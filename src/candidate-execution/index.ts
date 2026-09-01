/**
 * `@tangle-network/agent-runtime/candidate-execution` — sealed candidate bundles
 * plus the isolated prepare/execute/finalize/recover lifecycle around them.
 *
 * @module
 * @experimental
 */

export {
  type AgentCandidateCodeSource,
  type AgentCandidateCodeSurfaceSource,
  type AgentCandidateProfileSource,
  type BuildAgentCandidateBundleInput,
  buildAgentCandidateBundle,
} from './builder'
export {
  type AgentCandidateBundleInput,
  sealAgentCandidateBundle,
} from './bundle'
export {
  type AgentCandidateExecutionAttemptRecord,
  type AgentCandidateExecutionAttemptRef,
  type AgentCandidateExecutionClaim,
  type AgentCandidateExecutionClaimResult,
  type AgentCandidateExecutionClaimStore,
  type AgentCandidateExecutionCleanupHandles,
  type AgentCandidateExecutionFailureClass,
  type AgentCandidateExecutionFinishResult,
  type AgentCandidateExecutionLease,
  type AgentCandidateExecutionPhase,
  type AgentCandidateExecutionPhaseResult,
  type AgentCandidateExecutionRecoveryEvidence,
  type AgentCandidateExecutionStageResult,
  type AgentCandidateExecutionTerminalRecord,
  type AgentCandidateExecutionTerminalResult,
  type AgentCandidateRetryRejection,
  InMemoryAgentCandidateExecutionClaimStore,
  type InMemoryAgentCandidateExecutionClaimStoreOptions,
} from './claim'
export type { AgentCandidatePreparationEvidence } from './claim-file-formats'
export {
  FileAgentCandidateExecutionClaimStore,
  type FileAgentCandidateExecutionClaimStoreOptions,
} from './claim-file-store'
export { candidateExecutionClaim } from './claim-plan'
export {
  type DisposePreparedAgentCandidateOptions,
  disposePreparedAgentCandidateExecution,
} from './dispose'
export {
  type ExactProcessCandidateExecutorOptions,
  exactProcessProviderAsCandidateExecutor,
} from './exact-process-executor'
export {
  type ExecutePreparedAgentCandidateOptions,
  executePreparedAgentCandidate,
} from './execute'
export type { AgentCandidateExecutionRoots } from './execution-roots'
export {
  CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG_ENV,
  CANDIDATE_KNOWLEDGE_ROOT_ENV,
  candidateKnowledgeExecutionPaths,
} from './knowledge'
export { persistCandidateOutputArtifact } from './output-artifacts'
export {
  type PrepareAgentCandidateExecutionOptions,
  prepareAgentCandidateExecution,
} from './prepare'
export {
  agentCandidateProfileAsAgentProfile,
  applyExactAgentProfileDiff,
  assertCandidateProfileBinding,
  freezeGenericAgentCandidateProfile,
  omitUndefinedObjectFields,
  parseExactAgentProfile,
  parseExactAgentProfileDiff,
  parseExactCandidateProfile,
} from './profile'
export {
  type AgentCandidateModelGrantRunReservationInput,
  type ProtectedAgentCandidateModelGrantContext,
  type RunProtectedAgentCandidateModelGrantOptions,
  type RunProtectedAgentCandidateModelGrantResult,
  runProtectedAgentCandidateModelGrant,
} from './protected-model-grant'
export {
  type AgentCandidateModelGrantActivateInput,
  type AgentCandidateModelGrantClient,
  type AgentCandidateModelGrantReservation,
  type AgentCandidateModelGrantReserveInput,
  type AgentCandidateModelGrantSettleInput,
  type CreateProtectedAgentCandidateModelPortOptions,
  createProtectedAgentCandidateModelPort,
} from './protected-model-port'
export {
  type RecoverExpiredAgentCandidateOptions,
  recoverExpiredAgentCandidateExecution,
} from './recover'
export {
  type AgentCandidateArtifactPort,
  type AgentCandidateBenchmarkGraderIdentity,
  type AgentCandidateBenchmarkGraderPort,
  type AgentCandidateContainerPort,
  type AgentCandidateExecutionPorts,
  type AgentCandidateExecutorFinalCapture,
  type AgentCandidateExecutorMemoryCapture,
  type AgentCandidateExecutorPort,
  type AgentCandidateExecutorProfileFile,
  type AgentCandidateExecutorRequest,
  type AgentCandidateExecutorStopRequest,
  type AgentCandidateExecutorTaskOutcomeCapture,
  type AgentCandidateExecutorWorkspaceFile,
  type AgentCandidateExecutorWorkspaceInput,
  type AgentCandidateMemoryPort,
  type AgentCandidateMemoryResetResult,
  type AgentCandidateModelLimits,
  type AgentCandidateModelPort,
  type AgentCandidateOutputArtifactPort,
  type AgentCandidateOutputPurpose,
  type AgentCandidateProtectedModelActivation,
  type AgentCandidateProtectedModelReservation,
  type AgentCandidateProtectedModelSettlement,
  type AgentCandidateProtectedModelSettlementCall,
  type AgentCandidateProtectedRunCapture,
  type AgentCandidateRepositoryPort,
  type AgentCandidateRunFinalization,
  type AgentCandidateTaskExecution,
  type AgentCandidateVerificationPorts,
  type AgentCandidateWorkspacePort,
  CANDIDATE_TRACE_ENV,
  CANDIDATE_TRACE_TAGS,
  type CanonicalCandidateDocument,
  type PersistedTaskOutcomeEvidence,
  type PreparedAgentCandidateExecution,
  type PreparedAgentCandidateInstruction,
  type PreparedAgentCandidateKnowledge,
  type PreparedAgentCandidateLaunch,
  type PreparedAgentCandidateTrace,
  type ResolvedAgentCandidateContainer,
  type VerifiedAgentCandidate,
  type VerifiedAgentCandidateTaskOutcome,
} from './types'
export { AGENT_CANDIDATE_EXECUTION_SUPPORT, verifyAgentCandidateBundle } from './verify'
export {
  type AgentCandidateWorkspaceArchiveLimits,
  type CaptureAgentCandidateWorkspaceOptions,
  type CapturedAgentCandidateWorkspace,
  type CreateAgentCandidateWorkspacePortOptions,
  captureAgentCandidateWorkspace,
  captureAgentCandidateWorkspaceFiles,
  createAgentCandidateWorkspacePort,
} from './workspace-archive'
