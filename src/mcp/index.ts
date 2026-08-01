/**
 *
 * `@tangle-network/agent-runtime/mcp` — Stdio MCP server exposing the
 * delegation tools to sandbox coding-harness agents: the generic `delegate`
 * (one intent → a supervisor that authors + drives its own worker, returns the
 * delivered output with its cost), plus the queue-bound `delegate_feedback`,
 * `delegation_status`, and `delegation_history`. `delegate_ui_audit` is served
 * when a `uiAuditorDelegate` is wired.
 *
 * Mount the server inside a product agent's sandbox via
 * `agent-runtime-mcp` (the bin) or wire it into a custom Node entry
 * point with `createMcpServer({ ... })`.
 *
 * @experimental
 */

export type { DetectExecutorArgs } from './bin-helpers'
export { detectExecutor } from './bin-helpers'
export type {
  CoderDelegate,
  CoderReview,
  CoderReviewer,
  DelegateRunCtx,
  DetachedSessionDelegateOptions,
  DetachedWinnerSelection,
  SettleDetachedCoderTurnOptions,
  UiAuditorDelegate,
} from './delegates'
export {
  coderTaskFromArgs,
  detachedSessionDelegate,
  settleDetachedCoderTurn,
} from './delegates'
export type { DelegationStore, FileDelegationStoreOptions } from './delegation-store'
export {
  DelegationPersistenceError,
  DelegationStateCorruptError,
  FileDelegationStore,
  InMemoryDelegationStore,
} from './delegation-store'
export type {
  CappedDelegationTrace,
  DelegationTraceCaps,
  DelegationTraceCollector,
  DelegationTraceSpan,
} from './delegation-trace'
export {
  buildDelegationTraceSpans,
  capDelegationTrace,
  composeLoopTraceEmitters,
  createDelegationTraceCollector,
  DELEGATION_TRACE_MAX_BYTES,
  DELEGATION_TRACE_MAX_SPANS,
} from './delegation-trace'
export type { CoderOutput } from './detached-coder'
export type {
  DetachedSessionRefParts,
  DetachedTurn,
  DetachedTurnResumeDriverOptions,
  DriveTurnCapableBox,
  DriveTurnTick,
  RunDetachedTurnOptions,
} from './detached-turn'
export {
  createDetachedTurnResumeDriver,
  detachedTurnEvents,
  formatDetachedSessionRef,
  parseDetachedSessionRef,
  runDetachedTurn,
} from './detached-turn'
export type {
  DelegationExecutor,
  FleetHandle,
  FleetWorkspaceExecutorOptions,
  SiblingSandboxExecutorOptions,
} from './executor'
export { createFleetWorkspaceExecutor, createSiblingSandboxExecutor } from './executor'
export type { FeedbackEvent, FeedbackStore } from './feedback-store'
export { eventToSnapshot, InMemoryFeedbackStore } from './feedback-store'
export type {
  InProcessExecutorDescribePlacement,
  InProcessExecutorOptions,
} from './in-process-executor'
export { createInProcessExecutor } from './in-process-executor'
export {
  type CreateKbGateOptions,
  createKbGate,
  type FactCandidate,
  type FactJudge,
  type FactJudgeVerdict,
  type KbGateResult,
} from './kb-gate'
export type {
  CodexExecutionEvidence,
  CodexExecutionFailureDiagnostic,
  CodexExecutionPolicy,
  CodexTokenUsage,
  LocalHarness,
  LocalHarnessResult,
  RunLocalHarnessOptions,
} from './local-harness'
export {
  CodexExecutionDiagnosticError,
  parseCodexTokenUsage,
  runLocalHarness,
} from './local-harness'
export {
  type AgentMemorySpec,
  type CreateMemoryToolServerOptions,
  createMemoryToolServer,
  MEMORY_FILE_ENV,
  MEMORY_ITEMS_ENV,
  MEMORY_LOG_ENV,
  MEMORY_NAME_ENV,
  type MemoryItem,
  parseMemoryItems,
  type ResolvedMemoryEnv,
  readMemoryItemsFile,
  resolveMemoryFromEnv,
} from './memory-server'
export { mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset } from './openai-tools'
export type {
  JsonRpcMessage,
  JsonRpcResponse,
  McpToolDescriptor,
  McpTransport,
} from './protocol'
/** @deprecated Use `McpToolDescriptor`; both names are the same protocol contract. */
export type StdioToolDescriptor = import('./protocol').McpToolDescriptor
export type { McpServer, McpServerOptions } from './server'
export { createInProcessTransport, createMcpServer } from './server'
export type {
  DelegationArgs,
  DelegationRecord,
  DelegationResumeContext,
  DelegationResumeDriver,
  DelegationResumeTick,
  DelegationRunContext,
  DelegationTaskQueueOptions,
  SubmitInput,
  SubmitOutput,
} from './task-queue'
export { DelegationTaskQueue, hashIdempotencyInput } from './task-queue'
// The generic stdio JSON-RPC core every in-repo MCP server serves on.
export {
  createStdioToolServer,
  type StdioToolServer,
  type StdioToolServerOptions,
} from './tool-server'
export {
  type AnalystFindingEvent,
  type AnalystRegistry,
  type CoordinationEvent,
  type CoordinationTools,
  type CoordinationToolsOptions,
  createCoordinationTools,
  DEFAULT_AWAIT_EVENT_TIMEOUT_MS,
  type DownMessageEvent,
  type MakeWorkerAgent,
  type Question,
  type QuestionDecision,
  type QuestionLevel,
  type QuestionOption,
  type QuestionPolicy,
  type QuestionRecord,
  type QuestionUrgency,
  type SettledWorker,
  type WorkerWatchOptions,
} from './tools/coordination'
export {
  createDelegateHandler,
  DELEGATE_DESCRIPTION,
  DELEGATE_INPUT_SCHEMA,
  DELEGATE_TOOL_NAME,
  type DelegateArgs,
  type DelegateError,
  type DelegateHandlerOptions,
  type DelegateResult,
  validateDelegateArgs,
} from './tools/delegate'
export {
  createDelegateFeedbackHandler,
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_INPUT_SCHEMA,
  DELEGATE_FEEDBACK_TOOL_NAME,
  type DelegateFeedbackHandlerOptions,
  validateDelegateFeedbackArgs,
} from './tools/delegate-feedback'
export {
  createDelegateUiAuditHandler,
  DELEGATE_UI_AUDIT_DESCRIPTION,
  DELEGATE_UI_AUDIT_INPUT_SCHEMA,
  DELEGATE_UI_AUDIT_TOOL_NAME,
  type DelegateUiAuditHandlerOptions,
  validateDelegateUiAuditArgs,
} from './tools/delegate-ui-audit'
export {
  createDelegationHistoryHandler,
  DELEGATION_HISTORY_DESCRIPTION,
  DELEGATION_HISTORY_INPUT_SCHEMA,
  DELEGATION_HISTORY_TOOL_NAME,
  type DelegationHistoryHandlerOptions,
  validateDelegationHistoryArgs,
} from './tools/delegation-history'
export {
  createDelegationStatusHandler,
  DELEGATION_STATUS_DESCRIPTION,
  DELEGATION_STATUS_INPUT_SCHEMA,
  DELEGATION_STATUS_TOOL_NAME,
  type DelegationStatusHandlerOptions,
  validateDelegationStatusArgs,
} from './tools/delegation-status'
export type { TraceContext } from './trace-propagation'
export {
  createPropagatingTraceEmitter,
  readTraceContextFromEnv,
  traceContextToEnv,
} from './trace-propagation'
export type {
  DelegateCodeArgs,
  DelegateCodeConfig,
  DelegateCodeResult,
  DelegateFeedbackArgs,
  DelegateFeedbackResult,
  DelegateResearchArgs,
  DelegateResearchConfig,
  DelegateResearchResult,
  DelegateUiAuditArgs,
  DelegateUiAuditConfig,
  DelegateUiAuditResult,
  DelegateUiAuditRoute,
  DelegationError,
  DelegationFeedbackSnapshot,
  DelegationHistoryArgs,
  DelegationHistoryEntry,
  DelegationHistoryResult,
  DelegationProfile,
  DelegationProgress,
  DelegationResultPayload,
  DelegationStatus,
  DelegationStatusArgs,
  DelegationStatusResult,
  FeedbackRating,
  FeedbackRefersTo,
  ResearchOutputShape,
  ResearchSource,
  UiAuditLensFilter,
  UiAuditorDelegationOutput,
} from './types'
export type {
  CreateWorktreeOptions,
  DiffOptions,
  DiffResult,
  GitRunner,
  RemoveWorktreeOptions,
  WorktreeHandle,
} from './worktree'
export { captureWorktreeDiff, createWorktree, removeWorktree } from './worktree'
