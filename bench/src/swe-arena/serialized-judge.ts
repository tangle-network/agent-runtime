/**
 * Serialized official judge — the typed port of the experiment's `judge.sh`,
 * wrapping `adapter.judge` (via the tracked judge-child.mts) with the three
 * protections the bash experiment had to learn the hard way:
 *
 *  1. ONE JUDGE AT A TIME. The stale-container pre-clean does `docker rm -f`
 *     by instance short-name; two overlapping judges of the same instance nuke
 *     each other's container mid-run and each records a spurious
 *     `resolved:false` (proven false-negative on psf__requests-1766). The lock
 *     here is two-layer: an in-process promise chain plus a cross-process pid
 *     lock file (the flock equivalent), so the pre-clean can only ever remove
 *     a genuinely stale container — never a live grade.
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

import { readFile, unlink, writeFile } from 'node:fs/promises'
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
  /** Test-only escape hatch for the 1800s floor. NEVER set on a real judge. */
  unsafeAllowShortTimeout?: boolean
  /** Cross-process lock file (flock equivalent). One per docker daemon. */
  lockFile?: string
  /** SWEBENCH_CACHE_LEVEL for the child. `instance` = we manage image rotation. */
  cacheLevel?: string
  /** Override the judge child invocation (tests inject fakes here). */
  command?: (iid: string, patchPath: string) => JudgeCommand
}

export const JUDGE_TIMEOUT_FLOOR_MS = 1_800_000

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
// Locking: in-process promise chain + cross-process pid file.
// ---------------------------------------------------------------------------

let inProcessChain: Promise<unknown> = Promise.resolve()

async function acquirePidLock(lockFile: string): Promise<() => Promise<void>> {
  for (;;) {
    try {
      await writeFile(lockFile, String(process.pid), { flag: 'wx' })
      return async () => {
        await unlink(lockFile).catch(() => {})
      }
    } catch {
      const holder = Number((await readFile(lockFile, 'utf8').catch(() => '')).trim())
      const alive =
        Number.isFinite(holder) &&
        holder > 0 &&
        (() => {
          try {
            process.kill(holder, 0)
            return true
          } catch {
            return false
          }
        })()
      if (!alive) {
        // Stale lock from a dead process — remove and retry immediately.
        await unlink(lockFile).catch(() => {})
        continue
      }
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

/**
 * Run `fn` holding BOTH locks. Exported so calibrate/parity paths can pin any
 * docker-touching critical section to the same mutex the judge uses.
 */
export function withJudgeLock<T>(lockFile: string, fn: () => Promise<T>): Promise<T> {
  const task = inProcessChain
    .catch(() => {}) // a failed predecessor must not poison the queue
    .then(async () => {
      const release = await acquirePidLock(lockFile)
      try {
        return await fn()
      } finally {
        await release()
      }
    })
  inProcessChain = task.catch(() => {})
  return task
}

// ---------------------------------------------------------------------------
// The judge itself.
// ---------------------------------------------------------------------------

export interface SerializedJudge {
  judge(iid: string, patchPath: string, tag?: string): Promise<JudgeVerdict>
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
  const cacheLevel = opts.cacheLevel ?? 'instance'
  const command = opts.command ?? defaultCommand

  async function preClean(iid: string): Promise<void> {
    try {
      const short = instanceShortName(iid)
      const ps = await run('docker', ['ps', '-aq', '--filter', `name=${short}`])
      const ids = ps.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
      if (ids.length > 0) await run('docker', ['rm', '-f', ...ids])
    } catch {
      // docker unavailable → nothing stale to clean; a real judge child will
      // fail loudly on its own (and fake test judges don't need docker at all).
    }
  }

  async function attempt(iid: string, patchPath: string): Promise<{ verdict?: Omit<JudgeVerdict, 'attempts'>; raw: string }> {
    // Pre-clean INSIDE the mutex: with judging serialized this can only ever
    // remove a stale container, never a live grade.
    await preClean(iid)
    const { bin, argv, cwd } = command(iid, patchPath)
    const res = await run(bin, argv, {
      cwd,
      timeoutMs,
      env: { ...process.env, SWEBENCH_CACHE_LEVEL: cacheLevel },
    })
    const raw = res.timedOut ? `timeout after ${timeoutMs}ms` : res.stdout || res.stderr
    return { verdict: parseJudgeResult(res.stdout), raw }
  }

  return {
    lockFile,
    async judge(iid, patchPath, _tag = 'x') {
      // Empty patch never reaches docker — same short-circuit as judge.sh.
      const patch = await readFile(patchPath, 'utf8').catch(() => '')
      if (patch.trim().length === 0) {
        return { iid, resolved: false, score: 0, note: 'empty-patch', attempts: 0 }
      }
      return withJudgeLock(lockFile, async () => {
        const first = await attempt(iid, patchPath)
        if (first.verdict) return { ...first.verdict, attempts: 1 }
        const second = await attempt(iid, patchPath)
        if (second.verdict) return { ...second.verdict, attempts: 2 }
        return {
          iid,
          resolved: null,
          error: 'parse-or-timeout',
          raw: second.raw.slice(0, 200),
          attempts: 2,
        }
      })
    },
  }
}
