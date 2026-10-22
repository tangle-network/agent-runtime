import {
  closeSync,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  openSync,
  readSync,
  writeSync,
} from 'node:fs'
import { fenceRunWrite } from './run-fence'

/** Commit JSONL bytes and validate their descriptor under one generation fence. @internal */
export function commitJsonLine<T>(
  path: string,
  record: unknown,
  acknowledge?: (fd: number) => T,
): T | undefined {
  const encoded = JSON.stringify(record)
  if (encoded === undefined) throw new TypeError('JSONL records must be JSON serializable')
  return fenceRunWrite(() => {
    const separator = prepareJsonlTail(path)
    const fd = openSync(path, 'a')
    try {
      const bytes = Buffer.from(`${separator ? '\n' : ''}${encoded}\n`)
      let offset = 0
      while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset)
        if (written <= 0)
          throw new Error(`append-only file write made no progress at byte ${offset}`)
        offset += written
      }
      fsyncSync(fd)
      return acknowledge?.(fd)
    } finally {
      closeSync(fd)
    }
  })
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
