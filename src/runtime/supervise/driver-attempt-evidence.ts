import type { AgentTurnFailure } from '@tangle-network/agent-interface/environment-provider'
import { AgentEvalError, BackendTransportError, RuntimeRunStateError } from '../../errors'
import type { BlockedToolReport } from '../../mcp/tools/coordination-contracts'
import { CheckUnavailableError } from './completion-gate'
import type { ContinuationEntry } from './continuation'
import { CoordinationUnreachableError } from './coordination-preflight'
import { credentialCommandExit, isCredentialRefusal } from './credential-refusal'
import type { DriverContractState, DriverReentry } from './driver-retry'
import { causeChain, errMessage, errorHttpStatus, errorProperty, errorText } from './error-message'
import {
  type ExecutorFailure,
  executorFailureInfra,
  turnFailureOf,
  turnFailurePolicy,
} from './executor-outcome'
import {
  DISPATCH_EXECUTION_CHANGED_CODE,
  DISPATCH_NOT_ADMITTED_CODE,
  isProvisioningRefusal,
  isSchemaRejection,
  RetainedExecutionPendingError,
  type RetainedPendingCause,
} from './retained-executor'
import { subscriptionUsageLimitSignal } from './seat-chain'
import {
  printedStatus,
  UNAVAILABLE_CODES,
  UNAVAILABLE_STATUSES,
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

/** One attempt's record, emitted per attempt so an operator sees each legible failure. */
export interface DriverAttemptRecord {
  /** 1-based. */
  readonly attempt: number
  readonly durationMs: number
  /** Absent when the attempt completed. */
  readonly error?: string
  /** Validated producer attribution, including its reset hint when supplied. */
  readonly failure?: AgentTurnFailure
  readonly classification?: DriverFailureClass
  /** For a `transient` failure: `infra` (bounded as an outage) or `deterministic` (stops at the
   *  second invocation that fails alike with no progress). */
  readonly failureKind?: 'infra' | 'deterministic'
  /** Did anything change since the previous attempt (spend, settlement, submission)? */
  readonly madeProgress: boolean
  /** Set when this attempt ended the loop. */
  readonly stop?: DriverAttemptStop
  /** Set when this stop would have ended the loop and an opted-in root paused instead
   *  (`driverRetry.pauseRootStops`); `retryInMs` is the pause and `resumeAt` its end, with one
   *  `paused` row. An admission or continuation refusal carries no `error`. */
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
  /** How far its retained execution's events were read; a later reconcile subscribes after it. */
  readonly observed?: { readonly executionId: string; readonly replayPosition: string }
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

/** Sandbox's `PartialFailureError` on `error` or a cause, read by name: packages that hold their own
 *  copy of the class would miss an `instanceof`. */
const causedByPartialFailure = (error: unknown): boolean =>
  causeChain(error).some(
    (cause) => cause instanceof Error && errorProperty(cause, 'name') === 'PartialFailureError',
  )

/** Why a completed drive with an unmet contract was not re-entered. `closed` means the run was
 *  already closed: the manager's own `stop` or a progress stop rule. A barren streak is never a
 *  refusal: it pauses the next continuation (`barrenPauseMs`). */
export type DriverRepromptRefusal =
  | 'closed'
  | Extract<DriverAttemptStop, 'aborted' | 'budget-exhausted' | 'deadline' | 'max-attempts'>

/**
 * The pending invocation a failure left, when abandoning it is the resolution: the provider could
 * not resolve the execution (`unobservable`), or a nested manager's recovery could not be rebuilt
 * (`nested-recovery`). A lost transport waits in the outage window instead, and a capacity refusal
 * pauses, so neither starts a second execution beside one that may still run. A request refused
 * before it ran has nothing to abandon. A contract violation stays terminal (#1204).
 */
export function abandonablePending(error: unknown): RetainedExecutionPendingError | undefined {
  return error instanceof RetainedExecutionPendingError &&
    (error.pendingCause === 'unobservable' || error.pendingCause === 'nested-recovery')
    ? error
    : undefined
}

/** Deterministic bridge refusals remain terminal even when transport omits HTTP status. */
const DETERMINISTIC_BRIDGE_CODES: ReadonlySet<string> = new Set([
  'parse_error',
  'not_configured',
  'capability_denied',
  'MODEL_NOT_FOUND',
  'SEAT_NOT_LOGGED_IN',
])

/**
 * A model provider's content-filter refusal, which Codex names only in text under the generic
 * `AGENT_EXECUTION_FAILED`. It stays transient; the retry loop bounds a streak of them and stops
 * with this reason, for the parent to reword or re-scope the task.
 */
const CONTENT_FILTER_REASON = "refused by the model provider's content filter"
export const isContentFilterRefusal = (error: unknown): boolean =>
  causeChain(error).some(
    (cause) =>
      cause instanceof Error &&
      /\bcontent was flagged for possible\b/iu.test(errorProperty(cause, 'message') ?? ''),
  )

/** A completed failed turn enters retry with its producer classification and legacy metadata intact. */
export class HarnessTurnFailedError extends Error {
  readonly runtime: string
  /** The failure as the harness reported it, before this error's framing. */
  readonly reported: string
  readonly errorCode?: string
  readonly statusCode?: number
  /** The shared HTTP error reader also uses this status for persisted diagnostics. */
  readonly status?: number
  readonly failure?: ExecutorFailure['failure']

  constructor(runtime: string, failure: ExecutorFailure) {
    super(
      `${runtime} harness turn ended with a failed outcome` +
        (failure.errorCode === undefined ? '' : ` (${failure.errorCode})`) +
        `: ${failure.error}`,
    )
    this.name = 'HarnessTurnFailedError'
    this.runtime = runtime
    this.reported = failure.error
    if (failure.failure !== undefined) this.failure = failure.failure
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
    return error.name === 'ValidationError' || isSchemaRejection(error)
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

/** Sandbox confirmed the dispatch but named a different execution: deterministic on every retry. */
function isDispatchExecutionChanged(value: object): boolean {
  try {
    return Reflect.get(value, 'code') === DISPATCH_EXECUTION_CHANGED_CODE
  } catch {
    return false
  }
}

/** Read Runtime admission evidence before producer hints and legacy transport metadata. */
export function upstreamUnavailableSignal(error: unknown): string | undefined {
  if (undispatchedCredentialExit(error) !== undefined) return 'credential-unavailable'
  if (error instanceof CheckUnavailableError) return 'check-unavailable'
  if (error instanceof CoordinationUnreachableError) return 'coordination-unreachable'
  const typed = turnFailureOf(error)
  if (typed)
    return turnFailurePolicy(typed).classification === 'unavailable'
      ? (subscriptionUsageLimitSignal({ error: '', errorCode: typed.code }) ?? typed.code)
      : undefined
  const refusal = retainedAdmissionCause(error) ?? reconciliationCapacityRefusal(error)
  if (refusal !== undefined) return upstreamUnavailableSignal(refusal)
  if (!(error instanceof Error)) return undefined
  if (isCredentialRefusal(error)) return undefined
  if (isProviderSchemaRejection(error)) return undefined
  const transport = error instanceof BackendTransportError
  if (error instanceof AgentEvalError && !transport) return undefined
  const harness = error instanceof HarnessTurnFailedError
  const failure = {
    error: errorProperty(error, 'message') ?? '',
    errorCode: harness ? error.errorCode : transport ? error.upstreamCode : ownCode(error),
    statusCode: errorHttpStatus(error),
  }
  return (
    (harness ? subscriptionUsageLimitSignal(failure) : undefined) ??
    unavailableSignalOfFailure(failure)
  )
}

/** Capacity encountered while reconciling an admitted execution pauses that same execution. */
function reconciliationCapacityRefusal(error: unknown): Error | undefined {
  if (!(error instanceof RetainedExecutionPendingError) || error.phase !== 'execution')
    return undefined
  if (error.pendingCause !== 'unobservable' && error.pendingCause !== 'transport') return undefined
  return causeChain(error.cause).find(
    (cause): cause is Error =>
      cause instanceof Error &&
      (UNAVAILABLE_CODES.has(ownCode(cause)?.toLowerCase() ?? '') ||
        errorHttpStatus(cause) === 429),
  )
}

/** An error's own `code` field, read without trusting its getter: agent-provider-tangle's
 *  `TangleCredentialCapacityError` carries the router's code even with no HTTP status. */
function ownCode(error: Error): string | undefined {
  try {
    const code: unknown = Reflect.get(error, 'code')
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/** Runtime cancellation/contracts dominate producer policy; untyped foreign failures retain legacy rules. */
export function classifyDriverFailure(
  error: unknown,
  signal?: AbortSignal,
  stopSignal?: AbortSignal,
): DriverFailureClass {
  if (signal?.aborted) return 'terminal'
  if (error instanceof CheckUnavailableError || error instanceof CoordinationUnreachableError)
    return 'unavailable'
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
  // The provider confirmed the dispatch and then contradicted it: the same answer arrives on
  // every retry, retained or not (agent-sdk #475).
  if (causeChain(error).some(isDispatchExecutionChanged)) return 'terminal'
  if (admission !== undefined) return classifyDriverFailure(admission, signal, stopSignal)
  if (error instanceof Error && errorProperty(error, 'name') === 'AbortError') {
    return stopSignal?.aborted === true ? 'terminal' : 'transient'
  }
  if (error instanceof Error && isProviderSchemaRejection(error)) return 'terminal'
  if (isCredentialRefusal(error)) return 'terminal'
  if (causeChain(error).some(isProvisioningRefusal)) return 'terminal'
  if (error instanceof AgentEvalError && !(error instanceof BackendTransportError))
    return 'terminal'
  const typed = turnFailureOf(error)
  if (typed) return turnFailurePolicy(typed).classification
  if (error instanceof HarnessTurnFailedError) {
    if (error.errorCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.errorCode)) {
      return 'terminal'
    }
    if (upstreamUnavailableSignal(error) !== undefined) return 'unavailable'
    return foreignHttpStatusVerdict(error) ?? 'transient'
  }
  if (error instanceof BackendTransportError) {
    if (error.upstreamCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.upstreamCode))
      return 'terminal'
    if (upstreamUnavailableSignal(error) !== undefined) return 'unavailable'
    const status = error.status
    return status === undefined || status === 408 || status >= 500 ? 'transient' : 'terminal'
  }
  if (upstreamUnavailableSignal(error) !== undefined) return 'unavailable'
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
          UNAVAILABLE_CODES.has(ownCode(value)?.toLowerCase() ?? ''))
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
 * A foreign error's HTTP status, read by the transport branch's rule: 408 and 5xx are a bad
 * moment, any other 4xx fails identically forever. A provider SDK's own classes reach here: a
 * Sandbox create refused `HTTP 400 {"code":"CONFIG_ERROR"}` for a fully reserved key was retried
 * 14-22 times per node as transient. Capacity statuses were answered before this point.
 */
function foreignHttpStatusVerdict(error: unknown): 'transient' | 'terminal' | undefined {
  // Only a thrown Error: `status` is a common field on settlements and run states. The reader is
  // the one the persisted message quotes.
  if (!(error instanceof Error)) return undefined
  const status = errorHttpStatus(error)
  if (status === undefined || status < 400) return undefined
  if (status === 408 || status >= 500) return 'transient'
  return 'terminal'
}

/** Transport errno codes and undici codes: the connection, not the request, failed. */
const TRANSPORT_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'ENETUNREACH',
  'EHOSTUNREACH',
])
const TRANSPORT_NAMES = new Set([
  'TimeoutError',
  'NetworkError',
  'AbortError',
  'RetainedStreamError',
])

/** Producer infra earns the outage window; producer work earns only the bounded deterministic streak. */
export function transientFailureKind(error: unknown): 'infra' | 'deterministic' {
  const typed = turnFailureOf(error)
  if (typed) return turnFailurePolicy(typed).failureKind
  // A created box whose setup failed is met again on each re-entry, whatever cut it.
  if (causedByPartialFailure(error)) return 'deterministic'
  return causeChain(error).some((cause) => {
    if (!(cause instanceof Error)) return false
    // The settlement's platform vocabulary (an in-box runtime restart, a terminated box) is the
    // same verdict here: one table answers whether the platform ended a harness turn.
    if (
      cause instanceof HarnessTurnFailedError &&
      executorFailureInfra({
        error: cause.reported,
        ...(cause.errorCode === undefined ? {} : { errorCode: cause.errorCode }),
      })
    )
      return true
    // A harness CLI prints a gateway's status (`status code 524`) into its failure text.
    const status =
      cause instanceof HarnessTurnFailedError
        ? (cause.statusCode ?? printedStatus(cause.message))
        : errorHttpStatus(cause)
    const code = ownCode(cause) ?? ''
    return (
      (status !== undefined && (status === 408 || status >= 500)) ||
      TRANSPORT_CODES.has(code) ||
      code.startsWith('UND_ERR_') ||
      cause instanceof BackendTransportError ||
      TRANSPORT_NAMES.has(errorProperty(cause, 'name') ?? '')
    )
  })
    ? 'infra'
    : 'deterministic'
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
      `supervisor driver failed after ${attempts.length} attempt(s) — stopped by ${stop}` +
        (stop === 'repeated-failure' && isContentFilterRefusal(cause)
          ? `: ${CONTENT_FILTER_REASON}; `
          : '; ') +
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
   *  pause counts. A first drive worked 8 minutes before its
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
