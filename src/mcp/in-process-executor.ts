/**
 *
 * In-process delegation executor — when `agent-runtime-mcp` runs inside a sandbox whose image
 * carries the local coding-harness CLIs (claude / codex / opencode), delegations spawn the harness
 * AS A SUBPROCESS against a git worktree on the SAME filesystem instead of provisioning a sibling
 * sandbox. Zero provisioning latency; worker diffs land in-place; multi-harness fanout = N parallel
 * subprocesses in N parallel worktrees. Each authored profile selects its own harness.
 *
 * This is a THIN adapter over `runWorktreeHarness` (`./worktree-harness`) — the SAME core the
 * `Scope` leaf `createWorktreeCliExecutor` uses. It only adapts the core to the `SandboxClient`
 * port: `create()` reads the authored profile from `CreateSandboxOptions.backend.profile`, and
 * `streamPrompt` runs the core then emits its raw `WorktreeHarnessResult` (the content-addressed
 * patch artifact) on the `result` event. The sandbox-session decode layer
 * (`./detached-coder`) projects that artifact onto `CoderOutput`; the generic `Scope` path settles
 * the artifact directly. The §1.5 payload (systemPrompt + model) reaches the harness inside the core.
 *
 * @experimental
 */

import { randomUUID } from 'node:crypto'
import { type AgentProfile, agentProfileSchema } from '@tangle-network/agent-interface'
import type { CreateSandboxOptions, SandboxEvent, SandboxInstance } from '@tangle-network/sandbox'
import { ConfigError } from '../errors'
import type { LoopSandboxPlacement, SandboxClient } from '../runtime'
import { assertBoxlessPromptOptions } from '../runtime/prompt-options'
import { assertExecutableAgentProfile } from '../runtime/supervise/model-policy'
import type { DelegationExecutor } from './executor'
import { LOCAL_HARNESSES, type LocalHarness } from './local-harness'
import type { GitRunner, WorktreeHandle } from './worktree'
import { runWorktreeHarness } from './worktree-harness'

/** @experimental */
export interface InProcessExecutorOptions {
  /** Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`. */
  repoRoot: string
  /** Optional per-delegation test command run in the worktree after the harness exits. */
  testCmd?: string
  /** Optional per-delegation typecheck command. Same shape as `testCmd`. */
  typecheckCmd?: string
  /** Optional wall-clock cap per harness subprocess (ms). Omit it for no timer. */
  harnessTimeoutMs?: number
  /** Wall-clock cap per test/typecheck subprocess (ms). Default 2min. */
  postCheckTimeoutMs?: number
  /** Test seam — override the git runner used by the worktree helpers. */
  runGit?: GitRunner
  /** Test seam — override the harness runner (defaults to the real CLI via `runLocalHarness`). */
  runHarness?: typeof import('./local-harness').runLocalHarness
  /** Test seam — override the post-check runner (defaults to a `sh -c` spawn). A throw is folded
   *  into a non-fatal `{exitCode:-1}` so a broken check command fails the signal, not the run. */
  runPostCheck?: (
    cmd: string,
    cwd: string,
    signal?: AbortSignal,
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
}

/** @experimental */
export interface InProcessExecutorDescribePlacement extends LoopSandboxPlacement {
  /** Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts). */
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

const DEFAULT_POSTCHECK_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Build an in-process executor. Returns a {@link DelegationExecutor} whose `client.create()`
 * returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
 * runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
 * raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
 * (`backend.profile`) threads its systemPrompt + model into the harness via the core.
 *
 * There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
 * other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.
 *
 * @experimental
 */
export function createInProcessExecutor(options: InProcessExecutorOptions): DelegationExecutor {
  const runPostCheck = options.runPostCheck ?? defaultRunPostCheck
  // The core speaks one `runCommand` seam ({exitCode, output}); adapt the post-check seam
  // ({exitCode, stdout, stderr}) onto it, folding a throw into a non-fatal failure signal so a
  // broken check command fails the signal rather than aborting the whole delegation.
  const runCommand = async ({
    command,
    cwd,
    signal,
  }: {
    command: string
    cwd: string
    timeoutMs: number
    signal?: AbortSignal
  }): Promise<{ exitCode: number | null; output: string }> => {
    try {
      const r = await runPostCheck(command, cwd, signal)
      return { exitCode: r.exitCode, output: r.stderr || r.stdout }
    } catch (err) {
      return { exitCode: -1, output: err instanceof Error ? err.message : String(err) }
    }
  }

  const client: SandboxClient = {
    async create(opts?: CreateSandboxOptions): Promise<SandboxInstance> {
      // The authored profile is the sole execution authority. Refuse before creating a run id or
      // worktree: ambient executor configuration must never choose a worker's harness or model.
      const rawProfile = (opts?.backend as { profile?: unknown } | undefined)?.profile
      if (rawProfile === undefined) {
        throw new ConfigError(
          'in-process executor: backend.profile is required and must select the exact harness, provider, and model',
        )
      }
      const profile = agentProfileSchema.parse(rawProfile) as AgentProfile
      assertExecutableAgentProfile(profile, 'in-process executor')
      const harness = profile.harness
      if (!LOCAL_HARNESSES.includes(harness as LocalHarness)) {
        throw new ConfigError(
          `in-process executor: AgentProfile.harness ${JSON.stringify(harness)} is not a local harness; expected ${LOCAL_HARNESSES.join(', ')}`,
        )
      }
      if (opts?.backend?.type !== undefined && opts.backend.type !== harness) {
        throw new ConfigError(
          `in-process executor: backend.type ${JSON.stringify(opts.backend.type)} conflicts with AgentProfile.harness ${JSON.stringify(harness)}`,
        )
      }
      const localHarness = harness as LocalHarness
      const runId = randomUUID()

      const virtual: VirtualSandbox = {
        id: `in-process-${runId}`,
        __inProcess: { runId, harness: localHarness },
        async *streamPrompt(
          this: VirtualSandbox,
          message: string | unknown[],
          promptOpts?: { signal?: AbortSignal },
        ): AsyncGenerator<SandboxEvent> {
          assertBoxlessPromptOptions(promptOpts, 'in-process executor')
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

          // The shared worktree-harness core: worktree → profile-aware harness → diff → checks.
          // A throw cleans up inside the core; on success we own the teardown (the finally).
          const run = await runWorktreeHarness({
            repoRoot: options.repoRoot,
            profile,
            harness: localHarness,
            taskPrompt,
            runId,
            ...(options.harnessTimeoutMs !== undefined
              ? { harnessTimeoutMs: options.harnessTimeoutMs }
              : {}),
            checkTimeoutMs: options.postCheckTimeoutMs ?? DEFAULT_POSTCHECK_TIMEOUT_MS,
            ...(options.testCmd !== undefined ? { testCmd: options.testCmd } : {}),
            ...(options.typecheckCmd !== undefined ? { typecheckCmd: options.typecheckCmd } : {}),
            ...(options.runGit ? { runGit: options.runGit } : {}),
            ...(options.runHarness ? { runHarness: options.runHarness } : {}),
            runCommand,
            ...(promptOpts?.signal ? { signal: promptOpts.signal } : {}),
          })
          this.__inProcess.worktree = run.worktree

          try {
            yield {
              type: 'in_process.harness.started',
              data: {
                runId,
                harness: localHarness,
                worktreePath: run.worktree.path,
                command: localHarness,
              },
            }
            const h = run.result.harness
            yield {
              type: 'in_process.harness.ended',
              data: {
                runId,
                exitCode: h.exitCode,
                durationMs: h.durationMs,
                killedBySignal: h.killedBySignal,
                timedOut: h.timedOut,
                stdoutBytes: h.stdout.length,
                stderrBytes: h.stderr.length,
              },
            }
            yield {
              type: 'result',
              data: {
                result: run.result,
                source: 'in-process-executor',
                harness: localHarness,
                runId,
              },
            }
          } finally {
            await run.cleanup()
          }
        },
      } as unknown as VirtualSandbox

      return virtual
    },
    describePlacement(box: SandboxInstance): InProcessExecutorDescribePlacement {
      const sandboxId = (box as unknown as { id?: string }).id
      const meta = (box as VirtualSandbox).__inProcess
      return {
        kind: 'in-process',
        sandboxId,
        worktreePath: meta?.worktree?.path,
        harness: meta?.harness,
      }
    },
  }

  return {
    client,
    placement: 'in-process',
    describe(): string {
      return `in-process (repoRoot=${options.repoRoot}, harness=profile-selected${
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
