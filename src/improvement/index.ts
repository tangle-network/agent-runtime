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
} from './agentic-generator'
export {
  type BuildPromptFindingsInput,
  findingLines,
  mcpBuildPrompt,
  toolBuildPrompt,
} from './build-prompts'
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
  PROMPT_INSTRUCTION_COMPONENT_PREFIX,
  promptInstructionsProfileComponents,
} from './prompt-instructions-profile-components'
export type { DeepReadonly, ReadonlyAgentProfile } from './profile-types'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './raw-trace-distiller'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
export {
  applyRolloutPolicyToProfile,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_EXTENSION,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'
