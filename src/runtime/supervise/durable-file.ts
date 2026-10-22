/**
 * Small filesystem durability primitives for Runtime-owned state.
 *
 * Callers must validate their path and parent directory before invoking these functions.
 * The exclusive writer protects a no-clobber publication race; the atomic writer replaces one
 * state file after its temporary contents reach stable storage.
 *
 * @internal
 */

import { randomUUID } from 'node:crypto'
import {
  type BigIntStats,
  closeSync,
  existsSync,
  fchmodSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

interface DurableFileOptions {
  readonly mode?: number
}

/**
 * File content, or content computed from the new file's own stat when it must name the file's
 * inode (a lock record that later proves it was written for this very file).
 */
type DurableFileContent = string | ((file: BigIntStats) => string)

/**
 * Publish a new file without replacing a concurrent winner. The published entry is a hard link
 * of the temporary file, so a content function sees the published file's inode.
 */
export function publishExclusiveDurableFile(
  filePath: string,
  content: DurableFileContent,
  options: DurableFileOptions = {},
): boolean {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  let operationFailed = false
  let operationError: unknown
  let published = false
  try {
    writeExclusiveDurableFile(temporaryPath, content, options)
    try {
      linkSync(temporaryPath, filePath)
      syncDurableDirectory(dirname(filePath))
      published = true
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error
    }
  } catch (error) {
    operationFailed = true
    operationError = error
  }
  let cleanupError: unknown
  try {
    unlinkSync(temporaryPath)
  } catch (error) {
    if (!isNoEntryError(error)) cleanupError = error
  }
  if (operationFailed) throw operationError
  if (cleanupError !== undefined) throw cleanupError
  return published
}

/** Fsync a directory after publishing a durable file entry. */
export function syncDurableDirectory(directoryPath: string): void {
  const fd = openSync(directoryPath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Fsync one durable file after its contents reach stable storage. */
function syncDurableFile(filePath: string, exactMode?: number): void {
  const fd = openSync(filePath, 'r')
  try {
    if (exactMode !== undefined && process.platform !== 'win32') fchmodSync(fd, exactMode)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

/** Append one record with O_APPEND, then fsync the file and containing directory. */
export function appendDurableFile(
  filePath: string,
  content: string,
  options: DurableFileOptions = {},
): void {
  const flags =
    fsConstants.O_APPEND |
    fsConstants.O_CREAT |
    fsConstants.O_WRONLY |
    (typeof fsConstants.O_NOFOLLOW === 'number' ? fsConstants.O_NOFOLLOW : 0)
  const fd = openSync(filePath, flags, options.mode ?? 0o600)
  try {
    if (process.platform !== 'win32') fchmodSync(fd, options.mode ?? 0o600)
    const expectedBytes = Buffer.byteLength(content, 'utf8')
    const writtenBytes = writeSync(fd, content, undefined, 'utf8')
    if (writtenBytes !== expectedBytes) {
      throw new Error(
        `durable append wrote ${writtenBytes} of ${expectedBytes} bytes to '${filePath}'`,
      )
    }
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  syncDurableDirectory(dirname(filePath))
}

/** Reject a path that escapes its run directory or traverses a symbolic link. */
export function assertNoSymlinkDescendant(root: string, target: string, label = 'path'): void {
  const base = resolve(root)
  const exact = resolve(target)
  const rel = relative(base, exact)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} path escapes its run directory`)
  }
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) {
    throw new Error(`${label} path contains a symbolic link: ${base}`)
  }
  let current = base
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link: ${current}`)
    }
  }
}

/** Write, fsync, atomically replace, and fsync one Runtime-owned state file.
 * preserveMode retains ordinary access permissions despite the current umask; a new
 * file keeps normal creation semantics. Callers still own path validation and write exclusion. */
export function writeAtomicDurableFile(
  filePath: string,
  content: string,
  options: DurableFileOptions & { readonly preserveMode?: boolean } = {},
): void {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  let operationFailed = false
  let operationError: unknown
  try {
    let mode = options.mode
    let exactMode = false
    if (options.preserveMode) {
      try {
        mode = statSync(filePath).mode & 0o777
        exactMode = true
      } catch (error) {
        if (!isNoEntryError(error)) throw error
      }
    }
    writeExclusiveDurableFile(temporaryPath, content, { mode }, exactMode)
    renameSync(temporaryPath, filePath)
    syncDurableDirectory(dirname(filePath))
  } catch (error) {
    operationFailed = true
    operationError = error
  }
  let cleanupError: unknown
  try {
    unlinkSync(temporaryPath)
  } catch (error) {
    if (!isNoEntryError(error)) cleanupError = error
    // A successful rename removes the temporary directory entry.
  }
  if (operationFailed) throw operationError
  if (cleanupError !== undefined) throw cleanupError
}

function writeExclusiveDurableFile(
  filePath: string,
  content: DurableFileContent,
  options: DurableFileOptions,
  exactMode = false,
): void {
  const fd = openSync(filePath, 'wx', options.mode ?? 0o666)
  try {
    const text = typeof content === 'string' ? content : content(fstatSync(fd, { bigint: true }))
    writeFileSync(fd, text, 'utf8')
  } finally {
    closeSync(fd)
  }
  syncDurableFile(filePath, exactMode ? options.mode : undefined)
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

function isNoEntryError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
