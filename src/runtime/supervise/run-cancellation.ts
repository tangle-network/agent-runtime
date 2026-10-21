import { existsSync, mkdirSync, readFileSync, watch } from 'node:fs'
import { join } from 'node:path'
import type { RetainedRunEffect } from '../retained-run-types'
import { assertNoSymlinkDescendant, writeAtomicDurableFile } from './durable-file'
import { appendWorkerControlEvent, workerCancellationsDir } from './run-layout'

/** Apply a durable request through the run's existing abort controller. */
export function applyRunCancellation(
  dir: string,
  abortRun: (reason: string, request?: RunCancelRequest) => void,
  now: () => string,
  path: 'observer' | 'turn-boundary' | 'fallback' = 'turn-boundary',
): RunCancellation | undefined {
  const request = readRunCancelRequest(dir)
  if (request === undefined) return undefined
  const prior = readRunCancellation(dir, request.operationId)
  // A request acknowledged only as `cancel_requested` is still owed by this run: the process
  // that issued the abort died before the run settled. Abort again; the record stands.
  if (prior?.effect === 'cancel_requested') {
    abortRun(request.reason ?? 'run cancel requested', request)
  }
  if (prior !== undefined) return prior
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
  writeRunCancellation(dir, record)
  return record
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
  const check = (path: 'observer' | 'fallback' = 'observer'): void => {
    if (failure !== undefined) throw failure
    if (active) applyRunCancellation(dir, abortOnce, () => new Date().toISOString(), path)
  }
  const fail = (error: unknown): void => {
    if (!active) return
    failure = error
    abortRun(`durable run cancellation observer failed: ${String(error)}`)
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
      try {
        check()
      } catch (error) {
        fail(error)
      }
    })
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code !== 'EMFILE' && code !== 'ENOSPC') throw error
  }
  watcher?.on('error', fail)
  // Filesystem notifications are advisory. Scan the same durable inbox when one is dropped —
  // and carry the whole observer alone whenever the watcher above could not be created.
  const fallback = setInterval(() => {
    try {
      check('fallback')
    } catch (error) {
      fail(error)
    }
  }, 100)
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
  /** Stable operator/requester identity for audit trails. */
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
  const dir = workerCancellationsDir(eventDir)
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel acknowledgement')
  mkdirSync(dir, { recursive: true })
  assertNoSymlinkDescendant(eventDir, dir, 'run cancel acknowledgement')
  const file = runCancellationFile(eventDir)
  assertNoSymlinkDescendant(eventDir, file, 'run cancel acknowledgement')
  writeAtomicDurableFile(file, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
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
 */
export function cancelRun(
  eventDir: string,
  operationId: string,
  options: {
    readonly reason?: string
    readonly source?: string
    readonly deadlineMs?: number
    readonly operator?: string
  } = {},
): RunCancellation {
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
    return acknowledged
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
  if (pending === undefined) {
    const dir = workerCancellationsDir(eventDir)
    assertNoSymlinkDescendant(eventDir, dir, 'run cancel request')
    mkdirSync(dir, { recursive: true })
    assertNoSymlinkDescendant(eventDir, dir, 'run cancel request')
    const file = runCancelRequestFile(eventDir)
    assertNoSymlinkDescendant(eventDir, file, 'run cancel request')
    writeAtomicDurableFile(file, `${JSON.stringify(request, null, 2)}\n`, { mode: 0o600 })
    appendWorkerControlEvent(eventDir, 'run', {
      kind: 'run-cancel-request',
      operationId: opId,
      source,
      queued: true,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
      ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
      ...(options.operator === undefined ? {} : { operator: options.operator }),
    })
  }
  return {
    operationId: opId,
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
