import type { NodeStatus } from './scope-node-types'

/** The most recent activity an executor can name. */
export interface ActivityNote {
  readonly at: number
  readonly kind: 'turn' | 'tool' | 'note'
  readonly label: string
  readonly status?: 'ok' | 'error'
  readonly detail?: string
}

/** Optional executor-owned enrichment of scope-derived progress. */
export interface ExecutorProgress {
  readonly turns?: number
  readonly pendingMessages?: number
  readonly recentActivity?: ReadonlyArray<ActivityNote>
  readonly derived?: ReadonlyArray<string>
  readonly note?: string
}

/** The full live view of one worker. */
export interface WorkerProgress {
  readonly id: string
  readonly status: NodeStatus
  readonly live: boolean
  readonly steerable: boolean
  readonly startedAt: number
  readonly lastActivityAt: number
  readonly idleMs: number
  readonly stalled: boolean
  readonly stallAfterMs: number
  readonly turns: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly tokensKnown?: boolean
  readonly usd: number
  readonly usdKnown?: boolean
  readonly pendingMessages: number
  readonly recentActivity: ReadonlyArray<ActivityNote>
  readonly derived?: ReadonlyArray<string>
  readonly note?: string
}

/** A bounded newest-last ring of activity notes. */
export interface ActivityLog {
  push(note: ActivityNote): void
  read(): ReadonlyArray<ActivityNote>
  last(): ActivityNote | undefined
  size(): number
}

/** Scope-side facts needed to build a worker-progress read. */
export interface ScopeProgressInput {
  readonly id: string
  readonly status: NodeStatus
  readonly steerable: boolean
  readonly startedAt: number
  readonly lastActivityAt: number
  readonly turns: number
  readonly tokens: { readonly input: number; readonly output: number }
  readonly tokensKnown?: boolean
  readonly usd: number
  readonly usdKnown?: boolean
}
