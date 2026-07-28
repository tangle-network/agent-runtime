/**
 * Durable side-log for the coordination bus: questions and analyst findings, the two UP-leg
 * message kinds the spawn journal does NOT record (it owns spawns/settlements/waits/spend). A
 * durable run (`supervise({ runDir })`) appends them as they publish and replays them on resume,
 * so a restarted coordinator still sees the questions its workers raised and the findings its
 * analysts produced — instead of losing both with the process.
 *
 * Answer down-events are logged too, ONLY to fold status on load: a question answered before the
 * crash reloads as `answered`, not as a re-blocking `open`. Settled events are skipped (the spawn
 * journal is their ledger); steer events are skipped (a delivered steer to a dead worker has no
 * meaning to a new process).
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

/** The durable coordination side-log seam. `append` records one bus event (kinds it does not
 *  persist are ignored); `load` replays a run's prior records folded into `PriorCoordination`. */
export interface CoordinationLog {
  append(runId: string, event: CoordinationEvent, at: string): Promise<void>
  load(runId: string): Promise<PriorCoordination>
}

type CoordinationLogRecord = {
  readonly runId: string
  readonly at: string
  readonly event: CoordinationEvent
}

/** Should this bus event be persisted? Questions and findings ARE the prior context a resumed
 *  driver needs; answers fold their status; everything else has a better ledger or none. */
function persisted(event: CoordinationEvent): boolean {
  return event.type === 'question' || event.type === 'finding' || event.type === 'answer'
}

/** FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. */
export class FileCoordinationLog implements CoordinationLog {
  constructor(private readonly path: string) {}

  async append(runId: string, event: CoordinationEvent, at: string): Promise<void> {
    if (!persisted(event)) return
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const record: CoordinationLogRecord = { runId, at, event }
    const fh = await fs.open(this.path, 'a')
    try {
      await fh.write(`${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  async load(runId: string): Promise<PriorCoordination> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return { questions: [], findings: [] }
      throw err
    }
    const byId = new Map<string, QuestionRecord>()
    const findings: AnalystFindingEvent[] = []
    for (const line of text.split('\n')) {
      if (line.length === 0) continue
      const record = JSON.parse(line) as CoordinationLogRecord
      if (record.runId !== runId) continue
      const ev = record.event
      if (ev.type === 'question') {
        byId.set(ev.question.id, ev.question)
      } else if (ev.type === 'finding') {
        findings.push(ev.finding)
      } else if (ev.type === 'answer') {
        // Fold the answer into the question it decided, so an answered blocking question does
        // not reload as open and re-block the resumed run's stop. `by` is not on the wire —
        // the honest attribution is the prior run itself.
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
}

function isNoEntError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 'ENOENT'
  )
}
