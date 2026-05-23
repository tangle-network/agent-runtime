/**
 * @tangle-network/agent-runtime
 *
 * Reusable runtime lifecycle for domain-specific agents. Standardizes the
 * task lifecycle (knowledge readiness → questions / acquisition → control
 * loop → eval) and delegates domain behavior to an adapter. Owns no domain
 * policy, models, tools, connectors, or UI.
 *
 * See `docs/concepts.md` (mental model) and `README.md` (quickstart). Every
 * public export below carries a `@stable` or `@experimental` tag; treat
 * `@experimental` exports as subject to change inside this minor.
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
  UserQuestion,
} from '@tangle-network/agent-eval'
export type { BackendRetryPolicy } from './backends'
// ── Backends ──────────────────────────────────────────────────────────
export {
  createIterableBackend,
  createOpenAICompatibleBackend,
  createSandboxPromptBackend,
} from './backends'
export type {
  ChatTurnMessage,
  ChatTurnOverlay,
  ChatTurnSandbox,
  RunChatTurnOptions,
} from './chat-turn'
// ── Chat-turn primitive ──────────────────────────────────────────────
export {
  ChatTurnError,
  composeTurnProfile,
  runChatTurn,
  sandboxAsChatTurnTarget,
} from './chat-turn'
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
  CaptureIntegrityError,
  ConfigError,
  JudgeError,
  NotFoundError,
  ReplayError,
  RuntimeRunStateError,
  SessionMismatchError,
  ValidationError,
  VerificationError,
} from './errors'
export type {
  ClassifyIntentOptions,
  ClassifyIntentResult,
  SubagentMatcher,
} from './intent-router'
// ── Intent router ────────────────────────────────────────────────────
export { classifyIntent } from './intent-router'
export type {
  ChatModelCandidate,
  ChatModelValidation,
  ModelInfo,
  ResolvedChatModel,
  RouterEnv,
} from './model-resolution'
// ── Chat-model resolution ────────────────────────────────────────────
// Router catalog fetch + fail-closed id validation + precedence resolver.
// One primitive for every product chat handler — replaces the per-repo
// hand-rolled model-resolution copies.
export {
  cleanModelId,
  DEFAULT_ROUTER_BASE_URL,
  getModels,
  resolveChatModel,
  resolveRouterBaseUrl,
  validateChatModelId,
  withConfiguredModels,
} from './model-resolution'
export type {
  ConformanceIssue,
  ConformanceOptions,
  ConformanceResult,
} from './profile-conformance'
// ── Profile conformance ──────────────────────────────────────────────
export { assertProfileConformance } from './profile-conformance'
// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'
// ── Run loop ─────────────────────────────────────────────────────────
export { runAgentTask, runAgentTaskStream, summarizeAgentTaskRun } from './run'
export type {
  RuntimeRunCompleteInput,
  RuntimeRunCost,
  RuntimeRunHandle,
  RuntimeRunOptions,
  RuntimeRunPersistenceAdapter,
  RuntimeRunRow,
  RuntimeRunStatus,
} from './runtime-run'
// ── Production run lifecycle ─────────────────────────────────────────
export { startRuntimeRun } from './runtime-run'
export type {
  RuntimeEventCollector,
  RuntimeStreamEventCollector,
  RuntimeStreamEventSink,
  RuntimeStreamEventSummary,
  RuntimeTelemetryOptions,
  SanitizedKnowledgeReadinessReport,
  SanitizedKnowledgeRequirement,
} from './sanitize'
// ── Sanitization / telemetry ─────────────────────────────────────────
export {
  createRuntimeEventCollector,
  createRuntimeStreamEventCollector,
  sanitizeAgentRuntimeEvent,
  sanitizeKnowledgeReadinessReport,
  sanitizeRuntimeStreamEvent,
} from './sanitize'
// ── Sessions ──────────────────────────────────────────────────────────
export { InMemoryRuntimeSessionStore } from './sessions'
export type { ServerSentEventOptions } from './sse'
// ── SSE ───────────────────────────────────────────────────────────────
export {
  encodeServerSentEvent,
  readinessServerSentEvent,
  runtimeStreamServerSentEvent,
} from './sse'
export type { TraceBridge, TraceBridgeOptions } from './trace-bridge'
// ── agent-eval trace bridge ──────────────────────────────────────────
export { createTraceBridge, toAgentEvalTrace } from './trace-bridge'
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
  AgentTaskRunSummary,
  AgentTaskSpec,
  AgentTaskStatus,
  KnowledgeReadinessDecision,
  RunAgentTaskOptions,
  RunAgentTaskStreamOptions,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
