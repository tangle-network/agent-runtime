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
      expect(abort).toHaveBeenCalledExactlyOnceWith('operator')
      expect(readRunCancellation(dir, 'existing')?.effect).toBe('cancel_requested')
    } finally {
      observer.close()
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
})
