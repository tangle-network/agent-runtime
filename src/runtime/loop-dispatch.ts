/**
 * `loopDispatch` — turn `runAgentRounds` into an agent-eval campaign dispatch.
 *
 * Without this adapter a consumer wiring `runAgentRounds` into `runProfileMatrix` /
 * `runCampaign` has to, by hand, every time: (a) build an `ExecCtx` with a
 * sandbox client, (b) adapt the campaign `DispatchContext.trace` into a
 * `LoopTraceEmitter` (or lose all loop trace correlation), and (c) remember to
 * forward the loop's cost + tokens via `ctx.cost` (forgetting it yields a
 * `{0,0}` cell the backend-integrity guard reads as a stub). Three foot-guns,
 * the third silent. The fleet's products skipped (c) and fell back to a
 * `workerRecords[]` side-channel — the exact anti-pattern the substrate exists
 * to kill.
 *
 * `loopDispatch` collapses all three into one typed call:
 *
 *   const dispatch = loopDispatch({
 *     sandboxClient,
 *     toLoopOptions: (scenario, profile) => ({ driver, agentRun, output, validator, task }),
 *   })
 *   await runProfileMatrix({ profiles, scenarios, dispatch, judges, commitSha })
 *
 * The complete Runtime cell starts inside `ctx.cost.runPaidCall` before any
 * sandbox work begins. Its provider-reported usage becomes the paid-call
 * receipt before Eval settles the call. A completed `LoopResult` cannot be
 * attached afterward because it cannot prove pre-execution admission.
 * Trace events are forwarded automatically and the Runtime context is built
 * automatically.
 *
 * Typed structurally against the campaign `DispatchContext` (imported type-only
 * from `@tangle-network/agent-eval/campaign`) — a downward dependency, never an
 * inversion.
 */

// agent-eval's AgentProfile (the eval-harness unit of variation, `model: string`)
// — NOT sandbox's AgentProfile. ProfileDispatchFn is keyed on the former.
import {
  type AgentProfile,
  type CostReceiptInput,
  type MaximumCharge,
  modelHasSnapshot,
} from '@tangle-network/agent-eval'
import type {
  CampaignTraceWriter,
  DispatchContext,
  DispatchFn,
  ProfileDispatchFn,
  Scenario,
} from '@tangle-network/agent-eval/campaign'
import { observedModelMatchesDeclared } from './model-identity'
import { type RunAgentRoundsOptions, runAgentRounds } from './run-loop'
import { type SuperviseOptions, supervise } from './supervise/supervise'
import type { SupervisedResult } from './supervise/types'
import type { LoopResult, LoopTokenUsage, LoopTraceEmitter, SandboxClient } from './types'
import { hasCompleteCacheBreakdown } from './util'

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
  /** Sandbox client used for every cell's `runAgentRounds`. Supplied once. */
  sandboxClient: SandboxClient
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
    sandboxClient: SandboxClient
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
          sandboxClient: opts.sandboxClient,
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
  return costReceiptFromUsage(result.tokenUsage, model, {
    usageUnknown: result.tokenUsage.tokensKnown === false,
    actualCostUsd: result.costUsdKnown !== false ? result.costUsd : undefined,
    costUnknown: result.costUsdKnown === false,
    estimatedCostUsd: result.estimatedCostUsd,
  })
}

/** Map Runtime usage into Eval's canonical paid-call receipt without inventing cache classes. */
function costReceiptFromUsage(
  usage: LoopTokenUsage,
  model: string,
  cost: {
    usageUnknown?: boolean
    actualCostUsd?: number
    costUnknown?: boolean
    estimatedCostUsd?: number
  },
): CostReceiptInput {
  const cacheComplete =
    hasCompleteCacheBreakdown(usage) &&
    (usage.freshInput !== undefined ||
      usage.cacheRead !== undefined ||
      usage.cacheWrite !== undefined)
  const cacheRead = cacheComplete ? (usage.cacheRead ?? 0) : undefined
  const cacheWrite = cacheComplete ? (usage.cacheWrite ?? 0) : undefined
  const classified = (cacheRead ?? 0) + (cacheWrite ?? 0)
  return {
    model,
    // Eval prices fresh prompt input separately. A partial cache split remains one total input
    // number, rather than pretending omitted classes were zero.
    inputTokens: cacheComplete ? usage.input - classified : usage.input,
    outputTokens: usage.output,
    ...(cacheComplete ? { cachedTokens: cacheRead, cacheWriteTokens: cacheWrite } : {}),
    ...(usage.tokensKnown === false || cost.usageUnknown ? { usageUnknown: true } : {}),
    ...(cost.actualCostUsd !== undefined ? { actualCostUsd: cost.actualCostUsd } : {}),
    ...(cost.costUnknown ? { costUnknown: true } : {}),
    ...(cost.estimatedCostUsd !== undefined ? { estimatedCostUsd: cost.estimatedCostUsd } : {}),
  }
}

/** `supervise` options minus Eval-owned cancellation. */
export type SuperviseOptionsForDispatch = Omit<SuperviseOptions, 'signal'>

/**
 * Adapt a recursive Runtime `supervise()` tree to one Agent Eval profile-matrix cell.
 *
 * The adapter starts Eval's paid-call record before the tree starts. Runtime remains the sole
 * owner of recursive execution, budgets, and the journal; Eval remains the sole owner of the
 * paid-call admission and resulting receipt.
 */
export interface SuperviseDispatchOptions<TScenario extends Scenario, TArtifact> {
  /** Build the task passed to the root supervisor for this profile/scenario cell. */
  toTask: (scenario: TScenario, profile: AgentProfile) => unknown
  /** Build the Runtime-owned recursive-run options for this profile/scenario cell. */
  toSuperviseOptions: (scenario: TScenario, profile: AgentProfile) => SuperviseOptionsForDispatch
  /** Map the terminal tree result to the artifact judges score. Default: winner output. */
  toArtifact?: (result: SupervisedResult<unknown>) => TArtifact
  /** Cost-meter source label. Default `'supervise'`. */
  costSource?: string
  /** Provider- or executor-enforced maximum for the complete supervised tree. */
  maximumCharge?:
    | MaximumCharge
    | ((scenario: TScenario, profile: AgentProfile) => MaximumCharge | undefined)
}

type SupervisedTreeModel =
  | { readonly kind: 'known'; readonly model: string }
  | { readonly kind: 'mixed'; readonly models: readonly string[] }
  | { readonly kind: 'unknown' }

/**
 * Eval has one pre-admitted paid call for this dispatch. A tree can only settle that one call when
 * Runtime can prove every visible leaf used the same model. Child identities come from Runtime's
 * materialization receipts. The root identity comes only from Runtime's settled provider receipt;
 * the authored profile remains a matching constraint, never a fallback. A nested tree is not
 * flattened in this result view, so it remains unknown rather than being relabelled from its
 * parent. A caller-supplied override would be false.
 */
function supervisedTreeModel(
  result: SupervisedResult<unknown>,
  rootProfile: AgentProfile,
): SupervisedTreeModel {
  const models = new Set<string>()
  const rootEvidence = result.rootProviderModel
  if (rootEvidence?.status !== 'known' || rootEvidence.models.length === 0) {
    return { kind: 'unknown' }
  }
  for (const model of rootEvidence.models) {
    if (
      !modelHasSnapshot(model) ||
      !observedModelMatchesDeclared(model, rootProfile.model?.default ?? '')
    ) {
      return { kind: 'unknown' }
    }
    models.add(model)
  }
  let unknown = false
  for (const node of result.tree.nodes) {
    if (node.ownedTreeRoot !== undefined) {
      unknown = true
      continue
    }
    const materialization = node.materialization
    if (materialization?.status !== 'known' || materialization.model.status !== 'known') {
      unknown = true
      continue
    }
    models.add(materialization.model.id)
  }
  if (unknown || models.size === 0) return { kind: 'unknown' }
  if (models.size !== 1) return { kind: 'mixed', models: [...models].sort() }
  return { kind: 'known', model: [...models][0] as string }
}

/** The Eval receipt surface has no pre-admitted per-model recursive-tree receipt bundle yet. */
class SupervisedTreeModelIdentityError extends Error {
  constructor(identity: Exclude<SupervisedTreeModel, { readonly kind: 'known' }>) {
    const detail =
      identity.kind === 'mixed'
        ? `multiple models (${identity.models.join(', ')})`
        : 'an unknown materialized model'
    super(`superviseDispatch: cannot settle one Eval paid-call receipt for a tree with ${detail}`)
    this.name = 'SupervisedTreeModelIdentityError'
  }
}

function unknownSupervisedTreeReceipt(): CostReceiptInput {
  return {
    model: 'unknown',
    inputTokens: 0,
    outputTokens: 0,
    usageUnknown: true,
    costUnknown: true,
  }
}

/** Run one recursive supervised tree inside Eval's pre-execution paid-call lifecycle. */
export function superviseDispatch<TScenario extends Scenario, TArtifact>(
  opts: SuperviseDispatchOptions<TScenario, TArtifact>,
): ProfileDispatchFn<TScenario, TArtifact> {
  return async (profile, scenario, ctx) => {
    const superviseOptions = opts.toSuperviseOptions(scenario, profile)
    const task = opts.toTask(scenario, profile)
    const maximumCharge =
      typeof opts.maximumCharge === 'function'
        ? opts.maximumCharge(scenario, profile)
        : opts.maximumCharge
    const paid = await ctx.cost.runPaidCall({
      channel: 'agent',
      actor: opts.costSource ?? 'supervise',
      // A child profile can choose a different model after this call has been admitted. Until the
      // finished tree proves one uniform materialized model, naming the root model would be false.
      model: 'unknown',
      signal: ctx.signal,
      ...(maximumCharge ? { maximumCharge } : {}),
      // The execution signal is written last so a caller cannot bypass Eval cancellation.
      execute: async (executionSignal) => {
        const result = await supervise(profile, task, {
          ...superviseOptions,
          signal: executionSignal,
        })
        const identity = supervisedTreeModel(result, profile)
        if (identity.kind !== 'known') throw new SupervisedTreeModelIdentityError(identity)
        return result
      },
      receipt: (result) => {
        const identity = supervisedTreeModel(result, profile)
        if (identity.kind !== 'known') throw new SupervisedTreeModelIdentityError(identity)
        return costReceiptFromUsage(result.spentTotal.tokens, identity.model, {
          usageUnknown: result.spentTotal.tokensKnown === false,
          actualCostUsd: result.spentTotal.usdKnown !== false ? result.spentTotal.usd : undefined,
          costUnknown: result.spentTotal.usdKnown === false,
        })
      },
      receiptFromError: (error) =>
        error instanceof SupervisedTreeModelIdentityError
          ? unknownSupervisedTreeReceipt()
          : undefined,
    })
    if (!paid.succeeded) throw paid.error
    const toArtifact =
      opts.toArtifact ??
      ((result: SupervisedResult<unknown>) => {
        if (result.kind !== 'winner') {
          throw new Error(
            `superviseDispatch: supervised tree ended without a winner (${result.reason})`,
          )
        }
        return result.out as TArtifact
      })
    return toArtifact(paid.value)
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

/** Options for adapting plain agent-eval campaign scenarios into Runtime cells. */
export interface LoopCampaignDispatchOptions<
  Task,
  Output,
  Decision,
  TScenario extends Scenario,
  TArtifact,
> {
  /** Sandbox client used for every campaign cell's `runAgentRounds`. */
  sandboxClient: SandboxClient
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
 * Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for
 * agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
 * the Runtime cell here, and keep paid-call admission, receipts, and traces
 * automatic.
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
 * `ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell
 * inside Eval's paid-call lifecycle.
 */
export function loopDispatch<Task, Output, Decision, TScenario extends Scenario, TArtifact>(
  opts: LoopDispatchOptions<Task, Output, Decision, TScenario, TArtifact>,
): ProfileDispatchFn<TScenario, TArtifact> {
  return (profile, scenario, ctx) => runLoopForCell(opts, scenario, profile, ctx)
}
