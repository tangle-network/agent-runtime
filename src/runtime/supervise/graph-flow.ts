/**
 * Flow graphs: an `AgentGraph` with `entry`. Runtime spawns the entries and traverses `routes`
 * edges itself, so a fixed pipeline, a conditional branch, a bounded repair loop and a stop rule
 * run from graph data with no model root and no caller brain.
 *
 * This module owns what a flow adds to `runGraph`: every refusal a flow earns before compute, the
 * coordination form of the flow (`RouteFlow`, which the manager's route routing runs), the
 * runtime-owned root that hosts it, and the graph-owned finalizer that turns the flow's outputs
 * into the run's result. `runGraph` stays the one team executor; `supervise()` stays its substrate.
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalystRegistry } from '../../mcp/tools/coordination-analysts'
import type { CoordinationEvent } from '../../mcp/tools/coordination-events'
import type {
  JsonScalar,
  RouteFlow,
  RouteMatch,
  RouteWhen,
} from '../../mcp/tools/coordination-route-contracts'
import type { SupervisorFinalizer } from './finalizer'
import type { AgentGraph, GraphEdge, GraphNode, GraphResult } from './graph'
import {
  defaultEdgeTraversalCap,
  edgeId,
  type ValidatedGraph,
  validateGraphNodes,
  validateMaps,
} from './graph-overlay'
import type { PromptRegistry } from './prompt-registry'
import { coordinationProfileToolPrefix } from './provider-visible-profile'
import type { NodeId, SupervisedResult } from './types'

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
  /** Nodes Runtime spawns through an entry or a routes edge. */
  readonly nodes: ReadonlyMap<NodeId, GraphNode>
  /** Nodes whose settles the flow routes: `nodes` and every map join. */
  readonly routed: ReadonlyArray<NodeId>
  /** Routed nodes with no outgoing routes edge and no outgoing maps edge. */
  readonly terminals: ReadonlySet<NodeId>
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
  model: { provider: 'runtime', default: 'runtime/flow' },
  tools: { [`${coordinationProfileToolPrefix}spawn_worker`]: true },
}) as AgentProfile

const routeTargetName = (to: RoutesEdge['to']): string =>
  typeof to === 'string' ? to : 'stop' in to ? `stop:${to.stop}` : `finish:${to.finish}`

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
  graph: AgentGraph,
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

  // Edge ids: the ordinal among the routes edges leaving the same node, 1-based.
  const routesById = new Map<string, RoutesEdge>()
  const routesFrom = new Map<NodeId, RoutesEdge[]>()
  const idOf = new Map<RoutesEdge, string>()
  for (const edge of routes) {
    requireNode(edge.from, edgeId(edge))
    const leaving = [...(routesFrom.get(edge.from) ?? []), edge]
    routesFrom.set(edge.from, leaving)
    const id = `routes:${edge.from}#${leaving.length}->${routeTargetName(edge.to)}`
    idOf.set(edge, id)
    routesById.set(id, edge)
  }
  for (const edge of routes) validateRoutesEdge(edge, idOf.get(edge) as string, requireNode)
  for (const [from, leaving] of routesFrom) {
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
    if (typeof edge.to === 'string') flowNodes.set(edge.to, byId.get(edge.to) as GraphNode)
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
    if (!flowNodes.has(edge.from) && !joins.has(edge.from)) {
      throw new ValidationError(
        `runGraph: ${idOf.get(edge)} leaves '${edge.from}', a map item: its settle goes to its ` +
          'map, so a route from it could never fire',
      )
    }
  }

  // Every edge Runtime can take, for reachability, cycles and evidence order.
  const next = new Map<NodeId, Set<NodeId>>()
  const link = (from: NodeId, to: NodeId): void => {
    next.set(from, (next.get(from) ?? new Set()).add(to))
  }
  for (const edge of routes) if (typeof edge.to === 'string') link(edge.from, edge.to)
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
  const fromEntry = reachableFrom(entry.map((item) => item.node))
  for (const item of entry) fromEntry.add(item.node)
  for (const node of graph.nodes) {
    if (!fromEntry.has(node.id)) {
      throw new ValidationError(
        `runGraph: node '${node.id}' is unreachable from entry — no entry, routes edge or maps ` +
          'edge ever starts it',
      )
    }
  }
  refuseUncappedRouteCycles(routes, idOf)
  // An evidence node must be able to settle before `from` does on some path from entry.
  for (const edge of routes) {
    for (const id of edge.evidence ?? []) {
      if (id === edge.from || reachableFrom([id]).has(edge.from)) continue
      throw new ValidationError(
        `runGraph: ${idOf.get(edge)} lists evidence '${id}', which cannot settle before ` +
          `'${edge.from}' on any path from entry — its result could never ride this edge`,
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
  return {
    root: undefined,
    workers: new Map(),
    delegatesByWorker: new Map(),
    analyzes: [],
    analystNodes: new Map(),
    maps,
    mapNodes,
    mapItemNames,
    flow: { entries, routes: routesById, nodes: flowNodes, routed, terminals },
  }
}

function validateRoutesEdge(
  edge: RoutesEdge,
  id: string,
  requireNode: (id: unknown, where: string) => GraphNode,
): void {
  const refuse = (why: string): never => {
    throw new ValidationError(`runGraph: ${id} ${why}`)
  }
  const to = edge.to as unknown
  if (typeof to === 'string') requireNode(to, id)
  else {
    const target = to as { stop?: unknown; finish?: unknown } | null
    const reason = target?.stop ?? target?.finish
    if (
      target === null ||
      typeof target !== 'object' ||
      (target.stop === undefined) === (target.finish === undefined) ||
      typeof reason !== 'string' ||
      reason.length === 0
    ) {
      refuse('needs to as a node id, { stop: <reason> } or { finish: <reason> }')
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
    if (typeof to !== 'string') refuse('carries continuity, but a stop or finish starts no node')
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
      if (match.node !== edge.from && !evidence.includes(match.node)) {
        refuse(
          `reads when.node '${match.node}', which is not in its evidence — a match reads the ` +
            "edge's source or a node it lists as evidence",
        )
      }
    }
  }
}

/** Refuse a routes cycle, self-loops included, in which no edge sets `maxTraversals`: the
 *  default cap would still end it, but only after 32 laps nobody chose. */
function refuseUncappedRouteCycles(
  routes: ReadonlyArray<RoutesEdge>,
  idOf: ReadonlyMap<RoutesEdge, string>,
): void {
  const nodeEdges = routes.filter((edge) => typeof edge.to === 'string')
  const next = new Map<NodeId, NodeId[]>()
  for (const edge of nodeEdges) {
    next.set(edge.from, [...(next.get(edge.from) ?? []), edge.to as NodeId])
  }
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
    const inside = nodeEdges.filter(
      (edge) => component.has(edge.from) && component.has(edge.to as NodeId),
    )
    if (inside.length === 0) continue
    if (inside.some((edge) => edge.maxTraversals !== undefined)) continue
    throw new ValidationError(
      `runGraph: routes cycle through ${[...component].join(', ')} (${inside
        .map((edge) => idOf.get(edge))
        .join(', ')}) sets no maxTraversals — a repair loop states its own bound; set ` +
        `maxTraversals on one of its edges (the default cap is ${defaultEdgeTraversalCap})`,
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
      from: route.from,
      to:
        typeof route.to === 'string' ? { node: route.to, profile: profileOf(route.to) } : route.to,
      ...(route.when === undefined ? {} : { when: route.when }),
      evidence: route.evidence ?? [],
      maxTraversals: route.maxTraversals ?? defaultEdgeTraversalCap,
      continuity: route.continuity ?? 'fresh',
    })),
    nodes: flow.routed,
    terminals: [...flow.terminals],
  }
}

/** How a flow ended, read from its `route` events. */
export type FlowConclusion =
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
 * between a winner and `no-result-selected`. `conclude` names a stopped flow on its result.
 */
export function createFlowRun() {
  const outputs = new Map<NodeId, unknown>()
  let stopped: NonNullable<GraphResult['stopped']> | undefined
  let unrouted: Extract<FlowConclusion, { kind: 'unrouted' }>['unrouted'] | undefined
  const observe = (event: CoordinationEvent): void => {
    if (event.type !== 'route') return
    const step = event.route
    if (step.kind === 'output') outputs.set(step.node, step.result)
    else if (step.kind === 'stopped') {
      stopped ??= {
        ...(step.edge === undefined ? {} : { edge: step.edge }),
        at: step.at,
        workerId: step.workerId,
        reason: step.reason,
      }
    } else if (step.kind === 'unrouted') unrouted ??= step
  }
  const finalizer: SupervisorFinalizer = () =>
    stopped !== undefined || unrouted !== undefined || outputs.size === 0
      ? undefined
      : Object.fromEntries(outputs)
  const conclude = (result: SupervisedResult<unknown>): FlowConclusion => {
    if (unrouted !== undefined) return { kind: 'unrouted', unrouted }
    if (stopped === undefined) return { kind: 'result', result }
    // A stop edge names its own reason; a down settle is `all-children-down`. A caller's abort, an
    // exhausted pool or a cancellation stays the reason it already is.
    const replaceable =
      result.kind === 'no-winner' &&
      (result.reason === 'no-result-selected' ||
        result.reason === 'all-children-down' ||
        result.reason === 'no-children-spawned')
    if (!replaceable) return { kind: 'result', result, stopped }
    return {
      kind: 'result',
      result: {
        ...result,
        reason: stopped.edge === undefined ? 'all-children-down' : 'stopped',
      } as SupervisedResult<unknown>,
      stopped,
    }
  }
  return { observe, finalizer, conclude }
}
