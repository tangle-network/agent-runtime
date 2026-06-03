/**
 * Equal-k decomposition for batch-compare.
 *
 * Comparing blind (1 shot) against refine (k sequential steered shots) and calling
 * the delta "steering" attributes the more-compute effect to steering. The honest
 * split needs a third arm at the SAME budget: random@k = k INDEPENDENT bare shots,
 * no steering. Then:
 *   Δ compute = random@k − blind     (the effect of spending k shots at all)
 *   Δ steer   = refine@k − random@k  (the effect of steering, at equal k)
 * Δ steer is the only number that isolates steering; refine − blind double-counts
 * the compute the random@k control also spends.
 */

export interface CompareTally {
  /** instances scored */
  n: number
  /** count: round-1 (pass@1) resolved */
  blind: number
  /** sum over instances of nResolved/k (expected pass of a uniform-random pick among the k bare shots) */
  randomExp: number
  /** count: any of the k bare shots resolved (the oracle ceiling) */
  oracle: number
  /** count: refine final resolved */
  refine: number
}

export interface CompareReport {
  blindRate: number
  randomRate: number
  oracleRate: number
  refineRate: number
  /** random@k − blind, as a fraction (more compute, no steering) */
  dCompute: number
  /** refine@k − random@k, as a fraction — the confound-free steering effect */
  dSteer: number
}

/** Expected pass of a uniform-random pick among k bare shots, nResolved of which passed. */
export const randomAtK = (nResolved: number, k: number): number => (k > 0 ? nResolved / k : 0)

/** Turn the streamed tally into display rates + the compute/steer decomposition. */
export function summarizeCompare(t: CompareTally): CompareReport {
  const rate = (x: number) => (t.n > 0 ? x / t.n : 0)
  const blindRate = rate(t.blind)
  const randomRate = rate(t.randomExp)
  const oracleRate = rate(t.oracle)
  const refineRate = rate(t.refine)
  return {
    blindRate,
    randomRate,
    oracleRate,
    refineRate,
    dCompute: randomRate - blindRate,
    dSteer: refineRate - randomRate,
  }
}
