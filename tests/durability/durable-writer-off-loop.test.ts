import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, beforeEach, expect, it } from 'vitest'
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

import { createEventLoopHeartbeat, MAX_EVENT_LOOP_GAP_MS } from '../helpers/event-loop-heartbeat'

let heartbeat: Awaited<ReturnType<typeof createEventLoopHeartbeat>>
beforeEach(async () => {
  heartbeat = await createEventLoopHeartbeat()
})

const children = new Set<ChildProcess>()
const directories: string[] = []

afterEach(async () => {
  await heartbeat?.close()
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL')
  children.clear()
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

/** How long the writes wait on the held lock while the test watches this event loop. */
const HOLD_MS = 3_000

/**
 * Another process takes the run's mutation lock, reports it, and holds it until `release()`: a
 * slow disk. `release()` resolves to the holder's clock just before it let go, so a write that
 * completes at or after that reading waited for the lock. The holder used to let go on a timer and
 * the test compared elapsed time with a fixed 2.5 s, which a loaded gate host broke (11-20).
 */
function holdMutationLock(lockFile: string) {
  const source = `
    import { tryAcquireAtomicFileLock } from '@tangle-network/agent-eval/ledger-core'
    const taken = tryAcquireAtomicFileLock({ lockPath: ${JSON.stringify(`${lockFile}.mutation`)} })
    if (!taken.acquired) { console.log('refused'); process.exit(1) }
    console.log('held')
    process.stdin.once('data', () => {
      const at = Date.now()
      taken.lock.release()
      console.log('released ' + at)
    })
  `
  const child = spawn(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: process.cwd(),
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  children.add(child)
  let output = ''
  const waits = new Set<() => void>()
  child.stdout!.on('data', (chunk) => {
    output += String(chunk)
    for (const check of waits) check()
  })
  const line = (pattern: RegExp) =>
    new Promise<RegExpMatchArray>((resolve, reject) => {
      const done = () => {
        waits.delete(check)
        child.off('exit', exited)
      }
      const check = () => {
        const match = output.match(pattern)
        if (match) {
          done()
          resolve(match)
        } else if (output.includes('refused')) {
          done()
          reject(new Error('the holder could not take the lock'))
        }
      }
      const exited = (code: number | null) => {
        done()
        reject(new Error(`holder exited ${code} before ${pattern}`))
      }
      waits.add(check)
      child.once('exit', exited)
      check()
    })
  return line(/held/).then(() => ({
    child,
    /** Lets go of the lock; resolves to the holder's `Date.now()` just before it did. */
    release: async () => {
      const released = line(/released (\d+)/)
      child.stdin!.write('release\n')
      return Number((await released)[1])
    },
  }))
}

it('steer and binding writes wait on the durable writer without blocking the event loop, claimed or not', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'durable-writer-steer-'))
  directories.push(dir)
  const lock = await acquireRunDirectoryLock(dir, 'steer-off-loop')
  try {
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE))
    const worstGap = heartbeat.start()
    await delay(50)
    // This claimed write reaches the durable writer as it is called and waits there for the other
    // process's lock, so every later write waits behind it: an unclaimed steer that completes only
    // after the lock is free ran on the writer, not on this thread.
    const blocked = lock.run(() => writeAtomicDurableFileAsync(join(dir, 'first.json'), '{}\n'))
    const unclaimed = writeWorkerSteerAsync(dir, 'run', 'run:s0', {
      eventDir: dir,
      operationId: 'steer-unclaimed',
      message: 'admitted outside any claim',
    }).then((steer) => ({ steer, doneAt: Date.now() }))
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
    await delay(HOLD_MS)
    const releasedAt = await holder.release()
    const [, admitted, steer] = await Promise.all([blocked, unclaimed, claimed])
    const completedAt = Date.now()
    const { worstGapMs, maxObservedGapMs } = await worstGap()
    console.info(
      'DURABLE_WRITER_HEARTBEAT',
      JSON.stringify({ case: 'steer-binding', worstGapMs, maxObservedGapMs }),
    )
    holder.child.kill('SIGKILL')

    // Every write waited for the other process's lock while this loop kept running.
    expect(completedAt).toBeGreaterThanOrEqual(releasedAt)
    expect(admitted.doneAt).toBeGreaterThanOrEqual(releasedAt)
    expect(worstGapMs).toBeLessThan(MAX_EVENT_LOOP_GAP_MS)
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
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE))
    const worstGap = heartbeat.start()
    await delay(50)
    let abortedAt: number | undefined
    // The run's observer applies the stop under its claim: the abort is issued at once, and the
    // `cancel_requested` record, then the settle record, wait on the writer behind the held lock.
    const settled = lock.run(async () => {
      const applied = await applyRunCancellationAsync(
        dir,
        () => {
          abortedAt = Date.now()
        },
        () => new Date().toISOString(),
        'observer',
      )
      await writeRunCancellationAsync(dir, {
        ...applied!,
        effect: 'cancelled',
        detail: 'the run reached its terminal cancelled state',
      })
      return Date.now()
    })
    // Another run's coordinator stops it with no claim: its request queues behind the same writer.
    const stopped = cancelRunAsync(other, 'stop-other', {
      operator: 'test-operator',
      reason: 'solved',
    }).then((answer) => ({ answer, doneAt: Date.now() }))
    // A second stop under another operation id, admitted against the same still-empty inbox, loses
    // the exclusive publication and is refused against the first: one run carries one operation.
    const rival = cancelRunAsync(other, 'stop-rival', { operator: 'test-operator' }).then(
      () => 'admitted',
      (error: Error) => error.message,
    )
    await delay(HOLD_MS)
    const releasedAt = await holder.release()
    const [settledAt, outside, rivalOutcome] = await Promise.all([settled, stopped, rival])
    const { worstGapMs, maxObservedGapMs } = await worstGap()
    console.info(
      'DURABLE_WRITER_HEARTBEAT',
      JSON.stringify({ case: 'cancellation', worstGapMs, maxObservedGapMs }),
    )
    holder.child.kill('SIGKILL')

    // The abort did not wait for the writer; both records did.
    expect(abortedAt).toBeLessThan(releasedAt)
    expect(settledAt).toBeGreaterThanOrEqual(releasedAt)
    expect(outside.doneAt).toBeGreaterThanOrEqual(releasedAt)
    expect(worstGapMs).toBeLessThan(MAX_EVENT_LOOP_GAP_MS)
    expect(readRunCancellation(dir, 'stop-run')?.effect).toBe('cancelled')
    expect(outside.answer.effect).toBe('unknown')
    expect(readRunCancelRequest(other)?.operationId).toBe('stop-other')
    expect(rivalOutcome).toMatch(/'stop-other' is already pending/)
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
    const holder = await holdMutationLock(join(dir, RUN_DIRECTORY_LOCK_FILE))
    const worstGap = heartbeat.start()
    await delay(50)
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
    await delay(HOLD_MS)
    const releasedAt = await holder.release()
    await Promise.all(writes)
    const completedAt = Date.now()
    const { worstGapMs, maxObservedGapMs } = await worstGap()
    console.info(
      'DURABLE_WRITER_HEARTBEAT',
      JSON.stringify({ case: 'ordered-writes', worstGapMs, maxObservedGapMs }),
    )
    holder.child.kill('SIGKILL')

    // The writes waited for the other process's lock while this loop kept running.
    expect(completedAt).toBeGreaterThanOrEqual(releasedAt)
    expect(worstGapMs).toBeLessThan(MAX_EVENT_LOOP_GAP_MS)
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
