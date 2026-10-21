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
 * Two classifications decide everything a failure means, and both are conservative (a third, for
 * an upstream out of capacity, is described below):
 *
 *  - TERMINAL failures are Runtime's own refusals: a `ValidationError`/`ConfigError` guard, an
 *    exhausted budget, an abort, a client-side transport status (401/404/422). Runtime meant them,
 *    so retrying re-runs a decision rather than recovering from an accident. They fail immediately.
 *  - TRANSIENT failures are everything foreign: a harness process that exited without a reason, a
 *    stream that cut mid-turn, a 5xx, a socket reset. Those are accidents, and they are exactly
 *    what a retry exists for. A harness turn that RETURNED a failed outcome is the same accident
 *    reported as a value rather than thrown, so the drive raises {@link HarnessTurnFailedError}
 *    and it is classified here like any other failure.
 *
 * The one loop the budget alone cannot bound is a driver that dies INSTANTLY and repeatedly — a
 * dead-on-arrival credential, a harness that refuses to start. Spending nothing, it would retry
 * until the deadline hours later. So progress is measured between attempts, and a run of attempts
 * that changes nothing stops at `maxConsecutiveFailures` once it has outlasted the outage window
 * described below. A failure that made progress resets that counter: a long run may be rescued
 * many times, a hopeless one gives up after the window.
 *
 * WHAT COUNTS AS PROGRESS is the part this module got wrong first, and the correction is measured.
 * The original mark read metered spend, settled children, and an accepted submission — the
 * filesystem and the meter, never the goal. Across 1,422 settled discovery-lab runs (2026-09-01)
 * that reading retried the runs that had produced NOTHING 629 of 827 times (76.1%) while retrying
 * the runs that HAD left an artifact 21 of 399 times (5.3%): the loop spent its second chances on
 * the hopeless runs and measured persistence by burn rate. So when the caller declares a completion
 * check, spend and settlements alone are NOT progress while that check is unmet; only a delivery —
 * an accepted submission, a child that passed the check, or the contract turning met — resets the
 * barren counter. A caller that declares no check reports `contract: 'none'` and keeps the exact
 * historical reading.
 *
 * THE SECOND HALF of the same defect: `budgetStop` used to be consulted only after a failure, and a
 * driver that RETURNED with the contract unmet ended the run silently — 376 of 376 winning lab runs
 * ended on this loop's own `stop: 'completed'`, with the completion gate left to label the result
 * rather than to change it. A completed drive whose contract is unmet is now a first-class moment:
 * the manager's `continuation` policy (`src/runtime/supervise/continuation.ts`) re-enters the driver with Runtime's
 * continuation note, and every re-entry crosses the same budget, deadline, and abort bounds.
 * Successful continuations do not consume the failure retry allowance.
 *
 * This loop decides WHETHER to re-enter; it does not know WHERE the next drive runs. Whether the
 * re-entered driver continues the same harness session, the same environment, or a replacement is
 * the drive harness's fact, and the caller composes the re-entry task from it (see
 * `./reentry.ts`). A continuation re-enters the same session only on a backend that proves it.
 *
 * Progress bounds the continuations, and nothing else counts them. The same delivery reading that
 * resets the barren failure counter decides whether a continued drive earned another:
 * `continuation.maxBarren` consecutive re-entered drives that completed without progress end the
 * loop with `repromptRefusedBy: 'no-progress'`. Progress is a delivery or a rise in the check's
 * best composite. There is no count cap and no caller veto: the old prompt-owned loop logged 896
 * of 1,011 rounds with no progress, and 650 recorded inputs chose seven different re-prompt counts.
 *
 * A RE-ENTERED run is one this process resumed after an earlier process drove it, usually one
 * that stopped without settling it. Its first drive is entered as `run-reentered` with the
 * workers that were open, and a drive counts toward `maxBarren` only if it began after the root
 * streamed a model event in this process: the drive that straddles the restart never counts, and
 * a root that speaks and then stays barren is refused as any other. Measured 2026-10-19 on
 * magnetar-rust-20261019f: after a host reboot the re-entered root was first driven with the
 * bare original task and no word of its three open workers, two barren continuations followed,
 * and the run settled `no-result-selected`.
 *
 * A THIRD CLASS sits between the two: the upstream said "not now". A model provider's exhausted
 * quota, a rate limit, or an overloaded service (HTTP 429, 503, 529, or the router's own codes for
 * them) is not an accident in the driver and not a decision by Runtime; the same request succeeds
 * when capacity returns. Such a failure PAUSES the driver and re-enters it. A pause consumes neither
 * `maxAttempts` nor the barren streak, so only the deadline, the budget, and cancellation bound it.
 * Measured 2026-09-24 on play anomaly-referee-v3d: during the router's flash quota outage four of
 * five lead lanes ended `driver-failed` between minutes 101 and 118, after 12 to 13 attempts, while
 * the router answered some turns in between (one lead spent 1.7M and 3.3M input tokens on two of
 * them) and each run's budget and 8-hour deadline were almost untouched.
 *
 * A TRANSIENT failure that spent nothing, settled nothing, and made no progress is an
 * infrastructure outage until its streak has lasted `transientOutageMs`: nothing ran, so nothing
 * is being burned. Within that window it consumes neither `maxAttempts` nor the barren streak,
 * exactly like a pause, and only the deadline, the budget, and cancellation bound it. After the
 * window the failure bounds apply again, so a dead-on-arrival driver still stops, in minutes
 * rather than hours. The exception is a box that was created and then failed its setup (Sandbox's
 * `PartialFailureError`): it meets the same failure on every re-entry, so a second identical
 * attempt with no progress stops with `repeated-failure` (`SAME_PARTIAL_FAILURE_LIMIT`). A failure
 * that spent tokens without delivering keeps the bounds above,
 * because that is the burn the progress rule exists to stop. Measured 2026-10-04 on Discovery run research-nqs-20261003system2: a Platform
 * restart answered `HTTP 502 ... Platform key verification unavailable` from 03:04:34 to 03:09:41Z,
 * and the coordinator's twelve attempts ran out at 03:07:12Z with no token spent, while a sibling
 * that kept retrying survived.
 *
 * Every wait, a failure backoff or a pause, is jittered over its upper half so drivers that one
 * outage cut off together do not re-enter together.
 */

import { ValidationError } from '../../errors'
import type { ContinuationContext } from './continuation'
import type { DriverAttemptRecord } from './driver-attempt-evidence'
import { DriverRetryLoop, driverRetryLimits } from './driver-retry-loop'
import type { RetainedExecutionPendingError } from './retained-executor'
import type { Scope } from './types'
import type { UnavailablePausePolicy } from './upstream-unavailable'

/** The scope's live conserved-pool readout — the retry's real bound. Indexed off `Scope` so this
 *  module tracks the pool's shape rather than restating it. */
export type DriverBudgetReadout = Scope<unknown>['budget']

/** Whether the run's declared completion check has passed. `'none'` means the caller declared no
 *  check at all — the retry then reads spend and settlements exactly as it always has. */
export type DriverContractState = 'met' | 'unmet' | 'none'

/** How hard the root driver is retried after a transient failure. The defaults retry; a caller
 *  that wants the pre-#741 behavior sets `enabled: false` and owns the consequence. */
export interface DriverRetryPolicy extends UnavailablePausePolicy {
  /** `false` restores the historical behavior: the first driver failure ends the run. */
  readonly enabled?: boolean
  /** Consecutive failures that changed NOTHING (no metered spend, no settlement, no submission)
   *  before the run gives up. Default 3. A failure that made progress resets the count. Not
   *  enforced on a transient streak younger than `transientOutageMs`. */
  readonly maxConsecutiveFailures?: number
  /** Ceiling on failed invocations across this driver run, regardless of progress. Default: no
   *  ceiling, minimum 1. A failure that made no progress is bounded by `maxConsecutiveFailures`;
   *  failures that each made progress are bounded by the budget and the deadline, like the work
   *  they did. Successful continuations do not consume this allowance or reset it, and neither
   *  does a transient failure inside the outage window. */
  readonly maxAttempts?: number
  /** Backoff before the first retry, doubling per consecutive failure. Default 2000ms. */
  readonly initialBackoffMs?: number
  /** Ceiling on the doubling. Default 30000ms. */
  readonly maxBackoffMs?: number
  /** How long a streak of transient failures that spent nothing, settled nothing, and made no
   *  progress is retried as an infrastructure outage, from the streak's first failure, before
   *  `maxAttempts` and
   *  `maxConsecutiveFailures` apply to it. Default 900000ms (15 minutes), longer than a routine
   *  Platform restart. */
  readonly transientOutageMs?: number
}

/** The comparable mark used to decide whether an attempt moved the run TOWARD ITS DELIVERABLE.
 *  While a declared check is unmet, spend and settlements are not progress on their own; see this
 *  file's header for the measurement that made that the rule. */
export interface DriverProgressMark {
  /** Monotone total of POOL spend since the first reading, in tokens — the driver's own metered
   *  turns AND any child settlement, because the conserved pool is shared. Deliberately not
   *  driver-only: a child that settled during the attempt is progress by any reading, and the
   *  coarser signal can only bias toward rescuing a run, never toward abandoning one. */
  readonly poolTokensSpent: number
  /** Monotone count of settled children. */
  readonly settledCount: number
  /** Whether an accepted deliverable exists — a submission that PASSED the completion check. */
  readonly submitted: boolean
  /** The completion check's verdict right now. Omit (or `'none'`) when the caller declares no
   *  check: the retry then reads spend and settlements exactly as it did before this field
   *  existed, so a caller with no contract is unaffected. */
  readonly contract?: DriverContractState
  /** Monotone count of settled children that PASSED the completion check. A child that ran and
   *  settled without delivering does not count here, which is the whole point. */
  readonly deliveredCount?: number
  /** The best composite any check read has scored so far. A rise is progress: the director moved
   *  the outside check even though it has not passed. */
  readonly composite?: number
}

/** Why the loop is entering the driver again. Absent on the first attempt only.
 *
 *  An `unmet-contract` re-entry carries Runtime's continuation note. A `driver-failure` re-entry
 *  carries no instruction of its own: the drive that failed may never have read the last one, so
 *  the caller re-enters with the ORIGINAL task and the run's state, never with the note alone. */
export type DriverReentry =
  | {
      readonly reason: 'unmet-contract'
      /** The continuation note. Whether it is the whole turn depends on where the drive runs: only
       *  a backend that proves the same harness session may be re-entered with this text alone. */
      readonly steer: string
      /** 1-based: which continuation this is. */
      readonly continuation: number
    }
  | {
      readonly reason: 'driver-failure'
      /** The failure that ended the previous drive, as recorded. */
      readonly failure: string
      /** 1-based: which failure retry this is. */
      readonly retry: number
    }
  | {
      /** The previous turn ended with work open, and Runtime woke the manager when something
       *  happened. Not a continuation: the manager chose to wait, and `input` is what it waited for. */
      readonly reason: 'wake'
      /** The wake input: every event since the last turn, or the heartbeat or deadline notice. */
      readonly input: string
      /** 1-based: which wake this is. */
      readonly wake: number
    }
  | {
      /** The upstream refused the previous drive for capacity, or the check could not run, and the
       *  loop paused before this one. Re-entered like a failure, with the original task and the
       *  run's state. */
      readonly reason: 'upstream-unavailable'
      /** The code or status that classified the refusal, such as `provider_quota_exhausted`. */
      readonly signal: string
      /** 1-based: which pause this is. */
      readonly pause: number
    }
  | {
      /** An earlier process drove this run, usually one that stopped without settling it (a host
       *  reboot, a crash, a killed process), and this is the first drive of the process that
       *  resumed it. */
      readonly reason: 'run-reentered'
      /** This manager's workers that were open when the previous process stopped. */
      readonly live: ReadonlyArray<string>
      /** Of `live`, the workers this process re-placed. The others are gone: they will not
       *  report, and their unfinished work is lost. */
      readonly replaced: ReadonlyArray<string>
    }

/**
 * How a completed drive with its check unmet is re-entered. Runtime builds it from the manager's
 * `ContinuationPolicy`; nothing here is a product hook, so no caller can veto a continuation or
 * replace Runtime's note.
 */
export interface DriverContinuationPolicy {
  /** Re-entered drives in a row that may complete without progress. Minimum 1. */
  readonly maxBarren: number
  /** Epoch ms at or after which no continuation starts. */
  readonly deadlineMs: number
  /** Write the continuation note for this re-entry. */
  readonly compose: (context: ContinuationContext) => Promise<string>
  /** True when the run is already closed (the manager's own `stop`, a progress stop rule): a
   *  continuation would re-enter a session told to stop. */
  readonly closed: () => boolean
}

/**
 * A turn that ends with work open is a wait, not a completion. Runtime blocks with no model turn
 * until something happens, then enters the same driver again with what happened.
 */
interface DriverWaitPolicy {
  /** True while the manager has work it must hear back about. */
  readonly open: () => boolean
  /** Wait for the next wake of `attempt`; the wake input, or undefined when nothing is open. */
  readonly wake: (
    attempt: number,
  ) => Promise<{ readonly input: string; readonly idleMs: number } | undefined>
}

export interface DriverRetryRun {
  /** Run one attempt. Rejects exactly as the un-retried driver would. `reentry` is present on
   *  every attempt after the first, and on the first one of a re-entered run; see
   *  {@link DriverReentry}. */
  readonly drive: (attempt: number, reentry?: DriverReentry) => Promise<void>
  /**
   * Present when this loop drives a run an earlier process drove (a resume). Its first
   * drive is entered with `first`. Until `modelEvents()` is above zero when an attempt begins, that
   * attempt does not count toward `continuation.maxBarren`: drives made before the re-entered root
   * has spoken once measure the restart, not the root. The failure bounds, the deadline and the
   * budget still apply to them.
   */
  readonly reentered?: {
    readonly first: Extract<DriverReentry, { reason: 'run-reentered' }>
    /** Model events the root's harness streamed in this process. */
    readonly modelEvents: () => number
  }
  /** Read the current progress mark. Called before and after every attempt. */
  readonly progress: () => DriverProgressMark
  /** Read the live budget — the retry's real bound. */
  readonly budget: () => DriverBudgetReadout
  /** The scope's cancellation signal. An aborted scope is terminal, never retried. */
  readonly signal: AbortSignal
  readonly policy?: DriverRetryPolicy
  /** How a COMPLETED drive with its check unmet is re-entered. Omit = never, which is correct
   *  only for a manager with no check. */
  readonly continuation?: DriverContinuationPolicy
  /** How a completed drive that left work open waits. Omit = a completed drive is the end. */
  readonly wait?: DriverWaitPolicy
  readonly onAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  /**
   * Abandon the unfinished retained invocation a failed drive left pending, and answer whether
   * it was abandoned. The loop asks when the same invocation failed reconciliation with the same
   * cause twice in a row, or when that failure would otherwise end the run: retrying the same
   * reconciliation repeats the same refusal. Discovery run terraform-dc-tokens-20261006d repeated
   * one on 20 drives over 16 minutes until the barren bound settled it `driver-failed`
   * (2026-10-07). Only an `unobservable` or `nested-recovery` pending is offered: the provider
   * answered and could not resolve the execution. Omit = never.
   */
  readonly resolvePending?: (
    failure: RetainedExecutionPendingError,
    failures: number,
  ) => Promise<boolean>
  readonly now?: () => number
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
  /** The jitter source, in `[0, 1)`. Default `Math.random`. */
  readonly random?: () => number
}

function assertContinuationPolicy(continuation: DriverContinuationPolicy | undefined): void {
  if (continuation === undefined) return
  if (!Number.isFinite(continuation.deadlineMs) || continuation.deadlineMs <= 0) {
    throw new ValidationError('runDriverWithRetry: a continuation needs a finite positive deadline')
  }
  if (!Number.isInteger(continuation.maxBarren) || continuation.maxBarren < 1) {
    throw new ValidationError('runDriverWithRetry: continuation.maxBarren must be an integer >= 1')
  }
}

/**
 * Run the driver until it completes WITH ITS CONTRACT MET, or until the budget, the deadline, an
 * abort, a terminal error, or a ceiling stops it. Transient failures are retried. A drive that
 * returns with its completion check unmet is re-entered with Runtime's continuation note until the
 * continuation's deadline or `maxBarren` turns without progress. Throws
 * `DriverAttemptsExhaustedError` (cause = the last real failure) when a FAILURE ends the loop; a
 * completed drive returns, met contract or not, because deciding what an undelivered run is worth
 * belongs to the finalizer, not to this loop.
 */
export async function runDriverWithRetry(run: DriverRetryRun): Promise<void> {
  const limits = driverRetryLimits(run)
  assertContinuationPolicy(run.continuation)
  const loop = new DriverRetryLoop(run, limits)
  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = limits.now()
    loop.beforeModelEvent = run.reentered !== undefined && run.reentered.modelEvents() === 0
    // The completed-drive arm lives OUTSIDE this try. A configuration fault raised while deciding
    // the re-prompt is the caller's, not the driver's, and must reach the caller unwrapped instead
    // of being classified as one more driver failure.
    // No asynchronous work separates this check from dispatch. It covers first entry and
    // re-entry after onAttempt, whose awaited observer may exhaust authority or resources.
    if (loop.admissionRefused()) return
    try {
      await run.drive(attempt, loop.reentry)
    } catch (error) {
      await loop.afterFailure(error, attempt, before, startedAt)
      continue
    }
    if (!(await loop.afterCompletion(attempt, before, startedAt))) return
  }
}
