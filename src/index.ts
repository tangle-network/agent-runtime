/**
 * @tangle-network/agent-runtime
 *
 * Reusable runtime lifecycle for domain-specific agents. Standardizes the
 * task lifecycle (knowledge readiness → questions / acquisition → control
 * loop → eval) and delegates domain behavior to an adapter. Owns no domain
 * policy, models, tools, connectors, or UI.
 *
 * See `docs/concepts.md` (mental model) and `README.md` (quickstart).
 */

// ── Re-exports from @tangle-network/agent-eval ───────────────────────
export type {
  ControlBudget,
  ControlDecision,
  ControlEvalResult,
  ControlRunResult,
  ControlStep,
  DataAcquisitionPlan,
  KnowledgeReadinessReport,
  KnowledgeRequirement,
  RunRecord,
} from '@tangle-network/agent-eval'
export type { BackendRetryPolicy } from './backends'
// ── Backends ──────────────────────────────────────────────────────────
export {
  createIterableBackend,
  createOpenAICompatibleBackend,
  createSandboxPromptBackend,
} from './backends'
// ── Immutable candidate execution ─────────────────────────────────────
// One verified bundle → one exact per-task plan → one protected run receipt.
// This composes the shared profile materializer and agent-eval trace store;
// benchmark adapters supply only environment-specific artifact/container ports.
export * from './candidate-execution'
export type {
  AuthSource,
  BackendCallPolicy,
  CircuitBreakerConfig,
  Conversation,
  ConversationDriveState,
  ConversationJournal,
  ConversationJournalEntry,
  ConversationParticipant,
  ConversationPolicy,
  ConversationResult,
  ConversationStreamEvent,
  ConversationTurn,
  D1DatabaseLike,
  D1StmtLike,
  ForwardHeaderName,
  HaltContext,
  HaltPredicate,
  HaltReason,
  HaltSignal,
  PropagatedHeaders,
  RetryableErrorPredicate,
  RetryBackoff,
  RunConversationOptions,
  SqlAdapter,
  TurnOrder,
} from './conversation'
// ── Conversations (multi-agent, distributed) ──────────────────────────
// Drives N participants in turn through any reachable AgentExecutionBackend
// (in-process, local cli-bridge, sandbox, router, remote agent-gateway).
// Layered primitives — durable journal, per-turn call policy (deadline +
// retry + circuit breaker), deterministic turn ids, and cross-gateway header
// propagation — make the same driver work same-machine, same-cluster, and
// cross-cloud without code changes. See docs/agent-bus-protocol.md.
export {
  buildForwardHeaders,
  CircuitBreakerState,
  CircuitOpenError,
  computeBackoff,
  createConversationBackend,
  DEFAULT_MAX_DEPTH,
  DeadlineExceededError,
  d1ToSqlAdapter,
  defaultIsRetryable,
  defineConversation,
  FileConversationJournal,
  FORWARD_HEADERS,
  InMemoryConversationJournal,
  isDepthExceeded,
  makePerAttemptSignal,
  type PersonaConversationResult,
  type PersonaDriver,
  type RunPersonaConfig,
  type RunPersonaConversationOptions,
  readDepth,
  runConversation,
  runConversationStream,
  runPersonaConversation,
  runPersonaDispatch,
  SqlConversationJournal,
  sleep,
  slugifySpeaker,
  turnId,
} from './conversation'
// ── Errors ───────────────────────────────────────────────────────────
export {
  AgentEvalError,
  type AgentEvalErrorCode,
  BackendTransportError,
  ConfigError,
  JudgeError,
  NotFoundError,
  PlannerError,
  RuntimeRunStateError,
  ValidationError,
} from './errors'
// ── Improvement (self-improvement surfaces) ──────────────────────────
// Complete agent-eval methods optimize profile fields. Runtime owns only
// isolated code/worktree candidate execution.
export * from './improvement'
// ── Knowledge orchestration ──────────────────────────────────────────
// Runtime owns live agent orchestration; agent-knowledge owns the KB/RAG/memory state.
// These wrappers bridge the two without making agent-knowledge import runtime.
export * from './knowledge'
// ── Delegated loop-runner (configured code/research/review/audit/improvement) ──
export {
  auditLoopRunner,
  DELEGATED_LOOP_MODES,
  type DelegatedLoopMode,
  type DelegatedLoopRegistry,
  type DelegatedLoopResult,
  type DelegatedLoopRunner,
  isDelegatedLoopMode,
  type ResearchLoopResult,
  type ResearchLoopRunnerOptions,
  type RunDelegatedLoopOptions,
  researchLoopRunner,
  runDelegatedLoop,
  type VetoedFact,
  type WorktreeLoopRunnerOptions,
  worktreeLoopRunner,
} from './loop-runner'
export {
  type LoopRunnerCliArgs,
  type LoopRunnerCliResult,
  parseLoopRunnerArgv,
  runLoopRunnerCli,
} from './loop-runner-bin'
// ── MCP → OpenAI tools projection ────────────────────────────────────
// Helper for eval / orchestrator code that routes through the
// OpenAI-compat backend and needs the 5 delegation tools surfaced to
// the model. Sandbox-SDK callers discover tools via the runtime's MCP
// mount and don't need this projection.
export { mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset } from './mcp/openai-tools'
export type { WorktreeCheckRunner } from './mcp/worktree-harness'
// ── Chat-model resolution ────────────────────────────────────────────
// Router catalog fetch + fail-closed id validation + precedence resolver.
export type {
  ChatModelCandidate,
  ChatModelValidation,
  ModelInfo,
  ResolvedChatModel,
  RouterEnv,
} from './model-resolution'
export {
  cleanModelId,
  DEFAULT_ROUTER_BASE_URL,
  getModels,
  resolveChatModel,
  resolveRouterBaseUrl,
  validateChatModelId,
} from './model-resolution'
export type {
  EvalRunEvent,
  EvalRunGeneration,
  EvalRunsExportConfig,
  EvalRunsExportResult,
  LoopSpanNode,
  OtelAttribute,
  OtelExportConfig,
  OtelExporter,
  OtelSpan,
  RuntimeEventOtelOptions,
} from './otel-export'
// ── OTEL export + trace propagation + eval-run provenance ────────────
export {
  buildLoopOtelSpans,
  buildLoopSpanNodes,
  buildRuntimeEventOtelSpans,
  createOtelExporter,
  exportEvalRuns,
  generateSpanId,
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
  toOtelAttributes,
} from './otel-export'
// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'
export type { AgentBackendKind, ResolveAgentBackendOptions } from './resolve-agent-backend'
export { resolveAgentBackend } from './resolve-agent-backend'
// ── Run loop ─────────────────────────────────────────────────────────
export { applyRunRecordDefaults, runAgentTask, runAgentTaskStream } from './run'
// ── Execution kernel ─────────────────────────────────────────────────
// The organism-level execution surface — supervision, the open `Executor` port and its
// registry, conserved budgets, the finalizer seam, analyst wiring, and the
// round-synchronous loop — ships on `@tangle-network/agent-runtime/kernel`.
// These are its headline types; import the values (`supervise`, `createExecutor`,
// `createSupervisor`, `runAgentRounds`, the combinators) from that subpath.
export type {
  AgentSpec,
  AnalystRegistry,
  Budget,
  CoordinationEvent,
  Driver,
  Executor,
  ExecutorRegistry,
  FinalizeContext,
  LoopResult,
  Scope,
  Settled,
  Spend,
  SupervisedResult,
  Supervisor,
  SupervisorFinalizer,
  WorkerTraceEvidence,
  WorkerTraceUnavailableReason,
} from './runtime'
// ── Runtime hooks ────────────────────────────────────────────────────
export type {
  RuntimeDecisionEvidenceRef,
  RuntimeDecisionKind,
  RuntimeDecisionPoint,
  RuntimeHookContext,
  RuntimeHookErrorContext,
  RuntimeHookEvent,
  RuntimeHookPhase,
  RuntimeHooks,
  RuntimeHookTarget,
} from './runtime-hooks'
export {
  composeRuntimeHooks,
  defineRuntimeHooks,
  notifyRuntimeDecisionPoint,
  notifyRuntimeHookEvent,
} from './runtime-hooks'
// ── Production run lifecycle ─────────────────────────────────────────
export type {
  RuntimeRunCompleteInput,
  RuntimeRunCost,
  RuntimeRunHandle,
  RuntimeRunOptions,
  RuntimeRunPersistenceAdapter,
  RuntimeRunRow,
  RuntimeRunStatus,
} from './runtime-run'
export { startRuntimeRun } from './runtime-run'
// ── Sanitization / telemetry ─────────────────────────────────────────
export type {
  RuntimeEventCollector,
  RuntimeStreamEventCollector,
  RuntimeStreamEventSink,
  RuntimeStreamEventSummary,
  RuntimeTelemetryOptions,
  SanitizedKnowledgeReadinessReport,
  SanitizedKnowledgeRequirement,
} from './sanitize'
export {
  createRuntimeEventCollector,
  createRuntimeStreamEventCollector,
  sanitizeAgentRuntimeEvent,
  sanitizeKnowledgeReadinessReport,
  sanitizeRuntimeStreamEvent,
} from './sanitize'
// ── Sessions ──────────────────────────────────────────────────────────
export { InMemoryRuntimeSessionStore } from './sessions'
// ── SSE ───────────────────────────────────────────────────────────────
export {
  readinessServerSentEvent,
  runtimeStreamServerSentEvent,
  type ServerSentEventOptions,
} from './sse'
// ── Core types ───────────────────────────────────────────────────────
export type {
  AgentAdapter,
  AgentBackendContext,
  AgentBackendInput,
  AgentExecutionBackend,
  AgentKnowledgeProvider,
  AgentRuntimeEvent,
  AgentRuntimeEventSink,
  AgentTaskContext,
  AgentTaskRunResult,
  AgentTaskSpec,
  AgentTaskStatus,
  BackendErrorDetail,
  KnowledgeReadinessDecision,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  RunAgentTaskOptions,
  RunAgentTaskStreamOptions,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
