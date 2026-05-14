/**
 * @stable
 *
 * Canonical production-run lifecycle. ONE abstraction for "the agent did a
 * thing on behalf of a customer; record what it did, what it cost, and how it
 * ended." Consumer agents (legal, tax, gtm, creative, agent-builder) reach for
 * `startRuntimeRun` instead of inventing their own `agentRuns`-row helpers.
 *
 * Three concerns live in this module:
 *
 *  1. **Lifecycle state machine** — `running` -> `completed | failed | cancelled`,
 *     enforced by `RuntimeRunStateError`. Completion is idempotent (a second
 *     `complete()` call with the same status is a no-op so retries / cleanup
 *     paths don't double-fire side effects). A different terminal status is a
 *     state error.
 *
 *  2. **Cost ledger** — every `llm_call` event the handle observes contributes
 *     `tokensIn`, `tokensOut`, `costUsd`, and bumps `llmCalls`. Wall time is
 *     measured from `startRuntimeRun()` to `complete()`. Surface via
 *     `handle.cost()` for "cost per customer task" dashboards.
 *
 *  3. **Persistence adapter** — `RuntimeRunPersistenceAdapter` is the seam
 *     consumers plug in to write a `RuntimeRunRow` to their D1 / postgres /
 *     KV store. The adapter receives a sanitized row shape; no telemetry
 *     payload bytes flow through it unless the consumer opts in via
 *     `RuntimeRunOptions.telemetryEvents`.
 *
 * The pattern replaces legal-agent's bespoke `completeProductionAgentRun` /
 * `persistRuntimeRun` pair from `eval-evidence.ts` + `api.chat.ts`. Both are
 * marked `@deprecated` in this release; consumers ditch them on their own
 * version bumps.
 */

import { RuntimeRunStateError, ValidationError } from './errors'
import type { AgentTaskSpec, RuntimeStreamEvent } from './types'

/** @stable */
export type RuntimeRunStatus = 'running' | 'completed' | 'failed' | 'cancelled'

/** @stable */
export interface RuntimeRunCost {
  /** Cumulative input tokens across every observed `llm_call` event. */
  tokensIn: number
  /** Cumulative output tokens across every observed `llm_call` event. */
  tokensOut: number
  /** Sum of `costUsd` from every observed `llm_call` event. */
  costUsd: number
  /** Wall time from `startRuntimeRun()` to `complete()` (or `now()` if not yet completed). */
  wallMs: number
  /** Count of `llm_call` events observed during the run. */
  llmCalls: number
}

/** @stable */
export interface RuntimeRunCompleteInput {
  status: Exclude<RuntimeRunStatus, 'running'>
  resultSummary?: string
  /** Optional explicit cost override; if omitted, the accumulated ledger is used. */
  cost?: Partial<RuntimeRunCost>
  /** Stable error message when `status === 'failed'`. */
  error?: string
  /** Additional adapter-specific fields merged into the persisted row. */
  metadata?: Record<string, unknown>
}

/** @stable */
export interface RuntimeRunRow {
  /** Stable runtime-side identifier. Adapters may translate to their own primary key. */
  id: string
  workspaceId: string
  sessionId?: string
  agentId?: string
  domain?: string
  taskId: string
  scenarioId?: string
  status: RuntimeRunStatus
  resultSummary?: string
  error?: string
  cost: RuntimeRunCost
  startedAt: string
  completedAt?: string
  metadata?: Record<string, unknown>
}

/** @stable */
export interface RuntimeRunPersistenceAdapter {
  /**
   * Called once when `handle.persist()` runs. Implementations write `row` to
   * their durable store (D1, postgres, KV) and return whatever the consumer
   * wants the caller to see (often the storage-side row id). Errors thrown
   * here propagate out of `persist()` so the caller can decide whether to
   * retry or log-and-continue.
   */
  upsert(row: RuntimeRunRow): Promise<void> | void
}

/** @stable */
export interface RuntimeRunOptions {
  workspaceId: string
  sessionId?: string
  agentId?: string
  taskSpec: AgentTaskSpec
  scenarioId?: string
  /** Optional persistence adapter; if omitted, `persist()` is a no-op. */
  adapter?: RuntimeRunPersistenceAdapter
  /** Override the row id; default = `${taskSpec.id}:${random suffix}`. */
  id?: string
  /** Override the clock; default = `Date.now()`. Useful for deterministic tests. */
  now?: () => number
}

/** @stable */
export interface RuntimeRunHandle {
  /** Stable id assigned at start. */
  readonly id: string
  readonly workspaceId: string
  readonly sessionId: string | undefined
  readonly taskSpec: AgentTaskSpec
  readonly status: RuntimeRunStatus

  /**
   * Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
   * (text deltas, tool calls) silently so consumers can pipe the whole stream
   * through `handle.observe`. `llm_call` events update the ledger.
   */
  observe(event: RuntimeStreamEvent): void

  /** Snapshot of the current cost ledger. Safe to call at any time. */
  cost(): RuntimeRunCost

  /**
   * Transition to a terminal state. Idempotent for the same status; throws
   * `RuntimeRunStateError` for a different terminal status (state machines
   * don't time-travel).
   */
  complete(input: RuntimeRunCompleteInput): void

  /** Build the current row without writing it. Useful for tests + dry runs. */
  toRow(metadata?: Record<string, unknown>): RuntimeRunRow

  /**
   * Persist the current row via the configured adapter. Must be called after
   * `complete()`. Idempotent for the same terminal state (the adapter sees
   * the same row on retry).
   */
  persist(metadata?: Record<string, unknown>): Promise<void>
}

/**
 * @stable
 *
 * Construct a runtime-run handle. The returned handle is mutable across its
 * lifetime; consumers should not share it across requests.
 */
export function startRuntimeRun(options: RuntimeRunOptions): RuntimeRunHandle {
  if (!options.workspaceId) {
    throw new ValidationError('startRuntimeRun: workspaceId is required')
  }
  if (!options.taskSpec?.id) {
    throw new ValidationError('startRuntimeRun: taskSpec.id is required')
  }
  const now = options.now ?? Date.now
  const startedAtMs = now()
  const startedAt = new Date(startedAtMs).toISOString()
  const id = options.id ?? `${options.taskSpec.id}:${randomSuffix()}`

  let status: RuntimeRunStatus = 'running'
  let completedAtMs: number | undefined
  let resultSummary: string | undefined
  let error: string | undefined
  let completionMetadata: Record<string, unknown> | undefined

  const ledger: RuntimeRunCost = {
    tokensIn: 0,
    tokensOut: 0,
    costUsd: 0,
    wallMs: 0,
    llmCalls: 0,
  }

  const snapshotCost = (): RuntimeRunCost => ({
    tokensIn: ledger.tokensIn,
    tokensOut: ledger.tokensOut,
    costUsd: ledger.costUsd,
    wallMs: (completedAtMs ?? now()) - startedAtMs,
    llmCalls: ledger.llmCalls,
  })

  const buildRow = (extraMetadata?: Record<string, unknown>): RuntimeRunRow => ({
    id,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    agentId: options.agentId,
    domain: options.taskSpec.domain,
    taskId: options.taskSpec.id,
    scenarioId: options.scenarioId,
    status,
    resultSummary,
    error,
    cost: snapshotCost(),
    startedAt,
    completedAt: completedAtMs !== undefined ? new Date(completedAtMs).toISOString() : undefined,
    metadata: mergeMetadata(completionMetadata, extraMetadata),
  })

  return {
    id,
    workspaceId: options.workspaceId,
    sessionId: options.sessionId,
    taskSpec: options.taskSpec,
    get status() {
      return status
    },
    observe(event) {
      if (event.type !== 'llm_call') return
      ledger.llmCalls += 1
      if (typeof event.tokensIn === 'number' && Number.isFinite(event.tokensIn)) {
        ledger.tokensIn += event.tokensIn
      }
      if (typeof event.tokensOut === 'number' && Number.isFinite(event.tokensOut)) {
        ledger.tokensOut += event.tokensOut
      }
      if (typeof event.costUsd === 'number' && Number.isFinite(event.costUsd)) {
        ledger.costUsd += event.costUsd
      }
    },
    cost: snapshotCost,
    complete(input) {
      // `input.status` is typed `Exclude<RuntimeRunStatus, 'running'>`, but
      // a JS caller can still pass `'running'`. Validate defensively so the
      // state machine is enforced at runtime, not just at compile time.
      if ((input.status as RuntimeRunStatus) === 'running') {
        throw new ValidationError('complete() requires a terminal status, got "running"')
      }
      if (status !== 'running') {
        if (status === input.status) return
        throw new RuntimeRunStateError(
          `Cannot transition runtime run from "${status}" to "${input.status}"`,
        )
      }
      status = input.status
      completedAtMs = now()
      resultSummary = input.resultSummary
      error = input.error
      completionMetadata = input.metadata
      if (input.cost) {
        if (typeof input.cost.tokensIn === 'number' && Number.isFinite(input.cost.tokensIn)) {
          ledger.tokensIn = input.cost.tokensIn
        }
        if (typeof input.cost.tokensOut === 'number' && Number.isFinite(input.cost.tokensOut)) {
          ledger.tokensOut = input.cost.tokensOut
        }
        if (typeof input.cost.costUsd === 'number' && Number.isFinite(input.cost.costUsd)) {
          ledger.costUsd = input.cost.costUsd
        }
        if (typeof input.cost.llmCalls === 'number' && Number.isFinite(input.cost.llmCalls)) {
          ledger.llmCalls = input.cost.llmCalls
        }
      }
    },
    toRow(metadata) {
      return buildRow(metadata)
    },
    async persist(metadata) {
      if (status === 'running') {
        throw new RuntimeRunStateError('Cannot persist a runtime run before complete() is called')
      }
      if (!options.adapter) return
      await options.adapter.upsert(buildRow(metadata))
    },
  }
}

function mergeMetadata(
  base: Record<string, unknown> | undefined,
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!base && !extra) return undefined
  return { ...(base ?? {}), ...(extra ?? {}) }
}

function randomSuffix(): string {
  // Short, collision-resistant-enough for an in-memory id. Adapters that
  // require stronger guarantees pass `options.id` explicitly.
  return Math.random().toString(36).slice(2, 10)
}
