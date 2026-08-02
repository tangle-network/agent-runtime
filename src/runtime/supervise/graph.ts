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
 * `makeWorkerAgent` seam, conserved-pool budget, and deliverable-gated settlement every
 * supervised run uses. (`runLoop` is a deprecated alias of `runAgentRounds` and is deliberately
 * NOT the substrate here.) What the graph layer ADDS is exactly what a bespoke driver loop never
 * had:
 *
 *  1. **Node pinning** — a spawn names a node (`profile.name` = node id) and the node's canonical
 *     profile is what runs; a driver cannot smuggle capabilities into a worker it did not define.
 *  2. **Observable edges** — every delegates/analyzes traversal lands in an EDGE LEDGER
 *     (`delivered | stripped | empty | unpropagated`, with byte counts), in memory on
 *     the result AND as `edge` events in the run journal. The motivating incident: a filter
 *     silently replaced 1,700-char steering with 241 chars of boilerplate for three rounds and
 *     NO artifact said so — an unobservable edge cannot be trusted and its directive cannot be
 *     optimized.
 *  3. **Directives as data** — edge text lives in the prompt registry (`<surface>/v<n>`), so every
 *     edge is a versioned optimization target, never prose hardcoded in a builder function.
 *  4. **Per-edge traversal caps** — the cyclic-graph backstop. A delegates edge whose cap is
 *     exhausted REFUSES further traversals (fail loud), so a cycle cannot spin the pool dry.
 *
 * ORACLES ARE ENVIRONMENT, NEVER NODES. Graders/verifiers must not be addressable in the graph —
 * an edge to them leaks the rubric. Analysts (`analyzes` edges) are LENSES from the environment's
 * registry reading trace evidence; they are not nodes either, and a graph that names a node id as
 * its analyst is refused.
 *
 * @experimental
 */

import {
  type AgentProfile,
  agentProfileSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import { InMemoryResultBlobStore, InMemorySpawnJournal } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import type {
  AnalystRegistry,
  AnalyzeOnSettleRoute,
  CoordinationEvent,
  MakeWorkerAgent,
} from '../../mcp/tools/coordination'
import type { RouterConfig } from '../router-client'
import type { ToolLoopChat } from '../tool-loop'
import type { DeliverableSpec } from './completion-gate'
import {
  formatPromptHandle,
  kernelPromptRegistry,
  type PromptHandle,
  type PromptRegistry,
} from './prompt-registry'
import type { ExecutorConfig } from './runtime'
import { type SuperviseOptions, supervise, workerFromBackend } from './supervise'
import type { Budget, NodeId, ResultBlobStore, SpawnJournal, SupervisedResult } from './types'

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
    }
  /** Findings flow anywhere: an analyst LENS (environment, never a node) over N nodes' settled
   *  traces, delivered to ONE node wrapped in a directive telling the recipient what to do with
   *  the analysis. */
  | {
      readonly kind: 'analyzes'
      /** The analyst lens id, resolved against `RunGraphOptions.analysts`. NOT a node id. */
      readonly analyst: string
      readonly over: ReadonlyArray<NodeId>
      readonly to: NodeId
      readonly directive: PromptHandle
      /** Observability cap: traversals beyond this are LEDGERED as exhausted (`unpropagated`).
       *  Only delegates caps refuse traversal — they are what close the spawn cycle. */
      readonly maxTraversals?: number
    }

export interface AgentGraph {
  readonly nodes: ReadonlyArray<GraphNode>
  readonly edges: ReadonlyArray<GraphEdge>
  /** Termination is mandatory, not optional: the independent completion oracle. */
  readonly deliverable: DeliverableSpec<unknown>
  /** One conserved pool across the whole graph — cycles without conservation never terminate. */
  readonly budget: Budget
}

// ── The edge ledger ────────────────────────────────────────────────────────────

export type EdgeDeliveryOutcome = 'delivered' | 'stripped' | 'empty' | 'unpropagated'

/** One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent. */
export interface EdgeTraversal {
  /** Stable edge id: `delegates:<from>-><to>` or `analyzes:<analyst>:<over…>-><to>`. */
  readonly edge: string
  readonly kind: 'delegates' | 'analyzes'
  readonly from: string
  readonly to: string
  /** The resolved directive reference (`<surface>/v<n>`). */
  readonly directive: string
  /** 1-based per-edge ordinal. */
  readonly traversal: number
  readonly outcome: EdgeDeliveryOutcome
  /** Bytes of directive + payload that actually crossed the edge. */
  readonly bytes: number
  readonly reason?: string
  /** The concrete worker node id, once known. */
  readonly workerId?: string
}

/** Default per-edge traversal cap — the cyclic-graph backstop when an edge names none. */
export const defaultEdgeTraversalCap = 32

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

export interface RunGraphOptions {
  /** WHERE worker nodes run — the executor backend. Provide this OR `makeWorkerAgent`. */
  readonly backend?: ExecutorConfig
  /** Leaf-execution override (offline tests / advanced). `runGraph` still owns node pinning,
   *  directive delivery, and the edge ledger AROUND this seam — only the leaf `act` is yours. */
  readonly makeWorkerAgent?: MakeWorkerAgent
  /** The driver brain's router substrate (`profile.harness` omitted or `cli-base`). */
  readonly router?: RouterConfig
  /** Inject the driver brain directly (offline tests / advanced). */
  readonly brain?: ToolLoopChat
  /** The analyst lens registry `analyzes` edges resolve against. ENVIRONMENT, not nodes. */
  readonly analysts?: AnalystRegistry
  /** Directive registry. Default: the seeded kernel registry (`kernelPromptRegistry()`). */
  readonly registry?: PromptRegistry
  /** The run journal the edge ledger and every spawn/settle ride. Default: in-memory. */
  readonly journal?: SpawnJournal
  readonly blobs?: ResultBlobStore
  readonly runId?: string
  /** Per-child budget reserved from the conserved pool on each spawn. */
  readonly perWorker?: Budget
  readonly maxTurns?: number
  readonly maxLiveWorkers?: number
  /** Product authority over every steer/answer instruction (the filter seam). `runGraph` observes
   *  what it CHANGES: a narrowed instruction ledgers its steer traversal as `stripped`. */
  readonly authorizeMessage?: SuperviseOptions['authorizeMessage']
  readonly signal?: AbortSignal
  readonly now?: () => number
  readonly otel?: SuperviseOptions['otel']
  readonly stallAfterMs?: number
  readonly allowedModels?: readonly string[]
}

export interface GraphResult<Out = unknown> {
  readonly result: SupervisedResult<Out>
  /** Every edge traversal, in occurrence order — the observable-edge contract. */
  readonly ledger: ReadonlyArray<EdgeTraversal>
  /** Edge ids whose traversal cap was hit — analyzes exhaustion included (observable here, never
   *  a refusal). A DELEGATES cap paired with a `no-winner` result THROWS
   *  ({@link GraphEdgeCapError}) instead of returning: only delegates caps refuse spawns, so only
   *  they can have ended the run. */
  readonly exhaustedEdges: ReadonlyArray<string>
  readonly runId: string
}

// ── Validation ─────────────────────────────────────────────────────────────────

interface ValidatedGraph {
  readonly root: GraphNode
  readonly workers: ReadonlyMap<NodeId, GraphNode>
  readonly delegatesByWorker: ReadonlyMap<NodeId, Extract<GraphEdge, { kind: 'delegates' }>>
  readonly analyzes: ReadonlyArray<Extract<GraphEdge, { kind: 'analyzes' }>>
}

function edgeId(edge: GraphEdge): string {
  return edge.kind === 'delegates'
    ? `delegates:${edge.from}->${edge.to}`
    : `analyzes:${edge.analyst}:${edge.over.join('+')}->${edge.to}`
}

/** Validate the graph and resolve every directive BEFORE any compute is spent — an invalid
 *  topology or an unknown directive is a configuration fault, never a mid-run surprise. */
function validateGraph(
  graph: AgentGraph,
  registry: PromptRegistry,
  analysts: AnalystRegistry | undefined,
): ValidatedGraph {
  if (!Array.isArray(graph.nodes) || graph.nodes.length === 0) {
    throw new ValidationError('runGraph: graph.nodes must be a non-empty array')
  }
  if (!Array.isArray(graph.edges) || graph.edges.length === 0) {
    throw new ValidationError('runGraph: graph.edges must be a non-empty array')
  }
  if (typeof graph.deliverable?.check !== 'function') {
    throw new ValidationError('runGraph: graph.deliverable is mandatory (termination oracle)')
  }
  if (typeof graph.budget !== 'object' || graph.budget === null) {
    throw new ValidationError('runGraph: graph.budget is mandatory (the conserved pool)')
  }
  const byId = new Map<NodeId, GraphNode>()
  for (const node of graph.nodes) {
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
    byId.set(node.id, node)
  }
  const requireNode = (id: NodeId, where: string): GraphNode => {
    const node = byId.get(id)
    if (!node) throw new ValidationError(`runGraph: ${where} references unknown node '${id}'`)
    return node
  }
  const delegates = graph.edges.filter(
    (edge): edge is Extract<GraphEdge, { kind: 'delegates' }> => edge.kind === 'delegates',
  )
  const analyzes = graph.edges.filter(
    (edge): edge is Extract<GraphEdge, { kind: 'analyzes' }> => edge.kind === 'analyzes',
  )
  if (delegates.length === 0) {
    throw new ValidationError('runGraph: at least one delegates edge is required (who spawns whom)')
  }
  for (const edge of graph.edges) registry.resolve(edge.directive)
  for (const edge of delegates) {
    requireNode(edge.from, edgeId(edge))
    requireNode(edge.to, edgeId(edge))
    if (edge.from === edge.to) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} delegates to itself — the driver↔worker cycle is the ` +
          'settle-return loop, not a self-edge',
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
  for (const edge of delegates) {
    if (edge.from !== root.id) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} delegates from a non-root node — P0 executes one driver over ` +
          'its workers (the 2-node cyclic case, star-generalized); deeper delegation is P3',
      )
    }
  }
  for (const edge of analyzes) {
    if (byId.has(edge.analyst)) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} names node '${edge.analyst}' as its analyst — oracles and ` +
          'analysts are ENVIRONMENT, never nodes; pass a lens id from RunGraphOptions.analysts',
      )
    }
    if (!analysts) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} needs RunGraphOptions.analysts (the lens registry its analyst resolves against)`,
      )
    }
    if (!analysts.kinds.some((kind) => kind.id === edge.analyst)) {
      throw new ValidationError(
        `runGraph: ${edgeId(edge)} analyst '${edge.analyst}' is not in the analysts registry ` +
          `(known: ${analysts.kinds.map((kind) => kind.id).join(', ') || 'none'})`,
      )
    }
    if (edge.over.length === 0) {
      throw new ValidationError(`runGraph: ${edgeId(edge)} must analyze at least one node`)
    }
    for (const over of edge.over) requireNode(over, edgeId(edge))
    requireNode(edge.to, edgeId(edge))
  }
  const workers = new Map<NodeId, GraphNode>()
  const delegatesByWorker = new Map<NodeId, Extract<GraphEdge, { kind: 'delegates' }>>()
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
  // Every non-root node must be reachable by a delegates edge, or it can never run.
  for (const node of graph.nodes) {
    if (node.id !== root.id && !workers.has(node.id)) {
      throw new ValidationError(
        `runGraph: node '${node.id}' has no delegates edge to it — an unreachable node never runs`,
      )
    }
  }
  return { root, workers, delegatesByWorker, analyzes }
}

// ── The runner ─────────────────────────────────────────────────────────────────

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

function stringifyPayload(payload: unknown): string {
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload) ?? String(payload)
  } catch {
    return String(payload)
  }
}

/**
 * Execute an {@link AgentGraph}. The root node becomes the supervisor (`supervise()` — the
 * execution core), each worker node is spawnable BY NODE ID (`spawn_agent` with
 * `profile: { name: '<node id>' }`; the node's canonical profile is pinned by the graph), each
 * delegates directive is appended to the worker profile's `prompt.instructions` per traversal,
 * and each analyzes edge becomes an analyst-on-settle route with a real DESTINATION. Every
 * traversal is ledgered and journaled.
 */
export function runGraph(graph: AgentGraph, opts: RunGraphOptions): Promise<GraphResult> {
  const registry = opts.registry ?? kernelPromptRegistry()
  const { root, workers, delegatesByWorker, analyzes } = validateGraph(
    graph,
    registry,
    opts.analysts,
  )
  if (!opts.backend && !opts.makeWorkerAgent) {
    throw new ValidationError(
      'runGraph: provide opts.backend (where nodes run) or opts.makeWorkerAgent',
    )
  }
  const journal = opts.journal ?? new InMemorySpawnJournal()
  const blobs = opts.blobs ?? new InMemoryResultBlobStore()
  const runId =
    opts.runId ??
    `graph-${canonicalCandidateDigest(graph.nodes.map((n) => n.id)).slice('sha256:'.length, 'sha256:'.length + 12)}`
  const now = opts.now ?? Date.now

  // ── Ledger state ──
  const ledger: EdgeTraversal[] = []
  const journaled = new Set<EdgeTraversal>()
  const traversalCounts = new Map<string, number>()
  const exhausted = new Set<string>()
  // The subset of `exhausted` that REFUSED work. Only a delegates cap closes the spawn cycle, so
  // only it can be the reason a run ended winnerless — an analyzes cap refuses nothing.
  const exhaustedDelegates = new Set<string>()
  const journalWrites: Promise<void>[] = []
  let ledgerSeq = 0
  const appendJournal = (entry: EdgeTraversal, nodeIdForEvent: string): Promise<void> => {
    if (journaled.has(entry)) return Promise.resolve()
    journaled.add(entry)
    const write = journal.appendEvent(runId, {
      kind: 'edge',
      id: nodeIdForEvent,
      edge: { kind: entry.kind, from: entry.from, to: entry.to, directive: entry.directive },
      traversal: entry.traversal,
      outcome: entry.outcome,
      bytes: entry.bytes,
      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
      seq: ledgerSeq++,
      at: new Date(now()).toISOString(),
    })
    journalWrites.push(write)
    return write
  }
  const record = (entry: Omit<EdgeTraversal, 'traversal'>, journalNow: boolean): EdgeTraversal => {
    const count = (traversalCounts.get(entry.edge) ?? 0) + 1
    traversalCounts.set(entry.edge, count)
    const row: EdgeTraversal = { ...entry, traversal: count }
    ledger.push(row)
    if (journalNow) void appendJournal(row, row.workerId ?? `graph:${row.to}`)
    return row
  }

  // ── Node pinning + delegates spawn traversals (the makeWorkerAgent wrapper) ──
  const makeLeaf =
    opts.makeWorkerAgent ?? workerFromBackend(opts.backend as ExecutorConfig, graph.deliverable)
  const nodeByWorkerId = new Map<string, NodeId>()
  const pendingByAssignment = new Map<string, EdgeTraversal>()
  const graphWorker: MakeWorkerAgent = (authoredProfile, spawnContext) => {
    const requested =
      typeof (authoredProfile as { name?: unknown } | undefined)?.name === 'string'
        ? (authoredProfile as { name: string }).name
        : undefined
    const node = requested !== undefined ? workers.get(requested) : undefined
    if (!node) {
      throw new ValidationError(
        `runGraph: spawn_agent named profile ${JSON.stringify(requested)} which is not a worker ` +
          `node of this graph (nodes: ${[...workers.keys()].join(', ')}). Spawn by node id: ` +
          'profile.name selects the node; the node profile itself is pinned by the graph.',
      )
    }
    const edge = delegatesByWorker.get(node.id) as Extract<GraphEdge, { kind: 'delegates' }>
    const id = edgeId(edge)
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const used = traversalCounts.get(id) ?? 0
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
    const taskText = stringifyPayload(spawnContext?.task)
    const bytes = byteLength(directiveText) + byteLength(taskText)
    const row = record(
      {
        edge: id,
        kind: 'delegates',
        from: edge.from,
        to: edge.to,
        directive: formatPromptHandle(edge.directive),
        outcome: bytes === 0 ? 'empty' : 'delivered',
        bytes,
        ...(bytes === 0 ? { reason: 'no directive text and no task payload' } : {}),
      },
      false,
    )
    if (spawnContext?.assignmentId !== undefined) {
      pendingByAssignment.set(spawnContext.assignmentId, row)
    } else {
      void appendJournal(row, `graph:${row.to}`)
    }
    // The delegation directive is a STANDING instruction of this traversal: appended to the
    // node's canonical prompt instructions, so the worker runs under node profile + edge
    // directive, and the driver-authored profile contributes ONLY the node selection.
    const pinned: AgentProfile =
      directiveText.length === 0
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
    return makeLeaf(pinned, spawnContext)
  }

  // ── Analyzes edges → analyst-on-settle routes with destinations ──
  const routes: Array<string | AnalyzeOnSettleRoute> = analyzes.map((edge) =>
    edge.to === root.id
      ? { kind: edge.analyst, over: edge.over }
      : {
          kind: edge.analyst,
          over: edge.over,
          to: edge.to,
          directive: registry.resolve(edge.directive).text,
        },
  )
  // Driver-destined analyzes directives are standing instructions for the ROOT: the findings
  // arrive as bus events; the directive tells the driver what to do with them.
  const driverAnalyzesBriefs = analyzes
    .filter((edge) => edge.to === root.id)
    .map(
      (edge) =>
        `Findings from analyst '${edge.analyst}' (over: ${edge.over.join(', ')}) will arrive as ` +
        `finding events.\n${registry.resolve(edge.directive).text}`,
    )

  // ── The driver graph brief: which nodes it may spawn, by exact name ──
  const workerLines = [...workers.values()].map((node) => {
    const edge = delegatesByWorker.get(node.id) as Extract<GraphEdge, { kind: 'delegates' }>
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const description =
      typeof node.profile.description === 'string' && node.profile.description.length > 0
        ? ` — ${node.profile.description}`
        : ''
    return `- '${node.id}'${description} (delegation cap: ${cap} traversals)`
  })
  const graphBrief = [
    'AGENT GRAPH: you are the driver node of a fixed topology. You may spawn ONLY these worker',
    "nodes, by EXACT name (spawn_agent with profile: { name: '<node id>' }; the node's full",
    'profile is pinned by the graph — any other profile fields you author are ignored):',
    ...workerLines,
    ...(driverAnalyzesBriefs.length > 0 ? ['', ...driverAnalyzesBriefs] : []),
  ].join('\n')
  const rootProfile: AgentProfile = {
    ...root.profile,
    prompt: {
      ...(root.profile.prompt ?? {}),
      instructions: [
        ...((root.profile.prompt?.instructions as readonly string[] | undefined) ?? []),
        graphBrief,
      ],
    },
  }

  // ── Steer + finding observation (delegates steers, analyzes traversals) ──
  // The filter seam: when the caller's authorizeMessage NARROWS an instruction, the delivered
  // bytes differ from the composed bytes — that steer traversal is `stripped` (the VB incident:
  // authored steering silently replaced by boilerplate, byte-indistinguishable downstream).
  const strippedByDigest = new Map<string, { composedBytes: number }>()
  const authorizeMessage: SuperviseOptions['authorizeMessage'] | undefined = opts.authorizeMessage
    ? (input) => {
        const decision = (
          opts.authorizeMessage as NonNullable<SuperviseOptions['authorizeMessage']>
        )(input)
        if (decision.instruction !== input.instruction) {
          strippedByDigest.set(canonicalCandidateDigest(decision.instruction), {
            composedBytes: byteLength(input.instruction),
          })
        }
        return decision
      }
    : undefined

  const routedAnalyzesByAnalyst = new Map<string, Extract<GraphEdge, { kind: 'analyzes' }>>()
  const driverAnalyzesByAnalyst = new Map<string, Extract<GraphEdge, { kind: 'analyzes' }>>()
  for (const edge of analyzes) {
    ;(edge.to === root.id ? driverAnalyzesByAnalyst : routedAnalyzesByAnalyst).set(
      edge.analyst,
      edge,
    )
  }
  const analyzesCapReached = (edge: Extract<GraphEdge, { kind: 'analyzes' }>): boolean => {
    const cap = edge.maxTraversals ?? defaultEdgeTraversalCap
    const used = traversalCounts.get(edgeId(edge)) ?? 0
    if (used < cap) return false
    exhausted.add(edgeId(edge))
    return true
  }
  const ledgerAnalyzes = (
    edge: Extract<GraphEdge, { kind: 'analyzes' }>,
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

  const onCoordinationEvent = async (
    _context: unknown,
    _eventId: unknown,
    recordEnvelope: { readonly event: CoordinationEvent },
  ): Promise<void> => {
    const event = recordEnvelope.event
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

  // ── Spawn-hook: bind ledger rows to concrete worker ids, then journal them ──
  const hooks = {
    onEvent: (event: {
      target?: string
      phase?: string
      payload?: unknown
    }): void | Promise<void> => {
      if (event.target !== 'agent.spawn' || event.phase !== 'after') return
      const payload = event.payload as { childId?: unknown; assignmentId?: unknown } | undefined
      if (typeof payload?.childId !== 'string' || typeof payload.assignmentId !== 'string') return
      const pending = pendingByAssignment.get(payload.assignmentId)
      if (!pending) return
      pendingByAssignment.delete(payload.assignmentId)
      const bound: EdgeTraversal = { ...pending, workerId: payload.childId }
      ledger[ledger.indexOf(pending)] = bound
      nodeByWorkerId.set(payload.childId, bound.to)
      return appendJournal(bound, payload.childId)
    },
  }

  // Every configuration fault above throws SYNCHRONOUSLY (matching `supervise()`'s own
  // contract); only the run itself is asynchronous.
  const start = async (): Promise<GraphResult> => {
    const result = await supervise(rootProfile, graphTask(graph, root), {
      budget: graph.budget,
      deliverable: graph.deliverable,
      makeWorkerAgent: graphWorker,
      journal,
      blobs,
      runId,
      hooks,
      onCoordinationEvent,
      ...(routes.length > 0 && opts.analysts
        ? { analysts: opts.analysts, analyzeOnSettle: routes }
        : {}),
      ...(opts.router ? { router: opts.router } : {}),
      ...(opts.brain ? { brain: opts.brain } : {}),
      ...(authorizeMessage ? { authorizeMessage } : {}),
      ...(opts.perWorker ? { perWorker: opts.perWorker } : {}),
      ...(opts.maxTurns !== undefined ? { maxTurns: opts.maxTurns } : {}),
      ...(opts.maxLiveWorkers !== undefined ? { maxLiveWorkers: opts.maxLiveWorkers } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
      ...(opts.now ? { now: opts.now } : {}),
      ...(opts.otel ? { otel: opts.otel } : {}),
      ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
      ...(opts.allowedModels ? { allowedModels: opts.allowedModels } : {}),
    })

    // A spawn row is PROVISIONAL until the `agent.spawn` hook (fired synchronously once a worker
    // exists) binds it to a live worker id. A row still unbound here means the factory ran but no
    // NEW worker went live: the spawn was refused after the factory (identity conflict, runtime
    // floor) or a keyed re-spawn deduplicated to an already-completed result (prepare() runs the
    // factory, no hook fires). Both state the same truth every unpropagated row states — the
    // directive never reached a live worker — so rewrite rather than mint a new outcome. Then
    // settle every journal write, so the ledger's journal twin is complete when this returns.
    for (const pending of pendingByAssignment.values()) {
      const refused: EdgeTraversal = {
        ...pending,
        outcome: 'unpropagated',
        bytes: 0,
        reason: `no-live-worker-bound (spawn refused after the factory, or a keyed re-spawn deduplicated to a completed result; ${pending.bytes} composed bytes never crossed)`,
      }
      ledger[ledger.indexOf(pending)] = refused
      await appendJournal(refused, `graph:${refused.to}`)
    }
    pendingByAssignment.clear()
    await Promise.all(journalWrites)

    const exhaustedEdges = Object.freeze([...exhausted])
    const frozenLedger = Object.freeze(ledger.map((row) => Object.freeze({ ...row })))
    if (result.kind !== 'winner' && exhaustedDelegates.size > 0) {
      // Fail LOUD: the backstop, not the task, ended this run. The evidence rides on the error.
      // Only DELEGATES caps refuse spawns, so only they can be the cause named here.
      throw new GraphEdgeCapError(Object.freeze([...exhaustedDelegates]), frozenLedger, result)
    }
    return { result, ledger: frozenLedger, exhaustedEdges, runId }
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
