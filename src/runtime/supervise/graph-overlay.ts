/**
 * The graph layer over the managers that run one `AgentGraph`.
 *
 * `runGraph` and a manager's `run_graph` tool execute a graph the same way: the graph's root node is
 * a manager in the supervise kernel, and this module supplies what the graph adds around it —
 * node pinning (spawn authorization), the driver brief, analyst routes, edge continuity defaults,
 * and the edge ledger with its journal twin. `runGraph` composes it into the root `supervise()`
 * call; `supervise()` composes it into the nested manager a `run_graph` spawn starts, so a graph
 * run as a subtask is one subtree of the caller's run, spending from the caller's conserved pool.
 *
 * Nothing here schedules anything. It produces the values a manager's construction takes
 * (`authorizeSpawn`, `resolveSpawnProfile`, `analyzeOnSettle`, `continuityByProfile`) and
 * observes what the kernel reports back (spawn bindings, steers, findings).
 */

import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  AuthorizedDownMessage,
  ContinuityMode,
  CoordinationEvent,
} from '../../mcp/tools/coordination'
import type {
  EdgeDeliveryOutcome,
  EdgeTraversal,
  GraphEdge,
  GraphNode,
  TraversalContinuity,
} from './graph'
import {
  formatPromptHandle,
  type PromptHandle,
  type PromptRegistry,
  promptHandle,
} from './prompt-registry'
import { coordinationProfileToolPrefix, runtimeGraphMetadataKey } from './provider-visible-profile'
import type { SuperviseOptions } from './supervise'
import type { NodeId, SpawnJournal } from './types'

/** Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. */
export const defaultEdgeTraversalCap = 32

type DelegatesEdge = Extract<GraphEdge, { kind: 'delegates' }>
type AnalyzesEdge = Extract<GraphEdge, { kind: 'analyzes' }>
type SpawnAuthorization = NonNullable<SuperviseOptions['authorizeSpawn']>
type SpawnAuthorizationInput = Parameters<SpawnAuthorization>[0]

// ── Validation ─────────────────────────────────────────────────────────────────

/** A topology that passed every structural refusal, indexed for the overlay. */
export interface ValidatedGraph {
  readonly root: GraphNode
  readonly workers: ReadonlyMap<NodeId, GraphNode>
  readonly delegatesByWorker: ReadonlyMap<NodeId, DelegatesEdge>
  readonly analyzes: ReadonlyArray<AnalyzesEdge>
  /** Nodes referenced as an analyzes edge's ANALYST (the analyst-agent form): reachable through
   *  their analyzes edge (spawned on settle), never through a delegates edge. */
  readonly analystNodes: ReadonlyMap<NodeId, GraphNode>
}

export function edgeId(edge: GraphEdge): string {
  return edge.kind === 'delegates'
    ? `delegates:${edge.from}->${edge.to}`
    : `analyzes:${edge.analyst}:${edge.over.join('+')}->${edge.to}`
}

/** Validate a topology and resolve every directive BEFORE any compute is spent — an invalid
 *  topology or an unknown directive is a configuration fault, never a mid-run surprise. */
export function validateGraphTopology(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): ValidatedGraph {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ValidationError('runGraph: graph.nodes must be a non-empty array')
  }
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new ValidationError('runGraph: graph.edges must be a non-empty array')
  }
  const byId = new Map<NodeId, GraphNode>()
  for (const node of nodes) {
    if (typeof node.id !== 'string' || node.id.length === 0) {
      throw new ValidationError('runGraph: every node needs a non-empty string id')
    }
    if (byId.has(node.id)) throw new ValidationError(`runGraph: duplicate node id '${node.id}'`)
    const parsed = agentProfileSchema.safeParse(node.profile)
    if (!parsed.success) {
      throw new ValidationError(
        `runGraph: node '${node.id}' has an invalid AgentProfile: ${parsed.error.message}`,
      )
    }
    // The profile NAME is the node identity everywhere downstream: node pinning resolves a
    // spawn's `profile.name` against node ids, and the coordination layer matches analyst
    // routes (`over`/`to`) against the settled worker's PROFILE NAME. A divergent name would
    // make every analyzes edge touching this node silently never match — refuse it up front.
    if (node.profile.name !== node.id) {
      throw new ValidationError(
        `runGraph: node '${node.id}' has profile.name ${JSON.stringify(node.profile.name)} — ` +
          'profile.name IS the node identity (node pinning and analyst routing match on it) and ' +
          'must equal the node id',
      )
    }
    // A node that carried a graph of its own would run a second pinning layer inside this one,
    // which refuses every spawn the inner graph makes. Graphs nest by `run_graph`, not by data.
    if (node.profile.metadata?.[runtimeGraphMetadataKey] !== undefined) {
      throw new ValidationError(
        `runGraph: node '${node.id}' carries metadata.${runtimeGraphMetadataKey}, which Runtime ` +
          'writes only for the root of a graph started by run_graph; a node cannot hold a graph',
      )
    }
    byId.set(node.id, node)
  }
  const requireNode = (id: NodeId, where: string): GraphNode => {
    const node = byId.get(id)
    if (!node) throw new ValidationError(`runGraph: ${where} references unknown node '${id}'`)
    return node
  }
  const delegates = edges.filter((edge): edge is DelegatesEdge => edge.kind === 'delegates')
  const analyzes = edges.filter((edge): edge is AnalyzesEdge => edge.kind === 'analyzes')
  if (delegates.length === 0) {
    throw new ValidationError('runGraph: at least one delegates edge is required (who spawns whom)')
  }
  for (const edge of edges) registry.resolve(edge.directive)
  for (const edge of delegates) {
    requireNode(edge.from, edgeId(edge))
    requireNode(edge.to, edgeId(edge))
    if (edge.from === edge.to) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} delegates to itself — the driver↔worker cycle is the ` +
          'settle-return loop, not a self-edge',
      )
    }
    // The type admits only 'fresh' | 'resume', but a graph is plain data that often arrives
    // through JSON — refuse a nonsense mode here, never let it reach the spawn tool as a string.
    if (
      edge.continuity !== undefined &&
      edge.continuity !== 'fresh' &&
      edge.continuity !== 'resume'
    ) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} has invalid continuity ${JSON.stringify(edge.continuity)} — ` +
          "a delegates edge's continuity is 'fresh' or 'resume'",
      )
    }
  }
  // Root: the one node that delegates and is never delegated TO. P0 executes the star/2-node
  // cyclic family (one driver, N workers); nested driver graphs are the recorded P3 absorption.
  const delegatedTo = new Set(delegates.map((edge) => edge.to))
  const roots = [...new Set(delegates.map((edge) => edge.from))].filter(
    (id) => !delegatedTo.has(id),
  )
  if (roots.length !== 1) {
    throw new ValidationError(
      `runGraph: expected exactly ONE root (a node that delegates and is never delegated to), ` +
        `found ${roots.length === 0 ? 'none — delegates edges form a cycle with no entry' : roots.join(', ')}. ` +
        'P0 executes driver↔worker(s); nested driver graphs are P3.',
    )
  }
  const root = requireNode(roots[0] as string, 'root resolution')
  if (root.profile.tools?.[`${coordinationProfileToolPrefix}spawn_worker`] !== true) {
    throw new ValidationError(
      `runGraph: root node '${root.id}' has delegates edges but does not declare ` +
        `${JSON.stringify(`${coordinationProfileToolPrefix}spawn_worker`)} — the graph cannot ` +
        'spawn any declared worker',
    )
  }
  for (const edge of delegates) {
    if (edge.from !== root.id) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} delegates from a non-root node — P0 executes one driver over ` +
          'its workers (the 2-node cyclic case, star-generalized); deeper delegation is P3',
      )
    }
  }
  const analystIds = new Set<string>()
  const analystNodes = new Map<NodeId, GraphNode>()
  for (const edge of analyzes) {
    // Continuity is a delegates-edge axis ONLY: analysts (lens or node) are spawned by the
    // analyst-on-settle machinery, each run a fresh session over settled evidence — an analyzes
    // edge carrying continuity would silently mean nothing, so it is refused as data.
    if ((edge as { continuity?: unknown }).continuity !== undefined) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} carries continuity — analysts are spawned by the analyst ` +
          'machinery (every analyst run is a fresh session over settled evidence), so ' +
          'continuity is a delegates-edge axis only',
      )
    }
    // The runner's traversal ledger resolves a finding/steer back to its edge BY ANALYST ID
    // alone, so a second edge sharing an analyst would silently absorb the first edge's
    // traversals (last-registered wins). Multi-edge-per-analyst is not yet supported; refuse it
    // rather than mis-ledger it.
    if (analystIds.has(edge.analyst)) {
      throw new ValidationError(
        `runGraph: two analyzes edges share analyst '${edge.analyst}' — one analyzes edge per ` +
          'analyst lens (traversals are ledgered by analyst id; a second edge would silently ' +
          "absorb the first's). Register the lens under a second id for a second edge.",
      )
    }
    analystIds.add(edge.analyst)
    // The analyst REFERENCE has two forms — a registry lens id or a graph node id — and the id
    // itself is what distinguishes them, so an id living in both is refused as ambiguous rather
    // than silently resolved by precedence.
    const analystNode = byId.get(edge.analyst)
    const inRegistry = analysts?.kinds.some((kind) => kind.id === edge.analyst) === true
    if (analystNode !== undefined && inRegistry) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} analyst '${edge.analyst}' is BOTH a graph node and a lens in ` +
          'the analysts registry — the id alone distinguishes the two analyst forms, so this is ' +
          'ambiguous; rename the node or register the lens under another id',
      )
    }
    if (analystNode !== undefined) {
      // The analyst-AGENT form. Oracle doctrine holds structurally: the analyst node can never
      // receive work — not from the root (a delegates edge to it is refused) and not by being
      // the root (the root delegates by definition).
      if (analystNode.id === root.id) {
        throw new ValidationError(
          `runGraph: ${edgeId(edge)} names the ROOT as its analyst — the root is the driver; ` +
            'give the analyst its own node with no delegates edge pointing at it',
        )
      }
      if (delegatedTo.has(analystNode.id)) {
        throw new ValidationError(
          `runGraph: ${edgeId(edge)} names node '${edge.analyst}' as its analyst, but that node ` +
            'is a delegates target — oracle doctrine: an analyst is never delegated to. An ' +
            'analyst NODE is legal only with NO delegates edge pointing at it; give the analyst ' +
            'its own delegates-free node or pass a lens id from RunGraphOptions.analysts.',
        )
      }
      analystNodes.set(analystNode.id, analystNode)
    } else if (!analysts) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} analyst '${edge.analyst}' is not a graph node, and no ` +
          'RunGraphOptions.analysts registry was provided to resolve it as a lens',
      )
    } else if (!inRegistry) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} analyst '${edge.analyst}' is neither a graph node nor in the ` +
          `analysts registry (known lenses: ${analysts.kinds.map((kind) => kind.id).join(', ') || 'none'})`,
      )
    }
    if (edge.over.length === 0) {
      throw new ValidationError(`runGraph: ${edgeId(edge)} must analyze at least one node`)
    }
    for (const over of edge.over) {
      requireNode(over, edgeId(edge))
      // Analysts observe SETTLED WORKERS, matched by profile name — the root drives and never
      // settles as a worker, so an edge over the root would silently never fire; refuse it.
      if (over === root.id) {
        throw new ValidationError(
          `runGraph: ${edgeId(edge)} analyzes the ROOT — analysts observe settled workers, and ` +
            'the root never settles as one, so this edge would silently never fire; list ' +
            'delegates-target nodes only',
        )
      }
    }
    requireNode(edge.to, edgeId(edge))
  }
  // Second pass, once every analyst NODE is known: an analyst run's settlement is a FINDING,
  // never a worker settle, so an analyzes edge OVER an analyst node would silently never fire —
  // refuse it rather than let it rot unobserved.
  for (const edge of analyzes) {
    for (const over of edge.over) {
      if (analystNodes.has(over)) {
        throw new ValidationError(
          `runGraph: ${edgeId(edge)} analyzes '${over}', which is an analyst node — an analyst ` +
            'run settles as a finding, never as a worker, so this edge would silently never ' +
            'fire; analyst nodes are not analyzable',
        )
      }
    }
  }
  const workers = new Map<NodeId, GraphNode>()
  const delegatesByWorker = new Map<NodeId, DelegatesEdge>()
  for (const edge of delegates) {
    if (delegatesByWorker.has(edge.to)) {
      throw new ValidationError(
        `runGraph: node '${edge.to}' is the target of two delegates edges — one delegation ` +
          'directive per worker node (version the directive instead of forking the edge)',
      )
    }
    delegatesByWorker.set(edge.to, edge)
    workers.set(edge.to, requireNode(edge.to, edgeId(edge)))
  }
  // Every non-root node must be reachable by SOME edge, or it can never run. A worker node is
  // reached by its delegates edge; an analyst node by its analyzes edge (spawned on settle).
  for (const node of nodes) {
    if (node.id !== root.id && !workers.has(node.id) && !analystNodes.has(node.id)) {
      throw new ValidationError(
        `runGraph: node '${node.id}' has no delegates edge to it — an unreachable node never runs`,
      )
    }
  }
  return { root, workers, delegatesByWorker, analyzes, analystNodes }
}

// ── The driver brief ───────────────────────────────────────────────────────────

/** The root node's canonical profile with the graph brief appended: which nodes the driver may
 *  spawn, by exact name, each with its delegation cap and continuity. */
export function graphRootProfile(
  validated: ValidatedGraph,
  registry: PromptRegistry,
): AgentProfile {
  const { root, workers, delegatesByWorker, analyzes, analystNodes } = validated
  // Driver-destined analyzes findings are standing knowledge for the ROOT: the findings arrive
  // as bus events. For a lens edge the directive tells the driver what to do with them; for a
  // node edge the directive already went to the analyst agent as its task.
  const driverAnalyzesBriefs = analyzes
    .filter((edge) => edge.to === root.id)
    .map((edge) =>
      analystNodes.has(edge.analyst)
        ? `Findings from analyst '${edge.analyst}' (a tool-equipped analyst agent node, over: ` +
          `${edge.over.join(', ')}) will arrive as finding events.`
        : `Findings from analyst '${edge.analyst}' (over: ${edge.over.join(', ')}) will arrive as ` +
          `finding events.\n${registry.resolve(edge.directive).text}`,
    )
  const workerLines = [...workers.values()].map((node) => {
    const edge = delegatesByWorker.get(node.id) as DelegatesEdge
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const description =
      typeof node.profile.description === 'string' && node.profile.description.length > 0
        ? ` — ${node.profile.description}`
        : ''
    const continuityNote =
      edge.continuity === 'resume'
        ? "; continuity: resume — each spawn after the first re-attaches to this node's latest " +
          'settled session (spawn again to continue it; steer while it is live)'
        : ''
    return `- '${node.id}'${description} (delegation cap: ${cap} traversals${continuityNote})`
  })
  const graphBrief = [
    'AGENT GRAPH: you are the driver node of a fixed topology. You may spawn ONLY these worker',
    "nodes, by EXACT name (spawn_worker with profile: { name: '<node id>' }; the node's full",
    'profile is pinned by the graph — any other profile fields you author are ignored):',
    ...workerLines,
    ...(driverAnalyzesBriefs.length > 0 ? ['', ...driverAnalyzesBriefs] : []),
  ].join('\n')
  return {
    ...root.profile,
    prompt: {
      ...(root.profile.prompt ?? {}),
      instructions: [
        ...((root.profile.prompt?.instructions as readonly string[] | undefined) ?? []),
        graphBrief,
      ],
    },
  }
}

// ── The overlay ────────────────────────────────────────────────────────────────

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

function stringifyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload) ?? String(payload)
  } catch {
    return String(payload)
  }
}

export interface GraphOverlayOptions {
  readonly registry: PromptRegistry
  /** The journal every edge event rides. */
  readonly journal: SpawnJournal
  /** The journal tree the edge events are appended to: the run's root tree. */
  readonly runId: string
  readonly now: () => number
  /** Standing guidance composed into each pinned node profile (`profileGuidance`). Pinning
   *  replaces the driver's `{ name }` stub, so the pinned profile is composed here. */
  readonly guidance?: (profile: AgentProfile) => AgentProfile
  /** Product spawn authority. It runs AFTER the graph pinned the node, so it judges the profile
   *  that will run, never the driver's stub. */
  readonly authorizeSpawn?: SpawnAuthorization
  /** Set for a graph a manager started with `run_graph`. One run journal can then hold several
   *  ledgers, so every edge event names the node that drives this graph (`graph`). The run's own
   *  root graph leaves it unset, and its edge events stay as they were. */
  readonly subtask?: boolean
}

/** The ledger once the graph's manager settled. */
export interface GraphLedgerSettlement {
  /** Every edge traversal, in occurrence order. */
  readonly ledger: ReadonlyArray<EdgeTraversal>
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included. */
  readonly exhaustedEdges: ReadonlyArray<string>
  /** The delegates subset of `exhaustedEdges`: the only caps that refused work. */
  readonly exhaustedDelegates: ReadonlyArray<string>
}

/** What a manager's construction composes to run one graph. */
export interface GraphOverlay {
  /** Analyst-on-settle routes, one per analyzes edge. */
  readonly routes: ReadonlyArray<string | AnalyzeOnSettleRoute>
  /** Delegates-edge continuity defaults by node id (= profile name). */
  readonly continuityByProfile: Readonly<Record<string, ContinuityMode>>
  /** Node pinning: the node's canonical profile plus the edge directive, then the product's
   *  authority. Throws (fails the spawn loud) for a name that is not a worker node. */
  readonly authorizeSpawn: SpawnAuthorization
  /** Pure pre-journal resolution for the spawn pre-flight: which node, with no ledger row. */
  readonly resolveSpawnProfile: (profile: AgentProfile) => AgentProfile
  /** Wrap a message authority so a narrowed instruction ledgers its steer `stripped`. */
  observeMessages<I extends { readonly instruction: string }>(
    authorize: (input: I) => AuthorizedDownMessage,
  ): (input: I) => AuthorizedDownMessage
  /** Ledger the steers and findings a manager of this graph publishes. */
  onCoordinationEvent(event: CoordinationEvent): void
  /** Bind a pending spawn row to the worker the kernel started (the `agent.spawn` hook). */
  bindSpawn(
    parentNodeId: string | undefined,
    assignmentId: string,
    childId: string,
  ): Promise<void> | undefined
  /** Settle unbound rows, wait for every journal write, and return the ledger. */
  settle(): Promise<GraphLedgerSettlement>
}

/**
 * Build the graph layer for one validated graph. Each delegates directive is appended to the
 * worker profile's `prompt.instructions` per traversal, each analyzes edge becomes an
 * analyst-on-settle route with a real DESTINATION, and every traversal is ledgered and journaled.
 */
export function createGraphOverlay(
  validated: ValidatedGraph,
  opts: GraphOverlayOptions,
): GraphOverlay {
  const { root, workers, delegatesByWorker, analyzes, analystNodes } = validated
  const { registry, journal, runId, now } = opts

  // ── Ledger state ──
  const ledger: EdgeTraversal[] = []
  const journaled = new Set<EdgeTraversal>()
  // Per-edge ordinals: every row takes the next one, so the ledger reads as one full sequence.
  const traversalCounts = new Map<string, number>()
  // What the caps judge, kept apart from the ordinals: a spawn row is charged when a live worker
  // BINDS it, never when it is authorized. scope.spawn runs the factory (this graph's
  // authorizeSpawn) before it decides duplicate-key, key-conflict, or a completed keyed result,
  // so a row that never binds advanced no cycle and must leave the backstop untouched (#1005).
  const capSpend = new Map<string, number>()
  const spend = (edge: string): void => {
    capSpend.set(edge, (capSpend.get(edge) ?? 0) + 1)
  }
  const exhausted = new Set<string>()
  // The subset of `exhausted` that REFUSED work. Only a delegates cap closes the spawn cycle, so
  // only it can be the reason a run ended winnerless — an analyzes cap refuses nothing.
  const exhaustedDelegates = new Set<string>()
  const journalWrites: Promise<void>[] = []
  let ledgerSeq = 0
  // The node driving a run_graph subtask: the trusted parent of its first spawn.
  let graphNodeId: string | undefined
  const appendJournal = (entry: EdgeTraversal, nodeIdForEvent: string): Promise<void> => {
    if (journaled.has(entry)) return Promise.resolve()
    journaled.add(entry)
    const write = journal.appendEvent(runId, {
      kind: 'edge',
      id: nodeIdForEvent,
      ...(graphNodeId === undefined ? {} : { graph: graphNodeId }),
      edge: { kind: entry.kind, from: entry.from, to: entry.to, directive: entry.directive },
      traversal: entry.traversal,
      outcome: entry.outcome,
      continuity: entry.continuity,
      bytes: entry.bytes,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      seq: ledgerSeq++,
      at: new Date(now()).toISOString(),
    })
    journalWrites.push(write)
    return write
  }
  // A FINAL row (its recipient already live, or a refusal) is journaled and charged on record; a
  // provisional spawn row is both only once the `agent.spawn` hook binds it to a worker.
  // A provisional spawn row that never bound a live worker states the same truth every
  // unpropagated row states — the directive never reached a worker — so it is rewritten in place
  // rather than minted as a new outcome; its ordinal stands and the edge cap was never charged.
  const settleUnbound = (pending: EdgeTraversal): Promise<void> => {
    const refused: EdgeTraversal = {
      ...pending,
      outcome: 'unpropagated',
      bytes: 0,
      reason: `no-live-worker-bound (spawn refused after the factory, or a keyed re-spawn deduplicated to a completed result; ${pending.bytes} composed bytes never crossed)`,
    }
    ledger[ledger.indexOf(pending)] = refused
    return appendJournal(refused, `graph:${refused.to}`)
  }
  const record = (entry: Omit<EdgeTraversal, 'traversal'>, final: boolean): EdgeTraversal => {
    const count = (traversalCounts.get(entry.edge) ?? 0) + 1
    traversalCounts.set(entry.edge, count)
    const row: EdgeTraversal = { ...entry, traversal: count }
    ledger.push(row)
    if (final) {
      spend(row.edge)
      void appendJournal(row, row.workerId ?? `graph:${row.to}`)
    }
    return row
  }

  // ── Node pinning + delegates spawn traversals ──
  // Pinning lives in spawn authorization, which the kernel runs BEFORE it decides whether a child
  // is a leaf or a nested supervisor. That is what lets a node declaring the spawn tool become a
  // real supervisor carrying its canonical profile: the kernel reads the PINNED profile, not the
  // driver-authored `{ name }` stub.
  const nodeByWorkerId = new Map<string, NodeId>()
  // Keyed by manager AND assignment: assignment ids are unique within one manager, and every
  // manager of the run reports its spawns on the same hook stream.
  const pendingByAssignment = new Map<string, EdgeTraversal>()
  const pendingKey = (parentNodeId: string | undefined, assignmentId: string): string =>
    `${parentNodeId ?? ''}\u0000${assignmentId}`
  const pinNode = (input: SpawnAuthorizationInput): AgentProfile => {
    if (opts.subtask === true) graphNodeId ??= input.parentNodeId
    const requested =
      typeof (input.profile as { name?: unknown } | undefined)?.name === 'string'
        ? (input.profile as { name: string }).name
        : undefined
    // An analyst-AGENT run: the coordination settle hook — never the driver; the marker is
    // authored by the runtime, not accepted from model arguments — spawns the analyst NODE.
    // Pin the node's canonical profile; the analysis directive travels as the TASK (composed by
    // the coordination layer with the settled worker's trace evidence), so nothing is appended
    // to the profile's instructions here. Its traversal is ledgered on the finding/steer it
    // produces, exactly like a registry analyst's.
    if (input.analyst !== undefined) {
      const analystNode = analystNodes.get(input.analyst)
      if (!analystNode || requested !== analystNode.id) {
        throw new ValidationError(
          `runGraph: analyst run for ${JSON.stringify(input.analyst)} does not name an ` +
            `analyst node of this graph (analyst nodes: ${[...analystNodes.keys()].join(', ') || 'none'})`,
        )
      }
      return analystNode.profile
    }
    if (input.profile.metadata?.[runtimeGraphMetadataKey] !== undefined) {
      throw new ValidationError(
        'runGraph: a node of a graph cannot start another graph — run_graph inside a graph is ' +
          'refused; add the work as nodes of this graph instead',
      )
    }
    const node = requested !== undefined ? workers.get(requested) : undefined
    if (!node) {
      throw new ValidationError(
        `runGraph: spawn_worker named profile ${JSON.stringify(requested)} which is not a worker ` +
          `node of this graph (nodes: ${[...workers.keys()].join(', ')}). Spawn by node id: ` +
          'profile.name selects the node; the node profile itself is pinned by the graph.',
      )
    }
    const edge = delegatesByWorker.get(node.id) as DelegatesEdge
    const id = edgeId(edge)
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const used = capSpend.get(id) ?? 0
    // The EFFECTIVE spawn mode the coordination layer resolved (per-call override, else this
    // edge's declared default, else fresh) — stamped on the row so the ledger states how each
    // hop continued, never how it was merely configured to.
    const spawnContinuity: TraversalContinuity = input.continuity ?? 'fresh'
    if (used >= cap) {
      exhausted.add(id)
      exhaustedDelegates.add(id)
      record(
        {
          edge: id,
          kind: 'delegates',
          from: edge.from,
          to: edge.to,
          directive: formatPromptHandle(edge.directive),
          outcome: 'unpropagated',
          continuity: spawnContinuity,
          bytes: 0,
          reason: `traversal-cap-exhausted (max ${cap})`,
        },
        true,
      )
      throw new ValidationError(
        `runGraph: delegates edge ${id} exhausted its traversal cap (${cap}) — the ` +
          'cyclic-graph backstop refused this spawn',
      )
    }
    const directiveText = registry.resolve(edge.directive).text
    const taskText = stringifyPayload(input.task)
    const bytes = byteLength(directiveText) + byteLength(taskText)
    const row = record(
      {
        edge: id,
        kind: 'delegates',
        from: edge.from,
        to: edge.to,
        directive: formatPromptHandle(edge.directive),
        outcome: bytes === 0 ? 'empty' : 'delivered',
        continuity: spawnContinuity,
        bytes,
        ...(bytes === 0 ? { reason: 'no directive text and no task payload' } : {}),
      },
      false,
    )
    // A keyed assignment id is stable across re-spawns, so a row still pending under it was
    // never bound (the `agent.spawn` hook would have cleared it): settle it now, before this
    // authorization takes its slot, or the earlier phantom stays `delivered` forever.
    const key = pendingKey(input.parentNodeId, input.assignmentId)
    const stale = pendingByAssignment.get(key)
    if (stale !== undefined) void settleUnbound(stale)
    pendingByAssignment.set(key, row)
    // The delegation directive is a STANDING instruction of this traversal: appended to the
    // node's canonical prompt instructions, so the worker runs under node profile + edge
    // directive, and the driver-authored profile contributes ONLY the node selection.
    return directiveText.length === 0
      ? node.profile
      : {
          ...node.profile,
          prompt: {
            ...(node.profile.prompt ?? {}),
            instructions: [
              ...((node.profile.prompt?.instructions as readonly string[] | undefined) ?? []),
              directiveText,
            ],
          },
        }
  }
  const composeGuidance = (profile: AgentProfile): AgentProfile =>
    opts.guidance ? opts.guidance(profile) : profile
  // The pre-journal gate (a bridge backend's route/admission check) must judge the profile that
  // will run, not the `{ name }` stub — otherwise every graph spawn over a bridge is refused
  // `model-route` before the graph ever pins it. This resolver is PURE: it answers "which node"
  // without ledgering, because the gate may refuse and nothing may be journaled for a refusal.
  const resolveSpawnProfile = (authored: AgentProfile): AgentProfile => {
    const requested = typeof authored.name === 'string' ? authored.name : undefined
    const node =
      (requested !== undefined ? workers.get(requested) : undefined) ??
      (requested !== undefined ? analystNodes.get(requested) : undefined)
    // Unknown names fall through to authorizeSpawn, which refuses them with the full message and
    // a ledger row; the gate just sees the stub and lets that later refusal speak.
    return node ? composeGuidance(node.profile) : authored
  }
  // Graph authority first, then the caller's: a product authorizing spawns sees the CANONICAL
  // node profile (what will actually run), never the driver's `{ name }` stub.
  const authorizeSpawn: SpawnAuthorization = (input) => {
    const pinned = composeGuidance(pinNode(input))
    if (!opts.authorizeSpawn) return { profile: pinned }
    return opts.authorizeSpawn({ ...input, profile: pinned })
  }

  // ── Analyzes edges → analyst-on-settle routes with destinations ──
  // A LENS edge's directive wraps the findings for the recipient (so a driver-destined lens
  // route carries no directive — it becomes the driver brief). A NODE edge's directive is the
  // analyst AGENT's task, so it always rides the route, wherever the findings go.
  const routes: Array<string | AnalyzeOnSettleRoute> = analyzes.map((edge) => {
    const analystNode = analystNodes.get(edge.analyst)
    if (analystNode) {
      return {
        kind: edge.analyst,
        over: edge.over,
        agent: analystNode.profile,
        directive: registry.resolve(edge.directive).text,
        ...(edge.to === root.id ? {} : { to: edge.to }),
      }
    }
    return edge.to === root.id
      ? { kind: edge.analyst, over: edge.over }
      : {
          kind: edge.analyst,
          over: edge.over,
          to: edge.to,
          directive: registry.resolve(edge.directive).text,
        }
  })

  // ── Edge continuity defaults, threaded to the spawn tool by node id (= profile name) ──
  const continuityByProfile: Record<string, ContinuityMode> = {}
  for (const [nodeId, edge] of delegatesByWorker) {
    if (edge.continuity !== undefined) continuityByProfile[nodeId] = edge.continuity
  }

  // ── Steer + finding observation (delegates steers, analyzes traversals) ──
  // The filter seam: when the caller's authorizeMessage NARROWS an instruction, the delivered
  // bytes differ from the composed bytes — that steer traversal is `stripped` (the VB incident:
  // authored steering silently replaced by boilerplate, byte-indistinguishable downstream).
  const strippedByDigest = new Map<string, { composedBytes: number }>()
  const observeMessages = <I extends { readonly instruction: string }>(
    authorize: (input: I) => AuthorizedDownMessage,
  ): ((input: I) => AuthorizedDownMessage) => {
    return (input) => {
      const decision = authorize(input)
      if (decision.instruction !== input.instruction) {
        strippedByDigest.set(canonicalCandidateDigest(decision.instruction), {
          composedBytes: byteLength(input.instruction),
        })
      }
      return decision
    }
  }

  const routedAnalyzesByAnalyst = new Map<string, AnalyzesEdge>()
  const driverAnalyzesByAnalyst = new Map<string, AnalyzesEdge>()
  for (const edge of analyzes) {
    ;(edge.to === root.id ? driverAnalyzesByAnalyst : routedAnalyzesByAnalyst).set(
      edge.analyst,
      edge,
    )
  }
  const analyzesCapReached = (edge: AnalyzesEdge): boolean => {
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const used = capSpend.get(edgeId(edge)) ?? 0
    if (used < cap) return false
    exhausted.add(edgeId(edge))
    return true
  }
  const ledgerAnalyzes = (
    edge: AnalyzesEdge,
    outcome: EdgeDeliveryOutcome,
    bytes: number,
    reason: string | undefined,
    workerId: string | undefined,
  ): void => {
    const capped = analyzesCapReached(edge)
    record(
      {
        edge: edgeId(edge),
        kind: 'analyzes',
        from: edge.over.join('+'),
        to: edge.to,
        directive: formatPromptHandle(edge.directive),
        outcome: capped ? 'unpropagated' : outcome,
        // Every analyzes traversal is a mid-run delivery into an already-live recipient (a
        // routed steer leg, or the finding reaching the live driver) — never a spawn.
        continuity: 'steer',
        bytes,
        ...(capped
          ? {
              reason: `traversal-cap-exhausted (max ${edge.maxTraversals ?? defaultEdgeTraversalCap})`,
            }
          : reason !== undefined
            ? { reason }
            : {}),
        ...(workerId !== undefined ? { workerId } : {}),
      },
      true,
    )
  }

  const onCoordinationEvent = (event: CoordinationEvent): void => {
    if (event.type === 'finding') {
      // A routed edge's traversal is ledgered on its STEER (the delivery); the finding event is
      // its audit copy. A driver-destined edge's traversal IS the finding reaching the bus.
      const edge = driverAnalyzesByAnalyst.get(event.finding.analyst)
      if (!edge) return
      const sourceNode = nodeByWorkerId.get(event.finding.fromWorker)
      if (sourceNode === undefined || !edge.over.includes(sourceNode)) return
      // Absent findings (the analyst returned `undefined` — the producer omits the key so the
      // event stays digestable) contribute ZERO bytes, never the text "undefined".
      const findingsText =
        event.finding.findings === undefined ? '' : stringifyPayload(event.finding.findings)
      const directiveBytes = byteLength(registry.resolve(edge.directive).text)
      const empty = findingsText.length === 0
      ledgerAnalyzes(
        edge,
        empty ? 'empty' : 'delivered',
        directiveBytes + byteLength(findingsText),
        empty ? 'analyst returned no findings' : undefined,
        event.finding.fromWorker,
      )
      return
    }
    if (event.type === 'steer') {
      const down = event.down
      if (event.analyst !== undefined) {
        const edge = routedAnalyzesByAnalyst.get(event.analyst)
        if (!edge) return
        ledgerAnalyzes(
          edge,
          down.delivered ? 'delivered' : 'unpropagated',
          byteLength(down.instruction),
          down.delivered ? undefined : down.outcome,
          down.toWorker,
        )
        return
      }
      // A driver-authored steer to a live worker node is a delegates traversal too — the
      // mid-run leg of the same edge (the leg the motivating incident lost).
      const nodeId = nodeByWorkerId.get(down.toWorker)
      if (nodeId === undefined) return
      const edge = delegatesByWorker.get(nodeId)
      if (!edge) return
      const stripped = strippedByDigest.get(down.instructionDigest)
      record(
        {
          edge: edgeId(edge),
          kind: 'delegates',
          from: edge.from,
          to: edge.to,
          directive: formatPromptHandle(edge.directive),
          outcome: !down.delivered ? 'unpropagated' : stripped ? 'stripped' : 'delivered',
          // The mid-run leg of the edge: a delivery into the LIVE worker, never a spawn.
          continuity: 'steer',
          bytes: byteLength(down.instruction),
          ...(!down.delivered
            ? { reason: down.outcome }
            : stripped
              ? { reason: `authorization narrowed ${stripped.composedBytes} composed bytes` }
              : {}),
          workerId: down.toWorker,
        },
        true,
      )
    }
  }

  // ── Spawn binding: bind ledger rows to concrete worker ids, then journal them ──
  const bindSpawn = (
    parentNodeId: string | undefined,
    assignmentId: string,
    childId: string,
  ): Promise<void> | undefined => {
    const key = pendingKey(parentNodeId, assignmentId)
    const pending = pendingByAssignment.get(key)
    if (!pending) return undefined
    pendingByAssignment.delete(key)
    const bound: EdgeTraversal = { ...pending, workerId: childId }
    ledger[ledger.indexOf(pending)] = bound
    nodeByWorkerId.set(childId, bound.to)
    spend(bound.edge)
    return appendJournal(bound, childId)
  }

  const settle = async (): Promise<GraphLedgerSettlement> => {
    // A spawn row is PROVISIONAL until the `agent.spawn` hook (fired synchronously once a worker
    // exists) binds it to a live worker id. A row still unbound here means the factory ran but no
    // NEW worker went live: the spawn was refused after the factory (identity conflict, runtime
    // floor) or a keyed re-spawn deduplicated to an already-completed result (prepare() runs the
    // factory, no hook fires). Both state the same truth every unpropagated row states — the
    // directive never reached a live worker — so rewrite rather than mint a new outcome; the row
    // kept its ordinal and was never charged to the edge cap. Then settle every journal write, so
    // the ledger's journal twin is complete when this returns.
    for (const pending of pendingByAssignment.values()) await settleUnbound(pending)
    pendingByAssignment.clear()
    await Promise.all(journalWrites)
    return {
      ledger: Object.freeze(ledger.map((row) => Object.freeze({ ...row }))),
      exhaustedEdges: Object.freeze([...exhausted]),
      exhaustedDelegates: Object.freeze([...exhaustedDelegates]),
    }
  }

  return {
    routes,
    continuityByProfile,
    authorizeSpawn,
    resolveSpawnProfile,
    observeMessages,
    onCoordinationEvent,
    bindSpawn,
    settle,
  }
}

// ── run_graph: a graph a manager starts as one subtask ────────────────────────

/** A graph as a manager hands it to `run_graph`: the topology only. The tool's own arguments
 *  carry the budget (the subtask's reservation from the caller's pool) and the deliverable (the
 *  root node's task). */
export interface GraphSubtaskTopology {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
}

/** A validated `run_graph` graph, ready to spawn. */
export interface PreparedGraphSubtask {
  /** The root node's pinned profile with the graph brief, carrying the topology as Runtime-only
   *  metadata so the kernel rebuilds the same graph layer on a fresh spawn and on recovery. */
  readonly profile: AgentProfile
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeId>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseDirective(raw: unknown, where: string): PromptHandle {
  if (typeof raw === 'string') return promptHandle(raw)
  if (isRecord(raw) && typeof raw.surface === 'string' && typeof raw.version === 'number') {
    return { surface: raw.surface, version: raw.version }
  }
  throw new ValidationError(
    `run_graph: ${where}.directive must be a versioned directive reference such as ` +
      "'delegates/worker-brief/v1'",
  )
}

/**
 * Read graph data a model wrote, or a stored graph's topology. Edge directives may be written as
 * `'<surface>/v<n>'` strings. The budget and deliverable are the tool's arguments, so a graph that
 * carries its own is refused rather than one of the two silently ignored.
 */
export function parseGraphSubtaskTopology(raw: unknown): GraphSubtaskTopology {
  if (!isRecord(raw)) {
    throw new ValidationError('run_graph: graph must be an object { nodes, edges }')
  }
  for (const key of Object.keys(raw)) {
    if (key === 'nodes' || key === 'edges') continue
    if (key === 'budget' || key === 'deliverable') {
      throw new ValidationError(
        `run_graph: graph.${key} is not read — pass ${key} as run_graph's own argument`,
      )
    }
    throw new ValidationError(`run_graph: graph.${key} is not part of a graph; use nodes and edges`)
  }
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new ValidationError('run_graph: graph.nodes and graph.edges must be arrays')
  }
  const nodes = raw.nodes.map((node, index): GraphNode => {
    if (!isRecord(node) || typeof node.id !== 'string' || !isRecord(node.profile)) {
      throw new ValidationError(`run_graph: graph.nodes[${index}] must be { id, profile }`)
    }
    return { id: node.id, profile: node.profile as AgentProfile }
  })
  const edges = raw.edges.map((edge, index): GraphEdge => {
    const where = `graph.edges[${index}]`
    if (!isRecord(edge)) throw new ValidationError(`run_graph: ${where} must be an object`)
    const directive = parseDirective(edge.directive, where)
    if (edge.kind === 'delegates') {
      return { ...(edge as unknown as DelegatesEdge), directive }
    }
    if (edge.kind === 'analyzes') {
      return { ...(edge as unknown as AnalyzesEdge), directive }
    }
    throw new ValidationError(`run_graph: ${where}.kind must be 'delegates' or 'analyzes'`)
  })
  return { nodes, edges }
}

/**
 * Validate a `run_graph` graph and compose the profile its spawn runs: the root node's canonical
 * profile, the driver brief, and the topology under `metadata.agentRuntimeGraph`. That metadata is
 * part of the profile's identity, so a keyed `run_graph` that resumes runs the same graph, and the
 * provider-visible projection removes it before any provider sees the profile.
 */
export function prepareGraphSubtask(
  topology: GraphSubtaskTopology,
  opts: {
    readonly registry: PromptRegistry
    readonly analysts?: AnalystRegistry
    readonly guidance?: (profile: AgentProfile) => AgentProfile
  },
): PreparedGraphSubtask {
  const validated = validateGraphTopology(
    topology.nodes,
    topology.edges,
    opts.registry,
    opts.analysts,
  )
  const brief = graphRootProfile(validated, opts.registry)
  const marked: AgentProfile = {
    ...brief,
    metadata: {
      ...(brief.metadata ?? {}),
      [runtimeGraphMetadataKey]: { nodes: topology.nodes, edges: topology.edges },
    },
  }
  const parsed = agentProfileSchema.safeParse(opts.guidance ? opts.guidance(marked) : marked)
  if (!parsed.success) {
    throw new ValidationError(
      `run_graph: the graph's root profile is not a valid AgentProfile: ${parsed.error.message}`,
    )
  }
  return {
    profile: parsed.data,
    root: validated.root.id,
    nodes: topology.nodes.map((node) => node.id),
  }
}

/** The topology a `run_graph` root profile carries, or `undefined` for any other profile. */
export function graphSubtaskOf(profile: AgentProfile): GraphSubtaskTopology | undefined {
  const raw = profile.metadata?.[runtimeGraphMetadataKey]
  return raw === undefined ? undefined : parseGraphSubtaskTopology(raw)
}
