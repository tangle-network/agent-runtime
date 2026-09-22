import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, resolve } from 'node:path'

/**
 * Create a directory and commit its directory entry before a caller writes children into it.
 * The parent sync covers the case where this call created the directory itself.
 */
export function ensureDurableDirectory(directory: string): void {
  const absolute = resolve(directory)
  const missing: string[] = []
  let cursor = absolute
  while (!existsSync(cursor)) {
    missing.push(cursor)
    const parent = dirname(cursor)
    if (parent === cursor) break
    cursor = parent
  }
  mkdirSync(absolute, { recursive: true })
  for (const created of missing.reverse()) {
    syncDirectory(created)
    const parent = dirname(created)
    if (parent !== created) syncDirectory(parent)
  }
  if (missing.length === 0) syncDirectory(absolute)
}

/**
 * Append bytes and commit both the file and its directory entry.
 *
 * A process can die after writing a partial final JSONL record.
 * Add a separator before the next append so that the old partial record remains ignorable and the new record remains readable.
 */
export function appendFileDurably(file: string, contents: string): void {
  const directory = dirname(file)
  ensureDurableDirectory(directory)
  const fd = openSync(file, 'a+', 0o600)
  try {
    const size = fstatSync(fd).size
    if (size > 0) {
      const lastByte = Buffer.alloc(1)
      readSync(fd, lastByte, 0, 1, size - 1)
      if (lastByte[0] !== 0x0a) writeAll(fd, '\n')
    }
    writeAll(fd, contents)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  syncDirectory(directory)
}

/** Create one durable file only when no process has claimed its path yet. */
export function createFileDurably(file: string, contents: string): boolean {
  const directory = dirname(file)
  ensureDurableDirectory(directory)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'wx', 0o600)
    try {
      writeAll(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      linkSync(temporary, file)
    } catch (error) {
      if (isAlreadyExistsError(error)) return false
      throw error
    }
    syncDirectory(directory)
    return true
  } finally {
    if (existsSync(temporary)) {
      unlinkSync(temporary)
      syncDirectory(directory)
    }
  }
}

/** Replace a file atomically and commit the replacement at the filesystem boundary. */
export function replaceFileDurably(file: string, contents: string): void {
  const directory = dirname(file)
  ensureDurableDirectory(directory)
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    const fd = openSync(temporary, 'w', 0o600)
    try {
      writeAll(fd, contents)
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(temporary, file)
    syncDirectory(directory)
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary)
  }
}

function writeAll(fd: number, contents: string): void {
  const bytes = Buffer.from(contents, 'utf8')
  let offset = 0
  while (offset < bytes.length) {
    offset += writeSync(fd, bytes, offset, bytes.length - offset)
  }
}

function syncDirectory(directory: string): void {
  const fd = openSync(directory, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}
