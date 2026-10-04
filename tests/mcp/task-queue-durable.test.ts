import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DelegationPersistenceError,
  DelegationStateCorruptError,
  type DelegationStore,
  FileDelegationStore,
} from '../../src/mcp/delegation-store'
import {
  type DelegationResumeDriver,
  DelegationTaskQueue,
  hashIdempotencyInput,
} from '../../src/mcp/task-queue'
import type { DelegateCodeArgs } from '../../src/mcp/types'

const codeArgs: DelegateCodeArgs = { goal: 'fix bug', repoRoot: '/repo' }

const coderOutput = {
  branch: 'b',
  patch: '',
  testResult: { passed: true, output: '' },
  typecheckResult: { passed: true, output: '' },
  diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
}

const neverResolves = () => new Promise<never>(() => {})

async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met in time')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('DelegationTaskQueue durable mode', () => {
  let dir: string
  let filePath: string

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dlg-queue-'))
    filePath = join(dir, 'delegations.json')
  })

  afterEach(async () => {
    // Retry: a queue's write tail may still be landing tmp+rename pairs
    // when the test body returns.
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  })

  it('makes status + history visible to a fresh queue instance', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      namespace: 'ns-1',
      run: async () => coderOutput,
    })
    await until(() => first.status(taskId)?.status === 'completed')
    await first.flush()

    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const status = second.status(taskId)
    expect(status?.status).toBe('completed')
    expect(status?.result?.profile).toBe('coder')
    expect(status?.completedAt).toBeTypeOf('string')
    const [entry] = second.history({ namespace: 'ns-1' })
    expect(entry?.taskId).toBe(taskId)
    expect(entry?.status).toBe('completed')
  })

  it('settles restored in-flight records as failed with a truthful error', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      run: neverResolves,
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const status = second.status(taskId)
    expect(status?.status).toBe('failed')
    expect(status?.error?.kind).toBe('DriverRestartError')
    expect(status?.error?.message).toContain(
      'delegation driver restarted while the task was in flight',
    )
    // The settled failure is itself persisted: a third restore sees it
    // without re-running the rehydration logic against a 'running' record.
    await second.flush()
    const third = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    expect(third.status(taskId)?.status).toBe('failed')
  })

  it('resumes restored records that carry a detachedSessionRef via resumeDelegate', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: 'sess-abc',
      run: neverResolves,
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    const seenRefs: string[] = []
    let ticks = 0
    const resumeDelegate: DelegationResumeDriver = {
      intervalMs: 1,
      async tick(task) {
        seenRefs.push(task.detachedSessionRef)
        ticks += 1
        if (ticks < 3) return { state: 'running' }
        return { state: 'completed', output: coderOutput, costUsd: 0.42 }
      },
    }
    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
      resumeDelegate,
    })
    expect(['running', 'completed']).toContain(second.status(taskId)?.status)
    await until(() => second.status(taskId)?.status === 'completed')
    expect(seenRefs.every((ref) => ref === 'sess-abc')).toBe(true)
    expect(ticks).toBe(3)
    const status = second.status(taskId)
    expect(status?.result?.profile).toBe('coder')
    expect(status?.costUsd).toBe(0.42)

    await second.flush()
    const third = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    expect(third.status(taskId)?.status).toBe('completed')
  })

  it('fails the record without a resumeDelegate even when a detachedSessionRef exists', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: 'sess-xyz',
      run: neverResolves,
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const status = second.status(taskId)
    expect(status?.status).toBe('failed')
    expect(status?.error?.message).toContain('sess-xyz')
    expect(status?.error?.message).toContain('needs a resumeDelegate')

    const third = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    expect(third.status(taskId)?.status).toBe('failed')
  })

  it.each([false, true])(
    'settles a resumed record as failed when the driver tick throws (assertion throws: %s)',
    async (assertionThrows) => {
      const first = await DelegationTaskQueue.restore({
        store: new FileDelegationStore({ filePath }),
      })
      const { taskId } = first.submit({
        profile: 'coder',
        args: codeArgs,
        detachedSessionRef: 'sess-err',
        run: neverResolves,
      })
      await until(() => first.status(taskId)?.status === 'running')
      await first.flush()

      // Hold the terminal write so an in-memory failure cannot masquerade as
      // a drained journal. The real FileDelegationStore still performs the I/O.
      let releaseWrite!: () => void
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      let failedWriteStarted = false
      const store = new FileDelegationStore({ filePath })
      const upsert = store.upsert.bind(store)
      const writeSpy = vi.spyOn(store, 'upsert').mockImplementation(async (record) => {
        if (record.status === 'failed') {
          failedWriteStarted = true
          await writeGate
        }
        await upsert(record)
      })
      const second = await DelegationTaskQueue.restore({
        store,
        resumeDelegate: {
          intervalMs: 1,
          async tick() {
            throw new Error('detached session evaporated')
          },
        },
      })
      const assertionError = new Error('simulated test assertion failure')
      let testBodySettled = false
      const runAssertions = async () => {
        try {
          await until(() => second.status(taskId)?.status === 'failed')
          expect(second.status(taskId)?.error?.message).toBe('detached session evaporated')
          if (assertionThrows) throw assertionError
        } finally {
          // A failed assertion or status wait must not bypass the write drain.
          // cancel is a no-op once failed, but stops a still-running resume loop.
          second.cancel(taskId)
          await second.flush()
        }
      }
      // Observe rejection immediately, but retain it for the assertion below.
      const outcome = runAssertions().then(
        () => {
          testBodySettled = true
          return undefined
        },
        (error: unknown) => {
          testBodySettled = true
          return error
        },
      )
      try {
        await until(() => failedWriteStarted)
        await new Promise<void>((resolve) => setImmediate(resolve))
        expect(testBodySettled).toBe(false)
      } finally {
        // Release and drain even when the regression assertion itself fails,
        // keeping the suite's tmpdir-removal hook behind every pending write.
        releaseWrite()
        await outcome
        second.cancel(taskId)
        await second.flush()
        writeSpy.mockRestore()
      }
      expect(await outcome).toBe(assertionThrows ? assertionError : undefined)
      const persisted = await new FileDelegationStore({ filePath }).loadAll()
      expect(persisted.find((record) => record.taskId === taskId)).toMatchObject({
        status: 'failed',
        error: { message: 'detached session evaporated' },
      })
    },
  )

  it('cancel() aborts an in-progress resume loop', async () => {
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      detachedSessionRef: 'sess-cancel',
      run: neverResolves,
    })
    await until(() => first.status(taskId)?.status === 'running')
    await first.flush()

    let abortObserved = false
    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
      resumeDelegate: {
        intervalMs: 1,
        async tick(_task, ctx) {
          ctx.signal.addEventListener('abort', () => {
            abortObserved = true
          })
          return { state: 'running' }
        },
      },
    })
    await until(() => second.status(taskId)?.status === 'running')
    expect(second.cancel(taskId)).toBe(true)
    expect(second.status(taskId)?.status).toBe('cancelled')
    await until(() => abortObserved)
    await second.flush()
  })

  it('dedupes a re-submitted idempotency key across restart without re-running', async () => {
    const key = hashIdempotencyInput(codeArgs)
    const first = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const { taskId } = first.submit({
      profile: 'coder',
      args: codeArgs,
      idempotencyKey: key,
      run: async () => coderOutput,
    })
    await until(() => first.status(taskId)?.status === 'completed')
    await first.flush()

    const second = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    const run = vi.fn(async () => coderOutput)
    const resubmitted = second.submit({
      profile: 'coder',
      args: codeArgs,
      idempotencyKey: key,
      run,
    })
    expect(resubmitted.reused).toBe(true)
    expect(resubmitted.taskId).toBe(taskId)
    expect(second.status(taskId)?.status).toBe('completed')
    await new Promise((r) => setImmediate(r))
    expect(run).not.toHaveBeenCalled()
  })

  it('evicts the oldest terminal records beyond maxTerminalRecords, in memory and on disk', async () => {
    let n = 0
    const queue = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
      maxTerminalRecords: 2,
      now: () => new Date(1700000000000 + ++n * 1000).toISOString(),
    })
    const taskIds: string[] = []
    for (let i = 0; i < 4; i += 1) {
      const { taskId } = queue.submit({
        profile: 'coder',
        args: { goal: `task ${i}`, repoRoot: '/repo' },
        run: async () => coderOutput,
      })
      taskIds.push(taskId)
      await until(() => {
        const status = queue.status(taskId)?.status
        return status === 'completed' || status === undefined
      })
    }
    expect(queue.history().length).toBe(2)
    expect(queue.status(taskIds[0] as string)).toBeUndefined()
    expect(queue.status(taskIds[1] as string)).toBeUndefined()
    expect(queue.status(taskIds[3] as string)?.status).toBe('completed')

    await queue.flush()
    const reopened = await DelegationTaskQueue.restore({
      store: new FileDelegationStore({ filePath }),
    })
    expect(reopened.history().length).toBe(2)
  })

  it('rejects a non-positive retention cap loudly', async () => {
    expect(() => new DelegationTaskQueue({ maxTerminalRecords: 0 })).toThrowError(
      /maxTerminalRecords/,
    )
  })

  it('restore() rejects with DelegationStateCorruptError over a corrupt state file', async () => {
    await writeFile(filePath, '{"version":1,"records":"nope"}', 'utf8')
    await expect(
      DelegationTaskQueue.restore({ store: new FileDelegationStore({ filePath }) }),
    ).rejects.toBeInstanceOf(DelegationStateCorruptError)
  })

  it('stops accepting submissions after a store write failure', async () => {
    const broken: DelegationStore = {
      async loadAll() {
        return []
      },
      async upsert() {
        throw new Error('disk full')
      },
      async lookupIdempotencyKey() {
        return undefined
      },
      async remove() {},
    }
    const onPersistError = vi.fn()
    const queue = await DelegationTaskQueue.restore({ store: broken, onPersistError })
    queue.submit({ profile: 'coder', args: codeArgs, run: async () => coderOutput })
    await expect(queue.flush()).rejects.toBeInstanceOf(DelegationPersistenceError)
    expect(onPersistError).toHaveBeenCalledTimes(1)
    expect(() =>
      queue.submit({ profile: 'coder', args: codeArgs, run: async () => coderOutput }),
    ).toThrowError(DelegationPersistenceError)
  })
})
