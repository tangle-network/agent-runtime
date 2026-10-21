/**
 * One graph run's edge ledger and its journal twin: every traversal row in occurrence order, the
 * per-edge ordinals and cap charges, the exhausted edges, and the provisional spawn rows awaiting
 * the worker the kernel starts for them.
 */

import type { EdgeTraversal } from './graph'
import type { GraphLedgerSettlement } from './graph-overlay'
import type { NodeId, SpawnJournal } from './types'

export class GraphEdgeLedger {
  private readonly rows: EdgeTraversal[] = []
  private readonly journaled = new Set<EdgeTraversal>()
  // Per-edge ordinals: every row takes the next one, so the ledger reads as one full sequence.
  private readonly traversalCounts = new Map<string, number>()
  // What the caps judge, kept apart from the ordinals: a spawn row is charged when a live worker
  // BINDS it, never when it is authorized. scope.spawn runs the factory (this graph's
  // authorizeSpawn) before it decides duplicate-key, key-conflict, or a completed keyed result,
  // so a row that never binds advanced no cycle and must leave the backstop untouched (#1005).
  private readonly capSpend = new Map<string, number>()
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included. */
  readonly exhausted = new Set<string>()
  // The subset of `exhausted` that REFUSED work. Only a delegates cap closes the spawn cycle, so
  // only it can be the reason a run ended winnerless — an analyzes cap refuses nothing.
  readonly exhaustedDelegates = new Set<string>()
  private readonly journalWrites: Promise<void>[] = []
  private ledgerSeq = 0
  /** The node driving a run_graph subtask: the trusted parent of its first spawn. */
  graphNodeId: string | undefined
  /** The graph node each bound worker runs. */
  readonly nodeByWorkerId = new Map<string, NodeId>()
  // Keyed by manager AND assignment: assignment ids are unique within one manager, and every
  // manager of the run reports its spawns on the same hook stream.
  private readonly pendingByAssignment = new Map<string, EdgeTraversal>()

  constructor(
    private readonly journal: SpawnJournal,
    private readonly runId: string,
    private readonly now: () => number,
  ) {}

  /** Cap charges an edge has taken so far. */
  capUsed(edge: string): number {
    return this.capSpend.get(edge) ?? 0
  }

  // A FINAL row (its recipient already live, or a refusal) is journaled and charged on record; a
  // provisional spawn row is both only once the `agent.spawn` hook binds it to a worker.
  record(entry: Omit<EdgeTraversal, 'traversal'>, final: boolean): EdgeTraversal {
    const count = (this.traversalCounts.get(entry.edge) ?? 0) + 1
    this.traversalCounts.set(entry.edge, count)
    const row: EdgeTraversal = { ...entry, traversal: count }
    this.rows.push(row)
    if (final) {
      this.charge(row.edge)
      void this.appendJournal(row, row.workerId ?? `graph:${row.to}`)
    }
    return row
  }

  /** Hold a provisional spawn row under its manager and assignment until a worker binds it. */
  holdPendingSpawn(parentNodeId: string | undefined, assignmentId: string, row: EdgeTraversal) {
    // A keyed assignment id is stable across re-spawns, so a row still pending under it was
    // never bound (the `agent.spawn` hook would have cleared it): settle it now, before this
    // authorization takes its slot, or the earlier phantom stays `delivered` forever.
    const key = pendingKey(parentNodeId, assignmentId)
    const stale = this.pendingByAssignment.get(key)
    if (stale !== undefined) void this.settleUnbound(stale)
    this.pendingByAssignment.set(key, row)
  }

  /** Bind a pending spawn row to the worker the kernel started, then journal it. */
  readonly bindSpawn = (
    parentNodeId: string | undefined,
    assignmentId: string,
    childId: string,
  ): Promise<void> | undefined => {
    const key = pendingKey(parentNodeId, assignmentId)
    const pending = this.pendingByAssignment.get(key)
    if (!pending) return undefined
    this.pendingByAssignment.delete(key)
    const bound: EdgeTraversal = { ...pending, workerId: childId }
    this.rows[this.rows.indexOf(pending)] = bound
    this.nodeByWorkerId.set(childId, bound.to)
    this.charge(bound.edge)
    return this.appendJournal(bound, childId)
  }

  readonly settle = async (): Promise<GraphLedgerSettlement> => {
    // A spawn row is PROVISIONAL until the `agent.spawn` hook (fired synchronously once a worker
    // exists) binds it to a live worker id. A row still unbound here means the factory ran but no
    // NEW worker went live: the spawn was refused after the factory (identity conflict, runtime
    // floor) or a keyed re-spawn deduplicated to an already-completed result (prepare() runs the
    // factory, no hook fires). Both state the same truth every unpropagated row states — the
    // directive never reached a live worker — so rewrite rather than mint a new outcome; the row
    // kept its ordinal and was never charged to the edge cap. Then settle every journal write, so
    // the ledger's journal twin is complete when this returns.
    for (const pending of this.pendingByAssignment.values()) await this.settleUnbound(pending)
    this.pendingByAssignment.clear()
    await Promise.all(this.journalWrites)
    return {
      ledger: Object.freeze(this.rows.map((row) => Object.freeze({ ...row }))),
      exhaustedEdges: Object.freeze([...this.exhausted]),
      exhaustedDelegates: Object.freeze([...this.exhaustedDelegates]),
    }
  }

  private charge(edge: string): void {
    this.capSpend.set(edge, (this.capSpend.get(edge) ?? 0) + 1)
  }

  // A provisional spawn row that never bound a live worker states the same truth every
  // unpropagated row states — the directive never reached a worker — so it is rewritten in place
  // rather than minted as a new outcome; its ordinal stands and the edge cap was never charged.
  private settleUnbound(pending: EdgeTraversal): Promise<void> {
    const refused: EdgeTraversal = {
      ...pending,
      outcome: 'unpropagated',
      bytes: 0,
      reason: `no-live-worker-bound (spawn refused after the factory, or a keyed re-spawn deduplicated to a completed result; ${pending.bytes} composed bytes never crossed)`,
    }
    this.rows[this.rows.indexOf(pending)] = refused
    return this.appendJournal(refused, `graph:${refused.to}`)
  }

  private appendJournal(entry: EdgeTraversal, nodeIdForEvent: string): Promise<void> {
    if (this.journaled.has(entry)) return Promise.resolve()
    this.journaled.add(entry)
    const write = this.journal.appendEvent(this.runId, {
      kind: 'edge',
      id: nodeIdForEvent,
      ...(this.graphNodeId === undefined ? {} : { graph: this.graphNodeId }),
      edge: {
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        // An entry row crosses no edge directive.
        ...(entry.directive === '' ? {} : { directive: entry.directive }),
      },
      traversal: entry.traversal,
      outcome: entry.outcome,
      continuity: entry.continuity,
      bytes: entry.bytes,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.map !== undefined ? { map: entry.map } : {}),
      ...(entry.gate !== undefined ? { gate: entry.gate } : {}),
      seq: this.ledgerSeq++,
      at: new Date(this.now()).toISOString(),
    })
    this.journalWrites.push(write)
    return write
  }
}

const pendingKey = (parentNodeId: string | undefined, assignmentId: string): string =>
  `${parentNodeId ?? ''}\u0000${assignmentId}`
