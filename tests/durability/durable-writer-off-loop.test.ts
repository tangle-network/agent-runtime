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
import { writeAtomicDurableFileAsync } from '../../src/runtime/supervise/durable-file'
import {
  applyRunCancellationAsync,
  cancelRun,
  cancelRunAsync,
  readRunCancellation,
  readRunCancelRequest,
  writeRunCancellationAsync,
} from '../../src/runtime/supervise/run-cancellation'
import {
  claimWorkerSteerDelivery,
  readWorkerSteerAcknowledgement,
  writeWorkerSteerAcknowledgement,
  writeWorkerSteerAsync,
} from '../../src/runtime/supervise/run-layout'
import {
  readWorkerInteractiveBinding,
  writeWorkerInteractiveBindingAsync,
} from '../../src/runtime/supervise/worker-interactive'

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

/** A 5 ms heartbeat: the largest gap between beats is the longest time this loop was blocked. */
function heartbeat(): () => number {
  let last = performance.now()
  let worst = 0
  const beat = setInterval(() => {
    const now = performance.now()
    worst = Math.max(worst, now - last)
    last = now
  }, 5)
  return () => {
    clearInterval(beat)
    return Math.max(worst, performance.now() - last)
  }
}

it('steer and binding writes wait on the durable writer without blocking the event loop, claimed or not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'durable-writer-steer-'))
  directories.push(dir)
  const lock = await acquireRunDirectoryLock(dir, 'steer-off-loop')
  try {
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE), 3_000)
    const worstGap = heartbeat()
    await delay(50)
    const began = performance.now()
    // This claimed write reaches the durable writer as it is called and waits there for the other
    // process's lock, so every later write waits behind it: an unclaimed steer that completes only
    // after the lock is free ran on the writer, not on this thread.
    const blocked = lock.run(() => writeAtomicDurableFileAsync(join(dir, 'first.json'), '{}\n'))
    const unclaimed = writeWorkerSteerAsync(dir, 'run', 'run:s0', {
      eventDir: dir,
      operationId: 'steer-unclaimed',
      message: 'admitted outside any claim',
    }).then((steer) => ({ steer, doneMs: performance.now() - began }))
    const claimed = lock.run(async () => {
      const steer = await writeWorkerSteerAsync(dir, 'run', 'run:s1', {
        eventDir: dir,
        operationId: 'steer-claimed',
        message: 'admitted under the run claim',
      })
      const record = {
        schemaVersion: 1 as const,
        operationId: steer.request.operationId,
        requestDigest: steer.request.requestDigest,
        worker: steer.request.worker,
        requestedAt: steer.request.at,
        observedAt: steer.request.at,
        effect: 'unknown' as const,
        detail: 'delivery admitted',
      }
      expect(await claimWorkerSteerDelivery(dir, record)).toBe(true)
      await writeWorkerSteerAcknowledgement(dir, {
        ...record,
        effect: 'delivered',
        detail: 'delivered',
      })
      await writeWorkerInteractiveBindingAsync(dir, 'run:s1', 'worker', dir, {
        status: 'unavailable',
        reason: 'not-live',
      })
      return steer
    })
    const [, admitted, steer] = await Promise.all([blocked, unclaimed, claimed])
    const waitedMs = performance.now() - began
    const worstGapMs = worstGap()
    holder.kill('SIGKILL')

    // Every write waited for the other process's lock (about 3 s) while this loop kept running.
    expect(waitedMs).toBeGreaterThan(2_500)
    expect(admitted.doneMs).toBeGreaterThan(2_500)
    expect(worstGapMs).toBeLessThan(100)
    expect(admitted.steer.replayed).toBe(false)
    expect(steer.replayed).toBe(false)
    expect(readWorkerSteerAcknowledgement(dir, 'steer-claimed')?.effect).toBe('delivered')
    expect(readWorkerInteractiveBinding(dir, 'run:s1')?.status).toBe('unavailable')
  } finally {
    await lock.release()
  }
}, 30_000)

it('a run stop and its cancellation records wait on the durable writer without blocking the event loop', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'durable-writer-cancel-'))
  const other = await mkdtemp(join(tmpdir(), 'durable-writer-cancel-other-'))
  directories.push(dir, other)
  // The stop request is already on disk, as a coordinator wrote it before the disk filled.
  cancelRun(dir, 'stop-run', { operator: 'test-operator', reason: 'solved' })
  const lock = await acquireRunDirectoryLock(dir, 'cancel-off-loop')
  try {
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE), 3_000)
    const worstGap = heartbeat()
    await delay(50)
    const began = performance.now()
    let abortedMs: number | undefined
    // The run's observer applies the stop under its claim: the abort is issued at once, and the
    // `cancel_requested` record, then the settle record, wait on the writer behind the held lock.
    const settled = lock.run(async () => {
      const applied = await applyRunCancellationAsync(
        dir,
        () => {
          abortedMs = performance.now() - began
        },
        () => new Date().toISOString(),
        'observer',
      )
      await writeRunCancellationAsync(dir, {
        ...applied!,
        effect: 'cancelled',
        detail: 'the run reached its terminal cancelled state',
      })
      return performance.now() - began
    })
    // Another run's coordinator stops it with no claim: its request queues behind the same writer.
    const stopped = cancelRunAsync(other, 'stop-other', {
      operator: 'test-operator',
      reason: 'solved',
    }).then((answer) => ({ answer, doneMs: performance.now() - began }))
    const [settledMs, outside] = await Promise.all([settled, stopped])
    const worstGapMs = worstGap()
    holder.kill('SIGKILL')

    expect(abortedMs).toBeLessThan(100)
    expect(settledMs).toBeGreaterThan(2_500)
    expect(outside.doneMs).toBeGreaterThan(2_500)
    expect(worstGapMs).toBeLessThan(100)
    expect(readRunCancellation(dir, 'stop-run')?.effect).toBe('cancelled')
    expect(outside.answer.effect).toBe('unknown')
    expect(readRunCancelRequest(other)?.operationId).toBe('stop-other')
  } finally {
    await lock.release()
  }
}, 30_000)

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
