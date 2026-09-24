/**
 * An upstream that cannot serve NOW: how Runtime recognizes one, and how long an agent waits for it.
 *
 * A model provider's exhausted quota, a rate limit, an overload, or the router's own refused
 * credential is not a fault in the agent: the same request succeeds when capacity returns. A
 * driver that meets one re-enters after a pause (`runDriverWithRetry`), and a leaf continues in
 * its environment after the same pause (`providerAsExecutor`). Both read the refusal and the pause
 * from here, so an outage costs a director and its workers the same number of turns.
 *
 * This module imports nothing, so the provider executor can read it without the error classes of
 * `../../errors`.
 */

/**
 * Machine codes that say the upstream cannot serve now rather than that the request is wrong.
 * Each is a code an upstream publishes, not prose: the router's
 * (`lib/model-substitution.ts`, `lib/upstream-error-triage.ts`) and the OpenAI- and Anthropic-shaped
 * error types a relayed body carries.
 */
export const UNAVAILABLE_CODES: ReadonlySet<string> = new Set([
  'provider_quota_exhausted', // router: the upstream account has no remaining quota (429)
  'provider_quota_exceeded', // router: the earlier spelling, on the 2026-09-20 fleet corpus
  'provider_rate_limit', // router: the upstream is rate limiting this model (429)
  'upstream_unavailable', // router: upstream outage or an unexplained upstream refusal (503)
  // Router: its OWN credential for the provider was refused, answered 503. An operator restores
  // it, and the agent can only wait. The caller's key refused is `invalid_api_key` at 401 and
  // stays terminal. Measured 2026-09-24 from 14:15Z: every flash request ended
  // `No provider served model "deepseek/deepseek-v4.1-flash" (provider_key_invalid)`.
  'provider_key_invalid',
  'rate_limit_exceeded', // OpenAI-shaped 429
  'rate_limit_error', // Anthropic-shaped 429
  'overloaded_error', // Anthropic-shaped 529
])

/** 429 Too Many Requests, 503 Service Unavailable, and 529, which Anthropic uses for overload. */
export const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([429, 503, 529])

/**
 * A harness that flattens the router's JSON body into its own failure text leaves the router's
 * code in that text: `opencode execution failed: No provider served model "..."
 * (provider_quota_exhausted)`. The code is matched as a whole token, and a status only in the
 * `status code <n>` framing a harness prints, so prose that merely mentions a quota does not match.
 */
export function unavailableSignalInText(text: string): string | undefined {
  for (const token of text.toLowerCase().matchAll(/[a-z_]+/gu)) {
    if (UNAVAILABLE_CODES.has(token[0])) return token[0]
  }
  const status = text.match(/\bstatus code (\d{3})\b/u)?.[1]
  return status !== undefined && UNAVAILABLE_STATUSES.has(Number(status))
    ? `http-${status}`
    : undefined
}

/**
 * The code or status that marks a failed turn outcome as an upstream capacity refusal, or
 * `undefined`. The outcome's own `errorCode` decides first; the failure text is read only when no
 * code decided, because a harness CLI reports the router's refusal as text.
 */
export function unavailableSignalOfFailure(failure: {
  readonly error: string
  readonly errorCode?: string
}): string | undefined {
  const code = failure.errorCode?.toLowerCase()
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) return code
  return unavailableSignalInText(failure.error)
}

const DEFAULT_UNAVAILABLE_PAUSE_MS = 15_000
const DEFAULT_MAX_UNAVAILABLE_PAUSE_MS = 300_000

/** How long an agent waits after its upstream refused a turn for capacity: the codes and
 *  statuses `upstreamUnavailableSignal` reads. A pause is not a failure: a driver spends neither
 *  `maxAttempts` nor `maxConsecutiveFailures` on it. */
export interface UnavailablePausePolicy {
  /** The first pause, doubling per consecutive refusal. Default 15000ms. */
  readonly unavailablePauseMs?: number
  /** Ceiling on the doubling. Default 300000ms, so a long outage costs at most twelve turns an
   *  hour. */
  readonly maxUnavailablePauseMs?: number
}

/**
 * The pause after the `consecutive`-th refusal in a row (1-based): the first pause, doubled per
 * earlier refusal, up to the ceiling. The one rule for a driver that re-enters and a leaf that
 * continues in its environment, so an outage costs both the same number of turns.
 */
export function unavailablePauseMs(
  consecutive: number,
  policy: UnavailablePausePolicy = {},
): number {
  const first = Math.max(0, policy.unavailablePauseMs ?? DEFAULT_UNAVAILABLE_PAUSE_MS)
  const ceiling = Math.max(first, policy.maxUnavailablePauseMs ?? DEFAULT_MAX_UNAVAILABLE_PAUSE_MS)
  return Math.min(ceiling, first * 2 ** Math.max(0, consecutive - 1))
}
