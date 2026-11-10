import { ValidationError } from '../../errors'

import type { SuperviseOptions } from './supervise-options'
import type { Budget, Scope, Spend } from './types'

/**
 * The grant rule, in charged tokens (`chargedTokens`: input − cacheRead + output): after each
 * usage receipt, a node whose spend plus `unmetered` reaches its token grant gets no further model
 * call. Reservations its children hold are not spend. Returns the stop reason, or `undefined`.
 * Overspend is bounded by one receipt; a harness that reports usage only at its turn's end is
 * bounded by that turn (agent-learning-methods-20261109a:s4:s8 ran 138 calls to 328,290 of 6,200).
 */
export function tokenGrantReached(
  budget: Scope<unknown>['budget'],
  unmetered: number,
): string | undefined {
  if (budget.tokensCapped === false) return undefined
  const committed = budget.committedTokens ?? 0
  const grant = budget.tokensLeft + budget.reservedTokens + committed
  const spent = committed + unmetered
  return spent >= grant ? `tokens: ${spent} charged of a ${grant} grant` : undefined
}

/**
 * Which of a driver's budget channels are spent, with their numbers, or `undefined` while none is.
 * The bare 'supervisor budget exhausted' named no channel: on queens21-h22-capture-root-2-20261019c
 * workers capped at 42,000 tokens metered 7,324,356 to 13,190,478 in one turn, and nothing said so.
 */
export function exhaustedBudgetChannels(
  budget: Scope<unknown>['budget'],
  nowMs: number,
): string | undefined {
  const spent: string[] = []
  if (budget.tokensCapped !== false && budget.tokensLeft <= 0)
    spent.push(`tokens: ${-budget.tokensLeft} over the cap`)
  if (budget.usdCapped && budget.usdLeft <= 0)
    spent.push(`usd: ${(-budget.usdLeft).toFixed(4)} over the cap`)
  for (const [name, resource] of Object.entries(budget.resources ?? {})) {
    if (!resource.known) spent.push(`resource ${name}: unmetered`)
    else if (resource.remaining <= 0)
      spent.push(`resource ${name}: ${-resource.remaining} ${resource.unit} over the cap`)
  }
  if (budget.deadlineMs > 0 && nowMs >= budget.deadlineMs)
    spent.push(`deadline: passed ${Math.round((nowMs - budget.deadlineMs) / 1000)} s ago`)
  return spent.length === 0 ? undefined : spent.join('; ')
}

/** A per-child budget may not exceed the conserved pool it is reserved from. */
export function assertPerWorkerWithinPool(perWorker: Budget, pool: Budget): void {
  const over = (
    child: number | undefined,
    total: number | undefined,
    field: string,
  ): string | null =>
    child !== undefined && total !== undefined && child > total
      ? `supervise perWorker.${field} (${child}) exceeds budget.${field} (${total})`
      : null
  for (const [name, resource] of Object.entries(pool.resources ?? {})) {
    const child = perWorker.resources?.[name]
    if (!child)
      throw new ValidationError(
        `supervise perWorker resource ${name}: child must declare its limit`,
      )
    if (child.unit !== resource.unit)
      throw new ValidationError(`supervise perWorker resource ${name}: unit mismatch`)
    const problem = over(child.limit, resource.limit, `resources.${name}.limit`)
    if (problem) throw new ValidationError(problem)
  }
  for (const name of Object.keys(perWorker.resources ?? {})) {
    if (!Object.hasOwn(pool.resources ?? {}, name)) {
      throw new ValidationError(`supervise perWorker resource ${name}: root must declare its limit`)
    }
  }
  const problems = [
    over(perWorker.maxTokens, pool.maxTokens, 'maxTokens'),
    over(perWorker.maxIterations, pool.maxIterations, 'maxIterations'),
    perWorker.maxUsd !== undefined && pool.maxUsd !== undefined
      ? over(perWorker.maxUsd, pool.maxUsd, 'maxUsd')
      : null,
  ].filter((x): x is string => x !== null)
  if (problems.length > 0) {
    throw new ValidationError(
      `${problems.join('; ')} — a per-child ceiling cannot exceed the pool it draws from, and ` +
        'accepting it silently leaves the caller believing a knob is in effect when the ' +
        'reservation still clamps the child.',
    )
  }
}

/** A caller's per-child budget must fit the part of the pool children may reserve: the pool less
 *  the owner's kept share per channel (`reservationPolicy.ownerShare`, the floor scope admission
 *  keeps). Larger, and not even one child is ever admitted. Without a kept share, a token or
 *  iteration ceiling equal to the whole pool lets the first child take every unit, so the owner's
 *  next turn is refused as budget-exhausted while the child still holds the rest. */
export function assertPerWorkerAdmittable(
  perWorker: Budget,
  pool: Budget,
  ownerShare: number,
): void {
  const unreservable = (
    child: number | undefined,
    total: number | undefined,
    kept: number,
    field: string,
  ): string | null => {
    if (child === undefined || total === undefined) return null
    if (ownerShare > 0) {
      const reservable = total - kept
      return child > reservable
        ? `supervise perWorker.${field} (${child}) exceeds the reservable budget.${field} ` +
            `(${reservable}: ${total} less the owner's kept ${kept} at reservationPolicy.ownerShare ${ownerShare})`
        : null
    }
    return child >= total
      ? `supervise perWorker.${field} (${child}) equals the whole budget.${field} (${total}), ` +
          'so the first child takes every unit and the owner has none left for its next turn'
      : null
  }
  const unadmittable = [
    unreservable(
      perWorker.maxTokens,
      pool.maxTokens,
      Math.ceil((pool.maxTokens ?? 0) * ownerShare),
      'maxTokens',
    ),
    unreservable(
      perWorker.maxIterations,
      pool.maxIterations,
      Math.ceil((pool.maxIterations ?? 0) * ownerShare),
      'maxIterations',
    ),
    perWorker.maxUsd !== undefined && pool.maxUsd !== undefined && ownerShare > 0
      ? unreservable(perWorker.maxUsd, pool.maxUsd, pool.maxUsd * ownerShare, 'maxUsd')
      : null,
  ].filter((x): x is string => x !== null)
  if (unadmittable.length > 0) {
    throw new ValidationError(
      `${unadmittable.join('; ')} — lower perWorker on that channel so a child fits beside the ` +
        "owner's own turns; otherwise children are refused or starve at spawn hours into the run.",
    )
  }
}

/** The slice a child gets when its manager names none: the part of the manager's budget its
 *  children may reserve, divided by the run's worker slots (four with none), so the slots, not the
 *  budget, set how many run at once. A quarter share capped managers with 8-15 slots at 2-4
 *  children (zro-w4a16-hopper-20261104b held 4 of 8; canary-soak-20261104a queued s5-s7 163-176 s). */
export function defaultPerWorker(
  budget: Budget,
  ownerShare: number,
  workerSlots: SuperviseOptions['workerSlots'],
): Budget {
  const slots = typeof workerSlots === 'number' ? workerSlots : workerSlots?.max
  const share = (1 - ownerShare) / (slots !== undefined && slots > 0 ? slots : 4)
  return {
    ...(budget.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(budget.resources).map(([name, value]) => [
              name,
              { unit: value.unit, limit: Math.floor(value.limit * share) },
            ]),
          ),
        }),
    ...(budget.maxIterations === undefined
      ? {}
      : { maxIterations: Math.max(0, Math.floor(budget.maxIterations * share)) }),
    ...(budget.maxTokens === undefined
      ? {}
      : { maxTokens: Math.max(0, Math.floor(budget.maxTokens * share)) }),
    ...(budget.maxUsd !== undefined ? { maxUsd: budget.maxUsd * share } : {}),
  }
}

/** Historical unclassified input is already charged; replay cannot refund it with a class-only delta. */
export function unmeteredOwnerCache(total: Spend['tokens'], committed: Spend['tokens']) {
  const cache = {
    ...(total.freshInput === undefined
      ? {}
      : { freshInput: Math.max(0, total.freshInput - (committed.freshInput ?? 0)) }),
    ...(total.cacheRead === undefined
      ? {}
      : { cacheRead: Math.max(0, total.cacheRead - (committed.cacheRead ?? 0)) }),
    ...(total.cacheWrite === undefined
      ? {}
      : { cacheWrite: Math.max(0, total.cacheWrite - (committed.cacheWrite ?? 0)) }),
  }
  if (
    (cache.freshInput ?? 0) + (cache.cacheRead ?? 0) + (cache.cacheWrite ?? 0) >
    Math.max(0, total.input - committed.input)
  ) {
    return { cacheBreakdownKnown: false as const }
  }
  return {
    ...cache,
    ...(total.cacheBreakdownKnown === false ? { cacheBreakdownKnown: false as const } : {}),
  }
}
