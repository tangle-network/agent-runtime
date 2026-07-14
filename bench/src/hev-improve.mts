/**
 * SELF-IMPROVEMENT on HumanEval — the prompt-sensitive, VISIBLE-ORACLE counterpart
 * to the SWE-bench run. Same machinery (improve(surface:'prompt') + gepaProposer +
 * held-out gate), but the worker is a single chat completion and the judge is the
 * deterministic Docker checker (run the function against its own hidden unit tests).
 *
 * WHY this exists: on SWE-bench the same GEPA loop was NULL because the grading test
 * is withheld — the worker cannot verify, so prompt wording cannot move resolve.
 * HumanEval hands the worker a well-specified function to complete and grades by
 * running tests, so the instruction prompt DOES move pass-rate. This run measures
 * whether self-improvement lifts a CHEAP model when the task is prompt-sensitive.
 *
 * Worker + reflect models call the zai coding endpoint directly (no tangle router,
 * no WAF, no 503):  TANGLE_API_KEY=$ZAI_API_KEY  ROUTER_BASE=https://api.z.ai/api/coding/paas/v4
 */
import { improve } from '@tangle-network/agent-runtime'
import type { AgentProfile } from '@tangle-network/agent-interface'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { gepaProposer } from '@tangle-network/agent-eval/campaign'
import { extractCode, loadHumanEval, runChecker, type HumanEvalTask } from './benchmarks/humaneval'

// The SEED instruction GEPA evolves. Byte-identical to humaneval.ts basePrompt's
// solveInstruction so the baseline arm reproduces the plain-prompt denominator.
const SEED_INSTRUCTION =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

interface Completion {
  text: string
  usd: number
  tokIn: number
  tokOut: number
}

async function complete(base: string, key: string, model: string, prompt: string, maxTokens: number): Promise<Completion> {
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) throw new Error(`completion HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const d = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  const text = d.choices?.[0]?.message?.content ?? ''
  const tokIn = d.usage?.prompt_tokens ?? 0
  const tokOut = d.usage?.completion_tokens ?? 0
  // zai glm pricing is ~ $0.6/M in, $2.2/M out (coding plan); a rough cost tag so the
  // stub-guard sees a real backend. Exact cost is not the metric (pass-rate is).
  const usd = (tokIn * 0.6 + tokOut * 2.2) / 1_000_000
  return { text, usd, tokIn, tokOut }
}

async function main(): Promise<void> {
  const key = process.env.TANGLE_API_KEY
  if (!key) throw new Error('TANGLE_API_KEY required (worker + reflect completions)')
  const base = process.env.ROUTER_BASE ?? 'https://api.z.ai/api/coding/paas/v4'
  const workerModel = process.env.WORKER_MODEL ?? 'glm-4.5-air'
  const reflectModel = process.env.REFLECT_MODEL ?? 'glm-4.6'
  // The GEPA reflector may live on a DIFFERENT endpoint than the (cheap) worker —
  // e.g. a small worker on Together + a strong optimizer on zai. Defaults to the
  // worker endpoint when unset.
  const reflectBase = process.env.REFLECT_BASE ?? base
  const reflectKey = process.env.REFLECT_KEY ?? key
  const trainN = Number(process.env.TRAIN_N ?? 12)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 12)
  const offset = Number(process.env.OFFSET ?? 80)
  // generations=1 never exercises the GEPA Pareto/combine path (the frontier
  // needs >=1 completed generation before combine can fire) — default to a
  // multi-generation budget so the default run measures the full loop.
  const generations = Number(process.env.GENERATIONS ?? 6)
  const population = Number(process.env.POPULATION ?? 4)
  const workerMaxTokens = Number(process.env.MAX_TOKENS ?? 6000)
  const reflectMaxTokens = Number(process.env.REFLECT_MAX_TOKENS ?? 8000)
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? 4)

  // TRAIN and HOLDOUT are DISJOINT slices of the harder middle band (offset).
  const train = await loadHumanEval(trainN, offset)
  const holdout = await loadHumanEval(holdoutN, offset + trainN)
  const byId = new Map<string, HumanEvalTask>([...train, ...holdout].map((t) => [t.taskId, t]))
  const allIds = [...byId.keys()]

  console.log('═══ HumanEval self-improvement — VISIBLE oracle (deterministic Docker checker) ═══')
  console.log(`worker=${workerModel}  reflect=${reflectModel}  base=${base}`)
  console.log(`train=[${train.map((t) => t.taskId).join(', ')}]`)
  console.log(`holdout=[${holdout.map((t) => t.taskId).join(', ')}]`)
  console.log(`generations=${generations} population=${population} offset=${offset} maxTokens=${workerMaxTokens}`)
  console.log(`≈ ${trainN * (1 + generations * population) + 2 * holdoutN} cells (each = 1 completion + 1 Docker check)\n`)

  const stats = { n: 0 }
  const agent = async (surface: unknown, scenario: Scenario, ctx: DispatchContext): Promise<string | null> => {
    const instr = String(surface)
    const t = byId.get(scenario.id)
    if (!t) throw new Error(`agent: unknown scenario ${scenario.id}`)
    const prompt = `${instr}\n\n\`\`\`python\n${t.prompt}\`\`\``
    const t0 = Date.now()
    const r = await complete(base, key, workerModel, prompt, workerMaxTokens)
    const zeroUsage = r.tokIn === 0 && r.tokOut === 0
    const hasText = r.text.trim().length > 0
    ctx.cost.observe(zeroUsage && hasText ? Math.max(r.usd, 0.0001) : r.usd, workerModel)
    ctx.cost.observeTokens(
      zeroUsage && hasText ? { input: Math.max(r.tokIn, 1), output: Math.max(r.tokOut, 1) } : { input: r.tokIn, output: r.tokOut },
    )
    stats.n += 1
    const codeLen = extractCode(r.text).length
    console.log(`  [agent] ${scenario.id} instr=${instr.length}c code=${codeLen}b tok=in:${r.tokIn}/out:${r.tokOut} ${Math.round((Date.now() - t0) / 1000)}s`)
    return hasText ? r.text : null
  }

  const judge: JudgeConfig<string, Scenario> = {
    name: 'humaneval-docker',
    dimensions: [{ key: 'pass', description: 'the completed function passes its hidden unit tests (deterministic Docker checker)' }],
    async score({ artifact, scenario }) {
      const t = byId.get(scenario.id)
      if (!t) throw new Error(`judge: unknown scenario ${scenario.id}`)
      const code = extractCode(String(artifact ?? ''))
      if (!code.trim()) {
        console.log(`  [judge] ${scenario.id} pass=0 (empty)`)
        return { dimensions: { pass: 0 }, composite: 0, notes: 'empty' }
      }
      const { pass, detail } = await runChecker(t, code)
      console.log(`  [judge] ${scenario.id} pass=${pass}`)
      if (pass === 1) return { dimensions: { pass }, composite: pass, notes: 'passed' }
      // Trajectory-grounded failure note: the checker's traceback/assertion tail
      // plus the model's own emitted code, so GEPA reflection sees WHAT failed and
      // WHAT the model wrote — not just the word 'failed'. The candidate's full
      // raw reply additionally reaches the proposer via the campaign breakdown's
      // `emitted` field (carried automatically from the string artifact).
      const traceback = (detail ?? 'checker produced no output (timeout or silent non-zero exit)').slice(-800)
      const excerpt = code.slice(0, 700)
      return {
        dimensions: { pass },
        composite: pass,
        notes: `${traceback}\n--- emitted code (first 700 chars) ---\n${excerpt}`,
      }
    },
  }

  const profile: AgentProfile = { name: 'hev-solver', prompt: { systemPrompt: SEED_INSTRUCTION } }
  const proposer = gepaProposer({
    llm: { baseUrl: reflectBase, apiKey: reflectKey },
    model: reflectModel,
    target:
      'the instruction/system prompt strategy for a SMALL model completing Python functions to pass hidden unit tests. ' +
      'Propose SUBSTANTIALLY different strategies, not wording tweaks: e.g. require the model to first reason step-by-step ' +
      'about the algorithm and edge cases (empty inputs, off-by-one, boundary values, types) in a brief plan or comments ' +
      'BEFORE writing the code; provide a short worked example; or add an explicit self-check against the docstring. ' +
      'Bold rewrites that change model BEHAVIOR beat cosmetic edits.',
    maxTokens: reflectMaxTokens,
    temperature: 0.7,
  })

  const scenarios: Scenario[] = allIds.map((id) => ({ id, kind: 'humaneval' }))
  const holdoutScenarios: Scenario[] = holdout.map((t) => ({ id: t.taskId, kind: 'humaneval' }))

  const out = await improve(profile, [], {
    surface: 'prompt',
    gate: 'holdout',
    generator: proposer,
    scenarios,
    judge,
    agent,
    expectUsage: 'warn',
    // rawTraceContext stays OFF deliberately: it swaps the distilled findings for
    // filesystem paths + grep/cat instructions (rawTraceDistiller), which only a
    // coding harness can execute. This run's proposer is prompt-tier (gepaProposer
    // — a single LLM call that cannot run grep), so the trace evidence arrives via
    // the judge's traceback notes + the breakdown's `emitted` excerpt instead.
    budget: { generations, populationSize: population, holdoutScenarios, maxConcurrency, reps: 1 },
    llm: { baseUrl: reflectBase, apiKey: reflectKey, model: reflectModel },
  })

  console.log('\n═══ RESULT ═══')
  console.log(`gateDecision=${out.gateDecision}  shipped=${out.shipped}  lift=${out.lift}`)
  console.log(`baseline holdout pass-rate = ${out.raw.baseline.compositeMean}`)
  console.log(`winner   holdout pass-rate = ${out.raw.winner.compositeMean}`)
  console.log(`baseline per-scenario: ${JSON.stringify(out.raw.baseline.perScenario)}`)
  console.log(`winner   per-scenario: ${JSON.stringify(out.raw.winner.perScenario)}`)
  if (out.raw.winner.label) console.log(`winner label   : ${out.raw.winner.label}`)
  if ((out.raw.winner as { surface?: unknown }).surface) {
    console.log(`winner instruction:\n${String((out.raw.winner as { surface?: unknown }).surface).slice(0, 1200)}`)
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
