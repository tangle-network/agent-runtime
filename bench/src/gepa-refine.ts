/**
 * GEPA-optimize the refine DIRECTIVE — the first real-surface use of agent-runtime's
 * `optimizePrompt` (agent-eval 0.76 gepaDriver + heldOutGate + runImprovementLoop).
 *
 * We proved evidence-gated refinement beats blind (FinSearchComp +20pp) with a
 * HAND-WRITTEN refine directive. This stops hand-tuning it: GEPA reflects on
 * per-scenario scores, proposes directive rewrites, and the held-out gate ships a
 * learned directive ONLY if it beats the hand-written baseline on a disjoint split.
 *
 * The directive is the surface; `runWithPrompt` runs the refine worker with the
 * candidate directive over k rounds → final answer; the judge is the benchmark's
 * own judge (deterministic for HotpotQA, per-record LLM for FinSearchComp). Identity-
 * gated: the baseline is never regressed — a directive ships only on a held-out lift.
 *
 *   BENCH=hotpotqa RESEARCH=1   → local research worker (cheap; plumbing smoke)
 *   BENCH=finsearchcomp SANDBOX=1 → prod-sandbox web-search worker (the real run)
 */

import { optimizePrompt } from '@tangle-network/agent-runtime/improvement'
import type { JudgeConfig, Scenario } from '@tangle-network/agent-eval/campaign'
import { inMemoryCampaignStorage } from '@tangle-network/agent-eval/campaign'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { DEFAULT_RESEARCH_REFINE_DIRECTIVE, solveRefineResearchLocal } from './worker-research'
import { DEFAULT_SANDBOX_REFINE_DIRECTIVE, solveSandboxResearch } from './worker-sandbox-research'

interface RefineScenario extends Scenario {
  task: BenchTask
}

function must(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`env ${name} is required`)
  return v
}

const ADAPTERS: Record<string, () => BenchmarkAdapter> = {
  hotpotqa: createHotpotqaAdapter,
  finsearchcomp: createFinsearchcompAdapter,
}

async function main() {
  const benchKey = process.env.BENCH ?? 'hotpotqa'
  const adapter = ADAPTERS[benchKey]?.()
  if (!adapter) throw new Error(`gepa-refine supports BENCH=hotpotqa|finsearchcomp, got ${benchKey}`)
  const useSandbox = process.env.SANDBOX === '1'
  const model = process.env.WORKER_MODEL ?? (useSandbox ? 'gpt-5' : 'deepseek/deepseek-v4-pro')
  const rounds = Number(process.env.K_ROUNDS ?? 3)
  const trainN = Number(process.env.TRAIN_N ?? 8)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 8)
  const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('ROUTER_KEY')
  const baseDirective = useSandbox ? DEFAULT_SANDBOX_REFINE_DIRECTIVE : DEFAULT_RESEARCH_REFINE_DIRECTIVE

  await adapter.preflight()
  const tasks = await adapter.loadTasks({ limit: trainN + holdoutN })
  if (tasks.length < trainN + holdoutN) {
    console.warn(`[gepa-refine] only ${tasks.length} tasks available; shrinking split`)
  }
  const half = Math.floor(tasks.length / 2)
  const train = tasks.slice(0, Math.min(trainN, half))
  const holdout = tasks.slice(half, half + Math.min(holdoutN, tasks.length - half))
  const toScenario = (t: BenchTask): RefineScenario => ({ id: t.id, kind: benchKey, task: t })

  console.log(
    `[gepa-refine] ${benchKey} · worker=${useSandbox ? 'sandbox' : 'local'} model=${model} · train=${train.length} holdout=${holdout.length} · rounds=${rounds}`,
  )

  // Domain seam: run the refine worker under the CANDIDATE directive → final answer.
  const runWithPrompt = async (directive: string, scenario: RefineScenario): Promise<string> => {
    if (useSandbox) {
      const s = await solveSandboxResearch(scenario.task, {
        sandboxBaseUrl: process.env.SANDBOX_BASE_URL ?? 'https://sandbox.tangle.tools',
        sandboxKey: must('SANDBOX_KEY'),
        routerBaseUrl,
        routerKey,
        model,
        provider: process.env.WORKER_PROVIDER ?? 'openai',
        rounds,
        perRoundMs: livenessMs,
        refineDirective: directive,
      })
      return s.finalAnswer
    }
    const s = await solveRefineResearchLocal(scenario.task, { model, rounds, livenessMs, refineDirective: directive })
    return s.finalAnswer
  }

  // The benchmark's own judge → 0/1 composite. Throw on failure (never silent zero).
  const judge: JudgeConfig<string, RefineScenario> = {
    name: `${benchKey}-judge`,
    dimensions: [{ key: 'resolved', description: 'benchmark judge marks the answer resolved' }],
    async score({ artifact, scenario }) {
      if (!artifact.trim()) return { dimensions: { resolved: 0 }, composite: 0, notes: 'empty answer' }
      const verdict = await adapter.judge(scenario.task, artifact)
      const v = verdict.resolved ? 1 : 0
      return { dimensions: { resolved: v }, composite: v }
    },
  }

  const result = await optimizePrompt<RefineScenario, string>({
    baselinePrompt: baseDirective,
    runWithPrompt,
    scenarios: train.map(toScenario),
    holdoutScenarios: holdout.map(toScenario),
    judges: [judge],
    runDir: `gepa-refine-${benchKey}`,
    storage: inMemoryCampaignStorage(),
    reflection: {
      llm: { baseUrl: routerBaseUrl, apiKey: routerKey },
      model: process.env.REFLECT_MODEL ?? 'gpt-5',
      target:
        'a REFINE DIRECTIVE: the instruction given to an agent to re-examine its own prior answer and improve it. It must make the agent KEEP a correct answer and fix only concrete errors — never churn a right answer.',
      mutationPrimitives: [
        'demand explicit re-verification of the figure/fact against a cited source before asserting it',
        'require checking the answer against the exact units/precision/tolerance the question requests',
        'instruct the agent to keep a correct answer verbatim and change ONLY on a concrete identified error',
      ],
    },
    deltaThreshold: Number(process.env.DELTA_THRESHOLD ?? 0.05),
    populationSize: Number(process.env.POP ?? 3),
    maxGenerations: Number(process.env.GENS ?? 2),
    promoteTopK: Number(process.env.TOPK ?? 1),
    reps: Number(process.env.REPS ?? 1),
    maxConcurrency: Number(process.env.CONCURRENCY ?? 2),
    seed: 42,
    autoOnPromote: 'none',
  })

  console.log(`\n=== GEPA REFINE-DIRECTIVE RESULT (${benchKey}) ===`)
  console.log(`  baseline held-out composite: ${(result.baselineComposite * 100).toFixed(1)}%`)
  console.log(`  winner   held-out composite: ${(result.winnerComposite * 100).toFixed(1)}%`)
  console.log(`  ► held-out delta:            ${(result.delta * 100).toFixed(1)} pp`)
  console.log(`  gate decision: ${result.decision} (improved=${result.improved})`)
  if (result.improved) {
    console.log(`\n  LEARNED DIRECTIVE:\n${result.prompt}`)
    if (result.rationale) console.log(`\n  rationale: ${result.rationale}`)
  } else {
    console.log(`  kept hand-written baseline (gate did not ship a winner)`)
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err))
  process.exit(1)
})
