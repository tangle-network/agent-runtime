import { EventEmitter } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { watchRunCancellation } from '../../src/runtime/supervise/run-cancellation'
import { cancelRun, readRunCancellation } from '../../src/runtime/supervise/run-layout'

// Drop filesystem notifications while retaining real durable request and acknowledgement files.
vi.mock('node:fs', async (original) => ({
  ...(await original<typeof import('node:fs')>()),
  watch: () => Object.assign(new EventEmitter(), { close: () => {} }),
}))

describe('durable cancellation fallback', () => {
  it('applies a missed notification and truthfully reports the exceeded target', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'cancel-fallback-'))
    const abort = vi.fn()
    const observer = watchRunCancellation(dir, abort)
    try {
      observer.check()
      cancelRun(dir, 'missed', { deadlineMs: 0 })
      await expect
        .poll(() => readRunCancellation(dir, 'missed'), { timeout: 1000 })
        .toMatchObject({ effect: 'cancel_requested', path: 'fallback', deadlineExceeded: true })
      expect(abort).toHaveBeenCalledTimes(1)
      expect(readRunCancellation(dir, 'missed')?.appliedAfterMs).toBeGreaterThan(0)
    } finally {
      observer.close()
      await rm(dir, { recursive: true, force: true })
    }
  })
})
