import { describe, expect, it } from 'vitest'
import { boxReadErrorMessage, readBoxPathWithRetry } from './box-read-retry'

describe('readBoxPathWithRetry', () => {
  it('returns the text as soon as an attempt succeeds, without spending the rest', async () => {
    let calls = 0
    const read = () => {
      calls += 1
      return calls < 3 ? Promise.reject(new Error('404')) : Promise.resolve('flushed')
    }
    const result = await readBoxPathWithRetry(read, 'a.md', { attempts: 4, delayMs: 0 })
    expect(result).toEqual({ succeeded: true, text: 'flushed' })
    expect(calls).toBe(3)
  })

  it('carries the LAST error out after every attempt fails', async () => {
    let calls = 0
    const read = () => {
      calls += 1
      return Promise.reject(new Error(`attempt ${calls}`))
    }
    const result = await readBoxPathWithRetry(read, 'a.md', { attempts: 3, delayMs: 0 })
    expect(calls).toBe(3)
    expect(result.succeeded).toBe(false)
    if (!result.succeeded) expect(boxReadErrorMessage(result.error)).toBe('attempt 3')
  })

  it('lets beforeAttempt abandon the read with the caller’s own error', async () => {
    let calls = 0
    const read = () => {
      calls += 1
      return Promise.reject(new Error('transient'))
    }
    await expect(
      readBoxPathWithRetry(read, 'a.md', {
        attempts: 5,
        delayMs: 0,
        beforeAttempt: (lastError) => {
          if (lastError !== undefined)
            throw new Error(`gave up after: ${boxReadErrorMessage(lastError)}`)
        },
      }),
    ).rejects.toThrow('gave up after: transient')
    expect(calls).toBe(1)
  })

  it('spends no read at all when the signal is already aborted', async () => {
    let calls = 0
    const controller = new AbortController()
    controller.abort()
    const result = await readBoxPathWithRetry(
      () => {
        calls += 1
        return Promise.resolve('never reached')
      },
      'a.md',
      { attempts: 3, delayMs: 0, signal: controller.signal },
    )
    expect(calls).toBe(0)
    expect(result.succeeded).toBe(false)
    if (!result.succeeded)
      expect(boxReadErrorMessage(result.error)).toContain('aborted before reading')
  })

  it('runs beforeAttempt exactly once per attempt, including the aborted one', async () => {
    const controller = new AbortController()
    const seen: (string | undefined)[] = []
    await readBoxPathWithRetry(
      () => {
        controller.abort()
        return Promise.reject(new Error('transient'))
      },
      'a.md',
      {
        attempts: 4,
        delayMs: 0,
        signal: controller.signal,
        beforeAttempt: (lastError) => {
          seen.push(boxReadErrorMessage(lastError))
        },
      },
    )
    // One call before the read that failed, one before the attempt the abort cancels.
    expect(seen).toEqual([undefined, 'transient'])
  })

  it('treats a sub-1 attempt count as a single attempt rather than skipping the read', async () => {
    let calls = 0
    const read = () => {
      calls += 1
      return Promise.resolve('once')
    }
    const result = await readBoxPathWithRetry(read, 'a.md', { attempts: 0, delayMs: 0 })
    expect(result).toEqual({ succeeded: true, text: 'once' })
    expect(calls).toBe(1)
  })

  it('passes undefined through boxReadErrorMessage so "no failure yet" stays distinguishable', () => {
    expect(boxReadErrorMessage(undefined)).toBeUndefined()
    expect(boxReadErrorMessage(new Error('boom'))).toBe('boom')
    expect(boxReadErrorMessage('plain string')).toBe('plain string')
  })
})
