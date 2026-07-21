/**
 * `@tangle-network/agent-runtime` improvement — the CODE-surface proposer for
 * agent-eval's improvement loop.
 *
 * The public entry point is `improve()`, a profile-aware facade over agent-eval's
 * `selfImprove`. This module also supplies the runtime-specific code candidate
 * producer, which mutates an isolated git worktree via a pluggable
 * `CandidateGenerator`:
 *   - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
 *   - `agenticGenerator`     — full coding harness in the worktree, multi-shot
 *   - `driverLoopGenerator`  — the driver→worker atom: an LLM driver authors,
 *     observes, rates, and steers the harness sessions (default for tool/mcp)
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
  type CampaignOtlpOptions,
  type CampaignTraceResolverOptions,
  campaignCellSpansToOtlp,
  campaignTraceResolver,
  convertCampaignDirToOtlp,
} from './campaign-otlp'
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
  type ImproveCodeOptions,
  type ImprovementCandidate,
  type ImproveOptions,
  type ImproveResult,
  type ImproveSkillsOptions,
  type ImproveSurface,
  improve,
} from './improve'
export {
  type CandidateGenerator,
  type ImprovementDriverOptions,
  improvementDriver,
  type ManagedImprovementDriver,
} from './improvement-driver'
export { type McpServeSpec, mcpServeVerifier } from './mcp-serve-verifier'
export {
  buildDriverSystem,
  optimizerMethod,
  researchDriverNote,
  strategyAuthorMethod,
} from './optimizer-prompt'
export {
  type ProfileDiffProposerContext,
  type ProfileDiffProposerOptions,
  profileDiffProposer,
} from './profile-diff-proposer'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './raw-trace-distiller'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
export {
  applyRolloutPolicyToProfile,
  enumerateNeighborPolicies,
  normalizeRolloutPolicy,
  parseRolloutPolicy,
  ROLLOUT_POLICY_BOUNDS,
  ROLLOUT_POLICY_EXTENSION,
  rolloutPolicyProposer,
  serializeRolloutPolicy,
  structuralRolloutPolicyFromProfile,
} from './rollout-policy'
