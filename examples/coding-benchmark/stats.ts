/**
 * The STATS — turn the matrix's `RunRecord[]` into an honest leaderboard:
 *   - per-harness mean composite + a bootstrap CONFIDENCE INTERVAL (`confidenceInterval`)
 *   - per-harness PASS-RATE with a binomial Wilson interval (`wilson`) — the correct
 *     CI for a proportion (the continuous CI assumes the wrong distribution)
 *   - every harness PAIR compared on MATCHED scenarios with a paired bootstrap
 *     (`pairedBootstrap`), then BH-corrected across all pairs (`benjaminiHochberg`)
 *     so running many comparisons doesn't manufacture a false winner.
 *
 * Every number here is one agent-eval primitive call. No hand-rolled statistics.
 *
 * (The design flagged "no binomial CI in agent-eval" as a gap — that's stale:
 *  `wilson(successes, n)` ships in the stats surface and is exactly this CI. Used below.)
 */

import {
  benjaminiHochberg,
  confidenceInterval,
  pairedBootstrap,
  type RunRecord,
  wilson,
} from '@tangle-network/agent-eval'

/** A composite at or above this counts as "green" for the pass-rate proportion. */
const greenThreshold = 0.6

interface HarnessRow {
  harness: string
  n: number
  meanComposite: number
  ci: { lower: number; upper: number }
  passRate: number
  passCi: { lower: number; upper: number }
}

interface PairResult {
  a: string
  b: string
  /** median paired delta (b − a) and its bootstrap CI */
  delta: number
  low: number
  high: number
  /** BH-significant after correcting across all pairs */
  significant: boolean
}

export interface StatsReport {
  leaderboard: HarnessRow[]
  pairs: PairResult[]
}

/** Per-record composite — the search-split score the judges produced. */
function score(r: RunRecord): number {
  return r.outcome.searchScore ?? r.outcome.holdoutScore ?? 0
}

/** Group records by harness profile (the matrix stamps the profile id as candidateId). */
function byHarness(records: RunRecord[]): Map<string, RunRecord[]> {
  const m = new Map<string, RunRecord[]>()
  for (const r of records) {
    const key = r.agentProfile?.profileId ?? r.candidateId
    const list = m.get(key) ?? []
    list.push(r)
    m.set(key, list)
  }
  return m
}

/** Scores for harness A and B on the SAME scenarios, aligned for pairing. */
function pairedScores(a: RunRecord[], b: RunRecord[]): { aScores: number[]; bScores: number[] } {
  const bByScenario = new Map(b.map((r) => [r.scenarioId ?? '', r]))
  const aScores: number[] = []
  const bScores: number[] = []
  for (const ra of a) {
    const rb = bByScenario.get(ra.scenarioId ?? '')
    if (rb) {
      aScores.push(score(ra))
      bScores.push(score(rb))
    }
  }
  return { aScores, bScores }
}

export function pairwiseStats(records: RunRecord[]): StatsReport {
  const groups = byHarness(records)
  const harnesses = [...groups.keys()].sort()

  const leaderboard: HarnessRow[] = harnesses.map((harness) => {
    const rs = groups.get(harness) ?? []
    const scores = rs.map(score)
    const ci = confidenceInterval(scores, 0.95, { seed: 7 })
    const passes = scores.filter((s) => s >= greenThreshold).length
    const passCi = wilson(passes, scores.length, 0.95)
    return {
      harness,
      n: scores.length,
      meanComposite: ci.mean,
      ci: { lower: ci.lower, upper: ci.upper },
      passRate: scores.length ? passes / scores.length : 0,
      passCi: { lower: passCi.lower, upper: passCi.upper },
    }
  })

  // Every unordered harness pair, paired-bootstrapped on matched scenarios.
  const raw: Omit<PairResult, 'significant'>[] = []
  for (let i = 0; i < harnesses.length; i += 1) {
    for (let j = i + 1; j < harnesses.length; j += 1) {
      const ha = harnesses[i] as string
      const hb = harnesses[j] as string
      const { aScores, bScores } = pairedScores(groups.get(ha) ?? [], groups.get(hb) ?? [])
      if (aScores.length === 0) continue
      const boot = pairedBootstrap(aScores, bScores, { seed: 7, statistic: 'median' })
      raw.push({ a: ha, b: hb, delta: boot.median, low: boot.low, high: boot.high })
    }
  }

  // A CI excluding 0 is the per-pair p<0.05 proxy; BH-correct across all pairs.
  const pProxy = raw.map((r) => (r.low > 0 || r.high < 0 ? 0.04 : 0.5))
  const { significant } = benjaminiHochberg(pProxy, 0.05)
  const pairs: PairResult[] = raw.map((r, i) => ({ ...r, significant: significant[i] ?? false }))

  return { leaderboard, pairs }
}

/** Render the report as a plain leaderboard + significance lines. */
export function renderStats(report: StatsReport): string {
  const lines: string[] = []
  lines.push('Harness leaderboard (mean composite, 95% CI; pass-rate, Wilson CI):')
  for (const row of report.leaderboard) {
    lines.push(
      `  ${row.harness.padEnd(22)} composite ${row.meanComposite.toFixed(3)} ` +
        `[${row.ci.lower.toFixed(3)}, ${row.ci.upper.toFixed(3)}]  ` +
        `pass ${(row.passRate * 100).toFixed(0)}% ` +
        `[${(row.passCi.lower * 100).toFixed(0)}%, ${(row.passCi.upper * 100).toFixed(0)}%]  (n=${row.n})`,
    )
  }
  lines.push('')
  lines.push('Pairwise (paired bootstrap on matched scenarios, BH-corrected):')
  for (const p of report.pairs) {
    const tag = p.significant ? 'SIGNIFICANT' : 'n.s.'
    lines.push(
      `  ${p.b} − ${p.a}: Δ=${p.delta.toFixed(3)} [${p.low.toFixed(3)}, ${p.high.toFixed(3)}] ${tag}`,
    )
  }
  return lines.join('\n')
}
