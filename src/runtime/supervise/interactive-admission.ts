/**
 * Durable, credential-free admissions for Runtime-owned interactive workers.
 *
 * `startRetainedInteractiveRun` deliberately asks its caller to persist each admission before it
 * advances. A supervised worker supplies this hook through `Scope`; the hook stores only recovery
 * coordinates and digests, never the profile, prompt, environment variables, or other private
 * create material.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import {
  type AgentInteractiveSessionRef,
  AgentInteractiveSessionRefSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { RetainedInteractiveAdmission } from '../retained-run-types'
import { publishExclusiveDurableFile } from './durable-file'
import { workerInteractiveBindingsDir } from './worker-interactive'

/** The Scope seam key used by `workerFromInteractiveProvider`. */
export const interactiveAdmissionSeamKey = 'runtime.interactiveAdmission'

/** The credential-free record written for one interactive admission phase. */
export type WorkerInteractiveAdmission =
  | {
      readonly schemaVersion: 1
      readonly workerId: string
      readonly recordedAt: string
      readonly phase: 'interactive_intent'
      readonly provider: string
      readonly idempotencyKey: string
      readonly interactiveIdempotencyKey: string
      readonly sessionId: string
      readonly executionId: string
      readonly runId: string
      readonly requestedProfileDigest: `sha256:${string}`
      readonly requestDigest: `sha256:${string}`
    }
  | {
      readonly schemaVersion: 1
      readonly workerId: string
      readonly recordedAt: string
      readonly phase: 'interactive_environment'
      readonly provider: string
      readonly environmentId: string
      readonly idempotencyKey: string
      readonly interactiveIdempotencyKey: string
      readonly requestDigest: `sha256:${string}`
    }
  | {
      readonly schemaVersion: 1
      readonly workerId: string
      readonly recordedAt: string
      readonly phase: 'interactive_started'
      readonly idempotencyKey: string
      readonly interactiveIdempotencyKey: string
      readonly ref: AgentInteractiveSessionRef
      readonly refDigest: `sha256:${string}`
    }

/** Runtime-owned admission sink supplied to an interactive worker executor. */
export type InteractiveAdmissionWriter = (admission: RetainedInteractiveAdmission) => Promise<void>

/** Return the exact credential-free admission file for one worker and phase. */
export function workerInteractiveAdmissionFile(
  eventDir: string,
  workerId: string,
  phase: WorkerInteractiveAdmission['phase'],
): string {
  const dir = workerInteractiveBindingsDir(eventDir)
  const id = stableText(workerId, 'worker id')
  assertNoSymlinkDescendant(eventDir, dir)
  const stem = canonicalCandidateDigest({ workerId: id }).slice('sha256:'.length).slice(0, 32)
  return join(dir, `${stem}.${phase}.admission.json`)
}

/** Read all durable admissions for one worker, oldest phase first. */
export function readWorkerInteractiveAdmissions(
  eventDir: string,
  workerId: string,
): ReadonlyArray<WorkerInteractiveAdmission> {
  const phases: ReadonlyArray<WorkerInteractiveAdmission['phase']> = [
    'interactive_intent',
    'interactive_environment',
    'interactive_started',
  ]
  const admissions: WorkerInteractiveAdmission[] = []
  let missingPhase = false
  for (const phase of phases) {
    const file = workerInteractiveAdmissionFile(eventDir, workerId, phase)
    if (!existsSync(file)) {
      missingPhase = true
      continue
    }
    if (missingPhase) {
      throw new Error(`interactive admission phase '${phase}' exists after a missing earlier phase`)
    }
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown
    admissions.push(parseAdmission(parsed, workerId, phase))
  }
  return admissions
}

/**
 * Persist one retained-interactive admission without retaining sensitive start material.
 *
 * The phase file is an idempotency key. A retry with the same exact admission is a no-op; a
 * different admission for the same phase fails closed rather than overwriting recovery evidence.
 */
export function writeWorkerInteractiveAdmission(
  eventDir: string,
  workerId: string,
  admission: RetainedInteractiveAdmission,
  now: () => number = Date.now,
): WorkerInteractiveAdmission {
  const id = stableText(workerId, 'worker id')
  const record = credentialFreeAdmission(id, admission, now)
  const file = workerInteractiveAdmissionFile(eventDir, id, record.phase)
  assertNoSymlinkDescendant(eventDir, file)
  mkdirSync(dirname(file), { recursive: true })
  assertNoSymlinkDescendant(eventDir, file)

  const existing = readWorkerInteractiveAdmission(eventDir, id, record.phase)
  if (existing !== undefined) {
    assertSameAdmission(existing, record)
    return existing
  }

  if (publishExclusiveDurableFile(file, `${JSON.stringify(record, null, 2)}\n`)) {
    return record
  }
  const winner = readWorkerInteractiveAdmission(eventDir, id, record.phase)
  if (winner === undefined) {
    throw new Error(`interactive admission publication for '${record.phase}' lost its winner`)
  }
  assertSameAdmission(winner, record)
  return winner
}

function credentialFreeAdmission(
  workerId: string,
  admission: RetainedInteractiveAdmission,
  now: () => number,
): WorkerInteractiveAdmission {
  const recordedAt = new Date(now()).toISOString()
  switch (admission.phase) {
    case 'interactive_intent':
      return {
        schemaVersion: 1,
        workerId,
        recordedAt,
        phase: admission.phase,
        provider: admission.provider,
        idempotencyKey: admission.idempotencyKey,
        interactiveIdempotencyKey: admission.interactiveIdempotencyKey,
        sessionId: admission.sessionId,
        executionId: admission.executionId,
        runId: admission.runId,
        requestedProfileDigest: admission.requestedProfileDigest,
        requestDigest: admission.requestDigest,
      }
    case 'interactive_environment':
      return {
        schemaVersion: 1,
        workerId,
        recordedAt,
        phase: admission.phase,
        provider: admission.provider,
        environmentId: admission.environmentId,
        idempotencyKey: admission.idempotencyKey,
        interactiveIdempotencyKey: admission.interactiveIdempotencyKey,
        requestDigest: canonicalCandidateDigest(admission.request),
      }
    case 'interactive_started':
      return {
        schemaVersion: 1,
        workerId,
        recordedAt,
        phase: admission.phase,
        idempotencyKey: admission.idempotencyKey,
        interactiveIdempotencyKey: admission.interactiveIdempotencyKey,
        ref: admission.ref,
        refDigest: canonicalCandidateDigest(admission.ref),
      }
  }
}

function readWorkerInteractiveAdmission(
  eventDir: string,
  workerId: string,
  phase: WorkerInteractiveAdmission['phase'],
): WorkerInteractiveAdmission | undefined {
  const file = workerInteractiveAdmissionFile(eventDir, workerId, phase)
  if (!existsSync(file)) return undefined
  return parseAdmission(JSON.parse(readFileSync(file, 'utf8')), workerId, phase)
}

function parseAdmission(
  value: unknown,
  expectedWorkerId?: string,
  expectedPhase?: WorkerInteractiveAdmission['phase'],
): WorkerInteractiveAdmission {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('interactive admission is malformed')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== 1 ||
    typeof record.workerId !== 'string' ||
    record.workerId.length === 0 ||
    typeof record.recordedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.recordedAt))
  ) {
    throw new Error('interactive admission is malformed')
  }
  if (expectedWorkerId !== undefined && record.workerId !== expectedWorkerId) {
    throw new Error('interactive admission worker id does not match its file')
  }
  if (record.phase === 'interactive_intent') {
    assertAllowedFields(record, [
      'schemaVersion',
      'workerId',
      'recordedAt',
      'phase',
      'provider',
      'idempotencyKey',
      'interactiveIdempotencyKey',
      'sessionId',
      'executionId',
      'runId',
      'requestedProfileDigest',
      'requestDigest',
    ])
    assertStrings(record, [
      'provider',
      'idempotencyKey',
      'interactiveIdempotencyKey',
      'sessionId',
      'executionId',
      'runId',
      'requestedProfileDigest',
      'requestDigest',
    ])
    assertDigest(record.requestedProfileDigest, 'interactive admission profile digest')
    assertDigest(record.requestDigest, 'interactive admission request digest')
    assertPhase(record.phase, expectedPhase)
    return {
      schemaVersion: 1,
      workerId: record.workerId,
      recordedAt: record.recordedAt,
      phase: record.phase,
      provider: record.provider as string,
      idempotencyKey: record.idempotencyKey as string,
      interactiveIdempotencyKey: record.interactiveIdempotencyKey as string,
      sessionId: record.sessionId as string,
      executionId: record.executionId as string,
      runId: record.runId as string,
      requestedProfileDigest: record.requestedProfileDigest,
      requestDigest: record.requestDigest,
    }
  }
  if (record.phase === 'interactive_environment') {
    assertAllowedFields(record, [
      'schemaVersion',
      'workerId',
      'recordedAt',
      'phase',
      'provider',
      'environmentId',
      'idempotencyKey',
      'interactiveIdempotencyKey',
      'requestDigest',
    ])
    assertStrings(record, [
      'provider',
      'environmentId',
      'idempotencyKey',
      'interactiveIdempotencyKey',
      'requestDigest',
    ])
    assertDigest(record.requestDigest, 'interactive admission environment request digest')
    assertPhase(record.phase, expectedPhase)
    return {
      schemaVersion: 1,
      workerId: record.workerId,
      recordedAt: record.recordedAt,
      phase: record.phase,
      provider: record.provider as string,
      environmentId: record.environmentId as string,
      idempotencyKey: record.idempotencyKey as string,
      interactiveIdempotencyKey: record.interactiveIdempotencyKey as string,
      requestDigest: record.requestDigest,
    }
  }
  if (record.phase === 'interactive_started') {
    assertAllowedFields(record, [
      'schemaVersion',
      'workerId',
      'recordedAt',
      'phase',
      'idempotencyKey',
      'interactiveIdempotencyKey',
      'ref',
      'refDigest',
    ])
    assertStrings(record, ['idempotencyKey', 'interactiveIdempotencyKey', 'refDigest'])
    const ref = AgentInteractiveSessionRefSchema.parse(record.ref)
    const refDigest = canonicalCandidateDigest(ref)
    if (record.refDigest !== refDigest) {
      throw new Error('interactive admission ref digest does not match its exact ref')
    }
    assertPhase(record.phase, expectedPhase)
    return {
      schemaVersion: 1,
      workerId: record.workerId,
      recordedAt: record.recordedAt,
      phase: record.phase,
      idempotencyKey: record.idempotencyKey as string,
      interactiveIdempotencyKey: record.interactiveIdempotencyKey as string,
      ref,
      refDigest,
    }
  }
  throw new Error('interactive admission has an invalid phase')
}

function assertDigest(value: unknown, label: string): asserts value is `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/u.test(value)) {
    throw new Error(`${label} is malformed`)
  }
}

function assertPhase(
  phase: WorkerInteractiveAdmission['phase'],
  expected: WorkerInteractiveAdmission['phase'] | undefined,
): void {
  if (expected !== undefined && phase !== expected) {
    throw new Error('interactive admission phase does not match its file')
  }
}

function assertStrings(record: Record<string, unknown>, keys: ReadonlyArray<string>): void {
  for (const key of keys) {
    if (typeof record[key] !== 'string' || (record[key] as string).length === 0) {
      throw new Error(`interactive admission field '${key}' is invalid`)
    }
  }
}

function assertAllowedFields(
  record: Record<string, unknown>,
  allowed: ReadonlyArray<string>,
): void {
  const fields = new Set(allowed)
  const unsupported = Object.keys(record).filter((key) => !fields.has(key))
  if (unsupported.length > 0) {
    throw new Error(`interactive admission contains unsupported fields: ${unsupported.join(', ')}`)
  }
}

function assertSameAdmission(
  current: WorkerInteractiveAdmission,
  candidate: WorkerInteractiveAdmission,
): void {
  const comparable = (value: WorkerInteractiveAdmission): unknown => {
    const { recordedAt: _recordedAt, ...stable } = value
    return stable
  }
  if (
    canonicalCandidateDigest(comparable(current)) !==
    canonicalCandidateDigest(comparable(candidate))
  ) {
    throw new Error(
      `worker '${candidate.workerId}' already has a different ${candidate.phase} admission`,
    )
  }
}

function stableText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new Error(`${label} is empty`)
  return text
}

function assertNoSymlinkDescendant(root: string, target: string): void {
  const base = resolve(root)
  const exact = resolve(target)
  const rel = relative(base, exact)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error('interactive admission path escapes its run directory')
  }
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) {
    throw new Error(`interactive admission path contains a symbolic link: ${base}`)
  }
  let current = base
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`interactive admission path contains a symbolic link: ${current}`)
    }
  }
}
