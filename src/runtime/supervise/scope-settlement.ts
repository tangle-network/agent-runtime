import { contentAddress } from '../../durable/spawn-journal'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import type { BudgetPool, ReservationTicket } from './budget'
import { DEFAULT_SUCCESSFUL_SHUTDOWN_MS, teardownExecutor } from './deadline'
import {
  abortError,
  awaitAbortable,
  downRecord,
  errMessage,
  foldStream,
  frozenHandle,
  isAbortError,
  isAsyncIterable,
  isInfraError,
  preserveUnknownTelemetry,
} from './scope-support'
import type { LiveChild, PreSeqSettled, ScopeArgs } from './scope-types'
import { captureWorkerTraceEvidence } from './trace-evidence'
import type {
  ExecutionBindingReceipt,
  Executor,
  ExecutorResult,
  Handle,
  NodeId,
  ProfileMaterializationReceipt,
  ResultBlobStore,
  Settled,
  SpawnOpts,
  Spend,
  WorkerTraceEvidence,
} from './types'
import type { WaitOutcome } from './wait'

export async function appendNodeMaterialization(
  args: Pick<ScopeArgs, 'journal' | 'root'>,
  id: NodeId,
  seq: number,
  receipt: ProfileMaterializationReceipt,
  binding: ExecutionBindingReceipt,
  now: () => number,
): Promise<void> {
  const at = new Date(now()).toISOString()
  await args.journal.appendEvent(args.root, { kind: 'materialized', id, receipt, seq, at })
  await args.journal.appendEvent(args.root, { kind: 'execution-bound', id, binding, seq, at })
}

export async function raceFirstSettled(pending: LiveChild[]): Promise<LiveChild> {
  return Promise.race(pending.map((child) => child.settled.then(() => child)))
}

export async function finalizeSettlement<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
): Promise<Settled<Out>> {
  const handle = frozenHandle<Out>(child)
  if (child.wait) return finalizeWait<Out>(child, settlement, seq, args, now, handle)
  const settledAt = now()
  child.settledAt = settledAt
  const at = new Date(settledAt).toISOString()
  if (settlement.kind === 'down') {
    child.status = 'failed'
    child.trace = settlement.trace
    await args.journal.appendEvent(args.root, {
      kind: 'settled',
      id: child.id,
      status: 'down',
      spent: child.spent,
      infra: settlement.infra,
      reason: settlement.reason,
      trace: settlement.trace,
      seq,
      at,
    })
    if (settlement.metered) {
      await args.journal.appendEvent(args.root, {
        kind: 'metered',
        id: child.id,
        spend: settlement.metered,
        seq,
        at,
      })
    }
    notifyRuntimeHookEvent(
      args.hooks,
      {
        id: `${child.id}:settled`,
        runId: args.root,
        target: 'agent.child',
        phase: 'after',
        timestamp: settledAt,
        stepIndex: seq,
        parentId: args.parentId,
        payload: {
          childId: child.id,
          status: 'down',
          reason: settlement.reason,
          infra: settlement.infra,
          spent: child.spent,
        },
      },
      { signal: args.signal },
    )
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      restartCount: settlement.restartCount,
      trace: settlement.trace,
      settledAt,
      seq,
    }
  }
  child.status = 'done'
  child.outRef = settlement.outRef
  child.spent = settlement.spent
  child.trace = settlement.trace
  await args.journal.appendEvent(args.root, {
    kind: 'settled',
    id: child.id,
    status: 'done',
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    trace: settlement.trace,
    seq,
    at,
  })
  if (settlement.metered) {
    await args.journal.appendEvent(args.root, {
      kind: 'metered',
      id: child.id,
      spend: settlement.metered,
      seq,
      at,
    })
  }
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:settled`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: settledAt,
      stepIndex: seq,
      parentId: args.parentId,
      payload: {
        childId: child.id,
        status: 'done',
        outRef: settlement.outRef,
        score: settlement.verdict?.score,
        valid: settlement.verdict?.valid,
        spent: settlement.spent,
      },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    trace: settlement.trace,
    settledAt,
    seq,
  }
}

async function finalizeWait<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
  handle: Handle<Out>,
): Promise<Settled<Out>> {
  const settledAt = now()
  child.settledAt = settledAt
  const at = new Date(settledAt).toISOString()
  if (settlement.kind === 'down') {
    child.status = 'cancelled'
    if (child.wait?.armCommitted) {
      await args.journal.appendEvent(args.root, {
        kind: 'woken',
        id: child.id,
        by: 'cancelled',
        seq,
        at,
      })
    }
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      infra: settlement.infra,
      restartCount: settlement.restartCount,
      trace: settlement.trace,
      settledAt,
      seq,
    }
  }
  child.status = 'done'
  child.outRef = settlement.outRef
  const out = settlement.out as WaitOutcome
  await args.journal.appendEvent(args.root, {
    kind: 'woken',
    id: child.id,
    by: out.settled,
    outRef: settlement.outRef,
    seq,
    at,
  })
  notifyRuntimeHookEvent(
    args.hooks,
    {
      id: `${child.id}:woken`,
      runId: args.root,
      target: 'agent.child',
      phase: 'after',
      timestamp: settledAt,
      stepIndex: seq,
      parentId: args.parentId,
      payload: { childId: child.id, status: 'done', wait: out },
    },
    { signal: args.signal },
  )
  return {
    kind: 'done',
    handle,
    out: settlement.out as Out,
    outRef: settlement.outRef,
    spent: settlement.spent,
    trace: settlement.trace,
    settledAt,
    seq,
  }
}

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
  executionReady: Promise<void>,
  deadlineAtMs: number | undefined,
): Promise<PreSeqSettled> {
  let reconciled = false
  let started = false
  let terminalTelemetryCaptured = false
  let teardownStarted = false
  let traceEvidence: WorkerTraceEvidence | undefined
  const captureTraceOnce = async () => {
    traceEvidence ??= await captureWorkerTraceEvidence(live.readTraceSource, blobs, started)
    return traceEvidence
  }
  const teardownOnce = async (grace: number | 'brutalKill' | 'infinity') => {
    if (teardownStarted) return
    teardownStarted = true
    await teardownExecutor(executor, grace, deadlineAtMs, now)
    live.cleanupConfirmed = true
  }
  const reconcileOnce = (spend: Spend): unknown | undefined => {
    if (reconciled) return undefined
    reconciled = true
    try {
      pool.reconcile(ticket, spend)
      return undefined
    } catch (error) {
      return error
    }
  }
  try {
    await executionReady
    if (childAbort.signal.aborted) throw abortError(childAbort.signal)
    live.status = 'running'
    started = true
    const ran = executor.execute(task, childAbort.signal)
    let artifact: ExecutorResult<C>
    if (isAsyncIterable(ran)) {
      const spend = await foldStream(
        ran,
        (running) => {
          live.spent = running
          live.lastActivityAt = now()
        },
        childAbort.signal,
      )
      live.spent = spend
      artifact = executor.resultArtifact() as ExecutorResult<C>
      const accounting = executor.accounting?.()
      const terminalSpend = preserveUnknownTelemetry(spend, artifact.spent)
      live.spent = accounting?.reported ?? terminalSpend
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminalSpend)
      if (reconcileError !== undefined) throw reconcileError
    } else {
      const terminal = await awaitAbortable(Promise.resolve(ran), childAbort.signal)
      const accounting = executor.accounting?.()
      live.spent = accounting?.reported ?? terminal.spent
      artifact = terminal
      terminalTelemetryCaptured = true
      live.executorDone = true
      const reconcileError = reconcileOnce(accounting?.reservation ?? terminal.spent)
      if (reconcileError !== undefined) throw reconcileError
    }
    live.executorDone = true
    const ownMetered = executor.metered?.()
    const trace = await captureTraceOnce()
    if (childAbort.signal.aborted) {
      await teardownOnce(opts.shutdown ?? 'brutalKill')
      return downRecord('aborted before settle', true, trace, ownMetered)
    }
    const outRef = contentAddress(artifact.out)
    await blobs.put(outRef, artifact.out)
    await teardownOnce(opts.shutdown ?? DEFAULT_SUCCESSFUL_SHUTDOWN_MS)
    return {
      kind: 'done',
      out: artifact.out,
      outRef,
      ...(artifact.verdict ? { verdict: artifact.verdict } : {}),
      spent: live.spent,
      trace,
      ...(ownMetered ? { metered: ownMetered } : {}),
    }
  } catch (err) {
    live.executorDone = true
    const trace = await captureTraceOnce()
    let teardownError: unknown
    try {
      await teardownOnce('brutalKill')
    } catch (error) {
      teardownError = error
    }
    const accounting = executor.accounting?.()
    if (accounting) live.spent = accounting.reported
    const aborted = childAbort.signal.aborted || isAbortError(err)
    if (started && !terminalTelemetryCaptured && accounting === undefined) {
      live.spent = { ...live.spent, tokensKnown: false, usdKnown: false }
    }
    const reconcileError = reconcileOnce(accounting?.reservation ?? live.spent)
    return downRecord(
      errMessage(err),
      teardownError !== undefined || reconcileError !== undefined || aborted || isInfraError(err),
      trace,
      executor.metered?.(),
    )
  }
}
