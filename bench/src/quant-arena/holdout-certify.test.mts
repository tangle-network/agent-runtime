import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { certifyOnHoldout } from './holdout-certify.mts'

/** Synthetic Stooq-format CSVs on real calendar dates — the certification
 *  path exercised end-to-end WITHOUT ever reading the real vendored holdout. */
const isoDate = (dayOffset: number): string => {
  const d = new Date(Date.UTC(2020, 0, 1))
  d.setUTCDate(d.getUTCDate() + dayOffset)
  return d.toISOString().slice(0, 10)
}

const csvFor = (phase: number, from: number, to: number): string => {
  const lines = ['Date,Open,High,Low,Close,Volume']
  for (let t = from; t < to; t++) {
    const close = 100 + 10 * Math.sin(t / 9 + phase) + 0.03 * t
    const open = 100 + 10 * Math.sin((t - 0.5) / 9 + phase) + 0.03 * t
    lines.push(
      `${isoDate(t)},${open.toFixed(4)},${(Math.max(open, close) + 1).toFixed(4)},${(Math.min(open, close) - 1).toFixed(4)},${close.toFixed(4)},1000`,
    )
  }
  return lines.join('\n') + '\n'
}

const BUY_HOLD_PATH = fileURLToPath(new URL('./strategies/buy-hold-index/strategy.ts', import.meta.url))

describe('certifyOnHoldout (synthetic stand-in dirs — the real holdout stays untouched)', () => {
  let outDir: string
  let insampleDir: string
  let holdoutDir: string

  beforeAll(async () => {
    const root = await mkdtemp(join(tmpdir(), 'quant-arena-cert-'))
    outDir = join(root, 'out')
    insampleDir = join(root, 'insample')
    holdoutDir = join(root, 'holdout')
    await mkdir(outDir, { recursive: true })
    await mkdir(insampleDir, { recursive: true })
    await mkdir(holdoutDir, { recursive: true })
    for (const [ticker, phase] of [['IDX', 0], ['S01', 2]] as const) {
      await writeFile(join(insampleDir, `${ticker}.csv`), csvFor(phase, 0, 300))
      await writeFile(join(holdoutDir, `${ticker}.csv`), csvFor(phase, 300, 400))
    }
  })

  it('scores in-sample and holdout side by side and appends a notebook row', async () => {
    const record = await certifyOnHoldout({ strategyPath: BUY_HOLD_PATH, outDir, insampleDir, holdoutDir })
    expect(record.truncationClean).toBe(true)
    expect(record.inSample.days).toBe(300)
    expect(record.holdout.days).toBe(100)
    expect(record.holdoutStart).toBe(isoDate(300))
    // Buy-and-hold IS one of the pinned baselines, so its excess over the
    // best baseline can never be positive: deterministically not certified.
    expect(record.holdoutExcessSharpe).toBeLessThanOrEqual(0)
    expect(record.certified).toBe(false)
    expect(record.reasons[0]).toMatch(/no out-of-sample edge/)
    const notebook = await readFile(join(outDir, 'notebook.jsonl'), 'utf8')
    const rows = notebook.trim().split('\n').map((l) => JSON.parse(l) as { schema: string })
    expect(rows.some((r) => r.schema === 'quant-arena.certification.v1')).toBe(true)
  })

  it('refuses a second certification for the same strategy hash without --force', async () => {
    await expect(certifyOnHoldout({ strategyPath: BUY_HOLD_PATH, outDir, insampleDir, holdoutDir })).rejects.toThrow(
      /answers once/,
    )
    const forced = await certifyOnHoldout({ strategyPath: BUY_HOLD_PATH, outDir, insampleDir, holdoutDir, force: true })
    expect(forced.schema).toBe('quant-arena.certification.v1')
  })
})
