/**
 * Flow graphs: an `AgentGraph` with `entry`. Runtime spawns the entries and traverses `routes`
 * edges itself, so a fixed pipeline, a conditional branch, a bounded repair loop, a stop rule and a
 * human gate run from graph data with no model root and no caller brain.
 *
 * This module owns what a flow adds to `runGraph`: every refusal a flow earns before compute, the
 * coordination form of the flow (`RouteFlow`, which the manager's route routing runs), the
 * runtime-owned root that hosts it, and the graph-owned finalizer that turns the flow's outputs
 * into the run's result. `runGraph` stays the one team executor; `supervise()` stays its substrate.
 */

import { isRecord } from '@tangle-network/agent-core'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { CoordinationEvent } from '../../mcp/tools/coordination-events'
import type {
  DecideGate,
  JsonScalar,
  RouteFlow,
  RouteFlowEvent,
  RouteGate,
  RouteMatch,
  RouteWhen,
} from '../../mcp/tools/coordination-route-contracts'
import type { SupervisorFinalizer } from './finalizer'
import type {
  AgentGraph,
  EdgeTraversal,
  GraphEdge,
  GraphNode,
  GraphResult,
  RunGraphOptions,
} from './graph'
import {
  defaultEdgeTraversalCap,
  edgeId,
  type ValidatedGraph,
  validateGraphNodes,
  validateMaps,
} from './graph-topology'
import { formatPromptHandle, type PromptRegistry } from './prompt-registry'
import { coordinationProfileToolPrefix } from './provider-visible-profile'
import type { NodeId, SpawnJournal, SupervisedResult } from './types'

type RoutesEdge = Extract<GraphEdge, { kind: 'routes' }>
type MapsEdge = Extract<GraphEdge, { kind: 'maps' }>

/** A validated flow, indexed for the overlay and the route routing. */
export interface ValidatedFlow {
  readonly entries: ReadonlyArray<{
    readonly edge: string
    readonly key: string
    readonly node: NodeId
    readonly task: unknown
  }>
  /** Every routes edge by its ledger id, in declaration order. */
  readonly routes: ReadonlyMap<string, RoutesEdge>
  /** The nodes each entry or routes edge starts, by ledger id: what route-spawn pinning admits. */
  readonly starts: ReadonlyMap<string, ReadonlySet<NodeId>>
  /** Nodes Runtime spawns through an entry or a routes edge. */
  readonly nodes: ReadonlyMap<NodeId, GraphNode>
  /** Nodes whose settles the flow routes: `nodes` and every map join. */
  readonly routed: ReadonlyArray<NodeId>
  /** Routed nodes with no outgoing routes edge and no outgoing maps edge. */
  readonly terminals: ReadonlySet<NodeId>
  /** Gates by id: vertices a routes edge reaches that ask the caller instead of running an agent. */
  readonly gates: ReadonlyMap<NodeId, RouteGate>
}

/** A flow node's usable settle matched no routes edge leaving it (`unrouted`), or a fired edge named
 *  a node that still had a running worker (`target-live`). The flow spawned nothing more; the full
 *  evidence rides on the error, shaped like `GraphEdgeCapError`. */
export class GraphRouteError extends Error {
  readonly reason: 'unrouted' | 'target-live'
  readonly node: NodeId
  readonly workerId: string
  readonly ledger: ReadonlyArray<EdgeTraversal>
  readonly result: SupervisedResult<unknown>
  constructor(
    unrouted: {
      readonly reason: 'unrouted' | 'target-live'
      readonly node: NodeId
      readonly workerId: string
      readonly detail: string
    },
    ledger: ReadonlyArray<EdgeTraversal>,
    result: SupervisedResult<unknown>,
  ) {
    super(
      unrouted.reason === 'target-live'
        ? `runGraph: flow node '${unrouted.node}' (worker ${unrouted.workerId}) fired a route ` +
            `into a live target (${unrouted.detail}). Converging branches use a join (a routes ` +
            'edge whose from lists every branch); the full edge ledger and the supervised ' +
            'result ride on this error.'
        : `runGraph: flow node '${unrouted.node}' (worker ${unrouted.workerId}) settled a result ` +
            `no routes edge matched (${unrouted.detail}). Add a default routes edge or fix the ` +
            'node; the full edge ledger and the supervised result ride on this error.',
    )
    this.name = 'GraphRouteError'
    this.reason = unrouted.reason
    this.node = unrouted.node
    this.workerId = unrouted.workerId
    this.ledger = ledger
    this.result = result
  }
}

/** The name the runtime-owned flow root runs under. It is no node, so it pins nothing. */
export const flowRootName = 'flow'

/**
 * The flow root: a manager whose only grant is `spawn_worker`, so every entry and route spawn
 * still passes spawn admission. Its brain is the runtime flow brain, which never calls a model.
 */
export const flowRootProfile: AgentProfile = Object.freeze({
  name: flowRootName,
  harness: 'cli-base',
  tools: { [`${coordinationProfileToolPrefix}spawn_worker`]: true },
}) as AgentProfile

/** The nodes a routes edge starts: one, every node of a fork, or none for a stop or finish. */
const routeTargets = (to: RoutesEdge['to']): ReadonlyArray<NodeId> =>
  typeof to === 'string' ? [to] : Array.isArray(to) ? to : []

/** The sources a routes edge waits for: one, or every member of a join. */
const routeSources = (from: RoutesEdge['from']): ReadonlyArray<NodeId> =>
  typeof from === 'string' ? [from] : from

const routeTargetName = (to: RoutesEdge['to']): string => {
  const nodes = routeTargets(to)
  if (nodes.length > 0) return nodes.join('+')
  const end = to as { readonly stop?: string; readonly finish?: string }
  return end.stop !== undefined ? `stop:${end.stop}` : `finish:${end.finish}`
}

const isScalar = (value: unknown): value is JsonScalar =>
  value === null ||
  typeof value === 'string' ||
  typeof value === 'boolean' ||
  (typeof value === 'number' && Number.isFinite(value))

const isPointer = (value: unknown): boolean =>
  typeof value === 'string' && (value === '' || value.startsWith('/'))

/**
 * Validate a flow graph before any compute: every refusal of a flow is here, so a flow that runs
 * can only end by its routes, its budget, its deadline or its abort signal.
 */
export function validateFlowGraph(
  graph: Pick<AgentGraph, 'nodes' | 'edges' | 'entry' | 'gates'>,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): ValidatedGraph {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new ValidationError('runGraph: graph.nodes must be a non-empty array')
  }
  if (!Array.isArray(graph.edges)) {
    throw new ValidationError('runGraph: graph.edges must be an array (empty in a flow of entries)')
  }
  const byId = validateGraphNodes(graph.nodes)
  const entry = graph.entry
  if (!Array.isArray(entry) || entry.length === 0) {
    throw new ValidationError('runGraph: graph.entry must name at least one node Runtime starts')
  }
  const requireNode = (id: unknown, where: string): GraphNode => {
    const node = typeof id === 'string' ? byId.get(id) : undefined
    if (!node) {
      throw new ValidationError(`runGraph: ${where} references unknown node ${JSON.stringify(id)}`)
    }
    return node
  }
  for (const [index, item] of entry.entries()) requireNode(item?.node, `graph.entry[${index}]`)
  const gates = validateGates(graph.gates, byId)
  // A routes edge may start at or reach a gate where it names one vertex, never in a fork or join.
  const requireVertex = (id: unknown, where: string): void => {
    if (typeof id !== 'string' || !gates.has(id)) requireNode(id, where)
  }

  const routes: RoutesEdge[] = []
  const maps: MapsEdge[] = []
  for (const edge of graph.edges) {
    const kind = (edge as { kind?: unknown }).kind
    if (kind === 'delegates') {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} — a flow graph (one with entry) has no root to delegate; ` +
          'Runtime starts its entries and traverses its routes edges',
      )
    }
    if (kind === 'analyzes') {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} — findings go to a root or a live worker, and a flow graph has ` +
          'no root; make the analyst a routes node that reads its subject as evidence',
      )
    }
    if (kind === 'routes') routes.push(edge as RoutesEdge)
    else if (kind === 'maps') maps.push(edge as MapsEdge)
    else {
      throw new ValidationError(
        `runGraph: edge kind ${JSON.stringify(kind)} is not 'routes' or 'maps' in a flow graph`,
      )
    }
  }
  for (const edge of graph.edges) registry.resolve(edge.directive)

  // Edge ids: the ordinal among the routes edges leaving the same source, 1-based. A join's source
  // is its members, joined by '+'; a fork's target is its nodes, joined by '+'.
  for (const edge of routes) validateRouteEnds(edge, requireNode, requireVertex, gates)
  const routesById = new Map<string, RoutesEdge>()
  const bySource = new Map<string, RoutesEdge[]>()
  const routesFrom = new Map<NodeId, RoutesEdge[]>()
  const idOf = new Map<RoutesEdge, string>()
  for (const edge of routes) {
    const source = routeSources(edge.from).join('+')
    const leaving = [...(bySource.get(source) ?? []), edge]
    bySource.set(source, leaving)
    for (const from of routeSources(edge.from)) {
      routesFrom.set(from, [...(routesFrom.get(from) ?? []), edge])
    }
    const id = `routes:${source}#${leaving.length}->${routeTargetName(edge.to)}`
    idOf.set(edge, id)
    routesById.set(id, edge)
  }
  for (const edge of routes) {
    validateRoutesEdge(edge, idOf.get(edge) as string, requireNode, requireVertex, gates)
  }
  for (const gate of gates.values()) validateGateExits(gate, routesFrom.get(gate.id) ?? [], idOf)
  for (const [from, leaving] of routesFrom) {
    const join = leaving.find((edge) => routeSources(edge.from).length > 1)
    if (join !== undefined && leaving.length > 1) {
      throw new ValidationError(
        `runGraph: '${from}' is a member of join ${idOf.get(join)} and has ${leaving.length - 1} ` +
          'other outgoing routes edge(s) — a join member settles only into its join, so a second ' +
          'edge would decide its settle twice',
      )
    }
    const defaults = leaving.filter((edge) => edge.when === undefined)
    if (defaults.length > 1) {
      throw new ValidationError(
        `runGraph: node '${from}' has ${defaults.length} default routes edges (no when) — a node ` +
          'has at most one default branch',
      )
    }
    if (defaults.length === 1 && leaving.at(-1) !== defaults[0]) {
      throw new ValidationError(
        `runGraph: ${idOf.get(defaults[0] as RoutesEdge)} is a default edge (no when) that is not ` +
          `the last edge leaving '${from}' — edges are tried in order, so every edge after it ` +
          'could never fire',
      )
    }
  }

  // Nodes Runtime spawns: entries and route targets. Map items and joins are spawned by their map.
  const flowNodes = new Map<NodeId, GraphNode>()
  for (const item of entry) flowNodes.set(item.node, byId.get(item.node) as GraphNode)
  for (const edge of routes) {
    for (const to of routeTargets(edge.to)) {
      if (!gates.has(to)) flowNodes.set(to, byId.get(to) as GraphNode)
    }
  }
  for (const edge of maps) {
    if (gates.has(edge.from)) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} expands gate '${edge.from}' — a gate's result is a decision, ` +
          'not a list; map over the node the gate routes to',
      )
    }
  }
  const { mapNodes, mapItemNames } = validateMaps(maps, {
    byId,
    root: undefined,
    workers: flowNodes,
    analystNodes: new Map(),
    registry,
    analysts,
  })
  const joins = new Set(maps.map((edge) => edge.join))
  for (const edge of routes) {
    for (const from of routeSources(edge.from)) {
      if (!flowNodes.has(from) && !joins.has(from) && !gates.has(from)) {
        throw new ValidationError(
          `runGraph: ${idOf.get(edge)} leaves '${from}', a map item: its settle goes to its ` +
            'map, so a route from it could never fire',
        )
      }
    }
  }

  // Every edge Runtime can take, for reachability, cycles and evidence order.
  const next = new Map<NodeId, Set<NodeId>>()
  const link = (from: NodeId, to: NodeId): void => {
    next.set(from, (next.get(from) ?? new Set()).add(to))
  }
  for (const edge of routes) {
    for (const from of routeSources(edge.from)) {
      for (const to of routeTargets(edge.to)) link(from, to)
    }
  }
  for (const edge of maps) {
    if (edge.to !== undefined) link(edge.from, edge.to)
    link(edge.from, edge.join)
  }
  const reachableFrom = (starts: Iterable<NodeId>): Set<NodeId> => {
    const seen = new Set<NodeId>()
    const queue = [...starts]
    while (queue.length > 0) {
      const id = queue.shift() as NodeId
      for (const to of next.get(id) ?? []) {
        if (seen.has(to)) continue
        seen.add(to)
        queue.push(to)
      }
    }
    return seen
  }
  // A join starts its target only once every member can settle, so a node is reachable when some
  // edge into it has every one of its sources reachable. A join whose member waits on the join's
  // own target can never fire, and leaves that target unreachable.
  const fromEntry = new Set<NodeId>(entry.map((item) => item.node))
  for (let grew = true; grew; ) {
    grew = false
    const reach = (sources: ReadonlyArray<NodeId>, targets: ReadonlyArray<NodeId>): void => {
      if (!sources.every((id) => fromEntry.has(id))) return
      for (const id of targets) {
        if (fromEntry.has(id)) continue
        fromEntry.add(id)
        grew = true
      }
    }
    for (const edge of routes) reach(routeSources(edge.from), routeTargets(edge.to))
    for (const edge of maps)
      reach([edge.from], edge.to === undefined ? [edge.join] : [edge.to, edge.join])
  }
  for (const node of [...graph.nodes, ...gates.values()]) {
    if (!fromEntry.has(node.id)) {
      throw new ValidationError(
        `runGraph: node '${node.id}' is unreachable from entry — no entry, routes edge or maps ` +
          'edge ever starts it (a join starts its target only once every member can settle)',
      )
    }
  }
  refuseUncappedRouteCycles(routes, idOf)
  // An evidence node must be able to settle before a source does on some path from entry.
  for (const edge of routes) {
    for (const id of edge.evidence ?? []) {
      const sources = routeSources(edge.from)
      if (sources.includes(id) || sources.some((from) => reachableFrom([id]).has(from))) continue
      throw new ValidationError(
        `runGraph: ${idOf.get(edge)} lists evidence '${id}', which cannot settle before ` +
          `'${sources.join("' or '")}' on any path from entry — its result could never ride this edge`,
      )
    }
  }

  const routed = [...flowNodes.keys(), ...[...joins].filter((id) => !flowNodes.has(id))]
  const mapSources = new Set(maps.map((edge) => edge.from))
  const terminals = new Set(routed.filter((id) => !routesFrom.has(id) && !mapSources.has(id)))
  const repeats = new Map<NodeId, number>()
  const entries = entry.map((item) => {
    const k = repeats.get(item.node) ?? 0
    repeats.set(item.node, k + 1)
    return {
      edge: `routes:entry->${item.node}`,
      key: k === 0 ? `route:entry:${item.node}` : `route:entry:${item.node}#${k}`,
      node: item.node,
      task: item.task,
    }
  })
  const starts = new Map<string, ReadonlySet<NodeId>>()
  for (const item of entries)
    starts.set(item.edge, new Set([...(starts.get(item.edge) ?? []), item.node]))
  for (const [id, edge] of routesById) starts.set(id, new Set(routeTargets(edge.to)))
  return {
    root: undefined,
    workers: new Map(),
    delegatesByWorker: new Map(),
    analyzes: [],
    analystNodes: new Map(),
    maps,
    mapNodes,
    mapItemNames,
    flow: { entries, routes: routesById, starts, nodes: flowNodes, routed, terminals, gates },
  }
}

/** Refuse a malformed gate: an id that is not its own vertex, a missing question, or fewer than
 *  two distinct choices. */
function validateGates(
  raw: AgentGraph['gates'],
  byId: ReadonlyMap<NodeId, GraphNode>,
): ReadonlyMap<NodeId, RouteGate> {
  const gates = new Map<NodeId, RouteGate>()
  if (raw === undefined) return gates
  if (!Array.isArray(raw)) throw new ValidationError('runGraph: graph.gates must be an array')
  for (const [index, gate] of raw.entries()) {
    const where = `runGraph: graph.gates[${index}]`
    const id = (gate as { id?: unknown } | undefined)?.id
    if (typeof id !== 'string' || id.length === 0) {
      throw new ValidationError(`${where} needs a non-empty id`)
    }
    if (byId.has(id)) {
      throw new ValidationError(
        `${where} has id '${id}', which is also a node id — a gate is a vertex of its own, so an ` +
          'edge naming it must not be able to mean an agent',
      )
    }
    if (gates.has(id)) throw new ValidationError(`${where} repeats gate id '${id}'`)
    if (typeof gate.question !== 'string' || gate.question.length === 0) {
      throw new ValidationError(`${where} ('${id}') needs a non-empty question`)
    }
    const choices = gate.choices as unknown
    if (
      !Array.isArray(choices) ||
      choices.length < 2 ||
      !choices.every((choice) => typeof choice === 'string' && choice.length > 0) ||
      new Set(choices).size !== choices.length
    ) {
      throw new ValidationError(
        `${where} ('${id}') needs at least two distinct non-empty choices — a gate with one ` +
          'choice asks nothing',
      )
    }
    gates.set(id, { id, question: gate.question, choices: [...choices] as string[] })
  }
  return gates
}

/** The choice an edge leaving a gate matches: `when: { pointer: '/choice', equals: <choice> }`. */
const gateChoiceOf = (edge: RoutesEdge): unknown => {
  const when = edge.when as Partial<{ all: unknown; node: unknown; pointer: unknown }> | undefined
  if (when === undefined || 'all' in when || when.node !== undefined) return undefined
  return when.pointer === '/choice' && 'equals' in when ? when.equals : undefined
}

/** Refuse a gate whose leaving edges do not map its choices one to one. */
function validateGateExits(
  gate: RouteGate,
  leaving: ReadonlyArray<RoutesEdge>,
  idOf: ReadonlyMap<RoutesEdge, string>,
): void {
  const routed = new Set<unknown>()
  for (const edge of leaving) {
    const choice = gateChoiceOf(edge)
    if (typeof choice !== 'string' || !gate.choices.includes(choice)) {
      throw new ValidationError(
        `runGraph: ${idOf.get(edge)} leaves gate '${gate.id}' without matching one of its ` +
          `choices (${gate.choices.join(', ')}) — an edge leaving a gate uses ` +
          "when: { pointer: '/choice', equals: <choice> }",
      )
    }
    if (routed.has(choice)) {
      throw new ValidationError(
        `runGraph: ${idOf.get(edge)} is a second edge for choice '${choice}' of gate ` +
          `'${gate.id}' — each choice has exactly one leaving edge`,
      )
    }
    routed.add(choice)
  }
  const unrouted = gate.choices.filter((choice) => !routed.has(choice))
  if (unrouted.length > 0) {
    throw new ValidationError(
      `runGraph: gate '${gate.id}' has no leaving edge for choice(s) ${unrouted.join(', ')} — ` +
        'a decision the graph cannot route would strand the run',
    )
  }
}

/** Refuse a malformed source or target: a fork or join names two or more distinct known nodes. */
function validateRouteEnds(
  edge: RoutesEdge,
  requireNode: (id: unknown, where: string) => GraphNode,
  requireVertex: (id: unknown, where: string) => void,
  gates: ReadonlyMap<NodeId, RouteGate>,
): void {
  const where = edgeId(edge)
  const list = (value: unknown, role: 'from' | 'to', kind: 'join' | 'fork'): void => {
    if (!Array.isArray(value)) return
    const gate = value.find((id) => gates.has(id))
    if (gate !== undefined) {
      throw new ValidationError(
        `runGraph: ${where} lists gate '${gate}' in a ${kind} — a gate is reached and left one ` +
          'edge at a time',
      )
    }
    if (value.length < 2) {
      throw new ValidationError(
        `runGraph: ${where} has a ${kind} with ${value.length} node(s) in ${role} — a ${kind} ` +
          `names at least two nodes; write one node as a plain id`,
      )
    }
    for (const id of value) requireNode(id, where)
    const repeated = value.find((id, index) => value.indexOf(id) !== index)
    if (repeated !== undefined) {
      throw new ValidationError(
        `runGraph: ${where} lists '${repeated}' twice in its ${kind} — each ${kind} member is ` +
          'one distinct node',
      )
    }
  }
  if (Array.isArray(edge.from)) list(edge.from, 'from', 'join')
  else requireVertex(edge.from, where)
  list(edge.to, 'to', 'fork')
  if (Array.isArray(edge.from) && edge.when !== undefined) {
    throw new ValidationError(
      `runGraph: ${where} is a join with a when — a join fires once every member has settled, so ` +
        'there is no single settle for a condition to read; branch before or after the join',
    )
  }
}

function validateRoutesEdge(
  edge: RoutesEdge,
  id: string,
  requireNode: (id: unknown, where: string) => GraphNode,
  requireVertex: (id: unknown, where: string) => void,
  gates: ReadonlyMap<NodeId, RouteGate>,
): void {
  const refuse = (why: string): never => {
    throw new ValidationError(`runGraph: ${id} ${why}`)
  }
  const to = edge.to as unknown
  if (typeof to === 'string') requireVertex(to, id)
  else if (!Array.isArray(to)) {
    const target = to as { stop?: unknown; finish?: unknown } | null
    const reason = target?.stop ?? target?.finish
    if (
      target === null ||
      typeof target !== 'object' ||
      (target.stop === undefined) === (target.finish === undefined) ||
      typeof reason !== 'string' ||
      reason.length === 0
    ) {
      refuse(
        'needs to as a node id, a list of node ids, { stop: <reason> } or { finish: <reason> }',
      )
    }
  }
  if (
    edge.maxTraversals !== undefined &&
    !(Number.isSafeInteger(edge.maxTraversals) && edge.maxTraversals >= 1)
  ) {
    refuse('needs maxTraversals as a positive integer')
  }
  if (edge.continuity !== undefined) {
    if (edge.continuity !== 'fresh' && edge.continuity !== 'resume') {
      refuse(
        `has invalid continuity ${JSON.stringify(edge.continuity)} — a routes edge's continuity ` +
          "is 'fresh' or 'resume'",
      )
    }
    if (routeTargets(edge.to).length === 0) {
      refuse('carries continuity, but a stop or finish starts no node')
    }
    if (typeof to === 'string' && gates.has(to))
      refuse('carries continuity, but a gate is no agent')
  }
  const evidence = edge.evidence ?? []
  if (!Array.isArray(evidence)) refuse('needs evidence as an array of node ids')
  for (const node of evidence) requireNode(node, `${id} evidence`)
  if (edge.when === undefined) return
  const when = edge.when as RouteWhen
  const matches: ReadonlyArray<RouteMatch> = 'all' in when ? when.all : [when]
  if (!Array.isArray(matches) || matches.length === 0) refuse('has an empty when.all')
  for (const match of matches) {
    if (typeof match !== 'object' || match === null) refuse('has a when that is not a match')
    if (!isPointer(match.pointer)) {
      refuse(
        `has pointer ${JSON.stringify(match.pointer)} — a JSON pointer is '' or starts with '/'`,
      )
    }
    const tests = ['equals', 'in', 'exists'].filter((key) => key in match)
    if (tests.length !== 1) refuse('needs exactly one of equals, in or exists in each match')
    if ('equals' in match && !isScalar(match.equals)) refuse('compares equals with a non-scalar')
    if ('in' in match && (!Array.isArray(match.in) || !match.in.every(isScalar))) {
      refuse('needs in as an array of JSON scalars')
    }
    if ('exists' in match && typeof match.exists !== 'boolean') refuse('needs exists as a boolean')
    if (match.node !== undefined) {
      requireNode(match.node, `${id} when.node`)
      if (match.node !== edge.from && !evidence.includes(match.node as NodeId)) {
        refuse(
          `reads when.node '${match.node}', which is not in its evidence — a match reads the ` +
            "edge's source or a node it lists as evidence",
        )
      }
    }
  }
}

/** Refuse a routes cycle, self-loops included, that crosses no edge setting `maxTraversals`:
 *  the default cap would still end it, but only after 32 laps nobody chose. A cap on one edge of a
 *  strongly connected component does not bound a subcycle that avoids it, so the check removes
 *  every capped edge and refuses any cycle left in what remains. */
function refuseUncappedRouteCycles(
  routes: ReadonlyArray<RoutesEdge>,
  idOf: ReadonlyMap<RoutesEdge, string>,
): void {
  // Every uncapped (edge, source, target) hop; a fork or join is one hop per member pair.
  const hops = routes
    .filter((edge) => edge.maxTraversals === undefined)
    .flatMap((edge) =>
      routeSources(edge.from).flatMap((from) =>
        routeTargets(edge.to).map((to) => ({ edge, from, to })),
      ),
    )
  const next = new Map<NodeId, NodeId[]>()
  for (const hop of hops) next.set(hop.from, [...(next.get(hop.from) ?? []), hop.to])
  // Tarjan's strongly connected components.
  const index = new Map<NodeId, number>()
  const low = new Map<NodeId, number>()
  const stack: NodeId[] = []
  const onStack = new Set<NodeId>()
  const components: Array<Set<NodeId>> = []
  let counter = 0
  const visit = (id: NodeId): void => {
    index.set(id, counter)
    low.set(id, counter)
    counter += 1
    stack.push(id)
    onStack.add(id)
    for (const to of next.get(id) ?? []) {
      if (!index.has(to)) {
        visit(to)
        low.set(id, Math.min(low.get(id) as number, low.get(to) as number))
      } else if (onStack.has(to)) {
        low.set(id, Math.min(low.get(id) as number, index.get(to) as number))
      }
    }
    if (low.get(id) !== index.get(id)) return
    const component = new Set<NodeId>()
    for (;;) {
      const member = stack.pop() as NodeId
      onStack.delete(member)
      component.add(member)
      if (member === id) break
    }
    components.push(component)
  }
  for (const id of next.keys()) if (!index.has(id)) visit(id)
  for (const component of components) {
    const inside = [
      ...new Set(
        hops
          .filter((hop) => component.has(hop.from) && component.has(hop.to))
          .map((hop) => hop.edge),
      ),
    ]
    if (inside.length === 0) continue
    throw new ValidationError(
      `runGraph: routes cycle through ${[...component].join(', ')} (${inside
        .map((edge) => idOf.get(edge))
        .join(', ')}) sets no maxTraversals — a repair loop states its own bound; set ` +
        `maxTraversals on one of these edges (the default cap is ${defaultEdgeTraversalCap})`,
    )
  }
}

/** The flow in coordination form: plain data the root manager's route routing runs. */
export function routeFlowOf(validated: ValidatedGraph): RouteFlow {
  const flow = validated.flow as ValidatedFlow
  const profileOf = (id: NodeId): AgentProfile => (flow.nodes.get(id) as GraphNode).profile
  return {
    entries: flow.entries.map((item) => ({ ...item, profile: profileOf(item.node) })),
    routes: [...flow.routes].map(([edge, route]) => ({
      edge,
      from: routeSources(route.from),
      to:
        typeof route.to === 'string' && flow.gates.has(route.to)
          ? { gate: route.to }
          : typeof route.to === 'string' || Array.isArray(route.to)
            ? { nodes: routeTargets(route.to).map((node) => ({ node, profile: profileOf(node) })) }
            : (route.to as { readonly stop: string } | { readonly finish: string }),
      ...(route.when === undefined ? {} : { when: route.when }),
      evidence: route.evidence ?? [],
      maxTraversals: route.maxTraversals ?? defaultEdgeTraversalCap,
      continuity: route.continuity ?? 'fresh',
    })),
    nodes: flow.routed,
    terminals: [...flow.terminals],
    ...(flow.gates.size === 0 ? {} : { gates: [...flow.gates.values()] }),
  }
}

/** The ledger row of one flow traversal or gate decision. */
export function routeLedgerEntry(
  step: Extract<RouteFlowEvent, { kind: 'traversal' }>,
  edge: RoutesEdge | undefined,
  registry: PromptRegistry,
): Omit<EdgeTraversal, 'traversal'> {
  const source = step.workerId ?? step.sourceWorker
  const gate = step.gate
  return {
    edge: step.edge,
    kind: 'routes',
    from: step.from,
    to: step.to,
    // An entry row and a gate decision have no routes edge, so they cross no directive.
    directive: edge === undefined ? '' : formatPromptHandle(edge.directive),
    outcome: step.outcome,
    continuity: step.continuity,
    bytes:
      step.bytes +
      (edge !== undefined && step.workerId !== undefined
        ? Buffer.byteLength(registry.resolve(edge.directive).text, 'utf8')
        : 0),
    ...(step.reason !== undefined ? { reason: step.reason } : {}),
    ...(source !== undefined ? { workerId: source } : {}),
    ...(gate === undefined
      ? {}
      : {
          gate:
            'choice' in gate
              ? { by: gate.by, choice: gate.choice }
              : { by: gate.by, stop: gate.stop },
        }),
  }
}

/**
 * The caller's `decideGate` behind the run journal. A decision the journal already holds for this
 * gate visit is replayed without asking the caller, and marked so its ledger row is not journaled
 * a second time. A visit with no journaled decision is asked again, under the same visit number.
 */
export function journaledGateDecider(
  decideGate: NonNullable<RunGraphOptions['decideGate']>,
  journal: SpawnJournal,
  runId: string,
): DecideGate {
  return async (request) => {
    for (const event of (await journal.loadTree(runId)) ?? []) {
      // The run's own graph journals without `graph`; a gate decision's row leaves the gate.
      if (event.kind !== 'edge' || event.graph !== undefined || event.gate === undefined) continue
      if (event.edge.from !== request.gate || event.traversal !== request.visit) continue
      const { by } = event.gate
      return 'choice' in event.gate
        ? { kind: 'choose', choice: event.gate.choice, by, replayed: true }
        : { kind: 'stop', reason: event.gate.stop, by, replayed: true }
    }
    return decideGate(request)
  }
}

/** A subtask's flow: inside a maps item, every `{ item: true }` entry task becomes the item. */
export function flowOfSubtask(
  flow: RouteFlow,
  mapItem: { readonly item: unknown } | undefined,
): RouteFlow {
  if (mapItem === undefined) return flow
  return {
    ...flow,
    entries: flow.entries.map((entry) =>
      isRecord(entry.task) && Object.keys(entry.task).length === 1 && entry.task.item === true
        ? { ...entry, task: mapItem.item }
        : entry,
    ),
  }
}

/** How a flow ended, read from its `route` events. */
type FlowConclusion =
  | {
      readonly kind: 'result'
      readonly result: SupervisedResult<unknown>
      readonly stopped?: NonNullable<GraphResult['stopped']>
    }
  | {
      readonly kind: 'unrouted'
      readonly unrouted: Extract<
        Extract<CoordinationEvent, { type: 'route' }>['route'],
        { kind: 'unrouted' }
      >
    }

/**
 * One flow run's outcome. `observe` reads the flow's `route` events as the manager publishes them;
 * `finalizer` replaces `bestDelivered` for a flow: the output is `{ [node]: latest usable result }`
 * over the terminal nodes and `finish` sources that settled, and the graph's deliverable decides
 * between a winner and `no-result-selected`. `conclude` names a stopped flow on its result;
 * `failure` says why a flow run as a subtask ended without one.
 */
export function createFlowRun(nodeOfWorker: (workerId: string) => NodeId | undefined) {
  const outputs = new Map<NodeId, unknown>()
  let settled: Readonly<Record<string, unknown>> = {}
  let stopped: NonNullable<GraphResult['stopped']> | undefined
  let unrouted: Extract<FlowConclusion, { kind: 'unrouted' }>['unrouted'] | undefined
  const observe = (event: CoordinationEvent): void => {
    if (event.type !== 'route') return
    const step = event.route
    if (step.kind === 'output') outputs.set(step.node, step.result)
    else if (step.kind === 'stopped') {
      const { kind: _kind, ...detail } = step
      stopped ??= detail
    } else if (step.kind === 'unrouted') unrouted ??= step
  }
  const finalizer: SupervisorFinalizer = ({ delivered }) => {
    settled = Object.fromEntries(
      delivered.flatMap((worker) => {
        // The overlay's ledger names every worker's node: routes, delegates, map items and joins.
        const node = nodeOfWorker(worker.id)
        return node === undefined || !('out' in worker) ? [] : [[node, worker.out]]
      }),
    )
    return stopped !== undefined || unrouted !== undefined || outputs.size === 0
      ? undefined
      : Object.fromEntries(outputs)
  }
  const conclude = (result: SupervisedResult<unknown>): FlowConclusion => {
    if (unrouted !== undefined) return { kind: 'unrouted', unrouted }
    if (stopped === undefined) return { kind: 'result', result }
    // A stop edge names its own reason; a down settle is `all-children-down`. A caller's abort, an
    // exhausted pool, a deadline or a cancellation stays the reason it already is.
    if (
      result.kind !== 'no-winner' ||
      !['no-result-selected', 'all-children-down', 'no-children-spawned'].includes(result.reason)
    )
      return { kind: 'result', result, stopped }

    return {
      kind: 'result',
      result: {
        ...result,
        reason:
          stopped.code === 'budget-exhausted'
            ? 'budget-exhausted'
            : result.reason === 'no-children-spawned'
              ? result.reason
              : stopped.edge === undefined
                ? 'all-children-down'
                : 'stopped',
      },
      stopped,
    }
  }
  const failure = (): string | undefined =>
    unrouted !== undefined
      ? `${unrouted.reason} at '${unrouted.node}': ${unrouted.detail}`
      : stopped !== undefined
        ? `stopped at '${stopped.at}': ${stopped.reason}`
        : undefined
  /**
   * A stored route check may name any flow node: its conditions read each delivered node's latest
   * usable output under the terminal outputs, while the run's deliverable stays terminal-only.
   * Run 6f167e9e checked fetch-pr's merge_sha, false while only terminal outputs were in view.
   */
  const routeCheck = (d: AgentGraph['deliverable']): AgentGraph['deliverable'] =>
    d.checkRef !== 'route'
      ? d
      : {
          ...d,
          check: (out, context) =>
            d.check(context === undefined && isRecord(out) ? { ...settled, ...out } : out, context),
        }
  return { observe, finalizer, conclude, failure, routeCheck }
}
