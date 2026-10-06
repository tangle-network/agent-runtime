/**
 * `@tangle-network/agent-runtime` improvement.
 *
 * The public entry point is `improve()`. Complete agent-eval methods optimize
 * profile surfaces. Runtime owns isolated code candidates and trainer execution
 * that returns checkpoint receipts, not promotion decisions.
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
} from './agentic-generator'
export {
  type BuildPromptFindingsInput,
  findingLines,
  mcpBuildPrompt,
  toolBuildPrompt,
} from './build-prompts'
export {
  type CheckpointServingPort,
  type ControlledTrainingCommand,
  createCommandProfileTrainer,
  type DecideSearchImprovementOptions,
  decideSearchImprovement,
  dedicatedLane,
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
  type ImprovementProfileCandidate,
  type ImproveOptimizationRunOptions,
  type ImproveOptions,
  type ImproveProfileAgent,
  type ImproveProfileComponents,
  type ImproveProfileSurface,
  type ImproveResult,
  type ImproveRuntimeCodeGeneratorOptions,
  type ImproveScenarioPartitions,
  type ImproveSearchAgent,
  type ImproveSearchIdentity,
  type ImproveSearchMethod,
  type ImproveSearchOptions,
  type ImproveSearchResult,
  type ImproveSkillsOptions,
  type ImproveSurface,
  type ImproveTrainingOptions,
  type ImproveTrainingResult,
  improve,
  isSearchEnvironmentFault,
  type ProfileTrainer,
  type ProfileTrainerRequest,
  routerLane,
  type SearchCellContext,
  type SearchDispatchContext,
  SearchEnvironmentFault,
  type SearchImprovementDecision,
  type SearchLane,
  type SearchLaneKind,
  type SearchLaneOptions,
  type SearchMethodOptions,
  type SearchPromotion,
  type SearchTraceOptions,
  type SharedBoxSearchLane,
  searchMethod,
  sharedBoxLane,
  subscriptionLane,
  type TrainingBoundaryResult,
  type TrainingDatasetDocument,
} from './improve'
export type { CandidateGenerator } from './improvement-driver'
export { type McpServeSpec, mcpServeVerifier } from './mcp-serve-verifier'
export {
  type OfficialGepaOptions,
  type OfficialOptimizerContextOptions,
  OfficialOptimizerUnavailableError,
  type OfficialSensitiveCandidateInput,
  type OfficialSkillOptOptions,
  officialGepa,
  officialSkillOpt,
} from './official-optimizers'
export {
  optimizerMethod,
  strategyAuthorMethod,
} from './optimizer-prompt'
export {
  type CreateProfileImprovementHarnessOptions,
  createProfileImprovementHarness,
  type ProfileImprovementHarness,
  type ProfileImprovementHarnessRunOptions,
  type ProfileImprovementHarnessTrainOptions,
} from './profile-improvement-harness'
export type { DeepReadonly, ReadonlyAgentProfile } from './profile-types'
export {
  PROMPT_INSTRUCTION_COMPONENT_PREFIX,
  promptInstructionsProfileComponents,
} from './prompt-instructions-profile-components'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './raw-trace-distiller'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
export {
  type ReflectiveProfileProposerOptions,
  type ReflectiveProposerChat,
  type ReflectiveProposerParent,
  type ReflectiveProposerReply,
  reflectiveProfileProposer,
} from './reflective-profile-proposer'
export {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_EXTENSION,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'
