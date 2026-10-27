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
/** Runtime's public names for agent-trace-contract's wire-id rule (`toW3CSpanId`, `toW3CTraceId`). */
export {
  toW3CSpanId as padSpanId,
  toW3CTraceId as padTraceId,
} from '@tangle-network/agent-trace-contract'
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
export type {
  BackendCallPolicy,
  CircuitBreakerConfig,
  RetryableErrorPredicate,
  RetryBackoff,
} from './conversation/call-policy'
export type {
  PersonaConversationResult,
  RunPersonaConfig,
  RunPersonaConversationOptions,
} from './conversation/run-persona'
export type {
  AuthSource,
  ConversationDriveState,
  ConversationParticipant,
  ConversationPolicy,
  ConversationResult,
  ConversationStreamEvent,
  HaltContext,
  HaltPredicate,
  HaltReason,
  HaltSignal,
  RunConversationOptions,
  TurnOrder,
} from './conversation/types'
// ── Errors ───────────────────────────────────────────────────────────
export {
  AgentEvalError,
  type AgentEvalErrorCode,
  BackendTransportError,
  ConfigError,
  JudgeError,
  NotFoundError,
  ValidationError,
} from './errors'
// ── Improvement (self-improvement surfaces) ──────────────────────────
// Complete agent-eval methods optimize profile fields. Runtime owns isolated
// code/worktree candidates and checkpoint-producing trainer execution.
export {
  type AgenticGeneratorExecutorForWorktree,
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
export type {
  ImproveCandidateValidationInput,
  ImproveCandidateValidator,
  ImproveCodeBaseOptions,
  ImproveCodeOptions,
  ImproveCodeResult,
  ImproveCodeRunOptions,
  ImproveCost,
  ImproveCustomCodeGeneratorOptions,
  ImproveMethodContext,
  ImproveMethodLineage,
  ImproveMethodOptions,
  ImprovementCodeCandidate,
  ImprovementProfileCandidate,
  ImproveOptimizationRunOptions,
  ImproveProfileComponents,
  ImproveRuntimeCodeGeneratorOptions,
  ImproveScenarioPartitions,
  ImproveSearchAgent,
  ImproveSearchIdentity,
  ImproveSearchMethod,
  ImproveSearchOptions,
  ImproveSkillsOptions,
  SearchPromotion,
} from './improvement/improve-types'
export type { CandidateGenerator } from './improvement/improvement-driver'
export {
  type OfficialGepaOptions,
  type OfficialOptimizerContextOptions,
  type OfficialSensitiveCandidateInput,
  type OfficialSkillOptOptions,
  officialGepa,
  officialSkillOpt,
} from './improvement/official-optimizers'
export { optimizerMethod } from './improvement/optimizer-prompt'
export {
  type CreateProfileImprovementHarnessOptions,
  createProfileImprovementHarness,
  type ProfileImprovementHarness,
  type ProfileImprovementHarnessRunOptions,
  type ProfileImprovementHarnessTrainOptions,
} from './improvement/profile-improvement-harness'
export type { DeepReadonly, ReadonlyAgentProfile } from './improvement/profile-types'
export {
  type ReflectiveGeneratorOptions,
  reflectiveGenerator,
} from './improvement/reflective-generator'
export {
  type ReflectiveProfileProposerOptions,
  type ReflectiveProposerChat,
  type ReflectiveProposerParent,
  type ReflectiveProposerReply,
  reflectiveProfileProposer,
} from './improvement/reflective-profile-proposer'
export type {
  DecideSearchImprovementOptions,
  SearchImprovementDecision,
} from './improvement/search-decision'
export type {
  SearchLaneKind,
  SearchLaneOptions,
  SearchTraceOptions,
  SharedBoxSearchLane,
} from './improvement/search-executor'
export type { SearchMethodOptions } from './improvement/search-method'
export type {
  CheckpointServingPort,
  ProfileTrainerRequest,
  TrainingBoundaryResult,
} from './improvement/training'
export type {
  AgentImprovementActivationReconciliation,
  AgentImprovementActivationResultStore,
  AgentImprovementActivationTransition,
} from './intelligence/activation'
// ── Knowledge orchestration ──────────────────────────────────────────
// Runtime owns live agent orchestration; agent-knowledge owns the KB/RAG/memory state.
// These wrappers bridge the two without making agent-knowledge import runtime.
export {
  type CreateKnowledgeImprovementActivationExecutorOptions,
  createKnowledgeImprovementActivationExecutor,
  type KnowledgeImprovementActivationExecutor,
} from './knowledge/activation'
export {
  buildKnowledgeImprovementExperimentBundles,
  type KnowledgeImprovementCandidatePair,
  type KnowledgeImprovementExperimentBundles,
  type KnowledgeImprovementJobMeasurement,
  type KnowledgeImprovementJobResult,
  type RunKnowledgeImprovementJobOptions,
  runKnowledgeImprovementJob,
} from './knowledge/improvement-job'
export type {
  KnowledgeReadinessCheck,
  KnowledgeReadinessCheckInput,
  KnowledgeReadinessCheckResult,
} from './knowledge/supervised-update'
// ── Delegated loop-runner (configured code/research/review/audit/improvement) ──
export { auditLoopRunner, type DelegatedLoopRunner } from './loop-runner'
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
// ── OTEL export + trace propagation ──────────────────────────────────
export {
  buildLoopOtelSpans,
  createOtelExporter,
  loopEventToOtelSpan,
  type OtelAttribute,
  type OtelExportConfig,
  type OtelExporter,
  type OtelExportStats,
  type OtelSpan,
} from './otel-export'
export { priceTokens, ROUTER_PRICE_SOURCE, type TokenWork } from './pricing/router-prices'
// ── Readiness ─────────────────────────────────────────────────────────
export { decideKnowledgeReadiness } from './readiness'
// ── Run loop ─────────────────────────────────────────────────────────
export { runAgentTask, runAgentTaskStream } from './run'
export type {
  RuntimeFailureCause,
  RuntimeFailureCode,
  RuntimeFailureOwner,
} from './runtime/failure-cause'
export {
  isolatedCheckBoxEvidenceSchema,
  isolatedCheckResultSchema,
} from './runtime/isolated-check-result'
// ── Runtime hooks ────────────────────────────────────────────────────
export type {
  RuntimeHookContext,
  RuntimeHookErrorContext,
  RuntimeHookEvent,
  RuntimeHookPhase,
  RuntimeHooks,
  RuntimeHookTarget,
} from './runtime-hooks'
export { composeRuntimeHooks, defineRuntimeHooks } from './runtime-hooks'
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
  sanitizeKnowledgeReadinessReport,
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
  KnowledgeReadinessDecision,
  OpenAIChatResponseFormat,
  OpenAIChatTool,
  OpenAIChatToolChoice,
  RunAgentTaskOptions,
  RunAgentTaskStreamOptions,
  RuntimeCanonicalStreamEvent,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
