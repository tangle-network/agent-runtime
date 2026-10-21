import { workerTraceAnalysisStore } from '../../runtime/supervise/trace-evidence'
import type {
  NodeExecutionIdentity,
  NodeId,
  NodeSnapshot,
  NodeStatus,
  ResultBlobStore,
  Settled,
  SpawnJournal,
} from '../../runtime/supervise/types'
import { cloneSpend } from '../../runtime/util'
import { outsideCursorNamespace } from './event-index'
import {
  budgetViolationOf,
  copyProviderModelEvidence,
  traceEvidenceFor,
} from './settlement-evidence'

/**
 * Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled
 * child's `out` from the blob store by `outRef`, and return the `Settled[]` exactly
 * as `scope.next()` originally delivered them.
 *
 * Determinism (B2): the events are sorted by `seq` BEFORE any blob `get`, so the
 * replay order is the recorded cursor order regardless of how fast each rehydration
 * resolves. `at` (wall-clock) is never a replay input. Fail loud on a tree that was
 * never begun, a settled-done event missing its `outRef`, or a blob the store can't
 * rehydrate — a silent gap would let `act` branch on the wrong evidence.
 *
 * @stable
 */
export async function replaySpawnTree(
  journal: SpawnJournal,
  blobs: ResultBlobStore,
  root: NodeId,
): Promise<Settled<unknown>[]> {
  const events = await journal.loadTree(root)
  if (events === undefined) {
    throw new Error(`replaySpawnTree: no journaled tree for root '${root}'`)
  }
  const ordered = [...events].sort((a, b) => a.seq - b.seq)
  const labels = new Map<NodeId, string>()
  const assignmentIds = new Map<NodeId, string>()
  const identities = new Map<NodeId, NodeExecutionIdentity>()
  const materializations = new Map<NodeId, NodeSnapshot['materialization']>()
  const executionBindings = new Map<
    NodeId,
    NonNullable<NodeSnapshot['executionBindings']>[number][]
  >()
  for (const ev of ordered) {
    if (ev.kind === 'spawned') labels.set(ev.id, ev.label)
    if (ev.kind === 'spawned' && ev.assignmentId !== undefined) {
      assignmentIds.set(ev.id, ev.assignmentId)
    }
    if (ev.kind === 'spawned' && ev.identity !== undefined) {
      identities.set(ev.id, copyFrozenIdentity(ev.identity))
    }
    if (ev.kind === 'materialized') materializations.set(ev.id, ev.receipt)
    if (ev.kind === 'execution-bound') {
      const bindings = executionBindings.get(ev.id) ?? []
      bindings.push(ev.binding)
      executionBindings.set(ev.id, bindings)
    }
  }
  const handleFor = (id: NodeId, status: NodeStatus) =>
    replayHandle(id, labels.get(id) ?? id, status, {
      assignmentId: assignmentIds.get(id),
      identity: identities.get(id),
      materialization: materializations.get(id),
      executionBindings: executionBindings.get(id),
    })
  const settlementTime = (at: string): { readonly settledAt?: number } => {
    const settledAt = Date.parse(at)
    return Number.isFinite(settledAt) ? { settledAt } : {}
  }
  const settled: Settled<unknown>[] = []
  for (const ev of ordered) {
    // Node creation and informational records, read above for handles, are not settlements.
    if (outsideCursorNamespace(ev)) continue
    if (ev.kind === 'cancelled') {
      settled.push({
        kind: 'down',
        handle: handleFor(ev.id, 'cancelled'),
        reason: ev.reason,
        ...(ev.outRef === undefined ? {} : { outRef: ev.outRef }),
        ...(ev.infra === undefined ? {} : { infra: ev.infra }),
        ...(ev.providerModel === undefined
          ? {}
          : { providerModel: copyProviderModelEvidence(ev.providerModel) }),
        ...budgetViolationOf(ev),
        trace: ev.trace ?? { status: 'unavailable', reason: 'execution-did-not-start' },
        ...(ev.harnessTranscript === undefined ? {} : { harnessTranscript: ev.harnessTranscript }),
        ...(ev.retainedExecution === undefined ? {} : { retainedExecution: ev.retainedExecution }),
        ...(ev.retainedPendingCause === undefined
          ? {}
          : { retainedPendingCause: ev.retainedPendingCause }),
        ...(ev.subtree === undefined ? {} : { subtree: ev.subtree }),
        ...settlementTime(ev.at),
        seq: ev.seq,
      })
      continue
    }
    if (ev.status === 'down') {
      const trace = traceEvidenceFor(ev)
      if (trace.status === 'available') await workerTraceAnalysisStore(trace, blobs)
      settled.push({
        kind: 'down',
        handle: handleFor(ev.id, 'failed'),
        // `reason` is written by every current scope. The verdict fallback preserves the
        // pre-field convention and the generic text keeps still-older reasonless journals usable.
        reason: ev.reason ?? ev.verdict?.notes ?? 'child down',
        ...(ev.outRef === undefined ? {} : { outRef: ev.outRef }),
        // Replay carries the record's own claim, absent included: `ev.infra === true` turned an
        // unattributable failure into a `false` the live run never asserted.
        ...(ev.infra === undefined ? {} : { infra: ev.infra }),
        ...(ev.providerModel === undefined
          ? {}
          : { providerModel: copyProviderModelEvidence(ev.providerModel) }),
        ...budgetViolationOf(ev),
        trace,
        // A field the journal holds and replay drops is the #1214 bug again: a reader of the
        // replayed tree would see no transcript where the record says there is one.
        ...(ev.harnessTranscript === undefined ? {} : { harnessTranscript: ev.harnessTranscript }),
        // Replay yields the settlement the driver saw except for the one deliberate difference:
        // live carried `'pending'` while recoverable; the journal records how the slot closed.
        ...(ev.retainedExecution === undefined ? {} : { retainedExecution: ev.retainedExecution }),
        ...(ev.retainedPendingCause === undefined
          ? {}
          : { retainedPendingCause: ev.retainedPendingCause }),
        ...(ev.subtree === undefined ? {} : { subtree: ev.subtree }),
        ...settlementTime(ev.at),
        seq: ev.seq,
      })
      continue
    }
    if (ev.outRef === undefined) {
      throw new Error(
        `replaySpawnTree: settled-done event for '${ev.id}' (seq ${ev.seq}) has no outRef; ` +
          'cannot rehydrate the result the driver branched on',
      )
    }
    const out = await blobs.get(ev.outRef)
    if (out === undefined) {
      throw new Error(
        `replaySpawnTree: blob store has no artifact for outRef '${ev.outRef}' (node '${ev.id}', seq ${ev.seq})`,
      )
    }
    const trace = traceEvidenceFor(ev)
    if (trace.status === 'available') await workerTraceAnalysisStore(trace, blobs)
    settled.push({
      kind: 'done',
      handle: handleFor(ev.id, 'done'),
      out,
      outRef: ev.outRef,
      verdict: ev.verdict,
      spent: cloneSpend(ev.spent),
      ...(ev.providerModel === undefined
        ? {}
        : { providerModel: copyProviderModelEvidence(ev.providerModel) }),
      ...budgetViolationOf(ev),
      trace,
      ...(ev.harnessTranscript === undefined ? {} : { harnessTranscript: ev.harnessTranscript }),
      ...(ev.subtree === undefined ? {} : { subtree: ev.subtree }),
      ...settlementTime(ev.at),
      seq: ev.seq,
    })
  }
  return settled
}

function replayHandle(
  id: NodeId,
  label: string,
  status: NodeStatus,
  evidence: {
    readonly assignmentId?: string
    readonly identity?: NodeExecutionIdentity
    readonly materialization?: NodeSnapshot['materialization']
    readonly executionBindings?: ReadonlyArray<
      NonNullable<NodeSnapshot['executionBindings']>[number]
    >
  } = {},
) {
  return Object.freeze({
    id,
    label,
    status,
    ...(evidence.assignmentId === undefined ? {} : { assignmentId: evidence.assignmentId }),
    ...(evidence.identity === undefined ? {} : { identity: evidence.identity }),
    ...(evidence.materialization === undefined
      ? {}
      : { materialization: evidence.materialization }),
    ...(evidence.executionBindings === undefined
      ? {}
      : { executionBindings: Object.freeze([...evidence.executionBindings]) }),
    abort() {
      throw new Error(`cannot abort node '${id}': replayed handles are terminal, not live`)
    },
  })
}

/** A replayed handle must not retain mutable references into the loaded journal event. */
function copyFrozenIdentity(identity: NodeExecutionIdentity): NodeExecutionIdentity {
  const correlation =
    identity.correlation === undefined ? undefined : Object.freeze({ ...identity.correlation })
  return Object.freeze({
    ...(identity.profileDigest === undefined ? {} : { profileDigest: identity.profileDigest }),
    ...(identity.taskDigest === undefined ? {} : { taskDigest: identity.taskDigest }),
    ...(identity.candidateDigest === undefined
      ? {}
      : { candidateDigest: identity.candidateDigest }),
    ...(correlation === undefined ? {} : { correlation }),
  })
}
