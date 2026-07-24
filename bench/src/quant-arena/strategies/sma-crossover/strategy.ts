/**
 * Pinned baseline: SMA(20/100) crossover momentum. Each day t (after warmup)
 * a ticker is "trending" when its 20-day simple moving average of closes —
 * computed from bars up to and including t — is above its 100-day SMA. Equity
 * splits equally across trending tickers; no trend anywhere = 100% cash.
 * Signals are emitted only when the trending set changes, so turnover stays
 * proportional to regime changes rather than to calendar days.
 */

import type { Bar, Signal } from '../../types.ts'

const FAST = 20
const SLOW = 100

export function generateSignals(bars: Bar[][]): Signal[] {
  const n = bars.length
  const totalDays = bars[0]?.length ?? 0
  // Prefix sums of closes per ticker: sum[t+1] = closes[0..t] summed.
  const prefix: number[][] = bars.map((series) => {
    const p = new Array<number>(series.length + 1).fill(0)
    for (let t = 0; t < series.length; t++) p[t + 1] = p[t]! + series[t]!.close
    return p
  })
  const sma = (k: number, t: number, len: number): number =>
    (prefix[k]![t + 1]! - prefix[k]![t + 1 - len]!) / len

  const signals: Signal[] = []
  let lastKey = ''
  for (let t = SLOW - 1; t < totalDays; t++) {
    const trending: number[] = []
    for (let k = 0; k < n; k++) {
      if (sma(k, t, FAST) > sma(k, t, SLOW)) trending.push(k)
    }
    const key = trending.join(',')
    if (key === lastKey) continue
    lastKey = key
    const weights = new Array<number>(n).fill(0)
    for (const k of trending) weights[k] = 1 / Math.max(trending.length, 1)
    signals.push({ t, weights })
  }
  return signals
}
