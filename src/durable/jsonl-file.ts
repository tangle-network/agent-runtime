import type { FileHandle } from 'node:fs/promises'

/** Parse in-memory evidence with the same commit boundary as streamed journal reads. */
export function parseCommittedJsonLines<T>(text: string, source: string): T[] {
  const lines = text.split('\n')
  const records: T[] = []
  for (const [index, line] of lines.entries()) {
    const record = parseRecord<T>(line, source, index + 1, index < lines.length - 1)
    if (record !== undefined) records.push(record.value)
  }
  return records
}

/** Read a fixed file prefix one record at a time, never allocating the whole journal as a string.
 * A reader cannot chase concurrent appends forever. Missing files are empty only when requested;
 * corruption, short reads, and other I/O errors remain failures. Closing the iterator closes the fd. */
export async function* readCommittedJsonLines<T>(
  path: string,
  options: { allowMissing?: boolean; onBytes?: (bytes: Uint8Array) => void } = {},
): AsyncGenerator<T> {
  const fs = await import('node:fs/promises')
  let handle: FileHandle
  try {
    handle = await fs.open(path, 'r')
  } catch (error) {
    if (options.allowMissing && isNoEntError(error)) return
    throw error
  }
  try {
    const { size } = await handle.stat()
    if (size === 0) return
    const { StringDecoder } = await import('node:string_decoder')
    const decoder = new StringDecoder('utf8')
    const stream = handle.createReadStream({ autoClose: false, end: size - 1 })
    const fragments: string[] = []
    let lineNumber = 1
    try {
      for await (const chunk of stream) {
        options.onBytes?.(chunk as Buffer)
        const text = decoder.write(chunk as Buffer)
        let start = 0
        let end = text.indexOf('\n', start)
        while (end !== -1) {
          fragments.push(text.slice(start, end))
          const record = parseRecord<T>(fragments.join(''), path, lineNumber++, true)
          fragments.length = 0
          if (record !== undefined) yield record.value
          start = end + 1
          end = text.indexOf('\n', start)
        }
        if (start < text.length) fragments.push(text.slice(start))
      }
      if (stream.bytesRead !== size) {
        throw new Error(`${path}: journal changed while reading its committed prefix`)
      }
      fragments.push(decoder.end())
      const record = parseRecord<T>(fragments.join(''), path, lineNumber, false)
      if (record !== undefined) yield record.value
    } finally {
      stream.destroy()
    }
  } finally {
    await handle.close()
  }
}

/** An invalid unterminated tail may be a torn write; other parse failures are not evidence of one. */
function parseRecord<T>(
  line: string,
  source: string,
  lineNumber: number,
  terminated: boolean,
): { value: T } | undefined {
  if (line.length === 0) return undefined
  try {
    return { value: JSON.parse(line) as T }
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause
    if (!terminated) return undefined
    throw new Error(`${source}: malformed JSONL record at line ${lineNumber}`, { cause })
  }
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
