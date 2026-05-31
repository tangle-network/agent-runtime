/**
 * `@tangle-network/agent-runtime` improvement — two entry points onto
 * agent-eval's `runImprovementLoop`:
 *
 *   - `improvementDriver` (CODE surface) — owns the candidate lifecycle via a
 *     pluggable `CandidateGenerator`:
 *       - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
 *       - `agenticGenerator`     — full coding harness in the worktree, multi-shot
 *   - `optimizePrompt` (TEXT surface) — identity-gated optimization of any
 *     system / planner prompt. Defaults to agent-eval's `gepaDriver` +
 *     `heldOutGate`; returns the baseline unless the held-out gate ships a win.
 */

export { type AgenticGeneratorOptions, agenticGenerator } from './agentic-generator'
export {
  type CandidateGenerator,
  type ImprovementDriverOptions,
  improvementDriver,
} from './improvement-driver'
export {
  type OptimizePromptOptions,
  type OptimizePromptReflection,
  type OptimizePromptResult,
  optimizePrompt,
} from './optimize-prompt'
export { type ReflectiveGeneratorOptions, reflectiveGenerator } from './reflective-generator'
