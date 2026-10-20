import { resolveRedactor } from '../../redact'
import type { BusRecord, EventBus } from '../../runtime/supervise/event-bus'
import { detachedFrozen } from '../../runtime/supervise/snapshot'
import type { CoordinationToolsOptions } from './coordination-contracts'
import {
  type CoordinationEvent,
  JOURNAL_READ_BOUNDS,
  type JournalEntry,
  type JournalEventKind,
  type JournalPage,
  journalEventKinds,
} from './coordination-events'
import { obj } from './coordination-input'
import { safeJsonText } from './coordination-json'

export function createJournalReader({
  opts,
  bus,
}: {
  readonly opts: CoordinationToolsOptions
  readonly bus: EventBus<CoordinationEvent>
}) {
  let journalReadTo = 0

  // ── read_journal ──────────────────────────────────────────────────────────────
  //
  // Reads `bus.history()`, which is this manager's own log and nothing else. Bounds are clamped,
  // never rejected: a model that asks for 10_000 rows gets `maxLimit` rows and reads the exact
  // bound it was given back in `bounds`, which is more useful than an error it has to re-plan
  // around. A kind it cannot name IS an error, because silently dropping an unknown filter would
  // answer a different question than the one asked.
  const redactJournalEvent = resolveRedactor(opts.redactJournal)
  const clampBound = (raw: unknown, field: string, fallback: number, max: number): number => {
    if (raw === undefined) return fallback
    if (typeof raw !== 'number' || !Number.isInteger(raw))
      throw new Error(`coordination tools: "${field}" must be an integer`)
    return Math.min(Math.max(raw, 1), max)
  }
  const journalKinds = (raw: unknown): ReadonlySet<JournalEventKind> | undefined => {
    if (raw === undefined) return undefined
    if (!Array.isArray(raw))
      throw new Error('coordination tools: "kinds" must be an array of event kinds')
    for (const kind of raw) {
      if (!(journalEventKinds as ReadonlyArray<unknown>).includes(kind))
        throw new Error(
          `coordination tools: "kinds" accepts ${journalEventKinds.join(', ')}; received ${JSON.stringify(kind)}`,
        )
    }
    return new Set(raw as ReadonlyArray<JournalEventKind>)
  }
  // DETACHED, then redacted, in that order and unconditionally. Detaching must not depend on which
  // redactor was configured: `redact: false` or a pass-through domain hook would otherwise hand the
  // manager live references into `bus.history()`, and in code mode a model-written program holds
  // that result and can write through it into the run's own audit log. A redactor that throws
  // yields a marker for that row alone — the manager still learns an event of that kind happened.
  const redactedRow = (record: BusRecord<CoordinationEvent>): unknown => {
    try {
      return redactJournalEvent(detachedFrozen(record.event))
    } catch (error) {
      return {
        type: record.event.type,
        redactionFailed: error instanceof Error ? error.message : String(error),
      }
    }
  }
  // Prior-process rows first, then this process's bus. `row` indexes THIS concatenation, so the
  // cursor is stable across a restart even though the bus `seq` space restarts with it.
  const priorJournal = opts.priorJournal ?? []
  const journalRows = (): ReadonlyArray<
    JournalEntry & { readonly record: BusRecord<CoordinationEvent> }
  > => {
    const rows: Array<JournalEntry & { readonly record: BusRecord<CoordinationEvent> }> = []
    let row = 0
    for (const record of priorJournal) {
      rows.push({
        row: row++,
        seq: record.seq,
        at: record.at,
        priority: record.priority,
        prior: true,
        event: undefined,
        record,
      })
    }
    for (const record of bus.history()) {
      rows.push({
        row: row++,
        seq: record.seq,
        at: record.at,
        priority: record.priority,
        event: undefined,
        record,
      })
    }
    return rows
  }
  const readJournal = (raw: unknown, trackOwnRead = true): JournalPage => {
    const a = raw === undefined ? {} : obj(raw)
    const sinceRow =
      a.sinceRow === undefined
        ? 0
        : typeof a.sinceRow === 'number' && Number.isInteger(a.sinceRow) && a.sinceRow >= 0
          ? a.sinceRow
          : (() => {
              throw new Error('coordination tools: "sinceRow" must be a non-negative integer')
            })()
    const limit = clampBound(
      a.limit,
      'limit',
      JOURNAL_READ_BOUNDS.defaultLimit,
      JOURNAL_READ_BOUNDS.maxLimit,
    )
    const maxBytes = clampBound(
      a.maxBytes,
      'maxBytes',
      JOURNAL_READ_BOUNDS.defaultMaxBytes,
      JOURNAL_READ_BOUNDS.maxMaxBytes,
    )
    const kinds = journalKinds(a.kinds)
    const matching = journalRows().filter(
      (candidate) =>
        candidate.row >= sinceRow && (!kinds || kinds.has(candidate.record.event.type)),
    )

    const entries: JournalEntry[] = []
    // Seeded with the array's own two brackets, and each later row adds its separating comma, so
    // `usedBytes` equals the byte length of the `entries` array the caller receives — not a sum
    // that ignores the envelope and overshoots the budget by a few bytes on a full page.
    const envelopeBytes = 2
    let usedBytes = envelopeBytes
    let index = 0
    // A bound APPLIED, which is not the same as "records were left over": an oversize row is
    // consumed and still elided, so a caller keying completeness off `truncated` must see it.
    let bounded = false
    for (; index < matching.length; index++) {
      if (entries.length >= limit) {
        bounded = true
        break
      }
      const candidate = matching[index] as (typeof matching)[number]
      const { record, event: _placeholder, ...stamp } = candidate
      const row: JournalEntry = { ...stamp, event: redactedRow(record) }
      // Measured on the ASSEMBLED row, because the stamp is part of what the caller receives; the
      // event alone under-counts by ~50 bytes a row and a full page then overshoots the budget.
      const bytes = Buffer.byteLength(safeJsonText(row), 'utf8') + (entries.length === 0 ? 0 : 1)
      if (usedBytes + bytes > maxBytes) {
        bounded = true
        // A row that cannot fit ANY budget would stall the cursor forever, so the first row of a
        // page is always emitted — as a marker when it is too big to render.
        if (entries.length > 0) break
        const marker: JournalEntry = {
          ...stamp,
          event: { type: record.event.type },
          oversize: { type: record.event.type, bytes },
        }
        entries.push(marker)
        usedBytes += Buffer.byteLength(safeJsonText(marker), 'utf8')
        // The marker is only ever the FIRST row of a page, so it never adds a separator.
        index++
        break
      }
      entries.push(row)
      usedBytes += bytes
    }
    const last = entries[entries.length - 1]
    const nextRow = last === undefined ? sinceRow : last.row + 1
    if (trackOwnRead) journalReadTo = Math.max(journalReadTo, nextRow)
    return {
      entries,
      nextRow,
      remaining: matching.length - index,
      truncated: bounded,
      bounds: { sinceRow, limit, maxBytes, usedBytes },
      priorRows: priorJournal.length,
    }
  }

  return { readJournal, priorJournal, redactJournalEvent, readTo: () => journalReadTo }
}
