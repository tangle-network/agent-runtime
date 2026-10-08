import { describe, expect, it } from 'vitest'
import { priceTokens, routerTokenPrice } from '../../src/pricing/router-prices'
import { ROUTER_PRICE_SOURCE, ROUTER_TOKEN_PRICES } from '../../src/pricing/router-prices.generated'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { priceUnreceiptedWork } from '../../src/runtime/supervise/cost-estimate'
import type { Spend, UsageEvent } from '../../src/runtime/supervise/types'
import { usdEstimatedOf } from '../../src/runtime/util'

// The model terraform-dc-tokens-20261008f ran on a subscription: its record showed 101,423,456
// input and 456,586 output tokens at "$0 (unknown-floor)" because no table priced it.
const MODEL = 'gpt-6.1-sol'
const RATE = ROUTER_TOKEN_PRICES[MODEL]!

function spend(over: Partial<Spend> = {}): Spend {
  return { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0, ...over }
}

/** An uncapped pool — the shape 286 of 292 fleet runs use, since they set no `maxUsd`. */
function uncappedPool() {
  return createBudgetPool({ maxIterations: 100, maxTokens: 10_000_000 }, 0)
}

describe('pricing work that carried no provider receipt', () => {
  it('prices from the Router catalog and marks the dollars as not measured', () => {
    const event = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    const expected = 10_000 * RATE.input + 2_000 * RATE.output
    expect(event).toEqual({
      kind: 'cost',
      usd: expected,
      usdKnown: false,
      usdEstimated: expected,
      provenance: 'catalog-estimate',
    })
    expect(expected).toBeGreaterThan(0)
  })

  it("prices cached prompt tokens at the Router's cached rate", () => {
    // terraform-dc-tokens-20261008f: 3,428,192 fresh and 97,995,264 cached input, 456,586 output.
    // At $2 in, $0.10 cached and $10 out per million that is $6.86 + $9.80 + $4.57.
    const priced = priceUnreceiptedWork({
      inputTokens: 101_423_456,
      cacheReadTokens: 97_995_264,
      outputTokens: 456_586,
      model: MODEL,
    })
    expect(priced.usdEstimated).toBeCloseTo(21.2218, 3)
    // Without the split, every prompt token bills at the full input rate.
    expect(
      priceUnreceiptedWork({ inputTokens: 101_423_456, outputTokens: 456_586, model: MODEL })
        .usdEstimated,
    ).toBeCloseTo(207.4129, 3)
  })

  it('reads a model id as harnesses report it, and names the Router commit it priced from', () => {
    for (const id of ['openai/gpt-6.1-sol', 'GPT-6.1-SOL', 'pi/tangle-router/gpt-6.1-sol@fp_a']) {
      expect(routerTokenPrice(id)).toBe(RATE)
    }
    expect(ROUTER_PRICE_SOURCE.path).toBe('pricing/researched-provider-prices.json')
    expect(ROUTER_PRICE_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/)
    expect(
      priceTokens({ model: MODEL, inputTokens: 10, outputTokens: 1, cacheReadTokens: 11 }),
    ).toBe(11 * RATE.cachedInput! + RATE.output)
    expect(priceTokens({ model: MODEL, inputTokens: -1, outputTokens: 1 })).toBeUndefined()
  })

  it('reports unknown dollars, not a free turn, for a model the catalog does not price', () => {
    const event = priceUnreceiptedWork({
      inputTokens: 10_000,
      outputTokens: 2_000,
      model: 'in-house/no-such-model-family',
    })
    expect(event).toEqual({ kind: 'cost', usd: 0, usdKnown: false, provenance: 'uncaptured' })
    expect(event.usdEstimated).toBeUndefined()
  })

  it('reports unknown dollars when no model was observed', () => {
    expect(priceUnreceiptedWork({ inputTokens: 10, outputTokens: 5, model: undefined })).toEqual({
      kind: 'cost',
      usd: 0,
      usdKnown: false,
      provenance: 'uncaptured',
    })
  })

  it('refuses to price a negative or non-finite token count', () => {
    for (const inputTokens of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(priceUnreceiptedWork({ inputTokens, outputTokens: 5, model: MODEL })).toEqual({
        kind: 'cost',
        usd: 0,
        usdKnown: false,
        provenance: 'uncaptured',
      })
    }
  })
})

describe('a dollar total built from estimates', () => {
  it('reaches the pool as a lower bound rather than a measurement', () => {
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    const events: UsageEvent[] = [
      { kind: 'tokens', input: 10_000, output: 2_000 },
      priced,
      { kind: 'iteration' },
    ]
    const folded = spendFromUsageEvents(events)
    expect(folded.usd).toBe(priced.usd)
    expect(folded.usdEstimated).toBe(priced.usd)
    expect(folded.usdKnown).toBe(false)

    const pool = uncappedPool()
    pool.observe(folded)
    // The dollars are recorded, and the pool refuses to call the total a measurement.
    expect(pool.readout().usdKnown).toBe(false)
  })

  it('keeps a receipt and an estimate separable through the fold', () => {
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    const folded = spendFromUsageEvents([
      { kind: 'cost', usd: 0.25, usdKnown: true, provenance: 'provider-receipt' },
      priced,
      { kind: 'iteration' },
    ])
    expect(folded.usd).toBe(0.25 + priced.usd)
    expect(folded.usdEstimated).toBe(priced.usd)
    // The provider-billed part stays recoverable, which is the point of carrying both.
    expect(folded.usd - folded.usdEstimated!).toBeCloseTo(0.25, 10)
    expect(folded.usdKnown).toBe(false)
  })

  it('leaves a pure-receipt fold with no estimated part at all', () => {
    const folded = spendFromUsageEvents([
      { kind: 'cost', usd: 0.25, usdKnown: true, provenance: 'provider-receipt' },
      { kind: 'iteration' },
    ])
    expect(folded.usd).toBe(0.25)
    expect(folded.usdEstimated).toBeUndefined()
    expect(folded.usdKnown).toBeUndefined()
  })

  it('sums the estimated part across merged spends, and reports none when nothing was priced', () => {
    expect(usdEstimatedOf({ usdEstimated: 0.5 }, { usdEstimated: 0.25 })).toEqual({
      usdEstimated: 0.75,
    })
    expect(usdEstimatedOf({ usdEstimated: 0.5 }, {})).toEqual({ usdEstimated: 0.5 })
    expect(usdEstimatedOf({}, {})).toEqual({})
  })
})

describe('the estimated part may never be read as billed spend', () => {
  it('refuses an estimated part on a spend that claims its dollars are known', () => {
    const pool = uncappedPool()
    expect(() => pool.observe(spend({ usd: 1, usdEstimated: 1 }))).toThrow(
      /usdEstimated requires observed spend.usdKnown false/,
    )
    expect(() => pool.observe(spend({ usd: 1, usdEstimated: 1, usdKnown: true }))).toThrow(
      /usdEstimated requires observed spend.usdKnown false/,
    )
  })

  it('refuses an estimated part larger than the total it is a part of', () => {
    expect(() =>
      uncappedPool().observe(spend({ usd: 1, usdEstimated: 1.5, usdKnown: false })),
    ).toThrow(/usdEstimated must not exceed observed spend.usd/)
  })

  it('refuses a negative or non-finite estimated part', () => {
    for (const usdEstimated of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        uncappedPool().observe(spend({ usd: 10, usdEstimated, usdKnown: false })),
      ).toThrow(/usdEstimated must be a non-negative finite number/)
    }
  })

  it('accepts a well-formed estimated part', () => {
    expect(() =>
      uncappedPool().observe(spend({ usd: 1, usdEstimated: 0.4, usdKnown: false })),
    ).not.toThrow()
  })

  it('diagnoses an unreceipted child as unknown dollars, not as overspending its ceiling', () => {
    // A catalog price can exceed a child's declared dollar ceiling. Reporting that as an
    // overspend would assert the child spent dollars a provider billed, which is the exact
    // confusion this field exists to prevent.
    const pool = createBudgetPool({ maxIterations: 10, maxTokens: 1_000_000, maxUsd: 100 }, 0)
    const reserved = pool.reserve({ maxIterations: 2, maxTokens: 1_000, maxUsd: 0.001 })
    expect(reserved.ok).toBe(true)
    if (!reserved.ok) return
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    expect(priced.usd).toBeGreaterThan(0.001)
    expect(() =>
      pool.reconcile(
        reserved.ticket,
        spend({ usd: priced.usd, usdEstimated: priced.usd, usdKnown: false }),
      ),
    ).toThrow(/reported unknown dollar cost under a dollar-capped budget/)
  })

  it('still refuses unknown dollars under a dollar-capped root', () => {
    // Pricing an estimate does not open a dollar cap. A capped root refuses work whose dollars
    // are not measured, exactly as before, because the estimate rides `usdKnown: false`.
    const capped = createBudgetPool({ maxIterations: 10, maxTokens: 1_000_000, maxUsd: 100 }, 0)
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    expect(() =>
      capped.observe(spend({ usd: priced.usd, usdEstimated: priced.usd, usdKnown: false })),
    ).toThrow(/cannot observe unknown dollar cost under a dollar-capped budget/)
  })
})
