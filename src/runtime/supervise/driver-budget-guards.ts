import type { Budget, Scope } from './types'

/** Stop when no work is in flight and a capped channel cannot fund another worker.
 * Owner inference also debits the pool, so a turn limit alone cannot enforce its ceilings. */
export function poolStarved(
  scope: Scope<unknown>,
  perWorker: Budget,
  preserveOwnerTurns = false,
): boolean {
  const b = scope.budget
  if (scope.view.inFlight > 0) return false
  const tokenStarved =
    b.tokensCapped !== false &&
    (b.tokensLeft <= 0 ||
      (!preserveOwnerTurns &&
        perWorker.maxTokens !== undefined &&
        b.tokensLeft < perWorker.maxTokens))
  const iterationStarved = b.iterationsCapped !== false && b.iterationsLeft <= 0
  const usdStarved =
    b.usdCapped &&
    (b.usdLeft <= 0 ||
      (!preserveOwnerTurns && perWorker.maxUsd !== undefined && b.usdLeft < perWorker.maxUsd))
  const resourceStarved = Object.entries(b.resources ?? {}).some(
    ([name, value]) =>
      !value.known ||
      value.remaining <= 0 ||
      (!preserveOwnerTurns && value.remaining < (perWorker.resources?.[name]?.limit ?? 0)),
  )
  return tokenStarved || iterationStarved || usdStarved || resourceStarved
}

/** The number of driver turns a manager whose spend Runtime cannot measure may take when no
 *  deadline or dollar cap bounds it. */
const UNMETERED_DRIVER_TURNS = 16

/**
 * Safety guards for a manager's own turns when no deadline bounds them.
 *
 * `poolStarved` lets a manager keep taking turns while its workers run, because those workers hold
 * the pool its turns would otherwise be refused from. With no turn cap and no deadline, a manager
 * waiting on a worker that never settles would take a metered turn per heartbeat wake forever.
 * Money bounds that: a manager that has overdrawn its pool by as much again as the whole pool stops.
 * A brain that reports no usage cannot be bounded by money, so without a deadline or dollar cap it
 * keeps the historical 16-turn bound. A caller's explicit `maxTurns` or a deadline replaces both.
 */
export function ownTurnsUnbounded(
  scope: Scope<unknown>,
  poolTokens: number,
  turns: number,
  maxTurns: number | undefined,
): boolean {
  const b = scope.budget
  if (maxTurns !== undefined || b.deadlineMs > 0) return false
  if (b.tokensCapped !== false && poolTokens > 0 && b.tokensLeft < -poolTokens) return true
  return !b.tokensKnown && !b.usdCapped && turns > UNMETERED_DRIVER_TURNS
}

/** The absolute wall-clock deadline (when the root set one) has passed. */
export function deadlinePassed(scope: Scope<unknown>, now: () => number): boolean {
  const b = scope.budget
  return b.deadlineMs > 0 && now() >= b.deadlineMs
}
