import { isRecord } from '@tangle-network/agent-core'
import type { SpawnEvent } from '../../runtime/supervise/types'

/** Decode historical envelopes; readers own event validation. @internal */
export function spawnJournalRecordEvents(
  record: unknown,
  invalid: 'throw' | 'skip' = 'throw',
): ReadonlyArray<SpawnEvent> {
  const corrupt = (reason: string): ReadonlyArray<SpawnEvent> => {
    if (invalid === 'skip') return []
    throw new Error(`spawn journal corrupted: ${reason}`)
  }
  if (!isRecord(record)) return corrupt('record must be an object')
  if (record.kind === 'begin') return []
  const single = record.kind === 'event' || (record.kind === undefined && 'event' in record)
  if (!single && record.kind !== 'events')
    return corrupt(`unknown record kind '${String(record.kind)}'`)
  const events = single ? [record.event] : record.events
  if (!Array.isArray(events)) return corrupt('group has no events array')
  return events as SpawnEvent[]
}
