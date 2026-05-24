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
  CreateDefaultCoderDelegateOptions,
  DelegateRunCtx,
  ResearcherDelegate,
} from './delegates'
export { createDefaultCoderDelegate } from './delegates'
export type {
  DelegationExecutor,
  FleetHandle,
  FleetWorkspaceExecutorOptions,
  SiblingSandboxExecutorOptions,
} from './executor'
export { createFleetWorkspaceExecutor, createSiblingSandboxExecutor } from './executor'
export type { FeedbackEvent, FeedbackStore } from './feedback-store'
export { eventToSnapshot, InMemoryFeedbackStore } from './feedback-store'
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
export type {
  DelegateCodeArgs,
  DelegateCodeConfig,
  DelegateCodeResult,
  DelegateFeedbackArgs,
  DelegateFeedbackResult,
  DelegateResearchArgs,
  DelegateResearchConfig,
  DelegateResearchResult,
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
} from './types'
