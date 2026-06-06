/**
 * Render the gate results as clean, dependency-free SVG bar charts.
 *
 * One honest chart per benchmark: bars for each arm (baseline greys + the
 * verifier-grounded method in the accent), an optional dashed oracle-ceiling line,
 * and a single annotated delta. No chartjunk — value labels, one accent, lots of
 * whitespace. Data is passed in (no hidden numbers) so the charts regenerate from
 * the real run outputs.
 *
 *   node bench/scripts/render-gate-chart.mjs            # writes docs/assets/*.svg
 *   (then: cairosvg docs/assets/<f>.svg -o /tmp/<f>.png  to preview)
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const assetsDir = join(here, '..', '..', 'docs', 'assets')

const palette = {
  bg: '#ffffff',
  ink: '#0f172a', // slate-900 — titles, values
  muted: '#64748b', // slate-500 — subtitles, labels
  faint: '#e2e8f0', // slate-200 — baseline / axis
  baseline: '#cbd5e1', // slate-300 — "blind" / weaker baselines
  baseline2: '#94a3b8', // slate-400 — the competing selector
  method: '#4f46e5', // indigo-600 — the verifier-grounded method (the hero)
  methodSoft: '#eef2ff', // indigo-50 — method bar wash
  ceiling: '#475569', // slate-600 — oracle ceiling line
  good: '#059669', // emerald-600 — positive delta
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const f = 'system-ui, -apple-system, "Segoe UI", Inter, Roboto, sans-serif'

/**
 * @param {{
 *   title: string, subtitle: string, footnote?: string,
 *   bars: {label: string, value: number, kind: 'blind'|'rival'|'method'}[],
 *   ceiling?: {value: number, label: string},
 *   delta?: {fromIdx: number, toIdx: number, label: string},
 *   yMax?: number, unit?: string,
 * }} cfg
 */
function chart(cfg) {
  const W = 820
  const H = 524
  const m = { top: 152, right: 136, bottom: 120, left: 66 }
  const plotW = W - m.left - m.right
  const plotH = H - m.top - m.bottom
  const yMax = cfg.yMax ?? 100
  const unit = cfg.unit ?? '%'
  const y = (v) => m.top + plotH * (1 - v / yMax)

  const n = cfg.bars.length
  const bandW = plotW / n
  const barW = Math.min(112, bandW * 0.56)
  const cx = (i) => m.left + bandW * (i + 0.5)
  const fill = { blind: palette.baseline, rival: palette.baseline2, method: palette.method }

  const parts = []
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family='${f}'>`)
  parts.push(`<rect width="${W}" height="${H}" fill="${palette.bg}"/>`)

  // title + subtitle
  parts.push(`<text x="${m.left}" y="46" font-size="22" font-weight="700" fill="${palette.ink}">${esc(cfg.title)}</text>`)
  parts.push(`<text x="${m.left}" y="72" font-size="13.5" fill="${palette.muted}">${esc(cfg.subtitle)}</text>`)

  // baseline axis
  parts.push(`<line x1="${m.left}" y1="${y(0)}" x2="${m.left + plotW}" y2="${y(0)}" stroke="${palette.faint}" stroke-width="1.5"/>`)
  // light gridlines at 25/50/75/100
  for (const g of [25, 50, 75, 100]) {
    if (g > yMax) continue
    parts.push(`<line x1="${m.left}" y1="${y(g)}" x2="${m.left + plotW}" y2="${y(g)}" stroke="${palette.faint}" stroke-width="1" stroke-dasharray="2 5"/>`)
    parts.push(`<text x="${m.left - 12}" y="${y(g) + 4}" font-size="11" text-anchor="end" fill="${palette.muted}">${g}${unit}</text>`)
  }

  // oracle ceiling line
  if (cfg.ceiling) {
    const yc = y(cfg.ceiling.value)
    parts.push(`<line x1="${m.left}" y1="${yc}" x2="${m.left + plotW}" y2="${yc}" stroke="${palette.ceiling}" stroke-width="1.5" stroke-dasharray="6 4"/>`)
    parts.push(`<text x="${m.left + plotW + 8}" y="${yc - 5}" font-size="12" font-weight="600" fill="${palette.ceiling}">${esc(cfg.ceiling.label)}</text>`)
    parts.push(`<text x="${m.left + plotW + 8}" y="${yc + 12}" font-size="12" fill="${palette.ceiling}">${cfg.ceiling.value}${unit}</text>`)
  }

  // bars
  cfg.bars.forEach((b, i) => {
    const x = cx(i) - barW / 2
    const top = y(b.value)
    const h = y(0) - top
    const isMethod = b.kind === 'method'
    if (isMethod) parts.push(`<rect x="${x - 3}" y="${top - 3}" width="${barW + 6}" height="${h + 3}" rx="7" fill="${palette.methodSoft}"/>`)
    parts.push(`<rect x="${x}" y="${top}" width="${barW}" height="${h}" rx="5" fill="${fill[b.kind]}"/>`)
    // value label
    parts.push(`<text x="${cx(i)}" y="${top - 12}" font-size="16" font-weight="700" text-anchor="middle" fill="${isMethod ? palette.method : palette.ink}">${b.value}${unit}</text>`)
    // x label (two lines if it contains a newline)
    const lines = b.label.split('\n')
    lines.forEach((ln, li) => {
      parts.push(`<text x="${cx(i)}" y="${y(0) + 24 + li * 16}" font-size="12.5" font-weight="${isMethod ? 600 : 400}" text-anchor="middle" fill="${isMethod ? palette.method : palette.muted}">${esc(ln)}</text>`)
    })
  })

  // delta annotation: a bracket from one bar's top to another's, labelled
  if (cfg.delta) {
    const a = cfg.delta.fromIdx
    const b = cfg.delta.toIdx
    const xa = cx(a)
    const xb = cx(b)
    const ya = y(cfg.bars[a].value)
    const yb = y(cfg.bars[b].value)
    const yBar = Math.min(ya, yb) - 34
    const midx = (xa + xb) / 2
    parts.push(`<line x1="${xa}" y1="${ya - 26}" x2="${xa}" y2="${yBar}" stroke="${palette.good}" stroke-width="1.25"/>`)
    parts.push(`<line x1="${xb}" y1="${yb - 26}" x2="${xb}" y2="${yBar}" stroke="${palette.good}" stroke-width="1.25"/>`)
    parts.push(`<line x1="${xa}" y1="${yBar}" x2="${xb}" y2="${yBar}" stroke="${palette.good}" stroke-width="1.25"/>`)
    const lw = cfg.delta.label.length * 7.2 + 16
    parts.push(`<rect x="${midx - lw / 2}" y="${yBar - 22}" width="${lw}" height="20" rx="10" fill="${palette.good}"/>`)
    parts.push(`<text x="${midx}" y="${yBar - 8}" font-size="12.5" font-weight="700" text-anchor="middle" fill="#ffffff">${esc(cfg.delta.label)}</text>`)
  }

  if (cfg.footnote) {
    // wrap to the plot width (~92 chars at 11.5px over the full canvas)
    const words = cfg.footnote.split(' ')
    const lines = []
    let cur = ''
    for (const w of words) {
      if ((cur + ' ' + w).trim().length > 104) {
        lines.push(cur.trim())
        cur = w
      } else cur = `${cur} ${w}`
    }
    if (cur.trim()) lines.push(cur.trim())
    const startY = H - 20 - (lines.length - 1) * 15
    lines.forEach((ln, i) => {
      parts.push(`<text x="${m.left}" y="${startY + i * 15}" font-size="11.5" fill="${palette.muted}">${esc(ln)}</text>`)
    })
  }
  parts.push('</svg>')
  return parts.join('\n')
}

// ---- the charts (numbers are the real, verified run outputs) -------------------

const humaneval = chart({
  title: 'Verifier-grounded selection recovers the oracle ceiling',
  subtitle: 'HumanEval · gpt-3.5-turbo · k=4 · n=50 · paired bootstrap (B=10000) + Benjamini–Hochberg',
  bars: [
    { label: 'Blind\n(1 shot)', value: 80, kind: 'blind' },
    { label: 'Self-consistency\n(pick the consensus)', value: 82, kind: 'rival' },
    { label: 'Verifier-grounded\n(re-run the tests)', value: 92, kind: 'method' },
  ],
  ceiling: { value: 92, label: 'oracle ceiling', },
  delta: { fromIdx: 1, toIdx: 2, label: '+10.0pp  CI[+2, +18]' },
  footnote: 'Deployable, non-oracle selector: ranks k attempts by re-running the task’s own unit tests (gold never shown). It captures the FULL ceiling (gap 0); self-consistency leaves 10pp on the table. Reproduced across two independent n=50 runs (+10pp / +12pp, both BH-positive).',
})

// commit0 — single-task Layer-1 VALIDATION (wcwidth, k=3). Regenerate with the powered
// n=10 cross-task gate when it lands. Honestly labelled as a per-task validation.
const commit0Validation = chart({
  title: 'The selector signal survives real stateful coding rollouts',
  subtitle: 'commit0 · gpt-4.1 · k=3 · single-task validation (wcwidth) — official pytest harness, graded pass-rate',
  bars: [
    { label: 'Random pick\n(blind, mean-of-k)', value: 67.5, kind: 'blind' },
    { label: 'Verifier-grounded\n(highest test-pass)', value: 78.9, kind: 'method' },
  ],
  ceiling: { value: 78.9, label: 'best-of-k', },
  delta: { fromIdx: 0, toIdx: 1, label: '+11.4pp' },
  footnote: 'Layer-1: agent clones the repo, implements, runs pytest, iterates, emits a diff. Attempts score 60.5 / 78.9 / 63.2% — within-task variance the selector exploits. Powered n=10 cross-task gate in progress.',
})

mkdirSync(assetsDir, { recursive: true })
writeFileSync(join(assetsDir, 'gate-humaneval.svg'), humaneval)
writeFileSync(join(assetsDir, 'gate-commit0-validation.svg'), commit0Validation)
console.log(`wrote ${join(assetsDir, 'gate-humaneval.svg')}`)
console.log(`wrote ${join(assetsDir, 'gate-commit0-validation.svg')}`)
