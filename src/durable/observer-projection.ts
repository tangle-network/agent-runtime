import type { RuntimeDecisionKind, RuntimeHookTarget } from '../runtime-hooks'
import { type ObserverRecord, verifyObserverRecords } from './observer-journal'

export type PursuitRunStatus = 'running' | 'done' | 'failed'

export interface PursuitRunProjection {
  readonly runId: string
  readonly status: PursuitRunStatus
  readonly settledAt?: number
  readonly error?: string
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
  readonly decisionCount: number
  readonly targets: Readonly<Record<string, number>>
  readonly decisions: Readonly<Record<string, number>>
}

export type PursuitNodeStatus = 'running' | 'done' | 'down'

export interface PursuitNodeProjection {
  readonly id: string
  readonly parentId?: string
  /** Node ids are scoped to this concrete Runtime tree; `(runId,id)` is identity. */
  readonly runId: string
  readonly label?: string
  readonly runtime?: string
  readonly depth?: number
  readonly assignmentId?: string
  readonly identity?: unknown
  readonly budget?: unknown
  readonly status: PursuitNodeStatus
  readonly settledAt?: number
  readonly spent?: unknown
  readonly outRef?: string
  readonly score?: number
  readonly valid?: boolean
  readonly reason?: string
  readonly infra?: boolean
  readonly wait?: unknown
  readonly firstSequence: number
  readonly lastSequence: number
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly eventCount: number
}

export interface PursuitProjection {
  readonly pursuitId: string
  /** Number of records in this concrete execution journal. */
  readonly sequence: number
  /** Digest-chain tip for this concrete execution journal. */
  readonly chainTip: string
  readonly firstObservedAt: number
  readonly lastObservedAt: number
  readonly runs: readonly PursuitRunProjection[]
  readonly nodes: readonly PursuitNodeProjection[]
  readonly eventCount: number
  readonly decisionCount: number
}

type MutableRun = {
  runId: string
  status: PursuitRunStatus
  settledAt?: number
  error?: string
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
  status: PursuitNodeStatus
  settledAt?: number
  spent?: unknown
  outRef?: string
  score?: number
  valid?: boolean
  reason?: string
  infra?: boolean
  wait?: unknown
  firstSequence: number
  lastSequence: number
  firstObservedAt: number
  lastObservedAt: number
  eventCount: number
}

/**
 * Fold one append-only execution journal into a deterministic operator projection.
 *
 * This is intentionally a READ model, not another state machine: it does not own
 * execution, cannot steer agents, and can be rebuilt from the journal at any time.
 * Projection verifies the complete hash chain first, so an operator view can never
 * silently render a mutated or reordered observer history as trustworthy state.
 *
 * Topology comes only from Runtime's canonical `agent.spawn` facts. Terminal node
 * state comes only from `agent.child`; concrete run state comes only from the root
 * `agent.run` lifecycle emitted by `supervisePursuit`. Node identity is scoped to the
 * concrete Runtime run so independent trees may both contain `root:s0` without aliasing.
 */
export function projectPursuit(records: readonly ObserverRecord[]): PursuitProjection {
  if (records.length === 0) {
    throw new TypeError('projectPursuit: at least one observer record is required')
  }
  const pursuitId = records[0]!.pursuitId
  const verified = verifyObserverRecords(records, pursuitId)
  const runs = new Map<string, MutableRun>()
  const nodes = new Map<string, MutableNode>()
  let eventCount = 0
  let decisionCount = 0

  for (const record of verified) {
    const observed = record.event ?? record.decision
    if (!observed) throw new Error(`projectPursuit: record ${record.sequence} has no observation`)
    const run = getRun(runs, observed.runId, record)
    run.lastSequence = record.sequence
    run.lastObservedAt = record.observedAt

    if (record.event) {
      eventCount += 1
      run.eventCount += 1
      increment(run.targets, record.event.target)
      projectRunActivity(run, record)
      projectSpawnNode(nodes, record)
      projectNodeActivity(nodes, record)
    } else if (record.decision) {
      decisionCount += 1
      run.decisionCount += 1
      increment(run.decisions, record.decision.kind)
    }
  }

  const first = verified[0]!
  const last = verified.at(-1)!
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
        .sort(
          (a, b) =>
            a.firstSequence - b.firstSequence ||
            a.runId.localeCompare(b.runId) ||
            a.id.localeCompare(b.id),
        )
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
    status: 'running',
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

function projectRunActivity(run: MutableRun, record: ObserverRecord): void {
  const event = record.event
  if (event?.target !== 'agent.run') return
  const payload = objectRecord(event.payload)
  const status = stringField(payload, 'status')
  if (event.phase === 'after' || status === 'done') {
    run.status = 'done'
    run.settledAt = record.observedAt
    return
  }
  if (event.phase !== 'error' && status !== 'failed') return
  run.status = 'failed'
  run.settledAt = record.observedAt
  const error = stringField(payload, 'error')
  if (error) run.error = error
}

function nodeKey(runId: string, nodeId: string): string {
  return `${runId}\u0000${nodeId}`
}

function projectSpawnNode(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (event?.target !== 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const childId = stringField(payload, 'childId')
  if (!childId) return
  const key = nodeKey(event.runId, childId)
  const existing = nodes.get(key)
  if (existing) {
    existing.lastSequence = record.sequence
    existing.lastObservedAt = record.observedAt
    existing.eventCount += 1
    return
  }
  const label = stringField(payload, 'label')
  const runtime = stringField(payload, 'runtime')
  const depth = numberField(payload, 'depth')
  const assignmentId = stringField(payload, 'assignmentId')
  nodes.set(key, {
    id: childId,
    ...(event.parentId ? { parentId: event.parentId } : {}),
    runId: event.runId,
    ...(label ? { label } : {}),
    ...(runtime ? { runtime } : {}),
    ...(depth !== undefined ? { depth } : {}),
    ...(assignmentId ? { assignmentId } : {}),
    ...(payload && Object.hasOwn(payload, 'identity') ? { identity: payload.identity } : {}),
    ...(payload && Object.hasOwn(payload, 'budget') ? { budget: payload.budget } : {}),
    status: 'running',
    firstSequence: record.sequence,
    lastSequence: record.sequence,
    firstObservedAt: record.observedAt,
    lastObservedAt: record.observedAt,
    eventCount: 1,
  })
}

function projectNodeActivity(nodes: Map<string, MutableNode>, record: ObserverRecord): void {
  const event = record.event
  if (event === undefined) return
  if (event.target === 'agent.spawn') return
  const payload = objectRecord(event.payload)
  const nodeId =
    stringField(payload, 'childId') ??
    stringField(payload, 'nodeId') ??
    stringField(payload, 'workerId')
  if (!nodeId) return
  const node = nodes.get(nodeKey(event.runId, nodeId))
  if (!node) return
  node.lastSequence = record.sequence
  node.lastObservedAt = record.observedAt
  node.eventCount += 1

  if (event.target !== 'agent.child') return
  const status = stringField(payload, 'status')
  if (status !== 'done' && status !== 'down') return
  node.status = status
  node.settledAt = record.observedAt
  if (payload && Object.hasOwn(payload, 'spent')) node.spent = payload.spent
  const outRef = stringField(payload, 'outRef')
  if (outRef) node.outRef = outRef
  const score = numberField(payload, 'score')
  if (score !== undefined) node.score = score
  const valid = booleanField(payload, 'valid')
  if (valid !== undefined) node.valid = valid
  const reason = stringField(payload, 'reason')
  if (reason) node.reason = reason
  const infra = booleanField(payload, 'infra')
  if (infra !== undefined) node.infra = infra
  if (payload && Object.hasOwn(payload, 'wait')) node.wait = payload.wait
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

function booleanField(
  value: Record<string, unknown> | undefined,
  key: string,
): boolean | undefined {
  const field = value?.[key]
  return typeof field === 'boolean' ? field : undefined
}
