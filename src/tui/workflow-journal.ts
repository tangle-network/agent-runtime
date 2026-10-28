import { basename, join } from 'node:path'
import { parseCommittedJsonLines } from '../durable/jsonl-file'
import type { TopJournalEvent } from './top-snapshot'
import { type RecordedEvents, readRecordedEvents } from './top-transcript'

/** Native workflows have no Runtime accounting. Translate recorded lifecycle only. */
export function workflowJournal(runDir: string, text: string) {
  const rows = parseCommittedJsonLines<Record<string, unknown>>(text, 'journal.jsonl')
  const events: TopJournalEvent[] = []
  const tails = new Map<string, RecordedEvents>()
  let first: string | undefined
  let last: string | undefined
  for (const row of rows) {
    if (typeof row.agentId !== 'string' || !/^[\w-]+$/.test(row.agentId)) continue
    const id = row.agentId
    if (row.type === 'started') {
      const file = join(runDir, `agent-${id}.jsonl`)
      let start: string | undefined
      let end: string | undefined
      try {
        const recorded = readRecordedEvents(file)
        tails.set(id, recorded)
        if (recorded.firstActivityAt !== undefined)
          start = new Date(recorded.firstActivityAt).toISOString()
        if (recorded.activity.lastActivityAt !== undefined)
          end = new Date(recorded.activity.lastActivityAt).toISOString()
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      if (start && (!first || start < first)) first = start
      if (end && (!last || end > last)) last = end
      events.push({
        kind: 'spawned',
        id,
        label: typeof row.label === 'string' ? row.label : id,
        runtime: 'claude-code',
        ...(start ? { at: start } : {}),
      })
      events.push({ kind: 'metered', id, spend: { usdKnown: false, tokensKnown: false } })
    } else if (row.type === 'result' || row.type === 'error' || row.type === 'cancelled') {
      const activity = tails.get(id)?.activity.lastActivityAt
      const at = activity === undefined ? undefined : new Date(activity).toISOString()
      const reason = typeof row.reason === 'string' ? { reason: row.reason } : {}
      events.push(
        row.type === 'cancelled'
          ? { kind: 'cancelled', id, ...(at ? { at } : {}), ...reason }
          : {
              kind: 'settled',
              id,
              status: row.type === 'error' ? 'down' : 'done',
              ...(at ? { at } : {}),
              spent: { usdKnown: false, tokensKnown: false },
              ...reason,
            },
      )
    }
  }
  return { id: basename(runDir), events, tails, first, last }
}
