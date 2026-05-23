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
  RuntimeRunStateError,
  ValidationError,
} from './errors'

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

// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'

// ── Run loop ─────────────────────────────────────────────────────────
export { runAgentTask, runAgentTaskStream } from './run'

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
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
