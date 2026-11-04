import {
  closeSync,
  fstatSync,
  fsync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs'
import { promisify } from 'node:util'
import { fenceRunWrite } from './run-fence'

/** Append one JSONL record under the caller's existing single-writer discipline.
 * The caller creates the parent directory. Recover only an uncommitted tail and handle short
 * writes under one generation fence; fsync after the fence, off the event loop (#2362), and
 * resolve only once the bytes are durable. An optional acknowledgement reads the same open
 * descriptor inside the fence (the spawn journal validates its file stamp here).
 * @internal
 */
export function appendCommittedJsonLine(path: string, record: unknown): Promise<void>
export function appendCommittedJsonLine<T>(
  path: string,
  record: unknown,
  acknowledge: (fd: number) => T,
): Promise<T>
export async function appendCommittedJsonLine<T>(
  path: string,
  record: unknown,
  acknowledge?: (fd: number) => T,
): Promise<T | undefined> {
  const encoded = JSON.stringify(record)
  if (encoded === undefined) throw new TypeError('JSONL records must be JSON serializable')
  let fd: number | undefined
  try {
    const acknowledged = fenceRunWrite(() => {
      const bytes = Buffer.from(`${prepareJsonlTail(path) ? '\n' : ''}${encoded}\n`)
      fd = openSync(path, 'a')
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset)
        if (written <= 0)
          throw new Error(`append-only file write made no progress at byte ${offset}`)
        offset += written
      }
      return acknowledge?.(fd)
    })
    await promisify(fsync)(fd as number)
    return acknowledged
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
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
