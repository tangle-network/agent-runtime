import { ValidationError } from '../../errors'
import type { LoopTokenUsage } from '../types'
import { addTokenUsage, cloneTokenUsage, zeroTokenUsage } from '../util'
import { addResourceSpend } from './resources'
import { assertValidSpend } from './spend-validation'
import type { Spend, TokenUsageProvenance, UsageEvent } from './types'

/** Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 *  channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 *  pool does not read wall-clock). */
export function spendFromUsageEvents(events: UsageEvent[]): Spend {
  const totals = newUsageTotals()
  for (const ev of events) meterUsageEvent(totals, ev)
  return spendFromUsageTotals(totals)
}

/** Running accounting totals folded from `UsageEvent`s. */
interface UsageTotals {
  resources?: Spend['resources']
  tokens: LoopTokenUsage
  tokensKnown: boolean
  /** Which evidence the counted tokens came from. `undefined` until the first `tokens` event. */
  tokensProvenance?: TokenUsageProvenance
  usd: number
  usdEstimated: number
  usdKnown: boolean
  iterations: number
}

/** Fresh accounting totals, optionally restored from verified committed spend. */
export function newUsageTotals(priorSpent?: Spend): UsageTotals {
  if (priorSpent !== undefined) assertValidSpend(priorSpent, 'prior committed usage')
  return {
    ...addResourceSpend(priorSpent?.resources),
    tokens: priorSpent === undefined ? zeroTokenUsage() : cloneTokenUsage(priorSpent.tokens),
    tokensKnown: priorSpent?.tokensKnown !== false,
    ...(priorSpent?.tokensProvenance === undefined
      ? {}
      : { tokensProvenance: priorSpent.tokensProvenance }),
    usd: priorSpent?.usd ?? 0,
    usdEstimated: priorSpent?.usdEstimated ?? 0,
    usdKnown: priorSpent?.usdKnown !== false,
    iterations: priorSpent?.iterations ?? 0,
  }
}

/**
 * Fold ONE usage event into running totals — the single place that decides which event kinds
 * meter. `progress` carries observed output rather than accounting, so it meters nothing; only
 * `iteration` advances the iteration count.
 */
export function meterUsageEvent(totals: UsageTotals, ev: UsageEvent): void {
  if (ev.kind === 'resource') {
    totals.resources = addResourceSpend(
      totals.resources,
      Object.fromEntries([[ev.name, { unit: ev.unit, amount: ev.amount, known: ev.known }]]),
    ).resources
    return
  }
  if (ev.kind === 'tokens') {
    if (ev.mode === 'cumulative') {
      if (ev.input < totals.tokens.input || ev.output < totals.tokens.output) {
        throw new ValidationError('cumulative executor tokens must not decrease')
      }
      const snapshot = zeroTokenUsage()
      addTokenUsage(snapshot, {
        ...ev,
        ...(ev.freshInput === undefined && totals.tokens.freshInput !== undefined
          ? { freshInput: totals.tokens.freshInput }
          : {}),
        ...(ev.cacheRead === undefined && totals.tokens.cacheRead !== undefined
          ? { cacheRead: totals.tokens.cacheRead }
          : {}),
        ...(ev.cacheWrite === undefined && totals.tokens.cacheWrite !== undefined
          ? { cacheWrite: totals.tokens.cacheWrite }
          : {}),
        ...(totals.tokens.tokensKnown === false ? { tokensKnown: false } : {}),
      })
      totals.tokens = snapshot
    } else {
      addTokenUsage(totals.tokens, ev)
    }
    if (ev.tokensKnown === false) totals.tokensKnown = false
    // An event that names no provenance came from the executor's own live stream, which is what
    // every path reported before a harness store was readable.
    const source = ev.provenance ?? 'stream-receipt'
    totals.tokensProvenance =
      totals.tokensProvenance === undefined || totals.tokensProvenance === source ? source : 'mixed'
    return
  }
  if (ev.kind === 'cost') {
    totals.usd += ev.usd
    if (ev.usdKnown === false) {
      totals.usdEstimated += ev.usdEstimated ?? 0
      totals.usdKnown = false
    }
    return
  }
  if (ev.kind === 'iteration') totals.iterations += 1
}

/** Project folded totals onto the conserved-pool `Spend`. `ms` stays zero — the pool does not
 *  read wall-clock. */
export function spendFromUsageTotals(totals: UsageTotals): Spend {
  return {
    ...addResourceSpend(totals.resources),
    iterations: totals.iterations,
    tokens: totals.tokens,
    ...(totals.tokensKnown ? {} : { tokensKnown: false }),
    usd: totals.usd,
    ...(totals.usdKnown ? {} : { usdKnown: false }),
    ...(totals.usdEstimated > 0 ? { usdEstimated: totals.usdEstimated } : {}),
    // Only a provenance OTHER than the live stream is stated. Absence is the historical answer and
    // means the same thing, so every path that never reads a harness store is byte-unchanged.
    ...(totals.tokensProvenance === undefined || totals.tokensProvenance === 'stream-receipt'
      ? {}
      : { tokensProvenance: totals.tokensProvenance }),
    ms: 0,
  }
}

export async function foldUsage(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend> {
  if (Array.isArray(events)) return spendFromUsageEvents(events)
  const totals = newUsageTotals()
  for await (const ev of events) meterUsageEvent(totals, ev)
  return spendFromUsageTotals(totals)
}
