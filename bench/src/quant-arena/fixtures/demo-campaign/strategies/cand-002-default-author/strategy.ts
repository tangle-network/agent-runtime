type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = { t: number; weights: number[] };

export function generateSignals(bars: Bar[][]): Signal[] {
  const nTickers = bars.length;
  const nDays = bars[0].length;
  const nStocks = nTickers - 1; // exclude index at k=0 (IDX) from direct allocation

  const VOL_LOOKBACK = 20;
  const MOM_LOOKBACK = 40;
  const SMA_FAST = 20;
  const SMA_SLOW = 60;
  const MIN_HISTORY = SMA_SLOW;
  const REBALANCE_INTERVAL = 21;
  const VOL_TARGET = 0.12;
  const TRADE_BAND = 0.04;
  const URGENT_BAND = 0.15;

  const signals: Signal[] = [];
  if (nDays === 0 || nStocks <= 0) return signals;

  const stdev = (rets: number[]): number => {
    const n = rets.length;
    if (n === 0) return 0;
    let mean = 0;
    for (let i = 0; i < n; i++) mean += rets[i];
    mean /= n;
    let v = 0;
    for (let i = 0; i < n; i++) {
      const d = rets[i] - mean;
      v += d * d;
    }
    return Math.sqrt(v / n);
  };

  const sma = (k: number, t: number, period: number): number => {
    let s = 0;
    for (let i = t - period + 1; i <= t; i++) s += bars[k][i].close;
    return s / period;
  };

  let lastWeights: number[] | null = null;
  let lastTradeT = -Infinity;

  for (let t = 0; t < nDays; t++) {
    let target: number[] | null = null;

    if (t === 0) {
      target = new Array(nTickers).fill(0);
      for (let k = 1; k <= nStocks; k++) target[k] = 1 / nStocks;
    } else if (t >= MIN_HISTORY) {
      const fast = sma(0, t, SMA_FAST);
      const slow = sma(0, t, SMA_SLOW);
      const uptrend = fast >= slow;
      const regimeScale = uptrend ? 1.0 : 0.5;

      const stats: { k: number; mom: number; vol: number }[] = [];
      for (let k = 1; k <= nStocks; k++) {
        const closes = bars[k];
        const c0 = closes[t - MOM_LOOKBACK].close;
        const c1 = closes[t].close;
        const mom = c0 > 0 ? c1 / c0 - 1 : 0;

        const rets: number[] = [];
        for (let i = t - VOL_LOOKBACK + 1; i <= t; i++) {
          const prev = closes[i - 1].close;
          rets.push(prev > 0 ? closes[i].close / prev - 1 : 0);
        }
        const vol = stdev(rets);
        stats.push({ k, mom, vol });
      }

      let pool = stats.filter((s) => s.mom > 0);
      if (pool.length === 0) pool = stats;

      const invVols = pool.map((s) => 1 / Math.max(s.vol, 1e-4));
      const sumInv = invVols.reduce((a, b) => a + b, 0);
      const rawWeights = pool.map((_, i) => invVols[i] / sumInv);

      let weightedVol = 0;
      for (let i = 0; i < pool.length; i++) weightedVol += rawWeights[i] * pool[i].vol;
      const annVol = weightedVol * Math.sqrt(252);
      let volScale = annVol > 0 ? VOL_TARGET / annVol : 1;
      volScale = Math.min(volScale, 1);
      volScale = Math.max(volScale, 0);

      const combinedScale = Math.min(regimeScale, volScale);

      target = new Array(nTickers).fill(0);
      for (let i = 0; i < pool.length; i++) {
        target[pool[i].k] = rawWeights[i] * combinedScale;
      }
    }

    if (target === null) continue;

    if (lastWeights === null) {
      signals.push({ t, weights: target });
      lastWeights = target;
      lastTradeT = t;
      continue;
    }

    let l1 = 0;
    for (let k = 0; k < nTickers; k++) l1 += Math.abs(target[k] - lastWeights[k]);

    const scheduled = t - lastTradeT >= REBALANCE_INTERVAL;
    const urgent = l1 >= URGENT_BAND;
    const worthTrading = l1 >= TRADE_BAND;

    if ((scheduled && worthTrading) || urgent) {
      signals.push({ t, weights: target });
      lastWeights = target;
      lastTradeT = t;
    }
  }

  return signals;
}
