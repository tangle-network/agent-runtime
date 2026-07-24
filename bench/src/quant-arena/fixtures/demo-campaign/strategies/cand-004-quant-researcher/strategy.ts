type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = { t: number; weights: number[] };

/**
 * ECONOMIC RATIONALE
 * -------------------
 * One effect, harvested two ways: volatility is persistent and heterogeneous across names and
 * across time, while expected returns are not reliably predictable day to day. Two robust,
 * well-documented consequences of that fact:
 *
 *  1. Cross-sectional: weighting stocks inversely to their own trailing volatility (risk parity)
 *     extracts more diversification benefit than equal-weighting, because it does not let the
 *     noisiest names dominate portfolio variance. This should hold in any regime where the 10
 *     names have unequal, imperfectly-correlated volatility — i.e. most of the time.
 *  2. Time-series: realized volatility clusters, so scaling total equity exposure down when
 *     trailing portfolio vol rises above a fixed target de-risks ahead of stress regimes without
 *     forecasting direction (the "volatility-managed portfolio" effect). This should specifically
 *     help in the calm-to-stress transition windows where buy-and-hold and SMA-crossover get hurt.
 *
 * Both are single, few-parameter, regime-agnostic effects (no return forecasting, no curve
 * fitting to dates). Rebalancing only every ~21 trading days keeps turnover — and the 15bps
 * one-way cost — well below the vol-timing edge, which shows up at monthly-or-slower horizons.
 * No leverage is ever taken (scale is capped at 1); the model only ever de-risks toward cash.
 */
export function generateSignals(bars: Bar[][]): Signal[] {
  const numTickers = bars.length;       // 0 = IDX (untraded), 1..10 = S01..S10
  const numStocks = numTickers - 1;
  const numDays = bars[0].length;

  const VOL_LOOKBACK = 63;              // ~1 trading quarter: per-asset & portfolio realized-vol window
  const REBAL_INTERVAL = 21;            // ~monthly cadence: keeps turnover cheap relative to the vol-timing edge
  const TARGET_VOL_ANN = 0.15;          // target annualized portfolio vol; only de-risk when realized vol exceeds it
  const ANNUALIZATION = Math.sqrt(252);
  const MIN_HISTORY = VOL_LOOKBACK + 1;

  const signals: Signal[] = [];

  function logReturn(k: number, t: number): number {
    const prev = bars[k][t - 1].close;
    const cur = bars[k][t].close;
    if (prev <= 0 || cur <= 0) return 0;
    return Math.log(cur / prev);
  }

  let lastRebalance = -Infinity;

  for (let t = MIN_HISTORY; t < numDays; t++) {
    if (t - lastRebalance < REBAL_INTERVAL) continue;

    // Per-asset trailing volatility over [t - VOL_LOOKBACK + 1, t] — uses only data up to t.
    const assetVol: number[] = new Array(numStocks).fill(0);
    let anyValid = false;
    for (let s = 0; s < numStocks; s++) {
      const k = s + 1;
      const rets: number[] = [];
      for (let d = t - VOL_LOOKBACK + 1; d <= t; d++) {
        rets.push(logReturn(k, d));
      }
      const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
      const variance = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length;
      const vol = Math.sqrt(variance);
      assetVol[s] = vol;
      if (vol > 1e-8) anyValid = true;
    }

    if (!anyValid) {
      lastRebalance = t;
      continue;
    }

    // Inverse-volatility (risk-parity) weights across the traded stocks.
    const invVol = assetVol.map(v => (v > 1e-8 ? 1 / v : 0));
    const invVolSum = invVol.reduce((a, b) => a + b, 0);
    const riskParityWeights = invVol.map(v => (invVolSum > 0 ? v / invVolSum : 0));

    // Realized vol of that risk-parity mix, used purely for the exposure-scaling decision below.
    const portRets: number[] = [];
    for (let d = t - VOL_LOOKBACK + 1; d <= t; d++) {
      let dayRet = 0;
      for (let s = 0; s < numStocks; s++) {
        dayRet += riskParityWeights[s] * logReturn(s + 1, d);
      }
      portRets.push(dayRet);
    }
    const portMeanRet = portRets.reduce((a, b) => a + b, 0) / portRets.length;
    const portVar = portRets.reduce((a, b) => a + (b - portMeanRet) * (b - portMeanRet), 0) / portRets.length;
    const portVolAnn = Math.sqrt(portVar) * ANNUALIZATION;

    // Vol targeting: de-lever toward cash when realized vol exceeds target; never lever above 1.
    const scale = portVolAnn > 1e-8 ? Math.min(1, TARGET_VOL_ANN / portVolAnn) : 1;

    const weights = new Array(numTickers).fill(0);
    for (let s = 0; s < numStocks; s++) {
      weights[s + 1] = riskParityWeights[s] * scale;
    }

    signals.push({ t, weights });
    lastRebalance = t;
  }

  return signals;
}
