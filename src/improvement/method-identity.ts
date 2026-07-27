import {
  campaignScenarioIdentity,
  campaignSplitDigestFromIdentities,
  type JudgeConfig,
  type MutableSurface,
  type Scenario,
} from '@tangle-network/agent-eval/campaign'
import type { Sha256Digest } from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import type {
  ImproveCandidateValidator,
  ImproveOptimizationRunOptions,
  ImproveProfileSurface,
  ImproveScenarioPartitions,
  ImproveSkillsOptions,
} from './improve-types'

export interface MethodEvaluationIdentity {
  evaluationRef: Sha256Digest
  developmentSplitDigest: Sha256Digest
  finalTestSplitDigest: Sha256Digest
  scenarioPartitions: ImproveScenarioPartitions
  judgeDescriptors: readonly MethodJudgeDescriptor[]
}

interface MethodJudgeDescriptor {
  name: string
  dimensions: readonly { key: string; description: string }[]
  declaredVersion: string | null
  scoreImplementation: string
  appliesToImplementation: string | null
}

export function buildMethodEvaluationIdentity<TScenario extends Scenario, TArtifact>(input: {
  executionRef: Sha256Digest
  baselineProfileDigest: Sha256Digest
  baselineSurface: MutableSurface
  surface: ImproveProfileSurface
  skills?: ImproveSkillsOptions
  validateCandidate?: ImproveCandidateValidator
  findings: readonly unknown[]
  trainScenarios: readonly TScenario[]
  selectionScenarios: readonly TScenario[]
  testScenarios: readonly TScenario[]
  judges: readonly JudgeConfig<TArtifact, TScenario>[]
  seed?: number
  reps?: number
  costCeiling?: number
  optimizationRunOptions?: ImproveOptimizationRunOptions<TScenario, TArtifact>
}): MethodEvaluationIdentity {
  const optimizationReps = input.optimizationRunOptions?.reps ?? 1
  const finalTestReps = input.reps ?? 1
  const scenarioPartitions = immutableCandidateValue<ImproveScenarioPartitions>({
    train: input.trainScenarios.map(campaignScenarioIdentity),
    selection: input.selectionScenarios.map(campaignScenarioIdentity),
    finalTest: input.testScenarios.map(campaignScenarioIdentity),
    optimizationReps,
    finalTestReps,
  })
  const developmentSplitDigest = canonicalCandidateDigest({
    train: campaignSplitDigestFromIdentities(scenarioPartitions.train, optimizationReps),
    selection: campaignSplitDigestFromIdentities(scenarioPartitions.selection, optimizationReps),
  })
  const finalTestSplitDigest = campaignSplitDigestFromIdentities(
    scenarioPartitions.finalTest,
    finalTestReps,
  )
  const judgeDescriptors = input.judges.map(judgeDescriptor)
  const evaluationRef = canonicalCandidateDigest({
    executionRef: input.executionRef,
    baselineProfileDigest: input.baselineProfileDigest,
    coordinate: profileCoordinate(input.surface, input.baselineSurface, input.skills),
    candidateValidation: input.validateCandidate
      ? Function.prototype.toString.call(input.validateCandidate)
      : null,
    developmentSplitDigest,
    finalTestSplitDigest,
    findings: input.findings,
    judges: judgeDescriptors,
    run: {
      seed: input.seed ?? 42,
      finalReps: input.reps ?? 1,
      optimizationReps,
      costCeiling: input.costCeiling ?? null,
      resumable: input.optimizationRunOptions?.resumable ?? true,
      maxConcurrency: input.optimizationRunOptions?.maxConcurrency ?? 2,
      abortOnCellError: input.optimizationRunOptions?.abortOnCellError ?? false,
      dispatchTimeoutMs: input.optimizationRunOptions?.dispatchTimeoutMs ?? null,
      dispatchShutdownTimeoutMs: input.optimizationRunOptions?.dispatchShutdownTimeoutMs ?? 5_000,
      tracing: input.optimizationRunOptions?.tracing ?? 'on',
      expectUsage: input.optimizationRunOptions?.expectUsage ?? 'warn',
      captureSource: input.optimizationRunOptions?.captureSource ?? null,
      captureSourceVersionHash: input.optimizationRunOptions?.captureSourceVersionHash ?? null,
    },
  })
  return {
    evaluationRef,
    developmentSplitDigest,
    finalTestSplitDigest,
    scenarioPartitions,
    judgeDescriptors,
  }
}

function profileCoordinate(
  surface: ImproveProfileSurface,
  baselineSurface: MutableSurface,
  skills: ImproveSkillsOptions | undefined,
): {
  surface: ImproveProfileSurface
  resourceName: string | null
  componentNames: string[]
} {
  return {
    surface,
    resourceName: surface === 'skills' ? (skills?.resourceName.trim() ?? null) : null,
    componentNames:
      typeof baselineSurface === 'object' &&
      baselineSurface !== null &&
      baselineSurface.kind === 'components'
        ? Object.keys(baselineSurface.components).sort()
        : [],
  }
}

function judgeDescriptor<TScenario extends Scenario, TArtifact>(
  judge: JudgeConfig<TArtifact, TScenario>,
): MethodJudgeDescriptor {
  return {
    name: judge.name,
    dimensions: judge.dimensions.map((dimension) => ({ ...dimension })),
    declaredVersion: judge.judgeVersion ?? null,
    scoreImplementation: Function.prototype.toString.call(judge.score),
    appliesToImplementation: judge.appliesTo
      ? Function.prototype.toString.call(judge.appliesTo)
      : null,
  }
}
