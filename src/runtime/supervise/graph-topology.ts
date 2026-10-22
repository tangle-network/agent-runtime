/**
 * `run_graph`: a graph a manager starts as one subtask. The topology is read from model-written
 * data or a stored graph, validated exactly as `runGraph` validates a root graph, and carried on
 * the root profile so the kernel rebuilds the same graph layer on a fresh spawn and on recovery.
 * A topology with `entry` is a flow graph: its root is Runtime's own flow root, as in `runGraph`.
 */

// Canonical topology validation and profile preparation for root and nested graphs.

import { isRecord } from '@tangle-network/agent-core'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import { errMessage } from './error-message'
import type { GraphEdge, GraphNode, GraphTopology } from './graph'
import { flowRootName, flowRootProfile, type ValidatedFlow, validateFlowGraph } from './graph-flow'
import { type PromptHandle, type PromptRegistry, promptHandle } from './prompt-registry'
import { coordinationProfileToolPrefix, runtimeGraphMetadataKey } from './provider-visible-profile'
import type { NodeId } from './types'

/** Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. */
export const defaultEdgeTraversalCap = 32

export type DelegatesEdge = Extract<GraphEdge, { kind: 'delegates' }>
export type AnalyzesEdge = Extract<GraphEdge, { kind: 'analyzes' }>
type MapsEdge = Extract<GraphEdge, { kind: 'maps' }>
const mapItemFailurePolicies: ReadonlyArray<string> = ['all-or-refuse', 'settled-subset']

// ── Validation ─────────────────────────────────────────────────────────────────

/** A topology that passed every structural refusal, indexed for the overlay. A flow graph has no
 *  root: Runtime schedules its nodes from `flow`. */
export interface ValidatedGraph {
  readonly root: GraphNode | undefined
  readonly workers: ReadonlyMap<NodeId, GraphNode>
  readonly delegatesByWorker: ReadonlyMap<NodeId, DelegatesEdge>
  readonly analyzes: ReadonlyArray<AnalyzesEdge>
  /** Nodes referenced as an analyzes edge's ANALYST (the analyst-agent form): reachable through
   *  their analyzes edge (spawned on settle), never through a delegates edge. */
  readonly analystNodes: ReadonlyMap<NodeId, GraphNode>
  readonly maps: ReadonlyArray<MapsEdge>
  /** Item and join nodes of maps edges: reachable only through their edge, spawned by the runtime. */
  readonly mapNodes: ReadonlyMap<NodeId, GraphNode>
  /** By maps edge id: the name an item runs under — the item node, or a graph item's root node. */
  readonly mapItemNames: ReadonlyMap<string, NodeId>
  /** Present exactly for a flow graph (one with `entry`). */
  readonly flow?: ValidatedFlow
}

/** A graph with a root: what `runGraph` drives through a root manager and `run_graph` starts. */
export type RootValidatedGraph = ValidatedGraph & { readonly root: GraphNode }

/** A routes edge's id needs its ordinal among its source's edges, which only the flow knows; this
 *  form names a routes edge in a refusal. */
export function edgeId(edge: GraphEdge): string {
  if (edge.kind === 'delegates') return `delegates:${edge.from}->${edge.to}`
  if (edge.kind === 'maps') return `maps:${edge.from}->${edge.to ?? 'graph'}->${edge.join}`
  if (edge.kind === 'routes') return `routes:${edge.from}->${JSON.stringify(edge.to)}`
  return `analyzes:${edge.analyst}:${edge.over.join('+')}->${edge.to}`
}

const isPositiveInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 1

/** Refuse a node no graph can run, and index the nodes by id. */
export function validateGraphNodes(nodes: ReadonlyArray<GraphNode>): Map<NodeId, GraphNode> {
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
  return byId
}

/** Validate a topology and resolve every directive BEFORE any compute is spent — an invalid
 *  topology or an unknown directive is a configuration fault, never a mid-run surprise. */
export function validateGraphTopology(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): RootValidatedGraph {
  if (!Array.isArray(nodes) || nodes.length === 0) {
    throw new ValidationError('runGraph: graph.nodes must be a non-empty array')
  }
  if (!Array.isArray(edges) || edges.length === 0) {
    throw new ValidationError('runGraph: graph.edges must be a non-empty array')
  }
  const byId = validateGraphNodes(nodes)
  const requireNode = (id: NodeId, where: string): GraphNode => {
    const node = byId.get(id)
    if (!node) throw new ValidationError(`runGraph: ${where} references unknown node '${id}'`)
    return node
  }
  // A graph is plain data that often arrives through JSON: an edge of no known kind would be
  // silently skipped by every reader below, so it is refused here.
  for (const edge of edges) {
    const kind = (edge as { kind?: unknown }).kind
    if (kind === 'routes') {
      throw new ValidationError(
        `runGraph: ${edgeId(edge as GraphEdge)} is a routes edge, which only a flow graph runs — ` +
          'set graph.entry to name the nodes Runtime starts',
      )
    }
    if (kind !== 'delegates' && kind !== 'analyzes' && kind !== 'maps') {
      throw new ValidationError(
        `runGraph: edge kind ${JSON.stringify(kind)} is not 'delegates', 'analyzes', 'maps' or 'routes'`,
      )
    }
  }
  const delegates = edges.filter((edge): edge is DelegatesEdge => edge.kind === 'delegates')
  const analyzes = edges.filter((edge): edge is AnalyzesEdge => edge.kind === 'analyzes')
  const maps = edges.filter((edge): edge is MapsEdge => edge.kind === 'maps')
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
  const { mapNodes, mapItemNames } = validateMaps(maps, {
    byId,
    root,
    workers,
    analystNodes,
    registry,
    analysts,
  })
  // Every non-root node must be reachable by SOME edge, or it can never run. A worker node is
  // reached by its delegates edge; an analyst node by its analyzes edge (spawned on settle); a
  // map's item and join nodes by their maps edge.
  for (const node of nodes) {
    if (
      node.id !== root.id &&
      !workers.has(node.id) &&
      !analystNodes.has(node.id) &&
      !mapNodes.has(node.id)
    ) {
      throw new ValidationError(
        `runGraph: node '${node.id}' has no delegates edge to it — an unreachable node never runs`,
      )
    }
  }
  return { root, workers, delegatesByWorker, analyzes, analystNodes, maps, mapNodes, mapItemNames }
}

/**
 * Refuse a maps edge the runtime could not run as authored. A map's item and join nodes are the
 * runtime's to spawn, so neither may be the root, a delegates target, an analyst, or a node of
 * another map: a second way to reach the node would make its ledger rows and its pinning ambiguous.
 * The source must be a node that settles as a worker: a delegates target, or another map's join.
 */
export function validateMaps(
  maps: ReadonlyArray<MapsEdge>,
  graph: {
    readonly byId: ReadonlyMap<NodeId, GraphNode>
    readonly root: GraphNode | undefined
    readonly workers: ReadonlyMap<NodeId, GraphNode>
    readonly analystNodes: ReadonlyMap<NodeId, GraphNode>
    readonly registry: PromptRegistry
    readonly analysts: AnalystRegistry | undefined
  },
): {
  readonly mapNodes: ReadonlyMap<NodeId, GraphNode>
  readonly mapItemNames: ReadonlyMap<string, NodeId>
} {
  const mapNodes = new Map<NodeId, GraphNode>()
  const mapItemNames = new Map<string, NodeId>()
  const joins = new Set<NodeId>()
  for (const edge of maps) {
    const id = edgeId(edge)
    const refuse = (why: string): never => {
      throw new ValidationError(`runGraph: ${id} ${why}`)
    }
    if ((edge as { continuity?: unknown }).continuity !== undefined) {
      refuse('carries continuity — every map item is a fresh session over its own element')
    }
    if (
      typeof edge.pointer !== 'string' ||
      (edge.pointer !== '' && !edge.pointer.startsWith('/'))
    ) {
      refuse(
        `has pointer ${JSON.stringify(edge.pointer)} — a JSON pointer is '' or starts with '/'`,
      )
    }
    if (!isPositiveInteger(edge.maxItems)) refuse('needs maxItems as a positive integer')
    if (!isPositiveInteger(edge.concurrency)) {
      refuse(
        `has concurrency ${JSON.stringify(edge.concurrency)} — it needs a positive integer; ` +
          'concurrency throttles the items, so a value below 1 could never start one',
      )
    }
    if (!mapItemFailurePolicies.includes(edge.onItemFailure)) {
      refuse(`needs onItemFailure 'all-or-refuse' or 'settled-subset'`)
    }
    if (
      edge.itemBudget !== undefined &&
      (typeof edge.itemBudget !== 'object' ||
        edge.itemBudget === null ||
        Array.isArray(edge.itemBudget))
    ) {
      refuse('has an itemBudget that is not a budget object')
    }
    if ((edge.to === undefined) === (edge.graph === undefined)) {
      refuse('needs exactly one of to (an item node) or graph (a graph run per item)')
    }
    if (typeof edge.join !== 'string') refuse('needs a join node')
    if (edge.to !== undefined && edge.to === edge.join) refuse('joins into its own item node')
    for (const nodeId of edge.to === undefined ? [edge.join] : [edge.to, edge.join]) {
      const node = graph.byId.get(nodeId)
      if (!node) refuse(`references unknown node '${nodeId}'`)
      if (
        nodeId === graph.root?.id ||
        graph.workers.has(nodeId) ||
        graph.analystNodes.has(nodeId) ||
        mapNodes.has(nodeId)
      ) {
        refuse(
          `names node '${nodeId}', which the graph already reaches another way — a map's item and ` +
            'join nodes are spawned only by their maps edge, never as the root, a delegates ' +
            'target, an analyst, or a node of another map',
        )
      }
      mapNodes.set(nodeId, node as GraphNode)
    }
    joins.add(edge.join)
    if (edge.to !== undefined) {
      mapItemNames.set(id, edge.to)
    } else {
      // The same validation `run_graph` applies, before any compute.
      try {
        const prepared = prepareGraphSubtask(parseGraphSubtaskTopology(edge.graph), {
          registry: graph.registry,
          ...(graph.analysts ? { analysts: graph.analysts } : {}),
        })
        mapItemNames.set(id, prepared.root)
      } catch (error) {
        refuse(`has a graph item that cannot run: ${errMessage(error)}`)
      }
    }
  }
  for (const edge of maps) {
    if (!graph.byId.has(edge.from)) {
      throw new ValidationError(`runGraph: ${edgeId(edge)} references unknown node '${edge.from}'`)
    }
    if (!graph.workers.has(edge.from) && !joins.has(edge.from)) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} maps over '${edge.from}', which never settles as a worker — ` +
          "a map's source is a delegates target or another map's join",
      )
    }
    if (edge.from === edge.join) {
      throw new ValidationError(`runGraph: ${edgeId(edge)} maps over its own join`)
    }
  }
  return { mapNodes, mapItemNames }
}

// ── The driver brief ───────────────────────────────────────────────────────────

/** The root node's canonical profile with the graph brief appended: which nodes the driver may
 *  spawn, by exact name, each with its delegation cap and continuity. */
export function graphRootProfile(
  validated: RootValidatedGraph,
  registry: PromptRegistry,
): AgentProfile {
  const { root, workers, delegatesByWorker, analyzes, analystNodes, maps, mapItemNames } = validated
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
  // Maps run without the driver: say so, or a driver would spawn the items a second time.
  const mapLines = maps.map(
    (edge) =>
      `- when '${edge.from}' settles, the runtime runs '${mapItemNames.get(edgeId(edge))}'${edge.to === undefined ? ' (a graph)' : ''} once per ` +
      `element of ${edge.pointer === '' ? 'its result' : `${JSON.stringify(edge.pointer)} in its result`} ` +
      `(at most ${edge.maxItems} elements, ${edge.concurrency} at a time), then '${edge.join}' with the ordered ` +
      `results; '${edge.join}' settles to you like a worker, and a refused map arrives as a map event`,
  )
  const graphBrief = [
    'AGENT GRAPH: you are the driver node of a fixed topology. You may spawn ONLY these worker',
    "nodes, by EXACT name (spawn_worker with profile: { name: '<node id>' }; the node's full",
    'profile is pinned by the graph — any other profile fields you author are ignored):',
    ...workerLines,
    ...(mapLines.length > 0
      ? ['', 'MAPS (the runtime spawns these nodes; never spawn them yourself):', ...mapLines]
      : []),
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
type RoutesEdge = Extract<GraphEdge, { kind: 'routes' }>

/** A graph as a manager hands it to `run_graph`: the topology only. The tool's own arguments
 *  carry the budget (the subtask's reservation from the caller's pool) and the deliverable (the
 *  root node's task). */
export type GraphSubtaskTopology = GraphTopology

/** A validated `run_graph` graph, ready to spawn. */
interface PreparedGraphSubtask {
  /** The root node's pinned profile with the graph brief, carrying the topology as Runtime-only
   *  metadata so the kernel rebuilds the same graph layer on a fresh spawn and on recovery. */
  readonly profile: AgentProfile
  readonly root: NodeId
  readonly nodes: ReadonlyArray<NodeId>
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
    throw new ValidationError('run_graph: graph must be an object { nodes, edges, entry? }')
  }
  for (const key of Object.keys(raw)) {
    if (key === 'nodes' || key === 'edges' || key === 'entry') continue
    if (key === 'gates') {
      throw new ValidationError(
        "run_graph: graph.gates — a gate asks the top-level run's decideGate, and a maps " +
          "item's graph or a run_graph subtask has none; put the gate in the top-level flow",
      )
    }
    if (key === 'budget' || key === 'deliverable') {
      throw new ValidationError(
        `run_graph: graph.${key} is not read — pass ${key} as run_graph's own argument`,
      )
    }
    throw new ValidationError(
      `run_graph: graph.${key} is not part of a graph; use nodes, edges and entry`,
    )
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
    if (edge.kind === 'maps') {
      return { ...(edge as unknown as MapsEdge), directive }
    }
    if (edge.kind === 'routes') {
      return { ...(edge as unknown as RoutesEdge), directive }
    }
    throw new ValidationError(
      `run_graph: ${where}.kind must be 'delegates', 'analyzes', 'maps' or 'routes'`,
    )
  })
  if (raw.entry === undefined) return { nodes, edges }
  if (!Array.isArray(raw.entry)) {
    throw new ValidationError('run_graph: graph.entry must be an array of { node, task }')
  }
  const entry = raw.entry.map((item, index) => {
    if (!isRecord(item) || typeof item.node !== 'string') {
      throw new ValidationError(`run_graph: graph.entry[${index}] must be { node, task }`)
    }
    return { node: item.node, task: item.task }
  })
  return { nodes, edges, entry }
}

/** Validate a subtask topology: a flow graph (with `entry`) under Runtime's flow root, otherwise a
 *  graph driven by its root node. */
export function validateGraphSubtask(
  topology: GraphSubtaskTopology,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): ValidatedGraph {
  return topology.entry === undefined
    ? validateGraphTopology(topology.nodes, topology.edges, registry, analysts)
    : validateFlowGraph(topology, registry, analysts)
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
  const validated = validateGraphSubtask(topology, opts.registry, opts.analysts)
  const brief =
    validated.root === undefined
      ? flowRootProfile
      : graphRootProfile(validated as RootValidatedGraph, opts.registry)
  const marked: AgentProfile = {
    ...brief,
    metadata: {
      ...(brief.metadata ?? {}),
      [runtimeGraphMetadataKey]: {
        nodes: topology.nodes,
        edges: topology.edges,
        ...(topology.entry === undefined ? {} : { entry: topology.entry }),
      },
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
    root: validated.root?.id ?? flowRootName,
    nodes: topology.nodes.map((node) => node.id),
  }
}

/** The topology a `run_graph` root profile carries, or `undefined` for any other profile. */
export function graphSubtaskOf(profile: AgentProfile): GraphSubtaskTopology | undefined {
  const raw = profile.metadata?.[runtimeGraphMetadataKey]
  return raw === undefined ? undefined : parseGraphSubtaskTopology(raw)
}
