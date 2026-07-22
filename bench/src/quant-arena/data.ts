/**
 * Vendored daily-bar data: Stooq-format CSVs (Date,Open,High,Low,Close,Volume)
 * committed under fixtures/data/. Two physically separate directories:
 *
 *   fixtures/data/insample/  — everything the campaign loop may read.
 *   fixtures/data/holdout/   — the FINAL 2 years. Loaded ONLY by the
 *                              certification path (holdout-certify.mts).
 *                              quant-loop.mts never imports `loadHoldout`.
 *
 * See fixtures/data/PROVENANCE.md for where the series come from.
 */

import { readdir, readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Bar } from './types.ts'

export const DATA_DIR = fileURLToPath(new URL('./fixtures/data', import.meta.url))
export const IN_SAMPLE_DIR = join(DATA_DIR, 'insample')
export const HOLDOUT_DIR = join(DATA_DIR, 'holdout')
/** First holdout date — insample bars must all be strictly before this. */
export const HOLDOUT_START = '2024-07-01'
/** The benchmark index ticker; always bars[0] in the aligned universe. */
export const INDEX_TICKER = 'IDX'

export interface AlignedBars {
  /** tickers[0] === INDEX_TICKER; the rest sorted alphabetically. */
  tickers: string[]
  dates: string[]
  /** bars[k] belongs to tickers[k]; every series shares the date axis. */
  bars: Bar[][]
}

export function parseStooqCsv(text: string, source: string): Bar[] {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
  if (lines.length < 2) throw new Error(`${source}: empty CSV`)
  const header = lines[0]!.toLowerCase()
  if (!header.startsWith('date,open,high,low,close')) {
    throw new Error(`${source}: unexpected header '${lines[0]}'`)
  }
  const bars: Bar[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(',')
    if (cells.length < 5) throw new Error(`${source}: bad row '${line}'`)
    const [date, open, high, low, close, volume] = cells
    const bar: Bar = {
      date: date!,
      open: Number(open),
      high: Number(high),
      low: Number(low),
      close: Number(close),
      volume: volume !== undefined ? Number(volume) : 0,
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) throw new Error(`${source}: bad date '${bar.date}'`)
    for (const v of [bar.open, bar.high, bar.low, bar.close]) {
      if (!Number.isFinite(v) || v <= 0) throw new Error(`${source}: nonpositive price on ${bar.date}`)
    }
    bars.push(bar)
  }
  for (let i = 1; i < bars.length; i++) {
    if (bars[i]!.date <= bars[i - 1]!.date) {
      throw new Error(`${source}: dates not strictly ascending at ${bars[i]!.date}`)
    }
  }
  return bars
}

/** Load every `<TICKER>.csv` in a directory and align on the intersection of
 *  dates. The index ticker leads; the rest follow alphabetically. */
export async function loadBarsDir(dir: string): Promise<AlignedBars> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.csv')).sort()
  if (files.length === 0) throw new Error(`loadBarsDir: no CSVs in ${dir}`)
  const byTicker = new Map<string, Bar[]>()
  for (const file of files) {
    const ticker = basename(file, '.csv')
    byTicker.set(ticker, parseStooqCsv(await readFile(join(dir, file), 'utf8'), join(dir, file)))
  }
  if (!byTicker.has(INDEX_TICKER)) {
    throw new Error(`loadBarsDir: ${dir} has no ${INDEX_TICKER}.csv — the universe needs its benchmark index`)
  }
  const tickers = [INDEX_TICKER, ...[...byTicker.keys()].filter((t) => t !== INDEX_TICKER).sort()]
  let shared: Set<string> | null = null
  for (const ticker of tickers) {
    const tickerDates = new Set(byTicker.get(ticker)!.map((b) => b.date))
    if (shared === null) {
      shared = tickerDates
    } else {
      const carried: Set<string> = shared
      shared = new Set([...carried].filter((d) => tickerDates.has(d)))
    }
  }
  const dates = [...shared!].sort()
  if (dates.length < 2) throw new Error(`loadBarsDir: fewer than 2 shared dates across ${dir}`)
  const bars = tickers.map((ticker) => {
    const wanted = new Set(dates)
    return byTicker.get(ticker)!.filter((b) => wanted.has(b.date))
  })
  return { tickers, dates, bars }
}

/** The campaign loop's data. Fails loud if any bar strays into the holdout era. */
export async function loadInSample(): Promise<AlignedBars> {
  const aligned = await loadBarsDir(IN_SAMPLE_DIR)
  const last = aligned.dates[aligned.dates.length - 1]!
  if (last >= HOLDOUT_START) {
    throw new Error(`loadInSample: in-sample data reaches ${last}, at/past the holdout start ${HOLDOUT_START}`)
  }
  return aligned
}

/** CERTIFICATION PATH ONLY (holdout-certify.mts). The final 2 years. */
export async function loadHoldout(): Promise<AlignedBars> {
  const aligned = await loadBarsDir(HOLDOUT_DIR)
  const first = aligned.dates[0]!
  if (first < HOLDOUT_START) {
    throw new Error(`loadHoldout: holdout data starts ${first}, before the holdout start ${HOLDOUT_START}`)
  }
  return aligned
}

/** In-sample followed by holdout on one axis — what the certification run
 *  backtests so lookback indicators are warm when the holdout period begins.
 *  Returns the concatenated universe plus the index of the first holdout day. */
export function concatForCertification(insample: AlignedBars, holdout: AlignedBars): { aligned: AlignedBars; holdoutStartIndex: number } {
  if (insample.tickers.join(',') !== holdout.tickers.join(',')) {
    throw new Error('concatForCertification: in-sample and holdout universes differ')
  }
  const lastIn = insample.dates[insample.dates.length - 1]!
  const firstOut = holdout.dates[0]!
  if (firstOut <= lastIn) {
    throw new Error(`concatForCertification: holdout starts ${firstOut}, not after in-sample end ${lastIn}`)
  }
  return {
    aligned: {
      tickers: insample.tickers,
      dates: [...insample.dates, ...holdout.dates],
      bars: insample.bars.map((series, k) => [...series, ...holdout.bars[k]!]),
    },
    holdoutStartIndex: insample.dates.length,
  }
}
