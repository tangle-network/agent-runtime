import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { RetainedRunEffect } from '../retained-run-types'
import type { WorkerControlPersistence } from './worker-control-layout'
import {
  appendWorkerControlEvent,
  assertControlOperationId,
  assertExactWorkerId,
  defaultWorkerControlPersistence,
  SupervisorOperationConflictError,
  workerCancellationClaimFile,
  workerCancellationFile,
  workerCancellationIntentFile,
  workerCancellationIntentsDir,
  workerCancelRequestsFile,
} from './worker-control-layout'

/** One durable request to cancel one exact worker id. */
export interface WorkerCancelRequest {
  readonly operationId: string
  readonly at: string
  readonly source: string
  readonly worker: string
  readonly reason?: string
}

/** The durable state of one worker cancellation operation. */
export interface WorkerCancellation {
  readonly operationId: string
  /** The exact worker id supplied by the caller. */
  readonly worker: string
  readonly source: string
  readonly effect: RetainedRunEffect
  readonly requestedAt: string
  readonly observedAt: string
  /** New records always carry the exact worker id before abort begins. */
  readonly workerId?: string
  readonly reason?: string
  readonly detail?: string
  readonly terminated: ReadonlyArray<string>
  /** The Runtime process that owned the attempt, when written by the current protocol. */
  readonly ownerId?: string
}

export interface WorkerCancellationOptions {
  readonly reason?: string
  readonly source?: string
  readonly persistence?: WorkerControlPersistence
}

interface WorkerCancellationClaim {
  readonly operationId: string
  readonly worker: string
  readonly source: string
  readonly reason?: string
  readonly requestedAt: string
  readonly ownerId: string
}

export interface WorkerCancellationStore {
  readonly enqueue: (
    worker: string,
    operationId: string,
    options: WorkerCancellationOptions,
  ) => WorkerCancellation
  readonly requests: () => WorkerCancelRequest[]
  readonly readAcknowledgement: (operationId: string) => WorkerCancellation | undefined
  readonly writeAcknowledgement: (record: WorkerCancellation) => void
  /** Claim before abort. `true` means this owner may perform the one attempt. */
  readonly claim: (request: WorkerCancelRequest, ownerId: string) => boolean
  readonly assertAcknowledgementMatchesRequest: (
    acknowledgement: WorkerCancellation,
    request: WorkerCancelRequest,
  ) => void
}

/** Construct the durable cancellation store for one run directory. */
export function createWorkerCancellationStore(
  eventDir: string,
  options: { readonly persistence?: WorkerControlPersistence } = {},
): WorkerCancellationStore {
  const persistence = options.persistence ?? defaultWorkerControlPersistence

  const enqueue = (
    worker: string,
    operationId: string,
    requestOptions: WorkerCancellationOptions,
  ): WorkerCancellation => {
    assertExactWorkerId(worker)
    assertControlOperationId(operationId)
    const existingAcknowledgement = readAcknowledgement(operationId)
    if (existingAcknowledgement !== undefined) {
      assertAcknowledgementBinding(existingAcknowledgement, worker, requestOptions, operationId)
      return existingAcknowledgement
    }
    const requestedSource = requestOptions.source
    const effectiveSource = requestedSource ?? 'human'
    const request: WorkerCancelRequest = {
      operationId,
      at: new Date().toISOString(),
      source: effectiveSource,
      worker,
      ...(requestOptions.reason === undefined ? {} : { reason: requestOptions.reason }),
    }
    const intentFile = workerCancellationIntentFile(eventDir, operationId)
    const created = persistence.createFile(intentFile, `${JSON.stringify(request)}\n`)
    const durableRequest = created
      ? request
      : (readCancellationIntent(eventDir, operationId) ?? findRequest(eventDir, operationId))
    if (durableRequest === undefined) {
      throw new Error(`cancellation intent '${operationId}' exists but cannot be read`)
    }
    assertRequestBinding(durableRequest, worker, requestOptions, operationId)
    if (created) {
      // The intent is authoritative. If this append fails, the Runtime pass still finds the intent
      // and can decide the operation under its exclusive claim.
      persistence.appendFile(
        workerCancelRequestsFile(eventDir),
        `${JSON.stringify(durableRequest)}\n`,
      )
      appendWorkerControlEvent(
        eventDir,
        durableRequest.worker,
        {
          kind: 'cancel-request',
          operationId,
          source: durableRequest.source,
          queued: true,
          ...(durableRequest.reason === undefined ? {} : { reason: durableRequest.reason }),
        },
        persistence,
      )
    }
    return pendingCancellation(durableRequest)
  }

  const readAcknowledgement = (operationId: string): WorkerCancellation | undefined => {
    assertControlOperationId(operationId)
    const file = workerCancellationFile(eventDir, operationId)
    if (existsSync(file)) {
      const parsed = parseJson(file, `cancellation acknowledgement '${operationId}'`)
      if (parsed.operationId !== operationId) {
        throw new Error(
          `cancel acknowledgement collision: '${file}' holds operation '${parsed.operationId}', not '${operationId}'`,
        )
      }
      const normalized = normalizeWorkerCancellation(eventDir, parsed)
      if (normalized === undefined) {
        throw new Error(`invalid cancellation acknowledgement for operation '${operationId}'`)
      }
      return normalized
    }
    const claimFile = workerCancellationClaimFile(eventDir, operationId)
    if (!existsSync(claimFile)) return undefined
    const claim = parseJson(claimFile, `cancellation claim '${operationId}'`)
    if (!isWorkerCancellationClaim(claim) || claim.operationId !== operationId) {
      throw new Error(`invalid cancellation claim for operation '${operationId}'`)
    }
    return {
      operationId: claim.operationId,
      worker: claim.worker,
      workerId: claim.worker,
      source: claim.source,
      effect: 'unknown',
      requestedAt: claim.requestedAt,
      observedAt: claim.requestedAt,
      ...(claim.reason === undefined ? {} : { reason: claim.reason }),
      ownerId: claim.ownerId,
      detail: 'operation claim is durable; termination effect is unknown',
      terminated: [],
    }
  }

  const writeAcknowledgement = (record: WorkerCancellation): void => {
    assertExactWorkerId(record.worker)
    assertControlOperationId(record.operationId)
    if (record.workerId !== undefined) assertExactWorkerId(record.workerId)
    if (record.workerId !== undefined && record.workerId !== record.worker) {
      throw new SupervisorOperationConflictError(
        record.operationId,
        'cancellation workerId must equal the exact requested worker id',
      )
    }
    if (!isWorkerCancellationData(record)) {
      throw new Error(`invalid cancellation acknowledgement for operation '${record.operationId}'`)
    }
    const existing = readAcknowledgement(record.operationId)
    if (existing !== undefined) {
      assertAcknowledgementMaterial(existing, record)
      // A claim is exposed as a synthetic `unknown` acknowledgement until the first durable
      // acknowledgement file is written. Materialize that file even when both records say
      // `unknown`; only an existing file makes an identical transition idempotent.
      if (existing.effect === record.effect) {
        if (existsSync(workerCancellationFile(eventDir, record.operationId))) return
      } else if (!allowedTransition(existing.effect, record.effect)) {
        throw new SupervisorOperationConflictError(
          record.operationId,
          `cancellation effect '${existing.effect}' cannot transition to '${record.effect}'`,
        )
      }
    }
    persistence.replaceFile(
      workerCancellationFile(eventDir, record.operationId),
      `${JSON.stringify(record, null, 2)}\n`,
    )
  }

  const claim = (request: WorkerCancelRequest, ownerId: string): boolean => {
    assertRequest(request)
    if (!ownerId || ownerId.trim() !== ownerId) {
      throw new Error('cancellation ownerId is empty or unsafe')
    }
    const claim: WorkerCancellationClaim = {
      operationId: request.operationId,
      worker: request.worker,
      source: request.source,
      ...(request.reason === undefined ? {} : { reason: request.reason }),
      requestedAt: request.at,
      ownerId,
    }
    const file = workerCancellationClaimFile(eventDir, request.operationId)
    if (persistence.createFile(file, `${JSON.stringify(claim)}\n`)) return true
    const parsed = parseJson(file, `cancellation claim '${request.operationId}'`)
    if (!isWorkerCancellationClaim(parsed) || parsed.operationId !== request.operationId) {
      throw new Error(`invalid cancellation claim for operation '${request.operationId}'`)
    }
    assertClaimBinding(parsed, claim)
    // A claim owned by another process stays exclusive, even if both processes were given the
    // same logical owner label. The driver supplies a process-unique owner token.
    return false
  }

  return {
    enqueue,
    requests: () => readRequests(eventDir),
    readAcknowledgement,
    writeAcknowledgement,
    claim,
    assertAcknowledgementMatchesRequest: (acknowledgement, request) =>
      assertAcknowledgementMatchesRequest(acknowledgement, request),
  }
}

/** Request cancellation of one exact worker id. This function never aborts the worker. */
export function cancelWorker(
  eventDir: string,
  worker: string,
  operationId: string,
  options: WorkerCancellationOptions = {},
): WorkerCancellation {
  assertExactWorkerId(worker)
  assertControlOperationId(operationId)
  return createWorkerCancellationStore(eventDir, {
    persistence: options.persistence,
  }).enqueue(worker, operationId, options)
}

/** Read every valid cancellation request, including intent records whose inbox append failed. */
export function readWorkerCancelRequests(eventDir: string): WorkerCancelRequest[] {
  return createWorkerCancellationStore(eventDir).requests()
}

/** Read one durable cancellation acknowledgement. */
export function readWorkerCancellation(
  eventDir: string,
  operationId: string,
): WorkerCancellation | undefined {
  return createWorkerCancellationStore(eventDir).readAcknowledgement(operationId)
}

/** Persist one cancellation state transition. */
export function writeWorkerCancellation(
  eventDir: string,
  record: WorkerCancellation,
  persistence?: WorkerControlPersistence,
): void {
  createWorkerCancellationStore(eventDir, { persistence }).writeAcknowledgement(record)
}

function readRequests(eventDir: string): WorkerCancelRequest[] {
  const byOperation = new Map<string, WorkerCancelRequest>()
  const add = (request: WorkerCancelRequest): void => {
    if (!isWorkerCancelRequest(request)) return
    const existing = byOperation.get(request.operationId)
    if (existing !== undefined) {
      assertRequestMaterial(existing, request)
      return
    }
    byOperation.set(request.operationId, request)
  }
  const requestFile = workerCancelRequestsFile(eventDir)
  for (const request of readLines(requestFile)) add(request)
  const intentsDir = workerCancellationIntentsDir(eventDir)
  if (existsSync(intentsDir)) {
    for (const entry of readEntries(intentsDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const parsed = parseJson(join(intentsDir, entry.name), 'cancellation intent')
      if (isWorkerCancelRequest(parsed)) add(parsed)
    }
  }
  return [...byOperation.values()]
}

function findRequest(eventDir: string, operationId: string): WorkerCancelRequest | undefined {
  return readRequests(eventDir).find((request) => request.operationId === operationId)
}

function readCancellationIntent(
  eventDir: string,
  operationId: string,
): WorkerCancelRequest | undefined {
  const file = workerCancellationIntentFile(eventDir, operationId)
  if (!existsSync(file)) return undefined
  const parsed = parseJson(file, `cancellation intent '${operationId}'`)
  return isWorkerCancelRequest(parsed) ? parsed : undefined
}

function pendingCancellation(request: WorkerCancelRequest): WorkerCancellation {
  return {
    operationId: request.operationId,
    worker: request.worker,
    workerId: request.worker,
    source: request.source,
    effect: 'unknown',
    requestedAt: request.at,
    observedAt: request.at,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    detail: 'request queued; no Runtime attempt has completed',
    terminated: [],
  }
}

function normalizeWorkerCancellation(
  eventDir: string,
  parsed: Partial<WorkerCancellation>,
): WorkerCancellation | undefined {
  if (isWorkerCancellation(parsed)) return parsed
  if (!isLegacyWorkerCancellation(parsed)) return undefined
  const request = readRequests(eventDir).find(
    (candidate) => candidate.operationId === parsed.operationId,
  )
  const normalized = {
    ...parsed,
    source: request?.source ?? 'legacy',
    ...(parsed.workerId === undefined ? {} : { workerId: parsed.workerId }),
  }
  return isWorkerCancellation(normalized) ? normalized : undefined
}

function assertAcknowledgementMatchesRequest(
  acknowledgement: WorkerCancellation,
  request: WorkerCancelRequest,
): void {
  assertAcknowledgementBinding(acknowledgement, request.worker, request, request.operationId)
}

function assertAcknowledgementBinding(
  existing: WorkerCancellation,
  worker: string,
  options: { readonly source?: string; readonly reason?: string } | WorkerCancelRequest,
  operationId: string,
): void {
  const source = options.source
  const reason = options.reason
  if (existing.worker !== worker) {
    throw new SupervisorOperationConflictError(
      operationId,
      `worker '${existing.worker}' cannot be reused for worker '${worker}'`,
    )
  }
  if (source !== undefined && existing.source !== source) {
    throw new SupervisorOperationConflictError(operationId, 'source cannot change after recording')
  }
  if (reason !== undefined && existing.reason !== reason) {
    throw new SupervisorOperationConflictError(operationId, 'reason cannot change after recording')
  }
}

function assertRequestBinding(
  existing: WorkerCancelRequest,
  worker: string,
  options: { readonly source?: string; readonly reason?: string },
  operationId: string,
): void {
  assertExactWorkerId(worker)
  if (existing.worker !== worker) {
    throw new SupervisorOperationConflictError(operationId, 'worker cannot change after recording')
  }
  if (options.source !== undefined && existing.source !== options.source) {
    throw new SupervisorOperationConflictError(operationId, 'source cannot change after recording')
  }
  if (options.reason !== undefined && existing.reason !== options.reason) {
    throw new SupervisorOperationConflictError(operationId, 'reason cannot change after recording')
  }
}

function assertRequest(request: WorkerCancelRequest): void {
  if (!isWorkerCancelRequest(request)) throw new Error('invalid cancellation request')
}

function assertAcknowledgementMaterial(left: WorkerCancellation, right: WorkerCancellation): void {
  if (
    left.worker !== right.worker ||
    left.source !== right.source ||
    left.reason !== right.reason
  ) {
    throw new SupervisorOperationConflictError(
      right.operationId,
      'cancellation acknowledgement disagrees on worker, source, or reason',
    )
  }
}

function assertRequestMaterial(left: WorkerCancelRequest, right: WorkerCancelRequest): void {
  if (
    left.worker !== right.worker ||
    left.source !== right.source ||
    left.reason !== right.reason
  ) {
    throw new SupervisorOperationConflictError(
      right.operationId,
      'duplicate cancellation records disagree on worker, source, or reason',
    )
  }
}

function assertClaimBinding(left: WorkerCancellationClaim, right: WorkerCancellationClaim): void {
  if (
    left.worker !== right.worker ||
    left.source !== right.source ||
    left.reason !== right.reason
  ) {
    throw new SupervisorOperationConflictError(
      right.operationId,
      'cancellation claim disagrees on worker, source, or reason',
    )
  }
}

function allowedTransition(from: RetainedRunEffect, to: RetainedRunEffect): boolean {
  return (
    (from === 'unknown' && (to === 'cancel_requested' || to === 'not_live')) ||
    (from === 'cancel_requested' && (to === 'cancelled' || to === 'not_live'))
  )
}

function isWorkerCancelRequest(value: Partial<WorkerCancelRequest>): value is WorkerCancelRequest {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    (value.reason === undefined || typeof value.reason === 'string')
  )
}

function isWorkerCancellation(value: Partial<WorkerCancellation>): value is WorkerCancellation {
  return isWorkerCancellationData(value)
}

function isWorkerCancellationData(value: Partial<WorkerCancellation>): boolean {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    typeof value.source === 'string' &&
    isEffect(value.effect) &&
    typeof value.requestedAt === 'string' &&
    typeof value.observedAt === 'string' &&
    (value.workerId === undefined ||
      (safeWorkerId(value.workerId) && value.workerId === value.worker)) &&
    Array.isArray(value.terminated) &&
    value.terminated.every((id): id is string => safeWorkerId(id)) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    (value.ownerId === undefined || typeof value.ownerId === 'string')
  )
}

function isLegacyWorkerCancellation(value: Partial<WorkerCancellation>): boolean {
  return value.source === undefined && isWorkerCancellationWithoutSource(value)
}

function isWorkerCancellationWithoutSource(value: Partial<WorkerCancellation>): boolean {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    isEffect(value.effect) &&
    typeof value.requestedAt === 'string' &&
    typeof value.observedAt === 'string' &&
    (value.workerId === undefined ||
      (safeWorkerId(value.workerId) && value.workerId === value.worker)) &&
    Array.isArray(value.terminated) &&
    value.terminated.every((id): id is string => safeWorkerId(id))
  )
}

function isWorkerCancellationClaim(
  value: Partial<WorkerCancellationClaim>,
): value is WorkerCancellationClaim {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    typeof value.source === 'string' &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    typeof value.requestedAt === 'string' &&
    typeof value.ownerId === 'string' &&
    value.ownerId.length > 0
  )
}

function isEffect(value: unknown): value is RetainedRunEffect {
  return (
    value === 'unknown' ||
    value === 'cancel_requested' ||
    value === 'cancelled' ||
    value === 'not_live'
  )
}

function safeWorkerId(value: string): boolean {
  try {
    assertExactWorkerId(value)
    return true
  } catch {
    return false
  }
}

function safeOperationId(value: string): boolean {
  try {
    assertControlOperationId(value)
    return true
  } catch {
    return false
  }
}

function readEntries(directory: string): Dirent<string>[] {
  try {
    return readdirSync(directory, { withFileTypes: true, encoding: 'utf8' })
  } catch {
    return []
  }
}

function readLines(file: string): WorkerCancelRequest[] {
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const requests: WorkerCancelRequest[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<WorkerCancelRequest>
      if (isWorkerCancelRequest(parsed)) requests.push(parsed)
    } catch {
      // A partial or corrupt line does not hide later valid requests.
    }
  }
  return requests
}

function parseJson(file: string, description: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('expected an object')
    }
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new Error(`invalid ${description}`, { cause: error })
  }
}
