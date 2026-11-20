import { randomUUID } from 'node:crypto'
import type { CostReceipt } from '@tangle-network/agent-eval'
import {
  type CampaignStorage,
  compareOptimizationMethods,
  fsCampaignStorage,
  type OptimizationMethod,
  type OptimizationMethodInput,
  type OptimizationMethodResult,
  type SearchHistoryCoverageRow,
  type SearchHistoryReceipt,
  verifySearchHistoryArtifact,
} from '@tangle-network/agent-eval/campaign'
import type { MutableSurface, Scenario } from '@tangle-network/agent-eval/contract'
import type { AgentProfile, Sha256Digest } from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { copyImproveCost } from './improve-result'
import type {
  ImproveMethodContext,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveMethodSource,
  ImprovementProfileCandidate,
} from './improve-types'
import { assertNoCallerArtifactDescriptor, methodRuntimeControlsOf } from './method-controls'
import {
  assertMethodCostRecorded,
  methodHistoricalReceipts,
  methodInputWithScopedCost,
  methodInvocationCostLedger,
} from './method-cost'
import { prepareProfileImprovement } from './profile-improvement'
import { assertCandidateSurfaceKind } from './profile-surface'

function resolveOptimizationMethod<TScenario extends Scenario, TArtifact>(
  source: ImproveMethodSource<TScenario, TArtifact>,
  context: ImproveMethodContext,
): OptimizationMethod<TScenario, TArtifact> {
  const method = typeof source === 'function' ? source(context) : source
  if (
    !method ||
    typeof method !== 'object' ||
    typeof method.name !== 'string' ||
    method.name.trim() !== method.name ||
    method.name.length === 0 ||
    typeof method.optimize !== 'function'
  ) {
    throw new ConfigError(
      'improve(): method must be a complete OptimizationMethod with a trimmed name and optimize(input)',
    )
  }
  return method
}

/**
 * The comparison's one producer row, read in full: the method's own ledger and,
 * for a method Eval composed (`sequentialOptimizationMethod`,
 * `scopedOptimizationMethod`), every stage's ledger, depth first in run order.
 * Each ledger must be closed and is replayed from its bytes. `searchHistories`
 * is left out when any search behind the winner recorded no ledger, because the
 * lineage is then unknown.
 */
function closedSearchHistories(
  methodName: string,
  producers: readonly SearchHistoryCoverageRow[],
  storage: Pick<CampaignStorage, 'read'>,
): Pick<ImproveMethodResult, 'searchHistory' | 'searchHistories'> {
  const [row] = producers
  if (producers.length !== 1 || row?.producerId !== methodName) {
    const reported = producers.map((producer) => `'${producer.producerId}'`).join(', ')
    throw new ConfigError(
      `improve(): method '${methodName}' needs exactly its own search history row; the comparison reported [${reported}]`,
    )
  }
  const receipts: SearchHistoryReceipt[] = []
  let lineageKnown = true
  const read = (current: SearchHistoryCoverageRow, stagePath: readonly string[]): void => {
    const { receipt, stages = [] } = current
    if (receipt) {
      if (!receipt.complete) {
        const stage = stagePath.length > 0 ? ` stage '${stagePath.join(' > ')}'` : ''
        throw new ConfigError(
          `improve(): method '${methodName}'${stage} returned an open search ledger: ${receipt.incompleteReasons.join('; ')}`,
        )
      }
      verifySearchHistoryArtifact(receipt, storage)
      receipts.push(receipt)
    } else if (stages.length === 0) {
      lineageKnown = false
    }
    for (const stage of stages) read(stage, [...stagePath, stage.producerId])
  }
  read(row, [])
  return {
    searchHistory: row.receipt ?? null,
    ...(lineageKnown ? { searchHistories: Object.freeze(receipts) } : {}),
  }
}

/**
 * Run one complete method, then compare its winner with the baseline on the
 * held-out test split. A method that records its search (GEPA and SkillOpt do
 * through `officialGepa` and `officialSkillOpt`) must close its ledger, and so
 * must every stage of a method Eval composed; Runtime replays the bytes and
 * returns the receipts. `searchHistory` is the method's own ledger and is
 * `null` when the method recorded none itself; `searchHistories` holds every
 * ledger behind the winner and is absent when any search recorded none.
 */
export async function runMethodImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult> {
  assertNoCallerArtifactDescriptor(opts, 'improve()')
  const {
    surface: _surface,
    executionRef: _executionRef,
    method: methodSource,
    agent,
    validateCandidate: _validateCandidate,
    findings: _findings,
    skills: _skills,
    profileComponents: _profileComponents,
    optimizationRunOptions,
    minimumLift: _minimumLift,
    subject: _subject,
    ...comparisonOptions
  } = opts
  const prepared = prepareProfileImprovement(profile, opts)
  const {
    surface,
    identity,
    invocationId,
    baselineSurface,
    materializeProfile,
    validateMaterialized,
    minimumLift,
  } = prepared
  const { evaluationRef, developmentSplitDigest, finalTestSplitDigest, scenarioPartitions } =
    identity
  const dispatchRef = `improve:${evaluationRef}`
  const method = resolveOptimizationMethod(methodSource, {
    profile,
    evaluationRef,
    surface,
    baselineSurface,
    baselineValue: prepared.baselineValue,
    findings: prepared.findings,
    searchIdentity: prepared.searchIdentity,
  })
  const costScope = { evaluationRef: identity.evaluationRef, invocationId }
  const invoke = async (
    current: OptimizationMethod<TScenario, TArtifact>,
    input: OptimizationMethodInput<TScenario, TArtifact>,
  ): Promise<{ result: OptimizationMethodResult; historical: readonly CostReceipt[] }> => {
    const controls = methodRuntimeControlsOf(current)
    const scope = { ...costScope, methodTag: `runtimeMethod:${randomUUID()}` }
    // Every enclosing scope must preserve explicit optimizerRun reads from previous invocations.
    const scopedInput = methodInputWithScopedCost(input, scope, 'optimizer-run')
    const invocationLedger = methodInvocationCostLedger(scopedInput.costLedger, scope)
    const historical = new Map<string, CostReceipt>()
    let children = 0
    const checked = new Set<Sha256Digest>()
    const toRoot = (value: MutableSurface): MutableSurface =>
      immutableCandidateValue(input.surfaceToRoot?.(immutableCandidateValue(value)) ?? value)
    const currentBaselineDigest = canonicalCandidateDigest(toRoot(input.baselineSurface))
    const check = (value: MutableSurface): void => {
      const rootSurface = toRoot(value)
      const candidateDigest = canonicalCandidateDigest(rootSurface)
      if (checked.has(candidateDigest)) return
      validateMaterialized(
        controls?.validateCandidate,
        materializeProfile(rootSurface),
        rootSurface,
        candidateDigest === currentBaselineDigest,
      )
      checked.add(candidateDigest)
    }
    check(input.baselineSurface)
    const result = await current.optimize(
      Object.freeze({
        ...scopedInput,
        invokeMethod: async (
          child: OptimizationMethod<TScenario, TArtifact>,
          childInput: OptimizationMethodInput<TScenario, TArtifact>,
        ) => {
          const verified = await invoke(child, childInput)
          children += 1
          for (const receipt of verified.historical) historical.set(receipt.callId, receipt)
          return verified.result
        },
        dispatchWithSurface: (
          ...[value, scenario, context]: Parameters<
            OptimizationMethodInput<TScenario, TArtifact>['dispatchWithSurface']
          >
        ) => {
          check(value)
          return input.dispatchWithSurface(value, scenario, context)
        },
      }),
    )
    check(result.winnerSurface)
    assertMethodCostRecorded(
      current.name,
      result,
      scopedInput.costLedger,
      invocationLedger,
      comparisonOptions.costCeiling,
      children > 0 ? 'invocation' : controls?.costAttribution,
      [...historical.values()],
    )
    if (controls?.costAttribution === 'optimizer-run' && result.provenance?.runId) {
      for (const receipt of methodHistoricalReceipts(
        scopedInput.costLedger,
        result.provenance.runId,
        invocationId,
      ))
        historical.set(receipt.callId, receipt)
    }
    return { result, historical: [...historical.values()] }
  }
  const measuredMethod: OptimizationMethod<TScenario, TArtifact> = {
    ...method,
    async optimize(input) {
      const scopedInput = methodInputWithScopedCost(input, costScope, 'optimizer-run')
      return (await invoke(method, scopedInput)).result
    },
  }
  // The method writes its search ledger where Runtime reads it back.
  const methodStorage =
    optimizationRunOptions?.storage ?? comparisonOptions.storage ?? fsCampaignStorage()
  const startedAt = Date.now()
  const raw = await compareOptimizationMethods<TScenario, TArtifact>({
    ...comparisonOptions,
    judges: prepared.judges,
    dispatchRef,
    optimizationRunOptions: {
      ...(optimizationRunOptions ?? {}),
      storage: methodStorage,
      dispatchRef,
    },
    methods: [measuredMethod],
    baselineSurface,
    dispatchWithSurface: (candidateSurface, scenario, ctx) =>
      agent(materializeProfile(candidateSurface), scenario, ctx),
  })
  if (
    comparisonOptions.costCeiling !== undefined &&
    raw.totalCost.totalCostUsd > comparisonOptions.costCeiling
  ) {
    throw new ConfigError(
      `improve(): reported total cost $${raw.totalCost.totalCostUsd} exceeds costCeiling $${comparisonOptions.costCeiling}`,
    )
  }
  const { searchHistory, searchHistories } = closedSearchHistories(
    method.name,
    raw.searchHistory.producers,
    methodStorage,
  )
  const score = raw.best
  const winnerSurface = immutableCandidateValue(score.winnerSurface)
  assertCandidateSurfaceKind(surface, baselineSurface, winnerSurface)
  const candidate: ImprovementProfileCandidate = Object.freeze({
    surface,
    value: winnerSurface,
    profile: materializeProfile(winnerSurface),
  })
  const cost = copyImproveCost(raw.totalCost)
  return {
    mode: 'method',
    method: method.name,
    ...(score.provenance ? { provenance: immutableCandidateValue(score.provenance) } : {}),
    candidate,
    decision:
      cost.accountingComplete && score.decision.promote && score.decision.low > minimumLift
        ? 'ship'
        : 'hold',
    lift: score.lift,
    liftInterval: { ...score.liftCi },
    searchHistory,
    ...(searchHistories ? { searchHistories } : {}),
    cost,
    durationMs: Date.now() - startedAt,
    lineage: Object.freeze({
      invocationId,
      runId: score.provenance?.runId ?? invocationId,
      developmentSplitDigest,
      finalTestSplitDigest,
      scenarioPartitions,
      executionRef: prepared.executionRef,
      baselineProfileDigest: prepared.baselineProfileDigest,
    }),
    raw,
    async dispose() {},
  }
}
