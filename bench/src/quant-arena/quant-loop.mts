/**
 * QUANT-ARENA campaign loop — the improvement loop embodied for trading
 * strategies. One command runs: strategy authors (Claude, profile-pinned)
 * propose candidate strategies (v2 `onBar` contract, driven incrementally by
 * driver.ts) -> every candidate passes a two-stage leak audit -> survivors
 * are scored on K bootstrap in-sample windows against the pinned baselines
 * -> a multiplicity-adjusted acceptance rule decides -> every try becomes a
 * permanent lab-notebook row (notebook.jsonl).
 *
 * Scoring engines: the OFFICIAL per-window scores come from the vectorbt
 * worker (vbt-client.ts -> python/vbt-worker.py). The TS engine
 * (backtest.ts) runs first as contract prefilter + leak-audit substrate
 * only — it throws on shorting/leverage violations and supplies turnover
 * (which the worker protocol does not carry), but its Sharpe/return numbers
 * are never the acceptance currency.
 *
 *   tsx src/quant-arena/quant-loop.mts --out <dir> [--candidates 2] [--seed 20260722]
 *        [--author-model sonnet] [--audit-model haiku] [--skip-llm-audit]
 *
 * Kernel reuse (import, not copy — see src/swe-arena/):
 *  - cost accounting: the lib's durable CostLedger (createRunCostLedger) +
 *    crash-orphan reconcile (ledger-orphans.mts) — author/audit shots are
 *    metered paid calls with receipts in <out>/cost-ledger.jsonl.
 *  - evidence cells: one cached-result.json per (strategy x window) in the
 *    swe-arena cell shape, readable by cell-evidence.mts's loadCampaignCells.
 *  - rollout manifest: a pure reader/join over cells + ledger receipts,
 *    mirroring swe-arena/manifest.mts (loadLedgerReceipts imported from it).
 *  - proposer identity: AgentProfile-pinned authors via proposer-fanout.mts's
 *    loadAuthorProfile + the same ambient-auth-stripped shot env.
 *
 * The HOLDOUT (final 2 years) is never read here — see holdout-certify.mts.
 */

import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import process from 'node:process'
import { createRunCostLedger, fsCampaignStorage } from '@tangle-network/agent-eval/campaign'
import { loadCampaignCells } from '../swe-arena/cell-evidence.mts'
import { reconcileCrashOrphansOnDisk } from '../swe-arena/ledger-orphans.mts'
import { loadLedgerReceipts } from '../swe-arena/manifest.mts'
import { loadAuthorProfile, type ProposerSpec } from '../swe-arena/proposer-fanout.mts'
import { proposerShotEnv } from '../swe-arena/outer-loop.mts'
import { run } from '../swe-arena/proc.ts'
import { runBacktest, statsForRange, type BacktestConfig, type RangeStats } from './backtest.ts'
import { loadInSample, type AlignedBars } from './data.ts'
import { loadStrategyFile } from './driver.ts'
import { truncationInvariance, type TruncationReport } from './leak-audit.ts'
import { decideAcceptance, requiredExcessSharpe, type AcceptanceDecision } from './multiplicity.ts'
import { scoreSignals, VbtWorker, type VbtWindowStats } from './vbt-client.ts'
import { bootstrapWindows, type EvalWindow } from './windows.ts'
import type { GenerateSignals, Signal } from './types.ts'
import * as buyHoldIndex from './strategies/buy-hold-index/strategy.ts'
import * as equalWeight from './strategies/equal-weight/strategy.ts'
import * as smaCrossover from './strategies/sma-crossover/strategy.ts'

export const QUANT_PROFILES_DIR = fileURLToPath(new URL('./profiles', import.meta.url))

// ---------------------------------------------------------------------------
// Config.
// ---------------------------------------------------------------------------

export interface QuantLoopConfig {
  outDir: string
  candidatesPerProposer: number
  seed: number
  windows: number
  windowDays: number
  warmupDays: number
  costBps: number
  slippageBps: number
  authorModel: string
  auditModel: string
  skipLlmAudit: boolean
  authorTimeoutMs: number
  auditTimeoutMs: number
  proposers: ProposerSpec[]
}

export const PINNED_BASELINES: Record<string, GenerateSignals> = {
  'buy-hold-index': buyHoldIndex.generateSignals,
  'equal-weight': equalWeight.generateSignals,
  'sma-crossover': smaCrossover.generateSignals,
}

/** The two demo author seats: the plain author and the quant lens. */
export function defaultQuantProposers(): ProposerSpec[] {
  return [
    { name: 'default-author', profile: 'default-author.profile.json', harness: 'claude' },
    {
      name: 'quant-researcher',
      profile: join(QUANT_PROFILES_DIR, 'quant-researcher.profile.json'),
      harness: 'claude',
      lens:
        'Favor ONE economically-motivated effect (trend, mean reversion, vol targeting) with few parameters. ' +
        'State the regime in which it should work and keep turnover low enough that 15bps a side cannot eat the edge.',
    },
  ]
}

export function defaultConfig(outDir: string): QuantLoopConfig {
  return {
    outDir,
    candidatesPerProposer: 2,
    seed: 20260722,
    windows: 8,
    windowDays: 504,
    warmupDays: 120,
    costBps: 10,
    slippageBps: 5,
    authorModel: 'sonnet',
    auditModel: 'haiku',
    skipLlmAudit: false,
    authorTimeoutMs: 480_000,
    auditTimeoutMs: 240_000,
    proposers: defaultQuantProposers(),
  }
}

// ---------------------------------------------------------------------------
// Notebook rows — the permanent lab notebook. Append-only JSONL.
// ---------------------------------------------------------------------------

export const NOTEBOOK_CANDIDATE_SCHEMA = 'quant-arena.candidate.v1'
export const NOTEBOOK_BASELINES_SCHEMA = 'quant-arena.baselines.v1'

export type CandidateVerdict =
  | 'accepted'
  | 'rejected-no-edge'
  | 'rejected-leak'
  | 'rejected-contract'
  | 'rejected-error'

export interface WindowScore {
  start: number
  end: number
  startDate: string
  endDate: string
  sharpe: number
  bestBaselineSharpe: number
  excess: number
}

export interface CandidateRow {
  schema: typeof NOTEBOOK_CANDIDATE_SCHEMA
  at: string
  candidateId: string
  proposer: string
  authorModel: string
  strategyPath: string | null
  sha256: string | null
  authoringCostUsd: number | null
  /** Total candidates tried this campaign INCLUDING this one — the
   *  multiplicity denominator. Monotone; never resets within a notebook. */
  nTried: number
  leakAudit: {
    truncation: TruncationReport | null
    llm: { verdict: 'clean' | 'leak' | 'inconclusive'; evidence: string } | 'skipped' | null
  }
  eval: {
    perWindow: WindowScore[]
    meanExcessSharpe: number
    wins: number
    requiredWins: number
    threshold: number
  } | null
  inSampleFull: RangeStats | null
  verdict: CandidateVerdict
  reasons: string[]
}

export async function loadNotebookRows(notebookPath: string): Promise<Array<Record<string, unknown>>> {
  if (!existsSync(notebookPath)) return []
  const raw = await readFile(notebookPath, 'utf8')
  return raw
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as Record<string, unknown>)
}

const log = (msg: string): void => console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)

// ---------------------------------------------------------------------------
// Claude shots (author + auditor) — metered paid calls through the run ledger.
// ---------------------------------------------------------------------------

interface ClaudeShotOutcome {
  text: string
  model: string
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  costUsd: number | null
}

type Ledger = ReturnType<typeof createRunCostLedger>

async function claudeShot(opts: {
  prompt: string
  model: string
  systemPrompt?: string
  timeoutMs: number
  cwd: string
}): Promise<ClaudeShotOutcome> {
  const argv = [
    '-p',
    '--output-format',
    'json',
    '--model',
    opts.model,
    // The shot is pure text generation: no filesystem, no shell, no web.
    '--disallowed-tools',
    'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task,NotebookEdit',
    ...(opts.systemPrompt ? ['--append-system-prompt', opts.systemPrompt] : []),
  ]
  const res = await run('claude', argv, {
    stdin: opts.prompt,
    cwd: opts.cwd,
    env: proposerShotEnv('claude'),
    timeoutMs: opts.timeoutMs,
  })
  if (res.code !== 0) {
    throw new Error(`claude shot exited ${res.code}${res.timedOut ? ' (timeout)' : ''}: ${(res.stderr || res.stdout).slice(0, 800)}`)
  }
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(res.stdout) as Record<string, unknown>
  } catch {
    throw new Error(`claude shot: unparseable --output-format json stdout: ${res.stdout.slice(0, 400)}`)
  }
  if (parsed.is_error === true) throw new Error(`claude shot errored: ${String(parsed.result).slice(0, 800)}`)
  const usage = (parsed.usage ?? {}) as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    text: typeof parsed.result === 'string' ? parsed.result : '',
    model: typeof parsed.model === 'string' ? parsed.model : opts.model,
    inputTokens: num(usage.input_tokens),
    outputTokens: num(usage.output_tokens),
    cachedTokens: num(usage.cache_read_input_tokens),
    costUsd: typeof parsed.total_cost_usd === 'number' ? parsed.total_cost_usd : null,
  }
}

async function meteredClaudeShot(
  ledger: Ledger,
  meta: { phase: string; actor: string; tags: Record<string, string> },
  opts: Parameters<typeof claudeShot>[0],
): Promise<{ outcome: ClaudeShotOutcome; costUsd: number | null }> {
  const paid = await ledger.runPaidCall<ClaudeShotOutcome>({
    channel: 'driver',
    phase: meta.phase,
    actor: meta.actor,
    model: opts.model,
    tags: meta.tags,
    execute: () => claudeShot(opts),
    receipt: (v) => ({
      model: v.model,
      inputTokens: v.inputTokens,
      outputTokens: v.outputTokens,
      cachedTokens: v.cachedTokens,
      ...(v.costUsd !== null ? { actualCostUsd: v.costUsd } : {}),
    }),
  })
  if (!paid.succeeded) throw paid.error
  return { outcome: paid.value, costUsd: paid.value.costUsd }
}

// ---------------------------------------------------------------------------
// Authoring: prompt, extraction, hermeticity guard.
// ---------------------------------------------------------------------------

const CONTRACT_TEXT = `THE STRATEGY CONTRACT (v2 — incremental)
- Write ONE self-contained TypeScript module. NO import/require/fs/network/process — declare any types you need locally.
- Export exactly: export function onBar(ctx: StrategyContext): TargetPosition[] | null
  where StrategyContext = { symbols: string[]; t: number; history: Bar[][]; weights: number[]; equity: number },
  Bar = { date: string; open: number; high: number; low: number; close: number; volume: number },
  and TargetPosition = { symbol: string; weight: number }.
- The lab calls onBar once per trading day, in order. ctx.history[k] holds the daily bars of ctx.symbols[k] from
  day 0 THROUGH TODAY ONLY (ctx.history[k].length === ctx.t + 1) — bars after today do not exist in the array.
  ctx.history[0] / ctx.symbols[0] is the benchmark index. ctx.weights and ctx.equity are your current drifted
  portfolio state (equity starts at 1).
- Return TargetPosition[] to rebalance: weight = target fraction of equity per symbol; any symbol you omit is
  sold to 0. Return null to hold (positions drift with prices). A rebalance fills at the NEXT day's open.
- You never construct orders — the lab's shared rebalancer turns your target weights into orders.
- No shorting, no leverage: every weight >= 0 and the weights sum to <= 1 (rest is cash at 0%). Violations kill
  the candidate — fail-closed, not clamped.
- DETERMINISM / NO LOOK-AHEAD: onBar must be a pure function of ctx (no RNG, no clock, no hidden state). The lab
  re-runs your code on truncated data; if any decision up to the cutoff changes, the candidate is killed. No
  hardcoded calendar dates that memorize this dataset.
- Every fill pays 15bps one-way (cost + slippage) on traded dollars — churn is expensive.`

export function buildAuthorPrompt(args: {
  universe: AlignedBars
  windows: EvalWindow[]
  baselineTable: string
  threshold: number
  nTried: number
  lens?: string
}): string {
  const { universe, windows, baselineTable, threshold, nTried } = args
  return [
    'You are proposing ONE candidate trading strategy for a research lab with a strict acceptance rule.',
    '',
    CONTRACT_TEXT,
    '',
    `UNIVERSE: ${universe.tickers.length} tickers (${universe.tickers.join(', ')}); bars[0] = ${universe.tickers[0]} (the index).`,
    `IN-SAMPLE: ${universe.dates.length} daily bars, ${universe.dates[0]} .. ${universe.dates[universe.dates.length - 1]}.`,
    '',
    'ACCEPTANCE RULE (what you must beat):',
    `- Scored on ${windows.length} overlapping ${windows[0]!.end - windows[0]!.start}-day in-sample windows.`,
    '- You must beat the BEST pinned baseline Sharpe in at least 6 of 8 windows, AND',
    `- your mean excess Sharpe must clear ${threshold.toFixed(3)} (the bar rises with every candidate tried; you are try #${nTried}).`,
    '',
    'PINNED BASELINES (annualized Sharpe per window; "best" is the per-window max):',
    baselineTable,
    '',
    ...(args.lens ? ['YOUR AUTHORING LENS:', args.lens, ''] : []),
    'Reply with EXACTLY ONE fenced ```ts code block containing the module and nothing else after it.',
  ].join('\n')
}

/** Pull the strategy module out of the author's reply and enforce the
 *  self-contained rule. Fail-closed: anything ambiguous is a rejection. */
export function extractStrategySource(text: string): { ok: true; code: string } | { ok: false; reason: string } {
  const blocks = [...text.matchAll(/```(?:ts|typescript)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]!)
  const withExport = blocks.filter((b) => /export\s+function\s+onBar\s*\(/.test(b))
  if (withExport.length === 0) {
    return { ok: false, reason: 'no fenced code block exporting `onBar` in the reply (v2 contract)' }
  }
  const code = withExport[withExport.length - 1]!
  const stripped = code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const banned = /\b(import|require|fetch|process|globalThis|Deno|XMLHttpRequest|eval)\b/.exec(stripped)
  if (banned) {
    return { ok: false, reason: `not self-contained: uses banned identifier '${banned[1]}'` }
  }
  return { ok: true, code }
}

// ---------------------------------------------------------------------------
// Adversarial LLM leak audit (the deterministic truncation check lives in
// leak-audit.ts; both must pass).
// ---------------------------------------------------------------------------

const AUDIT_PROMPT_HEADER = `You are an adversarial reviewer with ONE job: find look-ahead bias or nondeterminism
in the trading strategy below. The contract: onBar(ctx) is called once per day; ctx.history[k] holds ONLY bars
0..ctx.t (the harness slices the arrays), decisions must be pure functions of ctx, and fills happen at the next
day's open. Hunt for:
- hardcoded calendar dates or magic day indexes that smell like memorizing this dataset,
- nondeterminism: Math.random, Date.now, or state carried between onBar calls that a re-run would not rebuild,
- decisions that would change when the future is truncated,
- any attempt to reach data beyond ctx.history (indexing past the array end, reconstructing future prices).
Deciding at close of ctx.t and being filled at t+1's open is LEGAL — do not flag it. Whole-history statistics over
ctx.history are LEGAL (the array ends at today) — do not flag them.
Reply with JSON ONLY: {"verdict":"clean"} or {"verdict":"leak","evidence":"<quote the offending code and why>"}.

STRATEGY SOURCE:
`

export function parseAuditVerdict(text: string): { verdict: 'clean' | 'leak'; evidence: string } | null {
  const matches = [...text.matchAll(/\{[\s\S]*?"verdict"[\s\S]*?\}/g)]
  for (const m of matches.reverse()) {
    try {
      const parsed = JSON.parse(m[0]) as { verdict?: string; evidence?: string }
      if (parsed.verdict === 'clean') return { verdict: 'clean', evidence: '' }
      if (parsed.verdict === 'leak') return { verdict: 'leak', evidence: parsed.evidence ?? '(no evidence quoted)' }
    } catch {
      continue
    }
  }
  return null
}

async function llmLeakAudit(
  ledger: Ledger,
  config: QuantLoopConfig,
  candidateId: string,
  code: string,
): Promise<{ verdict: 'clean' | 'leak' | 'inconclusive'; evidence: string }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const { outcome } = await meteredClaudeShot(
      ledger,
      { phase: 'audit.leak', actor: 'leak-auditor:claude', tags: { candidateId, attempt: String(attempt) } },
      {
        prompt: AUDIT_PROMPT_HEADER + '```ts\n' + code + '\n```',
        model: config.auditModel,
        timeoutMs: config.auditTimeoutMs,
        cwd: config.outDir,
      },
    )
    const verdict = parseAuditVerdict(outcome.text)
    if (verdict !== null) return verdict
  }
  return { verdict: 'inconclusive', evidence: 'auditor reply unparseable twice — fail-closed' }
}

// ---------------------------------------------------------------------------
// Evidence cells (kernel cell shape) + rollout manifest.
// ---------------------------------------------------------------------------

async function writeWindowCells(
  campaignRoot: string,
  label: string,
  perWindow: Array<{ window: EvalWindow; stats: RangeStats; bestBaselineSharpe: number | null }>,
): Promise<string> {
  const dir = join(campaignRoot, label)
  for (let i = 0; i < perWindow.length; i++) {
    const { window, stats, bestBaselineSharpe } = perWindow[i]!
    const cellDir = join(dir, `window-${i}-rep-0`)
    await mkdir(cellDir, { recursive: true })
    const cell = {
      scenarioId: `window-${window.start}-${window.end}`,
      rep: 0,
      artifact: {
        kind: 'quant-window',
        strategy: label,
        windowStart: window.start,
        windowEnd: window.end,
        sharpe: stats.sharpe,
        totalReturn: stats.totalReturn,
        maxDrawdown: stats.maxDrawdown,
        tradeCount: stats.tradeCount,
        turnover: stats.turnover,
        bestBaselineSharpe,
        excessSharpe: bestBaselineSharpe === null ? null : stats.sharpe - bestBaselineSharpe,
      },
      costUsd: 0,
      tokenUsage: { input: 0, output: 0 },
      cached: true,
    }
    await writeFile(join(cellDir, 'cached-result.json'), JSON.stringify(cell, null, 2))
  }
  return dir
}

export const QUANT_ROLLOUT_SCHEMA = 'quant-arena.rollout.v1'

/** Pure reader/join over what the campaign already wrote — the same posture
 *  as swe-arena/manifest.mts, over the same cell + ledger primitives. */
export async function writeQuantRolloutManifest(outDir: string): Promise<string> {
  const campaignRoot = join(outDir, 'campaign')
  const receipts = await loadLedgerReceipts(outDir)
  const notebook = await loadNotebookRows(join(outDir, 'notebook.jsonl'))
  const entries: Array<Record<string, unknown>> = []
  const { readdir } = await import('node:fs/promises')
  for (const name of (await readdir(campaignRoot).catch(() => [])).sort()) {
    const cells = await loadCampaignCells(join(campaignRoot, name))
    if (cells.length === 0) continue
    entries.push({
      label: name,
      campaignDir: join(campaignRoot, name),
      cells: cells.length,
      scenarios: cells.map((c) => c.scenarioId).sort(),
    })
  }
  const manifest = {
    schema: QUANT_ROLLOUT_SCHEMA,
    outDir,
    at: new Date().toISOString(),
    notebookRows: notebook.length,
    strategies: entries,
    receipts: receipts.map((r) => ({
      callId: r.callId,
      phase: (r as Record<string, unknown>).phase ?? null,
      actor: (r as Record<string, unknown>).actor ?? null,
      model: (r as Record<string, unknown>).model ?? null,
      costUsd: (r as Record<string, unknown>).costUsd ?? null,
    })),
  }
  const path = join(outDir, 'rollout-manifest.json')
  await writeFile(path, JSON.stringify(manifest, null, 2))
  return path
}

// ---------------------------------------------------------------------------
// The campaign.
// ---------------------------------------------------------------------------

/** RangeStats assembled from the official (vectorbt) numbers plus turnover,
 *  which only the TS prefilter tracks — labeled at the one place it mixes. */
function rangeStatsFromVbt(stats: VbtWindowStats, start: number, end: number, turnover: number): RangeStats {
  return {
    start,
    end,
    days: end - start,
    totalReturn: stats.totalReturn,
    maxDrawdown: stats.maxDD,
    sharpe: stats.sharpe,
    tradeCount: stats.trades,
    turnover,
  }
}

interface ScoredStrategy {
  signals: Signal[]
  /** Official per-window stats (vectorbt; turnover from the TS prefilter). */
  perWindow: RangeStats[]
  /** Official full-range stats. */
  full: RangeStats
}

/** Score one decision record: TS engine first as fail-closed contract
 *  prefilter (throws on shorting/leverage/malformed signals), then the
 *  vectorbt worker for the official numbers. */
async function scoreStrategySignals(
  worker: VbtWorker,
  universe: AlignedBars,
  signals: Signal[],
  windows: EvalWindow[],
  btConfig: BacktestConfig,
): Promise<ScoredStrategy> {
  const prefilter = runBacktest(universe.bars, signals, btConfig)
  const ranges = windows.map((w) => [w.start, w.end] as [number, number])
  const vbt = await scoreSignals(worker, universe.bars, signals, btConfig, ranges)
  const perWindow = windows.map((w, i) =>
    rangeStatsFromVbt(vbt.windows[i]!, w.start, w.end, statsForRange(prefilter, w.start, w.end).turnover),
  )
  const full = rangeStatsFromVbt(vbt.full, 0, universe.dates.length, prefilter.stats.turnover)
  return { signals, perWindow, full }
}

interface BaselineEvidence {
  perWindowSharpe: Record<string, number[]>
  bestPerWindow: number[]
  fullSample: Record<string, RangeStats>
  perWindowStats: Record<string, RangeStats[]>
}

async function evaluateBaselines(
  worker: VbtWorker,
  universe: AlignedBars,
  windows: EvalWindow[],
  btConfig: BacktestConfig,
): Promise<BaselineEvidence> {
  const perWindowSharpe: Record<string, number[]> = {}
  const fullSample: Record<string, RangeStats> = {}
  const perWindowStats: Record<string, RangeStats[]> = {}
  for (const [name, strategy] of Object.entries(PINNED_BASELINES)) {
    const scored = await scoreStrategySignals(worker, universe, strategy(universe.bars), windows, btConfig)
    fullSample[name] = scored.full
    perWindowStats[name] = scored.perWindow
    perWindowSharpe[name] = scored.perWindow.map((s) => s.sharpe)
  }
  const bestPerWindow = windows.map((_, i) =>
    Math.max(...Object.values(perWindowSharpe).map((sharpes) => sharpes[i]!)),
  )
  return { perWindowSharpe, bestPerWindow, fullSample, perWindowStats }
}

function baselineTable(evidence: BaselineEvidence): string {
  const lines: string[] = []
  for (const [name, sharpes] of Object.entries(evidence.perWindowSharpe)) {
    lines.push(`  ${name.padEnd(15)} ${sharpes.map((s) => s.toFixed(2).padStart(6)).join(' ')}`)
  }
  lines.push(`  ${'BEST'.padEnd(15)} ${evidence.bestPerWindow.map((s) => s.toFixed(2).padStart(6)).join(' ')}`)
  return lines.join('\n')
}

export async function runQuantCampaign(config: QuantLoopConfig): Promise<CandidateRow[]> {
  if (!VbtWorker.isAvailable()) {
    throw new Error(
      'quant-arena: the official scorer is the vectorbt worker, which needs `uv` on PATH ' +
        '(src/quant-arena/python/uv.lock pins the environment). The TS engine is a prefilter ' +
        'only and cannot stand in — install uv, there is no fallback scorer.',
    )
  }
  const worker = new VbtWorker()
  try {
    return await runQuantCampaignWithWorker(worker, config)
  } finally {
    await worker.close()
  }
}

async function runQuantCampaignWithWorker(worker: VbtWorker, config: QuantLoopConfig): Promise<CandidateRow[]> {
  await mkdir(config.outDir, { recursive: true })
  const notebookPath = join(config.outDir, 'notebook.jsonl')
  const reconciled = reconcileCrashOrphansOnDisk(config.outDir)
  if (reconciled.length > 0) log(`reconciled ${reconciled.length} crash-orphaned ledger call(s)`)
  const ledger = createRunCostLedger({ storage: fsCampaignStorage(), runDir: config.outDir })

  const universe = await loadInSample()
  const T = universe.dates.length
  const windows = bootstrapWindows(T, {
    k: config.windows,
    windowDays: config.windowDays,
    seed: config.seed,
    warmupDays: config.warmupDays,
  })
  const btConfig: BacktestConfig = { costBps: config.costBps, slippageBps: config.slippageBps }
  log(`in-sample: ${T} days x ${universe.tickers.length} tickers; ${windows.length} windows of ${config.windowDays}d (seed ${config.seed})`)
  log(`scoring engine: vectorbt ${await worker.ping()} (persistent worker, numba warm)`)

  const baselines = await evaluateBaselines(worker, universe, windows, btConfig)
  await appendFile(
    notebookPath,
    JSON.stringify({
      schema: NOTEBOOK_BASELINES_SCHEMA,
      at: new Date().toISOString(),
      seed: config.seed,
      costBps: config.costBps,
      slippageBps: config.slippageBps,
      windows: windows.map((w) => ({
        start: w.start,
        end: w.end,
        startDate: universe.dates[w.start],
        endDate: universe.dates[w.end - 1],
      })),
      perWindowSharpe: baselines.perWindowSharpe,
      bestPerWindow: baselines.bestPerWindow,
      fullSample: baselines.fullSample,
    }) + '\n',
  )
  const campaignRoot = join(config.outDir, 'campaign')
  for (const name of Object.keys(PINNED_BASELINES)) {
    await writeWindowCells(
      campaignRoot,
      `baseline-${name}`,
      windows.map((w, i) => ({
        window: w,
        stats: baselines.perWindowStats[name]![i]!,
        bestBaselineSharpe: baselines.bestPerWindow[i]!,
      })),
    )
  }

  const priorRows = await loadNotebookRows(notebookPath)
  let nTried = priorRows.filter((r) => r.schema === NOTEBOOK_CANDIDATE_SCHEMA).length
  const rows: CandidateRow[] = []

  for (const proposer of config.proposers) {
    const profile = loadAuthorProfile(proposer)
    for (let shot = 0; shot < config.candidatesPerProposer; shot++) {
      nTried += 1
      const candidateId = `cand-${String(nTried).padStart(3, '0')}-${proposer.name}`
      const threshold = requiredExcessSharpe(nTried)
      log(`--- ${candidateId}: authoring (try #${nTried}, bar ${threshold.toFixed(3)})`)

      const row: CandidateRow = {
        schema: NOTEBOOK_CANDIDATE_SCHEMA,
        at: new Date().toISOString(),
        candidateId,
        proposer: proposer.name,
        authorModel: config.authorModel,
        strategyPath: null,
        sha256: null,
        authoringCostUsd: null,
        nTried,
        leakAudit: { truncation: null, llm: null },
        eval: null,
        inSampleFull: null,
        verdict: 'rejected-error',
        reasons: [],
      }

      try {
        const prompt = buildAuthorPrompt({
          universe,
          windows,
          baselineTable: baselineTable(baselines),
          threshold,
          nTried,
          ...(proposer.lens ? { lens: proposer.lens } : {}),
        })
        const { outcome, costUsd } = await meteredClaudeShot(
          ledger,
          { phase: 'search.proposal', actor: `proposer-shot:${proposer.name}`, tags: { candidateId } },
          {
            prompt,
            model: config.authorModel,
            ...(profile?.prompt?.systemPrompt ? { systemPrompt: profile.prompt.systemPrompt } : {}),
            timeoutMs: config.authorTimeoutMs,
            cwd: config.outDir,
          },
        )
        row.authoringCostUsd = costUsd

        const extracted = extractStrategySource(outcome.text)
        if (!extracted.ok) {
          row.verdict = 'rejected-contract'
          row.reasons = [extracted.reason]
        } else {
          const strategyDir = join(config.outDir, 'strategies', candidateId)
          await mkdir(strategyDir, { recursive: true })
          const strategyPath = join(strategyDir, 'strategy.ts')
          await writeFile(strategyPath, extracted.code)
          row.strategyPath = strategyPath
          row.sha256 = `sha256:${createHash('sha256').update(extracted.code).digest('hex')}`

          let strategy: GenerateSignals | null = null
          try {
            // v2 (`onBar`) modules are wrapped through the incremental
            // driver, which structurally truncates history per bar.
            const loaded = await loadStrategyFile(strategyPath, {
              symbols: universe.tickers,
              costBps: config.costBps,
              slippageBps: config.slippageBps,
            })
            strategy = loaded.generateSignals
          } catch (cause) {
            row.verdict = 'rejected-contract'
            row.reasons = [(cause as Error).message.slice(0, 300)]
          }
          if (strategy !== null) {
            // Leak audit stage 1: deterministic truncation invariance.
            const truncation = truncationInvariance(strategy, universe.bars, { warmupDays: config.warmupDays })
            row.leakAudit.truncation = truncation
            // Leak audit stage 2: adversarial source read.
            const llm = config.skipLlmAudit
              ? ('skipped' as const)
              : await llmLeakAudit(ledger, config, candidateId, extracted.code)
            row.leakAudit.llm = llm
            const llmBad = llm !== 'skipped' && llm.verdict !== 'clean'
            if (!truncation.clean || llmBad) {
              row.verdict = 'rejected-leak'
              row.reasons = [
                ...(truncation.clean
                  ? []
                  : [`truncation divergence at cutoff ${truncation.divergence!.cutoff}: ${truncation.divergence!.detail}`]),
                ...(llmBad ? [`adversarial audit: ${(llm as { verdict: string; evidence: string }).evidence || (llm as { verdict: string }).verdict}`] : []),
              ]
            } else {
              // Eval: TS prefilter (contract enforcement) + official
              // vectorbt scores, per window against the pinned bar.
              const scored = await scoreStrategySignals(worker, universe, strategy(universe.bars), windows, btConfig)
              row.inSampleFull = scored.full
              const perWindow: WindowScore[] = windows.map((w, i) => {
                const stats = scored.perWindow[i]!
                return {
                  start: w.start,
                  end: w.end,
                  startDate: universe.dates[w.start]!,
                  endDate: universe.dates[w.end - 1]!,
                  sharpe: stats.sharpe,
                  bestBaselineSharpe: baselines.bestPerWindow[i]!,
                  excess: stats.sharpe - baselines.bestPerWindow[i]!,
                }
              })
              await writeWindowCells(
                campaignRoot,
                candidateId,
                windows.map((w, i) => ({
                  window: w,
                  stats: scored.perWindow[i]!,
                  bestBaselineSharpe: baselines.bestPerWindow[i]!,
                })),
              )
              const decision: AcceptanceDecision = decideAcceptance({
                perWindowExcess: perWindow.map((w) => w.excess),
                nTried,
              })
              row.eval = {
                perWindow,
                meanExcessSharpe: decision.meanExcessSharpe,
                wins: decision.wins,
                requiredWins: decision.requiredWins,
                threshold: decision.threshold,
              }
              row.verdict = decision.accepted ? 'accepted' : 'rejected-no-edge'
              row.reasons = decision.reasons
            }
          }
        }
      } catch (cause) {
        row.verdict = 'rejected-error'
        row.reasons = [(cause as Error).message.slice(0, 500)]
      }

      await appendFile(notebookPath, JSON.stringify(row) + '\n')
      rows.push(row)
      log(`${candidateId}: ${row.verdict}${row.reasons.length > 0 ? ` — ${row.reasons[0]}` : ''}`)
    }
  }

  const manifestPath = await writeQuantRolloutManifest(config.outDir)
  const summary = ledger.summary()
  log(`campaign done: ${rows.length} candidates, ${rows.filter((r) => r.verdict === 'accepted').length} accepted`)
  log(`spend: $${summary.totalCostUsd.toFixed(4)} across ${summary.totalCalls} metered calls (${summary.inputTokens} in / ${summary.outputTokens} out tokens)`)
  log(`notebook -> ${notebookPath}`)
  log(`rollout manifest -> ${manifestPath}`)
  return rows
}

// ---------------------------------------------------------------------------
// CLI.
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const argv = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(name)
    return i !== -1 ? argv[i + 1] : undefined
  }
  const outDir = flag('--out')
  if (!outDir) {
    console.error(
      'usage: tsx src/quant-arena/quant-loop.mts --out <dir> [--candidates 2] [--seed 20260722] ' +
        '[--author-model sonnet] [--audit-model haiku] [--skip-llm-audit]  # SPENDS: author + audit shots',
    )
    process.exit(2)
  }
  const config = defaultConfig(outDir)
  if (flag('--candidates')) config.candidatesPerProposer = Number(flag('--candidates'))
  if (flag('--seed')) config.seed = Number(flag('--seed'))
  if (flag('--author-model')) config.authorModel = flag('--author-model')!
  if (flag('--audit-model')) config.auditModel = flag('--audit-model')!
  if (argv.includes('--skip-llm-audit')) config.skipLlmAudit = true
  const rows = await runQuantCampaign(config)
  process.exitCode = rows.some((r) => r.verdict === 'rejected-error') ? 1 : 0
}
