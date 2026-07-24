import { randomUUID } from 'node:crypto'
import {
  compareOptimizationMethods,
  type OptimizationMethod,
  type OptimizationMethodComparison,
} from '@tangle-network/agent-eval/campaign'
import type { Scenario } from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
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
import { assertMethodCostRecorded, methodInputWithScopedCost } from './method-cost'
import { buildMethodEvaluationIdentity } from './method-identity'
import {
  assertCandidateSurfaceKind,
  createProfileCandidateMaterializer,
  prepareProfileSurface,
} from './profile-surface'

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

function copyProvenance(
  provenance: NonNullable<OptimizationMethodComparison['best']['provenance']>,
): NonNullable<OptimizationMethodComparison['best']['provenance']> {
  return immutableCandidateValue(provenance)
}

function validateExecutionRef(value: unknown): Sha256Digest {
  const parsed = sha256DigestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ConfigError('improve(): executionRef must be a lowercase sha256:<64 hex> digest')
  }
  return parsed.data
}

export async function runMethodImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  opts: ImproveMethodOptions<TScenario, TArtifact>,
): Promise<ImproveMethodResult> {
  const {
    surface = 'prompt',
    executionRef: inputExecutionRef,
    method: methodSource,
    agent,
    findings: inputFindings = [],
    skills,
    profileComponents,
    optimizationRunOptions,
    minimumLift = 0,
    ...comparisonOptions
  } = opts
  if (!Number.isFinite(minimumLift) || minimumLift < 0) {
    throw new ConfigError(
      'improve(): minimumLift must be a finite number greater than or equal to 0',
    )
  }
  if (profileComponents && surface !== 'agent-profile') {
    throw new ConfigError("improve(): profileComponents is valid only with surface 'agent-profile'")
  }
  const executionRef = validateExecutionRef(inputExecutionRef)
  const findings = [...inputFindings]
  const preparedSurface = prepareProfileSurface(profile, surface, skills, profileComponents)
  const baselineSurface = preparedSurface.surface
  const baselineValue = immutableCandidateValue(preparedSurface.value)
  const baselineProfileDigest = canonicalCandidateDigest(profile)
  const identity = buildMethodEvaluationIdentity({
    executionRef,
    baselineProfileDigest,
    baselineSurface,
    surface,
    skills,
    findings,
    trainScenarios: comparisonOptions.trainScenarios,
    selectionScenarios: comparisonOptions.selectionScenarios,
    judges: comparisonOptions.judges,
    seed: comparisonOptions.seed,
    reps: comparisonOptions.reps,
    costCeiling: comparisonOptions.costCeiling,
    optimizationRunOptions,
  })
  const { evaluationRef, developmentSplitDigest } = identity
  const dispatchRef = `improve:${evaluationRef}`
  const identifiedJudges = comparisonOptions.judges.map((judge, index) =>
    Object.freeze({
      ...judge,
      judgeVersion: canonicalCandidateDigest({
        evaluationRef,
        descriptor: identity.judgeDescriptors[index],
      }),
    }),
  )
  const materializeProfile = createProfileCandidateMaterializer(
    profile,
    surface,
    baselineSurface,
    skills,
    profileComponents,
  )
  const runtimeInvocationId = `runtime-optimization:${randomUUID()}`
  const method = resolveOptimizationMethod(methodSource, {
    profile,
    evaluationRef,
    surface,
    baselineSurface,
    baselineValue,
    findings,
  })
  const measuredMethod: OptimizationMethod<TScenario, TArtifact> = {
    ...method,
    async optimize(input) {
      const scopedInput = methodInputWithScopedCost(input, {
        evaluationRef,
        invocationId: runtimeInvocationId,
      })
      const result = await method.optimize(scopedInput)
      assertMethodCostRecorded(
        method.name,
        result.cost,
        scopedInput.costLedger,
        comparisonOptions.costCeiling,
      )
      materializeProfile(result.winnerSurface)
      return result
    },
  }
  const startedAt = Date.now()
  const raw = await compareOptimizationMethods<TScenario, TArtifact>({
    ...comparisonOptions,
    judges: identifiedJudges,
    dispatchRef,
    optimizationRunOptions: {
      ...(optimizationRunOptions ?? {}),
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
  const score = raw.best
  const winnerSurface = immutableCandidateValue(score.winnerSurface)
  assertCandidateSurfaceKind(surface, baselineSurface, winnerSurface)
  const candidateProfile = materializeProfile(winnerSurface)
  const candidate: ImprovementProfileCandidate = Object.freeze({
    surface,
    value: winnerSurface,
    profile: candidateProfile,
  })

  const cost = copyImproveCost(raw.totalCost)
  return {
    mode: 'method',
    method: method.name,
    ...(score.provenance ? { provenance: copyProvenance(score.provenance) } : {}),
    candidate,
    decision: cost.accountingComplete && score.liftCi.low > minimumLift ? 'ship' : 'hold',
    lift: score.lift,
    liftInterval: { ...score.liftCi },
    cost,
    durationMs: Date.now() - startedAt,
    lineage: Object.freeze({
      invocationId: runtimeInvocationId,
      runId: score.provenance?.runId ?? runtimeInvocationId,
      developmentSplitDigest,
      executionRef,
      baselineProfileDigest,
    }),
    raw,
    async dispose() {},
  }
}
