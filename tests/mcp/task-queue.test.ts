import { describe, expect, it } from 'vitest'
import { DelegationTaskQueue, hashIdempotencyInput } from '../../src/mcp/task-queue'
import type { DelegateCodeArgs, DelegateResearchArgs } from '../../src/mcp/types'

const codeArgs: DelegateCodeArgs = { goal: 'fix bug', repoRoot: '/repo' }
const researchArgs: DelegateResearchArgs = { question: 'q?', namespace: 'ns-1' }

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('DelegationTaskQueue.submit', () => {
  it('returns a taskId immediately and tracks pending → running → completed', async () => {
    const queue = new DelegationTaskQueue()
    const d = deferred<{
      output: {
        branch: string
        patch: string
        testResult: { passed: boolean; output: string }
        typecheckResult: { passed: boolean; output: string }
        diffStats: { filesChanged: number; insertions: number; deletions: number }
      }
    }>()
    const { taskId, reused } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      run: async () => (await d.promise).output,
    })
    expect(reused).toBe(false)
    expect(taskId).toMatch(/^dlg-/)
    expect(queue.status(taskId)?.status).toBe('pending')
    // microtask tick to flip to running
    await new Promise((r) => setImmediate(r))
    expect(queue.status(taskId)?.status).toBe('running')
    d.resolve({
      output: {
        branch: 'b',
        patch: '',
        testResult: { passed: true, output: '' },
        typecheckResult: { passed: true, output: '' },
        diffStats: { filesChanged: 0, insertions: 0, deletions: 0 },
      },
    })
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.status).toBe('completed')
    expect(status?.completedAt).toBeTypeOf('string')
    expect(status?.result?.profile).toBe('coder')
  })

  it('records failure when the run function throws', async () => {
    const queue = new DelegationTaskQueue()
    const { taskId } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      run: async () => {
        throw new Error('runner exploded')
      },
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.status).toBe('failed')
    expect(status?.error?.message).toBe('runner exploded')
    expect(status?.error?.kind).toBe('Error')
  })

  it('reuses a taskId when idempotencyKey matches a known record', () => {
    const queue = new DelegationTaskQueue()
    const key = hashIdempotencyInput({ x: 1 })
    const a = queue.submit({
      profile: 'coder',
      args: codeArgs,
      idempotencyKey: key,
      run: async () => ({}) as never,
    })
    const b = queue.submit({
      profile: 'coder',
      args: codeArgs,
      idempotencyKey: key,
      run: async () => ({}) as never,
    })
    expect(b.reused).toBe(true)
    expect(b.taskId).toBe(a.taskId)
  })

  it('reports progress updates from the run function', async () => {
    const queue = new DelegationTaskQueue()
    const d = deferred<void>()
    const { taskId } = queue.submit({
      profile: 'researcher',
      args: researchArgs,
      run: async (ctx) => {
        ctx.report({ iteration: 1, phase: 'searching' })
        await d.promise
        ctx.report({ iteration: 2, phase: 'finalizing' })
        return { items: [], citations: [], proposedWrites: [] }
      },
    })
    await new Promise((r) => setImmediate(r))
    expect(queue.status(taskId)?.progress).toEqual({ iteration: 1, phase: 'searching' })
    d.resolve()
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(queue.status(taskId)?.status).toBe('completed')
  })
})

describe('DelegationTaskQueue.cancel', () => {
  it('aborts an in-flight run and marks the record cancelled', async () => {
    const queue = new DelegationTaskQueue()
    let abortObserved = false
    const { taskId } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      run: async (ctx) =>
        new Promise<never>((_, reject) => {
          ctx.signal.addEventListener('abort', () => {
            abortObserved = true
            reject(new DOMException('aborted', 'AbortError'))
          })
        }),
    })
    await new Promise((r) => setImmediate(r))
    expect(queue.cancel(taskId)).toBe(true)
    await new Promise((r) => setImmediate(r))
    const status = queue.status(taskId)
    expect(status?.status).toBe('cancelled')
    expect(status?.error?.kind).toBe('CancelledError')
    expect(abortObserved).toBe(true)
  })

  it('returns false for unknown taskIds and is idempotent on terminal records', async () => {
    const queue = new DelegationTaskQueue()
    expect(queue.cancel('nope')).toBe(false)
    const { taskId } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      run: async () => {
        throw new Error('synthetic failure')
      },
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(queue.status(taskId)?.status).toBe('failed')
    expect(queue.cancel(taskId)).toBe(false)
  })
})

describe('DelegationTaskQueue.history + attachFeedback', () => {
  it('filters by namespace, profile, and since; orders newest-first', async () => {
    let n = 0
    const queue = new DelegationTaskQueue({
      now: () => {
        n += 1
        return new Date(1700000000000 + n * 1000).toISOString()
      },
    })
    queue.submit({
      profile: 'coder',
      args: codeArgs,
      namespace: 'a',
      run: async () => ({}) as never,
    })
    queue.submit({
      profile: 'researcher',
      args: researchArgs,
      namespace: 'a',
      run: async () => ({}) as never,
    })
    queue.submit({
      profile: 'coder',
      args: codeArgs,
      namespace: 'b',
      run: async () => ({}) as never,
    })
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))
    expect(queue.history({ namespace: 'a' }).map((e) => e.profile)).toEqual(['researcher', 'coder'])
    expect(queue.history({ profile: 'coder' }).map((e) => e.namespace)).toEqual(['b', 'a'])
    expect(queue.history({ limit: 1 }).length).toBe(1)
  })

  it('attaches feedback snapshots to the matching record', async () => {
    const queue = new DelegationTaskQueue()
    const { taskId } = queue.submit({
      profile: 'coder',
      args: codeArgs,
      run: async () => ({}) as never,
    })
    await new Promise((r) => setImmediate(r))
    expect(
      queue.attachFeedback(taskId, {
        id: 'fbk-1',
        score: 0.9,
        by: 'agent',
        notes: 'looks good',
        capturedAt: new Date().toISOString(),
      }),
    ).toBe(true)
    expect(
      queue.attachFeedback('nope', {
        id: 'fbk-2',
        score: 0.1,
        by: 'agent',
        notes: 'irrelevant',
        capturedAt: new Date().toISOString(),
      }),
    ).toBe(false)
    const [entry] = queue.history()
    expect(entry?.feedback?.[0]?.notes).toBe('looks good')
  })
})

describe('hashIdempotencyInput', () => {
  it('produces stable hashes regardless of property order', () => {
    expect(hashIdempotencyInput({ a: 1, b: 2 })).toBe(hashIdempotencyInput({ b: 2, a: 1 }))
  })
  it('differs when nested values differ', () => {
    expect(hashIdempotencyInput({ a: 1 })).not.toBe(hashIdempotencyInput({ a: 2 }))
  })
  it('treats undefined as absent', () => {
    expect(hashIdempotencyInput({ a: 1, b: undefined })).toBe(hashIdempotencyInput({ a: 1 }))
  })
})
