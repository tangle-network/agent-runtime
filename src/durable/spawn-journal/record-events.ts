import { isRecord } from '@tangle-network/agent-core'
import type { SpawnEvent } from '../../runtime/supervise/types'

/** Decode the file journal's historical single-event and atomic-group envelopes. @internal */
export function spawnJournalRecordEvents(record: unknown): ReadonlyArray<SpawnEvent> {
  if (!isRecord(record)) throw new Error('spawn journal corrupted: record must be an object')
  if (record.kind === 'begin') return []
  if (record.kind === 'event') return [record.event as SpawnEvent]
  if (record.kind !== 'events') {
    throw new Error(`spawn journal corrupted: unknown record kind '${String(record.kind)}'`)
  }
  if (!Array.isArray(record.events)) throw new Error('spawn journal group has no events array')
  return record.events as SpawnEvent[]
}
