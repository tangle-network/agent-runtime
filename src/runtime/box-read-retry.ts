/**
 * One bounded-retry read over a sandbox box's filesystem, shared by every caller that reads a
 * path the agent may have just written.
 *
 * The box data plane can transiently 404 a file that exists: the write is not yet flushed, or an
 * edge read lands on a stale view. A first-attempt failure is therefore not evidence of absence,
 * and a caller that treats it as such records a lie — "the agent produced nothing" for a
 * deliverable, or "the agent deleted this surface" for a mounted profile file.
 *
 * Retries wait `delayMs × attempt` (linear), so the total wait for n attempts is
 * `delayMs × n(n-1)/2`. Set `delayMs` to 0 to retry without waiting (tests).
 */

import { sleep } from './util'

/** Text read from the box, or the last error after every attempt failed. */
export type BoxReadAttemptResult =
  | { succeeded: true; text: string }
  | { succeeded: false; error: unknown }

export interface BoxReadRetryOptions {
  /** Total read attempts, including the first. Values below 1 are treated as 1. */
  attempts: number
  /** Linear backoff base in ms; the i-th retry waits `delayMs × i`. 0 disables the wait. */
  delayMs: number
  /** Stops the retries once aborted: the pending wait ends and no further attempt is spent on an
   *  abandoned run. The last error is still returned, so a caller that must raise its own abort
   *  error keeps that authority through `beforeAttempt`. */
  signal?: AbortSignal
  /** Runs before every attempt, carrying the previous attempt's error (`undefined` on the first).
   *  Throw from here to abandon the read — the way an aborting caller cancels with an error only
   *  it can construct. */
  beforeAttempt?: (lastError: unknown) => void
}

/** The diagnostic for a failed attempt. `undefined` in, `undefined` out — so a caller can pass the
 *  "no attempt has failed yet" state through without inventing a message for it. */
export function boxReadErrorMessage(error: unknown): string | undefined {
  if (error === undefined) return undefined
  return error instanceof Error ? error.message : String(error)
}

export async function readBoxPathWithRetry(
  read: (path: string) => Promise<string>,
  path: string,
  options: BoxReadRetryOptions,
): Promise<BoxReadAttemptResult> {
  const attempts = Math.max(1, options.attempts)
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    options.beforeAttempt?.(lastError)
    // An abandoned run earns no further reads. The guard sits AFTER `beforeAttempt` so a caller
    // that raises its own abort error keeps that authority, and BEFORE the read so an already
    // cancelled run spends nothing.
    if (options.signal?.aborted) {
      lastError ??= new Error(
        `readBoxPathWithRetry: aborted before reading ${JSON.stringify(path)}`,
      )
      break
    }
    try {
      return { succeeded: true, text: await read(path) }
    } catch (err) {
      lastError = err
      if (attempt < attempts && options.delayMs > 0)
        await sleep(options.delayMs * attempt, options.signal)
    }
  }
  return { succeeded: false, error: lastError }
}
