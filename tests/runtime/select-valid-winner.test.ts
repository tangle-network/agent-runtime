import { describe, expect, it } from 'vitest'
import { selectValidWinner } from '../../src/runtime/personify/combinators'
import type { Outcome } from '../../src/runtime/personify/types'
import type { Iteration } from '../../src/runtime/types'

// Minimal iteration shapes — the selector reads only output/error/verdict/index.
function iter<D>(
  index: number,
  valid: boolean | undefined,
  score: number,
  deliverable: D | undefined,
  error?: unknown,
): Iteration<unknown, Outcome<D>> {
  return {
    index,
    output: deliverable !== undefined ? ({ kind: 'done', deliverable } as Outcome<D>) : undefined,
    ...(valid !== undefined ? { verdict: { valid, score } } : {}),
    ...(error !== undefined ? { error } : {}),
  } as unknown as Iteration<unknown, Outcome<D>>
}

const dx = (w: { output?: Outcome<{ x: number }> | undefined } | undefined): number | undefined =>
  w?.output?.kind === 'done' ? w.output.deliverable.x : undefined

describe('selectValidWinner', () => {
  it('highest-score among valid only, ties → earliest index', () => {
    const w = selectValidWinner<{ x: number }>()([
      iter(0, true, 0.5, { x: 0 }),
      iter(1, true, 0.9, { x: 1 }),
      iter(2, true, 0.9, { x: 2 }), // tie on 0.9 → earliest (index 1) wins
      iter(3, false, 1.0, { x: 3 }), // higher score but NOT valid → excluded
    ])
    expect(dx(w)).toBe(1)
  })

  it('returns undefined when no candidate is valid (an ungated output never wins)', () => {
    expect(
      selectValidWinner()([iter(0, false, 1, { x: 0 }), iter(1, undefined, 0, { x: 1 })]),
    ).toBeUndefined()
  })

  it('smallest-artifact uses the sizeOf extractor over the unwrapped deliverable', () => {
    const w = selectValidWinner<{ x: number }>({
      strategy: 'smallest-artifact',
      sizeOf: (d) => d.x,
    })([iter(0, true, 1, { x: 10 }), iter(1, true, 1, { x: 3 }), iter(2, true, 1, { x: 7 })])
    expect(dx(w)).toBe(3)
  })

  it('smallest-artifact reads the RAW settled deliverable (the shape settledToIteration produces)', () => {
    // The worktree/scope fanout sets iter.output to the raw deliverable (no Outcome wrapper). sizeOf
    // must still fire over that shape — else smallest-artifact silently collapses to earliest-index.
    const rawIter = (index: number, x: number): Iteration<unknown, Outcome<{ x: number }>> =>
      ({
        index,
        output: { x } as unknown as Outcome<{ x: number }>,
        verdict: { valid: true, score: 1 },
      }) as unknown as Iteration<unknown, Outcome<{ x: number }>>
    const w = selectValidWinner<{ x: number }>({
      strategy: 'smallest-artifact',
      sizeOf: (d) => d.x,
    })([rawIter(0, 10), rawIter(1, 3), rawIter(2, 7)])
    const raw = w?.output as unknown as { x: number } | undefined
    expect(raw?.x).toBe(3)
  })

  it('first-valid picks the earliest valid regardless of score', () => {
    const w = selectValidWinner<{ x: number }>({ strategy: 'first-valid' })([
      iter(0, false, 1, { x: 0 }),
      iter(1, true, 0.1, { x: 1 }),
      iter(2, true, 0.9, { x: 2 }),
    ])
    expect(dx(w)).toBe(1)
  })

  it('excludes errored iterations even if marked valid', () => {
    const w = selectValidWinner<{ x: number }>()([
      iter(0, true, 0.9, { x: 0 }, new Error('boom')),
      iter(1, true, 0.5, { x: 1 }),
    ])
    expect(dx(w)).toBe(1)
  })
})
