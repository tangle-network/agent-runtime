import { afterEach, describe, expect, it, vi } from 'vitest'
import { armDeadlineTimer, teardownExecutor } from '../../src/runtime/supervise/deadline'
import type { Executor } from '../../src/runtime/supervise/types'
import { runWait } from '../../src/runtime/supervise/wait'
import { sleep, withTimeout } from '../../src/runtime/util'

const MONTH = 30 * 24 * 60 * 60 * 1_000
const TIMER_MAX = 2_147_483_647

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('long-duration timers', () => {
  it('does not settle a month-long durable wait after one millisecond', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let settled = false
    const result = runWait({
      spec: { kind: 'timer', untilMs: MONTH },
      label: 'external-result',
      armedAt: 0,
      resumed: false,
      signal: new AbortController().signal,
      now: Date.now,
    }).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(MONTH - 1)
    expect(await result).toMatchObject({
      kind: 'woke',
      outcome: { wokenAt: MONTH, settled: 'fired' },
    })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels a long wait during a later timer chunk', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const controller = new AbortController()
    const result = runWait({
      spec: { kind: 'timer', untilMs: MONTH },
      label: 'external-result',
      armedAt: 0,
      resumed: true,
      signal: controller.signal,
      now: Date.now,
    })
    await vi.advanceTimersByTimeAsync(TIMER_MAX + 5)
    controller.abort()
    expect(await result).toMatchObject({ kind: 'cancelled' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a caller-selected long poll interval without rapid re-polling', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const probe = vi.fn().mockResolvedValue(false)
    const controller = new AbortController()
    const result = runWait({
      spec: { kind: 'poll', probe: 'ready', intervalMs: MONTH },
      label: 'poll',
      armedAt: 0,
      resumed: false,
      signal: controller.signal,
      now: Date.now,
      probes: { resolve: () => probe },
    })
    await vi.advanceTimersByTimeAsync(10)
    expect(probe).toHaveBeenCalledTimes(1)
    controller.abort()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not turn a long backoff into an immediate retry', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let settled = false
    const controller = new AbortController()
    const result = sleep(MONTH, controller.signal).then(() => {
      settled = true
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    controller.abort()
    await result
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves a long timeout while still returning an early result', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let finish!: (value: string) => void
    let settled = false
    const result = withTimeout(
      new Promise<string>((resolve) => {
        finish = resolve
      }),
      MONTH,
    ).then((value) => {
      settled = true
      return value
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toBe(false)
    finish('saved')
    expect(await result).toBe('saved')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('preserves long explicit teardown grace rather than timing out immediately', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    let finish!: (receipt: { destroyed: boolean }) => void
    let rejected = false
    const executor = {
      teardown: () =>
        new Promise<{ destroyed: boolean }>((resolve) => {
          finish = resolve
        }),
    } as Executor<unknown>
    const result = teardownExecutor(executor, MONTH, undefined, Date.now).catch((error) => {
      rejected = true
      return error
    })
    await vi.advanceTimersByTimeAsync(1)
    expect(rejected).toBe(false)
    finish({ destroyed: true })
    expect(await result).toBeUndefined()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a 365-day deadline armed across chunks and clears it exactly once', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    const onDeadline = vi.fn()
    const year = 365 * 24 * 60 * 60 * 1_000
    const clear = armDeadlineTimer(year, onDeadline)
    await vi.advanceTimersByTimeAsync(year - 1)
    expect(onDeadline).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(onDeadline).toHaveBeenCalledOnce()
    clear()
    clear()
    expect(vi.getTimerCount()).toBe(0)
  })
})
