import { type BigIntStats, fstatSync, statSync } from 'node:fs'
import { detachedSnapshot } from '../../runtime/supervise/snapshot'
import type { NodeId, SpawnEvent, SpawnJournal } from '../../runtime/supervise/types'
import { appendCommittedJsonLine, isNoEntError, readCommittedJsonLines } from '../jsonl-file'
import { captureRunWriteContext } from '../run-fence'
import { SpawnEventIndex } from './event-index'

/**
 * Append every event as one grouped publication where the journal supports it (`appendEvents`),
 * preserving legacy per-event appends otherwise — the SQL contexts' fenced head advances once.
 * @internal
 */
export async function appendSpawnEvents(
  journal: SpawnJournal,
  root: NodeId,
  events: ReadonlyArray<SpawnEvent>,
): Promise<void> {
  if (journal.appendEvents !== undefined) return journal.appendEvents(root, events)
  for (const event of events) await journal.appendEvent(root, event)
}

/**
 * JSONL on disk. One line per record: the first record is `begin`, subsequent records
 * are `event` envelopes wrapping a `SpawnEvent`. `loadTree` replays the whole file,
 * filtering by `root`, and applies the same begin-precedes-events + unique-seq
 * corruption guards as the in-memory impl. Each append fsyncs so a crash between
 * writes never loses an acknowledged event.
 *
 * @stable
 */
export class FileSpawnJournal implements SpawnJournal {
  private readonly writeContext = captureRunWriteContext()
  private appendTail: Promise<void> = Promise.resolve()
  // Rebuildable validation state, not another journal or a copy of event payloads.
  private appendIndex:
    | { stamp: string | undefined; trees: Map<NodeId, { begunAt: string; index: SpawnEventIndex }> }
    | undefined

  constructor(private readonly path: string) {}

  async loadTree(root: NodeId): Promise<SpawnEvent[] | undefined> {
    let begun = false
    const events: SpawnEvent[] = []
    const index = new SpawnEventIndex(root)
    for await (const record of readCommittedJsonLines<SpawnJournalRecord>(this.path, {
      allowMissing: true,
    })) {
      if (record.root !== root) continue
      if (record.kind === 'begin') {
        begun = true
      } else {
        if (!begun) {
          throw new Error(
            `spawn journal corrupted: event for tree '${root}' precedes its begin record`,
          )
        }
        index.assert(record.event)
        index.add(record.event)
        events.push(record.event)
      }
    }
    return begun ? events : undefined
  }

  async beginTree(root: NodeId, at: string): Promise<void> {
    return this.serializeAppend(async () => {
      const state = await this.validationIndex()
      const existing = state.trees.get(root)
      if (existing) {
        if (existing.begunAt !== at) {
          throw new Error(
            `spawn tree '${root}' already begun in ${this.path} at ${existing.begunAt}; refusing to overwrite with ${at}`,
          )
        }
        return
      }
      state.stamp = await this.writeRecord({ kind: 'begin', root, at })
      state.trees.set(root, { begunAt: at, index: new SpawnEventIndex(root) })
    })
  }

  async appendEvent(root: NodeId, ev: SpawnEvent): Promise<void> {
    const event = detachedSnapshot(ev, 'spawn event')
    return this.serializeAppend(async () => {
      const state = await this.validationIndex()
      const tree = state.trees.get(root)
      if (tree === undefined) {
        throw new Error(`appendEvent called for unknown spawn tree '${root}'; call beginTree first`)
      }
      tree.index.assert(event)
      state.stamp = await this.writeRecord({ kind: 'event', root, event })
      // An unacknowledged append cannot advance validation state. A failed write invalidates
      // the index, so recovery reads the actual committed bytes before admitting another event.
      tree.index.add(event)
    })
  }

  private async validationIndex() {
    const stamp = await this.fileStamp()
    if (this.appendIndex && this.appendIndex.stamp === stamp) return this.appendIndex
    this.appendIndex = undefined
    const trees = new Map<NodeId, { begunAt: string; index: SpawnEventIndex }>()
    if (stamp !== undefined) {
      for await (const record of readCommittedJsonLines<SpawnJournalRecord>(this.path)) {
        if (record.kind === 'begin') {
          if (!trees.has(record.root)) {
            trees.set(record.root, { begunAt: record.at, index: new SpawnEventIndex(record.root) })
          }
        } else {
          const tree = trees.get(record.root)
          if (!tree) {
            throw new Error(
              `spawn journal corrupted: event for tree '${record.root}' precedes its begin record`,
            )
          }
          tree.index.assert(record.event)
          tree.index.add(record.event)
        }
      }
    }
    if ((await this.fileStamp()) !== stamp) {
      throw new Error('spawn journal changed while rebuilding its append index')
    }
    this.appendIndex = { stamp, trees }
    return this.appendIndex
  }

  private async fileStamp(): Promise<string | undefined> {
    const fs = await import('node:fs/promises')
    try {
      return journalFileStamp(await fs.stat(this.path, { bigint: true }))
    } catch (error) {
      if (isNoEntError(error)) return undefined
      throw error
    }
  }

  private async serializeAppend(operation: () => Promise<void>): Promise<void> {
    const append = this.appendTail.then(() => this.writeContext(operation))
    this.appendTail = append.catch(() => undefined)
    return append
  }

  private async writeRecord(record: SpawnJournalRecord): Promise<string> {
    const fs = await import('node:fs/promises')
    const { dirname } = await import('node:path')
    try {
      await fs.mkdir(dirname(this.path), { recursive: true })
      return await appendCommittedJsonLine(this.path, record, (fd) => {
        const stamp = journalFileStamp(fstatSync(fd, { bigint: true }))
        if (journalFileStamp(statSync(this.path, { bigint: true })) !== stamp) {
          throw new Error('spawn journal changed while acknowledging its append')
        }
        return stamp
      })
    } catch (error) {
      this.appendIndex = undefined
      throw error
    }
  }
}

/** Detect replacement, truncation, and same-size edits; this is not a cross-process write lock. */
function journalFileStamp(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

type SpawnJournalRecord =
  | { kind: 'begin'; root: NodeId; at: string }
  | { kind: 'event'; root: NodeId; event: SpawnEvent }
