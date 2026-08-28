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
 *   steers/requests/<hash>.json    one exact, caller-idempotent {@link WorkerSteerRequest}
 *   steers/acks/<hash>.json        runtime acknowledgement for that steer operation
 *   workers/<id>.inbox.ndjson      best-effort readable projection of admitted steer requests
 *   workers/<label>.ndjson         best-effort per-worker control-event log (delivery bookkeeping)
 *   cancellations/requests.ndjson  worker-scoped cancel requests (durable inbox); each line is a
 *                                  {@link WorkerCancelRequest}
 *   cancellations/<opId>.json      the acknowledgement for one cancel operation — a
 *                                  {@link WorkerCancellation} written ONLY by the runtime
 *                                  acknowledger in the OWNING manager's turn loop: exact node
 *                                  ids route to the manager that parents them (any depth);
 *                                  label/profile-name references to the root manager alone
 *   cancellations/run.request.json the run-scoped cancel request — one {@link RunCancelRequest},
 *                                  the whole RUN rather than one worker
 *   cancellations/run.json         the acknowledgement for the run-scoped request — a
 *                                  {@link RunCancellation} written ONLY by the runtime (the root
 *                                  manager issues the abort; the `supervise()` settle path records
 *                                  what the run actually did)
 *
 * Reads are tolerant by contract: a partial trailing line (a writer mid-append) or a corrupt line
 * never poisons the rest of the file — later valid lines still matter.
 *
 * Promoted from `loops/src/supervisor-control.ts`. Steer admission now requires the exact worker id
 * and a caller-owned operation id. One atomic request file is the durable inbox; the NDJSON file is
 * a readable projection only and never controls idempotency.
 *
 * @experimental
 */

import { createHash, randomUUID } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { canonicalCandidateDigest, type Sha256Digest } from '@tangle-network/agent-interface'
import type { RetainedRunEffect } from '../retained-run-types'

/** One atomically admitted down-leg request for an exact worker id. @stable */
export interface WorkerSteerRequest {
  readonly schemaVersion: 1
  /** Caller-minted stable idempotency key for this operation. */
  readonly operationId: string
  /** Digest of operation id, worker id, message, source, and interrupt mode. */
  readonly requestDigest: Sha256Digest
  /** ISO timestamp of durable admission. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  /** Exact supervised worker node id. */
  readonly worker: string
  readonly message: string
  readonly interrupt: boolean
}

/** Runtime acknowledgement for one exact steer operation. @stable */
export interface WorkerSteerAcknowledgement {
  readonly schemaVersion: 1
  readonly operationId: string
  readonly requestDigest: Sha256Digest
  readonly worker: string
  readonly effect: 'unknown' | 'delivered' | 'not_live' | 'unsupported' | 'refused'
  readonly requestedAt: string
  readonly observedAt: string
  readonly detail: string
}

/** Caller input for one retry-safe steer operation. @stable */
export interface WriteWorkerSteerOptions {
  readonly operationId: string
  readonly message: string
  readonly source?: string
  readonly interrupt?: boolean
}

/** One durable worker-scoped cancel request appended to the run's cancellation inbox. */
export interface WorkerCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string
  /** ISO timestamp of the append. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  /** The worker the request targets: a workerId (node id — routed to the owning manager at any
   *  depth), or a profile name or spawn label (resolved by the root manager against its direct
   *  children only). */
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
 *                           a request no acknowledger has answered), or — terminally, with the
 *                           run-over detail — an abort was issued but the run ended before the
 *                           termination could be observed. Never a success.
 *  - `'cancel_requested'` — the runtime issued the worker's abort; termination not yet proven.
 *  - `'cancelled'`        — the worker reached a terminal `down` state on the settle path.
 *  - `'not_live'`         — the worker was not live to cancel (already settled, it settled
 *                           `done` despite the abort, or the run ended before the request was
 *                           ever applied). Never a success of THIS operation.
 *
 * Expiry is run end: the owning manager's final pass closes every still-open request it owns
 * (`not_live` never applied, `unknown` issued-but-unproven), so a pending request cannot outlive
 * its run and abort a future spawn that happens to reuse a label.
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
   * its subtree observed to reach a terminal `down`/`cancelled` journal record at or after the
   * abort was ISSUED — the acknowledger's own `observedAt` on the `cancel_requested` record
   * (runtime clock), never the client's `requestedAt` (a cancelled lead cascades to its subtree
   * by design — the scope signal chain — so the acknowledgement names the set, not one id).
   * Proven at acknowledgement time; post-abort causation is approximate: a descendant that died
   * of its own cause after the abort is indistinguishable from the cascade and may be included,
   * a late teardown journal joins the set on a later pass while the manager still runs, and one
   * still absent at run end is absent from the set. Grows monotonically; empty until termination
   * is proven.
   */
  readonly terminated: ReadonlyArray<string>
}

/** One durable run-scoped cancel request: cancel the WHOLE run, not one worker. */
export interface RunCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string
  /** ISO timestamp of the write. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  readonly reason?: string
}

/**
 * The durable acknowledgement state for the run-scoped cancel operation, keyed by `operationId`.
 * The runtime is the ONLY writer; {@link cancelRun} only reads it.
 *
 * `effect` is the same {@link RetainedRunEffect} vocabulary the worker-scoped and retained-run
 * paths use, so the runtime has one spelling of the four cancellation states:
 *  - `'unknown'`          — no runtime has answered yet. Never a success.
 *  - `'cancel_requested'` — the root manager issued the run's cascading abort; the run's terminal
 *                           state is not yet observed.
 *  - `'cancelled'`        — the run reached its terminal state ABORTED after that request.
 *  - `'not_live'`         — the run was not live to cancel: it settled on its own despite the
 *                           request, or it ended before the request was applied.
 */
export interface RunCancellation {
  readonly operationId: string
  readonly effect: RetainedRunEffect
  /** ISO timestamp of the original request. */
  readonly requestedAt: string
  /** ISO timestamp of the runtime's most recent observation of this operation. */
  readonly observedAt: string
  /** The caller's reason, carried verbatim from the request. */
  readonly reason?: string
  /** The runtime's explanation of how it arrived at `effect`. */
  readonly detail?: string
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

/** Directory containing atomically admitted steer requests and runtime acknowledgements. */
export function workerSteersDir(eventDir: string): string {
  return join(eventDir, 'steers')
}

/** Directory containing one canonical request file per steer operation. */
export function workerSteerRequestsDir(eventDir: string): string {
  return join(workerSteersDir(eventDir), 'requests')
}

/** Directory containing one runtime acknowledgement per steer operation. */
export function workerSteerAcknowledgementsDir(eventDir: string): string {
  return join(workerSteersDir(eventDir), 'acks')
}

/** Canonical request file for one caller-owned steer operation id. */
export function workerSteerRequestFile(eventDir: string, operationId: string): string {
  return join(workerSteerRequestsDir(eventDir), `${operationFileHash(operationId)}.json`)
}

/** Runtime acknowledgement file for one caller-owned steer operation id. */
export function workerSteerAcknowledgementFile(eventDir: string, operationId: string): string {
  return join(workerSteerAcknowledgementsDir(eventDir), `${operationFileHash(operationId)}.json`)
}

/**
 * Admit one steer exactly once under a caller-owned operation id.
 *
 * The per-operation request file is linked into place atomically after its bytes reach disk. A
 * same-body retry returns the winner's request. A changed-body retry fails loud. The NDJSON inbox
 * and control log are readable projections written only by the admission winner.
 * @stable
 */
export function writeWorkerSteer(
  rootDir: string,
  supervisorId: string,
  worker: string,
  options: WriteWorkerSteerOptions,
): {
  worker: string
  file: string
  request: WorkerSteerRequest
  acknowledgement?: WorkerSteerAcknowledgement
  replayed: boolean
} {
  const workerId = worker.trim()
  if (!workerId) throw new Error('writeWorkerSteer: worker id is empty')
  const operationId = options.operationId.trim()
  if (!operationId) throw new Error('writeWorkerSteer: operationId is empty')
  const trimmed = options.message.trim()
  if (!trimmed) throw new Error('steer message is empty')
  const source = options.source?.trim() || 'human'
  const interrupt = options.interrupt === true
  const dir = supervisorRunDir(rootDir, supervisorId)
  const requestDigest = workerSteerRequestDigest({
    operationId,
    worker: workerId,
    message: trimmed,
    source,
    interrupt,
  })
  const request: WorkerSteerRequest = {
    schemaVersion: 1,
    operationId,
    requestDigest,
    at: new Date().toISOString(),
    source,
    worker: workerId,
    message: trimmed,
    interrupt,
  }
  const file = workerSteerRequestFile(dir, operationId)
  assertNoSymlinkDescendant(dir, file, 'steer request')
  mkdirSync(workerSteerRequestsDir(dir), { recursive: true })
  assertNoSymlinkDescendant(dir, file, 'steer request')
  const admitted = admitSteerRequest(file, request)
  if (admitted.replayed) {
    return {
      worker: admitted.request.worker,
      file,
      request: admitted.request,
      ...(readWorkerSteerAcknowledgement(dir, operationId) === undefined
        ? {}
        : { acknowledgement: readWorkerSteerAcknowledgement(dir, operationId) }),
      replayed: true,
    }
  }
  mkdirSync(supervisorWorkersDir(dir), { recursive: true })
  const projection = workerInboxFile(rootDir, supervisorId, workerId)
  try {
    appendFileSync(projection, `${JSON.stringify(request)}\n`, 'utf8')
  } catch {
    // The atomic operation file is the queue. This projection does not control admission.
  }
  appendWorkerControlEvent(dir, workerId, {
    kind: 'message',
    direction: 'down',
    source,
    operationId,
    requestDigest,
    message: trimmed,
    interrupt,
    queued: true,
    delivered: false,
  })
  return { worker: workerId, file, request, replayed: false }
}

/** Read every atomically admitted request for one exact worker id, in admission order. @stable */
export function readWorkerSteerRequests(eventDir: string, worker?: string): WorkerSteerRequest[] {
  const workerId = worker?.trim()
  if (worker !== undefined && !workerId) return []
  let names: string[]
  assertNoSymlinkDescendant(eventDir, workerSteerRequestsDir(eventDir), 'steer request')
  try {
    names = readdirSync(workerSteerRequestsDir(eventDir))
  } catch {
    return []
  }
  const out: WorkerSteerRequest[] = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const file = join(workerSteerRequestsDir(eventDir), name)
      assertNoSymlinkDescendant(eventDir, file, 'steer request')
      const parsed = parseWorkerSteerRequest(JSON.parse(readFileSync(file, 'utf8')))
      if (name !== `${operationFileHash(parsed.operationId)}.json`) continue
      if (workerId === undefined || parsed.worker === workerId) out.push(parsed)
    } catch {
      // One corrupt request cannot hide other independently committed operations.
    }
  }
  return out.sort((left, right) =>
    left.at === right.at
      ? left.operationId.localeCompare(right.operationId)
      : left.at.localeCompare(right.at),
  )
}

/** Read one runtime steer acknowledgement, or `undefined` while no manager has answered. @stable */
export function readWorkerSteerAcknowledgement(
  eventDir: string,
  operationId: string,
): WorkerSteerAcknowledgement | undefined {
  const id = operationId.trim()
  if (!id) throw new Error('readWorkerSteerAcknowledgement: operationId is empty')
  const file = workerSteerAcknowledgementFile(eventDir, id)
  assertNoSymlinkDescendant(eventDir, file, 'steer acknowledgement')
  if (!existsSync(file)) return undefined
  const record = parseWorkerSteerAcknowledgement(JSON.parse(readFileSync(file, 'utf8')))
  if (record.operationId !== id) {
    throw new Error(`steer acknowledgement '${file}' belongs to another operation`)
  }
  return record
}

/**
 * Claim one steer for delivery with an atomic no-clobber acknowledgement.
 * Returns `true` only to the process that created the pre-delivery record.
 * @internal
 */
export function claimWorkerSteerDelivery(
  eventDir: string,
  record: WorkerSteerAcknowledgement,
): boolean {
  const exact = parseWorkerSteerAcknowledgement(record)
  if (exact.effect !== 'unknown') {
    throw new Error('steer delivery claim must use effect unknown')
  }
  const request = readWorkerSteerRequest(eventDir, exact.operationId)
  if (request === undefined || request.requestDigest !== exact.requestDigest) {
    throw new Error('steer delivery claim does not match an admitted request')
  }
  const dir = workerSteerAcknowledgementsDir(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'steer acknowledgement')
  mkdirSync(dir, { recursive: true })
  assertNoSymlinkDescendant(eventDir, dir, 'steer acknowledgement')
  const file = workerSteerAcknowledgementFile(eventDir, exact.operationId)
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(exact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  syncFile(tmp)
  try {
    linkSync(tmp, file)
    syncDirectory(dir)
    return true
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const winner = readWorkerSteerAcknowledgement(eventDir, exact.operationId)
    if (
      winner === undefined ||
      winner.operationId !== exact.operationId ||
      winner.requestDigest !== exact.requestDigest
    ) {
      throw new Error('steer delivery claim conflicts with another operation')
    }
    return false
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // The no-clobber acknowledgement link is independent of the temporary name.
    }
  }
}

/** Atomically replace the runtime acknowledgement for one steer operation. @internal */
export function writeWorkerSteerAcknowledgement(
  eventDir: string,
  record: WorkerSteerAcknowledgement,
): void {
  const exact = parseWorkerSteerAcknowledgement(record)
  const request = readWorkerSteerRequest(eventDir, exact.operationId)
  if (request === undefined || request.requestDigest !== exact.requestDigest) {
    throw new Error('steer acknowledgement does not match an admitted request')
  }
  const dir = workerSteerAcknowledgementsDir(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'steer acknowledgement')
  mkdirSync(dir, { recursive: true })
  assertNoSymlinkDescendant(eventDir, dir, 'steer acknowledgement')
  const file = workerSteerAcknowledgementFile(eventDir, exact.operationId)
  const prior = readWorkerSteerAcknowledgement(eventDir, exact.operationId)
  if (
    prior !== undefined &&
    prior.effect !== 'unknown' &&
    canonicalCandidateDigest(prior) !== canonicalCandidateDigest(exact)
  ) {
    throw new Error(`steer operation '${exact.operationId}' already has a terminal acknowledgement`)
  }
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(exact, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
  syncFile(file)
  syncDirectory(dir)
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
 * analog): append the request to the run's cancellation inbox, where the OWNING manager's
 * acknowledger (its turn loop — the root for label/profile references, the parent manager for an
 * exact node id at any depth) applies it — aborting exactly that worker's subtree and recording
 * what it proved. This function never applies the cancellation itself; writing a
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

/** The run-scoped cancel request file of one run — one {@link RunCancelRequest}. */
export function runCancelRequestFile(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'run.request.json')
}

/** The run-scoped acknowledgement file of one run — one {@link RunCancellation}. */
export function runCancellationFile(eventDir: string): string {
  return join(workerCancellationsDir(eventDir), 'run.json')
}

/** Read the run-scoped cancel request, or `undefined` when none was written. */
export function readRunCancelRequest(eventDir: string): RunCancelRequest | undefined {
  const file = runCancelRequestFile(eventDir)
  if (!existsSync(file)) return undefined
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<RunCancelRequest>
  if (!isRunCancelRequest(parsed)) {
    throw new Error(`run cancel request '${file}' is not a complete RunCancelRequest`)
  }
  return parsed
}

/**
 * Read the acknowledgement for the run-scoped cancel operation. `undefined` when the runtime has
 * not answered. A record holding a DIFFERENT `operationId` belongs to another operation on the
 * same run — fail loud rather than answer for it.
 */
export function readRunCancellation(
  eventDir: string,
  operationId: string,
): RunCancellation | undefined {
  const file = runCancellationFile(eventDir)
  if (!existsSync(file)) return undefined
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as RunCancellation
  if (parsed.operationId !== operationId) {
    throw new Error(
      `run cancel acknowledgement '${file}' holds operation '${parsed.operationId}', not ` +
        `'${operationId}' — one run carries one run-scoped cancel operation`,
    )
  }
  return parsed
}

/**
 * Durably write the run-scoped acknowledgement. Write-then-rename, so a concurrent reader sees the
 * prior complete record or the new complete record, never a partial file.
 *
 * @internal The runtime is the only intended writer; clients read via {@link readRunCancellation}
 * or {@link cancelRun}.
 */
export function writeRunCancellation(eventDir: string, record: RunCancellation): void {
  const dir = workerCancellationsDir(eventDir)
  mkdirSync(dir, { recursive: true })
  const file = runCancellationFile(eventDir)
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
  renameSync(tmp, file)
}

/**
 * Request the cancellation of the WHOLE run, idempotently, and return the operation's current
 * durable state.
 *
 * The run-scoped twin of {@link cancelWorker}: write the request into the run's cancellation
 * directory, where the run's own root manager applies it — aborting the root through the one
 * cascade controller the run already has, so every live worker comes down with it. This function
 * never applies the cancellation itself; writing a request file is not an acknowledgement.
 *
 * Idempotency is a lookup: when an acknowledgement for `operationId` already exists it is returned
 * AS-IS and nothing is written. A request the runtime has not answered yet returns
 * `effect: 'unknown'` (never a success); call again with the same `operationId` — or
 * {@link readRunCancellation} — to read the acknowledged result after a reconnect.
 *
 * A run carries ONE run-scoped operation: a second request under a different `operationId` throws
 * rather than silently replacing the pending one, because both would claim the same single abort.
 */
export function cancelRun(
  eventDir: string,
  operationId: string,
  options: { readonly reason?: string; readonly source?: string } = {},
): RunCancellation {
  const opId = operationId.trim()
  if (!opId) throw new Error('cancelRun: operationId is empty')
  const acknowledged = readRunCancellation(eventDir, opId)
  if (acknowledged) return acknowledged
  const pending = readRunCancelRequest(eventDir)
  if (pending !== undefined && pending.operationId !== opId) {
    throw new Error(
      `cancelRun: run cancel '${pending.operationId}' is already pending for this run; ` +
        `read it with readRunCancellation instead of issuing '${opId}'`,
    )
  }
  const source = options.source ?? 'human'
  const request: RunCancelRequest = pending ?? {
    operationId: opId,
    at: new Date().toISOString(),
    source,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
  }
  if (pending === undefined) {
    mkdirSync(workerCancellationsDir(eventDir), { recursive: true })
    writeFileSync(runCancelRequestFile(eventDir), `${JSON.stringify(request, null, 2)}\n`, 'utf8')
    appendWorkerControlEvent(eventDir, 'run', {
      kind: 'run-cancel-request',
      operationId: opId,
      source,
      queued: true,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
    })
  }
  return {
    operationId: opId,
    effect: 'unknown',
    requestedAt: request.at,
    observedAt: request.at,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    detail: 'request queued; no runtime acknowledger has answered yet',
  }
}

function isRunCancelRequest(value: Partial<RunCancelRequest>): value is RunCancelRequest {
  return (
    typeof value.operationId === 'string' &&
    value.operationId.length > 0 &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    (value.reason === undefined || typeof value.reason === 'string')
  )
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

function workerSteerRequestDigest(value: {
  readonly operationId: string
  readonly worker: string
  readonly message: string
  readonly source: string
  readonly interrupt: boolean
}): Sha256Digest {
  return canonicalCandidateDigest({ kind: 'worker-steer-request.v1', ...value })
}

function operationFileHash(operationId: string): string {
  const id = operationId.trim()
  if (!id) throw new Error('steer operationId is empty')
  return createHash('sha256').update(id).digest('hex')
}

function admitSteerRequest(
  file: string,
  request: WorkerSteerRequest,
): { readonly request: WorkerSteerRequest; readonly replayed: boolean } {
  const existing = readWorkerSteerRequestFile(file)
  if (existing !== undefined) {
    assertSameSteerRequest(existing, request)
    return { request: existing, replayed: true }
  }
  const tmp = `${file}.${randomUUID()}.tmp`
  writeFileSync(tmp, `${JSON.stringify(request, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  syncFile(tmp)
  try {
    linkSync(tmp, file)
    syncDirectory(dirname(file))
    return { request, replayed: false }
  } catch (error) {
    if (!isAlreadyExists(error)) throw error
    const winner = readWorkerSteerRequestFile(file)
    if (winner === undefined) throw error
    assertSameSteerRequest(winner, request)
    return { request: winner, replayed: true }
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      // The admitted hard link is independent of the temporary name.
    }
  }
}

function readWorkerSteerRequest(
  eventDir: string,
  operationId: string,
): WorkerSteerRequest | undefined {
  const file = workerSteerRequestFile(eventDir, operationId)
  assertNoSymlinkDescendant(eventDir, file, 'steer request')
  const request = readWorkerSteerRequestFile(file)
  if (request !== undefined && request.operationId !== operationId) {
    throw new Error('steer request file belongs to another operation')
  }
  return request
}

function readWorkerSteerRequestFile(file: string): WorkerSteerRequest | undefined {
  if (!existsSync(file)) return undefined
  return parseWorkerSteerRequest(JSON.parse(readFileSync(file, 'utf8')))
}

function parseWorkerSteerRequest(value: unknown): WorkerSteerRequest {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('steer request is malformed')
  }
  const request = value as Partial<WorkerSteerRequest>
  if (
    request.schemaVersion !== 1 ||
    typeof request.operationId !== 'string' ||
    request.operationId.length === 0 ||
    typeof request.requestDigest !== 'string' ||
    typeof request.at !== 'string' ||
    typeof request.source !== 'string' ||
    request.source.length === 0 ||
    typeof request.worker !== 'string' ||
    request.worker.length === 0 ||
    typeof request.message !== 'string' ||
    request.message.trim().length === 0 ||
    typeof request.interrupt !== 'boolean'
  ) {
    throw new Error('steer request is malformed')
  }
  const exact = request as WorkerSteerRequest
  const expected = workerSteerRequestDigest({
    operationId: exact.operationId,
    worker: exact.worker,
    message: exact.message,
    source: exact.source,
    interrupt: exact.interrupt,
  })
  if (exact.requestDigest !== expected) throw new Error('steer request digest does not match')
  return exact
}

function parseWorkerSteerAcknowledgement(value: unknown): WorkerSteerAcknowledgement {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('steer acknowledgement is malformed')
  }
  const record = value as Partial<WorkerSteerAcknowledgement>
  if (
    record.schemaVersion !== 1 ||
    typeof record.operationId !== 'string' ||
    record.operationId.length === 0 ||
    typeof record.requestDigest !== 'string' ||
    typeof record.worker !== 'string' ||
    record.worker.length === 0 ||
    (record.effect !== 'unknown' &&
      record.effect !== 'delivered' &&
      record.effect !== 'not_live' &&
      record.effect !== 'unsupported' &&
      record.effect !== 'refused') ||
    typeof record.requestedAt !== 'string' ||
    typeof record.observedAt !== 'string' ||
    typeof record.detail !== 'string'
  ) {
    throw new Error('steer acknowledgement is malformed')
  }
  return record as WorkerSteerAcknowledgement
}

function assertSameSteerRequest(existing: WorkerSteerRequest, candidate: WorkerSteerRequest): void {
  if (existing.operationId !== candidate.operationId) {
    throw new Error('steer operation file collision')
  }
  if (existing.requestDigest !== candidate.requestDigest) {
    throw new Error(
      `writeWorkerSteer: operation '${candidate.operationId}' conflicts with its admitted request`,
    )
  }
}

function syncFile(file: string): void {
  const fd = openSync(file, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function syncDirectory(dir: string): void {
  const fd = openSync(dir, 'r')
  try {
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}

function assertNoSymlinkDescendant(root: string, target: string, label: string): void {
  const base = resolve(root)
  const exact = resolve(target)
  const rel = relative(base, exact)
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)) {
    throw new Error(`${label} path escapes its run directory`)
  }
  if (existsSync(base) && lstatSync(base).isSymbolicLink()) {
    throw new Error(`${label} path contains a symbolic link: ${base}`)
  }
  let current = base
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    current = join(current, part)
    if (!existsSync(current)) continue
    if (lstatSync(current).isSymbolicLink()) {
      throw new Error(`${label} path contains a symbolic link: ${current}`)
    }
  }
}
