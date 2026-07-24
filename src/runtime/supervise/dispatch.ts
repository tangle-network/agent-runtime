/**
 *
 * `rollingDispatch` — the REFILLING dispatch policy over a `Scope`. It keeps `width` children in
 * flight and admits the next queued unit of work the instant one settles, instead of waiting for
 * a whole round to drain (`fanout`) or for a driver to decide again (`spawn → await → spawn`).
 *
 * The gap it closes: `fanout` opens every item at once and then drains — one round, no refill —
 * and a driver brain's manual loop opens one worker per model turn. Between those two there was
 * nothing that holds N slots full, which is why a 5-worker run can peak at 2 live workers and sit
 * ~50% idle. This is a policy over the EXISTING `Scope.spawn` / `Scope.next` primitives: it adds
 * no second admission path, so the conserved budget pool stays the only fence on total work and
 * `width` is only a fence on simultaneous work.
 *
 * Fail-closed by construction: an admission rejection (`budget-exhausted` / `depth-exceeded`) is
 * recorded and STOPS further admission — the loop then drains what is already live and returns.
 * It never retries a rejected spawn against the same pool, and it never spawns past `width`.
 *
 * ── The concurrency-cap ledger (read this before adding a fourth cap) ──────────────────────────
 *
 * Three unrelated caps bound "how much runs at once" in this stack, at three different layers.
 * They are NOT aware of each other, and the smallest one silently wins:
 *
 *   1. `CoordinationToolsOptions.maxLiveWorkers` (`src/mcp/tools/coordination.ts`) — supervisor
 *      level. How many workers may be spawned-but-not-settled at once; `spawn_agent` fails closed
 *      with `error: 'max-live-workers'` past it. Unset by default ⇒ NO cap at this layer.
 *   2. `SandboxLineage`'s `maxConcurrency` / `DEFAULT_FORK_CONCURRENCY = 4`
 *      (`src/runtime/sandbox-lineage.ts`) — kernel level. How many BOXES one `runAgentRounds` fork wave
 *      provisions at once. It bounds a single leaf's fanout, not the supervisor's worker count.
 *   3. A host's own live-box governor (e.g. loops' `ComputeGovernor`, `maxSandboxes = 4`) — fleet
 *      level. How many sandboxes may exist across the whole host process.
 *
 * The honest effective limit on simultaneous WORKERS is the minimum of the caps that apply to the
 * worker layer — (1) and (3). (2) is a different unit (boxes per fork wave inside one leaf) and
 * must not be min'd into it, or a 4-way fork inside one worker reads as a 4-worker ceiling.
 * `effectiveConcurrency` computes that minimum in one place so a host derives ONE number and
 * passes it to BOTH `maxLiveWorkers` and this dispatcher's `width`, instead of leaving a fleet
 * governor of 4 and an unset worker fence as unrelated numbers.
 *
 * ── Why this is not a copy of the kernel's batch loop ──────────────────────────────────────────
 *
 * `runBatch` (`src/runtime/run-loop.ts`) runs the same hold-N-slots-full shape over the KERNEL's
 * substrate: bare promises in a `Set`, raced with `Promise.race`, bounded by `maxConcurrency`.
 * This one runs it over the SUPERVISOR's substrate — `Scope.spawn`'s atomic reservation against
 * the conserved pool, `Scope.next`'s journaled settlement cursor, and the blob store behind each
 * result. Neither can be expressed in the other's terms without dragging its whole substrate
 * along: the kernel loop has no budget to reserve and no cursor to order settlements by, and this
 * one cannot race raw promises because a settlement is only real once it is journaled. The shape
 * repeating across the two deliberate layers is resonance, not duplication — do not "unify" them
 * into a shared helper that would have to know about both.
 *
 * @experimental
 */

import { ValidationError } from '../../errors'
import type { Agent, Budget, NodeId, Scope, Settled, SpawnOpts } from './types'

/** One unit of queued work: the agent to run, its task, and the spawn options (budget + label).
 *  `nextUnit` mints these lazily so a queue can be generated, re-ordered, or grown while the
 *  dispatcher runs. */
export interface DispatchUnit<Out> {
  readonly agent: Agent<unknown, Out>
  readonly task: unknown
  readonly opts: SpawnOpts
}

/** Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end);
 *  `not-admitted` = the conserved pool or the depth ceiling refused a spawn; `stopped` = the
 *  caller's `shouldStop` returned true; `aborted` = the scope's signal fired. */
export type DispatchStopReason = 'drained' | 'not-admitted' | 'stopped' | 'aborted'

export interface RollingDispatchOptions<Out> {
  /**
   * How many children to hold in flight. Must be a positive integer. This is a SIMULTANEITY fence
   * only — the conserved pool still bounds total work, and a `width` larger than the pool can
   * afford simply hits `not-admitted` sooner. Derive it with `effectiveConcurrency` when the host
   * also runs a fleet-level box governor.
   */
  readonly width: number
  /**
   * Produce the next unit of work, or `undefined` when the queue is dry. Called only when a slot
   * is free, so a caller may compute the next unit from what has already settled (the point of a
   * refilling dispatcher: the queue is allowed to react). Never called after a stop.
   */
  nextUnit(): DispatchUnit<Out> | undefined | Promise<DispatchUnit<Out> | undefined>
  /**
   * Called once per settlement, in cursor order, BEFORE the freed slot is refilled — so an
   * `onSettled` that appends to the caller's queue is visible to the very next `nextUnit`.
   */
  onSettled?(settled: Settled<Out>): void | Promise<void>
  /**
   * Consulted before each admission. `true` stops admitting; the already-live children are still
   * drained to completion (no orphan, no lost settlement). Use it for a progress/plateau rule.
   */
  shouldStop?(): boolean
}

export interface DispatchReport<Out> {
  /** Every settlement, in the order `scope.next()` yielded them. */
  readonly settled: ReadonlyArray<Settled<Out>>
  /** How many children this dispatcher admitted. */
  readonly admitted: number
  /** Admission rejections, in order — `label: reason`. Non-empty ⇒ the pool or depth fenced. */
  readonly rejected: ReadonlyArray<string>
  readonly stopReason: DispatchStopReason
  /** The highest simultaneous live count actually reached — the number to compare against
   *  `width` when asking "did the slots really stay full?" */
  readonly peakLive: number
}

/**
 * Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every
 * admitted child has settled. Returns the settlements in cursor order plus the admission ledger.
 *
 * The loop is: fill free slots from `nextUnit` → `await scope.next()` → deliver the settlement →
 * refill → repeat. Because the refill happens immediately after each settlement rather than after
 * a whole round, a slow child never idles the other slots.
 */
export async function rollingDispatch<Out>(
  scope: Scope<Out>,
  opts: RollingDispatchOptions<Out>,
): Promise<DispatchReport<Out>> {
  if (!Number.isInteger(opts.width) || opts.width < 1) {
    throw new ValidationError(
      `rollingDispatch: width must be a positive integer, got ${String(opts.width)}`,
    )
  }

  const settled: Settled<Out>[] = []
  const rejected: string[] = []
  const live = new Set<NodeId>()
  let admitted = 0
  let peakLive = 0
  let queueDry = false
  let stopReason: DispatchStopReason = 'drained'

  // Fill every free slot from the queue. Returns false when nothing further may be admitted
  // (queue dry, caller stop, pool/depth rejection, or abort) — the caller then only drains.
  const fill = async (): Promise<void> => {
    while (live.size < opts.width) {
      if (queueDry) return
      if (scope.signal.aborted) {
        stopReason = 'aborted'
        queueDry = true
        return
      }
      if (opts.shouldStop?.() === true) {
        stopReason = 'stopped'
        queueDry = true
        return
      }
      const unit = await opts.nextUnit()
      if (unit === undefined) {
        queueDry = true
        return
      }
      // The ONE admission path: the scope's own atomic reservation. A rejection is terminal for
      // this dispatcher — the pool is conserved, so retrying the same spawn cannot succeed until
      // a live child refunds, and admitting a DIFFERENT unit past a rejection would silently
      // reorder the caller's queue.
      const res = scope.spawn(unit.agent, unit.task, unit.opts)
      if (!res.ok) {
        rejected.push(`${unit.opts.label}: ${res.reason}`)
        stopReason = 'not-admitted'
        queueDry = true
        return
      }
      live.add(res.handle.id)
      admitted += 1
      if (live.size > peakLive) peakLive = live.size
    }
  }

  await fill()
  while (live.size > 0) {
    const s = await scope.next()
    // `next()` is null only when the scope's live set is empty; this dispatcher may share the
    // scope with children it did not admit, so treat null as "nothing of ours left to await".
    if (s === null) break
    live.delete(s.handle.id)
    settled.push(s)
    await opts.onSettled?.(s)
    await fill()
  }

  return { settled, admitted, rejected, stopReason, peakLive }
}

/**
 * Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is
 * no cap (the conserved pool is then the only fence and "free slots" is not a finite number).
 * The one place the answer is computed, so the driver-facing tool payload and a dispatcher agree.
 */
export function freeSlots(liveCount: number, cap: number | undefined): number | null {
  if (cap === undefined || cap <= 0) return null
  return Math.max(0, cap - liveCount)
}

/** The caps a host can set on simultaneous work. See the ledger in this module's header for what
 *  each one actually bounds. */
export interface ConcurrencyCaps {
  /** Supervisor level: max spawned-but-unsettled workers. */
  readonly maxLiveWorkers?: number
  /** Fleet level: max live sandboxes/boxes across the host process (a `ComputeGovernor`-style
   *  cap). Applies to the worker layer, so it participates in the minimum. */
  readonly maxSandboxes?: number
}

/**
 * The ONE honest effective limit on simultaneous workers: the minimum of the caps that actually
 * bound the worker layer. Ignores unset/non-positive caps; returns `undefined` when no cap applies
 * (uncapped — the conserved pool remains the only fence).
 *
 * Deliberately does NOT fold in `SandboxLineage`'s fork concurrency: that bounds boxes inside ONE
 * leaf's fork wave, a different unit. Folding it in would report a 4-worker ceiling for what is
 * really a 4-box fanout inside a single worker.
 *
 * Use it once, at the top of a run, and pass the result to BOTH `maxLiveWorkers` and a
 * dispatcher's `width` — that is what turns three unrelated numbers into one.
 */
export function effectiveConcurrency(caps: ConcurrencyCaps): number | undefined {
  const applicable = [caps.maxLiveWorkers, caps.maxSandboxes].filter(
    (c): c is number => typeof c === 'number' && c > 0,
  )
  if (applicable.length === 0) return undefined
  return Math.min(...applicable)
}

/** Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where
 *  the queue is known up front and only the refill behavior is wanted. */
export function queueOf<Out>(
  units: ReadonlyArray<{ agent: Agent<unknown, Out>; task: unknown; label: string }>,
  budget: Budget,
): () => DispatchUnit<Out> | undefined {
  let i = 0
  return () => {
    const u = units[i]
    if (u === undefined) return undefined
    i += 1
    return { agent: u.agent, task: u.task, opts: { budget, label: u.label } }
  }
}
