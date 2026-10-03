import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runTaskQueue } from '../../src/runtime/task-queue'
import { mapWithConcurrency } from '../../src/runtime/util'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('runTaskQueue', () => {
  it('enforces bounded admission and returns every immediate settlement', async () => {
    let next = 0
    let peak = 0
    let running = 0
    const results = []
    for await (const result of runTaskQueue({
      concurrency: 2,
      take: (active) => {
        expect(active.size).toBeLessThan(2)
        const value = next++
        return value < 8 ? { id: String(value), value } : undefined
      },
      execute: async ({ value }) => {
        peak = Math.max(peak, ++running)
        await tick()
        running--
        return value * 2
      },
    }))
      results.push(result)
    expect(peak).toBe(2)
    expect(results.map((result) => result.task.value).sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7])
    expect(
      results.every(
        (result) => result.status === 'fulfilled' && result.value === result.task.value * 2,
      ),
    ).toBe(true)
  })

  it('delivers completed rejection before admitting more work after a paused consumer', async () => {
    const held = [deferred<number>(), deferred<number>()]
    const launched: number[] = []
    let next = 0
    const iterator = runTaskQueue({
      concurrency: 2,
      take: () => (next < 3 ? { id: String(next), value: next++ } : undefined),
      execute: ({ value }) => {
        launched.push(value)
        return held[value]?.promise ?? Promise.resolve(value)
      },
    })
    const first = iterator.next()
    await tick()
    const fault = new Error('B failed')
    held[0]!.resolve(0)
    held[1]!.reject(fault)
    expect((await first).value).toMatchObject({ status: 'fulfilled', value: 0 })
    await tick()
    const second = await iterator.next()
    expect(second.value).toMatchObject({ status: 'rejected', reason: fault })
    expect(launched).toEqual([0, 1])
    await iterator.return()
  })

  it('retains chronological settlement order, not task insertion order', async () => {
    const held = [deferred<number>(), deferred<number>()]
    let next = 0
    const iterator = runTaskQueue({
      concurrency: 2,
      take: () => (next < 2 ? { id: String(next), value: next++ } : undefined),
      execute: ({ value }) => held[value]!.promise,
    })
    const first = iterator.next()
    await tick()
    held[1]!.resolve(1)
    held[0]!.resolve(0)
    expect((await first).value).toMatchObject({ task: { id: '1' } })
    expect((await iterator.next()).value).toMatchObject({ task: { id: '0' } })
    expect((await iterator.next()).done).toBe(true)
  })

  it('drains started native file work on consumer return without admitting queued work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'runtime-task-queue-'))
    const first = deferred<number>()
    const held = deferred<void>()
    let next = 0
    let finished = false
    const launched: number[] = []
    const iterator = runTaskQueue({
      concurrency: 2,
      take: () => (next < 3 ? { id: String(next), value: next++ } : undefined),
      execute: async ({ value }) => {
        launched.push(value)
        if (value === 0) return first.promise
        await held.promise
        await writeFile(join(dir, 'finished'), 'exact native write')
        finished = true
        return value
      },
    })
    try {
      const yielded = iterator.next()
      await tick()
      expect(launched).toEqual([0, 1])
      first.resolve(0)
      await yielded
      let returned = false
      const closing = iterator.return().then(() => {
        returned = true
      })
      await tick()
      expect(returned).toBe(false)
      expect(finished).toBe(false)
      held.resolve()
      await closing
      expect(launched).toEqual([0, 1])
      expect(await readFile(join(dir, 'finished'), 'utf8')).toBe('exact native write')
    } finally {
      first.resolve(0)
      held.resolve()
      await iterator.return()
      await rm(dir, { recursive: true })
    }
  })

  it('rejects an active duplicate before execution and drains the original task', async () => {
    const held = deferred<void>()
    let executions = 0
    let returned = false
    const iterator = runTaskQueue({
      concurrency: 2,
      take: () => ({ id: 'same', value: 1 }),
      execute: async () => {
        executions++
        await held.promise
      },
    })
    const request = iterator.next().then(
      () => {
        throw new Error('expected duplicate refusal')
      },
      (error) => {
        returned = true
        return error
      },
    )
    await tick()
    expect(returned).toBe(false)
    expect(executions).toBe(1)
    held.resolve()
    expect(await request).toMatchObject({ message: 'runTaskQueue: task "same" is already active' })
  })

  it('allows the same identity after its previous settlement has been consumed', async () => {
    let next = 0
    const values = []
    for await (const result of runTaskQueue({
      concurrency: 1,
      take: () => (next < 3 ? { id: 'repeat', value: next++ } : undefined),
      execute: async ({ value }) => value,
    }))
      values.push(result)
    expect(values.map((result) => result.task.value)).toEqual([0, 1, 2])
  })

  it('awaits checkpoint admission before execute and snapshots task identity', async () => {
    const checkpoint = deferred<void>()
    const entry = { id: 'original', value: 7 }
    let executed = false
    let once = false
    const iterator = runTaskQueue({
      concurrency: 1,
      take: async () => {
        if (once) return
        once = true
        await checkpoint.promise
        return entry
      },
      execute: async (task) => {
        executed = true
        entry.id = 'mutated'
        return task.id
      },
    })
    const first = iterator.next()
    await tick()
    expect(executed).toBe(false)
    checkpoint.resolve()
    expect((await first).value).toMatchObject({ task: { id: 'original' }, value: 'original' })
    expect((await iterator.next()).done).toBe(true)
  })

  it('preserves synchronous errors, undefined rejection, and caller abort identity', async () => {
    const abort = new Error('caller cancelled')
    for (const reason of [abort, undefined]) {
      let once = false
      const iterator = runTaskQueue({
        concurrency: 1,
        take: () => {
          if (once) return
          once = true
          return { id: 'one', value: 1 }
        },
        execute: () => {
          throw reason
        },
      })
      const first = await iterator.next()
      expect(first.value).toMatchObject({ status: 'rejected' })
      expect(first.value?.status === 'rejected' && first.value.reason === reason).toBe(true)
      expect((await iterator.next()).done).toBe(true)
    }
  })

  it('drains started work before rethrowing a take failure', async () => {
    const held = deferred<void>()
    const fault = new Error('checkpoint failed')
    let takes = 0
    let returned = false
    const iterator = runTaskQueue({
      concurrency: 2,
      take: () => {
        if (takes++ > 0) throw fault
        return { id: 'one', value: 1 }
      },
      execute: () => held.promise,
    })
    const next = iterator.next().catch((error) => {
      returned = true
      return error
    })
    await tick()
    expect(returned).toBe(false)
    held.resolve()
    expect(await next).toBe(fault)
  })

  it('refuses invalid concurrency before calling the consumer', async () => {
    for (const concurrency of [0, -1, 1.5, NaN, Infinity]) {
      let called = false
      const iterator = runTaskQueue({
        concurrency,
        take: () => {
          called = true
          return undefined
        },
        execute: async () => undefined,
      })
      await expect(iterator.next()).rejects.toThrow('positive safe integer')
      expect(called).toBe(false)
    }
  })
})

describe('mapWithConcurrency uses the same drain owner', () => {
  it('awaits a started sibling before returning the original failure and does not start C', async () => {
    const held = deferred<void>()
    const fault = new Error('A failed')
    const launched: number[] = []
    let finished = false
    let returned = false
    const call = mapWithConcurrency([0, 1, 2], 2, async (value) => {
      launched.push(value)
      if (value === 0) {
        await tick()
        throw fault
      }
      await held.promise
      finished = true
      return value
    }).catch((error) => {
      returned = true
      return error
    })
    await tick()
    await tick()
    expect(returned).toBe(false)
    expect(finished).toBe(false)
    held.resolve()
    expect(await call).toBe(fault)
    expect(finished).toBe(true)
    expect(launched).toEqual([0, 1])
  })
  it('preserves ordered results and fractional/Infinity bounds', async () => {
    for (const limit of [0, 1.8, Infinity])
      expect(await mapWithConcurrency([0, 1, 2], limit, async (value) => value * 2)).toEqual([
        0, 2, 4,
      ])
    expect(await mapWithConcurrency([], Infinity, async (value) => value)).toEqual([])
    await expect(
      mapWithConcurrency([0], 1, async () => {
        throw undefined
      }),
    ).rejects.toBeUndefined()
  })
})
