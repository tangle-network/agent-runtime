import { settlementFailureCause } from '../../runtime/failure-cause'
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
    const trace =
      ev.kind === 'cancelled'
        ? (ev.trace ?? {
            status: 'unavailable' as const,
            reason: 'execution-did-not-start' as const,
          })
        : traceEvidenceFor(ev)
    if (ev.kind === 'settled' && trace.status === 'available')
      await workerTraceAnalysisStore(trace, blobs)
    const evidence = {
      ...(ev.outRef === undefined ? {} : { outRef: ev.outRef }),
      ...(ev.providerModel === undefined
        ? {}
        : { providerModel: copyProviderModelEvidence(ev.providerModel) }),
      ...budgetViolationOf(ev),
      trace,
      ...(ev.harnessTranscript === undefined ? {} : { harnessTranscript: ev.harnessTranscript }),
      ...(ev.subtree === undefined ? {} : { subtree: ev.subtree }),
      ...settlementTime(ev.at),
      seq: ev.seq,
    }
    if (ev.kind === 'cancelled' || ev.status === 'down') {
      // Legacy reasonless journals remain readable without inferring a native diagnosis.
      const reason =
        ev.reason ?? (ev.kind === 'settled' ? ev.verdict?.notes : undefined) ?? 'child down'
      settled.push({
        ...evidence,
        kind: 'down',
        handle: handleFor(ev.id, ev.kind === 'cancelled' ? 'cancelled' : 'failed'),
        reason,
        failure:
          ev.failure ??
          settlementFailureCause({
            reason,
            infra: ev.infra,
            retainedPendingCause: ev.retainedPendingCause,
          }),
        ...(ev.infra === undefined ? {} : { infra: ev.infra }),
        // A released record states how the earlier retained-pending slot finally closed.
        ...(ev.retainedExecution === undefined ? {} : { retainedExecution: ev.retainedExecution }),
        ...(ev.retainedPendingCause === undefined
          ? {}
          : { retainedPendingCause: ev.retainedPendingCause }),
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
    settled.push({
      ...evidence,
      kind: 'done',
      handle: handleFor(ev.id, 'done'),
      out,
      outRef: ev.outRef,
      verdict: ev.verdict,
      spent: cloneSpend(ev.spent),
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
