/** Result vocabulary shared by the scheduler and the fold (agent-runtime#973, #974, #976). */

export type GraphRunReason =
  | 'all-children-down'
  | 'budget-exhausted'
  | 'aborted'
  | 'driver-failed'
  | 'cycle-budget-exceeded'
  | 'unreachable-terminal'

/** One node settlement as the graph result reports it. */
export interface GraphNodeSettle {
  readonly node: string
  readonly visit: number
  /** Run-wide settle ordinal. `GraphRunResult.settles` is sorted by it, so the array reads in the
   *  order the run actually settled — not grouped by node, which is what a reader assumes and
   *  what the first consumer of this API tripped on. */
  readonly seq: number
  readonly status: 'done' | 'down'
  /** The node's completion check verdict; `undefined` when the node declares no check. */
  readonly valid?: boolean
  readonly out?: unknown
  readonly outRef?: string
  readonly reason?: string
}

/** One ledgered edge firing (or refusal) — the run's observable data flow. */
export interface GraphEdgeTraversal {
  readonly edge: string
  readonly kind: 'delegates' | 'analyzes' | 'data'
  readonly from: string
  readonly to: string
  readonly traversal: number
  readonly outcome: 'delivered' | 'empty' | 'unpropagated'
  readonly directive?: string
  readonly port?: string
  readonly reason?: string
}

export type GraphRunResult =
  | {
      readonly kind: 'winner'
      readonly out: unknown
      readonly terminals: ReadonlyArray<GraphNodeSettle>
      readonly settles: ReadonlyArray<GraphNodeSettle>
      readonly ledger: ReadonlyArray<GraphEdgeTraversal>
    }
  | {
      readonly kind: 'no-winner'
      readonly reason: GraphRunReason
      readonly error?: { readonly name: string; readonly message: string }
      readonly terminals: ReadonlyArray<GraphNodeSettle>
      readonly settles: ReadonlyArray<GraphNodeSettle>
      readonly ledger: ReadonlyArray<GraphEdgeTraversal>
      /** Nodes provably stuck when the run ended: every upstream settled, no release possible. */
      readonly unreachable: ReadonlyArray<string>
    }
  | {
      /** Every live branch parked on a host wake: a legitimate terminal state for an offline run.
       *  Restart over the same journal and `resume(token, payload)` to continue (#976). */
      readonly kind: 'suspended'
      readonly tokens: ReadonlyArray<string>
      readonly terminals: ReadonlyArray<GraphNodeSettle>
      readonly settles: ReadonlyArray<GraphNodeSettle>
      readonly ledger: ReadonlyArray<GraphEdgeTraversal>
    }
