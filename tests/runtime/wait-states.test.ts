/**
 * Wait-states: a tree node that waits on wall-clock time or an external predicate without an
 * executor, a sandbox, or a single token of conserved budget.
 *
 * The cross-process durability claim (SIGKILL a waiting tree, a new process keeps waiting to the
 * same instant) lives in `wait-resume.test.ts`; this file covers the mechanic in one process:
 * a timer fires, a poll fires when its predicate flips, a poll times out, and the admission
 * fences refuse a wait that could not be honoured.
 */

import { describe, expect, it } from 'vitest'
import {
  InMemoryResultBlobStore,
  InMemorySpawnJournal,
  materializeTreeView,
  pendingWaits,
  replaySpawnTree,
} from '../../src/durable/spawn-journal'
import { createExecutorRegistry } from '../../src/runtime/supervise/runtime'
import { createSupervisor } from '../../src/runtime/supervise/supervisor'
import type { Agent, Scope, Settled, SpawnEvent } from '../../src/runtime/supervise/types'
import {
  createWaitProbes,
  isWaitOutcome,
  pollFor,
  timerAt,
  type WaitOutcome,
  type WaitProbe,
  type WaitSpec,
} from '../../src/runtime/supervise/wait'

/** A run harness: build the stores, run a root that only ever waits, hand back the journal. */
async function runWaiting(
  act: (scope: Scope<unknown>) => Promise<unknown>,
  opts: {
    readonly probes?: Record<string, WaitProbe>
    readonly deadlineMs?: number
    readonly runId?: string
  } = {},
) {
  const journal = new InMemorySpawnJournal()
  const blobs = new InMemoryResultBlobStore()
  const runId = opts.runId ?? 'wait-run'
  const root: Agent<unknown, unknown> = { name: 'waiting-root', act: (_task, scope) => act(scope) }
  const result = await createSupervisor<unknown, unknown>().run(root, 'task', {
    budget: {
      maxIterations: 10,
      maxTokens: 10_000,
      ...(opts.deadlineMs !== undefined ? { deadlineMs: opts.deadlineMs } : {}),
    },
    runId,
    journal,
    blobs,
    executors: createExecutorRegistry(),
    ...(opts.probes ? { probes: createWaitProbes(opts.probes) } : {}),
  })
  const events = (await journal.loadTree(runId)) ?? []
  return { result, events, journal, blobs, runId }
}

const outcomeOf = (s: Settled<unknown> | null): WaitOutcome => {
  if (s === null || s.kind !== 'done' || !isWaitOutcome(s.out)) {
    throw new Error(`expected a settled wait outcome, got ${JSON.stringify(s)}`)
  }
  return s.out
}

describe('wait-states', () => {
  it('a timer node settles `fired` through the ordinary next() cursor and costs nothing', async () => {
    const { result, events } = await runWaiting(async (scope) => {
      const armed = scope.wait(timerAt(25, Date.now()), { label: 'nap' })
      expect(armed.ok).toBe(true)
      // While armed, the node is `waiting` — deliberately NOT counted as in flight, because it
      // holds no executor and no budget.
      expect(scope.view.waiting).toBe(1)
      expect(scope.view.inFlight).toBe(0)
      const out = outcomeOf(await scope.next())
      expect(out.kind).toBe('timer')
      expect(out.settled).toBe('fired')
      expect(out.resumed).toBe(false)
      return out.settled
    })

    expect(result.kind).toBe('winner')
    // ZERO conserved spend: no tokens, no dollars, no iterations. This is the whole point — a
    // week-long timer must cost the same as a 25ms one.
    if (result.kind === 'winner') {
      expect(result.spentTotal.tokens).toEqual({ input: 0, output: 0 })
      expect(result.spentTotal.usd).toBe(0)
      expect(result.spentTotal.iterations).toBe(0)
    }

    // The journal recorded the wait as a first-class pair: armed, then woken.
    const armedEv = events.find(
      (e): e is Extract<SpawnEvent, { kind: 'waiting' }> => e.kind === 'waiting',
    )
    const wokenEv = events.find(
      (e): e is Extract<SpawnEvent, { kind: 'woken' }> => e.kind === 'woken',
    )
    expect(armedEv?.label).toBe('nap')
    expect(armedEv?.spec.kind).toBe('timer')
    expect(wokenEv?.by).toBe('fired')
    // A woken wait is no longer pending — nothing for a resumed run to re-arm.
    expect(pendingWaits(events)).toEqual([])
  })

  it('a poll node fires the moment its predicate flips, and its outcome replays from the journal', async () => {
    let ready = false
    setTimeout(() => {
      ready = true
    }, 30)

    const { events, journal, blobs, runId } = await runWaiting(
      async (scope) => {
        const armed = scope.wait(
          pollFor('ci-green', { intervalMs: 5, timeoutMs: 5_000 }, Date.now()),
          { label: 'ci' },
        )
        expect(armed.ok).toBe(true)
        const out = outcomeOf(await scope.next())
        expect(out.settled).toBe('fired')
        // It re-checked several times before the predicate flipped — that is the poll, and it
        // cost nothing but the checks themselves.
        expect(out.polls).toBeGreaterThan(1)
        expect(out.probeErrors).toBe(0)
        return out.settled
      },
      { probes: { 'ci-green': () => ready } },
    )

    const wokenEv = events.find(
      (e): e is Extract<SpawnEvent, { kind: 'woken' }> => e.kind === 'woken',
    )
    expect(wokenEv?.by).toBe('fired')
    // Replay rehydrates the wait outcome from the blob store exactly like a worker's output.
    const replayed = await replaySpawnTree(journal, blobs, runId)
    expect(replayed).toHaveLength(1)
    const first = replayed[0]
    expect(first?.kind).toBe('done')
    if (first?.kind === 'done') expect(isWaitOutcome(first.out)).toBe(true)
    // And the materialized view shows it done, with a `wait` runtime and zero budget.
    const view = materializeTreeView(events)
    const waitNode = view.nodes.find((n) => n.label === 'ci')
    expect(waitNode?.status).toBe('done')
    expect(waitNode?.runtime).toBe('wait')
    expect(waitNode?.budget).toEqual({ maxIterations: 0, maxTokens: 0 })
    expect(view.waiting).toBe(0)
  })

  it('a bounded poll whose predicate never flips settles `timeout` — an answer, not a failure', async () => {
    const { events } = await runWaiting(
      async (scope) => {
        const armed = scope.wait(pollFor('never', { intervalMs: 5, timeoutMs: 40 }, Date.now()), {
          label: 'hopeless',
        })
        expect(armed.ok).toBe(true)
        const out = outcomeOf(await scope.next())
        expect(out.settled).toBe('timeout')
        expect(out.polls).toBeGreaterThan(1)
        return out.settled
      },
      { probes: { never: () => false } },
    )
    const wokenEv = events.find(
      (e): e is Extract<SpawnEvent, { kind: 'woken' }> => e.kind === 'woken',
    )
    // `by` names the outcome in the journal, so a reader learns WHY it woke without fetching the
    // blob it may never rehydrate.
    expect(wokenEv?.by).toBe('timeout')
  })

  it('a throwing probe counts the error and keeps polling — an unreachable endpoint is not an answer', async () => {
    let calls = 0
    await runWaiting(
      async (scope) => {
        scope.wait(pollFor('flaky', { intervalMs: 5, timeoutMs: 5_000 }, Date.now()), {
          label: 'flaky',
        })
        const out = outcomeOf(await scope.next())
        expect(out.settled).toBe('fired')
        expect(out.probeErrors).toBeGreaterThanOrEqual(2)
        return out.settled
      },
      {
        probes: {
          flaky: () => {
            calls += 1
            if (calls <= 2) throw new Error('connection refused')
            return true
          },
        },
      },
    )
  })

  it('fails closed: an unknown probe, an invalid spec, and a wait past the run deadline are all refused', async () => {
    await runWaiting(
      async (scope) => {
        // No such probe in this run's registry — refused BEFORE a node exists, so nothing waits
        // on a predicate that can never answer.
        const unknown = scope.wait(
          { kind: 'poll', probe: 'not-registered', intervalMs: 10, timeoutAtMs: Date.now() + 50 },
          { label: 'x' },
        )
        expect(unknown).toEqual({ ok: false, reason: 'unknown-probe' })

        const bad = scope.wait({ kind: 'poll', probe: 'known', intervalMs: 0 } as WaitSpec, {
          label: 'y',
        })
        expect(bad).toEqual({ ok: false, reason: 'invalid-spec' })

        // The deadline fence: this run's pool carries an absolute deadline, and a wait may
        // neither sleep past it nor extend it (that would let a wait override a budget guard).
        const past = scope.wait({ kind: 'timer', untilMs: Date.now() + 60_000 }, { label: 'long' })
        expect(past).toEqual({ ok: false, reason: 'deadline-exceeded' })

        // An UNBOUNDED poll is refused for the same reason: nothing proves it ends before the
        // ceiling. Bound it and it is admitted.
        const unbounded = scope.wait(
          { kind: 'poll', probe: 'known', intervalMs: 5 },
          {
            label: 'unbounded',
          },
        )
        expect(unbounded).toEqual({ ok: false, reason: 'deadline-exceeded' })

        expect(scope.view.nodes).toHaveLength(0)
        return 'refused'
      },
      { probes: { known: () => true }, deadlineMs: Date.now() + 1_000 },
    )
  })

  it('the join barrier cancels an armed wait, so a run never returns leaving a live timer behind', async () => {
    // The root arms a long wait and returns without awaiting it. The supervisor's join barrier
    // must cancel it — otherwise the process stays pinned to a deadline nobody is reading.
    const { result, events } = await runWaiting(async (scope) => {
      scope.wait(timerAt(60_000, Date.now()), { label: 'abandoned' })
      expect(scope.view.waiting).toBe(1)
      return 'left-early'
    })
    expect(result.kind).toBe('winner')
    const wokenEv = events.find(
      (e): e is Extract<SpawnEvent, { kind: 'woken' }> => e.kind === 'woken',
    )
    expect(wokenEv?.by).toBe('cancelled')
    // A cancelled wait carries no outcome blob and replays as a `down`, exactly like a cancelled
    // worker — the tree stays coherent.
    expect(wokenEv?.outRef).toBeUndefined()
    expect(materializeTreeView(events).nodes.find((n) => n.label === 'abandoned')?.status).toBe(
      'cancelled',
    )
  })

  it('waits and workers share one cursor: a wait never collides with a spawned child', async () => {
    const { events } = await runWaiting(async (scope) => {
      scope.wait(timerAt(5, Date.now()), { label: 'w0' })
      scope.wait(timerAt(10, Date.now()), { label: 'w1' })
      const seen: string[] = []
      for (let s = await scope.next(); s !== null; s = await scope.next()) {
        seen.push(s.handle.label)
      }
      expect(seen.sort()).toEqual(['w0', 'w1'])
      return 'both'
    })
    // Wait node ids live in their own `:w<n>` namespace and their settlements take distinct
    // cursor positions — the uniqueness the journal's guard enforces.
    const armed = events.filter((e) => e.kind === 'waiting')
    expect(armed.map((e) => e.id).sort()).toEqual(['wait-run:w0', 'wait-run:w1'])
    const cursors = events.filter((e) => e.kind === 'woken').map((e) => e.seq)
    expect(new Set(cursors).size).toBe(cursors.length)
  })
})
