import { describe, expect, it } from 'vitest'
import { runBacktest } from './backtest.ts'
import { generateSignalsFromStrategy, runIncremental, strategyFromGenerateSignals } from './driver.ts'
import { truncationInvariance } from './leak-audit.ts'
import { rebalance, targetsToWeights } from './oms.ts'
import { generateSignals as buyHold } from './strategies/buy-hold-index/strategy.ts'
import { generateSignals as equalWeight } from './strategies/equal-weight/strategy.ts'
import { generateSignals as smaCrossover } from './strategies/sma-crossover/strategy.ts'
import type { Bar, Signal, Strategy, StrategyContext } from './types.ts'

/** Deterministic wiggly price path (no RNG — reproducible). */
function syntheticBars(n: number, tickers: number): Bar[][] {
  return Array.from({ length: tickers }, (_, k) =>
    Array.from({ length: n }, (_, t) => {
      const close = 100 + 10 * Math.sin(t / 7 + k) + 0.05 * t
      const open = 100 + 10 * Math.sin((t - 0.5) / 7 + k) + 0.05 * t
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

const symbolsFor = (bars: Bar[][]): string[] => bars.map((_, k) => (k === 0 ? 'IDX' : `T${k}`))
const config = (bars: Bar[][]) => ({ costBps: 10, slippageBps: 5, symbols: symbolsFor(bars) })

describe('runIncremental — structural history visibility', () => {
  const bars = syntheticBars(120, 3)

  it('every onBar call sees exactly bars[0..t] and nothing beyond', () => {
    let calls = 0
    const spy: Strategy = {
      onBar(ctx: StrategyContext) {
        calls++
        for (let k = 0; k < ctx.history.length; k++) {
          expect(ctx.history[k]!.length).toBe(ctx.t + 1)
          // The future is ABSENT, not merely guarded.
          expect(ctx.history[k]![ctx.t + 1]).toBeUndefined()
          expect(ctx.history[k]![ctx.t]!.date).toBe(bars[k]![ctx.t]!.date)
        }
        return null
      },
    }
    runIncremental(bars, spy, config(bars))
    expect(calls).toBe(120)
  })

  it('driver equity path is bit-identical to runBacktest on the collected decisions', () => {
    const strategy = strategyFromGenerateSignals(smaCrossover)
    const run = runIncremental(bars, strategy, config(bars))
    const reference = runBacktest(bars, run.decisions, { costBps: 10, slippageBps: 5 })
    expect(run.equityByDay.length).toBe(reference.equity.length)
    for (let t = 0; t < run.equityByDay.length; t++) {
      expect(run.equityByDay[t]).toBe(reference.equity[t])
    }
  })

  it('ctx.weights and ctx.equity reflect the drifted portfolio', () => {
    const seen: Array<{ t: number; equity: number; weightSum: number }> = []
    const holdIndex: Strategy = {
      onBar(ctx) {
        seen.push({ t: ctx.t, equity: ctx.equity, weightSum: ctx.weights.reduce((s, w) => s + w, 0) })
        return ctx.t === 0 ? [{ symbol: 'IDX', weight: 1 }] : null
      },
    }
    const run = runIncremental(bars, holdIndex, config(bars))
    expect(seen[0]!.equity).toBe(1)
    expect(seen[0]!.weightSum).toBe(0) // all cash before the first fill
    // After the t=0 decision fills at t=1's open, the book is ~fully invested.
    expect(seen[1]!.weightSum).toBeGreaterThan(0.99)
    expect(run.decisions).toEqual([{ t: 0, weights: [1, 0, 0] }])
  })

  it('a decision on the final bar is recorded but produces no fill', () => {
    const lastBarOnly: Strategy = {
      onBar(ctx) {
        return ctx.t === bars[0]!.length - 1 ? [{ symbol: 'IDX', weight: 1 }] : null
      },
    }
    const run = runIncremental(bars, lastBarOnly, config(bars))
    expect(run.decisions.length).toBe(1)
    expect(run.equityByDay.every((e) => e === 1)).toBe(true) // never traded
  })

  it('fail-closed on contract violations from onBar', () => {
    const short: Strategy = { onBar: () => [{ symbol: 'IDX', weight: -0.2 }] }
    expect(() => runIncremental(bars, short, config(bars))).toThrow(/long-only|negative/)
    const levered: Strategy = {
      onBar: () => [
        { symbol: 'IDX', weight: 0.8 },
        { symbol: 'T1', weight: 0.5 },
      ],
    }
    expect(() => runIncremental(bars, levered, config(bars))).toThrow(/sum.*> 1/)
    const unknown: Strategy = { onBar: () => [{ symbol: 'NOPE', weight: 0.5 }] }
    expect(() => runIncremental(bars, unknown, config(bars))).toThrow(/unknown symbol/)
  })
})

describe('batch-compat shim — the 3 pinned baselines run unchanged', () => {
  const bars = syntheticBars(400, 4)

  for (const [name, generateSignals] of [
    ['buy-hold-index', buyHold],
    ['equal-weight', equalWeight],
    ['sma-crossover', smaCrossover],
  ] as const) {
    it(`${name}: incremental drive reproduces the batch signals exactly`, () => {
      const batch = generateSignals(bars)
      const incremental = generateSignalsFromStrategy(strategyFromGenerateSignals(generateSignals))(bars)
      expect(incremental).toEqual(batch)
    })
  }
})

describe('leak audit under the v2 harness', () => {
  const bars = syntheticBars(400, 3)

  /** Deliberately leaky: sizes today's weight by TOMORROW's return (same
   *  fixture class as leak-audit.test.mts, which keeps guarding the v1 path). */
  const peekAhead = (input: Bar[][]): Signal[] => {
    const T = input[0]!.length
    const signals: Signal[] = []
    for (let t = 0; t < T - 1; t++) {
      const up = input[0]![t + 1]!.close > input[0]![t]!.close
      signals.push({ t, weights: input.map((_, k) => (k === 0 && up ? 1 : 0)) })
    }
    return signals
  }

  /** Leaky via whole-series statistics over the FULL sample. */
  const fullSampleMax = (input: Bar[][]): Signal[] => {
    const maxClose = Math.max(...input[0]!.map((b) => b.close))
    const T = input[0]!.length
    const signals: Signal[] = []
    for (let t = 0; t < T; t++) {
      signals.push({ t, weights: input.map((_, k) => (k === 0 ? input[0]![t]!.close / maxClose : 0)) })
    }
    return signals
  }

  it('v1 truncation audit still catches both leaky strategies as written', () => {
    expect(truncationInvariance(peekAhead, bars, { warmupDays: 50 }).clean).toBe(false)
    expect(truncationInvariance(fullSampleMax, bars, { warmupDays: 50 }).clean).toBe(false)
  })

  it('the incremental harness neutralizes the batch peek-ahead (its signal can never fire)', () => {
    // Under the driver the shim hands the strategy TRUNCATED history: the
    // peek-ahead can only emit a signal for day t once it has seen t+1, so
    // "today's" signal never exists at decision time — zero trades, leak
    // structurally neutralized (and still caught as written by the v1 audit).
    const run = runIncremental(bars, strategyFromGenerateSignals(peekAhead), config(bars))
    expect(run.decisions).toEqual([])
    expect(run.orders).toEqual([])
  })

  it('a v2-native strategy reaching past today crashes on absent data — fail-closed', () => {
    const v2Peeker: Strategy = {
      onBar(ctx) {
        // ctx.history physically ends at today; tomorrow is undefined.
        const up = ctx.history[0]![ctx.t + 1]!.close > ctx.history[0]![ctx.t]!.close
        return up ? [{ symbol: 'IDX', weight: 1 }] : null
      },
    }
    expect(() => runIncremental(bars, v2Peeker, config(bars))).toThrow()
  })

  it('the incremental harness defuses whole-series leaks into causal decisions', () => {
    // Driven bar-by-bar, "max over the whole series" becomes "max up to
    // today": different decisions than the batch run, but causal — the
    // truncation audit on the DRIVEN strategy is clean by construction.
    const driven = generateSignalsFromStrategy(strategyFromGenerateSignals(fullSampleMax))
    expect(truncationInvariance(driven, bars, { warmupDays: 50 }).clean).toBe(true)
    expect(driven(bars)).not.toEqual(fullSampleMax(bars))
  })
})

describe('oms — the shared rebalancer', () => {
  it('targetsToWeights expands sparse targets and enforces the contract', () => {
    const symbols = ['IDX', 'A', 'B']
    expect(targetsToWeights([{ symbol: 'A', weight: 0.6 }], symbols)).toEqual([0, 0.6, 0])
    expect(() => targetsToWeights([{ symbol: 'A', weight: 0.6 }, { symbol: 'A', weight: 0.1 }], symbols)).toThrow(
      /twice/,
    )
    expect(() => targetsToWeights([{ symbol: 'A', weight: Number.NaN }], symbols)).toThrow(/non-finite/)
  })

  it('sizes orders LEAN-style: qty = (targetWeight * equity - positionValue) / price', () => {
    const orders = rebalance({
      targets: [
        { symbol: 'A', weight: 0.5 },
        { symbol: 'B', weight: 0 },
      ],
      symbols: ['IDX', 'A', 'B'],
      equity: 2,
      prices: [100, 50, 20],
      positionValues: [0, 0.5, 0.5],
      t: 42,
      tag: 'cand-x',
    })
    expect(orders).toEqual([
      // buy A: (0.5 * 2 - 0.5) / 50 = 0.01 shares
      { clientOrderId: 'qa-t42-A', symbol: 'A', side: 'buy', qty: 0.01, type: 'market', tif: 'day', tag: 'cand-x' },
      // sell B to flat: 0.5 / 20 = 0.025 shares
      { clientOrderId: 'qa-t42-B', symbol: 'B', side: 'sell', qty: 0.025, type: 'market', tif: 'day', tag: 'cand-x' },
    ])
  })

  it('suppresses dust and emits nothing on a no-op rebalance', () => {
    const orders = rebalance({
      targets: [{ symbol: 'A', weight: 0.5 }],
      symbols: ['IDX', 'A'],
      equity: 1,
      prices: [100, 50],
      positionValues: [0, 0.5],
      t: 7,
    })
    expect(orders).toEqual([])
  })

  it('order ids are deterministic per (t, symbol)', () => {
    const make = () =>
      rebalance({
        targets: [{ symbol: 'A', weight: 0.3 }],
        symbols: ['IDX', 'A'],
        equity: 1,
        prices: [100, 50],
        positionValues: [0, 0],
        t: 9,
      })
    expect(make()).toEqual(make())
    expect(make()[0]!.clientOrderId).toBe('qa-t9-A')
  })

  it('strategies cannot smuggle orders: only weights cross the seam', () => {
    // The driver hands onBar's return value to targetsToWeights, which
    // rejects anything that is not {symbol, weight} rows summing sanely.
    const bars = syntheticBars(30, 2)
    const smuggler = {
      onBar: () => [{ symbol: 'IDX', weight: 0.5, side: 'buy', qty: 999 }],
    } as unknown as Strategy
    // Extra fields are ignored — the OMS reads ONLY symbol + weight; the
    // emitted order comes out of the shared sizing rule, not the strategy.
    const run = runIncremental(bars, smuggler, { costBps: 10, slippageBps: 5, symbols: ['IDX', 'T1'] })
    expect(run.orders.every((o) => o.qty < 1)).toBe(true)
    expect(run.orders[0]!.clientOrderId).toMatch(/^qa-t0-IDX$/)
  })
})
