/**
 * Root-driver retry — the root gets the same second chance a worker's transport already has.
 *
 * One dropped connection, one SIGKILLed harness process or one upstream 5xx used to end a run of
 * arbitrary length with `reason: 'driver-failed'` and tear down every live child (#741). This
 * module runs the driver again on the SAME scope, coordination server and live children until the
 * budget or the deadline says stop. It restarts no children and replays no work: the bridge
 * backend reattaches the harness session because the execution id is bound durably per node.
 *
 * Failure classes (all conservative):
 *  - TERMINAL: Runtime's own refusals (`ValidationError`/`ConfigError`, exhausted budget, the run's
 *    own abort, a client-side transport status such as 401/404/422). Retrying re-runs a decision.
 *    Fails at once.
 *  - TRANSIENT: everything foreign (harness exit without a reason, a stream cut mid-turn, a 5xx, a
 *    socket reset, an `AbortError` that neither the run's signal nor the manager's own stop
 *    issued). A harness turn that RETURNED a failed outcome is the same accident reported as
 *    a value, so the drive raises {@link HarnessTurnFailedError} and it is classified like any other.
 *  - UNAVAILABLE: the upstream said "not now" (429, 503, 529, or the router's own codes: quota,
 *    rate limit, overload). The driver PAUSES and re-enters; a pause consumes neither `maxAttempts`
 *    nor the barren streak, so only the deadline, the budget and cancellation bound it. Measured
 *    2026-09-24 on play anomaly-referee-v3d: during the router's flash quota outage four of five
 *    lead lanes ended `driver-failed` after 12 to 13 attempts with budget and an 8-hour deadline
 *    almost untouched.
 *
 * A driver that dies INSTANTLY and repeatedly spends nothing, so the budget alone cannot bound it.
 * Progress is measured between attempts; a run of attempts that changes nothing stops at
 * `maxConsecutiveFailures` once it has outlasted the outage window below. A failure that made
 * progress resets that counter.
 *
 * WHAT COUNTS AS PROGRESS was got wrong first. Reading metered spend, settled children and an
 * accepted submission measured the filesystem and the meter, never the goal: across 1,422 settled
 * discovery-lab runs it retried the runs that produced NOTHING 629 of 827 times
 * (76.1%) and the runs that HAD left an artifact 21 of 399 times (5.3%). So when the caller
 * declares a completion check, spend and settlements alone are NOT progress while it is unmet; only
 * a delivery (an accepted submission, a child that passed the check, the contract turning met, or a
 * rise in the check's best composite) resets the barren counter. A caller that declares no check
 * reports `contract: 'none'` and keeps the historical reading.
 *
 * CONTINUATION. `budgetStop` used to be consulted only after a failure, so a driver that RETURNED
 * with the contract unmet ended the run silently (376 of 376 winning lab runs ended on this loop's
 * own `stop: 'completed'`). A completed drive whose contract is unmet is now a first-class moment:
 * the manager's `continuation` policy (`./continuation.ts`) re-enters the driver with Runtime's
 * continuation note, crossing the same budget, deadline and abort bounds. Successful
 * continuations do not consume the failure allowance. Progress paces the continuations: once
 * `continuation.maxBarren` re-entered drives in a row complete without progress, the loop PAUSES
 * before each further continuation, 5 minutes and doubling per barren drive up to 60, journals one
 * `barren-pause` row per pause for an operator alarm, and re-enters. A barren streak never ends the
 * run: the check, the deadline, the budget and cancellation do. Progress resets the streak and the
 * backoff. There is no count cap and no caller veto (the old prompt-owned loop logged 896 of 1,011
 * rounds with no progress). The barren bound
 * settled a 48-hour run `no-winner` after 14.3 hours, while its last two turns updated its pages
 * and waited on its own 2^20 prove.
 *
 * This loop decides WHETHER to re-enter, not WHERE the next drive runs: the drive harness owns
 * whether it continues the same session, environment or a replacement, and the caller composes the
 * re-entry task from it (`./reentry.ts`).
 *
 * A RE-ENTERED run is one this process resumed after an earlier process drove it. Its first drive
 * is entered as `run-reentered` with the workers that were open, and a drive counts toward
 * `maxBarren` only if it began after the root streamed a model event in this process; a root that
 * speaks and then stays barren is paced as any other. Measured 2026-10-19 on
 * magnetar-rust-20261019f: after a host reboot the root was driven with the bare original task and
 * no word of its three open workers, two barren continuations followed, and the barren bound of the
 * time settled the run `no-result-selected`.
 *
 * A TRANSIENT failure that spent nothing, settled nothing and made no progress is an infrastructure
 * outage until its streak has lasted `transientOutageMs`: within that window it consumes neither
 * `maxAttempts` nor the barren streak, like a pause. After it the failure bounds apply, so a
 * dead-on-arrival driver still stops in minutes rather than hours. The exception is a box that was
 * created and then failed its setup (Sandbox's `PartialFailureError`): it meets the same failure on
 * every re-entry, so a second identical attempt with no progress stops with `repeated-failure`
 * (`SAME_PARTIAL_FAILURE_LIMIT`). A failure that spent tokens without delivering keeps the bounds.
 * A Platform restart answered
 * `HTTP 502 ... Platform key verification unavailable` from 03:04:34 to 03:09:41Z, and the
 * coordinator's twelve attempts ran out at 03:07:12Z with no token spent.
 *
 * Every wait, a failure backoff or a pause, is jittered over its upper half so drivers that one
 * outage cut off together do not re-enter together.
 *
 * STOP-PAUSE. A run started with `driverRetry.pauseRootStops` hands its ROOT a `stopPause`;
 * no other manager gets one. It turns every stop except `completed`, `aborted` and a declared `deadline` into a wait that alarms:
 * `terminal-error`, `no-progress`, `max-attempts`, `repeated-failure`, `pending-unresolved` and
 * `budget-exhausted` each emit one record with `replacesStop` and pause 5 minutes, doubling per
 * stop-pause in a row up to 60, never past a declared deadline and not jittered. An attempt that
 * made progress resets the streak. A cancel ends the pause and settles the run; a root steer ends
 * any pause at once, a budget pause included, because a steer is how an operator changes a live
 * run. Ending a pause admits nothing by itself: the next admission reads the pool again, a pool
 * still spent pauses again with its own row, and the steer stays queued until a turn reads it.
 * After the pause the per-window counters start over and the driver is re-entered: after
 * a failure as `driver-failure` with `pausedMs`, after an admission or continuation refusal as the
 * re-entry it was about to use. Runs must not fail early: over 259 runs, 8 of the 10 stops settled runs that
 * nobody solved or stopped, including 17 roots whose harness never streamed.
 */

import { ValidationError } from '../../errors'
import type { ContinuationContext } from './continuation'
import type { DriverAttemptRecord } from './driver-attempt-evidence'
import { DriverRetryLoop, driverRetryLimits } from './driver-retry-loop'
import type { RetainedExecutionPendingError } from './retained-executor'
import { RunParkedError } from './run-parking'
import type { Scope } from './types'
import type { UnavailablePausePolicy } from './upstream-unavailable'

/** The scope's live conserved-pool readout — the retry's real bound. */
export type DriverBudgetReadout = Scope<unknown>['budget']

/** Whether the declared completion check has passed; `'none'` means the caller declared no check. */
export type DriverContractState = 'met' | 'unmet' | 'none'

/** How hard the root driver is retried after a transient failure; `enabled: false` restores pre-#741 behavior. */
export interface DriverRetryPolicy extends UnavailablePausePolicy {
  /** `false` restores the historical behavior: the first driver failure ends the run. */
  readonly enabled?: boolean
  /** Consecutive failures that changed NOTHING before the run gives up. Default 3; progress resets
   *  it; not enforced on a transient streak younger than `transientOutageMs`. */
  readonly maxConsecutiveFailures?: number
  /** Ceiling on failed invocations across this driver run, regardless of progress (default none,
   *  minimum 1). Successful continuations and transient failures inside the outage window neither
   *  consume nor reset it. */
  readonly maxAttempts?: number
  /** Backoff before the first retry, doubling per consecutive failure. Default 2000ms. */
  readonly initialBackoffMs?: number
  /** Ceiling on the doubling. Default 30000ms. */
  readonly maxBackoffMs?: number
  /** How long a streak of transient failures that spent, settled and progressed nothing is retried
   *  as an infrastructure outage before `maxAttempts` and `maxConsecutiveFailures` apply. Default
   *  900000ms (15 minutes), longer than a routine Platform restart. */
  readonly transientOutageMs?: number
  /** `true` makes the external ROOT pause where this policy would stop it (STOP-PAUSE in the
   *  header). The policy reaches every manager in the tree, but only the root reads this field, so
   *  a nested manager keeps its stops and settles `down` for its parent. Refused with
   *  `enabled: false`. Default off: leave it off when the run must return on its own. */
  readonly pauseRootStops?: boolean
}

/** The mark compared to decide whether an attempt moved the run TOWARD ITS DELIVERABLE (see the header). */
export interface DriverProgressMark {
  /** Monotone POOL spend in tokens: the driver's turns AND child settlements (deliberately not
   *  driver-only; the coarser signal can only bias toward rescuing a run). */
  readonly poolTokensSpent: number
  /** Monotone count of settled children. */
  readonly settledCount: number
  /** Whether an accepted deliverable exists — a submission that PASSED the completion check. */
  readonly submitted: boolean
  /** The completion check's verdict now; omit (or `'none'`) when the caller declares no check. */
  readonly contract?: DriverContractState
  /** Monotone count of settled children that PASSED the completion check. */
  readonly deliveredCount?: number
  /** The best composite any check read has scored; a rise is progress even if the check has not passed. */
  readonly composite?: number
}

/** Why the loop is entering the driver again (absent on the first attempt only). An `unmet-contract`
 *  re-entry carries Runtime's continuation note; a `driver-failure` re-entry carries none, since
 *  the failed drive may never have read the last one: re-enter with the ORIGINAL task and run state. */
export type DriverReentry =
  | {
      readonly reason: 'unmet-contract'
      /** The continuation note; the whole turn only on a backend that proves the same harness session. */
      readonly steer: string
      /** 1-based: which continuation this is. */
      readonly continuation: number
      /** Present when the barren streak had reached `maxBarren` and the loop paused before this
       *  re-entry: the re-entered drives in a row that delivered nothing, and the pause. */
      readonly barren?: { readonly streak: number; readonly pausedMs: number }
    }
  | {
      readonly reason: 'driver-failure'
      /** The failure that ended the previous drive, as recorded. */
      readonly failure: string
      /** 1-based: which failure retry this is. */
      readonly retry: number
      /** Present when the failure would have stopped the run and the root paused instead. */
      readonly pausedMs?: number
    }
  | {
      /** The previous turn ended with work open and Runtime woke the manager; `input` is what it waited for. */
      readonly reason: 'wake'
      /** The wake input: every event since the last turn, or the heartbeat or deadline notice. */
      readonly input: string
      /** 1-based: which wake this is. */
      readonly wake: number
    }
  | {
      /** The upstream refused the previous drive for capacity (or the check could not run); re-entered like a failure. */
      readonly reason: 'upstream-unavailable'
      /** The code or status that classified the refusal, such as `provider_quota_exhausted`. */
      readonly signal: string
      /** 1-based: which pause this is. */
      readonly pause: number
    }
  | {
      /** An earlier process drove this run and stopped without settling it; the first drive of the resuming process. */
      readonly reason: 'run-reentered'
      /** This manager's workers that were open when the previous process stopped. */
      readonly live: ReadonlyArray<string>
      /** Of `live`, the workers this process re-placed; the others are gone and their work is lost. */
      readonly replaced: ReadonlyArray<string>
    }

/** One pause before a continuation, taken because the barren streak reached `maxBarren`. */
export interface DriverBarrenPause {
  /** The completed attempt the pause follows, 1-based. */
  readonly attempt: number
  /** Re-entered drives in a row, that attempt included, that completed without progress. */
  readonly streak: number
  readonly pauseMs: number
  /** ISO 8601: when the next drive may start. */
  readonly resumeAt: string
  /** ISO 8601: when the last attempt that made progress ended, or when this loop began if none
   *  has. */
  readonly lastProgressAt: string
}

/** How a completed drive with its check unmet is re-entered; built from the manager's
 *  `ContinuationPolicy`, so no caller can veto a continuation or replace Runtime's note. */
export interface DriverContinuationPolicy {
  /** Re-entered drives in a row that may complete without progress before each further
   *  continuation waits {@link barrenPauseMs}. Minimum 1. */
  readonly maxBarren: number
  /** Epoch ms at or after which no continuation starts. Absent: no clock bounds the
   *  continuations; the check, cancellation and the budget do. */
  readonly deadlineMs?: number
  /** Write the continuation note for this re-entry. */
  readonly compose: (context: ContinuationContext) => Promise<string>
  /** True when the run is already closed (the manager's `stop`, a progress stop rule). */
  readonly closed: () => boolean
}

/** A turn that ends with work open is a wait: Runtime blocks with no model turn, then re-enters with what happened. */
interface DriverWaitPolicy {
  /** True while the manager has work it must hear back about. */
  readonly open: () => boolean
  /** Wait for the next wake of `attempt`; the wake input, or undefined when nothing is open. */
  readonly wake: (
    attempt: number,
  ) => Promise<{ readonly input: string; readonly idleMs: number } | undefined>
}

/** How an opted-in root waits where it would stop (`driverRetry.pauseRootStops`). */
export interface DriverStopPause {
  /** Resolves when a root steer is waiting, or once `signal` aborts. */
  readonly steered: (signal: AbortSignal) => Promise<void>
}

export interface DriverRetryRun {
  /** Run one attempt; rejects as the un-retried driver would. `reentry` is present on every attempt
   *  after the first and on the first of a re-entered run. */
  readonly drive: (attempt: number, reentry?: DriverReentry) => Promise<void>
  /**
   * Present for a resume: the first drive is entered with `first`. An attempt that begins while
   * `modelEvents()` is zero does not count toward `continuation.maxBarren` (it measures the
   * restart, not the root); failure bounds, deadline and budget still apply.
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
  /** The manager's own stop (an accepted result, `stop`, a stop rule). An `AbortError` is the run's
   *  own only when this or `signal` fired; any other is a lost stream and is retried. Once it fires,
   *  a stop stays a stop under `stopPause`. */
  readonly stopSignal?: AbortSignal
  /** Present for an opted-in root: the stops named in the header pause instead of ending the loop. */
  readonly stopPause?: DriverStopPause
  readonly policy?: DriverRetryPolicy
  /** How a COMPLETED drive with its check unmet is re-entered. Omit = never, which is correct
   *  only for a manager with no check. */
  readonly continuation?: DriverContinuationPolicy
  /** How a completed drive that left work open waits. Omit = a completed drive is the end. */
  readonly wait?: DriverWaitPolicy
  readonly onAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  /** Called as a barren pause begins, before the loop sleeps through it. */
  readonly onBarrenPause?: (pause: DriverBarrenPause) => void | Promise<void>
  /**
   * Abandon the unfinished retained invocation a failed drive left pending; answers whether it was.
   * Asked when it failed reconciliation with the same cause twice in a row or would otherwise end
   * the run (terraform-dc-tokens-20261006d repeated one on 20 drives over 16 minutes). Only an
   * `unobservable` or `nested-recovery` pending is offered. Omit = never.
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
  const { deadlineMs } = continuation
  if (deadlineMs !== undefined && (!Number.isFinite(deadlineMs) || deadlineMs <= 0)) {
    throw new ValidationError(
      'runDriverWithRetry: continuation.deadlineMs, when set, must be a finite positive deadline',
    )
  }
  if (!Number.isInteger(continuation.maxBarren) || continuation.maxBarren < 1) {
    throw new ValidationError('runDriverWithRetry: continuation.maxBarren must be an integer >= 1')
  }
}

/**
 * Run the driver until it completes WITH ITS CONTRACT MET, or until the budget, the deadline, an
 * abort, a terminal error, or a ceiling stops it. Transient failures are retried. A drive that
 * returns with its completion check unmet is re-entered with Runtime's continuation note until a
 * bound ends it (cancellation, the budget, or a deadline when one is set), pausing first once
 * `maxBarren` turns in a row made no progress. A failure after the run was aborted ends the loop
 * `deadline` when a deadline cut it and `aborted` otherwise, never `terminal-error`. Throws
 * `DriverAttemptsExhaustedError` (cause = the last real failure) when a FAILURE ends the loop; a
 * completed drive returns, met contract or not, because deciding what an undelivered run is worth
 * belongs to the finalizer, not to this loop. With `stopPause`, every stop but `completed`,
 * `aborted` and a declared `deadline` pauses instead (STOP-PAUSE in the header).
 */
export async function runDriverWithRetry(run: DriverRetryRun): Promise<void> {
  const limits = driverRetryLimits(run)
  assertContinuationPolicy(run.continuation)
  const loop = new DriverRetryLoop(run, limits)
  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = limits.now()
    loop.beforeModelEvent = run.reentered !== undefined && run.reentered.modelEvents() === 0
    // The completed-drive arm lives OUTSIDE this try: a configuration fault deciding the re-prompt
    // is the caller's and must not be classified as a driver failure. Nothing async separates this
    // check from dispatch; it covers re-entry after onAttempt, whose observer may exhaust resources.
    const admission = loop.admission()
    if (admission === 'refused') return
    if (admission !== undefined) {
      // An opted-in root pauses where admission would stop it, then asks again for this attempt.
      await loop.pauseAdmission(admission, attempt)
      attempt -= 1
      continue
    }
    try {
      await run.drive(attempt, loop.reentry)
    } catch (error) {
      if (error instanceof RunParkedError) throw error
      await loop.afterFailure(error, attempt, before, startedAt)
      continue
    }
    if (!(await loop.afterCompletion(attempt, before, startedAt))) return
  }
}
