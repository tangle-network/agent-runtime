/**
 * Pricing for work that arrived without a provider receipt.
 *
 * A turn whose provider reported no billed dollars used to reach the dollar channel as a
 * known `$0`, so a run that certainly spent money reported a dollar total of zero. A catalog
 * price is not a receipt, so what this module produces is always marked, never promoted.
 */

import { estimateCost, isModelPriced } from '@tangle-network/agent-eval'
import type { UsageEvent } from './types'

export interface UnreceiptedWork {
  /**
   * The provider's whole prompt total for this work, cache reads included.
   *
   * The catalog carries ONE input rate per model and no cache-read rate, so a prefix the
   * provider served from cache is priced at the full input rate. That overstates a
   * cache-heavy turn. It is the correct direction: a discount the catalog cannot support
   * would be invented, and an invented discount understates spend.
   */
  inputTokens: number
  outputTokens: number
  /** The model the provider reported for this work. An unpriced or absent id yields no dollars. */
  model: string | undefined
}

/**
 * Price one unit of work that no provider receipt covered.
 *
 * The event always carries `usdKnown: false`: a catalog price approximates what a provider
 * WOULD bill, never measures what it did. The priced amount is repeated in `usdEstimated` so
 * a consumer can subtract it from `usd` and recover the dollars a provider actually billed.
 *
 * A model with no catalog entry yields `usd: 0` with `usdKnown: false` and no `usdEstimated`.
 * The turn then reads as unknown dollars, which is true, rather than as a free turn.
 */
export function priceUnreceiptedWork(work: UnreceiptedWork): Extract<UsageEvent, { kind: 'cost' }> {
  const unknown = { kind: 'cost', usd: 0, usdKnown: false } as const
  const { inputTokens, outputTokens, model } = work
  if (model === undefined || !isModelPriced(model)) return unknown
  if (!Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return unknown
  if (inputTokens < 0 || outputTokens < 0) return unknown
  const usd = estimateCost(inputTokens, outputTokens, model)
  if (!Number.isFinite(usd) || usd <= 0) return unknown
  return { kind: 'cost', usd, usdKnown: false, usdEstimated: usd }
}
