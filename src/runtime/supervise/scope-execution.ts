import { contentAddress } from '../../durable/content-address'
import { ValidationError } from '../../errors'
import { runtimeFailureCause } from '../failure-cause'
import {
  type HarnessTranscriptEvidence,
  persistHarnessTranscript,
  readHarnessTranscript,
  settleHarnessTranscript,
} from '../harness-transcript'
import { cloneTokenUsage } from '../util'
import { abortError } from './abortable'
import {
  type BudgetPool,
  BudgetReconcileFault,
  meterUsageEvent,
  newUsageTotals,
  type ReservationTicket,
  spendFromUsageTotals,
} from './budget'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import { errMessage } from './error-message'
import { executorFailure, executorFailureInfra } from './executor-outcome'
import { runtimeOwnedExecutorProviderEvidence } from './materialization'
import { addResourceSpend, resourceTelemetry, withBudgetResources } from './resources'
import { RetainedExecutionPendingError } from './retained-executor'
import type { LiveChild, PreSeqSettled } from './scope-contract'
import { detachedSnapshot } from './snapshot'
import { captureWorkerTraceEvidence } from './trace-evidence'
import type {
  Executor,
  ExecutorResult,
  NodeId,
  ResultBlobStore,
  SpawnJournal,
  SpawnOpts,
  Spend,
  UsageEvent,
  WorkerTraceEvidence,
} from './types'

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
  executionEvidence: {
    complete: () => Promise<void>
    fail: () => Promise<void>
  },
  deadlineAtMs: number | undefined,
  recovering = false,
  closeRetainedWrites: () => Promise<void> = async () => {},
  budgetReady: Promise<void> | undefined = undefined,
  slotReady: Promise<void> = Promise.resolve(),
  priorSpent?: Spend,
  startedAt?: number,
): Promise<PreSeqSettled> {
  if (priorSpent !== undefined) live.spent = detachedSnapshot(priorSpent, 'prior committed usage')
  let reconciled = false
  let reconciliationError: unknown
  let teardownFailure: unknown
  let started = false
  let terminalTelemetryCaptured = false
  let teardownStarted = false
  let traceEvidence: WorkerTraceEvidence | undefined
  let retainedOutputRef: string | undefined
  const retainOutput = async (
    result: ExecutorResult<C>,
    measured: Spend = result.spent,
  ): Promise<ExecutorResult<C>> => {
    // Capture valid usage before storage: a failed write must not refund paid-for execution.
    let usageError: unknown
    try {
      assertReportedSpend(result.spent, `scope.spawn ${live.id}`)
      live.spent = executor.accounting?.()?.reported ?? measured
      terminalTelemetryCaptured = true
      live.executorDone = true
    } catch (error) {
      usageError = error
    }
    // Output is evidence, not a success verdict. Preserve it even when terminal usage is invalid.
    const out = detachedSnapshot(result.out, 'scope child output')
    const outRef = contentAddress(out)
    await blobs.put(outRef, out)
    await live.traceRoots.write(outRef, out)
    retainedOutputRef = outRef
    if (usageError !== undefined) throw usageError
    return { ...result, out, outRef }
  }
  const captureTraceOnce = async (): Promise<WorkerTraceEvidence> => {
    traceEvidence ??= await captureWorkerTraceEvidence(live.readTraceSource, blobs, started)
    return traceEvidence
  }
  // Same shape as the trace: read from the executor once per settle exit, persisted under its
  // own content ref, and only the receipt travels on the record. Every arm below, done and
  // down alike, carries it — the arms that lose it are the failure arms (#1244).
  let transcriptEvidence: HarnessTranscriptEvidence | undefined
  const persistTranscriptOnce = async (): Promise<HarnessTranscriptEvidence> => {
    transcriptEvidence ??= await persistHarnessTranscript(readHarnessTranscript(executor), blobs)
    return transcriptEvidence
  }
  const teardownOnce = async (grace: number | 'brutalKill' | 'infinity'): Promise<void> => {
    if (teardownStarted) return
    teardownStarted = true
    try {
      // An environment kept for a continuation that this settlement will not offer is released
      // with the rest of the executor.
      await executor.heldForContinuation?.()?.release()
      await teardownExecutor(executor, grace, deadlineAtMs, now, live.askTeardown)
      live.cleanupConfirmed = true
    } catch (error) {
      teardownFailure = error
      live.teardownDetail = errMessage(error)
      throw error
    }
  }
  const reconcileOnce = (spend: Spend): unknown | undefined => {
    if (reconciled) return reconciliationError
    reconciled = true
    // A refused pre-execution path (including an unmetered executor) reconciles zero and refunds
    // its whole reservation. Every path that actually executes reports measured or unknown spend.
    try {
      try {
        spend = withBudgetResources(spend, opts.budget, !started)
        live.spent = withBudgetResources(
          live.spent,
          opts.budget,
          !started || executor.accounting?.() !== undefined,
        )
      } catch (error) {
        // Invalid resource receipts cannot leave a ticket open or authorize a refund.
        spend = withBudgetResources({ ...spend, resources: undefined }, opts.budget)
        live.spent = withBudgetResources({ ...live.spent, resources: undefined }, opts.budget)
        try {
          live.budgetViolation = pool.reconcile(ticket, spend)
        } catch (fault) {
          // Unknown enforced usage closes the ticket before reporting its violation.
          if (fault instanceof BudgetReconcileFault) live.budgetViolation = fault.budgetViolation
        }
        throw error
      }
      // An overspend is recorded, not thrown: the pool has committed the true spend, and a
      // child that completed keeps its artifact. A fault still throws, carrying any overspend.
      live.budgetViolation = pool.reconcile(ticket, spend)
      // A child that settled past its time box names it the same way, as time given and taken.
      const settledAt = now()
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
      return undefined
    } catch (error) {
      if (error instanceof BudgetReconcileFault) live.budgetViolation = error.budgetViolation
      reconciliationError = error
      return error
    }
  }
  try {
    // Identity and kernel-owned materialization evidence must be durable before execution can
    // begin. A failed append or invalid executor declaration produces a typed-down child and
    // refunds its reservation; the executor observes zero calls.
    await executionReady
    if (childAbort.signal.aborted) throw abortError(childAbort.signal, 'execution aborted')
    // A queued child runs nothing until the pool grants its budget slice and then the allocator
    // grants it a worker slot. A refused budget wait settles it down as budget-exhausted; an abort
    // while it waits settles it down with whatever it holds refunded.
    if (budgetReady !== undefined) await awaitAbortable(budgetReady, childAbort.signal)
    await awaitAbortable(slotReady, childAbort.signal)
    // A budgetExempt WORKER (e.g. the raw `cli` printer) reports zero spend by contract; its
    // reconcile refunds the whole reservation, keeping it out of the conserved Σk by construction.
    // Only the DRIVER path refuses budget-exempt runtimes (`driveHarnessFromBackend`), because a
    // driver's own inference must be metered.
    live.status = 'running'
    started = true
    const ran = recovering
      ? executor.recover!(task, childAbort.signal)
      : executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    if (isAsyncIterable(ran)) {
      live.events.start()
      // Streaming: fold the incremental usage events as they arrive (the conserved-pool
      // authority), then read the terminal artifact after the stream drains. Each event also
      // republishes the running total + a fresh activity stamp onto the live child, so a
      // concurrent `scope.progress(id)` sees a worker mid-flight rather than a zeroed row.
      //
      // The fold does not abort when the running total crosses the reservation. Executors report
      // usage after the model call it measures, and the Tangle sandbox executor reports all of it
      // in the terminal receipt, so the crossing report is often the last event before the
      // artifact. Aborting there would discard completed work while saving no spend. A cap that
      // prevents spend belongs in the executor, before it starts a call the reservation cannot
      // cover. An overspend is recorded at reconciliation instead.
      const spend = await foldStream(
        ran,
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
      live.spent = spend
      const reported = executor.resultArtifact() as ExecutorResult<C>
      artifact = await retainOutput(reported, preserveUnknownTelemetry(spend, reported.spent))
      await executionEvidence.complete()
      const accounting = executor.accounting?.()
      const terminalSpend = preserveUnknownTelemetry(spend, artifact.spent)
      live.spent = accounting?.reported ?? terminalSpend
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminalSpend)
      if (reconcileError !== undefined) throw reconcileError
    } else {
      const terminal = await retainOutput(
        await awaitUnlessAccepted(Promise.resolve(ran), childAbort.signal, executor),
      )
      await executionEvidence.complete()
      const accounting = executor.accounting?.()
      live.spent = accounting?.reported ?? terminal.spent
      artifact = terminal
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminal.spent)
      if (reconcileError !== undefined) throw reconcileError
    }
    // Executor work is complete; everything below is persistence/teardown. From here `settled`
    // resolves without further executor progress — the non-blocking drain keys on this.
    live.executorDone = true

    // A driver child's OWN-inference subtree total — re-homed by the parent on EVERY settle exit
    // (done, aborted, crash) so the journal always matches what the pool already debited.
    const ownMetered = executor.metered?.()
    const trace = await captureTraceOnce()
    const childHarnessTranscript = await persistTranscriptOnce()

    if (
      childAbort.signal.aborted &&
      live.acceptedResult === undefined &&
      executor.resultAccepted?.() !== true
    ) {
      await teardownOnce(opts.shutdown ?? 'brutalKill')
      return downRecord(
        'aborted before settle',
        true,
        trace,
        ownMetered,
        runtimeOwnedExecutorProviderEvidence(executor),
        retainedOutputRef,
        childHarnessTranscript,
      )
    }

    // retainOutput derived and persisted the canonical reference before settlement work.
    const outRef = artifact.outRef
    const failure = executorFailure(artifact)
    if (failure !== undefined) {
      await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
      return {
        ...downRecord(
          failure.error,
          // The envelope's own vocabulary decides; an unattributable failure carries no claim.
          executorFailureInfra(failure),
          trace,
          ownMetered,
          runtimeOwnedExecutorProviderEvidence(executor),
          undefined,
          childHarnessTranscript,
        ),
        outRef,
      }
    }
    // A turn that ended over its budget keeps its environment for a same-key continuation; the
    // scope releases it at its hold ceiling, on cancel_worker, or at the join barrier.
    const held = executor.heldForContinuation?.()
    if (held !== undefined && live.budgetViolation !== undefined) live.held = { continuation: held }
    else await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS)
    return {
      kind: 'done',
      out: artifact.out,
      outRef,
      ...(artifact.verdict ? { verdict: artifact.verdict } : {}),
      spent: live.spent,
      trace,
      harnessTranscript: childHarnessTranscript,
      providerModel: runtimeOwnedExecutorProviderEvidence(executor),
      ...(ownMetered ? { metered: ownMetered } : {}),
    }
  } catch (cause) {
    let err = cause
    // An abort reaches here while a streaming executor still ends its turn: it stops the harness
    // and copies the session after the abort. Everything below reads that transcript or tears the
    // executor down, so wait (bounded) for the copy first.
    await settleHarnessTranscript(executor)
    await closeRetainedWrites()
    if (
      live.acceptedResult !== undefined &&
      reconciliationError === undefined &&
      (isAbortError(err) ||
        (teardownFailure !== undefined && err === teardownFailure) ||
        (childAbort.signal.aborted && err === childAbort.signal.reason))
    ) {
      // Provider release and cancellation cannot revoke an already committed terminal result.
      const accepted = live.acceptedResult
      live.spent = executor.accounting?.()?.reported ?? accepted.spent
      live.executorDone = true
      live.recoveryPending = false
      terminalTelemetryCaptured = true
      const acceptedAccountingError = reconcileOnce(
        executor.accounting?.()?.reservation ?? accepted.spent,
      )
      if (acceptedAccountingError === undefined) {
        const trace = await captureTraceOnce()
        await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS).catch(() => undefined)
        const metered = executor.metered?.()
        const failure = executorFailure(accepted)
        if (failure !== undefined) {
          return {
            ...downRecord(
              failure.error,
              executorFailureInfra(failure),
              trace,
              metered,
              runtimeOwnedExecutorProviderEvidence(executor),
              undefined,
              await persistTranscriptOnce(),
            ),
            outRef: accepted.outRef,
          }
        }
        return {
          kind: 'done',
          out: accepted.out,
          outRef: accepted.outRef,
          ...(accepted.verdict ? { verdict: accepted.verdict } : {}),
          spent: live.spent,
          trace,
          harnessTranscript: await persistTranscriptOnce(),
          providerModel: runtimeOwnedExecutorProviderEvidence(executor),
          ...(metered ? { metered } : {}),
        }
      }
      err = acceptedAccountingError
    }
    if (err instanceof RetainedExecutionPendingError || live.recoveryPending) {
      live.recoveryPending = true
      live.executorDone = true
      const trace = await captureTraceOnce()
      // Attempt teardown so a receipt exists at all; the permit release above does not depend on
      // it. A pending retained leaf answers `destroyed: false`, but a nested manager's executor
      // answers `destroyed: true` whenever its own descendants are confirmed, though its owner
      // environment is still held. So `cleanupConfirmed` here does not mean the execution is
      // gone, and the final close below still closes this slot (#1189).
      await teardownOnce(opts.shutdown ?? 'brutalKill').catch(() => undefined)
      // Charge what was observed, not the reservation ceiling — by the one rule the done and crash
      // paths already apply: a recursive executor's explicit accounting, else the running total
      // the conserved pool metered off the stream.
      //
      // `reconcile` refunds `reserved - spent`, so passing the ceiling as spend refunded exactly
      // nothing: a child that ran no turn was charged its entire per-worker allowance. Measured
      // 2026-09-11, all three runs at a 4M per-worker ceiling against a 32M root budget: 16 dead
      // children charged 64M (200% of the whole run's budget) having metered 890k; 14 charged 56M
      // (175%) having metered 139k, a 359x overcharge. `budget-exhausted` is the second most common
      // no-winner reason in that archive, and a run could reach it having metered almost nothing
      // (#1190).
      //
      // The floor is `live.spent` for a leaf: every production leaf streams its usage into it, and
      // none implements `metered`, so a fallback keyed on `metered` alone kept charging the ceiling
      // for exactly the children measured above. Every channel is marked unknown, because the
      // remote execution may still be consuming what it was handed off to: the floor is never read
      // back as a measurement. The child-work part is journaled as this node's `reconciled` floor
      // (its slot stays open until a resume recovers it or the release sweep closes it, so no
      // `settled` record carries it yet), and a driver's own inference rides its `metered`
      // record as on every other path.
      //
      // A ticket already reconciled at a measured terminal spend (a persistence failure after the
      // artifact landed) keeps that measurement: `live.spent` is then what the pool committed.
      if (!reconciled) {
        const accounting = executor.accounting?.()
        const ms = Math.max(0, now() - live.startedAt)
        live.spent = { ...unknownFloor(accounting?.reported ?? live.spent), ms }
        reconcileOnce({ ...unknownFloor(accounting?.reservation ?? live.spent), ms })
      }
      // The node keeps its cursor slot open, so no terminal record can carry an overspend yet, and
      // the floor is not the execution's final spend. A recovered settlement reports it from the
      // recorded result; reporting it here would make the live views disagree with replay. The
      // pool did commit it, though, and when the run RELEASES the node the floor is its final
      // charge — so the answer is held aside for the release sweep's terminal record rather than
      // discarded, or that record would say 'within reservation' for a node the pool overspent.
      live.retainedViolation = live.budgetViolation
      live.budgetViolation = undefined
      return {
        ...downRecord(
          errMessage(err),
          true,
          trace,
          executor.metered?.(),
          undefined,
          retainedOutputRef,
          // The #1244 population exactly: 45 of these in one evening, each of which executed and
          // reasoned and left no artifact. This is the only record their transcript can reach.
          await persistTranscriptOnce(),
        ),
        reconciled: live.spent,
        // Classified HERE, from the typed cause, before `errMessage` flattens it to text: a
        // provider that broke its contract and an execution nobody can observe both arrive on
        // this branch, and an operator must act differently on each (#1204). `recoveryPending`
        // without a RetainedExecutionPendingError is an admission that never got a result — by
        // definition unobservable.
        retainedPendingCause:
          err instanceof RetainedExecutionPendingError ? err.pendingCause : 'unobservable',
      }
    }
    // A thrown executor has also finished its own work — only the down-record persistence
    // remains, so the non-blocking drain may await this child too.
    live.executorDone = true
    let evidenceError: unknown
    try {
      await executionEvidence.fail()
    } catch (error) {
      evidenceError = error
    }
    // A recursive executor can still report the nested work committed before it threw.
    // Reconcile that whole partial subtree while journaling its child-work component separately.
    // A box-backed trace must be collected before teardown destroys the session that owns it.
    const trace = await captureTraceOnce()
    let teardownError: unknown
    try {
      await teardownOnce('brutalKill')
    } catch (error) {
      teardownError = error
    }
    const accounting = executor.accounting?.()
    if (accounting) live.spent = accounting.reported
    const providerModel = runtimeOwnedExecutorProviderEvidence(executor)
    const aborted = childAbort.signal.aborted || isAbortError(err)
    if (started && !terminalTelemetryCaptured && accounting === undefined) {
      // The provider never delivered a terminal usage receipt. This is true for an ordinary
      // network/provider crash just as it is for an abort. Preserve observed partial counts as a
      // lower bound, but never reinterpret the unreported remainder as zero under either root
      // ceiling. A recursive executor's explicit accounting remains authoritative on its throw
      // path; a persistence/teardown failure after a terminal artifact does too.
      live.spent = unknownFloor(live.spent)
    }
    const reconcileError = reconcileOnce(accounting?.reservation ?? live.spent)
    const failure = runtimeFailureCause(err, { signal: childAbort.signal })
    // A crashed driver child still re-homes the partial inference it durably metered.
    const down = downRecord(
      // The operation that failed is the causal error. Cleanup and accounting can independently
      // fail while handling it, but must never replace it with a secondary diagnostic (for
      // example, missing terminal usage after a provider crash). Their presence still marks the
      // settlement as infrastructure-related, while the unknown spend flags retain the accounting
      // failure itself in the durable record.
      errMessage(err),
      evidenceError !== undefined ||
        teardownError !== undefined ||
        reconcileError !== undefined ||
        aborted ||
        isInfraError(err),
      trace,
      executor.metered?.(),
      providerModel,
      retainedOutputRef,
      await persistTranscriptOnce(),
    )
    return { ...down, failure }
  } finally {
    await closeRetainedWrites()
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

/**
 * Fold a streaming executor's normalized usage into the conserved `Spend`, publishing the
 * running total after EVERY event via `onProgress`.
 *
 * The publish is what makes a running worker observable. Before it, `live.spent` was assigned
 * once — after the whole stream drained — so `observe_agent` on a RUNNING worker reported
 * `{tokens:0, iterations:0}` for the entire run and a driver had no way to tell a worker three
 * turns deep from one that had produced nothing. It also means a worker that THROWS mid-stream
 * now reconciles its real partial spend instead of refunding work the provider already billed.
 */
async function foldStream(
  stream: AsyncIterable<UsageEvent>,
  onProgress?: (running: Spend, event: UsageEvent) => void | Promise<void>,
  signal?: AbortSignal,
  priorSpent?: Spend,
  onEvent?: (event: import('./types').ExecutorProgressEvent) => void,
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
    // The platform box-time channel is terminal-artifact-only BY DESIGN: a box's minutes are not
    // known until it dies, so nothing on the usage stream can carry them and the conserved pool
    // never sees them. That makes this the one place they can reach `live.spent`, and from there
    // the journal, the tree view and every rollup. Without this the channel would be reported by
    // the executor and dropped at settlement — measured by the value audit on PR #1053.
    ...(terminal.boxMinutes !== undefined ? { boxMinutes: terminal.boxMinutes } : {}),
    ...(terminal.boxMinutesKnown !== undefined
      ? { boxMinutesKnown: terminal.boxMinutesKnown }
      : {}),
    ...(terminal.boxMinutesProvenance !== undefined
      ? { boxMinutesProvenance: terminal.boxMinutesProvenance }
      : {}),
    // Token provenance travels with the counters. The stream fold already derives it from the
    // events; the terminal artifact answers for an executor whose settlement states it and whose
    // stream did not, so a store-read receipt is not dropped on the way to the journal.
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
  if (signal.aborted) {
    // `execute()` may have returned a promise that rejects from the same abort. Observe it before
    // returning the already-winning cancellation so a fast abort cannot become an unhandled
    // provider rejection.
    void work.catch(() => undefined)
    throw abortError(signal, 'execution aborted')
  }
  return await new Promise<T>((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      // A cooperative executor often resolves its terminal usage receipt from an abort listener.
      // Give that already-triggered resolution one microtask to win; an ignoring executor still
      // loses immediately afterward.
      queueMicrotask(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(abortError(signal, 'execution aborted'))
      })
    }
    const cleanup = () => signal.removeEventListener('abort', onAbort)
    signal.addEventListener('abort', onAbort, { once: true })
    work.then(
      (value) => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      },
      (error) => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      },
    )
  })
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
  providerModel?: import('./types').ProviderModelExecutionEvidence,
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

function isAsyncIterable(value: unknown): value is AsyncIterable<UsageEvent> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as AsyncIterable<UsageEvent>)[Symbol.asyncIterator] === 'function'
  )
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
