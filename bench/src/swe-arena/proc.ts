/**
 * Process helpers shared by the swe-arena execution path (materialize /
 * calibrate / arms / serialized-judge). One place owns spawn semantics so
 * every port of a bash script gets identical rc/timeout behavior:
 *
 *  - `run` never throws on a nonzero exit — the bash scripts branched on `$?`,
 *    so callers get `{ code, stdout, stderr, timedOut }` and decide.
 *  - timeouts signal the whole process GROUP (detached spawn), because the
 *    arm commands are `dotenvx → bash -c → opencode/node` chains; killing only
 *    the leader would orphan the model call exactly like a dropped `timeout`.
 *    SIGTERM gets a short cleanup window before SIGKILL so children can cancel
 *    their own detached workers and flush terminal evidence.
 *  - `code` is 124 on timeout, mirroring coreutils `timeout` so ledger rc
 *    fields keep the bash experiment's encoding.
 */

import { spawn } from 'node:child_process'

export interface RunResult {
  code: number
  stdout: string
  stderr: string
  timedOut: boolean
  aborted: boolean
}

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** 0 / undefined = no timeout. On expiry the process group gets TERM then KILL. */
  timeoutMs?: number
  /** Grace between timeout SIGTERM and fallback SIGKILL. Default 1 second. */
  killGraceMs?: number
  /** Cancels the complete process group and waits until it is gone. */
  signal?: AbortSignal
  /** Cap captured stdout/stderr (bytes); beyond it output is dropped, not buffered. */
  maxBuffer?: number
  /** Piped to the child's stdin, then stdin is closed. */
  stdin?: string
}

const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024
const PROCESS_GROUP_EXIT_CONFIRM_MS = 1_000
const PROCESS_GROUP_EXIT_POLL_MS = 10

const exitKillGroups = new Set<number>()
const killRegisteredGroupsOnExit = (): void => {
  for (const processGroupId of exitKillGroups) {
    try {
      process.kill(process.platform === 'win32' ? processGroupId : -processGroupId, 'SIGKILL')
    } catch {
      // The group may have settled between its final async check and process exit.
    }
  }
}

function registerExitKill(processGroupId: number | undefined): () => void {
  if (processGroupId === undefined) return () => {}
  if (exitKillGroups.size === 0) process.once('exit', killRegisteredGroupsOnExit)
  exitKillGroups.add(processGroupId)
  return () => {
    exitKillGroups.delete(processGroupId)
    if (exitKillGroups.size === 0) process.removeListener('exit', killRegisteredGroupsOnExit)
  }
}

/** coreutils `timeout` exit code — kept so ledger rc columns stay comparable. */
export const TIMEOUT_RC = 124
export const ABORT_RC = 130

export interface ProcessSignalAbort {
  signal: AbortSignal
  /** First signal received; null until interrupted. */
  readonly receivedSignal: NodeJS.Signals | null
  /** Removes handlers after the caller has awaited cleanup. */
  dispose: () => void
}

/**
 * Translate terminal interrupts into cooperative cancellation. The handler
 * never exits immediately: callers await their normal cleanup in `finally`,
 * then dispose it. Repeated interrupts remain cooperative rather than
 * bypassing cleanup.
 */
export function installProcessSignalAbort(label: string): ProcessSignalAbort {
  const controller = new AbortController()
  let receivedSignal: NodeJS.Signals | null = null
  const onSignal = (signal: NodeJS.Signals): void => {
    if (receivedSignal !== null) return
    receivedSignal = signal
    process.exitCode = signal === 'SIGINT' ? 130 : 143
    controller.abort(new Error(`${label} interrupted by ${signal}`))
  }
  const onSigint = (): void => onSignal('SIGINT')
  const onSigterm = (): void => onSignal('SIGTERM')
  process.on('SIGINT', onSigint)
  process.on('SIGTERM', onSigterm)
  return {
    signal: controller.signal,
    get receivedSignal() {
      return receivedSignal
    },
    dispose: () => {
      process.removeListener('SIGINT', onSigint)
      process.removeListener('SIGTERM', onSigterm)
    },
  }
}

function processGroupExists(processGroupId: number): boolean {
  try {
    process.kill(-processGroupId, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

async function waitUntil(deadline: number, predicate: () => boolean): Promise<boolean> {
  while (predicate()) {
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, PROCESS_GROUP_EXIT_POLL_MS))
  }
  return true
}

export function run(bin: string, argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  opts.signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const child = spawn(bin, argv, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const unregisterExitKill = registerExitKill(child.pid)
    const cap = opts.maxBuffer ?? DEFAULT_MAX_BUFFER
    let stdout = ''
    let stderr = ''
    let outBytes = 0
    let errBytes = 0
    let timedOut = false
    let aborted = false
    let settled = false
    let timer: NodeJS.Timeout | undefined
    const signalGroup = (signal: NodeJS.Signals) => {
      try {
        process.kill(-child.pid!, signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          /* already dead */
        }
      }
    }
    let termination: Promise<void> | undefined
    const terminate = (): Promise<void> => {
      termination ??= (async () => {
        signalGroup('SIGTERM')
        if (process.platform === 'win32' || typeof child.pid !== 'number') return
        const processGroupId = child.pid
        const exitedOnTerm = await waitUntil(
          Date.now() + Math.max(0, opts.killGraceMs ?? 1_000),
          () => processGroupExists(processGroupId),
        )
        if (exitedOnTerm) return
        signalGroup('SIGKILL')
        const exitedOnKill = await waitUntil(
          Date.now() + PROCESS_GROUP_EXIT_CONFIRM_MS,
          () => processGroupExists(processGroupId),
        )
        if (!exitedOnKill) throw new Error(`process group ${processGroupId} survived SIGKILL`)
      })()
      // The close handler owns the rejection. Attaching this handler prevents
      // an early unhandled rejection while the direct child is still closing.
      void termination.catch(() => undefined)
      return termination
    }
    const onAbort = () => {
      aborted = true
      void terminate()
    }
    if (opts.timeoutMs && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true
        void terminate()
      }, opts.timeoutMs)
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    if (opts.signal?.aborted) onAbort()
    child.stdout.on('data', (c: Buffer) => {
      outBytes += c.length
      if (outBytes <= cap) stdout += c.toString('utf8')
    })
    child.stderr.on('data', (c: Buffer) => {
      errBytes += c.length
      if (errBytes <= cap) stderr += c.toString('utf8')
    })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      unregisterExitKill()
      reject(err)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      if (timer) clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      void (async () => {
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
          if (settled) return
          settled = true
          unregisterExitKill()
          resolve({
            code: timedOut ? TIMEOUT_RC : aborted ? ABORT_RC : (code ?? (signal ? 1 : 0)),
            stdout,
            stderr,
            timedOut,
            aborted,
          })
        } catch (err) {
          if (settled) return
          settled = true
          unregisterExitKill()
          reject(err)
        }
      })()
    })
    if (opts.stdin !== undefined) child.stdin.end(opts.stdin)
    else child.stdin.end()
  })
}

/** `run` that throws (with captured stderr) on nonzero exit — for steps the bash aborted on. */
export async function runOk(bin: string, argv: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await run(bin, argv, opts)
  opts.signal?.throwIfAborted()
  if (res.code !== 0) {
    const detail = (res.stderr || res.stdout).slice(0, 1500)
    throw new Error(`${bin} ${argv.join(' ')} exited ${res.code}${res.timedOut ? ' (timeout)' : ''}: ${detail}`)
  }
  return res
}

/** Single-quote shell escaping — identical to the quoting the bash scripts relied on. */
export function shq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/**
 * Provider/API-secret env families a hermetic test or judge subprocess must not
 * inherit. The verify/judge gate runs the repo's own tests under `dotenvx`, which
 * injects the operator's secrets (TANGLE_API_KEY, INTELLIGENCE_BASE, provider
 * keys) into the parent. A base test that asserts "throws without an api key"
 * then passes only because a key leaked in — so the gate decides on the injected
 * secret, not on the candidate's code, and becomes unpassable regardless of the
 * feature. Stripping these makes the gate depend on the workspace alone.
 *
 * Same principle as `proposerShotEnv` (which strips the CLIs' ambient auth so an
 * author shot runs on the CLI's own login) — here it is the verify/judge gate,
 * and the families are the inference secrets rather than the CLI auth vars.
 */
export const HERMETIC_SECRET_ENV_PREFIXES = [
  'ANTHROPIC_',
  'OPENAI_',
  'TANGLE_',
  'INTELLIGENCE_',
  'ZAI_',
  'Z_AI_',
  'OPENROUTER_',
  'GROQ_',
  'DEEPSEEK_',
  'MOONSHOT_',
  'XAI_',
  'GEMINI_',
] as const

/** Any var in these suffix families is a secret regardless of provider prefix. */
export const HERMETIC_SECRET_ENV_SUFFIXES = ['_API_KEY', '_AUTH_TOKEN'] as const

/** Exact names that carry secrets but match no prefix/suffix family. */
export const HERMETIC_SECRET_ENV_EXACT = ['INTELLIGENCE_BASE'] as const

/** True when an env var name carries an injected inference secret. Case-insensitive. */
export function isSecretEnvName(name: string): boolean {
  const upper = name.toUpperCase()
  if (HERMETIC_SECRET_ENV_EXACT.some((exact) => upper === exact)) return true
  if (HERMETIC_SECRET_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) return true
  if (HERMETIC_SECRET_ENV_SUFFIXES.some((suffix) => upper.endsWith(suffix))) return true
  return false
}

/**
 * A copy of `base` with every injected inference secret removed — the hermetic env
 * a verify/judge gate runs the repo's tests under. Non-secret vars (PATH, HOME,
 * pnpm store, CI heuristics) pass through untouched.
 */
export function stripAmbientSecretEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base }
  for (const name of Object.keys(env)) {
    if (isSecretEnvName(name)) delete env[name]
  }
  return env
}
