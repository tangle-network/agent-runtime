import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { watchRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-layout'

describe('external run cancellation observation', () => {
  it('checks pre-existing requests once and preserves the pending acknowledgement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    const abort = vi.fn()
    cancelRun(dir, 'existing', { reason: 'operator' })
    const observer = watchRunCancellation(dir, abort)
    try {
      observer.check()
      observer.check()
      expect(abort).toHaveBeenCalledExactlyOnceWith(
        'operator',
        expect.objectContaining({ source: 'human', operationId: 'existing' }),
      )
      expect(readRunCancellation(dir, 'existing')?.effect).toBe('cancel_requested')
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('echoes the operator on the applied acknowledgement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    const abort = vi.fn()
    cancelRun(dir, 'attributed', { reason: 'operator', operator: 'alice' })
    const observer = watchRunCancellation(dir, abort)
    try {
      observer.check()
      expect(abort).toHaveBeenCalledExactlyOnceWith(
        'operator',
        expect.objectContaining({ operationId: 'attributed', operator: 'alice' }),
      )
      expect(readRunCancellation(dir, 'attributed')).toMatchObject({
        effect: 'cancel_requested',
        operator: 'alice',
      })
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not acknowledge a callback that failed to issue cancellation', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    cancelRun(dir, 'rejected')
    const observer = watchRunCancellation(dir, () => {
      throw new Error('not bound')
    })
    try {
      expect(() => observer.check()).toThrow('not bound')
      expect(readRunCancellation(dir, 'rejected')).toBeUndefined()
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('validates and preserves the immutable requested deadline', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    try {
      for (const deadlineMs of [-1, NaN, Infinity]) {
        expect(() => cancelRun(dir, 'deadline', { deadlineMs })).toThrow(/deadlineMs/)
      }
      cancelRun(dir, 'deadline', { deadlineMs: 50 })
      expect(() => cancelRun(dir, 'deadline', { deadlineMs: 51 })).toThrow(/deadlineMs/)
      expect(cancelRun(dir, 'deadline', { deadlineMs: 50 }).effect).toBe('unknown')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('does not apply a queued request after the external driver finished', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    const abort = vi.fn()
    const observer = watchRunCancellation(dir, abort)
    try {
      cancelRun(dir, 'late', { reason: 'operator' })
      observer.close()
      observer.check()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(abort).not.toHaveBeenCalled()
      expect(readRunCancellation(dir, 'late')).toBeUndefined()
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('degrades to poll-only when the host inotify budget is exhausted (EMFILE)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    const abort = vi.fn()
    const observer = watchRunCancellation(dir, abort, () => {
      const error = new Error('too many open files') as NodeJS.ErrnoException
      error.code = 'EMFILE'
      throw error
    })
    try {
      // No watcher exists; the observer still applies a durable request through its poll path.
      cancelRun(dir, 'polled', { reason: 'operator' })
      observer.check('fallback')
      expect(abort).toHaveBeenCalledExactlyOnceWith(
        'operator',
        expect.objectContaining({ operationId: 'polled' }),
      )
      expect(readRunCancellation(dir, 'polled')?.effect).toBe('cancel_requested')
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('still fails loudly on a watch error that is not the host budget', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'run-cancel-observer-'))
    const abort = vi.fn()
    expect(() =>
      watchRunCancellation(dir, abort, () => {
        const error = new Error('bad fd') as NodeJS.ErrnoException
        error.code = 'EBADF'
        throw error
      }),
    ).toThrow('bad fd')
    await rm(dir, { recursive: true, force: true })
  })
})
