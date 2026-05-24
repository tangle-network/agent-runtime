/**
 * @experimental
 *
 * In-memory state for async MCP delegations. State machine:
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
 * Persistent state (sqlite) is a Phase 2 follow-up. The README documents the
 * in-memory limitation explicitly so consumers know a worker restart drops
 * pending delegations.
 */

import type {
  DelegateCodeArgs,
  DelegateResearchArgs,
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

/** @experimental */
export interface DelegationRecord {
  taskId: string
  profile: DelegationProfile
  namespace?: string
  args: DelegateCodeArgs | DelegateResearchArgs
  status: DelegationStatus
  progress?: DelegationProgress
  result?: DelegationResultPayload
  error?: DelegationError
  costUsd?: number
  startedAt: string
  completedAt?: string
  /** Sha-prefix hash of the canonical input — used for idempotency lookup. */
  idempotencyKey?: string
  /** Feedback events keyed by this delegation's taskId. */
  feedback: DelegationFeedbackSnapshot[]
}

/** @experimental */
export interface SubmitInput<Args extends DelegateCodeArgs | DelegateResearchArgs> {
  profile: DelegationProfile
  args: Args
  namespace?: string
  idempotencyKey?: string
  /**
   * Runs the underlying delegation. The queue passes a fresh `AbortSignal`
   * and a `report` channel for incremental progress updates. The function
   * MUST resolve with the typed `DelegationResultPayload['output']`; the
   * queue wraps it with the profile tag.
   */
  run: (ctx: {
    signal: AbortSignal
    report(progress: DelegationProgress): void
  }) => Promise<DelegationResultPayload['output']>
}

/** @experimental */
export interface SubmitOutput {
  taskId: string
  /** True when a prior matching `idempotencyKey` returned an existing record. */
  reused: boolean
}

/** @experimental */
export interface DelegationTaskQueueOptions {
  /** ID generator override; default `randomTaskId`. */
  generateId?: () => string
  /** Clock override; default `() => new Date().toISOString()`. */
  now?: () => string
}

/** @experimental */
export class DelegationTaskQueue {
  private readonly records = new Map<string, DelegationRecord>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly byIdempotencyKey = new Map<string, string>()
  private readonly generateId: () => string
  private readonly now: () => string

  constructor(options: DelegationTaskQueueOptions = {}) {
    this.generateId = options.generateId ?? randomTaskId
    this.now = options.now ?? (() => new Date().toISOString())
  }

  /**
   * Kick off a delegation in the background. Returns immediately. The
   * `taskId` is queryable via `status` once this method returns.
   */
  submit<Args extends DelegateCodeArgs | DelegateResearchArgs>(
    input: SubmitInput<Args>,
  ): SubmitOutput {
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
    }
    this.records.set(taskId, record)
    this.controllers.set(taskId, controller)
    if (input.idempotencyKey) this.byIdempotencyKey.set(input.idempotencyKey, taskId)

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
   */
  status(taskId: string): DelegationStatusResult | undefined {
    const record = this.records.get(taskId)
    if (!record) return undefined
    return toStatusResult(record)
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

  /** Test-only — number of in-flight (non-terminal) records. */
  inflightCount(): number {
    let n = 0
    for (const record of this.records.values()) {
      if (!isTerminal(record.status)) n += 1
    }
    return n
  }

  private async execute<Args extends DelegateCodeArgs | DelegateResearchArgs>(
    taskId: string,
    input: SubmitInput<Args>,
    controller: AbortController,
  ): Promise<void> {
    const record = this.records.get(taskId)
    if (!record) return
    record.status = 'running'
    try {
      const output = await input.run({
        signal: controller.signal,
        report: (progress) => {
          if (record.status === 'running') record.progress = progress
        },
      })
      // `cancel()` may have flipped the status to `cancelled` while the
      // run promise was pending. Read the field through a widening
      // helper so the narrowed `'running'` type from the assignment
      // above does not exclude that case at compile time.
      if (currentStatus(record) === 'cancelled') return
      record.status = 'completed'
      record.completedAt = this.now()
      record.result = { profile: input.profile, output } as DelegationResultPayload
    } catch (err) {
      if (currentStatus(record) === 'cancelled') return
      record.status = 'failed'
      record.completedAt = this.now()
      record.error = errorToShape(err)
    } finally {
      this.controllers.delete(taskId)
    }
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

function toStatusResult(record: DelegationRecord): DelegationStatusResult {
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
  return out
}

function toHistoryEntry(record: DelegationRecord): DelegationHistoryEntry {
  const entry: DelegationHistoryEntry = {
    taskId: record.taskId,
    profile: record.profile,
    args: record.args,
    status: record.status,
    startedAt: record.startedAt,
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
} from './types'
