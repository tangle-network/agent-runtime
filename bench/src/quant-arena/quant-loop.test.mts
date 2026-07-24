import { describe, expect, it } from 'vitest'
import { buildAuthorPrompt, extractStrategySource, parseAuditVerdict } from './quant-loop.mts'
import { bootstrapWindows } from './windows.ts'
import type { AlignedBars } from './data.ts'

const V2_MODULE = `
interface Bar { date: string; open: number; high: number; low: number; close: number; volume: number }
interface StrategyContext { symbols: string[]; t: number; history: Bar[][]; weights: number[]; equity: number }
interface TargetPosition { symbol: string; weight: number }
export function onBar(ctx: StrategyContext): TargetPosition[] | null {
  if (ctx.t < 20) return null
  return [{ symbol: ctx.symbols[0], weight: 0.5 }]
}
`

describe('extractStrategySource — v2 contract', () => {
  it('accepts a fenced module exporting onBar', () => {
    const out = extractStrategySource('Here is my strategy:\n```ts\n' + V2_MODULE + '\n```\n')
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.code).toContain('export function onBar')
  })

  it('rejects a v1 generateSignals-only reply (the contract moved)', () => {
    const v1 = '```ts\nexport function generateSignals(bars: unknown[]): unknown[] { return [] }\n```'
    const out = extractStrategySource(v1)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/onBar/)
  })

  it('rejects non-self-contained modules (banned identifiers)', () => {
    const dirty = '```ts\nimport fs from "node:fs"\nexport function onBar(ctx: unknown) { return null }\n```'
    const out = extractStrategySource(dirty)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toMatch(/import/)
  })

  it('takes the LAST onBar block when the author narrates with several', () => {
    const text = '```ts\nexport function onBar(a: unknown) { return null } // draft\n```\nbetter:\n```ts\n' + V2_MODULE + '```'
    const out = extractStrategySource(text)
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.code).toContain('ctx.t < 20')
  })
})

describe('buildAuthorPrompt — authored against the v2 contract', () => {
  it('states onBar, structural truncation, the OMS seam, and the acceptance bar', () => {
    const universe: AlignedBars = {
      tickers: ['IDX', 'S01'],
      dates: Array.from({ length: 800 }, (_, i) => `d${i}`),
      bars: [],
    }
    const windows = bootstrapWindows(800, { k: 4, windowDays: 200, seed: 7, warmupDays: 100 })
    const prompt = buildAuthorPrompt({
      universe,
      windows,
      baselineTable: '  (table)',
      threshold: 0.25,
      nTried: 3,
    })
    expect(prompt).toContain('export function onBar(ctx: StrategyContext)')
    expect(prompt).toContain('ctx.history[k].length === ctx.t + 1')
    expect(prompt).toContain('shared rebalancer')
    expect(prompt).toContain('try #3')
    expect(prompt).not.toContain('generateSignals')
  })
})

describe('parseAuditVerdict', () => {
  it('parses clean and leak verdicts, favoring the last JSON object', () => {
    expect(parseAuditVerdict('{"verdict":"clean"}')).toEqual({ verdict: 'clean', evidence: '' })
    const leak = parseAuditVerdict('thinking... {"verdict":"clean"} wait no {"verdict":"leak","evidence":"Date.now()"}')
    expect(leak).toEqual({ verdict: 'leak', evidence: 'Date.now()' })
    expect(parseAuditVerdict('no json here')).toBeNull()
  })
})
