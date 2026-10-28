/**
 *
 * `runGraph` — agent graphs: profiles as nodes, registry-backed prompt directives as edges.
 *
 * A topology is PLAIN DATA an agent can author in a few lines: nodes are canonical
 * `AgentProfile`s (the ONLY way a node is described — no role-builder functions), edges are typed
 * values carrying versioned {@link PromptHandle} directives, `deliverable` (termination) and
 * `budget` (one conserved pool) are mandatory. Driver↔worker is the two-node cyclic instance;
 * "agent 3 analyzes 1 and 2 and reports to 1" is ONE edge, not a framework.
 *
 * NOT A SECOND SCHEDULER. `runGraph` is an interpretation layer over what already runs:
 * `supervise()` is the execution core — the same `supervisorAgent`/`driverAgent` machinery,
 * backend-derived worker path (authorized, classified, recursive), conserved-pool budget, and
 * deliverable-gated settlement every
 * supervised run uses. (`runAgentRounds` is deliberately NOT the substrate here.) What the graph
 * layer ADDS is exactly what a bespoke driver loop never
 * had:
 *
 *  1. **Node pinning** — a spawn names a node (`profile.name` = node id) and the node's canonical
 *     profile is what runs; a driver cannot smuggle capabilities into a worker it did not define.
 *  2. **Observable edges** — every delegates/analyzes/maps/routes traversal lands in an EDGE LEDGER
 *     (`delivered | stripped | empty | unpropagated | failed`, with byte counts), in memory on
 *     the result AND as `edge` events in the run journal. The motivating incident: a filter
 *     silently replaced 1,700-char steering with 241 chars of boilerplate for three rounds and
 *     NO artifact said so — an unobservable edge cannot be trusted and its directive cannot be
 *     optimized.
 *  3. **Directives as data** — edge text lives in the prompt registry (`<surface>/v<n>`), so every
 *     edge is a versioned optimization target, never prose hardcoded in a builder function.
 *  4. **Per-edge traversal caps** — the cyclic-graph backstop. A delegates edge whose cap is
 *     exhausted REFUSES further traversals (fail loud), so a cycle cannot spin the pool dry.
 *  5. **Continuity as data** — a delegates edge may declare `continuity: 'resume'`, so each spawn
 *     after the node's first re-attaches to its latest SETTLED session (the spawn context hands
 *     the executor seam `resume: { ofWorker, sequence }`; the kernel keeps identity, ordering,
 *     ledger truth, and the one conserved pool). Every ledger row states how its hop continued:
 *     `'fresh' | 'resume'` for spawns, `'steer'` for mid-run deliveries — fresh respawns, session
 *     resumes, and live steers are all plain data, each a ledgered fact.
 *  6. **Fan-out over a run-time list** — a `maps` edge takes the array a JSON pointer selects in a
 *     node's settled result and runs one item per element, then hands the ordered results to a
 *     join node. The runtime spawns every item and the join when the source settles, so the
 *     driver spends no model turn on them; each item is a spawn through the same authorized path,
 *     reserving from the same conserved pool, and every expansion, item and join is a ledger row.
 *  7. **Flow graphs** — with `entry` set, no node is a root: Runtime spawns the entries and fires
 *     `routes` edges on each settle (`graph-flow.ts`), so a fixed order, a branch, a bounded repair
 *     loop and a stop rule are graph data. The root manager is Runtime's own and never calls a
 *     model; every entry and route spawn takes the same authorized path a map item takes.
 *
 * ORACLES ARE ENVIRONMENT, NEVER WORKERS. Graders/verifiers must not be spawnable in the graph —
 * a delegates edge to them leaks the rubric. An `analyzes` edge names its analyst in one of two
 * forms: a LENS id from the environment's registry (a pure function over trace evidence), or the
 * id of a graph NODE — a tool-equipped analyst AGENT spawned on each matching settle with the
 * node's pinned profile, whose settle output IS the findings. Either way the oracle doctrine
 * holds: an analyst node can never be a delegates target (refused loudly), so no driver can hand
 * it work, and an id living in both the registry and the nodes is refused as ambiguous.
 *
 * @experimental
 */

import { resolve } from 'node:path'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { ConfigError, ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { MakeWorkerAgent } from '../../mcp/tools/coordination-contracts'
import type { MapItemFailurePolicy } from '../../mcp/tools/coordination-map-contracts'
import type { ContinuityMode } from '../../mcp/tools/coordination-messages'
import type {
  GateDecision,
  GateDecisionRecord,
  GateRequest,
  RouteGate,
  RouteWhen,
} from '../../mcp/tools/coordination-route-contracts'
import { composeRuntimeHooks, type RuntimeHooks } from '../../runtime-hooks'
import { harnessRunsAgent } from '../harness-role'
import type { ToolLoopChat } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import { runtimeFlowBrain } from './flow-brain'
import { graphExecutionOptions } from './graph-backend'
import {
  createFlowRun,
  flowRootProfile,
  flowRouteDeliverable,
  GraphRouteError,
  journaledGateDecider,
  routeFlowOf,
  validateFlowGraph,
} from './graph-flow'
import { createGraphOverlay } from './graph-overlay'
import {
  graphRootProfile,
  type RootValidatedGraph,
  type ValidatedGraph,
  validateGraphTopology,
} from './graph-topology'
import { kernelPromptRegistry, type PromptHandle, type PromptRegistry } from './prompt-registry'
import { createFileRunContext, createInMemoryRunContext, withRunContext } from './run-context'
import { bindGraphCommand, type GraphCommandCheck } from './stored-graph-check'
import {
  profileGuidanceComposer,
  type SuperviseOptions,
  supervise,
  superviseWithTestBrain,
} from './supervise'
import type { Budget, NodeId, ResultBlobStore, SpawnJournal, SupervisedResult } from './types'

export type { MapItemFailurePolicy } from '../../mcp/tools/coordination-map-contracts'
export type {
  GateDecision,
  GateRequest,
  JsonScalar,
  RouteGate as GraphGate,
  RouteMatch,
  RouteWhen,
} from '../../mcp/tools/coordination-route-contracts'
export { GraphRouteError } from './graph-flow'
export { defaultEdgeTraversalCap } from './graph-topology'

// ── The algebra ────────────────────────────────────────────────────────────────

/** A graph node: an id and a canonical `AgentProfile`. The profile is the ONLY way a node is
 *  described — its `prompt.systemPrompt` is the standing role (the 0.117 canonical resolution;
 *  never a legacy top-level-only reduction), its tools/mcp/resources are its capabilities. */
export interface GraphNode {
  readonly id: NodeId
  readonly profile: AgentProfile
}

export type GraphEdge =
  /** Work flows down. The delegation directive is DATA → versionable, sweepable, optimizable.
   *  Each spawn of `to` by `from` — and each mid-run steer from `from` to a live `to` worker —
   *  is one traversal. */
  | {
      readonly kind: 'delegates'
      readonly from: NodeId
      readonly to: NodeId
      readonly directive: PromptHandle
      /** Cyclic-graph backstop: traversals beyond this REFUSE (fail loud). Default
       *  {@link defaultEdgeTraversalCap}. */
      readonly maxTraversals?: number
      /** Default continuity for this edge's SPAWN traversals. `'resume'` makes every spawn after
       *  the node's first re-attach to its most recent SETTLED worker: a NEW live worker whose
       *  spawn context carries `resume: { ofWorker, sequence }` for the executor seam, spending
       *  from the same conserved pool — the node's first spawn is effectively `'fresh'`, and a
       *  spawn while a prior worker is still live refuses loudly (steer is the live channel).
       *  The driver's per-call `spawn_worker` `continuity` argument overrides either way. Omit =
       *  `'fresh'` (today's behavior, byte-identical). Caps count resumes exactly like fresh
       *  spawns. */
      readonly continuity?: ContinuityMode
    }
  /** Findings flow anywhere: an analyst over N nodes' settled traces, delivered to ONE node.
   *  With a LENS analyst the directive wraps the findings for the recipient; with a NODE analyst
   *  the directive is the analyst agent's task and the findings are its settle output. */
  | {
      readonly kind: 'analyzes'
      /** The analyst REFERENCE, in one of two forms: a lens id resolved against
       *  `RunGraphOptions.analysts` (environment), or the id of a graph NODE with no delegates
       *  edge pointing at it — then each matching settle spawns that node's pinned profile as a
       *  tool-equipped analyst WORKER (same spawn machinery, conserved budget, trace join) whose
       *  task is this edge's directive plus the settled worker's trace evidence and whose settle
       *  output is the findings. An id that is both a node and a registry lens is refused. */
      readonly analyst: string
      readonly over: ReadonlyArray<NodeId>
      readonly to: NodeId
      readonly directive: PromptHandle
      /** Observability cap: traversals beyond this are LEDGERED as exhausted (`unpropagated`).
       *  Only delegates caps refuse traversal — they are what close the spawn cycle. */
      readonly maxTraversals?: number
    }
  /**
   * Fan-out over a list that exists only at run time, then one join. When `from` settles `done`,
   * the array at `pointer` in its result is expanded: each element becomes the TASK of one item
   * run, at most `concurrency` at a time, and once every item settled the `join` node runs with
   * `{ map, source, items, results: [{ index, item, result }], failures: [{ index, item, outcome,
   * reason }] }`, results in item order. The runtime spawns the items and the join (`from`'s
   * driver spends no turn on them) through the same authorized spawn path a delegates spawn
   * takes: each item reserves its budget from the one conserved pool and is pinned to the edge's
   * profile, so an item's content can never choose what runs.
   *
   * An item is either the node `to` (its pinned profile plus this edge's directive) or the nested
   * `graph`, started per item exactly as `run_graph` starts a graph. Refusals are loud and
   * ledgered, and the driver is woken with them: a pointer that does not resolve to an array, more
   * elements than `maxItems`, or a `concurrency` the run's worker-slot bound can never honor.
   * `concurrency` otherwise THROTTLES (items wait for a free place); it never refuses an item.
   *
   * An edge rather than a node-level spec, because every kernel invariant a map must keep already
   * attaches to edge traversal: pinning admits only the edge's item and join nodes (the spawn
   * context carries a runtime-authored `map` marker), each item is admitted like a spawn and
   * reserves from the conserved pool, each item settles under its own deliverable check, and each
   * expansion, item and join is a ledger row with its journal twin. Topology stays static; only the
   * traversal count is dynamic, so validation and the one-node-one-profile rule are unchanged.
   */
  | {
      readonly kind: 'maps'
      /** The source node: a delegates target, or the join of another maps edge. Each of its `done`
       *  settles expands the map once. */
      readonly from: NodeId
      /** RFC 6901 JSON pointer into `from`'s settled result (`''` is the whole result). */
      readonly pointer: string
      /** The item node, run once per element with the element as its task. Exactly one of `to`
       *  and `graph`. Reachable only through this edge: never a delegates target. */
      readonly to?: NodeId
      /** A graph run per element as one subtask, through the `run_graph` path. */
      readonly graph?: GraphTopology
      /** Receives the ordered results once every item settled. Reachable only through this edge. */
      readonly join: NodeId
      /** The item directive, appended to the item node's instructions per traversal. */
      readonly directive: PromptHandle
      /** Lists longer than this are refused before any item runs. */
      readonly maxItems: number
      /** How many items run at once. */
      readonly concurrency: number
      readonly onItemFailure: MapItemFailurePolicy
      /** Each item's budget, merged over the per-worker default as `spawn_worker`'s `budget` is. */
      readonly itemBudget?: Partial<Budget>
    }
  /**
   * A route in a flow graph (one with `entry`): Runtime traverses it when `from` settles, so no
   * root decides the order, the branch, the repair loop or the stop. On each usable settle of
   * `from` its outgoing routes edges are tried in declaration order and the first whose `when`
   * holds fires; an edge without `when` is the default branch and comes last. A node target is
   * spawned with `{ from: { node, result }, evidence: { [id]: latest usable result } }` (a join's
   * target with `{ from: { nodes }, evidence }`, see below) and the directive appended to its pinned instructions; `{ stop }` ends the run with no winner and
   * `GraphResult.stopped`; `{ finish }` makes this settle part of the run's output.
   *
   * A fork lists two or more nodes in `to`: one traversal spawns each of them at once, each under
   * its own key `route:<edge id>#<traversal>:<node>`. A join lists two or more nodes in `from`: it
   * fires once every member has settled usably since it last fired, and the target's task is
   * `{ from: { nodes: <members in declared order> }, evidence }` with each member's latest result
   * in `evidence`, so it does not depend on which member settled last and a resumed run derives the
   * same task. A routes edge that spawns a node with a settled worker in this flow (a back edge)
   * names that node's latest settled worker as the spawn's `successorOf`. A join carries no `when`, and it is the only routes edge
   * leaving each of its members. A route into a node that still has a running worker throws
   * {@link GraphRouteError} with reason `target-live`: converging branches use a join.
   */
  | {
      readonly kind: 'routes'
      readonly from: NodeId | ReadonlyArray<NodeId>
      readonly to:
        | NodeId
        | ReadonlyArray<NodeId>
        | { readonly stop: string }
        | { readonly finish: string }
      readonly directive: PromptHandle
      /** Absent on the default edge and on every join. A match reads `from` unless it names a node
       *  in `evidence`. */
      readonly when?: RouteWhen
      /** Nodes whose latest usable result rides the target's task. */
      readonly evidence?: ReadonlyArray<NodeId>
      /** Traversals beyond this are skipped (ledgered `unpropagated`) and matching continues with
       *  the next edge. Default {@link defaultEdgeTraversalCap}. Every routes cycle, each subcycle
       *  included, must cross an edge that sets it. */
      readonly maxTraversals?: number
      /** `'resume'` re-attaches each spawn of the target to its latest settled session. Omit =
       *  `'fresh'`. */
      readonly continuity?: ContinuityMode
    }

/** A topology without the run's own budget and deliverable: the form a `maps` edge runs per item,
 *  as `run_graph` runs it. With `entry` it is a flow graph. Inside a maps item, the item value is
 *  the task of every entry whose task is the placeholder `{ item: true }`; a down settle inside the item ends
 *  that item only, and the maps edge's `onItemFailure` decides the join. */
export interface GraphTopology {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  readonly entry?: AgentGraph['entry']
  /** Refused here: a maps item's graph and a `run_graph` subtask have no `decideGate`. */
  readonly gates?: AgentGraph['gates']
}

export interface AgentGraph {
  /** Preserve fully bound literal data when serializing a hydrated graph. */
  readonly triggerBindings?: readonly []
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  /** Termination is mandatory, not optional: the independent completion oracle. */
  readonly deliverable: DeliverableSpec<unknown> & {
    readonly checkRef?: string
    readonly command?: GraphCommandCheck
    readonly when?: RouteWhen
  }
  /** One conserved pool across the whole graph — cycles without conservation never terminate. */
  readonly budget: Budget
  /** Setting it makes this a FLOW graph: Runtime spawns every entry at once, each with its task,
   *  and traverses `routes` edges itself. No node is a root and no caller brain runs; the run's
   *  output is `{ [node]: latest usable result }` over its terminal nodes and `finish` sources,
   *  judged by `deliverable`. */
  readonly entry?: ReadonlyArray<{ readonly node: NodeId; readonly task: unknown }>
  /** Flow-graph vertices that are not agents: a routes edge into one awaits
   *  `RunGraphOptions.decideGate`, and one edge per choice leaves it, matching
   *  `{ pointer: '/choice', equals: <choice> }`. A `finish` leaving a gate outputs
   *  `{ [gate]: { choice, by } }`. */
  readonly gates?: ReadonlyArray<RouteGate>
}

// ── The edge ledger ────────────────────────────────────────────────────────────

/** `failed` is a maps item or join that ran and settled without a usable result (down, or
 *  rejected by its deliverable check); a traversal that never reached a worker is `unpropagated`. */
export type EdgeDeliveryOutcome = 'delivered' | 'stripped' | 'empty' | 'unpropagated' | 'failed'

/** How one ledgered hop CONTINUED: a spawn traversal stamps its effective spawn mode
 *  (`'fresh'` | `'resume'`), and every mid-run delivery into an already-live recipient — a
 *  driver steer leg and every analyzes delivery (routed steer or driver-destined finding) —
 *  stamps `'steer'`. Zero ambiguity: every row carries exactly one of the three. */
export type TraversalContinuity = ContinuityMode | 'steer'

/** One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent. */
export interface EdgeTraversal {
  /** Stable edge id: `delegates:<from>-><to>`, `analyzes:<analyst>:<over…>-><to>`,
   *  `maps:<from>-><to | graph>-><join>`, `routes:<from>#<ordinal>-><to | stop:<reason> |
   *  finish:<reason>>`, or `routes:entry-><node>` for an entry. */
  readonly edge: string
  readonly kind: 'delegates' | 'analyzes' | 'maps' | 'routes'
  readonly from: string
  readonly to: string
  /** The resolved directive reference (`<surface>/v<n>`). */
  readonly directive: string
  /** 1-based per-edge ordinal. */
  readonly traversal: number
  readonly outcome: EdgeDeliveryOutcome
  /** How this hop continued — see {@link TraversalContinuity}. */
  readonly continuity: TraversalContinuity
  /** Bytes of directive + payload that actually crossed the edge. */
  readonly bytes: number
  readonly reason?: string
  /** The concrete worker node id, once known. A maps expansion names the source worker. */
  readonly workerId?: string
  /** Present on maps rows: the expansion of the source's list, one item by its index, or the
   *  join. */
  readonly map?: { readonly phase: 'expand' | 'item' | 'join'; readonly index?: number }
  /** Present on a gate's decision row (`gate:<id>`, `traversal` = visit): who decided, and what. */
  readonly gate?: GateDecisionRecord
}

/** A delegates edge exhausted its traversal cap and the run produced no winner: the cap, not the
 *  task, ended it. Carries the full evidence so failing loud loses nothing. */
export class GraphEdgeCapError extends Error {
  readonly exhaustedEdges: ReadonlyArray<string>
  readonly ledger: ReadonlyArray<EdgeTraversal>
  readonly result: SupervisedResult<unknown>
  constructor(
    exhaustedEdges: ReadonlyArray<string>,
    ledger: ReadonlyArray<EdgeTraversal>,
    result: SupervisedResult<unknown>,
  ) {
    super(
      `runGraph: edge traversal cap exhausted on ${exhaustedEdges.join(', ')} and the run ` +
        'delivered no winner — the cap (the cyclic-graph backstop), not the task, ended this run. ' +
        'Raise maxTraversals on the edge or fix the cycle; the full edge ledger and the ' +
        'supervised result ride on this error.',
    )
    this.name = 'GraphEdgeCapError'
    this.exhaustedEdges = exhaustedEdges
    this.ledger = ledger
    this.result = result
  }
}

// ── Options / result ───────────────────────────────────────────────────────────

/**
 * Every `SuperviseOptions` key, partitioned by what `runGraph` does with it.
 *
 * `runGraph` starts one `supervise()` run, so every option that run honors is a graph option too
 * unless the graph itself owns the value. This used to be an opt-in list written by hand, and the
 * hand lost: 25 of 49 keys never reached `supervise()` from a graph, including `childSettleGraceMs`
 * (a root-driver failure tore down children that had ALREADY computed the deliverable) and
 * `driverRetry` (agent-runtime#963). Each absence was discovered by losing a run.
 *
 * The four lists below must cover `keyof SuperviseOptions` exactly. `everySuperviseOptionIsClassified`
 * below fails to COMPILE, naming the offender, when a key belongs to none of them — so the next
 * option added to `supervise()` cannot go missing here silently. It has to be classified, and
 * classifying it as forwarded is one word.
 */

/** The graph derives these from the `AgentGraph` itself; a caller value would be overwritten. */
const GRAPH_OWNED_SUPERVISE_OPTIONS = [
  'rootDriverFromBackend',
  'resolveSpawnProfile',
  'budget',
  'deliverable',
  'makeWorkerAgent',
  'onCoordinationEvent',
  'analyzeOnSettle',
  'mapOnSettle',
  // A flow graph's entries and routes edges; its runtime-owned root runs them.
  'routeFlow',
  'continuityByProfile',
  // A graph pins every node and its delegation edges; a node never gains spawn rights it lacks.
  'inheritSpawnRights',
] as const

/** Caller-facing on `RunGraphOptions`, but the graph wraps or defaults the value before it goes in:
 *  `hooks` composes with the graph's own spawn-binding hook, `authorizeMessage` is wrapped so a
 *  narrowed instruction ledgers `stripped`, `authorizeSpawn` runs AFTER the graph has pinned the
 *  node (so a product sees the canonical profile, never the driver's stub), `makeLeafAgent` is the
 *  caller's leaf override slotted under the graph's pinning, `analysts` rides only with analyze
 *  routes, and `journal`/`blobs`/`runId` get graph defaults. */
const GRAPH_TRANSFORMED_SUPERVISE_OPTIONS = [
  'hooks',
  'authorizeMessage',
  'authorizeSpawn',
  'makeLeafAgent',
  'analysts',
  'journal',
  'blobs',
  'runId',
  // Replays a journaled decision before asking the caller.
  'decideGate',
] as const

/** Not reachable from a graph, with the reason. `registry` is a NAME COLLISION, not a policy:
 *  `RunGraphOptions.registry` is the directive `PromptRegistry` and `SuperviseOptions.registry` is
 *  the `SuperviseRegistry` name→value table. Two different types under one name; the graph's wins.
 *  Giving the supervise one a graph channel means renaming a public option, so it is recorded here
 *  rather than silently dropped. */
const GRAPH_REFUSED_SUPERVISE_OPTIONS = ['registry'] as const

/**
 * Forwarded to the root `supervise()` VERBATIM. Everything not owned, transformed, or refused
 * above belongs here — the default is "a graph honors it", not "someone remembered to add it".
 */
const GRAPH_FORWARDED_SUPERVISE_OPTIONS = [
  'parking',
  'backend',
  // Forwarded: composes guidance into the root and into profiles a manager authors. The graph also
  // composes each PINNED node profile, because pinning replaces the composed `{ name }` stub.
  'profileGuidance',
  // Forwarded, not graph-owned: a graph pins WHICH nodes run, never who answers a question one of
  // them raises. Without it a graph run's `ask_parent` would always report `no-parent` even when
  // the caller wired an inbox.
  'escalateQuestion',
  'rootHandle',
  'signal',
  'execution',
  'resolveDeliverable',
  'coordination',
  'peerMail',
  'peerAudit',
  'traceTools',
  'driverBackend',
  'profileSecurity',
  'authorizeSpawn',
  'router',
  'driveHarness',
  'selectSeat',
  'driverRetry',
  'onDriverAttempt',
  'workerRetry',
  'onWorkerRetry',
  'continuation',
  'childSettleGraceMs',
  'teardownConfirmMs',
  'retainedAtSettlement',
  'resolveDriveHarness',
  'driveHarnessMaterialization',
  'resolveSupervisorTools',
  'extraTools',
  'executeExtraTool',
  'recoverExecutor',
  'perWorker',
  'reservationPolicy',
  'deadlineCheckIn',
  'budgetStopHoldMs',
  'workerSlots',
  'watchWorkers',
  'stallAfterMs',
  'wake',
  'runDir',
  'resume',
  'segment',
  'runContext',
  'steerDir',
  'stopRule',
  'onProgressStop',
  'maxDepth',
  'maxTurns',
  'compaction',
  'now',
  'allowedModels',
  'finalizer',
  'otel',
  // Forwarded: the registry a manager's `run_graph` resolves stored graphs against. A node of this
  // graph cannot start another graph (pinning refuses it), so it matters to no node here.
  'graphRegistry',
] as const

type ClassifiedSuperviseOption =
  | (typeof GRAPH_OWNED_SUPERVISE_OPTIONS)[number]
  | (typeof GRAPH_TRANSFORMED_SUPERVISE_OPTIONS)[number]
  | (typeof GRAPH_REFUSED_SUPERVISE_OPTIONS)[number]
  | (typeof GRAPH_FORWARDED_SUPERVISE_OPTIONS)[number]

/**
 * Every key `RunGraphOptions` accepts, as data: the forwarded and transformed `SuperviseOptions`
 * keys, the name-colliding `registry`, and the graph's own `brain`. `GRAPH_OWNED_SUPERVISE_OPTIONS`
 * is deliberately absent — a caller value for one of those is overwritten by the graph, so it is
 * refused by name rather than discarded.
 *
 * The assignment below fails to COMPILE, naming the key, when `RunGraphOptions` declares something
 * this list does not carry.
 */
const runGraphOptionKeys = [
  ...GRAPH_FORWARDED_SUPERVISE_OPTIONS,
  ...GRAPH_TRANSFORMED_SUPERVISE_OPTIONS,
  ...GRAPH_REFUSED_SUPERVISE_OPTIONS,
  'brain',
] as const

type UnlistedRunGraphOption = Exclude<keyof RunGraphOptions, (typeof runGraphOptionKeys)[number]>
const everyRunGraphOptionIsListed: UnlistedRunGraphOption extends never
  ? true
  : UnlistedRunGraphOption = true
void everyRunGraphOptionIsListed

const runGraphOptionKeySet: ReadonlySet<string> = new Set<string>(runGraphOptionKeys)
const graphOwnedOptionKeySet: ReadonlySet<string> = new Set<string>(GRAPH_OWNED_SUPERVISE_OPTIONS)

/**
 * Refuse an option key the graph would not read, naming it and saying which kind it is.
 *
 * A graph-owned key is the sharper case: it type-checks against a widened `SuperviseOptions`
 * value, the graph derives its own value and overwrites the caller's, the run succeeds, and the
 * capability the caller asked for is not there. The rename of the leaf seam from `makeWorkerAgent`
 * to `makeLeafAgent` is the shape of the failure — the old name stayed a valid `SuperviseOptions`
 * key AND a graph-owned one, so a caller that kept passing it got a run with no leaf override and
 * no complaint.
 */
function assertRunGraphOptionKeys(opts: RunGraphOptions): void {
  const graphOwned: string[] = []
  const unknown: string[] = []
  for (const key of Object.keys(opts)) {
    if (runGraphOptionKeySet.has(key)) continue
    if (graphOwnedOptionKeySet.has(key)) graphOwned.push(key)
    else unknown.push(key)
  }
  if (graphOwned.length > 0) {
    throw new ConfigError(
      `runGraph: ${graphOwned.sort().join(', ')} — the graph derives this from the AgentGraph ` +
        'itself, so a caller value is overwritten and the capability it asks for would silently ' +
        'be absent',
    )
  }
  if (unknown.length > 0) {
    throw new ConfigError(
      `runGraph: unknown option ${unknown.sort().join(', ')} — no reader consults that name, so ` +
        'the value would be discarded and the capability it asks for would silently be absent',
    )
  }
}

/** A `SuperviseOptions` key in none of the four lists makes this assignment fail, and the compiler
 *  error names the key. Classify it — `GRAPH_FORWARDED_SUPERVISE_OPTIONS` is usually the answer. */
type UnclassifiedSuperviseOption = Exclude<keyof SuperviseOptions, ClassifiedSuperviseOption>
const everySuperviseOptionIsClassified: UnclassifiedSuperviseOption extends never
  ? true
  : UnclassifiedSuperviseOption = true
void everySuperviseOptionIsClassified

/** `backend` and `driverBackend` keep graph-specific documentation below.
 *
 * Do not inherit and redeclare them through an indexed access type.
 * TypeScript 7 correctly treats `SuperviseOptions['backend']` as including `undefined`, which makes
 * that redeclaration wider than the exact optional property inherited from `SuperviseOptions`.
 */
type GraphInheritedSuperviseOption = Exclude<
  (typeof GRAPH_FORWARDED_SUPERVISE_OPTIONS)[number],
  'backend' | 'driverBackend'
>

/** Copy every forwarded option the caller actually set. Absent stays absent: `supervise()` and the
 *  graph must not disagree about what "unset" means. */
function forwardedSuperviseOptions(
  opts: RunGraphOptions,
): Pick<SuperviseOptions, (typeof GRAPH_FORWARDED_SUPERVISE_OPTIONS)[number]> {
  const forwarded: Record<string, unknown> = {}
  for (const key of GRAPH_FORWARDED_SUPERVISE_OPTIONS) {
    const value = (opts as Record<string, unknown>)[key]
    if (value !== undefined) forwarded[key] = value
  }
  return forwarded as Pick<SuperviseOptions, (typeof GRAPH_FORWARDED_SUPERVISE_OPTIONS)[number]>
}

/**
 * Options for one `runGraph` run.
 *
 * Extends every forwarded `SuperviseOptions` key, so a graph honors what a `supervise()` run
 * honors WITHOUT anyone restating it here. Only the graph-specific members and the ones whose
 * graph semantics differ are declared below; everything else inherits its type AND its
 * documentation from `SuperviseOptions`, which is the one owner of both.
 */
export interface RunGraphOptions extends Pick<SuperviseOptions, GraphInheritedSuperviseOption> {
  /** WHERE worker nodes run — the executor backend. Provide this OR `makeLeafAgent`. Forwarded to
   *  `supervise()`, which derives every authorized leaf from it. A node that declares
   *  `agent_runtime_coordination_spawn_worker` becomes a nested supervisor instead, whose own
   *  leaves are derived the same way. */
  readonly backend?: Exclude<SuperviseOptions['backend'], undefined>
  /** WHERE the ROOT node's harness brain runs — forwarded to `supervise()` verbatim (see
   *  `SuperviseOptions.driverBackend`). Needed when the root node's profile declares an external
   *  harness (`codex`, `claude-code`, `opencode`): that root is driven by the harness, not by the
   *  router brain, and automatic execution supports a local `bridge`. Unlike `supervise()`, this
   *  does NOT default to `backend`: a graph's `backend` places WORKER nodes, so the root driver
   *  is selected only by this field. Omit = no harness driver, which is correct for a root whose
   *  `profile.harness` is omitted or `cli-base` (that root runs on the router brain). */
  readonly driverBackend?: Exclude<SuperviseOptions['driverBackend'], undefined>
  /** Leaf-execution override (offline tests / advanced). `runGraph` still owns node pinning,
   *  directive delivery, and the edge ledger AROUND this seam — only the leaf `act` is yours.
   *  Slots INSIDE the kernel's authorized path (`SuperviseOptions.makeLeafAgent`), so a node that
   *  declares the spawn tool still becomes a nested supervisor even under an offline leaf. */
  readonly makeLeafAgent?: MakeWorkerAgent
  /** The ROOT driver's inference seam — a caller-owned `ToolLoopChat` that makes every root
   *  model call. Use it when the root's decisions must be caller-owned orchestration (a
   *  deterministic conversation driver, a persona loop with its own LLM calls) rather than a
   *  router-derived model call. The graph machinery around the seam is unchanged: node pinning,
   *  directive delivery, the edge ledger, and the journal twin all run the same shipped path,
   *  and the root profile keeps prompt control (`prompt-control-execution` materialization —
   *  `systemPrompt`/`instructions` still apply). What moves to the caller with the brain:
   *  model selection and provider-identity validation (`expectedModel` cannot be enforced on a
   *  call the runtime did not place) and per-turn usage reporting (a brain that reports no
   *  usage meters nothing into the pool). Omit = the router brain derived from the root
   *  profile — the unchanged default. Mutually exclusive with `driverBackend`, and refused
   *  when the root profile declares an external harness (that root is driven BY the harness). */
  readonly brain?: ToolLoopChat
  /** Caller-side runtime hooks (telemetry, policy, product extensions). Composed AFTER the
   *  graph's own spawn-binding hook on the SAME event stream — the graph never swallows the
   *  seam supervise() exposes. */
  readonly hooks?: RuntimeHooks
  /** The analyst lens registry `analyzes` edges resolve against. ENVIRONMENT — needed only for
   *  lens analysts; an analyzes edge naming a graph NODE as its analyst needs no registry. */
  readonly analysts?: AnalystRegistry
  /** Answers a flow gate while the process holds the run; the wait counts against its deadline.
   *  ENVIRONMENT, like `analysts`; required when the graph declares gates. */
  readonly decideGate?: (request: GateRequest) => Promise<GateDecision>
  /** Directive registry. Default: the seeded kernel registry (`kernelPromptRegistry()`).
   *
   *  NOT `SuperviseOptions.registry`, which is the `SuperviseRegistry` name→value table for
   *  code-valued options. The two share a name and nothing else, and this one wins here — see
   *  `GRAPH_REFUSED_SUPERVISE_OPTIONS`. */
  readonly registry?: PromptRegistry
  /** The run journal the edge ledger and every spawn/settle ride. Default: in-memory. */
  readonly journal?: SpawnJournal
  readonly blobs?: ResultBlobStore
  readonly runId?: string
  /** Product authority over every steer/answer instruction (the filter seam). `runGraph` observes
   *  what it CHANGES: a narrowed instruction ledgers its steer traversal as `stripped`. */
  readonly authorizeMessage?: SuperviseOptions['authorizeMessage']
}

export interface GraphResult<Out = unknown> {
  readonly result: SupervisedResult<Out>
  /** Every edge traversal, in occurrence order — the observable-edge contract. */
  readonly ledger: ReadonlyArray<EdgeTraversal>
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included (observable here, never
   *  a refusal). A DELEGATES cap paired with a `no-winner` result THROWS
   *  ({@link GraphEdgeCapError}) instead of returning: only delegates caps refuse spawns, so only
   *  they can have ended the run. A LIFECYCLE no-winner (`aborted` / `budget-exhausted`) returns
   *  normally even with an exhausted delegates cap — the abort or the pool, not the cap, ended
   *  that run, and the exhaustion stays observable here. */
  readonly exhaustedEdges: ReadonlyArray<string>
  readonly runId: string
  /** Why a flow graph ended early: a `stop` edge fired (`edge` names it), or a flow node settled
   *  down (no `edge`; `reason` is `down: <worker reason>`) or, where a route was needed, without a
   *  usable result (no `edge`; `reason` is `unusable: <why>`). Live flow workers are aborted. */
  readonly stopped?: {
    readonly edge?: string
    readonly at: NodeId
    readonly workerId: string
    readonly reason: string
  }
}

/** `RunGraphOptions` with the brain REQUIRED — the shape the `/testing` entry's
 *  `runGraphWithTestBrain` keeps accepting now that `brain` is a production option. */
export interface RunGraphTestOptions extends RunGraphOptions {
  readonly brain: ToolLoopChat
}

// ── Validation ─────────────────────────────────────────────────────────────────

/** Validate the graph and resolve every directive BEFORE any compute is spent — an invalid
 *  topology or an unknown directive is a configuration fault, never a mid-run surprise. */
function validateGraph(
  graph: AgentGraph,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): ValidatedGraph {
  if (graph.entry === undefined) {
    if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
      throw new ValidationError('runGraph: graph.nodes must be a non-empty array')
    }
    if (!Array.isArray(graph.edges) || graph.edges.length === 0) {
      throw new ValidationError('runGraph: graph.edges must be a non-empty array')
    }
  }
  if (typeof graph.deliverable?.check !== 'function') {
    throw new ValidationError('runGraph: graph.deliverable is mandatory (termination oracle)')
  }
  if (typeof graph.budget !== 'object' || graph.budget === null) {
    throw new ValidationError('runGraph: graph.budget is mandatory (the conserved pool)')
  }
  if (graph.entry !== undefined) return validateFlowGraph(graph, registry, analysts)
  if (graph.gates !== undefined)
    throw new ValidationError('runGraph: graph.gates needs graph.entry')
  return validateGraphTopology(graph.nodes, graph.edges, registry, analysts)
}

// ── The runner ─────────────────────────────────────────────────────────────────

/**
 * Execute an {@link AgentGraph}. A flow graph (`entry` set) runs from its entries and routes edges
 * under a runtime-owned root that places no model call. Otherwise the root node becomes the
 * supervisor (`supervise()` — the execution core), each worker node is spawnable BY NODE ID
 * (`spawn_worker` with `profile: { name: '<node id>' }`; the node's canonical profile is pinned by
 * the graph), each
 * delegates directive is appended to the worker profile's `prompt.instructions` per traversal,
 * and each analyzes edge becomes an analyst-on-settle route with a real DESTINATION. Every
 * traversal is ledgered and journaled.
 */
export function runGraph(graph: AgentGraph, opts: RunGraphOptions): Promise<GraphResult> {
  const { brain, ...runtimeOptions } = graphExecutionOptions(opts)
  return superviseAgentGraph(graph, runtimeOptions, brain)
}

/** Alias for graph tests written before `RunGraphOptions.brain` was production. The production
 *  entry accepts the same shape; this wrapper only keeps the `/testing` import path working. */
export function runGraphWithTestBrain(
  graph: AgentGraph,
  opts: RunGraphTestOptions,
): Promise<GraphResult> {
  const { brain, ...runtimeOptions } = opts
  return superviseAgentGraph(graph, runtimeOptions, brain)
}

/**
 * The graph supervise run, as its own entry: the engine's `run-graph` preset node executes exactly
 * this, so the preset and `runGraph` are the same code path by construction (agent-runtime#982).
 */
/**
 * Every refusal a graph earns before any compute, in one place: the authoring contract. `runGraph`
 * calls it FIRST so a malformed graph throws synchronously, exactly as it did before the engine
 * preset (agent-runtime#982) moved execution behind a promise.
 */
export function assertRunGraphAuthoring(
  graph: AgentGraph,
  opts: RunGraphOptions,
  brain?: ToolLoopChat,
): ReturnType<typeof validateGraph> {
  assertRunGraphOptionKeys(opts)
  const registry = opts.registry ?? kernelPromptRegistry()
  const validated = validateGraph(graph, registry, opts.analysts)
  const requireLeaves = (): void => {
    if (!opts.backend && !opts.makeLeafAgent) {
      throw new ValidationError(
        'runGraph: provide opts.backend (where nodes run) or opts.makeLeafAgent',
      )
    }
  }
  if (validated.flow !== undefined) {
    // A flow's root is Runtime's own: nothing a caller sets for a root manager has a reader.
    const rootOptions = [
      ...(brain ? ['brain'] : []),
      ...(['driverBackend', 'finalizer', 'maxTurns', 'compaction'] as const).filter(
        (key) => opts[key] !== undefined,
      ),
    ]
    if (rootOptions.length > 0) {
      throw new ValidationError(
        `runGraph: ${rootOptions.join(', ')} with graph.entry — a flow graph has no root ` +
          'manager: Runtime spawns its entries and traverses its routes edges, and the graph ' +
          "owns the run's output",
      )
    }
    if ((graph.gates?.length ?? 0) > 0 && opts.decideGate === undefined) {
      throw new ValidationError('runGraph: graph.gates needs opts.decideGate to answer them')
    }
    requireLeaves()
    return validated
  }
  const { root } = validated as RootValidatedGraph
  // A caller brain and a harness driver are two answers to WHO makes the root's calls: refuse the
  // contradiction before any compute, and refuse a harness-driven root outright — the harness IS
  // that root's brain, so a supplied one would be silently ignored downstream.
  if (brain && opts.driverBackend) {
    throw new ValidationError(
      'runGraph: brain and driverBackend are mutually exclusive — a caller brain makes the root model calls, a driverBackend places a harness that makes its own',
    )
  }
  if (brain && harnessRunsAgent(root.profile.harness)) {
    throw new ValidationError(
      `runGraph: root node '${root.id}' declares harness '${root.profile.harness}', so the harness drives it — a caller brain applies only to a router-brained root (profile.harness omitted or 'cli-base')`,
    )
  }
  requireLeaves()
  return validated
}

export function superviseAgentGraph(
  graph: AgentGraph,
  opts: RunGraphOptions,
  brain?: ToolLoopChat,
): Promise<GraphResult> {
  if (graph.deliverable.command !== undefined) {
    const bound = bindGraphCommand(graph, opts)
    return superviseAgentGraph(bound.graph, bound.options, brain)
  }
  const registry = opts.registry ?? kernelPromptRegistry()
  if (opts.runContext?.acquire !== undefined) {
    return withRunContext(opts.runContext, opts.signal, (runContext, signal) =>
      superviseAgentGraph(
        graph,
        {
          ...opts,
          runContext,
          ...(signal === undefined ? {} : { signal }),
        },
        brain,
      ),
    )
  }
  const validated = assertRunGraphAuthoring(graph, opts, brain)
  // A flow graph: Runtime schedules its nodes, and its root manager is Runtime's own.
  const flow = validated.flow === undefined ? undefined : createFlowRun()
  const context =
    opts.runContext ??
    (opts.runDir === undefined
      ? createInMemoryRunContext()
      : createFileRunContext(resolve(opts.runDir)))
  const journal = opts.journal ?? context.journal
  const blobs = opts.blobs ?? context.blobs
  const runId =
    opts.runId ??
    opts.runContext?.runId ??
    `graph-${canonicalCandidateDigest(graph.nodes.map((n) => n.id)).slice('sha256:'.length, 'sha256:'.length + 12)}`
  const now = opts.now ?? Date.now

  // The graph layer: node pinning, analyst routes, continuity defaults and the edge ledger. A
  // `run_graph` subtask builds the same overlay around its nested manager.
  // `profileGuidance` composes the profile a manager authors, but a graph then swaps that
  // `{ name }` stub for the pinned node profile. Compose the pinned profile too, so every node
  // that runs carries its harness and model guidance. Composition is idempotent.
  const guidance = profileGuidanceComposer(opts.profileGuidance)
  const overlay = createGraphOverlay(validated, {
    registry,
    journal,
    runId,
    now,
    ...(guidance ? { guidance } : {}),
    ...(opts.authorizeSpawn ? { authorizeSpawn: opts.authorizeSpawn } : {}),
  })
  // Always present: the kernel refuses steer/answer whenever spawn authorization is on (the
  // graph's pinning IS spawn authorization), so a graph with no caller filter passes instructions
  // through unchanged rather than losing its steer channel. Only a caller filter can strip.
  const callerAuthorizeMessage = opts.authorizeMessage
  const authorizeMessage = overlay.observeMessages<
    Parameters<NonNullable<SuperviseOptions['authorizeMessage']>>[0]
  >((input) =>
    callerAuthorizeMessage ? callerAuthorizeMessage(input) : { instruction: input.instruction },
  )

  // ── Spawn-hook: bind ledger rows to concrete worker ids, then journal them ──
  const graphHooks: RuntimeHooks = {
    onEvent: (event) => {
      if (event.target !== 'agent.spawn' || event.phase !== 'after') return
      const payload = event.payload as { childId?: unknown; assignmentId?: unknown } | undefined
      if (typeof payload?.childId !== 'string' || typeof payload.assignmentId !== 'string') return
      return overlay.bindSpawn(event.parentId, payload.assignmentId, payload.childId)
    },
  }
  const hooks = composeRuntimeHooks(graphHooks, opts.hooks)
  const rootProfile =
    flow === undefined
      ? graphRootProfile(validated as RootValidatedGraph, registry)
      : flowRootProfile
  const rootBrain = flow === undefined ? brain : runtimeFlowBrain()
  const task =
    flow === undefined
      ? graphTask(graph, (validated as RootValidatedGraph).root)
      : (graph.deliverable.describe ?? 'Runtime runs this flow graph from its entries.')

  // Every configuration fault above throws SYNCHRONOUSLY (matching `supervise()`'s own
  // contract); only the run itself is asynchronous.
  const start = async (): Promise<GraphResult> => {
    const superviseOptions = {
      // The backend also drives seat-bearing flow nodes, which use the managed driver lifecycle.
      // A flow's root keeps Runtime's deterministic brain; deriving its child driver adds no root
      // inference. Rooted graphs keep driverBackend explicit rather than inheriting backend.
      ...forwardedSuperviseOptions(opts),
      rootDriverFromBackend: flow !== undefined,
      // Graph-owned values come after the spread: the graph, not the caller, decides these.
      budget: graph.budget,
      deliverable:
        flow !== undefined && graph.deliverable.checkRef === 'route'
          ? flowRouteDeliverable(graph.deliverable, flow)
          : graph.deliverable,
      authorizeSpawn: overlay.authorizeSpawn,
      resolveSpawnProfile: overlay.resolveSpawnProfile,
      inheritSpawnRights: false,
      ...(opts.makeLeafAgent ? { makeLeafAgent: opts.makeLeafAgent } : {}),
      journal,
      blobs,
      runId,
      hooks,
      onCoordinationEvent: async (
        context: { readonly depth: number },
        _eventId: unknown,
        record: { readonly event: Parameters<typeof overlay.onCoordinationEvent>[0] },
      ) => {
        // A route event belongs to the flow of the manager that published it: a flow inside a
        // maps item or a run_graph subtask ledgers and concludes its own.
        if (record.event.type === 'route' && context.depth !== 0) return
        overlay.onCoordinationEvent(record.event)
        flow?.observe(record.event)
      },
      // Lens routes resolve against the registry; agent routes carry their own analyst profile,
      // so a graph whose only analysts are nodes needs no registry at all.
      ...(overlay.routes.length > 0
        ? {
            analyzeOnSettle: overlay.routes,
            ...(opts.analysts ? { analysts: opts.analysts } : {}),
          }
        : {}),
      ...(overlay.maps.length > 0 ? { mapOnSettle: overlay.maps } : {}),
      ...(Object.keys(overlay.continuityByProfile).length > 0
        ? { continuityByProfile: overlay.continuityByProfile }
        : {}),
      // A flow root's wake batches nothing for a decision, so it ends its turn on the first event.
      ...(flow === undefined
        ? {}
        : {
            routeFlow: routeFlowOf(validated),
            ...(opts.decideGate && {
              decideGate: journaledGateDecider(opts.decideGate, journal, runId),
            }),
            finalizer: flow.finalizer,
            wake: { debounceMs: 0, ...opts.wake },
          }),
      authorizeMessage,
    } satisfies SuperviseOptions
    // The flow root reaches supervise through the same brain seam a caller brain takes.
    const supervised =
      rootBrain === undefined
        ? await supervise(rootProfile, task, superviseOptions)
        : await superviseWithTestBrain(rootProfile, task, { ...superviseOptions, brain: rootBrain })

    const { ledger, exhaustedEdges, exhaustedDelegates } = await overlay.settle()
    const concluded = flow?.conclude(supervised)
    if (concluded?.kind === 'unrouted') {
      throw new GraphRouteError(concluded.unrouted, ledger, supervised)
    }
    const result = concluded?.result ?? supervised
    const stopped = concluded?.stopped
    // A LIFECYCLE ending (caller abort, exhausted budget, deadline) is its own complete explanation: the
    // cap did not end that run even when it was exhausted along the way, and blaming it would
    // misattribute the ending (and turn a caller-initiated abort into a throw). The exhaustion
    // stays observable in `exhaustedEdges` either way.
    const lifecycleEnded =
      result.kind === 'no-winner' &&
      (result.reason === 'aborted' ||
        result.reason === 'cancelled' ||
        result.reason === 'budget-exhausted' ||
        result.reason === 'deadline')
    if (result.kind !== 'winner' && !lifecycleEnded && exhaustedDelegates.length > 0) {
      // Fail LOUD: the backstop, not the task, ended this run. The evidence rides on the error.
      // Only DELEGATES caps refuse spawns, so only they can be the cause named here.
      throw new GraphEdgeCapError(exhaustedDelegates, ledger, result)
    }
    return { result, ledger, exhaustedEdges, runId, ...(stopped ? { stopped } : {}) }
  }

  return start()
}

/** The root task: the graph's own framing. The deliverable (mandatory) is the termination; the
 *  task names what the topology exists to produce. */
function graphTask(graph: AgentGraph, root: GraphNode): string {
  const describe = graph.deliverable.describe
  return (
    describe ?? `Deliver the graph's deliverable by driving your worker nodes (root: '${root.id}').`
  )
}
