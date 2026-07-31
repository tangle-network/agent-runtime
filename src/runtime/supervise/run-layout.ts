/**
 * The on-disk supervisor-run layout: `<root>/.loops/supervisor/<id>`.
 *
 * This is the durable, cross-process face of a supervisor run — the counterpart to the in-process
 * `Inbox` seam in `./inbox`. A run persists its state under one directory so that any OTHER process
 * can find it after the fact: `@tangle-network/traces` reads exactly this layout
 * (`traces analyze --supervisor-run-dir` expects `<runDir>/ws/.loops/supervisor/<id>`), a restarted
 * host can rehydrate a run it no longer holds handles to, and a human can steer a live worker by
 * appending one NDJSON line. Until now the layout was defined only in the unpublished `loops` repo
 * (`src/supervisor-control.ts`) — a published reader depending on an unpublished writer's
 * convention — so the contract is promoted here, names preserved.
 *
 * Layout, relative to `supervisorRunDir(root, id)`:
 *
 *   workers/<label>.inbox.ndjson   down-leg steer/answer requests for one worker (durable inbox);
 *                                  each line is a {@link WorkerSteerRequest}
 *   workers/<label>.ndjson         best-effort per-worker control-event log (delivery bookkeeping)
 *
 * Reads are tolerant by contract: a partial trailing line (a writer mid-append) or a corrupt line
 * never poisons the rest of the file — later valid lines still matter.
 *
 * Promoted from `loops/src/supervisor-control.ts`. The one deliberate difference: the loops version
 * resolved a worker id to its label through the run journal before writing a steer; that resolution
 * stays with the caller (it is journal-format-specific), so `writeWorkerSteer` here takes the worker
 * LABEL directly.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/** One durable down-leg request appended to a worker's inbox file. */
export interface WorkerSteerRequest {
  readonly id: string
  /** ISO timestamp of the append. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  /** The worker LABEL the request targets (already resolved by the caller). */
  readonly worker: string
  readonly message: string
}

/** The run directory every artifact of one supervisor run lives under. */
export function supervisorRunDir(rootDir: string, id: string): string {
  return join(resolve(rootDir), '.loops', 'supervisor', id)
}

/** A worker label reduced to a safe filename stem. Empty labels get a stable fallback. */
export function safeWorkerFile(label: string): string {
  const safe = label.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe.length > 0 ? safe : 'worker'
}

/** The durable inbox file for one worker of one run. */
export function workerInboxFile(rootDir: string, supervisorId: string, worker: string): string {
  return workerInboxFileFromEventDir(supervisorRunDir(rootDir, supervisorId), worker)
}

/** Same, addressed from an already-known run directory (the reader's usual entry point). */
export function workerInboxFileFromEventDir(eventDir: string, worker: string): string {
  return join(eventDir, 'workers', `${safeWorkerFile(worker)}.inbox.ndjson`)
}

/**
 * Durably append one steer request to a worker's inbox and log the delivery attempt.
 *
 * The inbox append is the durable act; the control-event log is best-effort bookkeeping and may
 * silently fail without voiding the steer.
 */
export function writeWorkerSteer(
  rootDir: string,
  supervisorId: string,
  worker: string,
  message: string,
  source = 'human',
): { worker: string; file: string; request: WorkerSteerRequest } {
  const trimmed = message.trim()
  if (!trimmed) throw new Error('steer message is empty')
  const dir = supervisorRunDir(rootDir, supervisorId)
  mkdirSync(join(dir, 'workers'), { recursive: true })
  const request: WorkerSteerRequest = {
    id: randomUUID(),
    at: new Date().toISOString(),
    source,
    worker,
    message: trimmed,
  }
  const file = workerInboxFile(rootDir, supervisorId, worker)
  appendFileSync(file, `${JSON.stringify(request)}\n`, 'utf8')
  appendWorkerControlEvent(dir, worker, {
    kind: 'message',
    direction: 'down',
    source,
    requestId: request.id,
    message: trimmed,
    queued: true,
    delivered: false,
  })
  return { worker, file, request }
}

/** Read every valid steer request in a worker's inbox. Corrupt or partial lines are skipped. */
export function readWorkerSteerRequests(eventDir: string, worker: string): WorkerSteerRequest[] {
  const file = workerInboxFileFromEventDir(eventDir, worker)
  if (!existsSync(file)) return []
  const out: WorkerSteerRequest[] = []
  let raw = ''
  try {
    raw = readFileSync(file, 'utf8')
  } catch {
    return out
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Partial<WorkerSteerRequest>
      if (isWorkerSteerRequest(parsed)) out.push(parsed)
    } catch {
      // Ignore partial or corrupt input lines; later valid lines still matter.
    }
  }
  return out
}

function appendWorkerControlEvent(
  eventDir: string,
  label: string,
  event: Record<string, unknown>,
): void {
  try {
    const workersDir = join(eventDir, 'workers')
    mkdirSync(workersDir, { recursive: true })
    appendFileSync(
      join(workersDir, `${safeWorkerFile(label)}.ndjson`),
      `${JSON.stringify({ at: new Date().toISOString(), label, ...event })}\n`,
      'utf8',
    )
  } catch {
    // Control logging is best-effort; the inbox write above is the durable part.
  }
}

function isWorkerSteerRequest(value: Partial<WorkerSteerRequest>): value is WorkerSteerRequest {
  return (
    typeof value.id === 'string' &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    typeof value.worker === 'string' &&
    typeof value.message === 'string' &&
    value.message.trim().length > 0
  )
}
