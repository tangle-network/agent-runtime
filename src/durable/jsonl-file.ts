import type { FileHandle } from 'node:fs/promises'

/** Parse an append-only JSONL file without treating a torn final write as committed data.
 * A malformed newline-terminated or non-final record is corruption and fails loud. */
export function parseCommittedJsonLines<T>(text: string, source: string): T[] {
  const lines = text.split('\n')
  const finalIndex = lines.length - 1
  const records: T[] = []

  for (const [index, line] of lines.entries()) {
    if (line.length === 0) continue
    try {
      records.push(JSON.parse(line) as T)
    } catch (cause) {
      const isInvalidUnterminatedTail = index === finalIndex && !text.endsWith('\n')
      if (isInvalidUnterminatedTail) break
      throw new Error(`${source}: malformed JSONL record at line ${index + 1}`, { cause })
    }
  }

  return records
}

/** FileHandle.write may legally make a short write. Loop until every byte is appended. */
export async function writeAllBytes(
  handle: Pick<FileHandle, 'write'>,
  value: string | Uint8Array,
): Promise<void> {
  const bytes = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
  let offset = 0
  while (offset < bytes.byteLength) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.byteLength - offset, null)
    if (bytesWritten <= 0) {
      throw new Error(`append-only file write made no progress at byte ${offset}`)
    }
    offset += bytesWritten
  }
}

/** Prepare the tail under the journal owner's existing single-writer discipline.
 * Healthy appends read one byte, regardless of history size. Only recovery scans backward,
 * retaining a valid unterminated value or truncating an uncommitted torn tail. */
export async function prepareJsonlAppend(path: string): Promise<boolean> {
  const fs = await import('node:fs/promises')
  let handle: FileHandle
  try {
    handle = await fs.open(path, 'r+')
  } catch (error) {
    if (isNoEntError(error)) return false
    throw error
  }
  try {
    const size = (await handle.stat()).size
    if (size === 0) return false
    const lastByte = Buffer.allocUnsafe(1)
    await readAt(handle, lastByte, size - 1)
    if (lastByte[0] === 0x0a) return false

    const chunks: Buffer[] = []
    let end = size
    let tailStart = 0
    while (end > 0) {
      const start = Math.max(0, end - 65_536)
      const chunk = Buffer.allocUnsafe(end - start)
      await readAt(handle, chunk, start)
      const newline = chunk.lastIndexOf(0x0a)
      chunks.push(chunk.subarray(newline + 1))
      if (newline >= 0) {
        tailStart = start + newline + 1
        break
      }
      end = start
    }
    const tail = Buffer.concat(chunks.reverse()).toString('utf8')
    try {
      JSON.parse(tail)
      return true
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      await handle.truncate(tailStart)
      await handle.sync()
      return false
    }
  } finally {
    await handle.close()
  }
}

/** A short read is legal; an unexpected EOF means the owner's snapshot changed. */
async function readAt(handle: FileHandle, buffer: Buffer, position: number): Promise<void> {
  let offset = 0
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      offset,
      buffer.length - offset,
      position + offset,
    )
    if (bytesRead === 0) throw new Error('journal changed while preparing its append tail')
    offset += bytesRead
  }
}

/** True for a filesystem error meaning "the file is not there yet" — the one condition an
 *  append-only reader treats as an empty log rather than a fault. */
export function isNoEntError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  )
}
