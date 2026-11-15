import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'
import { contentAddress } from '../../src/durable/content-address'
import { appendCommittedJsonLine } from '../../src/durable/jsonl-file'
import { acquireRunDirectoryLock, RUN_DIRECTORY_LOCK_FILE } from '../../src/durable/run-lock'
import { FileResultBlobStore } from '../../src/durable/spawn-journal/result-blob-store'

const children = new Set<ChildProcess>()
const directories: string[] = []

afterEach(async () => {
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  children.clear()
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** Another process takes the run's mutation lock, reports it, and holds it `holdMs`: a slow disk. */
function holdMutationLock(lockFile: string, holdMs: number): Promise<ChildProcess> {
  const source = `
    import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
    const taken = tryAcquireAtomicFileLock({ lockPath: ${JSON.stringify(`${lockFile}.mutation`)} })
    if (!taken.acquired) { console.log('refused'); process.exit(1) }
    console.log('held')
    setTimeout(() => { taken.lock.release(); console.log('released') }, ${holdMs})
  `
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  children.add(child)
  return new Promise((resolve, reject) => {
    child.stdout!.on('data', (chunk) => {
      if (String(chunk).includes('held')) resolve(child)
      if (String(chunk).includes('refused')) reject(new Error('the holder could not take the lock'))
    })
    child.once('exit', (code) => code !== 0 && reject(new Error(`holder exited ${code}`)))
  })
}

it('claimed writes wait on a held run lock without blocking the event loop, in the order issued', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'durable-writer-'))
  directories.push(dir)
  const lock = await acquireRunDirectoryLock(dir, 'off-loop')
  try {
    const blobs = new FileResultBlobStore(join(dir, 'blobs'))
    const journal = join(dir, 'journal.jsonl')
    const artifacts = Array.from({ length: 4 }, (_, index) => ({
      index,
      text: 'x'.repeat(64 * 1024),
    }))
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE), 3_000)
    // A 5 ms heartbeat: the largest gap between beats is the longest time this loop was blocked.
    let last = performance.now()
    let worstGapMs = 0
    const beat = setInterval(() => {
      const now = performance.now()
      worstGapMs = Math.max(worstGapMs, now - last)
      last = now
    }, 5)
    await delay(50)
    const began = performance.now()
    // Issued without awaiting each: blob, journal line naming it, next blob, next line, ...
    const writes = lock.run(() =>
      artifacts.flatMap((artifact) => {
        const ref = contentAddress(artifact)
        return [
          blobs.put(ref, artifact),
          appendCommittedJsonLine(journal, { index: artifact.index, ref }),
        ]
      }),
    )
    await Promise.all(writes)
    const waitedMs = performance.now() - began
    worstGapMs = Math.max(worstGapMs, performance.now() - last)
    clearInterval(beat)
    holder.kill('SIGKILL')

    // The writes waited for the other process's lock (about 3 s) while this loop kept running.
    expect(waitedMs).toBeGreaterThan(2_500)
    expect(worstGapMs).toBeLessThan(100)
    const lines = (await readFile(journal, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(lines.map((line) => line.index)).toEqual([0, 1, 2, 3])
    for (const line of lines) expect(await blobs.get(line.ref)).toEqual(artifacts[line.index])
  } finally {
    await lock.release()
  }
}, 30_000)
