import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { loadSpawnForest } from '../../src/durable/spawn-journal/spawn-forest'
import type { MakeWorkerAgent } from '../../src/mcp/tools/coordination-contracts'
import { runSettledCommand } from '../../src/mcp/worktree-harness'
import {
  graphDigest,
  graphRegistry,
  listGraphRuns,
  loadGraph,
  taskShapeDigest,
} from '../../src/runtime/supervise/graph-registry'
import { createFileRunContext } from '../../src/runtime/supervise/run-context'
import { supervise, superviseFleetCapabilities } from '../../src/runtime/supervise/supervise'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type { Agent, AgentSpec, Executor, ExecutorResult } from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

/** Real process work through the public leaf seam. Profiles are retained identity data here;
 * this proof does not claim native model, prompt or resource materialization. */
function fileWriter(directory: string): MakeWorkerAgent {
  return (profile) => {
    const stop = new AbortController()
    let pending: Promise<ExecutorResult<unknown>> | undefined
    let artifact: ExecutorResult<unknown> | undefined
    let signal: AbortSignal | undefined
    const started = performance.now()
    const spend = () => ({
      iterations: pending === undefined ? 0 : 1,
      tokens: { input: 0, output: 0 },
      // This raw process emits no usage receipt. The native settlement path must preserve the
      // missing channels even though this fixture itself performs no inference.
      tokensKnown: false,
      usd: 0,
      usdKnown: false,
      ms: performance.now() - started,
    })
    const executor: Executor<unknown> = {
      runtime: 'graph-registry-process',
      execute(_task, childSignal) {
        signal = AbortSignal.any([childSignal, stop.signal])
        pending = runSettledCommand({
          command: process.execPath,
          args: [
            '-e',
            "const fs=require('node:fs');fs.appendFileSync('processes.jsonl',JSON.stringify({pid:process.pid})+'\\n');fs.writeFileSync('artifact.json',JSON.stringify({value:'accepted'}));process.stdout.write('artifact.json')",
          ],
          cwd: directory,
          timeoutMs: 10000,
          signal,
        }).then((child) => {
          if (child.exitCode !== 0) throw new Error(child.stderr)
          const out = { artifact: child.stdout, value: 'accepted' }
          artifact = {
            out,
            outRef: contentAddress(out),
            verdict: { valid: true, score: 1 },
            spent: spend(),
          }
          return artifact
        })
        return pending
      },
      async teardown() {
        stop.abort('graph process fixture teardown')
        await pending?.catch((error) => {
          if (
            !signal?.aborted ||
            (error !== signal.reason && error?.message !== String(signal.reason))
          )
            throw error
        })
        return { destroyed: true }
      },
      accounting: () => ({
        reported: artifact?.spent ?? spend(),
        reservation: artifact?.spent ?? spend(),
      }),
      resultArtifact() {
        if (artifact === undefined) throw new Error('process did not finish')
        return artifact
      },
    }
    const executorSpec: AgentSpec = { profile, harness: null, executor }
    return {
      name: profile.name,
      act: async () => {
        throw new Error('process executor owns the leaf')
      },
      executorSpec,
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
  }
}

type Harness = Parameters<DriveHarness>[0]
async function call(driver: Harness, name: string, args: unknown = {}) {
  const response = await fetch(driver.coordinationMcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...driver.coordinationMcpHeaders },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
    signal: AbortSignal.timeout(5000),
  })
  const body = await response.json()
  if (!response.ok || body.error || body.result?.isError) throw new Error(JSON.stringify(body))
  return body.result.structuredContent ?? JSON.parse(body.result.content[0].text)
}

const graph = {
  nodes: [
    {
      id: 'lead',
      profile: testAgentProfile('lead', {
        tools: runtimeToolDeclarations('spawn_worker', 'submit_result'),
      }),
    },
    { id: 'writer', profile: testAgentProfile('writer', { harness: 'cli-base' }) },
  ],
  edges: [
    {
      kind: 'delegates' as const,
      from: 'lead',
      to: 'writer',
      directive: { surface: 'delegates/worker-brief', version: 1 },
    },
  ],
}
const budget = { maxIterations: 12, maxTokens: 12000 }
const shape = {
  task: 'write-artifact',
  contract: 'artifact-json/v1',
  check: 'artifact/v1',
  resources: 'local-fixture',
}

async function run(
  directory: string,
  name: string,
  request: Record<string, unknown>,
  opts: { registry?: boolean; readGrants?: boolean } = {},
) {
  const context = createFileRunContext(join(directory, name), { withDriver: true })
  const registry = graphRegistry(join(directory, 'registry'))
  let leadTurns = 0
  let rootTurns = 0
  let spawned: Record<string, unknown> | undefined
  let before: Record<string, unknown> | undefined
  let after: Record<string, unknown> | undefined
  let history: Record<string, unknown> | undefined
  let failure: unknown
  let checks = 0
  let checkedOutput: unknown
  const readGrants = opts.readGrants !== false
  await supervise(
    testAgentProfile('root', {
      tools: runtimeToolDeclarations(
        'run_graph',
        'stop',
        ...(readGrants ? ['lookup_graph', 'graph_history'] : []),
      ),
    }),
    'write and assess the graph artifact',
    {
      runContext: context,
      runId: name,
      budget: { maxIterations: 40, maxTokens: 40000, deadlineMs: 15000 },
      perWorker: { maxIterations: 2, maxTokens: 2000 },
      inheritSpawnRights: false,
      driverRetry: { enabled: false },
      coordination: { host: '127.0.0.1', port: 0, authentication: true },
      ...(opts.registry === false ? {} : { graphRegistry: registry.root }),
      makeLeafAgent: fileWriter(directory),
      registry: {
        deliverables: {
          resolve(ref) {
            if (ref !== 'artifact/v1' && ref !== 'reject/v1' && ref !== 'flow/v1') return undefined
            return {
              async check(out) {
                checks++
                checkedOutput = out
                const actual = JSON.parse(await readFile(join(directory, 'artifact.json'), 'utf8'))
                const value = ref === 'flow/v1' ? (out as { writer: unknown }).writer : out
                return (
                  ref !== 'reject/v1' &&
                  JSON.stringify(value) ===
                    JSON.stringify({ artifact: 'artifact.json', value: actual.value }) &&
                  actual.value === 'accepted'
                )
              },
            }
          },
        },
      },
      // This controller calls the real authenticated MCP transport, without any model call.
      driveHarness: async (driver) => {
        try {
          if (driver.profile.name === 'lead') {
            if (++leadTurns === 1) {
              const child = await call(driver, 'spawn_worker', {
                profile: { name: 'writer' },
                task: 'write artifact.json',
                budget: { maxIterations: 1, maxTokens: 1000 },
              })
              expect(child.workerId, JSON.stringify(child)).toBeTypeOf('string')
            } else {
              const artifact = JSON.parse(await readFile(join(directory, 'artifact.json'), 'utf8'))
              await call(driver, 'submit_result', {
                result: { artifact: 'artifact.json', value: artifact.value },
              })
            }
            return
          }
          if (++rootTurns === 1) {
            if (readGrants)
              before = await call(driver, 'lookup_graph', { taskShape: request.taskShape ?? shape })
            else {
              await expect(call(driver, 'lookup_graph', { taskShape: shape })).rejects.toThrow()
              await expect(call(driver, 'graph_history')).rejects.toThrow()
            }
            spawned = await call(driver, 'run_graph', {
              graph,
              deliverable: 'write artifact.json',
              budget,
              key: 'write-artifact',
              ...request,
            })
            if (spawned?.error !== undefined || spawned?.resumed === 'completed')
              await call(driver, 'stop')
          } else {
            if (readGrants) {
              history = await call(driver, 'graph_history', {
                taskShape: request.taskShape ?? shape,
              })
              after = await call(driver, 'lookup_graph', { taskShape: request.taskShape ?? shape })
            }
            await call(driver, 'stop')
          }
        } catch (error) {
          failure = error
          throw error
        }
      },
    },
  )
  if (failure !== undefined) throw failure
  return { context, registry, spawned, before, after, history, checks, checkedOutput, rootTurns }
}

it('records independently checked native graph subtasks and replays their exact digest inside admission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-graph-registry-'))
  try {
    expect(superviseFleetCapabilities.graphRegistry).toBe(true)
    const first = await run(directory, 'first', { taskShape: shape, checkRef: 'artifact/v1' })
    expect(first.spawned).toHaveProperty('workerId')
    expect(first.before).toMatchObject({ decision: 'author' })
    expect(first.after).toMatchObject({ decision: 'replay', checkRef: 'artifact/v1' })
    expect(first.checks).toBe(1)
    expect(first.checkedOutput).toEqual({ artifact: 'artifact.json', value: 'accepted' })
    const records = await listGraphRuns(first.registry)
    expect(records).toHaveLength(1)
    const record = records[0]!
    expect(record).toMatchObject({
      outcome: { kind: 'delivered' },
      taskDigest: taskShapeDigest(shape),
      traversals: 1,
    })
    expect(record.cost).not.toHaveProperty('tokens')
    expect(record.cost).not.toHaveProperty('usd')
    expect(record.unknowns).toEqual(
      expect.arrayContaining(['token accounting is incomplete', 'dollar accounting is incomplete']),
    )
    const stored = await loadGraph(first.registry, record.graphDigest)
    expect(stored).toMatchObject({
      ...graph,
      budget,
      deliverable: { describe: 'write artifact.json', checkRef: 'artifact/v1' },
    })
    const { digest: _digest, ...definition } = stored!
    expect(graphDigest(definition)).toBe(record.graphDigest)
    const forest = await loadSpawnForest(first.context.journal, 'first')
    const admitted = forest.events.find(
      ({ event }) => event.kind === 'spawned' && event.id === first.spawned?.workerId,
    )?.event
    expect(admitted).toMatchObject({ kind: 'spawned', budget })
    if (admitted?.kind !== 'spawned' || admitted.profileRef === undefined)
      throw new Error('missing admitted graph')
    expect(record.evidence).toContainEqual({ kind: 'admitted-profile', url: admitted.profileRef })

    // Reconstruct the stores from their actual files after losing the derived registry row.
    // Journal replay must restore the same evidence without executing or checking again.
    await rm(join(first.registry.root, 'records.jsonl'))
    const recovered = await run(directory, 'first', { taskShape: shape, checkRef: 'artifact/v1' })
    expect(recovered.spawned).toMatchObject({
      resumed: 'completed',
      workerId: first.spawned?.workerId,
    })
    expect(recovered.checks).toBe(0)
    expect(await listGraphRuns(first.registry)).toEqual([record])

    const replay = await run(directory, 'replay', {
      graph: undefined,
      graphDigest: record.graphDigest,
      taskShape: shape,
    })
    expect(replay.before).toMatchObject({ decision: 'replay', graphDigest: record.graphDigest })
    expect(replay.checks).toBe(1)
    const replayed = await listGraphRuns(first.registry)
    expect(replayed).toHaveLength(2)
    expect(replayed.map((row) => row.graphDigest)).toEqual([record.graphDigest, record.graphDigest])
    expect(replayed[1]?.evidence).toContainEqual({ kind: 'source-graph', url: record.graphDigest })
    const processes = (await readFile(join(directory, 'processes.jsonl'), 'utf8'))
      .trim()
      .split('\n')
    expect(processes).toHaveLength(2)
    for (const receipt of processes)
      expect(() => process.kill(JSON.parse(receipt).pid, 0)).toThrow()

    const changed = await run(directory, 'changed-check', {
      graph: undefined,
      graphDigest: record.graphDigest,
      taskShape: shape,
      checkRef: 'reject/v1',
    })
    expect(changed.checks).toBe(1)
    const changedRecord = (await listGraphRuns(first.registry)).at(-1)!
    expect(changedRecord.graphDigest).not.toBe(record.graphDigest)
    expect(changedRecord.outcome.kind).toBe('no-winner')
    expect(await loadGraph(first.registry, record.graphDigest)).toEqual(stored)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('checks flow outputs through the same gate and leaves execution without taskShape unregistered', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-graph-flow-'))
  try {
    const flow = await run(directory, 'flow', {
      graph: {
        nodes: [graph.nodes[1]],
        edges: [],
        entry: [{ node: 'writer', task: 'write artifact.json' }],
      },
      taskShape: { ...shape, check: 'flow/v1' },
      checkRef: 'flow/v1',
    })
    expect(flow.after).toMatchObject({ decision: 'replay', checkRef: 'flow/v1' })
    expect(flow.checks).toBe(1)
    expect(flow.checkedOutput).toEqual({ writer: { artifact: 'artifact.json', value: 'accepted' } })
    const legacy = await run(directory, 'legacy', {}, { readGrants: false })
    expect(legacy.spawned).toHaveProperty('workerId')
    expect(legacy.checks).toBe(0)
    expect(await listGraphRuns(legacy.registry)).toHaveLength(1)
    expect(
      (await readFile(join(directory, 'processes.jsonl'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('keeps self-submission and failed checks out of reuse and refuses missing bindings before execution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'native-graph-unassessed-'))
  try {
    const unassessed = await run(directory, 'unassessed', { taskShape: shape })
    expect(unassessed.after).toMatchObject({ decision: 'author' })
    expect((await listGraphRuns(unassessed.registry))[0]).toMatchObject({
      outcome: { kind: 'unknown' },
    })
    expect(unassessed.checks).toBe(0)
    const rejected = await run(directory, 'rejected', { taskShape: shape, checkRef: 'reject/v1' })
    expect(rejected.after).toMatchObject({ decision: 'author' })
    expect((await listGraphRuns(rejected.registry))[1]).toMatchObject({
      outcome: { kind: 'no-winner' },
    })
    expect(rejected.checks).toBe(1)
    const missing = await run(directory, 'missing', { taskShape: shape, checkRef: 'missing/v1' })
    expect(missing.spawned).toMatchObject({ error: 'invalid-graph' })
    expect(await listGraphRuns(missing.registry)).toHaveLength(2)
    const noRegistry = await run(
      directory,
      'no-registry',
      { taskShape: shape },
      { registry: false, readGrants: false },
    )
    expect(noRegistry.spawned).toMatchObject({
      error: 'invalid-graph',
      reason: expect.stringContaining('graphRegistry'),
    })
    expect(
      (await readFile(join(directory, 'processes.jsonl'), 'utf8')).trim().split('\n'),
    ).toHaveLength(2)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)
