/**
 * Pinned baseline: 1/N across the whole universe (index included), rebalanced
 * every 21 trading days (~monthly). Harvests diversification with bounded
 * turnover.
 */

import type { Bar, Signal } from '../../types.ts'

const REBALANCE_EVERY = 21

export function generateSignals(bars: Bar[][]): Signal[] {
  const n = bars.length
  const totalDays = bars[0]?.length ?? 0
  const weights = bars.map(() => 1 / n)
  const signals: Signal[] = []
  for (let t = 0; t < totalDays; t += REBALANCE_EVERY) {
    signals.push({ t, weights: [...weights] })
  }
  return signals
}
