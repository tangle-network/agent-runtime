import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { AgentInteractiveSessionRef } from '@tangle-network/agent-interface'
import {
  AgentInteractiveSessionRefSchema,
  canonicalCandidateDigest,
} from '@tangle-network/agent-interface'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { FileSpawnJournal, loadSpawnForest } from '../../durable/spawn-journal'
import type { AgentEnvironmentProviderRegistry } from '../environment-provider'
import { reconnectRetainedInteractiveRun } from '../retained-interactive'
import { assertNoSymlinkDescendant, publishExclusiveDurableFile } from './durable-file'
import type { WorkerInteractiveSession, WorkerInteractiveUnavailableReason } from './types'

const WORKER_BINDING_SCHEMA_VERSION = 1 as const
const SPAWN_JOURNAL_FILE = 'spawn-journal.jsonl'

/** Durable exact-process binding or capability decision for one supervised worker. @stable */
export type WorkerInteractiveBinding =
  | {
      readonly schemaVersion: 1
      readonly workerId: string
      readonly label: string
      readonly journalRoot: string
      readonly recordedAt: string
      readonly status: 'available'
      readonly ref: AgentInteractiveSessionRef
      readonly refDigest: `sha256:${string}`
    }
  | {
      readonly schemaVersion: 1
      readonly workerId: string
      readonly label: string
      readonly journalRoot: string
      readonly recordedAt: string
      readonly status: 'unavailable'
      readonly reason: WorkerInteractiveUnavailableReason
    }

/** Provider lookup accepted by {@link attachWorker}. @stable */
export type WorkerInteractiveProviderSource =
  | AgentEnvironmentProvider
  | AgentEnvironmentProviderRegistry

/** Options for reconstructing one worker's exact retained interactive process. @stable */
export interface AttachWorkerOptions {
  readonly providers: WorkerInteractiveProviderSource
  readonly signal?: AbortSignal
}

/** Directory containing exact per-worker interactive binding records. @stable */
export function workerInteractiveBindingsDir(eventDir: string): string {
  return join(eventDir, 'interactive-workers')
}

/** Exact durable binding file for one worker id. @stable */
export function workerInteractiveBindingFile(eventDir: string, workerId: string): string {
  const id = stableText(workerId, 'worker id')
  const stem = createHash('sha256').update(id).digest('hex')
  return join(workerInteractiveBindingsDir(eventDir), `${stem}.json`)
}

/** Read and validate one exact durable worker binding. @stable */
export function readWorkerInteractiveBinding(
  eventDir: string,
  workerId: string,
): WorkerInteractiveBinding | undefined {
  const id = stableText(workerId, 'worker id')
  const file = workerInteractiveBindingFile(eventDir, id)
  assertNoSymlinkDescendant(eventDir, file, 'worker interactive')
  if (!existsSync(file)) return undefined
  const binding = parseBinding(JSON.parse(readFileSync(file, 'utf8')))
  if (binding.workerId !== id) {
    throw new Error(
      `worker interactive binding collision: '${file}' holds '${binding.workerId}', not '${id}'`,
    )
  }
  return binding
}

/**
 * Publish the exact interactive capability of one worker after its spawn record commits.
 * Replays of the same binding are no-ops; a different binding for one worker fails loud.
 * @internal
 */
export function writeWorkerInteractiveBinding(
  eventDir: string,
  workerId: string,
  label: string,
  journalRoot: string,
  session: WorkerInteractiveSession,
  now = Date.now,
): WorkerInteractiveBinding {
  const id = stableText(workerId, 'worker id')
  const workerLabel = stableText(label, 'worker label')
  const root = stableText(journalRoot, 'journal root')
  const binding: WorkerInteractiveBinding =
    session.status === 'available'
      ? (() => {
          const ref = AgentInteractiveSessionRefSchema.parse(session.handle.ref)
          return {
            schemaVersion: WORKER_BINDING_SCHEMA_VERSION,
            workerId: id,
            label: workerLabel,
            journalRoot: root,
            recordedAt: new Date(now()).toISOString(),
            status: 'available',
            ref,
            refDigest: canonicalCandidateDigest(ref),
          }
        })()
      : {
          schemaVersion: WORKER_BINDING_SCHEMA_VERSION,
          workerId: id,
          label: workerLabel,
          journalRoot: root,
          recordedAt: new Date(now()).toISOString(),
          status: 'unavailable',
          reason: session.reason,
        }
  const file = workerInteractiveBindingFile(eventDir, id)
  assertNoSymlinkDescendant(eventDir, file, 'worker interactive')
  mkdirSync(dirname(file), { recursive: true })
  assertNoSymlinkDescendant(eventDir, file, 'worker interactive')
  const existing = readWorkerInteractiveBinding(eventDir, id)
  if (existing !== undefined) {
    assertSameBinding(existing, binding)
    return existing
  }
  if (publishExclusiveDurableFile(file, `${JSON.stringify(binding, null, 2)}\n`)) {
    return binding
  }
  const winner = readWorkerInteractiveBinding(eventDir, id)
  if (winner === undefined) {
    throw new Error(`worker interactive binding publication lost its winner`)
  }
  assertSameBinding(winner, binding)
  return winner
}

/**
 * Reconstruct the exact provider-owned interactive process bound to one supervised worker.
 * Unknown, headless, unsupported, settled, stale, and unregistered-provider cases fail closed.
 * @stable
 */
export async function attachWorker(
  eventDir: string,
  workerId: string,
  options: AttachWorkerOptions,
): Promise<WorkerInteractiveSession> {
  const id = stableText(workerId, 'worker id')
  options.signal?.throwIfAborted()
  const binding = readWorkerInteractiveBinding(eventDir, id)
  if (binding === undefined) {
    const lifecycle = workerLifecycle(eventDir, id)
    return unavailable(
      lifecycle.terminal
        ? 'not-live'
        : lifecycle.spawned
          ? 'interactive-binding-not-found'
          : 'unknown-node',
    )
  }
  try {
    const forest = await loadSpawnForest(
      new FileSpawnJournal(join(eventDir, SPAWN_JOURNAL_FILE)),
      binding.journalRoot,
    )
    const node = forest.nodes.find((candidate) => candidate.id === id)
    if (node === undefined) return unavailable('unknown-node')
    if (node.status === 'done' || node.status === 'failed' || node.status === 'cancelled') {
      return unavailable('not-live')
    }
  } catch {
    return unavailable('interactive-binding-stale')
  }
  if (binding.status === 'unavailable') return unavailable(binding.reason)
  const provider = resolveProvider(options.providers, binding.ref.run.provider)
  if (provider === undefined) return unavailable('interactive-provider-not-registered')
  let handle: Awaited<ReturnType<typeof reconnectRetainedInteractiveRun>>
  try {
    handle = await reconnectRetainedInteractiveRun({
      provider,
      ref: binding.ref,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    options.signal?.throwIfAborted()
    if (isUnsupportedProvider(error)) return unavailable('provider-has-no-interactive-contract')
    return unavailable('interactive-binding-stale')
  }
  if (handle === null) return unavailable('interactive-binding-stale')
  let status: Awaited<ReturnType<typeof handle.status>>
  try {
    status = await handle.status(
      options.signal === undefined ? undefined : { signal: options.signal },
    )
  } catch {
    options.signal?.throwIfAborted()
    return unavailable('interactive-binding-stale')
  }
  if (status.state !== 'running') return unavailable('interactive-binding-stale')
  return { status: 'available', handle }
}

function parseBinding(value: unknown): WorkerInteractiveBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('worker interactive binding is malformed')
  }
  const record = value as Record<string, unknown>
  if (
    record.schemaVersion !== WORKER_BINDING_SCHEMA_VERSION ||
    typeof record.workerId !== 'string' ||
    record.workerId.length === 0 ||
    typeof record.label !== 'string' ||
    record.label.length === 0 ||
    typeof record.journalRoot !== 'string' ||
    record.journalRoot.length === 0 ||
    typeof record.recordedAt !== 'string'
  ) {
    throw new Error('worker interactive binding is malformed')
  }
  if (record.status === 'available') {
    const ref = AgentInteractiveSessionRefSchema.parse(record.ref)
    const refDigest = canonicalCandidateDigest(ref)
    if (record.refDigest !== refDigest) {
      throw new Error('worker interactive binding ref digest does not match its exact ref')
    }
    return {
      schemaVersion: WORKER_BINDING_SCHEMA_VERSION,
      workerId: record.workerId,
      label: record.label,
      journalRoot: record.journalRoot,
      recordedAt: record.recordedAt,
      status: 'available',
      ref,
      refDigest,
    }
  }
  if (record.status !== 'unavailable' || !isUnavailableReason(record.reason)) {
    throw new Error('worker interactive binding is malformed')
  }
  return {
    schemaVersion: WORKER_BINDING_SCHEMA_VERSION,
    workerId: record.workerId,
    label: record.label,
    journalRoot: record.journalRoot,
    recordedAt: record.recordedAt,
    status: 'unavailable',
    reason: record.reason,
  }
}

function assertSameBinding(
  current: WorkerInteractiveBinding,
  candidate: WorkerInteractiveBinding,
): void {
  const currentMaterial = bindingMaterial(current)
  const candidateMaterial = bindingMaterial(candidate)
  if (canonicalCandidateDigest(currentMaterial) !== canonicalCandidateDigest(candidateMaterial)) {
    throw new Error(`worker '${candidate.workerId}' already has a different interactive binding`)
  }
}

function bindingMaterial(binding: WorkerInteractiveBinding): Record<string, unknown> {
  return binding.status === 'available'
    ? {
        schemaVersion: binding.schemaVersion,
        workerId: binding.workerId,
        label: binding.label,
        journalRoot: binding.journalRoot,
        status: binding.status,
        ref: binding.ref,
        refDigest: binding.refDigest,
      }
    : {
        schemaVersion: binding.schemaVersion,
        workerId: binding.workerId,
        label: binding.label,
        journalRoot: binding.journalRoot,
        status: binding.status,
        reason: binding.reason,
      }
}

function workerLifecycle(
  eventDir: string,
  workerId: string,
): { readonly spawned: boolean; readonly terminal: boolean } {
  let raw: string
  try {
    raw = readFileSync(join(eventDir, SPAWN_JOURNAL_FILE), 'utf8')
  } catch {
    return { spawned: false, terminal: false }
  }
  let spawned = false
  let terminal = false
  for (const line of raw.split('\n')) {
    const text = line.trim()
    if (!text) continue
    try {
      const record = JSON.parse(text) as { kind?: unknown; event?: Record<string, unknown> }
      if (record.kind !== 'event' || record.event?.id !== workerId) continue
      if (record.event.kind === 'spawned') spawned = true
      if (record.event.kind === 'settled' || record.event.kind === 'cancelled') terminal = true
    } catch {
      // A partial tail cannot erase earlier committed lifecycle evidence.
    }
  }
  return { spawned, terminal }
}

function resolveProvider(
  source: WorkerInteractiveProviderSource,
  name: string,
): AgentEnvironmentProvider | undefined {
  if ('register' in source) return source.get(name)
  return source.name === name ? source : undefined
}

function unavailable(reason: WorkerInteractiveUnavailableReason): WorkerInteractiveSession {
  return { status: 'unavailable', reason }
}

function stableText(value: string, label: string): string {
  const text = value.trim()
  if (!text) throw new Error(`${label} is empty`)
  return text
}

function isUnsupportedProvider(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes('cannot reconstruct an environment') ||
    message.includes('cannot control an exact interactive agent') ||
    message.includes('incomplete interactive agent controls')
  )
}

function isUnavailableReason(value: unknown): value is WorkerInteractiveUnavailableReason {
  return (
    value === 'unknown-node' ||
    value === 'not-live' ||
    value === 'executor-exposes-no-interactive-session' ||
    value === 'provider-has-no-interactive-contract' ||
    value === 'interactive-session-not-started' ||
    value === 'interactive-binding-not-found' ||
    value === 'interactive-binding-stale' ||
    value === 'interactive-provider-not-registered'
  )
}
