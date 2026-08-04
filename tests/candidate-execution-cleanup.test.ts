import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  CandidateCleanupTimeoutError,
  CandidateResultTimeoutError,
  candidateCleanupTimeout,
  MAX_CANDIDATE_TIMER_INTERVAL_MS,
  withinCandidateCleanupDeadline,
  withinCandidateResultDeadline,
} from '../src/candidate-execution/cleanup'
import {
  CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS,
  candidateExecutionOwnerWindowMs,
  candidatePostRunWindowMs,
} from '../src/candidate-execution/execution-window'

describe('candidate cleanup timer bounds', () => {
  afterEach(() => vi.useRealTimers())

  it('accepts the Node timer boundary and rejects values that would clamp', () => {
    expect(candidateCleanupTimeout(MAX_CANDIDATE_TIMER_INTERVAL_MS)).toBe(
      MAX_CANDIDATE_TIMER_INTERVAL_MS,
    )
    expect(() => candidateCleanupTimeout(MAX_CANDIDATE_TIMER_INTERVAL_MS + 1)).toThrow(
      /supported timer range/,
    )
    expect(() => candidateCleanupTimeout(Number.MAX_SAFE_INTEGER)).toThrow(/supported timer range/)
  })

  it('budgets every sequential post-run phase plus terminal persistence', () => {
    expect(candidatePostRunWindowMs(25, 500)).toBe(
      25 * 4 + 500 + CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS,
    )
    expect(candidateExecutionOwnerWindowMs(1_000, 25, 500)).toBe(
      1_000 + 25 * 4 + 500 + CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS,
    )
    expect(() => candidatePostRunWindowMs(MAX_CANDIDATE_TIMER_INTERVAL_MS, 1)).toThrow(
      /post-run window/,
    )
  })

  it('rejects results observed exactly at their frozen deadline', async () => {
    vi.useFakeTimers({ now: 100 })
    let observedCleanupSignal: AbortSignal | undefined
    await expect(
      withinCandidateCleanupDeadline(
        async (signal) => {
          observedCleanupSignal = signal
          vi.setSystemTime(110)
          return 'ambiguous'
        },
        110,
        'cleanup',
      ),
    ).rejects.toBeInstanceOf(CandidateCleanupTimeoutError)
    expect(observedCleanupSignal?.aborted).toBe(true)

    let observedSignal: AbortSignal | undefined
    await expect(
      withinCandidateResultDeadline(
        async (signal) => {
          observedSignal = signal
          vi.setSystemTime(120)
          return 'ambiguous'
        },
        120,
        'result',
      ),
    ).rejects.toBeInstanceOf(CandidateResultTimeoutError)
    expect(observedSignal?.aborted).toBe(true)
  })

  it('interrupts hanging cleanup at the frozen deadline', async () => {
    vi.useFakeTimers({ now: 100 })
    let observedSignal: AbortSignal | undefined
    const result = withinCandidateCleanupDeadline(
      async (signal) => {
        observedSignal = signal
        return await new Promise<never>(() => undefined)
      },
      120,
      'hanging cleanup',
    )
    const rejected = expect(result).rejects.toBeInstanceOf(CandidateCleanupTimeoutError)

    await vi.advanceTimersByTimeAsync(20)
    await rejected
    expect(Date.now()).toBe(120)
    expect(observedSignal?.aborted).toBe(true)
    expect(observedSignal?.reason).toBeInstanceOf(CandidateCleanupTimeoutError)
  })
})
