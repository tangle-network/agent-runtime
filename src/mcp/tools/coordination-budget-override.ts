import type { Budget } from '../../runtime'
import { assertValidBudget } from '../../runtime/supervise/budget'

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
