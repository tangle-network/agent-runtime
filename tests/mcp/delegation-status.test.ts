import { describe, expect, it } from 'vitest'
import { NotFoundError } from '../../src/errors'
import { DelegationTaskQueue } from '../../src/mcp/task-queue'
import {
  createDelegationStatusHandler,
  validateDelegationStatusArgs,
} from '../../src/mcp/tools/delegation-status'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('validateDelegationStatusArgs', () => {
  it('requires a non-empty taskId', () => {
    expect(() => validateDelegationStatusArgs({})).toThrow(TypeError)
    expect(() => validateDelegationStatusArgs({ taskId: '   ' })).toThrow(TypeError)
  })
})

describe('createDelegationStatusHandler', () => {
  it('walks the lifecycle pending → running → completed', async () => {
    const queue = new DelegationTaskQueue()
    const d = deferred<{ ok: true }>()
    const submitted = queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      run: async () => await d.promise,
    })
    const handler = createDelegationStatusHandler({ queue })
    const pending = await handler({ taskId: submitted.taskId })
    expect(pending.status).toBe('pending')
    await new Promise((r) => setImmediate(r))
    const running = await handler({ taskId: submitted.taskId })
    expect(running.status).toBe('running')
    d.resolve({ ok: true })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const completed = await handler({ taskId: submitted.taskId })
    expect(completed.status).toBe('completed')
    expect(completed.completedAt).toBeTypeOf('string')
  })

  it('throws NotFoundError for unknown taskIds', async () => {
    const queue = new DelegationTaskQueue()
    const handler = createDelegationStatusHandler({ queue })
    await expect(handler({ taskId: 'dlg-missing' })).rejects.toBeInstanceOf(NotFoundError)
  })

  it('surfaces failed status with the error payload', async () => {
    const queue = new DelegationTaskQueue()
    const submitted = queue.submit({
      profile: 'coder',
      args: { goal: 'g', repoRoot: '/r' },
      run: async () => {
        throw new Error('boom')
      },
    })
    const handler = createDelegationStatusHandler({ queue })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const status = await handler({ taskId: submitted.taskId })
    expect(status.status).toBe('failed')
    expect(status.error?.message).toBe('boom')
  })
})
