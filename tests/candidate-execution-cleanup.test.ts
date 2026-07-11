import { describe, expect, it } from 'vitest'

import {
  candidateCleanupTimeout,
  MAX_CANDIDATE_TIMER_INTERVAL_MS,
} from '../src/candidate-execution/cleanup'
import {
  CANDIDATE_TERMINAL_PERSISTENCE_MARGIN_MS,
  candidateExecutionOwnerWindowMs,
  candidatePostRunWindowMs,
} from '../src/candidate-execution/execution-window'

describe('candidate cleanup timer bounds', () => {
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
})
