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
  readonly traceId?: string
  readonly rootSpanId?: ObservedFact<string>
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
  /** Exact pre-cap counts from the trace owner's sender classification. */
  readonly typedTurnCounts?: ObservedFact<
    readonly { readonly actor: string; readonly turns: number }[]
  >
  /** Actual unread source records, counted only by the trace reader. */
  readonly unreadRecords?: ObservedFact<number>
  /** Only an authoritative sender-role join can establish who led the work. */
  readonly leadMessages?: ObservedFact<number>
  readonly agent: ObservedFact<{
    readonly profileName?: string
    readonly model?: string
    readonly harness?: string
  }>
}

/** Provenance and explicit labels for one imported run. spanRun is a structural
 * projection of traces' existing SpanRunSnapshot, never a replacement run tree. */
export interface GraphSessionObservationOptions {
  readonly source: NonNullable<GraphRunRecord['source']>
  readonly traceRunId?: string
  readonly taskType?: GraphRunRecord['taskType']
  readonly taskShape?: Record<string, unknown>
  readonly outcome?: GraphRunRecord['outcome']
  /** Authoritative task start; first trace activity alone does not establish it. */
  readonly startedAt?: string
  readonly finishedAt?: string
  readonly observedAt?: string
  readonly evidence?: GraphRunRecord['evidence']
  readonly spanRun?: {
    readonly present: boolean
    readonly traceIds: readonly string[]
    readonly orphanSpans: number
    readonly nodes: readonly {
      readonly traceId: string
      readonly spanId: string
      readonly parentNodeId: string | null
      readonly runtime: string | null
      readonly kind?: string | null
    }[]
  }
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

/** Project an existing canonical span run tree into an observed graph design,
 * linked to its trace run. SessionFacts supplies exclusive accounting. No
 * execution tree, transcript, or source-specific traversal parser is stored. */
export function graphFromSessionFacts(
  facts: readonly ObservedSessionFacts[],
  options: GraphSessionObservationOptions,
): { readonly graph: StoredGraph; readonly record: GraphRunRecord } {
  if (!facts.length) throw new ValidationError('graphFromSessionFacts: no session facts')
  const unknowns = [
    'edge traversal accounting unavailable from canonical span relationships',
    'span containment does not establish graph edge semantics',
  ]
  const spanNodes = options.spanRun?.present ? options.spanRun.nodes : []
  const spanKey = (traceId: string, spanId: string): string => JSON.stringify([traceId, spanId])
  const identities = new Set<string>()
  const observations = facts.map((fact) => {
    const roots = spanNodes.filter(
      (node) => node.traceId === fact.traceId && node.parentNodeId === null,
    )
    const anchor = measured(fact.rootSpanId) ?? (roots.length === 1 ? roots[0]!.spanId : undefined)
    const boundary = fact.traceId && anchor ? `span:${spanKey(fact.traceId, anchor)}` : undefined
    const sourceId = fact.sessionId ?? boundary
    const identity = boundary ?? (fact.sessionId ? `session:${fact.sessionId}` : undefined)
    if (!identity || !sourceId || identities.has(identity))
      throw new ValidationError(
        'graphFromSessionFacts: every observation needs a unique recorded session or span identity',
      )
    identities.add(identity)
    const typedCounts = measured(fact.typedTurnCounts)
    const humanCounts = typedCounts?.filter((entry) => entry.actor === 'human')
    if (humanCounts?.some((entry) => !Number.isSafeInteger(entry.turns) || entry.turns < 0))
      throw new ValidationError('graphFromSessionFacts: invalid human turn count')
    const humanMessages =
      fact.typedTurnCounts === undefined
        ? measured(fact.humanTurns)?.length
        : humanCounts?.reduce((sum, entry) => sum + entry.turns, 0)
    const leadMessages = measured(fact.leadMessages)
    const inputTokens = fact.tokens.input ?? undefined
    const outputTokens = fact.tokens.output ?? undefined
    for (const [key, value] of Object.entries({
      inputTokens,
      outputTokens,
      humanMessages,
      leadMessages,
    })) {
      if (value === undefined) unknowns.push(`${sourceId}: ${key} unavailable`)
      else if (!Number.isSafeInteger(value) || value < 0)
        throw new ValidationError(`graphFromSessionFacts: invalid ${key}`)
    }
    return {
      sourceId,
      startedAt: recordedAt(fact.firstRecordAt),
      lastRecordAt: recordedAt(fact.lastRecordAt),
      inputTokens,
      outputTokens,
      humanMessages,
      leadMessages,
    }
  })
  const ids = new Map<string, string>()
  for (const [index, node] of spanNodes.entries()) {
    const key = spanKey(node.traceId, node.spanId)
    if (ids.has(key))
      throw new ValidationError('graphFromSessionFacts: duplicate canonical span identity')
    ids.set(key, `n${index}`)
  }
  const nodes = spanNodes.map((node) => {
    const profile: AgentProfile = {
      name: node.parentNodeId === null ? 'observed-agent' : 'observed-child',
    }
    if (node.runtime || node.kind)
      profile.metadata = {
        ...(node.runtime ? { runtime: node.runtime } : {}),
        ...(node.kind ? { spanKind: node.kind } : {}),
      }
    return { id: ids.get(spanKey(node.traceId, node.spanId))!, profile }
  })
  const edges: { from: string; to: string }[] = []
  for (const node of spanNodes) {
    if (node.parentNodeId === null) continue
    const from = ids.get(spanKey(node.traceId, node.parentNodeId))
    if (from) edges.push({ from, to: ids.get(spanKey(node.traceId, node.spanId))! })
    else unknowns.push('canonical span run has an unresolved parent node')
  }
  edges.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
  const nodeUsage: NonNullable<GraphRunRecord['nodeUsage']>[number][] = []
  const joinedNodes = new Set<string>()
  for (const [index, fact] of facts.entries()) {
    const anchor = measured(fact.rootSpanId)
    const matching = spanNodes.filter(
      (node) =>
        node.traceId === fact.traceId &&
        (anchor === undefined ? node.parentNodeId === null : node.spanId === anchor),
    )
    if (
      matching.length !== 1 ||
      joinedNodes.has(spanKey(matching[0]!.traceId, matching[0]!.spanId))
    ) {
      unknowns.push(
        `${fact.sessionId}: session accounting cannot be joined to one canonical span node`,
      )
      continue
    }
    const key = spanKey(matching[0]!.traceId, matching[0]!.spanId)
    joinedNodes.add(key)
    const nodeId = ids.get(key)!
    nodeUsage.push({ nodeId, ...observations[index]! })
    const profile = nodes.find((node) => node.id === nodeId)!.profile
    const identity = measured(fact.agent)
    const model = identity?.model
    if (model) profile.model = { default: model }
    const harness = identity?.harness ?? fact.harness
    if (harness) profile.metadata = { ...profile.metadata, harness }
  }
  for (const node of spanNodes) {
    const key = spanKey(node.traceId, node.spanId)
    if (!joinedNodes.has(key)) {
      nodeUsage.push({ nodeId: ids.get(key)! })
      unknowns.push(`${ids.get(key)!}: canonical node accounting unavailable`)
    }
  }
  if (!spanNodes.length)
    unknowns.push('topology unavailable: no canonical span run tree was supplied')
  if (spanNodes.some((node) => node.kind == null))
    unknowns.push('canonical span node kind unavailable')
  if (options.spanRun?.orphanSpans) unknowns.push('canonical span run contains orphan spans')
  if (!options.traceRunId) unknowns.push('trace run identity unavailable')
  for (const issue of options.issues ?? []) {
    const kind = issue && typeof issue === 'object' && 'kind' in issue ? issue.kind : undefined
    const reason =
      issue && typeof issue === 'object' && 'reason' in issue ? issue.reason : undefined
    if (typeof kind === 'string')
      unknowns.push(
        'workflow issue: ' +
          kind +
          (kind === 'source-coverage' && typeof reason === 'string'
            ? `: ${reason.replace(/[\r\n]/g, ' ').slice(0, 500)}`
            : ''),
      )
  }
  const incompleteIssues = options.issues?.some(
    (issue) =>
      !issue || typeof issue !== 'object' || !('kind' in issue) || issue.kind !== 'source-coverage',
  )
  const unread = facts.some(
    (fact) => fact.unreadRecords?.partial || (fact.unreadRecords?.value ?? 0) > 0,
  )
  if (unread)
    unknowns.push('source contains unread or partial records; total accounting unavailable')
  const complete = options.complete !== false && !incompleteIssues && !unread
  if (!complete) unknowns.push('workflow selection incomplete; total accounting unavailable')
  if (!options.taskType) unknowns.push('task type not explicitly labeled')
  const starts = observations
    .flatMap((node) => (node.startedAt ? [node.startedAt] : []))
    .sort((a, b) => Date.parse(a) - Date.parse(b))
  const startedAt = options.startedAt ?? starts[0]
  if (!startedAt || !Number.isFinite(Date.parse(startedAt)))
    throw new ValidationError(
      'graphFromSessionFacts: no recorded task start; supply an authoritative startedAt',
    )
  const cost: { -readonly [K in keyof GraphRunRecord['cost']]: GraphRunRecord['cost'][K] } = {}
  for (const channel of ['inputTokens', 'outputTokens', 'humanMessages', 'leadMessages'] as const) {
    if (complete && observations.every((node) => node[channel] !== undefined))
      cost[channel] = observations.reduce((sum, node) => sum + node[channel]!, 0)
  }
  if (cost.inputTokens !== undefined && cost.outputTokens !== undefined)
    cost.tokens = cost.inputTokens + cost.outputTokens
  const outcome = options.outcome ?? {
    kind: 'unknown',
    reason: 'no independent delivery outcome was joined',
  }
  if ((outcome.kind === 'delivered' || outcome.kind === 'no-winner') && !options.finishedAt)
    throw new ValidationError(
      'graphFromSessionFacts: terminal outcomes require authoritative finishedAt',
    )
  if (!options.startedAt)
    unknowns.push('task start unconfirmed; startedAt is earliest observed activity')
  if (options.finishedAt) {
    const elapsed = Date.parse(options.finishedAt) - Date.parse(startedAt)
    if (!Number.isFinite(elapsed) || elapsed < 0)
      throw new ValidationError('graphFromSessionFacts: invalid finishedAt')
    if (options.startedAt) cost.ms = elapsed
  }
  const merged = options.evidence
    ?.filter((entry) => entry.kind === 'pr-merged' && entry.at)
    .map((entry) => Date.parse(entry.at!))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)[0]
  if (options.startedAt && merged !== undefined && merged >= Date.parse(startedAt))
    cost.mergeMs = merged - Date.parse(startedAt)
  const content = { observed: true as const, nodes, edges, deliverable: {} }
  const graph: StoredGraph = { digest: graphDigest(content), ...content }
  return {
    graph,
    record: {
      graphDigest: graph.digest,
      ...(spanNodes.length
        ? {
            topologyDigest: taskShapeDigest({
              nodes: nodes.map((node, index) => ({
                id: node.id,
                kind: spanNodes[index]!.kind ?? null,
              })),
              edges,
            }),
          }
        : {}),
      taskDigest: taskShapeDigest(options.taskShape ?? { taskType: options.taskType ?? 'unknown' }),
      startedAt,
      ...(options.finishedAt ? { finishedAt: options.finishedAt } : {}),
      outcome,
      cost,
      source: options.source,
      ...(options.traceRunId ? { traceRunId: options.traceRunId } : {}),
      ...(options.observedAt ? { observedAt: options.observedAt } : {}),
      ...(options.taskType ? { taskType: options.taskType } : {}),
      ...(options.evidence ? { evidence: options.evidence } : {}),
      ...(nodeUsage.length ? { nodeUsage } : {}),
      unknowns,
    },
  }
}
