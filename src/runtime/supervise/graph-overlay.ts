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
 * (`authorizeSpawn`, `resolveSpawnProfile`, `analyzeOnSettle`, `mapOnSettle`,
 * `continuityByProfile`) and observes what the kernel reports back (spawn bindings, steers,
 * findings, map steps).
 */

import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import type { AnalyzeOnSettleRoute } from '../../mcp/tools/coordination-analysts'
import type { CoordinationEvent } from '../../mcp/tools/coordination-events'
import { safeJsonText as stringifyPayload } from '../../mcp/tools/coordination-json'
import type { MapOnSettleRoute } from '../../mcp/tools/coordination-map-contracts'
import type { AuthorizedDownMessage, ContinuityMode } from '../../mcp/tools/coordination-messages'
import type { EdgeDeliveryOutcome, EdgeTraversal, GraphNode, TraversalContinuity } from './graph'
import { GraphEdgeLedger } from './graph-edge-ledger'
import { routeLedgerEntry } from './graph-flow'
import {
  type AnalyzesEdge,
  type DelegatesEdge,
  defaultEdgeTraversalCap,
  edgeId,
  graphSubtaskOf,
  parseGraphSubtaskTopology,
  type ValidatedGraph,
} from './graph-topology'
import { formatPromptHandle, type PromptRegistry } from './prompt-registry'
import { runtimeGraphMetadataKey } from './provider-visible-profile'
import type { SuperviseOptions } from './supervise'
import type { NodeId, SpawnJournal } from './types'

type SpawnAuthorization = NonNullable<SuperviseOptions['authorizeSpawn']>
type SpawnAuthorizationInput = Parameters<SpawnAuthorization>[0]

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

/** Each graph's pinning, mapped to the product authority it wraps. */
const productAuthorities = new WeakMap<SpawnAuthorization, SpawnAuthorization | undefined>()

/**
 * The product authority behind a spawn authority. A graph started inside a graph run composes
 * with the authority the outer pinning wraps: the outer pinning itself would refuse every node of
 * the inner graph.
 */
export function productSpawnAuthority(
  authorize: SpawnAuthorization | undefined,
): SpawnAuthorization | undefined {
  return authorize !== undefined && productAuthorities.has(authorize)
    ? productAuthorities.get(authorize)
    : authorize
}

/** A node profile with an edge directive appended to its standing instructions. */
function withDirective(profile: AgentProfile, directiveText: string): AgentProfile {
  if (directiveText.length === 0) return profile
  return {
    ...profile,
    prompt: {
      ...(profile.prompt ?? {}),
      instructions: [
        ...((profile.prompt?.instructions as readonly string[] | undefined) ?? []),
        directiveText,
      ],
    },
  }
}

interface GraphOverlayOptions {
  readonly registry: PromptRegistry
  readonly journal: SpawnJournal
  /** The journal tree the edge events are appended to: the run's root tree. */
  readonly runId: string
  readonly now: () => number
  /** Standing guidance composed into each pinned node profile (`profileGuidance`). */
  readonly guidance?: (profile: AgentProfile) => AgentProfile
  /** Product spawn authority; runs AFTER pinning, so it judges the profile that will run. */
  readonly authorizeSpawn?: SpawnAuthorization
  /** Set for a graph a manager started with `run_graph`: one journal can then hold several
   *  ledgers, so every edge event names the node that drives this graph (`graph`). */
  readonly subtask?: boolean
}

/** The ledger once the graph's manager settled. */
export interface GraphLedgerSettlement {
  readonly ledger: ReadonlyArray<EdgeTraversal>
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included. */
  readonly exhaustedEdges: ReadonlyArray<string>
  /** The delegates subset of `exhaustedEdges`: the only caps that refused work. */
  readonly exhaustedDelegates: ReadonlyArray<string>
}

/** What a manager's construction composes to run one graph. */
export interface GraphOverlay {
  readonly routes: ReadonlyArray<string | AnalyzeOnSettleRoute>
  readonly maps: ReadonlyArray<MapOnSettleRoute>
  /** Delegates-edge continuity defaults by node id (= profile name). */
  readonly continuityByProfile: Readonly<Record<string, ContinuityMode>>
  /** Node pinning: canonical profile plus edge directive, then the product's authority. Throws for a name that is not a worker node. */
  readonly authorizeSpawn: SpawnAuthorization
  /** Pure pre-journal resolution for the spawn pre-flight (no ledger row). */
  readonly resolveSpawnProfile: (profile: AgentProfile) => AgentProfile
  /** Wrap a message authority so a narrowed instruction ledgers its steer `stripped`. */
  observeMessages<I extends { readonly instruction: string }>(
    authorize: (input: I) => AuthorizedDownMessage,
  ): (input: I) => AuthorizedDownMessage
  /** Ledger the steers, findings and map steps a manager of this graph publishes. */
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

interface OverlayContext {
  readonly validated: ValidatedGraph
  readonly registry: PromptRegistry
  readonly ledger: GraphEdgeLedger
  readonly mapsById: ReadonlyMap<string, ValidatedGraph['maps'][number]>
  /** Analyzes edges whose findings route to a node other than the driver, by analyst. */
  readonly routedAnalyzesByAnalyst: ReadonlyMap<string, AnalyzesEdge>
  /** Analyzes edges whose findings reach the driver, by analyst. */
  readonly driverAnalyzesByAnalyst: ReadonlyMap<string, AnalyzesEdge>
  /** Steers whose authorization narrowed the composed instruction, by delivered digest. */
  readonly strippedByDigest: Map<string, { composedBytes: number }>
}

/**
 * Build the graph layer for one validated graph: each delegates directive is appended to the
 * worker's `prompt.instructions` per traversal, each analyzes edge becomes an analyst-on-settle
 * route with a real DESTINATION, and every traversal is ledgered and journaled.
 */
export function createGraphOverlay(
  validated: ValidatedGraph,
  opts: GraphOverlayOptions,
): GraphOverlay {
  const { registry } = opts
  const ledger = new GraphEdgeLedger(opts.journal, opts.runId, opts.now)
  const routedAnalyzesByAnalyst = new Map<string, AnalyzesEdge>()
  const driverAnalyzesByAnalyst = new Map<string, AnalyzesEdge>()
  for (const edge of validated.analyzes) {
    ;(edge.to === validated.root?.id ? driverAnalyzesByAnalyst : routedAnalyzesByAnalyst).set(
      edge.analyst,
      edge,
    )
  }
  const ctx: OverlayContext = {
    validated,
    registry,
    ledger,
    mapsById: new Map(validated.maps.map((edge) => [edgeId(edge), edge])),
    routedAnalyzesByAnalyst,
    driverAnalyzesByAnalyst,
    strippedByDigest: new Map(),
  }

  const composeGuidance = (profile: AgentProfile): AgentProfile =>
    opts.guidance ? opts.guidance(profile) : profile
  // The pre-journal gate (a bridge's route/admission check) must judge the profile that will run,
  // not the `{ name }` stub, or every graph spawn over a bridge is refused `model-route`. PURE: the
  // gate may refuse and nothing may be journaled for a refusal.
  const resolveSpawnProfile = (authored: AgentProfile): AgentProfile => {
    const requested = typeof authored.name === 'string' ? authored.name : undefined
    const node =
      requested === undefined
        ? undefined
        : (validated.workers.get(requested) ??
          validated.analystNodes.get(requested) ??
          validated.mapNodes.get(requested) ??
          validated.flow?.nodes.get(requested))
    // Unknown names fall through: authorizeSpawn refuses them with the full message and a ledger row.
    return node ? composeGuidance(node.profile) : authored
  }
  // Graph authority first, then the caller's, which sees the CANONICAL node profile.
  const authorizeSpawn: SpawnAuthorization = (input) => {
    if (opts.subtask === true) ledger.graphNodeId ??= input.parentNodeId
    const pinned = composeGuidance(pinNode(ctx, input))
    if (!opts.authorizeSpawn) return { profile: pinned }
    return opts.authorizeSpawn({ ...input, profile: pinned })
  }
  productAuthorities.set(authorizeSpawn, opts.authorizeSpawn)

  return {
    routes: analystRoutes(validated, registry),
    maps: mapRoutes(validated),
    continuityByProfile: continuityDefaults(validated),
    authorizeSpawn,
    resolveSpawnProfile,
    // When the caller's authorizeMessage NARROWS an instruction the steer is `stripped` (the VB
    // incident: authored steering silently replaced by boilerplate).
    observeMessages: (authorize) => (input) => {
      const decision = authorize(input)
      if (decision.instruction !== input.instruction) {
        ctx.strippedByDigest.set(canonicalCandidateDigest(decision.instruction), {
          composedBytes: byteLength(input.instruction),
        })
      }
      return decision
    },
    onCoordinationEvent: (event) => ledgerCoordinationEvent(ctx, event),
    bindSpawn: ledger.bindSpawn,
    settle: ledger.settle,
  }
}

// Pinning lives in spawn authorization, which the kernel runs BEFORE it decides whether a child
// is a leaf or a nested supervisor: the kernel reads the PINNED profile, not the `{ name }` stub.
function pinNode(ctx: OverlayContext, input: SpawnAuthorizationInput): AgentProfile {
  const requested =
    typeof (input.profile as { name?: unknown } | undefined)?.name === 'string'
      ? (input.profile as { name: string }).name
      : undefined
  // An analyst-AGENT run: the coordination settle hook (marker authored by the runtime, never
  // model arguments) spawns the analyst NODE. The directive travels as the TASK, so nothing is
  // appended to the profile; its traversal is ledgered on the finding/steer it produces.
  if (input.analyst !== undefined) {
    const { analystNodes } = ctx.validated
    const analystNode = analystNodes.get(input.analyst)
    if (!analystNode || requested !== analystNode.id) {
      throw new ValidationError(
        `runGraph: analyst run for ${JSON.stringify(input.analyst)} does not name an ` +
          `analyst node of this graph (analyst nodes: ${[...analystNodes.keys()].join(', ') || 'none'})`,
      )
    }
    return analystNode.profile
  }
  // A map's item or join (runtime-authored marker) spawns the node its maps edge names; the
  // item's content is only the task. Its traversal is ledgered from the map events.
  if (input.map !== undefined) return pinMapSpawn(ctx, input, requested)
  if (input.route !== undefined) return pinRouteSpawn(ctx, input, requested)
  if (input.profile.metadata?.[runtimeGraphMetadataKey] !== undefined) {
    throw new ValidationError(
      'runGraph: a node of a graph cannot start another graph — run_graph inside a graph is ' +
        'refused; add the work as nodes of this graph instead',
    )
  }
  return pinDelegatesSpawn(ctx, input, requested)
}

/** A driver spawn of a worker node: charge its delegates edge and append the edge directive. */
function pinDelegatesSpawn(
  { validated, registry, ledger }: OverlayContext,
  input: SpawnAuthorizationInput,
  requested: string | undefined,
): AgentProfile {
  const node = requested !== undefined ? validated.workers.get(requested) : undefined
  if (!node) {
    throw new ValidationError(
      `runGraph: spawn_worker named profile ${JSON.stringify(requested)} which is not a worker ` +
        `node of this graph (nodes: ${[...validated.workers.keys()].join(', ')}). Spawn by node id: ` +
        'profile.name selects the node; the node profile itself is pinned by the graph.',
    )
  }
  const edge = validated.delegatesByWorker.get(node.id) as DelegatesEdge
  const id = edgeId(edge)
  const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
  // The EFFECTIVE spawn mode (per-call override, else the edge default, else fresh): the ledger
  // states how each hop continued, not how it was configured to.
  const spawnContinuity: TraversalContinuity = input.continuity ?? 'fresh'
  if (ledger.capUsed(id) >= cap) {
    ledger.exhausted.add(id)
    ledger.exhaustedDelegates.add(id)
    ledger.record(
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
  const row = ledger.record(
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
  ledger.holdPendingSpawn(input.parentNodeId, input.assignmentId, row)
  // The directive is a STANDING instruction: the worker runs under node profile + edge directive;
  // the driver-authored profile contributes ONLY the node selection.
  return withDirective(node.profile, directiveText)
}

function pinMapSpawn(
  { validated, registry, mapsById }: OverlayContext,
  input: SpawnAuthorizationInput,
  requested: string | undefined,
): AgentProfile {
  const marker = input.map as NonNullable<SpawnAuthorizationInput['map']>
  const edge = mapsById.get(marker.edge)
  const refuse = (why: string): never => {
    throw new ValidationError(`runGraph: map spawn for ${JSON.stringify(marker.edge)} ${why}`)
  }
  if (edge === undefined) return refuse('names no maps edge of this graph')
  if (marker.role === 'join') {
    if (requested !== edge.join) refuse(`names ${JSON.stringify(requested)}, not its join`)
    return (validated.mapNodes.get(edge.join) as GraphNode).profile
  }
  if (edge.to !== undefined) {
    if (requested !== edge.to) refuse(`names ${JSON.stringify(requested)}, not its item node`)
    const node = validated.mapNodes.get(edge.to) as GraphNode
    return withDirective(node.profile, registry.resolve(edge.directive).text)
  }
  // A graph item runs the root profile `run_graph` prepared from this edge's topology. Admit it
  // only when it carries exactly that topology.
  const carried = graphSubtaskOf(input.profile)
  if (
    carried === undefined ||
    canonicalCandidateDigest(carried) !==
      canonicalCandidateDigest(parseGraphSubtaskTopology(edge.graph))
  ) {
    refuse("carries a graph other than its maps edge's")
  }
  return input.profile
}

// A flow's entry or route spawn (runtime-authored marker) spawns the node its edge names with the
// edge directive appended; its traversal is ledgered from the route events.
function pinRouteSpawn(
  { validated: { flow }, registry }: OverlayContext,
  input: SpawnAuthorizationInput,
  requested: string | undefined,
): AgentProfile {
  const marker = input.route as NonNullable<SpawnAuthorizationInput['route']>
  const node = requested === undefined ? undefined : flow?.nodes.get(requested)
  const edge = flow?.routes.get(marker.edge)
  const starts = flow?.starts.get(marker.edge)?.has(requested as NodeId) === true
  if (node === undefined || marker.node !== requested || !starts) {
    throw new ValidationError(
      `runGraph: route spawn for ${JSON.stringify(marker.edge)} names ` +
        `${JSON.stringify(requested)}, which is not the node that edge starts`,
    )
  }
  return edge === undefined
    ? node.profile
    : withDirective(node.profile, registry.resolve(edge.directive).text)
}

// A LENS edge's directive wraps the findings for the recipient (a driver-destined lens route
// carries none; it becomes the driver brief). A NODE edge's directive is the analyst AGENT's
// task, so it always rides the route.
function analystRoutes(
  { analyzes, analystNodes, root }: ValidatedGraph,
  registry: PromptRegistry,
): Array<string | AnalyzeOnSettleRoute> {
  return analyzes.map((edge) => {
    const analystNode = analystNodes.get(edge.analyst)
    if (analystNode) {
      return {
        kind: edge.analyst,
        over: edge.over,
        agent: analystNode.profile,
        directive: registry.resolve(edge.directive).text,
        ...(edge.to === root?.id ? {} : { to: edge.to }),
      }
    }
    return edge.to === root?.id
      ? { kind: edge.analyst, over: edge.over }
      : {
          kind: edge.analyst,
          over: edge.over,
          to: edge.to,
          directive: registry.resolve(edge.directive).text,
        }
  })
}

function mapRoutes({ maps, mapNodes }: ValidatedGraph): MapOnSettleRoute[] {
  return maps.map((edge) => ({
    edge: edgeId(edge),
    from: edge.from,
    pointer: edge.pointer,
    item:
      edge.to !== undefined
        ? { profile: (mapNodes.get(edge.to) as GraphNode).profile }
        : { graph: edge.graph },
    join: (mapNodes.get(edge.join) as GraphNode).profile,
    maxItems: edge.maxItems,
    concurrency: edge.concurrency,
    onItemFailure: edge.onItemFailure,
    ...(edge.itemBudget !== undefined ? { itemBudget: edge.itemBudget } : {}),
  }))
}

function continuityDefaults({ delegatesByWorker }: ValidatedGraph): Record<string, ContinuityMode> {
  const continuityByProfile: Record<string, ContinuityMode> = {}
  for (const [nodeId, edge] of delegatesByWorker) {
    if (edge.continuity !== undefined) continuityByProfile[nodeId] = edge.continuity
  }
  return continuityByProfile
}

function ledgerCoordinationEvent(ctx: OverlayContext, event: CoordinationEvent): void {
  if (event.type === 'route') ledgerRouteStep(ctx, event.route)
  else if (event.type === 'map') ledgerMapStep(ctx, event.map)
  else if (event.type === 'finding') ledgerFinding(ctx, event.finding)
  else if (event.type === 'steer') ledgerSteer(ctx, event)
}

function ledgerRouteStep(
  { ledger, validated, registry }: OverlayContext,
  step: Extract<CoordinationEvent, { type: 'route' }>['route'],
): void {
  if (step.kind !== 'traversal') return
  if (step.workerId !== undefined) ledger.nodeByWorkerId.set(step.workerId, step.to)
  if (step.reason?.startsWith('traversal-cap-exhausted') === true) ledger.exhausted.add(step.edge)
  // A replayed gate decision is already journaled: its row rides the result, not the journal.
  const entry = routeLedgerEntry(step, validated.flow?.routes.get(step.edge), registry)
  ledger.record(entry, step.gate?.replayed !== true)
}

function ledgerMapStep(
  { ledger, validated, registry, mapsById }: OverlayContext,
  step: Extract<CoordinationEvent, { type: 'map' }>['map'],
): void {
  const edge = mapsById.get(step.edge)
  if (!edge) return
  const itemName = validated.mapItemNames.get(step.edge) as NodeId
  if (step.workerId !== undefined) {
    ledger.nodeByWorkerId.set(step.workerId, step.phase === 'join' ? edge.join : itemName)
  }
  // An item that reached a node received the edge directive beside its element.
  const directiveBytes =
    step.phase === 'item' && step.workerId !== undefined && edge.to !== undefined
      ? byteLength(registry.resolve(edge.directive).text)
      : 0
  ledger.record(
    {
      edge: step.edge,
      kind: 'maps',
      from: step.phase === 'join' ? itemName : edge.from,
      to: step.phase === 'join' ? edge.join : itemName,
      directive: formatPromptHandle(edge.directive),
      outcome: step.outcome,
      // Every map spawn is a new session over its own element or the joined results.
      continuity: 'fresh',
      bytes: step.bytes + directiveBytes,
      ...(step.reason !== undefined ? { reason: step.reason } : {}),
      workerId: step.phase === 'expand' ? step.sourceWorker : step.workerId,
      map: { phase: step.phase, ...(step.index !== undefined ? { index: step.index } : {}) },
    },
    true,
  )
}

// A routed edge's traversal is ledgered on its STEER (the delivery); the finding event is
// its audit copy. A driver-destined edge's traversal IS the finding reaching the bus.
function ledgerFinding(
  ctx: OverlayContext,
  finding: Extract<CoordinationEvent, { type: 'finding' }>['finding'],
): void {
  const edge = ctx.driverAnalyzesByAnalyst.get(finding.analyst)
  if (!edge) return
  const sourceNode = ctx.ledger.nodeByWorkerId.get(finding.fromWorker)
  if (sourceNode === undefined || !edge.over.includes(sourceNode)) return
  // Absent findings (key omitted so the event stays digestable) contribute ZERO bytes.
  const findingsText = finding.findings === undefined ? '' : stringifyPayload(finding.findings)
  const directiveBytes = byteLength(ctx.registry.resolve(edge.directive).text)
  const empty = findingsText.length === 0
  ledgerAnalyzes(
    ctx.ledger,
    edge,
    empty ? 'empty' : 'delivered',
    directiveBytes + byteLength(findingsText),
    empty ? 'analyst returned no findings' : undefined,
    finding.fromWorker,
  )
}

function ledgerSteer(ctx: OverlayContext, event: Extract<CoordinationEvent, { type: 'steer' }>) {
  const { ledger } = ctx
  const down = event.down
  if (event.analyst !== undefined) {
    const edge = ctx.routedAnalyzesByAnalyst.get(event.analyst)
    if (!edge) return
    ledgerAnalyzes(
      ledger,
      edge,
      down.delivered ? 'delivered' : 'unpropagated',
      byteLength(down.instruction),
      down.delivered ? undefined : down.outcome,
      down.toWorker,
    )
    return
  }
  // A driver steer to a live worker node is a delegates traversal too: the edge's mid-run leg.
  const nodeId = ledger.nodeByWorkerId.get(down.toWorker)
  if (nodeId === undefined) return
  const edge = ctx.validated.delegatesByWorker.get(nodeId)
  if (!edge) return
  const stripped = ctx.strippedByDigest.get(down.instructionDigest)
  ledger.record(
    {
      edge: edgeId(edge),
      kind: 'delegates',
      from: edge.from,
      to: edge.to,
      directive: formatPromptHandle(edge.directive),
      outcome: !down.delivered ? 'unpropagated' : stripped ? 'stripped' : 'delivered',
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

function ledgerAnalyzes(
  ledger: GraphEdgeLedger,
  edge: AnalyzesEdge,
  outcome: EdgeDeliveryOutcome,
  bytes: number,
  reason: string | undefined,
  workerId: string | undefined,
): void {
  const id = edgeId(edge)
  const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
  const capped = ledger.capUsed(id) >= cap
  if (capped) ledger.exhausted.add(id)
  ledger.record(
    {
      edge: id,
      kind: 'analyzes',
      from: edge.over.join('+'),
      to: edge.to,
      directive: formatPromptHandle(edge.directive),
      outcome: capped ? 'unpropagated' : outcome,
      // Always a mid-run delivery into an already-live recipient, never a spawn.
      continuity: 'steer',
      bytes,
      ...(capped
        ? { reason: `traversal-cap-exhausted (max ${cap})` }
        : reason !== undefined
          ? { reason }
          : {}),
      ...(workerId !== undefined ? { workerId } : {}),
    },
    true,
  )
}
