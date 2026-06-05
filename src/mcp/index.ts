/**
 * @experimental
 *
 * `@tangle-network/agent-runtime/mcp` — Stdio MCP server exposing the 5
 * delegation tools (`delegate_code`, `delegate_research`,
 * `delegate_feedback`, `delegation_status`, `delegation_history`) to
 * sandbox coding-harness agents.
 *
 * Mount the server inside a product agent's sandbox via
 * `agent-runtime-mcp` (the bin) or wire it into a custom Node entry
 * point with `createMcpServer({ ... })`. Pass `coderDelegate` /
 * `researcherDelegate` factories you build from your project's
 * sandbox client + run-loop topology.
 */

export type { DetectExecutorArgs } from './bin-helpers'
export { detectExecutor } from './bin-helpers'
export type {
  CoderDelegate,
  CoderReview,
  CoderReviewer,
  CoderWinnerSelection,
  CreateDefaultCoderDelegateOptions,
  DelegateRunCtx,
  ResearcherDelegate,
  UiAuditorDelegate,
} from './delegates'
export { createDefaultCoderDelegate } from './delegates'
export type {
  BuildDelegationMcpServerOptions,
  ComposeProductionAgentProfileOptions,
} from './delegation-profile'
export {
  buildDelegationMcpServer,
  composeProductionAgentProfile,
  DELEGATION_MCP_SERVER_KEY,
} from './delegation-profile'
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
export type { LocalHarness, LocalHarnessResult, RunLocalHarnessOptions } from './local-harness'
export { runLocalHarness } from './local-harness'
export { mcpToolsForRuntimeMcp, mcpToolsForRuntimeMcpSubset } from './openai-tools'
export type {
  JsonRpcMessage,
  JsonRpcResponse,
  McpServer,
  McpServerOptions,
  McpToolDescriptor,
  McpTransport,
} from './server'
export { createInProcessTransport, createMcpServer } from './server'
export type {
  DelegationRecord,
  DelegationTaskQueueOptions,
  SubmitInput,
  SubmitOutput,
} from './task-queue'
export { DelegationTaskQueue, hashIdempotencyInput } from './task-queue'
export {
  type AnalystKind,
  type AnalystRunnerOptions,
  defaultAnalystKinds,
  liftFindings,
  makeAnalystRunner,
  renderTrace,
  runAnalystLens,
} from './tools/analyst-kinds'
export {
  createDelegateCodeHandler,
  DELEGATE_CODE_DESCRIPTION,
  DELEGATE_CODE_INPUT_SCHEMA,
  DELEGATE_CODE_TOOL_NAME,
  validateDelegateCodeArgs,
} from './tools/delegate-code'
export {
  createDelegateFeedbackHandler,
  DELEGATE_FEEDBACK_DESCRIPTION,
  DELEGATE_FEEDBACK_INPUT_SCHEMA,
  DELEGATE_FEEDBACK_TOOL_NAME,
  validateDelegateFeedbackArgs,
} from './tools/delegate-feedback'
export {
  createDelegateResearchHandler,
  DELEGATE_RESEARCH_DESCRIPTION,
  DELEGATE_RESEARCH_INPUT_SCHEMA,
  DELEGATE_RESEARCH_TOOL_NAME,
  validateDelegateResearchArgs,
} from './tools/delegate-research'
export {
  createDelegateUiAuditHandler,
  DELEGATE_UI_AUDIT_DESCRIPTION,
  DELEGATE_UI_AUDIT_INPUT_SCHEMA,
  DELEGATE_UI_AUDIT_TOOL_NAME,
  validateDelegateUiAuditArgs,
} from './tools/delegate-ui-audit'
export {
  createDelegationHistoryHandler,
  DELEGATION_HISTORY_DESCRIPTION,
  DELEGATION_HISTORY_INPUT_SCHEMA,
  DELEGATION_HISTORY_TOOL_NAME,
  validateDelegationHistoryArgs,
} from './tools/delegation-history'
export {
  createDelegationStatusHandler,
  DELEGATION_STATUS_DESCRIPTION,
  DELEGATION_STATUS_INPUT_SCHEMA,
  DELEGATION_STATUS_TOOL_NAME,
  validateDelegationStatusArgs,
} from './tools/delegation-status'
export {
  createOperatorDriverAgent,
  type OperatorDriverOptions,
  type OperatorDriverResult,
  type OperatorStep,
  type ToolCallRequest,
  type ToolChat,
  type ToolChatTurn,
} from './tools/operator-driver'
export {
  createOperatorToolbox,
  type MakeWorkerAgent,
  type OperatorToolbox,
  type OperatorToolboxOptions,
  type SettledWorker,
} from './tools/operator-toolbox'
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
