/**
 *
 * The LIVE read-model of a still-RUNNING worker — what a driver can see BEFORE the worker settles.
 *
 * Until this existed, `observe_agent` on a running worker returned `{status:'running', spent:{0,0},
 * outRef:null, output:null}`: nothing a brain could act on, so a brain that wanted to steer had no
 * evidence to steer FROM. This is the other half of the steering wire (the first half is
 * `Executor.deliver`): a supervisor cannot correct a worker it cannot watch.
 *
 * Two layers, both pull-based — no timer, no background task, so it is safe to leave on:
 *
 *   - The SCOPE layer, available for EVERY executor with no executor cooperation at all: usage
 *     events are timestamped as they arrive, so `lastActivityAt` / `idleMs` / `stalled` /
 *     `tokens` / `turns` are derived from the stream the conserved pool already meters.
 *   - The EXECUTOR layer, optional enrichment via `Executor.progress()`: the tool/file activity
 *     the harness exposes, its own turn count, and how many steers are queued but unread.
 *
 * `stalled` is a DERIVED read, computed at observation time against `stallAfterMs` — never a
 * background watchdog. A worker that has produced no metered activity for longer than the
 * threshold reads `stalled: true`; nothing is killed, nothing is retried. The driver decides.
 *
 * @experimental
 */

import type { NodeStatus } from './types'

/** How long a worker may produce no metered activity before a `progress()` read calls it stalled.
 *  Deliberately generous: a coding harness routinely spends minutes inside one tool call, and a
 *  false stall that provokes a steer is worse than a late one. */
export const DEFAULT_STALL_AFTER_MS = 180_000

/** The most recent activity the executor can name — one tool call, one turn, or a free-form note.
 *  `label` is the tool/file/turn name; `detail` is a short, already-truncated descriptor (a path,
 *  a command head) that a driver can read without pulling the whole transcript. */
export interface ActivityNote {
  readonly at: number
  readonly kind: 'turn' | 'tool' | 'note'
  readonly label: string
  readonly status?: 'ok' | 'error'
  readonly detail?: string
}

/** What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every
 *  field is optional: an executor that knows only its own turn count reports only that. */
export interface ExecutorProgress {
  /** The executor's own turn/step count when it is more meaningful than metered iterations. */
  readonly turns?: number
  /** Steers/answers delivered but not yet folded into the worker's conversation. */
  readonly pendingMessages?: number
  /** Newest-last window of what the worker has been doing. */
  readonly recentActivity?: ReadonlyArray<ActivityNote>
  /** A one-line human-readable state ("turn 3, running tests"). */
  readonly note?: string
}

/** The full live view of one worker, as `observe_agent` returns it mid-flight. */
export interface WorkerProgress {
  readonly id: string
  readonly status: NodeStatus
  /** True while the node is neither done, failed, nor cancelled — i.e. a steer could still land. */
  readonly live: boolean
  /** True when this worker's executor exposes an inbox (`Executor.deliver`) — i.e. `steer_agent`
   *  can actually reach it. False means a steer would be recorded and dropped. */
  readonly steerable: boolean
  readonly startedAt: number
  /** Epoch ms of the last metered usage event or executor-reported activity. */
  readonly lastActivityAt: number
  readonly idleMs: number
  readonly stalled: boolean
  readonly stallAfterMs: number
  /** Metered iterations so far (the executor's own count when it reports one). */
  readonly turns: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly usd: number
  /** Steers delivered but not yet read by the worker. */
  readonly pendingMessages: number
  /** Newest-last window of tool/turn activity; empty when the executor exposes none. */
  readonly recentActivity: ReadonlyArray<ActivityNote>
  readonly note?: string
}

/** A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`. */
export interface ActivityLog {
  push(note: ActivityNote): void
  /** Newest-last, at most `limit` entries. */
  read(): ReadonlyArray<ActivityNote>
  last(): ActivityNote | undefined
  size(): number
}

/** Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools. */
export function createActivityLog(limit = 12): ActivityLog {
  const notes: ActivityNote[] = []
  const cap = Math.max(1, Math.floor(limit))
  return {
    push(note) {
      notes.push(note)
      if (notes.length > cap) notes.splice(0, notes.length - cap)
    },
    read: () => [...notes],
    last: () => notes[notes.length - 1],
    size: () => notes.length,
  }
}

/** The scope-side facts about a child, independent of whether its executor cooperates. */
export interface ScopeProgressInput {
  readonly id: string
  readonly status: NodeStatus
  readonly steerable: boolean
  readonly startedAt: number
  readonly lastActivityAt: number
  readonly turns: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly usd: number
}

/** Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the
 *  caller supplies `now`, so a test can observe a stall without waiting for one. */
export function readWorkerProgress(
  scope: ScopeProgressInput,
  executor: ExecutorProgress | undefined,
  now: number,
  stallAfterMs: number = DEFAULT_STALL_AFTER_MS,
): WorkerProgress {
  const live = scope.status !== 'done' && scope.status !== 'failed' && scope.status !== 'cancelled'
  // An executor-reported activity is newer evidence than the last metered usage event: a harness
  // can run a five-minute tool call without emitting a single token.
  const executorActivityAt = executor?.recentActivity?.length
    ? (executor.recentActivity[executor.recentActivity.length - 1] as ActivityNote).at
    : 0
  const lastActivityAt = Math.max(scope.lastActivityAt, executorActivityAt)
  const idleMs = Math.max(0, now - lastActivityAt)
  const note = executor?.note
  return {
    id: scope.id,
    status: scope.status,
    live,
    steerable: scope.steerable,
    startedAt: scope.startedAt,
    lastActivityAt,
    idleMs,
    // Only a LIVE worker can stall; a settled one is simply finished.
    stalled: live && idleMs > stallAfterMs,
    stallAfterMs,
    turns: executor?.turns ?? scope.turns,
    tokens: scope.tokens,
    usd: scope.usd,
    pendingMessages: executor?.pendingMessages ?? 0,
    recentActivity: executor?.recentActivity ?? [],
    ...(note ? { note } : {}),
  }
}
