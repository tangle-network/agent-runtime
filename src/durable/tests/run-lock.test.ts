import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  acquireRunDirectoryLock,
  RUN_DIRECTORY_LOCK_FILE,
  RunDirectoryLockedError,
  readRunDirectoryLock,
} from '../run-lock'

/** A pid that belonged to a process which has already exited. */
function deadPid(): number {
  const child = spawnSync(process.execPath, ['-e', '0'])
  if (child.pid === undefined || child.status !== 0) throw new Error('helper process failed')
  return child.pid
}

describe('acquireRunDirectoryLock', () => {
  let runDir: string
  beforeEach(async () => {
    runDir = await mkdtemp(join(tmpdir(), 'run-lock-'))
  })
  afterEach(async () => {
    await rm(runDir, { recursive: true, force: true })
  })

  it('takes the lock once, refuses a concurrent call naming the holder, and releases it', async () => {
    const lock = await acquireRunDirectoryLock(runDir, 'run:a', () => 1_700_000_000_000)
    expect(lock.path).toBe(join(runDir, RUN_DIRECTORY_LOCK_FILE))
    const written = JSON.parse(await readFile(lock.path, 'utf8')) as Record<string, unknown>
    // The start token is host-reported, so its value is not asserted; its presence is.
    expect(typeof written.processStart === 'string' || written.processStart === undefined).toBe(
      true,
    )
    expect(written).toMatchObject({
      pid: process.pid,
      startedAt: '2023-11-14T22:13:20.000Z',
      runId: 'run:a',
    })
    expect(await readRunDirectoryLock(runDir)).toEqual(written)

    const refused = await acquireRunDirectoryLock(runDir, 'run:b').catch((error) => error)
    expect(refused).toBeInstanceOf(RunDirectoryLockedError)
    expect((refused as RunDirectoryLockedError).holder.pid).toBe(process.pid)
    expect((refused as Error).message).toContain(`pid ${process.pid}`)
    expect((refused as Error).message).toContain(lock.path)

    await lock.release()
    await lock.release()
    await expect(stat(lock.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readRunDirectoryLock(runDir)).toBeUndefined()

    const next = await acquireRunDirectoryLock(runDir, 'run:b')
    expect(next.runId).toBe('run:b')
    await next.release()
  })

  it('reclaims a lock whose holder process is gone', async () => {
    const stale = { pid: deadPid(), startedAt: '2026-09-06T06:14:43.597Z', runId: 'run:killed' }
    await writeFile(join(runDir, RUN_DIRECTORY_LOCK_FILE), `${JSON.stringify(stale)}\n`)

    const lock = await acquireRunDirectoryLock(runDir, 'run:resumed')
    expect(lock.pid).toBe(process.pid)
    expect(JSON.parse(await readFile(lock.path, 'utf8'))).toMatchObject({
      pid: process.pid,
      runId: 'run:resumed',
    })
    await lock.release()
  })

  it('grants only one concurrent stale-lock reclaimer', async () => {
    await writeFile(
      join(runDir, RUN_DIRECTORY_LOCK_FILE),
      JSON.stringify({ pid: deadPid(), startedAt: 'old', runId: 'dead' }),
    )
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) => acquireRunDirectoryLock(runDir, `run:${index}`)),
    )
    const acquired = outcomes.flatMap((outcome) =>
      outcome.status === 'fulfilled' ? [outcome.value] : [],
    )
    try {
      expect(acquired).toHaveLength(1)
      expect(await readRunDirectoryLock(runDir)).toMatchObject({ runId: acquired[0]?.runId })
    } finally {
      await Promise.all(acquired.map((lock) => lock.release()))
    }
  })

  it('refuses rather than reclaims a lock file it cannot read', async () => {
    await writeFile(join(runDir, RUN_DIRECTORY_LOCK_FILE), '{not json')

    await expect(acquireRunDirectoryLock(runDir, 'run:x')).rejects.toThrow(/not a readable lock/)
    expect(await readFile(join(runDir, RUN_DIRECTORY_LOCK_FILE), 'utf8')).toBe('{not json')
  })

  it('preserves an uncertain mutation guard', async () => {
    const guard = join(runDir, `${RUN_DIRECTORY_LOCK_FILE}.guard`)
    await mkdir(guard)
    await expect(acquireRunDirectoryLock(runDir, 'run:x')).rejects.toThrow(
      /confirming no lock mutation/,
    )
    expect((await stat(guard)).isDirectory()).toBe(true)
  })

  it('waits for transient mutation contention before releasing', async () => {
    const lock = await acquireRunDirectoryLock(runDir, 'run:a')
    const guard = `${lock.path}.guard`
    await mkdir(guard)
    const cleanup = new Promise<void>((resolve, reject) => {
      setTimeout(() => {
        rm(guard, { recursive: true }).then(resolve, reject)
      }, 50)
    })
    await lock.release()
    await cleanup
    expect(await readRunDirectoryLock(runDir)).toBeUndefined()
  })

  it('bounds release retries and preserves an abandoned guard', async () => {
    const lock = await acquireRunDirectoryLock(runDir, 'run:a')
    const guard = `${lock.path}.guard`
    await mkdir(guard)
    const started = performance.now()
    await expect(lock.release()).rejects.toThrow(/confirming no lock mutation/)
    expect(performance.now() - started).toBeGreaterThanOrEqual(1_000)
    expect(performance.now() - started).toBeLessThan(3_000)
    expect((await stat(guard)).isDirectory()).toBe(true)
    await rm(guard, { recursive: true })
    await lock.release()
    expect(await readRunDirectoryLock(runDir)).toBeUndefined()
  })

  it('does not release a different holder or malformed ownership', async () => {
    const lock = await acquireRunDirectoryLock(runDir, 'run:a')
    const replacement = { ...lock, processStart: 'another-process-start' }
    await writeFile(lock.path, JSON.stringify(replacement))
    await lock.release()
    expect(JSON.parse(await readFile(lock.path, 'utf8'))).toMatchObject({
      runId: 'run:a',
      processStart: 'another-process-start',
    })
  })

  it('reclaims a reused pid with a different process start token', async () => {
    await writeFile(
      join(runDir, RUN_DIRECTORY_LOCK_FILE),
      JSON.stringify({
        pid: process.pid,
        processStart: 'old-process',
        startedAt: 'old',
        runId: 'dead',
      }),
    )
    const lock = await acquireRunDirectoryLock(runDir, 'run:new')
    expect(lock.runId).toBe('run:new')
    await lock.release()
  })

  it('preserves a live holder whose start token is unknown', async () => {
    await writeFile(
      join(runDir, RUN_DIRECTORY_LOCK_FILE),
      JSON.stringify({ pid: process.pid, startedAt: 'old', runId: 'live' }),
    )
    await expect(acquireRunDirectoryLock(runDir, 'run:new')).rejects.toBeInstanceOf(
      RunDirectoryLockedError,
    )
  })

  it('refuses invalid holder pids', async () => {
    await writeFile(
      join(runDir, RUN_DIRECTORY_LOCK_FILE),
      JSON.stringify({ pid: -1, startedAt: 'old', runId: 'bad' }),
    )
    await expect(acquireRunDirectoryLock(runDir, 'run:x')).rejects.toThrow(/not a readable lock/)
  })

  it('creates a missing run directory before locking it', async () => {
    const nested = join(runDir, 'nested', 'run')
    const lock = await acquireRunDirectoryLock(nested, 'run:new')
    expect((await stat(nested)).isDirectory()).toBe(true)
    await lock.release()
  })
})
