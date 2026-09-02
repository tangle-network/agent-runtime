/**
 * Durable side-log for coordination evidence the spawn journal does not own: questions, analyst
 * findings, answer decisions, authorized continuation receipts, delivery-attempt markers, and
 * delivery outcomes. A durable run
 * (`supervise({ runDir })`) appends them as they publish and loads them on resume, so a restarted
 * coordinator retains the exact evidence produced by prior processes.
 *
 * Answer down-events also fold status on load: a question answered before the crash reloads as
 * `answered`, not as a re-blocking `open`. Settled events are skipped (the spawn journal is their
 * ledger). A receipt followed by an attempt but no outcome proves the process died in the delivery
 * window; that outcome remains unknown and no prior instruction is auto-delivered.
 *
 * JSONL, one fsynced record per event, keyed by `runId` — several runs may share one log file
 * exactly as they share one spawn-journal file.
 *
 * @experimental
 */

import {
  isNoEntError,
  parseCommittedJsonLines,
  prepareJsonlAppend,
  writeAllBytes,
} from '../../durable/jsonl-file'
import type {
  AnalystFindingEvent,
  ContinuationInstruction,
  CoordinationEvent,
  DefinedAnalystRecord,
  QuestionEscalationRecord,
  QuestionRecord,
} from '../../mcp/tools/coordination'
import type { BusRecord } from './event-bus'
import type { PeerMailEvent } from './peer-mail'

/** Stable identity of the supervisor that owns one coordination stream. High-level supervision
 * derives it from the exact root/child execution identity plus its parent assignment. */
export type CoordinationOwnerId = string

/** Durable delivery evidence retained in commit order. An attempt without a later event carrying
 * the same `receiptId` has an unknown outcome after a crash and is never replayed. */
export type CoordinationDeliveryEvidence = Extract<
  CoordinationEvent,
  { readonly type: 'delivery-attempt' | 'steer' | 'answer' }
>

/** Coordination evidence loaded from prior processes of one durable supervised run. */
export interface PriorCoordination {
  /** The owner filter used for this replay. Omitted only for the compatibility all-owner read. */
  readonly ownerId?: CoordinationOwnerId
  /** Every question the prior process raised, with answer-status folded in, raise order. */
  readonly questions: ReadonlyArray<QuestionRecord>
  /** Every analyst finding the prior process published, publish order. */
  readonly findings: ReadonlyArray<AnalystFindingEvent>
  /** Every `ask_parent` escalation the prior process made, raise order. An undelivered one names a
   * question the run raised that nothing above it received — retained so a resuming operator sees
   * it, never auto-redelivered. */
  readonly escalations: ReadonlyArray<QuestionEscalationRecord>
  /** Every lens the prior process DEFINED at run time, definition order. The exact authored bytes
   * and their digest, so an invented lens can be re-registered and any finding it produced can be
   * traced to the words that produced it. Re-registration is the owner's decision, never automatic:
   * the registry may have changed between processes. */
  readonly analystDefinitions: ReadonlyArray<DefinedAnalystRecord>
  /** Every authorized continuation, in commit order. These are evidence, never replayed to a new
   * worker automatically. */
  readonly continuations: ReadonlyArray<ContinuationInstruction>
  /** Delivery intent and result records in commit order, linked to receipts by `receiptId`. */
  readonly deliveryEvidence: ReadonlyArray<CoordinationDeliveryEvidence>
  /** Every peer-mail attempt the prior process made, delivered and refused alike, in commit order.
   * Evidence of what siblings told each other; never replayed into a new worker's inbox. */
  readonly mail: ReadonlyArray<PeerMailEvent>
  /** Exact source-bus stamps in durable append order. Bus `seq` restarts with each process; append
   * order remains the cross-process replay order. */
  readonly records: ReadonlyArray<BusRecord<CoordinationEvent>>
}

/** The durable coordination side-log seam. `append` records one bus event (kinds it does not
 *  persist are ignored); `load` replays a run's prior records folded into `PriorCoordination`. */
export interface CoordinationLog {
  append(
    runId: string,
    record: BusRecord<CoordinationEvent>,
    ownerId?: CoordinationOwnerId,
  ): Promise<void>
  load(runId: string, ownerId?: CoordinationOwnerId): Promise<PriorCoordination>
}

type CoordinationLogRecord = {
  readonly runId: string
  readonly ownerId?: CoordinationOwnerId
  readonly seq: number
  readonly at: number
  readonly priority: number
  readonly event: CoordinationEvent
}

type LegacyCoordinationLogRecord = {
  readonly runId: string
  readonly ownerId?: CoordinationOwnerId
  readonly at: string
  readonly event: CoordinationEvent
}

/** Persist prior context plus exact continuation authorization, attempt, and result evidence.
 * Settlements have their own journal. */
function persisted(event: CoordinationEvent): boolean {
  return event.type !== 'settled'
}

/** FS-backed `CoordinationLog`: append-only JSONL, fsynced per record. */
export class FileCoordinationLog implements CoordinationLog {
  private appendTail: Promise<void> = Promise.resolve()

  constructor(private readonly path: string) {}

  async append(
    runId: string,
    record: BusRecord<CoordinationEvent>,
    ownerId?: CoordinationOwnerId,
  ): Promise<void> {
    if (!persisted(record.event)) return
    const append = this.appendTail.then(() => this.appendRecord(runId, record, ownerId))
    this.appendTail = append.catch(() => undefined)
    return append
  }

  private async appendRecord(
    runId: string,
    busRecord: BusRecord<CoordinationEvent>,
    ownerId?: CoordinationOwnerId,
  ): Promise<void> {
    const fs = await import('node:fs/promises')
    const path = await import('node:path')
    await fs.mkdir(path.dirname(this.path), { recursive: true })
    const record: CoordinationLogRecord = {
      runId,
      ...(ownerId !== undefined ? { ownerId } : {}),
      ...busRecord,
    }
    const needsSeparator = await prepareJsonlAppend(this.path)
    const fh = await fs.open(this.path, 'a')
    try {
      await writeAllBytes(fh, `${needsSeparator ? '\n' : ''}${JSON.stringify(record)}\n`)
      await fh.sync()
    } finally {
      await fh.close()
    }
  }

  async load(runId: string, ownerId?: CoordinationOwnerId): Promise<PriorCoordination> {
    const fs = await import('node:fs/promises')
    let text: string
    try {
      text = await fs.readFile(this.path, 'utf8')
    } catch (err) {
      if (isNoEntError(err)) return emptyPriorCoordination(ownerId)
      throw err
    }
    const byId = new Map<string, QuestionRecord>()
    const findings: AnalystFindingEvent[] = []
    const escalations: QuestionEscalationRecord[] = []
    const analystDefinitions: DefinedAnalystRecord[] = []
    const continuations: ContinuationInstruction[] = []
    const deliveryEvidence: CoordinationDeliveryEvidence[] = []
    const mail: PeerMailEvent[] = []
    const records: BusRecord<CoordinationEvent>[] = []
    let legacySeq = 0
    for (const stored of parseCommittedJsonLines<
      CoordinationLogRecord | LegacyCoordinationLogRecord
    >(text, this.path)) {
      if (stored.runId !== runId) continue
      // Omitting ownerId preserves the historical all-run read for direct consumers. Runtime always
      // supplies one, so root and nested supervisors never receive one another's evidence.
      if (ownerId !== undefined && stored.ownerId !== ownerId) continue
      const record: BusRecord<CoordinationEvent> =
        'seq' in stored
          ? {
              seq: stored.seq,
              at: stored.at,
              priority: stored.priority,
              event: stored.event,
            }
          : {
              seq: legacySeq++,
              at: Date.parse(stored.at),
              priority: 0,
              event: stored.event,
            }
      records.push(record)
      const ev = record.event
      if (ev.type === 'delivery-attempt' || ev.type === 'steer' || ev.type === 'answer') {
        deliveryEvidence.push(ev)
      }
      if (ev.type === 'question') {
        byId.set(ev.question.id, ev.question)
      } else if (ev.type === 'finding') {
        findings.push(ev.finding)
      } else if (ev.type === 'answer') {
        // Only accepted delivery resolves a blocking question. Authorization and an attempted
        // refusal remain evidence, but cannot turn "worker never received the answer" into answered
        // state on replay. `by` is not on the wire; prior-run is the honest attribution.
        const prior = byId.get(ev.questionId)
        if (prior && ev.down.delivered) {
          byId.set(ev.questionId, {
            ...prior,
            status: 'answered',
            decision: { kind: 'answer', answer: ev.down.instruction, by: 'prior-run' },
          })
        }
      } else if (ev.type === 'instruction') {
        continuations.push(ev.instruction)
      } else if (ev.type === 'mail') {
        mail.push(ev.mail)
      } else if (ev.type === 'escalation') {
        escalations.push(ev.escalation)
      } else if (ev.type === 'analyst-defined') {
        analystDefinitions.push(ev.analyst)
      }
    }
    return {
      ...(ownerId !== undefined ? { ownerId } : {}),
      questions: [...byId.values()],
      findings,
      escalations,
      analystDefinitions,
      continuations,
      deliveryEvidence,
      mail,
      records,
    }
  }
}

function emptyPriorCoordination(ownerId?: CoordinationOwnerId): PriorCoordination {
  return {
    ...(ownerId !== undefined ? { ownerId } : {}),
    questions: [],
    findings: [],
    escalations: [],
    analystDefinitions: [],
    continuations: [],
    deliveryEvidence: [],
    mail: [],
    records: [],
  }
}
