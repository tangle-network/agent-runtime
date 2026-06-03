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
import { createCadBenchAdapter } from './benchmarks/cadbench'
import { createCadDesignAdapter } from './benchmarks/cad-design'
import { createCadGenBenchAdapter } from './benchmarks/cadgenbench'
import { createFinsearchcompAdapter } from './benchmarks/finsearchcomp'
import { createHotpotqaAdapter } from './benchmarks/hotpotqa'
import { createMind2WebAdapter } from './benchmarks/mind2web'
import type { BenchmarkAdapter, BenchTask } from './benchmarks/types'
import { DEFAULT_BLENDER_DIRECTIVE, solveBlenderLocal } from './worker-blender'
import { DEFAULT_MIND2WEB_DIRECTIVE, solveBrowserLocal } from './worker-browser'
import { DEFAULT_BUILD123D_DIRECTIVE, solveBuild123dLocal } from './worker-build123d'
import { DEFAULT_CAD_DIRECTIVE, solveCadRefineLocal } from './worker-cad'
import { DEFAULT_RESEARCH_REFINE_DIRECTIVE, DEFAULT_SANDBOX_REFINE_DIRECTIVE } from './directives'
import { solveRefineResearchLocal } from './worker-research'
import { solveSandboxResearch } from './worker-sandbox-research'

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
  cadbench: createCadBenchAdapter,
  cadgenbench: createCadGenBenchAdapter,
  mind2web: createMind2WebAdapter,
}

async function main() {
  const benchKey = process.env.BENCH ?? 'hotpotqa'
  const adapter = ADAPTERS[benchKey]?.()
  if (!adapter) throw new Error(`gepa-refine supports BENCH=hotpotqa|finsearchcomp|cad|cadbench|cadgenbench|mind2web, got ${benchKey}`)
  const isCad = benchKey === 'cad'
  const isCadbench = benchKey === 'cadbench'
  const isCadgenbench = benchKey === 'cadgenbench'
  const isMind2web = benchKey === 'mind2web'
  // CAD (openscad gate) + CADBench (criteria vision judge) + CADGenBench
  // (geometric cad_score) + Mind2Web (element 0.6 + operation 0.4 partial credit)
  // all return a FRACTION score → optimize against the partial-credit gradient,
  // not flat 0/1.
  const scoreBased = isCad || isCadbench || isCadgenbench || isMind2web
  const useSandbox = process.env.SANDBOX === '1'
  const model =
    process.env.WORKER_MODEL ?? (scoreBased ? 'claude-sonnet-4-6' : useSandbox ? 'gpt-5' : 'deepseek/deepseek-v4-pro')
  const rounds = Number(process.env.K_ROUNDS ?? 3)
  const trainN = Number(process.env.TRAIN_N ?? 8)
  const holdoutN = Number(process.env.HOLDOUT_N ?? 8)
  const livenessMs = process.env.OPENCODE_LIVENESS_MS ? Number(process.env.OPENCODE_LIVENESS_MS) : undefined
  const routerBaseUrl = process.env.ROUTER_BASE ?? 'https://router.tangle.tools/v1'
  const routerKey = must('ROUTER_KEY')
  const baseDirective = isMind2web
    ? DEFAULT_MIND2WEB_DIRECTIVE
    : isCadgenbench
      ? DEFAULT_BUILD123D_DIRECTIVE
      : isCadbench
        ? DEFAULT_BLENDER_DIRECTIVE
        : isCad
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
    if (isMind2web) {
      // One element-selection shot under the candidate directive; the artifact is
      // the ELEMENT/ACTION/VALUE the model commits to, scored by the deterministic
      // Mind2Web judge. Single shot — element prediction is one step, no refine.
      const s = await solveBrowserLocal(scenario.task, { routerBaseUrl, routerKey, model, directive })
      if (s.usage.input > 0 || s.usage.output > 0) ctx.cost.observeTokens(s.usage)
      return s.artifact
    }
    if (isCadgenbench) {
      // Author build123d → export output.step; the artifact IS the STEP text,
      // which the CADGenBench geometric scorer (judge) grades vs ground truth.
      const s = await solveBuild123dLocal(scenario.task, { routerBaseUrl, routerKey, model, rounds, directive })
      if (s.usage.input > 0 || s.usage.output > 0) ctx.cost.observeTokens(s.usage)
      return s.artifact
    }
    if (isCadbench) {
      // Author a bpy script under the candidate directive, render headless in
      // Blender; the artifact is the script. The judge re-renders + vision-scores.
      const s = await solveBlenderLocal(scenario.task, { routerBaseUrl, routerKey, model, rounds, directive })
      if (s.usage.input > 0 || s.usage.output > 0) ctx.cost.observeTokens(s.usage)
      return s.artifact
    }
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
    dimensions: scoreBased
      ? [
          { key: 'score', description: 'fraction of spec checks / criteria the produced model passes' },
          { key: 'resolved', description: 'all checks/criteria pass' },
        ]
      : [{ key: 'resolved', description: 'benchmark judge marks the answer resolved' }],
    async score({ artifact, scenario }): Promise<JudgeScore> {
      if (!artifact.trim()) return { dimensions: { resolved: 0 }, composite: 0, notes: 'empty artifact' }
      const verdict = await adapter.judge(scenario.task, artifact)
      if (scoreBased) {
        const sc = typeof verdict.score === 'number' ? verdict.score : verdict.resolved ? 1 : 0
        const dimensions: Record<string, number> = { score: sc, resolved: verdict.resolved ? 1 : 0 }
        return { dimensions, composite: sc, notes: verdict.detail ?? '' }
      }
      const v = verdict.resolved ? 1 : 0
      return { dimensions: { resolved: v }, composite: v, notes: verdict.detail ?? '' }
    },
  }

  const reflectionTarget = isMind2web
    ? 'a WEB ELEMENT-SELECTION DIRECTIVE: the system instruction given to a web agent that, shown a task goal and a numbered list of candidate page elements, must choose the SINGLE correct element to act on and the action (CLICK, or TYPE/SELECT with a value). It is scored by a deterministic step metric: the chosen element id must match the ground-truth target AND the action type (and the TYPE/SELECT value) must match. The directive must improve WHICH element the agent picks — favoring the candidate whose role/label/text matches the current task step and disambiguating look-alikes — without ever breaking the required ELEMENT/ACTION/VALUE output format.'
    : isCadgenbench
    ? 'a build123d AUTHORING DIRECTIVE: the system instruction given to an agent that writes build123d (Python, OpenCascade BREP) to produce a STEP solid for a part description. The result is scored by a deterministic CAD-kernel metric: it must be a VALID watertight manifold solid, then align to the ground truth with a high point-cloud F1 + volume IoU + edge F1 + matching topology. The directive must make the agent produce a valid solid whose shape + exact dimensions match the description.'
    : isCadbench
    ? 'a BLENDER bpy AUTHORING DIRECTIVE: the system instruction given to an agent that writes a Blender Python (bpy) script to build a described 3D object. The result is rendered to images and a vision judge scores per-task criteria — correct recognizable shape, accurate proportions, sensible size, reasonable color/material, clean three-dimensional structure, faithful execution of the instruction. The directive must make the agent reliably produce a script that builds a correct, well-proportioned, clearly-recognizable model.'
    : isCad
      ? 'an OpenSCAD AUTHORING DIRECTIVE: the system instruction given to an agent that writes OpenSCAD source for a geometry brief. The produced solid is scored by a deterministic CAD kernel gate: it must compile, hit the brief\'s bounding box, have enough triangle detail, present a PITCHED roof (the top z-band footprint far smaller than the base), and be a HOLLOW shell (printed solid volume well under the bounding-box volume). The directive must make the agent reliably satisfy ALL of these checks.'
      : 'a REFINE DIRECTIVE: the instruction given to an agent to re-examine its own prior answer and improve it. It must make the agent KEEP a correct answer and fix only concrete errors — never churn a right answer.'
  const reflectionPrimitives = isMind2web
    ? [
        'instruct the agent to choose the candidate whose role/label/text most directly names the current task step, not the most prominent, first, or top-of-page element',
        'instruct the agent to disambiguate look-alike candidates using their attributes (role, type, name, placeholder, aria-label) before committing',
        'instruct the agent to make the action type follow from the element kind — a textbox/searchbox → TYPE with the exact requested value; a link/button/menuitem → CLICK; a dropdown/listbox → SELECT the named option',
        'instruct the agent to read the value to type or select directly from the task goal (names, dates, codes, zip) and copy it verbatim into VALUE',
      ]
    : isCadgenbench
    ? [
        'instruct the agent to translate every explicit dimension in the description into exact build123d parameters (mm), so the produced solid matches the ground-truth size, not just the shape',
        'instruct the agent to build a single closed watertight manifold solid (use clean primitives + boolean unions/cuts; avoid open shells or self-intersections that fail the validity gate)',
        'instruct the agent to center/orient the part sensibly and verify the export with export_step(part, "output.step") at the end',
        'instruct the agent to prefer parametric primitives + fillets/holes that reproduce the described features precisely rather than approximate freeform geometry',
      ]
    : isCadbench
    ? [
        'instruct the agent to identify the object\'s essential shape primitives and build them at correct relative proportions and a sensible real-world scale',
        'instruct the agent to assign a reasonable material/base color to each part so the render reads as the intended object',
        'instruct the agent to compose parts with correct spatial relationships (stacking, contact, symmetry) and to keep the model centered near the world origin',
        'instruct the agent to cover every explicit attribute named in the instruction (count, orientation, defining features) and to avoid extra unrequested geometry',
      ]
    : isCad
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
