/**
 * `@tangle-network/agent-runtime/candidate-execution` — sealed candidate bundles
 * plus the isolated prepare/execute/finalize/recover lifecycle around them.
 *
 * @module
 * @experimental
 */

export { candidateWorkspaceManifest, scanMaterializedWorkspaceManifest } from './artifacts'
export { type BuildAgentCandidateBundleInput, buildAgentCandidateBundle } from './builder'
export { sealAgentCandidateBundle } from './bundle'
export type { AgentCandidateExecutionClaimStore } from './claim'
export { FileAgentCandidateExecutionClaimStore } from './claim-file-store'
export { disposePreparedAgentCandidateExecution } from './dispose'
export { exactProcessProviderAsCandidateExecutor } from './exact-process-executor'
export { executePreparedAgentCandidate } from './execute'
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
  type RunProtectedAgentCandidateModelGrantOptions,
  runProtectedAgentCandidateModelGrant,
} from './protected-model-grant'
export {
  type AgentCandidateModelGrantClient,
  createProtectedAgentCandidateModelPort,
} from './protected-model-port'
export type {
  AgentCandidateArtifactPort,
  AgentCandidateBenchmarkGraderPort,
  AgentCandidateExecutionPorts,
  AgentCandidateExecutorPort,
  AgentCandidateExecutorRequest,
  AgentCandidateExecutorStopRequest,
  AgentCandidateExecutorTaskOutcomeCapture,
  AgentCandidateModelLimits,
  AgentCandidateModelPort,
  AgentCandidateOutputArtifactPort,
  AgentCandidateProtectedModelReservation,
  AgentCandidateProtectedRunCapture,
  AgentCandidateRunFinalization,
  AgentCandidateTaskExecution,
  PreparedAgentCandidateExecution,
  ResolvedAgentCandidateContainer,
} from './types'
export { verifyAgentCandidateBundle } from './verify'
export { captureAgentCandidateWorkspaceFiles } from './workspace-archive'
export {
  captureAgentCandidateWorkspace,
  createAgentCandidateWorkspacePort,
} from './workspace-archive-local'
export {
  type AgentCandidateWorkspaceTree,
  captureAgentCandidateWorkspaceToArtifacts,
  captureAgentCandidateWorkspaceTreeToArtifacts,
  materializeAgentCandidateWorkspaceFromArtifacts,
  verifyAgentCandidateWorkspaceArtifacts,
  verifyAgentCandidateWorkspaceTree,
} from './workspace-streams'
export {
  type AgentCandidateWorkspaceSnapshotReferences,
  captureAgentWorkspaceSnapshot,
  materializeAgentWorkspaceSnapshot,
} from './workspace-transfer'
export { describeWorkspaceTree, seedWorkspaceTree } from './workspace-tree'
