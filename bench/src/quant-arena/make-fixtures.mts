/**
 * Deterministic synthetic market generator — writes the vendored fixtures.
 *
 *   tsx src/quant-arena/make-fixtures.mts        # regenerates fixtures/data/**
 *
 * Why synthetic (see fixtures/data/PROVENANCE.md): the free daily-bar sources
 * we checked (Stooq) license their data for personal use only and sit behind
 * an anti-bot wall, so vendoring real bars into a redistributable repo is not
 * clean. Instead the repo commits 10 years of clearly-labeled synthetic daily
 * bars for an index (IDX) plus 10 stocks (S01..S10), produced by THIS file
 * with a fixed seed — anyone can regenerate and diff them.
 *
 * The generator aims for realistic structure, not any real market's path:
 *  - a two-state regime-switching market factor (calm: +9%/yr drift, 13% vol;
 *    stress: -12%/yr drift, 32% vol; sticky transitions),
 *  - per-stock beta in [0.6, 1.5], idiosyncratic vol 15-35%/yr, small alpha,
 *    rare idiosyncratic jumps,
 *  - OHLC built from overnight gaps + intraday ranges, lognormal volume.
 *
 * Split: weekdays 2016-07-01 .. 2026-06-30; the FINAL 2 YEARS (>= 2024-07-01)
 * go to fixtures/data/holdout/, the rest to fixtures/data/insample/.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { HOLDOUT_DIR, HOLDOUT_START, IN_SAMPLE_DIR, INDEX_TICKER } from './data.ts'
import { mulberry32 } from './windows.ts'

export const FIXTURE_SEED = 20260722

const START_DATE = '2016-07-01'
const END_DATE = '2026-06-30'
const DAYS_PER_YEAR = 252

interface Regime {
  driftAnnual: number
  volAnnual: number
  stayProb: number
}

const CALM: Regime = { driftAnnual: 0.09, volAnnual: 0.13, stayProb: 0.985 }
const STRESS: Regime = { driftAnnual: -0.12, volAnnual: 0.32, stayProb: 0.92 }

/** Seeded standard normal via Box-Muller over mulberry32. */
function gaussian(rand: () => number): () => number {
  let spare: number | null = null
  return () => {
    if (spare !== null) {
      const v = spare
      spare = null
      return v
    }
    let u = 0
    let v = 0
    while (u === 0) u = rand()
    while (v === 0) v = rand()
    const mag = Math.sqrt(-2 * Math.log(u))
    spare = mag * Math.sin(2 * Math.PI * v)
    return mag * Math.cos(2 * Math.PI * v)
  }
}

export function weekdays(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const d = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  while (d.getTime() <= end.getTime()) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return dates
}

interface SyntheticSeries {
  ticker: string
  rows: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number }>
}

export function generateUniverse(seed: number): SyntheticSeries[] {
  const dates = weekdays(START_DATE, END_DATE)
  const T = dates.length
  const rand = mulberry32(seed)
  const norm = gaussian(rand)

  // Market factor daily log-returns under the regime chain.
  let regime: Regime = CALM
  const marketLogRet: number[] = new Array(T).fill(0)
  for (let t = 1; t < T; t++) {
    if (rand() > regime.stayProb) regime = regime === CALM ? STRESS : CALM
    marketLogRet[t] = regime.driftAnnual / DAYS_PER_YEAR + (regime.volAnnual / Math.sqrt(DAYS_PER_YEAR)) * norm()
  }

  const specs = [
    { ticker: INDEX_TICKER, beta: 1, idioVol: 0.02, alpha: 0, jumpProb: 0, basePrice: 200 },
    ...Array.from({ length: 10 }, (_, i) => ({
      ticker: `S${String(i + 1).padStart(2, '0')}`,
      beta: 0.6 + rand() * 0.9,
      idioVol: 0.15 + rand() * 0.2,
      alpha: -0.02 + rand() * 0.08,
      jumpProb: 0.004,
      basePrice: 20 + rand() * 180,
    })),
  ]

  return specs.map((spec) => {
    const dailyIdio = spec.idioVol / Math.sqrt(DAYS_PER_YEAR)
    const closes: number[] = new Array(T).fill(0)
    closes[0] = spec.basePrice
    for (let t = 1; t < T; t++) {
      let logRet = spec.alpha / DAYS_PER_YEAR + spec.beta * marketLogRet[t]! + dailyIdio * norm()
      if (spec.jumpProb > 0 && rand() < spec.jumpProb) {
        logRet += (rand() < 0.5 ? -1 : 1) * (3 + rand() * 5) * dailyIdio
      }
      closes[t] = closes[t - 1]! * Math.exp(logRet)
    }
    const baseVolume = 1e6 * (0.5 + rand() * 4)
    const rows = dates.map((date, t) => {
      const prevClose = t === 0 ? closes[0]! : closes[t - 1]!
      const close = closes[t]!
      const gap = t === 0 ? 0 : 0.3 * dailyIdio * norm()
      const open = round4(prevClose * Math.exp(gap))
      const range = Math.abs(norm()) * 0.5 * dailyIdio
      const high = round4(Math.max(open, close) * Math.exp(range))
      const low = round4(Math.min(open, close) * Math.exp(-Math.abs(norm()) * 0.5 * dailyIdio))
      const ret = t === 0 ? 0 : Math.abs(close / prevClose - 1)
      const volume = Math.round(baseVolume * (1 + 3 * ret) * Math.exp(0.2 * norm()))
      return { date, open, high, low, close: round4(close), volume }
    })
    return { ticker: spec.ticker, rows }
  })
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000

function toCsv(series: SyntheticSeries, filter: (date: string) => boolean): string {
  const lines = ['Date,Open,High,Low,Close,Volume']
  for (const r of series.rows) {
    if (!filter(r.date)) continue
    lines.push(`${r.date},${r.open},${r.high},${r.low},${r.close},${r.volume}`)
  }
  return lines.join('\n') + '\n'
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const universe = generateUniverse(FIXTURE_SEED)
  await mkdir(IN_SAMPLE_DIR, { recursive: true })
  await mkdir(HOLDOUT_DIR, { recursive: true })
  for (const series of universe) {
    await writeFile(join(IN_SAMPLE_DIR, `${series.ticker}.csv`), toCsv(series, (d) => d < HOLDOUT_START))
    await writeFile(join(HOLDOUT_DIR, `${series.ticker}.csv`), toCsv(series, (d) => d >= HOLDOUT_START))
  }
  const inDays = universe[0]!.rows.filter((r) => r.date < HOLDOUT_START).length
  const outDays = universe[0]!.rows.length - inDays
  console.log(
    `wrote ${universe.length} tickers: ${inDays} in-sample days (< ${HOLDOUT_START}) + ${outDays} holdout days, seed ${FIXTURE_SEED}`,
  )
}
