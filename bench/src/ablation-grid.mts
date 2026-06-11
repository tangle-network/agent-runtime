/**
 * THE ABLATION GRID — optimization coordinates as independent, toggleable factors
 * (docs/research/factorial-ablation-design.md). Each CELL = a named combination of:
 *
 *   σ steering        sample (off) | refine (on)
 *   α self-improve    fixed field (off) | runStrategyEvolution (on)
 *   γ prompt-opt      original prompt (off) | the PROMPT_ARTIFACT file (on — a GEPA/
 *                     selfImprove winner produced OUTSIDE the grid, supplied as input)
 *   κ compression     as-is (off) | a compression operator on the cell's prompt (on)
 *
 * Every cell runs the SAME tasks at the SAME budget; every cell's holdout report is
 * gated against the `base` cell — superiority for score factors, NON-INFERIORITY for κ
 * (its win condition is cost). Real spend, never token counts.
 *
 *   CELLS=base,steer,compress,steer+compress N=24 HOLDOUT=12 BUDGET=4 \
 *     EOPS_GYM_DBS_DIR=… tsx src/ablation-grid.mts
 *   ENV=math — gym-free verifier domain (the verbose-prompt compression target)
 *   PROMPT_ARTIFACT=/path/to/optimized-prompt.txt — required by any γ cell
 *   KAPPA=llm-50|llm-25|ddmin-2|ddmin-5 — the compression operator (default llm-50)
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticTask,
  type BenchmarkReport,
  promotionGate,
  type PromotionVerdict,
  refine,
  runBenchmark,
  runStrategyEvolution,
  sample,
  sampleThenRefine,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'
import { join } from 'node:path'
import { createEopsSurface, eopsTaskFromRow } from './agentic-eops'
import { aimeEnvironment, mathEnvironment } from './ablation-math-env.mts'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

interface CellSpec {
  name: string
  sigma: boolean // steering
  alpha: boolean // self-improvement
  gamma: boolean // optimized-prompt artifact
  kappa: boolean // compression
}

function parseCell(name: string): CellSpec {
  const parts = name === 'base' ? [] : name.split('+')
  const known = new Set(['steer', 'evolve', 'gepa', 'compress'])
  for (const p of parts) if (!known.has(p)) throw new Error(`unknown cell factor "${p}" in "${name}" (known: steer, evolve, gepa, compress)`)
  return {
    name,
    sigma: parts.includes('steer'),
    alpha: parts.includes('evolve'),
    gamma: parts.includes('gepa'),
    kappa: parts.includes('compress'),
  }
}

// ── κ operators (prompt minimization) ─────────────────────────────────────────────

function ddmin(text: string, n: number): string {
  return [...text].filter((_, i) => (i + 1) % n !== 0).join('')
}

interface CompressOut {
  prompt: string
  /** The machinery's own bill: what the compression call itself cost (zero for ddmin). */
  overhead: { usd: number; ms: number; tokens: { input: number; output: number } }
}

async function compressPrompt(
  text: string,
  kappa: string,
  routerKey: string,
  baseUrl: string,
  modelOverride?: string,
): Promise<CompressOut> {
  const free = { usd: 0, ms: 0, tokens: { input: 0, output: 0 } }
  if (kappa === 'ddmin-2') return { prompt: ddmin(text, 2), overhead: free }
  if (kappa === 'ddmin-5') return { prompt: ddmin(text, 5), overhead: free }
  const fraction = kappa === 'llm-25' ? 0.25 : 0.5
  // The compressor is a fixed NON-THINKING model: a thinking model can burn the token
  // cap on reasoning and emit ~empty content, silently degenerating the κ arm.
  const compressorModel = modelOverride ?? process.env.COMPRESSOR_MODEL ?? 'deepseek-v4-flash'
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl, defaultModel: compressorModel })
  const words = text.split(/\s+/).length
  const target = Math.round(words * fraction)
  const started = Date.now()
  const res = await chat.chat({
    temperature: 0.2,
    maxTokens: 2048,
    messages: [
      {
        role: 'system',
        content: `Compress the following instruction prompt to at most ${target} words while preserving everything task-critical (the procedure, the output format, any tool instructions). Output ONLY the compressed prompt.`,
      },
      { role: 'user', content: text },
    ],
  })
  const elapsedMs = Date.now() - started
  const usage = (res as { usage?: { promptTokens?: number; prompt_tokens?: number; completionTokens?: number; completion_tokens?: number } }).usage
  const tokens = {
    input: usage?.promptTokens ?? usage?.prompt_tokens ?? 0,
    output: usage?.completionTokens ?? usage?.completion_tokens ?? 0,
  }
  const out = res.content.trim()
  const outWords = out.split(/\s+/).length
  // Fail loud on a degenerate compression — a ~empty prompt is a different treatment
  // (prompt REMOVAL), not the requested ratio; it must never silently enter a cell.
  if (outWords < Math.max(5, target * 0.2)) {
    throw new Error(`compressPrompt(${kappa}): degenerate output (${outWords} words vs target ${target}) — compressor returned: ${out.slice(0, 120)}`)
  }
  const { estimateCost, isModelPriced } = await import('@tangle-network/agent-eval')
  return {
    prompt: out,
    overhead: {
      usd: isModelPriced(compressorModel) ? estimateCost(tokens.input, tokens.output, compressorModel) : 0,
      ms: elapsedMs,
      tokens,
    },
  }
}

async function main(): Promise<void> {
  const cellNames = (process.env.CELLS ?? 'base,steer,compress,steer+compress').split(',').map((s) => s.trim())
  const cells = cellNames.map(parseCell)
  if (!cells.some((c) => c.name === 'base')) cells.unshift(parseCell('base'))
  const n = Number(process.env.N ?? 24)
  const holdoutN = Number(process.env.HOLDOUT ?? 12)
  const budget = Number(process.env.BUDGET ?? 4)
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const kappaOp = process.env.KAPPA ?? 'llm-50'
  const envName = process.env.ENV ?? 'eops'

  const domain =
    envName === 'math'
      ? mathEnvironment()
      : envName === 'aime'
        ? aimeEnvironment()
        : (() => {
          const surface = createEopsSurface(must('EOPS_GYM_DBS_DIR'))
          const loadSlice = async (offset: number, count: number): Promise<AgenticTask[]> => {
            const split = process.env.EOPS_SPLIT ?? 'itsm'
            const url = `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent('ServiceNow-AI/EnterpriseOps-Gym')}&config=oracle&split=${split}&offset=${offset}&length=${count}`
            const res = await fetch(url)
            if (!res.ok) throw new Error(`EOPS HF rows HTTP ${res.status}`)
            const body = (await res.json()) as { rows?: Array<{ row: Parameters<typeof eopsTaskFromRow>[0] }> }
            const tasks = (body.rows ?? []).slice(0, count).map(({ row }) => eopsTaskFromRow(row))
            if (tasks.length < count) throw new Error(`EOPS slice [${offset}, ${offset + count}) returned only ${tasks.length}`)
            return tasks
          }
          return { environment: surface, tasks: loadSlice }
        })()

  const worker = { routerBaseUrl, routerKey, model: workerModel, innerTurns: Number(process.env.INNER_TURNS ?? 4), temperature: 0.7 }
  const gammaPrompt = cells.some((c) => c.gamma) ? readFileSync(must('PROMPT_ARTIFACT'), 'utf8').trim() : undefined

  // The prompt each cell carries: original | γ artifact, then κ on top of whichever.
  // The cache stores the PROMISE so concurrent retask() calls share ONE compression
  // call per unique prompt (check-then-set on the value raced: N tasks fired N
  // duplicate router calls and any single blip killed the run).
  const promptCache = new Map<string, Promise<CompressOut>>()
  const cellPrompt = async (cell: CellSpec, original: string): Promise<string> => {
    const base = cell.gamma ? (gammaPrompt as string) : original
    if (!cell.kappa) return base
    const key = `${cell.gamma}:${kappaOp}:${base.slice(0, 40)}`
    let pending = promptCache.get(key)
    if (!pending) {
      // The retry rotates to a NAMED fallback model (same-model retries do not help
      // when the model itself is degenerate-mooding — the authorStrategy lesson).
      pending = compressPrompt(base, kappaOp, routerKey, routerBaseUrl).catch((first) => {
        const fallback = process.env.COMPRESSOR_FALLBACK_MODEL ?? 'gpt-4o-mini'
        console.error(
          `  compress retry on ${fallback} (${kappaOp}): ${first instanceof Error ? first.message.slice(0, 80) : first}`,
        )
        return compressPrompt(base, kappaOp, routerKey, routerBaseUrl, fallback)
      })
      promptCache.set(key, pending)
    }
    return (await pending).prompt
  }

  const train = await domain.tasks(0, n)
  const holdout = await domain.tasks(n + Number(process.env.HOLDOUT_OFFSET ?? 0), holdoutN)
  const retask = async (cell: CellSpec, tasks: AgenticTask[]): Promise<AgenticTask[]> =>
    Promise.all(tasks.map(async (t) => ({ ...t, systemPrompt: await cellPrompt(cell, t.systemPrompt) })))

  console.error(`=== ABLATION GRID · cells [${cells.map((c) => c.name).join(', ')}] · n=${n}+${holdoutN} · budget=${budget} · κ=${kappaOp} · env=${envName} ===`)
  const results: Record<string, { holdout: BenchmarkReport; strategyName: string; words: number }> = {}
  for (const cell of cells) {
    console.error(`\n▶ cell ${cell.name}`)
    const cellHoldout = await retask(cell, holdout)
    const sysWords = (cellHoldout[0]?.systemPrompt ?? '').split(/\s+/).length
    let strategyName: string
    let holdoutReport: BenchmarkReport
    if (cell.alpha) {
      const report = await runStrategyEvolution({
        environment: domain.environment,
        tasks: async (offset, count) => retask(cell, offset === 0 ? train.slice(0, count) : holdout.slice(0, count)),
        trainN: n,
        holdoutN,
        worker,
        author: {
          chat: createChatClient({ transport: 'router', apiKey: routerKey, baseUrl: routerBaseUrl, defaultModel: workerModel }),
          model: workerModel,
          fallbackModel: 'deepseek-v4-flash',
          maxTokens: 8192,
        },
        budget,
        concurrency,
        generations: Number(process.env.GENS ?? 1),
        populationSize: Number(process.env.POP ?? 2),
        outDir: join(import.meta.dirname, 'authored'),
      })
      strategyName = report.finalChampion.name
      holdoutReport = report.holdout
    } else {
      const strategy: Strategy = cell.sigma ? refine : sample
      strategyName = strategy.name
      holdoutReport = await runBenchmark({
        environment: domain.environment,
        tasks: cellHoldout,
        worker,
        strategies: [strategy],
        budget,
        concurrency,
      })
    }
    const s = holdoutReport.perStrategy[strategyName]
    console.error(
      `  ${cell.name}: ${strategyName} → ${(100 * (s?.score ?? 0)).toFixed(1)}%  $${(s?.usd ?? 0).toFixed(4)}/task  ${((s?.ms ?? 0) / 1000).toFixed(0)}s/task  (prompt ${sysWords}w)`,
    )
    results[cell.name] = { holdout: holdoutReport, strategyName, words: sysWords }
  }

  // Gate every cell against base on the SAME holdout task ids.
  const base = results.base
  if (!base) throw new Error('base cell missing')
  const modelLine = `worker=${workerModel} analyst=${workerModel} compressor=${process.env.COMPRESSOR_MODEL ?? 'deepseek-v4-flash'} · env=${envName} n=${holdoutN} budget=${budget} κ=${kappaOp}`
  console.error(`\n${'='.repeat(74)}\nGRID VERDICTS (vs base; κ cells gated non-inferiority)\n${modelLine}\n${'='.repeat(74)}`)
  const verdicts: Record<string, PromotionVerdict> = {}
  for (const cell of cells) {
    if (cell.name === 'base') continue
    const r = results[cell.name]
    if (!r) continue
    const merged: BenchmarkReport = {
      n: holdoutN,
      excluded: 0,
      perStrategy: {},
      pareto: [],
      perTask: base.holdout.perTask.map((row) => {
        const vRow = r.holdout.perTask.find((x) => x.taskId === row.taskId)
        const bCell = row.cells?.[base.strategyName]
        const vCell = vRow?.cells?.[r.strategyName]
        return bCell && vCell
          ? { taskId: row.taskId, cells: { base: bCell, [cell.name]: vCell } }
          : { taskId: row.taskId, error: 'cell missing' }
      }),
    }
    const verdict = promotionGate({
      report: merged,
      incumbent: 'base',
      candidate: cell.name,
      ...(cell.kappa && !cell.sigma && !cell.alpha && !cell.gamma ? { mode: 'non-inferiority' as const } : cell.kappa ? { mode: 'non-inferiority' as const } : {}),
      minPairedTasks: Math.min(6, holdoutN),
    })
    verdicts[cell.name] = verdict
    const cost = verdict.costSavings ? `  savings $${verdict.costSavings.mean.toFixed(4)} CI[${verdict.costSavings.low.toFixed(4)},${verdict.costSavings.high.toFixed(4)}]` : ''
    const lat = verdict.latency ? `  Δms ${(verdict.latency.mean / 1000).toFixed(1)}s CI[${(verdict.latency.low / 1000).toFixed(1)},${(verdict.latency.high / 1000).toFixed(1)}]` : ''
    console.error(`  ${cell.name.padEnd(16)} Δscore ${(verdict.lift.mean * 100).toFixed(1)}pp CI[${(verdict.lift.low * 100).toFixed(1)},${(verdict.lift.high * 100).toFixed(1)}]${cost}${lat}  → ${verdict.promoted ? `PROMOTED (${verdict.reason})` : verdict.reason}`)
  }
  // The machinery's own bill: κ's one-time compression cost amortizes across every task
  // that uses the compressed prompt — break-even = overhead / per-task savings.
  const overheads = await Promise.all(
    [...promptCache.entries()].map(async ([k, v]) => [k, (await v).overhead] as const),
  )
  if (overheads.length > 0) {
    console.error('  machinery bill (κ one-time):')
    for (const [k, o] of overheads) {
      const promotedSavings = Object.values(verdicts).find((v) => v.promoted && v.costSavings)?.costSavings?.mean
      const breakEven = promotedSavings && promotedSavings > 0 ? Math.ceil(o.usd / promotedSavings) : null
      console.error(
        `    ${k.slice(0, 30)}: $${o.usd.toFixed(5)} · ${(o.ms / 1000).toFixed(1)}s · ${o.tokens.input}/${o.tokens.output} tok${breakEven !== null ? ` → break-even after ${breakEven} task(s)` : ''}`,
      )
    }
  }
  const outPath = process.env.OUT ?? '/tmp/ablation-grid-result.json'
  const prompts = Object.fromEntries(
    await Promise.all(
      [...promptCache.entries()].map(async ([k, v]) => [k, (await v).prompt] as const),
    ),
  )
  writeFileSync(
    outPath,
    JSON.stringify(
      {
        models: { worker: workerModel, analyst: workerModel, compressor: process.env.COMPRESSOR_MODEL ?? 'deepseek-v4-flash' },
        env: envName,
        budget,
        holdoutN,
        cells: cellNames,
        kappaOp,
        prompts,
        overheads: Object.fromEntries(overheads),
        results,
        verdicts,
      },
      null,
      2,
    ),
  )
  console.error(`  full artifact → ${outPath}`)
}

main().catch((e) => {
  console.error(`ablation-grid: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
