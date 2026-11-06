import { createHash } from 'node:crypto'
import type { BigIntStats } from 'node:fs'
import { type FileHandle, open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { isRecord } from '@tangle-network/agent-core'
import type { NodeId, SpawnEvent } from '../../runtime/supervise/types'
import { isNoEntError, readCommittedJsonLines } from '../jsonl-file'
import { spawnJournalRecordEvents } from './record-events'

/** Serializable checkpoint of a committed byte boundary, bound to one file and its bytes. */
export interface SpawnJournalCursor {
  readonly file: string
  readonly offset: number
  readonly boundary: string
}

/** Physical groups expand to event records; the owning tree is preserved for every event. */
export type SpawnJournalReadRecord =
  | { readonly kind: 'begin'; readonly root: NodeId; readonly at: string }
  | { readonly kind: 'event'; readonly root: NodeId; readonly event: SpawnEvent }

export interface SpawnJournalReadOptions {
  /** Read-only projections may skip malformed physical rows; execution readers stay strict. */
  readonly invalid?: 'throw' | 'skip'
  readonly after?: SpawnJournalCursor
  /** Initial opening-and-tail window, or an incremental page's byte budget. A crossing record
   * is read whole, so one large record can exceed this budget. Omit for complete history. */
  readonly tailBytes?: number
}

export interface SpawnJournalReadResult {
  readonly records: ReadonlyArray<SpawnJournalReadRecord>
  /** Absent only when the journal does not exist. Treat as opaque and persist unchanged. */
  readonly cursor?: SpawnJournalCursor
  /** The supplied cursor no longer matches; this page starts over. */
  readonly reset: boolean
  /** An initial opening-and-tail window omitted records between its two windows. */
  readonly truncated: boolean
  /** Bytes after the committed cursor in this snapshot, including an incomplete final write. */
  readonly remainingBytes: number
}

/** Read a fixed journal prefix, with historical envelopes and framing owned by Runtime.
 * Missing journals return an empty page. Malformed committed records fail by default; incomplete final
 * writes remain unread for the next call. Cursors detect replacement, truncation and edits at
 * their sampled opening/boundary; they are not integrity proofs against arbitrary file edits.
 */
export async function readSpawnJournal(
  runDir: string,
  options: SpawnJournalReadOptions = {},
): Promise<SpawnJournalReadResult> {
  const { after, tailBytes } = options
  if (tailBytes !== undefined && (!Number.isSafeInteger(tailBytes) || tailBytes < 1)) {
    throw new RangeError('readSpawnJournal: tailBytes must be a positive safe integer')
  }
  const path = join(runDir, 'spawn-journal.jsonl')
  let handle: FileHandle
  try {
    handle = await open(path, 'r')
  } catch (error) {
    if (isNoEntError(error)) {
      return { records: [], reset: after !== undefined, truncated: false, remainingBytes: 0 }
    }
    throw error
  }
  try {
    const snapshot = await handle.stat({ bigint: true })
    if (!snapshot.isFile()) throw new Error(`${path}: expected a regular file`)
    const size = Number(snapshot.size)
    const file = identity(snapshot)
    const resumed =
      after !== undefined &&
      after.file === file &&
      Number.isSafeInteger(after.offset) &&
      after.offset >= 0 &&
      after.offset <= size &&
      after.boundary === (await boundary(handle, after.offset))
    let offset = resumed ? after.offset : 0
    const records: SpawnJournalReadRecord[] = []
    const read = async (start: number, end: number, firstOnly = false): Promise<void> => {
      offset = start
      for await (const record of readCommittedJsonLines<unknown>(path, {
        handle,
        start,
        end,
        strictUtf8: true,
        invalid: options.invalid,
        onCommit: (committed) => {
          offset = committed
        },
      })) {
        if (
          !isRecord(record) ||
          typeof record.root !== 'string' ||
          (record.kind === 'begin' && typeof record.at !== 'string')
        ) {
          if (options.invalid === 'skip') continue
          throw new Error(`${path}: spawn journal record has no root or begin timestamp`)
        }
        if (record.kind === 'begin') {
          records.push({ kind: 'begin', root: record.root, at: record.at as string })
        } else {
          for (const event of spawnJournalRecordEvents(record, options.invalid))
            records.push({ kind: 'event', root: record.root, event })
        }
        if (firstOnly) break
      }
    }
    let truncated = false
    if (!resumed && tailBytes !== undefined && size > tailBytes) {
      await read(0, size, true)
      const openingEnd = offset
      const tailStart = await lineBoundary(handle, size - tailBytes, size, -1)
      truncated = tailStart > openingEnd
      await read(Math.max(openingEnd, tailStart), size)
      // A long torn tail must not hide the latest committed activity before it.
      if (offset === tailStart && tailStart > openingEnd) {
        const previous = await lineBoundary(handle, tailStart - 1, size, -1)
        truncated = previous > openingEnd
        await read(Math.max(openingEnd, previous), tailStart)
      }
    } else {
      const end =
        resumed && tailBytes !== undefined && size - offset > tailBytes
          ? await lineBoundary(handle, offset + tailBytes, size, 1)
          : size
      await read(offset, end)
    }
    if (identity(await stat(path, { bigint: true })) !== file || (await handle.stat()).size < size)
      throw new Error(`${path}: journal changed while reading its committed prefix`)
    return {
      records,
      cursor: { file, offset, boundary: await boundary(handle, offset) },
      reset: after !== undefined && !resumed,
      truncated,
      remainingBytes: size - offset,
    }
  } finally {
    await handle.close()
  }
}

function identity(info: BigIntStats): string {
  return `${info.dev}:${info.ino}:${info.birthtimeNs}`
}

async function bytes(handle: FileHandle, start: number, length: number): Promise<Buffer> {
  const buffer = Buffer.alloc(length)
  const { bytesRead } = await handle.read(buffer, 0, length, start)
  if (bytesRead !== length) throw new Error('spawn journal changed while reading its boundary')
  return buffer
}

async function boundary(handle: FileHandle, offset: number): Promise<string> {
  const length = Math.min(offset, 128)
  return createHash('sha256')
    .update(await bytes(handle, 0, length))
    .update(await bytes(handle, offset - length, length))
    .digest('hex')
}

/** Include the record crossing a tail window or incremental page boundary. */
async function lineBoundary(
  handle: FileHandle,
  position: number,
  size: number,
  direction: -1 | 1,
): Promise<number> {
  while (position > 0 && position < size) {
    const start = direction === -1 ? Math.max(0, position - 65_536) : position
    const end = direction === -1 ? position : Math.min(size, position + 65_536)
    const part = await bytes(handle, start, end - start)
    const newline = direction === -1 ? part.lastIndexOf(10) : part.indexOf(10)
    if (newline !== -1) return start + newline + 1
    position = direction === -1 ? start : end
  }
  return position
}
