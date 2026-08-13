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
      'non-negative finite number',
    )
    expect(validateDriverPromptCache({ writeCostUsd: Number.NaN })?.message).toContain(
      'non-negative finite number',
    )
    expect(validateDriverPromptCache({ writeCostUsd: Number.POSITIVE_INFINITY })).toBeDefined()
  })

  it('refuses a negative token count and ignores string fields', () => {
    expect(validateDriverPromptCache({ readTokens: -1 })?.message).toContain('safe integer')
    expect(validateDriverPromptCache({ tier: 'ephemeral-1h' })).toBeUndefined()
  })

  it('treats absent evidence as acceptable rather than inventing zeroes', () => {
    expect(validateDriverPromptCache(undefined)).toBeUndefined()
    expect(validateDriverPromptCache({})).toBeUndefined()
  })

  it('matches USD fields case-insensitively at the end of the name only', () => {
    expect(validateDriverPromptCache({ savingsUSD: 1.25 })).toBeUndefined()
    // `usdTokens` is a count despite carrying the substring — the suffix is what decides.
    expect(validateDriverPromptCache({ usdTokens: 1.25 })?.message).toContain('safe integer')
  })
})
