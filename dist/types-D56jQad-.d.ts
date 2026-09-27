import { l as RuntimeHooks } from "./runtime-hooks-Bj6wJHlH.js";
import { AgentExactRunControlRef, AgentInteractiveSession, AgentInteractiveSessionPromptAcknowledgement, AgentInteractiveSessionPromptCommand, AgentInteractiveSessionRef, AgentInteractiveSessionStart, AgentInteractiveSessionStatus, AgentNativeContextContinuationOptions, AgentNativeContextContinuationResult, AgentProfile, AgentSessionStatus, AgentTurnResult, ChildTaskEvent, ContextTransferRequest, HarnessType, InputPart, InteractionAcknowledgement, InteractionRequest, InteractionResponseCommand, NativeContextBoundaryProof, NativeContextContinuationRequest, NativeContextContinuationTurn, RequestedInteractions, RuntimeEventEnvelope, Sha256Digest, StreamEvent, WorkspaceCheckpointRef, WorkspaceCheckpointRequest } from "@tangle-network/agent-interface";
import { AgentEvalError, AgentEvalError as AgentEvalError$1, AgentEvalErrorCode, ConfigError, ControlBudget, ControlDecision, ControlEvalResult, ControlRunResult, ControlStep, DataAcquisitionPlan, DefaultVerdict, DefaultVerdict as DefaultVerdict$1, JudgeError, KnowledgeReadinessReport, KnowledgeRequirement, NotFoundError, RunRecord, ToolSpan, TraceAnalysisStore, TraceStore, UserQuestion, ValidationError } from "@tangle-network/agent-eval";
import { AgentRunOutcome } from "@tangle-network/sandbox/runtime";
import { BackendType, CreateRequestOptions, CreateSandboxOptions, PromptOptions, SandboxEvent, SandboxInstance } from "@tangle-network/sandbox";
import { AgentEnvironment, AgentEnvironmentCapabilities, AgentEnvironmentProvider, AgentTurnInput, AgentTurnResult as AgentTurnResult$1, CreateAgentEnvironmentInput } from "@tangle-network/agent-interface/environment-provider";
//#region src/types.d.ts
/** @stable */
interface AgentTaskSpec {
  id: string;
  intent: string;
  /** Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc. */
  domain?: string;
  inputs?: Record<string, unknown>;
  requiredKnowledge?: KnowledgeRequirement[];
  budget?: Partial<ControlBudget>;
  metadata?: Record<string, unknown>;
}
/** @stable */
interface AgentKnowledgeProvider {
  buildReadiness?(task: AgentTaskSpec): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport;
  answerQuestions?(questions: UserQuestion[], task: AgentTaskSpec): Promise<Record<string, string>> | Record<string, string>;
  executeAcquisitionPlans?(plans: DataAcquisitionPlan[], task: AgentTaskSpec): Promise<string[]> | string[];
  refreshReadiness?(input: {
    task: AgentTaskSpec;
    previous: KnowledgeReadinessReport;
    userAnswers: Record<string, string>;
    acquiredEvidenceIds: string[];
  }): Promise<KnowledgeReadinessReport> | KnowledgeReadinessReport;
}
/** @stable */
interface AgentTaskContext<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec;
  knowledge: KnowledgeReadinessReport;
  state: TState;
  evals: TEval[];
  history: ControlStep<TState, TAction, TActionResult, TEval>[];
  budget: ControlBudget;
  stepIndex: number;
  wallMs: number;
  spentCostUsd: number;
  remainingCostUsd?: number;
  abortSignal: AbortSignal;
}
/** @stable */
interface AgentAdapter<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  observe(ctx: {
    task: AgentTaskSpec;
    knowledge: KnowledgeReadinessReport;
    history: ControlStep<TState, TAction, TActionResult, TEval>[];
    abortSignal: AbortSignal;
  }): Promise<TState> | TState;
  validate(ctx: {
    task: AgentTaskSpec;
    knowledge: KnowledgeReadinessReport;
    state: TState;
    history: ControlStep<TState, TAction, TActionResult, TEval>[];
    abortSignal: AbortSignal;
  }): Promise<TEval[]> | TEval[];
  decide(ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<ControlDecision<TAction>> | ControlDecision<TAction>;
  act(action: TAction, ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<TActionResult> | TActionResult;
  shouldStop?(ctx: AgentTaskContext<TState, TAction, TActionResult, TEval>): Promise<{
    stop: boolean;
    pass: boolean;
    reason: string;
    score?: number;
  }> | {
    stop: boolean;
    pass: boolean;
    reason: string;
    score?: number;
  };
  onKnowledgeBlocked?(ctx: {
    task: AgentTaskSpec;
    knowledge: KnowledgeReadinessReport;
    questions: UserQuestion[];
    acquisitionPlans: DataAcquisitionPlan[];
  }): Promise<ControlDecision<TAction>> | ControlDecision<TAction>;
  getActionCostUsd?(ctx: {
    action: TAction;
    result: TActionResult;
    task: AgentTaskSpec;
    state: TState;
    evals: TEval[];
    history: ControlStep<TState, TAction, TActionResult, TEval>[];
  }): number | undefined;
  projectRunRecords?(result: ControlRunResult<TState, TAction, TActionResult, TEval>, task: AgentTaskSpec): RunRecord[];
}
/** @stable */
type AgentTaskStatus = 'completed' | 'blocked' | 'failed' | 'aborted';
/** @stable */
type AgentRuntimeEvent<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> = {
  type: 'task_start';
  task: AgentTaskSpec;
} | {
  type: 'readiness_start';
  task: AgentTaskSpec;
} | {
  type: 'readiness_end';
  task: AgentTaskSpec;
  knowledge: KnowledgeReadinessReport;
} | {
  type: 'questions_start';
  task: AgentTaskSpec;
  questions: UserQuestion[];
} | {
  type: 'questions_end';
  task: AgentTaskSpec;
  questions: UserQuestion[];
  userAnswers: Record<string, string>;
} | {
  type: 'acquisition_start';
  task: AgentTaskSpec;
  acquisitionPlans: DataAcquisitionPlan[];
} | {
  type: 'acquisition_end';
  task: AgentTaskSpec;
  acquisitionPlans: DataAcquisitionPlan[];
  acquiredEvidenceIds: string[];
} | {
  type: 'control_start';
  task: AgentTaskSpec;
  knowledge: KnowledgeReadinessReport;
} | {
  type: 'control_step';
  task: AgentTaskSpec;
  step: ControlStep<TState, TAction, TActionResult, TEval>;
} | {
  type: 'control_end';
  task: AgentTaskSpec;
  control: ControlRunResult<TState, TAction, TActionResult, TEval>;
} | {
  type: 'task_end';
  task: AgentTaskSpec;
  status: AgentTaskStatus;
  reason: string;
};
/** @stable */
type AgentRuntimeEventSink<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> = (event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>) => Promise<void> | void;
/**
 *
 * Typed transport / backend failure detail. Carried on `backend_error` and
 * `final` events when the backend's stream throws or the upstream HTTP call
 * returns a non-success status. Lets consumers (a) distinguish "stream
 * completed with no text" from "stream never reached the model" and
 * (b) reconstruct the precise upstream signal (status + truncated body) when
 * building a `RunRecord.error`.
 *
 * `body` is truncated to 2 KiB by the backend so an HTML error page from a
 * misconfigured proxy never bloats event payloads or logs. Consumers needing
 * the full body should inspect the underlying `BackendTransportError.body`
 * via a custom `mapEvent` or backend wrapper.
 *
 * @stable
 */
interface BackendErrorDetail {
  /**
   * `'transport'` — upstream HTTP / network failure with optional status code.
   * `'backend'` — the backend's `stream()` generator threw for a non-transport
   * reason (e.g. a custom adapter error, sandbox crash).
   */
  kind: 'transport' | 'backend';
  message: string;
  /** Upstream HTTP status when known. `0` for connection / abort errors. */
  status?: number;
  /** Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed. */
  body?: string;
}
/**
 *
 * OpenAI Chat Completions tool descriptor. The shape mirrors the
 * `/v1/chat/completions` `tools[]` parameter so caller-owned compatible
 * transports can pass tool definitions without translation. A router can
 * proxy this shape to Anthropic
 * (translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
 * that the eval surface targets.
 *
 * Callers that build their tool list from MCP servers should run a one-shot
 * MCP `tools/list` at config time and project the result into this shape. The
 * runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
 * keeping the backend transport thin lets domain repos own MCP plumbing.
 *
 * @stable
 */
interface OpenAIChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}
/**
 *
 * `tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
 * spec: `'auto'` (default — model decides), `'none'` (disable tool calling
 * for this turn), `'required'` (force a tool call), or a specific function
 * pin `{ type: 'function', function: { name } }`.
 *
 * @stable
 */
type OpenAIChatToolChoice = 'auto' | 'none' | 'required' | {
  type: 'function';
  function: {
    name: string;
  };
};
/**
 *
 * `response_format` parameter for OpenAI-compatible chat endpoints. Use
 * `json_object` when the caller needs syntactically valid JSON, or
 * `json_schema` when the upstream provider supports schema-constrained JSON.
 *
 * @stable
 */
type OpenAIChatResponseFormat = {
  type: 'text';
} | {
  type: 'json_object';
} | {
  type: 'json_schema';
  json_schema: Record<string, unknown>;
};
/** Agent Interface events that do not belong to Runtime's task vocabulary. */
type RuntimeCanonicalStreamEvent = StreamEvent & {
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  timestamp?: string;
};
/** @stable */
type RuntimeStreamEvent = RuntimeCanonicalStreamEvent | {
  type: 'task_start';
  task: AgentTaskSpec;
  timestamp: string;
} | {
  type: 'readiness_start';
  task: AgentTaskSpec;
  timestamp: string;
} | {
  type: 'readiness_end';
  task: AgentTaskSpec;
  knowledge: KnowledgeReadinessReport;
  decision: KnowledgeReadinessDecision;
  timestamp: string;
} | {
  type: 'questions_start';
  task: AgentTaskSpec;
  questions: UserQuestion[];
  timestamp: string;
} | {
  type: 'questions_end';
  task: AgentTaskSpec;
  questions: UserQuestion[];
  userAnswers: Record<string, string>;
  timestamp: string;
} | {
  type: 'acquisition_start';
  task: AgentTaskSpec;
  acquisitionPlans: DataAcquisitionPlan[];
  timestamp: string;
} | {
  type: 'acquisition_end';
  task: AgentTaskSpec;
  acquisitionPlans: DataAcquisitionPlan[];
  acquiredEvidenceIds: string[];
  timestamp: string;
} | {
  type: 'session_created';
  task: AgentTaskSpec;
  session: RuntimeSession;
  timestamp: string;
} | {
  type: 'session_resumed';
  task: AgentTaskSpec;
  session: RuntimeSession;
  timestamp: string;
} | {
  type: 'backend_start';
  task: AgentTaskSpec;
  session: RuntimeSession;
  backend: string;
  /** Canonical execution identity and materialization evidence for this turn, when Runtime
   *  owns the selected executor. Generic metadata keeps the event vocabulary open while the
   *  values use Runtime's existing identity/materialization receipt shapes. */
  metadata?: Record<string, unknown>;
  timestamp: string;
} | {
  type: 'text_delta';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  text: string;
  timestamp?: string;
} | {
  type: 'reasoning_delta';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  text: string;
  timestamp?: string;
} | {
  type: 'tool_call';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  timestamp?: string;
} | {
  type: 'tool_result';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  toolName: string;
  toolCallId?: string;
  result?: unknown;
  timestamp?: string;
} | {
  type: 'llm_call';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  model: string;
  /** The tool names offered to the model this turn, when the caller knows its own offered
   *  set (e.g. the in-process tool loop's `ToolSpec[]`). Exported as the OTel GenAI
   *  `gen_ai.tool.definitions` attribute — a contract gate reads this to tell "the model was
   *  offered no tools" from "the offered set was never recorded", the same distinction
   *  Claude Code's own `init` record gives a stream-json capture. Absent when the producer
   *  does not know its own offered set (e.g. a sandboxed CLI harness, whose tool list is the
   *  harness's own and belongs to its own transcript reader instead). */
  tools?: readonly string[];
  tokensIn?: number;
  tokensOut?: number;
  /** False when the numeric token subtotal is incomplete or absent. */
  tokensKnown?: false;
  /** Why `tokensKnown` is false when a harness receipt was present but unreadable. */
  tokensUnknownReason?: string;
  costUsd?: number;
  /** False when `costUsd` is only an observed floor, estimate, or absent. */
  usdKnown?: false;
  /** Separately-labelled local/catalog estimate; never billed spend. */
  estimatedCostUsd?: number;
  /** Provider-reported prompt-cache fields; absent fields remain unknown. */
  promptCache?: Readonly<Record<string, number | string>>;
  latencyMs?: number;
  finishReason?: string;
  timestamp?: string;
} | {
  type: 'artifact';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  artifactId: string;
  name?: string;
  mimeType?: string;
  uri?: string;
  content?: string;
  metadata?: Record<string, unknown>;
  timestamp?: string;
} | {
  type: 'proposal_created';
  task?: AgentTaskSpec;
  session?: RuntimeSession;
  proposalId: string;
  title: string;
  status?: 'pending' | 'approved' | 'rejected';
  content?: string;
  timestamp?: string;
} | {
  type: 'backend_error';
  task: AgentTaskSpec;
  session?: RuntimeSession;
  backend: string;
  message: string;
  recoverable: boolean;
  /**
   * Typed transport diagnostic. Present when the upstream returned a
   * non-success HTTP status or every retry attempt threw. Consumers MUST
   * surface this onto their `RunRecord.error` — silently treating a
   * `backend_error` as "no output" hides credit exhaustion, auth failure,
   * and upstream outages from operators.
   *  - `kind: 'transport'` — HTTP / network failure with optional `status`
   *    + truncated response `body`.
   *  - `kind: 'backend'` — the backend's `stream()` generator threw for a
   *    reason that isn't a recognized transport failure.
   */
  error?: BackendErrorDetail;
  timestamp: string;
} | {
  type: 'backend_end';
  task: AgentTaskSpec;
  session: RuntimeSession;
  backend: string;
  timestamp: string;
} | {
  type: 'task_end';
  task: AgentTaskSpec;
  status: AgentTaskStatus;
  reason: string;
  timestamp: string;
} | {
  type: 'final';
  task: AgentTaskSpec;
  session?: RuntimeSession;
  status: AgentTaskStatus;
  reason: string;
  text?: string;
  metadata?: Record<string, unknown>;
  /**
   * Typed terminal-error diagnostic. Mirrors the `backend_error.error`
   * shape so a consumer that only listens for `final` still receives a
   * loud, structured failure when the backend never produced output. Only
   * set when `status !== 'completed'`. Consumers building a `RunRecord`
   * MUST map this to `RunRecord.error` rather than recording silent
   * `error: null` with empty `finalText`.
   */
  error?: BackendErrorDetail;
  timestamp: string;
};
/** @stable */
interface RuntimeSession {
  id: string;
  backend: string;
  status: 'active' | 'completed' | 'failed' | 'aborted';
  resumeToken?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}
/** @stable */
interface RuntimeSessionStore {
  get(sessionId: string): Promise<RuntimeSession | undefined> | RuntimeSession | undefined;
  put(session: RuntimeSession): Promise<void> | void;
  appendEvent?(sessionId: string, event: RuntimeStreamEvent): Promise<void> | void;
  listEvents?(sessionId: string): Promise<RuntimeStreamEvent[]> | RuntimeStreamEvent[];
}
/** @stable */
interface AgentBackendInput {
  task: AgentTaskSpec;
  message?: string;
  messages?: Array<{
    role: string;
    content: string;
  }>;
  parts?: InputPart[];
  interactions?: RequestedInteractions;
  providerOptions?: Record<string, unknown>;
  inputs?: Record<string, unknown>;
}
/** @stable */
interface AgentBackendContext {
  task: AgentTaskSpec;
  knowledge: KnowledgeReadinessReport;
  session: RuntimeSession;
  signal?: AbortSignal;
  /**
   * Conversation/run identifier when this call is part of a multi-agent run.
   * Backends should stamp it into any trace/log emission so cross-participant
   * events correlate. Absent when the call is a stand-alone `runAgentTask`.
   */
  runId?: string;
  /**
   * Deterministic turn id for this single call. Stable across retries of the
   * same logical turn so a caching gateway / idempotent backend can dedupe.
   */
  turnId?: string;
  /**
   * If this call is itself nested inside a higher-order conversation
   * (recursion via `createConversationBackend`), the enclosing turn's id.
   * Used for trace stitching across nested orchestration.
   */
  parentTurnId?: string;
  /**
   * Headers to forward verbatim to any outbound HTTP the backend issues:
   * `X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
   * run/turn correlation. Backends that issue HTTP MUST merge these into
   * the outbound request; backends that don't issue HTTP may ignore them.
   */
  propagatedHeaders?: Readonly<Record<string, string>>;
}
/** @stable */
interface AgentExecutionBackend<TInput extends AgentBackendInput = AgentBackendInput> {
  kind: string;
  start?(input: TInput, context: Omit<AgentBackendContext, 'session'> & {
    requestedSessionId?: string;
  }): Promise<RuntimeSession> | RuntimeSession;
  resume?(session: RuntimeSession, input: TInput, context: Omit<AgentBackendContext, 'session'>): Promise<RuntimeSession> | RuntimeSession;
  stream(input: TInput, context: AgentBackendContext): AsyncIterable<RuntimeStreamEvent>;
  stop?(session: RuntimeSession, reason: string): Promise<void> | void;
}
/** @stable */
interface RunAgentTaskStreamOptions<TInput extends AgentBackendInput = AgentBackendInput> {
  task: AgentTaskSpec;
  backend: AgentExecutionBackend<TInput>;
  input?: Omit<TInput, 'task'>;
  knowledge?: AgentKnowledgeProvider;
  sessionStore?: RuntimeSessionStore;
  sessionId?: string;
  resume?: boolean;
  signal?: AbortSignal;
  minimumReadinessScore?: number;
}
/** @stable */
interface RunAgentTaskOptions<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec;
  adapter: AgentAdapter<TState, TAction, TActionResult, TEval>;
  knowledge?: AgentKnowledgeProvider;
  onEvent?: AgentRuntimeEventSink<TState, TAction, TActionResult, TEval>;
  store?: TraceStore;
  signal?: AbortSignal;
  scenarioId?: string;
  projectId?: string;
  variantId?: string;
  minimumReadinessScore?: number;
}
/** @stable */
interface AgentTaskRunResult<TState, TAction, TActionResult, TEval extends ControlEvalResult = ControlEvalResult> {
  task: AgentTaskSpec;
  status: AgentTaskStatus;
  knowledge: KnowledgeReadinessReport;
  questions: UserQuestion[];
  acquisitionPlans: DataAcquisitionPlan[];
  userAnswers: Record<string, string>;
  acquiredEvidenceIds: string[];
  control: ControlRunResult<TState, TAction, TActionResult, TEval>;
  runRecords: RunRecord[];
}
/** @stable */
interface KnowledgeReadinessDecision {
  passed: boolean;
  status: 'ready' | 'blocked' | 'caveat';
  reason: string;
  readinessScore: number;
  recommendedAction: KnowledgeReadinessReport['recommendedAction'];
  severity: KnowledgeReadinessReport['severity'];
  blockingGapIds: string[];
  nonBlockingGapIds: string[];
}
//#endregion
//#region src/runtime-usage.d.ts
/** Observed subtotals, with missing measurements kept separate from measured zeroes. */
interface RuntimeUsageTotals {
  /** Observed input tokens across normalized per-call events. */
  tokensIn: number;
  /** Observed output tokens across normalized per-call events. */
  tokensOut: number;
  /** Observed dollar subtotal; incomplete when `usdKnown` is false. */
  costUsd: number;
  /** Number of observed model calls, including unpriced or incompletely metered calls. */
  llmCalls: number;
  /** False when any observed call has incomplete token usage. */
  tokensKnown?: false;
  /** False when any observed call lacks complete provider-billed cost. */
  usdKnown?: false;
  /** Sum of reported external estimates; never included in `costUsd` or proof of complete cost. */
  estimatedCostUsd?: number;
}
//#endregion
//#region src/runtime-run.d.ts
/** @stable */
type RuntimeRunStatus = 'running' | 'completed' | 'failed' | 'cancelled';
/** @stable */
interface RuntimeRunCost extends RuntimeUsageTotals {
  /** Wall time from `startRuntimeRun()` to `complete()` (or `now()` if not yet completed). */
  wallMs: number;
}
/** @stable */
interface RuntimeRunCompleteInput {
  status: Exclude<RuntimeRunStatus, 'running'>;
  resultSummary?: string;
  /** Optional subtotal overrides. Existing incomplete-usage flags remain authoritative. */
  cost?: Partial<RuntimeRunCost>;
  /** Stable error message when `status === 'failed'`. */
  error?: string;
  /** Additional adapter-specific fields merged into the persisted row. */
  metadata?: Record<string, unknown>;
}
/** @stable */
interface RuntimeRunRow {
  /** Stable runtime-side identifier. Adapters may translate to their own primary key. */
  id: string;
  workspaceId: string;
  sessionId?: string;
  agentId?: string;
  domain?: string;
  taskId: string;
  scenarioId?: string;
  status: RuntimeRunStatus;
  resultSummary?: string;
  error?: string;
  cost: RuntimeRunCost;
  startedAt: string;
  completedAt?: string;
  metadata?: Record<string, unknown>;
}
/** @stable */
interface RuntimeRunPersistenceAdapter {
  /**
   * Called once when `handle.persist()` runs. Implementations write `row` to
   * their durable store (D1, postgres, KV) and return whatever the consumer
   * wants the caller to see (often the storage-side row id). Errors thrown
   * here propagate out of `persist()` so the caller can decide whether to
   * retry or log-and-continue.
   */
  upsert(row: RuntimeRunRow): Promise<void> | void;
}
/** @stable */
interface RuntimeRunOptions {
  workspaceId: string;
  sessionId?: string;
  agentId?: string;
  taskSpec: AgentTaskSpec;
  scenarioId?: string;
  /** Optional persistence adapter; if omitted, `persist()` is a no-op. */
  adapter?: RuntimeRunPersistenceAdapter;
  /** Override the row id; default = `${taskSpec.id}:${random suffix}`. */
  id?: string;
  /** Override the clock; default = `Date.now()`. Useful for deterministic tests. */
  now?: () => number;
}
/** @stable */
interface RuntimeRunHandle {
  /** Stable id assigned at start. */
  readonly id: string;
  readonly workspaceId: string;
  readonly sessionId: string | undefined;
  readonly taskSpec: AgentTaskSpec;
  readonly status: RuntimeRunStatus;
  /**
   * Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
   * (text deltas, tool calls) silently so consumers can pipe the whole stream
   * through `handle.observe`. `llm_call` events update the ledger.
   */
  observe(event: RuntimeStreamEvent): void;
  /** Snapshot of the current cost ledger. Safe to call at any time. */
  cost(): RuntimeRunCost;
  /**
   * Transition to a terminal state. Idempotent for the same status; throws
   * `RuntimeRunStateError` for a different terminal status (state machines
   * don't time-travel).
   */
  complete(input: RuntimeRunCompleteInput): void;
  /** Build the current row without writing it. Useful for tests + dry runs. */
  toRow(metadata?: Record<string, unknown>): RuntimeRunRow;
  /**
   * Persist the current row via the configured adapter. Must be called after
   * `complete()`. Idempotent for the same terminal state (the adapter sees
   * the same row on retry).
   */
  persist(metadata?: Record<string, unknown>): Promise<void>;
}
/**
 *
 * Construct a runtime-run handle. The returned handle is mutable across its
 * lifetime; consumers should not share it across requests.
 *
 * @stable
 */
declare function startRuntimeRun(options: RuntimeRunOptions): RuntimeRunHandle;
//#endregion
//#region src/runtime/types.d.ts
/** @stable */
interface ValidationCtx {
  /** Iteration index this output came from (0-based). */
  iteration: number;
  /**
   * Live sandbox for this iteration. Validators that need execution-grounded
   * evidence can inspect files or run commands here instead of forcing callers
   * to bypass the loop kernel with raw Sandbox SDK orchestration.
   */
  box?: SandboxInstance;
  /**
   * Detached, immutable node identity supplied by supervised provider execution.
   * Runtime scopes include depth (root = 0); standalone execution may omit this context.
   */
  readonly node?: ExecutorNodeContext;
  /** Cooperative cancellation channel. */
  signal: AbortSignal;
  /**
   * Optional trace emitter. When set, validator implementations that make
   * LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
   * The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.
   */
  traceEmitter?: LoopTraceEmitter;
}
/** @stable */
interface Validator<Output, Verdict = DefaultVerdict$1> {
  validate(output: Output, ctx: ValidationCtx): Promise<Verdict>;
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
 * @stable
 */
interface AgentRunSpec<Task> {
  /** Sandbox SDK profile — what kind of agent runs the task. */
  profile: AgentProfile;
  /** Task → prompt formatter. Pure and deterministic. */
  taskToPrompt: (task: Task) => string;
  /**
   * Optional pre-prompt sandbox provisioner. Runs after the sandbox is acquired
   * and before the first prompt is streamed into that box. Use this for
   * domain-agnostic setup such as repo snapshots, benchmark fixtures, policy
   * files, or seed datasets. The hook is part of the runtime surface so loop
   * consumers do not hand-roll Sandbox SDK orchestration just to prepare a
   * workspace before the agent sees it.
   *
   * `ctx.recordMount` records what was placed into the box so the run carries a
   * provenance manifest (`LoopResult.provenance.mounts`). It is optional and
   * provenance-only — the kernel never reads box contents and attaches no
   * meaning to the entries; not calling it simply leaves the manifest empty.
   */
  prepareBox?: (box: SandboxInstance, ctx: {
    signal: AbortSignal;
    recordMount: MountRecorder;
  }) => Promise<void> | void;
  /**
   * Per-spec stable name. Surfaced in trace events and the default winner
   * selector tiebreak. Falls back to `profile.name ?? 'agent'`.
   */
  name?: string;
  /**
   * Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
   * the kernel's defaults. `backend.profile` is set to `profile` by the
   * kernel and cannot be overridden here — use `profile` itself for that.
   */
  sandboxOverrides?: Partial<Omit<CreateSandboxOptions, 'backend'>> & {
    backend?: Omit<NonNullable<CreateSandboxOptions['backend']>, 'profile'>;
  };
}
/**
 * Stream of `SandboxEvent`s → typed `Output`.
 *
 * Adapters are pure functions over the already-collected event array; they
 * do not receive the live AsyncIterable so they can be replayed against
 * persisted streams during tests / replays.
 *
 * @stable
 */
interface OutputAdapter<Output> {
  parse(events: SandboxEvent[]): Output;
}
/** LLM token usage. Structurally maps into agent-eval's paid-call receipt so a
 * campaign dispatch settles real usage instead of appearing as a stub. */
interface LoopTokenUsage {
  /** Total provider-reported prompt tokens. Budgets always use this total. */
  input: number;
  output: number;
  /** False when the subtotal is incomplete. */
  tokensKnown?: false;
  /** Prompt tokens newly processed by the provider, when every prompt class is known. */
  freshInput?: number;
  /** Prompt tokens the provider reported serving from its cache. */
  cacheRead?: number;
  /** Prompt tokens the provider reported writing to its cache. */
  cacheWrite?: number;
  /**
   * False when any positive-input observation omitted or contradicted the prompt-cache split.
   * This marker is sticky during aggregation. Missing cache fields must never become zero.
   */
  cacheBreakdownKnown?: false;
}
/**
 * One mounted resource recorded during box preparation — a pure provenance
 * record of what the caller placed into a box before the agent saw it. The
 * kernel never reads box contents itself (it does not know what was mounted);
 * the caller, which owns the bytes inside `prepareBox`, supplies each entry via
 * `recordMount`. Carries no domain semantics — just where the resource landed,
 * its content fingerprint, its size, and where it came from — so a run is
 * auditable after the fact ("what exactly was this agent given?").
 *
 * @stable
 */
interface MountManifestEntry {
  /** Destination path inside the box where the resource was placed. */
  path: string;
  /** Hex SHA-256 of the mounted bytes. The caller computes it from the bytes
   *  it wrote — the kernel does not hash box contents. */
  sha256: string;
  /** Size of the mounted resource in bytes. */
  bytes: number;
  /** Free-form origin of the resource (e.g. a repo ref, a corpus id, a local
   *  path, a URL). Provenance only — the kernel attaches no meaning to it. */
  source: string;
}
/**
 * A record of one candidate-selection decision: which iteration the selector
 * picked (or rejected) and why. Pure audit trail of the SELECTOR role — it
 * carries the selector's identity, the candidate's score, and an optional
 * human-readable reason, with no domain semantics. The kernel emits one receipt
 * per scored candidate at finalize so a run answers "why did THIS one win?".
 *
 * @stable
 */
interface SelectionReceipt {
  /** Iteration index this receipt is about. */
  candidateIndex: number;
  /** True for the iteration the selector chose as winner; false otherwise. */
  selected: boolean;
  /** The candidate's verdict score, when it has one. */
  score?: number;
  /** Why this candidate was (or was not) selected, when the selector states it. */
  reason?: string;
  /** Identity of the selector that produced this receipt — `'caller'` (an
   *  explicit `selectWinner`), `'driver'` (a driver-authored winner), or
   *  `'default'` (the kernel's best-valid-score argmax). */
  selector: 'caller' | 'driver' | 'default';
}
/**
 * Domain-free run provenance: a manifest of what was mounted into the run's
 * boxes and the receipts for how the winner was selected. Surfaced on
 * `LoopResult` purely for run auditability — nothing in the kernel branches on
 * it. Empty arrays when the caller recorded no mounts and there was no
 * candidate to select.
 *
 * @stable
 */
interface RunProvenance {
  /** Every resource recorded via `prepareBox`'s `recordMount`, in record order. */
  mounts: MountManifestEntry[];
  /** One receipt per scored candidate at finalize, in iteration order. */
  selectionReceipts: SelectionReceipt[];
}
/**
 * Records a mounted resource into the run's provenance manifest. Passed to
 * `prepareBox` so the caller — which owns the bytes it writes into the box —
 * declares what it mounted without the kernel having to inspect box contents.
 *
 * @stable
 */
type MountRecorder = (entry: MountManifestEntry) => void;
/** @stable */
interface Iteration<Task, Output> {
  /** 0-based iteration index assigned by the kernel. */
  index: number;
  task: Task;
  /** Stable name of the `AgentRunSpec` that produced this iteration. */
  agentRunName: string;
  output?: Output;
  verdict?: DefaultVerdict$1;
  error?: Error;
  /** Public Sandbox outcome settled after the complete event stream. */
  sandboxOutcome?: AgentRunOutcome;
  /** Raw sandbox event stream collected for this iteration. Present on a failed iteration too,
   *  holding the events received before the failure — including the one that reported it. */
  events: SandboxEvent[];
  startedAt: number;
  endedAt: number;
  costUsd: number;
  /** False when `costUsd` is only the observed subtotal, not a complete bill. */
  costUsdKnown?: false;
  /**
   * The part of `costUsd` that came from calls carrying no billing receipt, summed per call.
   *
   * `costUsdKnown` is an AND over the iteration, so it cannot say HOW MUCH of the total is
   * unproven: one receiptless call marks the whole iteration unknown. This is the amount that
   * belongs on `Spend.usdEstimated`, which keeps `usd - usdEstimated` reading as billed money on
   * a settlement that mixed both kinds. Absent when every dollar here carried a receipt.
   */
  unprovenCostUsd?: number;
  /** Local/catalog estimates remain separate from billed spend. */
  estimatedCostUsd?: number;
  /** Provider-reported prompt-cache fields; absent fields remain unknown. */
  promptCache?: Record<string, number | string>;
  /** Summed LLM token usage across every `llm_call` event in this iteration. */
  tokenUsage: LoopTokenUsage;
  /**
   * Wall time this iteration's box was alive, in milliseconds: from the moment the loop acquired
   * the box to the moment the loop's own teardown returned.
   *
   * ABSENT when this iteration did not own the box's terminal. A lineage box and a same-sandbox
   * box are reaped at loop end, AFTER the loop has already built its result, so no iteration can
   * pair them. A missing lifetime is never a zero: a box nobody timed is a different fact from a
   * box that lived no time.
   */
  boxLiveMs?: number;
  /** False when `boxLiveMs` is a floor rather than the full lifetime: the delete was attempted and
   *  never acknowledged, so the box may have outlived the number. */
  boxLiveMsKnown?: false;
}
/** @stable */
interface Driver<Task, Output, Decision> {
  /**
   * Trace label surfaced in trace events. No behavioral effect: it never
   * selects a strategy or a decision path. Default `'driver'`.
   */
  readonly name?: string;
  /**
   * Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
   * `[]` → no more work this round (kernel proceeds to `decide`).
   */
  plan(task: Task, history: ReadonlyArray<Iteration<Task, Output>>): Promise<Task[]>;
  /**
   * Inspect history and return the next state. The kernel terminates the
   * loop when `decide` returns a `TerminalDecision`
   * (`'stop' | 'pick-winner' | 'fail' | 'done'`, exported as
   * `TERMINAL_DECISIONS` with the `isTerminalDecision` guard), when
   * `maxIterations` is hit, or when the abort signal fires. Every other
   * value is caller vocabulary and continues the loop.
   */
  decide(history: ReadonlyArray<Iteration<Task, Output>>): Decision | Promise<Decision>;
  /**
   * Optional: describe the move `plan()` just produced, for trace emission.
   * The kernel calls this immediately after `plan()` and emits the result in
   * the `loop.plan` event so a topology viewer can render the agent's chosen
   * move + rationale (not just the inferred fan-width). Drivers whose topology
   * is a pure function of count (refine/fanout-vote) omit it — the kernel
   * infers `moveKind` from the planned-task count. A driver that authors its
   * own topology returns its chosen move's kind + rationale here.
   */
  describePlan?(): LoopPlanDescription | undefined;
  /**
   * Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
   * kernel consults this at finalize ONLY when the caller did not pass an explicit
   * `selectWinner` to runAgentRounds. Return the driver-declared winner (e.g. from a
   * `select` topology move) or `undefined` to fall through to the default
   * (best-valid-score, earliest index). This is the SELECTOR role made
   * agent-authorable — the planner runs the selection, not the kernel.
   * @experimental
   */
  selectWinner?(history: ReadonlyArray<Iteration<Task, Output>>): LoopWinner<Task, Output> | undefined;
}
/** @stable Driver-supplied description of the just-planned move. */
interface LoopPlanDescription {
  /** Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`. */
  kind: string;
  /** Why the driver chose this move (the agent's rationale), when available. */
  rationale?: string;
  /**
   * Iteration index this round branches FROM, when the driver declares it.
   * Overrides the kernel's inferred branch point — lets a planner that
   * branches off a specific (non-winner) iteration emit faithful edge lineage.
   * Omit to keep the inferred (best-valid / latest) branch point.
   */
  parentIndex?: number;
}
/** @stable */
interface LoopWinner<Task, Output> {
  task: Task;
  output: Output;
  verdict?: DefaultVerdict$1;
  iterationIndex: number;
  agentRunName: string;
}
/** @stable */
interface LoopResult<Task, Output, Decision> {
  decision: Decision;
  iterations: Iteration<Task, Output>[];
  winner?: LoopWinner<Task, Output>;
  durationMs: number;
  /** Sum of every iteration's `costUsd`. */
  costUsd: number;
  /** False when `costUsd` is only the observed subtotal, not a complete bill. */
  costUsdKnown?: false;
  /** Sum of every iteration's `unprovenCostUsd` — the part of `costUsd` no billing receipt
   *  covers. Absent when every dollar in the loop carried one. */
  unprovenCostUsd?: number;
  /** Sum of separately-labelled local/catalog estimates. */
  estimatedCostUsd?: number;
  /** Aggregated provider-reported prompt-cache fields. */
  promptCache?: Record<string, number | string>;
  /** Sum of every iteration's token usage. `loopDispatch` commits it through
   *  the campaign's paid-call receipt. */
  tokenUsage: LoopTokenUsage;
  /** Sum of `Iteration.boxLiveMs` over the iterations that could pair a box acquire with its
   *  teardown. ABSENT when none could — the run's box time went unmeasured, which is not a zero. */
  boxLiveMs?: number;
  /** False when at least one iteration ran a box whose lifetime the loop could not fully observe,
   *  so `boxLiveMs` is a floor over the run rather than its total. */
  boxLiveMsKnown?: false;
  /** Domain-free run provenance for auditability: the mount manifest recorded
   *  during `prepareBox` and the selection receipts for how the winner was
   *  chosen. Always present; empty arrays when nothing was recorded. */
  provenance: RunProvenance;
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
 * @stable
 */
interface SandboxClient {
  create(options?: CreateSandboxOptions, requestOptions?: CreateRequestOptions): Promise<SandboxInstance>;
  describePlacement?(box: SandboxInstance): LoopSandboxPlacement;
  /**
   * Optional legacy CRIU capability probe. When present and it resolves
   * `{ available: true }`, the loop's `lineage.fork` seam may checkpoint and fork
   * a parent box when live `branch(count)` is unavailable. Current Sandbox boxes
   * expose live branching directly. The kernel reads this ONLY through the
   * capability probe — it never branches on backend kind.
   * The raw `Sandbox` SDK class satisfies it; the loop's test fakes omit it
   * (⇒ `canFork = false`).
   * @experimental
   */
  criuStatus?(): Promise<{
    available: boolean;
    criuVersion?: string;
    reason?: string;
  }>;
}
/**
 * Opt-in box-lineage controls for `runAgentRounds`. Default OFF — with both flags
 * unset the kernel's per-iteration behavior is byte-identical to acquiring a
 * fresh box, streaming once, and tearing it down. The independence of N fresh
 * boxes (e.g. `random@k`) is a compute-control invariant; these flags must
 * never apply to it. Enable them ONLY on a steered loop (refine / planner-driven
 * fanout) where reusing the parent's context is intended.
 *
 * Live-box footprint: the lineage keeps every box it starts or forks alive
 * across rounds so a later round can descend from it, and tears them down at
 * loop end. When the driver's branch point is kernel-inferred (no
 * `describePlan` — refine, fanout-vote), the kernel prunes boxes no future
 * round can reach after each round, so the live set tracks the active frontier.
 * When the driver authors its own branch point (`describePlan().parentIndex`),
 * it may descend from any prior
 * iteration, so no box is pruned and the live-box count rises to the total
 * iterations across all rounds. Size `forkFanout` runs accordingly. Live branch
 * children use copy-on-write, but each is still a live box until loop end.
 *
 * @experimental
 */
interface LoopLineageOptions {
  /**
   * When true, a refine round (1 planned task) descending from a prior round
   * CONTINUES the parent iteration's session on the SAME box
   * (`streamPrompt({ sessionId })`) instead of acquiring a fresh box and
   * re-injecting prior context as prompt text. Round 0 (no parent) always
   * starts fresh. Usable on any single-task path, not just the refine driver.
   *
   * Requires a platform that honors a client-supplied `sessionId`. The lineage
   * mints the id and `continue` asserts the session is still live
   * (`box.session(id).status()`), failing loud if the platform dropped it — so a
   * non-honoring platform errors instead of silently running contextless turns.
   * Verify continuity against the live platform before enabling: the assertion
   * proves the session EXISTS server-side, not that prior turns replay into it.
   */
  sessionContinuity?: boolean;
  /**
   * When true, a fanout round (N planned tasks) descending from a prior round
   * branches the parent's live box so all N branches inherit its context prefix.
   * If live branching is unavailable, the lineage uses legacy CRIU when its
   * probe is positive. Otherwise it degrades to N fresh boxes with no prefix.
   * Round 0 always starts fresh. NEVER set this for a `random@k` control arm —
   * forking would couple the independent samples.
   *
   * A real fork inherits the parent's IMAGE/PROFILE: per-branch `AgentRunSpec`
   * profiles are honored only on the degraded fresh-box path, so a
   * heterogeneous-profile fanout silently homogenizes to the parent's profile
   * when fork is available. Use this for same-profile branching; for
   * different-per-branch profiles use the unforked fanout path.
   */
  forkFanout?: boolean;
  /**
   * Per-turn sandbox streaming mode. Default `'sse'` (live `streamPrompt` —
   * low-latency, full per-token trace; best for interactive chat). `'poll'`
   * fire-and-detaches via `dispatchPrompt` and awaits the terminal result by
   * status-polling, so a long, quiet in-box turn (clone + build + test) never
   * holds a live stream a proxy idle-timeout can drop mid-execution. Lower trace
   * fidelity (one terminal event), so it is opt-in — intended for BATCH eval
   * runs, which don't need live streaming and were losing long turns to the
   * idle-drop. Applies to the default fresh-box path too, not only when
   * `sessionContinuity`/`forkFanout` are on.
   */
  streaming?: 'sse' | 'poll';
}
/** @stable */
interface LoopSandboxPlacement {
  /** `in-process` is a local harness CLI in the caller's own process tree — no sandbox, no fleet.
   *  It is a placement in its own right so a cost or latency breakdown split by placement does not
   *  count local runs in the sandbox bucket. */
  kind: 'sibling' | 'fleet' | 'in-process';
  sandboxId?: string;
  fleetId?: string;
  machineId?: string;
}
/** @stable */
interface LoopTraceEmitter {
  emit(event: LoopTraceEvent): void | Promise<void>;
}
/** @stable */
type LoopTraceEvent = {
  kind: 'loop.started';
  runId: string;
  timestamp: number;
  payload: LoopStartedPayload;
} | {
  kind: 'loop.plan';
  runId: string;
  timestamp: number;
  payload: LoopPlanPayload;
} | {
  kind: 'loop.iteration.started';
  runId: string;
  timestamp: number;
  payload: LoopIterationStartedPayload;
} | {
  kind: 'loop.iteration.dispatch';
  runId: string;
  timestamp: number;
  payload: LoopIterationDispatchPayload;
} | {
  kind: 'loop.iteration.ended';
  runId: string;
  timestamp: number;
  payload: LoopIterationEndedPayload;
} | {
  kind: 'loop.decision';
  runId: string;
  timestamp: number;
  payload: LoopDecisionPayload;
} | {
  kind: 'loop.ended';
  runId: string;
  timestamp: number;
  payload: LoopEndedPayload;
} | {
  kind: 'loop.teardown.failed';
  runId: string;
  timestamp: number;
  payload: LoopTeardownFailedPayload;
};
/** @stable */
interface LoopStartedPayload {
  driver: string;
  agentRunNames: string[];
  maxIterations: number;
  maxConcurrency: number;
}
/**
 * Emitted once per `plan()` round, immediately after the driver plans. Carries
 * the topology move so a viewer renders WHAT the agent decided + WHY, not just
 * the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
 * provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).
 *
 * @stable
 */
interface LoopPlanPayload {
  /** 0-based plan round (one per `plan()` call). */
  roundIndex: number;
  /** Tasks the driver issued this round. */
  plannedCount: number;
  /** Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc. */
  moveKind: string;
  /** Driver rationale for the move, when available. */
  rationale?: string;
  /**
   * Iteration index this round branched FROM (the edge source). `undefined`
   * for round 0 (root). Kernel-inferred branch point — the best-valid (else
   * latest) iteration so far — unless a driver later declares it explicitly.
   */
  parentIndex?: number;
  /** Iteration indices this round dispatched (the edge targets). */
  childIndices: number[];
}
/** @stable */
interface LoopIterationStartedPayload {
  iterationIndex: number;
  agentRunName: string;
  taskHash: string;
  /** Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to. */
  groupId?: number;
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number;
}
/**
 * Where the iteration's worker was placed. `sibling` = a fresh sandbox the
 * kernel created via `sandboxClient.create`. `fleet` = an existing machine in
 * a shared-workspace fleet — workers see the caller's filesystem and any diff
 * they write lands on it directly.
 *
 * @stable
 */
interface LoopIterationDispatchPayload {
  iterationIndex: number;
  agentRunName: string;
  placement: 'sibling' | 'fleet' | 'in-process';
  /** Set on every placement. Lets analyst loops correlate per-iteration logs. */
  sandboxId?: string;
  /** Set only when `placement === 'fleet'`. */
  fleetId?: string;
  /** Set only when `placement === 'fleet'`. */
  machineId?: string;
  /** Plan round this iteration belongs to. */
  groupId?: number;
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number;
}
/** @stable */
interface LoopIterationEndedPayload {
  iterationIndex: number;
  agentRunName: string;
  outputHash?: string;
  verdict?: DefaultVerdict$1;
  error?: string;
  costUsd: number;
  costUsdKnown?: false;
  estimatedCostUsd?: number;
  durationMs: number;
  /** Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
   *  branch span. Omitted when no `llm_call` events carried token counts. */
  tokenUsage?: LoopTokenUsage;
  /** Plan round this iteration belongs to. */
  groupId?: number;
  /** Iteration this one was planned from; `undefined` ⇒ root. */
  parentIndex?: number;
  /** Truncated string preview of the parsed output — for a viewer's drawer.
   *  Bounded to ~280 chars; never the full payload. */
  outputPreview?: string;
}
/** @stable */
interface LoopDecisionPayload {
  decision: string;
  historyLength: number;
}
/** @stable */
interface LoopEndedPayload {
  winnerIterationIndex?: number;
  totalCostUsd: number;
  costUsdKnown?: false;
  estimatedCostUsd?: number;
  durationMs: number;
  iterations: number;
}
/** Emitted when a box's `delete()` throws or times out during teardown — the
 *  loop swallows the failure (platform reaps on expiry) but surfaces it here so
 *  a real leak (e.g. mid-loop auth expiry) is observable. @stable */
interface LoopTeardownFailedPayload {
  sandboxId?: string;
  /** `'timeout'` or the delete error message. */
  reason: string;
}
/**
 * Execution context for `runAgentRounds`: the sandbox client the kernel creates boxes through, plus optional runtime hooks.
 *
 * @stable
 */
interface ExecCtx {
  /** Sandbox SDK client — the kernel calls `.create()` per iteration. */
  sandboxClient: SandboxClient;
  /**
   * Per-prompt sandbox SDK options, forwarded verbatim into EVERY `streamPrompt`
   * of every iteration and every turn of this run. The kernel owns `sessionId`
   * and `signal`: both are removed from the supplied value and applied last, so
   * only the kernel's own session id and abort signal reach the SDK. A value
   * that is present but not an object is a `ValidationError`, raised before any
   * box is created.
   *
   * Typical use: `backend.model` credentials (`authMode` / `authFiles`) so a
   * session runs on a caller-supplied subscription credential, `timeoutMs` for a
   * per-turn wall-clock ceiling, and `context` for platform-side metadata.
   *
   * The instrument keys — `backend` and `model` — need a real box. The no-box
   * `SandboxClient` seams (`inlineSandboxClient`, `localSandboxClient`,
   * `inProcessSandboxClient`, and the in-process MCP executor) run an in-process
   * executor with nothing to reconfigure, so they refuse a `backend` or `model`
   * with a `ValidationError` instead of running the turn on an instrument the
   * caller did not ask for. They accept and ignore every other key. The one
   * exception is `inProcessSandboxClient`, which surfaces the verbatim options
   * to its `onPrompt` callback: that callback is the executor, so a per-turn
   * `model` reaches it and only `backend` is refused.
   */
  promptOptions?: Omit<PromptOptions, 'signal' | 'sessionId'>;
  /** Optional runtime hooks. Execution-scoped; never part of `AgentProfile`. */
  hooks?: RuntimeHooks;
  /** Optional trace emitter. When set, the kernel emits `loop.*` events. */
  traceEmitter?: LoopTraceEmitter;
  /**
   * Optional per-event tee. When set, the kernel forwards EVERY raw event from
   * each iteration's `streamPrompt` stream as it arrives, so a host can stream
   * the agent's live output (tokens, tool calls) token-by-token. The observer
   * receives a defensive copy of each event — mutating it cannot affect the
   * run's own cost accounting or output parsing. Called synchronously in the hot
   * stream loop and never awaited, so a slow or never-settling observer cannot
   * stall the stream; keep it cheap. An async observer is fire-and-forget: its
   * promise is not awaited, so events carry no ordering or backpressure
   * guarantees (the next event may be observed before a prior async observer
   * settles) — use it for side-effect telemetry, not sequential processing.
   * Both a synchronous throw and a rejected returned promise are caught +
   * ignored so the observer can never break the run — but prefer not to depend
   * on that.
   *
   * @experimental
   */
  onSandboxEvent?: (event: SandboxEvent, meta: {
    iterationIndex: number;
    agentRunName: string;
  }) => void | PromiseLike<void>;
  /**
   * Optional production-run handle. When set, every synthesized `llm_call`
   * the kernel infers from a sandbox event stream is forwarded via
   * `runHandle.observe` so per-run cost aggregates pick up loop spend.
   */
  runHandle?: RuntimeRunHandle;
  /** Cooperative cancellation signal. */
  signal?: AbortSignal;
  /**
   * Trace id for OTEL correlation. When set alongside `traceEmitter`, the
   * exporter uses this as the parent trace for all emitted spans. Typically
   * inherited from TRACE_ID env var in MCP subprocess mode.
   */
  traceId?: string;
  /**
   * Parent span id for OTEL correlation. Loop events become children of
   * this span. Typically inherited from PARENT_SPAN_ID env var.
   */
  parentSpanId?: string;
}
//#endregion
//#region src/runtime/supervise/budget.d.ts
/**
 * A reconciliation whose spend the pool cannot verify. It is thrown after the reservation has
 * settled. `budgetViolation` carries any measured overspend on the same settlement, so a child
 * that fails closed on the fault still records how far its known channels exceeded the
 * reservation.
 */
declare class BudgetReconcileFault extends Error {
  readonly budgetViolation?: BudgetViolation;
  constructor(message: string, budgetViolation?: BudgetViolation);
}
/** Opaque, single-use reservation handle returned by `reserve` and consumed by
 *  `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup. */
interface ReservationTicket {
  readonly id: number;
  readonly reserved: {
    readonly resources?: Budget['resources'];
    readonly tokens: number;
    readonly usd: number;
    readonly iterations: number;
    /**
     * Whether the child's `Budget` actually declared `maxUsd`. `reserved.usd` is `0` for BOTH a
     * child that named no dollar ceiling and one that named `$0`, and the two settle differently:
     * an undeclared ceiling cannot be exceeded, so the child's real dollars are committed as
     * OBSERVED spend, while a declared ceiling of `$0` is a limit whose breach is fail-loud.
     * Optional so an externally constructed ticket stays valid; an absent flag is read as
     * `true` — the strict, fail-closed reading.
     */
    readonly usdBudgeted?: boolean;
  };
}
/** Where in the spawn lifecycle a reservation was last seen. `admitted` is the window between
 *  `reserve` and the hand-off to the child's execution, which the spawning code owns; `executing`
 *  means the child owns the ticket and only its settlement can close it. */
type ReservationStage = 'admitted' | 'executing';
/** Who holds a reservation. Recorded at `reserve` and refined through `attribute` once admission
 *  mints a node id, so a ticket stranded at the join barrier names the work that holds it instead
 *  of a bare counter. Every field except `stage` is optional: a pool used directly (no `Scope`)
 *  names nothing, and an unattributable leak must still be reportable. */
interface ReservationHolder {
  /** The manager-scoped assignment identity the caller declared (`SpawnOpts.assignmentId`, else
   *  its `key`), when it declared one. */
  readonly assignment?: string;
  /** The spawn label — the name an operator recognizes in a journal. */
  readonly label?: string;
  /** The spawned node's id, once admission minted one. Absent for a reservation that escaped
   *  before its child had an identity. */
  readonly childId?: string;
  readonly stage: ReservationStage;
}
/** One reservation still open when a run reached its join barrier — a conserved-pool leak,
 *  reported with the holder that can be chased rather than only its ticket id. */
interface LeakedReservation extends ReservationHolder {
  readonly ticketId: number;
}
/** Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 *  `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 *  `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 *  `iterationsLeft` is the remaining iteration capacity.
 *  `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 *  reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver. */
type BudgetReadout = Readonly<{
  resources?: Readonly<Record<string, {
    unit: string;
    limit: number;
    remaining: number;
    reserved: number;
    committed: number;
    known: boolean;
  }>>;
  tokensLeft: number;
  /**
   * False once the pool has recorded work whose token count was UNREPORTED (a `Spend` with
   * `tokensKnown: false`). `tokensLeft` is then a ceiling on what remains, not a measurement: real
   * consumption is at least the debited amount and possibly more. Reading `tokensLeft` without this
   * flag would present an under-count as an exact balance.
   */
  tokensKnown: boolean;
  /**
   * False once the pool has charged a REPORTED spend whose prompt-cache split it could not read.
   * The prompt tokens that carried no class were charged in full, and a cached prefix reaches the
   * pool again on every turn that reads it, so the debited amount is an upper bound on
   * newly-presented work rather than a measurement. It is a separate fact from `tokensKnown`: the
   * counts arrived, but their composition did not. A restored uncertain reservation leaves this
   * flag alone — it charges a declared ceiling, which has no composition to misread, and
   * `tokensKnown` already reports that the balance is not a measurement.
   */
  cacheBreakdownKnown: boolean;
  usdLeft: number;
  usdCapped: boolean;
  /** False once any recorded work reported an unknown dollar cost; the dollar totals are then a
   *  lower bound on real spend, not a measurement. */
  usdKnown: boolean;
  iterationsLeft: number;
  deadlineMs: number;
  reservedTokens: number;
}>;
/** The part of each channel a reservation must leave free: a manager's own share of its slice,
 *  which its children may not reserve. */
interface ReservationFloor {
  readonly tokens: number;
  readonly iterations: number;
  readonly usd?: number;
}
/** How a caller asks for a reservation. */
interface ReserveOptions {
  /** Wait for budget instead of failing, when the reservations still open would return enough.
   *  The reservation then holds nothing until it is granted. */
  readonly wait?: boolean;
  /** Leave this much of each channel free after the reservation. */
  readonly keep?: ReservationFloor;
}
/**
 * A waiting reservation that can never be granted: every open reservation settled and the free
 * balance still cannot cover it. `shortfalls` are the channels that did not fit at that moment.
 */
declare class ReservationWaitRefused extends Error {
  readonly reason: "budget-exhausted";
  readonly shortfalls: readonly ReservationShortfall[];
  constructor(shortfalls: readonly ReservationShortfall[]);
}
/** Why a reservation was refused. `budget-exhausted` means the pool ran out of a channel it
 * budgets; `usd-unbudgeted` means the root declared no dollar ceiling, so a dollar request is
 * unsatisfiable at any amount and the fix is to budget the root, not to ask for less. */
type ReservationRejection = 'budget-exhausted' | 'usd-unbudgeted';
/** One budget channel a `budget-exhausted` reservation could not fit, with the amounts that
 * decided it. A refusal lists every channel that did not fit (`shortfalls`), so shrinking one
 * request is not answered by a second refusal on a channel the caller was never told about
 * (observed live: a director whose 100-iteration child was refused spent a probe worker to learn
 * the pool still admitted 3). `free` is a snapshot: live reservations return to it as their
 * workers settle, and a driver's own metered turns draw tokens and dollars from the same pool
 * before its next request arrives, so only `iterations` can be requested at exactly `free`.
 * `closedByUnknownSpend` means work with unmeasured usage ran under that enforced limit; the
 * channel then refuses every reservation for the rest of the run. */
interface ReservationShortfall {
  readonly channel: 'tokens' | 'iterations' | 'usd' | `resource:${string}`;
  readonly requested: number;
  readonly free: number;
  /** What open reservations hold on this channel, when they hold any. A request of at most
   *  `free + held` can wait for them to settle; a larger one never fits. */
  readonly held?: number;
  readonly closedByUnknownSpend?: true;
}
/** State recovered from a prior process before new work is admitted. `committed` is measured spend
 * already present in the durable journal. Each `uncertainReservation` is a child that was recorded
 * as started but never recorded as settled: its full declared ceiling is charged conservatively,
 * while the public readout remains explicitly unknown. */
interface BudgetPoolRestore {
  readonly committed?: Spend;
  readonly uncertainReservations?: ReadonlyArray<Budget>;
}
interface BudgetPool {
  /**
   * Atomically reserve a child's full ceiling from the free balance. Fails closed
   * ({ ok: false }) when the pool can't cover standard or named channels — the
   * caller inspects `ok` before `ticket`.
   *
   * With `wait`, a request the free balance cannot cover now, but could once the open reservations
   * return, is admitted as a WAITING ticket: `granted` resolves when the pool reserves it, and
   * rejects with {@link ReservationWaitRefused} once nothing open could return enough. A waiting
   * ticket reserves nothing; reconciling it withdraws it. While any ticket waits, a new waiting
   * request queues behind it even when it would fit, so the order of asking is the order of grant.
   */
  reserve(b: Budget, holder?: ReservationHolder, options?: ReserveOptions): {
    ok: true;
    ticket: ReservationTicket;
    granted?: Promise<void>;
  } | {
    ok: false;
    reason: ReservationRejection;
    shortfalls?: readonly ReservationShortfall[];
  };
  /**
   * Name (or rename) who holds an open reservation. Merges into what `reserve` recorded, so a
   * caller states only what it just learned — the node id admission minted, or the stage the
   * ticket moved to. A settled or unknown ticket is ignored: attribution is leak EVIDENCE, never
   * a lifecycle guard, and must not be able to fail a run that is otherwise healthy.
   */
  attribute(ticket: ReservationTicket, holder: ReservationHolder): void;
  /**
   * Release a reservation: commit the actual `spent`, refund the unspent remainder
   * to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
   * a double refund would silently break conservation).
   *
   * Returns the overspend when measured spend exceeded the reservation, after committing it.
   * Throws, also after committing, when the spend cannot be verified: unknown dollar cost under
   * a dollar cap, or unknown or overflowing usage of an enforced resource.
   */
  reconcile(ticket: ReservationTicket, spent: Spend): BudgetViolation | undefined;
  /** Fold a normalized `UsageEvent` stream (or array) into a `Spend`. Tokens via
   *  `addTokenUsage`, usd on its own channel, iterations from `'iteration'` events.
   *  `ms` is left zero — wall-clock duration is the caller's to record, not the pool's. */
  spendFrom(events: AsyncIterable<UsageEvent> | UsageEvent[]): Promise<Spend>;
  /** The current readout, reflecting all outstanding reservations. */
  readout(): BudgetReadout;
  /**
   * Record OBSERVED spend that did NOT go through reserve/reconcile — the driver's OWN inference
   * (its chat turns), which is real compute but not a spawned child. A direct `free → committed`
   * debit, so `total ≡ free + reserved + committed` is preserved: equal-k counts the driver's
   * tokens and the in-loop budget guard (`readout().tokensLeft`) sees them. `free` may go negative
   * when a run overspends. Unknown enforced resource usage is recorded before throwing.
   * Partial increments defer completeness checks until the invocation reports its terminal spend.
   * The DURABLE record is the journal's `metered` event (written by `Scope.meter`); this debit
   * only makes the live `readout()` reflect driver inference for the in-loop guard.
   */
  observe(spend: Spend, options?: {
    partial?: boolean;
  }): void;
  /** Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
   *  supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
   *  reservation would silently break `total ≡ free + reserved + committed`). */
  assertNoOpenTickets(): void;
  /** Every reservation still open, with its holder. Empty on a healthy pool. Read at the join
   *  barrier so a run that failed can REPORT a leak it must not also be destroyed by. */
  openReservations(): ReadonlyArray<LeakedReservation>;
}
/** Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 *  channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 *  pool does not read wall-clock). */
declare function spendFromUsageEvents(events: UsageEvent[]): Spend;
/**
 * Create a conserved reservation pool from a root `Budget`. `runStartedAtMs` is the WALL-CLOCK
 * instant the run's root was recorded, and it is the only input the deadline is derived from:
 * `runStartedAtMs + root.deadlineMs`, or `0` when the root declares no deadline. The pool holds no
 * clock, so a caller cannot hand it a run-relative one and get a duration back where an instant is
 * expected. A resumed pool passes the ORIGINAL root instant, so restart never slides the limit.
 * The readout is an absolute instant, not a shrinking remainder.
 */
declare function createBudgetPool(root: Budget, runStartedAtMs: number, restore?: BudgetPoolRestore): BudgetPool;
//#endregion
//#region src/runtime/retained-run-types.d.ts
/** Cursor plus runtime sequence needed to continue one ordered replay. @stable */
interface RetainedRunReplayPoint {
  readonly cursor: string;
  readonly sequence: number;
}
/** Options for replaying canonical events strictly after a saved point. @stable */
interface RetainedRunEventOptions {
  readonly after?: RetainedRunReplayPoint;
  readonly signal?: AbortSignal;
}
/** Effect recorded for one retained control operation. @stable */
type RetainedRunEffect = 'cancel_requested' | 'cancelled' | 'not_live' | 'unknown';
/** Stable status snapshot for a retained run. @stable */
interface RetainedRunSnapshot {
  readonly runId: string;
  readonly controlRef: AgentExactRunControlRef;
  readonly status: AgentSessionStatus | null;
  readonly effect: RetainedRunEffect;
  readonly observedAt: string;
  readonly reason?: string;
  readonly signal?: string;
}
/** Durable acknowledgement state for one retained control operation. @stable */
interface RetainedRunCancellation {
  readonly operationId: string;
  readonly requestDigest: Sha256Digest;
  readonly status: 'accepted' | 'replayed' | 'conflict' | 'unknown';
  readonly effect: RetainedRunEffect;
  readonly snapshot: RetainedRunSnapshot;
  readonly reason?: string;
  readonly signal?: string;
}
/** Options for an idempotent retained cancellation. @stable */
interface RetainedRunCancelOptions {
  readonly operationId: string;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}
/** Runtime controls plus the exact user turn bound into a continuation request. @stable */
type NativeContextContinuationInput = NativeContextContinuationTurn & Omit<AgentNativeContextContinuationOptions, 'turn' | 'onAdmission'>;
/** Result of one verified same-session continuation. @stable */
type NativeContextContinuationExecution = AgentNativeContextContinuationResult;
/** A fresh retained turn with a canonical, approved portable context request. @stable */
type RetainedRunTurnInput = Omit<AgentTurnInput, 'contextTransfer'> & {
  readonly turnId: string;
  readonly contextTransfer?: ContextTransferRequest;
};
/**
 * Admission and terminal result for one same-session continuation.
 *
 * The provider resolves `admission` after it durably owns the next exact run
 * reference. `result` resolves when that run reaches its terminal result.
 * @stable
 */
interface NativeContextContinuationHandle {
  readonly admission: Promise<AgentExactRunControlRef>;
  readonly result: Promise<NativeContextContinuationExecution>;
}
/** Reconstructable control of one provider-retained run. @stable */
interface RetainedRunHandle {
  readonly controlRef: AgentExactRunControlRef;
  /** Capabilities measured from the exact environment that owns this run. */
  readonly capabilities: AgentEnvironmentCapabilities;
  status(options?: {
    waitMs?: number;
    signal?: AbortSignal;
  }): Promise<RetainedRunSnapshot>;
  events(options?: RetainedRunEventOptions): AsyncIterable<RuntimeEventEnvelope>;
  result(): Promise<AgentTurnResult$1>;
  respondToInteraction(command: InteractionResponseCommand, options?: {
    signal?: AbortSignal;
  }): Promise<InteractionAcknowledgement>;
  contextBoundary(options?: {
    signal?: AbortSignal;
  }): Promise<NativeContextBoundaryProof | null>;
  beginNativeContinuation(request: NativeContextContinuationRequest, turn: NativeContextContinuationInput): NativeContextContinuationHandle;
  continueNative(request: NativeContextContinuationRequest, turn: NativeContextContinuationInput): Promise<NativeContextContinuationExecution>;
  cancel(options: RetainedRunCancelOptions): Promise<RetainedRunCancellation>;
}
/**
 * Sanitized headless intent durable before environment creation.
 *
 * The request digest binds the public create and turn material without
 * retaining secret values. The original start material is required to replay
 * this record after a process crash.
 * @stable
 */
interface RetainedRunIntentAdmission {
  readonly phase: 'intent';
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly turnId: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly runId: string;
  readonly requestedProfileDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
}
/** Recovery coordinates durable after environment creation and before dispatch. @stable */
interface RetainedRunEnvironmentAdmission {
  readonly phase: 'environment';
  readonly provider: string;
  readonly environmentId: string;
  readonly idempotencyKey: string;
  readonly turnId: string;
  /** Caller-supplied or runtime-minted; always the identity the dispatch will request. */
  readonly sessionId: string;
  /** Caller-supplied or runtime-minted; always the identity the dispatch will request. */
  readonly executionId: string;
}
/** The verified exact reference, durable before the start promise resolves. @stable */
interface RetainedRunDispatchedAdmission {
  readonly phase: 'dispatched';
  readonly controlRef: AgentExactRunControlRef;
  readonly idempotencyKey: string;
  readonly turnId: string;
}
/**
 * Sanitized intent durable before an interactive environment create begins.
 *
 * The digest covers the public start and create material without retaining that
 * material. It never carries environment variables, secret values, or provider
 * options. The replay input supplies private values after this check.
 * @stable
 */
interface RetainedInteractiveIntentAdmission {
  readonly phase: 'interactive_intent';
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly runId: string;
  readonly requestedProfileDigest: Sha256Digest;
  readonly requestDigest: Sha256Digest;
}
/** Exact interactive start request durable after environment creation. @stable */
interface RetainedInteractiveEnvironmentAdmission {
  readonly phase: 'interactive_environment';
  readonly provider: string;
  readonly environmentId: string;
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly request: AgentInteractiveSessionStart;
}
/** Provider-issued interactive process reference durable before start returns. @stable */
interface RetainedInteractiveStartedAdmission {
  readonly phase: 'interactive_started';
  readonly idempotencyKey: string;
  readonly interactiveIdempotencyKey: string;
  readonly ref: AgentInteractiveSessionRef;
}
/** Durable records for one exact native coding-agent process. @stable */
type RetainedInteractiveAdmission = RetainedInteractiveIntentAdmission | RetainedInteractiveEnvironmentAdmission | RetainedInteractiveStartedAdmission;
/** One detached-run admission record the runtime persists before creation or dispatch proceeds. @stable */
type RetainedRunAdmission = RetainedRunIntentAdmission | RetainedRunEnvironmentAdmission | RetainedRunDispatchedAdmission;
/**
 * Awaited durability hook for retained admission records.
 *
 * The runtime blocks after the pre-create intent, environment creation, and
 * provider work until the hook resolves. No retained run becomes caller-visible
 * before its exact recovery record is durable. A rejection keeps provider state
 * for recovery when provider work has already started.
 *
 * @stable
 */
type RetainedRunAdmissionHook = (admission: RetainedRunAdmission) => Promise<void>;
/** Environment, turn, and optional identity needed to replay one retained start. @stable */
interface RetainedRunStartMaterial {
  readonly environment: CreateAgentEnvironmentInput & {
    idempotencyKey: string;
  };
  /** Reuse an environment whose retained ownership key is verified instead of creating one. */
  readonly existingEnvironmentId?: string;
  readonly turn: RetainedRunTurnInput;
  /**
   * Explicit dispatch coordinates. When omitted, the runtime mints
   * deterministic coordinates from `(environment.idempotencyKey, turn.turnId)`
   * so every process derives the same values.
   */
  readonly identity?: {
    readonly sessionId: string;
    readonly executionId: string;
  };
}
/** A retained start is retry-safe only when environment and turn keys are explicit. @stable */
interface StartRetainedRunOptions extends RetainedRunStartMaterial {
  readonly provider: AgentEnvironmentProvider;
  /** A previously persisted intent used to replay the exact create operation. */
  readonly intent?: RetainedRunIntentAdmission;
  readonly onAdmission: RetainedRunAdmissionHook;
  readonly now?: () => number;
}
/** A fresh retained session inside a provider environment that already exists. @stable */
interface StartRetainedRunInEnvironmentOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly environment: {
    /** Stable provider environment identifier used by `provider.get`. */
    readonly id: string;
    /** Original environment key. The provider must return the matching retained metadata. */
    readonly idempotencyKey: string;
  };
  readonly turn: RetainedRunTurnInput;
  /**
   * Explicit fresh-session coordinates. When omitted, the runtime mints them
   * from `(environment.idempotencyKey, turn.turnId)`.
   */
  readonly identity?: {
    readonly sessionId: string;
    readonly executionId: string;
  };
  readonly onAdmission: RetainedRunAdmissionHook;
  readonly now?: () => number;
}
/** Inputs sufficient to rebuild a control client in a new process. @stable */
interface ReconnectRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly controlRef: AgentExactRunControlRef;
  readonly now?: () => number;
}
/** Recover a headless start after its pre-create intent was persisted. @stable */
interface RecoverRetainedRunIntentOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly admission: RetainedRunIntentAdmission;
  /** The exact original environment, turn, and optional identity material. */
  readonly replay: RetainedRunStartMaterial;
  readonly onAdmission: RetainedRunAdmissionHook;
  readonly now?: () => number;
}
/**
 * Pre-dispatch admission coordinates for one recovery attempt.
 *
 * A `phase: 'environment'` admission record carries these fields, so a caller
 * can pass that record after a crash before the dispatched record landed.
 *
 * @stable
 */
interface RecoverRetainedRunOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly environmentId: string;
  readonly sessionId: string;
  readonly executionId: string;
  readonly now?: () => number;
}
/**
 * Outcome of one recovery attempt from pre-dispatch admission coordinates.
 *
 * `not_found`: the provider no longer holds the environment; nothing remains
 * to destroy. `recovered`: the provider self-identified the session with a
 * strict exact reference matching the recorded coordinates. `unverifiable`:
 * the environment exists but the provider cannot self-identify the session;
 * never destroy on this outcome — keep the environment, retry
 * `reconnectRetainedRun` with a dispatched admission record, or inspect it
 * with provider-native tools.
 *
 * @stable
 */
type RecoverRetainedRunResult = {
  readonly outcome: 'recovered';
  readonly handle: RetainedRunHandle;
} | {
  readonly outcome: 'not_found';
} | {
  readonly outcome: 'unverifiable';
  readonly environment: AgentEnvironment;
};
//#endregion
//#region src/runtime/supervise/worker-slots.d.ts
/**
 * Worker slots: the one bound on how many spawned agents work at the same time.
 *
 * Every scope of a supervised tree draws from one allocator. A host that runs several trees in one
 * process can pass the same allocator to each of them, and the bound then holds across all of them.
 *
 * A spawn past the bound is never refused. It keeps its reserved budget slice and waits in a queue,
 * and it starts when a slot frees. The queue releases the deepest spawn first and then the oldest,
 * so a subtree that is already paid for finishes before the tree grows wider.
 *
 * A slot counts a working agent: a spawned agent that runs with no running child of its own. A
 * manager whose children are all running is waiting on them, so its first running child takes over
 * the manager's slot and the manager takes it back when its last running child ends. This makes
 * nested waits deadlock-free: a manager can always run one child on its own slot, so a queued subtree
 * always keeps a path to completion, whatever the bound and however deep the tree.
 *
 * The bound therefore limits working agents, not environments. The environments alive at one time
 * can exceed it by the number of managers that have a running child. The conserved budget pool and
 * the deadline bound the total work; this allocator only bounds how much of it runs at once.
 *
 * @experimental
 */
/** A fleet-wide bound on concurrently working agents, with a queue for the spawns past it. */
interface WorkerSlots {
  /** The bound on working agents, or `undefined` when only the budget bounds concurrency. */
  readonly max: number | undefined;
  /** Working agents that hold a slot now. */
  readonly working: number;
  /** Spawns that hold a budget slice and wait for a slot. */
  readonly queued: number;
}
/**
 * One held or awaited slot. `ready` resolves when the slot is granted; `granted` reads whether it
 * has been. `release` returns the slot, or withdraws a request that is still queued, and is
 * idempotent.
 */
interface SlotPermit {
  readonly ready: Promise<void>;
  readonly granted: boolean;
  release(): void;
}
/**
 * Create a worker-slot allocator. `max` omitted, `0`, or negative leaves concurrency bounded by the
 * budget alone, and every spawn starts at once. Pass the returned allocator as `workerSlots` to each
 * run that should share one bound.
 */
declare function createWorkerSlots(max?: number): WorkerSlots;
//#endregion
//#region src/errors.d.ts
/**
 *
 * A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
 * status. Distinct from `JudgeError` (which is structural / unrecoverable)
 * because backend failures are sometimes retryable and consumers may want to
 * branch on the upstream status code.
 *
 * @stable
 */
declare class BackendTransportError extends AgentEvalError {
  readonly backend: string;
  readonly status?: number;
  /**
   * Router-owned proof that a rejected request never reached a provider.
   *
   * This is intentionally one-sided. An absent value, or any value this
   * package does not understand, remains unknown to Runtime.
   */
  readonly providerDispatch?: 'not_started';
  /**
   * The upstream's own error class when it names one (the bridge's `parse_error`,
   * `not_configured`, a provider's `invalid_request_error`). A class the upstream never
   * retries is a decision about the request, so a retry policy may read it where no
   * status arrived.
   */
  readonly upstreamCode?: string;
  /**
   * Truncated upstream response body (≤2 KiB) when available. Diagnostic
   * only — surfaces in `backend_error.error.body` and `final.error.body`
   * so operators can see "free_tier_limit", "invalid_api_key", etc. without
   * cracking the log line open.
   */
  readonly body?: string;
  constructor(backend: string, message: string, options?: {
    cause?: unknown;
    status?: number;
    upstreamCode?: string;
    body?: string;
    providerDispatch?: 'not_started';
  });
}
/**
 *
 * A runtime-run lifecycle method was called in an order the state machine does
 * not allow: `persist()` before `complete()`, `complete()` twice, etc.
 *
 * @stable
 */
declare class RuntimeRunStateError extends AgentEvalError {
  constructor(message: string, options?: {
    cause?: unknown;
  });
}
/**
 *
 * The dynamic-loop planner returned an unusable topology move — the LLM emitted
 * no parseable envelope, an unknown `kind`, or a structurally-invalid move
 * (e.g. a fanout with zero tasks). This is a structural failure of the
 * agent-authored topology, not a config mistake: the planner ran but its output
 * cannot drive the kernel. Carries `validation` so cross-package handlers can
 * pattern-match without importing the runtime. Fail loud — never substitute a
 * default move, or the loop silently runs a topology nobody chose.
 *
 * @stable
 */
declare class PlannerError extends AgentEvalError {
  constructor(message: string, options?: {
    cause?: unknown;
  });
}
/**
 *
 * The caller's `onAdmission` durability hook rejected, so a retained run's
 * admission record is not durable. For a pre-create intent, no provider work
 * has started. For a later record, provider state may already be live and the
 * environment remains available for recovery. Carries `capture_integrity`
 * because the required recovery record was not written.
 *
 * @stable
 */
declare abstract class RetainedAdmissionError<TAdmission extends RetainedRunAdmission | RetainedInteractiveAdmission> extends AgentEvalError {
  readonly phase: TAdmission['phase'];
  /** The exact record the hook failed to persist, for direct recovery. */
  readonly admission: TAdmission;
  constructor(admission: TAdmission, options?: {
    cause?: unknown;
  });
}
/** The caller could not persist one detached-run recovery record. @stable */
declare class RetainedRunAdmissionError extends RetainedAdmissionError<RetainedRunAdmission> {}
/** The caller could not persist one exact interactive-process recovery record. @stable */
declare class RetainedInteractiveAdmissionError extends RetainedAdmissionError<RetainedInteractiveAdmission> {}
/**
 * A provider returned a valid interactive reference that does not bind to the
 * exact start request, or returned data that could not be parsed as one.
 *
 * The requested start and any valid provider reference are detached snapshots.
 * Malformed provider data is never copied into the error, so the error remains
 * safe to persist while the environment remains available for orphan cleanup.
 *
 * @stable
 */
declare class RetainedInteractiveBindingError extends AgentEvalError {
  /** The exact native-process start request sent to the provider. */
  readonly requested: AgentInteractiveSessionStart;
  /** The valid provider data, when the provider returned a parseable value. */
  readonly returned: {
    readonly ref?: AgentInteractiveSessionRef;
    readonly status?: AgentInteractiveSessionStatus;
  };
  constructor(requested: AgentInteractiveSessionStart, returned: RetainedInteractiveBindingError['returned'], options?: {
    cause?: unknown;
  });
}
/**
 *
 * A retained dispatch answered with coordinates that do not bind to the
 * identity the runtime requested, or failed exact verification. The
 * environment-phase admission is already durable at this point, so its
 * coordinates plus the provider reference carried here are the manual
 * recovery path. The environment is intentionally kept. Carries
 * `backend_integrity` because the provider violated its dispatch contract.
 *
 * @stable
 */
declare class RetainedRunDispatchBindingError extends AgentEvalError {
  /** The coordinates the runtime sent with the dispatch. */
  readonly requested: {
    readonly provider: string;
    readonly environmentId: string;
    readonly sessionId: string;
    readonly executionId: string;
  };
  /** The loose reference the provider actually returned, for triage. */
  readonly returned: {
    readonly id?: string;
    readonly provider?: string;
    readonly controlRef?: unknown;
  };
  constructor(requested: RetainedRunDispatchBindingError['requested'], returned: RetainedRunDispatchBindingError['returned'], options?: {
    cause?: unknown;
  });
}
//#endregion
//#region src/runtime/supervise/continuation.d.ts
/**
 * One reading of a completion check.
 *
 * A check program prints an agent-eval `JudgeScore`; {@link verdictFromJudgeScore} reads it into
 * this shape. A plain boolean check is a verdict with no items.
 */
interface CheckVerdict {
  /** Whether the check accepts the result. */
  readonly pass: boolean;
  /** Every item the check read, by name: 1 when it passes, lower when it does not. The
   *  `JudgeScore.dimensions` of the check program. */
  readonly items?: Readonly<Record<string, number>>;
  /** The check's score. */
  readonly composite?: number;
  /** The pass threshold on `composite`, when the check has one. */
  readonly threshold?: number;
  /** One `FAIL <item> <where>: <reason>` line per failed item, in the check's order. */
  readonly failures?: ReadonlyArray<string>;
  /** The check's prose review of the result, when it writes one. */
  readonly review?: string;
}
/**
 * The check could not run: its box did not start, its judge's provider refused, its program
 * crashed. It is not a verdict on the result. Inside a run the loop pauses, as it does for an
 * unavailable upstream, and the refusal tells the director its result was not judged.
 */
declare class CheckUnavailableError extends Error {
  constructor(message: string, options?: {
    readonly cause?: unknown;
  });
}
/** Read a check function's return value into a verdict. Anything but `true` or a passing verdict
 *  is a failure: a check fails closed. */
declare function checkVerdictOf(outcome: unknown): CheckVerdict;
/**
 * Read an agent-eval `JudgeScore` from a check program into a verdict.
 *
 * Each dimension is a checked item. `notes` lines that start with `FAIL ` are the failures; the
 * remaining lines are the check's review. The verdict passes when `composite >= threshold` and the
 * score is not marked `failed`; a `failed` score means the judge itself did not run, which is
 * {@link CheckUnavailableError}, not a verdict.
 */
declare function verdictFromJudgeScore(score: {
  readonly dimensions: Readonly<Record<string, number>>;
  readonly composite: number;
  readonly notes: string;
  readonly failed?: true;
}, threshold: number): CheckVerdict;
/** Items that fail in `verdict`: every item below 1, or the named items of its FAIL lines. */
declare function failedItems(verdict: CheckVerdict): ReadonlyArray<string>;
/** Items that pass in `verdict`. */
declare function passedItems(verdict: CheckVerdict): ReadonlyArray<string>;
/** One time the check ran inside the run, whatever started it. */
interface CheckRead {
  /** 1-based count of check reads in this manager, the unavailable ones included. */
  readonly read: number;
  /** The driver attempt the read belongs to. */
  readonly attempt: number;
  /** Epoch ms. */
  readonly at: number;
  /** `submit`: a `submit_result` call. `turn-end`: the turn ended with no accepted result. */
  readonly source: 'submit' | 'turn-end';
  /** Absent when the check could not run. */
  readonly verdict?: CheckVerdict;
  /** Why the check could not run. */
  readonly unavailable?: string;
}
/**
 * How a manager with a completion check is sent back when its turn ends unmet.
 *
 * Required for an external manager with a check: Runtime supplies no default, because a retry
 * default in source is a research decision the record must make. There is no re-prompt count.
 * The loop re-enters until the check passes, `report_blocked` ends the run, or a bound ends it:
 * this deadline, the budget, `maxBarren` turns in a row without progress, or cancellation.
 * Progress means the check's best composite rose, an accepted result, or a worker that delivered.
 */
interface ContinuationPolicy {
  /** No re-entry starts at or after this instant: epoch ms, or an ISO 8601 time. */
  readonly deadline: number | string;
  /** Re-entered turns in a row that may end without progress before the run ends. Minimum 1.
   *  The evidence for 2: repair loses most of its effect within two or three attempts, and a
   *  fresh start at the same budget scored higher (Debugging Decay Index). */
  readonly maxBarren: number;
  /** Every instruction word of the note. */
  readonly profile: ContinuationProfile;
  /** `verbatim` sends the check's FAIL lines, the protected items, and what changed. A check with
   *  `feedback: 'pass-only'` overrides this to `off`. */
  readonly failures: 'verbatim' | 'off';
  /** `on` runs the question panel at each continuation and puts its admitted findings in the note.
   *  Requires `runPanel`. */
  readonly panel: 'on' | 'off';
  /** `on` states the bar: every check item with its state, the best version's verdict and the
   *  gap, the reference result, and the check's review. */
  readonly bar: 'on' | 'off';
  /** The play's registered reference result, for the bar. */
  readonly reference?: string;
  /** The best version's verdict on the same check, for the bar. The version loop sets it. */
  readonly best?: {
    readonly label: string;
    readonly verdict: CheckVerdict;
  };
  /** The panel's dollar caps. Required with `panel: 'on'`. */
  readonly panelUsd?: {
    readonly perContinuation: number;
    readonly perRun: number;
  };
  /** The question panel. Required with `panel: 'on'`. */
  readonly runPanel?: ContinuationPanel;
  /** A play's own section, appended after Runtime's sections. It cannot remove or rewrite one. */
  readonly append?: ContinuationAppend;
}
/** Resolve and check a policy before any compute. Returns the deadline in epoch ms. */
declare function admitContinuationPolicy(policy: ContinuationPolicy, context: string): number;
/**
 * Every instruction word of the note. Runtime supplies the facts and their order; this data
 * supplies the words, so the note can be improved (by a person, reflection, or GEPA) without a code
 * change. Templates may name the facts in {@link CONTINUATION_FACTS} as `{name}`.
 */
interface ContinuationProfile {
  /** Recorded with every note, so each continuation names the words it carried. */
  readonly id: string;
  /** Section 1, the verdict. The first line should state the failure as a fact. */
  readonly opening: string;
  /** Section 7: what to do before the next submit. */
  readonly plan: string;
  /** Section 8: what the harness enforces, and the honest exit. */
  readonly rules: string;
  /** Section headings; an empty heading prints the section without one. */
  readonly headings: {
    readonly failures: string;
    readonly protected: string;
    readonly changed: string;
    readonly findings: string;
    readonly bar: string;
    readonly plan: string;
    readonly rules: string;
  };
  /** The bar's standing instruction, printed under its heading. */
  readonly barRule?: string;
  /** The panel's question templates. `{item}` expands over failed items and `{worker}` over
   *  settled workers; a template with neither is asked once. */
  readonly questions?: ReadonlyArray<string>;
  /** The panel's model, when the profile chooses one. */
  readonly panelModel?: string;
  /** What a new version's director reads about the best version's review, for the version
   *  chain's `'review-of-best'`. It may name `{version}`, `{path}` and `{score}`. */
  readonly review?: string;
}
/** The facts a profile template may name. */
declare const CONTINUATION_FACTS: readonly ["composite", "threshold", "failed", "total", "reads", "owed", "settled", "delivered", "continuation"];
/** What the question panel reads for one continuation. */
interface ContinuationPanelInput {
  /** 1-based continuation number. */
  readonly continuation: number;
  readonly task: unknown;
  /** The check's verdict this note reports; absent when no result reached the check. */
  readonly verdict?: CheckVerdict;
  /** Every check read so far, oldest first. */
  readonly reads: ReadonlyArray<CheckRead>;
  /** The expanded questions, one per atomic question. */
  readonly questions: ReadonlyArray<string>;
  /**
   * The run's own traces, one per agent and named by its node id: the manager's root stream, when
   * it is the root, and each settled worker's tool trace (`./run-traces.ts`). The panel runs only
   * when the run has recorded a span.
   */
  readonly traces: TraceAnalysisStore;
  /** Settled workers; each one's trace in `traces` is named by its `id`. */
  readonly workers: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
  }>;
  readonly bar?: ContinuationPolicy['best'];
  readonly reference?: string;
  /** The dollars this panel call may spend. */
  readonly usdCap: number;
  readonly signal: AbortSignal;
}
/** One answer the panel proposes for the note. */
interface PanelFinding {
  readonly question: string;
  /** The finding, stated as a claim about the run. */
  readonly claim: string;
  /** Every `trace://` citation in the answer, and whether the trace store holds it. */
  readonly citations: ReadonlyArray<{
    readonly uri: string;
    readonly resolved: boolean;
  }>;
  /** Whether an independent verifier, shown only the cited spans, agreed with the claim. */
  readonly verified: boolean;
  /** The failed check items the finding explains, when it names any. */
  readonly items?: ReadonlyArray<string>;
}
interface ContinuationPanelResult {
  readonly findings: ReadonlyArray<PanelFinding>;
  /** Dollars spent; `null` when the provider reported no cost. Unknown is never zero. */
  readonly usd: number | null;
  /** Provider receipts, recorded verbatim in `panel.jsonl`. */
  readonly receipts?: unknown;
}
/** Ask the panel's questions over the run's own traces. */
type ContinuationPanel = (input: ContinuationPanelInput) => Promise<ContinuationPanelResult>;
/** A play's own section for one note. Return `undefined` to add nothing this time. */
type ContinuationAppend = (context: {
  readonly continuation: number;
  readonly verdict?: CheckVerdict;
  readonly reads: ReadonlyArray<CheckRead>;
  readonly signal: AbortSignal;
}) => Promise<{
  readonly heading: string;
  readonly text: string;
} | undefined>;
/** A finding that reached the note, with the continuation that admitted it. */
interface AdmittedFinding extends PanelFinding {
  readonly admittedAt: number;
  /** Set once every item the finding named passes. */
  readonly resolvedAt?: number;
}
/** Findings reach the note only when every citation resolves, at least two distinct spans are
 *  cited, and the independent verifier agreed. The best method in Who&When found the failing step
 *  14.2% of the time, so an unverified finding is noise with a citation. */
declare function admitFinding(finding: PanelFinding): boolean;
/**
 * Rank the admitted findings by how many failed items they explain, drop repeats, and keep them
 * within the note's cap. Earlier findings stay as they were written (ACE: itemized additions keep
 * detail that repeated rewrites lose); a finding whose items all pass now is marked resolved.
 */
declare function distillFindings(prior: ReadonlyArray<AdmittedFinding>, proposed: ReadonlyArray<PanelFinding>, failing: ReadonlySet<string>, continuation: number): ReadonlyArray<AdmittedFinding>;
/** Expand the profile's question templates over the failed items and the settled workers. */
declare function expandQuestions(templates: ReadonlyArray<string>, failing: ReadonlyArray<string>, workers: ReadonlyArray<{
  readonly id: string;
  readonly label: string;
}>): ReadonlyArray<string>;
/** The facts one note is written from. */
interface ContinuationNoteInput {
  readonly profile: ContinuationProfile;
  /** 1-based. */
  readonly continuation: number;
  /** The verdict this turn ended on; absent when no result has reached the check. */
  readonly verdict?: CheckVerdict;
  /** The verdict the previous note reported, for what changed. */
  readonly previous?: CheckVerdict;
  /** Check reads so far, the unavailable ones included. */
  readonly reads: number;
  /** `verbatim` only when the policy and the check both allow the FAIL lines. */
  readonly failures: 'verbatim' | 'off';
  readonly findings?: ReadonlyArray<AdmittedFinding>;
  readonly bar?: {
    readonly best?: ContinuationPolicy['best'];
    readonly reference?: string;
  };
  readonly appended?: ReadonlyArray<{
    readonly heading: string;
    readonly text: string;
  }>;
  /** What the run owes, from the check's description. */
  readonly owed?: string;
  readonly progress: DriverProgressMark;
  /** Whether `read_continuation` is served to this manager. */
  readonly canReadMore: boolean;
  /** Whether the check's score comes from cases the director cannot see. */
  readonly sealed?: boolean;
}
/**
 * Write one continuation note, sections 1 to 8 of docs/38. Section 9, the run's state, is
 * `composeReentryTask`, which wraps this text. Pure: the same input writes the same note.
 */
declare function composeContinuationNote(input: ContinuationNoteInput): string;
/** One continuation as the settle record carries it (`DriverContinuationRecord.continuations`). */
interface ContinuationEntry {
  /** 1-based. */
  readonly continuation: number;
  /** The driver attempt whose end this note answered. */
  readonly attempt: number;
  /** sha256 of the note's text. */
  readonly noteDigest: string;
  readonly profile: string;
  readonly switches: {
    readonly failures: 'verbatim' | 'off';
    readonly panel: 'on' | 'off';
    readonly bar: 'on' | 'off';
  };
  /** The verdict the note reported: `null` when no result had reached the check. */
  readonly before: VerdictSummary | null;
  /** The verdict at the director's next turn end: `null` when the run ended first. */
  readonly after: VerdictSummary | null;
  /** The panel's part: questions asked, findings admitted, dollars (`null` = unknown). */
  readonly panel?: {
    readonly asked: number;
    readonly proposed: number;
    readonly admitted: number;
    readonly usd: number | null;
    /** Why the panel asked nothing this time, when it could not run. */
    readonly unavailable?: string;
  };
  /** Sections a play appended. */
  readonly appended: number;
}
interface VerdictSummary {
  readonly pass: boolean;
  readonly composite?: number;
  readonly failed?: number;
  readonly total?: number;
}
/** A run directory's continuation files: the root's at `<runDir>/continuations/<n>/`, a nested
 *  manager's at `<runDir>/continuations/managers/<owner>/<n>/`. */
declare const CONTINUATIONS_DIR = "continuations";
/** The readout a continuation is composed from. */
interface ContinuationContext {
  /** The attempt that just completed, 1-based. */
  readonly attempt: number;
  /** Continuations this run has already sent. */
  readonly continuations: number;
  /** The mark read after the completed drive. */
  readonly progress: DriverProgressMark;
  readonly budget: DriverBudgetReadout;
  /** Re-entered drives in a row, this one included, that ended without progress. */
  readonly barrenReentries: number;
  readonly signal: AbortSignal;
}
//#endregion
//#region src/runtime/supervise/upstream-unavailable.d.ts
/** How long an agent waits after its upstream refused a turn for capacity: the codes and
 *  statuses `upstreamUnavailableSignal` reads. A pause is not a failure: a driver spends neither
 *  `maxAttempts` nor `maxConsecutiveFailures` on it. */
interface UnavailablePausePolicy {
  /** The first pause, doubling per consecutive refusal. Default 15000ms. */
  readonly unavailablePauseMs?: number;
  /** Ceiling on the doubling. Default 300000ms, so a long outage costs at most twelve turns an
   *  hour. */
  readonly maxUnavailablePauseMs?: number;
}
//#endregion
//#region src/runtime/supervise/driver-retry.d.ts
/** The scope's live conserved-pool readout — the retry's real bound. Indexed off `Scope` so this
 *  module tracks the pool's shape rather than restating it. */
type DriverBudgetReadout = Scope<unknown>['budget'];
/** Whether the run's declared completion check has passed. `'none'` means the caller declared no
 *  check at all — the retry then reads spend and settlements exactly as it always has. */
type DriverContractState = 'met' | 'unmet' | 'none';
/** How hard the root driver is retried after a transient failure. The defaults retry; a caller
 *  that wants the pre-#741 behavior sets `enabled: false` and owns the consequence. */
interface DriverRetryPolicy extends UnavailablePausePolicy {
  /** `false` restores the historical behavior: the first driver failure ends the run. */
  readonly enabled?: boolean;
  /** Consecutive failures that changed NOTHING (no metered spend, no settlement, no submission)
   *  before the run gives up. Default 3. A failure that made progress resets the count. */
  readonly maxConsecutiveFailures?: number;
  /** Ceiling on failed invocations across this driver run, regardless of progress. Default: no
   *  ceiling, minimum 1. A failure that made no progress is bounded by `maxConsecutiveFailures`;
   *  failures that each made progress are bounded by the budget and the deadline, like the work
   *  they did. Successful continuations do not consume this allowance or reset it. */
  readonly maxAttempts?: number;
  /** Backoff before the first retry, doubling per consecutive failure. Default 2000ms. */
  readonly initialBackoffMs?: number;
  /** Ceiling on the doubling. Default 30000ms. */
  readonly maxBackoffMs?: number;
}
/** Why the retry loop stopped. `completed` is the only non-failure. */
type DriverAttemptStop = 'completed' | 'terminal-error' | 'retry-disabled' | 'aborted' | 'budget-exhausted' | 'deadline' | 'no-progress' | 'max-attempts';
/** One attempt's record — the legible failure the issue's third ask names. Emitted per attempt so
 *  an operator sees `driver failed after N attempts` instead of one opaque `pi exit unknown`. */
interface DriverAttemptRecord {
  /** 1-based. */
  readonly attempt: number;
  readonly durationMs: number;
  /** Absent when the attempt completed. */
  readonly error?: string;
  readonly classification?: DriverFailureClass;
  /** Did anything change since the previous attempt (spend, settlement, submission)? */
  readonly madeProgress: boolean;
  /** Set when this attempt ended the loop. */
  readonly stop?: DriverAttemptStop;
  /** Set when another attempt follows. For an `unavailable` attempt this is the pause, which is
   *  infrastructure time: together with `durationMs` it is what the outage cost this driver. */
  readonly retryInMs?: number;
  /** How this attempt was entered. Absent on the first attempt. */
  readonly reentry?: DriverReentry['reason'];
  /** For an `unavailable` attempt: the code or HTTP status that classified it, such as
   *  `provider_quota_exhausted` or `http-429`. */
  readonly unavailableSignal?: string;
  /** The completion check's verdict after this attempt. Absent when the caller declares none. */
  readonly contract?: DriverContractState;
  /** True when this COMPLETED attempt's unmet contract sent the loop back with a continuation. */
  readonly reprompted?: boolean;
  /** Why an unmet contract did NOT re-enter the session. Absent when the contract was met, when
   *  the manager has no continuation policy, or when the continuation was sent. */
  readonly repromptRefusedBy?: DriverRepromptRefusal;
}
/** Why a completed drive with an unmet contract was not re-entered. `no-progress` means
 *  `continuation.maxBarren` consecutive re-entered drives completed without progress. `closed`
 *  means the run was already closed: a failed `report_blocked` probe or a progress stop rule. */
type DriverRepromptRefusal = 'closed' | Extract<DriverAttemptStop, 'aborted' | 'budget-exhausted' | 'deadline' | 'max-attempts' | 'no-progress'>;
/** The comparable mark used to decide whether an attempt moved the run TOWARD ITS DELIVERABLE.
 *  While a declared check is unmet, spend and settlements are not progress on their own; see this
 *  file's header for the measurement that made that the rule. */
interface DriverProgressMark {
  /** Monotone total of POOL spend since the first reading, in tokens — the driver's own metered
   *  turns AND any child settlement, because the conserved pool is shared. Deliberately not
   *  driver-only: a child that settled during the attempt is progress by any reading, and the
   *  coarser signal can only bias toward rescuing a run, never toward abandoning one. */
  readonly poolTokensSpent: number;
  /** Monotone count of settled children. */
  readonly settledCount: number;
  /** Whether an accepted deliverable exists — a submission that PASSED the completion check. */
  readonly submitted: boolean;
  /** The completion check's verdict right now. Omit (or `'none'`) when the caller declares no
   *  check: the retry then reads spend and settlements exactly as it did before this field
   *  existed, so a caller with no contract is unaffected. */
  readonly contract?: DriverContractState;
  /** Monotone count of settled children that PASSED the completion check. A child that ran and
   *  settled without delivering does not count here, which is the whole point. */
  readonly deliveredCount?: number;
  /** The best composite any check read has scored so far. A rise is progress: the director moved
   *  the outside check even though it has not passed. */
  readonly composite?: number;
}
/** Why the loop is entering the driver again. Absent on the first attempt only.
 *
 *  An `unmet-contract` re-entry carries Runtime's continuation note. A `driver-failure` re-entry
 *  carries no instruction of its own: the drive that failed may never have read the last one, so
 *  the caller re-enters with the ORIGINAL task and the run's state, never with the note alone. */
type DriverReentry = {
  readonly reason: 'unmet-contract';
  /** The continuation note. Whether it is the whole turn depends on where the drive runs: only
   *  a backend that proves the same harness session may be re-entered with this text alone. */
  readonly steer: string;
  /** 1-based: which continuation this is. */
  readonly continuation: number;
} | {
  readonly reason: 'driver-failure';
  /** The failure that ended the previous drive, as recorded. */
  readonly failure: string;
  /** 1-based: which failure retry this is. */
  readonly retry: number;
} | {
  /** The upstream refused the previous drive for capacity, or the check could not run, and the
   *  loop paused before this one. Re-entered like a failure, with the original task and the
   *  run's state. */
  readonly reason: 'upstream-unavailable';
  /** The code or status that classified the refusal, such as `provider_quota_exhausted`. */
  readonly signal: string;
  /** 1-based: which pause this is. */
  readonly pause: number;
};
/**
 * How one driver failure is answered.
 *
 *  - `terminal`: Runtime's own refusal, or a request that fails identically forever. The run ends.
 *  - `transient`: a foreign accident. It is retried under `maxAttempts` and the barren streak.
 *  - `unavailable`: the upstream cannot serve now (quota, rate limit, overload, or the router's
 *    own provider credential refused). The driver pauses and re-enters, and only the deadline, the
 *    budget, and cancellation bound the pauses.
 */
type DriverFailureClass = 'transient' | 'terminal' | 'unavailable';
/**
 * The code or status that marks `error` as an upstream capacity refusal, or `undefined`.
 *
 * A structured field is read first: a turn outcome's `errorCode`, a transport error's
 * `upstreamCode` and `status`, a provider SDK error's `status`. The failure text is read only when
 * no structured field decided, because a harness CLI reports the router's refusal as text.
 */
declare function upstreamUnavailableSignal(error: unknown): string | undefined;
/**
 * Classify one driver failure. Runtime's own typed refusals are decisions and stay terminal; an
 * upstream capacity refusal is `unavailable`; anything else foreign is an accident and is
 * retryable. A `BackendTransportError` is split by status because the taxonomy already promises
 * consumers may branch on it: a 5xx/408 is the upstream having a bad moment, a 429/503/529 is the
 * upstream out of capacity, and a 401/404/422 is a request that will fail identically forever. The
 * bridge's own never-retry classes are terminal whether or not a status rides with them.
 */
declare function classifyDriverFailure(error: unknown, signal?: AbortSignal): DriverFailureClass;
/** The error a give-up throws: the original cause, re-described with the attempt history so
 *  `driver-failed` carries a diagnosable message instead of one backend's last words. */
declare class DriverAttemptsExhaustedError extends RuntimeRunStateError {
  readonly attempts: readonly DriverAttemptRecord[];
  readonly stop: DriverAttemptStop;
  constructor(cause: unknown, attempts: readonly DriverAttemptRecord[], stop: DriverAttemptStop);
}
/**
 * What one driver loop did, counted from its attempt records: the numbers a run's settle record
 * carries so a reader can tell genuine continuations from failure retries without the journal.
 *
 * Measured motive: the most genuine continuations in any recorded lab run was 11
 * (evidence-compiler-j, which won), while the two larger counts, 32 and 12, were re-entries after
 * failed turns. One `attempts` number hid which was which.
 */
interface DriverLoopRecord {
  /** Driver invocations started. */
  readonly attempts: number;
  /** Genuine continuations: completed drives with the contract unmet that were re-entered. */
  readonly reprompts: number;
  /** Re-entries after a failed drive. A pause on an unavailable upstream is not one. */
  readonly failureRetries: number;
  /** Re-entries after the upstream refused a drive for capacity. Each is a pause, not a failure. */
  readonly unavailablePauses: number;
  /** Infrastructure time the unavailable upstream cost this loop: every pause, plus every refused
   *  drive that made no progress. A refused drive that made progress was mostly work, so only its
   *  pause counts. Measured 2026-09-24 on a real run: a first drive worked 8 minutes before its
   *  refusal, and counting its whole duration doubled a 10-minute outage to 16 minutes. */
  readonly unavailableMs: number;
  /** Re-entered drives, in a row at the end, that completed without a delivery. */
  readonly barrenReentries: number;
  /** Why the loop ended: its last record's stop, or `unrecorded` when it ended without one (an
   *  admission refusal before the first attempt, or a throw from outside the loop). */
  readonly ended: DriverAttemptStop | 'unrecorded';
  /** Why a completed-but-unmet drive was not re-entered, when that ended the loop. */
  readonly repromptRefusedBy?: DriverRepromptRefusal;
}
/** A manager's driver loop as its run's settle record carries it (`SupervisedResult.continuation`). */
interface DriverContinuationRecord extends DriverLoopRecord {
  /** Re-entries that ran in a new environment because the provider no longer held the old one. */
  readonly environmentReplacements: number;
  /** Of those, the ones whose new environment was created from the lost one's latest checkpoint.
   *  The journal's `workspace-restored` receipts say whether each restore was verified. */
  readonly workspaceRestores: number;
  /** How the run was closed, when something closed it: an accepted `submit_result`, the
   *  manager's own `stop` (served only to a manager with no check), a `report_blocked` whose
   *  probe failed, or the caller's progress `stopRule`. Absent when the loop ended on a bound or a
   *  failure. */
  readonly closedBy?: 'result-accepted' | 'stop' | 'blocked' | 'stop-rule';
  /** The reason the manager gave, or the failed probe, verbatim. */
  readonly stopReason?: string;
  /** Every continuation note this manager was sent, with the check's verdict before and after it.
   *  Empty for a manager with no check. */
  readonly continuations: ReadonlyArray<ContinuationEntry>;
}
/** Count a loop's attempt records into its {@link DriverLoopRecord}. */
declare function summarizeDriverAttempts(records: ReadonlyArray<DriverAttemptRecord>): DriverLoopRecord;
//#endregion
//#region src/runtime/harness-transcript.d.ts
declare const HARNESS_TRANSCRIPT_SCHEMA_VERSION: 1;
interface HarnessTranscriptFile {
  readonly path: string;
  readonly bytes: number;
  readonly content: string;
}
interface HarnessTranscriptArtifact {
  readonly schemaVersion: typeof HARNESS_TRANSCRIPT_SCHEMA_VERSION;
  readonly harness: string;
  readonly files: readonly HarnessTranscriptFile[];
  /** Paths found but not read, with why — a gap named is a gap an operator can act on. */
  readonly skipped: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
}
/** Why no transcript reached a record, from either the capture or the settle path. */
type HarnessTranscriptUnavailableReason = 'unsupported-environment' | 'unknown-harness' | 'no-transcript' | 'enumeration-failed' |
/** No environment was ever created for this child, so there is no transcript and never
 *  was one. The admission refusal of #1240 is the measured case: a budget pool that
 *  refuses an unknown dollar cost kills the child before it runs. Distinct from
 *  `unsupported-environment`, which means a box existed and could not be read. */
'execution-never-started' |
/** An environment WAS created and the child ran, but the capture never executed — the
 *  deadline/abort path closes the stream with `iterator.return()`, which runs the
 *  generator's `finally` and skips its `catch`. Says only what is known: this child had a
 *  transcript and nobody read it. Never collapse it into `execution-never-started`; that
 *  would report a child that reasoned for twenty seconds as one that never ran. */
'capture-did-not-run' |
/** This executor implements no transcript port at all: a CLI, in-process, bridge, or
 *  sandbox-session executor that has no capture yet. An absence by construction, never a
 *  failure — and never a claim that the harness wrote nothing. */
'executor-exposes-no-transcript' |
/** Session files were found and none was carried: every path was refused, over budget,
 *  unreadable, or skipped by an abort. The `skipped` list beside this reason names each one,
 *  so "there was a transcript and it was not kept" never reads as "no transcript". */
'nothing-carried' |
/** The capture succeeded and the blob write did not. The transcript existed in memory and
 *  never reached disk; mirrors `trace-persistence-failed` on the tool-span receipt. */
'transcript-persistence-failed';
interface HarnessTranscriptUnavailable {
  readonly status: 'unavailable';
  readonly reason: HarnessTranscriptUnavailableReason;
  /** Present with `nothing-carried`: the paths that existed and why each was not read. */
  readonly skipped?: readonly {
    readonly path: string;
    readonly reason: string;
  }[];
}
/**
 * What the executor holds in memory between the read and the settle: the files, inline.
 *
 * Never journaled and never inside a result blob. The scope persists it under its own content
 * ref and records the {@link HarnessTranscriptEvidence} receipt instead, so the settlement stays
 * small and a replay pays nothing for a transcript nobody opens.
 */
type HarnessTranscriptCapture = {
  readonly status: 'captured';
  readonly artifact: HarnessTranscriptArtifact;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Non-zero when some transcript was found but deliberately not carried. */
  readonly skippedCount: number;
} | HarnessTranscriptUnavailable;
/**
 * The durable receipt on a settlement: a content-addressed pointer to a persisted
 * {@link HarnessTranscriptArtifact}, or the exact reason there is none. A SIBLING of the tool-span
 * `trace` receipt, never nested inside it — a dropped child has zero tool spans and an
 * unavailable trace, and it is precisely the child whose transcript this exists to keep.
 */
type HarnessTranscriptEvidence = {
  readonly status: 'available';
  /** Content-addressed pointer to a persisted `HarnessTranscriptArtifact` in the run's blobs. */
  readonly transcriptRef: string;
  readonly harness: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  /** Non-zero when some transcript was found but deliberately not carried. */
  readonly skippedCount: number;
} | HarnessTranscriptUnavailable;
/** The two optional environment reads the capture needs. Public because `captureHarnessTranscript`
 *  is, so a BYO executor can satisfy it with any box that offers a bounded `read` and an `exec`. */
interface ReadableEnvironment {
  readonly read?: (path: string, options?: {
    readonly signal?: AbortSignal;
  }) => Promise<string>;
  readonly exec?: (command: string, options?: Record<string, unknown>) => Promise<{
    readonly stdout?: string;
    readonly exitCode?: number;
  }>;
}
/**
 * Read the harness transcript out of one LIVE environment.
 *
 * Call this before the environment is destroyed — on the settled path that means before the
 * result is built, since the `finally` that destroys runs after. It never throws: a teardown
 * must not fail because evidence could not be collected, and every failure mode is a named
 * `reason` the settled receipt carries instead of an empty artifact that reads as coverage.
 */
declare function captureHarnessTranscript(environment: ReadableEnvironment | undefined, harness: string | undefined, signal?: AbortSignal): Promise<HarnessTranscriptCapture>;
/**
 * Persist a capture under its own content ref and return the receipt a settlement carries.
 *
 * The scope calls this, not the executor: storage stays out of every provider and destroy site,
 * exactly as the tool-span trace is persisted by `captureWorkerTraceEvidence` and not by the
 * source that collected it. A capture that is already unavailable passes through untouched.
 */
declare function persistHarnessTranscript(capture: HarnessTranscriptCapture, blobs: Pick<ResultBlobStore, 'put'>): Promise<HarnessTranscriptEvidence>;
/**
 * Rehydrate the exact persisted transcript a receipt points at, or `undefined` when the receipt
 * says there is none. Throws only when the receipt claims a blob the store does not hold — that
 * is corruption, not absence, and must not read as "no transcript".
 */
declare function harnessTranscriptArtifact(evidence: HarnessTranscriptEvidence, blobs: Pick<ResultBlobStore, 'get'>): Promise<HarnessTranscriptArtifact | undefined>;
//#endregion
//#region src/runtime/retained-interactive-types.d.ts
/** Environment and exact AgentProfile used to start one native coding-agent process. @stable */
type RetainedInteractiveEnvironmentInput = Omit<CreateAgentEnvironmentInput, 'idempotencyKey' | 'profile' | 'signal'> & {
  readonly idempotencyKey: string;
  readonly profile: AgentProfile;
};
/** Material used to create and start one native coding-agent TUI. @stable */
interface RetainedInteractiveStartMaterial {
  readonly environment: RetainedInteractiveEnvironmentInput;
  readonly interactiveIdempotencyKey: string;
  readonly initialPrompt?: string;
  readonly cwd?: string;
  readonly cols?: number;
  readonly rows?: number;
}
/** Start one retry-safe native coding-agent TUI in a new environment. @stable */
interface StartRetainedInteractiveRunOptions extends RetainedInteractiveStartMaterial {
  readonly provider: AgentEnvironmentProvider;
  /** A previously persisted intent used to replay the exact create operation. */
  readonly intent?: RetainedInteractiveIntentAdmission;
  readonly onAdmission: RetainedInteractiveAdmissionHook;
  readonly signal?: AbortSignal;
}
/** Persist each exact interactive record before the runtime proceeds. @stable */
type RetainedInteractiveAdmissionHook = (admission: RetainedInteractiveAdmission) => Promise<void>;
/** Reconstruct one exact provider-owned native coding-agent process. @stable */
interface ReconnectRetainedInteractiveRunOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly ref: AgentInteractiveSessionRef;
  readonly signal?: AbortSignal;
}
/** Recover a start after a pre-create crash or a lost provider response. @stable */
interface RecoverRetainedInteractiveRunOptions {
  readonly provider: AgentEnvironmentProvider;
  readonly admission: RetainedInteractiveIntentAdmission | RetainedInteractiveEnvironmentAdmission;
  /** Required when recovering from an intent before an environment existed. */
  readonly replay?: RetainedInteractiveStartMaterial;
  readonly onAdmission: RetainedInteractiveAdmissionHook;
  readonly signal?: AbortSignal;
}
/** Exact interactive process controls plus measured environment capabilities. @stable */
interface RetainedInteractiveRunHandle extends AgentInteractiveSession {
  readonly capabilities: AgentEnvironmentCapabilities;
  sendPrompt(command: AgentInteractiveSessionPromptCommand, options?: {
    signal?: AbortSignal;
  }): Promise<AgentInteractiveSessionPromptAcknowledgement>;
}
//#endregion
//#region src/runtime/supervise/progress.d.ts
/** How long a worker may produce no metered activity before a `progress()` read calls it stalled.
 *  Deliberately generous: a coding harness routinely spends minutes inside one tool call, and a
 *  false stall that provokes a steer is worse than a late one. */
declare const DEFAULT_STALL_AFTER_MS = 180000;
/** The most recent activity the executor can name — one tool call, one turn, or a free-form note.
 *  `label` is the tool/file/turn name; `detail` is a short, already-truncated descriptor (a path,
 *  a command head) that a driver can read without pulling the whole transcript. */
interface ActivityNote {
  readonly at: number;
  readonly kind: 'turn' | 'tool' | 'note';
  readonly label: string;
  readonly status?: 'ok' | 'error';
  readonly detail?: string;
}
/** What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every
 *  field is optional: an executor that knows only its own turn count reports only that. */
interface ExecutorProgress {
  /** The executor's own turn/step count when it is more meaningful than metered iterations. */
  readonly turns?: number;
  /** Steers/answers delivered but not yet folded into the worker's conversation. */
  readonly pendingMessages?: number;
  /** Newest-last window of what the worker has been doing. */
  readonly recentActivity?: ReadonlyArray<ActivityNote>;
  /**
   * What the executor CHANGED about what the caller declared, one short line each — an MCP config
   * it materialized, an extension it had to add for the caller's own servers to mount at all.
   *
   * Deliberately NOT part of `recentActivity`: that is a bounded newest-last ring, so a derived
   * change made before the first turn is evicted by turn 13 and gone by the time anyone looks. And
   * deliberately not only on the settled artifact: a run that fails on turn 40 never produces one,
   * yet "what was this worker actually given?" is exactly the question a failure raises. This
   * channel is append-only and readable at any moment, including from a run that never finishes.
   */
  readonly derived?: ReadonlyArray<string>;
  /** A one-line human-readable state ("turn 3, running tests"). */
  readonly note?: string;
}
/** The team a worker leads, as its own lead observes it mid-flight: every agent below the worker,
 *  at every depth. A lead reads this instead of the team's raw outputs, so the read stays bounded
 *  however large the team grows. */
interface TeamProgress {
  /** Agents spawned below the worker, at every depth. */
  readonly agents: number;
  /** Levels below the worker: `1` when it leads only workers that lead no one. */
  readonly depth: number;
  /** Agents below it that hold a worker slot and are running. */
  readonly working: number;
  /** Agents below it waiting for a worker slot. */
  readonly queued: number;
  /** Agents below it that settled done. */
  readonly done: number;
  /** Agents below it that settled down or were cancelled. */
  readonly down: number;
}
/** The full live view of one worker, as `observe_agent` returns it mid-flight. */
interface WorkerProgress {
  readonly id: string;
  readonly status: NodeStatus;
  /** True while the node is neither done, failed, nor cancelled — i.e. a steer could still land. */
  readonly live: boolean;
  /** True when this worker's executor exposes an inbox (`Executor.deliver`) — i.e. `steer_agent`
   *  can actually reach it. False means a steer would be recorded and dropped. */
  readonly steerable: boolean;
  readonly startedAt: number;
  /** Epoch ms of the last metered usage event or executor-reported activity. For a worker that
   *  leads a team, the newest activity anywhere in that team counts, its own turns included. */
  readonly lastActivityAt: number;
  readonly idleMs: number;
  /** Live, not waiting for a worker slot, and idle past `stallAfterMs`. */
  readonly stalled: boolean;
  readonly stallAfterMs: number;
  /** Metered iterations so far (the executor's own count when it reports one). */
  readonly turns: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
  };
  /** False when observed `tokens` is only a known subtotal, not a complete total — the worker did
   *  work whose token count its provider never reported. The twin of `usdKnown`, carried for the
   *  same reason: a driver reading this over `observe_agent` would otherwise read the subtotal as
   *  the measurement and conclude a busy worker was cheap. */
  readonly tokensKnown?: boolean;
  readonly usd: number;
  /** False when observed dollar spend is only a known subtotal, not a complete total. */
  readonly usdKnown?: boolean;
  readonly resources?: Spend['resources'];
  /** Steers delivered but not yet read by the worker. */
  readonly pendingMessages: number;
  /** Newest-last window of tool/turn activity; empty when the executor exposes none. */
  readonly recentActivity: ReadonlyArray<ActivityNote>;
  /** What the executor changed about the caller's declaration; absent when it changed nothing.
   *  Unlike `recentActivity` this is never evicted, so it still answers on a failed run. */
  readonly derived?: ReadonlyArray<string>;
  readonly note?: string;
  /** The team this worker leads; absent while it leads no one. */
  readonly team?: TeamProgress;
}
/** A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`. */
interface ActivityLog {
  push(note: ActivityNote): void;
  /** Newest-last, at most `limit` entries. */
  read(): ReadonlyArray<ActivityNote>;
  last(): ActivityNote | undefined;
  size(): number;
}
/** Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools. */
declare function createActivityLog(limit?: number): ActivityLog;
/** The scope-side facts about a child, independent of whether its executor cooperates. */
interface ScopeProgressInput {
  readonly id: string;
  readonly status: NodeStatus;
  readonly steerable: boolean;
  readonly startedAt: number;
  readonly lastActivityAt: number;
  readonly turns: number;
  readonly tokens: {
    readonly input: number;
    readonly output: number;
  };
  readonly tokensKnown?: boolean;
  readonly usd: number;
  readonly usdKnown?: boolean;
  readonly resources?: Spend['resources'];
  /** The team the worker leads, when it leads one. */
  readonly team?: TeamProgress;
}
/** Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the
 *  caller supplies `now`, so a test can observe a stall without waiting for one. */
declare function readWorkerProgress(scope: ScopeProgressInput, executor: ExecutorProgress | undefined, now: number, stallAfterMs?: number): WorkerProgress;
//#endregion
//#region src/runtime/supervise/retained-executor.d.ts
/**
 * Why a retained execution has no accepted terminal result, classified where the cause is still
 * a typed value rather than a string in a journal.
 *
 * One reason string used to cover two situations that call for opposite operator responses
 * (#1204): an execution whose status genuinely cannot be determined — refusing to replace it is
 * correct, and the operator must reconcile before retrying or pay twice for one turn — and a
 * provider that broke its contract, where nothing needs reconciling and the right response is to
 * fix or report the provider. Six exhibits in three days wore the first name for the second fault.
 *
 * - `'unobservable'`: the execution may have run and nothing local can say. The safety refusal.
 *   Anything unclassifiable lands here, and so does a 4xx, a not-found, or a client deadline hit
 *   AFTER admission: the provider cannot resolve what it admitted, which is exactly the case the
 *   refusal exists for, not a rejected request.
 * - `'provider-contract'`: the provider answered with something its own contract forbids — a
 *   `RetainedRunProviderContractError` naming a broken answer (an `*_INVALID`, `*_CHANGED`,
 *   `*_DUPLICATE`, `*_MISSING` code), an event bound to another run.
 * - `'request-rejected'`: the request itself was refused BEFORE it ran — a schema violation
 *   (`ZodError`), an HTTP 4xx at admission. Never named after admission.
 * - `'transport'`: the provider or a gateway in front of it failed — an HTTP 5xx, a socket
 *   error, a platform service answering with a server error. Status is in doubt only because
 *   the transport was.
 * - `'nested-recovery'`: a nested manager's own recovery could not be reconstructed. Stated by
 *   the thrower, never inferred.
 *
 * Classification reads the cause's structure — class name, `code`, HTTP `status`, a Zod issue
 * list — never its message text, because the provider is not a dependency of this package and
 * its messages are not a contract. #1204's exhibit 3 (an event without a stable id) is delivered
 * rather than thrown since agent-provider-tangle 1.4.0, so it no longer reaches this path; its
 * exhibit 6 is typed as `JsonBoundError` (`code: 'JSON_BOUND_VIOLATION'`) since 1.5.0 and lands
 * with the schema violations. A provider still throwing plain `Error`s lands on `'unobservable'`,
 * which is the safe side.
 *
 * One `RetainedRunProviderContractError` is NOT one meaning. The runtime mints it both when the
 * provider answered wrongly and when a READ of the provider failed (`RETAINED_RESULT_READ_FAILED`,
 * `RETAINED_CONTROL_REF_READ_FAILED`). The second kind is a wrapper: what it wraps decides, in a
 * post-admission context, and a wrapper around nothing classifiable is exhibit 4.
 */
type RetainedPendingCause = 'unobservable' | 'provider-contract' | 'request-rejected' | 'transport' | 'nested-recovery';
/** @internal Validated original invocation selected for live adoption by the supervisor. */
interface RetainedChildRecovery {
  readonly spawned: Extract<SpawnEvent, {
    kind: 'spawned';
  }>;
  readonly spec: AgentSpec;
  /** The node's original task, which its admitted identity digests. */
  readonly task: unknown;
  /** The admissions of the invocation being recovered. */
  readonly admissions: readonly RetainedRunAdmission[];
  readonly factory: ExecutorFactory<unknown>;
  readonly priorMaterialization?: ProfileMaterializationReceipt;
  /** The invocation being recovered, when it is a leaf's continuation rather than its first. */
  readonly continuation?: RetainedLeafContinuation;
}
/** @internal A leaf's later invocation: its own task, input and execution identity, and the
 *  environment admission of the invocation it continues. */
interface RetainedLeafContinuation {
  readonly task: unknown;
  readonly inputSeq: number;
  readonly executionId: string;
  readonly priorSession: RetainedRunEnvironmentAdmission;
}
//#endregion
//#region src/runtime/supervise/trace-source.d.ts
interface ToolStepInput {
  readonly toolName: string;
  readonly args: unknown;
  /** False when the call was observed but its original arguments were unavailable. */
  readonly argsCaptured?: boolean;
  readonly status?: 'ok' | 'error';
  /**
   * False when the source observed the call being MADE but never observed it finishing — so no
   * outcome is knowable, not even by default. Some wires (cli-bridge's OpenAI-shaped `tool_calls`
   * deltas) report the model's DECISION to call a tool and never report the call's result at all.
   * Without this marker such a call would project as `status: 'ok'` and be counted as a success in
   * every downstream error-rate read. Set it and the span carries NO status, which is the truth.
   */
  readonly statusCaptured?: boolean;
  readonly result?: unknown;
  readonly error?: string;
  /** Stable id of the tool call — used to de-duplicate the repeated state transitions a harness
   *  streams for one call (opencode emits pending→running→completed, plus a `raw`-wrapped copy). */
  readonly callId?: string;
  /** Real per-call wall-clock when the source has it (owned tool-loop; opencode parts with `time`).
   *  When omitted the span collapses to a single instant (`at`) — order + counts only, no duration. */
  readonly startedAt?: number;
  readonly endedAt?: number;
}
interface TraceSource {
  /** Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
   *  only exposes its trace at the end registers nothing and returns a no-op. */
  onSpan(handler: (span: ToolSpan) => void): () => void;
  /** The full set of tool spans for the run (SETTLE / batch). Always available. */
  collect(): Promise<ToolSpan[]>;
}
/** Decode a part with a specific harness's adapter when known, else try every registered adapter
 *  (the composite — robust to mixed/unknown streams). Never throws. */
declare function decodeToolPart(part: unknown, harness?: HarnessType): ToolStepInput | undefined;
/** A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls
 *  `record(step)` for each tool call; it becomes a span, fan-out to live subscribers + buffered for
 *  `collect`. */
declare function createPushTraceSource(opts?: {
  runId?: string;
  now?: () => number;
}): {
  source: TraceSource;
  record: (input: ToolStepInput) => ToolSpan;
};
/** A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed
 *  so this works with the real `@tangle-network/sandbox` box AND a test double, no SDK import. */
interface SessionMessageLike {
  readonly parts?: ReadonlyArray<unknown>;
}
/** The minimal box surface this needs: list a session's messages (incl. mid-turn partials). */
interface SessionTraceBox {
  messages(opts: {
    sessionId: string;
  }): Promise<ReadonlyArray<SessionMessageLike>>;
}
/** The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool
 *  calls into spans. `collect` (settle) is the solid path — `box.messages({sessionId})` → parts → spans;
 *  black-box harnesses aren't mid-step interruptible, so online steering is the owned-loop's job and a
 *  live `subscribe` is opt-in (pass `subscribeParts` from `streamPrompt` when the harness streams parts). */
declare function sandboxSessionTraceSource(box: SessionTraceBox, sessionId: string, opts?: {
  /** The box's harness (e.g. 'opencode', 'claude-code') → selects its decoder adapter. */
  harness?: HarnessType;
  subscribeParts?: (onPart: (part: unknown) => void) => () => void;
  runId?: string;
  now?: () => number;
}): TraceSource;
//#endregion
//#region src/runtime/supervise/wait.d.ts
/**
 *
 * WAIT-STATES — a supervision-tree node that waits on wall-clock time or an external condition
 * without holding a worker, an executor, a sandbox, or a single LLM turn.
 *
 * A long-horizon run spends most of its wall-clock NOT computing: waiting for CI to finish,
 * for a nightly job to land, for a human to reply, for a rate-limit window to reopen. Before
 * this, the only way to express that was to keep something alive and re-ask — which spends
 * driver tokens per re-ask and pins a process to the wait.
 *
 * Two node kinds, both first-class:
 *   - `timer` — wake at an ABSOLUTE wall-clock instant (`untilMs`).
 *   - `poll`  — re-run a named predicate every `intervalMs` until it returns true, or until an
 *               absolute `timeoutAtMs` passes (CI status, file existence, an HTTP probe, an
 *               inbox message).
 *
 * ── How this differs from `await_event`'s 15s poll fence (`DEFAULT_AWAIT_EVENT_TIMEOUT_MS`) ──
 *
 * They look similar and are not the same mechanism. `await_event` is an IN-RUN RENDEZVOUS: the
 * driver blocks on the coordination bus for the next event from a live worker, and the 15s fence
 * exists only so a remote MCP request does not exceed the client's timeout — the caller re-polls.
 * Every re-poll is another driver inference turn (real tokens) against a process that must stay
 * up, and nothing about that wait is recorded: kill the process and the wait is simply gone.
 *
 * A wait-state is a NODE, not a call. It has a node id in the tree, a journal record carrying its
 * ABSOLUTE deadline, and it settles through the same `Scope.next()` cursor as any worker. Nobody
 * is blocked on it — the driver can stop reasoning entirely, and the process can die. Cost while
 * waiting: zero LLM calls, zero executor, zero sandbox, zero conserved budget (a wait reserves
 * nothing from the pool). The only in-process residue is one timer entry.
 *
 * ── Why probes are NAMED, not passed as closures ────────────────────────────────────────────
 *
 * A wait must survive a process restart with its original deadline intact, and a closure cannot
 * be journaled. So a `poll` names its predicate (`probe: 'ci-green'`) and the run resolves it
 * through a `WaitProbeRegistry`. A brand-new process re-resolves the SAME name against its own
 * registry and re-arms the wait — which is what makes "kill the box, the wait keeps waiting"
 * true rather than aspirational.
 *
 * Absolute instants for the same reason: `untilMs` / `timeoutAtMs` are epoch ms, not durations,
 * so a resumed wait counts down from the original arm, not from the restart. `timerAt`/`pollFor`
 * build them from a duration when that is what the caller has.
 *
 * @experimental
 */
/** What a wait node is waiting for. Both variants carry ABSOLUTE epoch-ms instants so a wait
 *  re-armed by a later process keeps the deadline the first process set. */
type WaitSpec = {
  readonly kind: 'timer';
  /** Absolute epoch ms to wake at. A past instant fires immediately. */
  readonly untilMs: number;
} | {
  /** A graph-engine suspension: the host holds the content-addressed token and wakes it via
   *  `resume`/`expire`; the engine owns the transition table (agent-runtime#976). */
  readonly kind: 'token';
  readonly token: string;
  /** Absent ⇒ `onExpire: 'wait'` (never expires). */
  readonly expiresAtMs?: number;
  readonly onExpire: 'wait' | 'fail' | 'default';
  /** `onExpire: 'default'`: the pre-admitted payload the expiry resolves with. */
  readonly defaultRef?: string;
} | {
  readonly kind: 'poll';
  /** Name of the predicate in the run's `WaitProbeRegistry`. Named (not a closure) so a
   *  resumed process can re-resolve it — see the module header. */
  readonly probe: string;
  /** How often to re-run the predicate, in ms. Must be > 0. */
  readonly intervalMs: number;
  /** Absolute epoch ms after which an unfired poll settles `timeout`. Omit = no timeout
   *  (then the run's own deadline is the only bound, and a run WITH a deadline refuses an
   *  unbounded poll — see `assertWaitWithinDeadline`). */
  readonly timeoutAtMs?: number;
  /** Opaque JSON handed to the probe on every check. Journaled with the spec, so a resumed
   *  probe gets the same arguments. */
  readonly args?: Record<string, unknown>;
};
/** Build a `timer` spec from a DURATION. The instant is resolved once, at arm time — a resumed
 *  wait re-uses the journaled instant, never a fresh `now + ms`. */
declare function timerAt(ms: number, now: number): WaitSpec;
/** Build a bounded `poll` spec from a duration. */
declare function pollFor(probe: string, opts: {
  readonly intervalMs: number;
  readonly timeoutMs?: number;
  readonly args?: Record<string, unknown>;
}, now: number): WaitSpec;
/**
 * A named predicate a `poll` node re-checks. Returns true when the condition it watches has
 * flipped. A throw is treated as "not yet" (an unreachable CI endpoint is not a settled answer),
 * and is counted in the outcome's `probeErrors` so a probe that never works is visible rather
 * than silently polling forever.
 */
type WaitProbe = (args: Record<string, unknown> | undefined, signal: AbortSignal) => boolean | Promise<boolean>;
/** Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so
 *  the SAME registry a fresh run used is what a resumed run re-resolves against. */
interface WaitProbeRegistry {
  resolve(name: string): WaitProbe | undefined;
}
/** Registry over a plain name→predicate record. */
declare function createWaitProbes(entries: Record<string, WaitProbe>): WaitProbeRegistry;
/** The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the
 *  caller branches on: `'fired'` = the timer reached its instant or the predicate flipped;
 *  `'timeout'` = a bounded poll gave up. A timeout is a first-class ANSWER, not a failure — a
 *  wait only settles `down` when it is cancelled or aborted. */
interface WaitOutcome {
  /** Tag for `isWaitOutcome` — a wait outcome arrives on the same cursor as worker outputs. */
  readonly waitOutcome: true;
  readonly kind: WaitSpec['kind'];
  readonly settled: 'fired' | 'timeout';
  readonly label: string;
  /** The absolute instant this wait was armed for (timer `untilMs` / poll `timeoutAtMs`); absent
   *  for an unbounded poll. */
  readonly untilMs?: number;
  /** Epoch ms the wait was FIRST armed — preserved across a resume, so `wokenAt - armedAt` is
   *  the true end-to-end wait even when it spanned several processes. */
  readonly armedAt: number;
  readonly wokenAt: number;
  /** Predicate checks performed in the process that settled it (a resume restarts this count). */
  readonly polls: number;
  /** Probe checks that threw (counted, not fatal). */
  readonly probeErrors: number;
  /** True when a later process re-armed this wait from the journal instead of creating it. */
  readonly resumed: boolean;
}
/** Narrow a settlement's `out` to a wait outcome — a wait settles on the SAME cursor as workers,
 *  so a driver that mixes them tags them apart with this. */
declare function isWaitOutcome(value: unknown): value is WaitOutcome;
/** A wait recorded in the journal that never woke — what a resumed run re-arms. */
interface PendingWait {
  readonly id: string;
  readonly label: string;
  readonly spec: WaitSpec;
  /** The ORIGINAL arm instant. A re-armed wait keeps it, so its deadline never slides. */
  readonly armedAt: number;
  /** The wait ordinal in its parent scope, so a resumed scope continues past it. */
  readonly ordinal: number;
}
/** Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape. */
type WaitRejection = 'invalid-spec' | 'unknown-probe' | 'deadline-exceeded';
/** The absolute instant a spec is bounded by, or `undefined` for an unbounded wait. */
declare function waitUntil(spec: WaitSpec): number | undefined;
/** Structural validation, independent of the run. Returns null when the spec is usable. */
declare function validateWaitSpec(spec: WaitSpec): string | null;
//#endregion
//#region src/sanitize.d.ts
/** @stable */
interface RuntimeTelemetryOptions {
  /**
   * Include raw task inputs. Off by default because task inputs often contain
   * customer facts, credentials, source text, or internal IDs.
   */
  includeInputs?: boolean;
  /** Include requirement descriptions. Secret requirements are always redacted. */
  includeRequirementDescriptions?: boolean;
  /** Include evidence IDs. Off by default; counts are safer for shared reports. */
  includeEvidenceIds?: boolean;
  /** Include user answers from question preflight. Off by default. */
  includeUserAnswers?: boolean;
  /** Include action payloads and action results for control steps. Off by default. */
  includeControlPayloads?: boolean;
  /** Include task metadata. Off by default because metadata may carry IDs or policy internals. */
  includeMetadata?: boolean;
  /** Include eval detail/evidence strings. Off by default because validators may echo private input. */
  includeEvalDetails?: boolean;
}
/** @stable */
interface SanitizedKnowledgeRequirement {
  id: string;
  description?: string;
  requiredFor: string[];
  category: KnowledgeRequirement['category'];
  acquisitionMode: KnowledgeRequirement['acquisitionMode'];
  importance: KnowledgeRequirement['importance'];
  freshness: KnowledgeRequirement['freshness'];
  sensitivity: KnowledgeRequirement['sensitivity'];
  confidenceNeeded: number;
  currentConfidence: number;
  evidenceCount: number;
  evidenceIds?: string[];
  fallbackPolicy: KnowledgeRequirement['fallbackPolicy'];
}
/** @stable */
interface SanitizedKnowledgeReadinessReport {
  taskId: string;
  readinessScore: number;
  recommendedAction: KnowledgeReadinessReport['recommendedAction'];
  severity: KnowledgeReadinessReport['severity'];
  reason: string;
  blockingMissingRequirements: SanitizedKnowledgeRequirement[];
  nonBlockingGaps: SanitizedKnowledgeRequirement[];
  evidenceCount: number;
  evidenceIds?: string[];
  missingRequirementIds: string[];
}
/** Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission. @stable */
declare function sanitizeKnowledgeReadinessReport(report: KnowledgeReadinessReport, options?: RuntimeTelemetryOptions): SanitizedKnowledgeReadinessReport;
/** Reduce an `AgentRuntimeEvent` to a PII-safe, serializable plain object for telemetry. @stable */
declare function sanitizeAgentRuntimeEvent<TState, TAction, TActionResult, TEval extends ControlEvalResult>(event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>, options?: RuntimeTelemetryOptions): Record<string, unknown>;
/** Reduce a `RuntimeStreamEvent` to a PII-safe, serializable plain object for telemetry. @stable */
declare function sanitizeRuntimeStreamEvent(event: RuntimeStreamEvent, options?: RuntimeTelemetryOptions): Record<string, unknown>;
/** @stable */
interface RuntimeEventCollector<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult> {
  onEvent: (event: AgentRuntimeEvent<TState, TAction, TActionResult, TEval>) => void;
  events: Array<Record<string, unknown>>;
}
/** @stable */
type RuntimeStreamEventSink = (event: RuntimeStreamEvent) => void;
/** @stable */
interface RuntimeStreamEventSummary {
  /** Total count of sanitized events collected. */
  eventCount: number;
  /** Count of events per `type`. Useful for log-line summaries. */
  eventCountsByType: Record<string, number>;
  /** First session id observed in a `session_created` / `session_resumed` event, if any. */
  firstSessionId?: string;
  /** Last `final` event's status, if a final event was observed. */
  finalStatus?: AgentTaskStatus;
  /** Last `final` event's reason, if a final event was observed. */
  finalReason?: string;
  /** Concatenated `text_delta.text` across the stream, even when payloads are redacted. */
  finalText: string;
}
/** @stable */
interface RuntimeStreamEventCollector {
  onEvent: RuntimeStreamEventSink;
  events: Array<Record<string, unknown>>;
  /** Snapshot of a small streaming-flavored summary derived from collected events. */
  summary(): RuntimeStreamEventSummary;
}
/** Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection. @stable */
declare function createRuntimeEventCollector<TState = unknown, TAction = unknown, TActionResult = unknown, TEval extends ControlEvalResult = ControlEvalResult>(options?: RuntimeTelemetryOptions): RuntimeEventCollector<TState, TAction, TActionResult, TEval>;
/**
 *
 * Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
 * event yielded by `runAgentTaskStream` through `onEvent` and read the
 * sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
 * flags apply. Kept distinct from `createRuntimeEventCollector` because the
 * stream and non-stream event shapes overlap on `type` literals — dispatching
 * on `type` alone would misroute events.
 *
 * @stable
 */
declare function createRuntimeStreamEventCollector(options?: RuntimeTelemetryOptions): RuntimeStreamEventCollector;
//#endregion
//#region src/otel-export.d.ts
interface OtelExportConfig {
  /** OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default. */
  endpoint?: string;
  /** OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default. */
  headers?: Record<string, string>;
  /** Batch size before flush. Default 64. */
  batchSize?: number;
  /** Flush interval ms. Default 5000. */
  flushIntervalMs?: number;
  /**
   * Most spans held at once, queued plus in flight. Default 2048, the OpenTelemetry batch
   * processor's own default. A span that arrives when the queue is full is dropped and counted in
   * {@link OtelExportStats.dropped}, so a stalled collector costs a bounded amount of memory.
   */
  maxQueueSize?: number;
  /** Milliseconds one POST may take before it is abandoned and its spans count as dropped. Default 10000. */
  timeoutMs?: number;
  /** Resource attributes stamped on every export. */
  resourceAttributes?: Record<string, string | number | boolean>;
  /** Service name. Default 'agent-runtime'. */
  serviceName?: string;
}
interface OtelExporter {
  /** Export a span. Never throws: a sink that cannot take the span counts it as dropped. */
  exportSpan(span: OtelSpan): void;
  /**
   * Deliver everything queued so far. Rejects when spans were dropped since the previous `flush`,
   * naming how many and the last error, because a caller that awaits delivery is owed the answer.
   */
  flush(): Promise<void>;
  /** Stop accepting spans and deliver what is queued. Never rejects. */
  shutdown(): Promise<void>;
  /** What this sink has delivered and lost so far. */
  stats(): OtelExportStats;
}
/**
 * Delivery accounting for one exporter. `written + dropped + pending` covers every span handed to
 * `exportSpan`, so a trace that arrives short can be told apart from a run that emitted less.
 */
interface OtelExportStats {
  /** Spans the sink confirmed: a 2xx collector response, or a completed file append. */
  written: number;
  /** Spans lost: refused by the collector, failed in transit, over the queue bound, or unwritable. */
  dropped: number;
  /** Spans accepted and not yet written or dropped. */
  pending: number;
  /** The most recent failure, when there has been one. */
  lastError?: string;
}
interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind?: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes?: OtelAttribute[];
  status?: {
    code: number;
    message?: string;
  };
}
interface OtelAttribute {
  key: string;
  value: {
    stringValue?: string;
    intValue?: string;
    doubleValue?: number;
    boolValue?: boolean;
  };
}
/**
 * Create an exporter that APPENDS spans to a local OpenInference-JSONL file, one complete span per
 * line, instead of posting them to a collector.
 *
 * Why this exists beside {@link createOtelExporter}: that one needs an OTLP endpoint, so a run on a
 * laptop, in CI, or inside a sandbox with no collector emits nothing and its per-turn shape is
 * simply lost. The journal records the TREE (who spawned whom, what settled, what it spent); it
 * does not record what happened inside a turn. A run whose tree is readable but whose turns are not
 * is exactly the state that made an observability gap invisible until someone went looking.
 *
 * The line shape is the one `@tangle-network/traces` reads (`spans.otlp.jsonl`) and is a standard
 * OpenInference representation, so the same file feeds any OpenInference tool with no conversion:
 * snake_case identity fields, ISO-8601 times, `parent_span_id` empty at the root, and attributes as
 * a plain object rather than OTLP's key/value array.
 *
 * Appends synchronously per span so a killed process keeps every span it had already finished —
 * matching the spawn journal's durability posture, since a trace that only survives a clean exit is
 * useless for the runs you most want to look at.
 */
declare function createOpenInferenceFileExporter(filePath: string): OtelExporter;
/**
 * Create an OTLP/HTTP exporter. Returns undefined when no endpoint is configured.
 *
 * One batch is in flight at a time; spans that arrive meanwhile wait in a queue bounded by
 * `maxQueueSize`. Every span ends in exactly one of `written` or `dropped`: a non-2xx response, a
 * network error, a timeout, an OTLP `partialSuccess.rejectedSpans` count and a full queue each count
 * as drops and set `lastError`. Nothing here throws into the caller's run; `flush()` reports the
 * loss, the same rule {@link createOpenInferenceFileExporter} follows.
 */
declare function createOtelExporter(config?: OtelExportConfig): OtelExporter | undefined;
/**
 * Convert a LoopTraceEvent into an OtelSpan for export.
 */
declare function loopEventToOtelSpan(event: {
  kind: string;
  runId: string;
  timestamp: number;
  payload: object;
}, traceId: string, parentSpanId?: string): OtelSpan;
interface RuntimeEventOtelOptions extends RuntimeTelemetryOptions {
  /** Final customer redactor applied after the schema-aware runtime sanitizer. */
  redact?: (value: unknown) => unknown;
}
/** Convert normalized runtime events into lossless, redacted child spans. */
declare function buildRuntimeEventOtelSpans(events: ReadonlyArray<RuntimeStreamEvent>, traceId: string, parentSpanId?: string, options?: RuntimeEventOtelOptions): OtelSpan[];
/**
 * Sink-neutral node in a reconstructed loop span tree. The root node's
 * `parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
 * mapper attaches the inherited delegation span; the delegation journal
 * leaves it as the tree root).
 */
interface LoopSpanNode {
  spanId: string;
  parentSpanId?: string;
  /** `'loop'` | `'loop.round'` | `'loop.iteration'`. */
  name: string;
  /** Topology level: loop root, plan round, or iteration branch. */
  kind: 'loop' | 'round' | 'branch';
  startMs: number;
  endMs: number;
  attrs: Record<string, string | number | boolean>;
  /** True when the iteration carried an error — maps to OTEL status code 2. */
  error: boolean;
}
/**
 * Build a nested, real-duration OTLP span tree for ONE loop run from its full
 * ordered `LoopTraceEvent` stream. Unlike `loopEventToOtelSpan` (one flat,
 * zero-duration span per event), this reconstructs the topology hierarchy a
 * GenAI trace viewer renders natively:
 *
 *   loop (invoke_workflow)
 *     └─ loop.round[k] (invoke_workflow)   ← tangle.loop.move.{kind,width,rationale}
 *          ├─ loop.iteration[i] (invoke_agent)  ← gen_ai.agent.name + usage + verdict + placement
 *          └─ …
 *
 * Attributes follow the current GenAI semconv (`gen_ai.*`) where they apply and
 * a namespaced `tangle.loop.*` / `tangle.cost.usd` extension for topology /
 * verdict / placement / cost (not yet standardized). Pure: feed it a buffered
 * per-runId event array (e.g. flushed on `loop.ended`) and export the result.
 */
declare function buildLoopOtelSpans(events: ReadonlyArray<{
  kind: string;
  runId: string;
  timestamp: number;
  payload: object;
}>, traceId: string, rootParentSpanId?: string, redact?: (value: unknown) => unknown): OtelSpan[];
/**
 * Sink-neutral core behind {@link buildLoopOtelSpans}: reconstruct the
 * loop → round → branch span tree from one run's ordered `LoopTraceEvent`
 * stream. Consumed by the OTEL mapper above and by the MCP delegation
 * journal's compact trace tee — one topology reconstruction, two sinks.
 * Tolerates partial streams (a run that never reached `loop.ended` closes
 * at the last observed event's timestamp).
 */
declare function buildLoopSpanNodes(events: ReadonlyArray<{
  kind: string;
  runId: string;
  timestamp: number;
  payload: object;
}>, redact?: (value: unknown) => unknown): LoopSpanNode[];
/**
 * Convert a flat record into the OTLP attribute list. Non-finite numbers are DROPPED (an OTLP
 * `doubleValue` of `NaN`/`Infinity` is not representable), integers ride as `intValue`. Exported so
 * a producer that mints its own `OtelSpan` (the supervisor span recorder) builds attributes exactly
 * the way every span in this file does, rather than re-deriving the encoding.
 */
declare function toOtelAttributes(record: Record<string, string | number | boolean>): OtelAttribute[];
/**
 * Map a caller-supplied span id onto the 16-hex OTLP encoding. An id that is already a valid W3C
 * span id passes through UNCHANGED — that is what lets an inherited `PARENT_SPAN_ID`/`TRACEPARENT`
 * id keep parenting the same trace. A DASHED hex id (a UUID-form id) passes through dash-stripped:
 * that is the exact wire id every earlier release exported for it, so cross-version joins survive
 * the strict-W3C upgrade. Anything else (a human run id) is DERIVED via the zero-dep contract's
 * `deriveHexId`, the one legal derivation: the old slice-and-pad produced ids that embedded the
 * raw input in the wire id and were not even valid hex (the contract's own `non-hex-id` validator
 * rejected what this module exported). Exported as the ONE wire-id normalization every writer
 * shares — `traceContextToEnv` builds the child's `TRACEPARENT` through these same functions, so
 * a parent's exported spans and the context it hands its children always name the same trace.
 */
declare function padSpanId(id: string): string;
/** Trace-id counterpart of {@link padSpanId}: valid W3C trace ids pass through (dash-stripped when
 *  UUID-form, preserving the pre-strict-W3C wire id), everything else is derived with
 *  `deriveHexId(id, 16)` so every process derives the SAME wire id for the same run. */
declare function padTraceId(id: string): string;
/** Mint a fresh 16-hex-character OTLP span id. Exported so a producer that must know a span's id
 *  BEFORE the span closes (a node opened at spawn and parented by its children) uses this one
 *  generator instead of a second copy of it. */
declare function generateSpanId(): string;
//#endregion
//#region src/mcp/trace-propagation.d.ts
interface TraceContext {
  /** Trace id inherited from the parent process, or a fresh one. */
  traceId: string;
  /** Parent span id from the delegation that launched this MCP server. */
  parentSpanId?: string;
  /** True when NO context reached this process and the trace id is a fallback mint — the hop
   *  above this process is severed. Span trees emitted under this context are stamped
   *  `tangle.trace.unpropagated=true` so the severed hop is queryable. */
  unpropagated?: boolean;
}
/**
 * Read trace context from a process environment (defaults to `process.env`).
 * `TRACEPARENT` wins; the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair is the fallback; with
 * neither present a fresh root is generated AND marked `unpropagated` — see {@link TraceContext}.
 */
declare function readTraceContextFromEnv(env?: Record<string, string | undefined>): TraceContext;
/**
 * Create a LoopTraceEmitter that:
 *   1. Parents all spans under the inherited parent span id.
 *   2. Exports spans to OTEL when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 *
 * Returns both the emitter and the optional exporter handle for shutdown.
 */
declare function createPropagatingTraceEmitter(ctx: TraceContext): {
  emitter: LoopTraceEmitter;
  exporter: OtelExporter | undefined;
  context: TraceContext;
};
/**
 * Build env vars to pass to a child subprocess so it inherits the current trace context.
 *
 * Writes BOTH conventions (see the module doc): `TRACEPARENT` carries the W3C-hex ids — mapped
 * through the exporter's own `padTraceId`/`padSpanId` (dashed hex passes through dash-stripped, a
 * human id is derived through the contract's `deriveHexId`), the SAME normalization every emitted
 * span uses, so both spellings and the parent's own spans all name ONE trace — and the legacy
 * pair carries the caller's ids verbatim. `TRACEPARENT` needs a parent span id by grammar; when
 * the context has none, the legacy pair still propagates the trace id alone.
 */
declare function traceContextToEnv(ctx: TraceContext): Record<string, string>;
/**
 * Merge a spawned child's environment from lowest to highest precedence — ambient env, the
 * recorder's stamped trace env, the caller's own overrides — while keeping the ONE cross-key
 * invariant a plain spread cannot: `TRACEPARENT` and the legacy pair must name the SAME trace.
 * A caller override that declares `TRACE_ID` / `PARENT_SPAN_ID` without its own `TRACEPARENT`
 * would otherwise keep the recorder's W3C wire — the child would join the caller's trace on the
 * legacy pair and the RECORDER's on the standard one. The dual-write is performed on the
 * caller's behalf: the merged `TRACEPARENT` is rebuilt from the merged legacy pair through the
 * same {@link traceContextToEnv} derivation (`deriveHexId` for human ids), or dropped when no
 * parent span id survives the merge (the W3C grammar requires one).
 */
declare function mergeTraceEnv(ambient: Record<string, string | undefined>, traceEnv: Record<string, string>, overrides?: Record<string, string>): Record<string, string | undefined>;
//#endregion
//#region src/runtime/supervise/worker-trace.d.ts
/**
 * Seam key the `Scope` seeds a {@link TraceContext} under on each child's `ExecutorContext.seams`.
 * Single-sourced here so the scope and every backend agree on it without a circular import — the
 * same arrangement `nestedScopeSeamKey` uses.
 */
declare const workerTraceSeamKey = "worker-trace";
/**
 * Resolve the trace context a worker spawned BY `spawningNodeId` should inherit. `undefined` means
 * this run records no spans, so nothing is stamped. Supplied by
 * `SupervisorSpanRecorder.workerTrace` and threaded to the scope as `SupervisorOpts.workerTrace`.
 */
type WorkerTraceResolver = (spawningNodeId: string) => TraceContext | undefined;
/**
 * What the two readers below need off an `ExecutorContext` — its seam bag, and nothing else.
 * Structural (not an `ExecutorContext` import) so this module stays free of the keystone type
 * surface, and exported because it is part of a public signature.
 */
interface WorkerTraceSeamCarrier {
  readonly seams: Readonly<Record<string, unknown>>;
}
/**
 * Read the inherited trace context off an `ExecutorContext`, or `undefined` when the run records no
 * spans. Fails CLOSED on a malformed seam value (returns `undefined`) rather than stamping a
 * half-formed id that would produce an unjoinable orphan span downstream.
 */
declare function readWorkerTraceContext(ctx: WorkerTraceSeamCarrier): TraceContext | undefined;
/**
 * The trace env to merge into a worker's environment — `TRACEPARENT` plus the legacy
 * `TRACE_ID` / `PARENT_SPAN_ID` pair (dual-written for one release) — EMPTY when the run
 * records no spans, which is what keeps the untraced path byte-identical. Merge it BELOW the
 * caller's own seam env so a deliberately-set id wins (see the precedence note above).
 */
declare function workerTraceEnv(ctx: WorkerTraceSeamCarrier): Record<string, string>;
/**
 * The trace request headers for a worker dispatched over the cli-bridge HTTP transport — W3C
 * `traceparent` plus the legacy `x-trace-id` / `x-parent-span-id` pair the bridge also reads —
 * EMPTY when the run records no spans, which keeps the untraced request byte-identical. Derived
 * from the same dual-write the env channel uses ({@link workerTraceEnv}), so the header and env
 * spellings can never name different traces. `traceparent` is present only when a parent span id
 * exists (the W3C grammar requires one); the legacy pair still carries a lone trace id.
 */
declare function workerTraceHeaders(ctx: WorkerTraceSeamCarrier): Record<string, string>;
//#endregion
//#region src/runtime/supervise/types.d.ts
/** Options for `Scope.wait`. `label` is the wait's identity within its parent scope — it is what
 *  a resumed run matches to re-adopt a journaled, still-unfired wait, so it must be stable across
 *  processes (a label derived from wall-clock would resume as a NEW wait). */
interface WaitOpts {
  readonly label: string;
}
/**
 * One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver
 * is an `Agent` whose `act` spawns children and reacts to them via `scope.next()`. An
 * analyst is an `Agent` whose task is "read these traces → findings" — `where` it runs
 * is its executor, not a separate type.
 *
 * `act` MUST be replay-safe: it may read `verdict`, `spent`, and `out` (rehydrated by
 * `outRef`) off each `Settled`; it MUST NOT read `Date.now`, `Math.random`, or any
 * unordered collection. `scope.next()` delivers strictly in recorded `seq` order.
 */
interface Agent<Task, Out> {
  readonly name: string;
  act(task: Task, scope: Scope<Out>): Promise<Out>;
  /**
   * Optional manager inbox. A parent or attached `RootHandle` uses this to deliver the same raw
   * down-message accepted by executor inboxes. Return `false` when the manager has no live receive
   * path; returning `true` means the message was accepted for the current manager session.
   */
  deliver?(msg: unknown): void | boolean;
  /** Optional live tool evidence exposed by executors that can observe it. */
  traceSource?(): TraceSource | undefined;
  /** Optional live execution progress exposed by executors that can observe it. */
  progress?(): ExecutorProgress | undefined;
  /**
   * Optional capture of this agent's own harness session, for an agent that runs a harness as a
   * manager. A driver child forwards it to its executor, so the manager settles with the same
   * receipt a leaf gets instead of `executor-exposes-no-transcript`.
   */
  harnessTranscript?(): HarnessTranscriptCapture | undefined;
}
/**
 * The leaf runtime — ONE open interface, not a closed union. `execute` returns a
 * `Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
 * streaming ones; a streaming executor reports incremental normalized usage as it runs
 * (the budget pool reconciles against it) and exposes its terminal artifact via
 * `resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
 * meters every runtime identically.
 *
 * Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
 * Router/HTTP inference call, no box), sandbox (COMPOSES `runAgentRounds` as a leaf, forwarding
 * PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
 * (Halo/RLM subprocess; `budgetExempt`, refused by budgeted supervision). A user's
 * own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.
 */
interface Executor<Out> {
  /** Stable runtime tag for traces + the equal-k exemption check. */
  readonly runtime: Runtime;
  /**
   * When true, this executor cannot report the usage a conserved pool would need (for example, a
   * subscription CLI with no token receipt). `Executor` can still be used directly, but `Scope`
   * refuses it before `execute` so unknown compute can never appear as measured zero in a
   * supervised or equal-resource run. A metered executor MUST report usage.
   */
  readonly budgetExempt?: boolean;
  /**
   * One-shot → resolves a `ExecutorResult`; streaming → yields incremental `UsageEvent`s and
   * the terminal artifact is read from `resultArtifact()` after the stream drains.
   * `signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).
   */
  execute(task: unknown, signal: AbortSignal): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>;
  /** Reattach the exact journaled execution. This must never start replacement work. */
  recover?(task: unknown, signal: AbortSignal): Promise<ExecutorResult<Out>> | AsyncIterable<UsageEvent>;
  /**
   * Optional inbox: receive an out-of-band message from the driver mid-run (the `send`/`steer_agent`
   * verb). A streaming executor drains pending messages between turns and folds them into the next
   * step (a steer / interrupt / resume). A one-shot executor that can't be steered mid-flight omits
   * this; `Scope.send` then returns `false` for it. Never throws — an inbox that rejects a malformed
   * message returns `false`, and that refusal propagates to the caller.
   */
  deliver?(msg: unknown): void | boolean;
  /**
   * Optional LIVE progress: what this worker is doing RIGHT NOW, read synchronously and
   * cheaply while `execute` is still streaming. The scope already derives activity timing,
   * turns, and spend from the metered usage stream for EVERY executor; this adds only what
   * the executor alone knows — the harness's tool/file activity, its own turn count, and how
   * many delivered steers it has not yet folded in. Never throws; a read that cannot be
   * answered returns `undefined`.
   *
   * This is the observe half of steering: `deliver` lets a driver correct a worker, and this
   * is the evidence it corrects FROM. An executor that implements neither cannot be supervised
   * mid-flight — it can only be waited on.
   */
  progress?(): ExecutorProgress | undefined;
  /**
   * Optional live tool-call trace for the ONLINE detectors (`watchTrace`). An executor that
   * can see its worker's tool calls exposes them here, so a supervisor can run the streaming
   * repeated-action / error-streak panel over a RUNNING worker and raise a `finding` the
   * moment it loops, instead of discovering it at settle. Omitted = no online detection for
   * this runtime (the settle-time analyzers still work).
   */
  traceSource?(): TraceSource | undefined;
  /**
   * The exact interactive process this worker runs in, when its execution was started in an
   * attachable terminal. Read through `Scope.interactive`; synchronous and side-effect free, and
   * it must not throw. Omitting it is the honest answer for every headless executor: omission
   * reads as `executor-exposes-no-interactive-session`, never as an empty handle.
   */
  interactive?(): WorkerInteractiveSession;
  /** Optional readiness signal for an executor whose exact interactive handle is created inside
   * `execute`. It resolves once to an available handle or a terminal unavailable reason. */
  interactiveReady?(): Promise<WorkerInteractiveSession>;
  /**
   * Optional provider-neutral CANCELLATION, distinct from `teardown`: it asks the backend to stop
   * the work and reports what the backend acknowledged, so a caller never has to read a local
   * iterator abort as remote acceptance. `teardown` remains the resource verb — it releases what
   * this process holds and says nothing about remote compute or billing.
   *
   * An executor that cannot ask its backend anything omits this method; one whose backend has no
   * cancel operation implements it and answers `unknown` with the reason in `detail`.
   */
  cancel?(request: ExecutorCancellationRequest): Promise<ExecutorCancellation>;
  /**
   * Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
   * (`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).
   */
  teardown(grace: number | 'brutalKill' | 'infinity'): Promise<{
    destroyed: boolean;
    /** Why the resource could not be proven destroyed. Present only with `destroyed: false`, so a
     *  caller reporting an unconfirmed teardown can name the cause instead of a bare flag. */
    detail?: string;
    /** With `destroyed: false`: asking again cannot change this answer, because the executor
     *  keeps the resource on purpose (a workspace preserved for lack of a verified receipt, an
     *  execution held for reconciliation) or cannot destroy it at all. The settlement retry stops
     *  asking. */
    permanent?: boolean;
  }>;
  /**
   * Optional acknowledgement window for a remote cleanup requested as `'brutalKill'`.
   * Local executors keep the short default; remote executors may need bounded network time.
   */
  teardownTimeoutMs?: number;
  /**
   * Optional release of a RETAINED execution that no later process will recover.
   *
   * `teardown` keeps a pending retained execution's environment alive by construction: the paid
   * work inside it is what a resumed run reconciles. Once the root has reached its own terminal
   * outcome nothing will, and the environment is a leak — measured 2026-09-11, four settled runs
   * held 18 of a 60-slot fleet for 19 to 37 hours this way. The supervisor calls this at root
   * settlement, never on a resumable interruption (an explicit cancellation, a process crash), and
   * journals one `environment-teardown` receipt per environment returned. `signal` bounds the
   * attempt; an executor that holds no retained execution answers with no receipts. After a
   * `destroyed: true` receipt the executor's `teardown` must answer `destroyed: true` as well.
   */
  releaseRetained?(signal: AbortSignal): Promise<ReadonlyArray<EnvironmentTeardownReceipt>>;
  /**
   * The provider environments this executor still holds and has not confirmed destroyed. Read
   * synchronously when a teardown stays unconfirmed, so the run can name each environment a
   * sweeper must delete even when the provider never answered. Never throws. An executor that
   * holds no provider environment omits the method.
   */
  heldEnvironments?(): ReadonlyArray<HeldEnvironment>;
  /**
   * The replay source (B1): the content-addressed `outRef` + the materialized output the
   * driver branched on, its verdict, and the conserved spend. Read once, after settle.
   */
  resultArtifact(): {
    outRef: string;
    out: Out;
    verdict?: DefaultVerdict;
    spent: Spend;
    teardown?: ExecutorTeardownWarning;
  };
  /**
   * Optional accounting split for recursive executors.
   * `reported` is the child-work spend written on this node's settlement; `reservation` is the
   * whole amount reconciled against this node's parent reservation.
   * They differ when a driver owns a nested allocation: its child work and own inference consume
   * that allocation together, while the journal keeps those two categories separate.
   * Valid after `execute` resolves or throws; ordinary leaf executors omit it.
   */
  accounting?(): ExecutorAccounting | undefined;
  /**
   * A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
   * events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
   * the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
   * (the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
   * trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
   * executors omit it (returns `undefined`).
   */
  metered?(): Spend | undefined;
  /**
   * The child's OWN harness transcript, read out of its environment while that environment was
   * still live. Read on settle, valid after `execute` resolves OR throws — the throw half is the
   * point: a child that drops produces no result artifact, so before this the only carrier was
   * the settled result and a dropped child's reasoning died with its box (#1244).
   *
   * An executor with no transcript to offer omits the method entirely; the settle path then
   * records `executor-exposes-no-transcript` rather than an empty artifact that reads as
   * coverage. Never throws. Returns the in-memory capture; the SCOPE persists it under its own
   * content ref and settles the receipt, so no executor ever learns about storage.
   */
  harnessTranscript?(): HarnessTranscriptCapture | undefined;
}
/** Why Runtime cannot provide structured tool-call evidence for one settled execution. */
type WorkerTraceUnavailableReason = 'execution-did-not-start' | 'executor-did-not-expose-trace-source' | 'trace-source-unavailable' | 'no-tool-spans-captured' | 'invalid-tool-spans' | 'trace-collection-failed' | 'trace-persistence-failed' | 'legacy-settlement-without-trace-evidence' | 'not-an-executor';
/** Durable proof of a worker's structured tool trace, or the exact reason it is unavailable. */
type WorkerTraceEvidence = {
  readonly status: 'available';
  /** Content-addressed pointer to a persisted `WorkerToolTraceArtifact`. */
  readonly traceRef: string;
  readonly spanCount: number;
} | {
  readonly status: 'unavailable';
  readonly reason: WorkerTraceUnavailableReason;
};
/** Why Runtime cannot hand a caller the exact interactive process one worker runs in. */
type WorkerInteractiveUnavailableReason =
/** No child of this scope carries that node id. */
'unknown-node' |
/** The child settled, was cancelled, or is a wait-state node: there is no process to attach to. */
'not-live' |
/** The worker runs headless. Its executor exposes no interactive session, so there is no
 *  terminal — a headless execution is never converted into an attachment. */
'executor-exposes-no-interactive-session' |
/** The executor is backed by a runner whose provider publishes no interactive-session contract
 *  (the local CLI Bridge today), so no process can be attached to even though one is running. */
'provider-has-no-interactive-contract' |
/** The runner supports interactive sessions but this execution was not started in one. Part of
 *  the `Executor` PORT vocabulary: `Scope.interactive` keeps whatever reason an executor's own
 *  `interactive()` returns, so any executor — including one implemented outside this package —
 *  answers with it. No first-party executor emits it yet: the sandbox arm must first ask its
 *  provider whether it supports control, which agent-runtime#773 tracks. */
'interactive-session-not-started' |
/** A durable worker exists, but its process predates the exact binding contract or failed to
 *  publish one. Runtime never guesses a provider session from conversation metadata. */
'interactive-binding-not-found' |
/** The exact durable reference no longer resolves to a running provider process. */
'interactive-binding-stale' |
/** The binding names a provider that this process did not register. */
'interactive-provider-not-registered';
/**
 * One worker's attachable process, or the named reason there is none.
 *
 * `available` carries the exact `RetainedInteractiveRunHandle` bound to THAT child's admitted
 * execution: input, resize, ordered replay, detach, and an acknowledged close all check every
 * provider answer against the session reference, so a second process that merely resumes the same
 * conversation cannot present itself as this one. `unavailable` names why, and is never a handle.
 */
type WorkerInteractiveSession = {
  readonly status: 'available';
  readonly handle: RetainedInteractiveRunHandle;
} | {
  readonly status: 'unavailable';
  readonly reason: WorkerInteractiveUnavailableReason;
};
/** One cancellation ask. `operationId` makes the request idempotent per attempt, exactly as the
 *  worker and retained layers already key their cancellations. */
interface ExecutorCancellationRequest {
  readonly operationId: string;
  readonly reason?: string;
  /** Deadline for the acknowledgement itself. Its expiry produces `unknown`, never a claim. */
  readonly signal?: AbortSignal;
}
/**
 * What a backend acknowledged about one cancellation ask.
 *
 * `status` is the backend's answer to the ASK; `effect` is what is now known about the RUN, in the
 * one cancellation vocabulary the worker and retained layers already use. A local abort with no
 * provider acknowledgement is `{ status: 'unknown', effect: 'cancel_requested' }` — never
 * `accepted`.
 */
interface ExecutorCancellation {
  readonly status: 'accepted' | 'rejected' | 'already-terminal' | 'unknown';
  readonly effect: RetainedRunEffect;
  /** When the acknowledgement was observed, ISO-8601. */
  readonly observedAt: string;
  /** Why the backend answered this way — required reading for `unknown`. */
  readonly detail?: string;
  /** Backend-native proof, persisted by digest only. */
  readonly evidence?: unknown;
}
/** Split used by a recursive executor when journaled child work differs from the full amount
 * reconciled against its parent reservation. */
interface ExecutorAccounting {
  readonly reported: Spend;
  readonly reservation: Spend;
}
/** Terminal artifact of a one-shot `Executor.execute`. */
interface ExecutorResult<Out> {
  /** Explicit execution outcome; application output and scoring verdicts do not determine failure.
   *  `errorCode` is the provider's machine code for a failure when it reported one. A retry policy
   *  reads the code, never the human `error` text. */
  outcome?: Pick<AgentTurnResult, 'success' | 'error'> & {
    errorCode?: string;
  };
  outRef: string;
  out: Out;
  verdict?: DefaultVerdict;
  spent: Spend;
  /** A resource teardown that failed AFTER this result settled. Present ONLY on that path, and it
   *  never changes the outcome: the turn completed, the artifact is real, and the spend is what was
   *  metered. See {@link ExecutorTeardownWarning}. */
  teardown?: ExecutorTeardownWarning;
}
/**
 * A teardown failure recorded BESIDE a settled result rather than in place of it.
 *
 * The measured failure: a provider environment's second DELETE answered 409, the rejection escaped
 * the executor's `finally`, and a run whose turn had completed (`spent.iterations: 1`, artifact
 * produced) was reported as a failure. Once the stream has yielded its terminal event the result is
 * SETTLED; what happens to the resource afterwards is an operational fact about the resource, not a
 * verdict on the work. The run keeps its outcome and carries this warning, which is the same
 * distinction `teardown-unconfirmed` already draws for a child whose cleanup was never acknowledged.
 */
interface ExecutorTeardownWarning {
  readonly failed: true;
  /** What the teardown threw, as text. */
  readonly error: string;
  /** ISO timestamp of the failed attempt. */
  readonly at: string;
}
/** One provider environment an executor holds, named by the provider's own id. */
interface HeldEnvironment {
  readonly provider: string;
  /** The provider-issued environment id — the id a fleet listing shows and a delete takes. */
  readonly environmentId: string;
  /**
   * Why the environment is held on purpose; absent when it is held only because its destroy was
   * not confirmed. A sweeper never deletes a kept environment.
   * - `resume`: a retained execution kept so a resumed run can reconcile the paid work inside it.
   * - `evidence`: a workspace preserved because the execution has no verified workspace receipt.
   */
  readonly keptFor?: 'resume' | 'evidence';
}
/**
 * The receipt for one provider environment an executor held for a RETAINED execution and was
 * asked to release at root settlement (see {@link Executor.releaseRetained}). One receipt per
 * environment, naming the provider's own id, so a fleet listing can be reconciled against what
 * the run says it released. `destroyed: false` carries why in `detail`.
 */
interface EnvironmentTeardownReceipt {
  readonly provider: string;
  /** The provider-issued environment id — the same id the `execution-admitted` record carries. */
  readonly environmentId: string;
  readonly destroyed: boolean;
  /** Why the environment could not be proven destroyed; present exactly when `destroyed` is
   *  false. */
  readonly detail?: string;
  /** With `destroyed: false`: another release cannot change this answer, because the executor
   *  keeps the environment on purpose or cannot destroy it at all. The settlement retry stops
   *  asking. */
  readonly permanent?: boolean;
}
/**
 * Normalized usage event — the single channel every executor reports through, so the
 * conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
 * `{ input, output }` plus an optional provider cache split; `usd` is a SEPARATE channel (never
 * folded into tokens).
 *
 * Either channel can explicitly say its numeric subtotal is incomplete. A missing provider receipt
 * therefore remains unknown through live metering and terminal reconciliation instead of becoming
 * a fabricated zero.
 */
/**
 * One tool call retained in an executor artifact. Every Runtime-owned executor reports this exact
 * shape, so `streamAgentTurn` projects terminal tool activity through one reader instead of a
 * per-backend parser. `arguments` holds the captured argument value; an empty object means the
 * source reported the call without its arguments.
 */
interface ExecutorToolCall {
  readonly id?: string;
  readonly name: string;
  readonly arguments: unknown;
}
/**
 * Live output observed while an executor runs, in Runtime's own vocabulary. It carries what the
 * backend produced — text, reasoning, tool activity, an interaction request — and never carries
 * accounting: tokens and dollars stay on the `tokens`/`cost` channels, so a progress event can
 * never meter a budget.
 */
type ExecutorProgressEvent = {
  readonly kind: 'text_delta';
  readonly text: string;
} | {
  readonly kind: 'reasoning_delta';
  readonly text: string;
} | {
  readonly kind: 'tool_call';
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly args?: unknown;
} | {
  readonly kind: 'tool_result';
  readonly toolName: string;
  readonly toolCallId?: string;
  readonly result?: unknown;
} | {
  readonly kind: 'interaction';
  readonly request: InteractionRequest;
} | {
  /**
   * One update of a provider-native child task — a subagent or delegated task the runner
   * started inside this run. It is the Interface event verbatim, so a client rebuilds the
   * child tree from provider identity (`childId`, `parentChildId`, `sourceEventId`) instead
   * of inferring children from tool names or transcript order.
   */
  readonly kind: 'child_task';
  readonly event: ChildTaskEvent;
};
/**
 * How a token count was obtained.
 *
 * `'stream-receipt'` — the executor's live event stream carried the provider's counters.
 * `'harness-store'` — the harness's own on-disk session store was read after the turn. Measured
 *   motive (discovery#80): a cli-bridge codex seat metered zero on 9 of 9 turns while 27,320,482
 *   tokens sat in its rollout, so the store is the only receipt that path produces.
 * `'mixed'` — a settlement whose turns came from more than one of the above.
 */
type TokenUsageProvenance = 'stream-receipt' | 'harness-store' | 'mixed';
type UsageEvent = {
  kind: 'tokens';
  /** Entire executor token total. Omit for additive observations. Cumulative totals may refine cache classes. */
  mode?: 'cumulative';
  /** Known token subtotal. When false, these counts are only the observed/estimated floor. */
  tokensKnown?: false;
  input: number;
  output: number;
  /** Newly processed prompt tokens. Present only with a complete cache split. */
  freshInput?: number;
  /** Prompt tokens the provider reported reading from cache. */
  cacheRead?: number;
  /** Prompt tokens the provider reported writing to cache. */
  cacheWrite?: number;
  /**
   * False when this observation cannot classify all positive prompt tokens — including a
   * provider that reports a read with no write counter. The measured counters are still
   * carried; the marker says the remaining prompt tokens are unclassified, so a charge over
   * them is an upper bound. A counter the provider did not report is absent, never zero.
   */
  cacheBreakdownKnown?: false;
  /**
   * Where these counters came from.
   *
   * ABSENT — the executor's own live stream carried the receipt. This is the default and the
   * only value that existed before harness stores were readable.
   * `'harness-store'` — the harness's OWN on-disk session store was read after the turn. The
   * counters are the provider's, not this runtime's estimate, so they may claim
   * `tokensKnown: true`; the marker states that the evidence is a file the harness wrote rather
   * than an event the transport forwarded.
   *
   * The distinction is load-bearing on a transport that forwards no usage: crediting a store
   * read as if it were a stream receipt would hide that the stream is still silent.
   */
  provenance?: TokenUsageProvenance;
} | {
  kind: 'cost';
  /** A provider or billing receipt covers this amount in full. */
  usdKnown: true;
  usd: number;
  /** Which receipt proves it. A number without one of these cannot claim `usdKnown: true`. */
  provenance: 'provider-receipt' | 'billing-receipt';
} | {
  kind: 'cost';
  /** No receipt covers this work, so `usd` is an observed floor, never the total charge. */
  usdKnown: false;
  usd: number;
  /**
   * The part of `usd` that is a PRICE rather than a charge: a model catalog's own number, or
   * a figure a provider stated with no billing receipt behind it. Either way it approximates
   * what a provider would bill and never measures what it did, so `usd - usdEstimated` stays
   * the amount a provider is known to have billed.
   *
   * Absence means nothing here was priced, NOT that `usd` is a receipt.
   */
  usdEstimated?: number;
  /**
   * Why the amount is not measured: a local catalog price, or nothing captured at all —
   * including a provider that reported a number with no receipt behind it.
   */
  provenance: 'catalog-estimate' | 'uncaptured';
} | {
  /** Observed output, not accounting. Meters ignore it; the turn projection publishes it. */
  kind: 'progress';
  progress: ExecutorProgressEvent;
} | {
  kind: 'resource';
  name: string;
  unit: string;
  amount: number;
  known: boolean;
} | {
  kind: 'iteration';
};
/** The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
 * External executors can register additional runtime strings without widening this type. */
type Runtime = 'router' | 'inline' | 'sandbox' | 'cli' | (string & {});
/**
 * `AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling
 * any registry, including one that resolves caller-supplied factories. The default registry
 * enforces the same rule when called directly. One spec is exempt from the harness-and-model
 * requirement, never from parsing: a verbatim `executor`, which receives only the task and a
 * signal and so can be filled from nothing. Its profile names the node and still digests into the
 * node identity; a leaf whose authority is code (a graph script) carries no model, honestly.
 * `AgentSpec.harness` records routing for one concrete run; where a backend consumes both fields,
 * it must agree with `AgentProfile.harness` and cannot fill or override it.
 *
 * Resolution (in `runtime.ts`):
 *  - `executorFactory` present → BYO: build it after admission with the live context.
 *  - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 *  - `harness === null`        → router/inline: a direct Router call, no box.
 *  - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
 * Fail loud on an unresolvable spec (no executor and an unknown harness).
 */
interface AgentSpec {
  readonly profile: AgentProfile;
  /** `null` selects router/inline; a `BackendType` selects the sandboxed harness. */
  readonly harness: BackendType | null;
  /** Trusted candidate/campaign attribution supplied by the caller. Profile/task digests are
   *  computed by Scope from the exact values it executes and cannot be supplied here. */
  readonly execution?: AgentExecutionRef;
  /** Per-spawn factory carrying caller configuration. Constructed only after admission, with the
   *  real child signal and nested-scope context. */
  readonly executorFactory?: ExecutorFactory<unknown>;
  /** Bring-your-own executor: highest routing precedence after exact-profile intake validation. */
  readonly executor?: Executor<unknown>;
}
/** Caller-owned identity beyond the exact profile/task bytes Scope can compute itself. */
interface AgentExecutionRef {
  readonly candidateDigest?: Sha256Digest;
  readonly correlation?: Readonly<Record<string, string>>;
}
/** Durable identity of one realized node. Missing digests mean the input was not canonical JSON. */
interface NodeExecutionIdentity extends AgentExecutionRef {
  readonly profileDigest?: Sha256Digest;
  readonly taskDigest?: Sha256Digest;
}
/** A named model carried into an execution, or an explicit reason the exact model is unknowable. */
type MaterializedModelIdentity = {
  readonly status: 'known';
  readonly id: string;
} | {
  readonly status: 'unknown';
  readonly reason: string;
};
/** External execution identity that operators can use to join this node to its backend. */
interface MaterializedExecutionIdentity {
  /** Backend-native identity kind, for example `request`, `session`, `run`, `process`, or `tree`. */
  readonly kind: string;
  readonly id: string;
}
/**
 * Data-only declaration from trusted executor code about the exact sealed plan `execute` uses.
 * Scope snapshots this value and computes the durable receipt; callers never provide digests.
 */
interface ExecutorMaterialization {
  /** Complete profile the provider actually receives after Runtime consumes its own declarations. */
  readonly effectiveProfile: AgentProfile;
  /** Canonical profile admitted by Runtime when it differs from the provider-visible profile.
   *  Its digest must equal the kernel-owned authored profile digest for the node. */
  readonly authoredProfile?: AgentProfile;
  /** Concrete backend or harness selected for this run. */
  readonly backend: string;
  /** Exact selected model, or an explicit unknown reason. */
  readonly model: MaterializedModelIdentity;
  /** Backend-native session/run/request/process identity. */
  readonly execution: MaterializedExecutionIdentity;
  /** Named implementation that turns the effective profile into executable backend inputs. */
  readonly materializer: string;
  /** Finite JSON describing the exact materialization plan. Persisted by digest only. */
  readonly plan: unknown;
  /** Trusted runtime-only attachments, such as the coordination MCP. Persisted by digest only. */
  readonly platformAttachments?: unknown;
}
/** Volatile execution routing that is true for one attempt but is not profile identity. The full
 * binding is hashed and discarded; only the safe structural descriptor is journaled. */
interface ExecutorExecutionBinding {
  readonly attemptId: string;
  readonly binding: unknown;
  readonly descriptor: Readonly<Record<string, string | number | boolean | null>>;
}
/** Why exact materialization evidence is unavailable for a node.
 *
 * `executor-receipt-pending` is an IN-FLIGHT value only. It states that a pending executor has
 * declared its plan and has not yet sent the terminal acknowledgement, so the answer can still
 * arrive. A terminal record must never carry it: the attempt is over and no receipt is coming.
 * A terminal attempt that ended before its acknowledgement records
 * `executor-failed-before-receipt` instead, which names the outcome rather than a wait that
 * already finished. */
type UnknownMaterializationReason = 'executor-did-not-report' | 'executor-failed-before-receipt' | 'executor-receipt-pending' | 'invalid-executor-report' | 'root-agent-did-not-report';
/** What the kernel can prove about one node's actual execution plan. */
type ProfileMaterializationReceipt = {
  readonly status: 'known';
  readonly authoredProfileDigest: Sha256Digest;
  readonly effectiveProfileDigest: Sha256Digest;
  readonly materializationPlanDigest: Sha256Digest;
  readonly platformAttachmentsDigest?: Sha256Digest;
  readonly runtime: Runtime;
  readonly backend: string;
  readonly model: MaterializedModelIdentity;
  readonly execution: MaterializedExecutionIdentity;
  readonly materializer: string;
} | {
  readonly status: 'unknown';
  readonly authoredProfileDigest?: Sha256Digest;
  readonly runtime: Runtime;
  readonly reason: UnknownMaterializationReason;
};
/** One attempt's immutable link from a stable materialization plan to its actual transport. */
type ExecutionBindingReceipt = {
  readonly status: 'known';
  readonly attemptId: string;
  readonly materializationReceiptDigest: Sha256Digest;
  readonly bindingDigest: Sha256Digest;
  readonly descriptor: Readonly<Record<string, string | number | boolean | null>>;
} | {
  readonly status: 'unknown';
  readonly attemptId: string;
  readonly materializationReceiptDigest: Sha256Digest;
  readonly reason: UnknownMaterializationReason;
};
/** Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown. */
type RootMaterialization = {
  readonly runtime: Runtime;
  readonly declaration: ExecutorMaterialization;
  readonly binding: Omit<ExecutorExecutionBinding, 'attemptId'>;
} | {
  /** The runtime-owned external adapter will publish the exact declaration after its dynamic
   * platform attachment (for example a coordination URL) exists and before paid work starts. */
  readonly runtime: Runtime;
  readonly declaration: 'deferred';
  /** Exact admitted profile used to validate the stable effective identity at publication. */
  readonly authoredProfile: AgentProfile;
};
/** Kernel-owned context for the concrete supervised node a factory is constructing. */
interface ExecutorNodeContext {
  readonly rootId: NodeId;
  readonly parentId: NodeId;
  readonly nodeId: NodeId;
  /** Recursion depth supplied by Runtime scopes (root = 0). Standalone callers may omit it. */
  readonly depth?: number;
  /** Kernel-minted identity for this concrete execution attempt. */
  readonly attemptId: string;
  readonly identity?: NodeExecutionIdentity;
}
/**
 * Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared)
 * so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a user supply
 * construction args without pre-instantiating; it never bypasses exact-profile validation.
 */
type ExecutorFactory<Out> = (spec: AgentSpec, ctx: ExecutorContext) => Executor<Out>;
/** Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 *  (sandbox client for the sandbox executor, router config for router/inline) without
 *  the factory reaching into module globals. */
interface ExecutorContext {
  readonly signal: AbortSignal;
  /**
   * Request headers inherited from an enclosing task or conversation.
   * Network executors forward these after their own connection headers so caller authorization,
   * recursion depth, and trace identity survive the profile-to-executor boundary.
   */
  readonly propagatedHeaders?: Readonly<Record<string, string>>;
  /** Present when Scope constructs the executor for a supervised node. */
  readonly node?: ExecutorNodeContext;
  /** Opaque seams the registry threads through; a built-in narrows what it needs. */
  readonly seams: Readonly<Record<string, unknown>>;
}
/**
 * The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates
 * before invoking any implementation; the default registry repeats validation for direct callers,
 * resolves the three built-ins, and accepts a BYO `executor`/factory. Callers may register more
 * runtimes by name, but registration does not waive exact-profile validation.
 */
interface ExecutorRegistry {
  /** Register a factory for a named runtime. Throws on a duplicate name (fail loud). */
  register<Out>(runtime: Runtime, factory: ExecutorFactory<Out>): void;
  /**
   * Resolve a spec to a factory. Precedence: a BYO `spec.executorFactory` → `spec.executor` →
   * `harness === null` → the `'router'` factory; else a registered
   * factory for the harness-derived runtime. Returns a typed outcome — the caller
   * inspects `succeeded` before `value` (no silent fallback).
   */
  resolve<Out>(spec: AgentSpec): {
    succeeded: true;
    value: ExecutorFactory<Out>;
  } | {
    succeeded: false;
    error: string;
  };
}
/** Caller-defined resource ceiling in non-negative safe-integer units, consistent throughout a tree. */
interface ResourceLimit {
  readonly unit: string;
  readonly limit: number;
}
/** Non-negative safe-integer subtotal. False means unknown, even when amount is zero.
 * Select sufficiently fine units, such as GPU-milliseconds. */
interface ResourceSpend {
  readonly unit: string;
  readonly amount: number;
  readonly known: boolean;
}
/** A budget envelope on a spawn or the root. All ceilings; the pool reserves against them. */
interface Budget {
  readonly maxIterations: number;
  readonly maxTokens: number;
  readonly maxUsd?: number;
  readonly deadlineMs?: number;
  readonly resources?: Readonly<Record<string, ResourceLimit>>;
}
/**
 * Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd are separate
 * channels (never folded).
 *
 * `boxMinutes` is a REPORTED channel, not a conserved one: it is summed across a run and carried
 * in the journal, and the budget pool never reserves, commits, or refunds against it. `budget.ts`
 * holds the reason.
 */
interface Spend {
  resources?: Readonly<Record<string, ResourceSpend>>;
  iterations: number;
  tokens: LoopTokenUsage;
  /** Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
   *  an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
   *  not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
   *  turn whose provider reported no usage is recorded with this flag rather than omitted, because
   *  omitting it makes the turn look free. */
  tokensKnown?: boolean;
  /** Dollar accounting is known unless explicitly false. A false value must not be treated as $0
   *  when enforcing a dollar-denominated comparison or limit. */
  usdKnown?: boolean;
  usd: number;
  /** The part of `usd` that is a PRICE rather than a charge, because no provider receipt covered
   *  the work: a model catalog's own number, or a figure a provider stated but did not bill.
   *  `usd - usdEstimated` is what a provider is known to have billed. Present only with
   *  `usdKnown: false`; absence means nothing here was priced, not that `usd` is measured. */
  usdEstimated?: number;
  ms: number;
  /**
   * Platform box wall time in minutes — the third conserved channel, beside tokens and dollars.
   *
   * A run on a subscription seat has no marginal dollar per model call, so box time is the only
   * real resource it consumes. Before this channel existed such a run reported `$0` with nothing
   * beside it and was unaccountable by construction.
   *
   * ABSENT when nothing was measured. Never `0` for unknown: a zero would claim the box consumed
   * no platform time, which is a different fact from a box nobody metered. The field is absent
   * entirely on a run with no box (router, cli-bridge, inline), because "not applicable" is not
   * the same fact as "unmeasured" either.
   */
  boxMinutes?: number;
  /** True when this record states its box time. `false` says a box RAN and its lifetime could not
   *  be paired, so `boxMinutes` — when present at all — is a floor, never the total. The twin of
   *  `tokensKnown` and `usdKnown` on the platform channel. */
  boxMinutesKnown?: boolean;
  /**
   * How `boxMinutes` was obtained, in the vocabulary `agent-eval`'s cost ledger already uses
   * (`CostProvenance`, `cost-ledger.ts`).
   *
   * `'observed'` — the platform itself reported the minutes.
   * `'estimated'` — this runtime derived them from the box lifetime it watched. A derived number
   *   is not a platform receipt, and the conserved pool never reserves against it.
   * `'uncaptured'` — a box ran and nothing measured its time. Comes WITHOUT `boxMinutes`.
   */
  boxMinutesProvenance?: 'observed' | 'estimated' | 'uncaptured';
  /**
   * How the token counters in `tokens` were obtained, when this record states it.
   *
   * ABSENT means every count came from the executor's live stream, which is what every path
   * reported before harness stores were readable. `'harness-store'` says the harness's own file was
   * the receipt; `'mixed'` says both sources contributed to this settlement.
   *
   * This is a provenance fact, not a confidence one: a store read is the provider's own number and
   * carries `tokensKnown: true`. The twin of `boxMinutesProvenance` on the token channel.
   */
  tokensProvenance?: TokenUsageProvenance;
}
/** `'queued'` is an admitted child that holds its budget slice and waits for a worker slot
 *  (`workerSlots`); it runs nothing until the allocator grants one. `'acquiring'` is first-class
 *  (M1): a node spends real time + reaps an orphan box during sandbox acquire BEFORE it is
 *  `running`, so abort must be defined over it.
 *  `'waiting'` is first-class for the opposite reason: a wait-state node holds NO executor, NO
 *  box, and no conserved budget — it is neither in flight nor settled, so neither `inFlight` nor
 *  a terminal status describes it (see `Scope.wait`). */
type NodeStatus = 'pending' | 'queued' | 'acquiring' | 'running' | 'waiting' | 'done' | 'failed' | 'cancelled';
/** Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock. */
type NodeId = string;
interface SpawnOpts {
  readonly budget: Budget;
  readonly label: string;
  /** Manager-scoped semantic assignment identity. Unlike `key`, this names every spawn, including
   * unkeyed siblings, so product traces can join authorization, node, and backend execution. */
  readonly assignmentId?: string;
  /** Teardown grace handed to the executor when this node is reaped. */
  readonly shutdown?: number | 'brutalKill' | 'infinity';
  /**
   * Semantic identity of this assignment ACROSS process lifetimes. A keyed spawn is
   * idempotent per key: once a child spawned under a key settles `done` — in this process or in a
   * journaled prior one — spawning the same key returns that committed result (`prior.state:
   * 'completed'`) instead of paying for the work again. A key whose prior attempt settled `down`
   * spawns fresh and says so explicitly (`prior.state: 'retried'`); a resume DERIVES that same
   * `down` for an interrupted `inline` attempt, because an in-process execution cannot outlive
   * its process — so a worker killed mid-flight under a plain in-process executor retries under
   * its own key instead of wedging. A key whose un-settled prior attempt may still exist
   * elsewhere (`sandbox`/`cli`/`router` runtimes) is refused (`'in-doubt'`): the remote execution
   * may still be running and must be recovered before replacement. A key that is currently LIVE
   * is refused (`'duplicate-key'`). Unkeyed spawns (the default) are position-identified and
   * always run.
   */
  readonly key?: string;
  /** The settled sibling node this spawn replaces, so a run's record names which worker took over
   *  whose work. The caller asserts the relation; the coordination `spawn_worker` tool admits only
   *  a settled worker of the same manager. Journaled on `spawned` and on the `agent.spawn` hook. */
  readonly successorOf?: NodeId;
}
/** Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets
 *  no dollars, an exceeded recursion ceiling, a full tree-wide worker allocation, a `key` that is
 *  still LIVE in this scope, a key whose prior remote execution has no terminal receipt, or a run
 *  that has already reached its join barrier.
 *
 * `usd-unbudgeted` is separate from `budget-exhausted` because the two call for opposite
 *  responses: an exhausted pool may admit a smaller request, while an unbudgeted dollar channel
 * refuses every amount until the ROOT budget names a `maxUsd`.
 *
 * `scope-settled` is separate from `scope-aborted` for the same reason: nothing cancelled this
 * run, its driver simply finished. A caller that outlived the request it was serving (a background
 * tool invocation still holding the driver's verbs) gets a refusal it can record, instead of a
 * child nobody joins. */
type SpawnRejection = 'budget-exhausted' | 'usd-unbudgeted' | 'depth-exceeded' | 'duplicate-key' | 'in-doubt' | 'invalid-identity' | 'key-conflict' | 'scope-aborted' | 'scope-settled';
/**
 * What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on
 * every unkeyed spawn). `'completed'` is the exactly-once path: NOTHING was spawned — the handle
 * references the prior settled node and `settled` is the committed result. `'retried'` DID spawn
 * fresh because the prior attempt settled `down`. A start with no terminal receipt is not a prior
 * result: `spawn` refuses it as `'in-doubt'`, retains its charged reservation, and requires exact
 * recovery before a replacement can run.
 */
type SpawnPrior<Out = unknown> = {
  readonly state: 'completed';
  readonly settled: Settled<Out> & {
    kind: 'done';
  };
} | {
  readonly state: 'retried';
  readonly priorId: NodeId;
  readonly reason: string;
};
/**
 * A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into
 * the `acquireSandbox` signal and reaps a find-by-name orphan box, so a node aborted
 * mid-acquire never leaks (M1).
 */
interface Handle<Out> {
  readonly id: NodeId;
  readonly label: string;
  readonly status: NodeStatus;
  /** Manager-scoped assignment identity supplied at admission. */
  readonly assignmentId?: string;
  /** Durable identity of the authorized profile/task/candidate represented by this handle. */
  readonly identity?: NodeExecutionIdentity;
  /** Stable execution plan once Runtime has committed it. */
  readonly materialization?: ProfileMaterializationReceipt;
  /** Immutable per-attempt backend bindings committed so far, oldest first. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>;
  abort(reason?: string): void;
  /** Phantom: binds the handle to the child's output type so `spawn<C>` returns a
   *  `Handle<C>` distinct from a `Handle<other>`. Type-only — never present at runtime. */
  readonly __out?: Out;
}
/**
 * A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order
 * `next()` yielded this settlement (B2) — NOT wall-clock — and replay delivers strictly
 * in `seq` order. `outRef` rehydrates `out` from the `ResultBlobStore` on replay.
 */
type Settled<Out> = {
  kind: 'done';
  handle: Handle<Out>;
  out: Out;
  outRef: string;
  verdict?: DefaultVerdict;
  spent: Spend;
  /** Provider model evidence for every inference attempt owned by this node. */
  providerModel?: ProviderModelExecutionEvidence;
  /** Structured tool evidence captured before this settlement was journaled. */
  trace: WorkerTraceEvidence;
  /** Whether the child's OWN harness transcript survived its environment, or why it did not.
   *  A SIBLING of `trace`, not a field inside it: `trace` carries the supervisor's tool spans
   *  (toolName, args, status, callId, startedAt === endedAt) and nothing the child said, and a
   *  child with zero tool spans has an UNAVAILABLE trace — so a receipt nested inside the
   *  available arm could never describe exactly the children that need it most (#1244). */
  harnessTranscript?: HarnessTranscriptEvidence;
  /** Present when the measured spend exceeded this child's reservation. */
  budgetViolation?: BudgetViolation;
  /** Present when this child led workers of its own: a bounded account of its team. */
  subtree?: SubtreeSummary;
  /** Epoch ms parsed from the durable settlement record when available. */
  settledAt?: number;
  seq: number;
} | {
  kind: 'down';
  handle: Handle<Out>;
  reason: string;
  /** Retained output evidence, when execution returned an artifact before this failure.
   * Its presence does not make the result successful or eligible for selection. */
  outRef?: string;
  /** `true` = the platform, not the work, ended this child (excluded from merge `n` /
   *  equal-k); `false` = the runtime knows the work itself failed (an ordinary thrown result);
   *  absent = the executor's envelope reported a failure the runtime cannot attribute either
   *  way. Absent is a stated unknown, never a euphemism for `false`: until 2026-09-20 the
   *  envelope path stamped `false` unconditionally and caught 1 of 78 platform losses. */
  infra?: boolean;
  /** Partial structured tool evidence captured before this failure was journaled. */
  trace: WorkerTraceEvidence;
  /** The child's own harness transcript, read out of its environment at the last moment it
   *  was live, or the named reason it could not be. This is the path the capture existed
   *  for and never covered: a dropped child produces no result artifact, so before #1244
   *  its reasoning was destroyed with its box. */
  harnessTranscript?: HarnessTranscriptEvidence;
  /** Partial provider model evidence survives an aborted or failed execution. */
  providerModel?: ProviderModelExecutionEvidence;
  /** Present when the spend reconciled for this child exceeded its reservation. */
  budgetViolation?: BudgetViolation;
  /** Present only when this child's provider execution was RETAINED (see
   *  `RetainedExecutionState`); absent on an ordinary down. `'pending'` on the settlement the
   *  driver receives at the reconcile; `'released'` or `'release-unconfirmed'` on the
   *  replayed settlement of a node a final settlement closed. The driver and every replay
   *  reader see the fact the journal
   *  states, so a reader never splits this population on `reason` text — which is identical
   *  on every one of these children. */
  retainedExecution?: RetainedExecutionState;
  /** WHY the retained execution has no accepted result, as a value: the safety refusal
   *  (`'unobservable'`) against a provider contract violation, a rejected request, a lost
   *  transport, or a nested recovery that could not be reconstructed. Present iff
   *  `retainedExecution` is; the `reason` text names the same thing, but a reader must never
   *  have to parse it (#1204). */
  retainedPendingCause?: RetainedPendingCause;
  /** Present when this child led workers of its own: a bounded account of its team. */
  subtree?: SubtreeSummary;
  /** Epoch ms parsed from the durable settlement/cancellation record when available. */
  settledAt?: number;
  seq: number;
};
/**
 * A bounded account of the team a manager led, carried up on its settlement.
 *
 * A lead reads its children's summaries instead of every descendant's output: the counts cover
 * the whole subtree, and `results` lists only the manager's own direct children, best first.
 * Every listed result stays addressable by its content address (`outRef`), so the lead can read
 * any one of them in full. The summary is bounded at every level, so a tree of hundreds of agents
 * reaches its root as a handful of summaries.
 */
interface SubtreeSummary {
  /** Spawned agents below this node, at every depth. */
  readonly agents: number;
  /** Levels below this node: `1` when it led only workers that led no one. */
  readonly depth: number;
  /** Agents below this node that settled done. */
  readonly done: number;
  /** Agents below this node that settled down or were cancelled. */
  readonly down: number;
  /** This node's own direct children, done before down and then by score, at most
   *  `SUBTREE_RESULT_LIMIT` of them. */
  readonly results: ReadonlyArray<SubtreeResult>;
  /** Direct children not listed in `results`. */
  readonly omitted: number;
}
/** One direct child of a manager, as its lead sees it in a {@link SubtreeSummary}. */
interface SubtreeResult {
  readonly id: NodeId;
  readonly label: string;
  readonly status: 'done' | 'down';
  /** Content address of the child's retained output, when it produced one. */
  readonly outRef?: string;
  readonly score?: number;
  /** Agents in this child's own subtree, itself excluded. */
  readonly agents: number;
}
/**
 * The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
 * budget atomically from the shared pool and fails closed when the pool cannot cover it.
 * `next()` waits for one settlement from this scope's live set; `view` reads live state,
 * not the replay log.
 *
 * @stable
 */
interface Scope<Out> {
  /**
   * Spawn a child. For a fresh key or an unkeyed spawn, tree-wide worker admission happens before a
   * lazy factory is called, so a full worker allocation creates no worker, executor, or reservation.
   * Reserves `opts.budget` from the conserved pool atomically; refunds the unspent remainder on
   * settle. Returns a typed outcome — fail-closed on an exhausted pool, an exceeded depth ceiling, a
   * full worker allocation, or a still-live duplicate `key` (the caller inspects `ok` before
   * `handle`). A KEYED spawn whose key already settled `done` invokes the factory only far enough to
   * prepare and authorize the exact profile/task identity, then compares that identity with the
   * journal. On a match it spends nothing, constructs no executor, reserves no budget, and runs no
   * work: it returns the committed result on `prior` (see `SpawnOpts.key`).
   */
  spawn<C extends Out>(agent: Agent<unknown, C> | (() => Agent<unknown, C>), task: unknown, opts: SpawnOpts): {
    ok: true;
    handle: Handle<C>;
    prior?: SpawnPrior<C>;
  } | {
    ok: false;
    reason: SpawnRejection;
    shortfalls?: readonly ReservationShortfall[];
  };
  /** ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
   *  `null` when the live set is empty. */
  next(): Promise<Settled<Out> | null>;
  /**
   * Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
   * when none is ready — never awaits a live child. The driver's post-loop drain reads this so
   * a child that settled while the driver was busy (or after it stopped pulling) still reaches
   * the finalize ledger instead of being silently lost.
   */
  nextResolved(): Promise<Settled<Out> | null>;
  /**
   * Steer a RUNNING child out-of-band — deliver a message to its executor's inbox (the driver's
   * `send` verb: next-instruction, interrupt, or resume). Returns `true` if the message was
   * delivered to a live child whose executor accepts delivery, `false` otherwise (unknown id,
   * already settled, or an executor with no inbox). The executor drains its inbox between turns;
   * a leaf that does not implement `deliver` simply cannot be steered mid-flight. In-process this
   * is a direct call; the sandbox/Agent-Bus transports surface the SAME verb as an MCP tool.
   */
  send(nodeId: NodeId, msg: unknown): boolean;
  /**
   * Arm a WAIT-STATE node: a first-class tree node that waits on wall-clock time (`timer`) or on
   * a named external predicate (`poll`) and settles through THIS scope's `next()` cursor like any
   * other child — but holds no executor, no sandbox, and no conserved budget. Waiting costs zero
   * tokens and zero dollars by construction.
   *
   * It is journaled (`waiting` → `woken`) with its ABSOLUTE deadline, so a run that dies mid-wait
   * resumes still waiting: the supervisor surfaces the un-woken waits on `Scope.resume.waits`, and
   * re-arming the same `label` adopts the recorded node id and original instant instead of
   * restarting the countdown.
   *
   * Fail-closed admission, mirroring `spawn`: `invalid-spec`, `unknown-probe` (a `poll` naming a
   * predicate this run's registry cannot resolve), or `deadline-exceeded` (the wait would outlive
   * the pool's hard wall-clock ceiling — a wait never extends a budget guard).
   *
   * NOT `await_event`: that is an in-run rendezvous on the coordination bus whose 15s fence makes
   * the caller re-poll — each re-poll a driver inference turn against a process that must stay up,
   * and nothing about it survives a restart. See `supervise/wait.ts`.
   */
  wait(spec: WaitSpec, opts: WaitOpts): {
    ok: true;
    handle: Handle<WaitOutcome>;
  } | {
    ok: false;
    reason: WaitRejection;
  };
  /**
   * The LIVE read-model of one child, valid WHILE it runs: last-activity timestamp, idle time,
   * a derived `stalled` flag, tokens/turns spent so far, whether a steer can even reach it
   * (`steerable`), and whatever tool activity its executor exposes. `undefined` for an unknown
   * id. This is the counterpart to `send`: a driver that can steer but cannot observe has
   * nothing to steer on, which is precisely why steering went unused.
   *
   * Pull-based and side-effect free — reading it starts no timer and spends nothing. `now` and
   * `stallAfterMs` are injectable so a caller (and a test) controls what counts as stalled.
   */
  progress(nodeId: NodeId, opts?: {
    now?: number;
    stallAfterMs?: number;
  }): WorkerProgress | undefined;
  /** The live tool-call trace of one child when its executor exposes one (`Executor.traceSource`),
   *  for running the online detector panel over a RUNNING worker. `undefined` otherwise. */
  traceSource(nodeId: NodeId): TraceSource | undefined;
  /**
   * Attach a human terminal to the exact process ONE child is running in.
   *
   * Returns that child's `RetainedInteractiveRunHandle` when its executor holds an interactive
   * session — the caller then types, resizes, detaches, reconnects, and closes against the same
   * admitted execution, with one ordered output history. Every other worker returns an explicit
   * `unavailable` reason: a headless run, a runner whose provider publishes no interactive
   * contract, and an unknown or settled node are each distinguishable, and none of them is ever
   * converted into a fake attachment.
   */
  interactive(nodeId: NodeId): WorkerInteractiveSession;
  /**
   * Ask one child's backend to stop, and report what it acknowledged. It delegates to
   * `Executor.cancel` when the runtime has one; otherwise the child is aborted locally and the
   * answer is `unknown`, never `accepted`. Resource release still belongs to teardown.
   */
  cancel(nodeId: NodeId, request: ExecutorCancellationRequest): Promise<ExecutorCancellation>;
  /** This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
   *  is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
   *  it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
   *  scope carries its own signal, chained off its driver child's abort. */
  readonly signal: AbortSignal;
  /**
   * Meter the driver's OWN compute against the conserved pool — its inference turns, which are
   * real tokens/usd but not a spawned child (no reserve/reconcile). A direct `free → committed`
   * debit, so equal-k counts the driver's tokens AND the in-loop budget guard (`budget.tokensLeft`)
   * halts a driver that thinks the pool dry. `detail` rides an `agent.turn` trace event for live
   * observability (turn index, tool calls, cumulative spend). It also journals a `metered` event —
   * the durable twin of the pool debit (as `settled` is the twin of `reconcile`) — so every
   * journal-based cost reader (`spentFromJournal`, `trajectoryReport`) sums driver inference
   * automatically. A leaf never calls this; a driver meters each chat turn and awaits it (the
   * metered event is cost-critical, so it lands before the join-barrier roll-up).
   */
  meter(spend: Spend, detail?: Record<string, unknown>): Promise<void>;
  /**
   * Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
   * every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
   * first; when a non-empty tree exists it rehydrates the already-settled children (via
   * `replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
   * re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
   * but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
   * maxima, so any NEW spawn appends without colliding with a journaled event.
   *
   * Retained provider children can reconcile their original execution through `recoverExecutor`.
   * Missing recovery evidence leaves keyed work in doubt.
   * Local ownership does not provide distributed fencing.
   * @experimental
   */
  readonly resume?: ResumedWork<Out>;
  /** The live tree — reads the in-memory nursery, not the journal. */
  readonly view: TreeView;
  /** Conserved-pool readouts (post-reservation). */
  readonly budget: BudgetReadout;
  /** The worker-slot allocator as this scope sees it. Every scope of a tree, and every tree that
   *  shares the allocator, reads the same counts; the root agent itself holds no slot. `working`
   *  counts agents that hold a slot, `queued` counts admitted spawns that wait for one, and
   *  `freeSlots` is `null` when no bound is set. `unconfirmed` NAMES this scope's settled children
   *  whose executor teardown was never acknowledged. Empty on every healthy run. */
  readonly workerCapacity: Readonly<{
    working: number;
    queued: number;
    freeSlots: number | null;
    unconfirmed: ReadonlyArray<UnconfirmedTeardown>;
  }>;
}
/** One settled child whose executor teardown was never acknowledged: the run cannot prove the
 *  resource is gone. Named so an operator can act on it. */
interface UnconfirmedTeardown {
  readonly id: NodeId;
  readonly label: string;
  readonly runtime: Runtime;
  readonly status: NodeStatus;
  /** The provider environments the node may still hold and nothing keeps on purpose, by the
   *  provider's own id: what an operator's sweeper deletes. Present when the executor names at
   *  least one (`Executor.heldEnvironments`); absence means nothing was named, never "nothing is
   *  held". Never contains a kept environment. */
  readonly environments?: ReadonlyArray<HeldEnvironment>;
  /** The environments the node holds on purpose, each with `keptFor` set: a retained execution
   *  a resume reconciles, or a workspace preserved as evidence. A sweeper never deletes these. */
  readonly kept?: ReadonlyArray<HeldEnvironment>;
  /** How many teardown requests Runtime sent the executor. */
  readonly attempts?: number;
  /** Why the last attempt did not confirm destruction. */
  readonly detail?: string;
}
/**
 * The committed work a resumed run inherits from its journal. `settled` is the replayed
 * `Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
 * is the tree as `materializeTreeView` folded it at the recorded cursor position. A
 * resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.
 */
interface ResumedWork<Out> {
  readonly settled: ReadonlyArray<Settled<Out>>;
  readonly view: TreeView;
  /**
   * Wait-state nodes the journal shows as ARMED but never woken — the run died mid-wait. Each
   * carries the ORIGINAL arm instant and absolute deadline, so re-arming the same `label` through
   * `Scope.wait` resumes the countdown instead of restarting it. Empty on a fresh run and on a
   * resumed run that was not waiting.
   */
  readonly waits: ReadonlyArray<PendingWait>;
  /**
   * Keyed assignments from the prior journal: `SpawnOpts.key` → what the journal proves about it.
   * `completed`/`down` carry the rehydrated settlement; `in-doubt` means the spawn was journaled
   * but no settlement ever landed — the process died with it in flight. `Scope.spawn` refuses a
   * keyed replacement in that state, rather than duplicate a possibly live remote execution. Empty
   * when no prior spawn carried a key.
   */
  readonly keys: ReadonlyMap<string, ResumedKeyState<Out>>;
  /**
   * The conserved spend the prior process(es) already committed for this run, summed off the same
   * journal replay reads: every `settled` child's reconciled spend (`childWork`) plus every
   * `metered` driver-inference record (`driverInference`). What a resume-aware driver reports as
   * "already paid" — the run's final `spentTotal` includes it because the journal spans processes.
   */
  readonly priorSpend: {
    readonly childWork: Spend;
    readonly driverInference: Spend;
  };
}
/** What the journal proves about one keyed assignment at resume time. */
interface ResumedKeyState<Out = unknown> {
  readonly id: NodeId;
  readonly label: string;
  /** Identity recorded when this key was first admitted. Every reuse must match it exactly. */
  readonly identity?: NodeExecutionIdentity;
  readonly state: 'completed' | 'down' | 'in-doubt';
  /** The rehydrated settlement; absent when `state` is `'in-doubt'`, and when `'down'` was
   * *derived* — the resume itself proved the execution dead (an `inline` runtime cannot outlive
   * its process), so there is no settlement to rehydrate and `reason` says how it died. */
  readonly settled?: Settled<Out>;
  /** Why a derived `'down'` state exists. Absent on every state backed by a settlement. */
  readonly reason?: string;
}
interface NodeSnapshot {
  readonly id: NodeId;
  readonly parent?: NodeId;
  readonly label: string;
  readonly status: NodeStatus;
  readonly runtime: Runtime;
  readonly budget: Budget;
  /** Exact nested journal tree owned by this node, when Runtime attested recursive ownership. */
  readonly ownedTreeRoot?: NodeId;
  /** Manager-scoped assignment identity, including deterministic ids for unkeyed siblings. */
  readonly assignmentId?: string;
  readonly identity?: NodeExecutionIdentity;
  /** Kernel-owned execution evidence. `unknown` is distinct from a known zero/empty plan. */
  readonly materialization?: ProfileMaterializationReceipt;
  /** Immutable attempt bindings, oldest first. A retried/resumed node may have more than one. */
  readonly executionBindings?: ReadonlyArray<ExecutionBindingReceipt>;
  /** Epoch ms of the terminal journal record; absent while live or when legacy evidence lacks it. */
  readonly settledAt?: number;
  /** Epoch ms of the spawn journal record; absent when legacy evidence lacks a parseable `at`. */
  readonly spawnedAt?: number;
  /** Conserved spend so far for this node. */
  readonly spent: Spend;
  /**
   * The node's executor has FINISHED and its settlement is queued for the manager to drain with
   * `await_event`/`next()`, but `status` still reads as it did while running because the settle
   * transition happens at drain time. Present only in that window; absent once drained or while
   * the executor is still live. Carries the terminal kind so a manager polling `observe_agent`
   * can tell "still working" from "finished, waiting for you to read it".
   *
   * Measured 2026-09-17 (discovery-lab sandbox-a-20260917h): two children finished 30 s after
   * dispatch; the manager polled `observe_agent` eleven times over 56 minutes, read `running`
   * each time, stopped draining because the status said work was in flight, and recorded the
   * opposite of the truth about its own experiment. agent-runtime#1279.
   */
  readonly settlementPending?: {
    readonly kind: 'done' | 'down';
  };
  /** Provider model evidence persisted separately from the execution plan. */
  readonly providerModel?: ProviderModelExecutionEvidence;
  /** Canonical retained output pointer; a failed or cancelled node may also have useful evidence. */
  readonly outRef?: string;
  /** Present on terminal executor nodes; legacy records carry an explicit unavailable reason. */
  readonly trace?: WorkerTraceEvidence;
  /** Present once a settled node's measured spend exceeded its reservation. */
  readonly budgetViolation?: BudgetViolation;
  /** Present on a retained child: `'pending'` while its cursor slot is open, `'released'` or
   *  `'release-unconfirmed'` once a final settlement closed it. The live view (`makeTreeView`)
   *  and the journal view (`materializeTreeView`) state the same fact, so a settle record's
   *  `tree` answers the retained-vs-down question without the observer journal. */
  readonly retainedExecution?: RetainedExecutionState;
  /** Why a retained child has no accepted result; see `RetainedPendingCause`. */
  readonly retainedPendingCause?: RetainedPendingCause;
}
/** The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer. */
interface TreeView {
  readonly root: NodeId;
  readonly nodes: ReadonlyArray<NodeSnapshot>;
  /** Count of nodes in `queued`, `acquiring`, or `running` — the "what's in flow?" answer. */
  readonly inFlight: number;
  /** Count of nodes in `waiting` — armed wait-states. Deliberately NOT folded into `inFlight`:
   *  a wait burns no executor and no budget, so counting it as flow would misreport both idle
   *  capacity and how much work is actually running. */
  readonly waiting: number;
}
/** Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 *  timestamp for human inspection only (NOT a replay input). */
/** The file Runtime writes into a retained owner's workspace immediately before a checkpoint, and
 *  reads back from a restored environment to report whether the marker matches. */
interface WorkspaceCheckpointMarker {
  /** Workspace-relative path. */
  readonly path: string;
  readonly content: string;
}
type SpawnEvent = {
  kind: 'spawned';
  id: NodeId;
  parent?: NodeId;
  label: string;
  /** The semantic spawn key (`SpawnOpts.key`), when the spawn carried one — what a resumed
   *  run matches to resolve the same assignment to its committed result. */
  key?: string;
  /** Manager-scoped assignment identity used to join unkeyed and keyed work alike. */
  assignmentId?: string;
  /** The settled sibling node this spawn replaces (`SpawnOpts.successorOf`). */
  successorOf?: NodeId;
  budget: Budget;
  runtime: Runtime;
  /** Root-only opt-in owner-share contract. A resumed run must use the same policy; absent on
   * records that set none. */
  recursiveAdmission?: {
    policy: RecursiveReservationPolicy;
  };
  /** Exact nested journal tree this node owns. Runtime writes this only after privately
   * attesting the executor as a recursive scope owner. Its absence means no tree is followed,
   * including records written before this field existed and caller leaves named `driver`. */
  ownedTreeRoot?: NodeId;
  /** Exact profile/task digests plus trusted candidate/campaign attribution when available. */
  identity?: NodeExecutionIdentity;
  /** `ResultBlobStore` key holding the AUTHORED child `AgentProfile` this spawn ran under.
   *  Distinct from `identity.profileDigest`: that is the canonical AgentProfile digest, which
   *  names the agent, while this is the blob store's own content address, which retrieves its
   *  bytes. Absent on records written before the body was persisted. */
  profileRef?: string;
  seq: number;
  at: string;
} | {
  /** Exact task bytes durable before admitting a retained invocation. */
  kind: 'execution-input';
  id: NodeId;
  taskRef: string;
  /** @internal Whether this owner must preserve an unreceipted provider workspace on resume. */
  workspaceRetention?: boolean;
  seq: number;
  at: string;
} | {
  /** Credential-free retained-provider admission, committed before the next external effect. */
  kind: 'execution-admitted';
  id: NodeId;
  admission: RetainedRunAdmission;
  seq: number;
  at: string;
} | {
  /** Recoverable output committed before releasing its provider environment. */
  kind: 'execution-result';
  outcome?: Pick<AgentTurnResult, 'success' | 'error'> & {
    errorCode?: string;
  };
  id: NodeId;
  outRef: string;
  spent: Spend;
  verdict?: DefaultVerdict;
  seq: number;
  at: string;
} | {
  /** Volatile transport/session binding for exactly one attempt. The full binding is retained
   * only by digest; descriptor fields are safe structural labels, never credential-bearing URLs. */
  kind: 'execution-bound';
  id: NodeId;
  binding: ExecutionBindingReceipt;
  seq: number;
  at: string;
} | {
  /** Trusted runtime transformation from the authorized profile to actual wire bytes. */
  kind: 'materialized';
  id: NodeId;
  receipt: ProfileMaterializationReceipt;
  seq: number;
  at: string;
} | {
  kind: 'settled';
  id: NodeId;
  status: 'done' | 'down';
  /** Content-addressed result pointer; rehydrates `out` from `ResultBlobStore`. */
  outRef?: string;
  verdict?: DefaultVerdict;
  spent: Spend;
  /** Provider model evidence is independent from the planned materialization receipt. */
  providerModel?: ProviderModelExecutionEvidence;
  infra?: boolean;
  /** Exact child failure. Present on every new `status: 'down'` record; optional only so
   * journals written before this field existed remain replayable. */
  reason?: string;
  /** Structured tool evidence. Optional only for journals written before trace capture. */
  trace?: WorkerTraceEvidence;
  /** Whether this child's harness transcript survived, or the named reason it did not.
   *  Absent on journals written before the capture existed — which is not the same fact as
   *  a recorded `unavailable`, and is why this stays optional rather than defaulting. */
  harnessTranscript?: HarnessTranscriptEvidence;
  /** Present when the reconciled spend exceeded the reservation, on either status. */
  budgetViolation?: BudgetViolation;
  /** `'released'` is written by the release sweep in the settling process, on the same tree,
   *  after every `environment-teardown` receipt for the node reads `destroyed: true` and the
   *  executor's own teardown confirmed — or by `healReleasedSlots` on the next resume, when
   *  that process died between the last `destroyed: true` receipt and this record: the same
   *  builder, `seq` and `at`, read from the `reconciled` record, so the bytes are identical
   *  either way. `'release-unconfirmed'` is written by the same builder at the end of a final
   *  settlement for every retained node the release could not confirm: a `destroyed: false`
   *  receipt, an empty receipt set, or a refused teardown probe. Only a crash before that point
   *  or a `reconciled` record without `settledSeq` leaves the slot open.
   *  `spent` is this node's child-work component of the reconcile the pool committed — for
   *  a leaf the streamed floor itself, for a recursive executor its `accounting().reported`
   *  split with the remainder on its `metered` records — never the reservation ceiling.
   *  `reason`/`infra`/`trace`/`harnessTranscript`/`outRef`/`providerModel` are the
   *  settlement the driver received, verbatim; `seq` is the cursor seq stamped on that
   *  delivery, so replay yields it at the position the driver saw it; `at` is the settlement
   *  instant, and the release instant is on the receipt immediately before it. Typed so a
   *  `'pending'` can never be journaled: the journal states that as `reconciled`. */
  retainedExecution?: Exclude<RetainedExecutionState, 'pending'>;
  retainedPendingCause?: RetainedPendingCause;
  /** The bounded account of the team this child led, when it led one. */
  subtree?: SubtreeSummary;
  seq: number;
  at: string;
} | {
  kind: 'cancelled';
  id: NodeId;
  reason: string;
  source?: string;
  infra?: boolean;
  spent?: Spend;
  providerModel?: ProviderModelExecutionEvidence;
  trace?: WorkerTraceEvidence;
  /** The child's harness transcript receipt, when the executor could still be read at the
   *  cancel. The settle path writes it on this record exactly as on `settled`. */
  harnessTranscript?: HarnessTranscriptEvidence;
  outRef?: string;
  budgetViolation?: BudgetViolation;
  /** As on `settled`: a retained child that was cancelled settles `cancelled`, and the one
   *  builder writes whichever kind the settlement had. */
  retainedExecution?: Exclude<RetainedExecutionState, 'pending'>;
  retainedPendingCause?: RetainedPendingCause;
  /** The bounded account of the team this child led, when it led one. */
  subtree?: SubtreeSummary;
  seq: number;
  at: string;
} | {
  /** GRAPH ENGINE fold input: the exact inputs one node instance was given, pinned by content
   *  address BEFORE the instance spawns. `onCrash: 'restart'` re-runs from this ref, never
   *  through a transform someone has since changed. Kernel replay skips it. */
  kind: 'node-inputs-resolved';
  /** The engine instance label (`<node>#<visit>`), which the matching `spawned` also carries. */
  id: NodeId;
  node: string;
  instance: string;
  inputRef: string;
  seq: number;
  at: string;
} | {
  /** GRAPH ENGINE fold input: what the scheduler DECIDED about one edge on one source
   *  completion — distinct from `edge`, which stays delivery observability. Kernel replay
   *  skips it; the engine fold consumes it as authority (never re-judged through changed
   *  guard code). */
  kind: 'edge-verdict';
  id: NodeId;
  edge: string;
  /** satisfied ⇒ true; dead or failed ⇒ false, with `sourceStatus` distinguishing. */
  fired: boolean;
  sourceStatus: 'done' | 'down' | 'invalid';
  /** A consumption the traversal cap refused: the edge stays satisfied, the target may block. */
  capped?: boolean;
  inputRef?: string;
  toInstance?: string;
  seq: number;
  at: string;
} | {
  /** GRAPH ENGINE fold input: one join release — which gating edges produced it and which
   *  in-flight edges were consumed-once by the wave. Kernel replay skips it. */
  kind: 'join-state';
  id: NodeId;
  node: string;
  rule: 'all' | 'any' | 'any_failed' | 'all_done';
  satisfiedBy: ReadonlyArray<string>;
  consumedPending: ReadonlyArray<string>;
  /** The instance this release entered (`<node>#<visit>`). */
  instance: string;
  seq: number;
  at: string;
} | {
  /** A wait-state node was ARMED. Lives in the SPAWN-ORDINAL namespace (`seq` is the wait
   *  ordinal within its parent scope), exactly like `spawned` — it creates a node, it does not
   *  settle one. It carries the whole `spec` and the original `armedAt` so a brand-new process
   *  re-arms the identical wait with the identical ABSOLUTE deadline. */
  kind: 'waiting';
  id: NodeId;
  parent?: NodeId;
  label: string;
  spec: WaitSpec;
  armedAt: number;
  seq: number;
  at: string;
} | {
  /** A wait-state node SETTLED — the cursor-namespace twin of `settled`, kept distinct so a
   *  reader can tell zero-cost waiting apart from paid work without inspecting payloads. A
   *  wait carries no `spent` (it is free by construction, not by measurement); `outRef`
   *  rehydrates its `WaitOutcome`, absent when the wait was cancelled. */
  kind: 'woken';
  id: NodeId;
  /** `expired`: a graph suspension whose `onExpire: 'fail'` deadline passed — distinct from
   *  `timeout` (a poll wait's own deadline), so a consumer can tell "the human never
   *  answered" from "the probe never fired". */
  by: 'fired' | 'timeout' | 'cancelled' | 'expired';
  outRef?: string;
  seq: number;
  at: string;
} | {
  /** A driver's OWN inference spend, journaled separately from spawned-child work — the journal
   *  TWIN of `BudgetPool.observe`, exactly as `settled` is the twin of `reconcile`. So every
   *  journal-based cost reader sums it automatically — the journal is the single cost ledger.
   *  It carries spend only and is NOT a settlement: replay + `materializeTreeView` skip it for
   *  structure, and its `seq` lives outside the cursor-uniqueness namespace. A
   *  driver re-homes its nested subtree's metered total up to its parent (like settled spend),
   *  so summing any sub-tree root yields that sub-tree's true driver-inference cost. */
  kind: 'metered';
  id: NodeId;
  spend: Spend;
  /** Runtime bookkeeping only; this record carries no provider inference attempt. */
  accountingOnly?: true;
  /** Runtime-owned provider attempt evidence for this driver's own inference turn. */
  providerModel?: ProviderModelExecutionEvidence;
  seq: number;
  at: string;
} | {
  /** A live worker's cumulative metered spend, published while its stream is still running.
   * This is observation only: it never settles a node and never enters cost totals. The next
   * terminal `settled` event replaces it in read models, so a live snapshot can show movement
   * without charging the same spend twice. */
  kind: 'progress';
  id: NodeId;
  spend: Spend;
  seq: number;
  at: string;
} | {
  /** A retained child's reservation was reconciled at the child-work floor its executor had
   *  observed, while its cursor slot stays OPEN so a resume can recover the execution. It stands
   *  in for the `settled` record an open node cannot carry: cost readers and a restored pool
   *  charge this floor for the node instead of its declared ceiling, and a later `settled` or
   *  `cancelled` record for the same node supersedes it. That record has four writers: a
   *  resumed process's recovered settlement, the release sweep's terminal record marked
   *  `retainedExecution: 'released'`, the final settlement's record marked
   *  `'release-unconfirmed'` for a node whose release it could not confirm, or
   *  `healReleasedSlots` on the next resume when the process died between the last
   *  `environment-teardown` receipt and the released record. The last three carry the same
   *  settlement, because each reads it from THIS record or from the live child it mirrors: it
   *  is literally the settlement it stands in for, minus the cursor position it cannot hold. A
   *  driver's own inference travels on its `metered` record as on every other path, so
   *  `reconciled + metered` is what the pool committed. Its `seq` lives outside the
   *  cursor-uniqueness namespace; `settledSeq` is the cursor seq. */
  kind: 'reconciled';
  id: NodeId;
  spent: Spend;
  /** The transcript receipt of a retained-pending child. This record is the ONLY durable home
   *  it has: the node writes no `settled` record while its slot stays open, and these are the
   *  #1244 children exactly — dropped mid-run with a live box the capture read. A later
   *  terminal record for the node carries the same receipt forward. */
  harnessTranscript?: HarnessTranscriptEvidence;
  /** The cursor seq `next()` stamped on the delivery this floor stands in for — what
   *  `finalizeSettlement` holds as `child.settledSeq` and the release sweep writes the
   *  terminal record under. A resume that heals a crashed sweep reads the seq back from here,
   *  so a record without it cannot be healed. Optional only so journals written before this
   *  field existed remain replayable. */
  settledSeq?: number;
  /** The settlement the driver received, verbatim, as `settled`/`cancelled` carry it. Optional
   *  only so journals written before these fields existed remain replayable. */
  reason?: string;
  retainedPendingCause?: RetainedPendingCause;
  infra?: boolean;
  trace?: WorkerTraceEvidence;
  outRef?: string;
  providerModel?: ProviderModelExecutionEvidence;
  /** The overspend the RETAINED reconcile returned, which the open-slot surfaces withhold
   *  (`materializeTreeView` folds only `spent` from this record); journaled so the released
   *  record carries it without recomputation. */
  budgetViolation?: BudgetViolation;
  /** Present iff the child had a `RunCancellationReason` when it settled; decides `settled`
   *  vs `cancelled` and its `source` on the released record. */
  cancellation?: {
    readonly source: string;
  };
  seq: number;
  at: string;
} | {
  /** A settled child whose executor teardown stayed unconfirmed after the settlement retry
   *  window: the run cannot prove the resource is gone. Recorded so the leak is durable
   *  evidence about the EXECUTOR, and the environment ids a sweeper deletes, rather than a
   *  cause of run failure.
   *  Informational: replay, `materializeTreeView`, and cost readers skip it, and its `seq` lives
   *  outside the cursor-uniqueness namespace. */
  kind: 'teardown-unconfirmed';
  id: NodeId;
  label: string;
  runtime: Runtime;
  /** The node's terminal status when the barrier read it. */
  status: NodeStatus;
  /** See `UnconfirmedTeardown.environments`: the ids a sweeper deletes. */
  environments?: ReadonlyArray<HeldEnvironment>;
  /** See `UnconfirmedTeardown.kept`: environments held on purpose, never swept. */
  kept?: ReadonlyArray<HeldEnvironment>;
  /** How many teardown requests Runtime sent the executor. */
  attempts?: number;
  /** Why the last attempt did not confirm destruction. */
  detail?: string;
  seq: number;
  at: string;
} | {
  /** A settled node whose teardown was unconfirmed when the join barrier opened its
   *  settlement retry window (`teardownConfirmMs`). Written before the window, so the
   *  environment ids reach durable storage even if the process dies inside it. Each is
   *  followed by `teardown-confirmed` when a retry confirms the node, or by
   *  `teardown-unconfirmed` when the window closes first. A sweeper reading a journal whose
   *  run never settled deletes the `environments` of each pending node with neither.
   *  Informational: replay and cost readers skip it, and its `seq` lives outside the
   *  cursor-uniqueness namespace. */
  kind: 'teardown-pending';
  id: NodeId;
  label: string;
  runtime: Runtime;
  status: NodeStatus;
  /** See `UnconfirmedTeardown.environments`: the ids a sweeper deletes. */
  environments?: ReadonlyArray<HeldEnvironment>;
  /** See `UnconfirmedTeardown.kept`: environments held on purpose, never swept. */
  kept?: ReadonlyArray<HeldEnvironment>;
  /** How many teardown requests Runtime had sent the executor when the window opened. */
  attempts?: number;
  /** Why the last attempt before the window did not confirm destruction. */
  detail?: string;
  seq: number;
  at: string;
} | {
  /** A `teardown-pending` node whose teardown a retry inside the settlement window confirmed:
   *  the executor destroyed what it held. Informational, outside the cursor namespace. */
  kind: 'teardown-confirmed';
  id: NodeId;
  seq: number;
  at: string;
} | {
  /** One provider environment a settled retained-pending child held, released at root
   *  settlement — or not. The run had reached a terminal outcome no later process resumes, so
   *  the environment its executor kept for recovery could never be recovered; this is the
   *  receipt of the supervisor's release, one per environment, naming the provider's own id
   *  so a fleet listing can be reconciled against it. A `destroyed: false` receipt carries why
   *  in `detail`, and the node is then also journaled as `teardown-unconfirmed`. When every
   *  receipt for a node is `destroyed: true` and the executor confirms teardown, the node's
   *  terminal `settled`/`cancelled` record with `retainedExecution: 'released'` follows on
   *  the same tree and closes the cursor slot; when the settling process dies between this
   *  receipt and that record, `healReleasedSlots` writes the same record on the next resume
   *  from the `reconciled` record. After a `destroyed: false` receipt, an empty receipt set, or
   *  an unconfirmed teardown, the environment may still exist: the node is journaled as
   *  `teardown-unconfirmed`, and its slot closes with `retainedExecution:
   *  'release-unconfirmed'` instead, because the settlement is final either way.
   *  Informational: replay, `materializeTreeView`, and cost readers skip it, and its `seq` is
   *  per node, outside the cursor-uniqueness namespace. */
  kind: 'environment-teardown';
  id: NodeId;
  provider: string;
  environmentId: string;
  destroyed: boolean;
  detail?: string;
  seq: number;
  at: string;
} | {
  /** Durable intent written before the provider creates a checkpoint. A missing result
   * is reconciled through exact operation lookup before its source can be released.
   * Informational, like `workspace-checkpoint`. */
  kind: 'workspace-checkpoint-requested';
  id: NodeId;
  provider: string;
  environmentId: string;
  request: WorkspaceCheckpointRequest;
  marker?: WorkspaceCheckpointMarker;
  seq: number;
  at: string;
} | {
  /** A durable checkpoint of a retained owner's workspace, taken while its manager coordinated.
   *  When the provider later loses the owner's environment, the next invocation is created from
   *  the latest of these, so a re-entered director keeps the files it wrote. `marker` is the
   *  file Runtime wrote into the workspace immediately before the checkpoint; a restored
   *  environment reports whether it holds that file with that content. Informational:
   *  replay, `materializeTreeView`, and cost readers skip it, and its `seq` is per node,
   *  outside the cursor-uniqueness namespace. */
  kind: 'workspace-checkpoint';
  id: NodeId;
  provider: string;
  /** The environment the checkpoint was taken from. */
  environmentId: string;
  checkpoint: WorkspaceCheckpointRef;
  marker?: WorkspaceCheckpointMarker;
  seq: number;
  at: string;
} | {
  /** Exact checkpoint cleanup outcome; unconfirmed resources remain pending across resume.
   * Informational, like `workspace-checkpoint`. */
  kind: 'workspace-checkpoint-cleanup';
  id: NodeId;
  provider: string;
  environmentId: string;
  checkpointId: string;
  confirmed: boolean;
  seq: number;
  at: string;
} | {
  /** A new environment of a retained owner was created from a `workspace-checkpoint`, and
   *  Runtime read the checkpoint's marker back from it. `verified` is true only when the file
   *  held the exact content written before the checkpoint. Informational, like
   *  `workspace-checkpoint`. */
  kind: 'workspace-restored';
  id: NodeId;
  provider: string;
  /** The new environment. */
  environmentId: string;
  checkpointId: string;
  /** The environment the checkpoint was taken from. */
  sourceEnvironmentId: string;
  verified: boolean;
  detail?: string;
  seq: number;
  at: string;
} | {
  /** One GRAPH-EDGE traversal (`runGraph`): what the runtime actually DELIVERED across a
   *  delegates/analyzes edge, with byte counts — the observability that makes an edge's
   *  directive trustable and therefore optimizable. Informational: replay,
   *  `materializeTreeView`, and cost readers skip it; its `seq` is the per-run edge-ledger
   *  ordinal, outside the cursor-uniqueness namespace. */
  kind: 'edge';
  /** The destination node when known (a spawned worker's id), else `graph:<node>`. */
  id: NodeId;
  edge: {
    kind: 'delegates' | 'analyzes' | 'data';
    from: string;
    to: string;
    /** The resolved directive reference (`<surface>/v<n>`), never the directive bytes.
     *  Absent on a `data` edge, which carries a port binding instead. */
    directive?: string;
    /** `data` edges: the target input port the payload bound to. */
    port?: string;
  };
  /** 1-based traversal ordinal for THIS edge within the run. */
  traversal: number;
  outcome: 'delivered' | 'stripped' | 'empty' | 'unpropagated';
  /** How the hop CONTINUED the node's work: spawn traversals stamp their effective mode
   *  (`'fresh'` = new session, `'resume'` = re-attached to the node's prior settled session),
   *  and every mid-run delivery into an already-live recipient — a driver steer leg and every
   *  analyzes delivery — stamps `'steer'`. Optional only so journals written before
   *  continuity stamping remain replayable; every new event carries it. */
  continuity?: 'fresh' | 'resume' | 'steer';
  /** Bytes of directive + payload that actually crossed the edge (0 for `empty`). */
  bytes: number;
  /** Why a non-`delivered` outcome happened, when the runtime knows. */
  reason?: string;
  seq: number;
  at: string;
} | {
  /** A spawned worker ran WITHOUT the run's trace context because its backend has no channel
   *  to carry one — the severed distributed-trace hop, journaled so a disconnected child trace
   *  is a queryable fact instead of a silent stranger tree. The child-side twin is the
   *  `tangle.trace.unpropagated=true` span attribute a fallback-minted root stamps.
   *  Informational: replay, `materializeTreeView`, and cost readers skip it; `seq` shares the
   *  spawn-ordinal namespace of the `spawned` event it annotates. */
  kind: 'trace-unpropagated';
  id: NodeId;
  /** The trace id the worker SHOULD have inherited. */
  expectedTraceId: string;
  /** The worker-execution backend that has no propagation channel. */
  backend: string;
  reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted';
  seq: number;
  at: string;
} | {
  /** A manager's driver turn was refused by an unavailable upstream (an exhausted quota, a
   *  rate limit, an overload), and the driver paused before re-entering instead of failing.
   *  Both durations are infrastructure time: `attemptMs` is the refused turn, `pauseMs` the
   *  wait that followed. Informational: replay, `materializeTreeView`, and cost readers skip
   *  it; `seq` counts this node's pauses. */
  kind: 'paused';
  id: NodeId;
  /** The driver attempt that was refused, 1-based. */
  attempt: number;
  /** The code or HTTP status that classified the refusal, such as `provider_quota_exhausted`. */
  signal: string;
  /** The refusal as the driver saw it, redacted and bounded. */
  cause: string;
  attemptMs: number;
  pauseMs: number;
  /** Whether the refused attempt still moved the run toward its deliverable. */
  madeProgress: boolean;
  seq: number;
  at: string;
};
/**
 * The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
 * `loadTree` returns events for inspection and completed-settlement replay, not live process
 * recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).
 */
interface SpawnJournal {
  loadTree(root: NodeId): Promise<SpawnEvent[] | undefined>;
  beginTree(root: NodeId, at: string): Promise<void>;
  appendEvent(root: NodeId, ev: SpawnEvent): Promise<void>;
  /** Publish all events together or none; SQL contexts use this for initialization records. */
  appendEvents?(root: NodeId, events: ReadonlyArray<SpawnEvent>): Promise<void>;
}
/** Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 *  invariant. Split from the journal so the journal stays small (decisions) and the
 *  payloads (evidence) live where a viewer/replayer rehydrates them. */
interface ResultBlobStore {
  put(outRef: string, artifact: unknown): Promise<void>;
  get(outRef: string): Promise<unknown | undefined>;
}
/**
 * Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker,
 * and the root handle. `run` executes the root `Agent` to completion; `attach` wires a
 * live `RootHandle` (the Q2 substrate the chat/pi-viz client later consumes).
 *
 * @stable
 */
interface Supervisor<Task, Out> {
  run(root: Agent<Task, Out>, task: Task, opts: SupervisorOpts): Promise<SupervisedResult<Out>>;
  attach(h: RootHandle<Out>): void;
}
/** Optional recursive admission policy. `ownerShare` is the fraction of every manager's budget
 * kept free for its own inference while children hold their declared slices. */
interface RecursiveReservationPolicy {
  readonly ownerShare: number;
}
interface SupervisorOpts {
  /** The root conserved-pool ceiling (tokens + usd + iterations + deadline). */
  readonly budget: Budget;
  /** Exact root profile/task identity supplied by the one-call composition surface. */
  readonly rootIdentity?: NodeExecutionIdentity;
  /** Trusted composition evidence for a root whose `act` drives an external backend. A generic
   *  root omits it and is durably marked unknown; model-facing Scope never receives this writer. */
  readonly rootMaterialization?: RootMaterialization;
  /** Trace-correlation root + the journal/blob root key. */
  readonly runId: NodeId;
  /** Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability. */
  readonly journal: SpawnJournal;
  /** Result payload store backing `outRef` rehydration. */
  readonly blobs: ResultBlobStore;
  /** Executor resolution — the open registry mapping `AgentSpec` → `Executor`. */
  readonly executors: ExecutorRegistry;
  /** Reconstruct configured executors for interrupted children before resuming the driver. */
  readonly recoverExecutor?: ExecutorFactory<unknown>;
  /** Predicate resolution for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so
   *  the wait can be journaled and re-armed by a later process; this is what the name resolves
   *  against. Unset ⇒ `poll` waits are refused (`unknown-probe`); `timer` waits are unaffected. */
  readonly probes?: WaitProbeRegistry;
  /** Recursion ceiling (root = 0). The conserved pool bounds depth; this only stops a runaway
   *  recursion. Omit = `DEFAULT_MAX_DEPTH` (16). */
  readonly maxDepth?: number;
  /** The bound on concurrently working agents across the whole tree, as a number or as an
   *  allocator from `createWorkerSlots` that several runs share. A spawn past it waits in a queue
   *  instead of being refused. The root holds no slot. Omit/`<= 0` bounds concurrency by the budget
   *  alone. */
  readonly workerSlots?: number | WorkerSlots;
  /** Opt in to keeping each manager's inference share free of its children's slices. A resumed
   *  run must use the same policy. */
  readonly reservationPolicy?: RecursiveReservationPolicy;
  /**
   * OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
   * trips the supervisor to `no-winner` rather than restarting forever.
   */
  readonly maxRestarts?: number;
  readonly withinMs?: number;
  /**
   * How long live children may keep running after the root driver returns or fails, before the join
   * barrier cascades the abort into them (#741). A child mid-unit holds work already paid for, and
   * killing it instantly discards everything it has not yet written. `null` waits until children
   * settle or the caller cancels. An explicit run deadline always wins. Omit/`0` = immediate
   * teardown.
   */
  readonly childSettleGraceMs?: number | null;
  /**
   * How long the join barrier keeps retrying a settled child's teardown until the executor
   * confirms its resources are destroyed. A child's first teardown gets a short acknowledgement
   * window, and a provider delete that fails or answers late then left the sandbox running: on
   * 2026-09-20, cancelling 20 Discovery lanes left 2 workers running, and 136 of 612 agents
   * across that campaign ended with teardown unconfirmed. The barrier re-asks each unconfirmed
   * child with exponential backoff (starting at 1/300 of this window, doubling, capped at 1/10 of
   * it) and releases a failed retained environment again under `retainedAtSettlement:
   * 'release'`. A child still unconfirmed when the window closes is named in
   * `teardownUnconfirmed` with the environment ids its executor reports, and journaled. The
   * nodes pending when the window opens are journaled first as `teardown-pending`, so a process
   * that dies inside the window still leaves their environment ids on record. A retained
   * environment kept for a resume is not retried, and neither is an answer the executor marks
   * `permanent`. The window runs after the run's deadline too: a deadline stops work, not
   * cleanup, so settlement can return up to this long after it. `0` makes one attempt only.
   * Default: 300000 (5 minutes).
   */
  readonly teardownConfirmMs?: number;
  /**
   * Load prior journal state and expose committed settlements through `Scope.resume`.
   * Use persistent journal and blob stores to recover across process restarts.
   * `createFileRunContext` provides the file-backed stores and local ownership lock.
   *
   * Default `false` refuses an existing run ID instead of replacing its journal.
   * Configure `recoverExecutor` to reconcile retained children before new work is admitted.
   * Unresolved keyed work remains in doubt.
   * The file run lock provides local ownership, without distributed fencing.
   * @experimental
   */
  readonly resume?: boolean;
  /**
   * What root settlement does with a provider environment that a settled child still holds for a
   * RETAINED execution (`Executor.releaseRetained`). Such a child settles `down` with its cursor
   * slot open and its environment alive, because a later process that resumes this run reconciles
   * the paid execution inside it.
   *
   * - `'release'`: the run will not be resumed, so nothing would ever reconcile or release those
   *   environments. The join barrier releases each one and journals an `environment-teardown`
   *   receipt per environment. Measured 2026-09-11: four settled runs held 18 of a 60-slot
   *   Sandbox fleet for 19 to 37 hours without it. It then closes each released child's cursor
   *   slot with a terminal record marked `retainedExecution: 'released'`, so `spendGaps` names
   *   it `unreported` (a floor) rather than `never-settled` (a ceiling) and
   *   `fleetYield.releasedUnrecovered` counts it. A release that is refused or cannot be
   *   confirmed names the node in `teardownUnconfirmed` and its `teardown-unconfirmed` record,
   *   and after the retry window closes its slot with `retainedExecution: 'release-unconfirmed'`,
   *   counted by `fleetYield.releaseUnconfirmed`: the settlement is final, so the slot closes
   *   whether or not the environment is confirmed gone. Measured 2026-09-23/24 on the Discovery
   *   fleet (Runtime 0.249.1 to 0.261.0): 338 of 1,620 agents never settled, and 179 of the
   *   retained ones had an admission that never named an environment. A process that dies
   *   between the last `destroyed: true` receipt and the released record leaves the slot open
   *   only until the next resume, whose `healReleasedSlots` writes the identical record from the
   *   `reconciled` record.
   * - `'keep'`: a later process may resume this run, so the environments stay for its recovery.
   *
   * Default: `'keep'` when `resume` is true (a durable run a later process may continue), else
   * `'release'`. A caller that owns finality says so: `supervisePursuit` records a settle record
   * that refuses re-entry, so it always releases. A process crash never reaches settlement, so it
   * releases nothing under either value.
   */
  readonly retainedAtSettlement?: 'release' | 'keep';
  /** @internal Whether provider-backed retained owner cleanup must preserve unreceipted sources. */
  readonly ownerWorkspaceRetention?: boolean;
  readonly now?: () => number;
  readonly signal?: AbortSignal;
  /** Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
   *  same `agent.spawn`/`agent.child` stream `runAgentRounds` feeds — one observable recursive tree. */
  readonly hooks?: RuntimeHooks;
  /**
   * Trace context to hand DOWN to each spawned worker, so a worker in another process or on another
   * machine emits spans that join THIS run's trace instead of opening its own root. Supply
   * `SupervisorSpanRecorder.workerTrace`; the `Scope` seeds the resolved context onto every child's
   * `ExecutorContext` and the backends with an environment channel stamp it as
   * `TRACEPARENT` plus the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair (see `worker-trace.ts` for
   * the precedence rule and for which backends propagate). Omit and no worker environment is
   * touched at all.
   */
  readonly workerTrace?: WorkerTraceResolver;
  /**
   * Declare that this run's worker backend CANNOT carry the trace context
   * (`WORKER_TRACE_PROPAGATION[backend] === false`). With `workerTrace` also set, every spawn then
   * journals a `trace-unpropagated` event naming the severed hop — the host-side record of a
   * distributed trace that will surface disconnected. `supervise()` derives this from its backend;
   * a direct `createSupervisor()` caller may set it for a caller-owned executor registry.
   */
  readonly workerTraceUnpropagated?: {
    readonly backend: string;
    readonly reason: 'no-env-channel' | 'no-worker-process' | 'caller-omitted';
  };
  /** Durable supervisor-run directory that receives exact worker interactive bindings.
   * `supervise({ runDir })` wires this automatically. Direct kernel callers omit it. */
  readonly interactiveBindingDir?: string;
}
/** Provider-observed model identity for the root manager's settled inference turns.
 * Runtime records this only from a Runtime-owned provider/bridge receipt; an authored profile
 * alias is never substituted when the provider omits the identity. */
type RootProviderModelEvidence = ProviderModelExecutionEvidence;
/**
 * The root manager's retained provider stream: `<runDir>/root-stream.jsonl`, one line per
 * progress event the root's executor observed, referenced by the content address of the file's
 * bytes and its committed line count. Present exactly when the run had a run directory and a
 * Runtime-driven root that began at least one drive attempt; a caller-supplied harness leaves it
 * absent, never an empty receipt. Distinct from `outRef`, which on a `winner` names the SELECTED
 * CHILD's artifact.
 */
interface RootStreamReceipt {
  /** `sha256:<hex>` over the file's bytes as they were when the receipt was taken. */
  readonly ref: string;
  /** Committed lines in the file. `0` is a root that drove and produced no observable output. */
  readonly events: number;
}
/** One provider/harness inference attempt. An empty observation list means the attempt started but
 * no trusted served model identity arrived before it failed or ended, unless Router explicitly
 * proves that admission rejected it before provider dispatch. */
interface ProviderModelAttemptEvidence {
  readonly observations: ReadonlyArray<string>;
  readonly identityConflict?: boolean;
  /** Router-owned proof that this attempt never reached a provider. */
  readonly providerDispatch?: 'not_started';
}
/** Durable provider identity evidence, independent from the planned materialization alias. */
type ProviderModelExecutionEvidence = {
  readonly status: 'known';
  readonly attempts: ReadonlyArray<ProviderModelAttemptEvidence>;
  readonly models: ReadonlyArray<string>;
} | {
  readonly status: 'unknown';
  readonly attempts: ReadonlyArray<ProviderModelAttemptEvidence>;
  readonly models: ReadonlyArray<string>;
  readonly reason: 'provider-model-missing' | 'provider-model-conflict';
};
/**
 * A driver's `act()` rejection, normalized to a serializable triple so it survives the typed
 * no-winner boundary (an `Error` does not cross a structured-clone / JSON hop intact). A
 * non-`Error` rejection normalizes to `{ name: 'NonError', message }` — never dropped.
 * Exported so a consumer handling `reason: 'driver-failed'` names this type instead of retyping
 * its fields.
 */
interface NoWinnerError {
  name: string;
  message: string;
  stack?: string;
}
/** The accounting channels a usage gap leaves incomplete. */
type SpendChannel = 'tokens' | 'usd' | `resource:${string}`;
/**
 * One journaled node whose usage accounting is incomplete — the named gap behind a `false`
 * `tokensKnown`/`usdKnown` on a terminal `spentTotal`. `never-settled`: the spawn is durable but
 * no terminal record landed, so the whole subtree is unaccounted on every channel and
 * `spentTotal` charges its budget ceiling instead of a fabricated zero. `unreported`: a settled
 * or metered record landed without a complete provider receipt, so the summed numbers are a
 * floor on the named channels, never the measured total.
 */
interface SpendGap {
  readonly id: NodeId;
  /** The spawn label, when the node's `spawned` event is in this journal tree. */
  readonly label?: string;
  readonly kind: 'never-settled' | 'unreported';
  readonly channels: ReadonlyArray<SpendChannel>;
}
/**
 * The recorded fate of a child whose provider execution was RETAINED: admitted durably, with no
 * accepted terminal result when local observation stopped (the `RetainedExecutionPendingError`
 * path). Not a failure classification — the child is `down` either way.
 *
 * - `'pending'`: the reservation was reconciled at a floor, the cursor slot is open, and the
 *   environment is kept so a resume can reconcile the paid execution. Only ever on the in-memory
 *   `Settled` and the first `agent.child` payload; the journal states it as the `reconciled`
 *   record and replay never yields it. For an executor without `releaseRetained` it means only
 *   that nothing could be released.
 * - `'released'`: root settlement under `retainedAtSettlement: 'release'` destroyed the
 *   environment (executor-confirmed) before any process recovered the execution; this is the
 *   node's terminal record, written by the release sweep in the settling process or by
 *   `healReleasedSlots` on the next resume when that process died between the last
 *   `destroyed: true` receipt and the record (same builder, `seq` and `at`, from the
 *   `reconciled` record). The pool's own admission fault, if the reconcile raised one, is not
 *   on this record.
 * - `'release-unconfirmed'`: root settlement under `retainedAtSettlement: 'release'` ended with
 *   the execution unrecovered and its environment NOT confirmed destroyed: the provider refused
 *   the delete, the executor could not confirm it, or the admission never named an environment
 *   (a create that timed out). The settlement is final, so no process will recover the execution
 *   and the slot closes anyway, with the same builder, `seq` and `at` as `'released'`. What the
 *   node may still hold stays named by its `teardown-unconfirmed` record and in
 *   `teardownUnconfirmed`, for a sweeper.
 *
 * Absent = an ordinary child. The live `Settled` a driver branched on carried `'pending'` where
 * replay yields `'released'` or `'release-unconfirmed'` for the same seq, so a resume-aware driver
 * must not branch on these values. No `'recovered'` value exists yet: a live-adopted recovery
 * settles on the ordinary path and the recorded-result path writes no marker.
 */
type RetainedExecutionState = 'pending' | 'released' | 'release-unconfirmed';
/**
 * How this run's spawned CHILDREN ended, counted by node id off the complete journal FOREST at
 * root settlement — after the join barrier and the release sweep, so the terminal records the
 * sweep wrote are included, and forest-wide so a director's grandchildren count (the population
 * the observer projection shows). Invariant: `spawned === done + down + cancelled + neverSettled`.
 * Distinct from a no-winner's `downCount`, the breaker's tally of ordinary down settlements: a
 * released record is the driver's earlier down re-stated, so the breaker skips it and
 * `downCount` never includes a retained child, while `down` here does. `spendGaps` stays
 * root-tree scoped, so on a nested run the two disagree by design.
 */
interface FleetYield {
  /** Every `spawned` record with a parent; the run root and an owned tree's re-rooted owner copy
   *  are exempt. */
  readonly spawned: number;
  readonly done: number;
  /** `settled` records with `status: 'down'`, released records included. */
  readonly down: number;
  readonly cancelled: number;
  /** Spawned with no terminal record: a crash-orphaned child, or a retained child of a run that
   *  keeps its environments for a resume (`retainedAtSettlement: 'keep'`). Named after
   *  `SpendGap`'s `never-settled`. */
  readonly neverSettled: number;
  /** Terminal records marked `retainedExecution: 'released'` — a subset of `down + cancelled`.
   *  A nested manager whose OWN retained execution was released counts here beside the
   *  grandchildren it released, because its execution was destroyed unrecovered too. */
  readonly releasedUnrecovered: number;
  /** Terminal records marked `retainedExecution: 'release-unconfirmed'` — a subset of
   *  `down + cancelled`, disjoint from `releasedUnrecovered`: executions a final settlement left
   *  unrecovered without confirming their environment destroyed. */
  readonly releaseUnconfirmed: number;
}
/**
 * One channel on which a settled reservation's measured spend exceeded what it reserved.
 * `tokens` is in the pool's charged unit (`chargedTokens`), `usd` is measured dollars, and a
 * `resource:<name>` entry is in the unit that resource's budget declares.
 */
interface BudgetOverspend {
  readonly channel: SpendChannel | 'iterations';
  readonly reserved: number;
  readonly spent: number;
}
/**
 * A settled reservation whose measured spend exceeded what it reserved.
 *
 * It records an accounting fact, not an outcome. A child that completed stays `done` with its
 * artifact, and a child that failed stays `down`. The pool commits the true spend, so its free
 * balance already carries the overspend and later reservations are refused on their own.
 * Spend the pool cannot verify (unknown dollars under a dollar cap, unknown or overflowing
 * resource usage) is not an overspend: it fails the child closed instead.
 */
interface BudgetViolation {
  /** Every overspent channel, in the order tokens, iterations, usd, then resources. Never empty. */
  readonly overspent: ReadonlyArray<BudgetOverspend>;
}
/** Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output. */
type SupervisedResult<Out> = {
  kind: 'winner';
  out: Out;
  outRef: string;
  verdict?: DefaultVerdict;
  tree: TreeView;
  /** The run's terminal accounting. `iterations`/`tokens`/`usd` are per-channel journal sums;
   *  `ms` is the wall clock from supervise start (the ORIGINAL root instant on a resumed run)
   *  to this terminal state — executors under-report their own `ms` and parallel children
   *  overlap, so a per-event sum cannot state the run's real duration. `tokensKnown`/`usdKnown`
   *  are always explicit here: `true` is the checked claim that every spawn reached a terminal
   *  record and every settled/metered record carried a complete receipt on that channel;
   *  `false` comes with the unaccounted nodes named in `spendGaps`. */
  spentTotal: Spend;
  /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
  readonly rootProviderModel?: RootProviderModelEvidence;
  /** The root manager's retained provider stream, when the run directory holds one. */
  readonly rootStream?: RootStreamReceipt;
  /** The root manager's native harness session, persisted like a child's receipt. A child's
   *  receipt rides its settle record and the root has none, so the result carries it. Absent
   *  for a router-brained root, which runs no driver. */
  readonly rootHarnessTranscript?: HarnessTranscriptEvidence;
  /** What the root's external driver loop did: genuine continuations, failure retries,
   *  environment replacements, why the loop ended, and how the root closed the run. Absent for
   *  a router-brained root, which runs no driver loop. */
  readonly continuation?: DriverContinuationRecord;
  /** Runtime-owned provider evidence reduced across the complete journal forest. */
  readonly providerModel?: ProviderModelExecutionEvidence;
  /** Settled children whose teardown stayed unconfirmed after the settlement retry window
   *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
   *  provider environments a sweeper deletes when its executor reports them, and each is
   *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
   *  never carries it. */
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
   *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
  spendGaps?: ReadonlyArray<SpendGap>;
  /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
  fleetYield: FleetYield;
  /** Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
   *  `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
   *  `driverInference + childWork === spentTotal` on `iterations`/`tokens`/`usd`; the
   *  breakdown's `ms` fields stay executor-reported sums while `spentTotal.ms` is wall clock.
   *  Present whenever any driver metered. */
  spentBreakdown?: {
    driverInference: Spend;
    childWork: Spend;
  };
} | ({
  /**
   * The LIFECYCLE no-winner arms: the supervisor itself proved why nothing was delivered, so
   * the reason is complete on its own and there is no driver rejection to hand back. A tripped
   * breaker or every child down is `all-children-down`, a cascaded abort is `aborted`, an
   * empty pool is `budget-exhausted`. These outrank `driver-failed`: when the driver threw
   * BECAUSE the pool emptied or the run was aborted, the lifecycle cause is the explanation.
   * One down child among delivered siblings is not a lifecycle cause; it rides `downCount`.
   */
  kind: 'no-winner';
  tree: TreeView;
  downCount: number;
  /** The conserved spend incurred before the run failed — real cost is paid even when no
   *  worker delivers, so the caller always learns what the delegation actually spent. Summed
   *  off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
   *  explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`. */
  spentTotal: Spend;
  /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
  readonly rootProviderModel?: RootProviderModelEvidence;
  /** The root manager's retained provider stream, when the run directory holds one. */
  readonly rootStream?: RootStreamReceipt;
  /** The root manager's native harness session, persisted like a child's receipt. A child's
   *  receipt rides its settle record and the root has none, so the result carries it. Absent
   *  for a router-brained root, which runs no driver. */
  readonly rootHarnessTranscript?: HarnessTranscriptEvidence;
  /** What the root's external driver loop did: genuine continuations, failure retries,
   *  environment replacements, why the loop ended, and how the root closed the run. Absent for
   *  a router-brained root, which runs no driver loop. */
  readonly continuation?: DriverContinuationRecord;
  /** Runtime-owned provider evidence reduced across the complete journal forest. */
  readonly providerModel?: ProviderModelExecutionEvidence;
  /** Settled children whose teardown stayed unconfirmed after the settlement retry window
   *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
   *  provider environments a sweeper deletes when its executor reports them, and each is
   *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
   *  never carries it. */
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  /** Budget reservations still open when the run reached its join barrier, each named by the
   *  assignment, child id, and lifecycle stage that holds it. The conserved-pool identity
   *  `total ≡ free + reserved + committed` does not hold, so `spentTotal` is a floor rather
   *  than a measurement — the run still settles with the tree and the spend the journal
   *  recorded. Present exactly when non-empty; a healthy run never carries it. */
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
   *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
  spendGaps?: ReadonlyArray<SpendGap>;
  /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
  fleetYield: FleetYield;
  /** Never present on a lifecycle arm — the discriminant, not prose, is what makes
   *  `if (r.reason === 'driver-failed') r.error.message` compile and every other arm refuse it. */
  error?: never;
} & ({
  /**
   * `no-children-spawned`: the root ran to completion under budget, selected nothing, and
   * never spawned a child. Until this arm existed that run settled `all-children-down`
   * with `downCount: 0`, which reads as a fleet failure to anyone who did not open the
   * journal; fifteen sandbox-placed directors settled that way in one week while the
   * actual fault was that the root never recursed.
   *
   * `no-result-selected`: the root ran to completion under budget, spawned children, and
   * selected nothing while no child was down when it settled. Until this arm existed that
   * run also settled `all-children-down`: on the 2026-09-20 fleet corpus, 46 of the 57
   * runs carrying that reason had zero down children in their own `fleetYield`, and a
   * reader of the label learned that banking pages was losing. `all-children-down` now
   * asserts what its name says: the supervisor observed a down child, a tripped breaker,
   * or every child down, before the root settled.
   */
  reason: 'all-children-down' | 'no-children-spawned' | 'no-result-selected' | 'budget-exhausted' | 'aborted';
} | {
  reason: 'cancelled';
  readonly source: string;
  readonly cancellationReason: string;
  readonly operationId?: string;
})) | {
  /**
   * The DRIVER-FAULT arm: `act()` rejected and no lifecycle cause (breaker/abort/budget/every
   * child down) outranks it — so nothing about the tree explains the failure and the driver's
   * own rejection is the only thing that does. It is therefore REQUIRED here. One down child
   * among delivered siblings does not outrank it: that count rides `downCount`.
   * `all-children-down` with `downCount: 0` used to be indistinguishable from an honest empty
   * result; this arm is that configuration/authoring fault, named.
   */
  kind: 'no-winner';
  reason: 'driver-failed';
  tree: TreeView;
  downCount: number;
  /** The conserved spend incurred before the run failed — real cost is paid even when no
   *  worker delivers, so the caller always learns what the delegation actually spent. Summed
   *  off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
   *  explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`. */
  spentTotal: Spend;
  /** Runtime-owned provider evidence for the root manager, when the root executed inference. */
  readonly rootProviderModel?: RootProviderModelEvidence;
  /** The root manager's retained provider stream, when the run directory holds one. */
  readonly rootStream?: RootStreamReceipt;
  /** The root manager's native harness session, persisted like a child's receipt. A child's
   *  receipt rides its settle record and the root has none, so the result carries it. Absent
   *  for a router-brained root, which runs no driver. */
  readonly rootHarnessTranscript?: HarnessTranscriptEvidence;
  /** What the root's external driver loop did: genuine continuations, failure retries,
   *  environment replacements, why the loop ended, and how the root closed the run. Absent for
   *  a router-brained root, which runs no driver loop. */
  readonly continuation?: DriverContinuationRecord;
  /** Runtime-owned provider evidence reduced across the complete journal forest. */
  readonly providerModel?: ProviderModelExecutionEvidence;
  /** Settled children whose teardown stayed unconfirmed after the settlement retry window
   *  (`teardownConfirmMs`) — the resources this run could not prove destroyed. Each names the
   *  provider environments a sweeper deletes when its executor reports them, and each is
   *  journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a healthy run
   *  never carries it. */
  teardownUnconfirmed?: ReadonlyArray<UnconfirmedTeardown>;
  /** Budget reservations still open when the run reached its join barrier, each named by the
   *  assignment, child id, and lifecycle stage that holds it. The conserved-pool identity
   *  `total ≡ free + reserved + committed` does not hold, so `spentTotal` is a floor rather
   *  than a measurement — the run still settles with the tree and the spend the journal
   *  recorded. Present exactly when non-empty; a healthy run never carries it. */
  leakedReservations?: ReadonlyArray<LeakedReservation>;
  /** The journaled nodes whose usage accounting is incomplete — the named gaps behind a
   *  `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty. */
  spendGaps?: ReadonlyArray<SpendGap>;
  /** How the fleet ended, see `FleetYield`. Always present: zeros are facts. */
  fleetYield: FleetYield;
  /** The driver's own rejection, carried across the typed no-winner boundary so the failure is
   *  recoverable by the caller. A non-`Error` rejection is normalized, never dropped. */
  error: NoWinnerError;
};
/** Live root handle — a chat/pi-viz client uses it to inspect and control one root run. */
interface RootHandle<Out> {
  view(): TreeView;
  /** Optional for structural compatibility with existing view/signal/abort wrappers. Handles
   * minted by `createRootHandle` implement the required form in `SteerableRootHandle`. */
  deliver?(msg: unknown): boolean;
  signal(msg: RootSignal): void;
  abort(reason?: string): void;
  /** Phantom: binds the handle to the supervised run's output type. Type-only — never
   *  present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed. */
  readonly __out?: Out;
}
/** A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox.
 * Delivery returns `false` when the manager has no receive path; detached calls fail loud. */
interface SteerableRootHandle<Out> extends RootHandle<Out> {
  deliver(msg: unknown): boolean;
}
/** Out-of-band message to a running root. Open by intent — a client extends it. */
type RootSignal = {
  kind: 'pause';
} | {
  kind: 'resume';
} | {
  kind: 'cancel';
  reason?: string;
} | {
  kind: 'ask';
  question: string;
};
/**
 * The progressive-widening gate (MCTS-PW). Decides whether a settled child is
 * `promising` enough to spawn another under the remaining pool. DEFAULTS TO FLAT
 * (`shouldWiden` always false) so a gate run never widens and the selector≠judge
 * firewall conflict (R2) stays dormant. When widening IS enabled, `promising` MUST be
 * derived from TRACE findings (`analyses`), never raw `verdict` — or the gate carries
 * an explicit, argued `judgeExempt: true` (the documented escape hatch, off by default).
 */
interface WidenGate<Out> {
  /** Default impl returns false for every settlement (flat — never widens). */
  shouldWiden(settled: Settled<Out>, budget: Scope<Out>['budget']): boolean;
  /** When true, widening may read `verdict` directly (collides with the steer firewall —
   *  must be explicitly argued per cell, never defaulted on). */
  readonly judgeExempt?: boolean;
}
//#endregion
export { SpawnJournal as $, RuntimeStreamEvent as $a, Iteration as $i, ReadableEnvironment as $n, RetainedInteractiveBindingError as $r, RuntimeStreamEventCollector as $t, NodeExecutionIdentity as A, RuntimeRunStatus as Aa, RetainedRunStartMaterial as Ai, RetainedPendingCause as An, ContinuationPanelInput as Ar, TraceContext as At, ResultBlobStore as B, AgentTaskRunResult as Ba, ReservationHolder as Bi, ReconnectRetainedInteractiveRunOptions as Bn, distillFindings as Br, OtelSpan as Bt, ExecutorToolCall as C, Validator as Ca, RetainedRunEffect as Ci, SessionTraceBox as Cn, CheckUnavailableError as Cr, WorkspaceCheckpointMarker as Ct, MaterializedExecutionIdentity as D, RuntimeRunOptions as Da, RetainedRunIntentAdmission as Di, decodeToolPart as Dn, ContinuationEntry as Dr, workerTraceEnv as Dt, HeldEnvironment as E, RuntimeRunHandle as Ea, RetainedRunHandle as Ei, createPushTraceSource as En, ContinuationContext as Er, readWorkerTraceContext as Et, ProviderModelAttemptEvidence as F, AgentExecutionBackend as Fa, BudgetPoolRestore as Fi, ScopeProgressInput as Fn, VerdictSummary as Fr, LoopSpanNode as Ft, RootMaterialization as G, OpenAIChatResponseFormat as Ga, ReservationWaitRefused as Gi, RetainedInteractiveStartMaterial as Gn, AgentEvalError$1 as Gr, createOpenInferenceFileExporter as Gt, ResumedWork as H, AgentTaskStatus as Ha, ReservationShortfall as Hi, RetainedInteractiveAdmissionHook as Hn, failedItems as Hr, buildLoopOtelSpans as Ht, ProviderModelExecutionEvidence as I, AgentKnowledgeProvider as Ia, BudgetReadout as Ii, TeamProgress as In, admitContinuationPolicy as Ir, OtelAttribute as It, RootStreamReceipt as J, RunAgentTaskOptions as Ja, spendFromUsageEvents as Ji, HarnessTranscriptCapture as Jn, ConfigError as Jr, loopEventToOtelSpan as Jt, RootProviderModelEvidence as K, OpenAIChatTool as Ka, ReserveOptions as Ki, StartRetainedInteractiveRunOptions as Kn, AgentEvalErrorCode as Kr, createOtelExporter as Kt, RecursiveReservationPolicy as L, AgentRuntimeEvent as La, BudgetReconcileFault as Li, WorkerProgress as Ln, admitFinding as Lr, OtelExportConfig as Lt, NodeSnapshot as M, AgentAdapter as Ma, StartRetainedRunInEnvironmentOptions as Mi, ActivityNote as Mn, ContinuationPolicy as Mr, mergeTraceEnv as Mt, NodeStatus as N, AgentBackendContext as Na, StartRetainedRunOptions as Ni, DEFAULT_STALL_AFTER_MS as Nn, ContinuationProfile as Nr, readTraceContextFromEnv as Nt, MaterializedModelIdentity as O, RuntimeRunPersistenceAdapter as Oa, RetainedRunReplayPoint as Oi, sandboxSessionTraceSource as On, ContinuationNoteInput as Or, workerTraceHeaders as Ot, ProfileMaterializationReceipt as P, AgentBackendInput as Pa, BudgetPool as Pi, ExecutorProgress as Pn, PanelFinding as Pr, traceContextToEnv as Pt, SpawnEvent as Q, RuntimeSessionStore as Qa, ExecCtx as Qi, HarnessTranscriptUnavailableReason as Qn, RetainedInteractiveAdmissionError as Qr, RuntimeEventCollector as Qt, ResourceLimit as R, AgentRuntimeEventSink as Ra, LeakedReservation as Ri, createActivityLog as Rn, checkVerdictOf as Rr, OtelExportStats as Rt, ExecutorTeardownWarning as S, ValidationCtx as Sa, RetainedRunDispatchedAdmission as Si, SessionMessageLike as Sn, CheckRead as Sr, WorkerTraceUnavailableReason as St, Handle as T, RuntimeRunCost as Ta, RetainedRunEventOptions as Ti, TraceSource as Tn, ContinuationAppend as Tr, WorkerTraceSeamCarrier as Tt, RetainedExecutionState as U, BackendErrorDetail as Ua, ReservationStage as Ui, RetainedInteractiveEnvironmentInput as Un, passedItems as Ur, buildLoopSpanNodes as Ut, ResumedKeyState as V, AgentTaskSpec as Va, ReservationRejection as Vi, RecoverRetainedInteractiveRunOptions as Vn, expandQuestions as Vr, RuntimeEventOtelOptions as Vt, RootHandle as W, KnowledgeReadinessDecision as Wa, ReservationTicket as Wi, RetainedInteractiveRunHandle as Wn, verdictFromJudgeScore as Wr, buildRuntimeEventOtelSpans as Wt, Scope as X, RuntimeCanonicalStreamEvent as Xa, DefaultVerdict$1 as Xi, HarnessTranscriptFile as Xn, NotFoundError as Xr, padTraceId as Xt, Runtime as Y, RunAgentTaskStreamOptions as Ya, AgentRunSpec as Yi, HarnessTranscriptEvidence as Yn, JudgeError as Yr, padSpanId as Yt, Settled as Z, RuntimeSession as Za, Driver as Zi, HarnessTranscriptUnavailable as Zn, PlannerError as Zr, toOtelAttributes as Zt, ExecutorMaterialization as _, MountRecorder as _a, RetainedInteractiveStartedAdmission as _i, isWaitOutcome as _n, upstreamUnavailableSignal as _r, WaitOpts as _t, BudgetOverspend as a, LoopLineageOptions as aa, WorkerSlots as ai, createRuntimeEventCollector as an, DriverAttemptsExhaustedError as ar, SpendGap as at, ExecutorRegistry as b, SandboxClient as ba, RetainedRunCancelOptions as bi, validateWaitSpec as bn, CONTINUATIONS_DIR as br, WorkerInteractiveUnavailableReason as bt, EnvironmentTeardownReceipt as c, LoopResult as ca, NativeContextContinuationHandle as ci, sanitizeKnowledgeReadinessReport as cn, DriverContractState as cr, SubtreeSummary as ct, ExecutorAccounting as d, LoopTeardownFailedPayload as da, RecoverRetainedRunIntentOptions as di, WaitOutcome as dn, DriverProgressMark as dr, SupervisorOpts as dt, LoopDecisionPayload as ea, RetainedRunAdmissionError as ei, RuntimeStreamEventSink as en, captureHarnessTranscript as er, SpawnOpts as et, ExecutorCancellation as f, LoopTokenUsage as fa, RecoverRetainedRunOptions as fi, WaitProbe as fn, DriverReentry as fr, TokenUsageProvenance as ft, ExecutorFactory as g, MountManifestEntry as ga, RetainedInteractiveIntentAdmission as gi, createWaitProbes as gn, summarizeDriverAttempts as gr, UsageEvent as gt, ExecutorExecutionBinding as h, LoopWinner as ha, RetainedInteractiveEnvironmentAdmission as hi, WaitSpec as hn, classifyDriverFailure as hr, UnknownMaterializationReason as ht, Budget as i, LoopIterationStartedPayload as ia, SlotPermit as ii, SanitizedKnowledgeRequirement as in, DriverAttemptStop as ir, SpendChannel as it, NodeId as j, startRuntimeRun as ja, RetainedRunTurnInput as ji, ActivityLog as jn, ContinuationPanelResult as jr, createPropagatingTraceEmitter as jt, NoWinnerError as k, RuntimeRunRow as ka, RetainedRunSnapshot as ki, RetainedChildRecovery as kn, ContinuationPanel as kr, workerTraceSeamKey as kt, ExecutionBindingReceipt as l, LoopSandboxPlacement as la, NativeContextContinuationInput as li, sanitizeRuntimeStreamEvent as ln, DriverFailureClass as lr, SupervisedResult as lt, ExecutorContext as m, LoopTraceEvent as ma, RetainedInteractiveAdmission as mi, WaitRejection as mn, DriverRetryPolicy as mr, UnconfirmedTeardown as mt, AgentExecutionRef as n, LoopIterationDispatchPayload as na, RuntimeRunStateError as ni, RuntimeTelemetryOptions as nn, persistHarnessTranscript as nr, SpawnRejection as nt, BudgetViolation as o, LoopPlanDescription as oa, createWorkerSlots as oi, createRuntimeStreamEventCollector as on, DriverBudgetReadout as or, SteerableRootHandle as ot, ExecutorCancellationRequest as p, LoopTraceEmitter as pa, RecoverRetainedRunResult as pi, WaitProbeRegistry as pn, DriverRepromptRefusal as pr, TreeView as pt, RootSignal as q, OpenAIChatToolChoice as qa, createBudgetPool as qi, HarnessTranscriptArtifact as qn, BackendTransportError as qr, generateSpanId as qt, AgentSpec as r, LoopIterationEndedPayload as ra, ValidationError as ri, SanitizedKnowledgeReadinessReport as rn, DriverAttemptRecord as rr, Spend as rt, DefaultVerdict as s, LoopPlanPayload as sa, NativeContextContinuationExecution as si, sanitizeAgentRuntimeEvent as sn, DriverContinuationRecord as sr, SubtreeResult as st, Agent as t, LoopEndedPayload as ta, RetainedRunDispatchBindingError as ti, RuntimeStreamEventSummary as tn, harnessTranscriptArtifact as tr, SpawnPrior as tt, Executor as u, LoopStartedPayload as ua, ReconnectRetainedRunOptions as ui, PendingWait as un, DriverLoopRecord as ur, Supervisor as ut, ExecutorNodeContext as v, OutputAdapter as va, RetainedRunAdmission as vi, pollFor as vn, UnavailablePausePolicy as vr, WidenGate as vt, FleetYield as w, RuntimeRunCompleteInput as wa, RetainedRunEnvironmentAdmission as wi, ToolStepInput as wn, CheckVerdict as wr, WorkerTraceResolver as wt, ExecutorResult as x, SelectionReceipt as xa, RetainedRunCancellation as xi, waitUntil as xn, CONTINUATION_FACTS as xr, WorkerTraceEvidence as xt, ExecutorProgressEvent as y, RunProvenance as ya, RetainedRunAdmissionHook as yi, timerAt as yn, AdmittedFinding as yr, WorkerInteractiveSession as yt, ResourceSpend as z, AgentTaskContext as za, ReservationFloor as zi, readWorkerProgress as zn, composeContinuationNote as zr, OtelExporter as zt };
//# sourceMappingURL=types-D56jQad-.d.ts.map