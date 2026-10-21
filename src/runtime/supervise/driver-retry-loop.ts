import { ValidationError } from '../../errors'
import { sleep } from '../util'
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
import type {
  DriverBudgetReadout,
  DriverContinuationPolicy,
  DriverContractState,
  DriverProgressMark,
  DriverReentry,
  DriverRetryPolicy,
  DriverRetryRun,
} from './driver-retry'
import { errMessage } from './error-message'
import { RetainedExecutionPendingError, type RetainedPendingCause } from './retained-executor'
import {
  cappedDoublingMs,
  jitteredMs,
  unavailablePauseMs,
  unavailableResumeAt,
} from './upstream-unavailable'

const DEFAULT_MAX_CONSECUTIVE_FAILURES = 3
const DEFAULT_MAX_ATTEMPTS = Number.POSITIVE_INFINITY
const DEFAULT_INITIAL_BACKOFF_MS = 2_000
const DEFAULT_MAX_BACKOFF_MS = 30_000
const DEFAULT_TRANSIENT_OUTAGE_MS = 900_000

/**
 * The repeated-failure bound: {@link REPEATED_FAILURE_LIMIT} or more attempts in a row, each
 * failing within {@link INSTANT_FAILURE_MS} with the same error over at least
 * {@link REPEATED_FAILURE_WINDOW_MS}, stop the run with `repeated-failure`. The progress mark is
 * run-wide, so a driver dying on arrival reads as progressing while other nodes spend: run
 * magnetar-rust-20261017c failed 1,258 of 2,069 root attempts with 'connect ECONNREFUSED
 * 127.0.0.1:32897'. The window keeps a seconds-long local restart from ending a run.
 */
const INSTANT_FAILURE_MS = 30_000
const REPEATED_FAILURE_LIMIT = 10
const REPEATED_FAILURE_WINDOW_MS = 5 * 60_000
/** Consecutive identical reconciliation failures of one pending invocation that resolve it. */
const SAME_PENDING_LIMIT = 2

/**
 * Consecutive attempts ending in the same Sandbox `PartialFailureError` (a box created that then
 * failed its setup) with nothing gained stop the loop: the retained execution is bound durably to
 * the node, so each re-entry meets the same box and failure. Run queens21-h22-capture-root-1-
 * 20261019c re-entered four such boxes 154 times in 37 minutes on `mkdir: cannot create directory
 * '/work': Read-only file system`, inside the transient-outage window. A second identical attempt
 * proves what a third repeats; a different failure, or any progress, restarts the count.
 */
const SAME_PARTIAL_FAILURE_LIMIT = 2

/** The budget's own verdict on whether another attempt may run at all. */
function budgetStop(budget: DriverBudgetReadout, atMs: number): DriverAttemptStop | undefined {
  if (budget.deadlineMs > 0 && atMs >= budget.deadlineMs) return 'deadline'
  if (budget.tokensLeft <= 0 || budget.iterationsLeft <= 0) return 'budget-exhausted'
  if (budget.usdCapped && budget.usdLeft <= 0) return 'budget-exhausted'
  // A dollar-capped pool that has seen an unknown-cost turn closes admission permanently: a retry
  // could only reproduce the same refusal.
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
 * Did this attempt move the run toward its DELIVERABLE? A delivery always counts (an accepted
 * submission, a child that passed the check, the contract turning met, a rise in the best
 * composite). Spend and settlements count only while no declared check is outstanding; with one
 * unmet they are the burn-rate reading the header rejects.
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
  // Consecutive failures that left the same unfinished retained invocation pending for the same
  // reason, and the abandonments since the last progress or completed drive.
  private samePending: { readonly cause: RetainedPendingCause; readonly count: number } | undefined
  // The current streak of instant failures with one error, and when its first one failed.
  private sameFailure:
    | { readonly error: string; readonly count: number; readonly since: number }
    | undefined
  // The current streak of identical `PartialFailureError` attempts that gained nothing.
  private samePartial: { readonly error: string; readonly count: number } | undefined
  private abandonments = 0
  // Every pause this loop took, for the re-entry it names.
  private pauses = 0
  private continuations = 0
  private wakes = 0
  reentry: DriverReentry | undefined
  /** Whether the current attempt began before the re-entered root's first model event. */
  beforeModelEvent = false

  constructor(
    private readonly run: DriverRetryRun,
    private readonly limits: DriverRetryLimits,
  ) {
    this.reentry = run.reentered?.first
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

  /** True when the loop returns before this attempt; throws when no attempt ever completed. */
  admissionRefused(): boolean {
    const { run } = this
    const admissionStop = run.signal.aborted
      ? 'aborted'
      : budgetStop(run.budget(), this.limits.now())
    if (admissionStop === undefined) return false
    // A completed-but-unmet invocation remains completed; its finalizer owns acceptance.
    if (this.attempts.length > 0) return true
    throw new DriverAttemptsExhaustedError(
      run.signal.aborted
        ? run.signal.reason
        : new ValidationError(`driver admission: ${admissionStop}`),
      this.attempts,
      admissionStop,
    )
  }

  private failureRecord(failure: DriverFailure) {
    return {
      attempt: failure.attempt,
      durationMs: failure.durationMs,
      error: errMessage(failure.error),
      classification: failure.classification,
      madeProgress: failure.progressed,
    }
  }

  private throwIfRetryBoundsReached(error: unknown): void {
    const { run } = this
    if (run.signal.aborted) {
      throw new DriverAttemptsExhaustedError(error, this.attempts, 'aborted')
    }
    const afterWait = budgetStop(run.budget(), this.limits.now())
    if (afterWait) {
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
    const classification = classifyDriverFailure(error, this.run.signal)
    const after = this.run.progress()
    const progressed = madeProgress(before, after)
    if (progressed) this.abandonments = 0
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
    this.samePending =
      pending === undefined || classification !== 'transient'
        ? undefined
        : {
            cause: pending.pendingCause,
            count:
              this.samePending?.cause === pending.pendingCause ? this.samePending.count + 1 : 1,
          }
    if (classification === 'unavailable') await this.pause(failure)
    else await this.retry(failure)
  }

  // A pause, not a failure: neither `failures` nor the barren streak moves, so an outage of
  // any length ends the run only at the deadline, the budget, or a cancellation.
  private async pause(failure: DriverFailure): Promise<void> {
    const { run, limits } = this
    const { error, progressed } = failure
    if (progressed) this.barrenReentries = 0
    const stop = ((): DriverAttemptStop | undefined => {
      if (!limits.retryEnabled) return 'retry-disabled'
      if (run.signal.aborted) return 'aborted'
      return budgetStop(run.budget(), limits.now())
    })()
    const unavailableSignal = upstreamUnavailableSignal(error) ?? 'unavailable'
    if (stop !== undefined) {
      await this.emit({ ...this.failureRecord(failure), unavailableSignal, stop })
      throw new DriverAttemptsExhaustedError(error, this.attempts, stop)
    }
    this.pauses += 1
    this.consecutivePauses = progressed ? 1 : this.consecutivePauses + 1
    // A refusal that names its reset holds until then, never past the run's deadline: probing a
    // 5-hour plan window every 300 s spent 219 of magnetar-rust-20261018b's 324 attempts.
    const pausedAt = limits.now()
    const resetAt = unavailableResumeAt(errMessage(error), pausedAt)
    const deadlineMs = run.budget().deadlineMs
    const pause =
      resetAt === undefined
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
    // The same rule as a failure retry: re-enter with the ORIGINAL task and the run's state,
    // because the refused turn may have ended before it read a re-prompt.
    this.reentry = { reason: 'upstream-unavailable', signal: unavailableSignal, pause: this.pauses }
    await limits.sleep(pause, run.signal)
    // Waiting for capacity is not transient outage time. A transient streak that began before
    // the refusal keeps its own age, so a capacity outage longer than `transientOutageMs`
    // cannot end the run on the next transient failure. Measured 2026-10-07 on Discovery run
    // terraform-dc-tokens-20261006d: its root waited out capacity refusals for 16 minutes.
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
    // A pending invocation that would be abandoned again after the run spent its abandonments
    // without progress is not retried until the outage window or barren bound ends it: each
    // replacement failed reconciliation the same way (terraform-dc-build-20261009g-fork re-entered
    // one stopped sandbox 52 times over 26 minutes). The stop names the pending cause.
    const unresolved =
      !abandoned &&
      !progressed &&
      failure.pending !== undefined &&
      this.samePending !== undefined &&
      run.resolvePending !== undefined &&
      this.abandonments >= limits.maxConsecutive &&
      this.samePending.count >= SAME_PENDING_LIMIT &&
      (stop === undefined || stop === 'no-progress')
    const retryStop = abandoned ? undefined : unresolved ? 'pending-unresolved' : stop

    if (progressed) this.barrenReentries = 0
    if (retryStop !== undefined) {
      await this.emit({
        ...this.failureRecord(failure),
        stop: retryStop,
        ...(retainedFailure === undefined ? {} : { pendingCause: retainedFailure.pendingCause }),
      })
      throw new DriverAttemptsExhaustedError(error, this.attempts, retryStop)
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
    // A retry re-enters with the ORIGINAL task. The drive that just failed may have died before
    // it read the re-prompt at all, so replaying the unmet-items text in its place would drop
    // the run's actual instruction. The failure itself travels, so the caller can say why.
    this.reentry = { reason: 'driver-failure', failure: errMessage(error), retry: this.failures }
    await limits.sleep(backoff, run.signal)
    // The wait is where an abort or a deadline most often lands; re-ask before re-entering.
    this.throwIfRetryBoundsReached(error)
  }

  /** Advance the failure streaks with this failure, and read the stop they reach, if any. */
  private failureStop(failure: DriverFailure, failedAt: number): DriverAttemptStop | undefined {
    const { run, limits } = this
    const { error, classification, progressed, before, after } = failure
    const idle =
      classification === 'transient' &&
      !progressed &&
      after.poolTokensSpent === before.poolTokensSpent &&
      after.settledCount === before.settledCount
    if (!idle) this.outageSince = undefined
    else this.outageSince ??= failedAt
    // A transient streak in which nothing ran is an outage while it is young: it is retried like
    // a pause, and the failure bounds apply only once it outlasts `transientOutageMs`.
    const inOutage = idle && failedAt - (this.outageSince ?? failedAt) < limits.transientOutage
    if (!inOutage) this.chargedFailures += 1
    const message = errMessage(error)
    const sameFailure =
      failure.durationMs >= INSTANT_FAILURE_MS
        ? undefined
        : this.sameFailure?.error === message
          ? { error: message, count: this.sameFailure.count + 1, since: this.sameFailure.since }
          : { error: message, count: 1, since: failedAt }
    this.sameFailure = sameFailure
    const repeated =
      sameFailure !== undefined &&
      sameFailure.count >= REPEATED_FAILURE_LIMIT &&
      failedAt - sameFailure.since >= REPEATED_FAILURE_WINDOW_MS
    const samePartial =
      classification === 'transient' &&
      !progressed &&
      failure.pending === undefined &&
      causedByPartialFailure(error)
        ? {
            error: message,
            count: this.samePartial?.error === message ? this.samePartial.count + 1 : 1,
          }
        : undefined
    this.samePartial = samePartial
    if (classification === 'terminal') return 'terminal-error'
    if (!limits.retryEnabled) return 'retry-disabled'
    if (run.signal.aborted) return 'aborted'
    const byBudget = budgetStop(run.budget(), failedAt)
    if (byBudget) return byBudget
    // The same failed box twice with nothing gained: the outage window below would retry it
    // for fifteen minutes, because the attempt spent nothing.
    if (samePartial !== undefined && samePartial.count >= SAME_PARTIAL_FAILURE_LIMIT) {
      return 'repeated-failure'
    }
    if (inOutage) return undefined
    if (this.chargedFailures >= limits.maxAttempts) return 'max-attempts'
    // Progress resets the barren counter: a driver that is doing real work between crashes
    // has earned another attempt, and the budget remains the bound on how many. Progress is
    // read run-wide, so an attempt that dies on arrival with the same error is bounded here.
    if (progressed) return repeated ? 'repeated-failure' : undefined
    return this.consecutiveBarren + 1 >= limits.maxConsecutive ? 'no-progress' : undefined
  }

  // A pending invocation that failed reconciliation the same way twice, or that would now end the
  // run, is abandoned instead of retried (recording what the provider confirmed), and the next
  // drive starts a new invocation with a new streak. Abandonments in a row without progress are
  // bounded like failures, so a provider that loses every execution still ends the run.
  private async abandonPending(
    failure: DriverFailure,
    stop: DriverAttemptStop | undefined,
  ): Promise<boolean> {
    const { run, limits, samePending } = this
    const { pending } = failure
    if (
      pending === undefined ||
      samePending === undefined ||
      run.resolvePending === undefined ||
      !limits.retryEnabled ||
      run.signal.aborted ||
      this.abandonments >= limits.maxConsecutive ||
      !(stop === 'no-progress' || (stop === undefined && samePending.count >= SAME_PENDING_LIMIT))
    ) {
      return false
    }
    const abandoned = await run.resolvePending(pending, samePending.count)
    if (abandoned) {
      this.abandonments += 1
      this.samePending = undefined
      this.consecutiveBarren = 0
      this.outageSince = undefined
    }
    return abandoned
  }

  /**
   * Decide what a completed drive with its check unmet does next. Every bound the FAILURE path
   * applies is applied here too (`budgetStop` once lived only in the catch arm), and read again
   * after the note is composed, because composing may run the question panel.
   */
  private async decideContinuation(
    policy: DriverContinuationPolicy,
    attempt: number,
    after: DriverProgressMark,
  ): Promise<{ steer: string } | { refusedBy: DriverRepromptRefusal }> {
    const { run } = this
    const now = this.limits.now
    const bounds = (): DriverRepromptRefusal | undefined => {
      if (policy.closed()) return 'closed'
      if (run.signal.aborted) return 'aborted'
      if (now() >= policy.deadlineMs) return 'deadline'
      const byBudget = budgetStop(run.budget(), now())
      return byBudget === 'deadline' || byBudget === 'budget-exhausted' ? byBudget : undefined
    }
    if (this.barrenReentries >= policy.maxBarren) return { refusedBy: 'no-progress' }
    const before = bounds()
    if (before !== undefined) return { refusedBy: before }
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
    return { steer }
  }

  /** Read a completed drive: wait, continue, or end the loop. True re-enters the driver. */
  async afterCompletion(
    attempt: number,
    before: DriverProgressMark,
    startedAt: number,
  ): Promise<boolean> {
    const { run } = this
    const { continuation } = run
    // A completed invocation ends the transport-failure streak, even while the pursuit's
    // independent completion check remains unmet. Successful continuation is not a failure. The
    // barren re-entry count is a different fact and a completion alone never resets it.
    this.consecutiveBarren = 0
    this.consecutivePauses = 0
    this.outageSince = undefined
    this.samePending = undefined
    this.sameFailure = undefined
    this.samePartial = undefined
    this.abandonments = 0
    const durationMs = this.limits.now() - startedAt
    const after = run.progress()
    const progressed = madeProgress(before, after)
    const contract = contractOf(after)
    const completed = {
      attempt,
      durationMs,
      madeProgress: progressed,
      ...(contract === 'none' ? {} : { contract }),
    }
    if (progressed) this.barrenReentries = 0
    else if (
      !this.beforeModelEvent &&
      this.reentry !== undefined &&
      this.reentry.reason !== 'wake' &&
      contract === 'unmet'
    ) {
      this.barrenReentries += 1
    }
    if (contract !== 'met' && (await this.wake(attempt, completed))) return true
    if (contract === 'unmet' && continuation !== undefined) {
      const decision = await this.decideContinuation(continuation, attempt, after)
      if ('steer' in decision) {
        this.continuations += 1
        // No backoff: the driver is not failing — it finished early.
        await this.emit({ ...completed, reprompted: true, retryInMs: 0 })
        this.reentry = {
          reason: 'unmet-contract',
          steer: decision.steer,
          continuation: this.continuations,
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
  ): Promise<boolean> {
    const { run } = this
    const wait = run.wait
    if (
      wait === undefined ||
      (run.continuation?.closed() ?? false) ||
      run.signal.aborted ||
      budgetStop(run.budget(), this.limits.now()) !== undefined ||
      !wait.open()
    ) {
      return false
    }
    const woken = await wait.wake(attempt + 1)
    if (woken === undefined || run.signal.aborted) return false
    this.wakes += 1
    await this.emit({ ...completed, waitedMs: woken.idleMs, retryInMs: 0 })
    this.reentry = { reason: 'wake', input: woken.input, wake: this.wakes }
    return true
  }
}
