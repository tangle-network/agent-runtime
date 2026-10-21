import { type ChildProcess, spawn } from 'node:child_process'
import { processGroupExists, terminateProcessTreeAndConfirm } from '../runtime/process-tree'
import { createCodexExecutionDiagnosticError, redactCodexHome } from './codex-diagnostics'
import {
  assertCodexReproducibleInvocation,
  type CodexExecutionEvidence,
  collectCodexExecutionEvidence,
} from './codex-execution-evidence'
import { isolateCodexHome } from './codex-home-isolation'
import { isSupportedCodexPlatform, resolveCodexNativeExecutable } from './codex-native-executable'
import { type CodexTokenUsage, parseCodexTokenUsage } from './codex-token-usage'
import {
  buildHarnessArgs,
  HARNESS_INVOCATIONS,
  type LocalHarness,
} from './local-harness-invocation'

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
  /** Allow autonomous edits without an interactive approval gate, using whichever bypass argv the
   *  harness declares. Use only when `cwd` is an isolated candidate worktree. */
  dangerouslySkipPermissions?: boolean
  /** Isolate Codex from ambient configuration/instructions and require JSONL token usage.
   *  The invocation should come from `harnessInvocation(..., { codexReproducible: true })`. */
  codexReproducible?: boolean
  /** Absolute host paths that reproducible Codex must not read. The normalized set is compiled
   *  into the controlled permission profile and its digest is returned in execution evidence. */
  codexReadDeniedPaths?: ReadonlyArray<string>
  /** Optional wall-clock kill deadline (ms). Omit it for no timer. A positive value sends
   *  SIGTERM on expiry. */
  timeoutMs?: number
  /** Newest stdout/stderr bytes retained per stream. Default 64 MiB. */
  maxOutputBytes?: number
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
      detached: boolean
    },
  ) => ChildProcess
  /** Test seam for locating the native Codex executable before it is staged in the worktree. */
  resolveCodexExecutable?: (command: string, env: NodeJS.ProcessEnv) => Promise<string>
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
  /**
   * Set when the caller's AbortSignal fired before this result settled.
   * Optional so injected runners and stored results from older releases remain valid.
   */
  aborted?: boolean
  /** Present for a reproducible Codex run; parsed from the real terminal JSONL event. */
  usage?: CodexTokenUsage
  /** Present for reproducible Codex runs; generated and checked before model execution. */
  evidence?: CodexExecutionEvidence
}

const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024

class RollingByteCapture {
  private readonly chunks: Buffer[] = []
  private bytes = 0

  constructor(private readonly maxBytes: number) {}

  append(chunk: unknown): void {
    if (this.maxBytes === 0) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    this.chunks.push(buffer)
    this.bytes += buffer.length
    let excess = this.bytes - this.maxBytes
    while (excess > 0 && this.chunks.length > 0) {
      const first = this.chunks[0]!
      if (first.length <= excess) {
        this.chunks.shift()
        this.bytes -= first.length
        excess -= first.length
      } else {
        this.chunks[0] = first.subarray(excess)
        this.bytes -= excess
        excess = 0
      }
    }
  }

  text(): string {
    return Buffer.concat(this.chunks, this.bytes).toString('utf8')
  }
}

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
 *   - the caller signal was already aborted before process launch
 *
 * Does NOT throw when:
 *   - the subprocess exits non-zero (`result.exitCode` carries the code)
 *   - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
 *     `result.timedOut` carries the reason even when a TERM-aware child exits zero)
 *
 * Reproducible Codex additionally requires a terminal usage event. If cancellation
 * prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
 * returning an incomplete reproducibility receipt.
 *
 * @experimental
 */
export async function runLocalHarness(
  options: RunLocalHarnessOptions,
): Promise<LocalHarnessResult> {
  const { harness, cwd, taskPrompt } = options
  // KEPT harness-name test: `codexReproducible` is a codex-SPECIFIC public option (its arg set,
  // its permission profile, its JSONL usage event), so this guard asserts caller self-consistency
  // and throws loudly rather than varying behavior by name. When a second harness gains a
  // reproducible mode, rename the option and make the arg set a row on `HARNESS_INVOCATIONS`.
  if (options.codexReproducible && harness !== 'codex') {
    throw new Error('runLocalHarness: codexReproducible requires the Codex harness')
  }
  if (options.codexReproducible && !isSupportedCodexPlatform()) {
    throw new Error(
      `runLocalHarness: codexReproducible does not support ${process.platform}/${process.arch};` +
        ' supported: linux and darwin on x64 or arm64',
    )
  }
  if (options.codexReadDeniedPaths !== undefined && !options.codexReproducible) {
    throw new Error('runLocalHarness: codexReadDeniedPaths requires codexReproducible')
  }
  const timeoutMs = options.timeoutMs
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 0) {
    throw new Error('runLocalHarness: maxOutputBytes must be a non-negative safe integer')
  }
  const spawnImpl = options.spawn ?? spawn

  const invocation = HARNESS_INVOCATIONS[harness]
  if (!invocation) {
    throw new Error(`runLocalHarness: unknown harness ${String(harness)}`)
  }

  const startedAt = Date.now()
  const requestedCommand = options.invocation?.command ?? invocation.command
  const args = options.invocation
    ? [...options.invocation.args]
    : buildHarnessArgs(harness, taskPrompt, options)
  if (options.codexReproducible) assertCodexReproducibleInvocation(requestedCommand, args)
  options.signal?.throwIfAborted()

  // We spawn the harness with `cwd`, but a harness that resolves its working
  // directory from `$PWD` rather than `getcwd()` (opencode does; the others may)
  // inherits the parent's stale `PWD` and edits the WRONG directory — its
  // worktree diff then comes back empty and the delegation fails with a phantom
  // "empty patch". Pin `PWD` to `cwd` so the harness edits where it was placed.
  // `baseEnv` feeds both the codex-isolated and the plain spawn paths below, so
  // pinning it here covers every runLocalHarness consumer.
  const baseEnv: NodeJS.ProcessEnv = { ...(options.env ?? process.env), PWD: cwd }
  const isolated = options.codexReproducible
    ? await isolateCodexHome({
        baseEnv,
        cwd,
        command: requestedCommand,
        readDeniedPaths: options.codexReadDeniedPaths ?? [],
        resolveExecutable: options.resolveCodexExecutable ?? resolveCodexNativeExecutable,
      })
    : {
        env: baseEnv,
        command: requestedCommand,
        cleanup: async () => undefined,
        controlledConfigSha256: '',
        executableSha256: '',
        readDeniedPathsSha256: '',
        readDeniedPathCount: 0,
        readDeniedPaths: [] as string[],
        diagnosticRedactionValues: [] as string[],
        ambientAuth: '',
        isolatedAuth: '',
        writeProbe: '',
        stagedWriteProbe: '',
        deniedProbePaths: [] as string[],
      }
  const env = isolated.env
  const command = isolated.command
  if (options.codexReproducible) assertCodexReproducibleInvocation(command, args)

  try {
    const evidence = options.codexReproducible
      ? await collectCodexExecutionEvidence({
          command,
          args,
          cwd,
          env,
          spawn: spawnImpl,
          controlledConfigSha256: isolated.controlledConfigSha256,
          executableSha256: isolated.executableSha256,
          readDeniedPathsSha256: isolated.readDeniedPathsSha256,
          readDeniedPathCount: isolated.readDeniedPathCount,
          readDeniedPaths: isolated.readDeniedPaths,
          ambientAuth: isolated.ambientAuth,
          isolatedAuth: isolated.isolatedAuth,
          writeProbe: isolated.writeProbe,
          stagedWriteProbe: isolated.stagedWriteProbe,
          deniedProbePaths: isolated.deniedProbePaths,
          ...(options.signal ? { signal: options.signal } : {}),
        })
      : undefined
    return await new Promise<LocalHarnessResult>((resolve, reject) => {
      let child: ChildProcess
      try {
        options.signal?.throwIfAborted()
        child = spawnImpl(command, args, {
          cwd,
          env,
          stdio: 'pipe',
          detached: process.platform !== 'win32',
        })
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

      const stdoutCapture = new RollingByteCapture(maxOutputBytes)
      const stderrCapture = new RollingByteCapture(maxOutputBytes)
      let timedOut = false
      let aborted = false
      let settled = false
      let leaderClosed = false
      let timer: ReturnType<typeof setTimeout> | null = null
      let termination: Promise<void> | null = null

      const clearLifecycle = () => {
        if (timer) clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
      }
      const rejectOnce = (err: unknown) => {
        if (settled) return
        settled = true
        clearLifecycle()
        reject(err instanceof Error ? err : new Error(String(err)))
      }
      const terminate = (): Promise<void> => {
        if (!termination) {
          termination = terminateProcessTreeAndConfirm(child, () => leaderClosed)
          void termination.catch(rejectOnce)
        }
        return termination
      }

      timer =
        timeoutMs !== undefined && timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true
              void terminate()
            }, timeoutMs)
          : null
      if (timer && typeof (timer as { unref?: () => void }).unref === 'function') {
        ;(timer as { unref: () => void }).unref()
      }

      const onAbort = () => {
        aborted = true
        void terminate()
      }
      if (options.signal) {
        if (options.signal.aborted) onAbort()
        else options.signal.addEventListener('abort', onAbort, { once: true })
      }

      child.stdout?.on('data', (chunk) => {
        stdoutCapture.append(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        stderrCapture.append(chunk)
      })

      const finalize = (result: LocalHarnessResult) => {
        if (settled) return
        settled = true
        clearLifecycle()
        resolve(result)
      }

      child.on('error', (err) => {
        leaderClosed = true
        if (timer) clearTimeout(timer)
        void (async () => {
          try {
            if (termination) await termination
            rejectOnce(err)
          } catch (terminationError) {
            rejectOnce(terminationError)
          }
        })()
      })

      child.on('close', (code, signal) => {
        leaderClosed = true
        if (timer) clearTimeout(timer)
        void (async () => {
          const stdout = stdoutCapture.text()
          const stderr = stderrCapture.text()
          try {
            if (
              !termination &&
              process.platform !== 'win32' &&
              typeof child.pid === 'number' &&
              processGroupExists(child.pid)
            ) {
              await terminate()
            }
            if (termination) await termination
            const durationMs = Date.now() - startedAt
            const usage = options.codexReproducible ? parseCodexTokenUsage(stdout) : undefined
            finalize({
              exitCode: code,
              stdout,
              stderr: redactCodexHome(stderr, env.CODEX_HOME),
              killedBySignal: signal,
              durationMs,
              timedOut,
              aborted,
              ...(usage ? { usage } : {}),
              ...(evidence ? { evidence } : {}),
            })
          } catch (err) {
            if (settled) return
            settled = true
            clearLifecycle()
            const durationMs = Date.now() - startedAt
            const reason = err instanceof Error ? err.message : String(err)
            reject(
              options.codexReproducible
                ? createCodexExecutionDiagnosticError({
                    reason,
                    exitCode: code,
                    killedBySignal: signal,
                    timedOut,
                    aborted,
                    durationMs,
                    stdout,
                    stderr,
                    codexHome: env.CODEX_HOME,
                    redactionValues: isolated.diagnosticRedactionValues,
                    cause: err,
                  })
                : err instanceof Error
                  ? err
                  : new Error(reason),
            )
          }
        })()
      })
    })
  } finally {
    await isolated.cleanup()
  }
}
