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
  fsyncSync,
  linkSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

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

function syncDurableFile(filePath: string): void {
  const fd = openSync(filePath, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
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
