/**
 * THE REDUCER GATE — does prompt COMPRESSION preserve quality while cutting real cost?
 *
 * The two-stage shape: quality-optimize a prompt first (GEPA/selfImprove or hand-tuned),
 * then sweep compression levels over the WINNER and gate each level with the
 * non-inferiority rule — score proven not-worse than the original (paired CI lower bound
 * clears −tolerance) AND real spend significantly lower. Token counts are never the
 * promoted metric; the cost vector is actual router usd (prompt caching can invert a
 * token-count "win").
 *
 * Arms (each = the SAME strategy + budget, only the task prompts differ):
 *   original        — the uncompressed prompt (the control)
 *   nth-char-2      — every 2nd character removed   (the dumb floor: if smart
 *   nth-char-5      — every 5th character removed    compression can't beat random
 *   word-drop-40    — 40% of words removed, seeded    deletion, it isn't earning it)
 *   llm-50 / llm-25 — an LLM compresses the prompt to ~50% / ~25% of its words,
 *                     instructed to preserve task-critical content
 *
 * Domain: answer-shaped math (createVerifierEnvironment) with a deliberately VERBOSE
 * system prompt — compression needs something to compress; short prompts measure noise.
 *
 *   N=12 BUDGET=2 STRATEGY=refine tsx src/prompt-compression-gate.mts
 */
import { writeFileSync } from 'node:fs'
import { createChatClient } from '@tangle-network/agent-eval'
import {
  type AgenticTask,
  type BenchmarkReport,
  createVerifierEnvironment,
  promotionGate,
  refine,
  runBenchmark,
  sample,
  type Strategy,
} from '@tangle-network/agent-runtime/loops'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// ── A verbose system prompt (the compression target) + graded math tasks ──────────

const verboseSystemPrompt = `You are an extremely careful and methodical mathematical reasoning assistant working on
quantitative word problems. Your approach to every single problem should always follow a disciplined,
step-by-step procedure: first, read the entire problem statement carefully from beginning to end,
making sure that you have correctly identified every quantity mentioned, every relationship between
the quantities, and exactly what the question is asking you to compute. Second, write out your
reasoning explicitly, one logical step at a time, double-checking each arithmetic operation as you
perform it, because small arithmetic slips are the most common source of incorrect final answers.
Third, before submitting, re-read the original question one final time and verify that the number you
are about to submit actually answers the question that was asked, in the units that were asked for,
rather than an intermediate quantity computed along the way. When you are fully confident, submit your
final numeric answer using the submit_answer tool with just the number, no units, no commas, and no
additional commentary or explanation attached to it.`

interface MathTask {
  q: string
  a: number
}
const problems: MathTask[] = [
  { q: 'A baker makes 24 muffins per tray and bakes 7 trays, then sells 109 muffins. How many remain?', a: 59 },
  { q: 'A train travels 84 km/h for 2.5 hours, then 60 km/h for 1.5 hours. Total distance in km?', a: 300 },
  { q: 'Tickets cost $14 for adults, $9 for children. 13 adults and 21 children attend. Total revenue?', a: 371 },
  { q: 'A tank holds 840 liters and drains at 35 liters/minute. After 18 minutes, how many liters remain?', a: 210 },
  { q: 'A worker earns $22/hour plus 1.5x overtime past 40 hours. They work 47 hours. Total pay?', a: 1111 },
  { q: 'A rectangle is 3x as long as wide; the perimeter is 96 cm. What is its area in square cm?', a: 432 },
  { q: 'A store discounts a $250 jacket by 30%, then adds 8% tax on the discounted price. Final price?', a: 189 },
  { q: 'Alice reads 45 pages/day, Bob 30 pages/day. A book is 600 pages. Reading together, days to finish (they split it optimally)?', a: 8 },
  { q: 'A car uses 7.5 liters per 100 km. Fuel costs $1.60/liter. Cost to drive 480 km?', a: 57.6 },
  { q: '3 pumps fill a pool in 8 hours. How many hours for 4 pumps at the same rate?', a: 6 },
  { q: 'An investment of $4000 grows 5% per year, simple interest. Value after 7 years?', a: 5400 },
  { q: 'A recipe for 6 servings needs 450g flour. How many grams for 16 servings?', a: 1200 },
]

// ── The reducers ──────────────────────────────────────────────────────────────────

function nthCharDrop(text: string, n: number): string {
  return [...text].filter((_, i) => (i + 1) % n !== 0).join('')
}

function wordDrop(text: string, fraction: number, seed = 1337): string {
  let state = seed
  const rand = () => {
    state = (state * 1103515245 + 12345) % 2147483648
    return state / 2147483648
  }
  return text
    .split(/\s+/)
    .filter(() => rand() > fraction)
    .join(' ')
}

async function llmCompress(text: string, targetFraction: number, routerKey: string, baseUrl: string, model: string): Promise<string> {
  const chat = createChatClient({ transport: 'router', apiKey: routerKey, baseUrl, defaultModel: model })
  const words = text.split(/\s+/).length
  const res = await chat.chat({
    temperature: 0.2,
    maxTokens: 1024,
    messages: [
      {
        role: 'system',
        content: `Compress the following instruction prompt to at most ${Math.round(words * targetFraction)} words while preserving everything task-critical (the procedure, the output format, the tool to use). Output ONLY the compressed prompt.`,
      },
      { role: 'user', content: text },
    ],
  })
  return res.content.trim()
}

async function main(): Promise<void> {
  const n = Math.min(Number(process.env.N ?? 12), problems.length)
  const budget = Number(process.env.BUDGET ?? 2)
  const strategyName = process.env.STRATEGY ?? 'refine'
  const workerModel = process.env.WORKER_MODEL ?? 'deepseek-v4-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const concurrency = Number(process.env.CONCURRENCY ?? 3)
  const tolerance = Number(process.env.SCORE_TOLERANCE ?? 0.05)
  const strategy: Strategy = strategyName === 'sample' ? sample : refine

  const environment = createVerifierEnvironment({
    name: 'verbose-math',
    check: (task, answer) => {
      const expected = (task.meta as MathTask | undefined)?.a
      const got = Number.parseFloat(String(answer).replace(/[$,\s]/g, ''))
      const pass = expected !== undefined && Number.isFinite(got) && Math.abs(got - expected) < 0.01
      return { passes: pass ? 1 : 0, total: 1, errored: 0 }
    },
  })

  const tasksWith = (systemPrompt: string): AgenticTask[] =>
    problems.slice(0, n).map((p, i) => ({
      id: `math-${i}`,
      systemPrompt,
      userPrompt: p.q,
      meta: p as unknown as Record<string, unknown>,
    }))

  console.error('▶ building compression variants…')
  const variants: Array<{ name: string; prompt: string }> = [
    { name: 'original', prompt: verboseSystemPrompt },
    { name: 'nth-char-2', prompt: nthCharDrop(verboseSystemPrompt, 2) },
    { name: 'nth-char-5', prompt: nthCharDrop(verboseSystemPrompt, 5) },
    { name: 'word-drop-40', prompt: wordDrop(verboseSystemPrompt, 0.4) },
    { name: 'llm-50', prompt: await llmCompress(verboseSystemPrompt, 0.5, routerKey, routerBaseUrl, workerModel) },
    { name: 'llm-25', prompt: await llmCompress(verboseSystemPrompt, 0.25, routerKey, routerBaseUrl, workerModel) },
  ]
  for (const v of variants) console.error(`  ${v.name}: ${v.prompt.split(/\s+/).length} words`)

  const worker = { routerBaseUrl, routerKey, model: workerModel, innerTurns: 4, temperature: 0.3 }
  const reports: Record<string, BenchmarkReport> = {}
  for (const v of variants) {
    console.error(`\n▶ arm ${v.name} (${strategy.name} @ budget ${budget}, n=${n})…`)
    reports[v.name] = await runBenchmark({
      environment,
      tasks: tasksWith(v.prompt),
      worker,
      strategies: [strategy],
      budget,
      concurrency,
    })
    const r = reports[v.name].perStrategy[strategy.name]
    console.error(`  score ${(100 * (r?.score ?? 0)).toFixed(1)}%  $${(r?.usd ?? 0).toFixed(4)}/task  ${(r?.ms ?? 0) / 1000 | 0}s/task`)
  }

  // The gate per variant vs original: tasks are identical ids across arms — merge into
  // one synthetic report with two "strategies" (original vs variant) so promotionGate's
  // pairing applies unchanged.
  console.error(`\n${'='.repeat(74)}\nREDUCER VERDICTS (non-inferiority: score CI low > −${tolerance}; cost savings CI low > 0)\n${'='.repeat(74)}`)
  const verdicts: Record<string, unknown> = {}
  const original = reports.original
  if (!original) throw new Error('original arm missing')
  for (const v of variants.slice(1)) {
    const variantReport = reports[v.name]
    if (!variantReport) continue
    const merged: BenchmarkReport = {
      n,
      excluded: 0,
      perStrategy: {},
      pareto: [],
      perTask: original.perTask.map((row) => {
        const vRow = variantReport.perTask.find((r) => r.taskId === row.taskId)
        const oCell = row.cells?.[strategy.name]
        const vCell = vRow?.cells?.[strategy.name]
        return oCell && vCell
          ? { taskId: row.taskId, cells: { original: oCell, [v.name]: vCell } }
          : { taskId: row.taskId, error: 'arm missing cell' }
      }),
    }
    const verdict = promotionGate({
      report: merged,
      incumbent: 'original',
      candidate: v.name,
      mode: 'non-inferiority',
      scoreTolerance: tolerance,
      minPairedTasks: Math.min(6, n),
    })
    verdicts[v.name] = verdict
    console.error(
      `  ${v.name.padEnd(14)} score Δ ${(verdict.lift.mean * 100).toFixed(1)}pp CI[${(verdict.lift.low * 100).toFixed(1)},${(verdict.lift.high * 100).toFixed(1)}]  savings $${verdict.costSavings?.mean.toFixed(4)} CI[${verdict.costSavings?.low.toFixed(4)},${verdict.costSavings?.high.toFixed(4)}]  → ${verdict.promoted ? 'PROMOTED (cheaper, quality holds)' : verdict.reason}`,
    )
  }
  const outPath = process.env.OUT ?? '/tmp/prompt-compression-result.json'
  writeFileSync(outPath, JSON.stringify({ variants: variants.map((v) => ({ ...v, words: v.prompt.split(/\s+/).length })), reports, verdicts }, null, 2))
  console.error(`  full artifact → ${outPath}`)
}

main().catch((e) => {
  console.error(`prompt-compression-gate: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`)
  process.exit(1)
})
