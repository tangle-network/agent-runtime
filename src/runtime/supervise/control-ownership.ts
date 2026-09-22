import { randomBytes, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants as fsConstants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from 'node:fs'
import { dirname } from 'node:path'
import {
  flockSync,
  constants as fsExtConstants,
  lockFileExSync,
  unlockFileExSync,
} from 'fs-ext-extra-prebuilt'
import { isRuntimeTimestamp } from '../timestamps'
import { capabilityDigest, sameSecret } from './control-crypto'
import {
  assertNoSymlinkComponents,
  assertNoSymlinkIfPresent,
  assertOwnerOnlyMode,
  assertOwnerOnlyRegularDescriptor,
  isErrno,
  noFollowFlag,
  readFileIfPresent,
  writeJsonAtomic,
  writeJsonNoClobberAtomic,
} from './control-io'
import { assertStableText, isRecord, isStableText } from './control-validation'

interface SupervisorRouteOwner {
  readonly version: 3
  readonly ownerId: string
  readonly runId: string
  readonly pid: number
  readonly startIdentity: string
  readonly capabilityDigest: string
  readonly acquiredAt: string
  readonly state: 'owned' | 'released'
  readonly releasedAt?: string
}

interface SupervisorRouteCapability {
  readonly version: 1
  readonly runId: string
  readonly capabilityDigest: string
}

export function ensureControlDirectory(directory: string): void {
  assertNoSymlinkComponents(directory)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  assertNoSymlinkComponents(directory)
  const stat = lstatSync(directory)
  if (!stat.isDirectory())
    throw new Error(`supervisor control path is not a directory: ${directory}`)
  assertOwnerOnlyMode(stat.mode, directory)
}

export function ensureRouteCapability(
  file: string,
  runId: string,
  suppliedToken: string | undefined,
): string {
  assertNoSymlinkComponents(dirname(file))
  if (suppliedToken !== undefined) {
    assertStableText(suppliedToken, 'supervisor capability token')
  }
  const existing = readRouteCapability(file)
  if (existing) {
    if (existing.runId !== runId) {
      throw new Error(
        `supervisor control capability run "${existing.runId}" does not match "${runId}"`,
      )
    }
    if (suppliedToken === undefined) {
      throw new Error(
        `supervisor control route for run "${runId}" requires its original capability token`,
      )
    }
    if (!sameSecret(existing.capabilityDigest, capabilityDigest(suppliedToken))) {
      throw new Error(`supervisor control capability does not match run "${runId}"`)
    }
    return suppliedToken
  }
  const token = suppliedToken ?? randomBytes(32).toString('base64url')
  const candidate: SupervisorRouteCapability = {
    version: 1,
    runId,
    capabilityDigest: capabilityDigest(token),
  }
  if (writeJsonNoClobberAtomic(file, candidate)) return token
  const concurrent = readRouteCapability(file)
  if (!concurrent || concurrent.runId !== runId) {
    throw new Error(`supervisor control capability was concurrently created with another run`)
  }
  if (!sameSecret(concurrent.capabilityDigest, capabilityDigest(token))) {
    throw new Error('supervisor control capability was concurrently created with another token')
  }
  return token
}

export function readRouteCapability(file: string): SupervisorRouteCapability | null {
  const raw = readFileIfPresent(file)
  if (raw === undefined) return null
  try {
    const value = JSON.parse(raw) as unknown
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      !isStableText(value.runId) ||
      !isStableText(value.capabilityDigest)
    ) {
      throw new Error(`supervisor control capability is invalid: ${file}`)
    }
    return value as unknown as SupervisorRouteCapability
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('supervisor control capability')) {
      throw error
    }
    throw new Error(`supervisor control capability is not valid JSON: ${file}`, { cause: error })
  }
}

export function acquireRouteOwnership(
  file: string,
  runId: string,
  capabilityToken: string,
  now: () => number,
): { release: () => void; deadOwnerTakenOver: boolean } {
  const digest = capabilityDigest(capabilityToken)
  const startIdentity = processStartIdentity(process.pid) ?? `pid-only:${process.pid}`
  const ownerId = randomUUID()
  const owner: SupervisorRouteOwner = {
    version: 3,
    ownerId,
    runId,
    pid: process.pid,
    startIdentity,
    capabilityDigest: digest,
    acquiredAt: new Date(now()).toISOString(),
    state: 'owned',
  }
  assertNoSymlinkComponents(dirname(file))
  const lockFile = `${file}.lock`
  assertNoSymlinkIfPresent(lockFile)
  const descriptor = openSync(
    lockFile,
    fsConstants.O_RDWR | fsConstants.O_CREAT | noFollowFlag(),
    0o600,
  )
  try {
    assertOwnerOnlyRegularDescriptor(descriptor, lockFile)
    lockOwnerDescriptor(descriptor)
  } catch (error) {
    let existing: SupervisorRouteOwner | null = null
    let readFailure: unknown
    try {
      existing = readRouteOwner(file)
    } catch (ownerError) {
      readFailure = ownerError
    } finally {
      closeSync(descriptor)
    }
    if (readFailure) throw readFailure
    if (existing?.state === 'owned') {
      throw new Error(
        `supervisor control route for run "${existing.runId}" is already owned by process ${existing.pid}`,
        { cause: error },
      )
    }
    throw new Error(`supervisor control route for run "${runId}" is already owned`, {
      cause: error,
    })
  }

  let existing: SupervisorRouteOwner | null
  try {
    existing = readRouteOwner(file)
    if (existing && !sameSecret(existing.capabilityDigest, digest)) {
      throw new Error('supervisor control capability does not match the existing route owner')
    }
    if (existing?.state === 'owned' && processIsAlive(existing.pid, existing.startIdentity)) {
      throw new Error(
        `supervisor control owner record still names live process ${existing.pid} after its operating-system lock was lost`,
      )
    }
    writeJsonAtomic(file, owner)
  } catch (error) {
    try {
      unlockOwnerDescriptor(descriptor)
    } finally {
      closeSync(descriptor)
    }
    throw error
  }

  const deadOwnerTakenOver = existing?.state === 'owned'

  let released = false
  const release = () => {
    if (released) return
    released = true
    let failure: unknown
    try {
      const current = readRouteOwner(file)
      if (current?.ownerId === ownerId && current.state === 'owned') {
        writeJsonAtomic(file, {
          ...current,
          state: 'released',
          releasedAt: new Date(now()).toISOString(),
        })
      }
    } catch (error) {
      failure = error
    }
    try {
      unlockOwnerDescriptor(descriptor)
    } catch (error) {
      failure ??= error
    }
    try {
      closeSync(descriptor)
    } catch (error) {
      failure ??= error
    }
    if (failure) throw failure
  }
  return { release, deadOwnerTakenOver }
}

function readRouteOwner(file: string): SupervisorRouteOwner | null {
  const raw = readFileIfPresent(file)
  if (raw === undefined) return null
  if (Buffer.byteLength(raw) > 16_384) {
    throw new Error('supervisor control owner record exceeds 16 KiB')
  }
  try {
    const value = JSON.parse(raw) as unknown
    if (
      !isRecord(value) ||
      value.version !== 3 ||
      !isStableText(value.ownerId) ||
      !isStableText(value.runId) ||
      !Number.isSafeInteger(value.pid) ||
      Number(value.pid) <= 0 ||
      !isStableText(value.startIdentity) ||
      !isStableText(value.capabilityDigest) ||
      !isRuntimeTimestamp(value.acquiredAt) ||
      (value.state !== 'owned' && value.state !== 'released') ||
      (value.state === 'owned' && value.releasedAt !== undefined) ||
      (value.state === 'released' && !isRuntimeTimestamp(value.releasedAt))
    ) {
      throw new Error('supervisor control owner record is invalid')
    }
    return value as unknown as SupervisorRouteOwner
  } catch (error) {
    if (error instanceof Error && error.message === 'supervisor control owner record is invalid') {
      throw error
    }
    throw new Error('supervisor control owner record is not valid JSON', { cause: error })
  }
}

function lockOwnerDescriptor(descriptor: number): void {
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

function unlockOwnerDescriptor(descriptor: number): void {
  if (process.platform === 'win32') {
    unlockFileExSync(descriptor, 0, 0, 0xffff_ffff, 0xffff_ffff)
    return
  }
  flockSync(descriptor, 'un')
}

function processIsAlive(pid: number, expectedStartIdentity: string): boolean {
  const currentStartIdentity = processStartIdentity(pid)
  if (currentStartIdentity === undefined) {
    try {
      process.kill(pid, 0)
      // The process exists but its identity could not be read. Refuse takeover rather than
      // treating an unverifiable process as dead; ESRCH is the one safe proof of absence.
      return true
    } catch (error) {
      return !isErrno(error, 'ESRCH')
    }
  }
  if (currentStartIdentity !== expectedStartIdentity) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !isErrno(error, 'ESRCH')
  }
}

function processStartIdentity(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    const closingCommand = stat.lastIndexOf(')')
    if (closingCommand < 0) return undefined
    const fields = stat
      .slice(closingCommand + 2)
      .trim()
      .split(/\s+/)
    const state = fields[0]
    const startTime = fields[19]
    if (!startTime || !/^\d+$/.test(startTime)) return undefined
    // A SIGKILLed child can remain as a zombie until its parent reaps it. `kill(pid, 0)` still
    // succeeds for that record, but it cannot own a live route anymore.
    return state === 'Z' ? `zombie:${startTime}` : startTime
  } catch {
    return undefined
  }
}
