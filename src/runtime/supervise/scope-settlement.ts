import { contentAddress } from '../../durable/content-address'
import { notifyRuntimeHookEvent } from '../../runtime-hooks'
import { settlementFailureCause } from '../failure-cause'
import { subtreeSummaryOf } from './scope-capabilities'
import type { LiveChild, PreSeqSettled, ScopeArgs } from './scope-contract'
import { frozenHandle } from './scope-observation'
import {
  type DownSettlement,
  settledNodeEvidence,
  settlementFields,
  type TerminalDownSubject,
  terminalDownEvent,
} from './terminal-record'
import type {
  EnvironmentTeardownReceipt,
  HeldRelease,
  NodeId,
  Settled,
  SpawnEvent,
  SpawnJournal,
  Spend,
} from './types'

/** Await whichever pending child settles first, returning the child (its `resolved` is set
 *  by the time this resolves because `runChild`'s `.then` sets it before the promise
 *  resolves downstream). */
export async function raceFirstSettled(pending: LiveChild[]): Promise<LiveChild> {
  return Promise.race(pending.map((c) => c.settled.then(() => c)))
}

/** Rehomed inference has its own per-child sequence, independent of terminal cursors. */
async function appendSettlementMetering(
  journal: SpawnJournal,
  root: NodeId,
  id: NodeId,
  spend: Spend,
  at: string,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'metered', id)
  await appendAcknowledged(journal, root, { kind: 'metered', id, spend, seq, at })
}

/** An open node's reconciled floor has the same per-child sequence discipline as its metering:
 *  outside the cursor namespace, monotonic per node, so a node reconciled once per process (a
 *  retained failure, a recovery, a second retained failure) keeps its records ordered. It carries
 *  the whole settlement and the cursor seq (`settledSeq`) beside the floor, through the same
 *  field spread the terminal record uses, so a resume that finds the release sweep died before
 *  its record can write that record byte-for-byte instead of inventing one. */
async function appendReconciledFloor(
  journal: SpawnJournal,
  root: NodeId,
  subject: TerminalDownSubject,
  settlement: DownSettlement,
  settledSeq: number,
  at: string,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'reconciled', subject.id)
  await appendAcknowledged(journal, root, {
    kind: 'reconciled',
    id: subject.id,
    ...settlementFields(subject, settlement),
    ...(subject.cancellationReason === undefined
      ? {}
      : { cancellation: { source: subject.cancellationReason.source } }),
    settledSeq,
    seq,
    at,
  })
}

/** A release receipt has the same per-child sequence discipline: outside the cursor namespace and
 *  monotonic per node, so a run released in two processes keeps its receipts ordered. */
export async function appendEnvironmentTeardown(
  journal: SpawnJournal,
  root: NodeId,
  id: NodeId,
  receipt: EnvironmentTeardownReceipt,
  at: string,
  heldRelease?: HeldRelease,
): Promise<void> {
  const seq = await nextPerNodeSeq(journal, root, 'environment-teardown', id)
  await journal.appendEvent(root, {
    kind: 'environment-teardown',
    id,
    provider: receipt.provider,
    environmentId: receipt.environmentId,
    destroyed: receipt.destroyed,
    ...(receipt.detail === undefined ? {} : { detail: receipt.detail }),
    ...(heldRelease === undefined ? {} : { heldRelease }),
    seq,
    at,
  })
}

async function nextPerNodeSeq(
  journal: SpawnJournal,
  root: NodeId,
  kind: 'metered' | 'reconciled' | 'environment-teardown',
  id: NodeId,
): Promise<number> {
  const prior = (await journal.loadTree(root)) ?? []
  return (
    prior.reduce(
      (max, event) => (event.kind === kind && event.id === id ? Math.max(max, event.seq) : max),
      -1,
    ) + 1
  )
}

async function appendAcknowledged(
  journal: SpawnJournal,
  root: NodeId,
  event: Extract<SpawnEvent, { kind: 'metered' | 'reconciled' }>,
): Promise<void> {
  try {
    await journal.appendEvent(root, event)
  } catch (error) {
    // An acknowledged durable prefix permits the terminal write; a missing prefix does not.
    const persisted = await journal.loadTree(root)
    if (
      !persisted?.some(
        (record) => record.kind === event.kind && contentAddress(record) === contentAddress(event),
      )
    )
      throw error
  }
}

/** Stamp the cursor `seq`, write the `settled` journal record, and project the
 *  `PreSeqSettled` into the frozen `Settled` the driver branches on. */
export async function finalizeSettlement<Out>(
  child: LiveChild,
  settlement: PreSeqSettled,
  seq: number,
  args: ScopeArgs,
  now: () => number,
): Promise<Settled<Out>> {
  const handle = frozenHandle<Out>(child)
  const nestedScope = child.readNestedScope?.()
  const subtree = nestedScope === undefined ? undefined : subtreeSummaryOf(nestedScope)
  if (subtree !== undefined) child.subtree = subtree
  const settledAt = now()
  child.settledAt = settledAt
  child.settledSeq = seq
  const at = new Date(settledAt).toISOString()
  // A terminal cursor must never hide inference that has not reached the parent journal.
  if (settlement.metered) {
    await appendSettlementMetering(args.journal, args.root, child.id, settlement.metered, at)
  }
  if (settlement.kind === 'down') {
    settlement.failure ??= settlementFailureCause(settlement)
    child.failure = settlement.failure
    const cancellation = child.cancellationReason
    child.status = cancellation === undefined ? 'failed' : 'cancelled'
    child.outRef = settlement.outRef
    child.trace = settlement.trace
    child.providerModel = settlement.providerModel
    const retainedPending = child.recoveryPending === true
    if (!retainedPending)
      await args.journal.appendEvent(args.root, terminalDownEvent(child, settlement, seq, at))
    // A retained-pending node keeps its cursor slot open for recovery, so it carries no terminal
    // record yet — but its reservation WAS reconciled, and a journal that says nothing about that
    // leaves every reader (terminal accounting, a restored pool, the tree view) charging the
    // ceiling the pool refunded: the reported `childWork` carried 4M per
    // retained child against a metered 10 (#1190). The floor is journaled in the settlement's
    // place, outside the cursor namespace, so the slot stays open and the ledgers agree. The
    // slot closes in exactly three ways: a resume recovers the execution and settles it on the
    // ordinary path; root settlement under `retainedAtSettlement: 'release'` destroys the
    // environment and the release sweep (`retainedReleasers`, above) writes this settlement as
    // the terminal record with `retainedExecution: 'released'`, under the seq stamped here; or
    // the next resume's `healReleasedSlots` writes that same record from this reconciled record
    // and the receipts, when the sweep's process died between them. The reconciled record
    // therefore carries the settlement and `seq` in full: `spent` is the floor the pool committed
    // (`live.spent` at the retained branch, the same object `child.spent` holds), the withheld
    // overspend is `retainedViolation`, and `cancellationReason` is final because
    // `recordCancellation` only assigns before `executorDone`.
    else {
      child.retainedExecution = 'pending'
      child.retainedPendingCause = settlement.retainedPendingCause
      if (settlement.reconciled !== undefined)
        await appendReconciledFloor(
          args.journal,
          args.root,
          {
            id: child.id,
            spent: settlement.reconciled,
            ...(child.retainedViolation === undefined
              ? {}
              : { budgetViolation: child.retainedViolation }),
            ...(child.cancellationReason === undefined
              ? {}
              : { cancellationReason: child.cancellationReason }),
          },
          settlement,
          seq,
          at,
        )
    }
    // The in-memory down and the first `agent.child` are the only surfaces that exist while the
    // slot is open, so they are where `'pending'` lives; the journal states the same fact as the
    // `reconciled` record and replay never yields it.
    const retainedExecution = retainedPending
      ? {
          retainedExecution: 'pending' as const,
          ...(settlement.retainedPendingCause === undefined
            ? {}
            : { retainedPendingCause: settlement.retainedPendingCause }),
        }
      : {}
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
          ...(settlement.outRef === undefined ? {} : { outRef: settlement.outRef }),
          reason: settlement.reason,
          ...(settlement.infra === undefined ? {} : { infra: settlement.infra }),
          ...retainedExecution,
          spent: child.spent,
          ...(subtree === undefined ? {} : { subtree }),
          ...settledNodeEvidence(child, settlement, settledAt),
        },
      },
      { signal: args.signal },
    )
    return {
      kind: 'down',
      handle,
      reason: settlement.reason,
      ...(settlement.infra === undefined ? {} : { infra: settlement.infra }),
      ...retainedExecution,
      ...(settlement.outRef === undefined ? {} : { outRef: settlement.outRef }),
      ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
      ...(child.budgetViolation ? { budgetViolation: child.budgetViolation } : {}),
      trace: settlement.trace,
      ...(settlement.harnessTranscript ? { harnessTranscript: settlement.harnessTranscript } : {}),
      ...(subtree === undefined ? {} : { subtree }),
      ...(settlement.failure === undefined ? {} : { failure: settlement.failure }),
      settledAt,
      seq,
    }
  }

  child.failure = undefined
  child.status = 'done'
  child.outRef = settlement.outRef
  child.spent = settlement.spent
  child.trace = settlement.trace
  child.providerModel = settlement.providerModel
  await args.journal.appendEvent(args.root, {
    kind: 'settled',
    id: child.id,
    status: 'done',
    outRef: settlement.outRef,
    ...(settlement.traceRoot === undefined ? {} : { traceRoot: settlement.traceRoot }),
    ...(settlement.verdict ? { verdict: settlement.verdict } : {}),
    spent: settlement.spent,
    ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
    ...(child.budgetViolation ? { budgetViolation: child.budgetViolation } : {}),
    trace: settlement.trace,
    ...(settlement.harnessTranscript ? { harnessTranscript: settlement.harnessTranscript } : {}),
    ...(subtree === undefined ? {} : { subtree }),
    seq,
    at,
  })
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
        ...(subtree === undefined ? {} : { subtree }),
        ...settledNodeEvidence(child, settlement, settledAt),
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
    ...(settlement.providerModel ? { providerModel: settlement.providerModel } : {}),
    ...(child.budgetViolation ? { budgetViolation: child.budgetViolation } : {}),
    trace: settlement.trace,
    ...(settlement.harnessTranscript ? { harnessTranscript: settlement.harnessTranscript } : {}),
    ...(subtree === undefined ? {} : { subtree }),
    settledAt,
    seq,
  }
}

/**
 * Drive one child's `Executor` to a terminal `PreSeqSettled`, folding usage into the
 * conserved `Spend`, reconciling the reservation, and persisting the result blob. Both
 * executor shapes are handled here: a one-shot `Promise<ExecutorResult>` and a streaming
 * `AsyncIterable<UsageEvent>` whose terminal artifact is read from `resultArtifact()`.
 *
 * A thrown executor (or a real abort) becomes a TYPED `down` — never re-thrown — so a
 * single failing child cannot reject the `next()` cursor (the M2 typed-result discipline,
 * applied per child). The reservation is reconciled on EVERY path (success, abort, throw)
 * so the conserved pool can never leak a reservation.
 */
