/**
 * Multiplicity-adjusted acceptance: the bar RISES with every candidate tried.
 *
 * Why: if you test N random strategies against the same data, the best one
 * looks good by luck alone. Under the null (no skill), the expected maximum
 * Sharpe across N independent tries grows like sqrt(2 ln N) times the
 * cross-trial dispersion — that is the term the Deflated Sharpe Ratio of
 * Bailey & Lopez de Prado ("The Deflated Sharpe Ratio", Journal of Portfolio
 * Management, 2014) corrects for. We implement the simple, auditable version:
 *
 *   requiredExcessSharpe(n) = BASE + SPREAD * sqrt(2 * ln(n))
 *
 * where n counts EVERY candidate ever tried this campaign (including ones
 * killed by the leak audit — they were still draws from the search), BASE is
 * the floor a single try must clear, and SPREAD calibrates how fast luck
 * accumulates. Every tried candidate is a permanent notebook row, so n can
 * never be quietly reset.
 *
 * A candidate is accepted only if BOTH hold:
 *   1. it beats the best pinned baseline's Sharpe in >= ceil(minWinFraction*K)
 *      of the K in-sample windows (consistency, not one lucky stretch), and
 *   2. its mean excess Sharpe across the K windows >= requiredExcessSharpe(n).
 */

/** Annualized excess-Sharpe floor for the very first candidate (n = 1). */
export const BASE_EXCESS_SHARPE = 0.1
/** Luck-accumulation rate: how fast the bar rises with tries. */
export const MULTIPLICITY_SPREAD = 0.15

export function requiredExcessSharpe(nTried: number): number {
  if (!Number.isInteger(nTried) || nTried < 1) {
    throw new Error(`requiredExcessSharpe: nTried must be a positive integer, got ${nTried}`)
  }
  return BASE_EXCESS_SHARPE + MULTIPLICITY_SPREAD * Math.sqrt(2 * Math.log(nTried))
}

export interface AcceptanceDecision {
  accepted: boolean
  wins: number
  windows: number
  requiredWins: number
  meanExcessSharpe: number
  threshold: number
  nTried: number
  reasons: string[]
}

export interface AcceptanceInput {
  /** Candidate Sharpe minus best-baseline Sharpe, one entry per window. */
  perWindowExcess: number[]
  /** Total candidates tried this campaign INCLUDING this one. */
  nTried: number
  /** Fraction of windows the candidate must win. Default 0.75 (6 of 8). */
  minWinFraction?: number
}

export function decideAcceptance(input: AcceptanceInput): AcceptanceDecision {
  const { perWindowExcess, nTried } = input
  const windows = perWindowExcess.length
  if (windows === 0) throw new Error('decideAcceptance: no windows')
  for (const e of perWindowExcess) {
    if (!Number.isFinite(e)) throw new Error('decideAcceptance: non-finite excess Sharpe — fail-closed')
  }
  const minWinFraction = input.minWinFraction ?? 0.75
  const requiredWins = Math.ceil(minWinFraction * windows)
  const wins = perWindowExcess.filter((e) => e > 0).length
  const meanExcessSharpe = perWindowExcess.reduce((s, e) => s + e, 0) / windows
  const threshold = requiredExcessSharpe(nTried)
  const reasons: string[] = []
  if (wins < requiredWins) {
    reasons.push(`consistency: beat the best baseline in only ${wins}/${windows} windows (need ${requiredWins})`)
  }
  if (meanExcessSharpe < threshold) {
    reasons.push(
      `multiplicity: mean excess Sharpe ${meanExcessSharpe.toFixed(3)} < required ${threshold.toFixed(3)} ` +
        `(bar after ${nTried} tried candidate${nTried === 1 ? '' : 's'})`,
    )
  }
  const accepted = reasons.length === 0
  if (accepted) {
    reasons.push(
      `accepted: won ${wins}/${windows} windows, mean excess Sharpe ${meanExcessSharpe.toFixed(3)} ` +
        `>= ${threshold.toFixed(3)} at n=${nTried}`,
    )
  }
  return { accepted, wins, windows, requiredWins, meanExcessSharpe, threshold, nTried, reasons }
}
