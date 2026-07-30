/**
 * Coordination transcript for every node in a recursive run.
 *
 * The execution journal records work. This log records the exact stamped bus records that agents
 * exchanged. A resumed node loads only its own transcript.
 *
 * @experimental
 */

import type {
  AnalystFindingEvent,
  CoordinationEvent,
  QuestionRecord,
} from '../../mcp/tools/coordination'
import type { BusRecord } from './event-bus'

export interface PriorCoordination {
  readonly records: ReadonlyArray<BusRecord<CoordinationEvent>>
  readonly questions: ReadonlyArray<QuestionRecord>
  readonly findings: ReadonlyArray<AnalystFindingEvent>
}

export interface CoordinationSource {
  readonly nodeId: string
  readonly profileName: string | null
}

export interface CoordinationLogRecord {
  readonly version: 3
  readonly runId: string
  readonly source: CoordinationSource
  readonly record: BusRecord<CoordinationEvent>
}

export interface CoordinationLog {
  append(
    runId: string,
    source: CoordinationSource,
    record: BusRecord<CoordinationEvent>,
  ): Promise<void>
  load(runId: string, nodeId: string): Promise<PriorCoordination>
  records(runId: string): Promise<ReadonlyArray<CoordinationLogRecord>>
}

type LegacyV2Record = {
  readonly version: 2
  readonly runId: string
  readonly source: CoordinationSource
  readonly at: string
  readonly event: CoordinationEvent
}

type LegacyV1Record = {
  readonly runId: string
  readonly at: string
  readonly event: CoordinationEvent
}

/** Process-local transcript with the same behavior as the durable implementation. */
export class InMemoryCoordinationLog implements CoordinationLog {
  readonly #records: CoordinationLogRecord[] = []

  append(
    runId: string,
    source: CoordinationSource,
    record: BusRecord<CoordinationEvent>,
  ): Promise<void> {
    this.#records.push(snapshotRecord({ version: 3, runId, source, record }))
    return Promise.resolve()
  }

  async load(runId: string, nodeId: string): Promise<PriorCoordination> {
    return foldPrior((await this.records(runId)).filter((row) => row.source.nodeId === nodeId))
  }

  records(runId: string): Promise<ReadonlyArray<CoordinationLogRecord>> {
    return Promise.resolve(this.#records.filter((row) => row.runId === runId))
  }
}

/** File-backed transcript: append-only JSONL, fsynced per bus record. */
export class FileCoordinationLog implements CoordinationLog {
  constructor(private readonly path: string) {}

  async append(
    runId: string,
    source: CoordinationSource,
    record: BusRecord<CoordinationEvent>,
  ): Promise<void> {
    const row = snapshotRecord({ version: 3 as const, runId, source, record })
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const fh = await fs.open(this.path, 'a')
    try {
      await fh.write(`${JSON.stringify(row)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  async load(runId: string, nodeId: string): Promise<PriorCoordination> {
    return foldPrior((await this.records(runId)).filter((row) => row.source.nodeId === nodeId))
  }

  async records(runId: string): Promise<ReadonlyArray<CoordinationLogRecord>> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return []
      throw err
    }

    const rows: CoordinationLogRecord[] = []
    const legacySeqBySource = new Map<string, number>()
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const decoded = JSON.parse(line) as CoordinationLogRecord | LegacyV2Record | LegacyV1Record
      const row =
        'version' in decoded && decoded.version === 3
          ? decoded
          : normalizeLegacy(decoded, legacySeqBySource)
      if (row.runId === runId) rows.push(row)
    }
    return rows
  }
}

function foldPrior(records: ReadonlyArray<CoordinationLogRecord>): PriorCoordination {
  const byId = new Map<string, QuestionRecord>()
  const findings: AnalystFindingEvent[] = []
  for (const row of records) {
    const event = row.record.event
    if (event.type === 'question') {
      byId.set(event.question.id, event.question)
    } else if (event.type === 'finding') {
      findings.push(event.finding)
    } else if (event.type === 'answer') {
      const prior = byId.get(event.questionId)
      if (prior) {
        byId.set(event.questionId, {
          ...prior,
          status: 'answered',
          answer: event.answer,
        })
      }
    }
  }
  return snapshotRecord({
    records: records.map((row) => row.record),
    questions: [...byId.values()],
    findings,
  })
}

function normalizeLegacy(
  decoded: LegacyV2Record | LegacyV1Record,
  nextSeqBySource: Map<string, number>,
): CoordinationLogRecord {
  const source =
    'version' in decoded ? decoded.source : { nodeId: decoded.runId, profileName: null }
  const seq = nextSeqBySource.get(source.nodeId) ?? 0
  nextSeqBySource.set(source.nodeId, seq + 1)
  const rawEvent = decoded.event as unknown as Record<string, unknown>
  const event =
    rawEvent.type === 'answer' && Object.hasOwn(rawEvent, 'down')
      ? legacyAnswerEvent(rawEvent)
      : decoded.event
  const parsedAt = Date.parse(decoded.at)
  if (!Number.isFinite(parsedAt)) {
    throw new Error(`coordination log: invalid legacy timestamp ${JSON.stringify(decoded.at)}`)
  }
  return {
    version: 3,
    runId: decoded.runId,
    source,
    record: {
      seq,
      at: parsedAt,
      priority: 0,
      event,
    },
  }
}

function legacyAnswerEvent(raw: Record<string, unknown>): CoordinationEvent {
  const down = raw.down && typeof raw.down === 'object' ? (raw.down as Record<string, unknown>) : {}
  return {
    type: 'answer',
    questionId: String(raw.questionId ?? ''),
    answer: {
      text: typeof down.instruction === 'string' ? down.instruction : '',
      by: typeof raw.by === 'string' ? raw.by : null,
    },
  }
}

function snapshotRecord<T>(value: T): T {
  return deepFreezeRecord(structuredClone(value))
}

function deepFreezeRecord<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== 'object' || seen.has(value as object)) return value
  seen.add(value as object)
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreezeRecord(child, seen)
  }
  return Object.freeze(value)
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
