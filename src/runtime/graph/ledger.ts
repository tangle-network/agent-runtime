/**
 * The edge ledger: what the runtime actually DELIVERED across each edge. It is observability, not
 * a fold input (agent-runtime#974) — `edge-verdict` carries the scheduler's decision, and this
 * carries the delivery, so a change to what an optimizer wants to see never changes resume
 * semantics. Its ordinals live in their own namespace, outside the kernel's cursor.
 */

import type { SpawnJournal } from '../supervise/types'
import type { CompiledEdge } from './compile'
import type { GraphEdgeTraversal } from './scheduler-types'

export interface EdgeLedger {
  readonly entries: ReadonlyArray<GraphEdgeTraversal>
  record(
    edge: CompiledEdge,
    traversal: number,
    outcome: GraphEdgeTraversal['outcome'],
    reason?: string,
  ): Promise<void>
}

/** Open a ledger for one run; its ordinals continue past whatever a prior process recorded. */
export function createEdgeLedger(args: {
  readonly journal: SpawnJournal
  readonly runId: string
  readonly now: () => number
  readonly startSeq: number
}): EdgeLedger {
  const entries: GraphEdgeTraversal[] = []
  let seq = args.startSeq
  return {
    entries,
    async record(edge, traversal, outcome, reason) {
      const spec = edge.spec
      const entry: GraphEdgeTraversal = {
        edge: edge.id,
        kind: spec.kind,
        from: spec.from.node,
        to: spec.to.node,
        traversal,
        outcome,
        ...(spec.directive !== undefined
          ? { directive: `${spec.directive.surface}/v${spec.directive.version}` }
          : {}),
        ...(spec.kind === 'data' ? { port: edge.toPort } : {}),
        ...(reason !== undefined ? { reason } : {}),
      }
      entries.push(entry)
      await args.journal.appendEvent(args.runId, {
        kind: 'edge',
        id: `graph:${spec.to.node}`,
        edge: {
          kind: spec.kind,
          from: spec.from.node,
          to: spec.to.node,
          ...(entry.directive !== undefined ? { directive: entry.directive } : {}),
          ...(entry.port !== undefined ? { port: entry.port } : {}),
        },
        traversal,
        outcome,
        bytes: 0,
        ...(reason !== undefined ? { reason } : {}),
        seq: seq++,
        at: new Date(args.now()).toISOString(),
      })
    },
  }
}
