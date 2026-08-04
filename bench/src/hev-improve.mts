/**
 * Official GEPA prompt optimization on HumanEval. The worker is a single chat
 * completion and the judge is the deterministic Docker checker.
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
import {
  improve,
  officialGepa,
  type ReadonlyAgentProfile,
} from '@tangle-network/agent-runtime'
import {
  canonicalCandidateDigest,
  type AgentProfile,
} from '@tangle-network/agent-interface'
import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { extractCode, loadHumanEval, runChecker, type HumanEvalTask } from './benchmarks/humaneval'
import {
  assertCompleteCost,
  officialOptimizerModel,
  requiredTokenPricing,
} from './official-optimizer-config.mjs'
import { runBenchRouterTurn, withBenchProfile } from './router-turn'

// The SEED instruction GEPA evolves. Byte-identical to humaneval.ts basePrompt's
// solveInstruction so the baseline arm reproduces the plain-prompt denominator.
const SEED_INSTRUCTION =
  'Complete the following Python function. Output the COMPLETE function definition (signature, docstring optional, body) inside a single ```python code block. Include any imports the function needs. Do not write tests or example calls.'

interface Completion {
  text: string
  tokIn: number
  tokOut: number
}

async function complete(
  base: string,
  key: string,
  profile: AgentProfile,
  prompt: string,
  maxTokens: number,
): Promise<Completion> {
  const result = await runBenchRouterTurn(
    {
      routerBaseUrl: base,
      routerKey: key,
      profile: withBenchProfile(profile, { temperature: 0.2, maxTokens }),
    },
    prompt,
  )
  return {
    text: result.finalText,
    tokIn: result.usage.input,
    tokOut: result.usage.output,
  }
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
  const selectionN = Number(process.env.SELECTION_N ?? 12)
  const testN = Number(process.env.TEST_N ?? 12)
  const offset = Number(process.env.OFFSET ?? 80)
  const maxEvaluations = Number(process.env.MAX_EVALUATIONS ?? 24)
  const maxProposerCostUsd = Number(process.env.MAX_PROPOSER_COST_USD ?? 5)
  const workerMaxTokens = Number(process.env.MAX_TOKENS ?? 6000)
  const reflectMaxTokens = Number(process.env.REFLECT_MAX_TOKENS ?? 8000)
  const maxConcurrency = Number(process.env.MAX_CONCURRENCY ?? 4)
  const runDir = process.env.RUN_DIR ?? '.runs/humaneval-official-gepa'
  if (process.env.DRYRUN) {
    console.log(
      `DRYRUN: imports OK (improve=${typeof improve}, officialGepa=${typeof officialGepa})`,
    )
    return
  }
  const workerPricing = requiredTokenPricing(process.env, 'WORKER')
  const optimizer = officialOptimizerModel({
    env: process.env,
    model: reflectModel,
    baseUrl: reflectBase,
    apiKey: reflectKey,
    maxCostUsd: maxProposerCostUsd,
    maxOutputTokensPerRequest: reflectMaxTokens,
  })

  // All three partitions are disjoint slices of the harder middle band.
  const train = await loadHumanEval(trainN, offset)
  const selection = await loadHumanEval(selectionN, offset + trainN)
  const testCases = await loadHumanEval(testN, offset + trainN + selectionN)
  const byId = new Map<string, HumanEvalTask>(
    [...train, ...selection, ...testCases].map((t) => [t.taskId, t]),
  )

  console.log('=== HumanEval prompt optimization with official GEPA ===')
  console.log(`worker=${workerModel} reflect=${reflectModel} base=${base}`)
  console.log(`train=[${train.map((t) => t.taskId).join(', ')}]`)
  console.log(`selection=[${selection.map((t) => t.taskId).join(', ')}]`)
  console.log(`test=[${testCases.map((t) => t.taskId).join(', ')}]`)
  console.log(`maxEvaluations=${maxEvaluations} maxProposerCostUsd=${maxProposerCostUsd} offset=${offset} maxTokens=${workerMaxTokens}`)
  console.log(`runDir=${runDir}\n`)

  const stats = { n: 0 }
  const agent = async (candidate: ReadonlyAgentProfile, scenario: Scenario, ctx: DispatchContext): Promise<string | null> => {
    const instr = candidate.prompt?.systemPrompt
    if (instr === undefined) throw new Error('agent: candidate profile has no system prompt')
    const t = byId.get(scenario.id)
    if (!t) throw new Error(`agent: unknown scenario ${scenario.id}`)
    const prompt = `\`\`\`python\n${t.prompt}\`\`\``
    const executionProfile: AgentProfile = {
      ...candidate,
      name: candidate.name ?? 'humaneval-improvement-worker',
      model: { ...candidate.model, provider: 'tangle-router', default: workerModel },
    }
    const t0 = Date.now()
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'humaneval-worker',
      model: workerModel,
      execute: () => complete(base, key, executionProfile, prompt, workerMaxTokens),
      receipt: (result) => {
        const usageUnknown = result.tokIn === 0 && result.tokOut === 0
        return {
          model: workerModel,
          inputTokens: result.tokIn,
          outputTokens: result.tokOut,
          customTokenPricing: workerPricing,
          ...(usageUnknown ? { usageUnknown: true } : {}),
        }
      },
    })
    if (!paid.succeeded) throw paid.error
    const r = paid.value
    const hasText = r.text.trim().length > 0
    stats.n += 1
    const codeLen = extractCode(r.text).length
    console.log(`  [agent] ${scenario.id} instr=${instr.length}c code=${codeLen}b tok=in:${r.tokIn}/out:${r.tokOut} ${Math.round((Date.now() - t0) / 1000)}s`)
    return hasText ? r.text : null
  }

  const judge: JudgeConfig<string | null, Scenario> = {
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
  const scenario = (task: HumanEvalTask): Scenario => ({ id: task.taskId, kind: 'humaneval' })

  const out = await improve(profile, {
    surface: 'prompt',
    executionRef: canonicalCandidateDigest({
      callback: 'bench/hev-improve',
      model: workerModel,
      endpoint: new URL(base).origin,
      maxTokens: workerMaxTokens,
      checker: 'local-python',
    }),
    method: officialGepa<Scenario, string | null>({
      objective:
        'Improve the complete instruction for a small model that writes Python functions which pass hidden unit tests.',
      background:
        'Prefer behavioral strategies over wording changes. Address algorithm choice, edge cases, boundary values, type behavior, and self-checking. Return only the complete instruction.',
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
      describeScenario: (item) => ({ prompt: byId.get(item.id)?.prompt ?? item.id }),
    }),
    trainScenarios: train.map(scenario),
    selectionScenarios: selection.map(scenario),
    testScenarios: testCases.map(scenario),
    judges: [judge],
    agent,
    expectUsage: 'warn',
    maxConcurrency,
    reps: 1,
    runDir,
    optimizationRunOptions: {
      expectUsage: 'warn',
      maxConcurrency,
      reps: 1,
    },
  })

  assertCompleteCost('humaneval official GEPA run', out.cost)
  console.log('\n=== RESULT ===')
  console.log(`decision=${out.decision} lift=${out.lift} interval=[${out.liftInterval.low}, ${out.liftInterval.high}]`)
  console.log(`baseline test pass-rate=${out.raw.best.baselineComposite}`)
  console.log(`winner test pass-rate=${out.raw.best.winnerComposite}`)
  console.log(`test scenarios=${JSON.stringify(out.raw.best.scenarioScores)}`)
  console.log(`cost=${JSON.stringify(out.cost)}`)
  console.log(`winner instruction:\n${String(out.candidate.value).slice(0, 2000)}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? (e.stack ?? e.message) : String(e))
  process.exit(1)
})
