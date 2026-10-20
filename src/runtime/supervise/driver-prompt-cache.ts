import { ValidationError } from '../../errors'

/** The USD-denominated members of {@link PromptCacheUsage} — the schema, not a guess. Every
 *  other known member (`readTokens`, `writeTokens`, `missTokens`) is a token COUNT. */
const PROMPT_CACHE_USD_FIELDS: ReadonlySet<string> = new Set(['readSavingsUsd'])

/** Dollar amounts above this are provider nonsense, not evidence. The old all-integer rule
 *  rejected them as a side effect; keeping an explicit ceiling preserves that protection
 *  without pretending a dollar amount is an integer. */
const MAX_PROMPT_CACHE_USD = 1_000_000

/**
 * Validate provider-reported prompt-cache evidence.
 *
 * Prompt-cache carries two kinds of number and they obey different rules: token COUNTS are
 * integers, and USD amounts are fractional by nature. Applying the count rule to a dollar
 * field refuses every provider that reports cache savings in dollars — a healthy router
 * response carrying `readSavingsUsd: 0.0034` failed the driver outright before this split.
 *
 * Classification is schema-first: a field named in {@link PromptCacheUsage} is validated by
 * what that member IS. `promptCache` is an open record (the sandbox path forwards provider
 * fields verbatim), so an unknown field falls back to the `usd` name-suffix convention —
 * documented here as the contract a provider must follow to report dollars.
 *
 * Returns the refusal, or `undefined` when the evidence is acceptable.
 */
export function validateDriverPromptCache(
  promptCache: Readonly<Record<string, number | string>> | undefined,
): ValidationError | undefined {
  for (const [field, value] of Object.entries(promptCache ?? {})) {
    if (typeof value !== 'number') continue
    const isUsdField = PROMPT_CACHE_USD_FIELDS.has(field) || /usd$/i.test(field)
    if (isUsdField) {
      if (!Number.isFinite(value) || value < 0 || value > MAX_PROMPT_CACHE_USD) {
        return new ValidationError(
          `driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative finite number of dollars`,
        )
      }
      continue
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      return new ValidationError(
        `driverAgent: prompt-cache field ${JSON.stringify(field)} must be a non-negative safe integer`,
      )
    }
  }
  return undefined
}
