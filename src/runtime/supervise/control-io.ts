import { randomUUID } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  ftruncateSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  flockSync,
  constants as fsExtConstants,
  lockFileExSync,
  unlockFileExSync,
} from 'fs-ext-extra-prebuilt'
import { isSupervisorControlCommand, serializeCommand } from './control-command'
import type { SupervisorControlFiles } from './control-types'

export function appendDurable(file: string, value: unknown, capabilityToken?: string): void {
  assertNoSymlinkComponents(dirname(file))
  const serialized = isSupervisorControlCommand(value)
    ? serializeCommand(value, capabilityToken)
    : value
  const descriptor = openSync(
    file,
    fsConstants.O_RDWR | fsConstants.O_APPEND | fsConstants.O_CREAT | noFollowFlag(),
    0o600,
  )
  let locked = false
  try {
    assertOwnerOnlyRegularDescriptor(descriptor, file)
    lockAppendDescriptor(descriptor)
    locked = true
    truncateUnterminatedTail(descriptor)
    // A leading separator makes the next complete record readable even when a
    // prior process died after writing only part of its final JSON record.
    writeSync(descriptor, `\n${JSON.stringify(serialized)}\n`, null, 'utf8')
    fsyncSync(descriptor)
  } finally {
    try {
      if (locked) unlockAppendDescriptor(descriptor)
    } finally {
      closeSync(descriptor)
    }
  }
}

function truncateUnterminatedTail(descriptor: number): void {
  const size = fstatSync(descriptor).size
  if (size === 0) return
  const lastByte = Buffer.alloc(1)
  readSync(descriptor, lastByte, 0, 1, size - 1)
  if (lastByte[0] === 0x0a) return
  let offset = size - 1
  const chunk = Buffer.alloc(4096)
  while (offset > 0) {
    const start = Math.max(0, offset - chunk.length + 1)
    const length = offset - start + 1
    readSync(descriptor, chunk, 0, length, start)
    for (let index = length - 1; index >= 0; index -= 1) {
      if (chunk[index] === 0x0a) {
        ftruncateSync(descriptor, start + index + 1)
        return
      }
    }
    offset = start - 1
  }
  ftruncateSync(descriptor, 0)
}

function lockAppendDescriptor(descriptor: number): void {
  if (process.platform === 'win32') {
    lockFileExSync(
      descriptor,
      fsExtConstants.LOCKFILE_EXCLUSIVE_LOCK | fsExtConstants.LOCKFILE_FAIL_IMMEDIATELY,
      0,
      0,
      0xffff_ffff,
      0xffff_ffff,
    )
    return
  }
  flockSync(descriptor, 'exnb')
}

function unlockAppendDescriptor(descriptor: number): void {
  if (process.platform === 'win32') {
    unlockFileExSync(descriptor, 0, 0, 0xffff_ffff, 0xffff_ffff)
    return
  }
  flockSync(descriptor, 'un')
}

export function writeJsonAtomic(file: string, value: unknown): void {
  assertNoSymlinkComponents(dirname(file))
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`
  const descriptor = openSync(
    temporary,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag(),
    0o600,
  )
  try {
    assertOwnerOnlyRegularDescriptor(descriptor, temporary)
    writeSync(descriptor, `${JSON.stringify(value)}\n`, null, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  try {
    assertNoSymlinkIfPresent(file)
    renameSync(temporary, file)
    fsyncDirectory(dirname(file))
  } catch (error) {
    unlinkIfPresent(temporary)
    throw error
  }
}

export function writeJsonExclusive(file: string, value: unknown): void {
  assertNoSymlinkComponents(dirname(file))
  const descriptor = openSync(
    file,
    fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | noFollowFlag(),
    0o600,
  )
  try {
    assertOwnerOnlyRegularDescriptor(descriptor, file)
    writeSync(descriptor, `${JSON.stringify(value)}\n`, null, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
  fsyncDirectory(dirname(file))
}

export function writeJsonNoClobberAtomic(file: string, value: unknown): boolean {
  const candidate = `${file}.${process.pid}.${randomUUID()}.candidate`
  writeJsonExclusive(candidate, value)
  try {
    linkSync(candidate, file)
    fsyncDirectory(dirname(file))
    return true
  } catch (error) {
    if (isErrno(error, 'EEXIST')) return false
    throw error
  } finally {
    unlinkIfPresent(candidate)
  }
}

export function readFileIfPresent(file: string): string | undefined {
  assertNoSymlinkComponents(dirname(file))
  let descriptor: number
  try {
    descriptor = openSync(file, fsConstants.O_RDONLY | noFollowFlag())
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
  try {
    assertOwnerOnlyRegularDescriptor(descriptor, file)
    return readFileSync(descriptor, 'utf8')
  } finally {
    closeSync(descriptor)
  }
}

export function unlinkIfPresent(file: string): void {
  try {
    assertNoSymlinkIfPresent(file)
    unlinkSync(file)
  } catch (error) {
    if (!isErrno(error, 'ENOENT')) throw error
  }
}

export function assertNoSymlinkComponents(path: string): void {
  let current = resolve(path)
  for (;;) {
    const stat = lstatIfPresent(current)
    if (stat?.isSymbolicLink()) {
      throw new Error(`supervisor control path cannot be a symlink: ${current}`)
    }
    const parent = dirname(current)
    if (parent === current) return
    current = parent
  }
}

export function assertNoSymlinkIfPresent(path: string): void {
  const stat = lstatIfPresent(path)
  if (stat?.isSymbolicLink()) {
    throw new Error(`supervisor control path cannot be a symlink: ${path}`)
  }
}

export function lstatIfPresent(path: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(path)
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return undefined
    throw error
  }
}

export function assertOwnerOnlyRegularDescriptor(descriptor: number, path: string): void {
  const stat = fstatSync(descriptor)
  if (!stat.isFile()) throw new Error(`supervisor control path is not a regular file: ${path}`)
  assertOwnerOnlyMode(stat.mode, path)
}

export function assertOwnerOnlyMode(mode: number, path: string): void {
  if ((mode & 0o077) !== 0) {
    throw new Error(`supervisor control path must be owner-only: ${path}`)
  }
}

export function noFollowFlag(): number {
  if (typeof fsConstants.O_NOFOLLOW !== 'number') {
    throw new Error('supervisor control requires O_NOFOLLOW support')
  }
  return fsConstants.O_NOFOLLOW
}

export function isErrno(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

export function fsyncDirectory(path: string): void {
  const directory = openSync(path, fsConstants.O_RDONLY | noFollowFlag())
  try {
    fsyncSync(directory)
  } finally {
    closeSync(directory)
  }
}

/** Resolve every control-route path from an already-owned run directory. @stable */
export function supervisorControlFiles(runDir: string): SupervisorControlFiles {
  const directory = join(resolve(runDir), 'control')
  return {
    directory,
    owner: join(directory, 'owner.json'),
    capability: join(directory, 'capability.json'),
    commands: join(directory, 'commands.ndjson'),
    acknowledgements: join(directory, 'acknowledgements.ndjson'),
    effects: join(directory, 'effects.ndjson'),
    snapshot: join(directory, 'snapshot.json'),
  }
}
