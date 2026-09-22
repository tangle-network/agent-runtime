import { randomUUID } from 'node:crypto'
import { type Dirent, existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { DownMessageDeliveryOutcome } from '../../mcp/tools/coordination'
import type { WorkerControlPersistence } from './worker-control-layout'
import {
  appendWorkerControlEvent,
  assertControlOperationId,
  assertExactWorkerId,
  defaultWorkerControlPersistence,
  SupervisorOperationConflictError,
  supervisorRunDir,
  supervisorWorkersDir,
  workerInboxFileFromEventDir,
  workerSteerAcknowledgementFile,
  workerSteerClaimFile,
  workerSteerIntentFile,
  workerSteerIntentsDir,
} from './worker-control-layout'

/** One durable down-leg request for one exact worker id. */
export interface WorkerSteerRequest {
  readonly id: string
  /** Caller-supplied idempotency key, when this steer must survive a retry. */
  readonly operationId?: string
  readonly at: string
  readonly source: string
  readonly worker: string
  readonly message: string
}

/** The durable result of one Runtime worker steer. */
export interface WorkerSteerAcknowledgement {
  readonly operationId: string
  readonly worker: string
  readonly source: string
  readonly message: string
  readonly requestId: string
  readonly requestedAt: string
  readonly observedAt: string
  /** The attempt was committed, but its final delivery effect is not proven. */
  readonly effect: 'unknown' | DownMessageDeliveryOutcome
  readonly detail?: string
  /** The Runtime process that owned the attempt, when written by the current protocol. */
  readonly ownerId?: string
}

export type WorkerSteerEffect = WorkerSteerAcknowledgement['effect']

export interface WorkerSteerOptions {
  readonly source?: string
  readonly operationId?: string
  readonly persistence?: WorkerControlPersistence
}

interface WorkerSteerClaim {
  readonly operationId: string
  readonly worker: string
  readonly source: string
  readonly message: string
  readonly requestId: string
  readonly requestedAt: string
  readonly ownerId: string
}

export interface WorkerSteerStore {
  readonly enqueue: (
    worker: string,
    message: string,
    source: string | undefined,
    operationId: string,
  ) => { worker: string; file: string; request: WorkerSteerRequest }
  readonly requests: () => WorkerSteerRequest[]
  readonly requestsForWorker: (worker: string) => WorkerSteerRequest[]
  readonly readAcknowledgement: (operationId: string) => WorkerSteerAcknowledgement | undefined
  readonly writeAcknowledgement: (record: WorkerSteerAcknowledgement) => void
  /** Claim before delivery. `true` means this owner may perform the one attempt. */
  readonly claim: (request: WorkerSteerRequest, ownerId: string) => boolean
  readonly assertAcknowledgementMatchesRequest: (
    acknowledgement: WorkerSteerAcknowledgement,
    request: WorkerSteerRequest,
  ) => void
}

/** Construct the durable steer store for one run directory. */
export function createWorkerSteerStore(
  eventDir: string,
  options: { readonly persistence?: WorkerControlPersistence } = {},
): WorkerSteerStore {
  const persistence = options.persistence ?? defaultWorkerControlPersistence

  const enqueue = (
    worker: string,
    message: string,
    source: string | undefined,
    operationId: string,
  ): { worker: string; file: string; request: WorkerSteerRequest } => {
    assertExactWorkerId(worker)
    assertControlOperationId(operationId)
    const trimmed = message.trim()
    if (!trimmed) throw new Error('steer message is empty')
    const effectiveSource = source ?? 'human'
    const existingAcknowledgement = readAcknowledgement(operationId)
    if (existingAcknowledgement !== undefined) {
      assertAcknowledgementBinding(existingAcknowledgement, worker, source, trimmed, operationId)
      return {
        worker: existingAcknowledgement.worker,
        file: workerInboxFileFromEventDir(eventDir, existingAcknowledgement.worker),
        request: requestFromAcknowledgement(existingAcknowledgement),
      }
    }

    const request: WorkerSteerRequest = {
      id: randomUUID(),
      operationId,
      at: new Date().toISOString(),
      source: effectiveSource,
      worker,
      message: trimmed,
    }
    const intentFile = workerSteerIntentFile(eventDir, operationId)
    const created = persistence.createFile(intentFile, `${JSON.stringify(request)}\n`)
    const durableRequest = created
      ? request
      : (readSteerIntent(eventDir, operationId) ?? findRequest(eventDir, operationId))
    if (durableRequest === undefined) {
      throw new Error(`steer intent '${operationId}' exists but cannot be read`)
    }
    assertRequestBinding(durableRequest, worker, source, trimmed, operationId)
    if (created) {
      // The intent is authoritative. If this append fails, a later Runtime pass still finds the
      // intent and can deliver it exactly once under the operation claim.
      persistence.appendFile(
        workerInboxFileFromEventDir(eventDir, durableRequest.worker),
        `${JSON.stringify(durableRequest)}\n`,
      )
      appendWorkerControlEvent(
        eventDir,
        durableRequest.worker,
        {
          kind: 'message',
          direction: 'down',
          source: durableRequest.source,
          requestId: durableRequest.id,
          operationId,
          message: durableRequest.message,
          queued: true,
          delivered: false,
        },
        persistence,
      )
    }
    return {
      worker: durableRequest.worker,
      file: workerInboxFileFromEventDir(eventDir, durableRequest.worker),
      request: durableRequest,
    }
  }

  const readAcknowledgement = (operationId: string): WorkerSteerAcknowledgement | undefined => {
    assertControlOperationId(operationId)
    const file = workerSteerAcknowledgementFile(eventDir, operationId)
    if (existsSync(file)) {
      const parsed = parseJson(file, `steer acknowledgement '${operationId}'`)
      if (parsed.operationId !== operationId) {
        throw new Error(
          `steer acknowledgement collision: '${file}' holds operation '${parsed.operationId}', not '${operationId}'`,
        )
      }
      if (!isWorkerSteerAcknowledgement(parsed)) {
        throw new Error(`invalid steer acknowledgement for operation '${operationId}'`)
      }
      return parsed
    }
    const claimFile = workerSteerClaimFile(eventDir, operationId)
    if (!existsSync(claimFile)) return undefined
    const claim = parseJson(claimFile, `steer claim '${operationId}'`)
    if (!isWorkerSteerClaim(claim) || claim.operationId !== operationId) {
      throw new Error(`invalid steer claim for operation '${operationId}'`)
    }
    return {
      operationId: claim.operationId,
      worker: claim.worker,
      source: claim.source,
      message: claim.message,
      requestId: claim.requestId,
      requestedAt: claim.requestedAt,
      observedAt: claim.requestedAt,
      effect: 'unknown',
      ownerId: claim.ownerId,
      detail: 'operation claim is durable; delivery effect is unknown',
    }
  }

  const writeAcknowledgement = (record: WorkerSteerAcknowledgement): void => {
    assertExactWorkerId(record.worker)
    assertControlOperationId(record.operationId)
    if (!isWorkerSteerAcknowledgementData(record)) {
      throw new Error(`invalid steer acknowledgement for operation '${record.operationId}'`)
    }
    const existing = readAcknowledgement(record.operationId)
    if (existing !== undefined) {
      assertAcknowledgementBinding(
        existing,
        record.worker,
        record.source,
        record.message,
        record.operationId,
      )
      if (existing.effect !== 'unknown') {
        if (existing.effect !== record.effect) {
          throw new SupervisorOperationConflictError(
            record.operationId,
            `steer effect '${existing.effect}' cannot transition to '${record.effect}'`,
          )
        }
        return
      }
    }
    persistence.replaceFile(
      workerSteerAcknowledgementFile(eventDir, record.operationId),
      `${JSON.stringify(record, null, 2)}\n`,
    )
  }

  const claim = (request: WorkerSteerRequest, ownerId: string): boolean => {
    const operationId = request.operationId ?? request.id
    assertRequest(request)
    assertControlOperationId(operationId)
    if (!ownerId || ownerId.trim() !== ownerId) throw new Error('steer ownerId is empty or unsafe')
    const claim: WorkerSteerClaim = {
      operationId,
      worker: request.worker,
      source: request.source,
      message: request.message,
      requestId: request.id,
      requestedAt: request.at,
      ownerId,
    }
    const file = workerSteerClaimFile(eventDir, operationId)
    if (persistence.createFile(file, `${JSON.stringify(claim)}\n`)) return true
    const existing = parseJson(file, `steer claim '${operationId}'`)
    if (!isWorkerSteerClaim(existing) || existing.operationId !== operationId) {
      throw new Error(`invalid steer claim for operation '${operationId}'`)
    }
    assertClaimBinding(existing, claim)
    // A claim owned by another process stays exclusive, even if both processes were given the
    // same logical owner label. The driver supplies a process-unique owner token.
    return false
  }

  const requests = (): WorkerSteerRequest[] => readRequests(eventDir)
  const requestsForWorker = (worker: string): WorkerSteerRequest[] => {
    assertExactWorkerId(worker)
    return requests().filter((request) => request.worker === worker)
  }

  return {
    enqueue,
    requests,
    requestsForWorker,
    readAcknowledgement,
    writeAcknowledgement,
    claim,
    assertAcknowledgementMatchesRequest: (acknowledgement, request) =>
      assertAcknowledgementMatchesRequest(acknowledgement, request),
  }
}

/** Durably enqueue one steer request. */
export function writeWorkerSteer(
  rootDir: string,
  supervisorId: string,
  worker: string,
  message: string,
  source?: string,
  operationId?: string,
): { worker: string; file: string; request: WorkerSteerRequest }
export function writeWorkerSteer(
  rootDir: string,
  supervisorId: string,
  worker: string,
  message: string,
  options?: WorkerSteerOptions,
): { worker: string; file: string; request: WorkerSteerRequest }
export function writeWorkerSteer(
  rootDir: string,
  supervisorId: string,
  worker: string,
  message: string,
  sourceOrOptions: string | WorkerSteerOptions = 'human',
  operationIdArgument?: string,
): { worker: string; file: string; request: WorkerSteerRequest } {
  assertExactWorkerId(worker)
  const source = typeof sourceOrOptions === 'string' ? sourceOrOptions : sourceOrOptions.source
  const operationId =
    typeof sourceOrOptions === 'string'
      ? (operationIdArgument ?? randomUUID())
      : (sourceOrOptions.operationId ?? randomUUID())
  assertControlOperationId(operationId)
  const eventDir = supervisorRunDir(rootDir, supervisorId)
  return createWorkerSteerStore(
    eventDir,
    typeof sourceOrOptions === 'string' ? {} : { persistence: sourceOrOptions.persistence },
  ).enqueue(worker, message, source, operationId)
}

/** Read every valid steer request for one exact worker id. */
export function readWorkerSteerRequests(eventDir: string, worker: string): WorkerSteerRequest[] {
  assertExactWorkerId(worker)
  return createWorkerSteerStore(eventDir).requestsForWorker(worker)
}

/** Read every valid steer request without using a filename as the worker identity. */
export function readWorkerSteerRequestsForRun(eventDir: string): WorkerSteerRequest[] {
  return createWorkerSteerStore(eventDir).requests()
}

/** Read one steer acknowledgement. */
export function readWorkerSteerAcknowledgement(
  eventDir: string,
  operationId: string,
): WorkerSteerAcknowledgement | undefined {
  return createWorkerSteerStore(eventDir).readAcknowledgement(operationId)
}

/** Persist one steer attempt or final effect. */
export function writeWorkerSteerAcknowledgement(
  eventDir: string,
  record: WorkerSteerAcknowledgement,
  persistence?: WorkerControlPersistence,
): void {
  createWorkerSteerStore(eventDir, { persistence }).writeAcknowledgement(record)
}

function readRequests(eventDir: string): WorkerSteerRequest[] {
  const byOperation = new Map<string, WorkerSteerRequest>()
  const add = (request: WorkerSteerRequest): void => {
    if (!isWorkerSteerRequest(request)) return
    const operationId = request.operationId ?? request.id
    const existing = byOperation.get(operationId)
    if (existing !== undefined) {
      assertRequestBinding(existing, request.worker, request.source, request.message, operationId)
      return
    }
    byOperation.set(
      operationId,
      request.operationId === undefined ? { ...request, operationId } : request,
    )
  }

  const inboxDir = supervisorWorkersDir(eventDir)
  if (existsSync(inboxDir)) {
    for (const entry of readEntries(inboxDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.inbox.ndjson')) continue
      for (const request of readLines(join(inboxDir, entry.name))) add(request)
    }
  }
  const intentsDir = workerSteerIntentsDir(eventDir)
  if (existsSync(intentsDir)) {
    for (const entry of readEntries(intentsDir)) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      const parsed = parseJson(join(intentsDir, entry.name), 'steer intent')
      if (isWorkerSteerRequest(parsed)) add(parsed)
    }
  }
  return [...byOperation.values()]
}

function findRequest(eventDir: string, operationId: string): WorkerSteerRequest | undefined {
  return readRequests(eventDir).find(
    (request) => (request.operationId ?? request.id) === operationId,
  )
}

function readSteerIntent(eventDir: string, operationId: string): WorkerSteerRequest | undefined {
  const file = workerSteerIntentFile(eventDir, operationId)
  if (!existsSync(file)) return undefined
  const parsed = parseJson(file, `steer intent '${operationId}'`)
  return isWorkerSteerRequest(parsed) ? parsed : undefined
}

function assertAcknowledgementMatchesRequest(
  acknowledgement: WorkerSteerAcknowledgement,
  request: WorkerSteerRequest,
): void {
  const operationId = request.operationId ?? request.id
  assertAcknowledgementBinding(
    acknowledgement,
    request.worker,
    request.source,
    request.message,
    operationId,
  )
}

function assertAcknowledgementBinding(
  existing: WorkerSteerAcknowledgement,
  worker: string,
  source: string | undefined,
  message: string,
  operationId: string,
): void {
  if (
    existing.worker !== worker ||
    (source !== undefined && existing.source !== source) ||
    existing.message !== message ||
    existing.operationId !== operationId
  ) {
    throw new SupervisorOperationConflictError(
      operationId,
      'steer acknowledgement disagrees on worker, source, or message',
    )
  }
}

function assertRequestBinding(
  existing: WorkerSteerRequest,
  worker: string,
  source: string | undefined,
  message: string,
  operationId: string,
): void {
  if (
    existing.worker !== worker ||
    (source !== undefined && existing.source !== source) ||
    existing.message !== message ||
    (existing.operationId ?? existing.id) !== operationId
  ) {
    throw new SupervisorOperationConflictError(
      operationId,
      'steer request disagrees on worker, source, or message',
    )
  }
}

function assertClaimBinding(existing: WorkerSteerClaim, claim: WorkerSteerClaim): void {
  if (
    existing.worker !== claim.worker ||
    existing.source !== claim.source ||
    existing.message !== claim.message ||
    existing.requestId !== claim.requestId
  ) {
    throw new SupervisorOperationConflictError(
      claim.operationId,
      'steer claim disagrees on worker, source, message, or request id',
    )
  }
}

function requestFromAcknowledgement(
  acknowledgement: WorkerSteerAcknowledgement,
): WorkerSteerRequest {
  return {
    id: acknowledgement.requestId,
    operationId: acknowledgement.operationId,
    at: acknowledgement.requestedAt,
    source: acknowledgement.source,
    worker: acknowledgement.worker,
    message: acknowledgement.message,
  }
}

function assertRequest(request: WorkerSteerRequest): void {
  if (!isWorkerSteerRequest(request)) throw new Error('invalid steer request')
}

function isWorkerSteerRequest(value: Partial<WorkerSteerRequest>): value is WorkerSteerRequest {
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0 &&
    (value.operationId === undefined || safeOperationId(value.operationId))
  )
}

function isWorkerSteerAcknowledgement(
  value: Partial<WorkerSteerAcknowledgement>,
): value is WorkerSteerAcknowledgement {
  return isWorkerSteerAcknowledgementData(value)
}

function isWorkerSteerAcknowledgementData(value: Partial<WorkerSteerAcknowledgement>): boolean {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    typeof value.source === 'string' &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0 &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    typeof value.requestedAt === 'string' &&
    typeof value.observedAt === 'string' &&
    isWorkerSteerEffect(value.effect) &&
    (value.detail === undefined || typeof value.detail === 'string') &&
    (value.ownerId === undefined || typeof value.ownerId === 'string')
  )
}

function isWorkerSteerClaim(value: Partial<WorkerSteerClaim>): value is WorkerSteerClaim {
  return (
    typeof value.operationId === 'string' &&
    safeOperationId(value.operationId) &&
    typeof value.worker === 'string' &&
    safeWorkerId(value.worker) &&
    typeof value.source === 'string' &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0 &&
    typeof value.requestId === 'string' &&
    value.requestId.length > 0 &&
    typeof value.requestedAt === 'string' &&
    typeof value.ownerId === 'string' &&
    value.ownerId.length > 0
  )
}

function isWorkerSteerEffect(value: unknown): value is WorkerSteerEffect {
  return (
    value === 'unknown' ||
    value === 'delivered' ||
    value === 'unknown-worker' ||
    value === 'already-settled' ||
    value === 'runtime-has-no-inbox' ||
    value === 'scope-stopped' ||
    value === 'runtime-error'
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

function readLines(file: string): WorkerSteerRequest[] {
  if (!existsSync(file)) return []
  let raw: string
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const requests: WorkerSteerRequest[] = []
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<WorkerSteerRequest>
      if (isWorkerSteerRequest(parsed)) requests.push(parsed)
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
