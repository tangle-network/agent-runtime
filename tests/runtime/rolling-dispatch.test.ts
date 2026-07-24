/**
 * Refilling dispatch: `rollingDispatch` keeps `width` children in flight and admits the next
 * queued unit the instant one settles.
 *
 * The proof is not a timing observation (those are flaky) but an exact admission ledger: with
 * `width = 3`, units 0/1/2 are admitted before ANY settlement, and unit k (k >= 3) is admitted
 * after exactly k - 2 settlements. That sequence holds only if a freed slot is refilled
 * immediately; a batch fan-out admits everything at 0 settlements, and a serial spawn-await loop
 * admits unit k at k settlements. All three are distinguishable from this one array.
 */

import { describe, expect, it } from 'vitest'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../src/durable/spawn-journal'
import { ValidationError } from '../../src/errors'
import { fanout } from '../../src/runtime/personify/combinators'
import { runPersonified } from '../../src/runtime/personify/persona'
import { spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import {
  type DispatchReport,
  type DispatchUnit,
  effectiveConcurrency,
  freeSlots,
  rollingDispatch,
} from '../../src/runtime/supervise/dispatch'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
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

const usage: UsageEvent[] = [{ kind: 'iteration' }, { kind: 'tokens', input: 10, output: 10 }]

/**
 * A leaf whose settlement is deferred by `ticks` macrotask hops, so the settle ORDER is a property
 * of the script rather than of the machine. It records live-concurrency as observed from inside
 * the executor.
 */
function leaf(
  name: string,
  ticks: number,
  live: { now: number; peak: number },
): Agent<unknown, string> {
  const spent = spendFromUsageEvents(usage)
  const executor: Executor<string> = {
    runtime: 'router',
    execute(): AsyncIterable<UsageEvent> {
      return (async function* () {
        live.now += 1
        if (live.now > live.peak) live.peak = live.now
        for (const ev of usage) yield ev
        for (let i = 0; i < ticks; i += 1) await new Promise<void>((r) => setTimeout(r, 1))
        live.now -= 1
      })()
    },
    teardown: async () => ({ destroyed: true }),
    resultArtifact: (): ExecutorResult<string> => ({
      outRef: `mock:${name}`,
      out: name,
      verdict: { score: 1, valid: true },
      spent,
    }),
  }
  const spec: AgentSpec = {
    profile: { name } as AgentSpec['profile'],
    harness: null,
    executor: executor as Executor<unknown>,
  }
  return { name, act: async () => name, executorSpec: spec } as Agent<unknown, string> & {
    executorSpec: AgentSpec
  }
}

/** Run one root `act` under a real supervisor with in-memory stores, returning the act's value. */
async function underScope<T>(
  budget: Budget,
  act: (scope: Scope<string>) => Promise<T>,
): Promise<T> {
  let captured: T | undefined
  const root: Agent<unknown, string> = {
    name: 'root',
    async act(_task, scope) {
      captured = await act(scope)
      return 'root-done'
    },
  }
  const res = await createSupervisor<unknown, string>().run(root, 'task', {
    budget,
    runId: 'dispatch-test',
    journal: new InMemorySpawnJournal(),
    blobs: new InMemoryResultBlobStore(),
    executors: createExecutorRegistry(),
    now: () => 0,
  })
  expect(res.kind).toBe('winner')
  return captured as T
}

describe('rollingDispatch', () => {
  it('refills a freed slot immediately instead of draining the round', async () => {
    const width = 3
    const total = 9
    const live = { now: 0, peak: 0 }
    // Uneven settle times, so a batch drain and a rolling refill would produce different orders.
    const ticks = [6, 1, 4, 2, 5, 1, 3, 2, 1]
    let issued = 0
    let settledSoFar = 0
    // For each admission, how many children had already settled when it was admitted.
    const admittedAfter: number[] = []

    const report = await underScope<DispatchReport<string>>(
      { maxIterations: 100, maxTokens: 100_000 },
      (scope) =>
        rollingDispatch(scope, {
          width,
          nextUnit: (): DispatchUnit<string> | undefined => {
            if (issued >= total) return undefined
            const i = issued
            issued += 1
            admittedAfter.push(settledSoFar)
            return {
              agent: leaf(`u${i}`, ticks[i] ?? 1, live),
              task: `t${i}`,
              opts: { budget: { maxIterations: 1, maxTokens: 100 }, label: `u${i}` },
            }
          },
          onSettled: () => {
            settledSoFar += 1
          },
        }),
    )

    expect(report.admitted).toBe(total)
    expect(report.rejected).toEqual([])
    expect(report.stopReason).toBe('drained')
    expect(report.settled).toHaveLength(total)
    // THE claim: the first `width` units open on an empty pipeline, and every later unit opens
    // exactly one settlement after the one before it — a slot freed is a slot refilled.
    expect(admittedAfter).toEqual([0, 0, 0, 1, 2, 3, 4, 5, 6])
    // Simultaneity held at the cap and actually reached it (not accidentally serial).
    expect(report.peakLive).toBe(width)
    expect(live.peak).toBe(width)
    // Every unit really ran.
    expect(report.settled.map((s) => s.handle.label).sort()).toEqual(
      Array.from({ length: total }, (_, i) => `u${i}`).sort(),
    )
  })

  it('a batch fan-out over the same queue is the contrast case: no refill, no cap', async () => {
    // The behavior `rollingDispatch` replaces — spawn everything, then drain. Recorded here so the
    // ledger above is read against a real alternative rather than an asserted one.
    const live = { now: 0, peak: 0 }
    const settledLabels = await underScope<string[]>(
      { maxIterations: 100, maxTokens: 100_000 },
      async (scope) => {
        for (let i = 0; i < 9; i += 1) {
          scope.spawn(leaf(`u${i}`, 1, live), `t${i}`, {
            budget: { maxIterations: 1, maxTokens: 100 },
            label: `u${i}`,
          })
        }
        const out: string[] = []
        for (let s = await scope.next(); s !== null; s = await scope.next()) {
          out.push(s.handle.label)
        }
        return out
      },
    )
    expect(settledLabels).toHaveLength(9)
    expect(live.peak).toBe(9)
  })

  it('fails closed on the conserved pool and never opens past the refused admission', async () => {
    const live = { now: 0, peak: 0 }
    let issued = 0
    // Pool affords two live children of 250 tokens; width asks for three.
    const report = await underScope<DispatchReport<string>>(
      { maxIterations: 100, maxTokens: 700 },
      (scope) =>
        rollingDispatch(scope, {
          width: 3,
          nextUnit: (): DispatchUnit<string> | undefined => {
            const i = issued
            issued += 1
            return {
              agent: leaf(`u${i}`, 2, live),
              task: `t${i}`,
              opts: { budget: { maxIterations: 1, maxTokens: 250 }, label: `u${i}` },
            }
          },
        }),
    )
    expect(report.stopReason).toBe('not-admitted')
    expect(report.rejected).toEqual(['u2: budget-exhausted'])
    // The two admitted children still drained to completion — a refused admission is not a leak.
    expect(report.admitted).toBe(2)
    expect(report.settled).toHaveLength(2)
    expect(live.now).toBe(0)
  })

  it('stops admitting on `shouldStop` but still drains what is live', async () => {
    const live = { now: 0, peak: 0 }
    let issued = 0
    let settledCount = 0
    const report = await underScope<DispatchReport<string>>(
      { maxIterations: 100, maxTokens: 100_000 },
      (scope) =>
        rollingDispatch(scope, {
          width: 2,
          nextUnit: (): DispatchUnit<string> => {
            const i = issued
            issued += 1
            return {
              agent: leaf(`u${i}`, 1, live),
              task: `t${i}`,
              opts: { budget: { maxIterations: 1, maxTokens: 100 }, label: `u${i}` },
            }
          },
          onSettled: () => {
            settledCount += 1
          },
          // Stop admitting once three have settled — an infinite queue must still terminate.
          shouldStop: () => settledCount >= 3,
        }),
    )
    expect(report.stopReason).toBe('stopped')
    // Nothing was orphaned: everything admitted also settled.
    expect(report.settled).toHaveLength(report.admitted)
    expect(report.admitted).toBeGreaterThanOrEqual(3)
    expect(live.now).toBe(0)
  })

  it('rejects a non-positive or non-integer width before touching the scope', async () => {
    // A scope that fails loudly if touched — the guard must fire before any spawn/next.
    const untouchable = new Proxy({} as Scope<string>, {
      get(_t, prop) {
        throw new Error(`rollingDispatch touched the scope (.${String(prop)}) despite a bad width`)
      },
    })
    for (const width of [0, -1, 2.5, Number.NaN]) {
      await expect(
        rollingDispatch(untouchable, { width, nextUnit: () => undefined }),
      ).rejects.toBeInstanceOf(ValidationError)
    }
  })
})

describe('free-slot visibility', () => {
  it('reports remaining capacity under a cap and `null` when uncapped', () => {
    expect(freeSlots(0, 4)).toBe(4)
    expect(freeSlots(3, 4)).toBe(1)
    expect(freeSlots(4, 4)).toBe(0)
    // Over-cap (a cap lowered mid-run) never reports negative capacity.
    expect(freeSlots(7, 4)).toBe(0)
    // No cap ⇒ no finite slot count; the conserved pool is the only fence.
    expect(freeSlots(3, undefined)).toBeNull()
    expect(freeSlots(3, 0)).toBeNull()
  })
})

describe('effectiveConcurrency', () => {
  it('collapses the worker-layer caps into one number', () => {
    // Supervisor fence unset + a fleet governor of 4 ⇒ the honest limit is 4, not "no cap".
    expect(effectiveConcurrency({ maxSandboxes: 4 })).toBe(4)
    // The smallest applicable cap wins.
    expect(effectiveConcurrency({ maxLiveWorkers: 6, maxSandboxes: 4 })).toBe(4)
    expect(effectiveConcurrency({ maxLiveWorkers: 2, maxSandboxes: 4 })).toBe(2)
    // Non-positive caps mean "unset", matching how `maxLiveWorkers <= 0` is read everywhere else.
    expect(effectiveConcurrency({ maxLiveWorkers: 0, maxSandboxes: 4 })).toBe(4)
    expect(effectiveConcurrency({})).toBeUndefined()
    expect(effectiveConcurrency({ maxLiveWorkers: 0 })).toBeUndefined()
  })
})

describe('fanout({ width })', () => {
  /** A persona whose every child spec is supplied per item, so the fanout is heterogeneous and
   *  each item's executor can record when it ran. */
  function persona(live: { now: number; peak: number }) {
    const rootSpec: AgentSpec = {
      profile: { name: 'root' } as AgentSpec['profile'],
      harness: null,
      executor: (leaf('root', 0, live) as unknown as { executorSpec: AgentSpec }).executorSpec
        .executor,
    }
    return {
      name: 'p',
      root: rootSpec,
      directive: 'd',
      context: { role: 'r' },
      executors: { registry: createExecutorRegistry() },
    }
  }

  const itemSpecFor = (live: { now: number; peak: number }, i: number): AgentSpec =>
    (leaf(`i${i}`, 1, live) as unknown as { executorSpec: AgentSpec }).executorSpec

  it('caps simultaneity while a batch fanout over the same items does not', async () => {
    const items = Array.from({ length: 8 }, (_, i) => i)

    const rolling = { now: 0, peak: 0 }
    const withWidth = await runPersonified<string, string>({
      persona: persona(rolling),
      shape: fanout<string, number, string>(items, {
        itemTask: (item) => `t${item}`,
        itemSpec: (item) => itemSpecFor(rolling, item),
        label: (item) => `i${item}`,
        width: 3,
      }),
      task: 'go',
      budget: { maxIterations: 100, maxTokens: 100_000 },
      // Explicit per-child budget so the conserved pool can admit ALL items — otherwise the
      // default fanout divisor, not `width`, would be the thing capping concurrency.
      shapeBudget: { perChild: { maxIterations: 1, maxTokens: 1_000 } },
      runId: 'fanout-width',
    })

    const batch = { now: 0, peak: 0 }
    const withoutWidth = await runPersonified<string, string>({
      persona: persona(batch),
      shape: fanout<string, number, string>(items, {
        itemTask: (item) => `t${item}`,
        itemSpec: (item) => itemSpecFor(batch, item),
        label: (item) => `i${item}`,
      }),
      task: 'go',
      budget: { maxIterations: 100, maxTokens: 100_000 },
      shapeBudget: { perChild: { maxIterations: 1, maxTokens: 1_000 } },
      runId: 'fanout-batch',
    })

    // Same items, same selection, same conserved pool — only simultaneity differs.
    expect(withWidth.kind).toBe(withoutWidth.kind)
    expect(rolling.peak).toBe(3)
    expect(batch.peak).toBe(items.length)
    // All eight items still ran under the cap; `width` bounds concurrency, not coverage.
    expect(withWidth.tree.nodes.filter((n) => n.status === 'done')).toHaveLength(items.length)
  })
})
