import { assertResources } from './resources'
import type { Budget, Spend } from './types'

/** Reject malformed ceilings before they can mint capacity through negative reservations. */
export function assertValidBudget(budget: Budget, label = 'budget'): void {
  const safeInteger = (value: number, field: string) => {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative safe integer`)
    }
  }
  const finiteNonNegative = (value: number, field: string) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative finite number`)
    }
  }
  assertResources(budget.resources, 'limit', `${label}.resources`)
  if (budget.maxIterations !== undefined) safeInteger(budget.maxIterations, 'maxIterations')
  if (budget.maxTokens !== undefined) safeInteger(budget.maxTokens, 'maxTokens')
  if (budget.maxUsd !== undefined) finiteNonNegative(budget.maxUsd, 'maxUsd')
  if (budget.deadlineMs !== undefined) finiteNonNegative(budget.deadlineMs, 'deadlineMs')
}

export function assertValidSpend(spend: Spend, label: string): void {
  assertResources(spend.resources, 'amount', `${label}.resources`)
  if (!Number.isSafeInteger(spend.iterations) || spend.iterations < 0) {
    throw new Error(`${label}.iterations must be a non-negative safe integer`)
  }
  for (const [field, value] of [
    ['input', spend.tokens.input],
    ['output', spend.tokens.output],
    ['freshInput', spend.tokens.freshInput],
    ['cacheRead', spend.tokens.cacheRead],
    ['cacheWrite', spend.tokens.cacheWrite],
  ] as const) {
    if (value === undefined && field !== 'input' && field !== 'output') continue
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${label}.tokens.${field} must be a non-negative safe integer`)
    }
  }
  for (const [field, value] of [
    ['tokensKnown', spend.tokens.tokensKnown],
    ['cacheBreakdownKnown', spend.tokens.cacheBreakdownKnown],
  ] as const) {
    if (value !== undefined && value !== false) {
      throw new Error(`${label}.tokens.${field} must be false when present`)
    }
  }
  const { freshInput, cacheRead, cacheWrite } = spend.tokens
  const classified = (freshInput ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  if (classified > spend.tokens.input) {
    throw new Error(`${label}.tokens cache classes must not exceed input`)
  }
  if (
    freshInput !== undefined &&
    cacheRead !== undefined &&
    cacheWrite !== undefined &&
    spend.tokens.cacheBreakdownKnown !== false &&
    classified !== spend.tokens.input
  ) {
    throw new Error(`${label}.tokens cache classes must sum to input`)
  }
  for (const [field, value] of [
    ['usd', spend.usd],
    ['ms', spend.ms],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label}.${field} must be a non-negative finite number`)
    }
  }
  if (spend.usdEstimated !== undefined) {
    if (!Number.isFinite(spend.usdEstimated) || spend.usdEstimated < 0) {
      throw new Error(`${label}.usdEstimated must be a non-negative finite number`)
    }
    // The catalog-priced part is a part OF `usd`, not an addition to it. A larger value would let
    // `usd - usdEstimated` report negative provider-billed dollars.
    if (spend.usdEstimated > spend.usd) {
      throw new Error(`${label}.usdEstimated must not exceed ${label}.usd`)
    }
    // A catalog price is never a measurement. Admitting one under `usdKnown: true` would let an
    // estimate be read as billed spend.
    if (spend.usdKnown !== false) {
      throw new Error(`${label}.usdEstimated requires ${label}.usdKnown false`)
    }
  }
}
