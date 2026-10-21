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
export { createIterableBackend, createSandboxPromptBackend } from './backends'
// ── Conversations ─────────────────────────────────────────────
export {
  type Conversation,
  type ConversationTurn,
  createConversationBackend,
  createProfileExecutionBackend,
  type PersonaDriver,
  runConversation,
  runConversationStream,
  runPersonaConversation,
  runPersonaDispatch,
} from './conversation'
// ── Errors ───────────────────────────────────────────────────────────
export {
  AgentEvalError,
  type AgentEvalErrorCode,
  BackendTransportError,
  ConfigError,
  JudgeError,
  NotFoundError,
  RuntimeRunStateError,
  ValidationError,
} from './errors'
// ── Improvement (self-improvement surfaces) ──────────────────────────
// Complete agent-eval methods optimize profile fields. Runtime owns isolated
// code/worktree candidates and checkpoint-producing trainer execution.
export {
  type AgenticGeneratorOptions,
  type AgenticGeneratorShotDisposition,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
  type Verifier,
  type VerifyResult,
} from './improvement/agentic-generator'
export {
  type ControlledTrainingCommand,
  createCommandProfileTrainer,
  decideSearchImprovement,
  dedicatedLane,
  type ImproveLineage,
  type ImproveMethodFactory,
  type ImproveMethodResult,
  type ImproveMethodSource,
  type ImproveProfileAgent,
  type ImproveProfileSurface,
  type ImproveSearchResult,
  type ImproveSurface,
  type ImproveTrainingOptions,
  type ImproveTrainingResult,
  improve,
  type ProfileTrainer,
  routerLane,
  type SearchCellContext,
  type SearchDispatchContext,
  SearchEnvironmentFault,
  type SearchLane,
  searchMethod,
  sharedBoxLane,
  subscriptionLane,
} from './improvement/improve'
export type { CandidateGenerator } from './improvement/improvement-driver'
export { officialGepa, officialSkillOpt } from './improvement/official-optimizers'
export { optimizerMethod } from './improvement/optimizer-prompt'
export {
  createProfileImprovementHarness,
  type ProfileImprovementHarness,
} from './improvement/profile-improvement-harness'
export type { ReadonlyAgentProfile } from './improvement/profile-types'
export { reflectiveGenerator } from './improvement/reflective-generator'
export { reflectiveProfileProposer } from './improvement/reflective-profile-proposer'
// ── Knowledge orchestration ──────────────────────────────────────────
// Runtime owns live agent orchestration; agent-knowledge owns the KB/RAG/memory state.
// These wrappers bridge the two without making agent-knowledge import runtime.
export { createKnowledgeImprovementActivationExecutor } from './knowledge/activation'
export {
  buildKnowledgeImprovementExperimentBundles,
  runKnowledgeImprovementJob,
} from './knowledge/improvement-job'
// ── Delegated loop-runner (configured code/research/review/audit/improvement) ──
export { auditLoopRunner } from './loop-runner'
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
export type { OtelAttribute, OtelExportConfig, OtelExporter, OtelSpan } from './otel-export'
// ── OTEL export + trace propagation ──────────────────────────────────
export {
  buildLoopOtelSpans,
  createOtelExporter,
  loopEventToOtelSpan,
  padSpanId,
  padTraceId,
} from './otel-export'
export { priceTokens, ROUTER_PRICE_SOURCE, type TokenWork } from './pricing/router-prices'
// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'
// ── Run loop ─────────────────────────────────────────────────────────
export { applyRunRecordDefaults, runAgentTask, runAgentTaskStream } from './run'
export {
  isolatedCheckBoxEvidenceSchema,
  isolatedCheckResultSchema,
} from './runtime/isolated-check-result'
// ── Runtime hooks ────────────────────────────────────────────────────
export type { RuntimeHookEvent, RuntimeHooks } from './runtime-hooks'
export { composeRuntimeHooks, defineRuntimeHooks } from './runtime-hooks'
// ── Production run lifecycle ─────────────────────────────────────────
export type { RuntimeRunHandle, RuntimeRunPersistenceAdapter, RuntimeRunRow } from './runtime-run'
export { startRuntimeRun } from './runtime-run'
// ── Sanitization / telemetry ─────────────────────────────────────────
export type {
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
  AgentTaskContext,
  AgentTaskRunResult,
  AgentTaskSpec,
  AgentTaskStatus,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
