/**
 * @experimental
 *
 * `coderProfile` — the §1.5 author-the-profile DATA for code-modification tasks: an `AgentProfile`
 * constant (the agent IS its profile) plus a pure `coderTaskToPrompt` formatter that renders a
 * `CoderTask` into the per-task instruction. There is no factory, output adapter, or validator
 * here — a domain customizes the worker by authoring a profile + handing it to a leaf executor
 * (`createWorktreeCliExecutor`) or a fanout (`worktreeFanout`), and "is it delivered" is a
 * `DeliverableSpec` (`patchDelivered`), not a bundled validator.
 *
 * The standing instruction tells the agent to work on a fresh branch, keep the patch minimal,
 * avoid forbidden paths, and run the test + typecheck commands before declaring done.
 */

import type { AgentProfile } from '@tangle-network/sandbox'

// Temporary re-export: the mechanical gate + its helpers moved to
// `../runtime/supervise/patch-checks`. Re-exported here so existing importers keep working
// mid-refactor; the barrel + importer migration removes this in a later step.
export {
  type CoderCheckConstraints,
  type CoderCheckInput,
  countDiffLines,
  isNonEmptyPatch,
  runCoderChecks,
  touchedPathsFromPatch,
  touchesSecretPath,
} from '../runtime/supervise/patch-checks'

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

/** @experimental The coder agent's standing instruction (its body lives in `coderProfile.prompt`). */
export const DEFAULT_CODER_SYSTEM_PROMPT = [
  'You are a coder agent operating inside an isolated sandbox workspace.',
  'Your job is to deliver a minimal, correct patch for the user-supplied goal.',
  '',
  'Hard rules:',
  '  1. Work on a fresh branch off the supplied base. Do not mutate the base branch.',
  '  2. Never touch a forbidden path. The user will list them explicitly.',
  '  3. Keep the diff under the max-diff cap. Prefer the smallest change that ships.',
  '  4. Run the supplied test and typecheck commands before declaring done.',
  '  5. If either command fails, fix the cause — do not weaken the test or hide the error.',
  '',
  'When you finish, emit a single final structured message of the shape:',
  '  ```json',
  '  { "branch": "<branch-name>",',
  '    "patch": "<unified-diff>",',
  '    "testResult": { "passed": <bool>, "output": "<stdout/stderr>" },',
  '    "typecheckResult": { "passed": <bool>, "output": "<stdout/stderr>" },',
  '    "diffStats": { "filesChanged": <int>, "insertions": <int>, "deletions": <int> },',
  '    "reviewerNotes": "<optional commentary>" }',
  '  ```',
].join('\n')

/**
 * @experimental
 *
 * The coder `AgentProfile` — the §1.5 DATA the substrate materializes into a harness invocation.
 * Stateless and harness-agnostic: a consumer overrides `model`/`metadata.backendType` by spreading
 * a copy, never by a factory. `worktreeFanout` authors one such profile per harness leaf.
 */
export const coderProfile: AgentProfile = {
  name: 'coder',
  description: 'Code-modification agent. Minimal-diff worktree-based coder.',
  prompt: { systemPrompt: DEFAULT_CODER_SYSTEM_PROMPT },
  tools: { git: true, fs: true, shell: true, test_runner: true },
  metadata: { role: 'coder' },
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
