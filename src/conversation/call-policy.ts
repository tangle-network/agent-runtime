/**
 * @stable
 *
 * Per-call resilience policy for participant backends: deadline, retry with
 * backoff, and a circuit breaker. Each policy is applied *around* a single
 * turn's backend invocation, not across the whole conversation — the
 * conversation-level credit cap and `maxTurns` bound the broader run.
 *
 * Deadlines abort the underlying backend stream via `AbortSignal` linkage so
 * the OpenAI/SDK clients tear down their HTTP request cleanly instead of
 * leaking sockets. Retries replay the same logical turn (same `turnId`) so
 * any caching gateway can dedupe. Circuit breakers are *per participant*: A's
 * failures don't open B's breaker.
 */

/** Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors. */
export type RetryableErrorPredicate = (err: unknown) => boolean

/** Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`. */
export type RetryBackoff = number | ((attempt: number) => number)

/** Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`. */
export interface CircuitBreakerConfig {
  failuresToOpen: number
  cooldownMs: number
}

export interface BackendCallPolicy {
  /** Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure. */
  perAttemptDeadlineMs?: number
  /** Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0. */
  maxRetries?: number
  /** Backoff between attempts. Default 250ms with jitter. */
  retryBackoffMs?: RetryBackoff
  /** Custom retry classifier. Defaults to {@link defaultIsRetryable}. */
  isRetryable?: RetryableErrorPredicate
  /** Circuit breaker that opens after N consecutive failures per participant. */
  circuitBreaker?: CircuitBreakerConfig
}

export class CircuitOpenError extends Error {
  constructor(participant: string, retryAfterMs: number) {
    super(
      `circuit open for participant '${participant}'; ${retryAfterMs}ms remaining before retry allowed`,
    )
    this.name = 'CircuitOpenError'
  }
}

export class DeadlineExceededError extends Error {
  constructor(deadlineMs: number) {
    super(`backend call exceeded per-attempt deadline of ${deadlineMs}ms`)
    this.name = 'DeadlineExceededError'
  }
}

/**
 * Default retryable classification — network/timeout class errors. Errors
 * a model deliberately throws (validation, refusal, 4xx) are not retried;
 * those represent real outcomes, not transient infrastructure faults.
 */
export const defaultIsRetryable: RetryableErrorPredicate = (err) => {
  if (err instanceof DeadlineExceededError) return true
  if (err instanceof Error) {
    const name = err.name
    const message = err.message.toLowerCase()
    if (name === 'AbortError' || name === 'TimeoutError') return true
    if (
      message.includes('econnreset') ||
      message.includes('etimedout') ||
      message.includes('econnrefused') ||
      message.includes('socket hang up') ||
      message.includes('network') ||
      message.includes('fetch failed')
    ) {
      return true
    }
  }
  return false
}

/** Live circuit-breaker state — one instance per (participant, conversation run). */
export class CircuitBreakerState {
  private consecutiveFailures = 0
  private openedAt: number | undefined

  constructor(private readonly config: CircuitBreakerConfig | undefined) {}

  /**
   * Check whether the next call is allowed. Throws `CircuitOpenError` when
   * the breaker is open and the cooldown hasn't elapsed.
   */
  preflight(participant: string, now: number = Date.now()): void {
    if (!this.config || this.openedAt === undefined) return
    const remaining = this.config.cooldownMs - (now - this.openedAt)
    if (remaining > 0) {
      throw new CircuitOpenError(participant, remaining)
    }
    this.openedAt = undefined
    this.consecutiveFailures = 0
  }

  recordSuccess(): void {
    this.consecutiveFailures = 0
    this.openedAt = undefined
  }

  recordFailure(now: number = Date.now()): void {
    if (!this.config) return
    this.consecutiveFailures += 1
    if (this.consecutiveFailures >= this.config.failuresToOpen) {
      this.openedAt = now
    }
  }
}

/**
 * Build a per-attempt AbortSignal linked to the parent signal AND fired when
 * the deadline elapses. The returned `dispose()` MUST be called in a
 * `finally` (clears the timer, detaches the listener) so we don't leak.
 *
 * When the deadline fires, the signal's `reason` is a `DeadlineExceededError`
 * — callers can detect timeout-vs-cancel by reading `signal.reason` after
 * the underlying operation throws.
 */
export function makePerAttemptSignal(
  parentSignal: AbortSignal | undefined,
  deadlineMs: number | undefined,
): {
  signal: AbortSignal
  dispose: () => void
  getDeadlineError(): DeadlineExceededError | undefined
} {
  const controller = new AbortController()
  let deadlineError: DeadlineExceededError | undefined
  const cleanups: Array<() => void> = []

  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason)
    else {
      const onAbort = () => controller.abort(parentSignal.reason)
      parentSignal.addEventListener('abort', onAbort, { once: true })
      cleanups.push(() => parentSignal.removeEventListener('abort', onAbort))
    }
  }
  if (deadlineMs !== undefined) {
    const ms = deadlineMs
    const timer = setTimeout(() => {
      deadlineError = new DeadlineExceededError(ms)
      controller.abort(deadlineError)
    }, ms)
    cleanups.push(() => clearTimeout(timer))
  }
  return {
    signal: controller.signal,
    dispose() {
      for (const c of cleanups) c()
    },
    getDeadlineError() {
      return deadlineError
    },
  }
}

/** Compute the delay before the next attempt. Default: 250ms exponential with jitter. */
export function computeBackoff(spec: RetryBackoff | undefined, attempt: number): number {
  if (spec === undefined) {
    const base = 250
    const jitter = Math.floor(Math.random() * base)
    return base * 2 ** (attempt - 1) + jitter
  }
  if (typeof spec === 'function') return Math.max(0, spec(attempt))
  return Math.max(0, spec)
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
