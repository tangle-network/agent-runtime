/**
 * Durable side-log for every coordination bus event. Each row names the exact coordinator node
 * that emitted it, so one file is a full-tree audit without replaying a child's questions into its
 * parent. The spawn journal remains the execution ledger; this log is the coordination transcript.
 *
 * JSONL, one fsynced record per event, keyed by `runId` — several runs may share one log file
 * exactly as they share one spawn-journal file.
 *
 * @experimental
 */

import type {
  AnalystFindingEvent,
  CoordinationEvent,
  QuestionRecord,
} from '../../mcp/tools/coordination'

/** What a prior process's coordination log replays into a resumed driver. */
export interface PriorCoordination {
  /** Every question the prior process raised, with answer-status folded in, raise order. */
  readonly questions: ReadonlyArray<QuestionRecord>
  /** Every analyst finding the prior process published, publish order. */
  readonly findings: ReadonlyArray<AnalystFindingEvent>
}

/** Exact coordinator attribution for one bus event. */
export interface CoordinationSource {
  readonly nodeId: string
  readonly profileName: string | null
}

/** Versioned full-tree row returned for audit. */
export interface CoordinationLogRecord {
  readonly version: 2
  readonly runId: string
  readonly source: CoordinationSource
  readonly at: string
  readonly event: CoordinationEvent
}

/** The durable coordination side-log seam. */
export interface CoordinationLog {
  append(
    runId: string,
    source: CoordinationSource,
    event: CoordinationEvent,
    at: string,
  ): Promise<void>
  /** Replay only the root coordinator's prior context. */
  load(runId: string): Promise<PriorCoordination>
  /** Read every coordinator's versioned rows for audit. */
  records(runId: string): Promise<ReadonlyArray<CoordinationLogRecord>>
}

type LegacyCoordinationLogRecord = {
  readonly runId: string
  readonly at: string
  readonly event: CoordinationEvent
}

/** FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. */
export class FileCoordinationLog implements CoordinationLog {
  constructor(private readonly path: string) {}

  async append(
    runId: string,
    source: CoordinationSource,
    event: CoordinationEvent,
    at: string,
  ): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const record: CoordinationLogRecord = { version: 2, runId, source, at, event }
    const fh = await fs.open(this.path, 'a')
    try {
      await fh.write(`${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  async load(runId: string): Promise<PriorCoordination> {
    const records = (await this.records(runId)).filter((record) => record.source.nodeId === runId)
    const byId = new Map<string, QuestionRecord>()
    const findings: AnalystFindingEvent[] = []
    for (const record of records) {
      const ev = record.event
      if (ev.type === 'question') {
        byId.set(ev.question.id, ev.question)
      } else if (ev.type === 'finding') {
        findings.push(ev.finding)
      } else if (ev.type === 'answer') {
        const prior = byId.get(ev.questionId)
        if (prior) {
          byId.set(ev.questionId, {
            ...prior,
            status: 'answered',
            decision: { kind: 'answer', answer: ev.down.instruction, by: 'prior-run' },
          })
        }
      }
    }
    return { questions: [...byId.values()], findings }
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
    const records: CoordinationLogRecord[] = []
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const decoded = JSON.parse(line) as CoordinationLogRecord | LegacyCoordinationLogRecord
      const record: CoordinationLogRecord =
        'version' in decoded && decoded.version === 2
          ? decoded
          : {
              version: 2,
              runId: decoded.runId,
              source: { nodeId: decoded.runId, profileName: null },
              at: decoded.at,
              event: decoded.event,
            }
      if (record.runId !== runId) continue
      records.push(record)
    }
    return records
  }
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
