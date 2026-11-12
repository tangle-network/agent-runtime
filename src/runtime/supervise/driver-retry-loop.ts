import { ValidationError } from '../../errors'
import { sleep } from '../util'
import { isDeadlineAbortReason } from './deadline'
import {
  abandonablePending,
  classifyDriverFailure,
  type DriverAttemptRecord,
  type DriverAttemptStop,
  DriverAttemptsExhaustedError,
  type DriverRepromptRefusal,
  HarnessTurnFailedError,
  transientFailureKind,
  undispatchedCredentialExit,
  upstreamUnavailableSignal,
} from './driver-attempt-evidence'
import type {
  DriverBarrenPause,
  DriverBudgetReadout,
  DriverContinuationPolicy,
  DriverContractState,
  DriverProgressMark,
  DriverReentry,
  DriverRetryPolicy,
  DriverRetryRun,
} from './driver-retry'
import { causeChain, errMessage, errorStack } from './error-message'
import { turnFailureOf } from './executor-outcome'
import { RetainedExecutionPendingError } from './retained-executor'
import {
  cappedDoublingMs,
  jitteredMs,
  RATE_LIMIT_SIGNALS,
  reportedResetAt,
  unavailablePauseMs,
  unavailableResumeAt,
} from './upstream-unavailable'

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_ATTEMPTS = Number.POSITIVE_INFINITY
const DEFAULT_INITIAL_BACKOFF_MS = 2_000
const DEFAULT_MAX_BACKOFF_MS = 30_000
const DEFAULT_TRANSIENT_OUTAGE_MS = 900_000
const BARREN_PAUSE_FIRST_MS = 5 * 60_000
const BARREN_PAUSE_MAX_MS = 60 * 60_000

/** The recoverable stops an opted-in root pauses on (`DriverRetryRun.stopPause`). Terminal errors,
 *  completion, cancellation and a declared deadline end the run; `supervise()` refuses `driverRetry.pauseRootStops` beside `retry-disabled`. */
const PAUSED_STOPS: ReadonlySet<DriverAttemptStop> = new Set<DriverAttemptStop>([
  'no-progress',
  'max-attempts',
  'budget-exhausted',
])

/** The pause before a continuation after `streak` barren re-entries: 5 minutes at `maxBarren`,
 *  doubling per further one, 60 at most. Unjittered: one root's streak, not a shared outage. */
function barrenPauseMs(streak: number, maxBarren: number): number {
  return cappedDoublingMs(streak - maxBarren + 1, BARREN_PAUSE_FIRST_MS, BARREN_PAUSE_MAX_MS)
}

/** Consecutive identical reconciliation failures of one pending invocation that resolve it. */
const SAME_PENDING_LIMIT = 2
/** No unchanged no-progress failure earns a fourth drive, including root pauses and capacity. */
const SAME_CAUSE_LIMIT = 3

/** Deterministic failures without progress stop on their second identical cause. */
const SAME_DETERMINISTIC_LIMIT = 2

/** `deadline` when a deadline cut the run, else `aborted`. Read before classification, which calls
 *  every failure after an abort terminal: 61 of 62 `terminal-error` runs were a cut deadline. */
function abortStop(signal: AbortSignal): 'deadline' | 'aborted' {
  return isDeadlineAbortReason(signal.reason) ? 'deadline' : 'aborted'
}

/** The budget's own verdict on whether another attempt may run at all. */
function budgetStop(budget: DriverBudgetReadout, atMs: number): DriverAttemptStop | undefined {
  if (budget.deadlineMs > 0 && atMs >= budget.deadlineMs) return 'deadline'
  // A dollar-capped pool that has seen an unknown-cost turn closes admission permanently: a retry
  // could only reproduce the same refusal.
  const exhausted =
    (budget.tokensCapped !== false && budget.tokensLeft <= 0) ||
    (budget.iterationsCapped !== false && budget.iterationsLeft <= 0) ||
    (budget.usdCapped && (budget.usdLeft <= 0 || budget.usdKnown === false)) ||
    Object.values(budget.resources ?? {}).some((r) => !r.known || r.remaining <= 0)
  return exhausted ? 'budget-exhausted' : undefined
}

/** The cause an admission or continuation refusal carries: it has no failure of its own. */
function admissionError(stop: DriverAttemptStop): ValidationError {
  return new ValidationError(`driver admission: ${stop}`)
}

function contractOf(mark: DriverProgressMark): DriverContractState {
  return mark.contract ?? 'none'
}

/** Did this attempt move the run toward its DELIVERABLE? A delivery always counts; spend and
 *  settlements count only while no declared check is outstanding. */
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

/** The retry policy with every default applied. */
export interface DriverRetryLimits {
  readonly now: () => number
  readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>
  readonly random: () => number
  readonly policy: DriverRetryPolicy
  readonly retryEnabled: boolean
  readonly maxConsecutive: number
  readonly maxAttempts: number
  readonly initialBackoff: number
  readonly maxBackoff: number
  readonly transientOutage: number
}

export function driverRetryLimits(run: DriverRetryRun): DriverRetryLimits {
  const policy = run.policy ?? {}
  const initialBackoff = Math.max(0, policy.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS)
  return {
    now: run.now ?? Date.now,
    sleep: run.sleep ?? defaultSleep,
    random: run.random ?? Math.random,
    policy,
    retryEnabled: policy.enabled !== false,
    maxConsecutive: Math.max(0, policy.maxConsecutiveFailures ?? DEFAULT_MAX_CONSECUTIVE_FAILURES),
    maxAttempts: Math.max(1, policy.maxAttempts ?? DEFAULT_MAX_ATTEMPTS),
    initialBackoff,
    maxBackoff: Math.max(initialBackoff, policy.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS),
    transientOutage: Math.max(0, policy.transientOutageMs ?? DEFAULT_TRANSIENT_OUTAGE_MS),
  }
}

/** A run of alike failures (text with ids and times blanked, code when one carried it). */
type Streak = { error: string; code?: string | undefined; count: number }

/** Compare the underlying cause, excluding changing observation/reconciliation wrappers. */
function extend(streak: Streak | undefined, error: unknown): Streak {
  const chain = causeChain(error)
  const root =
    chain
      .filter(
        (cause) => cause instanceof Error && !(cause instanceof RetainedExecutionPendingError),
      )
      .at(-1) ?? error
  let code =
    turnFailureOf(error)?.code ??
    chain.find((cause) => cause instanceof HarnessTurnFailedError)?.errorCode
  if (code === undefined) {
    try {
      const value: unknown = Reflect.get(root as object, 'code')
      if (typeof value === 'string') code = value
    } catch {
      /* A foreign getter cannot prevent failure settlement. */
    }
  }
  const text = (code ? errMessage(root).replace(` (${code})`, '') : errMessage(root))
    .replace(/\d{4}-\d\d-\d\dT[\d:.]+Z?/gu, '<time>')
    .replace(/\b(?=[\da-f-]*\d)[\da-f]{8,}(?:-[\da-f]{4,})*\b/giu, '<id>')
    .replace(/\d{6,}/gu, '<n>')
  if (streak?.error !== text || (streak.code ?? code) !== (code ?? streak.code))
    return { error: text, code, count: 1 }
  return { ...streak, code: code ?? streak.code, count: streak.count + 1 }
}

/** One failed drive, as the loop read it the moment it failed. */
interface DriverFailure {
  readonly error: unknown
  readonly attempt: number
  readonly startedAt: number
  readonly durationMs: number
  readonly classification: ReturnType<typeof classifyDriverFailure>
  readonly before: DriverProgressMark
  readonly after: DriverProgressMark
  readonly progressed: boolean
  readonly pending: ReturnType<typeof abandonablePending>
}

/** The retry loop's streaks and counters, and the decision each drive's outcome makes with them. */
export class DriverRetryLoop {
  readonly attempts: DriverAttemptRecord[] = []
  private consecutiveBarren = 0
  // Re-entered drives, in a row, that completed without a delivery. Reset by any progress, on a
  // failed drive as well as a completed one; never by a completion alone.
  private barrenReentries = 0
  private failures = 0
  // Failures charged against `maxAttempts`: every failure except a transient one inside an outage.
  private chargedFailures = 0
  // When the current streak of transient failures in which nothing ran began. Cleared by any
  // attempt that did work, failed or completed.
  private outageSince: number | undefined
  // Consecutive `unavailable` attempts, for the pause doubling only. Any other outcome, or an
  // unavailable attempt that still made progress, resets it: the upstream served in between.
  private consecutivePauses = 0
  // Reads of the current pending invocation; reset when it is abandoned.
  private pendingTries = 0
  // Unchanged failures without progress, across capacity waits and recoverable root stops.
  private sameIdle: Streak | undefined
  private abandonments = 0
  // Stop-pauses in a row since the last attempt that made progress, for the stop-pause ladder.
  private stopPauses = 0
  // Every pause this loop took, for the re-entry it names.
  private pauses = 0
  private continuations = 0
  private wakes = 0
  reentry: DriverReentry | undefined
  /** Whether the current attempt began before the re-entered root's first model event. */
  beforeModelEvent = false
  // When the last attempt that made progress ended, for the barren-pause record.
  private lastProgressAt: number

  constructor(
    private readonly run: DriverRetryRun,
    private readonly limits: DriverRetryLimits,
  ) {
    this.reentry = run.reentered?.first
    this.lastProgressAt = limits.now()
  }

  private async emit(record: DriverAttemptRecord): Promise<void> {
    const entered = this.reentry === undefined ? {} : { reentry: this.reentry.reason }
    const stamped = {
      ...record,
      ...entered,
      ...(this.beforeModelEvent ? { beforeModelEvent: true as const } : {}),
    }
    this.attempts.push(stamped)
    await this.run.onAttempt?.(stamped)
  }

  /**
   * Whether the next attempt may run: `undefined` admits it, `'refused'` returns before it, and a
   * stop is one an opted-in root pauses on before asking again. Throws when no attempt ever
   * completed. Synchronous, so nothing separates an admitted attempt from its dispatch.
   */
  admission(): 'refused' | DriverAttemptStop | undefined {
    const { run } = this
    const admissionStop = run.signal.aborted
      ? abortStop(run.signal)
      : budgetStop(run.budget(), this.limits.now())
    if (admissionStop === undefined) return undefined
    if (this.pausesStop(admissionStop)) return admissionStop
    // A completed-but-unmet invocation remains completed; its finalizer owns acceptance.
    if (this.attempts.length > 0) return 'refused'
    throw new DriverAttemptsExhaustedError(
      run.signal.aborted ? run.signal.reason : admissionError(admissionStop),
      this.attempts,
      admissionStop,
    )
  }

  /** Pause an opted-in root where admission would have stopped it; the re-entry is kept. */
  async pauseAdmission(stop: DriverAttemptStop, attempt: number): Promise<void> {
    await this.stopPause(admissionError(stop), stop, {
      attempt,
      durationMs: 0,
      madeProgress: false,
    })
  }

  /** True when `stop` becomes a pause: the caller opted in, the stop is one the header names, and
   *  neither the run nor the manager's own stop has fired. */
  private pausesStop(stop: DriverAttemptStop): boolean {
    const { run } = this
    return (
      run.stopPause !== undefined &&
      PAUSED_STOPS.has(stop) &&
      !run.signal.aborted &&
      run.stopSignal?.aborted !== true
    )
  }

  /** End the loop on `stop` with `record` (when the stop has one), or pause an opted-in root. */
  private async stopOrPause(
    error: unknown,
    stop: DriverAttemptStop,
    record: DriverAttemptRecord,
  ): Promise<void> {
    if (!this.pausesStop(stop)) {
      await this.emit({ ...record, stop })
      throw new DriverAttemptsExhaustedError(error, this.attempts, stop)
    }
    await this.stopPause(error, stop, record)
  }

  /** The earlier of the continuation deadline and the budget's deadline; infinite when neither is set. */
  private deadlineAt(): number {
    const budgetDeadline = this.run.budget().deadlineMs
    return Math.min(
      this.run.continuation?.deadlineMs ?? Number.POSITIVE_INFINITY,
      budgetDeadline > 0 ? budgetDeadline : Number.POSITIVE_INFINITY,
    )
  }

  /**
   * The wait an opted-in root takes where it would stop (STOP-PAUSE in `./driver-retry.ts`). Emits
   * one record carrying `replacesStop`, sleeps until the ladder ends, a cancel or a root steer, and
   * resets the per-window counters. A cancel during the pause emits one `aborted` record and
   * throws; so does a declared deadline the pause reached. A failure re-enters as `driver-failure`.
   */
  private async stopPause(
    error: unknown,
    stop: DriverAttemptStop,
    record: DriverAttemptRecord,
  ): Promise<void> {
    const { run, limits } = this
    const steering = run.stopPause
    if (steering === undefined) throw new DriverAttemptsExhaustedError(error, this.attempts, stop)
    this.stopPauses += 1
    const pausedAt = limits.now()
    const pauseMs = Math.max(
      0,
      Math.min(
        cappedDoublingMs(this.stopPauses, BARREN_PAUSE_FIRST_MS, BARREN_PAUSE_MAX_MS),
        this.deadlineAt() - pausedAt,
      ),
    )
    await this.emit({
      ...record,
      replacesStop: stop,
      stopPauseStreak: this.stopPauses,
      retryInMs: pauseMs,
      resumeAt: new Date(pausedAt + pauseMs).toISOString(),
    })
    // A steer ends every pause, a budget pause included: it is how an operator changes a live
    // run. `steered` answers each steer once, so a pool still spent pauses again on its ladder.
    const steered = new AbortController()
    const wait = AbortSignal.any([run.signal, steered.signal])
    void steering.steered(wait).then(() => steered.abort())
    try {
      await limits.sleep(pauseMs, wait)
    } finally {
      steered.abort()
    }
    const ended = run.signal.aborted
      ? abortStop(run.signal)
      : limits.now() >= this.deadlineAt()
        ? 'deadline'
        : undefined
    if (ended !== undefined) {
      await this.emit({ attempt: record.attempt, durationMs: 0, madeProgress: false, stop: ended })
      throw new DriverAttemptsExhaustedError(error, this.attempts, ended)
    }
    this.chargedFailures = 0
    this.consecutiveBarren = 0
    this.pendingTries = 0
    this.abandonments = 0
    this.outageSince = undefined
    // The same rule as a failure retry: the failed drive may never have read a re-prompt.
    if (record.error !== undefined) {
      this.reentry = {
        reason: 'driver-failure',
        failure: errMessage(error),
        retry: this.failures,
        pausedMs: pauseMs,
      }
    }
  }

  private failureRecord(failure: DriverFailure) {
    const producerFailure = turnFailureOf(failure.error)
    const stack = errorStack(failure.error)
    return {
      attempt: failure.attempt,
      durationMs: failure.durationMs,
      error: errMessage(failure.error),
      ...(stack === undefined ? {} : { errorStack: stack }),
      ...(producerFailure === undefined ? {} : { failure: producerFailure }),
      classification: failure.classification,
      ...(failure.classification === 'transient'
        ? { failureKind: transientFailureKind(failure.error) }
        : {}),
      madeProgress: failure.progressed,
    }
  }

  private throwIfRetryBoundsReached(error: unknown): void {
    const { run } = this
    if (run.signal.aborted) {
      throw new DriverAttemptsExhaustedError(error, this.attempts, abortStop(run.signal))
    }
    const afterWait = budgetStop(run.budget(), this.limits.now())
    // A stop an opted-in root pauses on is left to the next admission, which pauses with the
    // re-entry this wait set.
    if (afterWait && !this.pausesStop(afterWait)) {
      throw new DriverAttemptsExhaustedError(error, this.attempts, afterWait)
    }
  }

  /** Read a failed drive, then pause or retry it, or throw the stop that ends the loop. */
  async afterFailure(
    error: unknown,
    attempt: number,
    before: DriverProgressMark,
    startedAt: number,
  ): Promise<void> {
    const durationMs = this.limits.now() - startedAt
    const classification = classifyDriverFailure(error, this.run.signal, this.run.stopSignal)
    const after = this.run.progress()
    const progressed = madeProgress(before, after)
    if (progressed) {
      this.abandonments = 0
      this.stopPauses = 0
      this.lastProgressAt = this.limits.now()
    }
    const pending = abandonablePending(error)
    const failure: DriverFailure = {
      error,
      attempt,
      startedAt,
      durationMs,
      classification,
      before,
      after,
      progressed,
      pending,
    }
    this.sameIdle = progressed ? undefined : extend(this.sameIdle, error)
    // A named rate limit or overload on a run with a deadline is never a repeated failure: the run
    // pauses with growing waits until the upstream answers, its budget or its deadline
    // (rehearsed-futures-sleep-20261111a died of repeated-failure on a busy GLM plan). Quota and
    // billing 429s, credential and placement refusals, an in-doubt execution, and any refusal on a
    // run without a deadline still settle after three unchanged drives.
    if (
      classification !== 'terminal' &&
      !(
        classification === 'unavailable' &&
        pending === undefined &&
        this.run.budget().deadlineMs > 0 &&
        RATE_LIMIT_SIGNALS.has((upstreamUnavailableSignal(error) ?? '').toLowerCase())
      ) &&
      !this.run.signal.aborted &&
      budgetStop(this.run.budget(), this.limits.now()) === undefined &&
      (this.sameIdle?.count ?? 0) >= SAME_CAUSE_LIMIT
    ) {
      const stop =
        pending === undefined || classification === 'unavailable'
          ? 'repeated-failure'
          : 'pending-unresolved'
      await this.emit({
        ...this.failureRecord(failure),
        stop,
        ...(error instanceof RetainedExecutionPendingError
          ? { pendingCause: error.pendingCause }
          : {}),
      })
      throw new DriverAttemptsExhaustedError(error, this.attempts, stop)
    }
    // Count reads of this invocation; the unchanged-cause streak survives its replacement.
    if (progressed) this.pendingTries = 0
    else if (pending !== undefined && classification === 'transient') {
      this.pendingTries = this.sameIdle?.count === 1 ? 1 : this.pendingTries + 1
    }
    if (classification === 'unavailable') await this.pause(failure)
    else await this.retry(failure)
  }

  // Capacity waits charge no failure allowance; only rate limits are exempt from the unchanged-cause ceiling.
  private async pause(failure: DriverFailure): Promise<void> {
    const { run, limits } = this
    const { error, progressed } = failure
    const unavailableSignal = upstreamUnavailableSignal(error) ?? 'unavailable'
    const rotatingSeat = run.seatChain === true && unavailableSignal === 'subscription-usage-limit'
    if (progressed) this.barrenReentries = 0
    const stop = ((): DriverAttemptStop | undefined => {
      if (run.signal.aborted) return abortStop(run.signal)
      if (!limits.retryEnabled) return 'retry-disabled'
      const byBudget = budgetStop(run.budget(), limits.now())
      if (byBudget) return byBudget
      // A reset after the deadline is a refusal now, so the parent acts instead of a child that
      // holds its slot for days (zro-w4a16-hopper-20261104b s4 paused toward 2026-11-10).
      const deadline = run.budget().deadlineMs
      return !rotatingSeat &&
        deadline > 0 &&
        (reportedResetAt(error, limits.now()) ?? 0) >= deadline
        ? 'deadline'
        : undefined
    })()
    if (stop !== undefined) {
      await this.stopOrPause(error, stop, { ...this.failureRecord(failure), unavailableSignal })
      return
    }
    this.pauses += 1
    this.consecutivePauses = progressed ? 1 : this.consecutivePauses + 1
    // A refusal that names its reset holds until then, never past the run's deadline: probing a
    // 5-hour plan window every 300 s spent 219 of magnetar-rust-20261018b's 324 attempts.
    const pausedAt = limits.now()
    const resetAt = rotatingSeat
      ? undefined
      : unavailableResumeAt(reportedResetAt(error, limits.now()), pausedAt)
    const deadlineMs = run.budget().deadlineMs
    const pause = rotatingSeat
      ? 0
      : resetAt === undefined
        ? jitteredMs(unavailablePauseMs(this.consecutivePauses, limits.policy), limits.random)
        : Math.max(1_000, Math.min(resetAt, deadlineMs > 0 ? deadlineMs : resetAt) - pausedAt)
    const exitCode = undispatchedCredentialExit(error)
    const resumeAt = resetAt ?? (exitCode === undefined ? undefined : pausedAt + pause)
    await this.emit({
      ...this.failureRecord(failure),
      unavailableSignal,
      ...(exitCode === undefined ? {} : { exitCode }),
      retryInMs: pause,
      ...(resumeAt === undefined ? {} : { resumeAt: new Date(resumeAt).toISOString() }),
    })
    // Re-enter with the ORIGINAL task, as a failure retry does.
    this.reentry = { reason: 'upstream-unavailable', signal: unavailableSignal, pause: this.pauses }
    await limits.sleep(pause, run.signal)
    // Waiting for capacity is not transient outage time: a streak begun before it keeps its age
    // (terraform-dc-tokens-20261006d's root waited out 16 minutes of capacity refusals).
    if (this.outageSince !== undefined) this.outageSince += limits.now() - failure.startedAt
    this.throwIfRetryBoundsReached(error)
  }

  private async retry(failure: DriverFailure): Promise<void> {
    const { run, limits } = this
    const { error, progressed } = failure
    const retainedFailure = error instanceof RetainedExecutionPendingError ? error : undefined
    this.consecutivePauses = 0
    this.failures += 1
    const failedAt = limits.now()
    const stop = this.failureStop(failure, failedAt)
    const abandoned = await this.abandonPending(failure, stop)
    const retryStop = abandoned
      ? undefined
      : failure.pending && stop === 'no-progress'
        ? 'pending-unresolved'
        : stop

    if (progressed) this.barrenReentries = 0
    if (retryStop !== undefined) {
      await this.stopOrPause(error, retryStop, {
        ...this.failureRecord(failure),
        ...(retainedFailure === undefined ? {} : { pendingCause: retainedFailure.pendingCause }),
      })
      return
    }

    if (!abandoned) this.consecutiveBarren = progressed ? 0 : this.consecutiveBarren + 1
    const backoff = jitteredMs(
      cappedDoublingMs(this.consecutiveBarren, limits.initialBackoff, limits.maxBackoff),
      limits.random,
    )
    await this.emit({
      ...this.failureRecord(failure),
      ...(abandoned ? { abandoned: true } : {}),
      retryInMs: backoff,
    })
    // Re-enter with the ORIGINAL task (the failed drive may never have read a re-prompt) and why.
    this.reentry = { reason: 'driver-failure', failure: errMessage(error), retry: this.failures }
    await limits.sleep(backoff, run.signal)
    // The wait is where an abort or a deadline most often lands; re-ask before re-entering.
    this.throwIfRetryBoundsReached(error)
  }

  /** Advance the failure streaks with this failure, and read the stop they reach, if any. */
  private failureStop(failure: DriverFailure, failedAt: number): DriverAttemptStop | undefined {
    const { run, limits } = this
    const { error, classification, progressed, before, after } = failure
    const kind = classification === 'transient' ? transientFailureKind(error) : undefined
    const idle =
      kind === 'infra' &&
      !progressed &&
      after.poolTokensSpent === before.poolTokensSpent &&
      after.settledCount === before.settledCount
    if (!idle) this.outageSince = undefined
    else this.outageSince ??= failedAt
    // A transient streak in which nothing ran is an outage while it is young: it is retried like
    // a pause, and the failure bounds apply only once it outlasts `transientOutageMs`.
    const inOutage = idle && failedAt - (this.outageSince ?? failedAt) < limits.transientOutage
    if (!inOutage) this.chargedFailures += 1
    // An aborted run failed because it was stopped, so the abort names the stop, not the failure.
    if (run.signal.aborted) return abortStop(run.signal)
    if (classification === 'terminal') return 'terminal-error'
    if (!limits.retryEnabled) return 'retry-disabled'
    const byBudget = budgetStop(run.budget(), failedAt)
    if (byBudget) return byBudget
    if (
      kind === 'deterministic' &&
      failure.pending === undefined &&
      (this.sameIdle?.count ?? 0) >= SAME_DETERMINISTIC_LIMIT
    )
      return 'repeated-failure'
    if (inOutage) return undefined
    if (this.chargedFailures >= limits.maxAttempts) return 'max-attempts'
    // Progress resets the barren counter: a driver that is doing real work between crashes
    // has earned another attempt, and the budget remains the bound on how many. Progress is
    // read run-wide, so an attempt that dies on arrival with the same error is bounded here.
    if (progressed) return undefined
    return this.consecutiveBarren + 1 >= limits.maxConsecutive ? 'no-progress' : undefined
  }

  // A pending invocation that failed reconciliation the same way twice, or that would now end the
  // run, is abandoned instead of retried (recording what the provider confirmed), and the next
  // drive starts a new invocation. Abandonments in a row without progress are bounded too.
  private async abandonPending(
    failure: DriverFailure,
    stop: DriverAttemptStop | undefined,
  ): Promise<boolean> {
    const { run, limits } = this
    const { pending } = failure
    if (
      pending === undefined ||
      this.sameIdle === undefined ||
      run.resolvePending === undefined ||
      !limits.retryEnabled ||
      run.signal.aborted ||
      this.abandonments >= limits.maxConsecutive ||
      !(stop === 'no-progress' || (stop === undefined && this.pendingTries >= SAME_PENDING_LIMIT))
    ) {
      return false
    }
    const abandoned = await run.resolvePending(pending, this.pendingTries)
    if (abandoned) {
      this.abandonments += 1
      this.pendingTries = 0
      this.consecutiveBarren = 0
      this.outageSince = undefined
    }
    return abandoned
  }

  /** Decide what a completed drive with its check unmet does next, under every failure-path bound,
   *  read again after the note is composed (composing may run the question panel). */
  private async decideContinuation(
    policy: DriverContinuationPolicy,
    attempt: number,
    after: DriverProgressMark,
  ): Promise<
    | { steer: string; barren?: { streak: number; pausedMs: number } }
    | { refusedBy: DriverRepromptRefusal }
  > {
    const { run } = this
    const now = this.limits.now
    const bounds = (): DriverRepromptRefusal | undefined => {
      if (policy.closed()) return 'closed'
      if (run.signal.aborted) return abortStop(run.signal)
      if (policy.deadlineMs !== undefined && now() >= policy.deadlineMs) return 'deadline'
      const byBudget = budgetStop(run.budget(), now())
      return byBudget === 'deadline' || byBudget === 'budget-exhausted' ? byBudget : undefined
    }
    const before = bounds()
    if (before !== undefined) return { refusedBy: before }
    const barren = await this.barrenPause(policy, attempt)
    if (barren !== undefined) {
      const afterPause = bounds()
      if (afterPause !== undefined) return { refusedBy: afterPause }
    }
    const steer = (
      await policy.compose({
        attempt,
        continuations: this.continuations,
        progress: after,
        budget: run.budget(),
        barrenReentries: this.barrenReentries,
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

  /** A barren streak at `maxBarren` paces the run and never ends it: journal the pause and sleep
   *  through it, never past the earlier deadline; the caller reads the bounds again after. */
  private async barrenPause(
    policy: DriverContinuationPolicy,
    attempt: number,
  ): Promise<{ streak: number; pausedMs: number } | undefined> {
    if (this.barrenReentries < policy.maxBarren) return undefined
    const { run } = this
    const pausedAt = this.limits.now()
    const pauseMs = Math.max(
      0,
      Math.min(barrenPauseMs(this.barrenReentries, policy.maxBarren), this.deadlineAt() - pausedAt),
    )
    const pause: DriverBarrenPause = {
      attempt,
      streak: this.barrenReentries,
      pauseMs,
      resumeAt: new Date(pausedAt + pauseMs).toISOString(),
      lastProgressAt: new Date(this.lastProgressAt).toISOString(),
    }
    await run.onBarrenPause?.(pause)
    await this.limits.sleep(pauseMs, run.signal)
    return { streak: this.barrenReentries, pausedMs: pauseMs }
  }

  /** Read a completed drive: wait, continue, or end the loop. True re-enters the driver. */
  async afterCompletion(
    attempt: number,
    before: DriverProgressMark,
    startedAt: number,
  ): Promise<boolean> {
    const { run } = this
    const { continuation } = run
    // A completed invocation ends every failure streak, even with the check unmet; the barren
    // re-entry count is a different fact and a completion alone never resets it.
    this.consecutiveBarren = 0
    this.consecutivePauses = 0
    this.outageSince = undefined
    this.pendingTries = 0
    this.sameIdle = undefined
    this.abandonments = 0
    const durationMs = this.limits.now() - startedAt
    let after = run.progress()
    const progressed = madeProgress(before, after)
    let contract = contractOf(after)
    let completed = {
      attempt,
      durationMs,
      madeProgress: progressed,
      ...(contract === 'none' ? {} : { contract }),
    }
    if (progressed) {
      this.barrenReentries = 0
      this.stopPauses = 0
      this.lastProgressAt = this.limits.now()
    } else if (
      !this.beforeModelEvent &&
      this.reentry !== undefined &&
      this.reentry.reason !== 'wake' &&
      contract === 'unmet'
    ) {
      this.barrenReentries += 1
    }
    if (run.wait !== undefined && contract !== 'met') {
      const waited = await this.wake(attempt, completed, after)
      if (waited.reentered) return true
      after = waited.progress
      contract = contractOf(after)
      completed = {
        attempt,
        durationMs,
        madeProgress: madeProgress(before, after),
        ...(contract === 'none' ? {} : { contract }),
      }
    }
    if (contract === 'unmet' && continuation !== undefined) {
      let decision = await this.decideContinuation(continuation, attempt, after)
      // An opted-in root pauses on a spent budget and reads the bounds again once it ends.
      while ('refusedBy' in decision && decision.refusedBy === 'budget-exhausted') {
        if (!this.pausesStop('budget-exhausted')) break
        await this.stopPause(admissionError('budget-exhausted'), 'budget-exhausted', {
          attempt,
          durationMs,
          madeProgress: false,
        })
        decision = await this.decideContinuation(continuation, attempt, after)
      }
      if ('steer' in decision) {
        this.continuations += 1
        // No failure backoff: the driver is not failing, it finished early. A barren pause, when
        // the streak called for one, was taken before the note was composed.
        await this.emit({
          ...completed,
          reprompted: true,
          retryInMs: 0,
          ...(decision.barren === undefined ? {} : { barrenPauseMs: decision.barren.pausedMs }),
        })
        this.reentry = {
          reason: 'unmet-contract',
          steer: decision.steer,
          continuation: this.continuations,
          ...(decision.barren === undefined ? {} : { barren: decision.barren }),
        }
        return true
      }
      await this.emit({ ...completed, repromptRefusedBy: decision.refusedBy, stop: 'completed' })
      return false
    }
    await this.emit({ ...completed, stop: 'completed' })
    return false
  }

  // A turn that ends with work open is a wait. The bounds the failure path applies hold here
  // too; a closed run (accepted, stopped, blocked) never waits.
  private async wake(
    attempt: number,
    completed: Pick<DriverAttemptRecord, 'attempt' | 'durationMs' | 'madeProgress' | 'contract'>,
    beforeWait: DriverProgressMark,
    held?: { readonly input: string; readonly idleMs: number },
  ): Promise<{ readonly reentered: boolean; readonly progress: DriverProgressMark }> {
    const { run } = this
    const wait = run.wait
    if (
      wait === undefined ||
      (run.continuation?.closed() ?? false) ||
      run.signal.aborted ||
      !wait.open()
    ) {
      return { reentered: false, progress: beforeWait }
    }
    const stop = budgetStop(run.budget(), this.limits.now())
    // A deadline ends the wait; an opted-in root pauses on a spent pool, where a steer reaches it.
    if (stop === 'deadline' || (stop !== undefined && this.pausesStop(stop)))
      return { reentered: false, progress: beforeWait }
    const woken = await wait.wake(attempt + 1)
    const afterWait = run.progress()
    // Coordination can deliver checked work while the manager waits between native turns.
    if (madeProgress(beforeWait, afterWait)) {
      completed = { ...completed, madeProgress: true }
      this.barrenReentries = 0
      this.stopPauses = 0
      this.lastProgressAt = this.limits.now()
    }
    if (woken === undefined || run.signal.aborted) return { reentered: false, progress: afterWait }
    const input = held ? `${held.input}\n\n${woken.input}` : woken.input
    const idleMs = woken.idleMs + (held?.idleMs ?? 0)
    // A spent pool buys no turn, but a wait spends nothing: the running workers hold reservations
    // the pool granted, so hold until a refund buys the turn, which then reads what arrived.
    if (budgetStop(run.budget(), this.limits.now()) !== undefined)
      return this.wake(attempt, completed, afterWait, { input, idleMs })
    this.wakes += 1
    await this.emit({ ...completed, waitedMs: idleMs, retryInMs: 0 })
    this.reentry = { reason: 'wake', input, wake: this.wakes }
    return { reentered: true, progress: afterWait }
  }
}
