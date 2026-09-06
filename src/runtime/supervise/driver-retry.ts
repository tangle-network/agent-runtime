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
 * `reprompt.maxReprompts` re-enters the SAME live session with the unmet items, and every re-entry
 * crosses the same budget, deadline, abort, and attempt bounds a retry crosses.
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

/** Whether the run's declared completion check has passed. `'none'` means the caller declared no
 *  check at all — the retry then reads spend and settlements exactly as it always has. */
export type DriverContractState = 'met' | 'unmet' | 'none'

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
  /** The completion check's verdict after this attempt. Absent when the caller declares none. */
  readonly contract?: DriverContractState
  /** True when this COMPLETED attempt's unmet contract sent the loop back into the live session. */
  readonly reprompted?: boolean
  /** Why an unmet contract did NOT re-enter the session. Absent when the contract was met, when
   *  the caller configured no re-prompt, or when the re-prompt was issued. */
  readonly repromptRefusedBy?: DriverRepromptRefusal
}

/** Why a completed drive with an unmet contract was not re-entered. */
export type DriverRepromptRefusal =
  | 'reprompts-exhausted'
  | 'caller-stop'
  | Extract<DriverAttemptStop, 'aborted' | 'budget-exhausted' | 'deadline' | 'max-attempts'>

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
}

/** Why the loop is entering the driver again, and with what. Absent on a first attempt and on
 *  every failure retry — those re-enter with the caller's ORIGINAL task, because a driver that
 *  crashed may never have read it. */
export interface DriverReentry {
  readonly reason: 'unmet-contract'
  /** The instruction to re-enter the LIVE session with: the unmet items, not the original task. */
  readonly steer: string
  /** 1-based: which re-prompt this is. */
  readonly reprompt: number
}

/** What the caller sees when a drive returns with its completion check unmet. */
export interface DriverUnmetContractContext {
  /** The attempt that just completed, 1-based. */
  readonly attempt: number
  /** How many re-prompts this run has already issued. */
  readonly reprompts: number
  readonly maxReprompts: number
  /** The mark read AFTER the completed drive. */
  readonly progress: DriverProgressMark
  readonly budget: DriverBudgetReadout
  /** What the run was supposed to produce, from the caller's completion check. */
  readonly describe?: string
}

/** The caller's answer: re-enter the session with `steer`, or end the run here. */
export type DriverUnmetContractDecision = { readonly steer: string } | 'stop'

/** Compose the re-entry instruction for a completed drive that delivered nothing, or refuse. */
export type OnUnmetContract = (
  context: DriverUnmetContractContext,
) => DriverUnmetContractDecision | Promise<DriverUnmetContractDecision>

/** How a completed-but-undelivered drive is re-entered. Absent = the historical behavior, where
 *  such a drive ends the run and only the completion gate's label records what happened. */
export interface DriverRepromptPolicy {
  /** How many times one run may re-enter its live session with the unmet items. `0` = never. Each
   *  re-prompt also consumes an attempt, so `maxAttempts` bounds it too. */
  readonly maxReprompts: number
  /** Compose the instruction, or return `'stop'`. Omit = {@link defaultUnmetContractSteer}. */
  readonly onUnmetContract?: OnUnmetContract
  /** What the run owes, surfaced in the default instruction. */
  readonly describe?: string
}

/**
 * The instruction a completed-but-undelivered drive is re-entered with when the caller supplies no
 * `onUnmetContract`. It states the verdict, names what is owed, reports the ledger, and gives the
 * three steps — the same shape `depthStrategy` re-prompts a resumed session with, said in the
 * driver's own terms.
 */
export function defaultUnmetContractSteer(context: DriverUnmetContractContext): string {
  const owed = context.describe?.trim()
  const lines = [
    'The completion check has not passed. This run has delivered nothing yet.',
    owed === undefined || owed.length === 0
      ? 'The deliverable this run owes is still missing.'
      : `The deliverable this run owes: ${owed}`,
    `Workers settled: ${context.progress.settledCount}. ` +
      `Workers that passed the check: ${context.progress.deliveredCount ?? 0}.`,
    'Do the unfinished work with the tools.',
    'Verify that the check passes.',
    'Then submit the result.',
    'Do not restate work you already did.',
  ]
  return lines.join('\n')
}

export interface DriverRetryRun {
  /** Run one attempt. Rejects exactly as the un-retried driver would. `reentry` is present only
   *  for a re-prompt: run the SAME session on `reentry.steer` instead of the original task. */
  readonly drive: (attempt: number, reentry?: DriverReentry) => Promise<void>
  /** Read the current progress mark. Called before and after every attempt. */
  readonly progress: () => DriverProgressMark
  /** Read the live budget — the retry's real bound. */
  readonly budget: () => DriverBudgetReadout
  /** The scope's cancellation signal. An aborted scope is terminal, never retried. */
  readonly signal: AbortSignal
  readonly policy?: DriverRetryPolicy
  /** How a COMPLETED drive that delivered nothing is re-entered. Omit = never. */
  readonly reprompt?: DriverRepromptPolicy
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
 * Classify one driver failure. Runtime's own typed refusals are decisions and stay terminal;
 * anything foreign is an accident and is retryable. A `BackendTransportError` is split by status
 * because the taxonomy already promises consumers may branch on it: a 5xx/429/408 is the upstream
 * having a bad moment, while a 401/404/422 is a request that will fail identically forever. The
 * bridge's own never-retry classes are terminal whether or not a status rides with them.
 */
export function classifyDriverFailure(
  error: unknown,
  signal?: AbortSignal,
): 'transient' | 'terminal' {
  if (signal?.aborted) return 'terminal'
  if (error instanceof Error && error.name === 'AbortError') return 'terminal'
  if (error instanceof BackendTransportError) {
    if (error.upstreamCode !== undefined && DETERMINISTIC_BRIDGE_CODES.has(error.upstreamCode))
      return 'terminal'
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

function contractOf(mark: DriverProgressMark): DriverContractState {
  return mark.contract ?? 'none'
}

/**
 * Did this attempt move the run toward its DELIVERABLE?
 *
 * A delivery always counts: an accepted submission, one more child that passed the check, or the
 * contract turning met. Spend and settlements count only while no declared check is outstanding —
 * with a check unmet they are the burn-rate reading this module's header measures and rejects.
 */
function madeProgress(before: DriverProgressMark, after: DriverProgressMark): boolean {
  if (after.submitted && !before.submitted) return true
  if ((after.deliveredCount ?? 0) > (before.deliveredCount ?? 0)) return true
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
 * Run the driver until it completes WITH ITS CONTRACT MET, or until the budget, the deadline, an
 * abort, a terminal error, or a ceiling stops it. Transient failures are retried. A drive that
 * returns with its completion check unmet is re-entered on the same live session with the unmet
 * items, up to `reprompt.maxReprompts`. Throws `DriverAttemptsExhaustedError` (cause = the last
 * real failure) when a FAILURE ends the loop; a completed drive returns, met contract or not,
 * because deciding what an undelivered run is worth belongs to the finalizer, not to this loop.
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

  const maxReprompts = Math.max(0, run.reprompt?.maxReprompts ?? 0)

  const attempts: DriverAttemptRecord[] = []
  let consecutiveBarren = 0
  let reprompts = 0
  let reentry: DriverReentry | undefined

  const emit = async (record: DriverAttemptRecord): Promise<void> => {
    attempts.push(record)
    await run.onAttempt?.(record)
  }

  /**
   * Decide what a completed-but-undelivered drive does next. Every bound the FAILURE path applies
   * is applied here too — that is the fix for `budgetStop` having lived only in the catch arm — and
   * the caller's hook is consulted last, so no hook can talk the loop past a deadline.
   */
  const decideReprompt = async (
    attempt: number,
    after: DriverProgressMark,
  ): Promise<{ steer: string } | { refusedBy: DriverRepromptRefusal }> => {
    if (reprompts >= maxReprompts) return { refusedBy: 'reprompts-exhausted' }
    if (run.signal.aborted) return { refusedBy: 'aborted' }
    const byBudget = budgetStop(run.budget(), now())
    if (byBudget === 'deadline' || byBudget === 'budget-exhausted') return { refusedBy: byBudget }
    if (attempt >= maxAttempts) return { refusedBy: 'max-attempts' }
    const context: DriverUnmetContractContext = {
      attempt,
      reprompts,
      maxReprompts,
      progress: after,
      budget: run.budget(),
      ...(run.reprompt?.describe === undefined ? {} : { describe: run.reprompt.describe }),
    }
    const decision =
      (await run.reprompt?.onUnmetContract?.(context)) ??
      ({ steer: defaultUnmetContractSteer(context) } as const)
    if (decision === 'stop') return { refusedBy: 'caller-stop' }
    // Checked rather than assumed: JavaScript callers reach this hook too, and a non-string here
    // would otherwise become a TypeError inside the loop that owns the run.
    const steer = typeof decision.steer === 'string' ? decision.steer.trim() : ''
    if (steer.length === 0) {
      // An empty instruction would re-enter the session with nothing to act on, and the harness
      // would end again exactly as it just did. A misconfigured hook is a caller fault, so it is
      // named rather than absorbed into a silent stop.
      throw new ValidationError(
        'runDriverWithRetry: onUnmetContract returned an empty steer — return a non-empty ' +
          "instruction or 'stop'",
      )
    }
    return { steer }
  }

  for (let attempt = 1; ; attempt += 1) {
    const before = run.progress()
    const startedAt = now()
    // The completed-drive arm lives OUTSIDE this try. A configuration fault raised while deciding
    // the re-prompt is the caller's, not the driver's, and must reach the caller unwrapped instead
    // of being classified as one more driver failure.
    try {
      await run.drive(attempt, reentry)
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
      // A retry re-enters with the ORIGINAL task. The drive that just failed may have died before
      // it read the re-prompt at all, so replaying the unmet-items text in its place would drop
      // the run's actual instruction.
      reentry = undefined
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
      continue
    }

    const durationMs = now() - startedAt
    const after = run.progress()
    const progressed = madeProgress(before, after)
    const contract = contractOf(after)
    const contractField = contract === 'none' ? {} : { contract }
    if (contract === 'unmet' && maxReprompts > 0) {
      const decision = await decideReprompt(attempt, after)
      if ('steer' in decision) {
        reprompts += 1
        reentry = { reason: 'unmet-contract', steer: decision.steer, reprompt: reprompts }
        // No backoff: the session is alive and the driver is not failing — it finished early.
        await emit({
          attempt,
          durationMs,
          madeProgress: progressed,
          ...contractField,
          reprompted: true,
          retryInMs: 0,
        })
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
