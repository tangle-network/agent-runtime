/**
 * @experimental
 *
 * Subprocess wrappers for the local coding-harness CLIs installed in the
 * sandbox image (claude-code, codex, opencode). Used by the in-process
 * delegation executor (`createInProcessExecutor`) so a `delegate_code` call
 * spawns a real harness on a real git worktree instead of provisioning a
 * sibling sandbox.
 *
 * All harness invocations:
 *   - run with `cwd` set to the worktree
 *   - inherit env from the parent (the MCP server inside the sandbox has
 *     the harness's auth already)
 *   - capture stdout/stderr
 *   - support cancellation via AbortSignal
 *   - enforce a wall-clock timeout
 */

import { type ChildProcess, spawn } from 'node:child_process'
import type { AgentProfile } from '@tangle-network/agent-interface'

/** Local coding harness available inside the sandbox. */
export type LocalHarness = 'claude' | 'codex' | 'opencode'

/**
 * Default per-harness command + arg shape. `buildArgs` takes ONLY the task prompt and
 * emits the prompt-only invocation (no model, no system prompt) — the historical shape
 * the in-process executor's `streamPrompt` drives. `modelArgs` maps a resolved model to
 * the harness's selector flag (every supported harness takes `-m <model>`). The §1.5
 * profile-aware mapper `harnessInvocation` composes these to thread the full
 * supervisor-authored profile (systemPrompt + model) into argv.
 */
const HARNESS_INVOCATIONS: Record<
  LocalHarness,
  {
    command: string
    buildArgs: (taskPrompt: string) => string[]
    /** Map a resolved model to the harness's model-selector flag. */
    modelArgs: (model: string) => string[]
  }
> = {
  claude: {
    command: 'claude',
    buildArgs: (taskPrompt) => ['--headless', '-p', taskPrompt],
    modelArgs: (model) => ['-m', model],
  },
  codex: {
    command: 'codex',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
  },
  opencode: {
    command: 'opencode',
    buildArgs: (taskPrompt) => ['run', taskPrompt],
    modelArgs: (model) => ['-m', model],
  },
}

/** Result of mapping an `AgentProfile` + task prompt onto a harness invocation. */
export interface HarnessInvocation {
  command: string
  args: string[]
}

/**
 * Map a supervisor-authored `AgentProfile` + the per-task prompt onto a concrete harness
 * `command` + `args` (the §1.5 fix). UNLIKE the prompt-only `HARNESS_INVOCATIONS.buildArgs`
 * — which drops both the authored model and the system prompt — this threads the FULL
 * profile payload into argv:
 *
 *  - `profile.prompt.systemPrompt` → the PROMPT channel: a portable, harness-agnostic
 *    default that prepends the system prompt above the task prompt (`<system>\n\n<task>`),
 *    so the authored standing instructions reach EVERY harness (none of the three CLIs
 *    expose a portable replace-system-prompt flag for a one-shot non-interactive run).
 *  - `profile.model.default` → the harness's `-m <model>` selector.
 *
 * The task prompt alone is the floor; an empty/absent profile yields exactly the legacy
 * `buildArgs(taskPrompt)` shape so existing callers are byte-identical.
 */
export function harnessInvocation(
  harness: LocalHarness,
  profile: AgentProfile,
  taskPrompt: string,
): HarnessInvocation {
  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`harnessInvocation: unknown harness ${String(harness)}`)
  }

  const systemPrompt = profile.prompt?.systemPrompt
  const composedPrompt =
    typeof systemPrompt === 'string' && systemPrompt.trim().length > 0
      ? `${systemPrompt}\n\n${taskPrompt}`
      : taskPrompt

  const args = invocation.buildArgs(composedPrompt)

  const model = profile.model?.default
  if (typeof model === 'string' && model.length > 0) {
    args.push(...invocation.modelArgs(model))
  }

  return { command: invocation.command, args }
}

/** @experimental */
export interface RunLocalHarnessOptions {
  harness: LocalHarness
  /** Working directory for the subprocess (typically a worktree path). */
  cwd: string
  /** Prompt forwarded as the harness CLI's task argument. */
  taskPrompt: string
  /**
   * Pre-built command + args (e.g. from `harnessInvocation` so the full authored
   * `AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
   * default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
   * default binary when only `args` is supplied. When absent the legacy prompt-only shape
   * is used unchanged.
   */
  invocation?: { command?: string; args: ReadonlyArray<string> }
  /** Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry. */
  timeoutMs?: number
  /** Caller cancellation. SIGTERM is sent on abort. */
  signal?: AbortSignal
  /** Override env (defaults to inheriting from the parent). */
  env?: NodeJS.ProcessEnv
  /**
   * Test seam — inject a custom spawner so unit tests can mock the
   * subprocess without touching the OS. Defaults to node's `child_process.spawn`.
   */
  spawn?: (
    command: string,
    args: ReadonlyArray<string>,
    opts: {
      cwd: string
      env: NodeJS.ProcessEnv
      stdio: 'pipe'
    },
  ) => ChildProcess
}

/** @experimental */
export interface LocalHarnessResult {
  /** OS exit code. `null` when killed before exit. */
  exitCode: number | null
  /** Concatenated stdout. */
  stdout: string
  /** Concatenated stderr. */
  stderr: string
  /** Set when the process exited via signal (timeout / abort). */
  killedBySignal: NodeJS.Signals | null
  /** Wall-clock duration ms (spawn → exit). */
  durationMs: number
  /** Set when timeoutMs elapsed before exit. */
  timedOut: boolean
}

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Spawn a local coding harness CLI as a subprocess + collect its output.
 *
 * NOT responsible for parsing the harness's output or extracting a diff —
 * the in-process executor's `streamPrompt` orchestrates `git diff` against
 * the worktree after this resolves. This function is intentionally narrow:
 * spawn, wait, capture, return.
 *
 * Fails loud — throws when:
 *   - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
 *   - the harness binary is not on PATH (ENOENT)
 *
 * Does NOT throw when:
 *   - the subprocess exits non-zero (`result.exitCode` carries the code)
 *   - the subprocess is aborted / timed out (`result.killedBySignal` /
 *     `result.timedOut` carries the reason)
 *
 * @experimental
 */
export function runLocalHarness(options: RunLocalHarnessOptions): Promise<LocalHarnessResult> {
  const { harness, cwd, taskPrompt } = options
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const env = options.env ?? process.env
  const spawnImpl = options.spawn ?? spawn

  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    return Promise.reject(new Error(`runLocalHarness: unknown harness ${String(harness)}`))
  }

  const startedAt = Date.now()
  const command = options.invocation?.command ?? invocation.command
  const args = options.invocation ? [...options.invocation.args] : invocation.buildArgs(taskPrompt)

  return new Promise<LocalHarnessResult>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawnImpl(command, args, { cwd, env, stdio: 'pipe' })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
      return
    }

    // The harness takes its task as an argv arg, not on stdin. Leaving stdin
    // OPEN makes a non-TTY `opencode run` (and likely the other harnesses)
    // BLOCK forever waiting on input — zero output, SIGTERM at the wall cap,
    // empty patch -> "no candidate passed validation". Close stdin so the
    // subprocess sees EOF and proceeds (the `cliExecutor` leaf does the same).
    child.stdin?.end()

    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            timedOut = true
            if (!child.killed) child.kill('SIGTERM')
          }, timeoutMs)
        : null
    if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
      ;(timer as { unref: () => void }).unref()
    }

    const onAbort = () => {
      if (!child.killed) child.kill('SIGTERM')
    }
    if (options.signal) {
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }

    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })

    const finalize = (result: LocalHarnessResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      resolve(result)
    }

    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      options.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })

    child.on('close', (code, signal) => {
      finalize({
        exitCode: code,
        stdout,
        stderr,
        killedBySignal: signal,
        durationMs: Date.now() - startedAt,
        timedOut,
      })
    })
  })
}
