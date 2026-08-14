import { estimateCost, MODEL_PRICING } from '@tangle-network/agent-eval'
import { describe, expect, it } from 'vitest'
import { createBudgetPool, spendFromUsageEvents } from '../../src/runtime/supervise/budget'
import { priceUnreceiptedWork } from '../../src/runtime/supervise/cost-estimate'
import type { Spend, UsageEvent } from '../../src/runtime/supervise/types'
import { usdEstimatedOf } from '../../src/runtime/util'

const MODEL = 'claude-sonnet-4-20250514'
const RATE = MODEL_PRICING[MODEL]!

function spend(over: Partial<Spend> = {}): Spend {
  return { iterations: 1, tokens: { input: 0, output: 0 }, usd: 0, ms: 0, ...over }
}

/** An uncapped pool — the shape 286 of 292 fleet runs use, since they set no `maxUsd`. */
function uncappedPool() {
  return createBudgetPool({ maxIterations: 100, maxTokens: 10_000_000 }, () => 0)
}

describe('pricing work that carried no provider receipt', () => {
  it('prices from the catalog and marks the dollars as not measured', () => {
    const event = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    const expected = 10 * RATE.input + 2 * RATE.output
    expect(event).toEqual({
      kind: 'cost',
      usd: expected,
      usdKnown: false,
      usdEstimated: expected,
    })
    expect(expected).toBeGreaterThan(0)
  })

  it('prices a cached prefix at the full input rate, because the catalog carries no cache rate', () => {
    // The catalog entry is `{ input, output }` per model. There is no cache-read rate to apply,
    // so a prefix the provider served from cache is charged at the full input rate. That
    // overstates a cache-heavy turn, which is the correct direction: a discount the catalog
    // cannot support would be invented, and an invented discount understates spend.
    expect(Object.keys(RATE).sort()).toEqual(['input', 'output'])
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    expect(priced.usd).toBe(estimateCost(10_000, 2_000, MODEL))
  })

  it('reports unknown dollars, not a free turn, for a model the catalog does not price', () => {
    const event = priceUnreceiptedWork({
      inputTokens: 10_000,
      outputTokens: 2_000,
      model: 'in-house/no-such-model-family',
    })
    expect(event).toEqual({ kind: 'cost', usd: 0, usdKnown: false })
    expect(event.usdEstimated).toBeUndefined()
  })

  it('reports unknown dollars when no model was observed', () => {
    expect(priceUnreceiptedWork({ inputTokens: 10, outputTokens: 5, model: undefined })).toEqual({
      kind: 'cost',
      usd: 0,
      usdKnown: false,
    })
  })

  it('refuses to price a negative or non-finite token count', () => {
    for (const inputTokens of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(priceUnreceiptedWork({ inputTokens, outputTokens: 5, model: MODEL })).toEqual({
        kind: 'cost',
        usd: 0,
        usdKnown: false,
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
      { kind: 'cost', usd: 0.25 },
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
    const folded = spendFromUsageEvents([{ kind: 'cost', usd: 0.25 }, { kind: 'iteration' }])
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

  it('still refuses unknown dollars under a dollar-capped root', () => {
    // Pricing an estimate does not open a dollar cap. A capped root refuses work whose dollars
    // are not measured, exactly as before, because the estimate rides `usdKnown: false`.
    const capped = createBudgetPool(
      { maxIterations: 10, maxTokens: 1_000_000, maxUsd: 100 },
      () => 0,
    )
    const priced = priceUnreceiptedWork({ inputTokens: 10_000, outputTokens: 2_000, model: MODEL })
    expect(() =>
      capped.observe(spend({ usd: priced.usd, usdEstimated: priced.usd, usdKnown: false })),
    ).toThrow(/cannot observe unknown dollar cost under a dollar-capped budget/)
  })
})
