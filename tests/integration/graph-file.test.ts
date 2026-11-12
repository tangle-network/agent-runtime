import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  agentProfileSeatSchema,
  canonicalAgentProfileDigest,
} from '@tangle-network/agent-interface'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { contentAddress } from '../../src/durable/content-address'
import { SettledRunDirectoryError } from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { superviseGraphPursuit } from '../../src/durable/supervise-pursuit'
import { discoverDurableSupervisionRun } from '../../src/durable/supervision-discovery'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import {
  FileCoordinationLog,
  FileResultBlobStore,
  graphFlowSpawnProfile,
  type RouteFlowEvent,
} from '../../src/runtime/index'
import type { PortableContinuationPolicy } from '../../src/runtime/supervise/continuation-data'
import { runGraph } from '../../src/runtime/supervise/graph'
import { loadGraphFile } from '../../src/runtime/supervise/graph-file'
import {
  digestOfGraph,
  graphFromStored,
  listGraphRuns,
  loadGraph,
  recordGraphRun,
  recordStoredGraphRun,
  taskShapeDigest,
} from '../../src/runtime/supervise/graph-registry'
import { validateStoredGraph } from '../../src/runtime/supervise/stored-graph-validation'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'

/** Caller-owned deterministic process execution. The canonical profile remains identity data;
 * this seam proves graph plumbing, not native prompt/model/resource materialization. */
function processStages(cwd: string, script: string): MakeWorkerAgent {
  return (profile) => {
    const stop = new AbortController()
    let pending: Promise<ExecutorResult<unknown>> | undefined
    let artifact: ExecutorResult<unknown> | undefined
    let executionSignal: AbortSignal | undefined
    let started: number | undefined
    const executor: Executor<unknown> = {
      runtime: 'graph-file-process',
      execute(task, signal) {
        started = performance.now()
        executionSignal = AbortSignal.any([signal, stop.signal])
        pending = runSettledCommand({
          command: process.execPath,
          args: ['-e', script, profile.name, JSON.stringify(task), JSON.stringify(profile)],
          cwd,
          timeoutMs: 10000,
          signal: executionSignal,
        }).then((child) => {
          // A stage that prints a JSON object hands it on as its output (a maps source's items).
          const text = child.stdout.trim()
          const out = text.startsWith('{') ? JSON.parse(text) : { content: text }
          artifact = {
            out,
            outRef: contentAddress(out),
            verdict: { valid: child.exitCode === 0, score: child.exitCode === 0 ? 1 : 0 },
            // These deterministic OS processes perform no inference or billed provider work.
            spent: {
              iterations: 1,
              tokens: { input: 0, output: 0 },
              tokensKnown: true,
              usd: 0,
              usdKnown: true,
              ms: performance.now() - started!,
            },
          }
          return artifact
        })
        return pending
      },
      async teardown() {
        stop.abort('process fixture teardown')
        await pending?.catch((error) => {
          // The maintained runner throws the caller's abort reason only AFTER process-tree
          // termination is confirmed. A different failure must not become destroyed:true.
          const reason = executionSignal?.reason
          const aborted =
            executionSignal?.aborted &&
            (error === reason ||
              (!(reason instanceof Error) &&
                error instanceof Error &&
                error.message === String(reason)))
          if (!aborted) throw error
        })
        return { destroyed: true }
      },
      accounting() {
        const spent = artifact?.spent ?? {
          iterations: started === undefined ? 0 : 1,
          tokens: { input: 0, output: 0 },
          tokensKnown: true,
          usd: 0,
          usdKnown: true,
          ms: started === undefined ? 0 : performance.now() - started,
        }
        return { reported: spent, reservation: spent }
      },
      resultArtifact() {
        if (!artifact) throw new Error('process has not produced an artifact')
        return artifact
      },
    }
    const executorSpec: AgentSpec = { profile, harness: null, executor }
    return {
      name: profile.name,
      act: async () => {
        throw new Error('executor owns this process')
      },
      executorSpec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  }
}

// This proves loader, registry and routing plumbing with real processes. The CLI consumer owns
// real Bridge/native-harness qualification; these processes do not emulate the Bridge protocol.
it('loads one canonical file, persists its data check, and runs and resumes real process stages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-integration-'))
  const fixture = fileURLToPath(new URL('./fixtures/canonical.graph.yaml', import.meta.url))
  const params = { message: 'accepted', iterations: '12', input: { count: 3 } }
  try {
    const loaded = await loadGraphFile(fixture, { params })
    const sourceLoaded = await loadGraphFile(join(directory, 'authored.yaml'), {
      params,
      source: await readFile(fixture, 'utf8'),
    })
    expect(sourceLoaded.graph).toEqual(loaded.graph)
    expect(sourceLoaded.graph.digest).toBe(loaded.graph.digest)
    expect(loaded.params).toEqual({ ...params, iterations: 12 })
    expect(loaded.graph.nodes.map(({ id, profile }) => profile.name === id)).toEqual([true, true])
    expect(loaded.graph.nodes[0]!.profile.prompt?.systemPrompt).toBe('Build accepted.')
    expect(loaded.graph.entry?.[0]?.task).toEqual({
      message: 'accepted',
      input: { count: 3 },
      event: '${trigger.event}',
    })
    const json = parse(await readFile(fixture, 'utf8')) as Record<string, unknown>
    json.on = [{ schedule: { cron: '*/15 * * * *' } }]
    const jsonPath = join(directory, 'same.graph.json')
    await writeFile(jsonPath, JSON.stringify(json))
    const fromJson = await loadGraphFile(jsonPath, { params })
    expect(fromJson.graph.digest).toBe(loaded.graph.digest)
    expect(fromJson.on).not.toEqual(loaded.on)
    const override = 'cli-base/offline/override-process'
    const overrideSeat = agentProfileSeatSchema.parse({
      harness: 'cli-base',
      provider: 'offline',
      model: 'offline/override-process',
      selector: { kind: 'all-eligible' },
    })
    // The consumer supplies an already-canonical inventory choice; this fixture does not
    // claim to detect native credentials or parse Bridge seat syntax.
    const overridden = await loadGraphFile(fixture, {
      params,
      seat: override,
      nodeSeats: { build: 'must-not-be-selected' },
      resolveSeat: (seat, context) => {
        expect(context.lastCandidate).toBe(true)
        expect(seat).toBe(override)
        return { ...overrideSeat, reasoningEffort: 'none' }
      },
    })
    expect(overridden.graph.nodes.map(({ profile }) => profile.model?.default)).toEqual([
      'offline/override-process',
      'offline/override-process',
    ])
    expect(overridden.graph.nodes.every(({ profile }) => profile.seats === undefined)).toBe(true)
    expect(overridden.graph.nodes.map(({ profile }) => profile.model?.reasoningEffort)).toEqual([
      'none',
      'none',
    ])
    const preferences: Array<{ seat: string | undefined; lastCandidate: boolean }> = []
    const fallback = await loadGraphFile(fixture, {
      params,
      nodeSeats: { build: ['unavailable-first', 'available-last'] },
      resolveSeat: (seat, { lastCandidate }) => {
        preferences.push({ seat, lastCandidate })
        return lastCandidate ? overrideSeat : undefined
      },
    })
    expect(preferences).toEqual([
      { seat: 'unavailable-first', lastCandidate: false },
      { seat: 'available-last', lastCandidate: true },
    ])
    expect(fallback.graph.nodes[0]!.profile.model?.default).toBe(overrideSeat.model)
    const implicit = await loadGraphFile(join(directory, 'implicit.graph.json'), {
      source: JSON.stringify({
        ...json,
        nodes: [{ id: 'implicit', profile: {} }],
        entry: [{ node: 'implicit', task: {} }],
        edges: [],
        check: { node: 'implicit', pointer: '/content', equals: 'ok' },
      }),
      params,
      resolveSeat: (seat, context) => {
        expect(seat).toBeUndefined()
        expect(context.lastCandidate).toBe(true)
        return overrideSeat
      },
    })
    expect(implicit.graph.nodes[0]!.profile.harness).toBe(overrideSeat.harness)
    const unresolvedPath = join(directory, 'unresolved.graph.json')
    const unresolved = structuredClone(json)
    const unresolvedNodes = unresolved.nodes as Array<Record<string, unknown>>
    unresolvedNodes[0]!.seat = 'claude/native-default@high'
    await writeFile(unresolvedPath, JSON.stringify(unresolved))
    await expect(loadGraphFile(unresolvedPath, { params })).rejects.toThrow(
      'supply resolveSeat from Bridge login inventory',
    )
    delete unresolvedNodes[0]!.seat
    unresolvedNodes[0]!.needs = ['github']
    await writeFile(unresolvedPath, JSON.stringify(unresolved))
    await expect(loadGraphFile(unresolvedPath, { params })).rejects.toMatchObject({
      code: 'CONNECTION_REQUIRED',
      provider: 'github',
      node: 'build',
      fixCommand: 'tangle graph run --help',
    })
    const registry = { root: join(directory, 'registry') }
    await recordStoredGraphRun(registry, loaded.graph)
    expect(await listGraphRuns(registry)).toEqual([])
    const stored = await loadGraph(registry, loaded.graph.digest)
    if (!stored) throw new Error('registered canonical graph was not readable')
    const revision = join(registry.root, 'graphs', `${stored.digest}.json`)
    const original = await readFile(revision, 'utf8')
    const { digest: _digest, ...definition } = stored
    if (!definition.budget?.maxTokens) throw new Error('canonical fixture has no token budget')
    const alternate = await recordStoredGraphRun(registry, {
      ...definition,
      budget: { ...definition.budget, maxTokens: definition.budget.maxTokens + 1 },
    })
    try {
      await writeFile(revision, JSON.stringify(alternate))
      await expect(loadGraph(registry, stored.digest)).rejects.toThrow('content differs')
      await expect(recordStoredGraphRun(registry, stored)).rejects.toThrow('content differs')
      expect(await readFile(revision, 'utf8')).toBe(JSON.stringify(alternate))
      await writeFile(revision, JSON.stringify({ ...alternate, digest: stored.digest }))
      await expect(loadGraph(registry, stored.digest)).rejects.toThrow('content differs')
    } finally {
      await writeFile(revision, original)
    }
    expect(await loadGraph(registry, stored.digest)).toEqual(stored)
    const processScript = [
      "const fs=require('node:fs');const input=JSON.parse(process.argv[2]);",
      "fs.appendFileSync('stages.jsonl',JSON.stringify({stage:process.argv[1],input})+'\\n');",
      "process.stdout.write('delivered:accepted');",
    ].join('')
    const options = {
      makeLeafAgent: processStages(directory, processScript),
      runDir: join(directory, 'run'),
      runId: 'canonical-file-run',
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    }
    const graph = graphFromStored(stored, { trigger: { event: 'opened' } })
    const result = await runGraph(graph, options)
    expect(result.result.kind, JSON.stringify(result)).toBe('winner')
    const stages = (await readFile(join(directory, 'stages.jsonl'), 'utf8')).trim().split('\n')
    expect(stages).toHaveLength(2)
    expect(stages[0]).toContain('accepted')
    expect(stages[0]).toContain('opened')
    expect(await readFile(join(options.runDir, 'spawn-journal.jsonl'), 'utf8')).toContain('edge')
    const resumed = await runGraph(graph, options)
    expect(resumed.result.kind).toBe('winner')
    expect(
      (await readFile(join(directory, 'stages.jsonl'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2)
    const literalMessage = 'different ${HOME} ${trigger.other}'
    const literalEvent = 'opened ${HOME} ${trigger.other}'
    const rejected = await loadGraphFile(fixture, {
      params: { ...params, message: literalMessage },
    })
    expect(rejected.graph.digest).not.toBe(loaded.graph.digest)
    const rejectedGraph = graphFromStored(rejected.graph, { trigger: { event: literalEvent } })
    const startedAt = new Date().toISOString()
    const failure = await runGraph(rejectedGraph, {
      ...options,
      runDir: join(directory, 'rejected'),
      runId: 'canonical-check-rejected',
    })
    expect(failure.result.kind).toBe('no-winner')
    if (failure.result.kind !== 'no-winner')
      throw new Error('negative completion unexpectedly delivered')
    const spent = failure.result.spentTotal
    // Record the actual rejected process run, never a fabricated delivered-run receipt.
    const recorded = await recordGraphRun(registry, rejectedGraph, {
      graphDigest: digestOfGraph(rejectedGraph),
      taskDigest: taskShapeDigest({ fixture: 'literal-value-registry-replay' }),
      startedAt,
      finishedAt: new Date().toISOString(),
      outcome: { kind: 'no-winner', reason: failure.result.reason },
      cost: {
        iterations: spent.iterations,
        tokens: spent.tokens.input + spent.tokens.output,
        usd: spent.usd,
        ms: spent.ms,
      },
      traversals: failure.ledger.length,
      traceRunId: failure.runId,
    })
    expect(recorded.triggerBindings).toEqual([])
    const replayStored = await loadGraph(registry, recorded.digest)
    if (!replayStored) throw new Error('recorded process graph missing')
    const replay = graphFromStored(validateStoredGraph(replayStored), {
      trigger: { event: 'must not substitute', other: 'must not substitute' },
    })
    expect(replay.triggerBindings).toEqual([])
    expect(replay.entry?.[0]?.task).toEqual({
      message: literalMessage,
      input: { count: 3 },
      event: literalEvent,
    })
    expect(replay.nodes[0]?.profile.prompt?.systemPrompt).toBe(`Build ${literalMessage}.`)
    await expect(loadGraphFile(fixture, { params: { unknown: true } })).rejects.toThrow(
      'unknown parameter',
    )
    await expect(
      loadGraphFile(fixture, { params: { iterations: 'not-an-integer' } }),
    ).rejects.toThrow('must be integer')
    expect(() => graphFromStored(stored)).toThrow('missing trigger.event')
    expect(() => graphFromStored(stored, () => true)).toThrow('missing trigger.event')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('reopens a gracefully cancelled durable graph and retries only its interrupted real process', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-reopen-'))
  const fixture = fileURLToPath(new URL('./fixtures/canonical.graph.yaml', import.meta.url))
  const stop = new AbortController()
  const resumeStop = new AbortController()
  let pending: ReturnType<typeof superviseGraphPursuit> | undefined
  try {
    const loaded = await loadGraphFile(fixture, { params: { message: 'accepted' } })
    const graph = graphFromStored(loaded.graph, { trigger: { event: 'opened' } })
    const script = [
      "const fs=require('node:fs');const stage=process.argv[1];",
      "fs.appendFileSync('executions.jsonl',JSON.stringify({stage})+'\\n');",
      "if(stage==='review'&&!fs.existsSync('finish-review')){fs.writeFileSync('review-waiting',String(process.pid));setInterval(()=>{},100)}",
      "else process.stdout.write('delivered:accepted');",
    ].join('')
    const options = {
      pursuitId: 'canonical-graph-reopen',
      runId: 'canonical-reopen-run',
      runDir: join(directory, 'run'),
      makeLeafAgent: processStages(directory, script),
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    }
    pending = superviseGraphPursuit(graph, { ...options, signal: stop.signal })
    let pid: number | undefined
    const until = Date.now() + 5000
    while (Date.now() < until && pid === undefined) {
      try {
        const value = Number(await readFile(join(directory, 'review-waiting'), 'utf8'))
        if (Number.isSafeInteger(value) && value > 0) pid = value
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      }
      if (pid === undefined) await sleep(20)
    }
    if (pid === undefined) throw new Error('review subprocess did not reach its actual wait')
    process.kill(pid, 0)
    stop.abort('consumer SIGINT')
    const cancelled = await pending
    expect(cancelled.result.result).toMatchObject({ kind: 'no-winner', reason: 'cancelled' })
    expect(() => process.kill(pid!, 0)).toThrow()
    const prior = await readFile(join(options.runDir, 'result.json'), 'utf8')
    await expect(superviseGraphPursuit(graph, options)).rejects.toBeInstanceOf(
      SettledRunDirectoryError,
    )
    await writeFile(join(directory, 'finish-review'), 'complete the interrupted task')
    const budget = { maxIterations: 24, maxTokens: 20000 }
    pending = superviseGraphPursuit(graph, {
      ...options,
      signal: resumeStop.signal,
      reopen: {
        operator: 'integration-operator',
        reason: 'resume cancelled task',
        operationId: 'resume-1',
        budget,
      },
    })
    const resumed = await pending
    expect(resumed.result.result.kind, JSON.stringify(resumed.result.result)).toBe('winner')
    expect(resumed.result.runId).toBe(options.runId)
    expect(await readFile(join(options.runDir, 'settles', '1.json'), 'utf8')).toBe(prior)
    const events =
      (await new FileSpawnJournal(join(options.runDir, 'spawn-journal.jsonl')).loadTree(
        options.runId,
      )) ?? []
    expect(events.filter((event) => event.kind === 'reopened')).toEqual([
      expect.objectContaining({ id: options.runId, operationId: 'resume-1', budget }),
    ])
    const executions = (await readFile(join(directory, 'executions.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line).stage)
    expect(executions).toEqual(['build', 'review', 'review'])
    await expect(superviseGraphPursuit(graph, { ...options, resume: true })).rejects.toBeInstanceOf(
      SettledRunDirectoryError,
    )
  } finally {
    stop.abort('integration cleanup')
    resumeStop.abort('integration cleanup')
    await pending?.catch(() => undefined)
    await rm(directory, { recursive: true, force: true })
  }
})

it('persists authored trigger provenance while keeping inserted parameter and trigger values literal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-binding-provenance-'))
  const fixture = fileURLToPath(new URL('./fixtures/canonical.graph.yaml', import.meta.url))
  const message = 'show ${HOME} and ${trigger.other}'
  const input = { literal: '${trigger.other}', nested: ['${HOME}'] }
  const event = { literal: '${HOME}', nested: '${trigger.other}' }
  try {
    const loaded = await loadGraphFile(fixture, { params: { message, input } })
    expect(loaded.graph.triggerBindings).toHaveLength(1)
    expect(validateStoredGraph(loaded.graph)).toEqual(loaded.graph)
    const registry = { root: join(directory, 'registry') }
    await recordStoredGraphRun(registry, loaded.graph)
    const stored = await loadGraph(registry, loaded.graph.digest)
    if (!stored) throw new Error('compiled graph missing')
    const graph = graphFromStored(validateStoredGraph(stored), {
      trigger: { event, other: 'must not substitute' },
    })
    expect(graph.entry?.[0]?.task).toEqual({ message, input, event })
    expect(graph.nodes[0]?.profile.prompt?.systemPrompt).toBe(`Build ${message}.`)
    expect(() => graphFromStored(stored)).toThrow('missing trigger.event')
    expect(() => graphFromStored(stored, () => true)).toThrow('missing trigger.event')
    // The same registered compiled definition remains reusable for another event.
    expect(graphFromStored(stored, { trigger: { event: 'next' } }).entry?.[0]?.task).toEqual({
      message,
      input,
      event: 'next',
    })

    const bound = await loadGraphFile(fixture, { params: { message, input }, trigger: { event } })
    expect(bound.graph.triggerBindings).toEqual([])
    expect(graphFromStored(validateStoredGraph(bound.graph)).entry?.[0]?.task).toEqual({
      message,
      input,
      event,
    })
    expect(
      graphFromStored(bound.graph, { trigger: { other: 'must not substitute' } }).entry?.[0]?.task,
    ).toEqual({ message, input, event })

    const mixedFile = join(directory, 'mixed.json')
    const mixed = parse(await readFile(fixture, 'utf8')) as Record<string, unknown>
    ;(mixed.entry as Array<{ task: Record<string, unknown> }>)[0]!.task.mixed =
      '${params.message} / ${trigger.event}'
    await writeFile(mixedFile, JSON.stringify(mixed))
    const mixedLoaded = await loadGraphFile(mixedFile, { params: { message, input } })
    expect(
      graphFromStored(mixedLoaded.graph, { trigger: { event: '${trigger.other}' } }).entry?.[0]
        ?.task,
    ).toMatchObject({ mixed: `${message} / \${trigger.other}` })

    // Existing hand-authored StoredGraph values without provenance keep their trigger grammar.
    const { triggerBindings: _provenance, digest: _digest, ...definition } = loaded.graph
    const legacy = {
      ...definition,
      observed: false as const,
      budget: loaded.graph.budget!,
      edges: loaded.graph.edges as import('../../src/runtime/supervise/graph').AgentGraph['edges'],
      nodes: definition.nodes.map((node) => ({
        ...node,
        profile: { ...node.profile, prompt: { systemPrompt: 'legacy' } },
      })),
      entry: [{ node: 'build', task: { event: '${trigger.event}' } }],
      deliverable: { checkRef: 'route', when: { node: 'review', pointer: '/ok', equals: true } },
    }
    const legacyGraph = graphFromStored(legacy, { trigger: { event } })
    expect(legacyGraph.entry?.[0]?.task).toEqual({ event })
    expect(legacyGraph.triggerBindings).toBeUndefined()

    const tampered = structuredClone(loaded.graph)
    tampered.triggerBindings![0]!.parts = [{ trigger: ['different'] }]
    expect(() => validateStoredGraph(tampered)).toThrow('provisional value')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('judges a check that names a non-terminal node by its settled output, and keeps the terminal output', async () => {
  // Graph run 6f167e9e: the check read fetch-pr's merge_sha and review-pr's approval, but only the
  // terminal review-pr was in view, so the run ended no-winner whatever fetch-pr delivered.
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-nonterminal-check-'))
  const fixture = fileURLToPath(new URL('./fixtures/canonical.graph.yaml', import.meta.url))
  const json = parse(await readFile(fixture, 'utf8')) as Record<string, unknown>
  delete json.on
  const processScript = [
    'const input=JSON.parse(process.argv[2]);',
    "process.stdout.write('delivered:'+process.argv[1]);",
  ].join('')
  const run = async (buildExpected: string, runId: string) => {
    const loaded = await loadGraphFile(join(directory, `${runId}.graph.json`), {
      source: JSON.stringify({
        ...json,
        check: {
          describe: 'build and review both delivered',
          all: [
            { node: 'build', pointer: '/content', equals: buildExpected },
            { node: 'review', pointer: '/content', equals: 'delivered:review' },
          ],
        },
      }),
      params: { message: 'accepted', iterations: '12', input: { count: 3 } },
    })
    return runGraph(graphFromStored(loaded.graph, { trigger: { event: 'opened' } }), {
      makeLeafAgent: processStages(directory, processScript),
      runDir: join(directory, runId),
      runId,
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    })
  }
  try {
    const passed = await run('delivered:build', 'nonterminal-pass')
    expect(passed.result.kind, JSON.stringify(passed.result)).toBe('winner')
    // The deliverable stays the terminal node's output; the check alone reads build.
    if (passed.result.kind === 'winner')
      expect(passed.result.out).toEqual({ review: { content: 'delivered:review' } })
    // Still an exact, independent check: a wrong value for the non-terminal node fails it.
    const failed = await run('delivered:something-else', 'nonterminal-fail')
    expect(failed.result.kind).toBe('no-winner')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

it('judges a check that names a maps join by its settled output', async () => {
  // Review of #2222: the join's workers are bound by the overlay ledger, not by route events, so
  // a check naming the join read nothing and failed whatever the join delivered.
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-maps-join-check-'))
  const profile = {
    harness: 'cli-base',
    model: { provider: 'offline', default: 'offline/local-process' },
  }
  const directive = { surface: 'delegates/worker-brief', version: 1 }
  const processScript =
    "process.stdout.write(process.argv[1]==='source'?JSON.stringify({items:['a','b']}):'delivered:'+process.argv[1]);"
  const run = async (joinExpected: string, runId: string) => {
    const loaded = await loadGraphFile(join(directory, `${runId}.graph.json`), {
      source: JSON.stringify({
        graph: 'maps-join-check',
        describe: 'Map items, join them, review the join.',
        nodes: ['source', 'item', 'merge', 'review'].map((id) => ({ id, profile })),
        entry: [{ node: 'source', task: { event: '${trigger.event}' } }],
        edges: [
          {
            kind: 'maps',
            from: 'source',
            pointer: '/items',
            to: 'item',
            join: 'merge',
            directive,
            maxItems: 2,
            concurrency: 2,
            onItemFailure: 'settled-subset',
          },
          { kind: 'routes', from: 'merge', to: 'review', directive },
        ],
        budget: { maxIterations: 12, maxTokens: 10000 },
        check: {
          describe: 'the join and the review both delivered',
          all: [
            { node: 'merge', pointer: '/content', equals: joinExpected },
            { node: 'review', pointer: '/content', equals: 'delivered:review' },
          ],
        },
      }),
    })
    return runGraph(graphFromStored(loaded.graph, { trigger: { event: 'opened' } }), {
      makeLeafAgent: processStages(directory, processScript),
      runDir: join(directory, runId),
      runId,
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    })
  }
  try {
    const passed = await run('delivered:merge', 'maps-join-pass')
    expect(passed.result.kind, JSON.stringify(passed.result)).toBe('winner')
    if (passed.result.kind === 'winner')
      expect(passed.result.out).toEqual({ review: { content: 'delivered:review' } })
    const failed = await run('delivered:something-else', 'maps-join-fail')
    expect(failed.result.kind).toBe('no-winner')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

it('resumes an entry node under the profile its session started with', async () => {
  // Graph runs 86e4c408 and e09645de (#2479): a resume route back into an entry node added the
  // route directive to the profile, so the bridge refused to rebind the entry session (409).
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-resume-entry-'))
  const script = [
    "const fs=require('node:fs');",
    "if(process.argv[1]==='checker'){const again=!fs.existsSync('checked');fs.writeFileSync('checked','');",
    "process.stdout.write(JSON.stringify({again,profile:JSON.parse(process.argv[3])}))}else process.stdout.write(JSON.stringify({answer:'x',profile:JSON.parse(process.argv[3])}))",
  ].join('')
  const brief = { surface: 'delegates/worker-brief', version: 1 }
  const loaded = await loadGraphFile(join(directory, 'resume-entry.graph.json'), {
    source: JSON.stringify({
      graph: 'resume-entry',
      nodes: ['worker', 'checker'].map((id) => ({
        id,
        profile: {
          name: id,
          harness: 'cli-base',
          model: { provider: 'offline', default: 'offline/local-process' },
        },
      })),
      entry: ['worker'],
      edges: [
        { kind: 'routes', from: 'worker', to: 'checker', directive: brief, evidence: ['worker'] },
        {
          kind: 'routes',
          from: 'checker',
          to: 'worker',
          when: { pointer: '/again', equals: true },
          continuity: 'resume',
          maxTraversals: 1,
          directive: brief,
        },
        { kind: 'routes', from: 'checker', to: { finish: 'again' }, directive: brief },
      ],
      budget: { maxIterations: 8, maxTokens: 10000 },
      check: {
        describe: 'checker settled',
        all: [{ node: 'checker', pointer: '/again', exists: true }],
      },
    }),
  })
  const stages = processStages(directory, script)
  const worker: unknown[] = []
  const admitted = new Map<string, unknown[]>()
  try {
    const result = await runGraph(graphFromStored(loaded.graph, { trigger: {} }), {
      makeLeafAgent: (profile, ...rest) => {
        if (profile.name === 'worker') worker.push(profile)
        admitted.set(profile.name, [...(admitted.get(profile.name) ?? []), profile])
        return stages(profile, ...rest)
      },
      runDir: join(directory, 'run'),
      runId: 'resume-entry',
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
    })
    expect(result.result.kind, JSON.stringify(result.result)).toBe('winner')
    expect(worker).toHaveLength(2)
    expect(worker[1]).toEqual(worker[0])
    const discovery = await discoverDurableSupervisionRun(join(directory, 'run'))
    const log = new FileCoordinationLog(discovery.coordinationLogPath)
    const traversals: Extract<RouteFlowEvent, { kind: 'traversal' }>[] = []
    const blobs = new FileResultBlobStore(join(directory, 'run', 'blobs'))
    for (const stream of discovery.coordinationStreams) {
      expect(stream.unscopedRecords).toBe(0)
      for (const owner of stream.ownerIds) {
        const prior = await log.load(stream.runId, owner)
        for (const record of prior.records) {
          if (
            record.event.type !== 'route' ||
            record.event.route.kind !== 'traversal' ||
            !record.event.route.workerId
          )
            continue
          const traversal = record.event.route
          const derived = graphFlowSpawnProfile(
            graphFromStored(loaded.graph, { trigger: {} }),
            traversal,
          )
          traversals.push(traversal)
          expect(admitted.get(traversal.to)).toContainEqual(derived)
          const child = result.result.tree.nodes.find((item) => item.id === traversal.workerId)
          expect(child?.identity?.profileDigest).toBe(canonicalAgentProfileDigest(derived))
          expect(child?.outRef).toBeTruthy()
          const output = child?.outRef ? await blobs.get(child.outRef) : undefined
          expect((output as { profile?: unknown } | undefined)?.profile).toEqual(derived)
          expect(() =>
            graphFlowSpawnProfile(graphFromStored(loaded.graph), { ...traversal, edge: 'unknown' }),
          ).toThrow()
          expect(() =>
            graphFlowSpawnProfile(graphFromStored(loaded.graph), {
              ...traversal,
              outcome: 'unpropagated',
            }),
          ).toThrow()
        }
      }
    }
    expect(traversals.some((item) => item.to === 'checker')).toBe(true)
    expect(admitted.get('checker')?.[0]).not.toEqual(
      loaded.graph.nodes.find((item) => item.id === 'checker')?.profile,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 60_000)

it('stores an authored root policy and continues a real driver process after its check refuses a submission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'graph-file-root-policy-'))
  const file = join(directory, 'root.graph.json')
  const policy = {
    maxBarren: 2,
    failures: 'verbatim',
    panel: 'off',
    bar: 'on',
    profile: {
      id: 'authored-root-integration',
      opening: 'The outside graph check refused the submission.',
      plan: 'Read the settled worker and submit its checked result.',
      rules: 'Never change the outside check.',
      headings: {
        failures: 'Failures',
        protected: 'Passing',
        changed: 'Changes',
        findings: 'Findings',
        bar: 'Bar',
        plan: 'Next',
        rules: 'Rules',
      },
    },
  } satisfies PortableContinuationPolicy
  const definition = {
    nodes: [
      {
        id: 'lead',
        profile: {
          harness: 'opencode',
          model: { provider: 'fixture', default: 'fixture/native' },
          tools: {
            agent_runtime_coordination_spawn_worker: true,
            agent_runtime_coordination_submit_result: true,
          },
        },
      },
      {
        id: 'worker',
        profile: {
          harness: 'cli-base',
          model: { provider: 'fixture', default: 'fixture/process' },
        },
      },
    ],
    edges: [
      {
        kind: 'delegates',
        from: 'lead',
        to: 'worker',
        directive: { surface: 'delegates/worker-brief', version: 1 },
      },
    ],
    budget: { maxIterations: 12, maxTokens: 10000, deadlineMs: 10000 },
    check: { node: 'worker', pointer: '/done', equals: true },
    continuation: policy,
  }
  try {
    const load = (value: unknown) => loadGraphFile(file, { source: JSON.stringify(value) })
    const loaded = await load(definition)
    const changed = await load({ ...definition, continuation: { ...policy, maxBarren: 3 } })
    expect(changed.graph.digest).not.toBe(loaded.graph.digest)
    for (const invalid of [
      { ...policy, runPanel: 'ignored' },
      { ...policy, panel: 'on' },
      { ...policy, unknownControl: true },
      { ...policy, reference: 9 },
      { ...policy, best: { label: 'bad', verdict: { pass: 'yes' } } },
      { ...policy, profile: { ...policy.profile, panelModel: 3 } },
      { ...policy, profile: { ...policy.profile, questions: null } },
      { ...policy, profile: { ...policy.profile, unknownControl: true } },
    ])
      await expect(load({ ...definition, continuation: invalid })).rejects.toThrow()
    await expect(load({ ...definition, entry: [{ node: 'worker', task: {} }] })).rejects.toThrow(
      'no root manager',
    )
    const templated = await load({
      ...definition,
      continuation: { ...policy, profile: { ...policy.profile, opening: '${trigger.reason}' } },
    })
    expect(templated.graph.triggerBindings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['continuation', 'profile', 'opening'] }),
      ]),
    )
    const triggerRegistry = { root: join(directory, 'trigger-registry') }
    await recordStoredGraphRun(triggerRegistry, templated.graph)
    const triggerStored = await loadGraph(triggerRegistry, templated.graph.digest)
    if (!triggerStored) throw new Error('triggered root policy was not persisted')
    const hydrated = graphFromStored(validateStoredGraph(triggerStored), {
      trigger: { reason: 'Literal ${trigger.other}', other: 'must not be substituted' },
    })
    expect(hydrated.continuation?.profile.opening).toBe('Literal ${trigger.other}')
    expect(hydrated.triggerBindings).toEqual([])
    expect(() => graphFromStored(triggerStored)).toThrow('missing trigger.reason')
    expect(() => graphFromStored(triggerStored, { trigger: { reason: 42 } })).toThrow()
    const registry = { root: join(directory, 'registry') }
    await recordStoredGraphRun(registry, loaded.graph)
    const stored = await loadGraph(registry, loaded.graph.digest)
    if (!stored) throw new Error('authored root graph was not persisted')
    expect(stored.continuation).toEqual(policy)
    const graph = graphFromStored(validateStoredGraph(stored))
    expect(digestOfGraph(graph)).toBe(loaded.graph.digest)
    const tasks: string[] = []
    const mutablePolicy = structuredClone(policy)
    const options = {
      runId: 'authored-root-policy',
      runDir: join(directory, 'run'),
      makeLeafAgent: processStages(directory, 'process.stdout.write(JSON.stringify({done:true}))'),
      perWorker: { maxIterations: 1, maxTokens: 1000 },
      driverRetry: { enabled: false },
      driveHarness: async ({
        coordinationMcpUrl,
        coordinationMcpHeaders,
        task,
      }: Parameters<import('../../src/runtime/supervise/supervisor-agent').DriveHarness>[0]) => {
        tasks.push(String(task))
        mutablePolicy.profile.opening = 'caller changed this after admission'
        // This OS process calls Runtime's actual HTTP MCP surface. It is an offline driver,
        // not a substitute for the consumer's real native model/harness qualification.
        const program = `
const fs=require('node:fs'); const [url, headers, attempt]=process.argv.slice(1); const n=Number(attempt);
const name=n===1?'spawn_worker':'submit_result';
const args=n===1?{profile:{name:'worker'},task:'compute the result'}:{result:{worker:{done:n>=3}}};
fetch(url,{method:'POST',headers:{'content-type':'application/json',...JSON.parse(headers)},body:JSON.stringify({jsonrpc:'2.0',id:n,method:'tools/call',params:{name,arguments:args}})})
.then(async r=>{const body=await r.json();if(!r.ok||body.error||body.result?.isError)throw Error(JSON.stringify(body));fs.appendFileSync('root-attempts.jsonl',JSON.stringify({attempt:n,name,result:body.result})+'\\n')})
.catch(e=>{console.error(e);process.exitCode=1});`
        const child = await runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            program,
            coordinationMcpUrl,
            JSON.stringify(coordinationMcpHeaders ?? {}),
            String(tasks.length),
          ],
          cwd: directory,
          timeoutMs: 5000,
        })
        if (child.exitCode !== 0) throw new Error(child.stderr)
      },
    }
    expect(() => runGraph(graph, { ...options, continuation: policy })).toThrow('two policy owners')
    expect(() =>
      runGraph(
        { ...graph, continuation: { ...policy, append: 'ignored' } } as typeof graph,
        options,
      ),
    ).toThrow()
    expect(() =>
      runGraph(
        {
          ...graph,
          nodes: graph.nodes.map((node) =>
            node.id === 'lead'
              ? { ...node, profile: { ...node.profile, harness: 'cli-base' } }
              : node,
          ),
        },
        options,
      ),
    ).toThrow('external-harness root')
    const { continuation: _policy, ...noPolicy } = graph
    await expect(
      superviseGraphPursuit(noPolicy, {
        ...options,
        pursuitId: 'missing-root-policy',
        runDir: join(directory, 'missing-policy'),
      }),
    ).rejects.toThrow('continuation policy')
    expect(tasks).toHaveLength(0)
    await expect(
      recordStoredGraphRun(registry, {
        ...loaded.graph,
        continuation: { ...policy, runPanel: 'ignored' },
      } as typeof loaded.graph),
    ).rejects.toThrow()
    expect(() =>
      digestOfGraph({
        ...graph,
        continuation: { ...policy, append: () => 'ignored' },
      } as typeof graph),
    ).toThrow()
    const completed = await superviseGraphPursuit(
      { ...graph, continuation: mutablePolicy },
      {
        ...options,
        pursuitId: loaded.graph.digest,
      },
    )
    const result = completed.result
    expect(result.result).toMatchObject({ kind: 'winner', out: { worker: { done: true } } })
    expect(tasks).toHaveLength(3)
    expect(tasks[2]).toContain(policy.profile.opening)
    const attempts = (await readFile(join(directory, 'root-attempts.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((row) => JSON.parse(row))
    expect(attempts.map((row) => row.name)).toEqual([
      'spawn_worker',
      'submit_result',
      'submit_result',
    ])
    const replay = await runGraph(graph, options)
    expect(replay.result.kind).toBe('winner')
    expect(tasks).toHaveLength(3)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 20000)
