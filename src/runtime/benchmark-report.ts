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
import type { RunRecord } from '@tangle-network/agent-eval'

/** Pull the headline score in [0,1] from a record. Default: the held-out split, else the search split,
 *  else a `composite`/`passed`/`score` entry in the raw bag. Override to score a domain differently. */
export type ScoreOf = (record: RunRecord) => number | undefined
/** The profile (matrix row) a record belongs to — default `harness·model` from the record's profile cell,
 *  falling back to the model. This is the leaderboard's unit of comparison. */
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
  /** Display label for a profile key (default: the key itself). */
  readonly labelOf?: (profileKey: string) => string
  /** Commit SHA / dataset / dates surfaced in the provenance block. */
  readonly meta?: Record<string, string>
}

/** One leaderboard row — a harness×model profile, every measured column. */
export interface LeaderboardRow {
  readonly profileKey: string
  readonly label: string
  readonly model: string
  readonly n: number
  readonly meanScore: number
  /** Fraction of records scoring ≥ 0.999 — the binary "fully solved" rate. */
  readonly solveRate: number
  /** axis → mean score for this profile (blank in render when the profile never ran that axis). */
  readonly perAxis: Record<string, number>
  readonly costUsd: number
  readonly tokensIn: number
  readonly tokensOut: number
  readonly latencyP50Ms: number
  readonly latencyP90Ms: number
}

export interface Leaderboard {
  readonly title: string
  /** Column order — scenario groups (default) or dimension keys (`axisScoresOf`). */
  readonly axes: readonly string[]
  /** Rows ranked by `meanScore` desc (ties → lower cost, then label). */
  readonly profiles: readonly LeaderboardRow[]
  readonly meta: Record<string, string>
  /** Provenance counts — the denominators every honest report leads with. */
  readonly provenance: {
    readonly records: number
    readonly profiles: number
    readonly axes: number
    readonly models: readonly string[]
    readonly totalCostUsd: number
  }
}

const defaultScoreOf: ScoreOf = (r) => {
  const o = r.outcome
  if (typeof o.holdoutScore === 'number') return o.holdoutScore
  if (typeof o.searchScore === 'number') return o.searchScore
  const raw = o.raw ?? {}
  for (const k of ['composite', 'score', 'passed', 'resolved']) {
    if (typeof raw[k] === 'number') return raw[k]
  }
  return undefined
}

const defaultProfileKeyOf: ProfileKeyOf = (r) => {
  const cell = (r as { agentProfile?: { harness?: string; model?: string } }).agentProfile
  const harness = cell?.harness
  return harness ? `${harness}·${r.model}` : r.model
}

const defaultGroupOf: GroupOf = (r) => r.scenarioId ?? r.experimentId

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))
  return sorted[idx] ?? 0
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length
}

/** Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic. */
export function leaderboard(
  records: readonly RunRecord[],
  opts: LeaderboardOptions = {},
): Leaderboard {
  const scoreOf = opts.scoreOf ?? defaultScoreOf
  const profileKeyOf = opts.profileKeyOf ?? defaultProfileKeyOf
  const groupOf = opts.groupOf ?? defaultGroupOf
  const labelOf = opts.labelOf ?? ((k: string) => k)

  // Column set: explicit axis decomposition, else the scenario groups present in the data.
  const axisSet = new Set<string>()
  if (opts.axisScoresOf) {
    for (const r of records) for (const k of Object.keys(opts.axisScoresOf(r))) axisSet.add(k)
  } else {
    for (const r of records) axisSet.add(groupOf(r))
  }
  const axes = [...axisSet].sort()

  // Bucket records by profile.
  const byProfile = new Map<string, RunRecord[]>()
  for (const r of records) {
    const key = profileKeyOf(r)
    const bucket = byProfile.get(key)
    if (bucket) bucket.push(r)
    else byProfile.set(key, [r])
  }

  const rows: LeaderboardRow[] = []
  for (const [profileKey, recs] of byProfile) {
    const scores = recs.map(scoreOf).filter((s): s is number => typeof s === 'number')
    // Per-axis means.
    const axisBuckets = new Map<string, number[]>()
    for (const r of recs) {
      if (opts.axisScoresOf) {
        for (const [axis, s] of Object.entries(opts.axisScoresOf(r))) {
          const b = axisBuckets.get(axis) ?? []
          b.push(s)
          axisBuckets.set(axis, b)
        }
      } else {
        const s = scoreOf(r)
        if (typeof s === 'number') {
          const axis = groupOf(r)
          const b = axisBuckets.get(axis) ?? []
          b.push(s)
          axisBuckets.set(axis, b)
        }
      }
    }
    const perAxis: Record<string, number> = {}
    for (const [axis, b] of axisBuckets) perAxis[axis] = mean(b)

    const latencies = recs.map((r) => r.wallMs).sort((a, b) => a - b)
    rows.push({
      profileKey,
      label: labelOf(profileKey),
      model: recs[0]?.model ?? profileKey,
      n: recs.length,
      meanScore: mean(scores),
      solveRate: scores.length === 0 ? 0 : scores.filter((s) => s >= 0.999).length / scores.length,
      perAxis,
      costUsd: recs.reduce((a, r) => a + r.costUsd, 0),
      tokensIn: recs.reduce((a, r) => a + (r.tokenUsage?.input ?? 0), 0),
      tokensOut: recs.reduce((a, r) => a + (r.tokenUsage?.output ?? 0), 0),
      latencyP50Ms: quantile(latencies, 0.5),
      latencyP90Ms: quantile(latencies, 0.9),
    })
  }

  // Rank: score desc, then cheaper, then label for a stable order.
  rows.sort(
    (a, b) => b.meanScore - a.meanScore || a.costUsd - b.costUsd || a.label.localeCompare(b.label),
  )

  const models = [...new Set(records.map((r) => r.model))].sort()
  return {
    title: opts.title ?? 'Benchmark report',
    axes,
    profiles: rows,
    meta: opts.meta ?? {},
    provenance: {
      records: records.length,
      profiles: rows.length,
      axes: axes.length,
      models,
      totalCostUsd: records.reduce((a, r) => a + r.costUsd, 0),
    },
  }
}

const pct = (x: number): string => `${(100 * x).toFixed(1)}%`

/** Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis
 *  matrix → cost/latency/token columns. Every axis is shown — a curated subset is a reporting failure. */
export function renderLeaderboardMarkdown(report: Leaderboard): string {
  const lines: string[] = []
  lines.push(`# ${report.title}`, '')
  const p = report.provenance
  lines.push(
    `**${p.profiles} profiles × ${p.axes} axes**, ${p.records} runs, ${p.models.length} models · total $${p.totalCostUsd.toFixed(2)}`,
    '',
  )
  for (const [k, v] of Object.entries(report.meta)) lines.push(`- **${k}:** ${v}`)
  if (Object.keys(report.meta).length) lines.push('')

  // Leaderboard — the headline ranking with every measured column.
  lines.push('## Leaderboard', '')
  lines.push('| # | Profile | Score | Solved | Runs | Cost | Tok in/out | p50 | p90 |')
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|--:|')
  report.profiles.forEach((r, i) => {
    lines.push(
      `| ${i + 1} | ${r.label} | ${pct(r.meanScore)} | ${pct(r.solveRate)} | ${r.n} | $${r.costUsd.toFixed(3)} | ${r.tokensIn}/${r.tokensOut} | ${(r.latencyP50Ms / 1000).toFixed(1)}s | ${(r.latencyP90Ms / 1000).toFixed(1)}s |`,
    )
  })
  lines.push('')

  // The full matrix — profile × every axis.
  lines.push('## Score matrix — profile × axis', '')
  lines.push(`| Profile | ${report.axes.join(' | ')} |`)
  lines.push(`|---|${report.axes.map(() => '--:').join('|')}|`)
  for (const r of report.profiles) {
    const cells = report.axes.map((a) => {
      const v = r.perAxis[a]
      return v === undefined ? '·' : pct(v)
    })
    lines.push(`| ${r.label} | ${cells.join(' | ')} |`)
  }
  lines.push('')
  lines.push('> `·` = the profile never ran that axis (blank, never zero).')
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
    out.push(`<text x="${pad}" y="${y + 14}">${esc(r.label)}</text>`)
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
    out.push(`<text x="${pad}" y="${y + 16}">${esc(r.label)}</text>`)
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
        `<tr><td>${i + 1}</td><td>${esc(r.label)}</td><td class="n">${pct(r.meanScore)}</td><td class="n">${pct(r.solveRate)}</td><td class="n">${r.n}</td><td class="n">$${r.costUsd.toFixed(3)}</td>${report.axes
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
<div class="sub">${p.profiles} profiles × ${p.axes} axes · ${p.records} runs · ${p.models.length} models · total $${p.totalCostUsd.toFixed(2)}</div>
${svg}
<table><thead><tr><th>#</th><th>Profile</th><th>Score</th><th>Solved</th><th>Runs</th><th>Cost</th>${axisHead}</tr></thead>
<tbody>
${rows}
</tbody></table>
</body></html>`
}
