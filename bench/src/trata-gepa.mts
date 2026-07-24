/**
 * Official GEPA prompt optimization for Trata hedge-bench.
 *
 * The optimization surface is the system prompt given to the financial analyst
 * worker. GEPA reflects on which rubric themes were missed across training tasks
 * and proposes improved system prompts, learning to instruct the model to
 * extract specific quantitative claims, cover multiple analytical themes, and
 * cite named evidence. Candidate selection and final testing use disjoint data.
 *
 * The surface evolves beyond a bare system instruction: GEPA naturally discovers
 * that it can add few-shot analytical patterns, calculation templates, and
 * structured coverage checklists, effectively skill-creating without
 * hand-engineering. Set K_ROUNDS=2 to add a self-critique refine pass.
 *
 * Usage:
 *   TRATA_BENCH_ROOT=/tmp/trata-hedge-bench \
 *   JUDGE_MODEL=gemini-2.5-flash WORKER_MODEL=deepseek-v4-flash \
 *   REFLECT_MODEL=gemini-2.5-pro \
 *   TRAIN_N=70 SELECTION_N=16 TEST_N=16 MAX_EVALUATIONS=12 CONCURRENCY=8 \
 *   dotenvx run -f ~/company/devops/secrets/agent-state.env -- \
 *     pnpm exec tsx bench/src/trata-gepa.mts
 *
 * Key env vars:
 *   TRATA_BENCH_ROOT   cloned trata-hedge-bench (default /tmp/trata-hedge-bench)
 *   WORKER_MODEL       analyst model (default deepseek-v4-flash)
 *   JUDGE_MODEL        judge model in trata adapter (default gemini-2.5-flash)
 *   REFLECT_MODEL      GEPA reflection model (default gemini-2.5-pro)
 *   TRAIN_N            training tasks (default 70)
 *   SELECTION_N        optimizer selection tasks (default 16)
 *   TEST_N             untouched final comparison tasks (default 16)
 *   MAX_EVALUATIONS    GEPA callback evaluations (default 12)
 *   MAX_PROPOSER_COST_USD GEPA proposal budget (default 5)
 *   REPS               reps per scenario (default 1)
 *   CONCURRENCY        parallel worker slots (default 8)
 *   K_ROUNDS           1=single-shot, 2=analysis+self-critique (default 1)
 *   BASELINE_DIRECTIVE override the starting system prompt
 *   CORPUS             path to write JSONL run records (optional)
 */

import type { AgentProfile } from '@tangle-network/agent-interface'
import type {
  DispatchContext,
  JudgeConfig,
  JudgeScore,
  MutableSurface,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { improve, officialGepa } from '@tangle-network/agent-runtime'
import { appendFileSync, writeFileSync } from 'node:fs'
import { createTrataHedgeAdapter } from './benchmarks/trata-hedge'
import type { BenchTask } from './benchmarks/types'
import {
  assertCompleteCost,
  officialOptimizerModel,
  requiredTokenPricing,
} from './official-optimizer-config.mjs'

interface TrataScenario extends Scenario {
  task: BenchTask
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`env ${name} must be a positive integer`)
  }
  return value
}

function positiveNumber(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`env ${name} must be a positive number`)
  }
  return value
}

// GEPA-optimised baseline — the best surface found across 9 runs (+8.6pp on holdout, 2 independent
// confirmations). Future GEPA runs start from here; BASELINE_DIRECTIVE overrides if you want to
// experiment from a different starting point.
const DEFAULT_TRATA_SYSTEM = [
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

// Refine round instruction — used only when K_ROUNDS >= 2.
const REFINE_INSTRUCTION = [
  'Review your analysis above. For each distinct analytical theme in the investment brief,',
  'verify you have a dedicated section with at least one specific quantitative claim (a named figure,',
  'percentage, ratio, or calculation) from the cited data files. Add any missing themes.',
  'Rewrite any section that only gestures at a theme without a specific supporting data point.',
].join(' ')

async function chatComplete(
  baseUrl: string,
  key: string,
  model: string,
  maxTokens: number,
  messages: Array<{ role: string; content: string }>,
  signal: AbortSignal,
): Promise<{ content: string; usage?: { input: number; output: number } }> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages }),
  })
  if (!res.ok) throw new Error(`router ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const j = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const content = j.choices?.[0]?.message?.content ?? ''
  const usage =
    j.usage?.prompt_tokens != null
      ? { input: j.usage.prompt_tokens, output: j.usage.completion_tokens ?? 0 }
      : undefined
  return { content, usage }
}

async function main(): Promise<void> {
  if (process.env.DRYRUN) {
    console.log(
      `DRYRUN: imports OK (improve=${typeof improve}, officialGepa=${typeof officialGepa})`,
    )
    return
  }

  const adapter = createTrataHedgeAdapter()
  await adapter.preflight()

  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const reflectModel = process.env.REFLECT_MODEL ?? 'deepseek-v4-flash'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const reflectBaseUrl = process.env.REFLECT_BASE ?? routerBaseUrl
  const reflectKey = process.env.REFLECT_KEY ?? routerKey
  const trainN = positiveInteger('TRAIN_N', 70)
  const selectionN = positiveInteger('SELECTION_N', 16)
  const testN = positiveInteger('TEST_N', 16)
  const kRounds = positiveInteger('K_ROUNDS', 1)
  const maxEvaluations = positiveInteger('MAX_EVALUATIONS', 12)
  const maxProposerCostUsd = positiveNumber('MAX_PROPOSER_COST_USD', 5)
  const maxConcurrency = positiveInteger('CONCURRENCY', 8)
  const reps = positiveInteger('REPS', 1)
  const workerMaxTokens = positiveInteger('MAX_TOKENS', 4096)
  const reflectMaxTokens = positiveInteger('REFLECT_MAX_TOKENS', 8192)
  const corpusPath = process.env.CORPUS
  const baselineSurface = process.env.BASELINE_DIRECTIVE ?? DEFAULT_TRATA_SYSTEM
  const runDir = process.env.RUN_DIR ?? '.runs/trata-official-gepa'
  const evaluationId = [
    'trata-hedge-prompt',
    `worker=${model}`,
    `workerEndpoint=${new URL(routerBaseUrl).origin}`,
    `judge=${process.env.JUDGE_MODEL ?? 'adapter-default'}`,
    `rounds=${kRounds}`,
    `tokens=${workerMaxTokens}`,
  ].join('|')
  const workerPricing = requiredTokenPricing(process.env, 'WORKER')
  const optimizer = officialOptimizerModel({
    env: process.env,
    model: reflectModel,
    baseUrl: reflectBaseUrl,
    apiKey: reflectKey,
    maxCostUsd: maxProposerCostUsd,
    maxOutputTokensPerRequest: reflectMaxTokens,
  })

  // Hash-shuffle by task id so all three partitions carry the same difficulty mix.
  const requestedTasks = trainN + selectionN + testN
  const tasks = await adapter.loadTasks({ limit: requestedTasks })
  if (tasks.length !== requestedTasks) {
    throw new Error(
      `Trata returned ${tasks.length} tasks; ${requestedTasks} are required for exact train/selection/test partitions`,
    )
  }
  const idHash = (s: string): number => {
    let h = 2166136261
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  tasks.sort((a, b) => idHash(a.id) - idHash(b.id) || a.id.localeCompare(b.id))
  const train = tasks.slice(0, trainN)
  const selection = tasks.slice(trainN, trainN + selectionN)
  const test = tasks.slice(trainN + selectionN)
  const toScenario = (t: BenchTask): TrataScenario => ({ id: t.id, kind: 'trata-hedge', task: t })

  console.log(
    `[trata-gepa] worker=${model} reflect=${reflectModel} rounds=${kRounds} train=${train.length} selection=${selection.length} test=${test.length}`,
  )

  // Run the financial analyst worker under the candidate surface.
  // For K_ROUNDS=2, a second round asks the model to review its own coverage.
  // Every provider call reports its returned usage through the campaign ledger.
  const runPaidCompletion = async (
    ctx: DispatchContext,
    actor: string,
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ content: string; usage?: { input: number; output: number } }> => {
    const paid = await ctx.cost.runPaidCall({
      actor,
      model,
      execute: (signal) =>
        chatComplete(routerBaseUrl, routerKey, model, workerMaxTokens, messages, signal),
      receipt: (result) => ({
        model,
        inputTokens: result.usage?.input ?? 0,
        outputTokens: result.usage?.output ?? 0,
        customTokenPricing: workerPricing,
        ...(result.usage ? {} : { usageUnknown: true }),
      }),
    })
    if (!paid.succeeded) throw paid.error
    return paid.value
  }

  const runWithSurface = async (
    surface: MutableSurface,
    scenario: TrataScenario,
    ctx: DispatchContext,
  ): Promise<string> => {
    if (typeof surface !== 'string') {
      throw new Error('Trata prompt optimization requires a text surface')
    }
    // Round 1: initial analysis under the candidate system prompt.
    const r1 = await runPaidCompletion(ctx, 'trata-worker-round-1', [
      { role: 'system', content: surface },
      { role: 'user', content: scenario.task.prompt },
    ])
    let answer = r1.content

    // Round 2 (optional): self-critique for rubric coverage.
    if (kRounds >= 2 && answer.trim()) {
      const r2 = await runPaidCompletion(ctx, 'trata-worker-round-2', [
        { role: 'system', content: surface },
        { role: 'user', content: scenario.task.prompt },
        { role: 'assistant', content: answer },
        { role: 'user', content: REFINE_INSTRUCTION },
      ])
      if (r2.content.trim()) answer = r2.content
    }

    if (corpusPath) {
      appendFileSync(
        corpusPath,
        JSON.stringify({ benchmark: 'trata-gepa', instanceId: scenario.task.id, model, answer: answer.slice(0, 500) }) +
          '\n',
      )
    }
    return answer
  }

  // Judge: wraps the Trata 3-stage judge. Returns partial-credit score (0/0.25/0.5/0.75/1.0).
  const judge: JudgeConfig<string, TrataScenario> = {
    name: 'trata-hedge-judge',
    dimensions: [
      { key: 'score', description: 'rubric theme coverage fraction (rawScore/4)' },
      { key: 'resolved', description: 'all themes hit + synthesis (rawScore=4)' },
    ],
    async score({ artifact, scenario }): Promise<JudgeScore> {
      if (!artifact.trim()) {
        return { dimensions: { score: 0, resolved: 0 }, composite: 0, notes: 'empty artifact' }
      }
      const verdict = await adapter.judge(scenario.task, artifact)
      const sc = typeof verdict.score === 'number' ? verdict.score : verdict.resolved ? 1 : 0
      return {
        dimensions: { score: sc, resolved: verdict.resolved ? 1 : 0 },
        composite: sc,
        notes: verdict.detail ?? '',
      }
    },
  }

  const profile: AgentProfile = {
    name: 'trata-financial-analyst',
    prompt: { systemPrompt: baselineSurface },
  }
  const result = await improve(profile, {
    surface: 'prompt',
    method: officialGepa<TrataScenario, string>({
      objective:
        'Improve the complete system instruction for a financial analyst that writes evidence-backed investment memos.',
      evaluationId,
      background:
        'The judge awards partial credit for covering every requested analytical theme with specific quantitative claims, named peer comparisons, explicit calculations, source citations, and a decisive synthesis. Preserve the required ANALYSIS: prefix.',
      recipe: {
        kind: 'engine',
        run: {
          engine: 'gepa',
          maxEvaluations,
          maxProposerCostUsd,
        },
      },
      optimizer,
      resume: 'if-compatible',
      trustResumeState: true,
      describeScenario: (scenario) => ({
        id: scenario.id,
        prompt: scenario.task.prompt,
      }),
      describeArtifact: (artifact) => ({ answer: artifact.slice(-4000) }),
    }),
    trainScenarios: train.map(toScenario),
    selectionScenarios: selection.map(toScenario),
    testScenarios: test.map(toScenario),
    judges: [judge],
    agent: runWithSurface,
    expectUsage: 'warn',
    maxConcurrency,
    reps,
    runDir,
    optimizationRunOptions: {
      expectUsage: 'warn',
      maxConcurrency,
      reps,
    },
  })

  assertCompleteCost('Trata official GEPA run', result.cost)
  console.log('\n=== trata-gepa RESULT ===')
  const improved = result.decision === 'ship'
  console.log(`  baseline test mean: ${(result.raw.best.baselineComposite * 100).toFixed(1)}%`)
  console.log(`  winner test mean:   ${(result.raw.best.winnerComposite * 100).toFixed(1)}%`)
  console.log(`  test delta:         ${(result.lift * 100).toFixed(1)} pp`)
  console.log(
    `  95% interval:      [${(result.liftInterval.low * 100).toFixed(1)}, ${(result.liftInterval.high * 100).toFixed(1)}] pp`,
  )
  console.log(`  decision:           ${result.decision}`)
  console.log(`  cost:               ${JSON.stringify(result.cost)}`)

  const winnerSurface = String(result.candidate.value)
  if (improved) {
    console.log(`\n  PROMOTED SYSTEM PROMPT:\n${winnerSurface}`)
  } else {
    console.log('  kept baseline (the final-test interval did not clear zero)')
    console.log(`\n  BEST CANDIDATE SURFACE (set as BASELINE_DIRECTIVE to seed next run):\n${winnerSurface}`)
  }
  try {
    writeFileSync('/tmp/trata-gepa-winner-surface.txt', winnerSurface)
    console.log('\n  (winner surface written to /tmp/trata-gepa-winner-surface.txt)')
  } catch { /* non-fatal */ }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
