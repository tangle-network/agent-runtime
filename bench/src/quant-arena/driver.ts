/**
 * Incremental strategy driver — the v2 harness. Feeds a `Strategy` one bar
 * at a time and enforces history visibility STRUCTURALLY: before every
 * `onBar(ctx)` call the bar arrays are physically sliced to `[0..t]`, so
 * data after the decision day does not exist in anything the strategy can
 * reach. (A Proxy that throws on out-of-range reads was the alternative;
 * slicing was chosen because it is simpler, allocation-cheap at this scale
 * — slices copy references, not bars — and gives the harder guarantee:
 * future bars are ABSENT, not merely guarded. The truncation leak audit
 * stays in place on top of this as defense in depth, and because the v1
 * batch contract can still leak.)
 *
 * Portfolio state shown to the strategy (ctx.weights / ctx.equity) evolves
 * under EXACTLY the engine's execution model (see backtest.ts): a decision
 * at the close of day t fills at day t+1's open, fees in bps of traded
 * dollars, positions drift in between. `driver.test.mts` asserts the
 * driver's equity path is bit-identical to `runBacktest` on the collected
 * decisions.
 *
 * Outputs per run:
 *  - `decisions` — the decision record [(t, weights)], one row per rebalance;
 *    this is what the scorers (vectorbt worker, TS prefilter) consume.
 *  - `orders` — the OMS order stream produced by the SHARED rebalancer
 *    (oms.ts) from those decisions. Strategies never emit orders.
 *  - `equityByDay` — the driver's own equity path (close-marked).
 */

import { pathToFileURL } from 'node:url'
import { assertAligned } from './backtest.ts'
import { rebalance, targetsToWeights } from './oms.ts'
import type { Bar, GenerateSignals, Order, Signal, Strategy, StrategyContext, TargetPosition } from './types.ts'

export interface DriverConfig {
  /** One-way transaction cost, basis points of traded dollars. */
  costBps: number
  /** One-way slippage, basis points of traded dollars. */
  slippageBps: number
  /** Universe tickers; symbols[0] is the index. Length must match bars. */
  symbols: string[]
  /** Provenance tag stamped on every order (e.g. the candidate id). */
  tag?: string
}

export interface DriverRun {
  /** The decision record: one Signal per rebalance, in day order. */
  decisions: Signal[]
  /** OMS orders from the shared rebalancer, in emission order. */
  orders: Order[]
  /** Equity at each day's close under the engine's execution model. */
  equityByDay: number[]
}

export function runIncremental(bars: Bar[][], strategy: Strategy, config: DriverConfig): DriverRun {
  assertAligned(bars)
  const N = bars.length
  if (config.symbols.length !== N) {
    throw new Error(`driver: ${config.symbols.length} symbols for ${N} bar series`)
  }
  if (typeof strategy?.onBar !== 'function') {
    throw new Error('driver: strategy does not implement onBar(ctx)')
  }
  const T = bars[0]!.length
  const feeRate = (config.costBps + config.slippageBps) / 10_000

  const decisions: Signal[] = []
  const orders: Order[] = []
  const equityByDay: number[] = new Array(T).fill(0)
  let cash = 1
  const pos: number[] = new Array(N).fill(0)
  /** Weights of the decision made at day t-1, pending its fill at t's open. */
  let pendingFill: number[] | null = null

  for (let t = 0; t < T; t++) {
    if (t > 0) {
      // Overnight: yesterday's close -> today's open (same as backtest.ts).
      for (let k = 0; k < N; k++) {
        pos[k] = pos[k]! * (bars[k]![t]!.open / bars[k]![t - 1]!.close)
      }
      if (pendingFill !== null) {
        let equityOpen = cash
        for (let k = 0; k < N; k++) equityOpen += pos[k]!
        if (equityOpen <= 0) throw new Error(`driver: equity wiped out at t=${t}`)
        let traded = 0
        for (let k = 0; k < N; k++) {
          const desired = pendingFill[k]! * equityOpen
          const delta = desired - pos[k]!
          traded += Math.abs(delta)
          cash -= delta
          pos[k] = desired
        }
        cash -= traded * feeRate
        pendingFill = null
      }
      // Intraday: today's open -> today's close.
      for (let k = 0; k < N; k++) {
        pos[k] = pos[k]! * (bars[k]![t]!.close / bars[k]![t]!.open)
      }
    }
    let equity = cash
    for (let k = 0; k < N; k++) equity += pos[k]!
    equityByDay[t] = equity

    // Decision time: the close of day t. History is physically truncated.
    const ctx: StrategyContext = {
      symbols: config.symbols,
      t,
      history: bars.map((series) => series.slice(0, t + 1)),
      weights: pos.map((p) => (equity > 0 ? p / equity : 0)),
      equity,
    }
    const targets = strategy.onBar(ctx)
    if (targets === null || targets === undefined) continue
    if (!Array.isArray(targets)) {
      throw new Error(`driver: onBar at t=${t} returned ${typeof targets} — expected TargetPosition[] or null`)
    }
    const weights = targetsToWeights(targets, config.symbols)
    decisions.push({ t, weights })
    const prices = bars.map((series) => series[t]!.close)
    orders.push(
      ...rebalance({
        targets,
        symbols: config.symbols,
        equity,
        prices,
        positionValues: [...pos],
        t,
        ...(config.tag !== undefined ? { tag: config.tag } : {}),
      }),
    )
    if (t < T - 1) pendingFill = weights
    // A decision on the final bar is recorded but can never fill — the same
    // truth the batch engine encodes by never reading fills for t = T-1.
  }

  return { decisions, orders, equityByDay }
}

// ---------------------------------------------------------------------------
// Batch-compat shims.
// ---------------------------------------------------------------------------

/** Wrap a v1 batch strategy (`generateSignals`) as a v2 `Strategy` so the
 *  pinned baselines and legacy fixtures run UNCHANGED under the incremental
 *  harness. At every bar the batch function sees only the truncated history
 *  (the structural guarantee applies to it too) and the shim emits the
 *  signal it produced for today, if any.
 *
 *  Note the intended consequence: a batch strategy that leaks through
 *  whole-series statistics computes them over the TRUNCATED history here,
 *  i.e. the shim converts that leak into a causal (if different) strategy.
 *  The v1 truncation audit on the raw `generateSignals` remains the guard
 *  that catches such code as written. */
export function strategyFromGenerateSignals(generateSignals: GenerateSignals): Strategy {
  return {
    onBar(ctx: StrategyContext): TargetPosition[] | null {
      const signals = generateSignals(ctx.history)
      const today = signals.filter((s) => s.t === ctx.t)
      if (today.length === 0) return null
      if (today.length > 1) throw new Error(`batch shim: ${today.length} signals for t=${ctx.t}`)
      const weights = today[0]!.weights
      if (weights.length !== ctx.symbols.length) {
        throw new Error(`batch shim: ${weights.length} weights for ${ctx.symbols.length} symbols at t=${ctx.t}`)
      }
      // Emit every symbol explicitly (zero weight = sell to flat) so the
      // decision is a complete portfolio statement, exactly like v1.
      return ctx.symbols.map((symbol, k) => ({ symbol, weight: weights[k]! }))
    },
  }
}

/** Adapt a v2 `Strategy` to the v1 batch shape so the existing scoring and
 *  leak-audit plumbing (`truncationInvariance`, `runBacktest`) consume it
 *  unchanged. Fees do not alter decisions unless the strategy conditions on
 *  its own equity path, so the audit drives with the campaign's default
 *  costs. */
export function generateSignalsFromStrategy(
  strategy: Strategy,
  opts?: { symbols?: string[]; costBps?: number; slippageBps?: number },
): GenerateSignals {
  return (bars: Bar[][]): Signal[] => {
    const symbols = opts?.symbols ?? bars.map((_, k) => (k === 0 ? 'IDX' : `T${String(k).padStart(2, '0')}`))
    return runIncremental(bars, strategy, {
      costBps: opts?.costBps ?? 10,
      slippageBps: opts?.slippageBps ?? 5,
      symbols,
    }).decisions
  }
}

// ---------------------------------------------------------------------------
// Module loading — one entry point for both contract generations.
// ---------------------------------------------------------------------------

export interface LoadedStrategy {
  kind: 'v2-onBar' | 'v1-batch'
  /** Batch view of the strategy; v2 modules are wrapped through the
   *  incremental driver so the structural history guarantee applies. */
  generateSignals: GenerateSignals
}

/** Import a strategy module from disk and normalize it to the batch shape
 *  the scoring + leak-audit plumbing consumes. v2 (`onBar`) wins when a
 *  module exports both. Throws when neither contract is implemented. */
export async function loadStrategyFile(
  strategyPath: string,
  opts?: { symbols?: string[]; costBps?: number; slippageBps?: number },
): Promise<LoadedStrategy> {
  const mod = (await import(pathToFileURL(strategyPath).href)) as {
    onBar?: Strategy['onBar']
    generateSignals?: GenerateSignals
  }
  if (typeof mod.onBar === 'function') {
    return { kind: 'v2-onBar', generateSignals: generateSignalsFromStrategy({ onBar: mod.onBar }, opts) }
  }
  if (typeof mod.generateSignals === 'function') {
    return { kind: 'v1-batch', generateSignals: mod.generateSignals }
  }
  throw new Error(`strategy module exports neither onBar(ctx) nor generateSignals(bars): ${strategyPath}`)
}
