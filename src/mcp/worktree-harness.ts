/**
 *
 * The ONE worktree-harness execution core. The physical act — run a supervisor-authored
 * `AgentProfile` on a local coding-harness CLI (claude / codex / opencode) against a fresh git
 * worktree off `repoRoot`, capture the diff, derive the test/typecheck PASS signals, then clean
 * up — lives here ONCE. Two executors adapt it to two ports without re-implementing it:
 *   - `createWorktreeCliExecutor` — the `Scope`/`Supervisor` leaf `Executor`.
 *   - `createInProcessExecutor`   — the `runLoop` `SandboxClient` / coder-delegate path.
 *
 * §1.5 by construction: the authored `profile.prompt.systemPrompt` + `profile.model.default`
 * reach the harness through `harnessInvocation` HERE, so neither port can drop them — the exact
 * bug that existed while the in-process path called `runLocalHarness` with only the task prompt.
 *
 * Lifecycle: `createWorktree` → `harnessInvocation` + `runLocalHarness` → `captureWorktreeDiff`
 * (BEFORE checks, so the patch is the harness's output, not polluted by files a test run writes)
 * → the configured test/typecheck commands in the live worktree → return the result + a `cleanup`
 * the caller invokes at its own teardown point. A throw cleans up before propagating, so a failed
 * run never leaks a worktree.
 *
 * @experimental
 */

import { spawn } from 'node:child_process'
import type { AgentProfile } from '@tangle-network/agent-interface'
import {
  type CodexExecutionPolicy,
  type CodexTokenUsage,
  harnessInvocation,
  type LocalHarness,
  type LocalHarnessResult,
  runLocalHarness,
} from './local-harness'
import {
  captureWorktreeDiff,
  createWorktree,
  type GitRunner,
  removeWorktree,
  type WorktreeHandle,
} from './worktree'

/** Outcome of one verification command run in the worktree (test or typecheck). */
export interface WorktreeCommandResult {
  /** The shell command line that was run. */
  command: string
  /** Did the command exit 0? The PASS signal a deliverable gate / coder output reads. */
  passed: boolean
  /** OS exit code, or `null` when killed before exit. */
  exitCode: number | null
  /** Combined stdout+stderr (capped) — surfaced in traces for diagnosis. */
  output: string
}

/** The canonical result of one worktree-harness run, projected by each port to its own shape. */
export interface WorktreeHarnessResult {
  /** The branch the worktree was cut on (`delegate/<runId>`). */
  branch: string
  /** `git diff` of the worktree against its base — the unified patch the harness produced. */
  patch: string
  /** Shortstat-derived change counts. */
  stats: { filesChanged: number; insertions: number; deletions: number }
  /** The harness subprocess outcome. */
  harness: {
    name: LocalHarness | 'bridge'
    exitCode: number | null
    timedOut: boolean
    killedBySignal: NodeJS.Signals | null
    durationMs: number
    stdout: string
    stderr: string
    /** Exact Codex JSONL usage when reproducible mode is enabled. */
    usage?: CodexTokenUsage
    /** Installed CLI version captured immediately before execution. */
    cliVersion?: string
    /** SHA-256 of the native Codex executable staged read-only in the candidate worktree. */
    executableSha256?: string
    /** SHA-256 of the exact composed prompt argument proved present in Codex's rendered prompt. */
    requestedPromptSha256?: string
    /** SHA-256 of `codex debug prompt-input` output for the exact isolated prompt. */
    effectivePromptSha256?: string
    /** SHA-256 of the exact executable + argv with prompt content replaced by `<PROMPT>`. */
    nonPromptArgsSha256?: string
    /** SHA-256 of the isolated config that fixes permissions and shell environment. */
    controlledConfigSha256?: string
    /** SHA-256 of the normalized caller-supplied host read-denial paths. */
    readDeniedPathsSha256?: string
    /** Sorted normalized caller-supplied host read-denial paths. */
    readDeniedPaths?: string[]
    /** Number of normalized caller-supplied host read-denial paths. */
    readDeniedPathCount?: number
    /** Explicit isolation claims checked before model execution. */
    executionPolicy?: CodexExecutionPolicy
  }
  /** Verification signals derived in the live worktree (present only when commands were given). */
  checks?: {
    tests?: WorktreeCommandResult
    typecheck?: WorktreeCommandResult
  }
}

/** The single shell-command-in-worktree runner seam (replaces the per-executor copies). */
export type WorktreeCheckRunner = (opts: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}) => Promise<{ exitCode: number | null; output: string }>

/** @experimental */
export interface RunWorktreeHarnessOptions {
  /** Absolute path to the git checkout the worktree is cut from. */
  repoRoot: string
  /** The SUPERVISOR-AUTHORED profile — its systemPrompt + model reach the harness (§1.5). */
  profile: AgentProfile
  /** Which local harness CLI drives this run. */
  harness: LocalHarness
  /** The per-task instruction handed to the harness (composed under the system prompt). */
  taskPrompt: string
  /** Unique id for the worktree path + branch. */
  runId: string
  /** Override the base ref the worktree is cut from (default `HEAD`). */
  baseRef?: string
  /** Shell command run in the live worktree to derive the tests-PASS signal. Omit to skip. */
  testCmd?: string
  /** Shell command run in the live worktree to derive the typecheck-PASS signal. Omit to skip. */
  typecheckCmd?: string
  /** Wall-clock cap per harness subprocess (ms). */
  harnessTimeoutMs?: number
  /** Run Codex in isolated, network-off JSONL mode and require real token usage. */
  codexReproducible?: boolean
  /** Absolute host paths the reproducible Codex process must not read. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  /** Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min. */
  checkTimeoutMs?: number
  /** Cap on each check's captured output. Default 16k. */
  checkOutputCap?: number
  /** Abort signal — linked into the harness subprocess and the check commands. */
  signal?: AbortSignal
  /** Test seam — inject a git runner so unit tests drive the worktree helpers without git. */
  runGit?: GitRunner
  /** Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`. */
  runHarness?: typeof runLocalHarness
  /** Test seam — inject the verification-command runner. Defaults to a `/bin/sh -c` spawn. */
  runCommand?: WorktreeCheckRunner
}

/** One worktree-harness run: the result + the worktree handle + a single-use `cleanup`. */
export interface WorktreeHarnessRun {
  worktree: WorktreeHandle
  result: WorktreeHarnessResult
  /** Remove the worktree. The caller invokes this at its own teardown point (the leaf in its
   *  `Executor.teardown`, the SandboxClient in its `streamPrompt` finally). On a thrown run the
   *  core already cleaned up, so the caller never double-removes. */
  cleanup: () => Promise<void>
}

const defaultCheckOutputCap = 16_000

/**
 * Run the one worktree-harness operation. Fail-loud cleanup: any throw removes the worktree
 * before propagating, so a failed run never leaks one (the caller cleans up the success path).
 */
export async function runWorktreeHarness(
  opts: RunWorktreeHarnessOptions,
): Promise<WorktreeHarnessRun> {
  const runHarness = opts.runHarness ?? runLocalHarness
  const runCommand = opts.runCommand ?? defaultRunCommand
  const checkTimeoutMs = opts.checkTimeoutMs ?? opts.harnessTimeoutMs ?? 5 * 60 * 1000
  const cap = opts.checkOutputCap ?? defaultCheckOutputCap

  const worktree = await createWorktree({
    repoRoot: opts.repoRoot,
    runId: opts.runId,
    ...(opts.baseRef ? { baseRef: opts.baseRef } : {}),
    ...(opts.runGit ? { runGit: opts.runGit } : {}),
  })

  const cleanup = (): Promise<void> =>
    removeWorktree({
      worktree,
      repoRoot: opts.repoRoot,
      ...(opts.runGit ? { runGit: opts.runGit } : {}),
    }).catch(() => undefined)

  try {
    // §1.5: the authored systemPrompt + model reach the harness (NOT the prompt-only path).
    const { command, args } = harnessInvocation(opts.harness, opts.profile, opts.taskPrompt, {
      // This helper created the candidate worktree above; autonomous Claude
      // edits are permitted only inside that isolated checkout.
      dangerouslySkipPermissions: opts.harness === 'claude',
      ...(opts.codexReproducible ? { codexReproducible: true } : {}),
    })
    const harnessResult: LocalHarnessResult = await runHarness({
      harness: opts.harness,
      cwd: worktree.path,
      taskPrompt: opts.taskPrompt,
      invocation: { command, args },
      ...(opts.codexReproducible ? { codexReproducible: true } : {}),
      ...(opts.codexReadDeniedPaths ? { codexReadDeniedPaths: opts.codexReadDeniedPaths } : {}),
      ...(opts.harnessTimeoutMs !== undefined ? { timeoutMs: opts.harnessTimeoutMs } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    // Diff BEFORE checks — the patch is the harness's output, not whatever a test run left behind.
    const diff = await captureWorktreeDiff({
      worktree,
      ...(opts.runGit ? { runGit: opts.runGit } : {}),
    })

    const checks = await runWorktreeChecks({
      worktreePath: worktree.path,
      ...(opts.testCmd !== undefined ? { testCmd: opts.testCmd } : {}),
      ...(opts.typecheckCmd !== undefined ? { typecheckCmd: opts.typecheckCmd } : {}),
      timeoutMs: checkTimeoutMs,
      cap,
      runCommand,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })

    const result: WorktreeHarnessResult = {
      branch: worktree.branch,
      patch: diff.patch,
      stats: diff.stats,
      harness: {
        name: opts.harness,
        exitCode: harnessResult.exitCode,
        timedOut: harnessResult.timedOut,
        killedBySignal: harnessResult.killedBySignal,
        durationMs: harnessResult.durationMs,
        stdout: harnessResult.stdout,
        stderr: harnessResult.stderr,
        ...(harnessResult.usage ? { usage: harnessResult.usage } : {}),
        ...(harnessResult.evidence
          ? {
              cliVersion: harnessResult.evidence.cliVersion,
              executableSha256: harnessResult.evidence.executableSha256,
              requestedPromptSha256: harnessResult.evidence.requestedPromptSha256,
              effectivePromptSha256: harnessResult.evidence.effectivePromptSha256,
              nonPromptArgsSha256: harnessResult.evidence.nonPromptArgsSha256,
              controlledConfigSha256: harnessResult.evidence.controlledConfigSha256,
              readDeniedPaths: [...harnessResult.evidence.readDeniedPaths],
              readDeniedPathsSha256: harnessResult.evidence.readDeniedPathsSha256,
              readDeniedPathCount: harnessResult.evidence.readDeniedPathCount,
              executionPolicy: harnessResult.evidence.policy,
            }
          : {}),
      },
      ...(checks ? { checks } : {}),
    }
    return { worktree, result, cleanup }
  } catch (err) {
    await cleanup()
    throw err
  }
}

/** Run the configured test + typecheck commands in the live worktree, projecting exit codes into
 *  `checks`. Returns `undefined` when neither was configured (so the result omits `checks`). */
export async function runWorktreeChecks(opts: {
  worktreePath: string
  testCmd?: string
  typecheckCmd?: string
  timeoutMs: number
  cap: number
  runCommand?: WorktreeCheckRunner
  signal?: AbortSignal
}): Promise<WorktreeHarnessResult['checks'] | undefined> {
  if (opts.testCmd === undefined && opts.typecheckCmd === undefined) return undefined
  const runCommand = opts.runCommand ?? defaultRunCommand
  const run = async (command: string): Promise<WorktreeCommandResult> => {
    const res = await runCommand({
      command,
      cwd: opts.worktreePath,
      timeoutMs: opts.timeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return {
      command,
      passed: res.exitCode === 0,
      exitCode: res.exitCode,
      output: res.output.length > opts.cap ? res.output.slice(-opts.cap) : res.output,
    }
  }
  const checks: NonNullable<WorktreeHarnessResult['checks']> = {}
  if (opts.testCmd !== undefined) checks.tests = await run(opts.testCmd)
  if (opts.typecheckCmd !== undefined) checks.typecheck = await run(opts.typecheckCmd)
  return checks
}

/** Default verification-command runner — `/bin/sh -c <command>` in the worktree, capturing
 *  combined stdout+stderr. Never throws on a non-zero exit (that IS the fail signal); only a
 *  spawn failure (ENOENT shell) rejects. */
export function defaultRunCommand(opts: {
  command: string
  cwd: string
  timeoutMs: number
  signal?: AbortSignal
}): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', ['-c', opts.command], {
      cwd: opts.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const chunks: string[] = []
    let settled = false
    const timer = setTimeout(() => child.kill('SIGTERM'), opts.timeoutMs)
    const onAbort = () => child.kill('SIGTERM')
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.stdout?.on('data', (d) => chunks.push(String(d)))
    child.stderr?.on('data', (d) => chunks.push(String(d)))
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      fn()
    }
    child.on('error', (err) => finish(() => reject(err)))
    child.on('close', (code) => finish(() => resolve({ exitCode: code, output: chunks.join('') })))
  })
}
