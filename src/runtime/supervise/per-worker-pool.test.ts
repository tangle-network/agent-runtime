import { describe, expect, it } from 'vitest'
import { ValidationError } from '../../errors'
import { supervise } from './supervise'

/**
 * A per-child ceiling larger than the conserved pool cannot be honored. Accepting it silently is
 * what made a documented knob look effective while the reservation still clamped every child:
 * perWorker.maxTokens was 3,200,000,000 against a 200,000,000 pool, and children died with
 * "ticket 7 spent 2,420,267 tokens > reserved 700,000" — a budget-shaped message for what was
 * really a misconfiguration the caller could not see.
 */
const profile = {
  name: 'probe',
  version: '1',
  harness: 'cli-base',
  model: { provider: 'test', default: 'test' },
  prompt: { systemPrompt: 'probe', instructions: [] },
} as never

describe('perWorker must fit inside the pool', () => {
  // supervise validates at construction and throws synchronously, so the ceiling is refused
  // before any pool, journal or worker exists — which is the point: the caller can still fix it.
  it('refuses a per-child token ceiling larger than the pool', () => {
    expect(() =>
      supervise(profile, 'probe', {
        budget: { maxIterations: 10, maxTokens: 200_000_000 },
        perWorker: { maxIterations: 4, maxTokens: 3_200_000_000 },
      } as never),
    ).toThrow(/perWorker\.maxTokens \(3200000000\) exceeds budget\.maxTokens \(200000000\)/)
  })

  it('refuses a per-child iteration ceiling larger than the pool', () => {
    expect(() =>
      supervise(profile, 'probe', {
        budget: { maxIterations: 10, maxTokens: 1_000_000 },
        perWorker: { maxIterations: 40, maxTokens: 100_000 },
      } as never),
    ).toThrow(/perWorker\.maxIterations \(40\) exceeds budget\.maxIterations \(10\)/)
  })

  it('names ValidationError so a caller can distinguish misconfiguration from exhaustion', () => {
    expect(() =>
      supervise(profile, 'probe', {
        budget: { maxIterations: 10, maxTokens: 1_000 },
        perWorker: { maxIterations: 1, maxTokens: 2_000 },
      } as never),
    ).toThrow(ValidationError)
  })

  it('accepts a per-child ceiling that fits, so the guard is not a blanket refusal', () => {
    expect(() =>
      supervise(profile, 'probe', {
        budget: { maxIterations: 10, maxTokens: 1_000_000 },
        perWorker: { maxIterations: 4, maxTokens: 250_000 },
      } as never),
    ).not.toThrow(/exceeds budget/)
  })
})
