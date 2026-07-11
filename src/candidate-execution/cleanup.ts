export const DEFAULT_CANDIDATE_CLEANUP_TIMEOUT_MS = 30_000
/** Largest delay Node schedules without clamping to one millisecond. */
export const MAX_CANDIDATE_TIMER_INTERVAL_MS = 2_147_483_647

export function candidateCleanupTimeout(timeoutMs: number | undefined): number {
  const effective = timeoutMs ?? DEFAULT_CANDIDATE_CLEANUP_TIMEOUT_MS
  if (
    !Number.isSafeInteger(effective) ||
    effective <= 0 ||
    effective > MAX_CANDIDATE_TIMER_INTERVAL_MS
  ) {
    throw new Error('candidate cleanup timeout is outside the supported timer range')
  }
  return effective
}

export function candidateCleanupDeadline(timeoutMs: number | undefined): number {
  return Date.now() + candidateCleanupTimeout(timeoutMs)
}

/** Freeze a separate result-construction budget; defaults to the task wall limit. */
export function candidateResultTimeout(
  timeoutMs: number | undefined,
  taskTimeoutMs: number,
): number {
  const effective = timeoutMs ?? taskTimeoutMs
  if (
    !Number.isSafeInteger(effective) ||
    effective <= 0 ||
    effective > MAX_CANDIDATE_TIMER_INTERVAL_MS
  ) {
    throw new Error('candidate result timeout is outside the supported timer range')
  }
  return effective
}

/** Bound an evaluator cleanup call while keeping late rejection observed. */
export async function withinCandidateCleanupDeadline<T>(
  operation: () => Promise<T>,
  deadlineAtMs: number,
  label: string,
): Promise<T> {
  const remainingMs = deadlineAtMs - Date.now()
  if (remainingMs <= 0) throw new CandidateCleanupTimeoutError(label)

  const pending = Promise.resolve().then(operation)
  void pending.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new CandidateCleanupTimeoutError(label)), remainingMs)
      }),
    ])
    if (Date.now() > deadlineAtMs) throw new CandidateCleanupTimeoutError(label)
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Bound cancellable scoring/result work. Every side-effecting port called by
 * `operation` must honor the supplied signal before durable publication.
 */
export async function withinCandidateResultDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  deadlineAtMs: number,
  label: string,
): Promise<T> {
  const remainingMs = deadlineAtMs - Date.now()
  if (remainingMs <= 0) throw new CandidateResultTimeoutError(label)

  const controller = new AbortController()
  const timeoutError = new CandidateResultTimeoutError(label)
  const pending = Promise.resolve().then(() => operation(controller.signal))
  void pending.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort(timeoutError)
          reject(timeoutError)
        }, remainingMs)
      }),
    ])
    if (Date.now() > deadlineAtMs) {
      controller.abort(timeoutError)
      throw timeoutError
    }
    return result
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export class CandidateCleanupTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} did not complete before the evaluator cleanup deadline`)
    this.name = 'CandidateCleanupTimeoutError'
  }
}

export class CandidateResultTimeoutError extends Error {
  constructor(label: string) {
    super(`${label} did not complete before the evaluator result deadline`)
    this.name = 'CandidateResultTimeoutError'
  }
}
