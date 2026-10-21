/**
 * `@tangle-network/agent-runtime/candidate-execution` — sealed candidate bundles
 * plus the isolated prepare/execute/finalize/recover lifecycle around them.
 *
 * @module
 * @experimental
 */

export {
  candidateWorkspaceManifest,
  scanMaterializedWorkspaceManifest,
  type WorkspaceScanLimits,
  type WorkspaceScanOptions,
} from './artifacts'
export {
  type AgentCandidateCodeSource,
  type AgentCandidateCodeSurfaceSource,
  type AgentCandidateProfileSource,
  type BuildAgentCandidateBundleInput,
  buildAgentCandidateBundle,
} from './builder'
export { type AgentCandidateBundleInput, sealAgentCandidateBundle } from './bundle'
export type {
  AgentCandidateExecutionAttemptRecord,
  AgentCandidateExecutionAttemptRef,
  AgentCandidateExecutionClaim,
  AgentCandidateExecutionClaimResult,
  AgentCandidateExecutionClaimStore,
  AgentCandidateExecutionCleanupHandles,
  AgentCandidateExecutionFailureClass,
  AgentCandidateExecutionFinishResult,
  AgentCandidateExecutionLease,
  AgentCandidateExecutionPhase,
  AgentCandidateExecutionPhaseResult,
  AgentCandidateExecutionRecoveryEvidence,
  AgentCandidateExecutionStageResult,
  AgentCandidateExecutionTerminalRecord,
  AgentCandidateExecutionTerminalResult,
  AgentCandidateRetryRejection,
} from './claim'
export type { AgentCandidatePreparationEvidence } from './claim-file-formats'
export {
  FileAgentCandidateExecutionClaimStore,
  type FileAgentCandidateExecutionClaimStoreOptions,
} from './claim-file-store'
export {
  type DisposePreparedAgentCandidateOptions,
  disposePreparedAgentCandidateExecution,
} from './dispose'
export {
  type ExactProcessCandidateExecutorOptions,
  exactProcessProviderAsCandidateExecutor,
} from './exact-process-executor'
export { type ExecutePreparedAgentCandidateOptions, executePreparedAgentCandidate } from './execute'
export type { AgentCandidateExecutionRoots } from './execution-roots'
export { prepareAgentCandidateExecution } from './prepare'
export {
  agentCandidateProfileAsAgentProfile,
  applyExactAgentProfileDiff,
  assertCandidateProfileBinding,
  freezeGenericAgentCandidateProfile,
  omitUndefinedObjectFields,
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
  type AgentCandidateModelGrantClient,
  type AgentCandidateModelGrantReserveInput,
  type CreateProtectedAgentCandidateModelPortOptions,
  createProtectedAgentCandidateModelPort,
} from './protected-model-port'
export type {
  AgentCandidateArtifactPort,
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateContainerPort,
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorFinalCapture,
  AgentCandidateExecutorMemoryCapture,
  AgentCandidateExecutorPort,
  AgentCandidateExecutorProfileFile,
  AgentCandidateExecutorRequest,
  AgentCandidateExecutorStopRequest,
  AgentCandidateExecutorTaskOutcomeCapture,
  AgentCandidateExecutorWorkspaceFile,
  AgentCandidateExecutorWorkspaceInput,
  AgentCandidateMemoryPort,
  AgentCandidateMemoryResetResult,
  AgentCandidateModelLimits,
  AgentCandidateModelPort,
  AgentCandidateOutputArtifactPort,
  AgentCandidateOutputPurpose,
  AgentCandidateProtectedModelActivation,
  AgentCandidateProtectedModelReservation,
  AgentCandidateProtectedModelSettlement,
  AgentCandidateProtectedModelSettlementCall,
  AgentCandidateProtectedRunCapture,
  AgentCandidateRepositoryPort,
  AgentCandidateRunFinalization,
  AgentCandidateTaskExecution,
  AgentCandidateVerificationPorts,
  AgentCandidateWorkspacePort,
  CanonicalCandidateDocument,
  PersistedTaskOutcomeEvidence,
  PreparedAgentCandidateExecution,
  PreparedAgentCandidateInstruction,
  PreparedAgentCandidateKnowledge,
  PreparedAgentCandidateLaunch,
  PreparedAgentCandidateTrace,
  ResolvedAgentCandidateContainer,
  VerifiedAgentCandidate,
  VerifiedAgentCandidateTaskOutcome,
} from './types'
export { verifyAgentCandidateBundle } from './verify'
export {
  type CapturedAgentCandidateWorkspace,
  captureAgentCandidateWorkspaceFiles,
} from './workspace-archive'
export {
  type CaptureAgentCandidateWorkspaceOptions,
  type CreateAgentCandidateWorkspacePortOptions,
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from './workspace-archive-local'
export {
  type AgentCandidateWorkspaceArtifactsOptions,
  type AgentCandidateWorkspaceTree,
  type CaptureAgentCandidateWorkspaceToArtifactsOptions,
  captureAgentCandidateWorkspaceToArtifacts,
  captureAgentCandidateWorkspaceTreeToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
  verifyAgentCandidateWorkspaceArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from './workspace-streams'
export {
  type AgentCandidateWorkspaceSnapshotReferences,
  type CaptureAgentWorkspaceSnapshotOptions,
  captureAgentWorkspaceSnapshot,
  type MaterializeAgentWorkspaceSnapshotOptions,
  materializeAgentWorkspaceSnapshot,
} from './workspace-transfer'
export {
  type DescribeWorkspaceTreeOptions,
  describeWorkspaceTree,
  type SeedWorkspaceTreeInput,
  seedWorkspaceTree,
  type WorkspaceTreeAlgorithm,
  type WorkspaceTreeDescriptor,
  type WorkspaceTreeEntryPolicy,
  type WorkspaceTreeExclusion,
  type WorkspaceTreeExclusionReason,
} from './workspace-tree'
