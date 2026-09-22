/**
 * @tangle-network/agent-runtime
 *
 * Agent execution, multi-agent coordination, and improvement workflows.
 *
 * See `docs/concepts.md` (mental model) and `README.md` (quickstart).
 */

// ── Immutable candidate execution ─────────────────────────────────────
// One verified bundle → one exact per-task plan → one protected run receipt.
// This composes the shared profile materializer and agent-eval trace store;
// benchmark adapters supply only environment-specific artifact/container ports.
export * from './candidate-execution'
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
// ── Persistent multi-agent interaction ────────────────────────────────
export * from './interaction'
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
  LoopSpanNode,
  OtelAttribute,
  OtelDropEvent,
  OtelExportConfig,
  OtelExporter,
  OtelFlushResult,
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
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
} from './otel-export'
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
  RuntimeStreamEventCollector,
  RuntimeStreamEventSink,
  RuntimeStreamEventSummary,
  RuntimeTelemetryOptions,
} from './sanitize'
export {
  createRuntimeStreamEventCollector,
  sanitizeRuntimeStreamEvent,
} from './sanitize'
// ── SSE ───────────────────────────────────────────────────────────────
export { encodeServerSentEvent, runtimeStreamServerSentEvent } from './sse'
export {
  type RunToolLoopOptions,
  runToolLoop,
  type StreamToolLoopOptions,
  type StreamToolLoopYield,
  streamToolLoop,
  type ToolCallOutcome,
  type ToolLoopAssistantToolCall,
  type ToolLoopCall,
  type ToolLoopEvent,
  type ToolLoopMessage,
  type ToolLoopResult,
  type ToolLoopStopReason,
} from './tool-loop'
// ── Core types ───────────────────────────────────────────────────────
export type {
  AgentTaskSpec,
  AgentTaskStatus,
  AgentTurnError,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  RuntimeStreamEvent,
} from './types'
