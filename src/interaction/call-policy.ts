export type RetryableErrorPredicate = (error: unknown) => boolean

export type RetryBackoff = number | ((attempt: number) => number)

export interface CircuitBreakerConfig {
  failuresToOpen: number
  cooldownMs: number
}

export interface TurnCallPolicy {
  timeoutMs?: number
  maxRetries?: number
  retryBackoffMs?: RetryBackoff
  isRetryable?: RetryableErrorPredicate
  circuitBreaker?: CircuitBreakerConfig
}

/** Reports that an actor is temporarily blocked after repeated failures. */
export class CircuitOpenError extends Error {
  constructor(actor: string, retryAfterMs: number) {
    super(`circuit open for actor '${actor}'; retry in ${retryAfterMs}ms`)
    this.name = 'CircuitOpenError'
  }
}

/** Reports that an actor did not finish its turn before the configured timeout. */
export class TurnTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`actor turn timed out after ${timeoutMs}ms`)
    this.name = 'TurnTimeoutError'
  }
}

/** Tracks consecutive actor failures and the configured recovery period. */
export class CircuitBreakerState {
  private consecutiveFailures = 0
  private openedAt: number | undefined

  constructor(private readonly config: CircuitBreakerConfig | undefined) {
    if (!config) return
    if (!Number.isInteger(config.failuresToOpen) || config.failuresToOpen < 1) {
      throw new Error('CircuitBreakerConfig.failuresToOpen must be a positive integer')
    }
    if (!Number.isFinite(config.cooldownMs) || config.cooldownMs < 0) {
      throw new Error('CircuitBreakerConfig.cooldownMs must be a non-negative finite number')
    }
  }

  preflight(actor: string, now: number = Date.now()): void {
    if (!this.config || this.openedAt === undefined) return
    const remaining = this.config.cooldownMs - (now - this.openedAt)
    if (remaining > 0) throw new CircuitOpenError(actor, remaining)
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
    if (this.consecutiveFailures >= this.config.failuresToOpen) this.openedAt = now
  }
}

export const defaultIsRetryable: RetryableErrorPredicate = (error) => {
  if (error instanceof TurnTimeoutError) return true
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  return (
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('econnrefused') ||
    message.includes('socket hang up') ||
    message.includes('network') ||
    message.includes('fetch failed') ||
    message.includes('temporarily unavailable')
  )
}

export function createAttemptSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number | undefined,
): {
  signal: AbortSignal
  dispose(): void
  timeoutError(): TurnTimeoutError | undefined
} {
  const controller = new AbortController()
  const cleanups: Array<() => void> = []
  let timeoutError: TurnTimeoutError | undefined

  if (parent) {
    const abort = () => controller.abort(parent.reason)
    if (parent.aborted) abort()
    else {
      parent.addEventListener('abort', abort, { once: true })
      cleanups.push(() => parent.removeEventListener('abort', abort))
    }
  }
  if (timeoutMs !== undefined) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('TurnCallPolicy.timeoutMs must be a positive finite number')
    }
    const timer = setTimeout(() => {
      timeoutError = new TurnTimeoutError(timeoutMs)
      controller.abort(timeoutError)
    }, timeoutMs)
    timer.unref?.()
    cleanups.push(() => clearTimeout(timer))
  }

  return {
    signal: controller.signal,
    dispose() {
      for (const cleanup of cleanups) cleanup()
    },
    timeoutError: () => timeoutError,
  }
}

export function retryDelay(spec: RetryBackoff | undefined, attempt: number): number {
  if (spec === undefined) return Math.min(4_000, 250 * 2 ** (attempt - 1))
  const value = typeof spec === 'function' ? spec(attempt) : spec
  return Number.isFinite(value) ? Math.max(0, value) : 0
}
