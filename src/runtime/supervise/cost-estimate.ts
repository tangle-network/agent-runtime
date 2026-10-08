/**
 * Pricing for work that arrived without a provider receipt.
 *
 * A turn whose provider reported no billed dollars used to reach the dollar channel as a
 * known `$0`, so a run that certainly spent money reported a dollar total of zero. A catalog
 * price is not a receipt, so what this module produces is always marked, never promoted.
 * The catalog is the Router's (`src/pricing/router-prices.ts`).
 */

import { priceTokens } from '../../pricing/router-prices'
import type { UsageEvent } from './types'

export interface UnreceiptedWork {
  /** The provider's whole prompt total for this work, cache reads and writes included. */
  inputTokens: number
  outputTokens: number
  /** Prompt tokens served from cache, part of `inputTokens`; they bill at the cached rate. */
  cacheReadTokens?: number
  /** Prompt tokens written to cache, part of `inputTokens`. */
  cacheWriteTokens?: number
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
 * A model the Router does not price yields `usd: 0` with `usdKnown: false` and no `usdEstimated`.
 * The turn then reads as unknown dollars, which is true, rather than as a free turn.
 */
export function priceUnreceiptedWork(work: UnreceiptedWork): Extract<UsageEvent, { kind: 'cost' }> {
  const unknown = { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' } as const
  if (work.model === undefined) return unknown
  const usd = priceTokens({
    model: work.model,
    inputTokens: work.inputTokens,
    outputTokens: work.outputTokens,
    ...(work.cacheReadTokens === undefined ? {} : { cacheReadTokens: work.cacheReadTokens }),
    ...(work.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: work.cacheWriteTokens }),
  })
  if (usd === undefined || !Number.isFinite(usd) || usd <= 0) return unknown
  return { kind: 'cost', usd, usdKnown: false, usdEstimated: usd, provenance: 'catalog-estimate' }
}
