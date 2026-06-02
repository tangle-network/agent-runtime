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

import type { DefaultVerdict } from '@tangle-network/agent-eval'
import type {
  AgentProfile,
  CreateSandboxOptions,
  SandboxEvent,
  SandboxInstance,
} from '@tangle-network/sandbox'
import type { RuntimeRunHandle } from '../runtime-run'

// DefaultVerdict is a substrate primitive — it lives in @tangle-network/agent-eval.
// agent-runtime re-exports it here so existing consumers keep working without
// changing their import paths. The runtime-shaped `Validator<Output, Verdict>`
// interface below stays in agent-runtime because it's coupled to runtime-only
// concerns (ValidationCtx with iteration + signal + traceEmitter).
export type { DefaultVerdict }

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

/** LLM token usage. Structurally matches agent-eval's `RunTokenUsage` /
 *  `CampaignTokenUsage` ({ input, output }) so a loop result maps straight
 *  onto `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch — without
 *  which the backend-integrity guard reads the run as a stub. */
export interface LoopTokenUsage {
  input: number
  output: number
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
  /** Summed LLM token usage across every `llm_call` event in this iteration. */
  tokenUsage: LoopTokenUsage
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
  /**
   * Optional: describe the move `plan()` just produced, for trace emission.
   * The kernel calls this immediately after `plan()` and emits the result in
   * the `loop.plan` event so a topology viewer can render the agent's chosen
   * move + rationale (not just the inferred fan-width). Drivers whose topology
   * is a pure function of count (refine/fanout-vote) omit it — the kernel
   * infers `moveKind` from the planned-task count. Agent-authored drivers
   * (`createDynamicDriver`) return their chosen move's kind + rationale.
   */
  describePlan?(): LoopPlanDescription | undefined
}

/** @experimental Driver-supplied description of the just-planned move. */
export interface LoopPlanDescription {
  /** Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`. */
  kind: string
  /** Why the driver chose this move (the agent's rationale), when available. */
  rationale?: string
  /**
   * Iteration index this round branches FROM, when the driver declares it.
   * Overrides the kernel's inferred branch point — lets a planner that
   * branches off a specific (non-winner) iteration emit faithful edge lineage.
   * Omit to keep the inferred (best-valid / latest) branch point.
   */
  parentIndex?: number
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
  /** Sum of every iteration's token usage. Forward to
   *  `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch so the
   *  integrity guard sees real LLM activity. */
  tokenUsage: LoopTokenUsage
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
  | { kind: 'loop.plan'; runId: string; timestamp: number; payload: LoopPlanPayload }
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
  | {
      kind: 'loop.teardown.failed'
      runId: string
      timestamp: number
      payload: LoopTeardownFailedPayload
    }

/** @experimental */
export interface LoopStartedPayload {
  driver: string
  agentRunNames: string[]
  maxIterations: number
  maxConcurrency: number
}

/**
 * Emitted once per `plan()` round, immediately after the driver plans. Carries
 * the topology move so a viewer renders WHAT the agent decided + WHY, not just
 * the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
 * provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).
 *
 * @experimental
 */
export interface LoopPlanPayload {
  /** 0-based plan round (one per `plan()` call). */
  roundIndex: number
  /** Tasks the driver issued this round. */
  plannedCount: number
  /** Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc. */
  moveKind: string
  /** Driver rationale for the move, when available. */
  rationale?: string
  /**
   * Iteration index this round branched FROM (the edge source). `undefined`
   * for round 0 (root). Kernel-inferred branch point — the best-valid (else
   * latest) iteration so far — unless a driver later declares it explicitly.
   */
  parentIndex?: number
  /** Iteration indices this round dispatched (the edge targets). */
  childIndices: number[]
}

/** @experimental */
export interface LoopIterationStartedPayload {
  iterationIndex: number
  agentRunName: string
  taskHash: string
  /** Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
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
  /** Plan round this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
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
  /** Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
   *  branch span. Omitted when no `llm_call` events carried token counts. */
  tokenUsage?: LoopTokenUsage
  /** Plan round this iteration belongs to. */
  groupId?: number
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number
  /** Truncated string preview of the parsed output — for a viewer's drawer.
   *  Bounded to ~280 chars; never the full payload. */
  outputPreview?: string
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

/** Emitted when a box's `delete()` throws or times out during teardown — the
 *  loop swallows the failure (platform reaps on expiry) but surfaces it here so
 *  a real leak (e.g. mid-loop auth expiry) is observable. @experimental */
export interface LoopTeardownFailedPayload {
  sandboxId?: string
  /** `'timeout'` or the delete error message. */
  reason: string
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
