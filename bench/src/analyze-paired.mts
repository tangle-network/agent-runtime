/**
 * Paired bootstrap CI on a blind/random@k/refine@k scorecard (finsearch-loop output).
 * Reads the jsonl; computes rates + 95% bootstrap CIs on the PAIRED deltas
 * (random@k − blind = more-compute effect; refine@k − random@k = isolated steering).
 * A CI is obtainable at reps=1 by resampling INSTANCES — wide, but honest.
 *
 *   tsx src/analyze-paired.mts /tmp/finsearch-isolate.jsonl [bootstrapN]
 */
import { readFileSync } from 'node:fs'

const path = process.argv[2] ?? '/tmp/finsearch-isolate.jsonl'
const B = Number(process.argv[3] ?? 10000)
const rows = readFileSync(path, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as Record<string, unknown>)
  .filter((r) => !r.error && !r.infraError && typeof r.blind === 'boolean')

const n = rows.length
if (n === 0) {
  console.log(`no clean paired rows in ${path}`)
  process.exit(0)
}
const b = rows.map((r) => (r.blind ? 1 : 0))
const rnd = rows.map((r) => (r.randomK ? 1 : 0))
// 3-way scorecard uses refineHand/refineGepa; 2-way used refineK (fall back).
const refH = rows.map((r) => ((r.refineHand ?? r.refineK) ? 1 : 0))
const refG = rows.map((r) => (r.refineGepa ? 1 : 0))
const hasGepa = rows.some((r) => typeof r.refineGepa === 'boolean')
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length
// Deterministic mulberry32 (Math.imul — no >2^53 overflow, unlike a naive LCG).
let s = 0x9e3779b9
const rnd01 = () => {
  s = (s + 0x6d2b79f5) | 0
  let t = Math.imul(s ^ (s >>> 15), 1 | s)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const rint = (m: number) => Math.floor(rnd01() * m)
function ci(delta: (i: number) => number): [number, number, number] {
  const point = mean(rows.map((_, i) => delta(i)))
  const boots: number[] = []
  for (let bi = 0; bi < B; bi++) {
    let s = 0
    for (let j = 0; j < n; j++) s += delta(rint(n))
    boots.push(s / n)
  }
  boots.sort((x, y) => x - y)
  return [point, boots[Math.floor(0.025 * B)] ?? Number.NaN, boots[Math.floor(0.975 * B)] ?? Number.NaN]
}
const pp = (x: number) => `${(x * 100).toFixed(1)}pp`
const line = (label: string, delta: (i: number) => number, discA: number[], discB: number[]) => {
  const [d, lc, hc] = ci(delta)
  const disc = rows.filter((_, i) => discA[i] !== discB[i]).length
  // Significant iff the CI excludes 0 on EITHER side — a CI entirely below 0 is a
  // significant NEGATIVE effect (steering that HARMS), not "spans 0". The prior
  // `lc > 0` check silently mislabeled harm as non-significant.
  const significant = lc > 0 || hc < 0
  console.log(`  ${label.padEnd(28)} ${pp(d).padStart(7)}  95% CI [${pp(lc)}, ${pp(hc)}]  ${significant ? 'SIGNIFICANT' : 'spans 0'}  (discordant ${disc}/${n})`)
}
console.log(`paired bootstrap (clean n=${n}, B=${B})`)
console.log(`  blind: ${(mean(b) * 100).toFixed(1)}%  random@k: ${(mean(rnd) * 100).toFixed(1)}%  refineHand: ${(mean(refH) * 100).toFixed(1)}%${hasGepa ? `  refineGepa: ${(mean(refG) * 100).toFixed(1)}%` : ''}`)
line('more-compute(random−blind)', (i) => (rnd[i] ?? 0) - (b[i] ?? 0), rnd, b)
line('steerHand(refineHand−random)', (i) => (refH[i] ?? 0) - (rnd[i] ?? 0), refH, rnd)
if (hasGepa) line('steerGEPA(refineGepa−random)', (i) => (refG[i] ?? 0) - (rnd[i] ?? 0), refG, rnd)
