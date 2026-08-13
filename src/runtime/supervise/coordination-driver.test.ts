import { describe, expect, it } from 'vitest'
import { validateDriverPromptCache } from './coordination-driver'

describe('validateDriverPromptCache', () => {
  it('accepts fractional USD savings — the shape a real router reports', () => {
    // The exact evidence that refused an otherwise healthy driver: tangle-router returns
    // cache savings in dollars, which are fractional, and the count rule rejected them.
    expect(
      validateDriverPromptCache({ readTokens: 5888, writeTokens: 0, readSavingsUsd: 0.0034 }),
    ).toBeUndefined()
  })

  it('still refuses a fractional TOKEN count', () => {
    const error = validateDriverPromptCache({ readTokens: 12.5 })
    expect(error?.message).toContain('"readTokens"')
    expect(error?.message).toContain('non-negative safe integer')
  })

  it('refuses a negative USD amount and a non-finite one', () => {
    expect(validateDriverPromptCache({ readSavingsUsd: -0.01 })?.message).toContain(
      'non-negative finite number of dollars',
    )
    expect(validateDriverPromptCache({ writeCostUsd: Number.NaN })?.message).toContain(
      'non-negative finite number of dollars',
    )
    expect(validateDriverPromptCache({ writeCostUsd: Number.POSITIVE_INFINITY })).toBeDefined()
  })

  it('accepts a whole-dollar USD amount and -0, and keeps an absurd one out', () => {
    expect(validateDriverPromptCache({ readSavingsUsd: 5 })).toBeUndefined()
    expect(validateDriverPromptCache({ readSavingsUsd: -0 })).toBeUndefined()
    // The old all-integer rule rejected 1e308 as a side effect; the ceiling keeps that.
    expect(validateDriverPromptCache({ readSavingsUsd: 1e308 })?.message).toContain('dollars')
  })

  it('accepts the full router-reported shape including missTokens', () => {
    expect(
      validateDriverPromptCache({
        readTokens: 5888,
        writeTokens: 0,
        missTokens: 111,
        readSavingsUsd: 0.0034,
        status: 'hit',
      }),
    ).toBeUndefined()
  })

  it('refuses a negative token count and ignores string fields', () => {
    expect(validateDriverPromptCache({ readTokens: -1 })?.message).toContain('safe integer')
    expect(validateDriverPromptCache({ tier: 'ephemeral-1h' })).toBeUndefined()
  })

  it('treats absent evidence as acceptable rather than inventing zeroes', () => {
    expect(validateDriverPromptCache(undefined)).toBeUndefined()
    expect(validateDriverPromptCache({})).toBeUndefined()
  })

  it('classifies known schema members by what they are, not by their name', () => {
    // readSavingsUsd is the schema's only dollar member; the token members stay counts even
    // though nothing in their names says so.
    expect(validateDriverPromptCache({ missTokens: 12.5 })?.message).toContain('safe integer')
    expect(validateDriverPromptCache({ readSavingsUsd: 0.5 })).toBeUndefined()
  })

  it('falls back to the usd name-suffix convention for unknown pass-through fields', () => {
    expect(validateDriverPromptCache({ savingsUSD: 1.25 })).toBeUndefined()
    // `usdTokens` is a count despite carrying the substring — the suffix is what decides.
    expect(validateDriverPromptCache({ usdTokens: 1.25 })?.message).toContain('safe integer')
  })
})
