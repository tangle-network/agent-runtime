import { ValidationError } from '../../errors'
import { reportedFailureCause, runtimeFailureCause } from '../failure-cause'
import { type HarnessTranscriptEvidence, settleHarnessTranscript } from '../harness-transcript'
import { cloneTokenUsage, isAsyncIterable } from '../util'
import { runAbortable, signalAbortError } from './abortable'
import type { BudgetPool, ReservationTicket } from './budget'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS } from './deadline'
import { errMessage } from './error-message'
import { executorFailure, executorFailureInfra } from './executor-outcome'
import { runtimeOwnedExecutorProviderEvidence } from './materialization'
import { addResourceSpend, resourceTelemetry } from './resources'
import { RetainedExecutionPendingError } from './retained-executor'
import { ChildExecutionAttempt } from './scope-child-attempt'
import type { LiveChild, PreSeqSettled } from './scope-contract'
import { detachedSnapshot } from './snapshot'
import type {
  Executor,
  ExecutorProgressEvent,
  ExecutorResult,
  NodeId,
  ProviderModelExecutionEvidence,
  ResultBlobStore,
  SpawnJournal,
  SpawnOpts,
  Spend,
  UsageEvent,
  WorkerTraceEvidence,
} from './types'
import { meterUsageEvent, newUsageTotals, spendFromUsageTotals } from './usage-metering'

export async function runChild<C>(
  live: LiveChild,
  executor: Executor<C>,
  childAbort: AbortController,
  task: unknown,
  opts: SpawnOpts,
  pool: BudgetPool,
  ticket: ReservationTicket,
  blobs: ResultBlobStore,
  now: () => number,
  journal: SpawnJournal,
  journalRoot: NodeId,
  nextProgressSeq: () => number,
  executionReady: Promise<void>,
  executionEvidence: ExecutionEvidence,
  deadlineAtMs: number | undefined,
  recovering = false,
  closeRetainedWrites: () => Promise<void> = async () => {},
  budgetReady: Promise<void> | undefined = undefined,
  slotReady: Promise<void> = Promise.resolve(),
  priorSpent?: Spend,
  startedAt?: number,
): Promise<PreSeqSettled> {
  if (priorSpent !== undefined) live.spent = detachedSnapshot(priorSpent, 'prior committed usage')
  const attempt = new ChildExecutionAttempt(
    live,
    executor,
    childAbort,
    opts,
    pool,
    ticket,
    blobs,
    now,
    deadlineAtMs,
    startedAt,
  )
  try {
    // Materialization evidence must be durable before execution begins; a failure here types the
    // child down and refunds its reservation with zero executor calls.
    await executionReady
    if (childAbort.signal.aborted) throw signalAbortError(childAbort.signal, 'execution aborted')
    // A queued child runs nothing until the pool grants its budget slice and then a worker slot.
    if (budgetReady !== undefined) await awaitAbortable(budgetReady, childAbort.signal)
    await awaitAbortable(slotReady, childAbort.signal)
    // A budgetExempt WORKER (the raw `cli` printer) reports zero spend by contract and its
    // reconcile refunds the whole reservation; only the DRIVER path refuses such runtimes.
    live.status = 'running'
    attempt.started = true
    const ran = recovering
      ? executor.recover!(task, childAbort.signal)
      : executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    let terminalSpend: Spend
    if (isAsyncIterable<UsageEvent>(ran)) {
      const spend = await foldExecutorStream(
        attempt,
        ran,
        journal,
        journalRoot,
        nextProgressSeq,
        priorSpent,
      )
      live.spent = spend
      const reported = executor.resultArtifact() as ExecutorResult<C>
      artifact = await attempt.retainOutput(
        reported,
        preserveUnknownTelemetry(spend, reported.spent),
      )
      terminalSpend = preserveUnknownTelemetry(spend, artifact.spent)
    } else {
      artifact = await attempt.retainOutput(
        await awaitUnlessAccepted(Promise.resolve(ran), childAbort.signal, executor),
      )
      terminalSpend = artifact.spent
    }
    await executionEvidence.complete()
    attempt.commitTerminalSpend(terminalSpend)
    return await settleExecuted(attempt, artifact)
  } catch (cause) {
    return await settleThrown(attempt, cause, executionEvidence, closeRetainedWrites)
  } finally {
    await closeRetainedWrites()
  }
}

/** Kernel-owned materialization evidence for one execution, closed by its outcome. */
interface ExecutionEvidence {
  complete: () => Promise<void>
  fail: () => Promise<void>
}

/**
 * Drain a streaming executor, folding usage events as they arrive. Each event republishes the
 * running total and a fresh activity stamp onto the live child, so `scope.progress(id)` sees a
 * worker mid-flight. The fold does not abort when the total crosses the reservation: executors
 * report usage after the call it measures (the sandbox executor in its terminal receipt), so the
 * crossing report is often the last event, and aborting would discard completed work while saving
 * no spend. A cap that prevents spend belongs in the executor; an overspend is recorded at
 * reconciliation.
 */
async function foldExecutorStream<C>(
  { live, childAbort, now }: ChildExecutionAttempt<C>,
  stream: AsyncIterable<UsageEvent>,
  journal: SpawnJournal,
  journalRoot: NodeId,
  nextProgressSeq: () => number,
  priorSpent: Spend | undefined,
): Promise<Spend> {
  live.events.start()
  try {
    return await foldStream(
      stream,
      async (running, event) => {
        live.spent = running
        live.lastActivityAt = now()
        await journal.appendEvent(journalRoot, {
          kind: 'progress',
          id: live.id,
          spend: running,
          ...(event.kind === 'progress' && event.progress.kind === 'awaiting-result'
            ? { awaitingResult: { since: event.progress.since } }
            : {}),
          seq: nextProgressSeq(),
          at: new Date(now()).toISOString(),
        })
      },
      childAbort.signal,
      priorSpent,
      (event) => live.events.append(event, now()),
    )
  } finally {
    await live.events.settle()
  }
}

/** Settle an execution that returned its terminal artifact and reconciled its reservation. */
async function settleExecuted<C>(
  attempt: ChildExecutionAttempt<C>,
  artifact: ExecutorResult<C>,
): Promise<PreSeqSettled> {
  const { live, executor, childAbort, opts } = attempt
  // Executor work is complete; the non-blocking drain keys on this.
  live.executorDone = true

  // A driver child's OWN-inference subtree total — re-homed by the parent on EVERY settle exit
  // (done, aborted, crash) so the journal always matches what the pool already debited.
  const ownMetered = executor.metered?.()
  const trace = await attempt.captureTrace()
  await settleHarnessTranscript(executor)
  const childHarnessTranscript = await attempt.persistTranscript()

  if (
    childAbort.signal.aborted &&
    live.acceptedResult === undefined &&
    executor.resultAccepted?.() !== true
  ) {
    await attempt.teardown(opts.shutdown ?? 'brutalKill')
    return downRecord(
      'aborted before settle',
      true,
      trace,
      ownMetered,
      runtimeOwnedExecutorProviderEvidence(executor),
      attempt.retainedOutputRef,
      childHarnessTranscript,
    )
  }

  const failure = executorFailure(artifact)
  if (failure !== undefined) {
    await attempt.teardown(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
    return failureRecord(
      failure,
      trace,
      ownMetered,
      runtimeOwnedExecutorProviderEvidence(executor),
      childHarnessTranscript,
      // retainOutput derived and persisted the canonical reference before settlement work.
      artifact.outRef,
    )
  }
  // A turn that ended over its budget keeps its environment for a same-key continuation; the
  // scope releases it at its hold ceiling, on cancel_worker, or at the join barrier.
  const held = executor.heldForContinuation?.()
  if (held !== undefined && live.budgetViolation !== undefined) live.held = { continuation: held }
  else await attempt.teardown(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS)
  return doneRecord(
    artifact,
    live.spent,
    trace,
    childHarnessTranscript,
    runtimeOwnedExecutorProviderEvidence(executor),
    ownMetered,
  )
}

/** Settle a throw from execution or its persistence: accepted, retained-pending, or down. */
async function settleThrown<C>(
  attempt: ChildExecutionAttempt<C>,
  cause: unknown,
  executionEvidence: ExecutionEvidence,
  closeRetainedWrites: () => Promise<void>,
): Promise<PreSeqSettled> {
  const { live, executor, childAbort } = attempt
  let err = cause
  // An abort reaches here while a streaming executor still ends its turn: it stops the harness
  // and copies the session after the abort. Everything below reads that transcript or tears the
  // executor down, so wait (bounded) for the copy first.
  await settleHarnessTranscript(executor)
  await closeRetainedWrites()
  if (
    live.acceptedResult !== undefined &&
    attempt.reconciliationError === undefined &&
    (isAbortError(err) ||
      (attempt.teardownFailure !== undefined && err === attempt.teardownFailure) ||
      (childAbort.signal.aborted && err === childAbort.signal.reason))
  ) {
    // Provider release and cancellation cannot revoke an already committed terminal result.
    const accepted = live.acceptedResult
    const acceptedAccountingError = attempt.commitAcceptedSpend(accepted)
    if (acceptedAccountingError === undefined) return await settleAccepted(attempt, accepted)
    err = acceptedAccountingError
  }
  if (err instanceof RetainedExecutionPendingError || live.recoveryPending) {
    return await settleRetainedPending(attempt, err)
  }
  return await settleCrashed(attempt, err, executionEvidence)
}

/** Settle a result the child submitted and the kernel accepted before the abort arrived. */
async function settleAccepted<C>(
  attempt: ChildExecutionAttempt<C>,
  accepted: NonNullable<LiveChild['acceptedResult']>,
): Promise<PreSeqSettled> {
  const { executor, opts } = attempt
  const trace = await attempt.captureTrace()
  await attempt.teardown(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
  const metered = executor.metered?.()
  const failure = executorFailure(accepted)
  if (failure !== undefined) {
    const providerModel = runtimeOwnedExecutorProviderEvidence(executor)
    return failureRecord(
      failure,
      trace,
      metered,
      providerModel,
      await attempt.persistTranscript(),
      accepted.outRef,
    )
  }
  const spent = attempt.live.spent
  const harnessTranscript = await attempt.persistTranscript()
  return doneRecord(
    accepted,
    spent,
    trace,
    harnessTranscript,
    runtimeOwnedExecutorProviderEvidence(executor),
    metered,
  )
}

/** Settle an execution that may still run remotely: its node keeps its cursor slot open. */
async function settleRetainedPending<C>(
  attempt: ChildExecutionAttempt<C>,
  err: unknown,
): Promise<PreSeqSettled> {
  const { live, executor, opts, now } = attempt
  live.recoveryPending = true
  live.executorDone = true
  const trace = await attempt.captureTrace()
  // Teardown so a receipt exists at all. A nested manager's executor answers `destroyed: true`
  // once its descendants are confirmed though its owner environment is still held, so
  // `cleanupConfirmed` here does not mean the execution is gone (#1189).
  await attempt.teardown(opts.shutdown ?? 'brutalKill').catch(() => undefined)
  // Charge what was observed, not the reservation ceiling: a recursive executor's explicit
  // accounting, else the running total the pool metered off the stream. `reconcile` refunds
  // `reserved - spent`, so passing the ceiling refunded nothing: 16 dead children
  // were charged 64M having metered 890k (#1190). The floor is `live.spent` for a leaf (no
  // production leaf implements `metered`), with every channel marked unknown because the remote
  // execution may still be consuming; it is journaled as this node's `reconciled` floor. A
  // ticket already reconciled at a measured terminal spend keeps that measurement.
  if (!attempt.reconciled) {
    const accounting = executor.accounting?.()
    const ms = Math.max(0, now() - live.startedAt)
    live.spent = { ...unknownFloor(accounting?.reported ?? live.spent), ms }
    attempt.reconcile({ ...unknownFloor(accounting?.reservation ?? live.spent), ms })
  }
  // The slot stays open, so no terminal record carries an overspend yet and the floor is not the
  // final spend; reporting it here would make live views disagree with replay. The pool did
  // commit it, so the answer is held for the release sweep's terminal record.
  live.retainedViolation = live.budgetViolation
  live.budgetViolation = undefined
  return {
    ...downRecord(
      errMessage(err),
      true,
      trace,
      executor.metered?.(),
      undefined,
      attempt.retainedOutputRef,
      // #1244: 45 of these in one evening executed and left no artifact; this is the only record
      // their transcript can reach.
      await attempt.persistTranscript(),
    ),
    reconciled: live.spent,
    // Classified from the typed cause before `errMessage` flattens it (#1204). `recoveryPending`
    // without a RetainedExecutionPendingError is an admission that never got a result:
    // unobservable by definition.
    retainedPendingCause:
      err instanceof RetainedExecutionPendingError ? err.pendingCause : 'unobservable',
    // The provider's own machine code survives the wrapper, as on the crashed path.
    failure: runtimeFailureCause(err),
  }
}

/** Settle a thrown executor (or failed persistence) as a typed down record. */
async function settleCrashed<C>(
  attempt: ChildExecutionAttempt<C>,
  err: unknown,
  executionEvidence: ExecutionEvidence,
): Promise<PreSeqSettled> {
  const { live, executor, childAbort } = attempt
  // A thrown executor has also finished its own work — only the down-record persistence
  // remains, so the non-blocking drain may await this child too.
  live.executorDone = true
  let evidenceError: unknown
  try {
    await executionEvidence.fail()
  } catch (error) {
    evidenceError = error
  }
  // A recursive executor can still report the nested work committed before it threw. A
  // box-backed trace must be collected before teardown destroys the session that owns it.
  const trace = await attempt.captureTrace()
  let teardownError: unknown
  try {
    await attempt.teardown('brutalKill')
  } catch (error) {
    teardownError = error
  }
  const accounting = executor.accounting?.()
  if (accounting) live.spent = accounting.reported
  const providerModel = runtimeOwnedExecutorProviderEvidence(executor)
  const aborted = childAbort.signal.aborted || isAbortError(err)
  if (attempt.started && !attempt.terminalTelemetryCaptured && accounting === undefined) {
    // No terminal usage receipt arrived (a crash or an abort): keep observed partial counts as a
    // lower bound, never read the unreported remainder as zero. A recursive executor's explicit
    // accounting stays authoritative, as after a persistence failure behind a terminal artifact.
    live.spent = unknownFloor(live.spent)
  }
  const reconcileError = attempt.reconcile(accounting?.reservation ?? live.spent)
  const failure = runtimeFailureCause(err, { signal: childAbort.signal })
  // A crashed driver child still re-homes the partial inference it durably metered.
  const down = downRecord(
    // The failed operation is the causal error; a cleanup or accounting failure never replaces it
    // but still marks the settlement as infrastructure-related.
    errMessage(err),
    evidenceError !== undefined ||
      teardownError !== undefined ||
      reconcileError !== undefined ||
      aborted ||
      isInfraError(err),
    trace,
    executor.metered?.(),
    providerModel,
    attempt.retainedOutputRef,
    await attempt.persistTranscript(),
  )
  return { ...down, failure }
}

/** The done record of a terminal result. */
function doneRecord(
  result: Pick<ExecutorResult<unknown>, 'out' | 'outRef' | 'verdict'>,
  spent: Spend,
  trace: WorkerTraceEvidence,
  harnessTranscript: HarnessTranscriptEvidence,
  providerModel: ProviderModelExecutionEvidence | undefined,
  metered: Spend | undefined,
): PreSeqSettled {
  return {
    kind: 'done',
    out: result.out,
    outRef: result.outRef,
    ...(result.verdict ? { verdict: result.verdict } : {}),
    spent,
    trace,
    harnessTranscript,
    providerModel,
    ...(metered ? { metered } : {}),
  }
}

/** The down record of a result whose envelope reported failure; it still cites its output. */
function failureRecord(
  failure: NonNullable<ReturnType<typeof executorFailure>>,
  trace: WorkerTraceEvidence,
  metered: Spend | undefined,
  providerModel: ProviderModelExecutionEvidence | undefined,
  harnessTranscript: HarnessTranscriptEvidence,
  outRef: string | undefined,
): PreSeqSettled {
  return {
    ...downRecord(
      failure.error,
      // The envelope's own vocabulary decides; an unattributable failure carries no claim.
      executorFailureInfra(failure),
      trace,
      metered,
      providerModel,
      undefined,
      harnessTranscript,
    ),
    outRef,
    failure: reportedFailureCause(failure),
  }
}

/**
 * Fold a streaming executor's usage into the conserved `Spend`, publishing the running total
 * after EVERY event: a RUNNING worker is observable (it used to report zero until the stream
 * drained) and one that throws mid-stream reconciles its real partial spend.
 */
async function foldStream(
  stream: AsyncIterable<UsageEvent>,
  onProgress?: (running: Spend, event: UsageEvent) => void | Promise<void>,
  signal?: AbortSignal,
  priorSpent?: Spend,
  onEvent?: (event: ExecutorProgressEvent) => void,
): Promise<Spend> {
  const totals = newUsageTotals(priorSpent)
  const iterator = stream[Symbol.asyncIterator]()
  try {
    for (;;) {
      const next = signal
        ? await awaitAbortable(Promise.resolve(iterator.next()), signal)
        : await iterator.next()
      if (next.done) break
      const ev = next.value
      if (ev.kind === 'progress') onEvent?.(ev.progress)
      meterUsageEvent(totals, ev)
      await onProgress?.(
        {
          ...addResourceSpend(totals.resources),
          iterations: totals.iterations,
          tokens: cloneTokenUsage(totals.tokens),
          ...(totals.tokensKnown ? {} : { tokensKnown: false }),
          usd: totals.usd,
          ...(totals.usdEstimated > 0 ? { usdEstimated: totals.usdEstimated } : {}),
          ...(totals.usdKnown ? {} : { usdKnown: false }),
          // A live read says which receipt the running total came from, so `observe_agent` on a
          // codex seat reports store-read tokens as store-read rather than as a stream receipt.
          ...(totals.tokensProvenance === undefined || totals.tokensProvenance === 'stream-receipt'
            ? {}
            : { tokensProvenance: totals.tokensProvenance }),
          ms: 0,
        },
        ev,
      )
    }
  } catch (error) {
    // Ask a cooperative async generator to close, but never let a broken `return()` hide the
    // deadline that already won. Its promise is observed so a late rejection is not unhandled.
    void Promise.resolve(iterator.return?.()).catch(() => undefined)
    throw error
  }
  return spendFromUsageTotals(totals)
}

/** Usage events carry measured increments; the terminal artifact carries whether a provider omitted
 * a whole accounting channel. Preserve those unknowns on the common streaming path. */
function preserveUnknownTelemetry(streamed: Spend, terminal: Spend): Spend {
  const terminalTokens = cloneTokenUsage(terminal.tokens)
  return {
    ...streamed,
    ...resourceTelemetry(streamed, terminal),
    tokens: {
      ...streamed.tokens,
      ...(streamed.tokens.freshInput === undefined && terminalTokens.freshInput !== undefined
        ? { freshInput: terminalTokens.freshInput }
        : {}),
      ...(streamed.tokens.cacheRead === undefined && terminalTokens.cacheRead !== undefined
        ? { cacheRead: terminalTokens.cacheRead }
        : {}),
      ...(streamed.tokens.cacheWrite === undefined && terminalTokens.cacheWrite !== undefined
        ? { cacheWrite: terminalTokens.cacheWrite }
        : {}),
      ...(streamed.tokens.cacheBreakdownKnown === false ||
      terminalTokens.cacheBreakdownKnown === false
        ? { cacheBreakdownKnown: false as const }
        : {}),
    },
    ...(terminal.tokensKnown === false ? { tokensKnown: false } : {}),
    ...(terminal.usdKnown === false ? { usdKnown: false } : {}),
    ms: terminal.ms,
    // Box-time is terminal-artifact-only BY DESIGN (minutes are unknown until the box dies), so
    // this is the one place it can reach `live.spent` and the journal; without it the channel was
    // dropped at settlement (value audit, PR #1053).
    ...(terminal.boxMinutes !== undefined ? { boxMinutes: terminal.boxMinutes } : {}),
    ...(terminal.boxMinutesKnown !== undefined
      ? { boxMinutesKnown: terminal.boxMinutesKnown }
      : {}),
    ...(terminal.boxMinutesProvenance !== undefined
      ? { boxMinutesProvenance: terminal.boxMinutesProvenance }
      : {}),
    // The terminal artifact supplies provenance for an executor whose stream did not.
    ...((streamed.tokensProvenance ?? terminal.tokensProvenance) === undefined
      ? {}
      : { tokensProvenance: streamed.tokensProvenance ?? terminal.tokensProvenance }),
  }
}

/**
 * Await a one-shot executor's terminal result unless an abort wins first, except for an execution
 * whose result was accepted before the abort arrived: it is ending the turn that submitted that
 * result, so it is awaited rather than discarded, and the executor bounds that wait itself.
 */
async function awaitUnlessAccepted<T>(
  work: Promise<T>,
  signal: AbortSignal,
  executor: Pick<Executor<unknown>, 'resultAccepted'>,
): Promise<T> {
  try {
    return await awaitAbortable(work, signal)
  } catch (error) {
    if (signal.aborted && executor.resultAccepted?.() === true) return await work
    throw error
  }
}

async function awaitAbortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  // `execute()` may have returned a promise that rejects from the same abort. Observe it before
  // the already-winning cancellation so a fast abort cannot become an unhandled provider rejection.
  if (signal.aborted) void work.catch(() => undefined)
  // runAbortable defers the abort one microtask: a cooperative executor often resolves its
  // terminal usage receipt from an abort listener, and that already-triggered result still wins.
  return await runAbortable(() => work, signal, 'execution aborted')
}

/** Observed partial counts as a lower bound on every channel: the work happened, its remainder went
 *  unreported, and no reader may take the counts for a measurement. */
function unknownFloor(spend: Spend): Spend {
  return {
    ...spend,
    tokensKnown: false,
    usdKnown: false,
    ...(spend.resources === undefined
      ? {}
      : {
          resources: Object.fromEntries(
            Object.entries(spend.resources).map(([name, value]) => [
              name,
              { ...value, known: false },
            ]),
          ),
        }),
  }
}

export function downRecord(
  reason: string,
  infra: boolean | undefined,
  trace: WorkerTraceEvidence,
  metered?: Spend,
  providerModel?: ProviderModelExecutionEvidence,
  outRef?: string,
  harnessTranscript?: HarnessTranscriptEvidence,
): Extract<PreSeqSettled, { kind: 'down' }> {
  return {
    kind: 'down',
    reason,
    // Absent when unattributable; the record must not carry a boolean it cannot stand behind.
    ...(infra === undefined ? {} : { infra }),
    trace,
    ...(harnessTranscript ? { harnessTranscript } : {}),
    ...(providerModel ? { providerModel } : {}),
    ...(metered ? { metered } : {}),
    ...(outRef === undefined ? {} : { outRef }),
  }
}

function isAbortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: unknown }).name === 'AbortError'
  )
}

/** External-boundary failures (network/FS/subprocess) are infra — excluded from the merge
 *  `n` and the equal-k assertion. A `ValidationError` from a built-in executor wraps a
 *  config/transport failure, so it counts as infra; other throws are a real bad result. */
function isInfraError(err: unknown): boolean {
  return err instanceof ValidationError
}
