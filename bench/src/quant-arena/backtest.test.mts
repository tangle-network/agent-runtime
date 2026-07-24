import { describe, expect, it } from 'vitest'
import { fillSchedule, runBacktest, statsForRange } from './backtest.ts'
import type { Bar } from './types.ts'

/** Flat-price bar helper. */
const bar = (date: string, open: number, close = open): Bar => ({
  date,
  open,
  high: Math.max(open, close),
  low: Math.min(open, close),
  close,
  volume: 1000,
})

const dates = (n: number): string[] =>
  Array.from({ length: n }, (_, i) => `2020-01-${String(i + 1).padStart(2, '0')}`)

const flatSeries = (n: number, price: number): Bar[] => dates(n).map((d) => bar(d, price))

const NO_COST = { costBps: 0, slippageBps: 0 }

describe('runBacktest hand-computed toy cases', () => {
  it('all-cash (no signals) stays at equity 1 with zero trades', () => {
    const result = runBacktest([flatSeries(5, 100)], [], NO_COST)
    expect(result.equity).toEqual([1, 1, 1, 1, 1])
    expect(result.stats.tradeCount).toBe(0)
    expect(result.stats.totalReturn).toBe(0)
  })

  it('full weight on a flat ticker loses exactly the round-trip-free fee', () => {
    // 10bps cost + 5bps slippage on 1.0 traded dollars = 15bps once.
    const result = runBacktest([flatSeries(5, 100)], [{ t: 0, weights: [1] }], { costBps: 10, slippageBps: 5 })
    expect(result.stats.tradeCount).toBe(1)
    expect(result.stats.totalReturn).toBeCloseTo(-0.0015, 12)
    expect(result.equity[4]).toBeCloseTo(1 - 0.0015, 12)
  })

  it('captures a known move: buy at open, ride to close', () => {
    // Day1: open 100 -> close 110 with full weight decided at day0 close.
    const series = [bar('2020-01-01', 100), bar('2020-01-02', 100, 110), bar('2020-01-03', 110)]
    const result = runBacktest([series], [{ t: 0, weights: [1] }], NO_COST)
    expect(result.equity[1]).toBeCloseTo(1.1, 12)
    expect(result.stats.totalReturn).toBeCloseTo(0.1, 12)
  })

  it('fills at the NEXT open, not the signal-day close (no free look-ahead)', () => {
    // Price gaps 100 -> 200 overnight after the signal. A same-close fill would
    // double money on the gap; a next-open fill must NOT.
    const series = [bar('2020-01-01', 100, 100), bar('2020-01-02', 200, 200), bar('2020-01-03', 300, 300)]
    const result = runBacktest([series], [{ t: 0, weights: [1] }], NO_COST)
    // Bought at 200 (day2 open); close day2 = 200 -> equity 1; day3 300/200 = 1.5.
    expect(result.equity[1]).toBeCloseTo(1, 12)
    expect(result.equity[2]).toBeCloseTo(1.5, 12)
  })

  it('max drawdown on a crafted path: peak 1.2 -> trough 0.9 = 25%', () => {
    const series = [
      bar('2020-01-01', 100),
      bar('2020-01-02', 100, 120),
      bar('2020-01-03', 120, 90),
      bar('2020-01-04', 90, 100),
    ]
    const result = runBacktest([series], [{ t: 0, weights: [1] }], NO_COST)
    expect(result.equity).toEqual([1, 1.2, 0.9, 1.0].map((v) => expect.closeTo(v, 12) as unknown as number))
    expect(result.stats.maxDrawdown).toBeCloseTo((1.2 - 0.9) / 1.2, 12)
  })

  it('splits weights across two tickers and holds cash for the rest', () => {
    const a = [bar('2020-01-01', 100), bar('2020-01-02', 100, 110)]
    const b = [bar('2020-01-01', 50), bar('2020-01-02', 50, 45)]
    const result = runBacktest([a, b], [{ t: 0, weights: [0.5, 0.25] }], NO_COST)
    // 0.5 * +10% + 0.25 * -10% + 0.25 cash = 1 + 0.05 - 0.025 = 1.025
    expect(result.equity[1]).toBeCloseTo(1.025, 12)
    expect(result.stats.tradeCount).toBe(2)
  })

  it('is deterministic: identical inputs give identical equity paths', () => {
    const series = [flatSeries(30, 100).map((b, i) => bar(b.date, 100 + i, 101 + i))]
    const signals = [
      { t: 0, weights: [0.7] },
      { t: 10, weights: [0.2] },
      { t: 20, weights: [1] },
    ]
    const r1 = runBacktest(series as Bar[][], signals, { costBps: 10, slippageBps: 5 })
    const r2 = runBacktest(series as Bar[][], signals, { costBps: 10, slippageBps: 5 })
    expect(r1.equity).toEqual(r2.equity)
    expect(r1.stats).toEqual(r2.stats)
  })

  it('rejects shorting, leverage, and misaligned universes (fail-closed)', () => {
    const series = [flatSeries(3, 100)]
    expect(() => runBacktest(series, [{ t: 0, weights: [-0.1] }], NO_COST)).toThrow(/no shorting/)
    expect(() => runBacktest(series, [{ t: 0, weights: [1.2] }], NO_COST)).toThrow(/no leverage/)
    expect(() => runBacktest([flatSeries(3, 100), flatSeries(4, 50)], [], NO_COST)).toThrow(/unaligned/)
    expect(() => runBacktest(series, [{ t: 5, weights: [1] }], NO_COST)).toThrow(/outside/)
  })

  it('rebalances ONLY on emitted signals — positions drift in between', () => {
    // One signal at t=0, then a price runup: the winning position is NOT
    // trimmed back to its target weight on later days (no hidden churn).
    const a = [bar('2020-01-01', 100), bar('2020-01-02', 100), bar('2020-01-03', 100, 200), bar('2020-01-04', 200)]
    const result = runBacktest([a], [{ t: 0, weights: [0.5] }], NO_COST)
    expect(result.stats.tradeCount).toBe(1)
    // 0.5 in the ticker doubled -> equity 1.5, still only one fill ever.
    expect(result.equity[3]).toBeCloseTo(1.5, 12)
    const schedule = fillSchedule([{ t: 1, weights: [0.5] }], 1, 4)
    expect(schedule.get(1)).toEqual([0.5])
    expect(schedule.has(0)).toBe(false)
  })
})

describe('statsForRange window slicing', () => {
  it('scores only the window and carries positions in', () => {
    // Flat first half, +10% single day in the second half.
    const series = [
      bar('2020-01-01', 100),
      bar('2020-01-02', 100),
      bar('2020-01-03', 100),
      bar('2020-01-04', 100, 110),
      bar('2020-01-05', 110),
    ]
    const result = runBacktest([series], [{ t: 0, weights: [1] }], NO_COST)
    const firstHalf = statsForRange(result, 0, 3)
    const secondHalf = statsForRange(result, 2, 5)
    expect(firstHalf.totalReturn).toBeCloseTo(0, 12)
    expect(secondHalf.totalReturn).toBeCloseTo(0.1, 12)
    expect(secondHalf.days).toBe(3)
  })

  it('rejects degenerate ranges', () => {
    const result = runBacktest([flatSeries(5, 100)], [], NO_COST)
    expect(() => statsForRange(result, 3, 3)).toThrow(/bad range/)
    expect(() => statsForRange(result, 0, 99)).toThrow(/bad range/)
  })
})
