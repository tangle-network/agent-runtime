/**
 * Daily-bar event-loop backtester. Zero dependencies beyond the Node stdlib
 * (in fact: zero imports at all except the local types) so a reviewer can
 * audit the whole execution model in one file.
 *
 * Execution model (conservative by construction):
 *  - A signal decided at the close of day t is FILLED at the open of day t+1.
 *    Nothing trades on the bar that produced the decision.
 *  - Every rebalance pays `costBps + slippageBps` (basis points, one-way) on
 *    the dollars traded, deducted from cash at the fill.
 *  - No shorting, no leverage: weights >= 0, sum <= 1. Violations THROW —
 *    a strategy that asks for leverage is a broken candidate, not a clamped one.
 *  - Cash earns 0. A fully-invested target therefore carries a small negative
 *    cash balance equal to accumulated fees (fees financed at 0% — this only
 *    ever understates performance, never flatters it).
 *
 * Determinism: pure function of (bars, signals, config). No clock, no RNG.
 */

import type { Bar, Signal } from './types.ts'

export interface BacktestConfig {
  /** One-way transaction cost, basis points of traded dollars. */
  costBps: number
  /** One-way slippage, basis points of traded dollars. */
  slippageBps: number
}

export const TRADING_DAYS_PER_YEAR = 252

export interface RangeStats {
  /** First/last day index of the scored range (inclusive start, exclusive end). */
  start: number
  end: number
  days: number
  totalReturn: number
  maxDrawdown: number
  /** Annualized Sharpe of daily returns (rf = 0). 0 when volatility is 0. */
  sharpe: number
  /** Fills with |trade| > 1e-9 × equity, summed over the range. */
  tradeCount: number
  /** Σ traded dollars / equity at each rebalance (two-sided turnover). */
  turnover: number
}

export interface BacktestResult {
  dates: string[]
  /** Equity at each day's close; equity[0] = 1 (all cash at the first close). */
  equity: number[]
  /** dailyReturns[i] = equity[i+1] / equity[i] - 1. */
  dailyReturns: number[]
  /** Per-day fill count / turnover fraction (index = fill day). */
  fillsByDay: number[]
  turnoverByDay: number[]
  stats: RangeStats
}

const WEIGHT_EPS = 1e-9

export function assertAligned(bars: Bar[][]): void {
  if (bars.length === 0) throw new Error('backtest: empty universe')
  const T = bars[0]!.length
  if (T < 2) throw new Error('backtest: need at least 2 days of bars')
  for (let k = 1; k < bars.length; k++) {
    if (bars[k]!.length !== T) {
      throw new Error(`backtest: ticker ${k} has ${bars[k]!.length} bars, ticker 0 has ${T} — unaligned`)
    }
    for (let t = 0; t < T; t++) {
      if (bars[k]![t]!.date !== bars[0]![t]!.date) {
        throw new Error(`backtest: date mismatch at t=${t}: ${bars[k]![t]!.date} vs ${bars[0]![t]!.date}`)
      }
    }
  }
}

/** Validate one signal against the contract. Throws on violation. */
export function assertSignal(signal: Signal, tickers: number, totalDays: number): void {
  if (!Number.isInteger(signal.t) || signal.t < 0 || signal.t >= totalDays) {
    throw new Error(`backtest: signal.t=${signal.t} outside [0, ${totalDays})`)
  }
  if (signal.weights.length !== tickers) {
    throw new Error(`backtest: signal at t=${signal.t} has ${signal.weights.length} weights, universe has ${tickers}`)
  }
  let sum = 0
  for (const w of signal.weights) {
    if (!Number.isFinite(w)) throw new Error(`backtest: non-finite weight at t=${signal.t}`)
    if (w < -WEIGHT_EPS) throw new Error(`backtest: negative weight ${w} at t=${signal.t} — no shorting`)
    sum += w
  }
  if (sum > 1 + 1e-6) throw new Error(`backtest: weights sum ${sum} > 1 at t=${signal.t} — no leverage`)
}

/** Map of decision day -> target weights. A rebalance is executed ONLY at the
 *  open following an emitted signal; between signals, positions drift with
 *  prices (no silent daily re-targeting, no hidden fee drag). */
export function fillSchedule(signals: Signal[], tickers: number, totalDays: number): Map<number, number[]> {
  const sorted = [...signals].sort((a, b) => a.t - b.t)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]!.t === sorted[i - 1]!.t) {
      throw new Error(`backtest: two signals share t=${sorted[i]!.t} — a strategy emits at most one target per day`)
    }
  }
  const schedule = new Map<number, number[]>()
  for (const s of sorted) {
    assertSignal(s, tickers, totalDays)
    schedule.set(s.t, s.weights)
  }
  return schedule
}

export function runBacktest(bars: Bar[][], signals: Signal[], config: BacktestConfig): BacktestResult {
  assertAligned(bars)
  const N = bars.length
  const T = bars[0]!.length
  const fills = fillSchedule(signals, N, T)
  const feeRate = (config.costBps + config.slippageBps) / 10_000

  const equity: number[] = new Array(T).fill(0)
  const fillsByDay: number[] = new Array(T).fill(0)
  const turnoverByDay: number[] = new Array(T).fill(0)
  let cash = 1
  const pos: number[] = new Array(N).fill(0)
  equity[0] = 1

  for (let t = 1; t < T; t++) {
    // Overnight: yesterday's close -> today's open.
    for (let k = 0; k < N; k++) {
      const prevClose = bars[k]![t - 1]!.close
      if (prevClose <= 0) throw new Error(`backtest: nonpositive close for ticker ${k} at t=${t - 1}`)
      pos[k] = pos[k]! * (bars[k]![t]!.open / prevClose)
    }
    // Fill the target decided at yesterday's close, at today's open.
    const target = fills.get(t - 1)
    if (target !== undefined) {
      let equityOpen = cash
      for (let k = 0; k < N; k++) equityOpen += pos[k]!
      if (equityOpen <= 0) throw new Error(`backtest: equity wiped out at t=${t}`)
      let traded = 0
      let fills = 0
      for (let k = 0; k < N; k++) {
        const desired = target[k]! * equityOpen
        const delta = desired - pos[k]!
        traded += Math.abs(delta)
        if (Math.abs(delta) > WEIGHT_EPS * equityOpen) fills++
        cash -= delta
        pos[k] = desired
      }
      const fee = traded * feeRate
      cash -= fee
      fillsByDay[t] = fills
      turnoverByDay[t] = traded / equityOpen
    }
    // Intraday: today's open -> today's close.
    for (let k = 0; k < N; k++) {
      const open = bars[k]![t]!.open
      if (open <= 0) throw new Error(`backtest: nonpositive open for ticker ${k} at t=${t}`)
      pos[k] = pos[k]! * (bars[k]![t]!.close / open)
    }
    let eq = cash
    for (let k = 0; k < N; k++) eq += pos[k]!
    equity[t] = eq
  }

  const dailyReturns: number[] = new Array(T - 1)
  for (let i = 0; i < T - 1; i++) dailyReturns[i] = equity[i + 1]! / equity[i]! - 1

  const result: BacktestResult = {
    dates: bars[0]!.map((b) => b.date),
    equity,
    dailyReturns,
    fillsByDay,
    turnoverByDay,
    stats: undefined as unknown as RangeStats,
  }
  result.stats = statsForRange(result, 0, T)
  return result
}

/** Score a sub-range [start, end) of an existing backtest — the walk-forward
 *  window view. Positions carried into the window count; nothing after `end`
 *  leaks in. */
export function statsForRange(result: BacktestResult, start: number, end: number): RangeStats {
  const T = result.equity.length
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > T || end - start < 2) {
    throw new Error(`statsForRange: bad range [${start}, ${end}) over ${T} days`)
  }
  const eq = result.equity.slice(start, end)
  const totalReturn = eq[eq.length - 1]! / eq[0]! - 1
  let peak = eq[0]!
  let maxDrawdown = 0
  for (const e of eq) {
    if (e > peak) peak = e
    const dd = (peak - e) / peak
    if (dd > maxDrawdown) maxDrawdown = dd
  }
  const returns = result.dailyReturns.slice(start, end - 1)
  const n = returns.length
  const mean = returns.reduce((s, r) => s + r, 0) / n
  const variance = n > 1 ? returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (n - 1) : 0
  const std = Math.sqrt(variance)
  const sharpe = std > 0 ? (mean / std) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0
  let tradeCount = 0
  let turnover = 0
  for (let t = start + 1; t < end; t++) {
    tradeCount += result.fillsByDay[t]!
    turnover += result.turnoverByDay[t]!
  }
  return {
    start,
    end,
    days: end - start,
    totalReturn,
    maxDrawdown,
    sharpe,
    tradeCount,
    turnover,
  }
}
