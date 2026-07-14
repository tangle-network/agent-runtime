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
 */

export {
  AGENTIC_PROFILE_RESOURCE_ROOT,
  type AgenticGeneratorOptions,
  type AgenticGeneratorShotReceipt,
  agenticGenerator,
  commandVerifier,
  type Verifier,
  type VerifyResult,
} from './agentic-generator'
export { mcpBuildPrompt, toolBuildPrompt } from './build-prompts'
export {
  applyImprovementWinnerToProfile,
  type ImproveCodeOptions,
  type ImproveMemoryOptions,
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
  type AgentProfileDiffProposal,
  type ProfileDiffProposerContext,
  type ProfileDiffProposerOptions,
  profileDiffProposer,
} from './profile-diff-proposer'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './raw-trace-distiller'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
