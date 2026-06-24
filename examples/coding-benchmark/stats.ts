/**
 * The STATS — turn the matrix's `RunRecord[]` into an honest leaderboard:
 *   - per-harness mean composite + a bootstrap CONFIDENCE INTERVAL (`confidenceInterval`)
 *   - per-harness PASS-RATE with a binomial Wilson interval (`wilson`) — the correct
 *     CI for a proportion (the continuous CI assumes the wrong distribution)
 *   - every harness PAIR compared on MATCHED scenarios with a REAL paired significance
 *     test (`pairedTTest`, or `wilcoxonSignedRank` for the non-parametric path), then
 *     BH-corrected across all pairs (`benjaminiHochberg`) so running many comparisons
 *     doesn't manufacture a false winner. The paired delta + its bootstrap CI
 *     (`pairedBootstrap`) is reported as the effect size.
 *
 * Every number here is one agent-eval primitive call. No hand-rolled statistics,
 * and no fake p-values: BH is fed the actual paired-test p, not a CI proxy.
 *
 * Pairing discipline: the paired unit is the SCENARIO. With `reps > 1` a harness
 * produces several records per scenario; we average them to ONE score per
 * (harness, scenario) before pairing, so the paired arrays line up scenario-for-
 * scenario and reps tighten the per-cell estimate instead of corrupting the pairing.
 */

import {
  benjaminiHochberg,
  confidenceInterval,
  pairedBootstrap,
  pairedTTest,
  type RunRecord,
  wilcoxonSignedRank,
  wilson,
} from '@tangle-network/agent-eval'

/** A composite at or above this counts as "green" for the pass-rate proportion. */
const greenThreshold = 0.6

/** Which paired test to run. Parametric `t` by default; `wilcoxon` for skewed scores. */
export type PairedTest = 't' | 'wilcoxon'

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
  /** the paired-test p-value (before correction) */
  p: number
  /** BH-significant after correcting across all pairs */
  significant: boolean
}

export interface StatsReport {
  leaderboard: HarnessRow[]
  pairs: PairResult[]
}

/** Per-record composite — the score the judges produced. */
function score(r: RunRecord): number {
  return r.outcome.searchScore ?? r.outcome.holdoutScore ?? 0
}

/** Group records by harness profile. The matrix stamps the profile id (a hash) as
 *  `candidateId`; we resolve it to the readable harness name via `nameOf`. */
function byHarness(records: RunRecord[], nameOf: (id: string) => string): Map<string, RunRecord[]> {
  const m = new Map<string, RunRecord[]>()
  for (const r of records) {
    const key = nameOf(r.agentProfile?.profileId ?? r.candidateId)
    const list = m.get(key) ?? []
    list.push(r)
    m.set(key, list)
  }
  return m
}

/** ONE mean score per scenario for a harness — collapses reps so the paired unit is
 *  the scenario, in a stable scenario order. Fails LOUD on a record missing its
 *  `scenarioId`: a record with no scenario id cannot be paired honestly, and an empty
 *  '' fallback would silently merge DISTINCT scenarios into one bucket (corrupting both
 *  the leaderboard n and the pairing). No silent default — throw. */
function meanByScenario(records: RunRecord[]): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>()
  for (const r of records) {
    const id = r.scenarioId
    if (!id) {
      throw new Error(
        `RunRecord (candidate ${r.candidateId ?? 'unknown'}) is missing scenarioId — ` +
          'cannot pair or average it. The matrix stamps scenarioId on every record; a ' +
          'missing one means an upstream bug, not something to silently merge.',
      )
    }
    const acc = sums.get(id) ?? { total: 0, n: 0 }
    acc.total += score(r)
    acc.n += 1
    sums.set(id, acc)
  }
  const out = new Map<string, number>()
  for (const [id, acc] of sums) out.set(id, acc.n ? acc.total / acc.n : 0)
  return out
}

/** Scores for harness A and B on the SAME scenarios, aligned for pairing (one
 *  averaged score per scenario, in shared scenario order). */
function pairedScores(a: RunRecord[], b: RunRecord[]): { aScores: number[]; bScores: number[] } {
  const aMean = meanByScenario(a)
  const bMean = meanByScenario(b)
  const aScores: number[] = []
  const bScores: number[] = []
  for (const scenarioId of [...aMean.keys()].sort()) {
    const bv = bMean.get(scenarioId)
    if (bv !== undefined) {
      aScores.push(aMean.get(scenarioId) as number)
      bScores.push(bv)
    }
  }
  return { aScores, bScores }
}

export function pairwiseStats(
  records: RunRecord[],
  nameOf: (id: string) => string,
  test: PairedTest = 't',
): StatsReport {
  const groups = byHarness(records, nameOf)
  const harnesses = [...groups.keys()].sort()

  const leaderboard: HarnessRow[] = harnesses.map((harness) => {
    const rs = groups.get(harness) ?? []
    // Collapse reps to ONE mean per scenario BEFORE the CI/Wilson — the SAME unit the
    // pairing path uses. Reps tighten the per-(harness,scenario) estimate; they are NOT
    // independent samples, so feeding every raw rep record into the CI would let
    // identical reps fake a narrower interval out of zero new information. The honest n
    // is the number of distinct scenarios, not records.
    const scores = [...meanByScenario(rs).values()]
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

  // Every unordered harness pair, with a REAL paired test on matched scenarios.
  const raw: Omit<PairResult, 'significant'>[] = []
  for (let i = 0; i < harnesses.length; i += 1) {
    for (let j = i + 1; j < harnesses.length; j += 1) {
      const ha = harnesses[i] as string
      const hb = harnesses[j] as string
      const { aScores, bScores } = pairedScores(groups.get(ha) ?? [], groups.get(hb) ?? [])
      if (aScores.length === 0) continue
      // Effect size + CI from the paired bootstrap; the p-value from a real paired test.
      const boot = pairedBootstrap(aScores, bScores, { seed: 7, statistic: 'median' })
      const p =
        test === 'wilcoxon'
          ? wilcoxonSignedRank(aScores, bScores).p
          : pairedTTest(aScores, bScores).p
      raw.push({ a: ha, b: hb, delta: boot.median, low: boot.low, high: boot.high, p })
    }
  }

  // BH-correct the REAL p-values across all pairs (controls the false-discovery rate).
  const { significant } = benjaminiHochberg(
    raw.map((r) => r.p),
    0.05,
  )
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
  lines.push('Pairwise (paired delta + bootstrap CI; paired-test p, BH-corrected):')
  for (const p of report.pairs) {
    const tag = p.significant ? 'SIGNIFICANT' : 'n.s.'
    lines.push(
      `  ${p.b} − ${p.a}: Δ=${p.delta.toFixed(3)} [${p.low.toFixed(3)}, ${p.high.toFixed(3)}] ` +
        `p=${p.p.toFixed(3)} ${tag}`,
    )
  }
  // Power caveat: with a tiny scenario corpus the significance machinery is structurally
  // underpowered — the Wilcoxon path returns p=1 for n<6 non-zero diffs, and the paired
  // t-test has ~1 df. The tests show the WIRING; a real claim needs 20-50 tasks.
  const maxN = report.leaderboard.reduce((m, r) => Math.max(m, r.n), 0)
  if (maxN < 6) {
    lines.push('')
    lines.push(
      `  NOTE: n=${maxN} scenarios — below the power floor. The paired tests above cannot ` +
        'reach significance at this corpus size (they demonstrate the wiring). Use 20-50 ' +
        'tasks for a real harness comparison.',
    )
  }
  return lines.join('\n')
}
