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
  type AuthSource,
  type BackendCallPolicy,
  type CircuitBreakerConfig,
  type Conversation,
  type ConversationDriveState,
  type ConversationJournal,
  type ConversationJournalEntry,
  type ConversationParticipant,
  type ConversationPolicy,
  type ConversationResult,
  type ConversationStreamEvent,
  type ConversationTurn,
  createConversationBackend,
  createProfileExecutionBackend,
  type D1DatabaseLike,
  type D1StmtLike,
  d1ToSqlAdapter,
  defineConversation,
  FileConversationJournal,
  type HaltContext,
  type HaltPredicate,
  type HaltReason,
  type HaltSignal,
  InMemoryConversationJournal,
  type PersonaConversationResult,
  type PersonaDriver,
  type RetryableErrorPredicate,
  type RetryBackoff,
  type RunConversationOptions,
  type RunPersonaConfig,
  type RunPersonaConversationOptions,
  runConversation,
  runConversationStream,
  runPersonaConversation,
  runPersonaDispatch,
  type SqlAdapter,
  SqlConversationJournal,
  type TurnOrder,
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
  RetainedInteractiveAdmissionError,
  RetainedInteractiveBindingError,
  RetainedRunAdmissionError,
  RetainedRunDispatchBindingError,
  RuntimeRunStateError,
  ValidationError,
} from './errors'
// ── Improvement (self-improvement surfaces) ──────────────────────────
// Complete agent-eval methods optimize profile fields. Runtime owns only
// isolated code/worktree candidate execution.
/**
 * `@tangle-network/agent-runtime` improvement.
 *
 * The public entry point is `improve()`. Complete agent-eval methods optimize
 * profile surfaces. Runtime owns only code candidates that mutate an isolated
 * git worktree through a pluggable `CandidateGenerator`.
 */

export {
  type AgenticGeneratorExecutorForWorktree,
  type AgenticGeneratorOptions,
  type AgenticGeneratorShotDisposition,
  type AgenticGeneratorShotExecution,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
  defaultBuildPrompt,
  type Verifier,
  type VerifyResult,
} from './improvement/agentic-generator'
export {
  type BuildPromptFindingsInput,
  findingLines,
  mcpBuildPrompt,
  toolBuildPrompt,
} from './improvement/build-prompts'
export {
  type ImproveCandidateValidationInput,
  type ImproveCandidateValidator,
  type ImproveCodeBaseOptions,
  type ImproveCodeOptions,
  type ImproveCodeResult,
  type ImproveCodeRunOptions,
  type ImproveCost,
  type ImproveCustomCodeGeneratorOptions,
  type ImproveLineage,
  type ImproveMethodContext,
  type ImproveMethodFactory,
  type ImproveMethodLineage,
  type ImproveMethodOptions,
  type ImproveMethodResult,
  type ImproveMethodSource,
  type ImprovementCandidate,
  type ImprovementCodeCandidate,
  type ImprovementMaterializedProfilePopulationCandidate,
  type ImprovementProfileCandidate,
  type ImprovementProfileCandidatePopulation,
  type ImprovementProfileCandidatePopulationAvailable,
  type ImprovementProfileCandidatePopulationUnavailable,
  type ImprovementProfilePopulationArtifactSource,
  type ImprovementProfilePopulationCandidate,
  type ImprovementProfilePopulationCandidateSource,
  type ImprovementProfilePopulationLineage,
  type ImprovementProfilePopulationLineageNode,
  type ImprovementProfilePopulationObservationSource,
  type ImprovementRefusedProfilePopulationCandidate,
  type ImproveOptimizationRunOptions,
  type ImproveOptions,
  type ImproveProfileAgent,
  type ImproveProfileComponents,
  type ImproveProfileSurface,
  type ImproveResult,
  type ImproveRuntimeCodeGeneratorOptions,
  type ImproveScenarioPartitions,
  type ImproveSkillsOptions,
  type ImproveSurface,
  improve,
} from './improvement/improve'
export type { CandidateGenerator } from './improvement/improvement-driver'
export { type McpServeSpec, mcpServeVerifier } from './improvement/mcp-serve-verifier'
export {
  type OfficialGepaOptions,
  type OfficialOptimizerContextOptions,
  OfficialOptimizerUnavailableError,
  type OfficialSensitiveCandidateInput,
  type OfficialSkillOptOptions,
  officialGepa,
  officialSkillOpt,
} from './improvement/official-optimizers'
export {
  optimizerMethod,
  strategyAuthorMethod,
} from './improvement/optimizer-prompt'
export {
  type CreateProfileImprovementHarnessOptions,
  createProfileImprovementHarness,
  type ProfileImprovementHarness,
  type ProfileImprovementHarnessRunOptions,
} from './improvement/profile-improvement-harness'
export type { DeepReadonly, ReadonlyAgentProfile } from './improvement/profile-types'
export {
  PROMPT_INSTRUCTION_COMPONENT_PREFIX,
  promptInstructionsProfileComponents,
} from './improvement/prompt-instructions-profile-components'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './improvement/raw-trace-distiller'
export {
  type ReflectiveGeneratorOptions,
  reflectiveGenerator,
} from './improvement/reflective-generator'
export {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_EXTENSION,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './improvement/rollout-policy'

// ── Knowledge orchestration ──────────────────────────────────────────
// Runtime owns live agent orchestration; agent-knowledge owns the KB/RAG/memory state.
// These wrappers bridge the two without making agent-knowledge import runtime.
export {
  type CreateKnowledgeImprovementActivationExecutorOptions,
  createKnowledgeImprovementActivationExecutor,
  type KnowledgeImprovementActivationExecutor,
} from './knowledge/activation'

export {
  type AgentKnowledgeReadinessCheckOptions,
  buildKnowledgeImprovementExperimentBundles,
  createAgentKnowledgeReadinessCheck,
  type KnowledgeImprovementCandidatePair,
  type KnowledgeImprovementExperimentBundles,
  type KnowledgeImprovementJobMeasurement,
  type KnowledgeImprovementJobResult,
  type RunKnowledgeImprovementJobOptions,
  runKnowledgeImprovementJob,
} from './knowledge/improvement-job'

export {
  createSupervisedKnowledgeUpdater,
  formatSupervisedKnowledgeTask,
  type KnowledgeReadinessCheck,
  type KnowledgeReadinessCheckInput,
  type KnowledgeReadinessCheckResult,
  knowledgeReadinessDeliverable,
  RESEARCH_SUPERVISOR_SYSTEM_PROMPT,
  runSupervisedKnowledgeUpdate,
  type SupervisedKnowledgeUpdateInput,
  type SupervisedKnowledgeUpdateOptions,
  type SupervisedKnowledgeUpdateResult,
  type SupervisedKnowledgeUpdater,
} from './knowledge/supervised-update'
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
  createOpenInferenceFileExporter,
  createOtelExporter,
  exportEvalRuns,
  generateSpanId,
  INTELLIGENCE_WIRE_VERSION,
  loopEventToOtelSpan,
  padSpanId,
  padTraceId,
  toOtelAttributes,
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
  RuntimeCanonicalStreamEvent,
  RuntimeSession,
  RuntimeSessionStore,
  RuntimeStreamEvent,
} from './types'
