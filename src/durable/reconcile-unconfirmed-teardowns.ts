import { resolve } from 'node:path'
import type { SupervisedResult } from '../runtime/supervise/types'
import {
  acquireRunDirectoryLock,
  RUN_DIRECTORY_LOCK_FILE,
  RunDirectoryLockedError,
  runDirectoryHolderIsLive,
} from './run-lock'
import { readSettleRecord } from './settle-record'

/**
 * Read each unconfirmed environment of a settled run by the provider's own id, delete only
 * the ones the provider still holds, and report which were already gone, which this call
 * deleted, and which could not be decided. A kept environment is never read or deleted.
 * The port reads and deletes one id at a time; a fleet listing cannot hide a named worker.
 */

/** One environment named by the provider that issued it. */
export interface EnvironmentTarget {
  readonly provider: string
  readonly environmentId: string
}

/** What a direct read of one environment proved. `unknown` means the read did not decide. */
export type EnvironmentPresence =
  | { readonly state: 'absent' }
  | { readonly state: 'present' }
  | { readonly state: 'unknown'; readonly detail: string }

/** What a delete of one environment the read found present proved. */
export type EnvironmentDeletion =
  | { readonly state: 'deleted' }
  | { readonly state: 'absent' }
  | { readonly state: 'unknown'; readonly detail: string }

/**
 * The caller's provider adapter. `read` and `delete` take the provider's own id.
 * A delete that finds the environment already gone reports `absent`.
 */
export interface UnconfirmedEnvironmentPort {
  read(target: EnvironmentTarget): Promise<EnvironmentPresence>
  delete(target: EnvironmentTarget): Promise<EnvironmentDeletion>
}

/** An environment this call proved gone. `nodeId` is the teardown record that named it. */
export interface ReconciledEnvironment extends EnvironmentTarget {
  readonly nodeId?: string
}

/** An environment, or a node with no id, this call could not decide. */
export interface UnreconciledEnvironment {
  readonly nodeId?: string
  readonly provider?: string
  readonly environmentId?: string
  readonly detail: string
}

/** The three sets one reconcile call returns. A repeated id is acted on once and reported
 *  on every node that names it. */
export interface UnconfirmedTeardownReconcile {
  readonly confirmed: readonly ReconciledEnvironment[]
  readonly deleted: readonly ReconciledEnvironment[]
  readonly unknown: readonly UnreconciledEnvironment[]
}

/** The directory has no settle record, so there is no settled run to reconcile. */
export class NoSettleRecordError extends Error {
  readonly runDir: string

  constructor(runDir: string) {
    super(`reconcileUnconfirmedTeardowns: ${runDir} has no settle record`)
    this.name = 'NoSettleRecordError'
    this.runDir = runDir
  }
}

const DETAIL_LIMIT = 240

type Decision =
  | { readonly kind: 'confirmed' }
  | { readonly kind: 'deleted' }
  | { readonly kind: 'unknown'; readonly detail: string }

/** Finish unconfirmed teardowns named by a settled run's `result.json`. */
export async function reconcileUnconfirmedTeardowns(
  runDir: string,
  port: UnconfirmedEnvironmentPort,
): Promise<UnconfirmedTeardownReconcile> {
  const directory = resolve(runDir)
  const holder = await runDirectoryHolderIsLive(directory)
  if (holder.live) {
    if (holder.holder === undefined) {
      throw new Error(
        `reconcileUnconfirmedTeardowns: ${directory} is held by a lock this host cannot read`,
      )
    }
    throw new RunDirectoryLockedError(resolve(directory, RUN_DIRECTORY_LOCK_FILE), holder.holder)
  }
  const settled = await readSettleRecord(directory)
  if (settled === undefined) throw new NoSettleRecordError(directory)
  const lock = await acquireRunDirectoryLock(directory, settled.tree.root)
  try {
    const current = await readSettleRecord(directory)
    if (current === undefined) throw new NoSettleRecordError(directory)
    return await sweep(current, port)
  } finally {
    await lock.release()
  }
}

async function sweep(
  settled: SupervisedResult<unknown>,
  port: UnconfirmedEnvironmentPort,
): Promise<UnconfirmedTeardownReconcile> {
  const listed = settled.teardownUnconfirmed
  if (listed === undefined) return { confirmed: [], deleted: [], unknown: [] }
  if (!Array.isArray(listed)) {
    throw new Error(
      'reconcileUnconfirmedTeardowns: settle record teardownUnconfirmed is not an array',
    )
  }
  const confirmed: ReconciledEnvironment[] = []
  const deleted: ReconciledEnvironment[] = []
  const unknown: UnreconciledEnvironment[] = []
  const decided = new Map<string, Promise<Decision>>()
  for (const entry of listed) await oneNode(entry, port, decided, confirmed, deleted, unknown)
  return { confirmed, deleted, unknown }
}

async function oneNode(
  entry: unknown,
  port: UnconfirmedEnvironmentPort,
  decided: Map<string, Promise<Decision>>,
  confirmed: ReconciledEnvironment[],
  deleted: ReconciledEnvironment[],
  unknown: UnreconciledEnvironment[],
): Promise<void> {
  if (typeof entry !== 'object' || entry === null) {
    unknown.push({ detail: 'unreadable teardown record' })
    return
  }
  const record = entry as {
    id?: unknown
    environments?: unknown
    kept?: unknown
  }
  const nodeId = typeof record.id === 'string' && record.id.length > 0 ? record.id : undefined
  const environments = Array.isArray(record.environments) ? record.environments : []
  const keptIds = keptKeys(record.kept)
  const sweepable: EnvironmentTarget[] = []
  let unnamed = 0
  for (const item of environments) {
    const named = sweepableEnvironment(item)
    if (named === 'kept') continue
    if (named !== undefined && keptIds.has(`${named.provider}\0${named.environmentId}`)) continue
    if (named === undefined) unnamed += 1
    else sweepable.push(named)
  }
  if (sweepable.length === 0 && unnamed === 0 && environments.length === 0 && keptIds.size === 0) {
    unknown.push({ ...(nodeId === undefined ? {} : { nodeId }), detail: 'no environment id' })
    return
  }
  for (let index = 0; index < unnamed; index += 1) {
    unknown.push({
      ...(nodeId === undefined ? {} : { nodeId }),
      detail: 'environment record has no provider id',
    })
  }
  for (const target of sweepable) {
    const outcome = await decisionFor(port, decided, target)
    const row = { ...(nodeId === undefined ? {} : { nodeId }), ...target }
    if (outcome.kind === 'confirmed') confirmed.push(row)
    else if (outcome.kind === 'deleted') deleted.push(row)
    else unknown.push({ ...row, detail: outcome.detail })
  }
}

function keptKeys(value: unknown): Set<string> {
  const keys = new Set<string>()
  if (!Array.isArray(value)) return keys
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as { provider?: unknown; environmentId?: unknown }
    if (typeof record.provider !== 'string' || typeof record.environmentId !== 'string') continue
    keys.add(`${record.provider}\0${record.environmentId}`)
  }
  return keys
}

function sweepableEnvironment(value: unknown): EnvironmentTarget | 'kept' | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const record = value as { provider?: unknown; environmentId?: unknown; keptFor?: unknown }
  if (record.keptFor !== undefined) return 'kept'
  if (typeof record.provider !== 'string' || record.provider.length === 0) return undefined
  if (typeof record.environmentId !== 'string' || record.environmentId.length === 0) {
    return undefined
  }
  return { provider: record.provider, environmentId: record.environmentId }
}

function decisionFor(
  port: UnconfirmedEnvironmentPort,
  decided: Map<string, Promise<Decision>>,
  target: EnvironmentTarget,
): Promise<Decision> {
  const key = `${target.provider}\0${target.environmentId}`
  const cached = decided.get(key)
  if (cached !== undefined) return cached
  const pending = decide(port, target)
  decided.set(key, pending)
  return pending
}

async function decide(
  port: UnconfirmedEnvironmentPort,
  target: EnvironmentTarget,
): Promise<Decision> {
  try {
    const read = await port.read(target)
    if (read?.state === 'absent') return { kind: 'confirmed' }
    if (read?.state !== 'present') {
      return {
        kind: 'unknown',
        detail: detailOf(read?.state === 'unknown' ? read.detail : undefined),
      }
    }
    const removed = await port.delete(target)
    if (removed?.state === 'deleted' || removed?.state === 'absent') return { kind: 'deleted' }
    return {
      kind: 'unknown',
      detail: detailOf(removed?.state === 'unknown' ? removed.detail : undefined),
    }
  } catch (error) {
    return { kind: 'unknown', detail: detailOf(error) }
  }
}

function detailOf(value: unknown): string {
  const text =
    value instanceof Error
      ? value.message
      : typeof value === 'string'
        ? value
        : 'unreadable provider answer'
  const oneLine = text.replace(/\s+/g, ' ').trim()
  const bounded = oneLine.length > DETAIL_LIMIT ? `${oneLine.slice(0, DETAIL_LIMIT - 1)}…` : oneLine
  return bounded.length > 0 ? bounded : 'unreadable provider answer'
}
