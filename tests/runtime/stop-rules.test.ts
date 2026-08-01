/**
 * Progress-based stop rules: a run ends because it stopped LEARNING, not because it ran out.
 *
 * The load-bearing test is the plateau pair. A tree of workers on a flat objective stops on the
 * rule with most of its token pool untouched; the CONTROL — identical pool, identical queue,
 * identical rule, the only change being that the workers genuinely improve — runs past the point
 * where the first arm stopped. Without the control, "it stopped" proves nothing: a rule that
 * always fires would pass the first assertion.
 *
 * The rest covers the boundaries the mechanic rests on: the rules read the SAME best-so-far math
 * as the post-run anytime report, and a rule can never keep a run alive past a hard ceiling.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { areaUnderCurve, bestSoFar, plateauLength } from '../../src/runtime/anytime'
import { createBudgetPool } from '../../src/runtime/supervise/budget'
import { driverAgent } from '../../src/runtime/supervise/coordination-driver'
import { queueOf, rollingDispatch } from '../../src/runtime/supervise/dispatch'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createScope } from '../../src/runtime/supervise/scope'
import {
  allOf,
  allWorkersStalled,
  anyOf,
  createProgressTracker,
  noProgressFor,
  type ProgressView,
  plateau,
  type StopRule,
  sampleFromSettled,
} from '../../src/runtime/supervise/stop-rules'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type {
  Agent,
  AgentSpec,
  Budget,
  Executor,
  ExecutorResult,
  Scope,
  UsageEvent,
} from '../../src/runtime/supervise/types'
import { scriptedBrain } from '../kernel/scripted-brain'

// ── A scored offline leaf: fixed token cost, a verdict score the rules read ─────────────────────

const WORKER_TOKENS = 100

function scoredLeaf(name: string, score: number): Agent<unknown, unknown> {
  const events: UsageEvent[] = [
    { kind: 'iteration' },
    { kind: 'tokens', input: WORKER_TOKENS / 2, output: WORKER_TOKENS / 2 },
  ]
  const executor: Executor<unknown> = {
    runtime: 'router',
    execute() {
      return (async function* () {
        for (const ev of events) yield ev
      })()
    },
    teardown: () => Promise.resolve({ destroyed: true }),
    resultArtifact(): ExecutorResult<unknown> {
      return {
        outRef: `w:${name}`,
        out: { name, score },
        verdict: { valid: true, score },
        spent: {
          iterations: 1,
          tokens: { input: WORKER_TOKENS / 2, output: WORKER_TOKENS / 2 },
          usd: 0,
          ms: 0,
        },
      }
    },
  }
  const spec: AgentSpec = { profile: { name } as AgentProfile, harness: null, executor }
  return { name, act: async () => ({ name, score }), executorSpec: spec } as Agent<
    unknown,
    unknown
  > & { executorSpec: AgentSpec }
}

const perUnit: Budget = { maxIterations: 2, maxTokens: WORKER_TOKENS }

/** Run a queue of scored units under a rolling dispatcher gated by `rule`. One scope, one
 *  conserved pool — so "did it stop before the ceiling?" is answered off the pool's own readout. */
async function dispatchUnderRule(scores: readonly number[], rule: StopRule) {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  const root = 'stop-run'
  await journal.beginTree(root, new Date(0).toISOString())
  // A pool that can afford EVERY unit in the queue, so any early stop is the rule's doing and not
  // the budget's. `deadlineMs` is left unset: this arm tests the progress bound, not the clock.
  const pool = createBudgetPool(
    { maxIterations: scores.length * 4, maxTokens: scores.length * WORKER_TOKENS * 2 },
    () => 0,
  )
  const scope = createScope<unknown>({
    parentId: root,
    root,
    pool,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    seams: {},
    depth: 0,
    signal: new AbortController().signal,
    now: () => 0,
  })

  let clock = 0
  const tracker = createProgressTracker({ now: () => clock })
  const nextUnit = queueOf(
    scores.map((s, i) => ({ agent: scoredLeaf(`u${i}`, s), task: i, label: `u${i}` })),
    perUnit,
  )
  const report = await rollingDispatch(scope, {
    width: 2,
    nextUnit,
    onSettled: (s) => {
      clock += 1_000
      tracker.record(sampleFromSettled(s, clock))
    },
    shouldStop: () => tracker.evaluate(rule).stop,
  })
  return {
    report,
    tokensLeft: pool.readout().tokensLeft,
    view: tracker.view(),
    queue: scores.length,
  }
}

// ── Rule unit behavior ────────────────────────────────────────────────────────────────────────

const viewOf = (overrides: Partial<ProgressView> = {}): ProgressView => ({
  now: 10_000,
  settles: 0,
  delivered: 0,
  curve: [],
  best: 0,
  auc: 0,
  lastSettleAt: 0,
  lastImprovementAt: 0,
  settlesSinceImprovement: 0,
  workers: [],
  inFlight: 0,
  waiting: 0,
  ...overrides,
})

describe('stop rules — the primitives', () => {
  it('reuses the anytime best-so-far/AUC/plateau math rather than re-deriving it', () => {
    // The extracted functions ARE the shared definition: the tracker's curve is `bestSoFar`, its
    // `auc` is `areaUnderCurve`, and `plateau` fires off `plateauLength`. Asserted directly so a
    // future divergence between the live rule and the post-run report fails here.
    expect(bestSoFar([0.2, 0.1, undefined, 0.5, 0.4])).toEqual([0.2, 0.2, 0.2, 0.5, 0.5])
    expect(areaUnderCurve([0, 0.5, 1])).toBeCloseTo(0.5)
    expect(plateauLength([0.1, 0.5, 0.5, 0.5], 0)).toBe(2)
    expect(plateauLength([0.1, 0.5, 0.5, 0.9], 0)).toBe(0)
    // minDelta is the noise floor: a 0.01 wobble is not an improvement at minDelta 0.05.
    expect(plateauLength([0.5, 0.51, 0.52], 0.05)).toBe(2)

    const tracker = createProgressTracker({ now: () => 5_000 })
    tracker.record({ id: 'a', at: 1_000, objective: 0.2, delivered: true })
    tracker.record({ id: 'b', at: 2_000, objective: 0.6, delivered: true })
    tracker.record({ id: 'b', at: 9_999, objective: 1, delivered: true }) // idempotent by id
    const v = tracker.view()
    expect(v.settles).toBe(2)
    expect(v.curve).toEqual(bestSoFar([0.2, 0.6]))
    expect(v.auc).toBeCloseTo(areaUnderCurve([0.2, 0.6]))
    expect(v.best).toBe(0.6)
    expect(v.lastImprovementAt).toBe(2_000)
  })

  it('a scored-but-undelivered settlement is not progress', () => {
    // The single delivery signal `finalizeBestDelivered` uses. Counting an undelivered high score
    // as progress is exactly how a plateau rule gets talked out of firing.
    const tracker = createProgressTracker({ now: () => 0 })
    tracker.record({ id: 'a', at: 1, objective: 0.9, delivered: false })
    expect(tracker.view().best).toBe(0)
    const lenient = createProgressTracker({ now: () => 0, requireDelivered: false })
    lenient.record({ id: 'a', at: 1, objective: 0.9, delivered: false })
    expect(lenient.view().best).toBe(0.9)
  })

  it('plateau fires only on a full flat window; noProgressFor bounds settles and time', () => {
    const flat = plateau({ window: 3, minDelta: 0 })
    expect(flat(viewOf({ settles: 2, curve: [0.5, 0.5] })).stop).toBe(false) // warm-up
    expect(flat(viewOf({ settles: 4, curve: [0.5, 0.5, 0.5, 0.5], best: 0.5 })).stop).toBe(true)
    expect(flat(viewOf({ settles: 4, curve: [0.5, 0.5, 0.5, 0.9], best: 0.9 })).stop).toBe(false)

    const bySettles = noProgressFor({ settles: 3 })
    expect(bySettles(viewOf({ settles: 5, settlesSinceImprovement: 2 })).stop).toBe(false)
    expect(bySettles(viewOf({ settles: 5, settlesSinceImprovement: 3 })).stop).toBe(true)

    const byTime = noProgressFor({ ms: 5_000 })
    expect(byTime(viewOf({ settles: 1, lastSettleAt: 6_000 })).stop).toBe(false)
    expect(byTime(viewOf({ settles: 1, lastSettleAt: 4_000 })).stop).toBe(true)
    // A tree with ARMED WAITS is not stalled — it is waiting on the world. Killing it there would
    // defeat the wait-state mechanic, so the time bound is suppressed.
    expect(byTime(viewOf({ settles: 1, lastSettleAt: 4_000, waiting: 1 })).stop).toBe(false)

    // Every stop carries a reason — an unexplained early stop is indistinguishable from a bug.
    const d = flat(viewOf({ settles: 4, curve: [0.5, 0.5, 0.5, 0.5], best: 0.5 }))
    expect(d.stop && d.reason).toContain('plateau')
  })

  it('allWorkersStalled needs every live worker stalled, and never fires on a waiting tree', () => {
    const stalled = (id: string, isStalled: boolean) =>
      ({
        id,
        status: 'running' as const,
        live: true,
        steerable: false,
        startedAt: 0,
        lastActivityAt: 0,
        idleMs: isStalled ? 300_000 : 10,
        stalled: isStalled,
        stallAfterMs: 180_000,
        turns: 1,
        tokens: { input: 0, output: 0 },
        usd: 0,
        pendingMessages: 0,
        recentActivity: [],
      }) as const

    const rule = allWorkersStalled({ minWorkers: 2 })
    expect(rule(viewOf({ workers: [stalled('a', true)] })).stop).toBe(false) // below minWorkers
    expect(rule(viewOf({ workers: [stalled('a', true), stalled('b', false)] })).stop).toBe(false)
    expect(rule(viewOf({ workers: [stalled('a', true), stalled('b', true)] })).stop).toBe(true)
    expect(
      rule(viewOf({ workers: [stalled('a', true), stalled('b', true)], waiting: 1 })).stop,
    ).toBe(false)
  })

  it('anyOf stops on the first rule; allOf needs corroboration from every rule', () => {
    const always: StopRule = () => ({ stop: true, reason: 'always' })
    const never: StopRule = () => ({ stop: false })
    expect(anyOf(never, always)(viewOf()).stop).toBe(true)
    expect(allOf(never, always)(viewOf()).stop).toBe(false)
    const both = allOf(always, always)(viewOf())
    expect(both.stop && both.reason).toBe('always AND always')
  })

  it('refuses a rule with no threshold rather than inventing one', () => {
    // Thresholds are the caller's judgment. A default here would be this module deciding a
    // domain's noise floor for it.
    expect(() => noProgressFor({})).toThrow(/at least one of/)
    expect(() => plateau({ window: 0, minDelta: 0 })).toThrow(/positive integer/)
    expect(() => plateau({ window: 2, minDelta: -1 })).toThrow(/minDelta/)
  })
})

// ── THE PROOF: plateau stops before the ceiling; genuine progress runs past the same point ─────

describe('a plateaued tree stops before its token ceiling — and a progressing one does not', () => {
  const rule = plateau({ window: 3, minDelta: 0.01 })
  // 12 units. FLAT: the first result is the best result and nothing beats it.
  const flatScores = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]
  // CONTROL: identical length, identical pool, identical rule — every unit genuinely improves.
  const risingScores = [0.1, 0.2, 0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.8, 0.9, 0.95]

  it('the plateaued arm stops on the rule with its pool mostly untouched', async () => {
    const flat = await dispatchUnderRule(flatScores, rule)

    // It stopped because the RULE said so — not because anything was refused admission.
    expect(flat.report.stopReason).toBe('stopped')
    expect(flat.report.rejected).toEqual([])
    // And it stopped EARLY: only a fraction of the queue was ever admitted.
    expect(flat.report.admitted).toBeLessThan(flat.queue)
    // The ceiling was never approached — this is the claim. The pool could have afforded the whole
    // queue twice over and most of it is still free.
    const spent = flat.report.admitted * WORKER_TOKENS
    expect(flat.tokensLeft).toBeGreaterThan(spent)
    // The objective really was flat, by the same math the report grades it with.
    expect(flat.view.best).toBe(0.5)
    expect(plateauLength(flat.view.curve, 0.01)).toBeGreaterThanOrEqual(3)
  })

  it('the CONTROL — genuine progress under the same rule — runs past where the flat arm stopped', async () => {
    const flat = await dispatchUnderRule(flatScores, rule)
    const rising = await dispatchUnderRule(risingScores, rule)

    // Same rule, same pool, same queue length. The only difference is whether the work improved.
    expect(rising.report.admitted).toBeGreaterThan(flat.report.admitted)
    // Improving work is never stopped by a plateau rule: the whole queue drains.
    expect(rising.report.admitted).toBe(rising.queue)
    expect(rising.report.stopReason).toBe('drained')
    expect(rising.view.best).toBe(0.95)
    // The rising arm therefore also spent MORE — the rule bought the flat arm real budget back.
    expect(rising.tokensLeft).toBeLessThan(flat.tokensLeft)
  })

  it('a hard ceiling still wins: the rule cannot admit work the pool refuses', async () => {
    // Same rising (never-plateauing) scores, but a pool that can only afford three units. The rule
    // says "keep going" on every evaluation; admission fails closed anyway.
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const root = 'ceiling-run'
    await journal.beginTree(root, new Date(0).toISOString())
    const pool = createBudgetPool({ maxIterations: 100, maxTokens: WORKER_TOKENS * 3 }, () => 0)
    const scope = createScope<unknown>({
      parentId: root,
      root,
      pool,
      journal,
      blobs,
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      now: () => 0,
    })
    const tracker = createProgressTracker({ now: () => 0 })
    const report = await rollingDispatch(scope, {
      width: 2,
      nextUnit: queueOf(
        risingScores.map((s, i) => ({ agent: scoredLeaf(`u${i}`, s), task: i, label: `u${i}` })),
        perUnit,
      ),
      onSettled: (s) => {
        tracker.record(sampleFromSettled(s, 0))
      },
      shouldStop: () => tracker.evaluate(rule).stop,
    })
    expect(report.stopReason).toBe('not-admitted')
    expect(report.rejected[0]).toContain('budget-exhausted')
    expect(report.admitted).toBe(3)
  })
})

// ── The driver-level wiring: the guard block beside poolStarved / deadlinePassed ───────────────

describe('driverAgent stopRule — evaluated after the hard ceilings, never instead of them', () => {
  /** A driver whose brain spawns a worker every single turn, forever. Without a stop rule it runs
   *  to `maxTurns`; with one it stops the moment the objective flattens. */
  async function runDriver(opts: {
    readonly score: (n: number) => number
    readonly stopRule?: StopRule
    readonly maxTurns: number
  }) {
    const blobs = new InMemoryResultBlobStore()
    const journal = new InMemorySpawnJournal()
    let spawned = 0
    const makeWorkerAgent = () => {
      const leaf = scoredLeaf(`w${spawned}`, opts.score(spawned))
      spawned += 1
      return leaf
    }
    // Every turn: spawn one, await one. The brain never stops on its own.
    const chat = scriptedBrain([
      {
        toolCalls: [
          {
            name: 'spawn_agent',
            arguments: { profile: { metadata: { kind: 'worker' } }, task: 'go' },
          },
          { name: 'await_event', arguments: {} },
        ],
      },
    ])
    const stops: string[] = []
    const root = driverAgent({
      name: 'root',
      brain: chat,
      blobs,
      makeWorkerAgent,
      perWorker: perUnit,
      systemPrompt: 'drive',
      maxTurns: opts.maxTurns,
      ...(opts.stopRule ? { stopRule: opts.stopRule } : {}),
      onProgressStop: (reason) => stops.push(reason),
    })
    const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
      // A pool big enough for every turn, so an early stop can only be the rule.
      budget: { maxIterations: 500, maxTokens: WORKER_TOKENS * 200 },
      runId: 'driver-stop',
      journal,
      blobs,
      executors: createExecutorRegistry(),
      now: () => 0,
    })
    return { result, spawned, stops }
  }

  it('a flat objective stops the driver early; the same driver without the rule keeps spawning', async () => {
    const flatScore = () => 0.4
    const withRule = await runDriver({
      score: flatScore,
      stopRule: plateau({ window: 3, minDelta: 0.01 }),
      maxTurns: 20,
    })
    const withoutRule = await runDriver({ score: flatScore, maxTurns: 20 })

    // The rule ended the run, and said why.
    expect(withRule.stops).toHaveLength(1)
    expect(withRule.stops[0]).toContain('plateau')
    // The control — identical everything except the rule — burned the full turn cap.
    expect(withRule.spawned).toBeLessThan(withoutRule.spawned)
    expect(withoutRule.spawned).toBe(20)
    // Both still produced the same deliverable: stopping early cost no result here, which is the
    // point of stopping on a plateau rather than on exhaustion.
    expect(withRule.result.kind).toBe('winner')
    expect(withoutRule.result.kind).toBe('winner')
  })

  it('an improving objective under the SAME rule is not stopped', async () => {
    const rising = await runDriver({
      score: (n) => Math.min(0.95, 0.1 + n * 0.05),
      stopRule: plateau({ window: 3, minDelta: 0.01 }),
      maxTurns: 12,
    })
    expect(rising.stops).toEqual([])
    expect(rising.spawned).toBe(12)
  })

  it('the rule cannot keep a run alive past a hard ceiling', async () => {
    // A rule that NEVER stops, against a pool that starves after a handful of workers. The
    // ceilings are evaluated first and independently, so `poolStarved` still ends the run.
    const never: StopRule = () => ({ stop: false })
    const blobs = new InMemoryResultBlobStore()
    let spawned = 0
    const root = driverAgent({
      name: 'root',
      brain: scriptedBrain([
        {
          toolCalls: [
            {
              name: 'spawn_agent',
              arguments: { profile: { metadata: { kind: 'worker' } }, task: 'go' },
            },
            { name: 'await_event', arguments: {} },
          ],
        },
      ]),
      blobs,
      makeWorkerAgent: () => {
        spawned += 1
        return scoredLeaf(`w${spawned}`, 0.5)
      },
      perWorker: perUnit,
      systemPrompt: 'drive',
      maxTurns: 50,
      stopRule: never,
    })
    const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
      budget: { maxIterations: 500, maxTokens: WORKER_TOKENS * 4 },
      runId: 'ceiling-driver',
      journal: new InMemorySpawnJournal(),
      blobs,
      executors: createExecutorRegistry(),
      now: () => 0,
    })
    expect(spawned).toBeLessThanOrEqual(4)
    expect(result.kind).toBe('winner')
  })

  it('a run with no stopRule allocates no tracker and behaves exactly as before', async () => {
    // The opt-in guarantee: the guard block is the only thing that changed, and it short-circuits
    // when no rule is configured.
    const before = await runDriver({ score: () => 0.4, maxTurns: 5 })
    expect(before.stops).toEqual([])
    expect(before.spawned).toBe(5)
  })
})

// ── The live worker feed rides on the view ────────────────────────────────────────────────────

describe('ProgressView reads the live worker feed off the scope', () => {
  it('includes a WorkerProgress per non-terminal node and the tree shape', async () => {
    const journal = new InMemorySpawnJournal()
    const blobs = new InMemoryResultBlobStore()
    const root = 'live-view'
    await journal.beginTree(root, new Date(0).toISOString())
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 10_000 }, () => 0)
    const scope: Scope<unknown> = createScope<unknown>({
      parentId: root,
      root,
      pool,
      journal,
      blobs,
      executors: createExecutorRegistry(),
      seams: {},
      depth: 0,
      signal: new AbortController().signal,
      now: () => 0,
    })
    // One never-settling worker plus one armed wait: the view must report them as different
    // things — one is in flight and burning, the other is waiting and free.
    const hanging: Executor<unknown> = {
      runtime: 'router',
      execute: (_t, signal) =>
        new Promise<ExecutorResult<unknown>>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
        }),
      teardown: () => Promise.resolve({ destroyed: true }),
      resultArtifact: () => {
        throw new Error('never')
      },
    }
    const leaf = {
      name: 'hang',
      act: async () => ({}),
      executorSpec: {
        profile: { name: 'hang' } as AgentProfile,
        harness: null,
        executor: hanging,
      },
    } as Agent<unknown, unknown> & { executorSpec: AgentSpec }
    scope.spawn(leaf, 't', { budget: perUnit, label: 'hang' })
    scope.wait({ kind: 'timer', untilMs: 60_000 }, { label: 'later' })

    const tracker = createProgressTracker({ now: () => 1_000 })
    const view = tracker.view(scope, { stallAfterMs: 100 })
    expect(view.workers.map((w) => w.id.endsWith(':s0'))).toEqual([true])
    expect(view.workers[0]?.stalled).toBe(true)
    expect(view.inFlight).toBe(1)
    expect(view.waiting).toBe(1)
  })
})
