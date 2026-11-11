import type { AgentTurnFailure } from '@tangle-network/agent-interface/environment-provider'
import { causeChain } from './error-message'
import { turnFailureOf, turnFailurePolicy } from './executor-outcome'
/** Shared capacity recognition and pause policy for drivers and retained leaves. */

/** Legacy capacity codes for producers without the canonical failure contract. */
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
  // Sandbox: no host can place a box now (the SDK's `sandboxFailureKind` reads them as capacity).
  'capacity_exhausted',
  'host_pressure',
  'provisioning_paused',
])

/** Rate limits and overload: a wait clears them, so they never end a run as a repeated failure. */
export const RATE_LIMIT_SIGNALS: ReadonlySet<string> = new Set([
  'provider_rate_limit', 'rate_limit_exceeded', 'rate_limit_error', 'overloaded_error', 'http-429', 'http-529',
])

/** 429 Too Many Requests, 503 Service Unavailable, and 529, which Anthropic uses for overload. */
export const UNAVAILABLE_STATUSES: ReadonlySet<number> = new Set([429, 503, 529])

/** Legacy text fallback reads whole code tokens and explicitly framed HTTP statuses. */
export function unavailableSignalInText(text: string): string | undefined {
  // Z.ai's GLM plan states its 429 only as prose when opencode drops the code.
  if (text.includes('速率限制')) return 'provider_rate_limit'
  for (const token of text.toLowerCase().matchAll(/[a-z_]+/gu)) {
    if (UNAVAILABLE_CODES.has(token[0])) return token[0]
  }
  const status = printedStatus(text)
  return status !== undefined && UNAVAILABLE_STATUSES.has(status) ? `http-${status}` : undefined
}

/** The HTTP status a harness printed in its `status code <n>` framing, if any. */
export const printedStatus = (text: string): number | undefined => {
  const status = text.match(/\bstatus code (\d{3})\b/u)?.[1]
  return status === undefined ? undefined : Number(status)
}

/** Held room for an otherwise placeable shape is temporary capacity; oversized shapes stay refused. */
const HELD_ROOM_REFUSAL = /\bits room is held placeable\b/u

/**
 * The code or status that marks a failed turn outcome as an upstream capacity refusal, or
 * `undefined`. The outcome's own `errorCode` decides first, with Sandbox's held-room text beside its
 * code; other text is read only when no code or numeric status decided, because a harness CLI can
 * report the router's refusal as text.
 */
export function unavailableSignalOfFailure(failure: {
  readonly error: string
  readonly errorCode?: string
  readonly statusCode?: number
  readonly failure?: AgentTurnFailure
}): string | undefined {
  const typed = turnFailureOf(failure)
  if (typed)
    return turnFailurePolicy(typed).classification === 'unavailable' ? typed.code : undefined
  const code = failure.errorCode?.toLowerCase()
  if (code !== undefined && UNAVAILABLE_CODES.has(code)) return code
  if (code === 'no_host_fits_shape' && HELD_ROOM_REFUSAL.test(failure.error))
    return 'host-room-held'
  if (failure.statusCode !== undefined) {
    return UNAVAILABLE_STATUSES.has(failure.statusCode) ? `http-${failure.statusCode}` : undefined
  }
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
  return cappedDoublingMs(
    consecutive,
    policy.unavailablePauseMs ?? DEFAULT_UNAVAILABLE_PAUSE_MS,
    policy.maxUnavailablePauseMs ?? DEFAULT_MAX_UNAVAILABLE_PAUSE_MS,
  )
}

/** `first` doubled per earlier consecutive wait (`consecutive` is 1-based), up to `ceiling`. */
export function cappedDoublingMs(consecutive: number, first: number, ceiling: number): number {
  const start = Math.max(0, first)
  return Math.min(Math.max(start, ceiling), start * 2 ** Math.max(0, consecutive - 1))
}

/** The longest hold a refusal's own reset time may ask for: a 5-hour plan window plus a margin. */
const MAX_RESET_HOLD_MS = 6 * 60 * 60_000

/** How often a refusal whose reset is beyond {@link MAX_RESET_HOLD_MS} is probed again. */
const FAR_RESET_PROBE_MS = 60 * 60_000

/** Read canonical reset/retry-after before legacy structured reset fields; never parse text. */
export function reportedResetAt(error: unknown, nowMs = Date.now()): number | undefined {
  const typed = turnFailureOf(error)
  if (typed)
    return typed.resetAt !== undefined
      ? Date.parse(typed.resetAt)
      : typed.retryAfterMs !== undefined
        ? nowMs + typed.retryAfterMs
        : undefined
  for (const cause of causeChain(error)) {
    let value: unknown
    try {
      value = Reflect.get(cause, 'resetAt')
    } catch {
      continue
    }
    const at =
      typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN
    if (Number.isFinite(at)) return at
  }
  return undefined
}

/**
 * Until when a reported reset holds a pause, or `undefined` for none (absent or past: the caller
 * keeps its doubling pause). A reset more than MAX_RESET_HOLD_MS ahead is held FAR_RESET_PROBE_MS
 * at a time; on magnetar-rust-20261019c a far reset drew about 12 attempts an hour.
 */
export function unavailableResumeAt(
  resetAt: number | undefined,
  nowMs: number,
): number | undefined {
  if (resetAt === undefined || resetAt <= nowMs) return undefined
  return resetAt - nowMs > MAX_RESET_HOLD_MS ? nowMs + FAR_RESET_PROBE_MS : resetAt
}

/**
 * Spread a wait over `[ms / 2, ms]`. Every driver a Platform restart cut off fails within the same
 * seconds; without jitter their doubling schedules stay aligned and they all re-enter together
 * when the service returns. `random` returns a value in `[0, 1)`; 0 keeps the full wait.
 */
export function jitteredMs(ms: number, random: () => number): number {
  return ms - Math.floor((ms / 2) * Math.min(1, Math.max(0, random())))
}
