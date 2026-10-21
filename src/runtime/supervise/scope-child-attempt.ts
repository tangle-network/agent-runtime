import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import {
  type HarnessTranscriptEvidence,
  persistHarnessTranscript,
  readHarnessTranscript,
} from '../harness-transcript'
import { type BudgetPool, BudgetReconcileFault, type ReservationTicket } from './budget'
import { teardownExecutor } from './deadline'
import { errMessage } from './error-message'
import { withBudgetResources } from './resources'
import type { LiveChild } from './scope-contract'
import { detachedSnapshot } from './snapshot'
import { captureWorkerTraceEvidence } from './trace-evidence'
import type {
  Executor,
  ExecutorResult,
  ResultBlobStore,
  SpawnOpts,
  Spend,
  WorkerTraceEvidence,
} from './types'

/**
 * One child execution's settle-once state: its output, trace and transcript evidence, its
 * teardown, and the single reconciliation of its reservation. Every settle exit of `runChild`
 * reads and writes this owner, so each piece of evidence is captured once whichever arm ends it.
 */
export class ChildExecutionAttempt<C> {
  /** The executor was invoked: a pre-execution refusal reconciles zero and refunds everything. */
  started = false
  /** The executor's terminal usage reached `live.spent`. */
  terminalTelemetryCaptured = false
  /** The reservation was reconciled; a later reconcile returns its first answer. */
  reconciled = false
  reconciliationError: unknown
  teardownFailure: unknown
  /** The content ref of the output this process stored, on every arm that has one. */
  retainedOutputRef: string | undefined
  private teardownStarted = false
  private traceEvidence: WorkerTraceEvidence | undefined
  // Like the trace: read once per settle exit, persisted under its own content ref, only the receipt
  // travels. Every arm carries it, failure arms included (#1244).
  private transcriptEvidence: HarnessTranscriptEvidence | undefined

  constructor(
    readonly live: LiveChild,
    readonly executor: Executor<C>,
    readonly childAbort: AbortController,
    readonly opts: SpawnOpts,
    private readonly pool: BudgetPool,
    private readonly ticket: ReservationTicket,
    private readonly blobs: ResultBlobStore,
    readonly now: () => number,
    private readonly deadlineAtMs: number | undefined,
    private readonly startedAt: number | undefined,
  ) {}

  async retainOutput(
    result: ExecutorResult<C>,
    measured: Spend = result.spent,
  ): Promise<ExecutorResult<C>> {
    const { live } = this
    // Capture valid usage before storage: a failed write must not refund paid-for execution.
    let usageError: unknown
    try {
      assertReportedSpend(result.spent, `scope.spawn ${live.id}`)
      live.spent = this.executor.accounting?.()?.reported ?? measured
      this.terminalTelemetryCaptured = true
      live.executorDone = true
    } catch (error) {
      usageError = error
    }
    // Output is evidence, not a success verdict. Preserve it even when terminal usage is invalid.
    const out = detachedSnapshot(result.out, 'scope child output')
    const outRef = contentAddress(out)
    await this.blobs.put(outRef, out)
    await live.traceRoots.write(outRef, out)
    this.retainedOutputRef = outRef
    if (usageError !== undefined) throw usageError
    return { ...result, out, outRef }
  }

  async captureTrace(): Promise<WorkerTraceEvidence> {
    this.traceEvidence ??= await captureWorkerTraceEvidence(
      this.live.readTraceSource,
      this.blobs,
      this.started,
    )
    return this.traceEvidence
  }

  async persistTranscript(): Promise<HarnessTranscriptEvidence> {
    this.transcriptEvidence ??= await persistHarnessTranscript(
      readHarnessTranscript(this.executor),
      this.blobs,
    )
    return this.transcriptEvidence
  }

  async teardown(grace: number | 'brutalKill' | 'infinity'): Promise<void> {
    if (this.teardownStarted) return
    this.teardownStarted = true
    const { live, executor } = this
    try {
      // An environment kept for a continuation this settlement will not offer is released too.
      await executor.heldForContinuation?.()?.release()
      await teardownExecutor(executor, grace, this.deadlineAtMs, this.now, live.askTeardown)
      live.cleanupConfirmed = true
    } catch (error) {
      this.teardownFailure = error
      live.teardownDetail = errMessage(error)
      throw error
    }
  }

  reconcile(spend: Spend): unknown | undefined {
    if (this.reconciled) return this.reconciliationError
    this.reconciled = true
    const { live, opts } = this
    // A pre-execution refusal reconciles zero and refunds the reservation; every executing path
    // reports measured or unknown spend.
    try {
      try {
        spend = withBudgetResources(spend, opts.budget, !this.started)
        live.spent = withBudgetResources(
          live.spent,
          opts.budget,
          !this.started || this.executor.accounting?.() !== undefined,
        )
      } catch (error) {
        // Invalid resource receipts cannot leave a ticket open or authorize a refund.
        spend = withBudgetResources({ ...spend, resources: undefined }, opts.budget)
        live.spent = withBudgetResources({ ...live.spent, resources: undefined }, opts.budget)
        try {
          live.budgetViolation = this.pool.reconcile(this.ticket, spend)
        } catch (fault) {
          // Unknown enforced usage closes the ticket before reporting its violation.
          if (fault instanceof BudgetReconcileFault) live.budgetViolation = fault.budgetViolation
        }
        throw error
      }
      // An overspend is recorded, not thrown (the pool committed the true spend); a fault throws.
      live.budgetViolation = this.pool.reconcile(this.ticket, spend)
      this.recordDeadlineOverrun()
      return undefined
    } catch (error) {
      if (error instanceof BudgetReconcileFault) live.budgetViolation = error.budgetViolation
      this.reconciliationError = error
      return error
    }
  }

  /** Commit a terminal artifact's spend: its usage is captured and its reservation reconciled. */
  commitTerminalSpend(terminalSpend: Spend): void {
    const { live } = this
    const accounting = this.executor.accounting?.()
    live.spent = accounting?.reported ?? terminalSpend
    this.terminalTelemetryCaptured = true
    live.executorDone = true
    const reconcileError = this.reconcile(accounting?.reservation ?? terminalSpend)
    if (reconcileError !== undefined) throw reconcileError
  }

  /** Commit an accepted result's spend; returns the reconciliation error, if any. */
  commitAcceptedSpend(accepted: NonNullable<LiveChild['acceptedResult']>): unknown | undefined {
    const { live, executor } = this
    live.spent = executor.accounting?.()?.reported ?? accepted.spent
    live.executorDone = true
    live.recoveryPending = false
    this.terminalTelemetryCaptured = true
    return this.reconcile(executor.accounting?.()?.reservation ?? accepted.spent)
  }

  // A child that settled past its time box names it the same way, as time given and taken.
  private recordDeadlineOverrun(): void {
    const { live, deadlineAtMs } = this
    const startedAt = this.startedAt
    const settledAt = this.now()
    if (deadlineAtMs !== undefined && startedAt !== undefined && settledAt > deadlineAtMs) {
      live.budgetViolation = {
        overspent: [
          ...(live.budgetViolation?.overspent ?? []),
          {
            channel: 'deadline',
            reserved: deadlineAtMs - startedAt,
            spent: settledAt - startedAt,
          },
        ],
      }
    }
  }
}

function assertReportedSpend(spent: unknown, context: string): asserts spent is Spend {
  const candidate = spent as Partial<Spend> | null | undefined
  if (
    typeof candidate !== 'object' ||
    candidate === null ||
    typeof candidate.iterations !== 'number' ||
    typeof candidate.tokens !== 'object' ||
    candidate.tokens === null
  ) {
    throw new ValidationError(
      `${context}: executor settled without a Spend — report what was spent or mark it unknown; a budget-exempt executor reports zero`,
    )
  }
}
