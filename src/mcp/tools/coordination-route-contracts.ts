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

/** Where a fired route goes: the nodes to spawn (one, or every node of a fork at once), a gate
 *  that asks the caller, the end of the run, or a terminal result. */
export type RouteTarget =
  | { readonly nodes: ReadonlyArray<{ readonly node: string; readonly profile: AgentProfile }> }
  | { readonly gate: string }
  | { readonly stop: string }
  | { readonly finish: string }

/** A vertex that is not an agent: reaching it asks the caller for one of `choices`. The edges
 *  leaving it match `{ pointer: '/choice', equals: <choice> }`, one edge per choice. */
export interface RouteGate {
  readonly id: string
  readonly question: string
  readonly choices: ReadonlyArray<string>
}

/** What a gate asks its caller. `visit` is the 1-based count of times this run reached the gate;
 *  `evidence` is the evidence of the edge that reached it, with that edge's source. */
export interface GateRequest {
  readonly gate: string
  readonly visit: number
  readonly question: string
  readonly choices: ReadonlyArray<string>
  readonly evidence: Readonly<Record<string, unknown>>
}

/** The caller's answer to one gate visit: route on a choice, or end the run. `by` names who
 *  decided and rides the decision's ledger row. */
export type GateDecision =
  | { readonly kind: 'choose'; readonly choice: string; readonly by: string }
  | { readonly kind: 'stop'; readonly reason: string; readonly by: string }

/** The coordination layer's gate decider: the caller's decision, marked `replayed` when it came
 *  from the run journal instead of the caller, so its ledger row is not journaled twice. */
export type DecideGate = (
  request: GateRequest,
) => Promise<GateDecision & { readonly replayed?: boolean }>

/** A decision's facts on its ledger row and journal twin. */
export type GateDecisionRecord = { readonly by: string } & (
  | { readonly choice: string }
  | { readonly stop: string }
)

/** One routes edge in coordination form. The edges leaving one node are tried in declaration
 *  order on each usable settle; the first whose `when` holds fires. A join (several `from` nodes)
 *  is the only edge leaving each of its members, carries no `when`, and fires once every member
 *  has settled usably since it last fired. */
export interface RouteOnSettleEdge {
  /** Stable edge identity carried on every `route` event and in every route spawn's key. */
  readonly edge: string
  /** The source by profile name, or every member of a join. */
  readonly from: ReadonlyArray<string>
  readonly to: RouteTarget
  /** Absent on the default edge, which is the last edge leaving its source. */
  readonly when?: RouteWhen
  /** Nodes whose latest usable result rides the target's task, and the only nodes other than
   *  `from` a match may read. A join's members ride it too. */
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
 * replay the traversals of a prior process. A gate decision is the exception: the decider replays a
 * journaled decision instead of asking the caller again.
 */
export interface RouteFlow {
  readonly entries: ReadonlyArray<RouteEntry>
  readonly routes: ReadonlyArray<RouteOnSettleEdge>
  /** Gates a routes edge can reach. A flow with gates needs `CoordinationToolsOptions.decideGate`. */
  readonly gates?: ReadonlyArray<RouteGate>
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
 *   refused, or a gate was decided (`gate` set; its edge is `gate:<id>`);
 * - `output`: a terminal node or a `finish` edge made this settle part of the run's output;
 * - `stopped`: a `stop` edge fired, a gate decided `stop`, or a flow node settled down or without a
 *   usable result where a route was needed, or a gate was undecided at the deadline, and the flow
 *   spawns nothing more;
 * - `unrouted`: a flow node's usable settle matched no edge (`unrouted`), or a fired edge named a
 *   node that still has a running worker (`target-live`); converging branches use a join.
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
      /** A gate decision: who decided and what. `replayed` decisions are already journaled. */
      readonly gate?: GateDecisionRecord & { readonly replayed?: boolean }
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
      /** The stop edge or `gate:<id>`, or absent when a down or unusable settle or the deadline
       *  ended the flow. */
      readonly edge?: string
    }
  | {
      readonly kind: 'unrouted'
      readonly reason: 'unrouted' | 'target-live'
      readonly node: string
      readonly workerId: string
      readonly detail: string
      readonly result?: unknown
    }
