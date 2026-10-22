import {
  AgentEvalError,
  BackendTransportError,
  ConfigError,
  RuntimeRunStateError,
  ValidationError,
} from '../../errors'
import type { BlockedToolReport } from '../../mcp/tools/coordination-contracts'
import { CheckUnavailableError } from './completion-gate'
import type { ContinuationEntry } from './continuation'
import { credentialCommandExit, isCredentialRefusal } from './credential-refusal'
import type { DriverContractState, DriverReentry } from './driver-retry'
import { causeChain, errMessage, errorHttpStatus, errorProperty, errorText } from './error-message'
import {
  DISPATCH_NOT_ADMITTED_CODE,
  isProvisioningRefusal,
  RetainedExecutionPendingError,
  type RetainedPendingCause,
} from './retained-executor'
import { subscriptionUsageLimitSignal } from './seat-chain'
import {
  UNAVAILABLE_CODES,
  UNAVAILABLE_STATUSES,
  unavailableSignalInText,
  unavailableSignalOfFailure,
} from './upstream-unavailable'

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
  | 'pending-unresolved'
  | 'repeated-failure'

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
  /** Set when this stop would have ended the loop and an opted-in root paused instead
   *  (`driverRetry.pauseRootStops`); `retryInMs` is the pause and `resumeAt` its end. The
   *  run's journal holds one `paused` row for it. An admission or continuation refusal has no
   *  failure, so its record carries no `error`. */
  readonly replacesStop?: DriverAttemptStop
  /** With `replacesStop`: stop-pauses in a row since an attempt last made progress, 1-based. */
  readonly stopPauseStreak?: number
  /** True when this attempt's pending invocation was abandoned rather than retried: see
   *  `DriverRetryRun.resolvePending`. */
  readonly abandoned?: boolean
  /** With `stop: 'pending-unresolved'`: why the invocation it left pending cannot be resolved. */
  readonly pendingCause?: RetainedPendingCause
  /** Set when another attempt follows. For an `unavailable` attempt this is the pause, which is
   *  infrastructure time: together with `durationMs` it is what the outage cost this driver. */
  readonly retryInMs?: number
  /** How this attempt was entered. Absent on the first attempt of a run this process started. */
  readonly reentry?: DriverReentry['reason']
  /** Set on an attempt of a re-entered run that began before the root streamed any model event
   *  in this process. Such an attempt never counts toward `continuation.maxBarren`. */
  readonly beforeModelEvent?: true
  /** For an `unavailable` attempt: the code or HTTP status that classified it, such as
   *  `provider_quota_exhausted` or `http-429`, or `credential-unavailable` when the provider's
   *  command failed before any dispatch. */
  readonly unavailableSignal?: string
  /** For a `credential-unavailable` pause: the exit code of the command that failed. */
  readonly exitCode?: number
  /** For an `unavailable` attempt whose refusal named its reset time, a
   *  `credential-unavailable` pause, or a stop-pause: the pause holds until then. */
  readonly resumeAt?: string
  /** The completion check's verdict after this attempt. Absent when the caller declares none. */
  readonly contract?: DriverContractState
  /** True when this COMPLETED attempt's unmet contract sent the loop back with a continuation. */
  readonly reprompted?: boolean
  /** With `reprompted`: the pause taken before that continuation because the barren streak had
   *  reached `continuation.maxBarren`. The run's journal holds its `barren-pause` row. */
  readonly barrenPauseMs?: number
  /** For a completed attempt that left work open: how long the manager then waited, with no
   *  model turn, before the wake that started the next attempt. */
  readonly waitedMs?: number
  /** Why an unmet contract did NOT re-enter the session. Absent when the contract was met, when
   *  the manager has no continuation policy, or when the continuation was sent. */
  readonly repromptRefusedBy?: DriverRepromptRefusal
}

/** Why a completed drive with an unmet contract was not re-entered. `closed` means the run was
 *  already closed: the manager's own `stop` or a progress stop rule. A barren streak is never a
 *  refusal: it pauses the next continuation (`barrenPauseMs`). */
export type DriverRepromptRefusal =
  | 'closed'
  | Extract<DriverAttemptStop, 'aborted' | 'budget-exhausted' | 'deadline' | 'max-attempts'>

/** Longest cause chain read for a `PartialFailureError`; the failing box's error sits one or two wrappers down. */
const PARTIAL_FAILURE_CAUSE_DEPTH = 6

/**
 * True when `error` or one of its causes is Sandbox's `PartialFailureError`. Read by name: the
 * class lives in `@tangle-network/sandbox`, which Runtime does not import, and a failure crosses
 * packages that may each hold their own copy of it, so `instanceof` would miss it.
 */
export function causedByPartialFailure(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  for (let depth = 0; depth <= PARTIAL_FAILURE_CAUSE_DEPTH; depth += 1) {
    if (!(current instanceof Error) || seen.has(current)) return false
    seen.add(current)
    try {
      if (errorProperty(current, 'name') === 'PartialFailureError') return true
      current = current.cause
    } catch {
      return false
    }
  }
  return false
}

/**
 * The pending invocation a failure left, when abandoning it is the resolution: the provider
 * answered and could not resolve the execution (`unobservable`), or a nested manager's recovery
 * could not be rebuilt (`nested-recovery`). A lost transport waits for the provider instead, in
 * the outage window: abandoning during a provider outage would start a second execution beside
 * one that may still run. A request refused before it ran has nothing to abandon: a capacity
 * refusal pauses and any other refusal is terminal. A contract violation stays terminal (#1204).
 */
export function abandonablePending(error: unknown): RetainedExecutionPendingError | undefined {
  return error instanceof RetainedExecutionPendingError &&
    (error.pendingCause === 'unobservable' || error.pendingCause === 'nested-recovery')
    ? error
    : undefined
}

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
  readonly statusCode?: number
  /** The shared HTTP error reader also uses this status for persisted diagnostics. */
  readonly status?: number

  constructor(
    runtime: string,
    failure: { readonly error: string; readonly errorCode?: string; readonly statusCode?: number },
  ) {
    super(
      `${runtime} harness turn ended with a failed outcome` +
        (failure.errorCode === undefined ? '' : ` (${failure.errorCode})`) +
        `: ${failure.error}`,
    )
    this.name = 'HarnessTurnFailedError'
    this.runtime = runtime
    if (failure.errorCode !== undefined) this.errorCode = failure.errorCode
    if (failure.statusCode !== undefined) {
      this.statusCode = failure.statusCode
      this.status = failure.statusCode
    }
  }
}

/**
 * How one driver failure is answered.
 *
 *  - `terminal`: Runtime's own refusal, or a request that fails identically forever. The run ends.
 *  - `transient`: a foreign accident. A streak in which nothing ran is retried as an outage for
 *    `transientOutageMs`; after that, and for a failure that did work, `maxAttempts` and the
 *    barren streak bound it.
 *  - `unavailable`: the upstream cannot serve now (quota, rate limit, overload, or the router's
 *    own provider credential refused). The driver pauses and re-enters, and only the deadline, the
 *    budget, and cancellation bound the pauses.
 */
export type DriverFailureClass = 'transient' | 'terminal' | 'unavailable'

/** Provider schemas and JSON bounds reject the request deterministically. */
function isProviderSchemaRejection(error: Error): boolean {
  try {
    return (
      error.name === 'ZodError' ||
      error.name === 'ValidationError' ||
      Reflect.get(error, 'code') === 'JSON_BOUND_VIOLATION' ||
      Array.isArray(Reflect.get(error, 'issues'))
    )
  } catch {
    return false
  }
}

/** Sandbox started nothing for the dispatch: another execution owns the session or turn. */
function isDispatchNotAdmitted(error: Error): boolean {
  try {
    return Reflect.get(error, 'code') === DISPATCH_NOT_ADMITTED_CODE
  } catch {
    return false
  }
}

/**
 * The code or status that marks `error` as an upstream capacity refusal, or `undefined`.
 *
 * A structured field is read first: a turn outcome's `errorCode`, a transport error's
 * `upstreamCode` and `status`, a provider SDK error's `status`. The failure text is read only when
 * no structured field decided, because a harness CLI reports the router's refusal as text.
 */
export function upstreamUnavailableSignal(error: unknown): string | undefined {
  if (undispatchedCredentialExit(error) !== undefined) return 'credential-unavailable'
  const admission = retainedAdmissionCause(error)
  if (admission !== undefined) return upstreamUnavailableSignal(admission)
  if (!(error instanceof Error)) return undefined
  if (isCredentialRefusal(error)) return undefined
  if (isProviderSchemaRejection(error)) return undefined
  // The check could not run. It is not a verdict on the director, so the loop pauses as it does
  // for an upstream out of capacity and never counts the turn for or against the run.
  if (error instanceof CheckUnavailableError) return 'check-unavailable'
  if (error instanceof HarnessTurnFailedError) {
    const usageLimit = subscriptionUsageLimitSignal({
      error: error.message,
      ...(error.errorCode === undefined ? {} : { errorCode: error.errorCode }),
    })
    if (usageLimit !== undefined) return usageLimit
    return unavailableSignalOfFailure({
      error: error.message,
      ...(error.errorCode === undefined ? {} : { errorCode: error.errorCode }),
      ...(error.statusCode === undefined ? {} : { statusCode: error.statusCode }),
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
  const code = capacityCode(error)
  if (code !== undefined) return code
  const status = errorHttpStatus(error)
  if (status !== undefined) {
    return UNAVAILABLE_STATUSES.has(status) ? `http-${status}` : undefined
  }
  return unavailableSignalInText(errorProperty(error, 'message') ?? '')
}

/**
 * The upstream capacity code an error carries as its own `code` field, or `undefined`. A provider
 * SDK names a capacity refusal with the router's code when no HTTP response exists to carry a
 * status: agent-provider-tangle's `TangleCredentialCapacityError` (`provider_quota_exhausted`,
 * `upstream_unavailable`) when the subscription account owner has no account with room.
 */
function capacityCode(error: Error): string | undefined {
  let code: unknown
  try {
    code = Reflect.get(error, 'code')
  } catch {
    return undefined
  }
  if (typeof code !== 'string') return undefined
  const normalized = code.toLowerCase()
  return UNAVAILABLE_CODES.has(normalized) ? normalized : undefined
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
 *
 * An `AbortError` is the run's own only when `signal` (the run) or `stopSignal` (the manager's own
 * stop: an accepted result, `stop`, a stop rule) has fired. Any other is a lost stream and is
 * retried: on magnetar-rust-20261019b a 4.0 h root turn ended "bridgeExecutor: turn aborted" and,
 * classed terminal, settled the run after one attempt.
 */
export function classifyDriverFailure(
  error: unknown,
  signal?: AbortSignal,
  stopSignal?: AbortSignal,
): DriverFailureClass {
  if (signal?.aborted) return 'terminal'
  // A failed retained read does not settle or replace its execution. A contract violation
  // requires a repaired reader/provider; repeating that read unchanged cannot recover it.
  if (error instanceof RetainedExecutionPendingError && error.pendingCause === 'provider-contract')
    return 'terminal'
  // Nothing was dispatched, so nothing is pending: a pause, never a reconciliation to count.
  if (undispatchedCredentialExit(error) !== undefined) return 'unavailable'
  const admission = retainedAdmissionCause(error)
  // A dispatch that Sandbox did not admit gets the same refusal while the owning execution holds
  // the session. A run never starts a turn beside an execution that owns its session, so it stops
  // with the refusal named. The refusal reaches this check only from a retained admission.
  if (admission !== undefined && isDispatchNotAdmitted(admission)) return 'terminal'
  if (admission !== undefined) return classifyDriverFailure(admission, signal, stopSignal)
  if (error instanceof Error && errorProperty(error, 'name') === 'AbortError') {
    return stopSignal?.aborted === true ? 'terminal' : 'transient'
  }
  if (error instanceof Error && isProviderSchemaRejection(error)) return 'terminal'
  if (isCredentialRefusal(error)) return 'terminal'
  // A profile the box cannot be provisioned for fails the same way on every attempt and every box.
  if (causeChain(error).some(isProvisioningRefusal)) return 'terminal'
  if (error instanceof HarnessTurnFailedError) {
    // The same never-retry classes a bridge refusal carries, now arriving as a turn's outcome.
    // Without a code the failure is foreign: an upstream timeout, a cut stream, an expired key.
    if (error.errorCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.errorCode)) {
      return 'terminal'
    }
    if (isUpstreamUnavailable(error)) return 'unavailable'
    return foreignHttpStatusVerdict(error) ?? 'transient'
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

/** The credential command's exit code when it failed before Runtime journaled a dispatch: no
 *  provider execution id exists, so nothing ran ({@link credentialCommandExit}). */
export function undispatchedCredentialExit(error: unknown): number | undefined {
  return error instanceof RetainedExecutionPendingError &&
    error.phase === 'admission' &&
    error.pendingCause === 'unobservable'
    ? credentialCommandExit(error.cause)
    : undefined
}

/** Admission refusals keep the original HTTP rules without interpreting failures after execution starts. */
function retainedAdmissionCause(error: unknown): Error | undefined {
  if (
    !(error instanceof RetainedExecutionPendingError) ||
    error.phase !== 'admission' ||
    (error.pendingCause !== 'request-rejected' && error.pendingCause !== 'transport')
  )
    return undefined
  const queue: unknown[] = []
  try {
    queue.push(error.cause)
  } catch {
    return undefined
  }
  const seen = new Set<Error>()
  for (let steps = 0; queue.length > 0 && steps < 12; steps += 1) {
    const value = queue.shift()
    try {
      if (!(value instanceof Error) || seen.has(value)) continue
      seen.add(value)
      if (value instanceof RetainedExecutionPendingError) {
        if (
          value.phase !== 'admission' ||
          (value.pendingCause !== 'request-rejected' && value.pendingCause !== 'transport')
        )
          return undefined
        queue.push(value.cause)
        continue
      }
      // A failed retained read observes an existing execution, even inside an admission wrapper.
      if (errorProperty(value, 'name') === 'RetainedRunProviderContractError') return undefined
      const status = errorHttpStatus(value)
      if (status !== undefined && status >= 400) {
        // An uncertain transport cause can establish capacity, but cannot establish a terminal refusal.
        return error.pendingCause === 'request-rejected' || UNAVAILABLE_STATUSES.has(status)
          ? value
          : undefined
      }
      if (
        error.pendingCause === 'request-rejected' &&
        (value instanceof AgentEvalError ||
          isProviderSchemaRejection(value) ||
          isDispatchNotAdmitted(value) ||
          isCredentialRefusal(value) ||
          // A capacity refusal before dispatch: the same request is admitted when room returns.
          capacityCode(value) !== undefined)
      )
        return value
      const members: unknown = Reflect.get(value, 'errors')
      if (Array.isArray(members)) queue.push(...members.slice(0, 12 - steps))
      queue.push(value.cause)
    } catch {
      return undefined
    }
  }
  return undefined
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
  /** Driver invocations started (the attempt numbers the loop reached). */
  readonly attempts: number
  /** Genuine continuations: completed drives with the contract unmet that were re-entered. */
  readonly reprompts: number
  /** Re-entries after a failed drive. A pause on an unavailable upstream is not one, nor is a
   *  stop-pause. */
  readonly failureRetries: number
  /** Stops an opted-in root paused on instead of ending (`DriverAttemptRecord.replacesStop`). */
  readonly stopPauses: number
  /** Re-entries after the upstream refused a drive for capacity. Each is a pause, not a failure. */
  readonly unavailablePauses: number
  /** Infrastructure time the unavailable upstream cost this loop: every pause, plus every refused
   *  drive that made no progress. A refused drive that made progress was mostly work, so only its
   *  pause counts. Measured 2026-09-24 on a real run: a first drive worked 8 minutes before its
   *  refusal, and counting its whole duration doubled a 10-minute outage to 16 minutes. */
  readonly unavailableMs: number
  /** Re-entered drives, in a row at the end, that completed without a delivery. */
  readonly barrenReentries: number
  /** Turns started by a wake: the manager ended its turn with work open and Runtime resumed it. */
  readonly wakes: number
  /** Time the manager waited between turns with no model turn, summed over its wakes. */
  readonly waitedMs: number
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
   *  manager's own `stop` (served only to a manager with no check), or the caller's progress
   *  `stopRule`. Absent when the loop ended on a bound or a failure. A blocked tool never closes
   *  a run: it is a segment boundary, recorded in `blocked`. */
  readonly closedBy?: 'result-accepted' | 'stop' | 'stop-rule'
  /** The reason the manager gave, verbatim. */
  readonly stopReason?: string
  /** Every `report_blocked` whose probe failed too, in report order. Present when non-empty. */
  readonly blocked?: ReadonlyArray<BlockedToolReport>
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
      record.beforeModelEvent !== true &&
      record.error === undefined &&
      record.reentry !== undefined &&
      record.reentry !== 'wake' &&
      record.contract === 'unmet'
    )
      barren += 1
  }
  const last = records.at(-1)
  const stopPauses = records.filter((record) => record.replacesStop !== undefined)
  const refused = records.filter(
    (record) => record.classification === 'unavailable' && record.replacesStop === undefined,
  )
  return {
    // A stop-pause before an admission, or before a continuation, adds a record to its attempt.
    attempts: new Set(records.map((record) => record.attempt)).size,
    reprompts: records.filter((record) => record.reprompted === true).length,
    failureRetries: records.filter(
      (record) =>
        record.error !== undefined &&
        record.retryInMs !== undefined &&
        record.classification !== 'unavailable' &&
        record.replacesStop === undefined,
    ).length,
    stopPauses: stopPauses.length,
    unavailablePauses: refused.filter((record) => record.retryInMs !== undefined).length,
    unavailableMs: refused.reduce(
      (sum, record) =>
        sum + (record.madeProgress ? 0 : record.durationMs) + (record.retryInMs ?? 0),
      0,
    ),
    barrenReentries: barren,
    wakes: records.filter((record) => record.reentry === 'wake').length,
    waitedMs: records.reduce((sum, record) => sum + (record.waitedMs ?? 0), 0),
    ended: last?.stop ?? 'unrecorded',
    ...(last?.repromptRefusedBy === undefined ? {} : { repromptRefusedBy: last.repromptRefusedBy }),
  }
}
