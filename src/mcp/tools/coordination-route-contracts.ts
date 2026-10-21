import type { AgentProfile } from '@tangle-network/agent-interface'
import type { ContinuityMode } from './coordination-messages'

/** A JSON scalar: what a route condition compares. A numeric or stateful rule is a field the
 *  settling node writes (a boolean or a counter), never an expression evaluated here. */
export type JsonScalar = string | number | boolean | null

/** One condition over a settled result: the RFC 6901 `pointer` in the latest usable result of
 *  `node` (default: the edge's source). A node that has not settled matches nothing. `equals` and
 *  `in` need the pointer to resolve; `exists` tests whether it resolves. */
export type RouteMatch = { readonly node?: string; readonly pointer: string } & (
  | { readonly equals: JsonScalar }
  | { readonly in: ReadonlyArray<JsonScalar> }
  | { readonly exists: boolean }
)

/** A route condition: one match, or every match of `all`. */
export type RouteWhen = RouteMatch | { readonly all: ReadonlyArray<RouteMatch> }

/** Where a fired route goes: a node to spawn, the end of the run, or a terminal result. */
export type RouteTarget =
  | { readonly node: string; readonly profile: AgentProfile }
  | { readonly stop: string }
  | { readonly finish: string }

/** One routes edge in coordination form. The edges leaving one node are tried in declaration
 *  order on each usable settle; the first whose `when` holds fires. */
export interface RouteOnSettleEdge {
  /** Stable edge identity carried on every `route` event and in every route spawn's key. */
  readonly edge: string
  /** The source, by profile name. */
  readonly from: string
  readonly to: RouteTarget
  /** Absent on the default edge, which is the last edge leaving its source. */
  readonly when?: RouteWhen
  /** Nodes whose latest usable result rides the target's task, and the only nodes other than
   *  `from` a match may read. */
  readonly evidence: ReadonlyArray<string>
  /** Fired traversals beyond this are skipped and recorded `unpropagated`. */
  readonly maxTraversals: number
  /** How a node target continues: `'resume'` re-attaches to the target's latest settled session
   *  when it has one. */
  readonly continuity: ContinuityMode
}

/** One entry: a node Runtime spawns, with its task, when the manager's coordination opens. */
export interface RouteEntry {
  /** The ledger identity of this entry, `routes:entry-><node>`. */
  readonly edge: string
  /** The spawn key: `route:entry:<node>`, or `route:entry:<node>#<k>` for the k-th repeat. */
  readonly key: string
  readonly node: string
  readonly profile: AgentProfile
  readonly task: unknown
}

/**
 * A flow: the coordination form of an AgentGraph with `entry`. Runtime spawns every entry when the
 * manager's coordination opens and routes every settle of a flow node, so the manager itself makes
 * no decision. Every spawn goes through the admission a `spawn_worker` call takes, carrying the
 * runtime-authored {@link RouteSpawnMarker}, so the pool, the pre-flight and node pinning judge it.
 *
 * Plain data, like a map route: flow state is process-local, and a restarted manager does not
 * replay the traversals of a prior process.
 */
export interface RouteFlow {
  readonly entries: ReadonlyArray<RouteEntry>
  readonly routes: ReadonlyArray<RouteOnSettleEdge>
  /** Nodes whose settles this flow routes, by profile name: entries, route targets, map joins. */
  readonly nodes: ReadonlyArray<string>
  /** Flow nodes with no outgoing routes edge and no outgoing maps edge: their usable settles are
   *  the run's output. */
  readonly terminals: ReadonlyArray<string>
}

/** The runtime marker on an entry or route spawn. */
export interface RouteSpawnMarker {
  /** The entry or routes edge that started this spawn. */
  readonly edge: string
  /** The node it starts. */
  readonly node: string
}

/**
 * One flow step, published as a record-only `route` event (the settle that caused it already woke
 * the manager):
 *
 * - `traversal`: an entry or a routes edge fired, or was skipped at its cap, or its spawn was
 *   refused;
 * - `output`: a terminal node or a `finish` edge made this settle part of the run's output;
 * - `stopped`: a `stop` edge fired, or a flow node settled down or without a usable result where a
 *   route was needed, and the flow spawns nothing more;
 * - `unrouted`: a flow node's usable settle matched no edge.
 */
export type RouteFlowEvent =
  | {
      readonly kind: 'traversal'
      readonly edge: string
      readonly from: string
      readonly to: string
      readonly outcome: 'delivered' | 'unpropagated'
      readonly continuity: ContinuityMode
      /** Bytes of the task that crossed, or of the result a stop or finish took. */
      readonly bytes: number
      readonly reason?: string
      /** The spawned worker, when a node target started. */
      readonly workerId?: string
      /** The settled worker whose result fired the edge. Absent on an entry. */
      readonly sourceWorker?: string
    }
  | {
      readonly kind: 'output'
      readonly node: string
      readonly workerId: string
      readonly result: unknown
      /** The finish edge, or absent for a terminal node. */
      readonly edge?: string
    }
  | {
      readonly kind: 'stopped'
      readonly at: string
      readonly workerId: string
      readonly reason: string
      /** The stop edge, or absent when a down or unusable settle ended the flow. */
      readonly edge?: string
    }
  | {
      readonly kind: 'unrouted'
      readonly node: string
      readonly workerId: string
      readonly detail: string
      readonly result?: unknown
    }
