import type { AgentProfile } from '@tangle-network/sandbox'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import {
  type DeliverableSpec,
  gateOnDeliverable,
} from '../../src/runtime/supervise/completion-gate'
import {
  type DriverAgentOptions,
  driverAgent,
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
import type { ToolLoopChat } from '../../src/runtime/tool-loop'
import { type ScriptedTurn, scriptedBrain } from './scripted-brain'

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

function driverOpts(
  name: string,
  brain: ToolLoopChat,
  makeWorkerAgent: (p: unknown) => Agent<unknown, unknown>,
): DriverAgentOptions {
  return { name, brain, blobs, makeWorkerAgent, perWorker, systemPrompt: 'drive', maxTurns: 8 }
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

const spawnAwaitStop: ScriptedTurn[] = [
  { toolCalls: [{ name: 'spawn_agent', arguments: { profile: { kind: 'worker' }, task: 'go' } }] },
  { toolCalls: [{ name: 'await_event', arguments: {} }] },
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
    const root = driverAgent(driverOpts('root', scriptedBrain(spawnAwaitStop), () => worker))
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
    const root = driverAgent(driverOpts('root', scriptedBrain(spawnAwaitStop), () => worker))
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
    const turns: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { which: 'a' }, task: 'a' } },
          { name: 'spawn_agent', arguments: { profile: { which: 'b' }, task: 'b' } },
        ],
      },
      {
        toolCalls: [
          { name: 'await_event', arguments: {} },
          { name: 'await_event', arguments: {} },
        ],
      },
      { content: 'stop' },
    ]
    const root = driverAgent(driverOpts('root', scriptedBrain(turns), makeAgent))
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
          driverAgent(driverOpts('mid', scriptedBrain(spawnAwaitStop), makeAgent)),
          journal,
        )
      }
      return gatedWorkerLeaf(
        'leaf',
        { out: { code: 'broken' }, score: 0.95 },
        { check: () => false },
      )
    }
    const rootTurns: ScriptedTurn[] = [
      {
        toolCalls: [
          { name: 'spawn_agent', arguments: { profile: { kind: 'driver' }, task: 'delegate' } },
        ],
      },
      { toolCalls: [{ name: 'await_event', arguments: {} }] },
      { content: 'stop' },
    ]
    const root = driverAgent(driverOpts('root', scriptedBrain(rootTurns), makeAgent))
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

// ── The gate must not blind a live supervisor ─────────────────────────────────────────────
// A gated worker is still a RUNNING worker: the scope captures `progress`/`traceSource` at spawn,
// and ONLY if the executor exposes them. A gate that dropped them made `observe_agent` read
// `recentActivity:[]` for a genuinely-active worker and lost online detection — the exact blind
// steer this fix closes. `metered` is a driver-executor's own-inference subtree total; dropping it
// leaks a gated sub-driver's inference out of the journal.
describe('gateOnDeliverable — forwards the live-observation surfaces so a gated worker stays supervisable', () => {
  /** A worker that implements every optional executor surface, each with a distinct sentinel. */
  function observableWorker(): Executor<unknown> {
    const artifact: ExecutorResult<unknown> = {
      outRef: 'obs',
      out: { answer: 42 },
      verdict: { valid: true, score: 0.5 },
      spent: { iterations: 3, tokens: { input: 9, output: 9 }, usd: 0, ms: 0 },
    }
    // Stable instance so the test can assert the gate forwards the SAME source, not a copy.
    const traceSource = { onSpan: () => () => {}, collect: async () => [] }
    return {
      runtime: 'router',
      execute: async () => artifact,
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => artifact,
      deliver: () => {},
      progress: () => ({
        turns: 3,
        pendingMessages: 1,
        recentActivity: [{ at: 100, kind: 'tool', label: 'edit', detail: 'src/x.ts' }],
        note: 'turn 3, editing',
      }),
      traceSource: () => traceSource,
      metered: () => ({ iterations: 2, tokens: { input: 4, output: 4 }, usd: 0.01, ms: 5 }),
    }
  }

  it('forwards progress() to the inner value, not undefined', () => {
    const inner = observableWorker()
    const gated = gateOnDeliverable(inner, { check: () => true })
    // The exact failure this fixes: `readWorkerProgress` on a gated worker read undefined here.
    expect(typeof gated.progress).toBe('function')
    const p = gated.progress?.()
    expect(p).toEqual(inner.progress?.())
    expect(p?.turns).toBe(3)
    expect(p?.recentActivity?.[0]?.label).toBe('edit')
    expect(p?.pendingMessages).toBe(1)
  })

  it('forwards traceSource() and metered() through the wrapper', () => {
    const inner = observableWorker()
    const gated = gateOnDeliverable(inner, { check: () => true })
    expect(typeof gated.traceSource).toBe('function')
    expect(gated.traceSource?.()).toBe(inner.traceSource?.())
    expect(typeof gated.metered).toBe('function')
    expect(gated.metered?.()).toEqual(inner.metered?.())
  })

  it('preserves the "undefined ⟺ not implemented" contract for a leaf that omits them', () => {
    // A bare leaf implements none of the optional surfaces; the gate must not fabricate them,
    // or the scope would set up a readProgress that returns undefined and report a broken
    // observable state for a worker that genuinely has no live read.
    const bare = streamingWorker({ out: { answer: 42 }, score: 0.9 })
    const gated = gateOnDeliverable(bare, { check: () => true })
    expect(gated.progress).toBeUndefined()
    expect(gated.traceSource).toBeUndefined()
    expect(gated.metered).toBeUndefined()
  })
})
