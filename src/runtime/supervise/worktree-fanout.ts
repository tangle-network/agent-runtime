/**
 *
 * `worktreeFanout` — the GENERIC coding combinator: a `fanout` of N supervisor-authored harness
 * profiles, each on its OWN worktree-CLI leaf, each `gateOnDeliverable(deliverable)`, winner via the
 * shared `selectValidWinner` (valid-only — an ungated patch never wins, the deliverable gate is the
 * point). The `deliverable` is passed as DATA: it defaults to `patchDelivered(opts)` but any
 * `DeliverableSpec<WorktreePatchArtifact>` a domain authors slots in unchanged.
 *
 * The shape is content-free at the `fanout` layer; this builder only assembles the pieces (the
 * worktree-CLI executor + the injected deliverable + the diff-size selector) into the generic
 * combinator's `itemSpec`/`selectWinner` seams. Nothing here re-implements selection, gating, or
 * fanout — it composes the existing primitives.
 *
 * @experimental
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type { LocalHarness } from '../../mcp/local-harness'
import { fanout, selectValidWinner } from '../personify/combinators'
import type { CombinatorShape, WinnerStrategy } from '../personify/wave-types'
import { type DeliverableSpec, gateOnDeliverable } from './completion-gate'
import { type PatchDeliverableOptions, patchDelivered } from './patch-deliverable'
import type { AgentSpec, ExecutorFactory } from './types'
import {
  createWorktreeCliExecutor,
  type WorktreeCliExecutorOptions,
  type WorktreePatchArtifact,
} from './worktree-cli-executor'

/** @experimental One authored harness profile in a worktree fanout: the §1.5 profile + which local
 *  harness CLI drives it. The supervisor authors `profile` per sub-task; `harness` chooses the leaf. */
export interface AuthoredHarness {
  /** A short label for the worktree branch + trace node. */
  name: string
  /** The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5). */
  profile: AgentProfile
  /** Which local harness CLI drives this leaf. */
  harness: LocalHarness
  /** Require measured usage from this leaf. Budgeted supervision refuses the default unmetered
   *  local-CLI mode; set false only when the selected runner actually returns token usage. */
  budgetExempt?: WorktreeCliExecutorOptions['budgetExempt']
  /** Run Codex through its measured, isolated JSONL path. This implies `budgetExempt: false`. */
  codexReproducible?: WorktreeCliExecutorOptions['codexReproducible']
  /** Host paths denied to a reproducible Codex leaf. */
  codexReadDeniedPaths?: WorktreeCliExecutorOptions['codexReadDeniedPaths']
  /** Per-harness model/runId/baseRef overrides flow through the profile + these. */
  runId?: string
  baseRef?: string
}

/** @experimental */
export interface WorktreeFanoutOptions extends PatchDeliverableOptions {
  /** Absolute path to the git checkout each worktree is cut from. */
  repoRoot: string
  /** The per-task instruction handed to every harness (composed under each profile's systemPrompt). */
  taskPrompt: string
  /** The authored harness profiles — one fanout item (and one worktree-CLI leaf) each. */
  harnesses: ReadonlyArray<AuthoredHarness>
  /**
   * The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
   * no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
   * `DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.
   */
  deliverable?: DeliverableSpec<WorktreePatchArtifact>
  /** Shell command run in each worktree to derive the tests-PASS signal. */
  testCmd?: string
  /** Shell command run in each worktree to derive the typecheck-PASS signal. */
  typecheckCmd?: string
  /** Wall-clock cap per harness subprocess (ms). */
  harnessTimeoutMs?: number
  /** Winner-selection strategy. Default `highest-score`. */
  winnerStrategy?: WinnerStrategy
  /** Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
   *  whole fanout runs offline). Production callers leave these unset. */
  runGit?: WorktreeCliExecutorOptions['runGit']
  runHarness?: WorktreeCliExecutorOptions['runHarness']
  runCommand?: WorktreeCliExecutorOptions['runCommand']
}

/**
 * Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
 * — equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
 * the shared valid-only `selectValidWinner` (never a judge).
 *
 * @experimental
 */
export function worktreeFanout<Task>(
  options: WorktreeFanoutOptions,
): CombinatorShape<Task, WorktreePatchArtifact> {
  const deliverable =
    options.deliverable ??
    patchDelivered({
      ...(options.maxDiffLines !== undefined ? { maxDiffLines: options.maxDiffLines } : {}),
      ...(options.forbiddenPaths !== undefined ? { forbiddenPaths: options.forbiddenPaths } : {}),
      ...(options.require !== undefined ? { require: options.require } : {}),
    })

  const itemSpec = (item: AuthoredHarness): AgentSpec => {
    const executorFactory: ExecutorFactory<WorktreePatchArtifact> = (_spec, ctx) => {
      if (!ctx.node) {
        throw new Error('worktreeFanout: supervised node context required')
      }
      return gateOnDeliverable(
        createWorktreeCliExecutor({
          repoRoot: options.repoRoot,
          profile: item.profile,
          harness: item.harness,
          taskPrompt: options.taskPrompt,
          executionAttemptId: ctx.node.attemptId,
          ...(item.budgetExempt !== undefined ? { budgetExempt: item.budgetExempt } : {}),
          ...(item.codexReproducible !== undefined
            ? { codexReproducible: item.codexReproducible }
            : {}),
          ...(item.codexReadDeniedPaths !== undefined
            ? { codexReadDeniedPaths: item.codexReadDeniedPaths }
            : {}),
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
    }
    return { profile: item.profile, harness: null, executorFactory }
  }

  const selectWinner = selectValidWinner<WorktreePatchArtifact>({
    strategy: options.winnerStrategy ?? 'highest-score',
    sizeOf: (a) => a.stats.insertions + a.stats.deletions,
  })

  return fanout<Task, AuthoredHarness, WorktreePatchArtifact>(options.harnesses, {
    itemTask: () => options.taskPrompt,
    label: (item, i) => `${item.name}:${i}`,
    itemSpec: (item) => itemSpec(item),
    selectWinner,
  })
}
