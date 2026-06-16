/**
 * @experimental
 *
 * The worktree-CLI leaf executor — a supervisor-authored `AgentProfile` driving a local
 * coding-harness CLI (claude / codex / opencode) on its OWN git worktree, surfaced as the
 * open `Executor<Out>` port (`./types`). It is a LEAF executor, not a `DelegationExecutor`:
 * it plugs straight into the `Scope`/`Supervisor` recursion and `gateOnDeliverable`, so it
 * IS the canonical recursive path (no `runLoop`/virtual-SandboxInstance shim in between).
 *
 * The §1.5 payload reaches the harness: `harnessInvocation` (mcp/local-harness) maps the
 * authored `profile.prompt.systemPrompt` into the prompt channel and `profile.model.default`
 * into the harness's `-m` selector — the prompt-only `buildArgs(taskPrompt)` path dropped
 * both. The subprocess runs through `runLocalHarness` (the stdin-CLOSED spawn shape — the
 * #308 fix that keeps a non-TTY `opencode run` from blocking on input forever).
 *
 * Lifecycle per spawn (fresh executor — one box/abort/teardown each):
 *   1. `createWorktree` — `git worktree add` off `repoRoot` at `baseRef`.
 *   2. `runLocalHarness` — spawn the harness, fed the profile-aware invocation.
 *   3. `captureWorktreeDiff` — `git diff` the worktree → the patch artifact.
 *   4. `removeWorktree` — on `teardown` (always; the loser of a fanout is dirty).
 *
 * Reuse, not duplication: `createWorktree` / `captureWorktreeDiff` / `removeWorktree` come
 * straight from `mcp/worktree`; `runLocalHarness` + `LocalHarness` from `mcp/local-harness`.
 * Nothing here reimplements a worktree, a spawn, or a diff.
 *
 * Token accounting: a harness CLI does not surface usage, so this executor is
 * `budgetExempt: true` — its spend is NOT metered against the conserved pool and its
 * iterations are EXCLUDED from the equal-k arms by construction (mirrors `cliExecutor`).
 */

import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/sandbox'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import {
  harnessInvocation,
  type LocalHarness,
  type LocalHarnessResult,
  runLocalHarness,
} from '../../mcp/local-harness'
import {
  captureWorktreeDiff,
  createWorktree,
  type GitRunner,
  removeWorktree,
  type WorktreeHandle,
} from '../../mcp/worktree'
import { zeroTokenUsage } from '../util'
import type { Executor, ExecutorResult, Spend } from './types'

/** Terminal artifact of one worktree-CLI run: the captured diff + the harness's run record. */
export interface WorktreePatchArtifact {
  /** The branch the worktree was cut on (`delegate/<runId>`). */
  branch: string
  /** `git diff` of the worktree against its base — the unified patch the harness produced. */
  patch: string
  /** Shortstat-derived change counts. */
  stats: { filesChanged: number; insertions: number; deletions: number }
  /** The harness subprocess outcome (exit code, captured streams, timing). */
  harness: {
    name: LocalHarness
    exitCode: number | null
    timedOut: boolean
    killedBySignal: NodeJS.Signals | null
    durationMs: number
    stdout: string
    stderr: string
  }
}

/** @experimental */
export interface WorktreeCliExecutorOptions {
  /** Absolute path to the git checkout the worktree is cut from. */
  repoRoot: string
  /** The SUPERVISOR-AUTHORED profile (the §1.5 payload: systemPrompt + model). */
  profile: AgentProfile
  /** Which local harness CLI drives this leaf (`claude` | `codex` | `opencode`). */
  harness: LocalHarness
  /** The per-task instruction handed to the harness (composed under the system prompt). */
  taskPrompt: string
  /** Unique id for the worktree path + branch. Defaults to a fresh UUID. */
  runId?: string
  /** Override the base ref the worktree is cut from (default `HEAD`). */
  baseRef?: string
  /** Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default). */
  harnessTimeoutMs?: number
  /** Test seam — inject a git runner so unit tests drive the worktree helpers without git. */
  runGit?: GitRunner
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
}

/**
 * Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each),
 * so a fanout of N profiles = N parallel worktrees that never clobber each other.
 *
 * Fail-loud: an empty `repoRoot`/`harness`/`taskPrompt` throws at construction (no silent
 * default for a required boundary). `resultArtifact()` before `execute()` resolves throws.
 *
 * @experimental
 */
export function createWorktreeCliExecutor(
  options: WorktreeCliExecutorOptions,
): Executor<WorktreePatchArtifact> {
  if (!options.repoRoot) {
    throw new ValidationError('createWorktreeCliExecutor: repoRoot required')
  }
  if (!options.harness) {
    throw new ValidationError('createWorktreeCliExecutor: harness required')
  }
  if (typeof options.taskPrompt !== 'string' || options.taskPrompt.length === 0) {
    throw new ValidationError('createWorktreeCliExecutor: taskPrompt required')
  }

  const runId = options.runId ?? randomUUID()
  const runHarness = options.runHarness ?? runLocalHarness
  const controller = new AbortController()

  let worktree: WorktreeHandle | undefined
  let artifact: ExecutorResult<WorktreePatchArtifact> | undefined

  const removeIfPresent = async (): Promise<void> => {
    if (!worktree) return
    const wt = worktree
    worktree = undefined
    await removeWorktree({
      worktree: wt,
      repoRoot: options.repoRoot,
      ...(options.runGit ? { runGit: options.runGit } : {}),
    }).catch(() => undefined)
  }

  return {
    runtime: 'cli',
    // A harness CLI cannot account tokens — exclude it from the conserved pool + equal-k.
    budgetExempt: true,
    async execute(_task, signal): Promise<ExecutorResult<WorktreePatchArtifact>> {
      const linked = linkSignals(signal, controller.signal)
      const started = Date.now()

      worktree = await createWorktree({
        repoRoot: options.repoRoot,
        runId,
        ...(options.baseRef ? { baseRef: options.baseRef } : {}),
        ...(options.runGit ? { runGit: options.runGit } : {}),
      })

      // The §1.5 fix: the authored systemPrompt + model reach the spawned harness.
      const { command, args } = harnessInvocation(
        options.harness,
        options.profile,
        options.taskPrompt,
      )

      const harnessResult: LocalHarnessResult = await runHarness({
        harness: options.harness,
        cwd: worktree.path,
        taskPrompt: options.taskPrompt,
        invocation: { command, args },
        ...(options.harnessTimeoutMs !== undefined ? { timeoutMs: options.harnessTimeoutMs } : {}),
        ...(linked ? { signal: linked } : {}),
      })

      // Capture the diff regardless of exit code — a failed run can still leave a partial
      // patch worth inspecting. The diff becomes the patch artifact.
      const diff = await captureWorktreeDiff({
        worktree,
        ...(options.runGit ? { runGit: options.runGit } : {}),
      })

      const out: WorktreePatchArtifact = {
        branch: worktree.branch,
        patch: diff.patch,
        stats: diff.stats,
        harness: {
          name: options.harness,
          exitCode: harnessResult.exitCode,
          timedOut: harnessResult.timedOut,
          killedBySignal: harnessResult.killedBySignal,
          durationMs: harnessResult.durationMs,
          stdout: harnessResult.stdout,
          stderr: harnessResult.stderr,
        },
      }

      const spent: Spend = {
        iterations: 1,
        // budgetExempt: spend is recorded zero (not metered), never a fabricated cost.
        tokens: zeroTokenUsage(),
        usd: 0,
        ms: Date.now() - started,
      }
      artifact = { outRef: contentAddress(out), out, spent }
      return artifact
    },
    async teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      await removeIfPresent()
      return { destroyed: true }
    },
    resultArtifact() {
      if (!artifact) {
        throw new ValidationError(
          'createWorktreeCliExecutor: resultArtifact() read before execute() resolved',
        )
      }
      return artifact
    },
  }
}

/** Link two abort signals into one that fires when either does. Returns `undefined` when
 *  neither is present so the harness runner gets no signal at all. */
function linkSignals(a: AbortSignal, b: AbortSignal): AbortSignal | undefined {
  if (a.aborted || b.aborted) {
    const c = new AbortController()
    c.abort()
    return c.signal
  }
  const c = new AbortController()
  const onAbort = () => c.abort()
  a.addEventListener('abort', onAbort, { once: true })
  b.addEventListener('abort', onAbort, { once: true })
  return c.signal
}
