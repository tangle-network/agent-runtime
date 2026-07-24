/**
 * QUANT-ARENA strategy contract (v2 — incremental, OMS-mediated).
 *
 * A strategy is ONE module exporting `onBar(ctx: StrategyContext)`. The
 * harness calls it once per trading day, in order, and the strategy answers
 * with either a full set of target portfolio weights or `null` ("hold").
 *
 *  - `ctx.history[k]` is ticker k's daily bars UP TO AND INCLUDING today
 *    (`ctx.history[k].length === ctx.t + 1`, always). The harness physically
 *    slices the data before every call: bars after today DO NOT EXIST in the
 *    array, so look-ahead is structurally impossible through `history`.
 *    `history[0]` is ALWAYS the index (the buy-and-hold benchmark asset);
 *    `history[1..]` are the rest of the universe, in `ctx.symbols` order.
 *  - Returning `TargetPosition[]` requests a rebalance: each entry names a
 *    symbol and a target fraction of equity. Weights must be >= 0 and sum
 *    to <= 1 (the remainder sits in cash earning 0). Violations kill the
 *    candidate — fail-closed, not silently clamped. Symbols omitted from the
 *    list are targeted to 0 (sold).
 *  - Returning `null` means "no trade today": positions drift with prices.
 *  - FILL TIMING: a rebalance decided at the close of day `t` fills at the
 *    NEXT day's open. Every fill pays cost + slippage (basis points, one-way)
 *    on traded dollars — churn is expensive.
 *  - Strategies NEVER construct or emit `Order`s. The shared rebalancer
 *    (oms.ts) is the only component that turns target weights into orders,
 *    so sizing, side, and long-only enforcement are uniform across every
 *    candidate and baseline.
 *  - Determinism: `onBar` must be a pure function of `ctx`. No RNG, no
 *    clock, no memory of prior calls that a re-run would not rebuild. The
 *    lab re-runs candidates on truncated data; any divergence in decisions
 *    up to the cutoff kills the candidate.
 *
 * The v1 batch contract (`generateSignals(bars): Signal[]`) remains for the
 * pinned baselines and old fixtures; `driver.ts` wraps it so batch strategies
 * run unchanged under the incremental harness.
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

// ---------------------------------------------------------------------------
// v2 incremental contract.
// ---------------------------------------------------------------------------

export interface StrategyContext {
  /** Universe tickers; symbols[0] is the benchmark index. */
  symbols: string[]
  /** Today's day index into the shared date axis. */
  t: number
  /** history[k] = bars for symbols[k], indices 0..t ONLY (length t + 1). */
  history: Bar[][]
  /** Current portfolio weights per symbol (drifted, marked at today's close). */
  weights: number[]
  /** Current equity (starts at 1). */
  equity: number
}

export interface TargetPosition {
  symbol: string
  /** Target fraction of equity; >= 0, and the sum over all targets <= 1. */
  weight: number
}

export interface Strategy {
  /** Called once per bar. Return targets to rebalance, or null to hold. */
  onBar(ctx: StrategyContext): TargetPosition[] | null
}

export interface StrategyModuleV2 {
  onBar: Strategy['onBar']
}

// ---------------------------------------------------------------------------
// OMS layer. Orders are produced ONLY by the shared rebalancer (oms.ts) from
// the strategy's target weights — never by strategy code.
// ---------------------------------------------------------------------------

export type OrderSide = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'
export type TimeInForce = 'day' | 'gtc' | 'ioc' | 'fok'

export interface Order {
  /** Deterministic id, unique within a run (e.g. 'qa-t42-S03'). */
  clientOrderId: string
  symbol: string
  side: OrderSide
  /** Absolute quantity in shares (fractional allowed — see oms.ts). */
  qty: number
  type: OrderType
  limitPrice?: number
  tif: TimeInForce
  /** Free-form provenance tag, e.g. the candidate id. */
  tag?: string
}

/** Turns target weights into orders given the portfolio state at decision
 *  time. The one shared implementation lives in oms.ts (long-only in v2). */
export type Rebalancer = (args: {
  targets: TargetPosition[]
  symbols: string[]
  /** Equity at decision time (close of day t). */
  equity: number
  /** Last price per symbol at decision time (close of day t). */
  prices: number[]
  /** Current position value in dollars per symbol. */
  positionValues: number[]
  /** Decision day index — used for deterministic order ids. */
  t: number
  tag?: string
}) => Order[]

// ---------------------------------------------------------------------------
// v1 batch contract (baselines + legacy fixtures; wrapped by driver.ts).
// ---------------------------------------------------------------------------

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
