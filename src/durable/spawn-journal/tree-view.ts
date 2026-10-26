import { settlementFailureCause } from '../../runtime/failure-cause'
import type { NodeId, NodeSnapshot, SpawnEvent, TreeView } from '../../runtime/supervise/types'
import { addSpend, cloneSpend, zeroSpend } from '../../runtime/util'
import { insideCursorNamespace } from './event-index'
import {
  budgetViolationOf,
  copyProviderModelEvidence,
  traceEvidenceFor,
} from './settlement-evidence'

/**
 * Materialize a recorded `TreeView` from a journaled event list for inspection. Folds
 * `spawned`/`settled`/`cancelled` into a per-node snapshot in `seq` order, then adds each
 * `metered` event's driver-inference spend onto its node in a separate additive pass so the view
 * matches the recorded cursor. It does not recover live executors or driver state after restart.
 */
export function materializeTreeView(events: SpawnEvent[]): TreeView {
  const nodes = new Map<NodeId, MutableSnapshot>()
  let root: NodeId | undefined
  // `spawned` (ordinal namespace) and `settled`/`cancelled` (cursor namespace) carry
  // overlapping `seq` values, so create every node before any update — process spawns in
  // ordinal order, then settlements/cancellations in cursor order. A settle/cancel for an
  // un-spawned node is a corrupted log (fail loud via requireNode).
  const spawns = events
    .filter((ev): ev is Extract<SpawnEvent, { kind: 'spawned' }> => ev.kind === 'spawned')
    .sort((a, b) => a.seq - b.seq)
  const settlements = events.filter((ev) => insideCursorNamespace(ev)).sort((a, b) => a.seq - b.seq)
  for (const ev of spawns) {
    if (ev.parent === undefined && root === undefined) root = ev.id
    nodes.set(ev.id, {
      id: ev.id,
      parent: ev.parent,
      label: ev.label,
      status: 'pending',
      runtime: ev.runtime,
      budget: ev.budget,
      ...(ev.ownedTreeRoot === undefined ? {} : { ownedTreeRoot: ev.ownedTreeRoot }),
      ...(ev.assignmentId === undefined ? {} : { assignmentId: ev.assignmentId }),
      ...(ev.identity ? { identity: ev.identity } : {}),
      ...(ev.modelSubstitution ? { modelSubstitution: ev.modelSubstitution } : {}),
      ...(Number.isFinite(Date.parse(ev.at)) ? { spawnedAt: Date.parse(ev.at) } : {}),
      spent: zeroSpend(),
    })
  }
  for (const ev of settlements) {
    const node = requireNode(nodes, ev.id)
    const down = ev.kind === 'cancelled' || ev.status === 'down'
    node.status = ev.kind === 'cancelled' ? 'cancelled' : down ? 'failed' : 'done'
    if (ev.spent !== undefined) node.spent = cloneSpend(ev.spent)
    node.providerModel = copyProviderModelEvidence(ev.providerModel)
    node.outRef = ev.outRef
    node.failure = down
      ? (ev.failure ??
        settlementFailureCause({
          reason:
            ev.reason ?? (ev.kind === 'settled' ? ev.verdict?.notes : undefined) ?? 'child down',
          infra: ev.infra,
          retainedPendingCause: ev.retainedPendingCause,
        }))
      : undefined
    node.trace =
      ev.kind === 'cancelled'
        ? (ev.trace ?? { status: 'unavailable', reason: 'execution-did-not-start' })
        : traceEvidenceFor(ev)
    node.budgetViolation = budgetViolationOf(ev).budgetViolation
    if (ev.retainedExecution !== undefined) node.retainedExecution = ev.retainedExecution
    if (ev.retainedPendingCause !== undefined) node.retainedPendingCause = ev.retainedPendingCause
    const settledAt = Date.parse(ev.at)
    if (Number.isFinite(settledAt)) node.settledAt = settledAt
  }
  // Materialization is node evidence, not a settlement. Fold it after node creation and before
  // freezing the view; exactly one receipt per node is enforced by the journal corruption guard.
  for (const ev of events) {
    if (ev.kind !== 'materialized' && ev.kind !== 'seat-materialized') continue
    const node = requireNode(nodes, ev.id)
    node.materialization = ev.receipt
    node.runtime = ev.receipt.runtime
  }
  for (const ev of events) {
    if (ev.kind !== 'execution-bound') continue
    const node = requireNode(nodes, ev.id)
    node.executionBindings ??= []
    node.executionBindings.push(ev.binding)
  }
  // An open node's reconciled floor is its child-work base until a terminal record replaces it: a
  // retained-pending child stays `pending` here, and a view that showed zero for a node the ledger
  // charges would be a second ledger. The latest record wins; a settled node ignores it.
  for (const ev of [...events]
    .filter(
      (event): event is Extract<SpawnEvent, { kind: 'reconciled' }> => event.kind === 'reconciled',
    )
    .sort((a, b) => a.seq - b.seq)) {
    const node = requireNode(nodes, ev.id)
    if (node.status === 'pending') {
      node.spent = cloneSpend(ev.spent)
      node.failure = ev.failure
    }
  }
  // Driver inference: a separate pass so it accumulates ONTO the settled child-work base (no
  // dependence on metered-vs-settled seq order) without touching node status.
  for (const ev of events) {
    if (ev.kind !== 'metered') continue
    const node = requireNode(nodes, ev.id)
    node.spent = addSpend(node.spent, ev.spend)
  }
  const snapshots = [...nodes.values()].map(freezeSnapshot)
  return {
    root: root ?? snapshots[0]?.id ?? '',
    nodes: snapshots,
    inFlight: snapshots.filter((n) => n.status === 'running' || n.status === 'acquiring').length,
  }
}

/** The journal fold mutates the canonical snapshot shape; only bindings need a mutable list. */
type MutableSnapshot = {
  -readonly [Key in keyof NodeSnapshot]: NodeSnapshot[Key]
} & {
  executionBindings?: NonNullable<NodeSnapshot['executionBindings']>[number][]
}

function requireNode(nodes: Map<NodeId, MutableSnapshot>, id: NodeId): MutableSnapshot {
  const node = nodes.get(id)
  if (!node) {
    throw new Error(`spawn journal corrupted: settle/cancel for node '${id}' with no prior spawn`)
  }
  return node
}

function freezeSnapshot(node: MutableSnapshot): NodeSnapshot {
  return {
    id: node.id,
    parent: node.parent,
    label: node.label,
    status: node.status,
    ...(node.failure === undefined ? {} : { failure: node.failure }),
    runtime: node.runtime,
    budget: node.budget,
    ownedTreeRoot: node.ownedTreeRoot,
    assignmentId: node.assignmentId,
    identity: node.identity,
    modelSubstitution: node.modelSubstitution,
    materialization: node.materialization,
    executionBindings:
      node.executionBindings === undefined ? undefined : Object.freeze([...node.executionBindings]),
    spent: node.spent,
    providerModel: node.providerModel,
    outRef: node.outRef,
    trace: node.trace,
    ...(node.budgetViolation === undefined ? {} : { budgetViolation: node.budgetViolation }),
    ...(node.retainedExecution === undefined ? {} : { retainedExecution: node.retainedExecution }),
    ...(node.retainedPendingCause === undefined
      ? {}
      : { retainedPendingCause: node.retainedPendingCause }),
    settledAt: node.settledAt,
    spawnedAt: node.spawnedAt,
  }
}
