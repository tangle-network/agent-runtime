/**
 * `rollingDispatch` keeps `width` children in flight over `Scope.spawn` and `Scope.next`.
 * An admission rejection stops further admission. `width` bounds this dispatcher; `workerSlots`
 * queues past the tree-wide bound; a sandbox fork wave is a different unit. Do not fold this
 * into `runBatch`: a Scope settlement is real only once it is journaled.
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
   * afford simply hits `not-admitted` sooner.
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
      // The ONE admission path: the scope's own atomic reservation. The scope already waits for
      // what live children will refund, so a rejection means nothing running could fund this
      // unit, and it is terminal for this dispatcher: admitting a DIFFERENT unit past it would
      // silently reorder the caller's queue.
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
