/**
 * `@tangle-network/agent-runtime` improvement.
 *
 * The public entry point is `improve()`. Complete agent-eval methods optimize
 * profile surfaces. Runtime owns only code candidates that mutate an isolated
 * git worktree through a pluggable `CandidateGenerator`.
 */

export {
  AGENTIC_PROFILE_RESOURCE_ROOT,
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
export { findingLines, mcpBuildPrompt, toolBuildPrompt } from './build-prompts'
export {
  type DriverLoopGeneratorOptions,
  driverLoopGenerator,
} from './driver-loop-generator'
export {
  isAnalystFinding,
  LIFTED_FINDING_ANALYST_ID,
  type ToAnalystFindingsOptions,
  toAnalystFindings,
} from './findings'
export {
  type ImproveCandidateValidationInput,
  type ImproveCandidateValidator,
  type ImproveCodeOptions,
  type ImproveCodeResult,
  type ImproveCodeRunOptions,
  type ImproveCost,
  type ImproveLineage,
  type ImproveMethodContext,
  type ImproveMethodFactory,
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
  buildDriverSystem,
  optimizerMethod,
  researchDriverNote,
  strategyAuthorMethod,
} from './optimizer-prompt'
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
