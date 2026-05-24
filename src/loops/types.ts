/**
 * @experimental
 *
 * Driven-loop substrate — type surface.
 *
 * The loop kernel orchestrates around the sandbox SDK; it does not invent
 * its own notion of "what an agent is". Each iteration is a sandbox-SDK
 * `streamPrompt` call against an `AgentProfile`. The kernel owns iteration
 * accounting, concurrency, abort propagation, cost aggregation, and trace
 * emission; the driver owns topology (plan + decide); the validator owns
 * output scoring; the output adapter owns event-stream → typed-output decode.
 */

import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import type { RuntimeRunHandle } from '../runtime-run'

/** @experimental */
export interface DefaultVerdict {
  /** Whether the output meets the validator's pass criteria. */
  valid: boolean
  /** Aggregate score in [0, 1]. Drivers use this for winner selection. */
  score: number
  /** Per-dimension scores. Free-form; weighted into `score` by the validator. */
  scores?: Record<string, number>
  /** Human-readable rationale; surfaces in trace + final-result `winner.verdict`. */
  notes?: string
}

/** @experimental */
export interface ValidationCtx {
  /** Iteration index this output came from (0-based). */
  iteration: number
  /** Cooperative cancellation channel. */
  signal: AbortSignal
  /**
   * Optional trace emitter. When set, validator implementations that make
   * LLM calls (e.g. LLM reviewer in coderProfile) emit spans into it.
   * The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.
   */
  traceEmitter?: LoopTraceEmitter
}

/** @experimental */
export interface Validator<Output, Verdict = DefaultVerdict> {
  validate(output: Output, ctx: ValidationCtx): Promise<Verdict>
}

/**
 * Sandbox-SDK-shaped agent specification.
 *
 * The kernel uses `profile` to instantiate a sandbox per iteration, formats
 * `task` into a prompt via `taskToPrompt`, and merges `sandboxOverrides` into
 * the `CreateSandboxOptions` it passes to `client.create`. Heterogeneous
 * fanout supplies multiple `AgentRunSpec`s and the kernel round-robins
 * through them when the driver plans N tasks.
 *
 * @experimental
 */
export interface AgentRunSpec<Task> {
  /** Sandbox SDK profile — what kind of agent runs the task. */
  profile: AgentProfile
  /** Task → prompt formatter. Pure and deterministic. */
  taskToPrompt: (task: Task) => string
  /**
   * Per-spec stable name. Surfaced in trace events and the default winner
   * selector tiebreak. Falls back to `profile.name ?? 'agent'`.
   */
  name?: string
  /**
   * Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
   * the kernel's defaults. `backend.profile` is set to `profile` by the
   * kernel and cannot be overridden here — use `profile` itself for that.
   */
  sandboxOverrides?: Partial<Omit<CreateSandboxOptions, 'backend'>> & {
    backend?: Omit<NonNullable<CreateSandboxOptions['backend']>, 'profile'>
  }
}

/**
 * Stream of `SandboxEvent`s → typed `Output`.
 *
 * Adapters are pure functions over the already-collected event array; they
 * do not receive the live AsyncIterable so they can be replayed against
 * persisted streams during tests / replays.
 *
 * @experimental
 */
export interface OutputAdapter<Output> {
  parse(events: SandboxEvent[]): Output
}

/** @experimental */
export interface Iteration<Task, Output> {
  /** 0-based iteration index assigned by the kernel. */
  index: number
  task: Task
  /** Stable name of the `AgentRunSpec` that produced this iteration. */
  agentRunName: string
  output?: Output
  verdict?: DefaultVerdict
  error?: Error
  /** Raw sandbox event stream collected for this iteration. */
  events: SandboxEvent[]
  startedAt: number
  endedAt: number
  costUsd: number
}

/** @experimental */
export interface Driver<Task, Output, Decision> {
  /**
   * Stable identifier surfaced in trace events. Default `'driver'`.
   */
  readonly name?: string
  /**
   * Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
   * `[]` → no more work this round (kernel proceeds to `decide`).
   */
  plan(task: Task, history: ReadonlyArray<Iteration<Task, Output>>): Promise<Task[]>
  /**
   * Inspect history and return the next state. The kernel terminates the
   * loop when `decide` returns a value listed in `isTerminalDecision`
   * (`'stop' | 'pick-winner' | 'fail' | 'done'`), when `maxIterations`
   * is hit, or when the abort signal fires.
   */
  decide(history: ReadonlyArray<Iteration<Task, Output>>): Decision | Promise<Decision>
}

/** @experimental */
export interface LoopWinner<Task, Output> {
  task: Task
  output: Output
  verdict?: DefaultVerdict
  iterationIndex: number
  agentRunName: string
}

/** @experimental */
export interface LoopResult<Task, Output, Decision> {
  decision: Decision
  iterations: Iteration<Task, Output>[]
  winner?: LoopWinner<Task, Output>
  durationMs: number
  /** Sum of every iteration's `costUsd`. */
  costUsd: number
}

/**
 * Minimal sandbox client surface the kernel calls. Satisfied structurally by
 * `new Sandbox({ apiKey, baseUrl })` — declared as a structural type so
 * tests can pass a stub without instantiating the SDK.
 *
 * `describePlacement` is optional. When present, the kernel calls it after
 * each `create()` so the `loop.iteration.dispatch` trace event carries fleet
 * coordinates (fleetId + machineId) instead of just the sibling sandboxId.
 * Fleet-aware adapters set this; the raw `Sandbox` SDK class does not, and
 * the kernel falls back to `{ placement: 'sibling', sandboxId: box.id }`.
 *
 * @experimental
 */
export interface LoopSandboxClient {
  create(options?: CreateSandboxOptions): Promise<SandboxInstance>
  describePlacement?(box: SandboxInstance): LoopSandboxPlacement
}

/** @experimental */
export interface LoopSandboxPlacement {
  kind: 'sibling' | 'fleet'
  sandboxId?: string
  fleetId?: string
  machineId?: string
}

/** @experimental */
export interface LoopTraceEmitter {
  emit(event: LoopTraceEvent): void | Promise<void>
}

/** @experimental */
export type LoopTraceEvent =
  | { kind: 'loop.started'; runId: string; timestamp: number; payload: LoopStartedPayload }
  | {
      kind: 'loop.iteration.started'
      runId: string
      timestamp: number
      payload: LoopIterationStartedPayload
    }
  | {
      kind: 'loop.iteration.dispatch'
      runId: string
      timestamp: number
      payload: LoopIterationDispatchPayload
    }
  | {
      kind: 'loop.iteration.ended'
      runId: string
      timestamp: number
      payload: LoopIterationEndedPayload
    }
  | { kind: 'loop.decision'; runId: string; timestamp: number; payload: LoopDecisionPayload }
  | { kind: 'loop.ended'; runId: string; timestamp: number; payload: LoopEndedPayload }

/** @experimental */
export interface LoopStartedPayload {
  driver: string
  agentRunNames: string[]
  maxIterations: number
  maxConcurrency: number
}

/** @experimental */
export interface LoopIterationStartedPayload {
  iterationIndex: number
  agentRunName: string
  taskHash: string
}

/**
 * Where the iteration's worker was placed. `sibling` = a fresh sandbox the
 * kernel created via `sandboxClient.create`. `fleet` = an existing machine in
 * a shared-workspace fleet — workers see the caller's filesystem and any diff
 * they write lands on it directly.
 *
 * @experimental
 */
export interface LoopIterationDispatchPayload {
  iterationIndex: number
  agentRunName: string
  placement: 'sibling' | 'fleet'
  /** Set on every placement. Lets analyst loops correlate per-iteration logs. */
  sandboxId?: string
  /** Set only when `placement === 'fleet'`. */
  fleetId?: string
  /** Set only when `placement === 'fleet'`. */
  machineId?: string
}

/** @experimental */
export interface LoopIterationEndedPayload {
  iterationIndex: number
  agentRunName: string
  outputHash?: string
  verdict?: DefaultVerdict
  error?: string
  costUsd: number
  durationMs: number
}

/** @experimental */
export interface LoopDecisionPayload {
  decision: string
  historyLength: number
}

/** @experimental */
export interface LoopEndedPayload {
  winnerIterationIndex?: number
  totalCostUsd: number
  durationMs: number
  iterations: number
}

/** @experimental */
export interface ExecCtx {
  /** Sandbox SDK client — the kernel calls `.create()` per iteration. */
  sandboxClient: LoopSandboxClient
  /** Optional trace emitter. When set, the kernel emits `loop.*` events. */
  traceEmitter?: LoopTraceEmitter
  /**
   * Optional production-run handle. When set, every synthesized `llm_call`
   * the kernel infers from a sandbox event stream is forwarded via
   * `runHandle.observe` so per-run cost aggregates pick up loop spend.
   */
  runHandle?: RuntimeRunHandle
  /** Cooperative cancellation signal. */
  signal?: AbortSignal
  /**
   * Trace id for OTEL correlation. When set alongside `traceEmitter`, the
   * exporter uses this as the parent trace for all emitted spans. Typically
   * inherited from TRACE_ID env var in MCP subprocess mode.
   */
  traceId?: string
  /**
   * Parent span id for OTEL correlation. Loop events become children of
   * this span. Typically inherited from PARENT_SPAN_ID env var.
   */
  parentSpanId?: string
}
