import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { appendFileDurably, createFileDurably, replaceFileDurably } from './durable-fs'

/** The durable write operations used by worker-control stores. Tests may inject failures here. */
export interface WorkerControlPersistence {
  readonly appendFile: (file: string, contents: string) => void
  readonly createFile: (file: string, contents: string) => boolean
  readonly replaceFile: (file: string, contents: string) => void
}

/** The production filesystem boundary for worker-control state. */
export const defaultWorkerControlPersistence: WorkerControlPersistence = Object.freeze({
  appendFile: appendFileDurably,
  createFile: createFileDurably,
  replaceFile: replaceFileDurably,
})

/** A collision between two operations that reuse one id with different request material. */
export class SupervisorOperationConflictError extends Error {
  readonly code = 'OPERATION_CONFLICT' as const
  readonly operationId: string

  constructor(operationId: string, detail: string) {
    super(`operation '${operationId}' conflicts with its existing request: ${detail}`)
    this.name = 'SupervisorOperationConflictError'
    this.operationId = operationId
  }
}

/** The root every supervisor run of one workspace lives under. */
export function supervisorRunsRoot(rootDir: string): string {
  assertRootPath(rootDir)
  return join(resolve(rootDir), '.agent', 'supervisor')
}

/** The run directory every artifact of one supervisor run lives under. */
export function supervisorRunDir(rootDir: string, id: string): string {
  assertSupervisorId(id)
  return join(supervisorRunsRoot(rootDir), id)
}

/** The pre-rename location used by readers for historical supervisor runs. */
export function legacySupervisorRunDir(rootDir: string, id: string): string {
  assertSupervisorId(id)
  return join(legacySupervisorRunsRoot(rootDir), id)
}

/** The pre-rename supervisor root. Writers never create this location. */
export function legacySupervisorRunsRoot(rootDir: string): string {
  assertRootPath(rootDir)
  return join(resolve(rootDir), '.loops', 'supervisor')
}

/** Validate the exact worker identity carried by Runtime records. */
export function assertExactWorkerId(workerId: string): string {
  if (
    typeof workerId !== 'string' ||
    workerId.length === 0 ||
    workerId !== workerId.trim() ||
    workerId.includes('\0')
  ) {
    throw new Error(
      `unsafe workerId '${displayId(workerId)}' — use the exact non-empty worker id returned by Runtime`,
    )
  }
  return workerId
}

/** Validate an operation id before it can become a durable filename. */
export function assertControlOperationId(operationId: string): string {
  if (!isSafeId(operationId)) {
    throw new Error(`unsafe operationId '${displayId(operationId)}'`)
  }
  return operationId
}

/** A worker label reduced to a safe filename stem for legacy display readers. */
export function safeWorkerFile(label: string): string {
  const safe = label.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe.length > 0 ? safe : 'worker'
}

/** The directory holding every per-worker file of one run. */
export function supervisorWorkersDir(eventDir: string): string {
  return join(eventDir, 'workers')
}

/** The durable inbox file for one exact worker id. */
export function workerInboxFile(rootDir: string, supervisorId: string, workerId: string): string {
  return workerInboxFileFromEventDir(supervisorRunDir(rootDir, supervisorId), workerId)
}

/** The durable inbox file addressed from an already-known run directory. */
export function workerInboxFileFromEventDir(eventDir: string, workerId: string): string {
  assertExactWorkerId(workerId)
  return join(supervisorWorkersDir(eventDir), `${workerFileStem(workerId)}.inbox.ndjson`)
}

/** The per-worker control log for one exact worker id. */
export function workerControlLogFile(eventDir: string, workerId: string): string {
  assertExactWorkerId(workerId)
  return join(supervisorWorkersDir(eventDir), `${workerFileStem(workerId)}.ndjson`)
}

/** The directory containing steer intent records. */
export function workerSteerIntentsDir(eventDir: string): string {
  return join(supervisorWorkersDir(eventDir), 'steer-intents')
}

/** The durable intent record for one steer operation. */
export function workerSteerIntentFile(eventDir: string, operationId: string): string {
  return join(workerSteerIntentsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** The directory containing exclusive runtime steer claims. */
export function workerSteerClaimsDir(eventDir: string): string {
  return join(supervisorWorkersDir(eventDir), 'steer-claims')
}

/** The durable claim record for one steer operation. */
export function workerSteerClaimFile(eventDir: string, operationId: string): string {
  return join(workerSteerClaimsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** The directory containing steer acknowledgements. */
export function workerSteerAcknowledgementsDir(eventDir: string): string {
  return join(supervisorWorkersDir(eventDir), 'steer-acknowledgements')
}

/** The durable acknowledgement file for one steer operation. */
export function workerSteerAcknowledgementFile(eventDir: string, operationId: string): string {
  return join(workerSteerAcknowledgementsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** The directory holding every cancellation artifact of one run. */
export function workerCancellationsDir(eventDir: string): string {
  return join(eventDir, 'cancellations')
}

/** The durable cancellation request inbox. */
export function workerCancelRequestsFile(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'requests.ndjson')
}

/** The directory containing cancellation intent records. */
export function workerCancellationIntentsDir(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'intents')
}

/** The durable intent record for one cancellation operation. */
export function workerCancellationIntentFile(eventDir: string, operationId: string): string {
  return join(workerCancellationIntentsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** The directory containing exclusive runtime cancellation claims. */
export function workerCancellationClaimsDir(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'claims')
}

/** The durable claim record for one cancellation operation. */
export function workerCancellationClaimFile(eventDir: string, operationId: string): string {
  return join(workerCancellationClaimsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** The acknowledgement file for one cancellation operation. */
export function workerCancellationFile(eventDir: string, operationId: string): string {
  return join(workerCancellationsDir(eventDir), `${operationFile(operationId)}.json`)
}

/** Append a non-authoritative control log entry without weakening the durable request. */
export function appendWorkerControlEvent(
  eventDir: string,
  workerId: string,
  event: Record<string, unknown>,
  persistence: WorkerControlPersistence = defaultWorkerControlPersistence,
): void {
  assertExactWorkerId(workerId)
  try {
    persistence.appendFile(
      workerControlLogFile(eventDir, workerId),
      `${JSON.stringify({ at: new Date().toISOString(), worker: workerId, ...event })}\n`,
    )
  } catch {
    // The request, claim, and acknowledgement files are authoritative. This log is diagnostic only.
  }
}

function operationFile(operationId: string): string {
  return assertControlOperationId(operationId)
}

function workerFileStem(workerId: string): string {
  if (isSafeId(workerId)) return workerId
  return `~${createHash('sha256').update(workerId, 'utf8').digest('hex')}`
}

function assertRootPath(rootDir: string): void {
  if (typeof rootDir !== 'string' || rootDir.includes('\0')) {
    throw new Error('supervisor root path contains NUL')
  }
}

function assertSupervisorId(id: string): void {
  if (!isSafeId(id)) {
    throw new Error(`unsafe supervisor id '${displayId(id)}' — ids must be one path segment`)
  }
}

function isSafeId(value: string): boolean {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim() &&
    !/\s/u.test(value) &&
    value !== '.' &&
    value !== '..' &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  )
}

function displayId(value: string): string {
  return typeof value === 'string' ? value.replace(/\0/g, '\\0') : String(value)
}
