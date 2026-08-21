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

/** Prepare a recovered JSONL file for its next append. A valid unterminated final value is retained
 * and needs a separator; an invalid unterminated tail was never committed and is truncated. */
export async function prepareJsonlAppend(path: string): Promise<boolean> {
  const fs = await import('node:fs/promises')
  let bytes: Buffer
  try {
    bytes = await fs.readFile(path)
  } catch (error) {
    if (isNoEntError(error)) return false
    throw error
  }
  if (bytes.byteLength === 0 || bytes[bytes.byteLength - 1] === 0x0a) return false

  const lastNewline = bytes.lastIndexOf(0x0a)
  const tail = bytes.subarray(lastNewline + 1).toString('utf8')
  try {
    JSON.parse(tail)
    return true
  } catch {
    await fs.truncate(path, lastNewline + 1)
    return false
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
