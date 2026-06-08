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

// ── Backends ──────────────────────────────────────────────────────────
export {
  createIterableBackend,
  createOpenAICompatibleBackend,
  createSandboxPromptBackend,
} from './backends'
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
  readDepth,
  runConversation,
  runConversationStream,
  SqlConversationJournal,
  sleep,
  slugifySpeaker,
  turnId,
} from './conversation'
// ── Chat-turn HTTP orchestration ──────────────────────────────────────
// `handleChatTurn` frames a producer with the `session.run.*` envelope
// + NDJSON line protocol + persist/post-process/trace-flush hook order.
// `deriveExecutionId` produces the stable id products persist so a
// client retry can replay the same substrate execution. Long-running
// execution durability itself lives in @tangle-network/sandbox.
export * from './durable'
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
// ── Delegated loop-runner (configured code/research/review/audit/self-improve/dynamic) ──
export {
  auditLoopRunner,
  type CoderLoopRunnerOptions,
  coderLoopRunner,
  DELEGATED_LOOP_MODES,
  type DelegatedLoopMode,
  type DelegatedLoopRegistry,
  type DelegatedLoopResult,
  type DelegatedLoopRunner,
  type DynamicLoopRunnerOptions,
  dynamicLoopRunner,
  isDelegatedLoopMode,
  type ResearchLoopResult,
  type ResearchLoopRunnerOptions,
  type RunDelegatedLoopOptions,
  researchLoopRunner,
  reviewLoopRunner,
  runDelegatedLoop,
  selfImproveLoopRunner,
  type VetoedFact,
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
// ── Chat-model resolution ────────────────────────────────────────────
// Router catalog fetch + fail-closed id validation + precedence resolver.
export type { ModelInfo, ResolvedChatModel, RouterEnv } from './model-resolution'
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
  OtelAttribute,
  OtelExportConfig,
  OtelExporter,
  OtelSpan,
} from './otel-export'
// ── OTEL export + trace propagation + eval-run provenance ────────────
export {
  buildLoopOtelSpans,
  createOtelExporter,
  exportEvalRuns,
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
} from './otel-export'
// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'
// ── Run loop ─────────────────────────────────────────────────────────
export { applyRunRecordDefaults, runAgentTask, runAgentTaskStream } from './run'
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
  RuntimeRunHandle,
  RuntimeRunPersistenceAdapter,
  RuntimeRunRow,
} from './runtime-run'
export { startRuntimeRun } from './runtime-run'
// ── Sanitization / telemetry ─────────────────────────────────────────
export type {
  RuntimeEventCollector,
  RuntimeStreamEventCollector,
  RuntimeTelemetryOptions,
  SanitizedKnowledgeReadinessReport,
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
export { readinessServerSentEvent, runtimeStreamServerSentEvent } from './sse'
export {
  type RunToolLoopOptions,
  runToolLoop,
  type StreamToolLoopOptions,
  type StreamToolLoopYield,
  streamToolLoop,
  type ToolCallOutcome,
  type ToolLoopCall,
  type ToolLoopEvent,
  type ToolLoopMessage,
  type ToolLoopResult,
} from './tool-loop'
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
  OpenAIChatTool,
  OpenAIChatToolChoice,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
