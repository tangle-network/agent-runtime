export interface Bar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface StrategyContext {
  symbols: string[]
  t: number
  history: Bar[][]
  weights: number[]
  equity: number
}

export interface TargetPosition {
  symbol: string
  weight: number
}

// ECONOMIC RATIONALE
// -------------------
// Core effect (risk parity / low-volatility anomaly): within the 10-name universe,
// weight each name inversely to its trailing realized volatility instead of equal
// weight. Lower-vol names have historically offered better risk-adjusted (not
// necessarily raw) returns, so tilting the book toward them raises the portfolio's
// Sharpe by shrinking variance faster than it gives up mean return -- a
// cross-sectional statistical property of the return distribution, not a level
// fitted to this dataset, so it should generalize out of sample.
//
// Overlay (trend-based de-risking): scale TOTAL exposure down when the index is
// below its own ~6-month moving average. Sustained downtrends carry the worst
// left-tail days; cutting exposure in that regime avoids most of that tail and
// improves Sharpe without needing to predict the turn. This is the same
// mechanism behind classic tactical/trend-following allocation (Faber 2007;
// time-series momentum, Moskowitz/Ooi/Pedersen 2012).
//
// Turnover control: both the vol estimate and the trend regime move slowly, so
// re-deciding weights only once a month (not daily) captures nearly all the
// signal while keeping realized turnover, and the 15bps-per-side cost, low.

const VOL_LOOKBACK = 60 // ~1 quarter of trading days for the realized-vol estimate
const TREND_LOOKBACK = 120 // ~6 months for the index trend line
const MIN_RETURNS_FOR_VOL = 10 // below this, a vol estimate is too noisy to trust -> equal weight
const MIN_BARS_FOR_TREND = 20 // below this, no evidence of a downtrend yet -> assume uptrend
const REBALANCE_PERIOD = 21 // ~1 trading month cadence, keeps churn cheap relative to the edge
const DEFENSIVE_FRACTION = 0.3 // exposure kept on when the index is below its trend line
const MAX_STOCK_WEIGHT = 0.25 // guardrail against one noisy low-vol reading dominating the book
const EPS = 1e-6

function stdev(returns: number[]): number {
  const n = returns.length
  const mean = returns.reduce((s, r) => s + r, 0) / n
  const variance = returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / (n - 1)
  return Math.sqrt(Math.max(variance, 0))
}

function dailyReturns(bars: Bar[], lookback: number): number[] {
  const start = Math.max(1, bars.length - lookback)
  const out: number[] = []
  for (let i = start; i < bars.length; i++) {
    const prev = bars[i - 1].close
    const cur = bars[i].close
    if (prev > 0) out.push(cur / prev - 1)
  }
  return out
}

export function onBar(ctx: StrategyContext): TargetPosition[] | null {
  const { symbols, t, history } = ctx

  // Establish the initial book on day 0; otherwise only re-decide on a fixed
  // monthly cadence so 15bps churn cannot eat a vol/trend edge that itself
  // only moves on a weeks-to-months timescale.
  if (t !== 0 && t % REBALANCE_PERIOD !== 0) return null

  // --- regime filter: is the index above its own trend line? ---
  const idxBars = history[0]
  let uptrend = true
  if (idxBars.length >= MIN_BARS_FOR_TREND) {
    const window = idxBars.slice(Math.max(0, idxBars.length - TREND_LOOKBACK))
    const sma = window.reduce((s, b) => s + b.close, 0) / window.length
    uptrend = idxBars[idxBars.length - 1].close > sma
  }
  const exposure = uptrend ? 1 : DEFENSIVE_FRACTION

  // --- risk-parity book across the 10 constituents (symbols[1..10]) ---
  const stockIdx: number[] = []
  for (let k = 1; k < symbols.length; k++) stockIdx.push(k)

  const invVols: number[] = stockIdx.map((k) => {
    const rets = dailyReturns(history[k], VOL_LOOKBACK)
    if (rets.length < MIN_RETURNS_FOR_VOL) return NaN
    return 1 / (stdev(rets) + EPS)
  })

  const validMask = invVols.map((v) => !Number.isNaN(v))
  const anyValid = validMask.some(Boolean)

  let baseWeights: number[]
  if (!anyValid) {
    baseWeights = stockIdx.map(() => 1 / stockIdx.length)
  } else {
    const sumInv = invVols.reduce((s, v, i) => s + (validMask[i] ? v : 0), 0)
    baseWeights = invVols.map((v, i) => (validMask[i] ? v / sumInv : 0))
  }

  const positions: TargetPosition[] = []
  for (let i = 0; i < stockIdx.length; i++) {
    const w = Math.min(baseWeights[i] * exposure, MAX_STOCK_WEIGHT)
    positions.push({ symbol: symbols[stockIdx[i]], weight: w })
  }

  return positions
}
