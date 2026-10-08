/**
 * Model prices from the Router's catalog, the one source of model prices.
 *
 * `router-prices.generated.ts` is a copy of tangle-router `pricing/researched-provider-prices.json`
 * written by `scripts/sync-router-prices.mjs`; nothing here is maintained by hand. Runtime prices
 * every token a provider did not bill from it, so a run's API-equivalent cost and the Router's
 * charge for the same tokens use the same rates.
 */

import { ROUTER_PRICE_SOURCE, ROUTER_TOKEN_PRICES } from './router-prices.generated'

/** USD per token. A null cache rate means the Router lists none, so those tokens bill at `input`. */
export interface RouterTokenPrice {
  readonly provider: string
  readonly input: number
  readonly cachedInput: number | null
  readonly cacheWrite: number | null
  readonly output: number
}

export { ROUTER_PRICE_SOURCE }

/**
 * The Router's price for a model id as a harness or provider reports it: exact, then without a
 * `@snapshot` suffix, then its last path segment (`openai/gpt-6.1-sol` is `gpt-6.1-sol`), each
 * as written and lowercased. Undefined when the Router prices no such model.
 */
export function routerTokenPrice(model: string): RouterTokenPrice | undefined {
  const bare = (model.split('@')[0] ?? model).trim()
  const last = bare.slice(bare.lastIndexOf('/') + 1)
  for (const id of [model, bare, bare.toLowerCase(), last, last.toLowerCase()]) {
    const price = ROUTER_TOKEN_PRICES[id]
    if (price !== undefined) return price
  }
  return undefined
}

export interface TokenWork {
  readonly model: string
  /** The whole prompt, cache reads and writes included. */
  readonly inputTokens: number
  readonly outputTokens: number
  /** Prompt tokens served from the provider's cache, part of `inputTokens`. */
  readonly cacheReadTokens?: number
  /** Prompt tokens written to the provider's cache, part of `inputTokens`. */
  readonly cacheWriteTokens?: number
}

const count = (value: number | undefined): value is number =>
  value !== undefined && Number.isFinite(value) && value >= 0

/**
 * What the Router would charge for this work at the model's base rates, or undefined when it
 * prices no such model or a count is not a non-negative number. Cache reads and writes bill at
 * their own rates when the Router lists them. A per-request tier (some models charge more past a
 * prompt size) is not applied: a run total does not keep each request's prompt size.
 */
export function priceTokens(work: TokenWork): number | undefined {
  const price = routerTokenPrice(work.model)
  if (price === undefined) return undefined
  const cacheRead = work.cacheReadTokens ?? 0
  const cacheWrite = work.cacheWriteTokens ?? 0
  if (![work.inputTokens, work.outputTokens, cacheRead, cacheWrite].every(count)) return undefined
  const fresh = Math.max(0, work.inputTokens - cacheRead - cacheWrite)
  return (
    fresh * price.input +
    cacheRead * (price.cachedInput ?? price.input) +
    cacheWrite * (price.cacheWrite ?? price.input) +
    work.outputTokens * price.output
  )
}
