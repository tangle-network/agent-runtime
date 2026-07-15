import { MAX_CANDIDATE_TIMER_INTERVAL_MS } from './cleanup'

export const CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS = 10_000
const CANDIDATE_POST_RUN_CLEANUP_PHASES = 4

/** Process stop, access closure, model evidence, and task/result evidence. */
export function candidatePostRunWindowMs(
  cleanupTimeoutMs: number,
  resultTimeoutMs: number,
): number {
  const windowMs =
    cleanupTimeoutMs * CANDIDATE_POST_RUN_CLEANUP_PHASES +
    resultTimeoutMs +
    CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS
  if (!Number.isSafeInteger(windowMs) || windowMs > MAX_CANDIDATE_TIMER_INTERVAL_MS) {
    throw new Error('candidate post-run window exceeds the supported timer range')
  }
  return windowMs
}

/** Maximum owner lifetime from claim through process stop, access closure, and terminal write. */
export function candidateExecutionOwnerWindowMs(
  timeoutMs: number,
  cleanupTimeoutMs: number,
  resultTimeoutMs: number,
): number {
  const windowMs = timeoutMs + candidatePostRunWindowMs(cleanupTimeoutMs, resultTimeoutMs)
  if (!Number.isSafeInteger(windowMs) || windowMs > MAX_CANDIDATE_TIMER_INTERVAL_MS) {
    throw new Error('candidate execution and cleanup window exceeds the supported timer range')
  }
  return windowMs
}

/** Time reserved after scoring for failure evidence plus terminal publication. */
export function candidateTerminalWindowMs(cleanupTimeoutMs: number): number {
  const windowMs = cleanupTimeoutMs + CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS
  if (!Number.isSafeInteger(windowMs) || windowMs > MAX_CANDIDATE_TIMER_INTERVAL_MS) {
    throw new Error('candidate terminal window exceeds the supported timer range')
  }
  return windowMs
}
