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
const rootProfile = testAgentProfile('segment-root', {
  harness: 'claude-code',
  prompt: { systemPrompt: 'Delegate once, wait, then stop.' },
  tools: runtimeToolDeclarations('spawn_worker', 'stop'),
})
const toLuna = { model: 'gpt-6-luna', reasoningEffort: 'high', reason: 'gpt-6 is on the seat now' }
const stack = { '@tangle-network/agent-runtime': '0.312.0' }

describe('supervisePursuit: one run id for its whole life, in recorded segments', () => {
  let root: string
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'pursuit-segment-'))
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('keeps one run on another model: the root drives it and the journal records the segment once', async () => {
    const runDir = join(root, 'run')
    const driven: Driven[] = []
    await run(runDir, driven)
    const before = await events(runDir)
    // A process that died after its journal and before its settle record leaves this state.
    await rm(join(runDir, 'result.json'))

    const resumed = await run(runDir, driven, { segment: toLuna })
    expect(resumed.result.kind).toBe('winner')
    expect(driven[0]?.model).toBe('offline-test-model')
    expect(driven.at(-1)?.model).toBe('gpt-6-luna')

    const after = await events(runDir)
    const roots = after.filter((event) => event.kind === 'spawned' && event.parent === undefined)
    expect(roots).toHaveLength(1)
    expect(roots[0]).toEqual(before.find((event) => event.kind === 'spawned'))
    expect(segments(after)).toEqual([
      expect.objectContaining({
        id: 'run:segment',
        from: { provider: 'offline', model: 'offline-test-model', harness: 'claude-code' },
        to: {
          provider: 'offline',
          model: 'gpt-6-luna',
          reasoningEffort: 'high',
          harness: 'claude-code',
        },
        reason: 'gpt-6 is on the seat now',
        seq: 0,
      }),
    ])

    // Another entry on the same segment adds nothing: a resume is a boundary, not a segment.
    await rm(join(runDir, 'result.json'))
    await run(runDir, driven, { segment: toLuna })
    expect(segments(await events(runDir))).toHaveLength(1)
    expect(driven.at(-1)?.model).toBe('gpt-6-luna')
  })

  it('keeps one run in another harness: the root drives it and the journal records the segment', async () => {
    const runDir = join(root, 'run')
    const driven: Driven[] = []
    await run(runDir, driven)
    await rm(join(runDir, 'result.json'))

    const toCodex = {
      harness: 'codex',
      provider: 'openai',
      model: 'gpt-6.1-sol',
      reason: 'no Claude seat has room',
    } as const
    const resumed = await run(runDir, driven, { segment: toCodex })
    expect(resumed.result.kind).toBe('winner')
    expect(driven[0]?.harness).toBe('claude-code')
    expect(driven.at(-1)).toEqual({ harness: 'codex', model: 'gpt-6.1-sol' })
    expect(segments(await events(runDir))).toEqual([
      expect.objectContaining({
        from: { provider: 'offline', model: 'offline-test-model', harness: 'claude-code' },
        to: { provider: 'openai', model: 'gpt-6.1-sol', harness: 'codex' },
        reason: 'no Claude seat has room',
      }),
    ])
  })

  it('records the first segment of a fresh run, and a stack change as a new segment', async () => {
    const runDir = join(root, 'run')
    await run(runDir, [], { segment: { stack, reason: 'pressed' } })
    expect(segments(await events(runDir))).toEqual([
      expect.objectContaining({
        to: { provider: 'offline', model: 'offline-test-model', harness: 'claude-code', stack },
        reason: 'pressed',
        seq: 0,
      }),
    ])
    expect(segments(await events(runDir))[0]).not.toHaveProperty('from')

    await rm(join(runDir, 'result.json'))
    await run(runDir, [], { segment: { stack, reason: 'resumed' } })
    expect(segments(await events(runDir))).toHaveLength(1)

    await rm(join(runDir, 'result.json'))
    const next = { '@tangle-network/agent-runtime': '0.313.0' }
    await run(runDir, [], { segment: { stack: next, reason: 'resumed on agent-runtime 0.313.0' } })
    expect(segments(await events(runDir)).at(-1)).toMatchObject({
      from: { stack },
      to: { stack: next },
      seq: 1,
    })
  })

  it('still refuses a resume that changes anything but the segment', async () => {
    const runDir = join(root, 'run')
    await run(runDir, [])
    await rm(join(runDir, 'result.json'))
    const otherPrompt = { ...rootProfile, prompt: { systemPrompt: 'Delegate twice.' } }
    await expect(run(runDir, [], { profile: otherPrompt, segment: toLuna })).rejects.toThrow(
      /resume identity mismatch/,
    )
  })

  it('refuses a model or harness change on a run with no recorded root', async () => {
    await expect(run(join(root, 'fresh'), [], { segment: toLuna })).rejects.toThrow(
      /a new run takes them from its profile/,
    )
    await expect(
      run(join(root, 'fresh-harness'), [], { segment: { harness: 'codex', reason: 'x' } }),
    ).rejects.toThrow(/a new run takes them from its profile/)
  })

  it('refuses a segment without a reason', async () => {
    const runDir = join(root, 'run')
    await run(runDir, [])
    await rm(join(runDir, 'result.json'))
    await expect(
      run(runDir, [], { segment: { model: 'gpt-6-luna', reason: ' ' } }),
    ).rejects.toThrow(/must say why the segment starts/)
  })
})

interface Driven {
  readonly model?: string
  readonly harness?: string
}

function segments(all: SpawnEvent[]) {
  return all.filter((event) => event.kind === 'root-segment')
}

function run(runDir: string, driven: Driven[], overrides: Record<string, unknown> = {}) {
  const { profile = rootProfile, ...options } = overrides
  return supervisePursuit(profile as typeof rootProfile, task, {
    pursuitId: 'pursuit:segment',
    runId: 'run:segment',
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
    (await new FileSpawnJournal(join(runDir, 'spawn-journal.jsonl')).loadTree('run:segment')) ?? []
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

/** Records the model and harness each drive runs, spawns one worker, and stops on the wake that settles it. */
function delegateOnce(driven: Driven[]): DriveHarness {
  let drives = 0
  return async ({ profile, coordinationMcpUrl }) => {
    driven.push({
      ...(profile.harness === undefined ? {} : { harness: profile.harness }),
      ...(profile.model?.default === undefined ? {} : { model: profile.model.default }),
    })
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
