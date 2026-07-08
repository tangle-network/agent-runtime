/**
 * `@tangle-network/agent-runtime` improvement — the CODE-surface proposer for
 * agent-eval's improvement loop.
 *
 * The ONE entry point for optimization is agent-eval's `selfImprove`
 * (`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
 * with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
 * `fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
 * cohorting. This module supplies only the one genuinely runtime-specific piece:
 * a CODE-surface `SurfaceProposer` you pass to `selfImprove` as `proposer`, which
 * mutates a git worktree via a pluggable `CandidateGenerator`:
 *   - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
 *   - `agenticGenerator`     — full coding harness in the worktree, multi-shot
 */

export {
  type AgenticGeneratorOptions,
  agenticGenerator,
  commandVerifier,
  type Verifier,
  type VerifyResult,
} from './agentic-generator'
export { mcpBuildPrompt, toolBuildPrompt } from './build-prompts'
export {
  type ImproveOptions,
  type ImproveResult,
  type ImproveSurface,
  improve,
} from './improve'
export {
  type CandidateGenerator,
  type ImprovementDriverOptions,
  improvementDriver,
} from './improvement-driver'
export { type McpServeSpec, mcpServeVerifier } from './mcp-serve-verifier'
export {
  type RawTraceDistillerOptions,
  rawTraceDistiller,
} from './raw-trace-distiller'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
