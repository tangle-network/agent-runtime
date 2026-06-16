/**
 * @experimental
 *
 * `worktreeCoderFanout` — the GENERIC coding combinator: a `fanout` of N supervisor-authored
 * harness profiles, each on its OWN worktree-CLI leaf, each `gateOnDeliverable(coderDeliverable)`,
 * winner via `defaultSelectWinner` (or a thin re-sort strategy). It is the canonical replacement
 * for the role-coupled multi-harness coder driver: no `runLoop` driver, no `multiHarnessCoderFanout`
 * harness-list config — the harness list is the fanout's item list, the §1.5 profile is authored
 * per item, and the mechanical gate is the re-homed `coderDeliverable`.
 *
 * The shape is content-free at the `fanout` layer; this builder only assembles the coder-domain
 * pieces (the worktree-CLI executor + the coder deliverable + the diff/readiness selectors) into
 * the generic combinator's `itemSpec`/`selectWinner` seams. Nothing here re-implements selection,
 * gating, or fanout — it composes the existing primitives.
 */

import type { AgentProfile } from '@tangle-network/sandbox'
import { fanout } from '../personify/combinators'
import type { Outcome } from '../personify/types'
import type { CombinatorShape, FanoutWinnerSelector } from '../personify/wave-types'
import type { Iteration } from '../types'
import { type CoderDeliverableOptions, coderDeliverable } from './coder-deliverable'
import { gateOnDeliverable } from './completion-gate'
import type { AgentSpec } from './types'
import {
  createWorktreeCliExecutor,
  type WorktreeCliExecutorOptions,
  type WorktreePatchArtifact,
} from './worktree-cli-executor'

/** @experimental One authored harness profile in a coder fanout: the §1.5 profile + which local
 *  harness CLI drives it. The supervisor authors `profile` per sub-task; `harness` chooses the leaf. */
export interface AuthoredCoderHarness {
  /** A short label for the worktree branch + trace node. */
  name: string
  /** The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5). */
  profile: AgentProfile
  /** Which local harness CLI drives this leaf. */
  harness: 'claude' | 'codex' | 'opencode'
  /** Per-harness model/runId/baseRef overrides flow through the profile + these. */
  runId?: string
  baseRef?: string
}

/** @experimental Winner-selection among the gated coder candidates. `highest-score` is the
 *  `defaultSelectWinner` default; the rest are thin re-sorts over the same iterations. */
export type CoderWinnerStrategy = 'highest-score' | 'smallest-diff' | 'first-valid'

/** @experimental */
export interface WorktreeCoderFanoutOptions extends CoderDeliverableOptions {
  /** Absolute path to the git checkout each worktree is cut from. */
  repoRoot: string
  /** The per-task instruction handed to every harness (composed under each profile's systemPrompt). */
  taskPrompt: string
  /** The authored harness profiles — one fanout item (and one worktree-CLI leaf) each. */
  harnesses: ReadonlyArray<AuthoredCoderHarness>
  /** Shell command run in each worktree to derive the tests-PASS signal. */
  testCmd?: string
  /** Shell command run in each worktree to derive the typecheck-PASS signal. */
  typecheckCmd?: string
  /** Wall-clock cap per harness subprocess (ms). */
  harnessTimeoutMs?: number
  /** Winner-selection strategy. Default `highest-score`. */
  winnerStrategy?: CoderWinnerStrategy
  /** Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
   *  whole fanout runs offline). Production callers leave these unset. */
  runGit?: WorktreeCliExecutorOptions['runGit']
  runHarness?: WorktreeCliExecutorOptions['runHarness']
  runCommand?: WorktreeCliExecutorOptions['runCommand']
}

/**
 * Build the coder fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
 * — equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
 * the single-sourced `defaultSelectWinner` (or a thin re-sort), never a judge.
 *
 * @experimental
 */
export function worktreeCoderFanout<Task>(
  options: WorktreeCoderFanoutOptions,
): CombinatorShape<Task, WorktreePatchArtifact> {
  const deliverable = coderDeliverable({
    ...(options.maxDiffLines !== undefined ? { maxDiffLines: options.maxDiffLines } : {}),
    ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
    ...(options.require !== undefined ? { require: options.require } : {}),
  })

  const itemSpec = (item: AuthoredCoderHarness): AgentSpec => {
    const executor = gateOnDeliverable(
      createWorktreeCliExecutor({
        repoRoot: options.repoRoot,
        profile: item.profile,
        harness: item.harness,
        taskPrompt: options.taskPrompt,
        ...(item.runId ? { runId: item.runId } : {}),
        ...(item.baseRef ? { baseRef: item.baseRef } : {}),
        ...(options.testCmd !== undefined ? { testCmd: options.testCmd } : {}),
        ...(options.typecheckCmd !== undefined ? { typecheckCmd: options.typecheckCmd } : {}),
        ...(options.harnessTimeoutMs !== undefined
          ? { harnessTimeoutMs: options.harnessTimeoutMs }
          : {}),
        ...(options.runGit ? { runGit: options.runGit } : {}),
        ...(options.runHarness ? { runHarness: options.runHarness } : {}),
        ...(options.runCommand ? { runCommand: options.runCommand } : {}),
      }),
      deliverable,
    )
    return { profile: item.profile, harness: null, executor: executor as AgentSpec['executor'] }
  }

  const selectWinner = winnerSelectorFor(options.winnerStrategy ?? 'highest-score')

  return fanout<Task, AuthoredCoderHarness, WorktreePatchArtifact>(options.harnesses, {
    itemTask: () => options.taskPrompt,
    label: (item, i) => `${item.name}:${i}`,
    itemSpec: (item) => itemSpec(item),
    selectWinner,
  })
}

/**
 * Resolve a winner strategy into a `FanoutWinnerSelector`. ALL coder strategies select among only
 * the gated-VALID (delivered) candidates and return `undefined` when none qualifies — so an
 * UNDELIVERED patch can never win (the deliverable gate IS the point). This is the re-home of the
 * old `pickCoderWinner` "keep only valid, fail loud when none survives" discipline; the generic
 * `defaultSelectWinner` is intentionally NOT used here because it falls back to the best non-errored
 * output when nothing is valid, which would surface an ungated patch.
 */
function winnerSelectorFor(
  strategy: CoderWinnerStrategy,
): FanoutWinnerSelector<WorktreePatchArtifact> {
  return (iterations) => {
    const valid = iterations.filter(
      (iter) => iter.output !== undefined && !iter.error && iter.verdict?.valid === true,
    )
    if (valid.length === 0) return undefined
    switch (strategy) {
      case 'first-valid':
        return [...valid].sort((a, b) => a.index - b.index)[0]
      case 'smallest-diff':
        // fewest changed lines among the valid candidates, ties → earliest.
        return [...valid].sort((a, b) => diffLines(a) - diffLines(b) || a.index - b.index)[0]
      default:
        // highest-score: best-valid-score, ties → earliest (defaultSelectWinner semantics over
        // the VALID pool only — no non-valid fallback).
        return [...valid].sort(
          (a, b) => (b.verdict?.score ?? 0) - (a.verdict?.score ?? 0) || a.index - b.index,
        )[0]
    }
  }
}

function diffLines(iter: Iteration<unknown, Outcome<WorktreePatchArtifact>>): number {
  const artifact = artifactOf(iter.output)
  if (!artifact) return Number.POSITIVE_INFINITY
  return artifact.stats.insertions + artifact.stats.deletions
}

/** The leaf executor settles the raw `WorktreePatchArtifact` as the iteration output; defend
 *  against the `Outcome<D>` wrapper shape the type nominally carries. */
function artifactOf(
  output: Outcome<WorktreePatchArtifact> | undefined,
): WorktreePatchArtifact | undefined {
  if (!output) return undefined
  if (isArtifact(output)) return output
  if (output.kind === 'done' && isArtifact(output.deliverable)) return output.deliverable
  return undefined
}

function isArtifact(value: unknown): value is WorktreePatchArtifact {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { patch?: unknown }).patch === 'string' &&
    typeof (value as { stats?: unknown }).stats === 'object'
  )
}
