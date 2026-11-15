import type { Budget } from '../../runtime'
import type { ReservationShortfall } from '../../runtime/supervise/budget'
import { assertValidBudget } from '../../runtime/supervise/spend-validation'

export // Parse a per-spawn `budget` override and merge it over the per-worker default (per field).
// Fails loud on a non-object or a non-finite numeric field — a malformed budget must never
// silently fall back to the default and run a sub-task on a ceiling nobody chose.
const mergeBudget = (base: Budget, raw: unknown): Budget => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('coordination tools: "budget" must be an object')
  const o = raw as Record<string, unknown>
  const field = (name: keyof Budget): number | undefined => {
    const v = o[name]
    if (v === undefined) return undefined
    if (typeof v !== 'number' || !Number.isFinite(v))
      throw new Error(`coordination tools: "budget.${name}" must be a finite number`)
    return v
  }
  const maxIterations = field('maxIterations')
  const maxTokens = field('maxTokens')
  const maxUsd = field('maxUsd')
  const deadlineMs = field('deadlineMs')
  const rawResources = o.resources
  if (
    rawResources !== undefined &&
    (!rawResources || typeof rawResources !== 'object' || Array.isArray(rawResources))
  ) {
    throw new Error('coordination tools: "budget.resources" must be a resource map')
  }
  const resources =
    rawResources === undefined ? base.resources : { ...base.resources, ...rawResources }
  const merged: Budget = {
    ...(resources === undefined
      ? {}
      : { resources: resources as NonNullable<Budget['resources']> }),
    maxIterations: maxIterations ?? base.maxIterations,
    maxTokens: maxTokens ?? base.maxTokens,
    ...((maxUsd ?? base.maxUsd) === undefined ? {} : { maxUsd: maxUsd ?? base.maxUsd }),
    ...((deadlineMs ?? base.deadlineMs) === undefined
      ? {}
      : { deadlineMs: deadlineMs ?? base.deadlineMs }),
  }
  assertValidBudget(merged, 'coordination tools: budget')
  return merged
}

/**
 * The default slice lowered to what the pool can admit: each short channel takes the amount the
 * pool reported free plus held by running workers, and a spawn of at most that waits for them as
 * any spawn does. A spawn that named no budget asked for the default as a ceiling, not a demand,
 * so a pool its siblings already drew from still runs it; `undefined` when a short channel has
 * nothing to give or is closed by unmeasured spend. A spawn that names its budget keeps the refusal.
 */
export function fitDefaultBudget(
  base: Budget,
  shortfalls: readonly ReservationShortfall[] | undefined,
): Budget | undefined {
  if (shortfalls === undefined || shortfalls.length === 0) return undefined
  if (shortfalls.some((s) => s.closedByUnknownSpend === true || s.free + (s.held ?? 0) <= 0)) {
    return undefined
  }
  const room = new Map(shortfalls.map((s) => [s.channel, s.free + (s.held ?? 0)]))
  const lowered = (channel: ReservationShortfall['channel'], value: number | undefined) =>
    value === undefined || !room.has(channel) ? value : Math.min(value, room.get(channel)!)
  const iterations = lowered('iterations', base.maxIterations)
  const fitted: Budget = {
    ...base,
    ...(base.maxTokens === undefined
      ? {}
      : { maxTokens: Math.floor(lowered('tokens', base.maxTokens)!) }),
    ...(iterations === undefined ? {} : { maxIterations: Math.floor(iterations) }),
    ...(base.maxUsd === undefined ? {} : { maxUsd: lowered('usd', base.maxUsd) }),
    ...(base.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(base.resources).map(([name, value]) => [
              name,
              { ...value, limit: Math.floor(lowered(`resource:${name}`, value.limit)!) },
            ]),
          ),
        }),
  }
  assertValidBudget(fitted, 'coordination tools: fitted default budget')
  return fitted
}
