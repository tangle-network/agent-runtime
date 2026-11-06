import type { FileHandle } from 'node:fs/promises'
import { prepareJsonlTail } from './jsonl-append'
import { fenceRunWrite } from './run-fence'

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
    invalid?: 'throw' | 'skip'
    onBytes?: (bytes: Uint8Array) => void
    /** Internal fixed-prefix range. The caller supplies a record boundary and owns the handle. */
    handle?: FileHandle
    start?: number
    end?: number
    strictUtf8?: boolean
    onCommit?: (offset: number) => void
  } = {},
): AsyncGenerator<T> {
  const fs = await import('node:fs/promises')
  let handle: FileHandle
  try {
    handle = options.handle ?? (await fs.open(path, 'r'))
  } catch (error) {
    if (options.allowMissing && isNoEntError(error)) return
    throw error
  }
  try {
    const start = options.start ?? 0
    const end = options.end ?? (await handle.stat()).size
    if (end <= start) return
    const fragments: Buffer[] = []
    let offset = start
    let lineNumber = 1
    const parse = (terminated: boolean): { value: T } | undefined => {
      const bytes = Buffer.concat(fragments)
      let line: string
      try {
        line = options.strictUtf8
          ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
          : bytes.toString('utf8')
      } catch (cause) {
        if (!terminated || (options.invalid === 'skip' && cause instanceof TypeError))
          return undefined
        throw new Error(`${path}: malformed UTF-8 at line ${lineNumber}`, { cause })
      }
      return parseRecord<T>(
        line,
        path,
        lineNumber++,
        terminated,
        options.allowWhitespaceLines,
        options.invalid,
      )
    }
    let position = start
    while (position < end) {
      const buffer = Buffer.alloc(Math.min(65_536, end - position))
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (bytesRead === 0) {
        throw new Error(`${path}: journal changed while reading its committed prefix`)
      }
      position += bytesRead
      const bytes = buffer.subarray(0, bytesRead)
      options.onBytes?.(bytes)
      let start = 0
      for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
        fragments.push(bytes.subarray(start, end))
        const record = parse(true)
        offset += fragments.reduce((size, part) => size + part.length, 0) + 1
        fragments.length = 0
        options.onCommit?.(offset)
        if (record !== undefined) yield record.value
        start = end + 1
      }
      if (start < bytes.length) fragments.push(bytes.subarray(start))
    }
    const record = parse(false)
    if (record !== undefined) {
      options.onCommit?.(end)
      yield record.value
    }
  } finally {
    if (options.handle === undefined) await handle.close()
  }
}

/** An invalid unterminated tail may be a torn write; other parse failures are not evidence of one. */
function parseRecord<T>(
  line: string,
  source: string,
  lineNumber: number,
  terminated: boolean,
  allowWhitespaceLines = false,
  invalid: 'throw' | 'skip' = 'throw',
): { value: T } | undefined {
  if (line.length === 0 || (allowWhitespaceLines && line.trim().length === 0)) return undefined
  try {
    return { value: JSON.parse(line) as T }
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause
    if (!terminated || invalid === 'skip') return undefined
    throw new Error(`${source}: malformed JSONL record at line ${lineNumber}`, { cause })
  }
}

export { appendCommittedJsonLine } from './jsonl-append'

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

/** Recover a torn tail under the same generation fence as durable publications. @internal */
export async function prepareJsonlAppend(path: string): Promise<boolean> {
  return fenceRunWrite(() => prepareJsonlTail(path))
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
