/**
 * Serialized official judge — the typed port of the experiment's `judge.sh`,
 * wrapping `adapter.judge` (via the tracked judge-child.mts) with the three
 * protections the bash experiment had to learn the hard way:
 *
 *  1. ONE JUDGE AT A TIME. The stale-container pre-clean does `docker rm -f`
 *     by instance short-name; two overlapping judges of the same instance nuke
 *     each other's container mid-run and each records a spurious
 *     `resolved:false` (proven false-negative on psf__requests-1766). The lock
 *     here is two-layer: an in-process promise chain plus a kernel-backed
 *     `flock`, so the pre-clean can only ever remove a genuinely stale
 *     container — never a live grade.
 *
 *  2. CEILING ≥ 1800s. The original 700s ceiling caused 3 spurious timeouts on
 *     psf__requests-2317 (a successful grade took 1181s). The floor is
 *     enforced, not advisory: a shorter ceiling for the REAL judge is a
 *     protocol violation and throws.
 *
 *  3. ONE RETRY on empty/unparseable judge output (single-run judge flake was
 *     observed live: byte-identical patches split-verdicted). A second failure
 *     returns `resolved: null` — inconclusive, never a fabricated verdict —
 *     matching the RejudgeRow semantics M1 pinned.
 */

import { spawn } from 'node:child_process'
import { open, readFile, type FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run } from './proc'

/** Verdict shape — field names match the experiment's JUDGE_RESULT/RejudgeRow rows. */
export interface JudgeVerdict {
  iid: string
  /** `null` = inconclusive (judge failed twice); never a guessed boolean. */
  resolved: boolean | null
  score?: number
  secs?: number
  patch_bytes?: number
  note?: string
  error?: string
  /** First 200 chars of the failing output, for post-mortem (mirrors rejudge rows). */
  raw?: string
  /** How many judge child runs it took (1 = clean, 2 = retried). */
  attempts?: number
}

export interface JudgeCommand {
  bin: string
  argv: string[]
  cwd: string
}

export interface SerializedJudgeOptions {
  /**
   * Hard ceiling per judge child. Default 1_800_000 ms; values below the floor
   * throw unless `unsafeAllowShortTimeout` (test hook) is set.
   */
  timeoutMs?: number
  /** Maximum time spent waiting to acquire both judge locks. */
  lockWaitTimeoutMs?: number
  /** Hard ceiling for each stale-container pre-clean command. */
  preCleanTimeoutMs?: number
  /** Test-only escape hatch for the 1800s floor. NEVER set on a real judge. */
  unsafeAllowShortTimeout?: boolean
  /** Cross-process kernel lock file. One per docker daemon. */
  lockFile?: string
  /** SWEBENCH_CACHE_LEVEL for the child. `instance` = we manage image rotation. */
  cacheLevel?: string
  /** Override the judge child invocation (tests inject fakes here). */
  command?: (iid: string, patchPath: string) => JudgeCommand
}

export const JUDGE_TIMEOUT_FLOOR_MS = 1_800_000
export const JUDGE_PRE_CLEAN_TIMEOUT_MS = 60_000
/** Process-group settlement and scheduler margin beyond all command ceilings. */
export const JUDGE_LOCK_SETTLEMENT_MARGIN_MS = 30_000
/** One live holder may use two attempts, each with docker ps + docker rm. */
export const JUDGE_LOCK_WAIT_TIMEOUT_MS =
  2 * (JUDGE_TIMEOUT_FLOOR_MS + 2 * JUDGE_PRE_CLEAN_TIMEOUT_MS) + JUDGE_LOCK_SETTLEMENT_MARGIN_MS

const benchRoot = fileURLToPath(new URL('../..', import.meta.url))
const judgeChild = fileURLToPath(new URL('./judge-child.mts', import.meta.url))

const defaultCommand = (iid: string, patchPath: string): JudgeCommand => ({
  bin: 'node',
  argv: ['--import', 'tsx', judgeChild, iid, patchPath],
  cwd: benchRoot,
})

/** judge.sh's `sed 's/.*__//'` — the docker container filter for pre-clean. */
export function instanceShortName(iid: string): string {
  return iid.replace(/.*__/, '')
}

// ---------------------------------------------------------------------------
// Locking: in-process promise chain + cross-process kernel flock.
// ---------------------------------------------------------------------------

let inProcessChain: Promise<unknown> = Promise.resolve()

export interface JudgeLockOptions {
  /** Maximum total wait across the in-process queue and kernel lock. */
  timeoutMs?: number
  signal?: AbortSignal
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason
  const error = new Error('serialized-judge: aborted while waiting for the judge lock')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal)
}

function lockTimeoutError(timeoutMs: number): Error {
  return new Error(`serialized-judge: lock wait exceeded ${timeoutMs}ms`)
}

function waitFor<T>(promise: Promise<T>, deadline: number, timeoutMs: number, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal)
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return Promise.reject(lockTimeoutError(timeoutMs))

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const onAbort = () => finish(() => reject(abortReason(signal!)))
    const timer = setTimeout(() => finish(() => reject(lockTimeoutError(timeoutMs))), remainingMs)
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    )
  })
}

/**
 * Ask util-linux `flock` to lock an fd inherited from this process. Linux
 * associates a flock with the open file description, so the lock remains held
 * by `handle` after the short helper exits and is released atomically on close.
 * There is no owner record to initialize, inspect, or unlink: process death and
 * fd close are the only stale-owner recovery path, both enforced by the kernel.
 */
function tryAcquireFlock(
  handle: FileHandle,
  deadline: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  throwIfAborted(signal)
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) return Promise.reject(lockTimeoutError(timeoutMs))

  return new Promise<boolean>((resolve, reject) => {
    const waitSeconds = Math.max(0.001, remainingMs / 1_000).toFixed(3)
    const child = spawn('flock', ['--exclusive', '--wait', waitSeconds, '3'], {
      stdio: ['ignore', 'ignore', 'pipe', handle.fd],
    })
    let stderr = ''
    let pendingError: Error | undefined
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      callback()
    }
    const stopWith = (error: Error) => {
      if (pendingError || settled) return
      pendingError = error
      child.kill('SIGKILL')
    }
    const onAbort = () => stopWith(abortReason(signal!))
    const timer = setTimeout(() => stopWith(lockTimeoutError(timeoutMs)), remainingMs)

    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < 2_000) stderr += chunk.toString('utf8')
    })
    child.on('error', (error) => finish(() => reject(pendingError ?? error)))
    child.on('close', (code, closeSignal) => {
      if (pendingError) {
        finish(() => reject(pendingError!))
        return
      }
      if (code === 0) {
        finish(() => resolve(true))
        return
      }
      // util-linux flock uses rc=1 when --wait expires without ownership.
      if (code === 1) {
        finish(() => resolve(false))
        return
      }
      const detail = stderr.trim()
      finish(() => reject(new Error(
        `serialized-judge: flock failed with ${closeSignal ?? `exit ${code ?? 'unknown'}`}${detail ? `: ${detail}` : ''}`,
      )))
    })
  })
}

async function acquireFlock(
  lockFile: string,
  deadline: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<() => Promise<void>> {
  for (;;) {
    throwIfAborted(signal)
    if (Date.now() >= deadline) throw lockTimeoutError(timeoutMs)
    const handle = await open(lockFile, 'a')
    try {
      if (await tryAcquireFlock(handle, deadline, timeoutMs, signal)) {
        let released = false
        return async () => {
          if (released) return
          released = true
          await handle.close()
        }
      }
    } catch (error) {
      await handle.close().catch(() => {})
      throw error
    }
    await handle.close()
    if (Date.now() >= deadline) throw lockTimeoutError(timeoutMs)
  }
}

/**
 * Run `fn` holding BOTH locks. Exported so calibrate/parity paths can pin any
 * docker-touching critical section to the same mutex the judge uses.
 */
export function withJudgeLock<T>(
  lockFile: string,
  fn: () => Promise<T>,
  opts: JudgeLockOptions = {},
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? JUDGE_LOCK_WAIT_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new Error('serialized-judge: lock timeoutMs must be a positive finite number'))
  }
  const deadline = Date.now() + timeoutMs
  const predecessor = inProcessChain.catch(() => {})
  const task = (async () => {
    // Cancellation stops this waiter, not the predecessor. A later waiter
    // still has to acquire the kernel lock, so the live holder is never bypassed.
    await waitFor(predecessor, deadline, timeoutMs, opts.signal)
    const release = await acquireFlock(lockFile, deadline, timeoutMs, opts.signal)
    try {
      throwIfAborted(opts.signal)
      return await fn()
    } finally {
      await release()
    }
  })()
  inProcessChain = task.catch(() => {})
  return task
}

// ---------------------------------------------------------------------------
// The judge itself.
// ---------------------------------------------------------------------------

export interface SerializedJudge {
  judge(iid: string, patchPath: string, tag?: string, signal?: AbortSignal): Promise<JudgeVerdict>
  readonly lockFile: string
}

function parseJudgeResult(stdout: string): Omit<JudgeVerdict, 'attempts'> | undefined {
  const line = stdout.split('\n').find((l) => l.includes('JUDGE_RESULT'))
  if (!line) return undefined
  try {
    const parsed = JSON.parse(line.slice(line.indexOf('JUDGE_RESULT') + 'JUDGE_RESULT'.length).trim())
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.resolved !== 'boolean') return undefined
    return parsed as Omit<JudgeVerdict, 'attempts'>
  } catch {
    return undefined
  }
}

export function createSerializedJudge(opts: SerializedJudgeOptions = {}): SerializedJudge {
  const timeoutMs = opts.timeoutMs ?? JUDGE_TIMEOUT_FLOOR_MS
  const usingRealJudge = opts.command === undefined
  if (timeoutMs < JUDGE_TIMEOUT_FLOOR_MS && (usingRealJudge || !opts.unsafeAllowShortTimeout)) {
    throw new Error(
      `serialized-judge: timeoutMs=${timeoutMs} is below the ${JUDGE_TIMEOUT_FLOOR_MS}ms floor ` +
        `(700s provably caused 3 spurious timeouts on psf__requests-2317)`,
    )
  }
  const lockFile = opts.lockFile ?? join(tmpdir(), 'swe-arena-judge.lock')
  const preCleanTimeoutMs = opts.preCleanTimeoutMs ?? JUDGE_PRE_CLEAN_TIMEOUT_MS
  const lockWaitTimeoutMs =
    opts.lockWaitTimeoutMs ??
    2 * (timeoutMs + 2 * preCleanTimeoutMs) + JUDGE_LOCK_SETTLEMENT_MARGIN_MS
  if (!Number.isFinite(lockWaitTimeoutMs) || lockWaitTimeoutMs <= 0) {
    throw new Error('serialized-judge: lockWaitTimeoutMs must be a positive finite number')
  }
  if (!Number.isFinite(preCleanTimeoutMs) || preCleanTimeoutMs <= 0) {
    throw new Error('serialized-judge: preCleanTimeoutMs must be a positive finite number')
  }
  const cacheLevel = opts.cacheLevel ?? 'instance'
  const command = opts.command ?? defaultCommand
  // A command override is a hermetic test hook and does not touch Docker.
  // Tests that exercise cleanup opt in by setting preCleanTimeoutMs.
  const shouldPreClean = usingRealJudge || opts.preCleanTimeoutMs !== undefined

  async function runDockerCleanup(argv: string[], signal?: AbortSignal): Promise<Awaited<ReturnType<typeof run>>> {
    let result: Awaited<ReturnType<typeof run>>
    try {
      result = await run('docker', argv, { timeoutMs: preCleanTimeoutMs, signal })
    } catch (error) {
      throw new Error(`serialized-judge: docker pre-clean could not start: ${(error as Error).message}`, {
        cause: error,
      })
    }
    throwIfAborted(signal)
    if (result.timedOut) {
      throw new Error(`serialized-judge: docker ${argv[0]} pre-clean timed out after ${preCleanTimeoutMs}ms`)
    }
    if (result.code !== 0) {
      const detail = (result.stderr || result.stdout).trim().slice(0, 1_500)
      throw new Error(
        `serialized-judge: docker ${argv[0]} pre-clean exited ${result.code}${detail ? `: ${detail}` : ''}`,
      )
    }
    return result
  }

  async function preClean(iid: string, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    const short = instanceShortName(iid)
    const ps = await runDockerCleanup(['ps', '-aq', '--filter', `name=${short}`], signal)
    throwIfAborted(signal)
    const ids = ps.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
    if (ids.length > 0) {
      await runDockerCleanup(['rm', '-f', ...ids], signal)
      throwIfAborted(signal)
    }
  }

  async function attempt(
    iid: string,
    patchPath: string,
    signal?: AbortSignal,
  ): Promise<{ verdict?: Omit<JudgeVerdict, 'attempts'>; raw: string }> {
    // Pre-clean INSIDE the mutex: with judging serialized this can only ever
    // remove a stale container, never a live grade.
    if (shouldPreClean) await preClean(iid, signal)
    throwIfAborted(signal)
    const { bin, argv, cwd } = command(iid, patchPath)
    const res = await run(bin, argv, {
      cwd,
      timeoutMs,
      signal,
      env: { ...process.env, SWEBENCH_CACHE_LEVEL: cacheLevel },
    })
    throwIfAborted(signal)
    const raw = res.timedOut
      ? `timeout after ${timeoutMs}ms`
      : res.code === 0
        ? res.stdout || res.stderr
        : `exit ${res.code}: ${res.stdout || res.stderr}`
    return {
      verdict: !res.timedOut && res.code === 0 ? parseJudgeResult(res.stdout) : undefined,
      raw,
    }
  }

  return {
    lockFile,
    async judge(iid, patchPath, _tag = 'x', signal) {
      throwIfAborted(signal)
      // Empty patch never reaches docker — same short-circuit as judge.sh.
      const patch = await readFile(patchPath, 'utf8')
      throwIfAborted(signal)
      if (patch.trim().length === 0) {
        return { iid, resolved: false, score: 0, note: 'empty-patch', attempts: 0 }
      }
      return withJudgeLock(
        lockFile,
        async () => {
          const first = await attempt(iid, patchPath, signal)
          if (first.verdict) return { ...first.verdict, attempts: 1 }
          throwIfAborted(signal)
          const second = await attempt(iid, patchPath, signal)
          if (second.verdict) return { ...second.verdict, attempts: 2 }
          return {
            iid,
            resolved: null,
            error: 'parse-or-timeout',
            raw: second.raw.slice(0, 200),
            attempts: 2,
          }
        },
        { timeoutMs: lockWaitTimeoutMs, signal },
      )
    },
  }
}
