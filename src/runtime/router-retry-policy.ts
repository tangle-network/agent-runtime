import { ValidationError } from '../errors'

/** Exact retry controls accepted at `AgentProfile.model.metadata.retry`. */
export interface RouterRetryPolicy {
  /** Total attempts, including the first request. */
  readonly maxAttempts?: number
  /** Delay before the second attempt. Later delays grow exponentially. */
  readonly initialBackoffMs?: number
  /** Maximum delay between attempts. */
  readonly maxBackoffMs?: number
  /** Symmetric random variation around each delay, from 0 through 1. */
  readonly jitter?: number
  /** HTTP statuses that may be retried. */
  readonly retryStatuses?: ReadonlyArray<number>
  /** Deadline for receiving one attempt's response headers. Zero disables it. */
  readonly requestTimeoutMs?: number
}

export interface ResolvedRouterRetryPolicy {
  readonly maxAttempts: number
  readonly initialBackoffMs: number
  readonly maxBackoffMs: number
  readonly jitter: number
  readonly retryStatuses: ReadonlyArray<number>
  readonly requestTimeoutMs: number
}

const maximumTimerMs = 2_147_483_647
const defaultRetryStatuses = Object.freeze([408, 425, 429, 500, 502, 503, 504, 520, 522, 524])
const retryPolicyKeys = new Set([
  'initialBackoffMs',
  'jitter',
  'maxAttempts',
  'maxBackoffMs',
  'requestTimeoutMs',
  'retryStatuses',
])

/** Parse untrusted profile/config data once and return an immutable complete policy. */
export function resolveRouterRetryPolicy(
  input: unknown,
  context: string,
): ResolvedRouterRetryPolicy {
  if (
    input !== undefined &&
    (typeof input !== 'object' || input === null || Array.isArray(input))
  ) {
    throw new ValidationError(`${context} must be an object`)
  }
  const policy = input === undefined ? {} : Object.fromEntries(Object.entries(input))
  const unknown = Object.keys(policy).filter((key) => !retryPolicyKeys.has(key))
  if (unknown.length > 0) {
    throw new ValidationError(`${context} has unsupported fields: ${unknown.join(', ')}`)
  }
  const maxAttempts = positiveInteger(policy.maxAttempts, 5, `${context}.maxAttempts`)
  const initialBackoffMs = timerInteger(
    policy.initialBackoffMs,
    1_000,
    `${context}.initialBackoffMs`,
  )
  const maxBackoffMs = timerInteger(policy.maxBackoffMs, 30_000, `${context}.maxBackoffMs`)
  const requestTimeoutMs = timerInteger(
    policy.requestTimeoutMs,
    120_000,
    `${context}.requestTimeoutMs`,
  )
  const jitter = policy.jitter ?? 0.25
  if (typeof jitter !== 'number' || !Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
    throw new ValidationError(`${context}.jitter must be a finite number from 0 through 1`)
  }
  const retryStatuses = parseRetryStatuses(policy.retryStatuses, context)
  return Object.freeze({
    maxAttempts,
    initialBackoffMs,
    maxBackoffMs,
    jitter,
    retryStatuses,
    requestTimeoutMs,
  })
}

function parseRetryStatuses(value: unknown, context: string): ReadonlyArray<number> {
  if (value === undefined) return defaultRetryStatuses
  if (!Array.isArray(value)) {
    throw new ValidationError(`${context}.retryStatuses must be an array of HTTP statuses`)
  }
  const statuses: number[] = []
  const seen = new Set<number>()
  for (const status of value) {
    if (!Number.isSafeInteger(status) || status < 100 || status > 599) {
      throw new ValidationError(
        `${context}.retryStatuses must contain integer HTTP statuses from 100 through 599`,
      )
    }
    if (seen.has(status)) {
      throw new ValidationError(`${context}.retryStatuses must not contain duplicates`)
    }
    seen.add(status)
    statuses.push(status)
  }
  return Object.freeze(statuses)
}

function positiveInteger(value: unknown, fallback: number, context: string): number {
  const parsed = value ?? fallback
  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ValidationError(`${context} must be a positive safe integer`)
  }
  return parsed
}

function timerInteger(value: unknown, fallback: number, context: string): number {
  const parsed = value ?? fallback
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < 0 ||
    parsed > maximumTimerMs
  ) {
    throw new ValidationError(
      `${context} must be a nonnegative safe integer no greater than ${maximumTimerMs}`,
    )
  }
  return parsed
}
