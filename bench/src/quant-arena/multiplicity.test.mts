import { describe, expect, it } from 'vitest'
import {
  BASE_EXCESS_SHARPE,
  MULTIPLICITY_SPREAD,
  decideAcceptance,
  requiredExcessSharpe,
} from './multiplicity.ts'

describe('requiredExcessSharpe — the rising bar', () => {
  it('equals the base floor for the very first candidate', () => {
    expect(requiredExcessSharpe(1)).toBeCloseTo(BASE_EXCESS_SHARPE, 12)
  })

  it('matches the documented formula base + spread * sqrt(2 ln n)', () => {
    for (const n of [2, 4, 10, 50, 200]) {
      expect(requiredExcessSharpe(n)).toBeCloseTo(BASE_EXCESS_SHARPE + MULTIPLICITY_SPREAD * Math.sqrt(2 * Math.log(n)), 12)
    }
    // Spot values so a silent constant change fails a test, not just a diff.
    expect(requiredExcessSharpe(10)).toBeCloseTo(0.1 + 0.15 * Math.sqrt(2 * Math.log(10)), 12)
  })

  it('is strictly increasing in candidates tried', () => {
    let prev = requiredExcessSharpe(1)
    for (let n = 2; n <= 100; n++) {
      const cur = requiredExcessSharpe(n)
      expect(cur).toBeGreaterThan(prev)
      prev = cur
    }
  })

  it('rejects a non-positive or fractional try count', () => {
    expect(() => requiredExcessSharpe(0)).toThrow(/positive integer/)
    expect(() => requiredExcessSharpe(2.5)).toThrow(/positive integer/)
  })
})

describe('decideAcceptance — consistency AND multiplicity', () => {
  const goodWindows = [0.9, 0.8, 1.0, 0.7, 0.85, 0.95, 0.6, 0.75]

  it('accepts a consistent, large edge early in the campaign', () => {
    const d = decideAcceptance({ perWindowExcess: goodWindows, nTried: 1 })
    expect(d.accepted).toBe(true)
    expect(d.wins).toBe(8)
    expect(d.requiredWins).toBe(6)
  })

  it('rejects on consistency when the edge is one lucky stretch (5/8 wins)', () => {
    const d = decideAcceptance({ perWindowExcess: [3, 3, 3, -0.1, -0.1, -0.1, 0.5, 0.5], nTried: 1 })
    expect(d.accepted).toBe(false)
    expect(d.wins).toBe(5)
    expect(d.reasons[0]).toMatch(/consistency/)
  })

  it('the SAME evidence passes at n=1 and fails once enough candidates were tried', () => {
    // Mean excess 0.30: above the n=1 bar (0.10), below the n=50 bar (~0.52).
    const marginal = [0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]
    expect(decideAcceptance({ perWindowExcess: marginal, nTried: 1 }).accepted).toBe(true)
    const late = decideAcceptance({ perWindowExcess: marginal, nTried: 50 })
    expect(late.accepted).toBe(false)
    expect(late.reasons[0]).toMatch(/multiplicity/)
    expect(late.threshold).toBeGreaterThan(0.3)
  })

  it('fails closed on non-finite evidence and empty windows', () => {
    expect(() => decideAcceptance({ perWindowExcess: [0.5, Number.NaN], nTried: 1 })).toThrow(/non-finite/)
    expect(() => decideAcceptance({ perWindowExcess: [], nTried: 1 })).toThrow(/no windows/)
  })
})
