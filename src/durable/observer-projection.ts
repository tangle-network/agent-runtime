import type { RuntimeDecisionKind, RuntimeHookTarget } from '../runtime-hooks'
import type { ObserverRecord } from './observer-journal'

export interface PursuitRunProjection {
  readonly runId: string
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
  readonly decisionCount: number
  readonly targets: Readonly<Record<string, number>>
  readonly decisions: Readonly<Record<string, number>>
}

export interface PursuitNodeProjection {
  readonly id: string
  readonly parentId?: string
  readonly runId: string
  readonly label?: string
  readonly runtime?: string
  readonly depth?: number
  readonly assignmentId?: string
  readonly identity?: unknown
  readonly budget?: unknown
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
}

export interface PursuitProjection {
  readonly pursuitId: string
  readonly sequence: number
  readonly chainTip?: string
  readonly firstObservedAt?: number
  readonly lastObservedAt?: number
  readonly runs: readonly PursuitRunProjection[]
  readonly nodes: readonly PursuitNodeProjection[]
  readonly eventCount: number
  readonly decisionCount: number
}

type MutableRun = {
  runId: string
  firstSequence: number
  lastSequence: number
  firstObservedAt: number
  lastObservedAt: number
  eventCount: number
  decisionCount: number
  targets: Record<string, number>
  decisions: Record<string, number>
}

type MutableNode = {
  id: string
  parentId?: string
  runId: string
  label?: string
  runtime?: string
  depth?: number
  assignmentId?: string
  identity?: unknown
  budget?: unknown
  firstSequence: number
  lastSequence: number
  firstObservedAt: number
  lastObservedAt: number
  eventCount: number
}

/**
 * Fold the append-only observer history into a deterministic operator projection.
 *
 * This is intentionally a READ model, not another state machine: it does not own
 * execution, cannot steer agents, and can be rebuilt from the journal at any time.
 * The only topology fact it special-cases is Runtime's canonical `agent.spawn`
 * payload (`childId` + `parentId`); every other event remains visible through the
 * per-run target/decision counters even when a future Runtime adds new event kinds.
 */
export function projectPursuit(records: readonly ObserverRecord[]): PursuitProjection {
  if (records.length === 0) {
    throw new TypeError('projectPursuit: at least one observer record is required')
  }
  const pursuitId = records[0]!.pursuitId
  const runs = new Map<string, MutableRun>()
  const nodes = new Map<string, MutableNode>()
  let eventCount = 0
  let decisionCount = 0

  for (const record of records) {
    if (record.pursuitId !== pursuitId) {
      throw new Error(
        `projectPursuit: mixed pursuit journals (${record.pursuitId} !== ${pursuitId})`,
      )
    }
    const observed = record.event ?? record.decision
    if (!observed) throw new Error(`projectPursuit: record ${record.sequence} has no observation`)
    const run = getRun(runs, observed.runId, record)
    run.lastSequence = record.sequence
    run.lastObservedAt = record.observedAt

    if (record.event) {
      eventCount += 1
      run.eventCount += 1
      increment(run.targets, record.event.target)
      projectSpawnNode(nodes, record)
      projectNodeActivity(nodes, record)
    } else if (record.decision) {
      decisionCount += 1
      run.decisionCount += 1
      increment(run.decisions, record.decision.kind)
    }
  }

  const first = records[0]!
  const last = records.at(-1)!
  return Object.freeze({
    pursuitId,
    sequence: last.sequence,
    chainTip: last.digest,
    firstObservedAt: first.observedAt,
    lastObservedAt: last.observedAt,
    runs: Object.freeze(
      [...runs.values()]
        .sort((a, b) => a.firstSequence - b.firstSequence || a.runId.localeCompare(b.runId))
        .map(freezeRun),
    ),
    nodes: Object.freeze(
      [...nodes.values()]
        .sort((a, b) => a.firstSequence - b.firstSequence || a.id.localeCompare(b.id))
        .map(freezeNode),
    ),
    eventCount,
    decisionCount,
  })
}

function getRun(
  runs: Map<string, MutableRun>,
  runId: string,
  record: ObserverRecord,
): MutableRun {
  const existing = runs.get(runId)
  if (existing) return existing
  const created: MutableRun = {
    runId,
    firstSequence: record.sequence,
    lastSequence: record.sequence,
    firstObservedAt: record.observedAt,
    lastObservedAt: record.observedAt,
    eventCount: 0,
    decisionCount: 0,
    targets: {},
    decisions: {},
  }
  runs.set(runId, created)
  return created
}

function projectSpawnNode(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (!event || event.target !== 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const childId = stringField(payload, 'childId')
  if (!childId) return
  const existing = nodes.get(childId)
  if (existing) {
    existing.lastSequence = record.sequence
    existing.lastObservedAt = record.observedAt
    existing.eventCount += 1
    return
  }
  nodes.set(childId, {
    id: childId,
    ...(event.parentId ? { parentId: event.parentId } : {}),
    runId: event.runId,
    ...(stringField(payload, 'label') ? { label: stringField(payload, 'label') } : {}),
    ...(stringField(payload, 'runtime') ? { runtime: stringField(payload, 'runtime') } : {}),
    ...(numberField(payload, 'depth') !== undefined ? { depth: numberField(payload, 'depth') } : {}),
    ...(stringField(payload, 'assignmentId')
      ? { assignmentId: stringField(payload, 'assignmentId') }
      : {}),
    ...(payload && Object.hasOwn(payload, 'identity') ? { identity: payload.identity } : {}),
    ...(payload && Object.hasOwn(payload, 'budget') ? { budget: payload.budget } : {}),
    firstSequence: record.sequence,
    lastSequence: record.sequence,
    firstObservedAt: record.observedAt,
    lastObservedAt: record.observedAt,
    eventCount: 1,
  })
}

function projectNodeActivity(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (!event || event.target === 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const nodeId =
    stringField(payload, 'childId') ??
    stringField(payload, 'nodeId') ??
    stringField(payload, 'workerId')
  if (!nodeId) return
  const node = nodes.get(nodeId)
  if (!node) return
  node.lastSequence = record.sequence
  node.lastObservedAt = record.observedAt
  node.eventCount += 1
}

function freezeRun(run: MutableRun): PursuitRunProjection {
  return Object.freeze({
    ...run,
    targets: Object.freeze({ ...run.targets }),
    decisions: Object.freeze({ ...run.decisions }),
  })
}

function freezeNode(node: MutableNode): PursuitNodeProjection {
  return Object.freeze({ ...node })
}

function increment(
  target: Record<string, number>,
  key: RuntimeHookTarget | RuntimeDecisionKind,
): void {
  target[key] = (target[key] ?? 0) + 1
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringField(value: Record<string, unknown> | undefined, key: string): string | undefined {
  const field = value?.[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function numberField(value: Record<string, unknown> | undefined, key: string): number | undefined {
  const field = value?.[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}
