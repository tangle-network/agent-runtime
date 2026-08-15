/**
 * The on-disk supervisor-run layout: `<root>/.agent/supervisor/<id>`.
 *
 * This is the durable, cross-process face of a supervisor run — the counterpart to the in-process
 * `Inbox` seam in `./inbox`. A run persists its state under one directory so that any OTHER process
 * can find it after the fact: `@tangle-network/traces` reads exactly this layout via
 * `traces analyze --supervisor-run-dir`, a restarted host can rehydrate a run it no longer holds
 * handles to, and a human can steer a live worker by appending one NDJSON line. Until now the
 * layout was defined only in the unpublished `loops` repo (`src/supervisor-control.ts`) — a
 * published reader depending on an unpublished writer's convention — so the contract is promoted
 * here, names preserved.
 *
 * `.agent` is the one dot-dir for ALL agent-owned state (skills already write
 * `.agent/hypotheses/`, `.agent/skill-runs.jsonl`); supervisor runs live beside them rather than
 * under a product-branded dir. Runs written by older writers used `.loops/supervisor/<id>` —
 * readers that must see those keep a legacy fallback; this writer never creates `.loops` again.
 *
 * Layout, relative to `supervisorRunDir(root, id)`:
 *
 *   workers/<label>.inbox.ndjson   down-leg steer/answer requests for one worker (durable inbox);
 *                                  each line is a {@link WorkerSteerRequest}
 *   workers/<label>.ndjson         best-effort per-worker control-event log (delivery bookkeeping)
 *   cancellations/requests.ndjson  worker-scoped cancel requests (durable inbox); each line is a
 *                                  {@link WorkerCancelRequest}
 *   cancellations/<opId>.json      the acknowledgement for one cancel operation — a
 *                                  {@link WorkerCancellation} written ONLY by the runtime
 *                                  acknowledger (the coordination driver's turn loop)
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
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { RetainedRunEffect } from '../retained-run-types'

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

/** One durable worker-scoped cancel request appended to the run's cancellation inbox. */
export interface WorkerCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string
  /** ISO timestamp of the append. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  /** The worker the request targets: a workerId (node id), a profile name, or a spawn label. */
  readonly worker: string
  readonly reason?: string
}

/**
 * The durable acknowledgement state for one worker-scoped cancel operation, keyed by
 * `operationId`. The runtime acknowledger is the ONLY writer; `cancelWorker` only reads it.
 *
 * `effect` reuses the retained-run vocabulary ({@link RetainedRunEffect}) so the runtime has one
 * spelling of the four cancellation states:
 *  - `'unknown'`          — not yet resolved by the runtime (also what `cancelWorker` returns for
 *                           a request no acknowledger has answered). Never a success.
 *  - `'cancel_requested'` — the runtime issued the worker's abort; termination not yet proven.
 *  - `'cancelled'`        — the worker reached a terminal `down` state on the settle path.
 *  - `'not_live'`         — the worker was not live to cancel (already settled, or it settled
 *                           `done` despite the abort). Never a success of THIS operation.
 */
export interface WorkerCancellation {
  readonly operationId: string
  /** The worker reference exactly as requested. */
  readonly worker: string
  readonly effect: RetainedRunEffect
  /** ISO timestamp of the original request. */
  readonly requestedAt: string
  /** ISO timestamp of the runtime's most recent observation of this operation. */
  readonly observedAt: string
  /** The node id the acknowledger resolved `worker` to, once resolved. */
  readonly workerId?: string
  /** The caller's reason, carried verbatim from the request. */
  readonly reason?: string
  /** The runtime's explanation of how it arrived at `effect`. */
  readonly detail?: string
  /**
   * Every node id this operation PROVED terminated: the requested worker plus each descendant of
   * its subtree observed to reach a terminal `down`/`cancelled` journal record at or after
   * `requestedAt` (a cancelled lead cascades to its subtree by design — the scope signal chain —
   * so the acknowledgement names the set, not one id). Empty until termination is proven.
   */
  readonly terminated: ReadonlyArray<string>
}

/** The root every supervisor run of one workspace lives under. */
export function supervisorRunsRoot(rootDir: string): string {
  return join(resolve(rootDir), '.agent', 'supervisor')
}

/** The run directory every artifact of one supervisor run lives under. */
export function supervisorRunDir(rootDir: string, id: string): string {
  return join(supervisorRunsRoot(rootDir), id)
}

/**
 * Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must
 * see historical runs check {@link supervisorRunDir} first and fall back to this; nothing writes
 * here anymore.
 */
export function legacySupervisorRunDir(rootDir: string, id: string): string {
  return join(legacySupervisorRunsRoot(rootDir), id)
}

/**
 * The pre-rename runs root (`<root>/.loops/supervisor`). Only readers that ENUMERATE historical
 * runs need this — the per-id form is {@link legacySupervisorRunDir}. Nothing writes here.
 */
export function legacySupervisorRunsRoot(rootDir: string): string {
  return join(resolve(rootDir), '.loops', 'supervisor')
}

/** A worker label reduced to a safe filename stem. Empty labels get a stable fallback. */
export function safeWorkerFile(label: string): string {
  const safe = label.replace(/[^A-Za-z0-9._-]/g, '_')
  return safe.length > 0 ? safe : 'worker'
}

/** The directory holding every per-worker file of one run (inboxes and control-event logs). */
export function supervisorWorkersDir(eventDir: string): string {
  return join(eventDir, 'workers')
}

/** The durable inbox file for one worker of one run. */
export function workerInboxFile(rootDir: string, supervisorId: string, worker: string): string {
  return workerInboxFileFromEventDir(supervisorRunDir(rootDir, supervisorId), worker)
}

/** Same, addressed from an already-known run directory (the reader's usual entry point). */
export function workerInboxFileFromEventDir(eventDir: string, worker: string): string {
  return join(supervisorWorkersDir(eventDir), `${safeWorkerFile(worker)}.inbox.ndjson`)
}

/**
 * The best-effort control-event log for one worker (`workers/<label>.ndjson`) — delivery
 * bookkeeping for steers, plus whatever lifecycle events a writer chooses to append. Distinct from
 * the inbox: the inbox is the durable down-leg queue, this is the record of what happened to it.
 */
export function workerControlLogFile(eventDir: string, worker: string): string {
  return join(supervisorWorkersDir(eventDir), `${safeWorkerFile(worker)}.ndjson`)
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
  mkdirSync(supervisorWorkersDir(dir), { recursive: true })
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

/** The directory holding every cancellation artifact of one run (request inbox + acknowledgements). */
export function workerCancellationsDir(eventDir: string): string {
  return join(eventDir, 'cancellations')
}

/** The durable cancel-request inbox of one run — one NDJSON line per {@link WorkerCancelRequest}. */
export function workerCancelRequestsFile(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'requests.ndjson')
}

/**
 * The acknowledgement file for one cancel operation. The filename is a sanitized stem of the
 * `operationId`; the record inside carries the exact id, and readers verify it so two distinct
 * ids that sanitize to one stem fail loud instead of answering for each other.
 */
export function workerCancellationFile(eventDir: string, operationId: string): string {
  return join(workerCancellationsDir(eventDir), `${safeOperationFile(operationId)}.json`)
}

function safeOperationFile(operationId: string): string {
  const safe = operationId.replace(/[^A-Za-z0-9._-]/g, '_')
  if (safe.length === 0) throw new Error('cancel operationId is empty')
  return safe
}

/** Read every valid cancel request in the run's cancellation inbox. Corrupt lines are skipped. */
export function readWorkerCancelRequests(eventDir: string): WorkerCancelRequest[] {
  const file = workerCancelRequestsFile(eventDir)
  if (!existsSync(file)) return []
  const out: WorkerCancelRequest[] = []
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
      const parsed = JSON.parse(trimmed) as Partial<WorkerCancelRequest>
      if (isWorkerCancelRequest(parsed)) out.push(parsed)
    } catch {
      // Ignore partial or corrupt input lines; later valid lines still matter.
    }
  }
  return out
}

/**
 * Read the acknowledgement for one cancel operation. `undefined` when the runtime has not
 * answered. A record whose stored `operationId` differs from the requested one is a filename
 * collision between two sanitized ids — fail loud rather than return another operation's answer.
 */
export function readWorkerCancellation(
  eventDir: string,
  operationId: string,
): WorkerCancellation | undefined {
  const file = workerCancellationFile(eventDir, operationId)
  if (!existsSync(file)) return undefined
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as WorkerCancellation
  if (parsed.operationId !== operationId) {
    throw new Error(
      `cancel acknowledgement collision: '${file}' holds operation '${parsed.operationId}', ` +
        `not '${operationId}' — use operation ids that stay distinct after filename sanitization`,
    )
  }
  return parsed
}

/**
 * Durably write one acknowledgement record. Write-then-rename, so a concurrent reader sees the
 * prior complete record or the new complete record, never a partial file.
 *
 * @internal The runtime acknowledger is the only intended writer; clients read via
 * {@link readWorkerCancellation} or {@link cancelWorker}.
 */
export function writeWorkerCancellation(eventDir: string, record: WorkerCancellation): void {
  const dir = workerCancellationsDir(eventDir)
  mkdirSync(dir, { recursive: true })
  const file = workerCancellationFile(eventDir, record.operationId)
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * Request the cancellation of ONE worker, idempotently, and return the operation's current
 * durable state.
 *
 * The write half of the acknowledged-cancellation contract (`writeWorkerSteer` is the steer
 * analog): append the request to the run's cancellation inbox, where the runtime's acknowledger
 * (the coordination driver's turn loop) applies it — aborting exactly that worker's subtree and
 * recording what it proved. This function never applies the cancellation itself; writing a
 * request file is not an acknowledgement.
 *
 * Idempotency is a lookup: when an acknowledgement for `operationId` already exists, it is
 * returned AS-IS and nothing is appended — repeating one operation can never apply twice. A
 * request the runtime has not answered yet returns `effect: 'unknown'` (never a success); call
 * again with the same `operationId` — or `readWorkerCancellation` — to read the acknowledged
 * result after a reconnect.
 */
export function cancelWorker(
  eventDir: string,
  worker: string,
  operationId: string,
  options: { readonly reason?: string; readonly source?: string } = {},
): WorkerCancellation {
  const ref = worker.trim()
  if (!ref) throw new Error('cancelWorker: worker reference is empty')
  const opId = operationId.trim()
  if (!opId) throw new Error('cancelWorker: operationId is empty')
  const acknowledged = readWorkerCancellation(eventDir, opId)
  if (acknowledged) return acknowledged
  const source = options.source ?? 'human'
  const pending = readWorkerCancelRequests(eventDir).find((r) => r.operationId === opId)
  const request: WorkerCancelRequest = pending ?? {
    operationId: opId,
    at: new Date().toISOString(),
    source,
    worker: ref,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  }
  if (!pending) {
    mkdirSync(workerCancellationsDir(eventDir), { recursive: true })
    appendFileSync(workerCancelRequestsFile(eventDir), `${JSON.stringify(request)}\n`, 'utf8')
    appendWorkerControlEvent(eventDir, ref, {
      kind: 'cancel-request',
      operationId: opId,
      source,
      queued: true,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    })
  }
  return {
    operationId: opId,
    worker: request.worker,
    effect: 'unknown',
    requestedAt: request.at,
    observedAt: request.at,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    detail: 'request queued; no runtime acknowledger has answered yet',
    terminated: [],
  }
}

function isWorkerCancelRequest(value: Partial<WorkerCancelRequest>): value is WorkerCancelRequest {
  return (
    typeof value.operationId === 'string' &&
    value.operationId.length > 0 &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    typeof value.worker === 'string' &&
    value.worker.length > 0 &&
    (value.reason === undefined || typeof value.reason === 'string')
  )
}

function appendWorkerControlEvent(
  eventDir: string,
  label: string,
  event: Record<string, unknown>,
): void {
  try {
    mkdirSync(supervisorWorkersDir(eventDir), { recursive: true })
    appendFileSync(
      workerControlLogFile(eventDir, label),
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
