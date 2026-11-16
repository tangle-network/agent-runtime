import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import { runFencedAlways } from '../../durable/durable-writer'
import type { RetainedRunEffect } from '../retained-run-types'
import {
  assertNoSymlinkDescendant,
  publishExclusiveFenced,
  writeAtomicDurableFile,
  writeAtomicDurableFileAsync,
} from './durable-file'
import {
  appendWorkerControlEvent,
  appendWorkerControlEventAsync,
  workerCancellationsDir,
} from './run-layout'

type CancellationPath = 'observer' | 'turn-boundary' | 'fallback'

/** Apply a durable request through the run's existing abort controller. */
export function applyRunCancellation(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  now: () => string,
  path: CancellationPath = 'turn-boundary',
): RunCancellation | undefined {
  const applied = abortForRequest(dir, abortRun, now, path)
  if (applied?.fresh) writeRunCancellation(dir, applied.record)
  return applied?.record
}

/**
 * `applyRunCancellation` without blocking the calling thread on the disk: the abort is issued at
 * once, and the `cancel_requested` record reaches disk on the durable writer under the run's claim.
 */
export async function applyRunCancellationAsync(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  now: () => string,
  path: CancellationPath = 'turn-boundary',
): Promise<RunCancellation | undefined> {
  const applied = abortForRequest(dir, abortRun, now, path)
  if (applied?.fresh) await writeRunCancellationAsync(dir, applied.record)
  return applied?.record
}

/** Abort for the pending request, and the record it owes: the standing one, or a fresh one to write. */
function abortForRequest(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  now: () => string,
  path: CancellationPath,
): { readonly record: RunCancellation; readonly fresh: boolean } | undefined {
  const request = readRunCancelRequest(dir)
  if (request === undefined) return undefined
  const prior = readRunCancellation(dir, request.operationId)
  // A request acknowledged only as `cancel_requested` is still owed by this run: the process
  // that issued the abort died before the run settled. Abort again; the record stands.
  if (prior?.effect === 'cancel_requested') {
    abortRun(request.reason ?? 'run cancel requested', request)
  }
  if (prior !== undefined) return { record: prior, fresh: false }
  abortRun(request.reason ?? 'run cancel requested', request)
  const observedAt = now()
  const appliedAfterMs = Math.max(0, Date.parse(observedAt) - Date.parse(request.at))
  const record: RunCancellation = {
    operationId: request.operationId,
    effect: 'cancel_requested',
    path,
    appliedAfterMs,
    ...(request.deadlineMs === undefined
      ? {}
      : { deadlineExceeded: appliedAfterMs > request.deadlineMs }),
    requestedAt: request.at,
    observedAt,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.operator === undefined ? {} : { operator: request.operator }),
    detail: 'root abort issued to the whole run; termination not yet proven',
  }
  return { record, fresh: true }
}

/** External drivers may remain silent indefinitely, so turn boundaries cannot observe control. */
export function watchRunCancellation(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  createWatch: typeof watch = watch,
) {
  mkdirSync(workerCancellationsDir(dir), { recursive: true })
  let active = true
  let failure: unknown
  // One observer aborts its run once: a request this process already applied, or one a dead
  // process acknowledged, is not re-issued on every poll.
  let aborted = false
  const abortOnce = (reason: string, request?: RunCancelRequest): void => {
    if (aborted) return
    aborted = true
    abortRun(reason, request)
  }
  // One application at a time. The abort is immediate; its record goes to the durable writer, so a
  // saturated disk delays the record, never this event loop. A poll that finds one in flight skips.
  let inFlight: Promise<void> | undefined
  const apply = (path: 'observer' | 'fallback'): Promise<void> => {
    if (failure !== undefined) return Promise.reject(failure)
    if (!active) return Promise.resolve()
    const applying = applyRunCancellationAsync(
      dir,
      abortOnce,
      () => new Date().toISOString(),
      path,
    ).then(() => undefined)
    const settled = applying.then(
      () => {
        if (inFlight === settled) inFlight = undefined
      },
      (error: unknown) => {
        // Kept even after close, so the settle path's check() throws it instead of reading no record.
        failure ??= error
        if (inFlight === settled) inFlight = undefined
      },
    )
    inFlight = settled
    return applying
  }
  // A caller's check waits for the application in flight, so a closed observer's last record lands
  // before the run's settle record is written, and a failure it met is thrown here.
  const check = async (path: 'observer' | 'fallback' = 'observer'): Promise<void> => {
    while (inFlight !== undefined) await inFlight
    await apply(path)
  }
  const fail = (error: unknown): void => {
    if (!active) return
    failure = error
    abortRun(`durable run cancellation observer failed: ${String(error)}`)
  }
  const poll = (path: 'observer' | 'fallback'): void => {
    if (inFlight !== undefined) return
    apply(path).catch(fail)
  }
  // The watcher is an optimization over the poll loop below (instant pickup instead of ≤100 ms).
  // Creating it can fail for reasons that say NOTHING about this run: the host's inotify budget is
  // exhausted (EMFILE — a shared box with many agents held ~110 of the 128 default user instances
  // when this was measured), or the kernel caps watches (ENOSPC). Degrading to poll-only keeps
  // every durable behavior; failing the run would make a neighboring process's resource use kill
  // runs that never touched the limit. Any other creation error still fails loudly.
  let watcher: ReturnType<typeof watch> | undefined
  try {
    watcher = createWatch(workerCancellationsDir(dir), (_event, filename) => {
      if (!active || (filename !== null && filename !== 'run.request.json')) return
      poll('observer')
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EMFILE' && code !== 'ENOSPC') throw error
  }
  watcher?.on('error', fail)
  // Filesystem notifications are advisory. Scan the same durable inbox when one is dropped —
  // and carry the whole observer alone whenever the watcher above could not be created.
  const fallback = setInterval(() => poll('fallback'), 100)
  fallback.unref()
  return {
    check,
    close(): void {
      active = false
      watcher?.close()
      clearInterval(fallback)
    },
  }
}

/** One durable run-scoped cancel request: cancel the WHOLE run, not one worker. */
export interface RunCancelRequest {
  /** Caller-minted stable operation identifier — the idempotency key of the whole operation. */
  readonly operationId: string
  /** ISO timestamp of the write. */
  readonly at: string
  /** Who asked — 'human', a brain label, a tool name. Provenance, not authorization. */
  readonly source: string
  /** Requested observation target, measured by the acknowledgement's deadlineExceeded field.
   * The observer always cascades eagerly. This does not guarantee scheduler latency or cleanup. */
  readonly deadlineMs?: number
  /** Who stops the run. `cancelRun` requires it on every new request; it is optional here only
   *  so a request written before that rule still reads. The settle record carries it. */
  readonly operator?: string
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
 *  - `'cancelled'`        — the run reached its terminal cancelled state with confirmed teardown.
 *  - `'not_live'`         — the run was not live to cancel: it settled on its own despite the
 *                           request, or it ended before the request was applied.
 */
export interface RunCancellation {
  /** Runtime path that issued the cascade. */
  readonly path?: 'observer' | 'turn-boundary' | 'fallback'
  /** Runtime clock elapsed between request timestamp and cascade application. */
  readonly appliedAfterMs?: number
  /** Whether application exceeded the requested deadlineMs; absent when no target was requested. */
  readonly deadlineExceeded?: boolean
  readonly operationId: string
  readonly effect: RetainedRunEffect
  /** ISO timestamp of the original request. */
  readonly requestedAt: string
  /** ISO timestamp of the runtime's most recent observation of this operation. */
  readonly observedAt: string
  /** The caller's reason, carried verbatim from the request. */
  readonly reason?: string
  /** The caller's operator identity, carried verbatim from the request. */
  readonly operator?: string
  /** The runtime's explanation of how it arrived at `effect`. */
  readonly detail?: string
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
  const dir = workerCancellationsDir(eventDir)
  const file = runCancelRequestFile(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel request')
  assertNoSymlinkDescendant(eventDir, file, 'run cancel request')
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
  const dir = workerCancellationsDir(eventDir)
  const file = runCancellationFile(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel acknowledgement')
  assertNoSymlinkDescendant(eventDir, file, 'run cancel acknowledgement')
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
 * Durably write the run-scoped acknowledgement. The shared writer fsyncs the file and containing
 * directory, so a concurrent reader sees the prior complete record or the new complete record.
 *
 * @internal The runtime is the only intended writer; clients read via {@link readRunCancellation}
 * or {@link cancelRun}.
 */
export function writeRunCancellation(eventDir: string, record: RunCancellation): void {
  writeAtomicDurableFile(runCancellationTarget(eventDir), recordText(record), { mode: 0o600 })
}

/** `writeRunCancellation` without blocking the calling thread on the disk under a run claim. @internal */
export function writeRunCancellationAsync(
  eventDir: string,
  record: RunCancellation,
): Promise<void> {
  return writeAtomicDurableFileAsync(runCancellationTarget(eventDir), recordText(record), {
    mode: 0o600,
  })
}

const recordText = (record: RunCancellation | RunCancelRequest): string =>
  `${JSON.stringify(record, null, 2)}\n`

/** The acknowledgement file, its directory made and every path checked for symlinks. */
function runCancellationTarget(eventDir: string): string {
  const dir = workerCancellationsDir(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel acknowledgement')
  mkdirSync(dir, { recursive: true })
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel acknowledgement')
  const file = runCancellationFile(eventDir)
  assertNoSymlinkDescendant(eventDir, file, 'run cancel acknowledgement')
  return file
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
 * AS-IS and nothing is written. A retry that changes the source, reason, deadline, or operator
 * fails closed. A request the runtime has not answered yet returns `effect: 'unknown'` (never a
 * success); call again with the same `operationId` — or {@link readRunCancellation} — to read the
 * acknowledged result after a reconnect.
 *
 * A run carries ONE run-scoped operation: a second request under a different `operationId` throws
 * rather than silently replacing the pending one, because both would claim the same single abort.
 * Reopening a settled run (`supervisePursuit`'s `reopen`) moves that operation aside.
 *
 * A NEW request must name its `operator`, so every stop says who made it. A replay of a request
 * or acknowledgement written before that rule is answered as it was.
 */
export function cancelRun(
  eventDir: string,
  operationId: string,
  // Inline, as published through 10.0.5: the archive admission reads a named type here as a new
  // shape, which would make this patch a major.
  options: {
    readonly reason?: string
    readonly source?: string
    readonly deadlineMs?: number
    readonly operator?: string
  } = {},
): RunCancellation {
  const admission = admitRunCancel(eventDir, operationId, options)
  if ('answer' in admission) return admission.answer
  if (admission.file !== undefined) {
    writeAtomicDurableFile(admission.file, recordText(admission.request), { mode: 0o600 })
    appendWorkerControlEvent(eventDir, 'run', admission.event)
  }
  return queuedRunCancellation(admission.request)
}

/**
 * Request the cancellation of the whole run like {@link cancelRun}, without blocking the calling
 * thread on the disk. The request file is published by the durable writer whether or not the
 * caller holds a run claim (a coordinator outside the run holds none), so an event loop that stops
 * runs keeps running while the file and its directory reach disk. Same admission, replay and
 * conflict rules.
 * @stable
 */
export async function cancelRunAsync(
  eventDir: string,
  operationId: string,
  options: CancelRunOptions = {},
): Promise<RunCancellation> {
  const admission = admitRunCancel(eventDir, operationId, options)
  if ('answer' in admission) return admission.answer
  if (admission.file !== undefined) {
    // Published only if no request is there yet: an overlapping call admitted against the same empty
    // inbox loses here, and is admitted again against the winner, which it replays or conflicts with.
    const published = await runFencedAlways(
      'publishExclusiveDurableFile',
      publishExclusiveFenced,
      admission.file,
      recordText(admission.request),
      { mode: 0o600 },
    )
    if (!published) return cancelRunAsync(eventDir, operationId, options)
    await appendWorkerControlEventAsync(eventDir, 'run', admission.event)
  }
  return queuedRunCancellation(admission.request)
}

/** Options of {@link cancelRun} and {@link cancelRunAsync}. */
export interface CancelRunOptions {
  readonly reason?: string
  readonly source?: string
  readonly deadlineMs?: number
  readonly operator?: string
}

/**
 * The admission of one run cancel: the standing acknowledgement, or the request to answer for,
 * with the file and control event still to write when it is new.
 */
function admitRunCancel(
  eventDir: string,
  operationId: string,
  options: CancelRunOptions,
):
  | { readonly answer: RunCancellation }
  | {
      readonly request: RunCancelRequest
      readonly file?: string
      readonly event: Record<string, unknown>
    } {
  if (
    options.deadlineMs !== undefined &&
    (!Number.isFinite(options.deadlineMs) || options.deadlineMs < 0)
  ) {
    throw new Error('cancelRun: deadlineMs must be a finite nonnegative number')
  }
  const opId = operationId.trim()
  if (!opId) throw new Error('cancelRun: operationId is empty')
  const pending = readRunCancelRequest(eventDir)
  if (pending !== undefined && pending.operationId !== opId) {
    throw new Error(
      `cancelRun: run cancel '${pending.operationId}' is already pending for this run; ` +
        `read it with readRunCancellation instead of issuing '${opId}'`,
    )
  }
  const candidate = {
    operationId: opId,
    source: options.source ?? 'human',
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.operator === undefined ? {} : { operator: options.operator }),
  }
  if (pending !== undefined) assertSameRunCancelRequest(pending, candidate)
  const acknowledged = readRunCancellation(eventDir, opId)
  if (acknowledged !== undefined) {
    if (pending === undefined && options.source !== undefined) {
      throw new Error(
        `cancelRun: operation '${opId}' cannot verify source without its admitted request`,
      )
    }
    assertRunCancellationMatchesCandidate(acknowledged, candidate)
    return { answer: acknowledged }
  }
  // A new request names who stops the run. A replay of a request written before this rule keeps
  // its absent operator: it was admitted above against the file it replays.
  if (pending === undefined && (options.operator === undefined || options.operator.trim() === '')) {
    throw new Error('cancelRun: operator is required; name who stops the run')
  }
  const source = options.source ?? 'human'
  const request: RunCancelRequest = pending ?? {
    operationId: opId,
    at: new Date().toISOString(),
    source,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.operator === undefined ? {} : { operator: options.operator }),
  }
  const event = {
    kind: 'run-cancel-request',
    operationId: opId,
    source,
    queued: true,
    ...(options.reason === undefined ? {} : { reason: options.reason }),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
    ...(options.operator === undefined ? {} : { operator: options.operator }),
  }
  if (pending !== undefined) return { request, event }
  const dir = workerCancellationsDir(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel request')
  mkdirSync(dir, { recursive: true })
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel request')
  const file = runCancelRequestFile(eventDir)
  assertNoSymlinkDescendant(eventDir, file, 'run cancel request')
  return { request, file, event }
}

/** The answer to a request no runtime has acknowledged yet. */
function queuedRunCancellation(request: RunCancelRequest): RunCancellation {
  return {
    operationId: request.operationId,
    effect: 'unknown',
    requestedAt: request.at,
    observedAt: request.at,
    ...(request.reason === undefined ? {} : { reason: request.reason }),
    ...(request.operator === undefined ? {} : { operator: request.operator }),
    detail: 'request queued; no runtime acknowledger has answered yet',
  }
}

type RunCancelRequestCandidate = Omit<RunCancelRequest, 'at'>

function assertSameRunCancelRequest(
  existing: RunCancelRequest,
  candidate: RunCancelRequestCandidate,
): void {
  if (existing.operationId !== candidate.operationId) {
    throw new Error(`cancelRun: operation '${candidate.operationId}' has an id collision`)
  }
  if (existing.source !== candidate.source) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its admitted request ` +
        `(source '${existing.source}' != '${candidate.source}')`,
    )
  }
  if (existing.deadlineMs !== candidate.deadlineMs) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its admitted request (deadlineMs differs)`,
    )
  }
  if (existing.reason !== candidate.reason) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its admitted request ` +
        `(reason differs)`,
    )
  }
  if (existing.operator !== candidate.operator) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its admitted request ` +
        `(operator '${existing.operator}' != '${candidate.operator}')`,
    )
  }
}

function assertRunCancellationMatchesCandidate(
  existing: RunCancellation,
  candidate: RunCancelRequestCandidate,
): void {
  if (existing.reason !== candidate.reason) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its acknowledgement ` +
        `(reason differs)`,
    )
  }
  // An acknowledgement written before acknowledgements carried the operator (0.251.0) names none
  // even when its admitted request does. The request comparator has already held the candidate
  // to that request, so a legacy record matches any candidate operator; a record that names one
  // must name the same one.
  if (existing.operator !== undefined && existing.operator !== candidate.operator) {
    throw new Error(
      `cancelRun: operation '${candidate.operationId}' conflicts with its acknowledgement ` +
        `(operator '${existing.operator}' != '${candidate.operator}')`,
    )
  }
}

function isRunCancelRequest(value: Partial<RunCancelRequest>): value is RunCancelRequest {
  return (
    typeof value.operationId === 'string' &&
    value.operationId.length > 0 &&
    typeof value.at === 'string' &&
    typeof value.source === 'string' &&
    (value.deadlineMs === undefined ||
      (Number.isFinite(value.deadlineMs) && value.deadlineMs >= 0)) &&
    (value.reason === undefined || typeof value.reason === 'string') &&
    (value.operator === undefined || typeof value.operator === 'string')
  )
}
