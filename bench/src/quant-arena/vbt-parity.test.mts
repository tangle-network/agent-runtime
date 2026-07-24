/**
 * PARITY CI: the TS reference engine (backtest.ts) and the official vectorbt
 * scorer (python/vbt-worker.py) must agree on golden fixtures under the
 * aligned fill model (decide at close t, fill at t+1's open, bps fees +
 * slippage charged on traded dollars).
 *
 * Measured tolerance regimes (see the fully-invested note below):
 *  - no-trade: EXACT (both curves are flat 1.0);
 *  - any book holding a cash buffer >= accumulated fees: machine epsilon
 *    (measured ~2e-15 max relative diff over 300 days);
 *  - fully-invested books (weights sum to exactly 1): ~2e-3, a REAL model
 *    difference, not noise — the TS engine finances fees at 0% by letting
 *    cash go slightly negative, while vectorbt refuses negative cash and
 *    buys marginally less. vectorbt is the economically conservative side
 *    and is the official scorer; the TS engine remains prefilter-only.
 *
 * When a fixture disagrees, the failure output prints both curves' tails.
 *
 * Requires `uv` on PATH (python/uv.lock pins the worker env); otherwise the
 * suite is SKIPPED with that reason — the seam under test is still real.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runBacktest, statsForRange } from './backtest.ts'
import { generateSignalsFromStrategy, runIncremental, strategyFromGenerateSignals } from './driver.ts'
import { generateSignals as smaCrossover } from './strategies/sma-crossover/strategy.ts'
import { scoreSignals, VbtWorker, type VbtScore } from './vbt-client.ts'
import type { Bar, Signal } from './types.ts'

const vbtAvailable = VbtWorker.isAvailable()

function syntheticBars(n: number, tickers: number): Bar[][] {
  return Array.from({ length: tickers }, (_, k) =>
    Array.from({ length: n }, (_, t) => {
      const close = 100 + 10 * Math.sin(t / 7 + k) + 0.05 * t + 3 * Math.sin(t / 23 + 2 * k)
      const open = 100 + 10 * Math.sin((t - 0.5) / 7 + k) + 0.05 * t + 3 * Math.sin((t - 0.5) / 23 + 2 * k)
      return {
        date: `d${String(t).padStart(4, '0')}`,
        open,
        high: Math.max(open, close) + 1,
        low: Math.min(open, close) - 1,
        close,
        volume: 1000,
      }
    }),
  )
}

const BT = { costBps: 10, slippageBps: 5 }

/** Assert two equity curves agree; on violation print both tails first. */
function expectCurveParity(tsEquity: number[], vbtEquity: number[], relTol: number, label: string): void {
  expect(vbtEquity.length).toBe(tsEquity.length)
  let worst = 0
  let worstAt = -1
  for (let t = 0; t < tsEquity.length; t++) {
    const rel = Math.abs(tsEquity[t]! - vbtEquity[t]!) / Math.abs(tsEquity[t]!)
    if (rel > worst) {
      worst = rel
      worstAt = t
    }
  }
  if (worst > relTol) {
    const tail = (curve: number[]) => curve.slice(-10).map((v) => v.toFixed(10)).join(', ')
    console.error(
      `PARITY FAILURE [${label}]: max relative diff ${worst.toExponential(3)} at t=${worstAt} (tol ${relTol})\n` +
        `  TS  tail: ${tail(tsEquity)}\n` +
        `  VBT tail: ${tail(vbtEquity)}`,
    )
  }
  expect(worst, `${label}: max relative equity diff (worst at t=${worstAt})`).toBeLessThanOrEqual(relTol)
}

describe.skipIf(!vbtAvailable)('TS engine vs vectorbt worker parity (golden fixtures)', () => {
  let worker: VbtWorker

  beforeAll(async () => {
    worker = new VbtWorker()
    await worker.ping() // pay the cold-JIT warmup once, up front
  }, 240_000)

  afterAll(async () => {
    await worker.close()
  })

  async function compare(
    label: string,
    bars: Bar[][],
    signals: Signal[],
    relTol: number,
  ): Promise<{ ts: ReturnType<typeof runBacktest>; vbt: VbtScore }> {
    const T = bars[0]!.length
    const windows: Array<[number, number]> = [
      [0, T],
      [Math.floor(T / 4), Math.floor(T / 2)],
    ]
    const ts = runBacktest(bars, signals, BT)
    const vbt = await scoreSignals(worker, bars, signals, BT, windows)
    expectCurveParity(ts.equity, vbt.equity, relTol, label)
    // Window stats derive from the curves with the SAME formulas both sides,
    // so they inherit the curve tolerance: compare RELATIVELY (Sharpe can be
    // O(30) in magnitude on synthetic fixtures — digit-based closeness lies).
    const statTol = relTol === 0 ? 1e-12 : Math.max(relTol * 10, 1e-11)
    const expectRelClose = (actual: number, wanted: number, what: string): void => {
      const rel = Math.abs(actual - wanted) / Math.max(1, Math.abs(wanted))
      expect(rel, `${label}/${what}: vbt=${actual} ts=${wanted}`).toBeLessThanOrEqual(statTol)
    }
    for (const [i, [start, end]] of windows.entries()) {
      const tsStats = statsForRange(ts, start, end)
      const vbtStats = vbt.windows[i]!
      expectRelClose(vbtStats.totalReturn, tsStats.totalReturn, `w${i}.totalReturn`)
      expectRelClose(vbtStats.maxDD, tsStats.maxDrawdown, `w${i}.maxDD`)
      expectRelClose(vbtStats.sharpe, tsStats.sharpe, `w${i}.sharpe`)
      expect(vbtStats.trades).toBe(tsStats.tradeCount)
    }
    return { ts, vbt }
  }

  it('golden 1 — no-trade: both curves are exactly flat at 1', { timeout: 120_000 }, async () => {
    const bars = syntheticBars(300, 3)
    const { ts, vbt } = await compare('no-trade', bars, [], 0)
    expect(ts.equity.every((e) => e === 1)).toBe(true)
    expect(vbt.equity.every((e) => e === 1)).toBe(true)
    expect(vbt.full.trades).toBe(0)
  })

  it('golden 2 — high-turnover daily flip (2% cash buffer): machine-epsilon parity', { timeout: 120_000 }, async () => {
    const bars = syntheticBars(300, 3)
    const flip: Signal[] = []
    for (let t = 10; t < 290; t++) flip.push({ t, weights: t % 2 === 0 ? [0, 0.98, 0] : [0, 0, 0.98] })
    const { vbt } = await compare('high-turnover-98', bars, flip, 1e-12)
    expect(vbt.full.trades).toBeGreaterThan(500)
  })

  it('golden 3 — sma-crossover, 5 tickers (fully invested): documented fee-financing tolerance', { timeout: 120_000 }, async () => {
    const bars = syntheticBars(500, 5)
    await compare('sma-crossover', bars, smaCrossover(bars), 5e-3)
  })

  it('golden 4 — monthly partial-invest book: machine-epsilon parity', { timeout: 120_000 }, async () => {
    const bars = syntheticBars(300, 3)
    const monthly: Signal[] = []
    for (let t = 0; t < 300; t += 21) monthly.push({ t, weights: [0.2, 0.3, 0.3] })
    await compare('monthly-partial', bars, monthly, 1e-12)
  })

  it('golden 5 — the v2 demo candidate (authored via onBar) scores identically through the driver', { timeout: 120_000 }, async () => {
    const mod = await import('./fixtures/demo-campaign-v2/strategies/cand-001-quant-researcher/strategy.ts')
    const bars = syntheticBars(500, 5)
    const symbols = bars.map((_, k) => (k === 0 ? 'IDX' : `T${String(k).padStart(2, '0')}`))
    const strategy = { onBar: mod.onBar }
    const signals = generateSignalsFromStrategy(strategy, { symbols, ...BT })(bars)
    await compare('v2-demo-candidate', bars, signals, 5e-3)
    // The driver's own equity path also matches the TS reference engine.
    const run = runIncremental(bars, strategy, { ...BT, symbols })
    const reference = runBacktest(bars, run.decisions, BT)
    for (let t = 0; t < run.equityByDay.length; t++) {
      expect(run.equityByDay[t]).toBe(reference.equity[t])
    }
  })

  it('crash-restart: a killed worker settles in-flight requests and the retry succeeds', { timeout: 240_000 }, async () => {
    const own = new VbtWorker()
    try {
      await own.ping()
      // Reach into the client to kill the child mid-session (test-only).
      const child = (own as unknown as { child: { kill(sig: string): void } | null }).child
      expect(child).not.toBeNull()
      child!.kill('SIGKILL')
      // score() retries once across the crash: respawn + re-issue.
      const bars = syntheticBars(60, 2)
      const vbt = await scoreSignals(own, bars, [{ t: 5, weights: [0.5, 0.3] }], BT, [[0, 60]])
      expect(vbt.equity.length).toBe(60)
      expect(vbt.full.trades).toBe(2)
    } finally {
      await own.close()
    }
  })
})

describe.skipIf(vbtAvailable)('vectorbt worker unavailable', () => {
  it.skip('skipped: `uv` not on PATH or python/uv.lock missing — parity fixtures need the pinned worker env', () => {})
})
