import {
  type BigIntStats,
  closeSync,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  statSync,
  writeSync,
} from 'node:fs'
import { promisify } from 'node:util'
import { durableCallAsync, routesToDurableWriter } from './durable-writer'
import { fenceRunWrite } from './run-fence'

/** Append one JSONL record under the caller's existing single-writer discipline.
 * The caller creates the parent directory. Recover only an uncommitted tail and handle short
 * writes under one generation fence; fsync after the fence, off the event loop (#2362), and
 * resolve only once the bytes are durable. A claimed append made on the main thread runs on the
 * durable writer (durable-writer.ts). With `journalStamp`, the append also proves, inside the
 * fence, that the file it wrote is still the one at `path`, and resolves with that file's stamp.
 * @internal
 */
export function appendCommittedJsonLine(path: string, record: unknown): Promise<undefined>
export function appendCommittedJsonLine(
  path: string,
  record: unknown,
  options: { readonly journalStamp: true },
): Promise<string>
export async function appendCommittedJsonLine(
  path: string,
  record: unknown,
  options: { readonly journalStamp?: boolean } = {},
): Promise<string | undefined> {
  const encoded = JSON.stringify(record)
  if (encoded === undefined) throw new TypeError('JSONL records must be JSON serializable')
  const stamp = options.journalStamp === true
  if (routesToDurableWriter())
    return durableCallAsync({ name: 'appendCommittedLine', args: [path, encoded, stamp] })
  const written = writeCommittedLine(path, encoded, stamp)
  try {
    await promisify(fsync)(written.fd)
    return written.stamp
  } finally {
    closeSync(written.fd)
  }
}

/** The committed append the durable writer runs: the fenced write, then its fsync on that thread. @internal */
export function appendCommittedLine(
  path: string,
  encoded: string,
  journalStamp: boolean,
): string | undefined {
  const written = writeCommittedLine(path, encoded, journalStamp)
  try {
    fsyncSync(written.fd)
    return written.stamp
  } finally {
    closeSync(written.fd)
  }
}

/** Under one fence: recover the tail, write the whole line, and stamp the file when asked. */
function writeCommittedLine(
  path: string,
  encoded: string,
  journalStamp: boolean,
): { fd: number; stamp?: string } {
  let fd: number | undefined
  try {
    return fenceRunWrite(() => {
      const bytes = Buffer.from(`${prepareJsonlTail(path) ? '\n' : ''}${encoded}\n`)
      fd = openSync(path, 'a')
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset)
        if (written <= 0)
          throw new Error(`append-only file write made no progress at byte ${offset}`)
        offset += written
      }
      if (!journalStamp) return { fd }
      const stamp = journalFileStamp(fstatSync(fd, { bigint: true }))
      if (journalFileStamp(statSync(path, { bigint: true })) !== stamp) {
        throw new Error('spawn journal changed while acknowledging its append')
      }
      return { fd, stamp }
    })
  } catch (error) {
    if (fd !== undefined) closeSync(fd)
    throw error
  }
}

/** Detect replacement, truncation, and same-size edits; this is not a cross-process write lock. @internal */
export function journalFileStamp(stat: BigIntStats): string {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`
}

/** Recover only an uncommitted tail. Caller holds the generation fence. @internal */
export function prepareJsonlTail(path: string): boolean {
  let fd: number
  try {
    fd = openSync(path, 'r+')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  try {
    const size = fstatSync(fd).size
    if (size === 0) return false
    const last = Buffer.allocUnsafe(1)
    readAt(fd, last, size - 1)
    if (last[0] === 0x0a) return false
    const chunks: Buffer[] = []
    let end = size
    let tailStart = 0
    while (end > 0) {
      const start = Math.max(0, end - 65_536)
      const chunk = Buffer.allocUnsafe(end - start)
      readAt(fd, chunk, start)
      const newline = chunk.lastIndexOf(0x0a)
      chunks.push(chunk.subarray(newline + 1))
      if (newline >= 0) {
        tailStart = start + newline + 1
        break
      }
      end = start
    }
    try {
      JSON.parse(Buffer.concat(chunks.reverse()).toString('utf8'))
      return true
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      ftruncateSync(fd, tailStart)
      fsyncSync(fd)
      return false
    }
  } finally {
    closeSync(fd)
  }
}

function readAt(fd: number, buffer: Buffer, position: number): void {
  let offset = 0
  while (offset < buffer.length) {
    const read = readSync(fd, buffer, offset, buffer.length - offset, position + offset)
    if (read === 0) throw new Error('journal changed while preparing its append tail')
    offset += read
  }
}
