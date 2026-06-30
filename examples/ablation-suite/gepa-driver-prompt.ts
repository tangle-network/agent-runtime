/**
 * gepa-driver-prompt — GEPA-optimize the REAL supervisor driver prompt (the proposer) on TRAIN,
 * executable-graded by the ACTUAL supervised resolve, frozen, held-out-certified, and return the winner.
 *
 * This is the `optimize: 'gepa'` knob from the ablation board (ablation.ts), wired over the real
 * substrate: agent-eval's `selfImprove` (the held-out-gated closed loop) driven by `gepaProposer`
 * (the reflective prompt mutator). The surface under improvement is the driver/proposer standing
 * prompt that `supervise()` runs as its brain — each candidate string becomes the driver profile's
 * `systemPrompt`. So each candidate IS a candidate driver prompt, and its fitness IS the resolve it
 * earns when it actually drives a `superviseSurface` run over the surface.
 *
 * The grading is EXECUTABLE, never an LLM judge: each candidate driver prompt runs a real supervised
 * rollout via `superviseSurface` (its harness-verified `resolved`/`score` come from the
 * surface's own completion oracle), and the `JudgeConfig` reads those outcomes straight off the
 * returned artifact. A candidate's fitness IS the resolve it actually earned on the environment's own
 * check — there is no model in the scoring loop to flatter it.
 */

import {
  type DispatchContext,
  gepaProposer,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
  selfImprove,
} from '@tangle-network/agent-eval/contract'
import {
  type AgenticSurface,
  type AgenticTask,
  failuresAnalyst,
  superviseSurface,
} from '@tangle-network/agent-runtime/loops'

/** One TRAIN scenario: the coding task carried as the scenario's domain payload. The agent reads
 *  `scenario.task` to run the supervised rollout; the judge reads the artifact the rollout produced. */
interface DriverPromptScenario extends Scenario {
  task: AgenticTask
}

/** The deployable outcome of one supervised candidate run — exactly what `superviseSurface`
 *  returns. The judge scores on `resolved`/`score`; the `usd` rides through so it is never lost. */
interface SupervisedOutcome {
  resolved: boolean
  score: number
  usd: number
  tokensIn: number
  tokensOut: number
}

/** The default reflection model — a model the Tangle router actually serves. The substrate default
 *  (`anthropic/claude-sonnet-4.6`) is NOT served by the router, so `gepaProposer` would fail every
 *  reflection call; callers should pass their own, but this keeps the zero-config path live. */
const defaultReflectionModel = 'gemini-2.5-pro'

/** The mutation levers offered to the reflective proposer — what a driver-prompt rewrite may change.
 *  These orient the model toward the kinds of edits that move a supervisor brain's effectiveness. */
const driverMutationPrimitives = [
  'sharpen what the driver must verify on a settled worker before it stops or re-spawns',
  'make the next-spawn instruction the driver composes more concrete and tool-grounded',
  'add an explicit verify-it-took step the driver must confirm before declaring done',
  'tighten the stop / re-spawn decision so it settles only when every required change is verified',
]

export async function optimizeDriverPrompt(opts: {
  surface: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  trainOffset: number
  trainN: number
  baselinePrompt: string
  worker: {
    routerBaseUrl: string
    routerKey: string
    model: string
    maxTokens?: number
    innerTurns?: number
    /** Refine-shot budget per worker — MUST match the deployment arm's budget, or the prompt is tuned
     *  against a different per-attempt compute than it serves with. */
    budget?: number
  }
  /** The supervisor brain's router substrate for each candidate's supervised run (the driver's own
   *  inference). Defaults to the worker's router + model when omitted. */
  supervisorRouter?: { baseUrl: string; apiKey: string; model: string }
  reflectionModel?: string
}): Promise<{ systemPrompt: string; lift: number; shipped: boolean; usd: number }> {
  const { surface, worker } = opts

  // The supervisor brain's router: each candidate prompt drives a real supervised run, so it needs an
  // inference substrate. Default to the worker's router + model — the driver and worker share compute
  // unless the caller separates them.
  const supervisorRouter = opts.supervisorRouter ?? {
    baseUrl: worker.routerBaseUrl,
    apiKey: worker.routerKey,
    model: worker.model,
  }

  // TRAIN scenarios — the disjoint training slice. `selfImprove` splits a held-out fraction off these
  // for the gate, so the winner is certified on tasks the proposer never optimized against.
  const trainTasks = await opts.tasks(opts.trainOffset, opts.trainN)
  const scenarios: DriverPromptScenario[] = trainTasks.map((task) => ({
    id: task.id,
    kind: 'coding',
    task,
  }))

  // The agent under improvement: it receives the CURRENT candidate driver prompt (the surface string)
  // and runs a REAL supervised rollout with that prompt as the supervisor brain's standing instruction.
  // The returned artifact is the harness-verified deployable outcome — `resolved`/`score` come from the
  // surface's completion oracle, not a self-report, so the candidate cannot fabricate a win.
  const agent = async (
    candidate: MutableSurface,
    scenario: DriverPromptScenario,
    ctx: DispatchContext,
  ): Promise<SupervisedOutcome> => {
    // The candidate is the driver prompt. A `CodeSurface` is not a prompt — this loop only optimizes the
    // string driver prompt, so a non-string candidate is a wiring error that must fail loud.
    if (typeof candidate !== 'string') {
      throw new Error(
        `optimizeDriverPrompt: candidate surface is a CodeSurface, not a driver prompt — this loop optimizes the string driver prompt only`,
      )
    }
    const sup = await superviseSurface(
      { name: 'driver', systemPrompt: candidate },
      {
        surface,
        task: scenario.task,
        worker,
        // A small conserved pool: enough for the driver's turns plus several worker spawns so the
        // spawn-targeted-worker loop runs, sized off the worker's inner-loop bounds.
        budget: {
          maxIterations: (worker.innerTurns ?? 6) * 3 + 16,
          maxTokens: (worker.maxTokens ?? 4000) * 6,
        },
        router: {
          routerBaseUrl: supervisorRouter.baseUrl,
          routerKey: supervisorRouter.apiKey,
          model: supervisorRouter.model,
        },
        analysts: failuresAnalyst(),
      },
    )
    // Report the supervised run's REAL spend to the campaign cost meter — the substrate intercepts no
    // LLM call, so without this the cell reads {cost:0, tokens:0} and the backend-integrity guard
    // (expectUsage:'assert') aborts the whole optimization on the first cell as a stub.
    ctx.cost.observe(sup.usd, 'supervised-run')
    ctx.cost.observeTokens({ input: sup.tokensIn, output: sup.tokensOut })
    return {
      resolved: sup.resolved,
      score: sup.score,
      usd: sup.usd,
      tokensIn: sup.tokensIn,
      tokensOut: sup.tokensOut,
    }
  }

  // The EXECUTABLE judge — no LLM in the scoring loop. Composite = the supervised run's harness-verified
  // score; the `resolved` dimension is the binary deployable pass. Reads straight off the artifact.
  const judge: JudgeConfig<SupervisedOutcome, DriverPromptScenario> = {
    name: 'supervised-resolve',
    dimensions: [
      {
        key: 'resolved',
        description: 'the surface oracle confirmed a delivered winner (1) or not (0)',
      },
      { key: 'score', description: 'the surface verifier pass fraction in [0,1]' },
    ],
    score: ({ artifact }) => ({
      dimensions: {
        resolved: artifact.resolved ? 1 : 0,
        score: artifact.score,
      },
      composite: artifact.score,
      notes: `executable grade: resolved=${artifact.resolved} score=${artifact.score.toFixed(3)}`,
    }),
  }

  const reflectionModel = opts.reflectionModel ?? defaultReflectionModel

  const result = await selfImprove<DriverPromptScenario, SupervisedOutcome>({
    agent,
    scenarios,
    judge,
    baselineSurface: opts.baselinePrompt,
    proposer: gepaProposer({
      llm: { baseUrl: worker.routerBaseUrl, apiKey: worker.routerKey },
      model: reflectionModel,
      target:
        'the supervisor driver prompt (the standing brain instruction that spawns + steers workers)',
      mutationPrimitives: driverMutationPrimitives,
    }),
    // One generation, two candidates, a third of TRAIN held out for the gate — the cheap proof shape;
    // raise generations/populationSize for a deeper search once the cheap run is green.
    budget: { generations: 1, populationSize: 2, holdoutFraction: 0.34 },
  })

  // The winner surface is the promoted driver prompt. A `CodeSurface` winner is impossible here (the
  // baseline + every mutation is a string), but guard the type so the return stays a clean string.
  const winner = result.winner.surface
  const systemPrompt = typeof winner === 'string' ? winner : opts.baselinePrompt

  return {
    systemPrompt,
    lift: result.lift,
    shipped: result.gateDecision === 'ship',
    // The TRAIN-side optimization cost (baseline + every generation) — counted into the arm's $ so the
    // cost-aware ablation never hides the price of GEPA behind the held-out run alone.
    usd: result.totalCostUsd,
  }
}
