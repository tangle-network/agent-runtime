/**
 * Pinned baseline: buy and hold the benchmark index (bars[0]) from day 0.
 * One fill, then nothing — the cheapest possible exposure to the market.
 */

import type { Bar, Signal } from '../../types.ts'

export function generateSignals(bars: Bar[][]): Signal[] {
  const weights = bars.map((_, k) => (k === 0 ? 1 : 0))
  return [{ t: 0, weights }]
}
