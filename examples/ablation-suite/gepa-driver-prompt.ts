/**
 * gepa-driver-prompt — GEPA-optimize the driver's compose-next-prompt on TRAIN, executable-graded,
 * frozen, held-out-certified, and return the winner.
 *
 * This is the `optimize: 'gepa'` knob from the ablation board (ablation.ts), wired over the real
 * substrate: agent-eval's `selfImprove` (the held-out-gated closed loop) driven by `gepaProposer`
 * (the reflective prompt mutator). It is NOT `improve()` — `improve()` writes the winner back into an
 * `AgentProfile` field, but the steerer prompt (what the driver composes the next round's instruction
 * from) is not a profile field. So we call `selfImprove` directly with the steerer string as the
 * `baselineSurface` the proposer mutates.
 *
 * The grading is EXECUTABLE, never an LLM judge: each candidate steerer runs a real `refine` rollout
 * over the surface (its harness-verified `resolved`/`score`), and the `JudgeConfig` reads those
 * outcomes straight off the artifact. A candidate's fitness IS the resolve it actually earned on the
 * environment's own check — there is no model in the scoring loop to flatter it.
 *
 * The candidate steerer reaches the run through `refine`'s built-in analyst steerer
 * (`AgenticOptions.analystInstruction`): the closest in-strategy proxy for "the driver's
 * compose-next-prompt", since `refine`'s between-shot analyst IS the thing that composes the next
 * instruction from the trajectory. GEPA tunes that instruction; the held-out gate certifies it.
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
  type AgenticRunResult,
  type AgenticSurface,
  type AgenticTask,
  refine,
  runAgentic,
} from '@tangle-network/agent-runtime/loops'

/** One TRAIN scenario: the coding task carried as the scenario's domain payload. The agent reads
 *  `scenario.task` to run the rollout; the judge reads the artifact the rollout produced. */
interface DriverPromptScenario extends Scenario {
  task: AgenticTask
}

/** The default reflection model — a model the Tangle router actually serves. The substrate default
 *  (`anthropic/claude-sonnet-4.6`) is NOT served by the router, so `gepaProposer` would fail every
 *  reflection call; callers should pass their own, but this keeps the zero-config path live. */
const defaultReflectionModel = 'gemini-2.5-pro'

/** The mutation levers offered to the reflective proposer — what a steerer-prompt rewrite may change.
 *  These orient the model toward the kinds of edits that move a compose-next-prompt's effectiveness. */
const steererMutationPrimitives = [
  'sharpen what the reviewer must check on the trajectory before recommending an action',
  'make the recommended next actions more concrete and tool-grounded',
  'add an explicit verify-it-took step after each change',
  'tighten the COMPLETE / continue decision so it stops only when every required change is verified',
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
  }
  reflectionModel?: string
}): Promise<{ systemPrompt: string; lift: number; shipped: boolean }> {
  const { surface, worker } = opts

  // TRAIN scenarios — the disjoint training slice. `selfImprove` splits a held-out fraction off these
  // for the gate, so the winner is certified on tasks the proposer never optimized against.
  const trainTasks = await opts.tasks(opts.trainOffset, opts.trainN)
  const scenarios: DriverPromptScenario[] = trainTasks.map((task) => ({
    id: task.id,
    kind: 'coding',
    task,
  }))

  // The agent under improvement: it receives the CURRENT candidate steerer (the surface string) and
  // runs a real `refine` rollout with that steerer as the analyst instruction. The returned artifact
  // is the harness-verified `AgenticRunResult` — `resolved`/`score` come from `surface.score`, not a
  // self-report, so the candidate cannot fabricate a win.
  const agent = async (
    candidate: MutableSurface,
    scenario: DriverPromptScenario,
    _ctx: DispatchContext,
  ): Promise<AgenticRunResult> => {
    // The candidate is the steerer prompt. A `CodeSurface` is not a prompt — this loop only optimizes
    // the string steerer, so a non-string candidate is a wiring error that must fail loud.
    if (typeof candidate !== 'string') {
      throw new Error(
        `optimizeDriverPrompt: candidate surface is a CodeSurface, not a steerer prompt — this loop optimizes the string steerer only`,
      )
    }
    return runAgentic({
      surface,
      task: scenario.task,
      strategy: refine,
      budget: opts.worker.innerTurns ? Math.max(2, Math.ceil(opts.worker.innerTurns / 2)) : 2,
      routerBaseUrl: worker.routerBaseUrl,
      routerKey: worker.routerKey,
      model: worker.model,
      // The candidate steerer drives the run via refine's built-in between-shot analyst.
      analystInstruction: candidate,
      ...(worker.maxTokens !== undefined ? { maxTokens: worker.maxTokens } : {}),
      ...(worker.innerTurns !== undefined ? { innerTurns: worker.innerTurns } : {}),
    })
  }

  // The EXECUTABLE judge — no LLM in the scoring loop. Composite = the artifact's harness-verified
  // resolve fraction; the `resolved` dimension is the binary deployable pass. A thrown judge would be
  // recorded as a failed cell, so we read defensively-shaped numeric fields and never throw on shape.
  const judge: JudgeConfig<AgenticRunResult, DriverPromptScenario> = {
    name: 'surface-resolve',
    dimensions: [
      { key: 'resolved', description: 'the surface verifier passed every check (1) or not (0)' },
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

  const result = await selfImprove<DriverPromptScenario, AgenticRunResult>({
    agent,
    scenarios,
    judge,
    baselineSurface: opts.baselinePrompt,
    proposer: gepaProposer({
      llm: { baseUrl: worker.routerBaseUrl, apiKey: worker.routerKey },
      model: reflectionModel,
      target:
        'the driver compose-next-prompt (the between-shot steerer that turns the trajectory into the next instruction)',
      mutationPrimitives: steererMutationPrimitives,
    }),
    // One generation, two candidates, a third of TRAIN held out for the gate — the cheap proof shape;
    // raise generations/populationSize for a deeper search once the cheap run is green.
    budget: { generations: 1, populationSize: 2, holdoutFraction: 0.34 },
  })

  // The winner surface is the promoted steerer. A `CodeSurface` winner is impossible here (the
  // baseline + every mutation is a string), but guard the type so the return stays a clean string.
  const winner = result.winner.surface
  const systemPrompt = typeof winner === 'string' ? winner : opts.baselinePrompt

  return {
    systemPrompt,
    lift: result.lift,
    shipped: result.gateDecision === 'ship',
  }
}
