/**
 *
 * The worktree-CLI leaf executor — a supervisor-authored `AgentProfile` driving a local
 * coding-harness CLI (claude / codex / opencode) on its OWN git worktree, surfaced as the open
 * `Executor<Out>` port (`./types`). It is a LEAF executor: it plugs straight into the
 * `Scope`/`Supervisor` recursion and `gateOnDeliverable`, so it IS the canonical recursive path
 * (no `runLoop`/virtual-SandboxInstance shim in between).
 *
 * This is a THIN adapter: the physical act (worktree → profile-aware harness invocation → diff →
 * checks → cleanup) lives ONCE in `runWorktreeHarness` (`../../mcp/worktree-harness`), shared with
 * the `runLoop`/coder-delegate `createInProcessExecutor`. This executor only projects that core's
 * result onto the `Executor` port (artifact + spend) and owns the teardown point. The §1.5 payload
 * (authored systemPrompt + model) reaches the harness inside the core, not here.
 *
 * Token accounting: ordinary harness CLI runs remain `budgetExempt`. Reproducible Codex mode
 * parses the CLI's terminal JSONL usage and is metered by default; an absent usage event fails the
 * run instead of recording fabricated zero tokens. Codex does not report dollar cost, so that
 * channel is explicitly marked unknown on the resulting `Spend`.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@tangle-network/agent-interface'
import { contentAddress } from '../../durable/spawn-journal'
import { ValidationError } from '../../errors'
import type { LocalHarness, runLocalHarness } from '../../mcp/local-harness'
import type { GitRunner } from '../../mcp/worktree'
import {
  runWorktreeHarness,
  type WorktreeCheckRunner,
  type WorktreeCommandResult,
  type WorktreeHarnessResult,
  type WorktreeHarnessRun,
} from '../../mcp/worktree-harness'
import type { Executor, ExecutorResult, Spend } from './types'

export type { WorktreeCommandResult }
/** Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 *  diff + the harness's run record + the derived checks). */
export type WorktreePatchArtifact = WorktreeHarnessResult

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
  /** Run Codex with an ephemeral session, isolated config/instructions, network disabled, and
   *  JSONL usage capture. Requires `harness: 'codex'`; metered by default. */
  codexReproducible?: boolean
  /**
   * Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
   * Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).
   */
  testCmd?: string
  /** Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`). */
  typecheckCmd?: string
  /** Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min. */
  checkTimeoutMs?: number
  /** Cap on each check's captured output. Default 16k. */
  checkOutputCap?: number
  /** Test seam — inject a git runner so unit tests drive the worktree helpers without git. */
  runGit?: GitRunner
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the verification-command runner so unit tests script test/typecheck
   *  outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree. */
  runCommand?: WorktreeCheckRunner
  /**
   * Exclude this leaf's spend from accounting. Defaults to `true` for ordinary CLI runs and
   * `false` for `codexReproducible`, which captures real token usage. A metered custom runner must
   * likewise return `LocalHarnessResult.usage`.
   */
  budgetExempt?: boolean
}

/**
 * Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a
 * fanout of N profiles = N parallel worktrees that never clobber each other.
 *
 * Fail-loud: an empty `repoRoot`/`harness`/`taskPrompt` throws at construction. `resultArtifact()`
 * before `execute()` resolves throws.
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
  if (options.codexReproducible && options.harness !== 'codex') {
    throw new ValidationError(
      'createWorktreeCliExecutor: codexReproducible requires harness "codex"',
    )
  }
  if (options.codexReproducible && options.budgetExempt === true) {
    throw new ValidationError('createWorktreeCliExecutor: codexReproducible cannot be budgetExempt')
  }

  const runId = options.runId ?? randomUUID()
  const controller = new AbortController()
  const budgetExempt = options.budgetExempt ?? !options.codexReproducible

  let run: WorktreeHarnessRun | undefined
  let artifact: ExecutorResult<WorktreePatchArtifact> | undefined

  return {
    runtime: 'cli',
    budgetExempt,
    async execute(_task, signal): Promise<ExecutorResult<WorktreePatchArtifact>> {
      const linked = linkSignals(signal, controller.signal)
      const started = Date.now()

      run = await runWorktreeHarness({
        repoRoot: options.repoRoot,
        profile: options.profile,
        harness: options.harness,
        taskPrompt: options.taskPrompt,
        runId,
        ...(options.baseRef ? { baseRef: options.baseRef } : {}),
        ...(options.testCmd !== undefined ? { testCmd: options.testCmd } : {}),
        ...(options.typecheckCmd !== undefined ? { typecheckCmd: options.typecheckCmd } : {}),
        ...(options.harnessTimeoutMs !== undefined
          ? { harnessTimeoutMs: options.harnessTimeoutMs }
          : {}),
        ...(options.codexReproducible ? { codexReproducible: true } : {}),
        ...(options.checkTimeoutMs !== undefined ? { checkTimeoutMs: options.checkTimeoutMs } : {}),
        ...(options.checkOutputCap !== undefined ? { checkOutputCap: options.checkOutputCap } : {}),
        ...(linked ? { signal: linked } : {}),
        ...(options.runGit ? { runGit: options.runGit } : {}),
        ...(options.runHarness ? { runHarness: options.runHarness } : {}),
        ...(options.runCommand ? { runCommand: options.runCommand } : {}),
      })

      const usage = run.result.harness.usage
      if (!budgetExempt && !usage) {
        const completed = run
        run = undefined
        await completed.cleanup()
        throw new ValidationError(
          'createWorktreeCliExecutor: metered harness run returned no token usage',
        )
      }
      const spent: Spend = {
        iterations: 1,
        tokens: usage
          ? { input: usage.inputTokens, output: usage.outputTokens }
          : { input: 0, output: 0 },
        usd: 0,
        ...(usage ? { usdKnown: false } : {}),
        ms: Date.now() - started,
      }
      artifact = { outRef: contentAddress(run.result), out: run.result, spent }
      return artifact
    },
    async teardown(_grace): Promise<{ destroyed: boolean }> {
      controller.abort()
      // The loser of a fanout (or any settled run) is dirty — remove its worktree. A run that
      // THREW already cleaned itself up in the core, so `run` stays undefined and this is a no-op.
      if (run) {
        const r = run
        run = undefined
        await r.cleanup()
      }
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

/** Link two abort signals into one that fires when either does. Returns `undefined` when neither
 *  is present so the harness runner gets no signal at all. */
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
