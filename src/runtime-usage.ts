import type { RuntimeStreamEvent } from './types'

/** Observed subtotals, with missing measurements kept separate from measured zeroes. */
export interface RuntimeUsageTotals {
  /** Observed input tokens across normalized per-call events. */
  tokensIn: number
  /** Observed output tokens across normalized per-call events. */
  tokensOut: number
  /** Observed dollar subtotal; incomplete when `usdKnown` is false. */
  costUsd: number
  /** Number of observed model calls, including unpriced or incompletely metered calls. */
  llmCalls: number
  /** False when any observed call has incomplete token usage. */
  tokensKnown?: false
  /** False when any observed call lacks complete provider-billed cost. */
  usdKnown?: false
  /** Estimates for unpriced work; never included in `costUsd`. */
  estimatedCostUsd?: number
}

export function createRuntimeUsageTotals(): RuntimeUsageTotals {
  return { tokensIn: 0, tokensOut: 0, costUsd: 0, llmCalls: 0 }
}

export function isUsageAmount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

/** Fold normalized per-call events. Backend adapters own cumulative receipt reconciliation. */
export function addRuntimeUsage(
  totals: RuntimeUsageTotals,
  event: Extract<RuntimeStreamEvent, { type: 'llm_call' }>,
): void {
  totals.llmCalls += 1
  for (const key of ['tokensIn', 'tokensOut', 'costUsd'] as const) {
    const value = event[key]
    if (isUsageAmount(value)) totals[key] += value
    else if (key === 'costUsd') totals.usdKnown = false
    else totals.tokensKnown = false
  }
  if (event.tokensKnown === false) totals.tokensKnown = false
  if (event.usdKnown === false) totals.usdKnown = false
  if (
    (event.usdKnown === false || !isUsageAmount(event.costUsd)) &&
    isUsageAmount(event.estimatedCostUsd)
  ) {
    totals.estimatedCostUsd = (totals.estimatedCostUsd ?? 0) + event.estimatedCostUsd
  }
}
