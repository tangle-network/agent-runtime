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

// ── The overlay ────────────────────────────────────────────────────────────────

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

/** Each graph's pinning, mapped to the product authority it wraps. */
const productAuthorities = new WeakMap<SpawnAuthorization, SpawnAuthorization | undefined>()

/**
 * The product authority behind a spawn authority. A graph started inside a run composes its own
 * pinning with the run's product authority. When that run is itself a graph (`runGraph`), the run's
 * `authorizeSpawn` is the outer graph's pinning, which would refuse every node of the inner graph,
 * so the inner graph composes with the authority the outer pinning wraps instead.
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
  /** Map routes, one per maps edge. */
  readonly maps: ReadonlyArray<MapOnSettleRoute>
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

/**
 * Build the graph layer for one validated graph. Each delegates directive is appended to the
 * worker profile's `prompt.instructions` per traversal, each analyzes edge becomes an
 * analyst-on-settle route with a real DESTINATION, and every traversal is ledgered and journaled.
 */
export function createGraphOverlay(
  validated: ValidatedGraph,
  opts: GraphOverlayOptions,
): GraphOverlay {
  const {
    root,
    workers,
    delegatesByWorker,
    analyzes,
    analystNodes,
    maps,
    mapNodes,
    mapItemNames,
    flow,
  } = validated
  const { registry, journal, runId, now } = opts
  const mapsById = new Map(maps.map((edge) => [edgeId(edge), edge]))

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
      edge: {
        kind: entry.kind,
        from: entry.from,
        to: entry.to,
        // An entry row crosses no edge directive.
        ...(entry.directive === '' ? {} : { directive: entry.directive }),
      },
      traversal: entry.traversal,
      outcome: entry.outcome,
      continuity: entry.continuity,
      bytes: entry.bytes,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      ...(entry.map !== undefined ? { map: entry.map } : {}),
      ...(entry.gate !== undefined ? { gate: entry.gate } : {}),
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
    // A map's item or join: the coordination layer's map route — never the driver; the marker is
    // authored by the runtime — spawns the node its maps edge names. The item's content is only the
    // task; what runs is pinned here. Its traversal is ledgered from the map events.
    if (input.map !== undefined) return pinMapSpawn(input, requested)
    if (input.route !== undefined) return pinRouteSpawn(input, requested)
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
    return withDirective(node.profile, directiveText)
  }
  const pinMapSpawn = (
    input: SpawnAuthorizationInput,
    requested: string | undefined,
  ): AgentProfile => {
    const marker = input.map as NonNullable<SpawnAuthorizationInput['map']>
    const edge = mapsById.get(marker.edge)
    const refuse = (why: string): never => {
      throw new ValidationError(`runGraph: map spawn for ${JSON.stringify(marker.edge)} ${why}`)
    }
    if (edge === undefined) return refuse('names no maps edge of this graph')
    if (marker.role === 'join') {
      if (requested !== edge.join) refuse(`names ${JSON.stringify(requested)}, not its join`)
      return (mapNodes.get(edge.join) as GraphNode).profile
    }
    if (edge.to !== undefined) {
      if (requested !== edge.to) refuse(`names ${JSON.stringify(requested)}, not its item node`)
      const node = mapNodes.get(edge.to) as GraphNode
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
  // A flow's entry or route spawn: the flow's route — never a driver; the marker is authored by the
  // runtime — spawns the node its edge names, with the edge directive appended per traversal.
  // Its traversal is ledgered from the route events.
  const pinRouteSpawn = (
    input: SpawnAuthorizationInput,
    requested: string | undefined,
  ): AgentProfile => {
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
  const composeGuidance = (profile: AgentProfile): AgentProfile =>
    opts.guidance ? opts.guidance(profile) : profile
  // The pre-journal gate (a bridge backend's route/admission check) must judge the profile that
  // will run, not the `{ name }` stub — otherwise every graph spawn over a bridge is refused
  // `model-route` before the graph ever pins it. This resolver is PURE: it answers "which node"
  // without ledgering, because the gate may refuse and nothing may be journaled for a refusal.
  const resolveSpawnProfile = (authored: AgentProfile): AgentProfile => {
    const requested = typeof authored.name === 'string' ? authored.name : undefined
    const node =
      requested === undefined
        ? undefined
        : (workers.get(requested) ??
          analystNodes.get(requested) ??
          mapNodes.get(requested) ??
          flow?.nodes.get(requested))
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
  productAuthorities.set(authorizeSpawn, opts.authorizeSpawn)

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

  // ── Maps edges → map routes the coordination layer expands on the source's settle ──
  const mapRoutes: MapOnSettleRoute[] = maps.map((edge) => ({
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
    ;(edge.to === root?.id ? driverAnalyzesByAnalyst : routedAnalyzesByAnalyst).set(
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
    if (event.type === 'route') {
      const step = event.route
      if (step.kind !== 'traversal') return
      if (step.workerId !== undefined) nodeByWorkerId.set(step.workerId, step.to)
      if (step.reason?.startsWith('traversal-cap-exhausted') === true) exhausted.add(step.edge)
      // A replayed gate decision is already journaled: its row rides the result, not the journal.
      const entry = routeLedgerEntry(step, flow?.routes.get(step.edge), registry)
      record(entry, step.gate?.replayed !== true)
      return
    }
    if (event.type === 'map') {
      const step = event.map
      const edge = mapsById.get(step.edge)
      if (!edge) return
      const itemName = mapItemNames.get(step.edge) as NodeId
      if (step.workerId !== undefined) {
        nodeByWorkerId.set(step.workerId, step.phase === 'join' ? edge.join : itemName)
      }
      // An item that reached a node received the edge directive beside its element.
      const directiveBytes =
        step.phase === 'item' && step.workerId !== undefined && edge.to !== undefined
          ? byteLength(registry.resolve(edge.directive).text)
          : 0
      record(
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
      return
    }
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
    maps: mapRoutes,
    continuityByProfile,
    authorizeSpawn,
    resolveSpawnProfile,
    observeMessages,
    onCoordinationEvent,
    bindSpawn,
    settle,
  }
}
