/**
 * Optimize the supervisor driver prompt with GEPA's official engine.
 *
 * The surface under improvement is the standing prompt that `supervise()` uses
 * to steer workers. Agent-eval's complete method owns candidate search and
 * selection. Runtime scores the selected candidate on a separate final set.
 *
 * The grading is EXECUTABLE, never an LLM judge: each candidate driver prompt runs a real supervised
 * rollout via `superviseSurface` (its harness-verified `resolved`/`score` come from the
 * surface's own completion oracle), and the `JudgeConfig` reads those outcomes straight off the
 * returned artifact. A candidate's fitness IS the resolve it actually earned on the environment's own
 * check — there is no model in the scoring loop to flatter it.
 */

import type { DispatchContext, JudgeConfig, Scenario } from '@tangle-network/agent-eval/contract'
import { type AgentProfile, canonicalCandidateDigest } from '@tangle-network/agent-interface'
import { improve, officialGepa, type ReadonlyAgentProfile } from '@tangle-network/agent-runtime'
import {
  type AgenticSurface,
  type AgenticTask,
  failuresAnalyst,
  superviseSurface,
} from '@tangle-network/agent-runtime/kernel'
import {
  assertCompleteCost,
  officialOptimizerModel,
} from '../../bench/src/official-optimizer-config.mjs'

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

const defaultReflectionModel = 'gemini-2.5-pro'

export async function optimizeDriverPrompt(opts: {
  surface: AgenticSurface
  tasks: (offset: number, n: number) => Promise<AgenticTask[]>
  trainOffset: number
  trainN: number
  selectionN?: number
  testN?: number
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
  maxEvaluations?: number
  maxProposerCostUsd?: number
  maxConcurrency?: number
  runDir?: string
}): Promise<{ systemPrompt: string; lift: number | undefined; shipped: boolean; usd: number }> {
  const { surface, worker } = opts

  // The supervisor brain's router: each candidate prompt drives a real supervised run, so it needs an
  // inference substrate. Default to the worker's router + model — the driver and worker share compute
  // unless the caller separates them.
  const supervisorRouter = opts.supervisorRouter ?? {
    baseUrl: worker.routerBaseUrl,
    apiKey: worker.routerKey,
    model: worker.model,
  }

  const selectionN = opts.selectionN ?? opts.trainN
  const testN = opts.testN ?? opts.trainN
  const tasks = await opts.tasks(opts.trainOffset, opts.trainN + selectionN + testN)
  const trainTasks = tasks.slice(0, opts.trainN)
  const selectionTasks = tasks.slice(opts.trainN, opts.trainN + selectionN)
  const testTasks = tasks.slice(opts.trainN + selectionN)
  if (
    trainTasks.length !== opts.trainN ||
    selectionTasks.length !== selectionN ||
    testTasks.length !== testN
  ) {
    throw new Error('optimizeDriverPrompt: task source returned too few tasks for all partitions')
  }
  const scenarios = new Map(
    tasks.map((task) => [
      task.id,
      {
        id: task.id,
        kind: 'coding',
        task,
      } satisfies DriverPromptScenario,
    ]),
  )
  const mapScenarios = (items: AgenticTask[]): DriverPromptScenario[] =>
    items.map((task) => scenarios.get(task.id)!)
  const trainScenarios = mapScenarios(trainTasks)
  const selectionScenarios = mapScenarios(selectionTasks)
  const testScenarios = mapScenarios(testTasks)

  // The agent under improvement receives the complete candidate profile and runs a real supervised
  // rollout with its prompt as the supervisor brain's standing instruction.
  // The returned artifact is the harness-verified deployable outcome — `resolved`/`score` come from the
  // surface's completion oracle, not a self-report, so the candidate cannot fabricate a win.
  const agent = async (
    candidate: ReadonlyAgentProfile,
    scenario: DriverPromptScenario,
    ctx: DispatchContext,
  ): Promise<SupervisedOutcome> => {
    const systemPrompt = candidate.prompt?.systemPrompt
    if (systemPrompt === undefined) {
      throw new Error('optimizeDriverPrompt: candidate profile has no system prompt')
    }
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: 'supervised-run',
      model: supervisorRouter.model,
      signal: ctx.signal,
      execute: () =>
        superviseSurface({ name: 'driver', prompt: { systemPrompt } }, scenario.task, {
          surface,
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
        }),
      receipt: (sup) => ({
        model: supervisorRouter.model,
        inputTokens: sup.tokensIn,
        outputTokens: sup.tokensOut,
        ...(sup.usd > 0 ? { actualCostUsd: sup.usd } : {}),
      }),
    })
    if (!paid.succeeded) throw paid.error
    const sup = paid.value
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

  const profile: AgentProfile = {
    name: 'ablation-driver',
    prompt: { systemPrompt: opts.baselinePrompt },
  }
  const maxProposerCostUsd = opts.maxProposerCostUsd ?? 3
  const optimizer = officialOptimizerModel({
    env: process.env,
    model: opts.reflectionModel ?? defaultReflectionModel,
    baseUrl: supervisorRouter.baseUrl,
    apiKey: supervisorRouter.apiKey,
    maxCostUsd: maxProposerCostUsd,
    maxOutputTokensPerRequest: Number(process.env.REFLECT_MAX_TOKENS ?? 8192),
  })
  const result = await improve(profile, {
    surface: 'prompt',
    executionRef: canonicalCandidateDigest({
      callback: 'examples/ablation-suite/gepa-driver-prompt',
      workerModel: worker.model,
      workerMaxTokens: worker.maxTokens ?? null,
      workerTurns: worker.innerTurns ?? null,
      workerShots: worker.budget ?? null,
      supervisorModel: supervisorRouter.model,
      workerEndpoint: new URL(worker.routerBaseUrl).origin,
      supervisorEndpoint: new URL(supervisorRouter.baseUrl).origin,
    }),
    method: officialGepa<DriverPromptScenario, SupervisedOutcome>({
      objective:
        'Improve the complete standing prompt used by a supervisor that spawns, steers, and verifies coding workers.',
      background: [
        'Return only the complete supervisor prompt.',
        'The supervisor must verify settled workers, target subsequent workers at observed failures, and stop only after the task check passes.',
        'Do not change worker tools, models, or budgets.',
      ].join(' '),
      recipe: {
        kind: 'engine',
        run: {
          engine: 'gepa',
          maxEvaluations: opts.maxEvaluations ?? 8,
          maxProposerCostUsd,
        },
      },
      optimizer,
      resume: 'if-compatible',
      trustResumeState: true,
      describeScenario: (scenario) => ({
        id: scenario.id,
        systemPrompt: scenario.task.systemPrompt,
        userPrompt: scenario.task.userPrompt,
      }),
    }),
    trainScenarios,
    selectionScenarios,
    testScenarios,
    judges: [judge],
    agent,
    runDir: opts.runDir ?? `.runs/ablation-driver-gepa-${opts.trainOffset}`,
    maxConcurrency: opts.maxConcurrency ?? 1,
    reps: 1,
    optimizationRunOptions: {
      maxConcurrency: opts.maxConcurrency ?? 1,
      reps: 1,
    },
  })

  assertCompleteCost('optimizeDriverPrompt', result.cost)
  return {
    systemPrompt:
      typeof result.candidate.value === 'string' ? result.candidate.value : opts.baselinePrompt,
    lift: result.lift,
    shipped: result.decision === 'ship',
    usd: result.cost.totalCostUsd,
  }
}
