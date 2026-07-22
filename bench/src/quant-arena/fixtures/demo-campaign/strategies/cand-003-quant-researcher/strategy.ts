type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = { t: number; weights: number[] };

// ECONOMIC RATIONALE (one compound "regime quality" effect on a long-only equal-weight basket):
//
// 1) TREND BREADTH: capital is deployed in proportion to the fraction of the 10 names
//    trading above their own trailing moving average. Broad participation in an uptrend
//    is a well-documented leading indicator of continuation; breadth deteriorates BEFORE
//    and DURING systemic drawdowns (fewer names hold their trend as a selloff spreads),
//    so scaling exposure by breadth cuts risk ahead of/through the worst stretches without
//    ever forecasting direction or shorting.
//
// 2) VOLATILITY TARGETING: equity returns cluster in volatility, and the conditional
//    Sharpe ratio is empirically lower in high-vol regimes than in calm ones. Scaling
//    exposure by (target vol / realized vol) keeps risk roughly constant through time,
//    which mechanically improves the risk-adjusted return by underweighting exactly the
//    stretches where the same dollar of exposure buys worse risk-adjusted payoff.
//
// Both signals are pure regime-quality throttles on ONE equal-weight book (no stock
// picking, no shorting, no leverage - final scalar in [0,1]). They are combined
// multiplicatively so the book only runs near-full size when trend AND vol conditions are
// both benign, and de-risks fast (toward cash) when either deteriorates. A rebalance band
// plus a minimum holding gap keep trading infrequent so 15bps one-way cost cannot eat the
// edge - this strategy trades on regime shifts, not on daily noise.
export function generateSignals(bars: Bar[][]): Signal[] {
  const numTickers = bars.length;
  const numStocks = numTickers - 1;
  const numDays = bars[0].length;

  const TREND_SMA = 100;      // trailing window defining "in an uptrend" per stock
  const VOL_LOOKBACK = 20;    // trailing window for realized-vol estimate of the basket
  const TARGET_VOL = 0.15;    // annualized vol target for the invested basket
  const REBAL_BAND = 0.08;    // min change in target exposure to justify paying the spread
  const MIN_GAP_DAYS = 5;     // minimum days between rebalances, avoids whipsaw churn

  const signals: Signal[] = [];

  const closeWindows: number[][] = [];
  const closeSums: number[] = [];
  for (let k = 0; k < numTickers; k++) {
    closeWindows.push([]);
    closeSums.push(0);
  }

  const basketReturns: number[] = [];

  let lastScalar = -1;
  let lastSignalDay = -Infinity;

  for (let t = 0; t < numDays; t++) {
    for (let k = 1; k < numTickers; k++) {
      const c = bars[k][t].close;
      closeWindows[k].push(c);
      closeSums[k] += c;
      if (closeWindows[k].length > TREND_SMA) {
        closeSums[k] -= closeWindows[k].shift() as number;
      }
    }

    if (t >= 1) {
      let sumRet = 0;
      for (let k = 1; k < numTickers; k++) {
        const prev = bars[k][t - 1].close;
        const cur = bars[k][t].close;
        sumRet += prev > 0 ? (cur - prev) / prev : 0;
      }
      basketReturns.push(sumRet / numStocks);
      if (basketReturns.length > VOL_LOOKBACK) basketReturns.shift();
    }

    const trendReady = closeWindows[1].length >= TREND_SMA;
    const volReady = basketReturns.length >= VOL_LOOKBACK;
    if (!trendReady || !volReady) continue;

    let above = 0;
    for (let k = 1; k < numTickers; k++) {
      const sma = closeSums[k] / closeWindows[k].length;
      if (bars[k][t].close > sma) above++;
    }
    const breadth = above / numStocks;

    const mean = basketReturns.reduce((a, b) => a + b, 0) / basketReturns.length;
    const variance =
      basketReturns.reduce((a, b) => a + (b - mean) * (b - mean), 0) / basketReturns.length;
    const annualizedVol = Math.sqrt(variance) * Math.sqrt(252);
    const volScalar =
      annualizedVol > 1e-8 ? Math.max(0, Math.min(1, TARGET_VOL / annualizedVol)) : 1;

    const scalar = Math.max(0, Math.min(1, breadth * volScalar));

    const daysSinceLast = t - lastSignalDay;
    const moved = Math.abs(scalar - lastScalar) >= REBAL_BAND;

    if (lastScalar < 0 || (moved && daysSinceLast >= MIN_GAP_DAYS)) {
      const weights = new Array(numTickers).fill(0);
      const perStock = scalar / numStocks;
      for (let k = 1; k < numTickers; k++) weights[k] = perStock;
      signals.push({ t, weights });
      lastScalar = scalar;
      lastSignalDay = t;
    }
  }

  return signals;
}
