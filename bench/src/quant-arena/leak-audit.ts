/**
 * Look-ahead (leak) audit — the deterministic half.
 *
 * The strongest guard against look-ahead bias is mechanical: run the strategy
 * on data truncated at day c and on the full history. Under the contract
 * ("the signal at t uses only bars[0..t]"), every signal with t <= c must be
 * BIT-IDENTICAL in both runs. Any divergence proves the strategy read past
 * its decision day — future closes, whole-series statistics, end-anchored
 * indexing — regardless of how the leak was written.
 *
 * This check is necessary, not sufficient (a strategy hardcoding calendar
 * dates it memorized survives truncation), which is why the campaign ALSO
 * runs an adversarial LLM read of the source (see quant-loop.mts). Kill on
 * either.
 */

import type { Bar, GenerateSignals, Signal } from './types.ts'

export interface TruncationDivergence {
  cutoff: number
  t: number
  detail: string
}

export interface TruncationReport {
  clean: boolean
  cutoffs: number[]
  divergence: TruncationDivergence | null
}

/** Evenly spaced cutoffs across (warmupDays, totalDays - 1). */
export function truncationCutoffs(totalDays: number, warmupDays: number, count = 6): number[] {
  const lo = Math.max(warmupDays + 1, 1)
  const hi = totalDays - 2
  if (hi <= lo) throw new Error(`truncationCutoffs: no room between warmup ${warmupDays} and ${totalDays} days`)
  const cutoffs = new Set<number>()
  for (let i = 0; i < count; i++) {
    cutoffs.add(Math.round(lo + ((hi - lo) * i) / Math.max(count - 1, 1)))
  }
  return [...cutoffs].sort((a, b) => a - b)
}

const signalMap = (signals: Signal[], maxT: number): Map<number, number[]> => {
  const map = new Map<number, number[]>()
  for (const s of signals) if (s.t <= maxT) map.set(s.t, s.weights)
  return map
}

function compareAt(cutoff: number, full: Signal[], truncated: Signal[]): TruncationDivergence | null {
  const fullMap = signalMap(full, cutoff)
  const truncMap = signalMap(truncated, cutoff)
  const ts = new Set([...fullMap.keys(), ...truncMap.keys()])
  for (const t of [...ts].sort((a, b) => a - b)) {
    const a = fullMap.get(t)
    const b = truncMap.get(t)
    if (a === undefined || b === undefined) {
      return {
        cutoff,
        t,
        detail: `signal at t=${t} exists only in the ${a === undefined ? 'truncated' : 'full'} run`,
      }
    }
    if (a.length !== b.length) {
      return { cutoff, t, detail: `weight vector length ${a.length} vs ${b.length} at t=${t}` }
    }
    for (let k = 0; k < a.length; k++) {
      if (!Object.is(a[k], b[k])) {
        return {
          cutoff,
          t,
          detail: `weights[${k}] at t=${t}: full=${a[k]} truncated=${b[k]} — the decision changed when future bars were removed`,
        }
      }
    }
  }
  return null
}

/** Run the truncation-invariance check. Deterministic; throws only if the
 *  strategy itself throws. */
export function truncationInvariance(
  strategy: GenerateSignals,
  bars: Bar[][],
  opts: { warmupDays: number; cutoffs?: number[] },
): TruncationReport {
  const totalDays = bars[0]?.length ?? 0
  const cutoffs = opts.cutoffs ?? truncationCutoffs(totalDays, opts.warmupDays)
  const full = strategy(bars)
  for (const cutoff of cutoffs) {
    const truncated = strategy(bars.map((series) => series.slice(0, cutoff + 1)))
    const divergence = compareAt(cutoff, full, truncated)
    if (divergence !== null) return { clean: false, cutoffs, divergence }
  }
  return { clean: true, cutoffs, divergence: null }
}
