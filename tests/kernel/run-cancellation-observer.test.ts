import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cancelRun,
  readRunCancellation,
  watchRunCancellation,
} from '../../src/runtime/supervise/run-cancellation'

describe('external run cancellation observation', () => {
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
})
