import type { AgentProfile } from '@tangle-network/agent-interface'
import { ValidationError } from '../../errors'
import {
  type GraphRunRecord,
  graphDigest,
  type StoredGraph,
  taskShapeDigest,
} from './graph-registry'

/** @inline */
interface ObservedFact<T> {
  readonly value: T | null
  readonly unavailable?: string | null
  readonly partial?: string
}

/** Structural projection of traces' SessionFacts. The trace reader owns all
 * measurements; this adapter neither parses transcripts nor recounts tokens. */
export interface ObservedSessionFacts {
  readonly sessionId: string | null
  readonly parentSessionId: string | null
  readonly harness: string | null
  readonly firstRecordAt: ObservedFact<string>
  readonly lastRecordAt: ObservedFact<string>
  readonly tokens: {
    readonly input: number | null
    readonly output: number | null
    readonly unavailable?: string | null
  }
  readonly humanTurns: ObservedFact<readonly unknown[]>
  /** Postclassification authors counted by traces, unlike raw harness actors. */
  readonly typedTurnCounts?: ObservedFact<
    readonly { readonly actor: string; readonly turns: number }[]
  >
  readonly agent: ObservedFact<{
    readonly profileName?: string
    readonly model?: string
    readonly harness?: string
  }>
}

/** Provenance and explicit labels for one imported workflow or Fleet lane.
 * Task shape/type and outcome are supplied by their deterministic owners. */
export interface GraphSessionObservationOptions {
  readonly source: NonNullable<GraphRunRecord['source']>
  readonly taskType?: GraphRunRecord['taskType']
  readonly taskShape?: Record<string, unknown>
  readonly outcome?: GraphRunRecord['outcome']
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly observedAt?: string
  readonly evidence?: GraphRunRecord['evidence']
  readonly relationships?: ReadonlyArray<{
    readonly sessionId: string
    readonly parentSessionId?: string
    readonly childSessionIds: readonly string[]
  }>
  readonly complete?: boolean
  readonly issues?: readonly unknown[]
}

function measured<T>(fact: ObservedFact<T> | undefined): T | undefined {
  return fact && !fact.partial && fact.value !== null ? fact.value : undefined
}

function recordedAt(fact: ObservedFact<string>): string | undefined {
  const value = measured(fact)
  return value && Number.isFinite(Date.parse(value)) ? value : undefined
}

/** Import normalized session facts into the existing graph and run record.
 * Canonical node ordinals keep run identities and usage out of topology hashes.
 * Ordered adjacency can conservatively split isomorphic graphs; it never pools
 * graphs merely because their degree histograms happen to match. */
export function graphFromSessionFacts(
  facts: readonly ObservedSessionFacts[],
  options: GraphSessionObservationOptions,
): { readonly graph: StoredGraph; readonly record: GraphRunRecord } {
  const sessions = new Map<string, ObservedSessionFacts | undefined>()
  const unknowns: string[] = []
  for (const fact of facts) {
    if (!fact.sessionId)
      throw new ValidationError('graphFromSessionFacts: every session needs its recorded identity')
    if (sessions.has(fact.sessionId))
      throw new ValidationError(
        `graphFromSessionFacts: duplicate session identity ${fact.sessionId}`,
      )
    sessions.set(fact.sessionId, fact)
  }
  if (!sessions.size) throw new ValidationError('graphFromSessionFacts: no session facts')
  const links = new Map<string, readonly [string, string]>()
  const link = (parent: string, child: string): void => {
    links.set(JSON.stringify([parent, child]), [parent, child])
    if (!sessions.has(parent)) sessions.set(parent, undefined)
    if (!sessions.has(child)) sessions.set(child, undefined)
  }
  for (const fact of facts) if (fact.parentSessionId) link(fact.parentSessionId, fact.sessionId!)
  for (const relation of options.relationships ?? []) {
    if (!sessions.has(relation.sessionId)) sessions.set(relation.sessionId, undefined)
    if (relation.parentSessionId) link(relation.parentSessionId, relation.sessionId)
    for (const child of relation.childSessionIds) link(relation.sessionId, child)
  }
  const children = new Map<string, string[]>()
  const parents = new Set<string>()
  for (const [parent, child] of links.values()) {
    children.set(parent, [...(children.get(parent) ?? []), child])
    parents.add(child)
  }
  // Refinement is for deterministic ordering only. The digest below retains
  // every endpoint of every edge, rather than using these labels as a shape.
  let labels = new Map([...sessions.keys()].map((id) => [id, 'node']))
  for (let round = 0; round < sessions.size; round++) {
    labels = new Map(
      [...sessions.keys()].map((id) => [
        id,
        taskShapeDigest({
          children: (children.get(id) ?? []).map((child) => labels.get(child)).sort(),
        }),
      ]),
    )
  }
  const compare = (a: string, b: string): number =>
    labels.get(a)!.localeCompare(labels.get(b)!) || a.localeCompare(b)
  const order: string[] = []
  const visited = new Set<string>()
  const visit = (id: string): void => {
    if (visited.has(id)) return
    visited.add(id)
    order.push(id)
    for (const child of [...(children.get(id) ?? [])].sort(compare)) visit(child)
  }
  for (const id of [...sessions.keys()].filter((id) => !parents.has(id)).sort(compare)) visit(id)
  for (const id of [...sessions.keys()].sort(compare)) visit(id)
  const ids = new Map(order.map((id, index) => [id, `n${index}`]))
  const edges = [...links.values()]
    .map(([from, to]) => ({
      kind: 'delegates' as const,
      from: ids.get(from)!,
      to: ids.get(to)!,
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  const nodes = order.map((id) => {
    const fact = sessions.get(id)
    const identity = fact && measured(fact.agent)
    const profile: AgentProfile = {}
    if (identity?.model) profile.model = { default: identity.model }
    const harness = identity?.harness ?? fact?.harness
    if (harness) profile.metadata = { harness }
    // A generic role name reveals no task prompt or local filesystem path.
    profile.name = parents.has(id) ? 'observed-child' : 'observed-agent'
    return { id: ids.get(id)!, profile }
  })
  const content = { observed: true as const, nodes, edges, deliverable: {} }
  const graph: StoredGraph = { digest: graphDigest(content), ...content }
  const nodeUsage: NonNullable<GraphRunRecord['nodeUsage']>[number][] = []
  for (const id of order) {
    const fact = sessions.get(id)
    if (!fact) {
      unknowns.push(`${ids.get(id)}: referenced session facts unavailable`)
      nodeUsage.push({ nodeId: ids.get(id)!, sourceId: id })
      continue
    }
    const startedAt = recordedAt(fact.firstRecordAt)
    const lastRecordAt = recordedAt(fact.lastRecordAt)
    const humanTurns = measured(fact.humanTurns)
    const typedTurns = measured(fact.typedTurnCounts)
    const leadMessages = typedTurns
      ?.filter((entry) => entry.actor === 'fleet')
      .reduce((sum, entry) => sum + entry.turns, 0)
    const inputTokens = fact.tokens.input ?? undefined
    const outputTokens = fact.tokens.output ?? undefined
    const humanMessages = humanTurns?.length
    for (const [key, value] of Object.entries({
      inputTokens,
      outputTokens,
      humanMessages,
      leadMessages,
    })) {
      if (value === undefined) unknowns.push(`${ids.get(id)}: ${key} unavailable`)
      else if (!Number.isFinite(value) || value < 0)
        throw new ValidationError(`graphFromSessionFacts: invalid ${key}`)
    }
    nodeUsage.push({
      nodeId: ids.get(id)!,
      sourceId: id,
      ...(startedAt === undefined ? {} : { startedAt }),
      // A last trace record proves observation time, not agent completion.
      ...(lastRecordAt === undefined ? {} : { lastRecordAt }),
      ...(inputTokens === undefined ? {} : { inputTokens }),
      ...(outputTokens === undefined ? {} : { outputTokens }),
      ...(humanMessages === undefined ? {} : { humanMessages }),
      ...(leadMessages === undefined ? {} : { leadMessages }),
    })
    if (!startedAt) unknowns.push(`${ids.get(id)}: first record timestamp unavailable`)
    if (!lastRecordAt) unknowns.push(`${ids.get(id)}: last record timestamp unavailable`)
  }
  const starts = nodeUsage
    .flatMap((node) => (node.startedAt ? [node.startedAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  const startedAt = options.startedAt ?? starts[0]
  if (!startedAt || !Number.isFinite(Date.parse(startedAt)))
    throw new ValidationError(
      'graphFromSessionFacts: no recorded task start; supply an authoritative startedAt',
    )
  const complete =
    options.complete !== false && !options.issues?.length && [...sessions.values()].every(Boolean)
  if (!complete) unknowns.push('workflow selection incomplete; total accounting unavailable')
  for (const issue of options.issues ?? []) {
    const kind = issue && typeof issue === 'object' && 'kind' in issue ? issue.kind : undefined
    if (typeof kind === 'string') unknowns.push(`workflow issue: ${kind}`)
  }
  if (!options.taskType) unknowns.push('task type not explicitly labeled')
  const cost: { -readonly [K in keyof GraphRunRecord['cost']]: GraphRunRecord['cost'][K] } = {}
  for (const channel of ['inputTokens', 'outputTokens', 'humanMessages', 'leadMessages'] as const) {
    if (complete && nodeUsage.every((node) => node[channel] !== undefined))
      cost[channel] = nodeUsage.reduce((sum, node) => sum + node[channel]!, 0)
  }
  if (cost.inputTokens !== undefined && cost.outputTokens !== undefined)
    cost.tokens = cost.inputTokens + cost.outputTokens
  const outcome = options.outcome ?? {
    kind: 'unknown',
    reason: 'no independent delivery outcome was joined',
  }
  const timingComplete =
    options.startedAt !== undefined ||
    (complete && nodeUsage.every((node) => node.startedAt !== undefined))
  if (!timingComplete)
    unknowns.push('task start unconfirmed; startedAt is earliest observed activity')
  if ((outcome.kind === 'delivered' || outcome.kind === 'no-winner') && !options.finishedAt)
    throw new ValidationError(
      'graphFromSessionFacts: terminal outcomes require authoritative finishedAt',
    )
  if (options.finishedAt) {
    const elapsed = Date.parse(options.finishedAt) - Date.parse(startedAt)
    if (!Number.isFinite(elapsed) || elapsed < 0)
      throw new ValidationError('graphFromSessionFacts: invalid finishedAt')
    if (timingComplete) cost.ms = elapsed
  }
  const merged = options.evidence
    ?.filter((entry) => entry.kind === 'pr-merged' && entry.at)
    .map((entry) => Date.parse(entry.at!))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0]
  if (timingComplete && merged !== undefined && merged >= Date.parse(startedAt))
    cost.mergeMs = merged - Date.parse(startedAt)
  return {
    graph,
    record: {
      graphDigest: graph.digest,
      topologyDigest: taskShapeDigest({ nodes: nodes.map((node) => node.id), edges }),
      taskDigest: taskShapeDigest(options.taskShape ?? { taskType: options.taskType ?? 'unknown' }),
      startedAt,
      ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
      outcome,
      cost,
      traversals: edges.length,
      source: options.source,
      ...(options.observedAt ? { observedAt: options.observedAt } : {}),
      ...(options.taskType ? { taskType: options.taskType } : {}),
      ...(options.evidence ? { evidence: options.evidence } : {}),
      nodeUsage,
      unknowns,
    },
  }
}
