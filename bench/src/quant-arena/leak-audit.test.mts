import { describe, expect, it } from 'vitest'
import { truncationCutoffs, truncationInvariance } from './leak-audit.ts'
import { generateSignals as smaCrossover } from './strategies/sma-crossover/strategy.ts'
import { generateSignals as buyHold } from './strategies/buy-hold-index/strategy.ts'
import type { Bar, Signal } from './types.ts'

/** Deterministic wiggly price path (no RNG — the test must be reproducible). */
function syntheticBars(n: number, tickers: number): Bar[][] {
  return Array.from({ length: tickers }, (_, k) =>
    Array.from({ length: n }, (_, t) => {
      const close = 100 + 10 * Math.sin(t / 7 + k) + 0.05 * t
      const open = 100 + 10 * Math.sin((t - 0.5) / 7 + k) + 0.05 * t
      return {
        date: `d${String(t).padStart(4, '0')}`,
        open,
        high: Math.max(open, close) + 1,
        low: Math.min(open, close) - 1,
        close,
        volume: 1000,
      }
    }),
  )
}

/** Deliberately leaky: sizes today's weight by TOMORROW's return. Exactly the
 *  bug class the truncation check exists to kill. */
const peekAheadStrategy = (bars: Bar[][]): Signal[] => {
  const T = bars[0]!.length
  const signals: Signal[] = []
  for (let t = 0; t < T - 1; t++) {
    const up = bars[0]![t + 1]!.close > bars[0]![t]!.close
    signals.push({ t, weights: bars.map((_, k) => (k === 0 && up ? 1 : 0)) })
  }
  return signals
}

/** Leaky via whole-series statistics: normalizes by the FULL-sample max close. */
const fullSampleMaxStrategy = (bars: Bar[][]): Signal[] => {
  const maxClose = Math.max(...bars[0]!.map((b) => b.close))
  const T = bars[0]!.length
  const signals: Signal[] = []
  for (let t = 0; t < T; t++) {
    const w = bars[0]![t]!.close / maxClose
    signals.push({ t, weights: bars.map((_, k) => (k === 0 ? w : 0)) })
  }
  return signals
}

describe('truncationInvariance — the mechanical look-ahead guard', () => {
  const bars = syntheticBars(400, 3)

  it('catches a strategy that peeks at tomorrow', () => {
    const report = truncationInvariance(peekAheadStrategy, bars, { warmupDays: 50 })
    expect(report.clean).toBe(false)
    expect(report.divergence).not.toBeNull()
    expect(report.divergence!.detail).toMatch(/decision changed|exists only/)
  })

  it('catches a strategy leaking through full-sample statistics', () => {
    const report = truncationInvariance(fullSampleMaxStrategy, bars, { warmupDays: 50 })
    expect(report.clean).toBe(false)
  })

  it('passes the pinned baselines (no look-ahead by construction)', () => {
    expect(truncationInvariance(smaCrossover, bars, { warmupDays: 120 }).clean).toBe(true)
    expect(truncationInvariance(buyHold, bars, { warmupDays: 50 }).clean).toBe(true)
  })

  it('cutoffs are inside (warmup, T-1) and deduplicated ascending', () => {
    const cutoffs = truncationCutoffs(400, 50)
    expect(cutoffs.length).toBeGreaterThanOrEqual(2)
    for (const c of cutoffs) {
      expect(c).toBeGreaterThan(50)
      expect(c).toBeLessThan(399)
    }
    expect(cutoffs).toEqual([...cutoffs].sort((a, b) => a - b))
    expect(new Set(cutoffs).size).toBe(cutoffs.length)
  })
})
