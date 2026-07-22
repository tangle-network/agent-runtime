/**
 * QUANT-ARENA strategy contract.
 *
 * A strategy is ONE module exporting `generateSignals(bars: Bar[][]): Signal[]`.
 *
 *  - `bars[k]` is ticker k's daily bars. All tickers share one date axis:
 *    equal length, identical dates. `bars[0]` is ALWAYS the index (the
 *    buy-and-hold benchmark asset); `bars[1..]` are the rest of the universe.
 *  - A `Signal { t, weights }` is a target portfolio decided at the CLOSE of
 *    day `t`: `weights[k]` is the fraction of equity to hold in ticker k.
 *  - NO-LOOK-AHEAD RULE: the signal at index `t` may be computed ONLY from
 *    `bars[k][0..t]` (inclusive). Nothing after `t` — no future closes, no
 *    full-series statistics, no calendar tricks keyed to specific dates.
 *    The backtester fills every target at the NEXT day's open, and the leak
 *    audit re-runs the strategy on truncated data: signals up to the cutoff
 *    must be bit-identical or the candidate is killed.
 *  - No shorting, no leverage: every weight >= 0 and the weights sum to <= 1
 *    (the remainder sits in cash earning 0). The backtester throws on a
 *    violating signal — fail-closed, not silently clamped.
 *  - A rebalance happens ONLY when a signal is emitted: the target fills at
 *    the next open, then positions drift with prices until the next signal.
 *    Emit a signal each time you want to trade. No signal at all = 100% cash.
 */

export interface Bar {
  /** ISO date, e.g. '2019-03-08'. */
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Signal {
  /** Day index into the shared date axis. */
  t: number
  /** Target weight per ticker (same order as `bars`). */
  weights: number[]
}

export type GenerateSignals = (bars: Bar[][]) => Signal[]

export interface StrategyModule {
  generateSignals: GenerateSignals
}
