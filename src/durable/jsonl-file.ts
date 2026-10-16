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
  options: {
    allowMissing?: boolean
    allowWhitespaceLines?: boolean
    onBytes?: (bytes: Uint8Array) => void
  } = {},
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
          const record = parseRecord<T>(
            fragments.join(''),
            path,
            lineNumber++,
            true,
            options.allowWhitespaceLines,
          )
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
      const record = parseRecord<T>(
        fragments.join(''),
        path,
        lineNumber,
        false,
        options.allowWhitespaceLines,
      )
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
  allowWhitespaceLines = false,
): { value: T } | undefined {
  if (line.length === 0 || (allowWhitespaceLines && line.trim().length === 0)) return undefined
  try {
    return { value: JSON.parse(line) as T }
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause
    if (!terminated) return undefined
    throw new Error(`${source}: malformed JSONL record at line ${lineNumber}`, { cause })
  }
}

/** Append one JSONL record under the caller's existing single-writer discipline.
 * The caller creates the parent directory. Recover only an uncommitted tail, handle short
 * writes, and fsync before acknowledging.
 * An optional acknowledgement reads the same open descriptor after sync (the spawn journal
 * validates its file stamp here). Queueing, validation, and failure policy belong to the owner.
 * @internal
 */
export function appendCommittedJsonLine(path: string, record: unknown): Promise<void>
export function appendCommittedJsonLine<T>(
  path: string,
  record: unknown,
  acknowledge: (handle: FileHandle) => Promise<T>,
): Promise<T>
export async function appendCommittedJsonLine<T>(
  path: string,
  record: unknown,
  acknowledge?: (handle: FileHandle) => Promise<T>,
): Promise<T | undefined> {
  const fs = await import('node:fs/promises')
  const needsSeparator = await prepareJsonlAppend(path)
  const handle = await fs.open(path, 'a')
  try {
    await writeAllBytes(handle, `${needsSeparator ? '\n' : ''}${JSON.stringify(record)}\n`)
    await handle.sync()
    return await acknowledge?.(handle)
  } finally {
    await handle.close()
  }
}

/** Serialize JSONL file updates across processes and aliases using Eval's existing file lock.
 * The caller owns validation and the record format. The lock path names the canonical file,
 * including its first write, so two directory aliases cannot acquire different write heads.
 * @internal
 */
export async function withJsonlFileLock<T>(
  path: string,
  operation: (canonicalPath: string) => Promise<T>,
): Promise<T> {
  const fs = await import('node:fs/promises')
  const { dirname } = await import('node:path')
  const { tryAcquireAtomicFileLock } = await import('@tangle-network/agent-eval/ledger-core')
  await fs.mkdir(dirname(path), { recursive: true })
  const file = await fs.open(path, 'a')
  await file.close()
  const canonicalPath = await fs.realpath(path)
  const deadline = Date.now() + 5000
  for (;;) {
    const acquisition = tryAcquireAtomicFileLock({ lockPath: `${canonicalPath}.lock` })
    if (!acquisition.acquired) {
      if (Date.now() >= deadline) {
        throw new Error(`journal file lock unavailable after 5000ms: ${canonicalPath}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
      continue
    }
    try {
      return await operation(canonicalPath)
    } finally {
      acquisition.lock.release()
    }
  }
}

/** Read one keyed registry snapshot without an extra whole-file text allocation.
 * Historical registry files allow whitespace-only separators; append journals remain strict.
 * @internal
 */
export async function readCommittedJsonFile<T>(path: string): Promise<T[]> {
  const records: T[] = []
  for await (const record of readCommittedJsonLines<T>(path, {
    allowMissing: true,
    allowWhitespaceLines: true,
  })) {
    records.push(record)
  }
  return records
}

/** Replace one keyed row and publish one durable snapshot. The caller holds the file lock.
 * Keep unrelated rows in order and put the replacement last. No revision archive is retained.
 * @internal
 */
export async function upsertCommittedJsonLine<T>(
  path: string,
  record: T,
  key: (record: T) => string,
): Promise<void> {
  const encoded = JSON.stringify(record)
  if (encoded === undefined) throw new Error('JSONL records must be JSON serializable')
  const snapshot: T = JSON.parse(encoded)
  const id = key(snapshot)
  const updated: T[] = []
  for await (const prior of readCommittedJsonLines<T>(path, {
    allowMissing: true,
    allowWhitespaceLines: true,
  })) {
    if (key(prior) !== id) updated.push(prior)
  }
  updated.push(snapshot)
  // Reuse Runtime's file publication owner; this module owns JSONL framing, not another
  // durability implementation. Preserve the existing snapshot's permissions across rename.
  const { writeAtomicDurableFile } = await import('../runtime/supervise/durable-file')
  writeAtomicDurableFile(path, `${updated.map((row) => JSON.stringify(row)).join('\n')}\n`, {
    preserveMode: true,
  })
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
