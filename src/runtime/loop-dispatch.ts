/**
 * `loopDispatch` — turn `runAgentRounds` into an agent-eval campaign dispatch.
 *
 * `loopDispatch` builds the execution context, forwards trace events, and
 * reports cost and token usage for each campaign cell:
 *
 *   const dispatch = loopDispatch({
 *     environmentProvider,
 *     toLoopOptions: (scenario, profile) => ({ driver, agentRun, output, validator, task }),
 *   })
 *   await runProfileMatrix({ profiles, scenarios, dispatch, judges, commitSha })
 */

// agent-eval's AgentProfile (the eval-harness unit of variation, `model: string`)
// — NOT sandbox's AgentProfile. ProfileDispatchFn is keyed on the former.
import type { AgentProfile, CostReceiptInput, MaximumCharge } from '@tangle-network/agent-eval'
import type {
  CampaignTraceWriter,
  DispatchContext,
  DispatchFn,
  ProfileDispatchFn,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { AgentEnvironmentProvider } from '@tangle-network/agent-interface/environment-provider'
import { type RunAgentRoundsOptions, runAgentRounds } from './run-loop'
import type { LoopResult, LoopTraceEmitter } from './types'

/** runAgentRounds options minus the `ctx` (loopDispatch builds the ctx). */
export type LoopOptionsForDispatch<Task, Output, Decision> = Omit<
  RunAgentRoundsOptions<Task, Output, Decision>,
  'ctx'
>

export interface LoopDispatchOptions<
  Task,
  Output,
  Decision,
  TScenario extends Scenario,
  TArtifact,
> {
  /** Environment provider used for every cell's `runAgentRounds`. */
  environmentProvider: AgentEnvironmentProvider
  /** Build the per-cell runAgentRounds options from the scenario (+ profile, when
   *  used with `runProfileMatrix`). */
  toLoopOptions: (
    scenario: TScenario,
    profile: AgentProfile,
  ) => LoopOptionsForDispatch<Task, Output, Decision>
  /** Map the finished loop to the artifact the judges score. Default:
   *  `result.winner?.output`. A loop with no winner yields `undefined` (judges
   *  skip the cell) — but the loop's token usage is STILL reported, so the
   *  integrity guard sees real activity. */
  toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact
  /** Forward `loop.*` trace events into the campaign's scoped trace so loop
   *  spans correlate with the cell. Default true. */
  forwardTrace?: boolean
  /** Cost-meter source label for the loop's spend. Default `'loop'`. */
  costSource?: string
  /** Provider- or executor-enforced maximum for this whole cell dispatch.
   * Required by agent-eval before execution when the campaign is cost-capped. */
  maximumCharge?:
    | MaximumCharge
    | ((scenario: TScenario, profile: AgentProfile) => MaximumCharge | undefined)
  /** Resolve the model actually served from the completed loop. */
  resolveCostModel?: (
    result: LoopResult<Task, Output, Decision>,
    scenario: TScenario,
    profile: AgentProfile,
  ) => string | undefined
}

/** Bridge a campaign `DispatchContext.trace` to a `LoopTraceEmitter` so every
 *  `loop.*` event lands as a span under the cell's scoped trace. */
function campaignTraceToLoopEmitter(trace: CampaignTraceWriter): LoopTraceEmitter {
  return {
    emit(event) {
      trace
        .span(event.kind, { runId: event.runId, timestamp: event.timestamp, ...event.payload })
        .end()
    },
  }
}

async function runLoopForCell<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
  scenario: TScenario,
  profile: AgentProfile,
  ctx: DispatchContext,
): Promise<TArtifact> {
  const loopOptions = opts.toLoopOptions(scenario, profile)
  return runLoopWithCampaignContext(opts, loopOptions, ctx, {
    model: profile.model?.default ?? modelFromLoopOptions(loopOptions),
    maximumCharge:
      typeof opts.maximumCharge === 'function'
        ? opts.maximumCharge(scenario, profile)
        : opts.maximumCharge,
    resolveModel: opts.resolveCostModel
      ? (result) => opts.resolveCostModel?.(result, scenario, profile)
      : undefined,
  })
}

async function runLoopWithCampaignContext<Task, Output, Decision, TArtifact>(
  opts: {
    environmentProvider: AgentEnvironmentProvider
    toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact
    forwardTrace?: boolean
    costSource?: string
  },
  loopOptions: LoopOptionsForDispatch<Task, Output, Decision>,
  ctx: DispatchContext,
  cost: {
    model: string
    maximumCharge?: MaximumCharge
    resolveModel?: (result: LoopResult<Task, Output, Decision>) => string | undefined
  },
): Promise<TArtifact> {
  const paid = await ctx.cost.runPaidCall({
    channel: 'agent',
    actor: opts.costSource ?? 'loop',
    model: cost.model,
    signal: ctx.signal,
    ...(cost.maximumCharge ? { maximumCharge: cost.maximumCharge } : {}),
    execute: (executionSignal) =>
      runAgentRounds<Task, Output, Decision>({
        ...loopOptions,
        ctx: {
          environmentProvider: opts.environmentProvider,
          signal: executionSignal,
          traceEmitter:
            opts.forwardTrace === false ? undefined : campaignTraceToLoopEmitter(ctx.trace),
        },
      }),
    receipt: (result) => loopCostReceipt(result, cost.resolveModel?.(result) ?? cost.model),
  })
  if (!paid.succeeded) {
    throw paid.error
  }
  const result = paid.value
  const toArtifact =
    opts.toArtifact ?? ((r: LoopResult<Task, Output, Decision>) => r.winner?.output as TArtifact)
  return toArtifact(result)
}

function loopCostReceipt<Task, Output, Decision>(
  result: LoopResult<Task, Output, Decision>,
  model: string,
): CostReceiptInput {
  return {
    model,
    inputTokens: result.tokenUsage.input,
    outputTokens: result.tokenUsage.output,
    ...(result.costUsd > 0 ? { actualCostUsd: result.costUsd } : {}),
  }
}

function modelFromLoopOptions<Task, Output, Decision>(
  options: LoopOptionsForDispatch<Task, Output, Decision>,
): string {
  const profiles = options.agentRun
    ? [options.agentRun.profile]
    : (options.agentRuns?.map((run) => run.profile) ?? [])
  const models = new Set(
    profiles.map((profile) => profile.model?.default).filter((model): model is string => !!model),
  )
  if (models.size === 1) return [...models][0] as string
  return models.size > 1 ? 'mixed' : 'unknown'
}

/** Options for adapting plain agent-eval campaign scenarios into runtime `runAgentRounds` cells. */
export interface LoopCampaignDispatchOptions<
  Task,
  Output,
  Decision,
  TScenario extends Scenario,
  TArtifact,
> {
  /** Environment provider used for every campaign cell's `runAgentRounds`. */
  environmentProvider: AgentEnvironmentProvider
  /** Build the per-cell runAgentRounds options from the campaign scenario. */
  toLoopOptions: (scenario: TScenario) => LoopOptionsForDispatch<Task, Output, Decision>
  /** Map the finished loop to the artifact the campaign judges score. */
  toArtifact?: (result: LoopResult<Task, Output, Decision>) => TArtifact
  /** Forward `loop.*` trace events into the campaign's scoped trace. Default true. */
  forwardTrace?: boolean
  /** Cost-meter source label for the loop's spend. Default `'loop'`. */
  costSource?: string
  /** Provider- or executor-enforced maximum for this whole cell dispatch. */
  maximumCharge?: MaximumCharge | ((scenario: TScenario) => MaximumCharge | undefined)
  /** Resolve the model actually served from the completed loop. */
  resolveCostModel?: (
    result: LoopResult<Task, Output, Decision>,
    scenario: TScenario,
  ) => string | undefined
}

/**
 * Adapter for plain `runCampaign` scenarios. This is the runtime-side pair for
 * agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
 * the runtime loop here, and keep cost + token + trace reporting automatic.
 */
export function loopCampaignDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopCampaignDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
): DispatchFn<TScenario, TArtifact> {
  return (scenario, ctx) => {
    const loopOptions = opts.toLoopOptions(scenario)
    return runLoopWithCampaignContext(opts, loopOptions, ctx, {
      model: modelFromLoopOptions(loopOptions),
      maximumCharge:
        typeof opts.maximumCharge === 'function'
          ? opts.maximumCharge(scenario)
          : opts.maximumCharge,
      resolveModel: opts.resolveCostModel
        ? (result) => opts.resolveCostModel?.(result, scenario)
        : undefined,
    })
  }
}

/**
 * Adapter for `runProfileMatrix` (profile is an axis). Returns a
 * `ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell and
 * reports usage automatically.
 */
export function loopDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
): ProfileDispatchFn<TScenario, TArtifact> {
  return (profile, scenario, ctx) => runLoopForCell(opts, scenario, profile, ctx)
}
