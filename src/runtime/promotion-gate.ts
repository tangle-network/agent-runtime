/**
 * promotionGate — the statistical promotion decision over a holdout benchmark: does the
 * candidate strategy beat the incumbent on held-out tasks by a margin the task noise
 * cannot fake? The statistics are the substrate's (`heldoutSignificance`): a SEEDED
 * paired bootstrap over per-task (candidate − incumbent) deltas — deterministic verdict,
 * a minimum-evidence floor, and the CI lower bound must clear `deltaThreshold`. A raw
 * h1>h0 point comparison on m≈8 holdout tasks certifies false champions at near
 * coin-flip rates; this gate is the instrument-grade replacement.
 */
import { heldoutSignificance } from '@tangle-network/agent-eval/campaign'
import type { BenchmarkReport } from './run-benchmark'

export interface PromotionGateOptions {
  /** The HOLDOUT report — must carry per-task cells for both strategy names. */
  report: BenchmarkReport
  /** The incumbent champion's strategy name. */
  incumbent: string
  /** The challenger's strategy name. */
  candidate: string
  /** 'superiority' (default): the candidate must score significantly BETTER.
   *  'non-inferiority': the candidate must prove its score is not worse than the
   *  incumbent by more than `scoreTolerance` AND its cost savings are significant —
   *  the gate for "same quality, cheaper" claims. */
  mode?: 'superiority' | 'non-inferiority'
  /** non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05. */
  scoreTolerance?: number
  /** The CI lower bound on the paired lift must EXCEED this (score scale). Default 0. */
  deltaThreshold?: number
  /** Minimum paired tasks before significance can be claimed. Default 6 — below that
   *  the bootstrap CI is too wide to separate a real lift from the per-task noise. */
  minPairedTasks?: number
  /** Bootstrap statistic over the paired deltas. Default 'mean'. */
  statistic?: 'mean' | 'median'
  /** Fixed by the substrate by default — the same report always yields the same verdict. */
  seed?: number
  resamples?: number
}

export interface PromotionVerdict {
  promoted: boolean
  reason:
    | 'identical-champion'
    | 'few-tasks'
    | 'no-margin'
    | 'significant'
    | 'non-inferior-and-cheaper'
    | 'score-inferior'
    | 'not-cheaper'
  mode: 'superiority' | 'non-inferiority'
  /** Paired tasks that carried both strategies' cells. */
  n: number
  /** Paired (candidate − incumbent) lift across the holdout tasks. */
  lift: { mean: number; median: number; low: number; high: number }
  /** non-inferiority mode: paired (incumbent − candidate) cost SAVINGS per task (usd) —
   *  positive means the candidate is cheaper; significant iff the CI low clears zero. */
  costSavings?: { mean: number; median: number; low: number; high: number }
}

export function promotionGate(opts: PromotionGateOptions): PromotionVerdict {
  const mode = opts.mode ?? 'superiority'
  if (opts.candidate === opts.incumbent) {
    return {
      promoted: false,
      reason: 'identical-champion',
      mode,
      n: 0,
      lift: { mean: 0, median: 0, low: 0, high: 0 },
    }
  }
  const before: number[] = []
  const after: number[] = []
  const incUsd: number[] = []
  const candUsd: number[] = []
  const cellIds: string[] = []
  for (const row of opts.report.perTask) {
    const inc = row.cells?.[opts.incumbent]
    const cand = row.cells?.[opts.candidate]
    if (!inc || !cand) continue
    before.push(inc.score)
    after.push(cand.score)
    incUsd.push(inc.usd)
    candUsd.push(cand.usd)
    cellIds.push(row.taskId)
  }
  if (before.length === 0) {
    throw new Error(
      `promotionGate: no holdout task carried cells for both "${opts.incumbent}" and "${opts.candidate}" — the report must come from a run that included both strategies`,
    )
  }
  const sig = heldoutSignificance(
    { before, after, cellIds },
    {
      deltaThreshold: opts.deltaThreshold ?? 0,
      minProductiveRuns: opts.minPairedTasks ?? 6,
      statistic: opts.statistic ?? 'mean',
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    },
  )
  const lift = {
    mean: sig.bootstrap.mean,
    median: sig.bootstrap.median,
    low: sig.bootstrap.low,
    high: sig.bootstrap.high,
  }
  if (mode === 'superiority') {
    if (sig.fewRuns) return { promoted: false, reason: 'few-tasks', mode, n: sig.n, lift }
    return sig.significant
      ? { promoted: true, reason: 'significant', mode, n: sig.n, lift }
      : { promoted: false, reason: 'no-margin', mode, n: sig.n, lift }
  }
  // non-inferiority: (a) score not worse than −scoreTolerance, proven (CI low clears
  // −tolerance); (b) cost SAVINGS (incumbent − candidate, usd/task) significantly > 0.
  const tolerance = opts.scoreTolerance ?? 0.05
  const scoreSig = heldoutSignificance(
    { before, after, cellIds },
    {
      deltaThreshold: -tolerance,
      minProductiveRuns: opts.minPairedTasks ?? 6,
      statistic: opts.statistic ?? 'mean',
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    },
  )
  const costSig = heldoutSignificance(
    { before: candUsd, after: incUsd, cellIds },
    {
      deltaThreshold: 0,
      minProductiveRuns: opts.minPairedTasks ?? 6,
      statistic: opts.statistic ?? 'mean',
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
      ...(opts.resamples !== undefined ? { resamples: opts.resamples } : {}),
    },
  )
  const costSavings = {
    mean: costSig.bootstrap.mean,
    median: costSig.bootstrap.median,
    low: costSig.bootstrap.low,
    high: costSig.bootstrap.high,
  }
  if (scoreSig.fewRuns)
    return { promoted: false, reason: 'few-tasks', mode, n: scoreSig.n, lift, costSavings }
  if (!scoreSig.significant)
    return { promoted: false, reason: 'score-inferior', mode, n: scoreSig.n, lift, costSavings }
  if (!costSig.significant)
    return { promoted: false, reason: 'not-cheaper', mode, n: scoreSig.n, lift, costSavings }
  return {
    promoted: true,
    reason: 'non-inferior-and-cheaper',
    mode,
    n: scoreSig.n,
    lift,
    costSavings,
  }
}
