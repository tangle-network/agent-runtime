/** Unreceipted work stays `usdKnown: false`. A subscription seat stays uncaptured. */

import { priceTokens } from '../../pricing/router-prices'
import type { UsageEvent } from './types'

interface UnreceiptedWork {
  /** Whole prompt total, cache reads and writes included. */
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  /** Absent or unpriced model yields no dollars. */
  model: string | undefined
  /** A subscription seat has no per-call bill. */
  credentialSource?: string
}

export function priceUnreceiptedWork(work: UnreceiptedWork): Extract<UsageEvent, { kind: 'cost' }> {
  const unknown = { kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' } as const
  if (work.credentialSource === 'subscription' || work.model === undefined) return unknown
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
