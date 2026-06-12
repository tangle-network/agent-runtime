/**
 * trata-gepa — selfImprove (GEPA) outer loop for Trata hedge-bench.
 *
 * The optimization surface is the system prompt given to the financial analyst
 * worker. GEPA reflects on which rubric themes were missed across training tasks
 * and proposes improved system prompts — learning to instruct the model to
 * extract specific quantitative claims, cover multiple analytical themes, and
 * cite named evidence. Gated on a frozen holdout.
 *
 * The surface evolves beyond a bare system instruction: GEPA naturally discovers
 * that it can add few-shot analytical patterns, calculation templates, and
 * structured coverage checklists — effectively skill-creating without
 * hand-engineering. Set K_ROUNDS=2 to add a self-critique refine pass.
 *
 * Usage:
 *   TRATA_BENCH_ROOT=/tmp/trata-hedge-bench \
 *   JUDGE_MODEL=gemini-2.5-flash WORKER_MODEL=deepseek-v4-flash \
 *   REFLECT_MODEL=gemini-2.5-pro \
 *   TRAIN_N=70 HOLDOUT_N=32 GENS=2 POP=3 CONCURRENCY=8 \
 *   dotenvx run -f ~/company/devops/secrets/agent-state.env -- \
 *     pnpm exec tsx bench/src/trata-gepa.mts
 *
 * Key env vars:
 *   TRATA_BENCH_ROOT   cloned trata-hedge-bench (default /tmp/trata-hedge-bench)
 *   WORKER_MODEL       analyst model (default deepseek-v4-flash)
 *   JUDGE_MODEL        judge model in trata adapter (default gemini-2.5-flash)
 *   REFLECT_MODEL      GEPA reflection model (default gemini-2.5-pro)
 *   TRAIN_N            training tasks (default 70)
 *   HOLDOUT_N          frozen holdout tasks (default 32)
 *   GENS               optimization generations (default 2)
 *   POP                candidates per generation (default 3)
 *   REPS               reps per scenario (default 1)
 *   CONCURRENCY        parallel worker slots (default 8)
 *   K_ROUNDS           1=single-shot, 2=analysis+self-critique (default 1)
 *   BASELINE_DIRECTIVE override the starting system prompt
 *   CORPUS             path to write JSONL run records (optional)
 */

import { selfImprove } from '@tangle-network/agent-eval/contract'
import type { CampaignResult, JudgeConfig, JudgeScore, Scenario } from '@tangle-network/agent-eval/campaign'
import { heldoutSignificance, inMemoryCampaignStorage, pairHoldout } from '@tangle-network/agent-eval/campaign'
import { appendFileSync } from 'node:fs'
import { createTrataHedgeAdapter } from './benchmarks/trata-hedge'
import type { BenchTask } from './benchmarks/types'

interface TrataScenario extends Scenario {
  task: BenchTask
}

interface DiagnosedFinding {
  claim: string
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info'
  area?: string
  recommended_action?: string
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

// The baseline surface — a minimal but complete analyst instruction.
// GEPA will learn what to add: specific extraction patterns for quantitative
// targets, rubric coverage structures, peer comparison frameworks, IRR
// calculation templates, and worked-example fragments.
const DEFAULT_TRATA_SYSTEM = [
  'You are a senior financial analyst producing a structured investment memo.',
  'Begin your response with exactly "ANALYSIS:" on its own line (nothing before it), then write your full analysis.',
  'Every factual claim must cite the filename (e.g., "per earnings_call/apo_q4_2025_earnings_call.txt").',
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
  messages: Array<{ role: string; content: string }>,
): Promise<{ content: string; usage?: { input: number; output: number } }> {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(180_000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, temperature: 0, max_tokens: 4096, messages }),
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

function parseFindings(content: string): DiagnosedFinding[] {
  const start = content.indexOf('[')
  const end = content.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  let arr: unknown
  try {
    arr = JSON.parse(content.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const sev = new Set(['critical', 'high', 'medium', 'low', 'info'])
  return arr
    .filter(
      (x): x is Record<string, unknown> =>
        typeof x === 'object' && x !== null && typeof (x as { claim?: unknown }).claim === 'string',
    )
    .map((x) => ({
      claim: String(x.claim),
      severity: (sev.has(String(x.severity)) ? String(x.severity) : 'medium') as DiagnosedFinding['severity'],
      area: x.area !== undefined ? String(x.area) : 'failure-mode',
      recommended_action: x.recommended_action !== undefined ? String(x.recommended_action) : undefined,
    }))
}

async function main(): Promise<void> {
  const adapter = createTrataHedgeAdapter()
  await adapter.preflight()

  const model = process.env.WORKER_MODEL ?? 'deepseek-v4-flash'
  const reflectModel = process.env.REFLECT_MODEL ?? 'gemini-2.5-pro'
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('TANGLE_API_KEY')
  const trainN = Number(process.env.TRAIN_N ?? 70)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 32)
  const kRounds = Number(process.env.K_ROUNDS ?? 1)
  const corpusPath = process.env.CORPUS
  const baselineSurface = process.env.BASELINE_DIRECTIVE ?? DEFAULT_TRATA_SYSTEM

  // Load all tasks and split deterministically.
  // Hash-shuffle by task id so both splits carry the same difficulty mix.
  const tasks = await adapter.loadTasks({})
  const idHash = (s: string): number => {
    let h = 2166136261
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return h >>> 0
  }
  tasks.sort((a, b) => idHash(a.id) - idHash(b.id))
  const train = tasks.slice(0, Math.min(trainN, tasks.length))
  const holdout = tasks.slice(train.length, train.length + Math.min(holdoutN, tasks.length - train.length))
  const toScenario = (t: BenchTask): TrataScenario => ({ id: t.id, kind: 'trata-hedge', task: t })

  console.log(
    `[trata-gepa] worker=${model} reflect=${reflectModel} rounds=${kRounds} train=${train.length} holdout=${holdout.length}`,
  )

  // Domain seam: run the financial analyst worker under the candidate surface.
  // For K_ROUNDS=2, a second round asks the model to review its own coverage.
  // Reports real token usage to ctx.cost (never fabricated).
  const runWithSurface = async (
    surface: string,
    scenario: TrataScenario,
    ctx: {
      cost: {
        observe(usd: number, source: string): void
        observeTokens(u: { input: number; output: number }): void
      }
    },
  ): Promise<string> => {
    // Round 1: initial analysis under the candidate system prompt.
    const r1 = await chatComplete(routerBaseUrl, routerKey, model, [
      { role: 'system', content: surface },
      { role: 'user', content: scenario.task.prompt },
    ])
    if (r1.usage) ctx.cost.observeTokens(r1.usage)
    let answer = r1.content

    // Round 2 (optional): self-critique for rubric coverage.
    if (kRounds >= 2 && answer.trim()) {
      const r2 = await chatComplete(routerBaseUrl, routerKey, model, [
        { role: 'system', content: surface },
        { role: 'user', content: scenario.task.prompt },
        { role: 'assistant', content: answer },
        { role: 'user', content: REFINE_INSTRUCTION },
      ])
      if (r2.usage) ctx.cost.observeTokens(r2.usage)
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

  // EYES→HANDS: diagnose FAILED runs using themesMissed from judge detail.
  // Trata's judge returns structured per-theme failure data — richer than the
  // generic "wrong answer" signal that other benches feed into this hook.
  const taskById = new Map(tasks.map((t) => [t.id, t]))
  const analyzeGeneration = async (input: {
    generation: number
    runDir: string
    candidates: Array<{
      surfaceHash: string
      campaign: CampaignResult<string, TrataScenario>
      composite: number
    }>
    history: unknown[]
  }): Promise<DiagnosedFinding[]> => {
    interface FailureItem { themesMissed: string[]; themesHit: string[]; answer: string }
    const failures = new Map<string, FailureItem>()
    let totalCells = 0; let skippedError = 0; let skippedResolved = 0
    for (const cand of input.candidates) {
      for (const cell of cand.campaign.cells) {
        totalCells++
        if (cell.error) { skippedError++; continue }
        const js = cell.judgeScores?.[judge.name]
        if (!js) continue
        if (js.composite >= 1) { skippedResolved++; continue }
        if (failures.has(cell.scenarioId)) continue
        let themesMissed: string[] = []
        let themesHit: string[] = []
        try {
          const d = JSON.parse(js.notes ?? '{}') as { themesMissed?: string[]; themesHit?: string[] }
          themesMissed = d.themesMissed ?? []
          themesHit = d.themesHit ?? []
        } catch { /* no structured detail */ }
        failures.set(cell.scenarioId, {
          themesMissed,
          themesHit,
          answer: (typeof cell.artifact === 'string' ? cell.artifact : '').slice(-1500),
        })
      }
    }
    console.log(`[trata-gepa] gen ${input.generation}: cells=${totalCells} err=${skippedError} resolved=${skippedResolved} failures=${failures.size}`)
    const items = [...failures.values()].slice(0, 8)
    if (items.length === 0) return []
    const user = items
      .map(
        (f, i) =>
          `### Failure ${i + 1}\n` +
          (f.themesMissed.length > 0 ? `THEMES MISSED: ${f.themesMissed.join(' | ')}\n` : '') +
          (f.themesHit.length > 0 ? `THEMES HIT: ${f.themesHit.join(' | ')}\n` : '') +
          `AGENT ANSWER (tail):\n${f.answer}`,
      )
      .join('\n\n---\n\n')
    const system =
      'You are a failure analyst for a financial analyst agent. The agent produces investment memos ' +
      'scored by a rubric with 4-6 analytical themes, each requiring specific quantitative claims. ' +
      'Below are FAILED runs showing which themes were missed and the agent\'s answer. ' +
      'Identify the COMMON failure patterns — e.g., generic statements without specific figures, ' +
      'missing peer comparisons, no explicit calculations, ignoring certain data file types. ' +
      'For each finding, recommend a CONCRETE change to the system instruction that would fix it. ' +
      'Return ONLY a JSON array (no prose): [{"claim","severity":"high"|"medium"|"low","area","recommended_action"}]. Max 6.'
    let content: string | undefined
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      try {
        const r = await chatComplete(routerBaseUrl, routerKey, reflectModel, [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ])
        content = r.content
        break
      } catch (err) {
        const msg = (err as Error).message
        if (attempt === 4) {
          console.error(`[trata-gepa] analyzeGeneration failed gen ${input.generation}: ${msg}`)
          return []
        }
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)))
      }
    }
    if (!content) return []
    const findings = parseFindings(content)
    console.log(`[trata-gepa] gen ${input.generation}: ${items.length} failures → ${findings.length} findings`)
    return findings
  }

  const result = await selfImprove<TrataScenario, string>({
    agent: (surface, scenario, ctx) => runWithSurface(surface as string, scenario, ctx),
    scenarios: train.map(toScenario),
    judge,
    baselineSurface,
    budget: {
      generations: Number(process.env.GENS ?? 2),
      populationSize: Number(process.env.POP ?? 3),
      maxConcurrency: Number(process.env.CONCURRENCY ?? 8),
      reps: Number(process.env.REPS ?? 1),
      promoteTopK: Number(process.env.TOPK ?? 1),
      holdoutScenarios: holdout.map(toScenario),
    },
    llm: {
      baseUrl: routerBaseUrl,
      apiKey: routerKey,
      model: reflectModel,
    },
    driverTarget:
      'a FINANCIAL ANALYST SYSTEM INSTRUCTION: the directive given to an agent that produces an investment memo from embedded earnings call transcripts, SEC filings, financial statements, and investor presentations. ' +
      'The memo is scored by a rubric with 4-6 analytical themes, each requiring 2-4 specific analytical moves (quantitative claims, strategic conclusions, peer comparisons, or explicit calculations). ' +
      'A theme is "hit" only when the agent makes the SPECIFIC move — not just gestures at the theme. ' +
      'The directive must make the agent: (1) extract and cite specific numerical targets from management guidance, ' +
      '(2) compute implied returns/IRRs when comparing capital allocation options, ' +
      '(3) cover every distinct analytical theme with a dedicated paragraph, ' +
      '(4) benchmark against named peers with specific metrics. The "ANALYSIS:" sentinel must start the response.',
    mutationPrimitives: [
      'instruct the agent to identify and verbatim-cite specific numerical targets in management guidance (earnings per share targets, margin percentages, growth rates, AUM figures) rather than paraphrasing in approximate terms',
      'instruct the agent to explicitly compute implied returns or IRRs when evaluating capital allocation trade-offs — show the arithmetic using the price levels and targets from the source data',
      'instruct the agent to structure the analysis with a clearly-labeled section for each distinct analytical theme (valuation, capital allocation, competitive dynamics, risk factors, etc.) so no major investment consideration is merged or omitted',
      'instruct the agent to compare the company against its NAMED sector peers with specific metrics (EV/EBITDA, P/E, margin differential, growth premium) cited from the peer financials files in the data',
    ],
    runDir: 'improve-prompt-trata-hedge',
    storage: inMemoryCampaignStorage(),
    autoOnPromote: 'none',
    analyzeGeneration,
  })

  console.log('\n=== trata-gepa RESULT ===')
  const improved = result.gateDecision === 'ship'
  console.log(`  baseline held-out mean: ${(result.baseline.compositeMean * 100).toFixed(1)}%`)
  console.log(`  winner   held-out mean: ${(result.winner.compositeMean * 100).toFixed(1)}%`)
  console.log(`  ► held-out delta:       ${(result.lift * 100).toFixed(1)} pp`)
  console.log(`  gate decision:          ${result.gateDecision}`)

  try {
    const cellsToMap = (cells: ReadonlyArray<{ scenarioId: string; judgeScores: Record<string, JudgeScore> }>) => {
      const m = new Map<string, Record<string, JudgeScore>>()
      for (const c of cells) m.set(c.scenarioId, c.judgeScores)
      return m
    }
    const baseMap = cellsToMap(result.raw.baselineOnHoldout.cells)
    const winMap = cellsToMap(result.raw.winnerOnHoldout.cells)
    const ids = new Set([...baseMap.keys()].filter((id) => winMap.has(id)))
    const paired = pairHoldout(winMap, baseMap, ids, (s) => s.composite)
    const sig = heldoutSignificance(paired)
    console.log(
      `  ► 95% CI (n=${sig.n}): [${(sig.bootstrap.low * 100).toFixed(1)}, ${(sig.bootstrap.high * 100).toFixed(1)}] pp · median ${(sig.bootstrap.median * 100).toFixed(1)}pp · significant=${sig.significant}`,
    )
    if (!sig.significant)
      console.log('    (CI spans 0 — scale n or generations before promoting)')
  } catch (err) {
    console.log(`  (significance unavailable: ${(err instanceof Error ? err.message : String(err)).slice(0, 80)})`)
  }

  if (improved) {
    console.log(`\n  LEARNED SYSTEM PROMPT:\n${result.winner.surface as string}`)
    if (result.winner.rationale) console.log(`\n  rationale: ${result.winner.rationale}`)
  } else {
    console.log('  kept baseline (gate did not ship a winner)')
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : String(err))
  process.exit(1)
})
