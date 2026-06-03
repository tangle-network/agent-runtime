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
import type { JudgeConfig, JudgeScore, Scenario } from '@tangle-network/agent-eval/campaign'
import {
  heldoutSignificance,
  inMemoryCampaignStorage,
  pairHoldout,
} from '@tangle-network/agent-eval/campaign'
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { DEFAULT_CAD_DIRECTIVE, solveCadRefineLocal } from './worker-cad'
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
  cad: createCadDesignAdapter,
}

async function main() {
  const benchKey = process.env.BENCH ?? 'hotpotqa'
  const adapter = ADAPTERS[benchKey]?.()
  if (!adapter) throw new Error(`gepa-refine supports BENCH=hotpotqa|finsearchcomp|cad, got ${benchKey}`)
  const isCad = benchKey === 'cad'
  const useSandbox = process.env.SANDBOX === '1'
  const model =
    process.env.WORKER_MODEL ?? (isCad ? 'claude-sonnet-4-6' : useSandbox ? 'gpt-5' : 'deepseek/deepseek-v4-pro')
  const rounds = Number(process.env.K_ROUNDS ?? 3)
  const trainN = Number(process.env.TRAIN_N ?? 8)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 8)
  const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('ROUTER_KEY')
  const baseDirective = isCad
    ? DEFAULT_CAD_DIRECTIVE
    : useSandbox
      ? DEFAULT_SANDBOX_REFINE_DIRECTIVE
      : DEFAULT_RESEARCH_REFINE_DIRECTIVE

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
  // Reports REAL token usage to ctx.cost (sandbox path) so the campaign's
  // backend-integrity guard sees a real backend, not a stub — never fabricated.
  const runWithPrompt = async (
    directive: string,
    scenario: RefineScenario,
    ctx: { cost: { observe(usd: number, source: string): void; observeTokens(u: { input: number; output: number }): void } },
  ): Promise<string> => {
    if (isCad) {
      // The CAD authoring loop: author .scad under the candidate directive,
      // gate+render with the LOCAL openscad kernel (staging-independent), refine
      // k rounds on compiler feedback. The artifact is the produced source.
      const s = await solveCadRefineLocal(scenario.task, { routerBaseUrl, routerKey, model, rounds, directive })
      if (s.usage.input > 0 || s.usage.output > 0) ctx.cost.observeTokens(s.usage)
      return s.artifact
    }
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
      if (s.costUsd > 0) ctx.cost.observe(s.costUsd, 'sandbox-research')
      if (s.usage.input > 0 || s.usage.output > 0) ctx.cost.observeTokens(s.usage)
      return s.finalAnswer
    }
    const s = await solveRefineResearchLocal(scenario.task, { model, rounds, livenessMs, refineDirective: directive })
    return s.finalAnswer
  }

  // The benchmark's own judge → composite. For CAD the geometric gate returns a
  // FRACTION of checks passed — use it directly so the optimizer sees a smooth
  // gradient (0.57 → 1.0), not a flat 0/1. For QA the judge is binary resolved.
  // Throw on failure (never silent zero).
  const judge: JudgeConfig<string, RefineScenario> = {
    name: `${benchKey}-judge`,
    dimensions: isCad
      ? [
          { key: 'score', description: 'fraction of geometric spec checks the produced solid passes' },
          { key: 'resolved', description: 'all geometric checks pass' },
        ]
      : [{ key: 'resolved', description: 'benchmark judge marks the answer resolved' }],
    async score({ artifact, scenario }): Promise<JudgeScore> {
      if (!artifact.trim()) return { dimensions: { resolved: 0 }, composite: 0, notes: 'empty artifact' }
      const verdict = await adapter.judge(scenario.task, artifact)
      if (isCad) {
        const sc = typeof verdict.score === 'number' ? verdict.score : verdict.resolved ? 1 : 0
        const dimensions: Record<string, number> = { score: sc, resolved: verdict.resolved ? 1 : 0 }
        return { dimensions, composite: sc, notes: verdict.detail ?? '' }
      }
      const v = verdict.resolved ? 1 : 0
      return { dimensions: { resolved: v }, composite: v, notes: verdict.detail ?? '' }
    },
  }

  const reflectionTarget = isCad
    ? 'an OpenSCAD AUTHORING DIRECTIVE: the system instruction given to an agent that writes OpenSCAD source for a geometry brief. The produced solid is scored by a deterministic CAD kernel gate: it must compile, hit the brief\'s bounding box, have enough triangle detail, present a PITCHED roof (the top z-band footprint far smaller than the base), and be a HOLLOW shell (printed solid volume well under the bounding-box volume). The directive must make the agent reliably satisfy ALL of these checks.'
    : 'a REFINE DIRECTIVE: the instruction given to an agent to re-examine its own prior answer and improve it. It must make the agent KEEP a correct answer and fix only concrete errors — never churn a right answer.'
  const reflectionPrimitives = isCad
    ? [
        'instruct the agent to build the roof as a tapering gable or hip (linear_extrude of a triangular profile, or hull() from a wide base to a narrow ridge) so the top footprint is far smaller than the base',
        'instruct the agent to build the walls as a hollow shell via difference() — an outer solid minus an inset inner cavity — rather than a filled block',
        'instruct the agent to declare explicit parametric dimensions matching the brief\'s footprint and height, and to keep the overall bounding box within those numbers',
        'instruct the agent to cut the required openings (a door, several windows) by subtracting boxes from the walls while keeping the model a small number of connected solids',
      ]
    : [
        'demand explicit re-verification of the figure/fact against a cited source before asserting it',
        'require checking the answer against the exact units/precision/tolerance the question requests',
        'instruct the agent to keep a correct answer verbatim and change ONLY on a concrete identified error',
      ]

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
      target: reflectionTarget,
      mutationPrimitives: reflectionPrimitives,
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

  // 0.76 heldoutSignificance: a bootstrap CI on the PAIRED winner−baseline held-out
  // delta — turns a bare "+X pp" (a few-instance swing at thin n) into a CI + a
  // significance verdict, so we know whether to trust/promote or just scale n.
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
      `  ► held-out delta 95% CI (n=${sig.n}): [${(sig.bootstrap.low * 100).toFixed(1)}, ${(sig.bootstrap.high * 100).toFixed(1)}] pp · median ${(sig.bootstrap.median * 100).toFixed(1)}pp · significant=${sig.significant}`,
    )
    if (!sig.significant) console.log(`    (CI spans 0 or n below the productive-runs floor — scale n before promoting)`)
  } catch (err) {
    console.log(`  (held-out significance unavailable: ${(err instanceof Error ? err.message : String(err)).slice(0, 100)})`)
  }
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
