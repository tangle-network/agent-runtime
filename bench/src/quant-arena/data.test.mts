import { describe, expect, it } from 'vitest'
import { readdir } from 'node:fs/promises'
import {
  HOLDOUT_DIR,
  HOLDOUT_START,
  IN_SAMPLE_DIR,
  INDEX_TICKER,
  loadInSample,
  parseStooqCsv,
} from './data.ts'

describe('parseStooqCsv', () => {
  it('parses the vendored CSV format', () => {
    const bars = parseStooqCsv('Date,Open,High,Low,Close,Volume\n2020-01-02,10,11,9,10.5,12345\n2020-01-03,10.5,12,10,11,999\n', 'test')
    expect(bars).toHaveLength(2)
    expect(bars[0]).toEqual({ date: '2020-01-02', open: 10, high: 11, low: 9, close: 10.5, volume: 12345 })
  })

  it('fails loud on descending dates, bad prices, and foreign headers', () => {
    expect(() => parseStooqCsv('Date,Open,High,Low,Close,Volume\n2020-01-03,10,11,9,10,1\n2020-01-02,10,11,9,10,1\n', 't')).toThrow(/ascending/)
    expect(() => parseStooqCsv('Date,Open,High,Low,Close,Volume\n2020-01-02,0,11,9,10,1\n', 't')).toThrow(/nonpositive/)
    expect(() => parseStooqCsv('Ticker,Per,Date\nX,D,2020\n', 't')).toThrow(/header/)
  })
})

describe('vendored fixture integrity (in-sample side only — the holdout is not read here)', () => {
  it('in-sample and holdout are physically separate directories with the same tickers', async () => {
    const inFiles = (await readdir(IN_SAMPLE_DIR)).filter((f) => f.endsWith('.csv')).sort()
    const outFiles = (await readdir(HOLDOUT_DIR)).filter((f) => f.endsWith('.csv')).sort()
    expect(inFiles).toEqual(outFiles)
    expect(inFiles).toContain(`${INDEX_TICKER}.csv`)
    expect(inFiles.length).toBe(11)
  })

  it('loadInSample aligns the universe, leads with the index, and never crosses into the holdout era', async () => {
    const aligned = await loadInSample()
    expect(aligned.tickers[0]).toBe(INDEX_TICKER)
    expect(aligned.tickers).toHaveLength(11)
    expect(aligned.bars).toHaveLength(11)
    for (const series of aligned.bars) expect(series).toHaveLength(aligned.dates.length)
    expect(aligned.dates.length).toBeGreaterThan(1800)
    expect(aligned.dates[aligned.dates.length - 1]! < HOLDOUT_START).toBe(true)
  })
})
