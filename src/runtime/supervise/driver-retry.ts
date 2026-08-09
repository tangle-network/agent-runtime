/**
 * Root-driver retry — the root gets the same second chance a worker's transport already has.
 *
 * A spawned child that dies is typed into a `down` settlement and the driver may re-spawn it. The
 * ROOT had no such path: one dropped connection, one SIGKILLed harness process, one upstream 5xx
 * ended a run of arbitrary length with `reason: 'driver-failed'`, and every live child was torn
 * down with it (#741). The driver's budget and deadline were usually almost untouched.
 *
 * This module supplies the missing arm: run the driver again, on the SAME scope, the SAME
 * coordination server and the SAME live children, until the budget or the deadline says stop.
 * Nothing here restarts children or replays work — it re-enters the driver, and the bridge backend
 * reattaches the harness session because the execution id is bound durably per node.
 *
 * Two classifications decide everything, and both are conservative:
 *
 *  - TERMINAL failures are Runtime's own refusals: a `ValidationError`/`ConfigError` guard, an
 *    exhausted budget, an abort, a client-side transport status (401/404/422). Runtime meant them,
 *    so retrying re-runs a decision rather than recovering from an accident. They fail immediately.
 *  - TRANSIENT failures are everything foreign: a harness process that exited without a reason, a
 *    stream that cut mid-turn, a 5xx, a socket reset. Those are accidents, and they are exactly
 *    what a retry exists for.
 *
 * The one loop the budget alone cannot bound is a driver that dies INSTANTLY and repeatedly — a
 * dead-on-arrival credential, a harness that refuses to start. Spending nothing, it would retry
 * until the deadline hours later. So progress is measured between attempts (metered driver spend,
 * settled children, an accepted submission), and a run of attempts that changes none of them stops
 * at `maxConsecutiveFailures`. A failure that made progress resets that counter: a long run may be
 * rescued many times, a hopeless one gives up in seconds.
 */

import {
  AgentEvalError,
  BackendTransportError,
  ConfigError,
  RuntimeRunStateError,
  ValidationError,
} from '../../errors'
import type { Scope } from './types'

/** The scope's live conserved-pool readout — the retry's real bound. Indexed off `Scope` so this
 *  module tracks the pool's shape rather than restating it. */
export type DriverBudgetReadout = Scope<unknown>['budget']

/** How hard the root driver is retried after a transient failure. The defaults retry; a caller
 *  that wants the pre-#741 behavior sets `enabled: false` and owns the consequence. */
export interface DriverRetryPolicy {
  /** `false` restores the historical behavior: the first driver failure ends the run. */
  readonly enabled?: boolean
  /** Consecutive failures that changed NOTHING (no metered spend, no settlement, no submission)
   *  before the run gives up. Default 3. A failure that made progress resets the count. */
  readonly maxConsecutiveFailures?: number
  /** Absolute ceiling on attempts, regardless of progress. Default 8. The barren counter alone
   *  cannot bound a driver that crashes every turn AFTER metering a little: each attempt looks like
   *  progress, so without this backstop such a run would retry until it had eaten the entire
   *  envelope. A caller who wants budget-only bounding sets this high deliberately. */
  readonly maxAttempts?: number
  /** Backoff before the first retry, doubling per consecutive failure. Default 2000ms. */
  readonly initialBackoffMs?: number
  /** Ceiling on the doubling. Default 30000ms. */
  readonly maxBackoffMs?: number
}

/** Why the retry loop stopped. `completed` is the only non-failure. */
export type DriverAttemptStop =
  | 'completed'
  | 'terminal-error'
  | 'retry-disabled'
  | 'aborted'
  | 'budget-exhausted'
  | 'deadline'
  | 'no-progress'
  | 'max-attempts'

/** One attempt's record — the legible failure the issue's third ask names. Emitted per attempt so
 *  an operator sees `driver failed after N attempts` instead of one opaque `pi exit unknown`. */
export interface DriverAttemptRecord {
  /** 1-based. */
  readonly attempt: number
  readonly durationMs: number
  /** Absent when the attempt completed. */
  readonly error?: string
  readonly classification?: 'transient' | 'terminal'
  /** Did anything change since the previous attempt (spend, settlement, submission)? */
  readonly madeProgress: boolean
  /** Set when this attempt ended the loop. */
  readonly stop?: DriverAttemptStop
  /** Set when another attempt follows. */
  readonly retryInMs?: number
}

/** The comparable mark used to decide whether an attempt did anything at all. Any field moving
 *  counts as progress — a driver that metered one turn before dying is not dead on arrival. */
export interface DriverProgressMark {
  /** Monotone total of the driver's own metered spend, in tokens. */
  readonly tokensSpent: number
  /** Monotone count of settled children. */
  readonly settledCount: number
  /** Whether an accepted deliverable exists. */
  readonly submitted: boolean
}

export interface DriverRetryRun {
  /** Run one attempt. Rejects exactly as the un-retried driver would. */
  readonly drive: (attempt: number) => Promise<void>
  /** Read the current progress mark. Called before and after every attempt. */
  readonly progress: () => DriverProgressMark
  /** Read the live budget — the retry's real bound. */
  readonly budget: () => DriverBudgetReadout
  /** The scope's cancellation signal. An aborted scope is terminal, never retried. */
  readonly signal: AbortSignal
  readonly policy?: DriverRetryPolicy
  readonly onAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  readonly now?: () => number
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_INITIAL_BACKOFF_MS = 2_000
const DEFAULT_MAX_BACKOFF_MS = 30_000

/**
 * Classify one driver failure. Runtime's own typed refusals are decisions and stay terminal;
 * anything foreign is an accident and is retryable. A `BackendTransportError` is split by status
 * because the taxonomy already promises consumers may branch on it: a 5xx/429/408 is the upstream
 * having a bad moment, while a 401/404/422 is a request that will fail identically forever.
 */
export function classifyDriverFailure(
  error: unknown,
  signal?: AbortSignal,
): 'transient' | 'terminal' {
  if (signal?.aborted) return 'terminal'
  if (error instanceof Error && error.name === 'AbortError') return 'terminal'
  if (error instanceof BackendTransportError) {
    const status = error.status
    if (status === undefined) return 'transient'
    if (status === 408 || status === 429 || status >= 500) return 'transient'
    return 'terminal'
  }
  if (
    error instanceof ValidationError ||
    error instanceof ConfigError ||
    error instanceof RuntimeRunStateError
  ) {
    return 'terminal'
  }
  // Every other AgentEvalError (session mismatch, planner, analyst, not-found) is a structural
  // refusal too. Kept after the transport check, which is itself an AgentEvalError subclass.
  if (error instanceof AgentEvalError) return 'terminal'
  return 'transient'
}

/** The budget's own verdict on whether another attempt may run at all. */
export function budgetStop(
  budget: DriverBudgetReadout,
  atMs: number,
): DriverAttemptStop | undefined {
  if (budget.deadlineMs > 0 && atMs >= budget.deadlineMs) return 'deadline'
  if (budget.tokensLeft <= 0 || budget.iterationsLeft <= 0) return 'budget-exhausted'
  if (budget.usdCapped && budget.usdLeft <= 0) return 'budget-exhausted'
  // A dollar-capped pool that has seen an unknown-cost turn closes admission permanently, so a
  // retry could only reproduce the same refusal. The pool's own state proves this, independently of
  // how the refusal was thrown.
  if (budget.usdCapped && budget.usdKnown === false) return 'budget-exhausted'
  return undefined
}

function madeProgress(before: DriverProgressMark, after: DriverProgressMark): boolean {
  return (
    after.tokensSpent > before.tokensSpent ||
    after.settledCount > before.settledCount ||
    (after.submitted && !before.submitted)
  )
}

/** The error a give-up throws: the original cause, re-described with the attempt history so
 *  `driver-failed` carries a diagnosable message instead of one backend's last words. */
export class DriverAttemptsExhaustedError extends RuntimeRunStateError {
  readonly attempts: readonly DriverAttemptRecord[]
  readonly stop: DriverAttemptStop

  constructor(cause: unknown, attempts: readonly DriverAttemptRecord[], stop: DriverAttemptStop) {
    const last = attempts[attempts.length - 1]
    const causeText =
      cause instanceof Error ? `${cause.name}: ${cause.message}` : describeUnknown(cause)
    super(
      `supervisor driver failed after ${attempts.length} attempt(s) — stopped by ${stop}; ` +
        `last cause: ${causeText}` +
        (last?.classification ? ` (classified ${last.classification})` : ''),
      { cause },
    )
    this.attempts = Object.freeze([...attempts])
    this.stop = stop
  }
}

function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    // A timer left armed past the run would pin the process to a deadline nobody reads.
    if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
      ;(timer as { unref: () => void }).unref()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}

/**
 * Run the driver, retrying transient failures until the budget, the deadline, an abort, a terminal
 * error, or the no-progress ceiling stops it. Returns when an attempt completes; throws
 * `DriverAttemptsExhaustedError` (cause = the last real failure) when it does not.
 */
export async function runDriverWithRetry(run: DriverRetryRun): Promise<void> {
  const now = run.now ?? Date.now
  const sleep = run.sleep ?? defaultSleep
  const policy = run.policy ?? {}
  const retryEnabled = policy.enabled !== false
  const maxConsecutive = Math.max(
    0,
    policy.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
  )
  const maxAttempts = Math.max(1, policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const initialBackoff = Math.max(0, policy.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS)
  const maxBackoff = Math.max(initialBackoff, policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)

  const attempts: DriverAttemptRecord[] = []
  let consecutiveBarren = 0

  const emit = async (record: DriverAttemptRecord): Promise<void> => {
    attempts.push(record)
    await run.onAttempt?.(record)
  }

  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = now()
    try {
      await run.drive(attempt)
      await emit({
        attempt,
        durationMs: now() - startedAt,
        madeProgress: madeProgress(before, run.progress()),
        stop: 'completed',
      })
      return
    } catch (error) {
      const durationMs = now() - startedAt
      const classification = classifyDriverFailure(error, run.signal)
      const progressed = madeProgress(before, run.progress())
      const stop = ((): DriverAttemptStop | undefined => {
        if (classification === 'terminal') return 'terminal-error'
        if (!retryEnabled) return 'retry-disabled'
        if (run.signal.aborted) return 'aborted'
        const byBudget = budgetStop(run.budget(), now())
        if (byBudget) return byBudget
        if (attempt >= maxAttempts) return 'max-attempts'
        // Progress resets the barren counter: a driver that is doing real work between crashes
        // has earned another attempt, and the budget remains the bound on how many.
        if (progressed) return undefined
        return consecutiveBarren + 1 >= maxConsecutive ? 'no-progress' : undefined
      })()

      if (stop !== undefined) {
        await emit({
          attempt,
          durationMs,
          error: error instanceof Error ? error.message : describeUnknown(error),
          classification,
          madeProgress: progressed,
          stop,
        })
        throw new DriverAttemptsExhaustedError(error, attempts, stop)
      }

      consecutiveBarren = progressed ? 0 : consecutiveBarren + 1
      const backoff = Math.min(maxBackoff, initialBackoff * 2 ** Math.max(0, consecutiveBarren - 1))
      await emit({
        attempt,
        durationMs,
        error: error instanceof Error ? error.message : describeUnknown(error),
        classification,
        madeProgress: progressed,
        retryInMs: backoff,
      })
      await sleep(backoff, run.signal)
      // The wait is where an abort or a deadline most often lands; re-ask before re-entering.
      if (run.signal.aborted) {
        throw new DriverAttemptsExhaustedError(error, attempts, 'aborted')
      }
      const afterWait = budgetStop(run.budget(), now())
      if (afterWait) {
        throw new DriverAttemptsExhaustedError(error, attempts, afterWait)
      }
    }
  }
}
