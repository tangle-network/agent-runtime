import { mkdir, open, rmdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  type LockHolderRecord,
  type LockIdentity,
  lockHolderVerdict,
  lockIdentity,
  parseLockHolderRecord,
  readLockHolderIdentity,
} from '@tangle-network/agent-eval/lock-holder'
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
 * process and hold the directory until an operator removed the file. Whether a holder is dead is
 * agent-eval's one dead-owner rule (`@tangle-network/agent-eval/lock-holder`): the record carries
 * the start token, host, boot id, pid namespace and the lock file's own inode identity, and a
 * holder is reclaimed only when those prove it gone or its pid reused. A record that cannot prove
 * that, such as one written before these fields existed, is refused and is removed by hand.
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
  /** The OS's start token for `pid` when the host reports one. A holder without one is never proved dead. */
  readonly processStart?: string
  /** Hostname of the holder. Records written before it existed are never proved dead. */
  readonly host?: string
  readonly bootId?: string
  readonly pidNamespace?: string
  /** Inode identity of the lock file this record was written into. */
  readonly lock?: LockIdentity
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
 * half-written holder. A lock whose holder is proved dead (its pid no longer exists, the pid now
 * belongs to a process with a different start token, or the host rebooted) is stale and is removed
 * under the mutation guard; a holder that is alive or cannot be proved dead refuses. An empty file
 * names no holder and is reclaimed. A file with unreadable content is left in place and refused:
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
  const { pid, ...identity } = readLockHolderIdentity(process.pid)
  const owner = { pid, startedAt: new Date(now()).toISOString(), runId, ...identity }
  return withMutationGuard(path, async () => {
    const existing = await readLockFile(path)
    if (existing.state === 'holder' && !holderIsDead(existing)) {
      throw new RunDirectoryLockedError(path, existing.holder)
    }
    if (existing.state !== 'missing') await removeIfPresent(path)
    const written: { holder?: RunDirectoryLockHolder } = {}
    // The lock file is a hard link of the temporary file, so the temporary file's inode identity
    // is the lock's, and a later verdict can prove this record was written for this very lock.
    const published = publishExclusiveDurableFile(path, (file) => {
      written.holder = Object.freeze({ ...owner, lock: lockIdentity(file) })
      return `${JSON.stringify(written.holder)}\n`
    })
    const holder = written.holder
    if (!published || holder === undefined) {
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

/** What {@link runDirectoryHolderIsLive} proved about a run directory's recorded holder. */
export interface RunDirectoryHolderLiveness {
  /** False only when the holder that took the lock is proved dead; a holder that cannot be proved dead reads as live. */
  readonly live: boolean
  /** The holder the lock file names. Absent when no lock file names one, which reads as not live. */
  readonly holder?: RunDirectoryLockHolder
}

/**
 * Whether a run directory is still held by the live process that took its lock.
 *
 * The same rule `acquireRunDirectoryLock` applies to decide whether a lock is stale, exposed so a
 * caller — a supervisor picking up an abandoned directory, an operator tool listing runs — asks
 * the question instead of hand-rolling `process.kill(pid, 0)`. A bare signal probe cannot tell a
 * live holder from an unrelated process that later took the same pid, which is the failure this
 * lock's start token exists to prevent.
 *
 * The answer is ADVISORY: it is read outside the mutation guard `acquireRunDirectoryLock` holds,
 * so a `false` can be stale by the time the caller acts on it and a concurrent acquire can take
 * the directory in between. Reporting and listing are what this is for. A caller that intends to
 * TAKE the directory calls `acquireRunDirectoryLock`, which evaluates the same rule under the
 * guard and refuses atomically.
 */
export async function runDirectoryHolderIsLive(
  runDir: string,
): Promise<RunDirectoryHolderLiveness> {
  const existing = await readLockFile(resolve(runDir, RUN_DIRECTORY_LOCK_FILE))
  if (existing.state !== 'holder') return { live: false }
  return { live: !holderIsDead(existing), holder: existing.holder }
}

type LockFileState =
  | { readonly state: 'missing' }
  | { readonly state: 'empty' }
  | {
      readonly state: 'holder'
      readonly holder: RunDirectoryLockHolder
      /** The holder as agent-eval's rule reads it; absent when the record names no host. */
      readonly record: LockHolderRecord | undefined
      /** Inode identity of the file the holder was read from. */
      readonly current: LockIdentity
    }

async function readLockFile(path: string): Promise<LockFileState> {
  let text: string
  let current: LockIdentity
  try {
    const file = await open(path, 'r')
    try {
      current = lockIdentity(await file.stat({ bigint: true }))
      text = await file.readFile('utf8')
    } finally {
      await file.close()
    }
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
  // A missing or malformed identity field is dropped, which leaves the holder never provably dead.
  const verdictRecord = parseLockHolderRecord(parsed)
  const { pid: _pid, ...identity } = verdictRecord ?? { pid }
  return {
    state: 'holder',
    holder: Object.freeze({
      pid,
      startedAt,
      runId,
      ...(processStart === undefined ? {} : { processStart }),
      ...identity,
    }),
    record: verdictRecord,
    current,
  }
}

/** agent-eval's dead-owner rule: only a holder proved dead is stale; alive or unknown stays held. */
function holderIsDead(existing: Extract<LockFileState, { state: 'holder' }>): boolean {
  return lockHolderVerdict(existing.record, existing.current).liveness === 'dead'
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
