/**
 * @experimental
 *
 * `CoderTask` + `coderTaskToPrompt` — the per-task DATA + pure formatter for code-modification tasks
 * (§1.5: the system authors profiles; there is no hardcoded coder profile constant). A domain
 * customizes the worker by authoring its own `AgentProfile` and handing it to a leaf executor
 * (`createWorktreeCliExecutor`) or a fanout (`worktreeFanout`); "is it delivered" is a
 * `DeliverableSpec` (`patchDelivered`), not a bundled validator. This formatter renders a `CoderTask`
 * into the per-task instruction that profile receives.
 */

const DEFAULT_MAX_DIFF_LINES = 400

/** @experimental The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces. */
export interface CoderTask {
  /** What the agent must accomplish. Free-form prose. */
  goal: string
  /** Absolute path inside the sandbox where the repo lives. */
  repoRoot: string
  /** Default `main`. The branch the agent diffs against. */
  baseBranch?: string
  /** Default `pnpm test --run`. */
  testCmd?: string
  /** Default `pnpm typecheck`. */
  typecheckCmd?: string
  /** Files the agent may inspect for context. Surfaced verbatim in the prompt. */
  contextFiles?: string[]
  /**
   * Paths the agent must not touch. The mechanical gate hard-fails on any match.
   * Use glob-free literal path prefixes for unambiguous enforcement.
   */
  forbiddenPaths?: string[]
  /** Default 400. Hard cap; the gate hard-fails when exceeded. */
  maxDiffLines?: number
}

/** @experimental Render a `CoderTask` into the per-task instruction handed to the coder profile. */
export function coderTaskToPrompt(task: CoderTask): string {
  const base = task.baseBranch ?? 'main'
  const testCmd = task.testCmd ?? 'pnpm test --run'
  const typecheckCmd = task.typecheckCmd ?? 'pnpm typecheck'
  const maxDiff = task.maxDiffLines ?? DEFAULT_MAX_DIFF_LINES
  const forbidden = task.forbiddenPaths?.length ? task.forbiddenPaths.join(', ') : '(none)'
  const context = task.contextFiles?.length
    ? task.contextFiles.map((f) => `  - ${f}`).join('\n')
    : '  (none)'
  return [
    `Goal: ${task.goal}`,
    `Repo: ${task.repoRoot}`,
    `Base branch: ${base}`,
    `Run tests with: ${testCmd}`,
    `Run typecheck with: ${typecheckCmd}`,
    `Forbidden paths: ${forbidden}`,
    `Max diff lines: ${maxDiff}`,
    'Context files:',
    context,
    '',
    'Produce a minimal patch on a fresh branch. Run tests and typecheck before',
    'returning. Emit the final JSON result block exactly as instructed.',
  ].join('\n')
}
