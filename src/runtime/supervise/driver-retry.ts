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
 * that changes nothing stops at `maxConsecutiveFailures`. A failure that made progress resets that
 * counter: a long run may be rescued many times, a hopeless one gives up in seconds.
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
 * the manager's `continuation` policy (`./continuation.ts`) re-enters the driver with Runtime's
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
 * A THIRD CLASS sits between the two: the upstream said "not now". A model provider's exhausted
 * quota, a rate limit, or an overloaded service (HTTP 429, 503, 529, or the router's own codes for
 * them) is not an accident in the driver and not a decision by Runtime; the same request succeeds
 * when capacity returns. Such a failure PAUSES the driver and re-enters it. A pause consumes neither
 * `maxAttempts` nor the barren streak, so only the deadline, the budget, and cancellation bound it.
 * Measured 2026-09-24 on play anomaly-referee-v3d: during the router's flash quota outage four of
 * five lead lanes ended `driver-failed` between minutes 101 and 118, after 12 to 13 attempts, while
 * the router answered some turns in between (one lead spent 1.7M and 3.3M input tokens on two of
 * them) and each run's budget and 8-hour deadline were almost untouched.
 */

import {
  AgentEvalError,
  BackendTransportError,
  ConfigError,
  RuntimeRunStateError,
  ValidationError,
} from '../../errors'
import { sleep } from '../util'
import {
  CheckUnavailableError,
  type ContinuationContext,
  type ContinuationEntry,
} from './continuation'
import { errMessage, errorHttpStatus, errorProperty, errorText } from './error-message'
import type { Scope } from './types'
import {
  UNAVAILABLE_CODES,
  UNAVAILABLE_STATUSES,
  type UnavailablePausePolicy,
  unavailablePauseMs,
  unavailableSignalInText,
  unavailableSignalOfFailure,
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
   *  before the run gives up. Default 3. A failure that made progress resets the count. */
  readonly maxConsecutiveFailures?: number
  /** Ceiling on failed invocations across this driver run, regardless of progress. Default 8,
   *  minimum 1. Successful continuations do not consume this allowance or reset it.
   *  This bounds repeated crashes that each make enough progress to reset the barren streak. */
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
  readonly classification?: DriverFailureClass
  /** Did anything change since the previous attempt (spend, settlement, submission)? */
  readonly madeProgress: boolean
  /** Set when this attempt ended the loop. */
  readonly stop?: DriverAttemptStop
  /** Set when another attempt follows. For an `unavailable` attempt this is the pause, which is
   *  infrastructure time: together with `durationMs` it is what the outage cost this driver. */
  readonly retryInMs?: number
  /** How this attempt was entered. Absent on the first attempt. */
  readonly reentry?: DriverReentry['reason']
  /** For an `unavailable` attempt: the code or HTTP status that classified it, such as
   *  `provider_quota_exhausted` or `http-429`. */
  readonly unavailableSignal?: string
  /** The completion check's verdict after this attempt. Absent when the caller declares none. */
  readonly contract?: DriverContractState
  /** True when this COMPLETED attempt's unmet contract sent the loop back with a continuation. */
  readonly reprompted?: boolean
  /** Why an unmet contract did NOT re-enter the session. Absent when the contract was met, when
   *  the manager has no continuation policy, or when the continuation was sent. */
  readonly repromptRefusedBy?: DriverRepromptRefusal
}

/** Why a completed drive with an unmet contract was not re-entered. `no-progress` means
 *  `continuation.maxBarren` consecutive re-entered drives completed without progress. `closed`
 *  means the run was already closed: a failed `report_blocked` probe or a progress stop rule. */
export type DriverRepromptRefusal =
  | 'closed'
  | Extract<
      DriverAttemptStop,
      'aborted' | 'budget-exhausted' | 'deadline' | 'max-attempts' | 'no-progress'
    >

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
      /** The upstream refused the previous drive for capacity, or the check could not run, and the
       *  loop paused before this one. Re-entered like a failure, with the original task and the
       *  run's state. */
      readonly reason: 'upstream-unavailable'
      /** The code or status that classified the refusal, such as `provider_quota_exhausted`. */
      readonly signal: string
      /** 1-based: which pause this is. */
      readonly pause: number
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
  /** True when the run is already closed (a failed `report_blocked` probe, a progress stop rule):
   *  a continuation would re-enter a session told to stop. */
  readonly closed: () => boolean
}

export interface DriverRetryRun {
  /** Run one attempt. Rejects exactly as the un-retried driver would. `reentry` is present on
   *  every attempt after the first; see {@link DriverReentry}. */
  readonly drive: (attempt: number, reentry?: DriverReentry) => Promise<void>
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
  readonly onAttempt?: (record: DriverAttemptRecord) => void | Promise<void>
  readonly now?: () => number
  readonly sleep?: (ms: number, signal: AbortSignal) => Promise<void>
}

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_ATTEMPTS = 8
const DEFAULT_INITIAL_BACKOFF_MS = 2_000
const DEFAULT_MAX_BACKOFF_MS = 30_000
/**
 * Bridge error classes the bridge itself never retries: a request that fails identically on
 * every attempt, mapped below 5xx on its HTTP path (`parse_error` 400, the other two 501). On the
 * stream path the same failure arrives with no status at all — a profile that cannot materialize
 * is a `parse_error` — and the status split alone read it as a bad moment and re-drove it to the
 * attempt ceiling.
 */
const DETERMINISTIC_BRIDGE_CODES: ReadonlySet<string> = new Set([
  'parse_error',
  'not_configured',
  'capability_denied',
])

/**
 * A driver's harness turn ran to its terminal result, and that result reported failure.
 *
 * A provider executor reports a failed turn as a returned outcome, not a thrown error, so without
 * this error a failed turn reads as a completed drive and never reaches the retry decision.
 * Measured 2026-09-17 on a Discovery director placed on tangle-sandbox with the opencode harness:
 * a 53-minute turn ended `status code 524`, and another ended `Invalid API key` after a platform
 * key expired mid-turn. A new turn succeeds in both cases.
 *
 * `errorCode` is the provider's machine code when it reported one. The classifier reads the code
 * and never the text, because the text is written for people and changes without notice.
 */
export class HarnessTurnFailedError extends Error {
  readonly runtime: string
  readonly errorCode?: string

  constructor(runtime: string, failure: { readonly error: string; readonly errorCode?: string }) {
    super(
      `${runtime} harness turn ended with a failed outcome` +
        (failure.errorCode === undefined ? '' : ` (${failure.errorCode})`) +
        `: ${failure.error}`,
    )
    this.name = 'HarnessTurnFailedError'
    this.runtime = runtime
    if (failure.errorCode !== undefined) this.errorCode = failure.errorCode
  }
}

/**
 * How one driver failure is answered.
 *
 *  - `terminal`: Runtime's own refusal, or a request that fails identically forever. The run ends.
 *  - `transient`: a foreign accident. It is retried under `maxAttempts` and the barren streak.
 *  - `unavailable`: the upstream cannot serve now (quota, rate limit, overload, or the router's
 *    own provider credential refused). The driver pauses and re-enters, and only the deadline, the
 *    budget, and cancellation bound the pauses.
 */
export type DriverFailureClass = 'transient' | 'terminal' | 'unavailable'

/**
 * The code or status that marks `error` as an upstream capacity refusal, or `undefined`.
 *
 * A structured field is read first: a turn outcome's `errorCode`, a transport error's
 * `upstreamCode` and `status`, a provider SDK error's `status`. The failure text is read only when
 * no structured field decided, because a harness CLI reports the router's refusal as text.
 */
export function upstreamUnavailableSignal(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  // The check could not run. It is not a verdict on the director, so the loop pauses as it does
  // for an upstream out of capacity and never counts the turn for or against the run.
  if (error instanceof CheckUnavailableError) return 'check-unavailable'
  if (error instanceof HarnessTurnFailedError) {
    return unavailableSignalOfFailure({
      error: error.message,
      ...(error.errorCode === undefined ? {} : { errorCode: error.errorCode }),
    })
  }
  if (error instanceof BackendTransportError) {
    const code = error.upstreamCode?.toLowerCase()
    if (code !== undefined && UNAVAILABLE_CODES.has(code)) return code
    if (error.status !== undefined) {
      return UNAVAILABLE_STATUSES.has(error.status) ? `http-${error.status}` : undefined
    }
    return unavailableSignalInText(errorProperty(error, 'message') ?? '')
  }
  if (error instanceof AgentEvalError) return undefined
  const status = errorHttpStatus(error)
  if (status !== undefined) {
    return UNAVAILABLE_STATUSES.has(status) ? `http-${status}` : undefined
  }
  return unavailableSignalInText(errorProperty(error, 'message') ?? '')
}

/** True when the upstream refused for capacity and the same request will succeed later. */
function isUpstreamUnavailable(error: unknown): boolean {
  return upstreamUnavailableSignal(error) !== undefined
}

/**
 * Classify one driver failure. Runtime's own typed refusals are decisions and stay terminal; an
 * upstream capacity refusal is `unavailable`; anything else foreign is an accident and is
 * retryable. A `BackendTransportError` is split by status because the taxonomy already promises
 * consumers may branch on it: a 5xx/408 is the upstream having a bad moment, a 429/503/529 is the
 * upstream out of capacity, and a 401/404/422 is a request that will fail identically forever. The
 * bridge's own never-retry classes are terminal whether or not a status rides with them.
 */
export function classifyDriverFailure(error: unknown, signal?: AbortSignal): DriverFailureClass {
  if (signal?.aborted) return 'terminal'
  if (error instanceof Error && errorProperty(error, 'name') === 'AbortError') return 'terminal'
  if (error instanceof HarnessTurnFailedError) {
    // The same never-retry classes a bridge refusal carries, now arriving as a turn's outcome.
    // Without a code the failure is foreign: an upstream timeout, a cut stream, an expired key.
    if (error.errorCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.errorCode)) {
      return 'terminal'
    }
    return isUpstreamUnavailable(error) ? 'unavailable' : 'transient'
  }
  if (error instanceof BackendTransportError) {
    if (error.upstreamCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.upstreamCode))
      return 'terminal'
    if (isUpstreamUnavailable(error)) return 'unavailable'
    const status = error.status
    if (status === undefined) return 'transient'
    if (status === 408 || status >= 500) return 'transient'
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
  if (isUpstreamUnavailable(error)) return 'unavailable'
  return foreignHttpStatusVerdict(error) ?? 'transient'
}

/**
 * A foreign error that still carries an HTTP status is a refusal we can read.
 *
 * A provider SDK throws its own error classes, so an environment `create` that the platform
 * refused arrives here as neither a `BackendTransportError` nor an `AgentEvalError`, and the
 * default sends it to `transient`. Measured 2026-09-16: a Tangle Sandbox create refused
 * `HTTP 400 {"code":"CONFIG_ERROR"}` for a key whose budget was fully reserved retried 14-22
 * times per node while the run showed a durable intent and no other event, so eleven of twelve
 * roots sat for 25 minutes with nothing to diagnose. The status was on the error the whole time.
 *
 * Reading it applies the same rule the transport branch already promises consumers: 408 and 5xx
 * are the upstream having a bad moment, and any other 4xx is a request that will fail identically
 * forever. The capacity statuses were answered before this point. Anything without a plain numeric
 * status keeps the historical default.
 */
function foreignHttpStatusVerdict(error: unknown): 'transient' | 'terminal' | undefined {
  // Only a thrown Error is read. `status` is a common field name on ordinary objects — a
  // settlement, a run state, a provider-model record — and treating one of those as an HTTP
  // refusal would silently stop retries that have nothing to do with a rejected request.
  // `errorHttpStatus` is the same reader the persisted message uses, so a failure is classified
  // from exactly the status an operator will see quoted back to them.
  if (!(error instanceof Error)) return undefined
  const status = errorHttpStatus(error)
  if (status === undefined || status < 400) return undefined
  if (status === 408 || status >= 500) return 'transient'
  return 'terminal'
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

/** The error a give-up throws: the original cause, re-described with the attempt history so
 *  `driver-failed` carries a diagnosable message instead of one backend's last words. */
export class DriverAttemptsExhaustedError extends RuntimeRunStateError {
  readonly attempts: readonly DriverAttemptRecord[]
  readonly stop: DriverAttemptStop

  constructor(cause: unknown, attempts: readonly DriverAttemptRecord[], stop: DriverAttemptStop) {
    const last = attempts[attempts.length - 1]
    const causeText =
      cause instanceof Error
        ? `${errorProperty(cause, 'name')}: ${errMessage(cause)}`
        : errMessage(cause)
    const firstFailure = attempts.find((attempt) => attempt.error !== undefined)?.error
    const pauses = attempts.filter((attempt) => attempt.classification === 'unavailable')
    const pausedMs = pauses.reduce((sum, attempt) => sum + (attempt.retryInMs ?? 0), 0)
    super(
      `supervisor driver failed after ${attempts.length} attempt(s) — stopped by ${stop}; ` +
        (pauses.length === 0
          ? ''
          : `${pauses.length} attempt(s) met an unavailable upstream and paused ` +
            `${Math.round(pausedMs / 1000)} s in total; `) +
        (firstFailure !== undefined && firstFailure !== last?.error
          ? `first failure: ${errorText(firstFailure)}; `
          : '') +
        `last cause: ${causeText}` +
        (last?.classification ? ` (classified ${last.classification})` : ''),
      { cause },
    )
    this.attempts = Object.freeze([...attempts])
    this.stop = stop
  }
}

/**
 * What one driver loop did, counted from its attempt records: the numbers a run's settle record
 * carries so a reader can tell genuine continuations from failure retries without the journal.
 *
 * Measured motive: the most genuine continuations in any recorded lab run was 11
 * (evidence-compiler-j, which won), while the two larger counts, 32 and 12, were re-entries after
 * failed turns. One `attempts` number hid which was which.
 */
export interface DriverLoopRecord {
  /** Driver invocations started. */
  readonly attempts: number
  /** Genuine continuations: completed drives with the contract unmet that were re-entered. */
  readonly reprompts: number
  /** Re-entries after a failed drive. A pause on an unavailable upstream is not one. */
  readonly failureRetries: number
  /** Re-entries after the upstream refused a drive for capacity. Each is a pause, not a failure. */
  readonly unavailablePauses: number
  /** Infrastructure time the unavailable upstream cost this loop: every pause, plus every refused
   *  drive that made no progress. A refused drive that made progress was mostly work, so only its
   *  pause counts. Measured 2026-09-24 on a real run: a first drive worked 8 minutes before its
   *  refusal, and counting its whole duration doubled a 10-minute outage to 16 minutes. */
  readonly unavailableMs: number
  /** Re-entered drives, in a row at the end, that completed without a delivery. */
  readonly barrenReentries: number
  /** Why the loop ended: its last record's stop, or `unrecorded` when it ended without one (an
   *  admission refusal before the first attempt, or a throw from outside the loop). */
  readonly ended: DriverAttemptStop | 'unrecorded'
  /** Why a completed-but-unmet drive was not re-entered, when that ended the loop. */
  readonly repromptRefusedBy?: DriverRepromptRefusal
}

/** A manager's driver loop as its run's settle record carries it (`SupervisedResult.continuation`). */
export interface DriverContinuationRecord extends DriverLoopRecord {
  /** Re-entries that ran in a new environment because the provider no longer held the old one. */
  readonly environmentReplacements: number
  /** Of those, the ones whose new environment was created from the lost one's latest checkpoint.
   *  The journal's `workspace-restored` receipts say whether each restore was verified. */
  readonly workspaceRestores: number
  /** How the run was closed, when something closed it: an accepted `submit_result`, the
   *  manager's own `stop` (served only to a manager with no check), a `report_blocked` whose
   *  probe failed, or the caller's progress `stopRule`. Absent when the loop ended on a bound or a
   *  failure. */
  readonly closedBy?: 'result-accepted' | 'stop' | 'blocked' | 'stop-rule'
  /** The reason the manager gave, or the failed probe, verbatim. */
  readonly stopReason?: string
  /** Every continuation note this manager was sent, with the check's verdict before and after it.
   *  Empty for a manager with no check. */
  readonly continuations: ReadonlyArray<ContinuationEntry>
}

/** Count a loop's attempt records into its {@link DriverLoopRecord}. */
export function summarizeDriverAttempts(
  records: ReadonlyArray<DriverAttemptRecord>,
): DriverLoopRecord {
  let barren = 0
  for (const record of records) {
    if (record.madeProgress) barren = 0
    else if (
      record.error === undefined &&
      record.reentry !== undefined &&
      record.contract === 'unmet'
    )
      barren += 1
  }
  const last = records.at(-1)
  const refused = records.filter((record) => record.classification === 'unavailable')
  return {
    attempts: records.length,
    reprompts: records.filter((record) => record.reprompted === true).length,
    failureRetries: records.filter(
      (record) =>
        record.error !== undefined &&
        record.retryInMs !== undefined &&
        record.classification !== 'unavailable',
    ).length,
    unavailablePauses: refused.filter((record) => record.retryInMs !== undefined).length,
    unavailableMs: refused.reduce(
      (sum, record) =>
        sum + (record.madeProgress ? 0 : record.durationMs) + (record.retryInMs ?? 0),
      0,
    ),
    barrenReentries: barren,
    ended: last?.stop ?? 'unrecorded',
    ...(last?.repromptRefusedBy === undefined ? {} : { repromptRefusedBy: last.repromptRefusedBy }),
  }
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0 || signal.aborted) return
  await sleep(ms, signal, false)
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

  const continuation = run.continuation
  if (continuation !== undefined) {
    if (!Number.isFinite(continuation.deadlineMs) || continuation.deadlineMs <= 0) {
      throw new ValidationError(
        'runDriverWithRetry: a continuation needs a finite positive deadline',
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
  // Consecutive `unavailable` attempts, for the pause doubling only. Any other outcome, or an
  // unavailable attempt that still made progress, resets it: the upstream served in between.
  let consecutivePauses = 0
  // Every pause this loop took, for the re-entry it names.
  let pauses = 0
  let continuations = 0
  let reentry: DriverReentry | undefined

  const emit = async (record: DriverAttemptRecord): Promise<void> => {
    const entered = reentry === undefined ? {} : { reentry: reentry.reason }
    const stamped = { ...record, ...entered }
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
  ): Promise<{ steer: string } | { refusedBy: DriverRepromptRefusal }> => {
    const bounds = (): DriverRepromptRefusal | undefined => {
      if (policy.closed()) return 'closed'
      if (run.signal.aborted) return 'aborted'
      if (now() >= policy.deadlineMs) return 'deadline'
      const byBudget = budgetStop(run.budget(), now())
      return byBudget === 'deadline' || byBudget === 'budget-exhausted' ? byBudget : undefined
    }
    if (barrenReentries >= policy.maxBarren) return { refusedBy: 'no-progress' }
    const before = bounds()
    if (before !== undefined) return { refusedBy: before }
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
    return { steer }
  }

  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = now()
    // The completed-drive arm lives OUTSIDE this try. A configuration fault raised while deciding
    // the re-prompt is the caller's, not the driver's, and must reach the caller unwrapped instead
    // of being classified as one more driver failure.
    // No asynchronous work separates this check from dispatch. It covers first entry and
    // re-entry after onAttempt, whose awaited observer may exhaust authority or resources.
    const admissionStop = run.signal.aborted ? 'aborted' : budgetStop(run.budget(), now())
    if (admissionStop !== undefined) {
      // A completed-but-unmet invocation remains completed; its finalizer owns acceptance.
      if (reentry !== undefined) return
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
      const progressed = madeProgress(before, run.progress())
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
            attempt,
            durationMs,
            error: errMessage(error),
            classification,
            madeProgress: progressed,
            unavailableSignal,
            stop,
          })
          throw new DriverAttemptsExhaustedError(error, attempts, stop)
        }
        pauses += 1
        consecutivePauses = progressed ? 1 : consecutivePauses + 1
        const pause = unavailablePauseMs(consecutivePauses, policy)
        await emit({
          attempt,
          durationMs,
          error: errMessage(error),
          classification,
          madeProgress: progressed,
          unavailableSignal,
          retryInMs: pause,
        })
        // The same rule as a failure retry: re-enter with the ORIGINAL task and the run's state,
        // because the refused turn may have ended before it read a re-prompt.
        reentry = { reason: 'upstream-unavailable', signal: unavailableSignal, pause: pauses }
        await sleep(pause, run.signal)
        if (run.signal.aborted) {
          throw new DriverAttemptsExhaustedError(error, attempts, 'aborted')
        }
        const afterPause = budgetStop(run.budget(), now())
        if (afterPause) {
          throw new DriverAttemptsExhaustedError(error, attempts, afterPause)
        }
        continue
      }
      consecutivePauses = 0
      failures += 1
      const stop = ((): DriverAttemptStop | undefined => {
        if (classification === 'terminal') return 'terminal-error'
        if (!retryEnabled) return 'retry-disabled'
        if (run.signal.aborted) return 'aborted'
        const byBudget = budgetStop(run.budget(), now())
        if (byBudget) return byBudget
        if (failures >= maxAttempts) return 'max-attempts'
        // Progress resets the barren counter: a driver that is doing real work between crashes
        // has earned another attempt, and the budget remains the bound on how many.
        if (progressed) return undefined
        return consecutiveBarren + 1 >= maxConsecutive ? 'no-progress' : undefined
      })()

      if (progressed) barrenReentries = 0
      if (stop !== undefined) {
        await emit({
          attempt,
          durationMs,
          error: errMessage(error),
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
        error: errMessage(error),
        classification,
        madeProgress: progressed,
        retryInMs: backoff,
      })
      // A retry re-enters with the ORIGINAL task. The drive that just failed may have died before
      // it read the re-prompt at all, so replaying the unmet-items text in its place would drop
      // the run's actual instruction. The failure itself travels, so the caller can say why.
      reentry = { reason: 'driver-failure', failure: errMessage(error), retry: failures }
      await sleep(backoff, run.signal)
      // The wait is where an abort or a deadline most often lands; re-ask before re-entering.
      if (run.signal.aborted) {
        throw new DriverAttemptsExhaustedError(error, attempts, 'aborted')
      }
      const afterWait = budgetStop(run.budget(), now())
      if (afterWait) {
        throw new DriverAttemptsExhaustedError(error, attempts, afterWait)
      }
      continue
    }

    // A completed invocation ends the transport-failure streak, even while the pursuit's
    // independent completion check remains unmet. Successful continuation is not a failure. The
    // barren re-entry count is a different fact and a completion alone never resets it.
    consecutiveBarren = 0
    consecutivePauses = 0
    const durationMs = now() - startedAt
    const after = run.progress()
    const progressed = madeProgress(before, after)
    const contract = contractOf(after)
    const contractField = contract === 'none' ? {} : { contract }
    if (progressed) barrenReentries = 0
    else if (reentry !== undefined && contract === 'unmet') barrenReentries += 1
    if (contract === 'unmet' && continuation !== undefined) {
      const decision = await decideContinuation(continuation, attempt, after)
      if ('steer' in decision) {
        continuations += 1
        // No backoff: the driver is not failing — it finished early.
        await emit({
          attempt,
          durationMs,
          madeProgress: progressed,
          ...contractField,
          reprompted: true,
          retryInMs: 0,
        })
        reentry = { reason: 'unmet-contract', steer: decision.steer, continuation: continuations }
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
