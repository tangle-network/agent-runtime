/**
 * @experimental
 *
 * State machine for async MCP delegations:
 *
 *   pending → running → completed | failed
 *           ↘ cancelled (from any non-terminal state via cancel())
 *
 * Each `submit` returns a `taskId` immediately and kicks the work off in the
 * background. The work function receives an `AbortSignal` the queue fires
 * when `cancel(taskId)` is called. The queue does NOT supervise runtime
 * timeouts — the underlying `runLoop` driver / sandbox imposes those.
 *
 * Idempotency: callers may supply an `idempotencyKey` (hash of the input).
 * A duplicate `submit` with a known key returns the existing task instead of
 * starting a new one. Mutated input → different key → different task.
 *
 * Durability: the working set lives in memory (reads stay synchronous) and
 * every record mutation is journaled through a `DelegationStore`. The default
 * `InMemoryDelegationStore` keeps today's semantics — a process restart drops
 * all state. Construct via `DelegationTaskQueue.restore({ store })` with a
 * `FileDelegationStore` to reload prior records on startup: terminal records
 * stay queryable, in-flight records either re-attach through the
 * `resumeDelegate` seam (when they carry a `detachedSessionRef`) or fail
 * loud with a driver-restart error so `delegation_status` tells the truth.
 */

import { ValidationError } from '../errors'
import type { LoopTraceEmitter } from '../runtime/types'
import {
  DelegationPersistenceError,
  type DelegationStore,
  InMemoryDelegationStore,
} from './delegation-store'
import {
  capDelegationTrace,
  createDelegationTraceCollector,
  type DelegationTraceSpan,
  generateDelegationSpanId,
} from './delegation-trace'
import type {
  DelegateCodeArgs,
  DelegateResearchArgs,
  DelegateUiAuditArgs,
  DelegationError,
  DelegationFeedbackSnapshot,
  DelegationHistoryArgs,
  DelegationHistoryEntry,
  DelegationProfile,
  DelegationProgress,
  DelegationResultPayload,
  DelegationStatus,
  DelegationStatusResult,
} from './types'

type AnyDelegateArgs = DelegateCodeArgs | DelegateResearchArgs | DelegateUiAuditArgs

/**
 * Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
 * persistent stores round-trip records through `JSON.stringify`.
 *
 * @experimental
 */
export interface DelegationRecord {
  taskId: string
  profile: DelegationProfile
  namespace?: string
  args: AnyDelegateArgs
  status: DelegationStatus
  progress?: DelegationProgress
  result?: DelegationResultPayload
  error?: DelegationError
  costUsd?: number
  startedAt: string
  completedAt?: string
  /** Sha-prefix hash of the canonical input — used for idempotency lookup. */
  idempotencyKey?: string
  /**
   * Caller-generated deterministic id of a detached run (e.g. the sandbox
   * session id a single-tick driver resumes by). Presence is what makes a
   * restored in-flight record resumable via `resumeDelegate`; without it a
   * restart settles the record as failed.
   */
  detachedSessionRef?: string
  /** Feedback events keyed by this delegation's taskId. */
  feedback: DelegationFeedbackSnapshot[]
  /**
   * Compact loop-trace span tree teed from the delegation's run, oldest
   * spans first. Appended when a delegated loop reaches `loop.ended` and
   * settled (partial buffers included) at the terminal transition. Capped
   * via `capDelegationTrace` — see `traceTruncated`.
   */
  trace?: DelegationTraceSpan[]
  /** Present when oldest trace spans were dropped to honor the trace caps. */
  traceTruncated?: true
}

/** @experimental */
export interface SubmitInput<Args extends AnyDelegateArgs> {
  profile: DelegationProfile
  args: Args
  namespace?: string
  idempotencyKey?: string
  /**
   * Records the detached-run resume key on the new record. The submitted
   * `run` function still executes in-process exactly as without it — the
   * ref only matters after a restart, when `DelegationTaskQueue.restore`
   * hands it to the `resumeDelegate` seam instead of failing the record.
   */
  detachedSessionRef?: string
  /**
   * Runs the underlying delegation. The queue passes a fresh `AbortSignal`
   * and a `report` channel for incremental progress updates. The function
   * MUST resolve with the typed `DelegationResultPayload['output']`; the
   * queue wraps it with the profile tag.
   */
  run: (ctx: DelegationRunContext) => Promise<DelegationResultPayload['output']>
}

/** @experimental Context handed to a `SubmitInput.run` function. */
export interface DelegationRunContext {
  signal: AbortSignal
  report(progress: DelegationProgress): void
  /** The `detachedSessionRef` recorded at submit, when one was supplied. */
  detachedSessionRef?: string
  /**
   * Replace the record's detached-run resume key — the detached dispatch path
   * calls this once the sandbox id is known so the persisted ref names a
   * resolvable box. Ignored after the record settles (a cancel racing the
   * rebind is legitimate; the ref no longer matters then). Throws on an empty
   * ref — erasing the resume key would silently make the record unresumable.
   */
  updateDetachedSessionRef(ref: string): void
  /**
   * Per-delegation loop-trace sink, always provided by the queue. Events
   * emitted here are journaled onto the record as a compact span tree
   * (`record.trace`) when each loop run ends and at the delegation's
   * terminal transition. Delegates forward it into their `runLoop` ctx,
   * composed with any process-wide OTEL emitter
   * (`composeLoopTraceEmitters`). Optional in the type so consumer-built
   * contexts stay source-compatible.
   */
  traceEmitter?: LoopTraceEmitter
}

/** @experimental */
export interface SubmitOutput {
  taskId: string
  /** True when a prior matching `idempotencyKey` returned an existing record. */
  reused: boolean
}

/**
 * One observation of a detached run, mapped 1:1 from a single-tick driver
 * (e.g. the sandbox SDK's `driveTurn`, which reports
 * completed | running | failed per pass). `running` schedules another tick
 * after `intervalMs`; `completed` / `failed` settle the record.
 *
 * @experimental
 */
export type DelegationResumeTick =
  | { state: 'running' }
  | { state: 'completed'; output: DelegationResultPayload['output']; costUsd?: number }
  | { state: 'failed'; error: DelegationError }

/** @experimental */
export interface DelegationResumeContext {
  /** Fired by `cancel(taskId)`; the driver should stop the remote run when it can. */
  signal: AbortSignal
  report(progress: DelegationProgress): void
}

/**
 * Re-attaches restored in-flight records to their detached runs. The queue
 * calls `tick` repeatedly — it never awaits a whole run — so the driver can
 * be a thin wrapper over a one-pass primitive: resolve the run named by
 * `detachedSessionRef`, advance/poll it once, report where it stands. A
 * thrown error settles the record as failed; `failed` ticks are treated as
 * terminal and are not retried.
 *
 * @experimental
 */
export interface DelegationResumeDriver {
  tick(
    task: { record: DelegationRecord; detachedSessionRef: string },
    ctx: DelegationResumeContext,
  ): Promise<DelegationResumeTick>
  /** Delay between `running` ticks, in milliseconds. Default 5000. */
  intervalMs?: number
}

/** @experimental */
export interface DelegationTaskQueueOptions {
  /** ID generator override; default `randomTaskId`. */
  generateId?: () => string
  /** Clock override; default `() => new Date().toISOString()`. */
  now?: () => string
  /**
   * Journal for record mutations and the `restore()` load source. Default
   * `InMemoryDelegationStore` — observably identical to an unjournaled
   * queue. Pass a `FileDelegationStore` through
   * `DelegationTaskQueue.restore` for state that survives a restart;
   * constructing with `new` never loads prior state.
   */
  store?: DelegationStore
  /** Resume seam for restored in-flight records that carry a `detachedSessionRef`. */
  resumeDelegate?: DelegationResumeDriver
  /**
   * Maximum number of terminal (completed | failed | cancelled) records
   * retained; the oldest (by `completedAt`) are evicted from memory and
   * store once the cap is exceeded. Default unbounded.
   */
  maxTerminalRecords?: number
  /**
   * Observes the first store failure. After it fires, the queue refuses
   * new submissions and `flush()` rejects with the same error. Default:
   * rethrow on a microtask — an unhandled crash — because silently
   * degrading durable mode to memory-only would lie to the caller.
   */
  onPersistError?: (error: DelegationPersistenceError) => void
}

/** @experimental */
export class DelegationTaskQueue {
  private readonly records = new Map<string, DelegationRecord>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly byIdempotencyKey = new Map<string, string>()
  private readonly generateId: () => string
  private readonly now: () => string
  private readonly store: DelegationStore
  private readonly resumeDelegate?: DelegationResumeDriver
  private readonly maxTerminalRecords: number
  private readonly onPersistError: (error: DelegationPersistenceError) => void
  private persistTail: Promise<void> = Promise.resolve()
  private persistFailure: DelegationPersistenceError | undefined

  constructor(options: DelegationTaskQueueOptions = {}) {
    this.generateId = options.generateId ?? randomTaskId
    this.now = options.now ?? (() => new Date().toISOString())
    this.store = options.store ?? new InMemoryDelegationStore()
    this.resumeDelegate = options.resumeDelegate
    if (options.maxTerminalRecords !== undefined) {
      if (!Number.isInteger(options.maxTerminalRecords) || options.maxTerminalRecords < 1) {
        throw new ValidationError(
          `DelegationTaskQueue: maxTerminalRecords must be a positive integer, got ${String(options.maxTerminalRecords)}`,
        )
      }
    }
    this.maxTerminalRecords = options.maxTerminalRecords ?? Number.POSITIVE_INFINITY
    this.onPersistError =
      options.onPersistError ??
      ((error) => {
        queueMicrotask(() => {
          throw error
        })
      })
  }

  /**
   * Construct a queue from previously-persisted state. Loads every record
   * from `options.store`, rebuilds the idempotency index (so a re-submitted
   * identical task returns the prior taskId and its terminal state), then:
   *
   *   - terminal records stay queryable via `status()` / `history()`
   *   - in-flight records with a `detachedSessionRef` re-attach through
   *     `options.resumeDelegate` and report `running`
   *   - other in-flight records settle as failed — their driver died with
   *     the previous process and the result is unrecoverable
   *
   * The retention cap applies to the loaded set as well.
   */
  static async restore(options: DelegationTaskQueueOptions = {}): Promise<DelegationTaskQueue> {
    const queue = new DelegationTaskQueue(options)
    const loaded = await queue.store.loadAll()
    queue.rehydrate(loaded)
    return queue
  }

  /**
   * Kick off a delegation in the background. Returns immediately. The
   * `taskId` is queryable via `status` once this method returns. Throws
   * the recorded `DelegationPersistenceError` once the store has failed —
   * the queue does not accept work it cannot journal.
   */
  submit<Args extends AnyDelegateArgs>(input: SubmitInput<Args>): SubmitOutput {
    if (this.persistFailure) throw this.persistFailure
    if (input.idempotencyKey) {
      const existing = this.byIdempotencyKey.get(input.idempotencyKey)
      if (existing && this.records.has(existing)) {
        return { taskId: existing, reused: true }
      }
    }
    const taskId = this.generateId()
    const controller = new AbortController()
    const record: DelegationRecord = {
      taskId,
      profile: input.profile,
      namespace: input.namespace,
      args: input.args,
      status: 'pending',
      startedAt: this.now(),
      feedback: [],
      idempotencyKey: input.idempotencyKey,
      detachedSessionRef: input.detachedSessionRef,
    }
    this.records.set(taskId, record)
    this.controllers.set(taskId, controller)
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, taskId)
    this.persist(record)

    // Fire-and-forget the run function. Errors flow into the record so the
    // status poll surfaces them; the promise itself is intentionally
    // unobserved by the queue.
    queueMicrotask(() => {
      this.execute(taskId, input, controller)
    })

    return { taskId, reused: false }
  }

  /**
   * Snapshot the current state of a delegation. Returns `undefined` for
   * unknown ids so callers can distinguish missing from terminal.
   * `includeTrace` attaches the journaled loop-trace span tree — off by
   * default so status polls stay light.
   */
  status(
    taskId: string,
    opts?: { includeTrace?: boolean },
  ): DelegationStatusResult | undefined {
    const record = this.records.get(taskId)
    if (!record) return undefined
    return toStatusResult(record, opts)
  }

  /**
   * Abort an in-flight delegation. Returns `false` if the task is unknown
   * or already terminal. The underlying `run` function MUST honor the
   * abort signal for the cancel to take effect; the queue marks the
   * record `cancelled` regardless so a misbehaving runner cannot pin the
   * UI on `running` forever.
   */
  cancel(taskId: string): boolean {
    const record = this.records.get(taskId)
    if (!record) return false
    if (isTerminal(record.status)) return false
    const controller = this.controllers.get(taskId)
    controller?.abort()
    record.status = 'cancelled'
    record.completedAt = this.now()
    record.error = { message: 'cancelled by caller', kind: 'CancelledError' }
    this.persist(record)
    this.enforceRetention()
    return true
  }

  /**
   * Append a feedback event to the matching delegation. Returns `false`
   * when `ref` does not name a known taskId — the caller should still
   * record the feedback through a different surface (artifact/outcome
   * kinds are not queue-bound).
   */
  attachFeedback(taskId: string, snapshot: DelegationFeedbackSnapshot): boolean {
    const record = this.records.get(taskId)
    if (!record) return false
    record.feedback.push(snapshot)
    this.persist(record)
    return true
  }

  /**
   * Query the recorded delegations. Returns entries newest-first (by
   * `startedAt`), truncated to `limit`.
   */
  history(args: DelegationHistoryArgs = {}): DelegationHistoryEntry[] {
    const limit = clampLimit(args.limit)
    const since = args.since ? Date.parse(args.since) : Number.NEGATIVE_INFINITY
    const out: DelegationHistoryEntry[] = []
    for (const record of this.records.values()) {
      if (args.namespace && record.namespace !== args.namespace) continue
      if (args.profile && record.profile !== args.profile) continue
      if (Number.isFinite(since) && Date.parse(record.startedAt) < since) continue
      out.push(toHistoryEntry(record))
    }
    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return out.slice(0, limit)
  }

  /**
   * Await every journal write issued so far. Rejects with the recorded
   * `DelegationPersistenceError` when any of them failed. Call before
   * handing the store's backing file to another process.
   */
  async flush(): Promise<void> {
    await this.persistTail
    if (this.persistFailure) throw this.persistFailure
  }

  /** Test-only — number of in-flight (non-terminal) records. */
  inflightCount(): number {
    let n = 0
    for (const record of this.records.values()) {
      if (!isTerminal(record.status)) n += 1
    }
    return n
  }

  private async execute<Args extends AnyDelegateArgs>(
    taskId: string,
    input: SubmitInput<Args>,
    controller: AbortController,
  ): Promise<void> {
    const record = this.records.get(taskId)
    if (!record) return
    record.status = 'running'
    this.persist(record)
    // Journal tee: each finished loop run inside the delegation appends its
    // compact span tree to the record immediately (a long delegation's trace
    // is durable before the terminal transition); `settle()` below drains
    // partial buffers from runs that never reached `loop.ended`.
    const traceCollector = createDelegationTraceCollector((spans) => {
      if (isTerminal(currentStatus(record))) return
      this.appendTrace(record, spans)
      this.persist(record)
    })
    try {
      const output = await input.run({
        signal: controller.signal,
        report: (progress) => {
          if (record.status === 'running') {
            record.progress = progress
            this.persist(record)
          }
        },
        traceEmitter: traceCollector.emitter,
        ...(record.detachedSessionRef !== undefined
          ? { detachedSessionRef: record.detachedSessionRef }
          : {}),
        updateDetachedSessionRef: (ref) => {
          if (typeof ref !== 'string' || ref.length === 0) {
            throw new ValidationError(
              'DelegationTaskQueue: updateDetachedSessionRef requires a non-empty ref',
            )
          }
          if (isTerminal(currentStatus(record))) return
          record.detachedSessionRef = ref
          this.persist(record)
        },
      })
      traceCollector.settle()
      // `cancel()` may have flipped the status to `cancelled` while the
      // run promise was pending. Read the field through a widening
      // helper so the narrowed `'running'` type from the assignment
      // above does not exclude that case at compile time.
      if (currentStatus(record) === 'cancelled') return
      record.status = 'completed'
      record.completedAt = this.now()
      record.result = { profile: input.profile, output } as DelegationResultPayload
      this.persist(record)
      this.enforceRetention()
    } catch (err) {
      traceCollector.settle()
      if (currentStatus(record) === 'cancelled') return
      record.status = 'failed'
      record.completedAt = this.now()
      record.error = errorToShape(err)
      this.persist(record)
      this.enforceRetention()
    } finally {
      this.controllers.delete(taskId)
    }
  }

  private appendTrace(record: DelegationRecord, spans: DelegationTraceSpan[]): void {
    if (spans.length === 0) return
    const { trace, truncated } = capDelegationTrace([...(record.trace ?? []), ...spans])
    record.trace = trace
    if (truncated) record.traceTruncated = true
  }

  private rehydrate(loaded: DelegationRecord[]): void {
    const records = [...loaded].sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    for (const record of records) {
      this.records.set(record.taskId, record)
      if (record.idempotencyKey) this.byIdempotencyKey.set(record.idempotencyKey, record.taskId)
    }
    for (const record of this.records.values()) {
      if (isTerminal(record.status)) continue
      if (record.detachedSessionRef && this.resumeDelegate) {
        record.status = 'running'
        this.persist(record)
        this.startResume(record, record.detachedSessionRef, this.resumeDelegate)
        continue
      }
      record.status = 'failed'
      record.completedAt = this.now()
      record.error = {
        message: record.detachedSessionRef
          ? `delegation driver restarted while the task was in flight; detached session "${record.detachedSessionRef}" needs a resumeDelegate to be resumed`
          : 'delegation driver restarted while the task was in flight; the run was not detached and cannot be resumed',
        kind: 'DriverRestartError',
      }
      this.persist(record)
    }
    this.enforceRetention()
  }

  private startResume(
    record: DelegationRecord,
    detachedSessionRef: string,
    driver: DelegationResumeDriver,
  ): void {
    const controller = new AbortController()
    this.controllers.set(record.taskId, controller)
    void this.driveResume(record, detachedSessionRef, driver, controller)
  }

  private async driveResume(
    record: DelegationRecord,
    detachedSessionRef: string,
    driver: DelegationResumeDriver,
    controller: AbortController,
  ): Promise<void> {
    const intervalMs = driver.intervalMs ?? 5000
    const resumeStartMs = Date.parse(this.now())
    const ctx: DelegationResumeContext = {
      signal: controller.signal,
      report: (progress) => {
        if (currentStatus(record) !== 'running') return
        record.progress = progress
        this.persist(record)
      },
    }
    try {
      while (!controller.signal.aborted && currentStatus(record) === 'running') {
        const tick = await driver.tick({ record: structuredClone(record), detachedSessionRef }, ctx)
        if (currentStatus(record) === 'cancelled') return
        if (tick.state === 'completed') {
          this.appendResumeSpan(record, detachedSessionRef, resumeStartMs)
          record.status = 'completed'
          record.completedAt = this.now()
          record.result = {
            profile: record.profile,
            output: tick.output,
          } as DelegationResultPayload
          if (tick.costUsd !== undefined) record.costUsd = tick.costUsd
          this.persist(record)
          this.enforceRetention()
          return
        }
        if (tick.state === 'failed') {
          this.appendResumeSpan(record, detachedSessionRef, resumeStartMs, tick.error.message)
          record.status = 'failed'
          record.completedAt = this.now()
          record.error = tick.error
          this.persist(record)
          this.enforceRetention()
          return
        }
        await abortableDelay(intervalMs, controller.signal)
      }
    } catch (err) {
      if (currentStatus(record) === 'cancelled') return
      this.appendResumeSpan(record, detachedSessionRef, resumeStartMs, errorToShape(err).message)
      record.status = 'failed'
      record.completedAt = this.now()
      record.error = errorToShape(err)
      this.persist(record)
      this.enforceRetention()
    } finally {
      this.controllers.delete(record.taskId)
    }
  }

  /**
   * Journal the resumed segment of a detached run as one compact span. The
   * resume driver re-attaches after a process restart, so the original
   * process's loop events are gone — this span records the post-restart
   * observation window (re-attach → terminal tick) under the
   * `'detached-resume'` driver tag, keeping restored delegations observable
   * in the journal alongside trace-carrying live runs.
   */
  private appendResumeSpan(
    record: DelegationRecord,
    detachedSessionRef: string,
    startMs: number,
    error?: string,
  ): void {
    this.appendTrace(record, [
      {
        spanId: generateDelegationSpanId(),
        name: 'loop',
        kind: 'loop',
        startMs,
        endMs: Date.parse(this.now()),
        meta: {
          'tangle.loop.driver': 'detached-resume',
          'tangle.loop.detached_session_ref': detachedSessionRef,
          ...(error !== undefined ? { 'tangle.loop.error': error } : {}),
        },
      },
    ])
  }

  private persist(record: DelegationRecord): void {
    if (this.persistFailure) return
    const snapshot = structuredClone(record)
    this.persistTail = this.persistTail.then(async () => {
      if (this.persistFailure) return
      try {
        await this.store.upsert(snapshot)
      } catch (err) {
        this.failPersistence(err)
      }
    })
  }

  private persistRemoval(taskIds: string[]): void {
    if (this.persistFailure || taskIds.length === 0) return
    this.persistTail = this.persistTail.then(async () => {
      if (this.persistFailure) return
      try {
        await this.store.remove(taskIds)
      } catch (err) {
        this.failPersistence(err)
      }
    })
  }

  private failPersistence(cause: unknown): void {
    if (this.persistFailure) return
    const error =
      cause instanceof DelegationPersistenceError
        ? cause
        : new DelegationPersistenceError(
            `DelegationTaskQueue: store write failed: ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          )
    this.persistFailure = error
    this.onPersistError(error)
  }

  private enforceRetention(): void {
    if (!Number.isFinite(this.maxTerminalRecords)) return
    const terminal: DelegationRecord[] = []
    for (const record of this.records.values()) {
      if (isTerminal(record.status)) terminal.push(record)
    }
    const excess = terminal.length - this.maxTerminalRecords
    if (excess <= 0) return
    terminal.sort((a, b) =>
      (a.completedAt ?? a.startedAt).localeCompare(b.completedAt ?? b.startedAt),
    )
    const evicted = terminal.slice(0, excess)
    for (const record of evicted) {
      this.records.delete(record.taskId)
      if (
        record.idempotencyKey &&
        this.byIdempotencyKey.get(record.idempotencyKey) === record.taskId
      ) {
        this.byIdempotencyKey.delete(record.idempotencyKey)
      }
    }
    this.persistRemoval(evicted.map((record) => record.taskId))
  }
}

function isTerminal(status: DelegationStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled'
}

function currentStatus(record: DelegationRecord): DelegationStatus {
  return record.status
}

function clampLimit(raw: number | undefined): number {
  if (!Number.isFinite(raw)) return 50
  const n = Math.trunc(raw as number)
  if (n <= 0) return 50
  return Math.min(n, 500)
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve()
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function toStatusResult(
  record: DelegationRecord,
  opts?: { includeTrace?: boolean },
): DelegationStatusResult {
  const out: DelegationStatusResult = {
    taskId: record.taskId,
    profile: record.profile,
    status: record.status,
    startedAt: record.startedAt,
  }
  if (record.progress) out.progress = record.progress
  if (record.result) out.result = record.result
  if (record.error) out.error = record.error
  if (record.costUsd !== undefined) out.costUsd = record.costUsd
  if (record.completedAt) out.completedAt = record.completedAt
  if (opts?.includeTrace === true && record.trace && record.trace.length > 0) {
    out.trace = record.trace.map((span) => ({ ...span }))
    if (record.traceTruncated) out.traceTruncated = true
  }
  return out
}

function toHistoryEntry(record: DelegationRecord): DelegationHistoryEntry {
  const entry: DelegationHistoryEntry = {
    taskId: record.taskId,
    profile: record.profile,
    args: record.args,
    status: record.status,
    startedAt: record.startedAt,
    hasTrace: record.trace !== undefined && record.trace.length > 0,
  }
  if (record.namespace) entry.namespace = record.namespace
  if (record.completedAt) entry.completedAt = record.completedAt
  if (record.costUsd !== undefined) entry.costUsd = record.costUsd
  if (record.feedback.length > 0) entry.feedback = [...record.feedback]
  return entry
}

function errorToShape(err: unknown): DelegationError {
  if (err instanceof Error) {
    return { message: err.message, kind: err.name || 'Error' }
  }
  return { message: String(err), kind: 'NonError' }
}

function randomTaskId(): string {
  // Caller-stable id: `dlg-${timestamp}-${random}`. The timestamp portion
  // makes lexicographic sort match chronological order in history queries
  // even when the system clock skews under the second.
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 10)
  return `dlg-${t}-${r}`
}

/**
 * Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
 * collisions only affect dedupe, never correctness.
 *
 * @experimental
 */
export function hashIdempotencyInput(value: unknown): string {
  let str: string
  try {
    str = JSON.stringify(canonicalize(value))
  } catch {
    str = String(value)
  }
  // FNV-1a 32-bit
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalize)
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  const out: Record<string, unknown> = {}
  for (const [k, v] of entries) out[k] = canonicalize(v)
  return out
}

// Re-exports re-used by the feedback-store + handler glue. Kept local so
// consumers of the queue don't have to import from `./types` separately.
export type {
  DelegateCodeArgs,
  DelegateCodeResult,
  DelegateFeedbackArgs,
  DelegateFeedbackResult,
  DelegateResearchArgs,
  DelegateResearchResult,
  DelegateUiAuditArgs,
  DelegateUiAuditConfig,
  DelegateUiAuditResult,
  DelegateUiAuditRoute,
  DelegationError,
  DelegationFeedbackSnapshot,
  DelegationHistoryArgs,
  DelegationHistoryEntry,
  DelegationHistoryResult,
  DelegationProfile,
  DelegationProgress,
  DelegationResultPayload,
  DelegationStatus,
  DelegationStatusArgs,
  DelegationStatusResult,
  UiAuditorDelegationOutput,
} from './types'
