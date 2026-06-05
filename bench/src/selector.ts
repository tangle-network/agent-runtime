/**
 * Deployable, non-oracle selector (docs/roadmap-rsi.md Phase 1).
 *
 * best-of-N only pays if you can pick the good attempt WITHOUT the judge. Today
 * the loop's winner is judge-selected (verdict.score) — an oracle upper bound, not
 * a deployable system. A `Selector` ranks the k candidate OUTPUTS using only
 * trace-observable signal and never the judge verdict. The type enforces the
 * firewall: a Selector is `(outputs: string[]) => index`; it is structurally
 * incapable of reading `valid`/`score`, so it cannot become an oracle by accident.
 *
 * Scoring is OFFLINE over the corpus: each random@k RunRecord already holds k
 * attempts each with a stored `valid`, so picking index i and reading
 * attempts[i].valid is the judge's verdict of the pick — zero new rollouts, zero
 * new judge calls. selector@k vs random@k (does picking beat a blind random draw?)
 * and selector@k vs oracle@k (how much ceiling is recoverable?) fall straight out.
 */

import type { AttemptRecord, RunRecord } from './corpus'

/** Picks one of `outputs` by index, using the candidate text only. Never the verdict. */
export type Selector = (outputs: string[]) => number

/** Normalize a short free-text answer so equivalent answers cluster: lowercase,
 *  trim, collapse whitespace, strip surrounding quotes/punctuation, drop a leading
 *  article. Deliberately conservative — it clusters trivial restatements, not
 *  paraphrases (that is the selector's known ceiling, not a bug). */
export function normalizeAnswer(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'`([{]+|[\s"'`)\]}.,;:!?]+$/g, '')
    .replace(/^(the|a|an)\s+/, '')
    .trim()
}

/**
 * Self-consistency (Wang 2022): pick the output that agrees with the most others
 * after normalization. Ties break to the cluster whose first member appears
 * earliest, and within the winning cluster to its earliest member — deterministic,
 * so test-retest flip rate is 0 by construction (the sanity floor). Empty input is
 * a caller bug (fail loud).
 */
export const selfConsistencySelect: Selector = (outputs) => {
  if (outputs.length === 0) throw new Error('selfConsistencySelect: no candidate outputs')
  const counts = new Map<string, number>()
  for (const o of outputs) {
    const k = normalizeAnswer(o)
    counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  let bestIdx = 0
  let bestCount = -1
  for (let i = 0; i < outputs.length; i += 1) {
    const c = counts.get(normalizeAnswer(outputs[i] as string)) ?? 0
    if (c > bestCount) {
      bestCount = c
      bestIdx = i // first member of the largest cluster encountered
    }
  }
  return bestIdx
}

/**
 * Verifier-grounded selection: pick the candidate with the highest deployable-checker
 * pass-count (ties → earliest). The pass-counts come from a checker the agent can run
 * in production (a provided test suite), NOT from the gold answer — so unlike a
 * judge/oracle pick this is deployable. A boolean pass/fail is the pass-count's {0,1}
 * special case. Pure and unit-shaped: it reads only the supplied counts, never any
 * verdict. Empty input is a caller bug (fail loud); a negative count is invalid.
 */
export function verifierGroundedSelect(passCounts: ReadonlyArray<number>): number {
  if (passCounts.length === 0) throw new Error('verifierGroundedSelect: no candidate pass-counts')
  let bestIdx = 0
  let bestCount = Number.NEGATIVE_INFINITY
  for (let i = 0; i < passCounts.length; i += 1) {
    const c = passCounts[i] as number
    if (!Number.isFinite(c) || c < 0) {
      throw new Error(`verifierGroundedSelect: invalid pass-count ${c} at index ${i}`)
    }
    if (c > bestCount) {
      bestCount = c
      bestIdx = i
    }
  }
  return bestIdx
}

/** One instance's offline selector outcome, all derived from stored verdicts. */
export interface SelectorOutcome {
  /** usable candidates (attempts with a non-empty output) */
  k: number
  /** the picked attempt's stored verdict — selector@k for this instance */
  selectorResolved: boolean
  /** nValid / k — expected pass of a uniform-random pick (the compute control) */
  randomExpected: number
  /** any usable candidate passed — the oracle ceiling */
  oracle: boolean
  /** round-1 verdict — pass@1 */
  blind: boolean
}

const usableCandidates = (record: RunRecord): AttemptRecord[] =>
  record.attempts.filter((a) => typeof a.output === 'string' && a.output.length > 0)

/**
 * Score a selector on one RunRecord offline. Returns null when no attempt produced
 * an output (unscoreable — not a pass). The selector sees OUTPUTS ONLY; the stored
 * `valid` flags are read after the pick, never passed to the selector.
 */
export function scoreSelectorOnRun(record: RunRecord, select: Selector): SelectorOutcome | null {
  const usable = usableCandidates(record)
  if (usable.length === 0) return null
  const picked = select(usable.map((a) => a.output as string))
  if (!Number.isInteger(picked) || picked < 0 || picked >= usable.length) {
    throw new Error(`selector returned out-of-range index ${picked} for ${usable.length} candidates`)
  }
  const nValid = usable.filter((a) => a.valid === true).length
  return {
    k: usable.length,
    selectorResolved: usable[picked]?.valid === true,
    randomExpected: nValid / usable.length,
    oracle: nValid > 0,
    blind: record.blindResolved === true,
  }
}

export interface SelectorReport {
  /** scoreable instances */
  n: number
  selectorRate: number
  randomRate: number
  oracleRate: number
  blindRate: number
  /** selector@k − random@k: does picking beat a blind random draw at the same k? (the gate) */
  dVsRandom: number
  /** selector@k − blind: total lift over one shot */
  dVsBlind: number
  /** oracle@k − selector@k: ceiling left on the table */
  gapToOracle: number
  /** instances skipped as unscoreable (no output in any attempt) */
  skipped: number
}

/** Aggregate the offline selector outcome across a corpus slice (one condition). */
export function summarizeSelector(records: RunRecord[], select: Selector): SelectorReport {
  let n = 0
  let selector = 0
  let randomExp = 0
  let oracle = 0
  let blind = 0
  let skipped = 0
  for (const r of records) {
    const o = scoreSelectorOnRun(r, select)
    if (o === null) {
      skipped += 1
      continue
    }
    n += 1
    if (o.selectorResolved) selector += 1
    randomExp += o.randomExpected
    if (o.oracle) oracle += 1
    if (o.blind) blind += 1
  }
  const rate = (x: number) => (n > 0 ? x / n : 0)
  const selectorRate = rate(selector)
  const randomRate = rate(randomExp)
  const oracleRate = rate(oracle)
  const blindRate = rate(blind)
  return {
    n,
    selectorRate,
    randomRate,
    oracleRate,
    blindRate,
    dVsRandom: selectorRate - randomRate,
    dVsBlind: selectorRate - blindRate,
    gapToOracle: oracleRate - selectorRate,
    skipped,
  }
}

/**
 * Test-retest: fraction of records where two selector runs pick a DIFFERENT index.
 * A deterministic selector against itself is 0 (the floor); a stochastic selector
 * (or two seeds) reveals how much its decision is noise. A selector whose flips
 * move the resolve rate is not a selector.
 */
export function flipRate(records: RunRecord[], a: Selector, b: Selector): number {
  let n = 0
  let flips = 0
  for (const r of records) {
    const usable = usableCandidates(r)
    if (usable.length === 0) continue
    const outs = usable.map((x) => x.output as string)
    n += 1
    if (a(outs) !== b(outs)) flips += 1
  }
  return n > 0 ? flips / n : 0
}
