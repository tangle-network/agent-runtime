import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileSpawnJournal } from '../../src/durable/spawn-journal'
import { supervisePursuit } from '../../src/durable/supervise-pursuit'
import type { DriveHarness } from '../../src/runtime/supervise/supervisor-agent'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  SpawnEvent,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { runtimeToolDeclarations, testAgentProfile } from '../kernel/test-agent-profile'

const budget: Budget = { maxIterations: 100, maxTokens: 100_000 }
const perWorker: Budget = { maxIterations: 4, maxTokens: 1_000 }
const task = 'deliver one settled result'
const rootProfile = testAgentProfile('model-change-root', {
  prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
  tools: runtimeToolDeclarations('spawn_worker', 'stop'),
})
const toLuna = { model: 'gpt-6-luna', reasoningEffort: 'high', reason: 'gpt-6 is on the seat now' }

describe('supervisePursuit resumed on another model', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pursuit-model-change-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('keeps one run: the root drives the new model and the journal records the change once', async () => {
    const runDir = join(root, 'run')
    const driven: Array<string | undefined> = []
    await run(runDir, driven)
    const before = await events(runDir)
    // A process that died after its journal and before its settle record leaves this state.
    await rm(join(runDir, 'result.json'))

    const resumed = await run(runDir, driven, { modelChange: toLuna })
    expect(resumed.result.kind).toBe('winner')
    expect(driven[0]).toBe('offline-test-model')
    expect(driven.at(-1)).toBe('gpt-6-luna')

    const after = await events(runDir)
    const roots = after.filter((event) => event.kind === 'spawned' && event.parent === undefined)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toEqual(before.find((event) => event.kind === 'spawned'))
    const changes = after.filter((event) => event.kind === 'model-changed')
    expect(changes).toEqual([
      expect.objectContaining({
        id: 'run:model',
        from: { model: 'offline-test-model' },
        to: { model: 'gpt-6-luna', reasoningEffort: 'high' },
        reason: 'gpt-6 is on the seat now',
        seq: 0,
      }),
    ])

    // Another entry on the same model adds nothing; the change already holds.
    await rm(join(runDir, 'result.json'))
    await run(runDir, driven, { modelChange: toLuna })
    expect((await events(runDir)).filter((event) => event.kind === 'model-changed')).toHaveLength(1)
    expect(driven.at(-1)).toBe('gpt-6-luna')
  })

  it('still refuses a resume that changes anything but the model', async () => {
    const runDir = join(root, 'run')
    await run(runDir, [])
    await rm(join(runDir, 'result.json'))
    const otherPrompt = { ...rootProfile, prompt: { systemPrompt: 'Delegate twice.' } }
    await expect(run(runDir, [], { profile: otherPrompt, modelChange: toLuna })).rejects.toThrow(
      /resume identity mismatch/,
    )
  })

  it('refuses a model change on a run with no recorded root', async () => {
    await expect(run(join(root, 'fresh'), [], { modelChange: toLuna })).rejects.toThrow(
      /a new run takes its model from its profile/,
    )
  })

  it('refuses a model change without a reason', async () => {
    const runDir = join(root, 'run')
    await run(runDir, [])
    await rm(join(runDir, 'result.json'))
    await expect(
      run(runDir, [], { modelChange: { model: 'gpt-6-luna', reason: ' ' } }),
    ).rejects.toThrow(/must say why the model changed/)
  })
})

function run(
  runDir: string,
  driven: Array<string | undefined>,
  overrides: Record<string, unknown> = {},
) {
  const { profile = rootProfile, ...options } = overrides
  return supervisePursuit(profile as typeof rootProfile, task, {
    pursuitId: 'pursuit:model-change',
    runId: 'run:model',
    runDir,
    budget,
    perWorker,
    driveHarness: delegateOnce(driven),
    makeWorkerAgent: () => deliveringLeaf('worker'),
    ...options,
  })
}

async function events(runDir: string): Promise<SpawnEvent[]> {
  return (
    (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree('run:model')) ?? []
  )
}

function deliveringLeaf(name: string): Agent<unknown, unknown> {
  const executor: Executor<unknown> = {
    runtime: 'record-test-worker',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
        yield { kind: 'cost', usd: 0, usdKnown: true, provenance: 'provider-receipt' } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: (): ExecutorResult<unknown> => ({
      outRef: `record:${name}`,
      out: { worker: name },
      verdict: { valid: true, score: 1 },
      spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
    }),
  }
  const spec: AgentSpec = { profile: testAgentProfile(name), harness: null, executor }
  return { name, act: async () => ({ worker: name }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

async function jsonRpc(url: string, method: string, params: unknown): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error(`coordination MCP returned ${response.status}`)
  const body = await response.json()
  if (body.error || body.result?.isError) throw new Error(JSON.stringify(body))
}

/** Records the model each drive runs, spawns one worker, and stops on the wake that settles it. */
function delegateOnce(driven: Array<string | undefined>): DriveHarness {
  let drives = 0
  return async ({ profile, coordinationMcpUrl }) => {
    driven.push(profile.model?.default)
    drives += 1
    if (drives === 1) {
      await jsonRpc(coordinationMcpUrl, 'tools/call', {
        name: 'spawn_worker',
        arguments: { profile: testAgentProfile('worker'), task: 'deliver', label: 'worker' },
      })
      return
    }
    await jsonRpc(coordinationMcpUrl, 'tools/call', { name: 'stop', arguments: {} })
  }
}
