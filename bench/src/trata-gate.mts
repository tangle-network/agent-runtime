/**
 * Trata hedge-bench gate — direct router completions (no sandbox/opencode).
 *
 * Trata is a text-analysis benchmark: each task is a financial analysis brief
 * over embedded source docs. The worker is a single router completion (not an
 * agentic loop), which is appropriate here: tasks are scored by an LLM judge on
 * theme coverage, not on code execution or tool use.
 *
 * Usage:
 *   BENCH=trata-hedge WORKER_MODEL=deepseek-v4-flash JUDGE_MODEL=gemini-2.5-flash \
 *   TRATA_BENCH_ROOT=/tmp/trata-hedge-bench N=10 CONCURRENCY=5 \
 *   dotenvx run -f ~/company/devops/secrets/agent-state.env -- \
 *     pnpm exec tsx bench/src/trata-gate.mts
 *
 * Key env vars:
 *   BENCH              adapter key (default: trata-hedge)
 *   WORKER_MODEL       model for the analysis completion (default: deepseek-v4-flash)
 *   JUDGE_MODEL        model for the 3-stage judge (default: gemini-2.5-pro)
 *   TRATA_BENCH_ROOT   path to cloned trata-hedge-bench (default: /tmp/trata-hedge-bench)
 *   N                  how many tasks to run (default: 10; 0 = all 102)
 *   CONCURRENCY        parallel worker slots (default: 5)
 *   IDS                comma-separated task ids to run a specific subset
 *   ROUTER_BASE        router base URL (default: https://router.tangle.tools/v1)
 *   CORPUS             path to write JSONL run records (optional)
 *
 * Score is 0–4 / 4 = 0–100%; resolved = 4/4 (all themes + synthesis = sparse reward).
 * Partial credit (1-3) is reported in the score distribution.
 */

import { appendFileSync } from 'node:fs'
import { resolveAdapter } from './adapters'
import type { BenchScore, BenchTask } from './benchmarks/types'
import { runBenchRouterTurn } from './router-turn'
import { runPool } from './run-pool'

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// GEPA-optimised surface — +8.6pp holdout lift over the minimal baseline on deepseek-v4-flash
// (2 independent runs, CI [0, 12.5pp]; gate holds for caution, surface ships as default).
const ANALYST_SYSTEM = process.env.SYSTEM_PROMPT ?? [
  'You are a senior financial analyst producing a structured investment memo.',
  'Begin your response with exactly "ANALYSIS:" on its own line (nothing before it), then write your full analysis.',
  'Structure your analysis with clearly labeled sections for each distinct analytical theme',
  '(e.g., valuation, capital allocation, competitive dynamics, risk factors)',
  'so that no major investment consideration is merged or omitted.',
  'Benchmark the company explicitly against named sector peers, citing specific metrics such as',
  'EV/EBITDA, P/E ratios, margin differentials, and growth premiums from the peer financial files.',
  'Every factual claim must cite the filename (e.g., "per earnings_call/apo_q4_2025_earnings_call.txt").',
  'Identify and verbatim-cite specific numerical targets from management guidance such as',
  'earnings per share targets, margin percentages, growth rates, or AUM figures rather than paraphrasing approximately.',
  'When evaluating capital allocation options, explicitly compute implied returns or internal rates of return (IRRs),',
  'showing the arithmetic using price levels and targets from the source data.',
  'Take a clear, decisive position — do not hedge with "it depends". Reconcile conflicting data points explicitly.',
].join(' ')

async function workerComplete(
  task: BenchTask,
  cfg: { routerBaseUrl: string; routerKey: string; model: string; timeoutMs: number },
): Promise<{ answer: string; inputTokens: number; outputTokens: number; durationMs: number }> {
  const startedAt = Date.now()
  const result = await runBenchRouterTurn(
    {
      routerBaseUrl: cfg.routerBaseUrl,
      routerKey: cfg.routerKey,
      profile: {
        name: 'trata-financial-analyst',
        harness: 'cli-base',
        model: {
          provider: 'tangle-router',
          default: cfg.model,
          metadata: {
            temperature: 0,
            maxTokens: Number(process.env.WORKER_MAX_TOKENS ?? 4096),
          },
        },
        prompt: { systemPrompt: ANALYST_SYSTEM },
      },
      timeoutMs: cfg.timeoutMs,
    },
    task.prompt,
  )
  if (result.usage.tokensKnown === false) throw new Error('worker provider omitted token usage')
  return {
    answer: result.finalText,
    inputTokens: result.usage.input,
    outputTokens: result.usage.output,
    durationMs: Date.now() - startedAt,
  }
}

interface TaskResult {
  taskId: string
  answer: string
  score: BenchScore
  rawScore: number
  inputTokens: number
  outputTokens: number
  durationMs: number
  error?: string
}

async function runTask(
  task: BenchTask,
  workerCfg: { routerBaseUrl: string; routerKey: string; model: string; timeoutMs: number },
  adapter: ReturnType<typeof resolveAdapter>,
): Promise<TaskResult> {
  let answer = ''
  let inputTokens = 0
  let outputTokens = 0
  let durationMs = 0
  let error: string | undefined

  try {
    const result = await workerComplete(task, workerCfg)
    answer = result.answer
    inputTokens = result.inputTokens
    outputTokens = result.outputTokens
    durationMs = result.durationMs
  } catch (err) {
    error = err instanceof Error ? err.message : String(err)
  }

  const score = answer.trim()
    ? await adapter.judge(task, answer).catch((err) => ({
        resolved: false as const,
        score: 0,
        detail: JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      }))
    : { resolved: false as const, score: 0, detail: JSON.stringify({ error: error ?? 'empty answer' }) }

  const detail = score.detail ? (JSON.parse(score.detail) as { rawScore?: number }) : {}
  return {
    taskId: task.id,
    answer,
    score,
    rawScore: detail.rawScore ?? (score.resolved ? 4 : 0),
    inputTokens,
    outputTokens,
    durationMs,
    error,
  }
}

async function main(): Promise<void> {
  const benchName = process.env.BENCH ?? 'trata-hedge'
  const adapter = resolveAdapter(benchName)
  await adapter.preflight()

  const n = Number(process.env.N ?? 10)
  const concurrency = Number(process.env.CONCURRENCY ?? 5)
  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const routerBase = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const corpusPath = process.env.CORPUS
  const idsEnv = process.env.IDS

  const loadOpts = idsEnv
    ? { ids: idsEnv.split(',').map((s) => s.trim()).filter(Boolean) }
    : n > 0
      ? { limit: n }
      : {}
  const tasks = await adapter.loadTasks(loadOpts)
  if (tasks.length === 0) throw new Error('no tasks loaded')

  const workerCfg = { routerBaseUrl: routerBase, routerKey, model, timeoutMs: 180_000 }

  console.log(
    `trata-gate: ${tasks.length} tasks | model=${model} | judge=${process.env.JUDGE_MODEL ?? 'gemini-2.5-pro'} | concurrency=${concurrency}`,
  )

  let done = 0
  const results: TaskResult[] = []
  await runPool(tasks, concurrency, async (task) => {
    const r = await runTask(task, workerCfg, adapter)
    results.push(r)
    done++
    const icon = r.rawScore === 4 ? '✓' : r.rawScore >= 2 ? '~' : '·'
    process.stdout.write(
      `  [${done}/${tasks.length}] ${task.id.slice(0, 60)}: ${icon} (${r.rawScore}/4)\n`,
    )
    return r
  })

  // Score distribution
  const byRaw = [0, 0, 0, 0, 0] // index = rawScore 0-4
  let totalInputTok = 0
  let totalOutputTok = 0
  let totalMs = 0
  for (const r of results) {
    byRaw[Math.min(r.rawScore, 4)]++
    totalInputTok += r.inputTokens
    totalOutputTok += r.outputTokens
    totalMs += r.durationMs
  }
  const resolved = byRaw[4] ?? 0
  const partial = (byRaw[2] ?? 0) + (byRaw[3] ?? 0)
  const n_ = results.length
  const pct = (x: number) => (n_ > 0 ? `${((x / n_) * 100).toFixed(1)}%` : 'n/a')
  const meanScore = n_ > 0 ? results.reduce((s, r) => s + r.score.score, 0) / n_ : 0

  console.log(`\n=== ${benchName} — trata-gate (n=${n_}, model=${model}) ===`)
  console.log(`  resolved (4/4):       ${pct(resolved)}  (${resolved}/${n_})`)
  console.log(`  partial credit (2-3): ${pct(partial)}  (${partial}/${n_})`)
  console.log(`  mean score (0..1):    ${meanScore.toFixed(3)}`)
  console.log(`  score dist [0..4]:    ${byRaw.join(' | ')}`)
  console.log(
    `  tokens (in/out):     ${(totalInputTok / 1000).toFixed(0)}k / ${(totalOutputTok / 1000).toFixed(0)}k`,
  )
  console.log(`  wall time:            ${(totalMs / 1000).toFixed(0)}s total`)
  console.log(`  errors:               ${results.filter((r) => r.error).length}`)

  if (corpusPath) {
    for (const r of results) {
      appendFileSync(
        corpusPath,
        JSON.stringify({
          benchmark: benchName,
          instanceId: r.taskId,
          condition: `blind@1`,
          model,
          resolved: r.score.resolved,
          rawScore: r.rawScore,
          score: r.score.score,
          detail: r.score.detail,
          inputTokens: r.inputTokens,
          outputTokens: r.outputTokens,
          durationMs: r.durationMs,
          ...(r.error ? { error: r.error } : {}),
        }) + '\n',
      )
    }
    console.log(`\ncorpus written → ${corpusPath}`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
