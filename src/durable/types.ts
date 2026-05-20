/**
 * Durable-run substrate: the typed contract for checkpointed agent runs that
 * survive worker crashes, deploy rolls, OOM, and transient transport errors.
 *
 * The model — directly inspired by Absurd (Postgres-backed) and Cloudflare
 * Workflows — splits a run into ordered, idempotent **steps**. Each step's
 * result is persisted before the next step runs. On resume, the runner reads
 * the prior steps from a `DurableRunStore` and fast-replays them (returning
 * cached values) until it reaches the first unfinished step, where execution
 * actually resumes.
 *
 * Three boundary disciplines:
 *
 *   1. Step results MUST be JSON-serializable. No closures, no class
 *      instances, no live streams. The store treats results as opaque JSON.
 *
 *   2. Step intents MUST be stable across replays. The runner derives a
 *      stable step id from (runId, stepIndex, intent). Mismatched intent at
 *      the same index = `DurableRunDivergenceError`.
 *
 *   3. Non-determinism (now / uuid / random) MUST flow through the
 *      `DurableContext` helpers — `ctx.now()`, `ctx.uuid()` — so the values
 *      are checkpointed and identical on replay. Bare `Date.now()` /
 *      `crypto.randomUUID()` inside a task fn breaks replay equality.
 */

import type { AgentTaskSpec } from '../types'

/** Caller-facing kinds. The runner uses these for telemetry + querying. */
export type StepKind =
  /** Logical step that ran user code (the default for ctx.step). */
  | 'logic'
  /** A wrapped LLM call. */
  | 'llm'
  /** A wrapped tool call. */
  | 'tool'
  /** A wrapped readiness probe. */
  | 'readiness'
  /** A deterministic clock or uuid read. */
  | 'deterministic'
  /** A suspend-for-event boundary. */
  | 'event'

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed'

export interface StepError {
  message: string
  code?: string
  /** Optional stack — stored for diagnostics, NEVER replayed as an exception. */
  stack?: string
}

export interface StepRecord<T = unknown> {
  runId: string
  /** Monotonic 0-based index. Position is the load-bearing identifier — the
   *  same intent string at different positions is a different step. */
  stepIndex: number
  /** Caller-supplied label; intended for human reading + log correlation. */
  intent: string
  kind: StepKind
  /** sha256 of the canonical input fingerprint at begin-time. Used to detect
   *  divergence (caller changed inputs across replays). Empty for steps where
   *  the input cannot be canonicalized (e.g. ctx.now()). */
  inputHash: string
  status: StepStatus
  /** Re-entry count. Increments each time the step begins. */
  attempts: number
  /** JSON-serializable result. Present when status === 'completed'. */
  result?: T
  error?: StepError
  startedAt?: string
  completedAt?: string
}

export interface EventRecord {
  runId: string
  key: string
  payload: unknown
  emittedAt: string
}

export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'suspended'

export interface RunOutcome {
  pass?: boolean
  score?: number
  notes?: string
  /** Free-form bag of run-level metrics — surfaced in OTLP / TraceStore. */
  metadata?: Record<string, unknown>
}

export interface DurableRunManifest {
  /** Stable per-product id (e.g. 'legal-agent', 'creative-agent'). */
  projectId: string
  /** Optional scenario / persona / session id — surfaced in telemetry. */
  scenarioId?: string
  task: AgentTaskSpec
  /** Input payload. Hashed into the run identity so two runs with the same
   *  runId but different inputs raise DurableRunInputMismatchError. */
  input: Record<string, unknown>
  /** Free-form tags surfaced into RunRecord / OTLP. */
  tags?: Record<string, string>
}

export interface RunRecord {
  runId: string
  manifestHash: string
  projectId: string
  scenarioId?: string
  status: RunStatus
  createdAt: string
  updatedAt: string
  completedAt?: string
  /** Stable per-worker id holding the lease. */
  leaseHolderId?: string
  leaseExpiresAt?: string
  outcome?: RunOutcome
  stepCount: number
}

/**
 * The durable-run substrate. Implementations: in-memory (dev), file-system
 * (eval harness), D1 (Cloudflare prod). All stores share this exact contract
 * — swap by changing one factory call.
 *
 * Concurrency model: at most one worker holds a run's lease at a time. Lease
 * renewal happens on a heartbeat; on lease expiry, another worker can
 * `startOrResume` and pick up. Steps committed by the prior worker survive.
 */
export interface DurableRunStore {
  /**
   * Begin or resume a run. Returns the canonical RunRecord, all previously
   * completed steps (in order), and the lease deadline.
   *
   * If the run did not exist, creates it with status='running'. If it existed
   * with a different manifest hash, throws DurableRunInputMismatchError.
   * If it existed with a live lease held by a different worker, throws
   * DurableRunLeaseHeldError (caller can retry or back off).
   */
  startOrResume(input: {
    runId: string
    manifest: DurableRunManifest
    workerId: string
    leaseMs?: number
  }): Promise<{
    run: RunRecord
    completedSteps: ReadonlyArray<StepRecord>
    leaseExpiresAt: string
  }>

  /** Renew the lease. Returns false if another worker now holds it. */
  renewLease(input: {
    runId: string
    workerId: string
    leaseMs?: number
  }): Promise<{ ok: boolean; leaseExpiresAt?: string }>

  /** Load a step by position. Returns undefined if not yet begun. */
  loadStep(runId: string, stepIndex: number): Promise<StepRecord | undefined>

  /** Record step start (intent + input hash + kind). Bumps attempt count. */
  beginStep(input: {
    runId: string
    stepIndex: number
    intent: string
    kind: StepKind
    inputHash: string
  }): Promise<StepRecord>

  /** Mark step completed with a JSON-serializable result. */
  completeStep(input: {
    runId: string
    stepIndex: number
    result: unknown
  }): Promise<StepRecord>

  /** Mark step failed with a captured error. */
  failStep(input: {
    runId: string
    stepIndex: number
    error: StepError
  }): Promise<StepRecord>

  /** End the run; releases lease. */
  endRun(input: {
    runId: string
    workerId: string
    status: 'completed' | 'failed'
    outcome?: RunOutcome
  }): Promise<RunRecord>

  /**
   * Emit an event. First emit wins; subsequent emits return the existing
   * record under `existing` and accepted=false. Caller can treat that as
   * idempotency-by-design — never double-fire a downstream side effect.
   */
  emitEvent(input: {
    runId: string
    key: string
    payload: unknown
  }): Promise<{ accepted: boolean; record: EventRecord }>

  /** Load the cached event payload if it has been emitted. */
  loadEvent(runId: string, key: string): Promise<EventRecord | undefined>

  /** Cleanup hook for in-memory / fs stores; no-op for D1. Idempotent. */
  close(): Promise<void>
}

// ── Public error contract ────────────────────────────────────────────────

/** Base class for durable-run errors. */
export class DurableRunError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'lease_held'
      | 'manifest_mismatch'
      | 'step_divergence'
      | 'step_input_mismatch'
      | 'await_event_timeout'
      | 'event_emit_race',
  ) {
    super(message)
    this.name = this.constructor.name
  }
}

/** Thrown when another worker holds the lease for this runId. */
export class DurableRunLeaseHeldError extends DurableRunError {
  constructor(message: string) {
    super(message, 'lease_held')
  }
}

/** Thrown when the manifest hash differs from a prior run with the same id. */
export class DurableRunInputMismatchError extends DurableRunError {
  constructor(message: string) {
    super(message, 'manifest_mismatch')
  }
}

/** Thrown when the same stepIndex re-runs with a different intent string. */
export class DurableRunDivergenceError extends DurableRunError {
  constructor(message: string) {
    super(message, 'step_divergence')
  }
}

/** Thrown when `awaitEvent` times out. */
export class DurableAwaitEventTimeoutError extends DurableRunError {
  constructor(message: string) {
    super(message, 'await_event_timeout')
  }
}
