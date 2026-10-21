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
 * Progress paces the continuations, and nothing else counts them. The same delivery reading that
 * resets the barren failure counter decides how soon a continued drive is re-entered: once
 * `continuation.maxBarren` re-entered drives in a row complete without progress, the loop PAUSES
 * before each further continuation, 5 minutes and doubling per barren drive up to 60, journals one
 * `barren-pause` row per pause for an operator alarm, and re-enters. A barren streak never ends the
 * run: the check, the deadline, the budget and cancellation do. Progress is a delivery or a rise
 * in the check's best composite, and it resets the streak and the backoff. There is no count cap
 * and no caller veto: the old prompt-owned loop logged 896 of 1,011 rounds with no progress, and
 * 650 recorded inputs chose seven different re-prompt counts. Measured 2026-10-21 on
 * magnetar-rust-20261021a: the barren bound settled a 48-hour run `no-winner` after 14.3 hours,
 * while its last two turns updated its pages and waited on its own 2^20 prove.
 *
 * A RE-ENTERED run is one this process resumed after an earlier process drove it, usually one
 * that stopped without settling it. Its first drive is entered as `run-reentered` with the
 * workers that were open, and a drive counts toward `maxBarren` only if it began after the root
 * streamed a model event in this process: the drive that straddles the restart never counts, and
 * a root that speaks and then stays barren is paced as any other. Measured 2026-10-19 on
 * magnetar-rust-20261019f: after a host reboot the re-entered root was first driven with the
 * bare original task and no word of its three open workers, two barren continuations followed,
 * and the barren bound of the time settled the run `no-result-selected`.
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
import { sleep } from '../util'
import type { ContinuationContext } from './continuation'
import {
  abandonablePending,
  causedByPartialFailure,
  classifyDriverFailure,
  type DriverAttemptRecord,
  type DriverAttemptStop,
  DriverAttemptsExhaustedError,
  type DriverRepromptRefusal,
  undispatchedCredentialExit,
  upstreamUnavailableSignal,
} from './driver-attempt-evidence'
import { errMessage } from './error-message'
import { RetainedExecutionPendingError, type RetainedPendingCause } from './retained-executor'
import type { Scope } from './types'
import {
  cappedDoublingMs,
  jitteredMs,
  type UnavailablePausePolicy,
  unavailablePauseMs,
  unavailableResumeAt,
} from './upstream-unavailable'

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

/** One pause before a continuation, taken because the barren streak reached `maxBarren`. */
interface DriverBarrenPause {
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

/**
 * How a completed drive with its check unmet is re-entered. Runtime builds it from the manager's
 * `ContinuationPolicy`; nothing here is a product hook, so no caller can veto a continuation or
 * replace Runtime's note.
 */
export interface DriverContinuationPolicy {
  /** Re-entered drives in a row that may complete without progress before each further
   *  continuation waits {@link barrenPauseMs}. Minimum 1. */
  readonly maxBarren: number
  /** Epoch ms at or after which no continuation starts. Absent: no clock bounds the
   *  continuations; the check, cancellation and the budget do. */
  readonly deadlineMs?: number
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

interface DriverRetryRun {
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
  /** Called as a barren pause begins, before the loop sleeps through it. */
  readonly onBarrenPause?: (pause: DriverBarrenPause) => void | Promise<void>
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

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3

const DEFAULT_MAX_ATTEMPTS = Number.POSITIVE_INFINITY

const DEFAULT_INITIAL_BACKOFF_MS = 2_000

const DEFAULT_MAX_BACKOFF_MS = 30_000

const DEFAULT_TRANSIENT_OUTAGE_MS = 900_000

const BARREN_PAUSE_FIRST_MS = 5 * 60_000

const BARREN_PAUSE_MAX_MS = 60 * 60_000

/**
 * The pause before a continuation once `streak` re-entered drives in a row have completed without
 * progress: 5 minutes at `maxBarren`, doubling per further barren drive, 60 minutes at most.
 * Derived from the streak alone, so a progress reading resets the backoff with the streak. Not
 * jittered: a barren streak is one root's, not an outage that cut many drivers off together.
 */
function barrenPauseMs(streak: number, maxBarren: number): number {
  return cappedDoublingMs(streak - maxBarren + 1, BARREN_PAUSE_FIRST_MS, BARREN_PAUSE_MAX_MS)
}

/**
 * The repeated-failure bound: attempts that each fail within {@link INSTANT_FAILURE_MS} with the
 * same error, {@link REPEATED_FAILURE_LIMIT} or more in a row over at least
 * {@link REPEATED_FAILURE_WINDOW_MS}, stop the run with `repeated-failure` whatever the rest of the
 * run is doing. The progress mark is run-wide, so while other nodes spend or settle, a driver that
 * dies on arrival reads as progressing and the barren bound never fires: on Discovery run
 * magnetar-rust-20261017c, 1,258 of 2,069 root attempts failed with 'connect ECONNREFUSED
 * 127.0.0.1:32897' between 13:20Z and 16:05Z. The window keeps a local server's restart, which
 * takes seconds, from ending a run.
 */
const INSTANT_FAILURE_MS = 30_000

const REPEATED_FAILURE_LIMIT = 10

const REPEATED_FAILURE_WINDOW_MS = 5 * 60_000

/** Consecutive identical reconciliation failures of one pending invocation that resolve it. */
const SAME_PENDING_LIMIT = 2

/**
 * Consecutive attempts that end in the same Sandbox `PartialFailureError`, with nothing gained
 * between them, that stop the loop. That error is a box that was created and then failed its
 * setup (its profile files would not materialize, it did not become ready). The retained
 * execution is bound durably to the node, so each re-entry meets the same box and the same
 * failure. Discovery run queens21-h22-capture-root-1-20261019c re-entered four such boxes 154
 * times in 37 minutes on `mkdir: cannot create directory '/work': Read-only file system`, one
 * box per root, each inside the transient-outage window that retries a failure which spent
 * nothing. A second identical attempt proves what a third would repeat; a different failure, or
 * any progress, starts the count over.
 */
const SAME_PARTIAL_FAILURE_LIMIT = 2

/** The budget's own verdict on whether another attempt may run at all. */
function budgetStop(budget: DriverBudgetReadout, atMs: number): DriverAttemptStop | undefined {
  if (budget.deadlineMs > 0 && atMs >= budget.deadlineMs) return 'deadline'
  if (budget.tokensLeft <= 0 || budget.iterationsLeft <= 0) return 'budget-exhausted'
  if (budget.usdCapped && budget.usdLeft <= 0) return 'budget-exhausted'
  // A dollar-capped pool that has seen an unknown-cost turn closes admission permanently, so a
  // retry could only reproduce the same refusal. The pool's own state proves this, independently of
  // how the refusal was thrown.
  if (budget.usdCapped && budget.usdKnown === false) return 'budget-exhausted'
  if (
    Object.values(budget.resources ?? {}).some(
      (resource) => !resource.known || resource.remaining <= 0,
    )
  )
    return 'budget-exhausted'
  return undefined
}

function contractOf(mark: DriverProgressMark): DriverContractState {
  return mark.contract ?? 'none'
}

/**
 * Did this attempt move the run toward its DELIVERABLE?
 *
 * A delivery always counts: an accepted submission, one more child that passed the check, the
 * contract turning met, or a rise in the check's best composite. Spend and settlements count only
 * while no declared check is outstanding — with a check unmet they are the burn-rate reading this
 * module's header measures and rejects.
 */
function madeProgress(before: DriverProgressMark, after: DriverProgressMark): boolean {
  if (after.submitted && !before.submitted) return true
  if ((after.deliveredCount ?? 0) > (before.deliveredCount ?? 0)) return true
  if (after.composite !== undefined && after.composite > (before.composite ?? -Infinity))
    return true
  if (contractOf(before) !== 'met' && contractOf(after) === 'met') return true
  if (contractOf(after) === 'unmet') return false
  return after.poolTokensSpent > before.poolTokensSpent || after.settledCount > before.settledCount
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  await sleep(ms, signal, false)
}

/**
 * Run the driver until it completes WITH ITS CONTRACT MET, or until the budget, the deadline, an
 * abort, a terminal error, or a ceiling stops it. Transient failures are retried. A drive that
 * returns with its completion check unmet is re-entered with Runtime's continuation note until a
 * bound ends it (cancellation, the budget, or a deadline when one is set), pausing first once
 * `maxBarren` turns in a row made no progress. Throws
 * `DriverAttemptsExhaustedError` (cause = the last real failure) when a FAILURE ends the loop; a
 * completed drive returns, met contract or not, because deciding what an undelivered run is worth
 * belongs to the finalizer, not to this loop.
 */
export async function runDriverWithRetry(run: DriverRetryRun): Promise<void> {
  const now = run.now ?? Date.now
  const sleep = run.sleep ?? defaultSleep
  const random = run.random ?? Math.random
  const policy = run.policy ?? {}
  const retryEnabled = policy.enabled !== false
  const maxConsecutive = Math.max(
    0,
    policy.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES,
  )
  const maxAttempts = Math.max(1, policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const initialBackoff = Math.max(0, policy.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS)
  const maxBackoff = Math.max(initialBackoff, policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS)
  const transientOutage = Math.max(0, policy.transientOutageMs ?? DEFAULT_TRANSIENT_OUTAGE_MS)

  const continuation = run.continuation
  if (continuation !== undefined) {
    if (
      continuation.deadlineMs !== undefined &&
      (!Number.isFinite(continuation.deadlineMs) || continuation.deadlineMs <= 0)
    ) {
      throw new ValidationError(
        'runDriverWithRetry: continuation.deadlineMs, when set, must be a finite positive deadline',
      )
    }
    if (!Number.isInteger(continuation.maxBarren) || continuation.maxBarren < 1) {
      throw new ValidationError(
        'runDriverWithRetry: continuation.maxBarren must be an integer >= 1',
      )
    }
  }
  const attempts: DriverAttemptRecord[] = []
  let consecutiveBarren = 0
  // Re-entered drives, in a row, that completed without a delivery. Reset by any progress, on a
  // failed drive as well as a completed one; never by a completion alone.
  let barrenReentries = 0
  let failures = 0
  // Failures charged against `maxAttempts`: every failure except a transient one inside an outage.
  let chargedFailures = 0
  // When the current streak of transient failures in which nothing ran began. Cleared by any
  // attempt that did work, failed or completed.
  let outageSince: number | undefined
  // Consecutive `unavailable` attempts, for the pause doubling only. Any other outcome, or an
  // unavailable attempt that still made progress, resets it: the upstream served in between.
  let consecutivePauses = 0
  // Consecutive failures that left the same unfinished retained invocation pending for the same
  // reason, and the abandonments since the last progress or completed drive.
  let samePending: { readonly cause: RetainedPendingCause; readonly count: number } | undefined
  // The current streak of instant failures with one error, and when its first one failed.
  let sameFailure:
    | { readonly error: string; readonly count: number; readonly since: number }
    | undefined
  // The current streak of identical `PartialFailureError` attempts that gained nothing.
  let samePartial: { readonly error: string; readonly count: number } | undefined
  let abandonments = 0
  // Every pause this loop took, for the re-entry it names.
  let pauses = 0
  let continuations = 0
  let wakes = 0
  let reentry: DriverReentry | undefined = run.reentered?.first
  // Whether the current attempt began before the re-entered root's first model event.
  let beforeModelEvent = false
  // When the last attempt that made progress ended, for the barren-pause record.
  let lastProgressAt = now()

  const emit = async (record: DriverAttemptRecord): Promise<void> => {
    const entered = reentry === undefined ? {} : { reentry: reentry.reason }
    const stamped = {
      ...record,
      ...entered,
      ...(beforeModelEvent ? { beforeModelEvent: true as const } : {}),
    }
    attempts.push(stamped)
    await run.onAttempt?.(stamped)
  }

  /**
   * Decide what a completed drive with its check unmet does next. Every bound the FAILURE path
   * applies is applied here too — that is the fix for `budgetStop` having lived only in the catch
   * arm — and they are read again after the note is composed, because composing may run the
   * question panel.
   */
  const decideContinuation = async (
    policy: DriverContinuationPolicy,
    attempt: number,
    after: DriverProgressMark,
  ): Promise<
    | { steer: string; barren?: { streak: number; pausedMs: number } }
    | { refusedBy: DriverRepromptRefusal }
  > => {
    const bounds = (): DriverRepromptRefusal | undefined => {
      if (policy.closed()) return 'closed'
      if (run.signal.aborted) return 'aborted'
      if (policy.deadlineMs !== undefined && now() >= policy.deadlineMs) return 'deadline'
      const byBudget = budgetStop(run.budget(), now())
      return byBudget === 'deadline' || byBudget === 'budget-exhausted' ? byBudget : undefined
    }
    const before = bounds()
    if (before !== undefined) return { refusedBy: before }
    // A barren streak paces the run and never ends it. The pause holds no longer than the
    // earlier deadline, and the bounds are read again when it ends.
    let barren: { streak: number; pausedMs: number } | undefined
    if (barrenReentries >= policy.maxBarren) {
      const pausedAt = now()
      const budgetDeadline = run.budget().deadlineMs
      const until = Math.min(
        policy.deadlineMs ?? Number.POSITIVE_INFINITY,
        budgetDeadline > 0 ? budgetDeadline : Number.POSITIVE_INFINITY,
      )
      const pauseMs = Math.max(
        0,
        Math.min(barrenPauseMs(barrenReentries, policy.maxBarren), until - pausedAt),
      )
      await run.onBarrenPause?.({
        attempt,
        streak: barrenReentries,
        pauseMs,
        resumeAt: new Date(pausedAt + pauseMs).toISOString(),
        lastProgressAt: new Date(lastProgressAt).toISOString(),
      })
      await sleep(pauseMs, run.signal)
      barren = { streak: barrenReentries, pausedMs: pauseMs }
      const afterPause = bounds()
      if (afterPause !== undefined) return { refusedBy: afterPause }
    }
    const steer = (
      await policy.compose({
        attempt,
        continuations,
        progress: after,
        budget: run.budget(),
        barrenReentries,
        signal: run.signal,
      })
    ).trim()
    const afterCompose = bounds()
    if (afterCompose !== undefined) return { refusedBy: afterCompose }
    if (steer.length === 0) {
      throw new ValidationError('runDriverWithRetry: the continuation note is empty')
    }
    return barren === undefined ? { steer } : { steer, barren }
  }

  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = now()
    beforeModelEvent = run.reentered !== undefined && run.reentered.modelEvents() === 0
    // The completed-drive arm lives OUTSIDE this try. A configuration fault raised while deciding
    // the re-prompt is the caller's, not the driver's, and must reach the caller unwrapped instead
    // of being classified as one more driver failure.
    // No asynchronous work separates this check from dispatch. It covers first entry and
    // re-entry after onAttempt, whose awaited observer may exhaust authority or resources.
    const admissionStop = run.signal.aborted ? 'aborted' : budgetStop(run.budget(), now())
    if (admissionStop !== undefined) {
      // A completed-but-unmet invocation remains completed; its finalizer owns acceptance.
      if (attempts.length > 0) return
      throw new DriverAttemptsExhaustedError(
        run.signal.aborted
          ? run.signal.reason
          : new ValidationError(`driver admission: ${admissionStop}`),
        attempts,
        admissionStop,
      )
    }
    try {
      await run.drive(attempt, reentry)
    } catch (error) {
      const durationMs = now() - startedAt
      const classification = classifyDriverFailure(error, run.signal)
      const after = run.progress()
      const progressed = madeProgress(before, after)
      if (progressed) {
        abandonments = 0
        lastProgressAt = now()
      }
      const retainedFailure = error instanceof RetainedExecutionPendingError ? error : undefined
      const pending = abandonablePending(error)
      const failureRecord = () => ({
        attempt,
        durationMs,
        error: errMessage(error),
        classification,
        madeProgress: progressed,
      })
      const throwIfRetryBoundsReached = () => {
        if (run.signal.aborted) {
          throw new DriverAttemptsExhaustedError(error, attempts, 'aborted')
        }
        const afterWait = budgetStop(run.budget(), now())
        if (afterWait) {
          throw new DriverAttemptsExhaustedError(error, attempts, afterWait)
        }
      }
      samePending =
        pending === undefined || classification !== 'transient'
          ? undefined
          : {
              cause: pending.pendingCause,
              count: samePending?.cause === pending.pendingCause ? samePending.count + 1 : 1,
            }
      if (classification === 'unavailable') {
        // A pause, not a failure: neither `failures` nor the barren streak moves, so an outage of
        // any length ends the run only at the deadline, the budget, or a cancellation.
        if (progressed) barrenReentries = 0
        const stop = ((): DriverAttemptStop | undefined => {
          if (!retryEnabled) return 'retry-disabled'
          if (run.signal.aborted) return 'aborted'
          return budgetStop(run.budget(), now())
        })()
        const unavailableSignal = upstreamUnavailableSignal(error) ?? 'unavailable'
        if (stop !== undefined) {
          await emit({
            ...failureRecord(),
            unavailableSignal,
            stop,
          })
          throw new DriverAttemptsExhaustedError(error, attempts, stop)
        }
        pauses += 1
        consecutivePauses = progressed ? 1 : consecutivePauses + 1
        // A refusal that names its reset holds until then, never past the run's deadline: probing a
        // 5-hour plan window every 300 s spent 219 of magnetar-rust-20261018b's 324 attempts.
        const pausedAt = now()
        const resetAt = unavailableResumeAt(errMessage(error), pausedAt)
        const deadlineMs = run.budget().deadlineMs
        const pause =
          resetAt === undefined
            ? jitteredMs(unavailablePauseMs(consecutivePauses, policy), random)
            : Math.max(1_000, Math.min(resetAt, deadlineMs > 0 ? deadlineMs : resetAt) - pausedAt)
        const exitCode = undispatchedCredentialExit(error)
        const resumeAt = resetAt ?? (exitCode === undefined ? undefined : pausedAt + pause)
        await emit({
          ...failureRecord(),
          unavailableSignal,
          ...(exitCode === undefined ? {} : { exitCode }),
          retryInMs: pause,
          ...(resumeAt === undefined ? {} : { resumeAt: new Date(resumeAt).toISOString() }),
        })
        // The same rule as a failure retry: re-enter with the ORIGINAL task and the run's state,
        // because the refused turn may have ended before it read a re-prompt.
        reentry = { reason: 'upstream-unavailable', signal: unavailableSignal, pause: pauses }
        await sleep(pause, run.signal)
        // Waiting for capacity is not transient outage time. A transient streak that began before
        // the refusal keeps its own age, so a capacity outage longer than `transientOutageMs`
        // cannot end the run on the next transient failure. Measured 2026-10-07 on Discovery run
        // terraform-dc-tokens-20261006d: its root waited out capacity refusals for 16 minutes.
        if (outageSince !== undefined) outageSince += now() - startedAt
        throwIfRetryBoundsReached()
        continue
      }
      consecutivePauses = 0
      failures += 1
      const failedAt = now()
      const idle =
        classification === 'transient' &&
        !progressed &&
        after.poolTokensSpent === before.poolTokensSpent &&
        after.settledCount === before.settledCount
      if (!idle) outageSince = undefined
      else outageSince ??= failedAt
      // A transient streak in which nothing ran is an outage while it is young: it is retried like
      // a pause, and the failure bounds apply only once it outlasts `transientOutageMs`.
      const inOutage = idle && failedAt - (outageSince ?? failedAt) < transientOutage
      if (!inOutage) chargedFailures += 1
      const failure = errMessage(error)
      sameFailure =
        durationMs >= INSTANT_FAILURE_MS
          ? undefined
          : sameFailure?.error === failure
            ? { error: failure, count: sameFailure.count + 1, since: sameFailure.since }
            : { error: failure, count: 1, since: failedAt }
      const repeated =
        sameFailure !== undefined &&
        sameFailure.count >= REPEATED_FAILURE_LIMIT &&
        failedAt - sameFailure.since >= REPEATED_FAILURE_WINDOW_MS
      samePartial =
        classification === 'transient' &&
        !progressed &&
        pending === undefined &&
        causedByPartialFailure(error)
          ? {
              error: failure,
              count: samePartial?.error === failure ? samePartial.count + 1 : 1,
            }
          : undefined
      const stop = ((): DriverAttemptStop | undefined => {
        // An aborted run failed because it was stopped. `classifyDriverFailure` calls every
        // failure after an abort terminal (do not retry); reading that first labelled 61 of 62
        // `terminal-error` runs measured 2026-10-21, each one a deadline cut mid-turn. An abort at
        // or after the budget deadline is the deadline; any other is a cancellation.
        if (run.signal.aborted) {
          return budgetStop(run.budget(), failedAt) === 'deadline' ? 'deadline' : 'aborted'
        }
        if (classification === 'terminal') return 'terminal-error'
        if (!retryEnabled) return 'retry-disabled'
        const byBudget = budgetStop(run.budget(), failedAt)
        if (byBudget) return byBudget
        // The same failed box twice with nothing gained: the outage window below would retry it
        // for fifteen minutes, because the attempt spent nothing.
        if (samePartial !== undefined && samePartial.count >= SAME_PARTIAL_FAILURE_LIMIT) {
          return 'repeated-failure'
        }
        if (inOutage) return undefined
        if (chargedFailures >= maxAttempts) return 'max-attempts'
        // Progress resets the barren counter: a driver that is doing real work between crashes
        // has earned another attempt, and the budget remains the bound on how many. Progress is
        // read run-wide, so an attempt that dies on arrival with the same error is bounded here.
        if (progressed) return repeated ? 'repeated-failure' : undefined
        return consecutiveBarren + 1 >= maxConsecutive ? 'no-progress' : undefined
      })()
      // A pending invocation that failed reconciliation the same way twice, or that would now
      // end the run, is resolved instead of retried: the owner abandons it, recording what the
      // provider confirmed, and the next drive starts a new invocation. The new invocation's
      // failures start a new streak. Abandonments in a row without progress are bounded like
      // failures, so a provider that loses every execution still ends the run.
      let abandoned = false
      if (
        pending !== undefined &&
        samePending !== undefined &&
        run.resolvePending !== undefined &&
        retryEnabled &&
        !run.signal.aborted &&
        abandonments < maxConsecutive &&
        (stop === 'no-progress' || (stop === undefined && samePending.count >= SAME_PENDING_LIMIT))
      ) {
        abandoned = await run.resolvePending(pending, samePending.count)
        if (abandoned) {
          abandonments += 1
          samePending = undefined
          consecutiveBarren = 0
          outageSince = undefined
        }
      }
      // A pending invocation that would be abandoned again, after the run already spent its
      // abandonments without progress, is not retried until the outage window or the barren bound
      // ends it: each replacement failed reconciliation the same way, so the next one would too.
      // Discovery run terraform-dc-build-20261009g-fork (2026-10-09) re-entered one stopped
      // sandbox 52 times over 26 minutes this way, and settled an untyped `no-progress`. The stop
      // names the pending cause so the owner reconciles the execution before re-driving the run.
      const unresolved =
        !abandoned &&
        !progressed &&
        pending !== undefined &&
        samePending !== undefined &&
        run.resolvePending !== undefined &&
        abandonments >= maxConsecutive &&
        samePending.count >= SAME_PENDING_LIMIT &&
        (stop === undefined || stop === 'no-progress')
      const retryStop = abandoned ? undefined : unresolved ? 'pending-unresolved' : stop

      if (progressed) barrenReentries = 0
      if (retryStop !== undefined) {
        await emit({
          ...failureRecord(),
          stop: retryStop,
          ...(retainedFailure === undefined ? {} : { pendingCause: retainedFailure.pendingCause }),
        })
        throw new DriverAttemptsExhaustedError(error, attempts, retryStop)
      }

      if (!abandoned) consecutiveBarren = progressed ? 0 : consecutiveBarren + 1
      const backoff = jitteredMs(
        cappedDoublingMs(consecutiveBarren, initialBackoff, maxBackoff),
        random,
      )
      await emit({
        ...failureRecord(),
        ...(abandoned ? { abandoned: true } : {}),
        retryInMs: backoff,
      })
      // A retry re-enters with the ORIGINAL task. The drive that just failed may have died before
      // it read the re-prompt at all, so replaying the unmet-items text in its place would drop
      // the run's actual instruction. The failure itself travels, so the caller can say why.
      reentry = { reason: 'driver-failure', failure: errMessage(error), retry: failures }
      await sleep(backoff, run.signal)
      // The wait is where an abort or a deadline most often lands; re-ask before re-entering.
      throwIfRetryBoundsReached()
      continue
    }

    // A completed invocation ends the transport-failure streak, even while the pursuit's
    // independent completion check remains unmet. Successful continuation is not a failure. The
    // barren re-entry count is a different fact and a completion alone never resets it.
    consecutiveBarren = 0
    consecutivePauses = 0
    outageSince = undefined
    samePending = undefined
    sameFailure = undefined
    samePartial = undefined
    abandonments = 0
    const durationMs = now() - startedAt
    const after = run.progress()
    const progressed = madeProgress(before, after)
    const contract = contractOf(after)
    const contractField = contract === 'none' ? {} : { contract }
    if (progressed) {
      barrenReentries = 0
      lastProgressAt = now()
    } else if (
      !beforeModelEvent &&
      reentry !== undefined &&
      reentry.reason !== 'wake' &&
      contract === 'unmet'
    ) {
      barrenReentries += 1
    }
    // A turn that ends with work open is a wait. The bounds the failure path applies hold here
    // too; a closed run (accepted, stopped, blocked) never waits.
    const wait = run.wait
    if (
      wait !== undefined &&
      contract !== 'met' &&
      !(continuation?.closed() ?? false) &&
      !run.signal.aborted &&
      budgetStop(run.budget(), now()) === undefined &&
      wait.open()
    ) {
      const woken = await wait.wake(attempt + 1)
      if (woken !== undefined && !run.signal.aborted) {
        wakes += 1
        await emit({
          attempt,
          durationMs,
          madeProgress: progressed,
          ...contractField,
          waitedMs: woken.idleMs,
          retryInMs: 0,
        })
        reentry = { reason: 'wake', input: woken.input, wake: wakes }
        continue
      }
    }
    if (contract === 'unmet' && continuation !== undefined) {
      const decision = await decideContinuation(continuation, attempt, after)
      if ('steer' in decision) {
        continuations += 1
        // No failure backoff: the driver is not failing, it finished early. A barren pause, when
        // the streak called for one, was taken before the note was composed.
        await emit({
          attempt,
          durationMs,
          madeProgress: progressed,
          ...contractField,
          reprompted: true,
          retryInMs: 0,
          ...(decision.barren === undefined ? {} : { barrenPauseMs: decision.barren.pausedMs }),
        })
        reentry = {
          reason: 'unmet-contract',
          steer: decision.steer,
          continuation: continuations,
          ...(decision.barren === undefined ? {} : { barren: decision.barren }),
        }
        continue
      }
      await emit({
        attempt,
        durationMs,
        madeProgress: progressed,
        ...contractField,
        repromptRefusedBy: decision.refusedBy,
        stop: 'completed',
      })
      return
    }
    await emit({
      attempt,
      durationMs,
      madeProgress: progressed,
      ...contractField,
      stop: 'completed',
    })
    return
  }
}
