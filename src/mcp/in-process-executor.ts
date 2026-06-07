/**
 * @experimental
 *
 * In-process delegation executor — when `agent-runtime-mcp` is running
 * inside a sandbox whose image carries the local coding-harness CLIs
 * (claude / codex / opencode), delegations spawn the harness AS A
 * SUBPROCESS against a git worktree on the SAME filesystem instead of
 * provisioning a sibling sandbox.
 *
 * Why: zero provisioning latency, worker diffs land in-place, multi-harness
 * fanout = N parallel subprocesses in N parallel worktrees.
 *
 * Selection:
 *   - env `AGENT_RUNTIME_IN_SANDBOX=1` (set by the parent harness at MCP
 *     server launch) → in-process executor
 *   - env `TANGLE_FLEET_ID=...` → fleet executor (Phase 2.5)
 *   - neither → sibling sandbox executor (default)
 *
 * Multi-harness rotation: pass `harnesses: ['claude', 'codex', 'opencode']`
 * to round-robin across calls. A `runLoop` + `FanoutVote(n: 3)` against this
 * executor produces three parallel iterations, each running a different
 * harness on its own worktree.
 *
 * Architecture:
 *
 *   client.create() → returns a fake SandboxInstance whose streamPrompt:
 *     1. createWorktree() — git worktree add /workspace/.coder-variants/<id>
 *     2. runLocalHarness() — spawn claude/codex/opencode subprocess
 *     3. captureWorktreeDiff() — git diff HEAD → patch + stats
 *     4. run testCmd + typecheckCmd if specified (the executor doesn't
 *        own these — caller wires via task-extractor callback)
 *     5. emit ONE SandboxEvent { type: 'result', data: { result: CoderOutput } }
 *     6. removeWorktree() in finally
 */

import { randomUUID } from 'node:crypto'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import type { LoopSandboxPlacement, SandboxClient } from '../runtime'
import type { DelegationExecutor } from './executor'
import { type LocalHarness, runLocalHarness } from './local-harness'
import {
  captureWorktreeDiff,
  createWorktree,
  type GitRunner,
  removeWorktree,
  type WorktreeHandle,
} from './worktree'

/** @experimental */
export interface InProcessExecutorOptions {
  /**
   * Absolute path to the git repo (the workspace inside the sandbox). The
   * executor creates worktrees under `<repoRoot>/.coder-variants/`.
   */
  repoRoot: string
  /**
   * Harnesses to round-robin across calls. With one entry every delegation
   * uses that harness; with three you get fanout diversity for free.
   * Default `['claude']`.
   */
  harnesses?: ReadonlyArray<LocalHarness>
  /**
   * Optional per-delegation test command. Run with `cwd = worktree.path`
   * after the harness exits. The exit code populates
   * `CoderOutput.testResult.passed`.
   */
  testCmd?: string
  /**
   * Optional per-delegation typecheck command. Same shape as `testCmd`.
   */
  typecheckCmd?: string
  /** Wall-clock cap per harness subprocess (ms). Default 5min. */
  harnessTimeoutMs?: number
  /** Wall-clock cap per test/typecheck subprocess (ms). Default 2min. */
  postCheckTimeoutMs?: number
  /** Test seam — override the git runner used by the worktree helpers. */
  runGit?: GitRunner
  /**
   * Test seam — override the harness runner. Defaults to spawning the real
   * CLI via `runLocalHarness`. Tests inject a stub that returns a scripted
   * `LocalHarnessResult`.
   */
  runHarness?: typeof runLocalHarness
  /**
   * Test seam — override the post-check runner. Defaults to spawning the
   * configured `testCmd` / `typecheckCmd` via `child_process.spawn`.
   */
  runPostCheck?: (
    cmd: string,
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
}

/** @experimental */
export interface InProcessExecutorDescribePlacement extends LoopSandboxPlacement {
  /**
   * Worktree path in the parent sandbox's filesystem. Set so trace
   * consumers can correlate dispatch events with on-disk artifacts after
   * the worker exits.
   */
  worktreePath?: string
  /** Which harness handled this delegation. */
  harness?: LocalHarness
}

interface VirtualSandbox extends SandboxInstance {
  __inProcess: {
    runId: string
    harness: LocalHarness
    worktree?: WorktreeHandle
  }
}

const DEFAULT_HARNESS_TIMEOUT_MS = 5 * 60 * 1000
const DEFAULT_POSTCHECK_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Build an in-process executor.
 *
 * Returns a {@link DelegationExecutor} whose `client.create()` returns a
 * minimal "virtual" SandboxInstance — the kernel calls `streamPrompt(msg)`
 * on it, which runs the local harness on a worktree and emits one
 * `result` event whose `data.result` is a `CoderOutput`-shaped record.
 *
 * Pairs with `coderProfile`'s event parser (it walks the event list
 * back-to-front for the first `type === 'result'`).
 *
 * @experimental
 */
export function createInProcessExecutor(options: InProcessExecutorOptions): DelegationExecutor {
  const harnesses =
    options.harnesses && options.harnesses.length > 0
      ? [...options.harnesses]
      : (['claude'] as const)
  const runHarness = options.runHarness ?? runLocalHarness
  const runPostCheck = options.runPostCheck ?? defaultRunPostCheck

  let callIndex = 0

  const client: SandboxClient = {
    async create(_opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      const runId = randomUUID()
      const harness = harnesses[callIndex % harnesses.length] as LocalHarness
      callIndex += 1

      const virtual: VirtualSandbox = {
        // Synthesize the minimum SandboxInstance surface the kernel touches.
        // We CAST through unknown because SandboxInstance is a `declare class`
        // with private fields; we're producing a structural subtype that
        // satisfies the kernel's narrow usage (`box.id`, `box.streamPrompt`).
        id: `in-process-${runId}`,
        __inProcess: { runId, harness },
        // eslint-disable-next-line require-yield
        async *streamPrompt(
          this: VirtualSandbox,
          message: string | unknown[],
          promptOpts?: { signal?: AbortSignal },
        ): AsyncGenerator<SandboxEvent> {
          const taskPrompt =
            typeof message === 'string'
              ? message
              : message
                  .map((p) =>
                    typeof p === 'object' && p && 'text' in p
                      ? String((p as { text: unknown }).text)
                      : '',
                  )
                  .join('\n')

          let worktree: WorktreeHandle | undefined
          try {
            worktree = await createWorktree({
              repoRoot: options.repoRoot,
              runId,
              runGit: options.runGit,
            })
            this.__inProcess.worktree = worktree

            // Yield a dispatch-equivalent event so traces see the placement.
            yield {
              type: 'in_process.harness.started',
              data: {
                runId,
                harness,
                worktreePath: worktree.path,
                command: harness,
              },
            }

            const harnessResult = await runHarness({
              harness,
              cwd: worktree.path,
              taskPrompt,
              timeoutMs: options.harnessTimeoutMs ?? DEFAULT_HARNESS_TIMEOUT_MS,
              signal: promptOpts?.signal,
            })

            yield {
              type: 'in_process.harness.ended',
              data: {
                runId,
                exitCode: harnessResult.exitCode,
                durationMs: harnessResult.durationMs,
                killedBySignal: harnessResult.killedBySignal,
                timedOut: harnessResult.timedOut,
                stdoutBytes: harnessResult.stdout.length,
                stderrBytes: harnessResult.stderr.length,
              },
            }

            // Capture diff regardless of exit code — a failed run can still
            // leave a partial diff worth inspecting.
            const diff = await captureWorktreeDiff({ worktree, runGit: options.runGit })

            // Optional post-checks. Each runs in the WORKTREE so it sees the
            // harness's edits.
            const testCheck = options.testCmd
              ? await runPostCheck(options.testCmd, worktree.path, promptOpts?.signal).catch(
                  (err) => ({
                    exitCode: -1,
                    stdout: '',
                    stderr: err instanceof Error ? err.message : String(err),
                  }),
                )
              : { exitCode: 0, stdout: '', stderr: '' }
            const typecheckCheck = options.typecheckCmd
              ? await runPostCheck(options.typecheckCmd, worktree.path, promptOpts?.signal).catch(
                  (err) => ({
                    exitCode: -1,
                    stdout: '',
                    stderr: err instanceof Error ? err.message : String(err),
                  }),
                )
              : { exitCode: 0, stdout: '', stderr: '' }

            const coderOutput = {
              branch: worktree.branch,
              patch: diff.patch,
              testResult: {
                passed: !options.testCmd || testCheck.exitCode === 0,
                output: tail(testCheck.stderr || testCheck.stdout, 4000),
              },
              typecheckResult: {
                passed: !options.typecheckCmd || typecheckCheck.exitCode === 0,
                output: tail(typecheckCheck.stderr || typecheckCheck.stdout, 4000),
              },
              diffStats: diff.stats,
              reviewerNotes:
                harnessResult.exitCode === 0
                  ? undefined
                  : `harness ${harness} exited ${harnessResult.exitCode}${harnessResult.timedOut ? ' (timed out)' : ''}`,
            }

            // The terminal event the coderProfile parser looks for.
            yield {
              type: 'result',
              data: {
                result: coderOutput,
                source: 'in-process-executor',
                harness,
                runId,
              },
            }
          } finally {
            if (worktree) {
              await removeWorktree({
                worktree,
                repoRoot: options.repoRoot,
                runGit: options.runGit,
              }).catch(() => undefined)
            }
          }
        },
      } as unknown as VirtualSandbox

      return virtual
    },
    describePlacement(box: SandboxInstance): InProcessExecutorDescribePlacement {
      const sandboxId = (box as unknown as { id?: string }).id
      const meta = (box as VirtualSandbox).__inProcess
      return {
        kind: 'sibling',
        sandboxId,
        worktreePath: meta?.worktree?.path,
        harness: meta?.harness,
      }
    },
  }

  return {
    client,
    describe(): string {
      return `in-process (repoRoot=${options.repoRoot}, harnesses=[${harnesses.join(',')}]${
        options.testCmd ? `, testCmd="${options.testCmd}"` : ''
      }${options.typecheckCmd ? `, typecheckCmd="${options.typecheckCmd}"` : ''})`
    },
  }
}

async function defaultRunPostCheck(
  cmd: string,
  cwd: string,
  signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const { spawn } = await import('node:child_process')
  return new Promise((resolve, reject) => {
    // Run via sh -c so multi-word commands ("pnpm test") and shell features work.
    const child = spawn('sh', ['-c', cmd], { cwd, stdio: 'pipe' })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (c) => {
      stdout += String(c)
    })
    child.stderr?.on('data', (c) => {
      stderr += String(c)
    })
    if (signal) {
      const onAbort = () => {
        if (!child.killed) child.kill('SIGTERM')
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
    }
    const killTimer = setTimeout(() => {
      if (!child.killed) child.kill('SIGTERM')
    }, DEFAULT_POSTCHECK_TIMEOUT_MS)
    if (typeof (killTimer as { unref?: () => void }).unref === 'function') {
      ;(killTimer as { unref: () => void }).unref()
    }
    child.on('error', (err) => {
      clearTimeout(killTimer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(killTimer)
      resolve({ exitCode: code ?? -1, stdout, stderr })
    })
  })
}

function tail(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(text.length - max)
}
