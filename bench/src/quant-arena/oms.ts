/**
 * The shared OMS rebalancer — the ONLY component that turns a strategy's
 * target weights into orders. Strategies never construct `Order`s; keeping
 * sizing in one place means every candidate and baseline trades under the
 * same rules, and the leak/contract audits only ever have to reason about
 * weights.
 *
 * Sizing (LEAN `CalculateOrderQuantity` style, long-only v2):
 *   qty = (targetWeight * equity - currentPositionValue) / price
 * at decision-time (close of day t) prices. Positive -> buy, negative ->
 * sell. Quantities are fractional: the backtest engines track dollar
 * positions, so lot rounding would only introduce parity noise between the
 * TS prefilter and the vectorbt scorer. No fee buffer is reserved (fees are
 * financed at 0% by the engines — conservative, never flattering).
 *
 * Long-only enforcement is fail-closed: a negative target weight, a weight
 * sum > 1, or an unknown symbol throws rather than clamping.
 */

import type { Order, Rebalancer, TargetPosition } from './types.ts'

const WEIGHT_EPS = 1e-9
/** Trades below this fraction of equity are dust — no order is emitted. */
const MIN_TRADE_FRACTION = 1e-9

/** Validate targets and expand them to a full per-symbol weight vector
 *  (omitted symbols -> 0). Throws on contract violations. */
export function targetsToWeights(targets: TargetPosition[], symbols: string[]): number[] {
  const index = new Map(symbols.map((s, k) => [s, k]))
  const weights = new Array<number>(symbols.length).fill(0)
  const seen = new Set<string>()
  let sum = 0
  for (const target of targets) {
    const k = index.get(target.symbol)
    if (k === undefined) {
      throw new Error(`oms: target names unknown symbol '${target.symbol}' (universe: ${symbols.join(', ')})`)
    }
    if (seen.has(target.symbol)) {
      throw new Error(`oms: symbol '${target.symbol}' targeted twice in one rebalance`)
    }
    seen.add(target.symbol)
    if (!Number.isFinite(target.weight)) throw new Error(`oms: non-finite weight for '${target.symbol}'`)
    if (target.weight < -WEIGHT_EPS) {
      throw new Error(`oms: negative weight ${target.weight} for '${target.symbol}' — long-only, no shorting`)
    }
    weights[k] = Math.max(target.weight, 0)
    sum += weights[k]!
  }
  if (sum > 1 + 1e-6) {
    throw new Error(`oms: target weights sum ${sum} > 1 — no leverage`)
  }
  return weights
}

/** The one shared rebalancer. See module header for the sizing rule. */
export const rebalance: Rebalancer = ({ targets, symbols, equity, prices, positionValues, t, tag }) => {
  if (prices.length !== symbols.length || positionValues.length !== symbols.length) {
    throw new Error(
      `oms: state arrays disagree with the universe (${symbols.length} symbols, ` +
        `${prices.length} prices, ${positionValues.length} positions)`,
    )
  }
  if (!Number.isFinite(equity) || equity <= 0) throw new Error(`oms: nonpositive equity ${equity}`)
  const weights = targetsToWeights(targets, symbols)
  const orders: Order[] = []
  for (let k = 0; k < symbols.length; k++) {
    const price = prices[k]!
    if (!Number.isFinite(price) || price <= 0) throw new Error(`oms: nonpositive price for '${symbols[k]}'`)
    const desiredValue = weights[k]! * equity
    const deltaValue = desiredValue - positionValues[k]!
    if (Math.abs(deltaValue) <= MIN_TRADE_FRACTION * equity) continue
    const qty = Math.abs(deltaValue) / price
    const side = deltaValue > 0 ? 'buy' : 'sell'
    if (side === 'sell' && deltaValue < -positionValues[k]! - MIN_TRADE_FRACTION * equity) {
      // Cannot happen when weights >= 0, but keep the invariant explicit:
      // a sell may never exceed the current long position.
      throw new Error(`oms: sell of ${qty} '${symbols[k]}' exceeds current position — long-only`)
    }
    orders.push({
      clientOrderId: `qa-t${t}-${symbols[k]}`,
      symbol: symbols[k]!,
      side,
      qty,
      type: 'market',
      tif: 'day',
      ...(tag !== undefined ? { tag } : {}),
    })
  }
  return orders
}
