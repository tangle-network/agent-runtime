type Bar = { date: string; open: number; high: number; low: number; close: number; volume: number };
type Signal = { t: number; weights: number[] };

export function generateSignals(bars: Bar[][]): Signal[] {
  const N = bars.length;
  const T = bars[0].length;

  const SHORT_LB = 20;
  const LONG_LB = 80;
  const VOL_LB = 40;
  const MIN_AVAIL = 25;
  const REBAL_EVERY = 5;
  const CHANGE_THRESHOLD = 0.05;
  const MAX_WEIGHT = 0.30;
  const TARGET_VOL = 0.15;
  const MAX_GROSS = 0.95;
  const MIN_SCALE = 0.15;
  const TRADING_DAYS = 252;

  const closesByTicker: number[][] = bars.map((series) => series.map((b) => b.close));

  function smaAt(closes: number[], t: number, lb: number): number {
    const start = Math.max(0, t - lb + 1);
    let s = 0;
    let n = 0;
    for (let i = start; i <= t; i++) {
      s += closes[i];
      n++;
    }
    return n > 0 ? s / n : NaN;
  }

  function annualizedVol(closes: number[], t: number, lb: number): number {
    const start = Math.max(1, t - lb + 1);
    const rets: number[] = [];
    for (let i = start; i <= t; i++) {
      const prev = closes[i - 1];
      const cur = closes[i];
      if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
    }
    if (rets.length < 2) return NaN;
    let m = 0;
    for (const r of rets) m += r;
    m /= rets.length;
    let v = 0;
    for (const r of rets) v += (r - m) * (r - m);
    v /= (rets.length - 1);
    return Math.sqrt(v) * Math.sqrt(TRADING_DAYS);
  }

  const signals: Signal[] = [];
  let lastWeights: number[] = new Array(N).fill(0);

  for (let t = 0; t < T; t++) {
    const avail = t + 1;
    if (avail < MIN_AVAIL || t % REBAL_EVERY !== 0) continue;

    const shortLb = Math.min(SHORT_LB, avail);
    const longLb = Math.min(LONG_LB, avail);
    const volLb = Math.min(VOL_LB, avail - 1);

    const weights: number[] = new Array(N).fill(0);
    const eligible: number[] = [];
    const invVol: number[] = new Array(N).fill(0);

    for (let k = 0; k < N; k++) {
      const closes = closesByTicker[k];
      const price = closes[t];
      const smaShort = smaAt(closes, t, shortLb);
      const smaLong = smaAt(closes, t, longLb);
      const vol = annualizedVol(closes, t, volLb);
      const trendUp = Number.isFinite(smaShort) && Number.isFinite(smaLong) && price > smaLong && smaShort > smaLong;
      if (trendUp && Number.isFinite(vol) && vol > 1e-6) {
        eligible.push(k);
        invVol[k] = 1 / vol;
      }
    }

    if (eligible.length > 0) {
      const sumInv = eligible.reduce((s, k) => s + invVol[k], 0);
      for (const k of eligible) weights[k] = invVol[k] / sumInv;

      for (let iter = 0; iter < 5; iter++) {
        let excess = 0;
        const uncapped: number[] = [];
        for (const k of eligible) {
          if (weights[k] > MAX_WEIGHT) {
            excess += weights[k] - MAX_WEIGHT;
            weights[k] = MAX_WEIGHT;
          } else {
            uncapped.push(k);
          }
        }
        if (excess <= 1e-9 || uncapped.length === 0) break;
        const add = excess / uncapped.length;
        for (const k of uncapped) weights[k] += add;
      }

      let basketVolSum = 0;
      for (const k of eligible) basketVolSum += 1 / invVol[k];
      const basketVol = basketVolSum / eligible.length;
      let scale = basketVol > 0 ? TARGET_VOL / basketVol : MIN_SCALE;
      if (!Number.isFinite(scale)) scale = MIN_SCALE;
      scale = Math.max(MIN_SCALE, Math.min(1, scale));

      for (const k of eligible) weights[k] *= scale * MAX_GROSS;
    }

    let diff = 0;
    for (let k = 0; k < N; k++) diff += Math.abs(weights[k] - lastWeights[k]);

    if (diff > CHANGE_THRESHOLD) {
      signals.push({ t, weights: weights.slice() });
      lastWeights = weights;
    }
  }

  return signals;
}
