/**
 * benchmark-report — turn a fleet of `RunRecord`s into a publishable, multi-axis benchmark report:
 * a ranked leaderboard, the full profile×axis score matrix, the cost/latency/token columns, and
 * embeddable charts (SVG) + a self-contained HTML page. Domain-agnostic by construction — it reads ONLY
 * the universal `RunRecord` currency (model, scenario, score, cost, tokens, latency, the `outcome.raw`
 * metric bag), so the SAME engine reports any benchmark in any domain: coding, search, agents, multimodal.
 *
 * This is the surface a hosted leaderboard (à la vals.ai) renders: for every harness×model profile, its
 * score on every axis, not a curated subset. It pairs with `runProfileMatrix` (whose `result.records`
 * feed straight in) but takes the records directly, so it is independent of how they were produced.
 *
 * An AXIS is any way to slice the score into columns — by default one column per scenario group
 * (`groupOf`, default = the scenario id), so the matrix is profile × scenario. Pass `axisScoresOf` to
 * score along judge dimensions or any custom decomposition instead. The reporter never invents a number:
 * a missing cell renders blank, never zero.
 */
import {
  benjaminiHochberg,
  confidenceInterval,
  pairedBootstrap,
  pairedTTest,
  type RunRecord,
  type RunSplitTag,
  validateRunRecord,
  wilson,
} from '@tangle-network/agent-eval'

/** Pull the headline score in [0,1] from a record. */
export type ScoreOf = (record: RunRecord) => number | undefined
/** The profile (matrix row) a record belongs to. Defaults to the canonical
 *  `agentProfile.cellId`, falling back to `candidateId`. */
export type ProfileKeyOf = (record: RunRecord) => string
/** The axis (matrix column) a record contributes to — default the scenario group. */
export type GroupOf = (record: RunRecord) => string
/** Decompose ONE record into per-axis scores (e.g. judge dimensions). When set, it REPLACES the
 *  scenario-group axes: the column set is the union of returned keys. */
export type AxisScoresOf = (record: RunRecord) => Record<string, number>

export interface LeaderboardOptions {
  readonly title?: string
  readonly scoreOf?: ScoreOf
  readonly profileKeyOf?: ProfileKeyOf
  readonly groupOf?: GroupOf
  readonly axisScoresOf?: AxisScoresOf
  /** Display label for a profile key. Defaults to the record's harness and model. */
  readonly labelOf?: (profileKey: string) => string
  /** Commit SHA / dataset / dates surfaced in the provenance block. */
  readonly meta?: Record<string, string>
  /** Compute per-row confidence intervals (bootstrap on score, Wilson on pass rate). Needs a
   *  `scenarioId` on every record (reps are collapsed per scenario for the honest n). Default off. */
  readonly stats?: boolean
  /** A score ≥ this counts as a "pass" for the pass-rate proportion + its Wilson CI. Default 0.999
   *  (fully solved). Lower it (e.g. 0.6) for a partial-credit domain. */
  readonly passThreshold?: number
}

/** A 95%-by-default confidence interval. */
export interface Interval {
  readonly lower: number
  readonly upper: number
}

/** One leaderboard row for one canonical profile and one data split. */
export interface LeaderboardRow {
  readonly profileKey: string
  readonly splitTag: RunSplitTag
  readonly label: string
  readonly model: string
  readonly runCount: number
  readonly scenarioCount: number
  readonly meanScore: number
  /** Fraction of scenario means scoring at least `passThreshold`. */
  readonly solveRate: number
  /** Axis to scenario-weighted mean score. */
  readonly perAxis: Record<string, number>
  readonly observedCostUsd: number
  readonly estimatedCostUsd: number
  readonly uncapturedCostRunCount: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly latencyP50Ms: number
  readonly latencyP90Ms: number
  /** Bootstrap CI on the mean score — present only when `opts.stats` is set. Computed over
   *  per-scenario means (reps collapsed first), so identical reps can't fake a narrow interval. */
  readonly scoreCi?: Interval
  /** Wilson CI on the pass rate — present only when `opts.stats` is set. */
  readonly passCi?: Interval
}

export interface Leaderboard {
  readonly title: string
  /** Column order — scenario groups (default) or dimension keys (`axisScoresOf`). */
  readonly axes: readonly string[]
  /** Rows ranked by `meanScore` descending, then label. */
  readonly profiles: readonly LeaderboardRow[]
  readonly meta: Record<string, string>
  /** Counts and cost coverage for the complete report input. */
  readonly provenance: {
    readonly runCount: number
    readonly scenarioCount: number
    readonly profiles: number
    readonly axes: number
    readonly models: readonly string[]
    readonly splits: readonly RunSplitTag[]
    readonly observedCostUsd: number
    readonly estimatedCostUsd: number
    readonly uncapturedCostRunCount: number
  }
}

const defaultScoreOf: ScoreOf = (r) => {
  return r.splitTag === 'holdout' ? r.outcome.holdoutScore : r.outcome.searchScore
}

const defaultProfileKeyOf: ProfileKeyOf = (r) => {
  return r.agentProfile?.cellId ?? r.candidateId
}

const defaultGroupOf: GroupOf = (r) => r.scenarioId

function defaultProfileLabel(record: RunRecord): string {
  const harness = record.agentProfile?.harness?.id
  return harness ? `${harness}·${record.model}` : record.model
}

function displayRowLabel(row: LeaderboardRow): string {
  return `${row.label} [${row.splitTag}]`
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))
  return sorted[idx] ?? 0
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

interface CostSummary {
  observedCostUsd: number
  estimatedCostUsd: number
  uncapturedCostRunCount: number
}

function summarizeCost(records: readonly RunRecord[]): CostSummary {
  const summary: CostSummary = {
    observedCostUsd: 0,
    estimatedCostUsd: 0,
    uncapturedCostRunCount: 0,
  }
  for (const record of records) {
    if (record.costProvenance.kind === 'observed') {
      summary.observedCostUsd += record.costProvenance.usd
    } else if (record.costProvenance.kind === 'estimated') {
      summary.estimatedCostUsd += record.costProvenance.usd
    } else {
      summary.uncapturedCostRunCount += 1
    }
  }
  return summary
}

function assertUniqueRunIds(records: readonly RunRecord[]): void {
  const runIds = new Set<string>()
  for (const record of records) {
    if (runIds.has(record.runId)) {
      throw new Error(`benchmark-report: duplicate runId ${record.runId}`)
    }
    runIds.add(record.runId)
  }
}

function evaluateScores(records: readonly RunRecord[], scoreOf: ScoreOf): Map<RunRecord, number> {
  const scores = new Map<RunRecord, number>()
  for (const record of records) {
    const score = scoreOf(record)
    if (score === undefined) {
      throw new Error(`benchmark-report: run ${record.runId} has no benchmark score`)
    }
    if (!Number.isFinite(score) || score < 0 || score > 1) {
      throw new Error(`benchmark-report: run ${record.runId} has invalid score ${String(score)}`)
    }
    scores.set(record, score)
  }
  return scores
}

/** Collapse reps to ONE mean score per scenario — the honest unit for a CI or a paired test. Reps
 *  tighten the per-(profile, scenario) estimate but are NOT independent samples, so feeding raw reps into
 *  a CI lets identical reps fake a narrower interval. Fails LOUD on a record missing `scenarioId`: an
 *  empty-string fallback would silently merge distinct scenarios into one bucket. */
function meanByScenario(
  records: readonly RunRecord[],
  scores: ReadonlyMap<RunRecord, number>,
): Map<string, number> {
  const sums = new Map<string, { total: number; n: number }>()
  for (const r of records) {
    const s = scores.get(r)
    if (s === undefined) {
      throw new Error(`benchmark-report: run ${r.runId} has no evaluated score`)
    }
    const id = r.scenarioId
    const acc = sums.get(id) ?? { total: 0, n: 0 }
    acc.total += s
    acc.n += 1
    sums.set(id, acc)
  }
  const out = new Map<string, number>()
  for (const [id, acc] of sums) out.set(id, acc.n ? acc.total / acc.n : 0)
  return out
}

/** Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. */
export function leaderboard(
  records: readonly RunRecord[],
  opts: LeaderboardOptions = {},
): Leaderboard {
  const validRecords = records.map((record) => validateRunRecord(record))
  const scoreOf = opts.scoreOf ?? defaultScoreOf
  const profileKeyOf = opts.profileKeyOf ?? defaultProfileKeyOf
  const groupOf = opts.groupOf ?? defaultGroupOf
  const pass = opts.passThreshold ?? 0.999
  if (!Number.isFinite(pass) || pass < 0 || pass > 1) {
    throw new Error(`benchmark-report: passThreshold must be in [0, 1], got ${String(pass)}`)
  }

  assertUniqueRunIds(validRecords)
  const scoresByRecord = evaluateScores(validRecords, scoreOf)

  // Column set: explicit axis decomposition, else the scenario groups present in the data.
  const axisSet = new Set<string>()
  const axisEntriesByRecord = new Map<RunRecord, Array<[string, number]>>()
  const groupByRecord = new Map<RunRecord, string>()
  if (opts.axisScoresOf) {
    for (const r of validRecords) {
      const entries = Object.entries(opts.axisScoresOf(r))
      axisEntriesByRecord.set(r, entries)
      for (const [axis, score] of entries) {
        if (axis.length === 0) {
          throw new Error(`benchmark-report: run ${r.runId} has an empty axis identity`)
        }
        if (!Number.isFinite(score) || score < 0 || score > 1) {
          throw new Error(
            `benchmark-report: run ${r.runId} has invalid axis score ${axis}=${String(score)}`,
          )
        }
        axisSet.add(axis)
      }
    }
  } else {
    for (const r of validRecords) {
      const axis = groupOf(r)
      if (axis.length === 0) {
        throw new Error(`benchmark-report: run ${r.runId} has an empty axis identity`)
      }
      groupByRecord.set(r, axis)
      axisSet.add(axis)
    }
  }
  const axes = [...axisSet].sort()

  // Split is an independent comparison dimension. Never average search/dev
  // and holdout observations into the same profile row.
  const bySplit = new Map<RunSplitTag, Map<string, RunRecord[]>>()
  for (const r of validRecords) {
    const key = profileKeyOf(r)
    if (key.length === 0) {
      throw new Error(`benchmark-report: run ${r.runId} has an empty profile identity`)
    }
    const byProfile = bySplit.get(r.splitTag) ?? new Map<string, RunRecord[]>()
    const bucket = byProfile.get(key)
    if (bucket) bucket.push(r)
    else byProfile.set(key, [r])
    bySplit.set(r.splitTag, byProfile)
  }

  const rows: LeaderboardRow[] = []
  for (const [splitTag, byProfile] of bySplit) {
    for (const [profileKey, recs] of byProfile) {
      const scenarioScores = meanByScenario(recs, scoresByRecord)
      const scores = [...scenarioScores.values()]
      const axisBuckets = new Map<string, Map<string, number[]>>()
      for (const r of recs) {
        if (opts.axisScoresOf) {
          const entries = axisEntriesByRecord.get(r)
          if (entries === undefined) {
            throw new Error(`benchmark-report: run ${r.runId} has no axis scores`)
          }
          for (const [axis, s] of entries) {
            const byScenario = axisBuckets.get(axis) ?? new Map<string, number[]>()
            const bucket = byScenario.get(r.scenarioId) ?? []
            bucket.push(s)
            byScenario.set(r.scenarioId, bucket)
            axisBuckets.set(axis, byScenario)
          }
        } else {
          const axis = groupByRecord.get(r)
          if (axis === undefined) {
            throw new Error(`benchmark-report: run ${r.runId} has no axis identity`)
          }
          const byScenario = axisBuckets.get(axis) ?? new Map<string, number[]>()
          const bucket = byScenario.get(r.scenarioId) ?? []
          const score = scoresByRecord.get(r)
          if (score === undefined) {
            throw new Error(`benchmark-report: run ${r.runId} has no evaluated score`)
          }
          bucket.push(score)
          byScenario.set(r.scenarioId, bucket)
          axisBuckets.set(axis, byScenario)
        }
      }
      const perAxis: Record<string, number> = {}
      for (const [axis, byScenario] of axisBuckets) {
        perAxis[axis] = mean([...byScenario.values()].map((scenarioReps) => mean(scenarioReps)))
      }

      const latencies = recs.map((r) => r.wallMs).sort((a, b) => a - b)
      let scoreCi: Interval | undefined
      let passCi: Interval | undefined
      if (opts.stats) {
        if (scores.length > 0) {
          const ci = confidenceInterval(scores, 0.95, { seed: 7 })
          scoreCi = { lower: ci.lower, upper: ci.upper }
          const w = wilson(scores.filter((s) => s >= pass).length, scores.length, 0.95)
          passCi = { lower: w.lower, upper: w.upper }
        }
      }
      const costSummary = summarizeCost(recs)
      rows.push({
        profileKey,
        splitTag,
        label: opts.labelOf
          ? opts.labelOf(profileKey)
          : opts.profileKeyOf
            ? profileKey
            : defaultProfileLabel(recs[0]!),
        model: recs[0]!.model,
        runCount: recs.length,
        scenarioCount: scenarioScores.size,
        meanScore: mean(scores),
        solveRate: scores.length === 0 ? 0 : scores.filter((s) => s >= pass).length / scores.length,
        perAxis,
        ...costSummary,
        tokensIn: recs.reduce((a, r) => a + r.tokenUsage.input, 0),
        tokensOut: recs.reduce((a, r) => a + r.tokenUsage.output, 0),
        latencyP50Ms: quantile(latencies, 0.5),
        latencyP90Ms: quantile(latencies, 0.9),
        ...(scoreCi ? { scoreCi } : {}),
        ...(passCi ? { passCi } : {}),
      })
    }
  }

  rows.sort(
    (a, b) =>
      b.meanScore - a.meanScore ||
      a.splitTag.localeCompare(b.splitTag) ||
      a.label.localeCompare(b.label),
  )

  const models = [...new Set(validRecords.map((r) => r.model))].sort()
  const splits = [...new Set(validRecords.map((r) => r.splitTag))].sort()
  const costSummary = summarizeCost(validRecords)
  return {
    title: opts.title ?? 'Benchmark report',
    axes,
    profiles: rows,
    meta: opts.meta ?? {},
    provenance: {
      runCount: validRecords.length,
      scenarioCount: new Set(validRecords.map((record) => record.scenarioId)).size,
      profiles: rows.length,
      axes: axes.length,
      models,
      splits,
      ...costSummary,
    },
  }
}

/** One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict. */
export interface PairwiseVerdict {
  readonly splitTag: RunSplitTag
  readonly a: string
  readonly b: string
  /** Paired unit count (shared scenarios). The significance is suppressed below `minPairs`. */
  readonly pairs: number
  /** Median paired delta (b − a) and its bootstrap CI. */
  readonly delta: number
  readonly ciLow: number
  readonly ciHigh: number
  /** Paired-test p-value (before correction). */
  readonly p: number
  /** BH-significant across ALL pairs AND above the `minPairs` power floor. */
  readonly significant: boolean
}

export interface PairwiseOptions {
  readonly scoreOf?: ScoreOf
  readonly profileKeyOf?: ProfileKeyOf
  readonly labelOf?: (profileKey: string) => string
  /** False-discovery rate for the Benjamini–Hochberg correction. Default 0.05. */
  readonly fdr?: number
  /** Below this many shared scenarios a paired test can't defensibly separate two profiles, so the
   *  `significant` tag is suppressed regardless of p (small-n mirage protection). Default 12. */
  readonly minPairs?: number
}

/** Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real
 *  paired-test p-value, BH-corrected across all pairs. This is the honest "did A beat B" table the
 *  leaderboard's point ranking cannot answer. Reuses the agent-eval statistics substrate. */
export function pairwiseSignificance(
  records: readonly RunRecord[],
  opts: PairwiseOptions = {},
): PairwiseVerdict[] {
  const validRecords = records.map((record) => validateRunRecord(record))
  assertUniqueRunIds(validRecords)
  const scoreOf = opts.scoreOf ?? defaultScoreOf
  const profileKeyOf = opts.profileKeyOf ?? defaultProfileKeyOf
  const labelOf = opts.labelOf ?? ((k: string) => k)
  const minPairs = opts.minPairs ?? 12
  const scoresByRecord = evaluateScores(validRecords, scoreOf)

  const bySplit = new Map<RunSplitTag, Map<string, RunRecord[]>>()
  for (const r of validRecords) {
    const k = profileKeyOf(r)
    if (k.length === 0) {
      throw new Error(`benchmark-report: run ${r.runId} has an empty profile identity`)
    }
    const byProfile = bySplit.get(r.splitTag) ?? new Map<string, RunRecord[]>()
    const b = byProfile.get(k)
    if (b) b.push(r)
    else byProfile.set(k, [r])
    bySplit.set(r.splitTag, byProfile)
  }

  const raw: Array<Omit<PairwiseVerdict, 'significant'>> = []
  for (const [splitTag, byProfile] of [...bySplit].sort(([a], [b]) => a.localeCompare(b))) {
    const keys = [...byProfile.keys()].sort()
    const collapsed = new Map(
      keys.map((k) => [k, meanByScenario(byProfile.get(k) ?? [], scoresByRecord)]),
    )
    for (let i = 0; i < keys.length; i += 1) {
      for (let j = i + 1; j < keys.length; j += 1) {
        const ka = keys[i] as string
        const kb = keys[j] as string
        const am = collapsed.get(ka) as Map<string, number>
        const bm = collapsed.get(kb) as Map<string, number>
        const aScores: number[] = []
        const bScores: number[] = []
        for (const sid of [...am.keys()].sort()) {
          const bv = bm.get(sid)
          if (bv !== undefined) {
            aScores.push(am.get(sid) as number)
            bScores.push(bv)
          }
        }
        if (aScores.length === 0) continue
        const boot = pairedBootstrap(aScores, bScores, { seed: 7, statistic: 'median' })
        const p = pairedTTest(aScores, bScores).p
        raw.push({
          splitTag,
          a: labelOf(ka),
          b: labelOf(kb),
          pairs: aScores.length,
          delta: boot.median,
          ciLow: boot.low,
          ciHigh: boot.high,
          p,
        })
      }
    }
  }
  const { significant } = benjaminiHochberg(
    raw.map((r) => r.p),
    opts.fdr ?? 0.05,
  )
  return raw.map((r, i) => ({
    ...r,
    significant: (significant[i] ?? false) && r.pairs >= minPairs,
  }))
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`
const ci = (iv: Interval | undefined): string => (iv ? ` [${pct(iv.lower)}, ${pct(iv.upper)}]` : '')
const usd = (value: number, decimals: number): string => `$${value.toFixed(decimals)}`

/** Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis
 *  matrix → cost/latency/token columns. Every axis is shown — a curated subset is a reporting failure. */
export function renderLeaderboardMarkdown(report: Leaderboard): string {
  const lines: string[] = []
  lines.push(`# ${report.title}`, '')
  const p = report.provenance
  lines.push(
    `**${p.profiles} profiles × ${p.axes} axes**, ${p.runCount} runs across ${p.scenarioCount} scenarios, ${p.models.length} models`,
    `**Cost:** ${usd(p.observedCostUsd, 2)} observed, ${usd(p.estimatedCostUsd, 2)} estimated, ${p.uncapturedCostRunCount} runs uncaptured`,
    '',
  )
  for (const [k, v] of Object.entries(report.meta)) lines.push(`- **${k}:** ${v}`)
  if (Object.keys(report.meta).length) lines.push('')

  // Leaderboard — the headline ranking with every measured column (+ CIs when computed).
  lines.push('## Leaderboard', '')
  lines.push(
    '| # | Profile | Split | Score (95% CI) | Solved (95% CI) | Runs | Scenarios | Observed cost | Estimated cost | Unknown cost runs | Tok in/out | p50 | p90 |',
  )
  lines.push('|---|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|')
  report.profiles.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.label} | ${r.splitTag} | ${pct(r.meanScore)}${ci(r.scoreCi)} | ${pct(r.solveRate)}${ci(r.passCi)} | ${r.runCount} | ${r.scenarioCount} | ${usd(r.observedCostUsd, 3)} | ${usd(r.estimatedCostUsd, 3)} | ${r.uncapturedCostRunCount} | ${r.tokensIn}/${r.tokensOut} | ${(r.latencyP50Ms / 1000).toFixed(1)}s | ${(r.latencyP90Ms / 1000).toFixed(1)}s |`,
    )
  })
  lines.push('')

  // The full matrix — profile × every axis.
  lines.push('## Score matrix — profile × axis', '')
  lines.push(`| Profile | Split | ${report.axes.join(' | ')} |`)
  lines.push(`|---|---|${report.axes.map(() => '--:').join('|')}|`)
  for (const r of report.profiles) {
    const cells = report.axes.map((a) => {
      const v = r.perAxis[a]
      return v === undefined ? '·' : pct(v)
    })
    lines.push(`| ${r.label} | ${r.splitTag} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push('> `·` = the profile never ran that axis (blank, never zero).')
  return lines.join('\n')
}

/** Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected
 *  verdict. Feed it `pairwiseSignificance(records)`. This is the "did A really beat B" evidence the point
 *  ranking cannot give. */
export function renderPairwiseMarkdown(
  verdicts: readonly PairwiseVerdict[],
  title = 'Pairwise significance (paired, BH-corrected)',
): string {
  const lines: string[] = [`## ${title}`, '']
  if (verdicts.length === 0) return lines.concat('_no comparable pairs_').join('\n')
  lines.push('| Split | A vs B | Δ(b−a) median | 95% CI | pairs | p | verdict |')
  lines.push('|---|---|--:|--:|--:|--:|---|')
  for (const v of verdicts) {
    const verdict = v.significant ? `**${v.delta >= 0 ? v.b : v.a} wins**` : 'ns'
    lines.push(
      `| ${v.splitTag} | ${v.a} vs ${v.b} | ${v.delta >= 0 ? '+' : ''}${pct(v.delta)} | [${pct(v.ciLow)}, ${pct(v.ciHigh)}] | ${v.pairs} | ${v.p.toFixed(3)} | ${verdict} |`,
    )
  }
  lines.push(
    '',
    '> `ns` = not significant after Benjamini–Hochberg (or below the paired-count floor).',
  )
  return lines.join('\n')
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// A score → color ramp (red→amber→green) for the heatmap, deterministic and dependency-free.
function ramp(score: number): string {
  const x = Math.max(0, Math.min(1, score))
  const r = Math.round(x < 0.5 ? 220 : 220 - (x - 0.5) * 2 * 160)
  const g = Math.round(x < 0.5 ? x * 2 * 170 : 170)
  return `rgb(${r},${g},60)`
}

/** Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps,
 *  embeddable anywhere (README, HTML page, hosted leaderboard). */
export function renderLeaderboardSvg(report: Leaderboard): string {
  const rowH = 26
  const labelW = 220
  const cellW = 54
  const pad = 16
  const barAreaW = 360
  const profiles = report.profiles
  const barsH = profiles.length * rowH + pad
  const heatTop = barsH + 48
  const heatW = labelW + report.axes.length * cellW + pad
  const heatH = profiles.length * rowH + pad
  const width = Math.max(labelW + barAreaW + pad * 2, heatW)
  const height = heatTop + heatH + pad

  const out: string[] = []
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="12">`,
  )
  out.push(`<rect width="${width}" height="${height}" fill="white"/>`)
  out.push(
    `<text x="${pad}" y="${pad + 4}" font-weight="700" font-size="14">${esc(report.title)} — score</text>`,
  )

  // Bar chart (ranked).
  profiles.forEach((r, i) => {
    const y = pad + 12 + i * rowH
    out.push(`<text x="${pad}" y="${y + 14}">${esc(displayRowLabel(r))}</text>`)
    const w = Math.round(r.meanScore * barAreaW)
    out.push(`<rect x="${labelW}" y="${y + 4}" width="${barAreaW}" height="16" fill="#eef0f2"/>`)
    out.push(
      `<rect x="${labelW}" y="${y + 4}" width="${w}" height="16" fill="${ramp(r.meanScore)}"/>`,
    )
    out.push(`<text x="${labelW + barAreaW + 6}" y="${y + 16}">${pct(r.meanScore)}</text>`)
  })

  // Heatmap.
  out.push(
    `<text x="${pad}" y="${heatTop - 12}" font-weight="700" font-size="14">profile × axis</text>`,
  )
  report.axes.forEach((a, c) => {
    const x = labelW + c * cellW
    out.push(
      `<text x="${x + cellW / 2}" y="${heatTop}" text-anchor="middle" fill="#555">${esc(a.length > 8 ? `${a.slice(0, 7)}…` : a)}</text>`,
    )
  })
  profiles.forEach((r, i) => {
    const y = heatTop + 8 + i * rowH
    out.push(`<text x="${pad}" y="${y + 16}">${esc(displayRowLabel(r))}</text>`)
    report.axes.forEach((a, c) => {
      const x = labelW + c * cellW
      const s = r.perAxis[a]
      if (s !== undefined) {
        out.push(
          `<rect x="${x}" y="${y}" width="${cellW - 3}" height="${rowH - 4}" fill="${ramp(s)}"/>`,
        )
        out.push(
          `<text x="${x + (cellW - 3) / 2}" y="${y + 15}" text-anchor="middle" fill="white" font-size="10">${Math.round(100 * s)}</text>`,
        )
      } else {
        out.push(
          `<rect x="${x}" y="${y}" width="${cellW - 3}" height="${rowH - 4}" fill="#f3f4f6"/>`,
        )
      }
    })
  })
  out.push('</svg>')
  return out.join('\n')
}

/** Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown
 *  matrix as a table. Single file, no assets, opens in any browser. */
export function renderLeaderboardHtml(report: Leaderboard): string {
  const svg = renderLeaderboardSvg(report)
  const p = report.provenance
  const rows = report.profiles
    .map(
      (r, i) =>
        `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td>${r.splitTag}</td><td class="n">${pct(r.meanScore)}</td><td class="n">${pct(r.solveRate)}</td><td class="n">${r.runCount}</td><td class="n">${r.scenarioCount}</td><td class="n">${usd(r.observedCostUsd, 3)}</td><td class="n">${usd(r.estimatedCostUsd, 3)}</td><td class="n">${r.uncapturedCostRunCount}</td>${report.axes
          .map((a) => {
            const v = r.perAxis[a]
            return `<td class="n">${v === undefined ? '·' : pct(v)}</td>`
          })
          .join('')}</tr>`,
    )
    .join('\n')
  const axisHead = report.axes.map((a) => `<th>${esc(a)}</th>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(report.title)}</title>
<style>
body{font:14px ui-sans-serif,system-ui,sans-serif;margin:2rem;color:#111}
h1{font-size:1.4rem}.sub{color:#555;margin:.2rem 0 1.2rem}
table{border-collapse:collapse;margin-top:1rem}td,th{border:1px solid #e5e7eb;padding:.35rem .6rem}
th{background:#f9fafb;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
tr:first-child td{font-weight:600}
</style></head><body>
<h1>${esc(report.title)}</h1>
<div class="sub">${p.profiles} profiles × ${p.axes} axes · ${p.runCount} runs across ${p.scenarioCount} scenarios · ${p.models.length} models · ${usd(p.observedCostUsd, 2)} observed · ${usd(p.estimatedCostUsd, 2)} estimated · ${p.uncapturedCostRunCount} runs with unknown cost</div>
${svg}
<table><thead><tr><th>#</th><th>Profile</th><th>Split</th><th>Score</th><th>Solved</th><th>Runs</th><th>Scenarios</th><th>Observed cost</th><th>Estimated cost</th><th>Unknown cost runs</th>${axisHead}</tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`
}
