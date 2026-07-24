/**
 * Holdout certification — the ONLY code path that reads fixtures/data/holdout/
 * (the final 2 years). Operator-invoked, once per winning strategy:
 *
 *   tsx src/quant-arena/holdout-certify.mts --strategy <path/to/strategy.ts> --out <campaign dir> [--force]
 *
 * Protocol:
 *  - the strategy is backtested over in-sample + holdout concatenated (so its
 *    lookbacks are warm when the holdout period begins), but SCORED only on
 *    the holdout days — a true walk-forward on data no candidate ever saw;
 *  - the three pinned baselines run under the identical protocol; the bar is
 *    the best baseline's holdout Sharpe;
 *  - the truncation leak audit re-runs on the full axis first (a leak that
 *    only pays off out-of-sample would otherwise slip through);
 *  - the verdict is appended to the campaign notebook with in-sample and
 *    out-of-sample stats side by side, and a certification record is written.
 *    A second run for the same strategy hash refuses without --force — the
 *    holdout answers once; re-rolling it is how holdouts die.
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'
import { runBacktest, statsForRange, type BacktestConfig, type RangeStats } from './backtest.ts'
import { concatForCertification, loadBarsDir, loadHoldout, loadInSample } from './data.ts'
import { truncationInvariance } from './leak-audit.ts'
import { PINNED_BASELINES } from './quant-loop.mts'
import type { GenerateSignals } from './types.ts'

export const CERTIFICATION_SCHEMA = 'quant-arena.certification.v1'

export interface CertificationRecord {
  schema: typeof CERTIFICATION_SCHEMA
  at: string
  strategyPath: string
  sha256: string
  costBps: number
  slippageBps: number
  holdoutStart: string
  holdoutEnd: string
  truncationClean: boolean
  inSample: RangeStats
  holdout: RangeStats
  baselinesHoldout: Record<string, RangeStats>
  bestBaselineHoldoutSharpe: number
  holdoutExcessSharpe: number
  certified: boolean
  reasons: string[]
}

export async function certifyOnHoldout(opts: {
  strategyPath: string
  outDir: string
  costBps?: number
  slippageBps?: number
  force?: boolean
  /** Test seam ONLY: alternate data directories so the certification code
   *  path can be exercised end-to-end WITHOUT reading the real holdout. The
   *  CLI never sets these — the real run always uses the vendored split. */
  insampleDir?: string
  holdoutDir?: string
}): Promise<CertificationRecord> {
  const code = await readFile(opts.strategyPath, 'utf8')
  const sha256 = `sha256:${createHash('sha256').update(code).digest('hex')}`
  const certDir = join(opts.outDir, 'holdout-certification')
  await mkdir(certDir, { recursive: true })
  const recordPath = join(certDir, `certification-${sha256.slice(7, 17)}.json`)
  if (existsSync(recordPath) && !opts.force) {
    throw new Error(
      `holdout-certify: ${recordPath} already exists — the holdout answers once per strategy. ` +
        'Re-running it turns the holdout into another in-sample set. Use --force only if the prior run was broken.',
    )
  }

  const mod = (await import(pathToFileURL(opts.strategyPath).href)) as { generateSignals?: GenerateSignals }
  if (typeof mod.generateSignals !== 'function') {
    throw new Error(`holdout-certify: ${opts.strategyPath} does not export generateSignals(bars)`)
  }
  const strategy = mod.generateSignals

  const insample = opts.insampleDir ? await loadBarsDir(opts.insampleDir) : await loadInSample()
  const holdout = opts.holdoutDir ? await loadBarsDir(opts.holdoutDir) : await loadHoldout()
  const { aligned, holdoutStartIndex } = concatForCertification(insample, holdout)
  const btConfig: BacktestConfig = { costBps: opts.costBps ?? 10, slippageBps: opts.slippageBps ?? 5 }
  const T = aligned.dates.length

  const truncation = truncationInvariance(strategy, aligned.bars, { warmupDays: 120 })

  const result = runBacktest(aligned.bars, strategy(aligned.bars), btConfig)
  const inSampleStats = statsForRange(result, 0, holdoutStartIndex)
  const holdoutStats = statsForRange(result, holdoutStartIndex, T)

  const baselinesHoldout: Record<string, RangeStats> = {}
  for (const [name, baseline] of Object.entries(PINNED_BASELINES)) {
    const baseResult = runBacktest(aligned.bars, baseline(aligned.bars), btConfig)
    baselinesHoldout[name] = statsForRange(baseResult, holdoutStartIndex, T)
  }
  const bestBaselineHoldoutSharpe = Math.max(...Object.values(baselinesHoldout).map((s) => s.sharpe))
  const holdoutExcessSharpe = holdoutStats.sharpe - bestBaselineHoldoutSharpe

  const reasons: string[] = []
  if (!truncation.clean) {
    reasons.push(`leak: truncation divergence at cutoff ${truncation.divergence!.cutoff}: ${truncation.divergence!.detail}`)
  }
  if (holdoutExcessSharpe <= 0) {
    reasons.push(
      `no out-of-sample edge: holdout Sharpe ${holdoutStats.sharpe.toFixed(3)} <= best baseline ${bestBaselineHoldoutSharpe.toFixed(3)}`,
    )
  }
  const certified = reasons.length === 0
  if (certified) {
    reasons.push(
      `certified: holdout Sharpe ${holdoutStats.sharpe.toFixed(3)} beats best baseline ` +
        `${bestBaselineHoldoutSharpe.toFixed(3)} on ${holdoutStats.days} untouched days`,
    )
  }

  const record: CertificationRecord = {
    schema: CERTIFICATION_SCHEMA,
    at: new Date().toISOString(),
    strategyPath: opts.strategyPath,
    sha256,
    costBps: btConfig.costBps,
    slippageBps: btConfig.slippageBps,
    holdoutStart: aligned.dates[holdoutStartIndex]!,
    holdoutEnd: aligned.dates[T - 1]!,
    truncationClean: truncation.clean,
    inSample: inSampleStats,
    holdout: holdoutStats,
    baselinesHoldout,
    bestBaselineHoldoutSharpe,
    holdoutExcessSharpe,
    certified,
    reasons,
  }
  await writeFile(recordPath, JSON.stringify(record, null, 2))
  await appendFile(join(opts.outDir, 'notebook.jsonl'), JSON.stringify(record) + '\n')
  return record
}

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const strategyPath = flag('--strategy')
  const outDir = flag('--out')
  if (!strategyPath || !outDir) {
    console.error('usage: tsx src/quant-arena/holdout-certify.mts --strategy <strategy.ts> --out <campaign dir> [--force]')
    process.exit(2)
  }
  const record = await certifyOnHoldout({ strategyPath, outDir, force: argv.includes('--force') })
  console.log(JSON.stringify({ certified: record.certified, reasons: record.reasons, holdout: record.holdout, inSample: record.inSample }, null, 2))
  process.exitCode = record.certified ? 0 : 1
}
