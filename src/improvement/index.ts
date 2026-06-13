/**
 * `@tangle-network/agent-runtime` improvement — the CODE-surface driver for
 * agent-eval's improvement loop.
 *
 * The ONE entry point for optimization is agent-eval's `selfImprove`
 * (`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
 * with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
 * `fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
 * cohorting. This module supplies only the one genuinely runtime-specific piece:
 * a CODE-surface `ImprovementDriver` you pass to `selfImprove` as `driver`, which
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
export {
  type McpGeneratorOptions,
  mcpGenerator,
  type ToolGeneratorOptions,
  toolGenerator,
} from './buildable-generators'
export {
  type CandidateGenerator,
  type ImprovementDriverOptions,
  improvementDriver,
} from './improvement-driver'
export { type McpServeSpec, mcpServeVerifier } from './mcp-serve-verifier'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
