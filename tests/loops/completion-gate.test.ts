import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type DeliverableSpec,
  gateOnDeliverable,
} from '../../src/runtime/supervise/completion-gate'
import {
  type CoordinationDriverOptions,
  coordinationDriverAgent,
  type DriverChat,
  type DriverMessage,
  type DriverTurn,
} from '../../src/runtime/supervise/coordination-driver'
import { driverChild, withDriverExecutor } from '../../src/runtime/supervise/driver-executor'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  UsageEvent,
} from '../../src/runtime/supervise/types'

// ── Two leaf-worker shapes, to exercise BOTH `execute` shapes the gate wraps ──────────────
interface WorkerScript {
  readonly out: unknown
  readonly score: number
}

/** Streaming worker: yields UsageEvents, terminal artifact read from resultArtifact(). */
function streamingWorker(s: WorkerScript): Executor<unknown> {
  return {
    runtime: 'router',
    execute() {
      return (async function* () {
        yield { kind: 'iteration' } as UsageEvent
        yield { kind: 'tokens', input: 5, output: 5 } as UsageEvent
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `w:${JSON.stringify(s.out)}`,
        out: s.out,
        verdict: { valid: true, score: s.score }, // inner "self-verdict" — the gate OVERRIDES valid
        spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
      }
    },
  }
}

/** One-shot worker: execute() resolves an ExecutorResult directly (the other gate branch). */
function oneShotWorker(s: WorkerScript): Executor<unknown> {
  const artifact: ExecutorResult<unknown> = {
    outRef: `o:${JSON.stringify(s.out)}`,
    out: s.out,
    verdict: { valid: true, score: s.score },
    spent: { iterations: 1, tokens: { input: 5, output: 5 }, usd: 0, ms: 0 },
  }
  return {
    runtime: 'router',
    execute: async () => artifact,
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact: () => artifact,
  }
}

/** Drive an executor to settlement the way the Scope does, then read the gated verdict. */
async function settle(ex: Executor<unknown>): Promise<ExecutorResult<unknown>> {
  const r = ex.execute(undefined, new AbortController().signal)
  if (Symbol.asyncIterator in (r as object)) {
    for await (const _ of r as AsyncIterable<UsageEvent>) {
      /* drain */
    }
    return ex.resultArtifact()
  }
  return r as Promise<ExecutorResult<unknown>>
}

describe('gateOnDeliverable — the leaf completion-oracle (valid ⟺ the deliverable check passes)', () => {
  it('sets valid=true and preserves the inner score when the check passes (streaming)', async () => {
    const ex = gateOnDeliverable(streamingWorker({ out: { answer: 42 }, score: 0.9 }), {
      check: (out) => (out as { answer: number }).answer === 42,
    })
    const art = await settle(ex)
    expect(art.verdict?.valid).toBe(true)
    expect(art.verdict?.score).toBe(0.9) // score is preserved; only `valid` is gated
  })

  it('overrides valid=false when the check fails, even though the worker RAN and self-scored high', async () => {
    const ex = gateOnDeliverable(streamingWorker({ out: { answer: 7 }, score: 0.95 }), {
      check: (out) => (out as { answer: number }).answer === 42,
    })
    const art = await settle(ex)
    expect(art.verdict?.valid).toBe(false) // did NOT deliver — self-score is irrelevant
    expect(art.verdict?.score).toBe(0.95)
  })

  it('is fail-closed: a throwing check is NOT a delivery (valid=false, no crash)', async () => {
    const ex = gateOnDeliverable(streamingWorker({ out: {}, score: 1 }), {
      check: () => {
        throw new Error('checker blew up')
      },
    })
    const art = await settle(ex)
    expect(art.verdict?.valid).toBe(false)
  })

  it('gates the one-shot execute() shape too (resolved ExecutorResult)', async () => {
    const pass = await settle(
      gateOnDeliverable(oneShotWorker({ out: 'ok', score: 0.5 }), { check: () => true }),
    )
    const fail = await settle(
      gateOnDeliverable(oneShotWorker({ out: 'ok', score: 0.5 }), { check: () => false }),
    )
    expect(pass.verdict?.valid).toBe(true)
    expect(fail.verdict?.valid).toBe(false)
  })
})

// ── End-to-end: the honest settle through a real driver + the recursion ───────────────────
const perWorker: Budget = { maxIterations: 4, maxTokens: 1000 }
let blobs = new InMemoryResultBlobStore()

function scriptedChat(turns: DriverTurn[], seen: DriverMessage[][] = []): DriverChat {
  let i = 0
  return {
    next: async (input) => {
      seen.push([...input.messages])
      const t = turns[Math.min(i, turns.length - 1)] ?? {}
      i += 1
      return t
    },
  }
}

function driverOpts(
  name: string,
  chat: DriverChat,
  makeWorkerAgent: (p: unknown) => Agent<unknown, unknown>,
): CoordinationDriverOptions {
  return { name, chat, blobs, makeWorkerAgent, perWorker, systemPrompt: 'drive', maxTurns: 8 }
}

/** A leaf worker whose executor is gated on a deliverable — `out` is delivered ONLY if `check` passes. */
function gatedWorkerLeaf(
  name: string,
  s: WorkerScript,
  deliverable: DeliverableSpec,
): Agent<unknown, unknown> {
  const spec: AgentSpec = {
    profile: { name } as AgentProfile,
    harness: null,
    executor: gateOnDeliverable(streamingWorker(s), deliverable),
  }
  return { name, act: async () => s.out, executorSpec: spec } as Agent<unknown, unknown> & {
    executorSpec: AgentSpec
  }
}

const spawnAwaitStop: DriverTurn[] = [
  { toolCalls: [{ name: 'spawn_worker', arguments: { profile: { kind: 'worker' }, task: 'go' } }] },
  { toolCalls: [{ name: 'await_next', arguments: {} }] },
  { content: 'stop' },
]

describe('completion-oracle settle — settled ⟺ DELIVERED (Foreman 0/18)', () => {
  it('a worker that RAN but FAILED its deliverable check yields NO winner (honest "produced nothing")', async () => {
    blobs = new InMemoryResultBlobStore()
    const worker = gatedWorkerLeaf(
      'w',
      { out: { code: 'broken' }, score: 0.95 },
      { check: () => false }, // it ran, it self-scored 0.95 — but it did not deliver
    )
    const root = coordinationDriverAgent(
      driverOpts('root', scriptedChat(spawnAwaitStop), () => worker),
    )
    const result = await createSupervisor<unknown, unknown>().run(root, 'ship it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cg',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })
    expect(result.kind).not.toBe('winner') // the lie ("done" without a passing check) is refused
  })

  it('the same worker DELIVERS (check passes) → a winner', async () => {
    blobs = new InMemoryResultBlobStore()
    const worker = gatedWorkerLeaf(
      'w',
      { out: { code: 'works' }, score: 0.6 },
      { check: () => true },
    )
    const root = coordinationDriverAgent(
      driverOpts('root', scriptedChat(spawnAwaitStop), () => worker),
    )
    const result = await createSupervisor<unknown, unknown>().run(root, 'ship it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cg',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })
    expect(result.kind).toBe('winner')
  })

  it('the gate dominates score: a DELIVERED low-score child beats an UNDELIVERED high-score one', async () => {
    blobs = new InMemoryResultBlobStore()
    const delivered = gatedWorkerLeaf(
      'a',
      { out: { pick: 'me' }, score: 0.5 },
      { check: () => true },
    )
    const ran = gatedWorkerLeaf(
      'b',
      { out: { pick: 'not-me' }, score: 0.99 },
      { check: () => false },
    )
    const makeAgent = (raw: unknown) =>
      (raw as { which?: string })?.which === 'b' ? ran : delivered
    // spawn BOTH, await BOTH, stop.
    const turns: DriverTurn[] = [
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: { which: 'a' }, task: 'a' } },
          { name: 'spawn_worker', arguments: { profile: { which: 'b' }, task: 'b' } },
        ],
      },
      {
        toolCalls: [
          { name: 'await_next', arguments: {} },
          { name: 'await_next', arguments: {} },
        ],
      },
      { content: 'stop' },
    ]
    const root = coordinationDriverAgent(driverOpts('root', scriptedChat(turns), makeAgent))
    const result = await createSupervisor<unknown, unknown>().run(root, 'choose', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cg',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      maxDepth: 4,
      now: () => 0,
    })
    expect(result.kind).toBe('winner')
    if (result.kind === 'winner') expect(result.out).toEqual({ pick: 'me' }) // not the 0.99 that didn't deliver
  })

  it('delivery propagates UP the recursion: a sub-driver whose worker failed its check cannot settle "delivered"', async () => {
    blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()

    // The mid driver spawns ONE worker whose deliverable check FAILS.
    const makeAgent = (raw: unknown): Agent<unknown, unknown> => {
      const p = raw as { kind?: string }
      if (p?.kind === 'driver') {
        return driverChild(
          'mid',
          coordinationDriverAgent(driverOpts('mid', scriptedChat(spawnAwaitStop), makeAgent)),
          journal,
        )
      }
      return gatedWorkerLeaf(
        'leaf',
        { out: { code: 'broken' }, score: 0.95 },
        { check: () => false },
      )
    }
    const rootTurns: DriverTurn[] = [
      {
        toolCalls: [
          { name: 'spawn_worker', arguments: { profile: { kind: 'driver' }, task: 'delegate' } },
        ],
      },
      { toolCalls: [{ name: 'await_next', arguments: {} }] },
      { content: 'stop' },
    ]
    const root = coordinationDriverAgent(driverOpts('root', scriptedChat(rootTurns), makeAgent))
    const result = await createSupervisor<unknown, unknown>().run(root, 'delegate it', {
      budget: { maxIterations: 100, maxTokens: 100_000 },
      runId: 'cg',
      journal,
      executors: withDriverExecutor(createExecutorRegistry()),
      blobs,
      maxDepth: 4,
      now: () => 0,
    })
    // The sub-driver delivered nothing → its settlement is NOT valid → the root has no delivered
    // child → no winner. A non-recursive "trust the sub-driver's word" build would wrongly win.
    expect(result.kind).not.toBe('winner')
  })
})
