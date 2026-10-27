import { existsSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { type AgentProfile, agentProfileSeatSchema } from '@tangle-network/agent-interface'
import { type AgentGraph, promptHandle, runGraph } from '@tangle-network/agent-runtime/kernel'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { contentAddress } from '../../src/durable/content-address'
import { SettledRunDirectoryError } from '../../src/durable/settle-record'
import { FileSpawnJournal } from '../../src/durable/spawn-journal/journal-store'
import { superviseGraphPursuit } from '../../src/durable/supervise-pursuit'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
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
function processStages(cwd: string, script: string, jsonOutput = false): MakeWorkerAgent {
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
          args: ['-e', script, profile.name, JSON.stringify(task)],
          cwd,
          timeoutMs: 10000,
          signal: executionSignal,
        }).then((child) => {
          const out: unknown = jsonOutput
            ? JSON.parse(child.stdout)
            : { content: child.stdout.trim() }
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

async function retainAndRemove(directory: string, label: string): Promise<void> {
  const retained = process.env.RUNTIME_FLOW_ADMISSION_PROOF_DIR
  if (retained) {
    await mkdir(retained, { recursive: true })
    await cp(directory, join(retained, label), { recursive: true })
  }
  await rm(directory, { recursive: true, force: true })
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
    const processScript = [
      "const fs=require('node:fs');const input=JSON.parse(process.argv[2]);",
      "fs.appendFileSync('stages.jsonl',JSON.stringify({stage:process.argv[1],input})+'\\n');",
      "process.stdout.write('delivered:accepted');",
    ].join('')
    const options = {
      makeLeafAgent: processStages(directory, processScript),
      runDir: join(directory, 'run'),
      runId: 'canonical-file-run',
      allowedModels: ['offline/local-process'],
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
    await retainAndRemove(directory, 'canonical')
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

// Public execution with real child processes. These fixtures spend no model or account work.
it.each([
  { model: { default: 'forbidden/default' } },
  { model: { default: 'offline/local-process', small: 'forbidden/small' } },
  { subagents: { critic: { model: 'forbidden/subagent' } } },
  { modes: { review: { model: 'forbidden/mode' } } },
  { model: { provider: 'runtime', default: 'runtime/flow' } },
] satisfies Partial<AgentProfile>[])(
  'refuses real graph model fields before durable or process effects: %j',
  async (override) => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-model-refusal-'))
    try {
      const loaded = await loadGraphFile(
        fileURLToPath(new URL('./fixtures/canonical.graph.yaml', import.meta.url)),
      )
      const graph = graphFromStored(loaded.graph, { trigger: { event: 'opened' } })
      const nodes = graph.nodes.map((node, index) =>
        index === 0 ? { ...node, profile: { ...node.profile, ...override } } : node,
      )
      expect(() =>
        runGraph(
          { ...graph, nodes },
          {
            allowedModels: ['offline/local-process'],
            runDir: join(directory, 'run'),
            makeLeafAgent: processStages(directory, 'throw new Error("must never execute")'),
          },
        ),
      ).toThrow(/model .* is not in the allowed set/)
      expect(existsSync(join(directory, 'run'))).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

it.each(['allowed', 'default', 'small', 'subagent', 'mode', 'synthetic'])(
  'enforces the allowlist through real process maps of nested flows: %s',
  async (variant) => {
    const directory = await mkdtemp(join(tmpdir(), 'graph-nested-flow-models-'))
    const profile = (name: string): AgentProfile => ({
      name,
      harness: 'cli-base',
      model: { provider: 'offline', default: 'offline/local-process' },
    })
    const inner = profile('flow') // A genuine node may share the synthetic root's name.
    if (variant === 'default') inner.model = { default: 'forbidden/default' }
    if (variant === 'small') inner.model = { ...inner.model, small: 'forbidden/small' }
    if (variant === 'subagent') inner.subagents = { critic: { model: 'forbidden/subagent' } }
    if (variant === 'mode') inner.modes = { review: { model: 'forbidden/mode' } }
    if (variant === 'synthetic') inner.model = { provider: 'runtime', default: 'runtime/flow' }
    const graph: AgentGraph = {
      nodes: ['plan', 'collect'].map((id) => ({ id, profile: profile(id) })),
      entry: [{ node: 'plan', task: 'two items' }],
      edges: [
        {
          kind: 'maps',
          from: 'plan',
          pointer: '/items',
          join: 'collect',
          graph: {
            nodes: [{ id: 'flow', profile: inner }],
            entry: [{ node: 'flow', task: { item: true } }],
            edges: [],
          },
          directive: promptHandle('delegates/worker-brief/v1'),
          maxItems: 2,
          concurrency: 2,
          onItemFailure: 'all-or-refuse',
        },
      ],
      budget: { maxIterations: 100, maxTokens: 10000 },
      deliverable: { describe: 'both nested items joined', check: () => true },
    }
    const script = `const fs=require('node:fs');const name=process.argv[1];
      const task=JSON.parse(process.argv[2]);fs.appendFileSync('stages.jsonl',JSON.stringify({name,task})+'\\n');
      process.stdout.write(JSON.stringify(name==='plan'?{items:['a','b']}:name==='flow'?{checked:task}:{joined:task}));`
    try {
      const options = {
        allowedModels: ['offline/local-process'],
        runDir: join(directory, 'run'),
        runId: 'nested-flow-models',
        driverRetry: { enabled: false },
        makeLeafAgent: processStages(directory, script, true),
      }
      let result: Awaited<ReturnType<typeof runGraph>> | undefined
      let failure: unknown
      try {
        result = await runGraph(graph, options)
      } catch (error) {
        failure = error
      }
      const stages = (await readFile(join(directory, 'stages.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { name: string; task: unknown })
      if (variant === 'allowed') {
        expect(failure).toBeUndefined()
        expect(result?.result.kind, JSON.stringify(result)).toBe('winner')
        expect(
          stages
            .filter((stage) => stage.name === 'flow')
            .map((stage) => stage.task)
            .sort(),
        ).toEqual(['a', 'b'])
        expect(stages.filter((stage) => stage.name === 'collect')).toHaveLength(1)
        const resumed = await runGraph(graph, options)
        expect(resumed.result.kind).toBe('winner')
        expect(
          (await readFile(join(directory, 'stages.jsonl'), 'utf8')).trim().split('\n'),
        ).toHaveLength(4)
      } else {
        expect(result?.result.kind).not.toBe('winner')
        expect(stages.map((stage) => stage.name)).toEqual(['plan'])
        const journal = await readFile(join(options.runDir, 'spawn-journal.jsonl'), 'utf8')
        const rejected = variant === 'synthetic' ? 'runtime/flow' : `forbidden/${variant}`
        expect(journal + String(failure)).toContain(`model "${rejected}" is not in the allowed set`)
      }
    } finally {
      await retainAndRemove(directory, `nested-${variant}`)
    }
  },
)
