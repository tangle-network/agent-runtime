import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { assertProposalFindings } from '@tangle-network/agent-eval/analyst'
import {
  type CampaignStorage,
  compareOptimizationMethods,
  decodeExternalTextCandidate,
  type OptimizationMethod,
  type OptimizationMethodComparison,
  readExternalOptimizerObservationArtifact,
  readGepaCandidatePopulationArtifact,
} from '@tangle-network/agent-eval/campaign'
import type { MutableSurface, Scenario } from '@tangle-network/agent-eval/contract'
import {
  type AgentProfile,
  applyAgentProfileDiff,
  diffAgentProfiles,
  canonicalCandidateDigest as interfaceCandidateDigest,
  type Sha256Digest,
  sha256DigestSchema,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import { copyImproveCost } from './improve-result'
import type {
  ImproveCandidateValidationInput,
  ImproveMethodContext,
  ImproveMethodOptions,
  ImproveMethodResult,
  ImproveMethodSource,
  ImprovementProfileCandidate,
  ImprovementProfileCandidatePopulation,
  ImprovementProfilePopulationCandidateSource,
  ImprovementProfilePopulationLineageNode,
} from './improve-types'
import { methodRuntimeControlsOf } from './method-controls'
import {
  assertMethodCostRecorded,
  methodInputWithScopedCost,
  methodInvocationCostLedger,
} from './method-cost'
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

function materializationError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: error.message }
  }
  return {
    name: 'Error',
    message:
      typeof error === 'string' ? error : 'candidate materialization threw a non-Error value',
  }
}

function profileCandidatePopulation(
  provenance: OptimizationMethodComparison['best']['provenance'],
  baselineProfile: AgentProfile,
  materializeProfile: (candidateSurface: MutableSurface) => AgentProfile,
  winnerSurface: MutableSurface,
  storage?: CampaignStorage,
): ImprovementProfileCandidatePopulation {
  const observationSummary = provenance?.observations
  const graphSummary = provenance?.gepaCandidatePopulation
  if (!observationSummary && !graphSummary) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'method-did-not-report-candidate-population',
    })
  }

  const observations = observationSummary
    ? readExternalOptimizerObservationArtifact({
        summary: observationSummary,
        ...(storage ? { storage } : {}),
      })
    : undefined
  const graph = graphSummary
    ? readGepaCandidatePopulationArtifact({
        summary: graphSummary,
        ...(storage ? { storage } : {}),
      })
    : undefined
  if (!graph && (observations?.candidates.length ?? 0) === 0) {
    return Object.freeze({
      status: 'unavailable',
      reason: 'method-did-not-report-candidate-population',
    })
  }
  interface PopulationEntry {
    candidateDigest: Sha256Digest
    value: MutableSurface
    observation?: {
      proposalSequence: number
      artifact: { path: string; sha256: Sha256Digest }
    }
    lineageNodes: ImprovementProfilePopulationLineageNode[]
  }
  const entries = new Map<Sha256Digest, PopulationEntry>()
  const entryFor = (candidateDigest: Sha256Digest, value: MutableSurface): PopulationEntry => {
    const existing = entries.get(candidateDigest)
    if (existing) {
      if (!isDeepStrictEqual(existing.value, value)) {
        throw new Error(`improve(): optimizer artifacts disagree on candidate ${candidateDigest}`)
      }
      return existing
    }
    const entry: PopulationEntry = {
      candidateDigest,
      value: immutableCandidateValue(value),
      lineageNodes: [],
    }
    entries.set(candidateDigest, entry)
    return entry
  }

  for (const submitted of observations?.candidates ?? []) {
    const entry = entryFor(
      submitted.candidateDigest,
      decodeExternalTextCandidate(submitted.candidate),
    )
    entry.observation = {
      proposalSequence: submitted.proposalSequence,
      artifact: {
        path: submitted.provenance.path,
        sha256: submitted.provenance.sha256,
      },
    }
  }
  for (const graphCandidate of graph?.candidates ?? []) {
    const entry = entryFor(
      graphCandidate.candidateDigest,
      decodeExternalTextCandidate(graphCandidate.candidate),
    )
    entry.lineageNodes.push({
      index: graphCandidate.index,
      parentIndices: [...graphCandidate.parentIndices],
      aggregateScore: graphCandidate.aggregateScore,
      selectionScores: graphCandidate.selectionScores.map((score) => ({ ...score })),
      discoveryEvaluationCount: graphCandidate.discoveryEvaluationCount,
    })
  }

  if (graph) {
    const best = graph.candidates.find((candidate) => candidate.index === graph.bestIndex)
    if (!best) {
      throw new ConfigError(
        `improve(): GEPA candidate population has no bestIndex node ${graph.bestIndex}`,
      )
    }
    const verifiedBest = decodeExternalTextCandidate(best.candidate)
    if (!isDeepStrictEqual(verifiedBest, winnerSurface)) {
      throw new ConfigError(
        'improve(): method winner does not equal the verified GEPA bestIndex candidate',
      )
    }
  } else if (
    ![...entries.values()].some((entry) => isDeepStrictEqual(entry.value, winnerSurface))
  ) {
    throw new ConfigError(
      'improve(): method winner does not appear in the verified optimizer observations',
    )
  }

  let materializedCandidates = 0
  let refusedCandidates = 0
  const candidates = [...entries.values()].map((entry) => {
    const source: ImprovementProfilePopulationCandidateSource = {
      candidateDigest: entry.candidateDigest,
      ...(entry.observation ? { observation: entry.observation } : {}),
      lineage:
        entry.lineageNodes.length > 0 && graph
          ? {
              status: 'available',
              artifact: {
                path: graph.summary.path,
                sha256: graph.summary.sha256,
              },
              nodes: entry.lineageNodes,
            }
          : {
              status: 'unavailable',
              reason: 'optimizer-did-not-report-candidate-lineage',
            },
    }
    const surfaceDigest = interfaceCandidateDigest(entry.value)
    let candidateProfile: AgentProfile
    try {
      candidateProfile = materializeProfile(entry.value)
    } catch (error) {
      refusedCandidates += 1
      return {
        status: 'refused' as const,
        source,
        value: entry.value,
        surfaceDigest,
        error: materializationError(error),
      }
    }

    const profileDigest = interfaceCandidateDigest(candidateProfile)
    const diffs = diffAgentProfiles(baselineProfile, candidateProfile)
    const reproduced = diffs.reduce(applyAgentProfileDiff, baselineProfile)
    if (interfaceCandidateDigest(reproduced) !== profileDigest) {
      throw new Error(
        `improve(): Interface profile diffs do not reproduce optimizer candidate ${entry.candidateDigest}`,
      )
    }
    materializedCandidates += 1
    return {
      status: 'materialized' as const,
      source,
      value: entry.value,
      surfaceDigest,
      profile: candidateProfile,
      profileDigest,
      diffs,
      diffDigests: diffs.map(interfaceCandidateDigest),
    }
  })

  return immutableCandidateValue({
    status: 'available',
    source: {
      ...(observations
        ? {
            observations: {
              path: observations.summary.path,
              sha256: observations.summary.sha256,
            },
          }
        : {}),
      ...(graph
        ? {
            gepaCandidateGraph: {
              path: graph.summary.path,
              sha256: graph.summary.sha256,
              bestIndex: graph.bestIndex,
            },
          }
        : {}),
    },
    uniqueCandidates: entries.size,
    observedCandidates: observations?.candidates.length ?? 0,
    gepaCandidateNodes: graph?.candidates.length ?? 0,
    materializedCandidates,
    refusedCandidates,
    candidates,
  })
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
    validateCandidate,
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
  const findings = immutableCandidateValue([
    ...assertProposalFindings(inputFindings, 'improve() method findings'),
  ])
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
    validateCandidate,
    findings,
    trainScenarios: comparisonOptions.trainScenarios,
    selectionScenarios: comparisonOptions.selectionScenarios,
    testScenarios: comparisonOptions.testScenarios,
    judges: comparisonOptions.judges,
    seed: comparisonOptions.seed,
    reps: comparisonOptions.reps,
    costCeiling: comparisonOptions.costCeiling,
    optimizationRunOptions,
  })
  const { evaluationRef, developmentSplitDigest, finalTestSplitDigest, scenarioPartitions } =
    identity
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
  const rawMaterializeProfile = createProfileCandidateMaterializer(
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
  const methodControls = methodRuntimeControlsOf(method)
  const baselineSurfaceDigest = canonicalCandidateDigest(baselineSurface)
  const validatedCandidates = new Set<Sha256Digest>()
  const materializeProfile = (
    candidateSurface: Parameters<typeof rawMaterializeProfile>[0],
  ): ReturnType<typeof rawMaterializeProfile> => {
    const candidate = rawMaterializeProfile(candidateSurface)
    const candidateDigest = canonicalCandidateDigest(candidateSurface)
    if (!validatedCandidates.has(candidateDigest)) {
      const prepared = prepareProfileSurface(candidate, surface, skills, profileComponents)
      const validationInput: ImproveCandidateValidationInput = Object.freeze({
        profile: candidate,
        surface,
        candidateSurface: immutableCandidateValue(candidateSurface),
        value: immutableCandidateValue(prepared.value),
        isBaseline: candidateDigest === baselineSurfaceDigest,
      })
      methodControls?.validateCandidate(validationInput)
      validateCandidate?.(validationInput)
      validatedCandidates.add(candidateDigest)
    }
    return candidate
  }
  materializeProfile(baselineSurface)
  const measuredMethod: OptimizationMethod<TScenario, TArtifact> = {
    ...method,
    async optimize(input) {
      const costScope = {
        evaluationRef,
        invocationId: runtimeInvocationId,
      }
      const scopedInput = methodInputWithScopedCost(
        input,
        costScope,
        methodControls?.costAttribution,
      )
      const invocationLedger = methodInvocationCostLedger(input.costLedger, costScope)
      const result = await method.optimize(scopedInput)
      assertMethodCostRecorded(
        method.name,
        result,
        scopedInput.costLedger,
        invocationLedger,
        comparisonOptions.costCeiling,
        methodControls?.costAttribution,
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
  const candidatePopulation = profileCandidatePopulation(
    score.provenance,
    profile,
    materializeProfile,
    winnerSurface,
    optimizationRunOptions?.storage,
  )

  const cost = copyImproveCost(raw.totalCost)
  return {
    mode: 'method',
    method: method.name,
    ...(score.provenance ? { provenance: copyProvenance(score.provenance) } : {}),
    candidate,
    decision: cost.accountingComplete && score.liftCi.low > minimumLift ? 'ship' : 'hold',
    lift: score.lift,
    liftInterval: { ...score.liftCi },
    candidatePopulation,
    cost,
    durationMs: Date.now() - startedAt,
    lineage: Object.freeze({
      invocationId: runtimeInvocationId,
      runId: score.provenance?.runId ?? runtimeInvocationId,
      developmentSplitDigest,
      finalTestSplitDigest,
      scenarioPartitions,
      executionRef,
      baselineProfileDigest,
    }),
    raw,
    async dispose() {},
  }
}
