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
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

export interface DurableFileOptions {
  readonly mode?: number
}

/** Publish a new file without replacing a concurrent winner. */
export function publishExclusiveDurableFile(
  filePath: string,
  content: string,
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
export function syncDurableFile(filePath: string): void {
  const fd = openSync(filePath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
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

/** Write, fsync, atomically replace, and fsync one Runtime-owned state file. */
export function writeAtomicDurableFile(
  filePath: string,
  content: string,
  options: DurableFileOptions = {},
): void {
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  let operationFailed = false
  let operationError: unknown
  try {
    writeExclusiveDurableFile(temporaryPath, content, options)
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
  content: string,
  options: DurableFileOptions,
): void {
  if (options.mode === undefined) {
    writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx' })
  } else {
    writeFileSync(filePath, content, { encoding: 'utf8', flag: 'wx', mode: options.mode })
  }
  syncDurableFile(filePath)
}

export function isAlreadyExistsError(error: unknown): boolean {
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
