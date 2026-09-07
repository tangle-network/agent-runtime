import { execFile } from 'node:child_process'
import { mkdir, readFile, rmdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { publishExclusiveDurableFile } from '../runtime/supervise/durable-file'
import { isNoEntError } from './jsonl-file'

/*
 * Exclusive ownership of one durable run directory for the life of one `supervisePursuit` call.
 *
 * Measured motive (discovery-lab recursive smoke r1, 2026-09-06): the recovery protocol is
 * `SIGKILL` the runner while a child is live, then resume on the same directory. PID 1527 was
 * killed at 06:20:27Z and PID 2058 resumed at 06:24:59Z. Nothing refused a second process while
 * the first was still alive; two processes on one directory both append to `spawn-journal.jsonl`
 * and `observer.jsonl`, and the recorded assignment keys and settlements stop being one sequence.
 * The operator relied on timing. This lock makes the second process refuse and name the holder.
 *
 * The holder is identified by its pid and the OS's start token for that pid. r1 ran in a
 * container whose pids are small (1527, 2058) and restart from 1, so a pid alone names the wrong
 * process after enough spawns: a lock left by a killed run would then match an unrelated live
 * process and hold the directory until an operator removed the file. The start token (Linux
 * `/proc/<pid>/stat` starttime, otherwise `ps` lstart) is the same for a process's whole life
 * and differs for every later holder of its pid, so a reused pid is reclaimed like a dead one.
 *
 * The lock is operational state, not evidence: replay, projection, and the settle record ignore
 * it. A holder whose process is gone is reclaimed, except when it dies during a guarded mutation; that guard requires manual recovery.
 */

/** The lock file `supervisePursuit` holds inside a run directory for the life of one call. */
export const RUN_DIRECTORY_LOCK_FILE = 'supervise.lock'

/** What the lock file records about its holder. */
export interface RunDirectoryLockHolder {
  readonly pid: number
  /** ISO instant the holder took the lock. */
  readonly startedAt: string
  readonly runId: string
  /**
   * The OS's start token for `pid` when the host reports one (`readProcessStart`). A holder
   * without one is judged by pid liveness alone, which cannot detect a reused pid.
   */
  readonly processStart?: string
}

/** A held lock. `release()` removes the file; it is safe to call more than once. */
export interface RunDirectoryLock extends RunDirectoryLockHolder {
  readonly path: string
  release(): Promise<void>
}

/** The directory is held by a live process. `holder` is what that process recorded. */
export class RunDirectoryLockedError extends Error {
  readonly path: string
  readonly holder: RunDirectoryLockHolder

  constructor(path: string, holder: RunDirectoryLockHolder) {
    super(
      `supervisePursuit: ${path} is held by pid ${holder.pid} (run '${holder.runId}', since ${holder.startedAt}); one process drives a run directory at a time`,
    )
    this.name = 'RunDirectoryLockedError'
    this.path = path
    this.holder = holder
  }
}

/**
 * Take `runDir/supervise.lock`, or refuse.
 *
 * The file is published with its full content or not at all, so a contender never reads a
 * half-written holder. A lock whose holder is gone (its pid no longer exists, or the pid now
 * belongs to a process with a different start token) is stale and is removed under the mutation guard;
 * a pid this process may not signal (`EPERM`) is alive and refuses. An empty file names no
 * holder and is reclaimed. A file with unreadable content is left in place and refused:
 * reclaiming it could evict a live holder written by something other than this module.
 */
export async function acquireRunDirectoryLock(
  runDir: string,
  runId: string,
  now: () => number = Date.now,
): Promise<RunDirectoryLock> {
  const dir = resolve(runDir)
  const path = resolve(dir, RUN_DIRECTORY_LOCK_FILE)
  await mkdir(dir, { recursive: true })
  const processStart = await readProcessStart(process.pid)
  const holder: RunDirectoryLockHolder = Object.freeze({
    pid: process.pid,
    startedAt: new Date(now()).toISOString(),
    runId,
    ...(processStart === undefined ? {} : { processStart }),
  })
  return withMutationGuard(path, async () => {
    const existing = await readLockFile(path)
    if (existing.state === 'holder' && (await holderIsLive(existing.holder))) {
      throw new RunDirectoryLockedError(path, existing.holder)
    }
    if (existing.state !== 'missing') await removeIfPresent(path)
    if (!publishExclusiveDurableFile(path, `${JSON.stringify(holder)}\n`)) {
      throw new Error(`supervisePursuit: could not take ${path}`)
    }
    let released = false
    return Object.freeze({
      ...holder,
      path,
      release: async () => {
        if (released) return
        await releaseHolder(path, holder)
        released = true
      },
    })
  })
}

/** Read the holder a lock file names, or `undefined` when no lock file names one. */
export async function readRunDirectoryLock(
  runDir: string,
): Promise<RunDirectoryLockHolder | undefined> {
  const existing = await readLockFile(resolve(runDir, RUN_DIRECTORY_LOCK_FILE))
  return existing.state === 'holder' ? existing.holder : undefined
}

const execFileAsync = promisify(execFile)

/**
 * The OS's start token for a live pid: on Linux the `starttime` field of `/proc/<pid>/stat`
 * (clock ticks since boot), elsewhere the `ps` `lstart` column. The same process reports the
 * same token for its whole life and a later holder of the pid reports a different one.
 * `undefined` when the host cannot report one: the pid is gone, there is no `/proc` and no
 * `ps`, or the platform is Windows.
 */
export async function readProcessStart(pid: number): Promise<string | undefined> {
  if (!Number.isInteger(pid) || pid <= 0 || process.platform === 'win32') return undefined
  if (process.platform === 'linux') {
    let stat: string
    try {
      stat = await readFile(`/proc/${pid}/stat`, 'utf8')
    } catch {
      return undefined
    }
    // The comm field is parenthesized and may hold spaces, so fields are counted after its close.
    const fields = stat
      .slice(stat.lastIndexOf(')') + 1)
      .trim()
      .split(/\s+/u)
    const startTime = fields[19]
    return startTime !== undefined && /^\d+$/u.test(startTime) ? startTime : undefined
  }
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'lstart=', '-p', String(pid)])
    const token = stdout.trim()
    return token.length === 0 ? undefined : token
  } catch {
    return undefined
  }
}

type LockFileState =
  | { readonly state: 'missing' }
  | { readonly state: 'empty' }
  | { readonly state: 'holder'; readonly holder: RunDirectoryLockHolder }

async function readLockFile(path: string): Promise<LockFileState> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return { state: 'missing' }
    throw error
  }
  // This module publishes the file with its full content or not at all, so an empty file was
  // not left by a live holder.
  if (text.trim().length === 0) return { state: 'empty' }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`, {
      cause,
    })
  }
  const record = parsed as Partial<RunDirectoryLockHolder> | null
  if (
    typeof record !== 'object' ||
    record === null ||
    typeof record.pid !== 'number' ||
    !Number.isInteger(record.pid) ||
    record.pid <= 0 ||
    typeof record.startedAt !== 'string' ||
    typeof record.runId !== 'string' ||
    (record.processStart !== undefined && typeof record.processStart !== 'string')
  ) {
    throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`)
  }
  const { pid, startedAt, runId, processStart } = record
  return {
    state: 'holder',
    holder: Object.freeze({
      pid,
      startedAt,
      runId,
      ...(processStart === undefined ? {} : { processStart }),
    }),
  }
}

async function holderIsLive(holder: RunDirectoryLockHolder): Promise<boolean> {
  if (!processExists(holder.pid)) return false
  if (holder.processStart === undefined) return true
  const current = await readProcessStart(holder.pid)
  // A pid that exists but reports no token cannot be shown to be reused, so it stays live.
  return current === undefined || current === holder.processStart
}

function processExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user; only ESRCH means gone.
    return (error as { code?: unknown }).code !== 'ESRCH'
  }
}

/** Remove the lock only while it still names this holder; a reclaimed lock belongs to its new owner. */
async function releaseHolder(path: string, holder: RunDirectoryLockHolder): Promise<void> {
  await withMutationGuard(
    path,
    async () => {
      const existing = await readLockFile(path)
      if (existing.state !== 'holder') return
      if (
        existing.holder.pid !== holder.pid ||
        existing.holder.startedAt !== holder.startedAt ||
        existing.holder.runId !== holder.runId ||
        existing.holder.processStart !== holder.processStart
      )
        return
      await removeIfPresent(path)
    },
    true,
  )
}

/** Serialize stale reclamation and release; an abandoned guard requires operator recovery. */
async function withMutationGuard<T>(
  path: string,
  mutate: () => Promise<T>,
  waitForRelease = false,
): Promise<T> {
  const guard = `${path}.guard`
  const deadline = performance.now() + (waitForRelease ? 1_000 : 0)
  for (;;) {
    try {
      await mkdir(guard)
      break
    } catch (cause) {
      if (
        waitForRelease &&
        (cause as { code?: unknown }).code === 'EEXIST' &&
        performance.now() < deadline
      ) {
        await delay(10)
        continue
      }
      throw new Error(
        `supervisePursuit: cannot mutate ${path}; inspect ${guard} and remove it only after confirming no lock mutation is active`,
        { cause },
      )
    }
  }
  try {
    return await mutate()
  } finally {
    await rmdir(guard)
  }
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isNoEntError(error)) throw error
  }
}
