import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
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
 * The lock is operational state, not evidence: replay, projection, and the settle record ignore
 * it. A holder whose process is gone is reclaimed, so a killed run never needs manual cleanup.
 */

/** The lock file `supervisePursuit` holds inside a run directory for the life of one call. */
export const RUN_DIRECTORY_LOCK_FILE = 'supervise.lock'

/** What the lock file records about its holder. */
export interface RunDirectoryLockHolder {
  readonly pid: number
  /** ISO instant the holder took the lock. */
  readonly startedAt: string
  readonly runId: string
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
 * Take `runDir/supervise.lock` with `O_EXCL`, or refuse.
 *
 * A lock whose recorded pid no longer exists (`ESRCH`) is stale and is removed before one retry;
 * a pid this process may not signal (`EPERM`) is alive and refuses. A lock this process cannot
 * read is left in place and refused: reclaiming an unreadable file could evict a live holder.
 */
export async function acquireRunDirectoryLock(
  runDir: string,
  runId: string,
  now: () => number = Date.now,
): Promise<RunDirectoryLock> {
  const dir = resolve(runDir)
  const path = resolve(dir, RUN_DIRECTORY_LOCK_FILE)
  await mkdir(dir, { recursive: true })
  const holder: RunDirectoryLockHolder = Object.freeze({
    pid: process.pid,
    startedAt: new Date(now()).toISOString(),
    runId,
  })
  // Two reclaimers can race after one removes a stale file: the loser's `O_EXCL` fails and it
  // reads the winner's live pid, so at most one retry is ever useful.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (await tryCreate(path, holder)) {
      let released = false
      return Object.freeze({
        ...holder,
        path,
        release: async () => {
          if (released) return
          released = true
          await removeIfPresent(path)
        },
      })
    }
    const existing = await readHolder(path)
    if (existing === undefined) continue
    if (processExists(existing.pid)) throw new RunDirectoryLockedError(path, existing)
    await removeIfPresent(path)
  }
  const existing = await readHolder(path)
  if (existing !== undefined) throw new RunDirectoryLockedError(path, existing)
  throw new Error(`supervisePursuit: could not take ${path} after reclaiming a stale holder`)
}

/** Read the holder a lock file names, or `undefined` when there is no lock file. */
export async function readRunDirectoryLock(
  runDir: string,
): Promise<RunDirectoryLockHolder | undefined> {
  return readHolder(resolve(runDir, RUN_DIRECTORY_LOCK_FILE))
}

async function tryCreate(path: string, holder: RunDirectoryLockHolder): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>>
  try {
    handle = await open(path, 'wx')
  } catch (error) {
    if (isAlreadyExists(error)) return false
    throw error
  }
  try {
    await handle.writeFile(`${JSON.stringify(holder)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  return true
}

async function readHolder(path: string): Promise<RunDirectoryLockHolder | undefined> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (isNoEntError(error)) return undefined
    throw error
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`, {
      cause,
    })
  }
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    typeof (parsed as { pid?: unknown }).pid !== 'number' ||
    typeof (parsed as { startedAt?: unknown }).startedAt !== 'string' ||
    typeof (parsed as { runId?: unknown }).runId !== 'string'
  ) {
    throw new Error(`supervisePursuit: ${path} is not a readable lock file; remove it by hand`)
  }
  const { pid, startedAt, runId } = parsed as RunDirectoryLockHolder
  return Object.freeze({ pid, startedAt, runId })
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

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch (error) {
    if (!isNoEntError(error)) throw error
  }
}

function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'EEXIST'
  )
}
