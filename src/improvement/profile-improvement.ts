/**
 * What every profile improvement prepares before any optimizer or search runs:
 * the exact surface and its baseline, the evaluation identity, identified
 * judges, the identities a search ledger records, and one materializer that
 * admits a candidate only after the held-out and caller checks. `improve()`
 * with an external method and with `searchMethod` share it, so a candidate is
 * materialized and admitted the same way on both paths.
 */

import { randomUUID } from 'node:crypto'
import type { ProposalFinding } from '@tangle-network/agent-eval'
import { assertProposalFindings } from '@tangle-network/agent-eval/analyst'
import type {
  JudgeConfig,
  MutableSurface,
  Scenario,
  SearchModelIdentity,
} from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfile,
  canonicalAgentProfileDigest,
  type Sha256Digest,
} from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { ConfigError } from '../errors'
import {
  assertCandidateValidator,
  assertProfileTrainingIsHeldOut,
  parseExecutionRef,
  validateProfileCandidate,
} from './candidate-validation'
import type {
  ImproveCandidateValidator,
  ImproveMethodOptions,
  ImproveOptimizationRunOptions,
  ImproveProfileSurface,
  ImproveSearchIdentity,
} from './improve-types'
import { buildMethodEvaluationIdentity, type MethodEvaluationIdentity } from './method-identity'
import { createProfileCandidateMaterializer, prepareProfileSurface } from './profile-surface'

/** The options both improvement paths read before they diverge. */
export type ProfileImprovementInput<TScenario extends Scenario, TArtifact> = Pick<
  ImproveMethodOptions<TScenario, TArtifact>,
  | 'surface'
  | 'executionRef'
  | 'validateCandidate'
  | 'findings'
  | 'skills'
  | 'profileComponents'
  | 'minimumLift'
  | 'subject'
  | 'trainScenarios'
  | 'selectionScenarios'
  | 'testScenarios'
  | 'judges'
  | 'seed'
  | 'costCeiling'
> & {
  reps?: number
  optimizationRunOptions?: ImproveOptimizationRunOptions<TScenario, TArtifact>
}

export interface PreparedProfileImprovement<TScenario extends Scenario, TArtifact> {
  profile: AgentProfile
  surface: ImproveProfileSurface
  executionRef: Sha256Digest
  findings: ReadonlyArray<ProposalFinding>
  minimumLift: number
  baselineSurface: MutableSurface
  baselineValue: unknown
  baselineProfileDigest: Sha256Digest
  identity: MethodEvaluationIdentity
  /** Unique id of this invocation, which scopes its cost receipts. */
  invocationId: string
  /** Judges carrying a `judgeVersion` derived from the evaluation identity. */
  judges: JudgeConfig<TArtifact, TScenario>[]
  searchIdentity: ImproveSearchIdentity
  /** The surface a profile holds at the searched coordinate. */
  surfaceOf(candidate: AgentProfile): MutableSurface
  /** Materialize a candidate surface without admitting it. */
  materializeCandidate(candidateSurface: MutableSurface): AgentProfile
  /** Refuse a materialized candidate unless it passes the held-out check and
   * the caller's validator; each surface is checked once. */
  admitCandidate(candidate: AgentProfile, candidateSurface: MutableSurface): void
  /** Materialize and admit a candidate surface. */
  materializeProfile(candidateSurface: MutableSurface): AgentProfile
  /** Run one validator on an exact materialized candidate. */
  validateMaterialized(
    validator: ImproveCandidateValidator | undefined,
    candidate: AgentProfile,
    candidateSurface: MutableSurface,
    isBaseline: boolean,
  ): void
}

export function prepareProfileImprovement<TScenario extends Scenario, TArtifact>(
  profile: AgentProfile,
  input: ProfileImprovementInput<TScenario, TArtifact>,
): PreparedProfileImprovement<TScenario, TArtifact> {
  const {
    surface = 'prompt',
    validateCandidate,
    skills,
    profileComponents,
    minimumLift = 0,
  } = input
  assertCandidateValidator(validateCandidate)
  if (!Number.isFinite(minimumLift) || minimumLift < 0) {
    throw new ConfigError(
      'improve(): minimumLift must be a finite number greater than or equal to 0',
    )
  }
  if (profileComponents && surface !== 'agent-profile') {
    throw new ConfigError("improve(): profileComponents is valid only with surface 'agent-profile'")
  }
  if (
    input.subject !== undefined &&
    (typeof input.subject !== 'string' ||
      !input.subject.trim() ||
      input.subject !== input.subject.trim())
  ) {
    throw new ConfigError('improve(): subject must be a trimmed non-empty string')
  }
  const executionRef = parseExecutionRef(input.executionRef, 'improve()')
  const findings = immutableCandidateValue([
    ...assertProposalFindings(input.findings ?? [], 'improve() method findings'),
  ])
  const preparedSurface = prepareProfileSurface(profile, surface, skills, profileComponents)
  const baselineSurface = preparedSurface.surface
  const baselineValue = immutableCandidateValue(preparedSurface.value)
  const baselineProfileDigest = canonicalAgentProfileDigest(profile)
  const identity = buildMethodEvaluationIdentity({
    executionRef,
    baselineProfileDigest,
    baselineSurface,
    surface,
    skills,
    validateCandidate,
    findings,
    trainScenarios: input.trainScenarios,
    selectionScenarios: input.selectionScenarios,
    testScenarios: input.testScenarios,
    judges: input.judges,
    seed: input.seed,
    reps: input.reps,
    costCeiling: input.costCeiling,
    optimizationRunOptions: input.optimizationRunOptions,
  })
  const judges = input.judges.map((judge, index) =>
    Object.freeze({
      ...judge,
      judgeVersion: canonicalCandidateDigest({
        evaluationRef: identity.evaluationRef,
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
  const baselineSurfaceDigest = canonicalCandidateDigest(baselineSurface)
  const heldOutDigests = new Set(
    identity.scenarioPartitions.finalTest.map((task) => task.scenarioDigest),
  )
  const validatedCandidates = new Set<Sha256Digest>()
  const validateMaterialized: PreparedProfileImprovement<
    TScenario,
    TArtifact
  >['validateMaterialized'] = (validator, candidate, candidateSurface, isBaseline) => {
    const prepared = prepareProfileSurface(candidate, surface, skills, profileComponents)
    validateProfileCandidate(validator, {
      profile: candidate,
      surface,
      candidateSurface,
      value: immutableCandidateValue(prepared.value),
      isBaseline,
    })
  }
  const admitCandidate = (candidate: AgentProfile, candidateSurface: MutableSurface): void => {
    const candidateDigest = canonicalCandidateDigest(candidateSurface)
    if (validatedCandidates.has(candidateDigest)) return
    assertProfileTrainingIsHeldOut(candidate, heldOutDigests)
    validateMaterialized(
      validateCandidate,
      candidate,
      immutableCandidateValue(candidateSurface),
      candidateDigest === baselineSurfaceDigest,
    )
    validatedCandidates.add(candidateDigest)
  }
  const materializeProfile = (candidateSurface: MutableSurface): AgentProfile => {
    const candidate = rawMaterializeProfile(candidateSurface)
    admitCandidate(candidate, candidateSurface)
    return candidate
  }
  materializeProfile(baselineSurface)
  return {
    profile,
    surface,
    executionRef,
    findings,
    minimumLift,
    baselineSurface,
    baselineValue,
    baselineProfileDigest,
    identity,
    invocationId: `runtime-optimization:${randomUUID()}`,
    judges,
    searchIdentity: Object.freeze({
      subject: input.subject ?? profile.name ?? 'agent-profile',
      agent: { uri: 'agent-runtime:improve-execution-ref', revision: executionRef },
      judge: {
        uri: 'agent-runtime:improve-judges',
        revision: canonicalCandidateDigest(identity.judgeDescriptors),
      },
      model: profileModel(profile),
    }),
    surfaceOf: (candidate) =>
      prepareProfileSurface(candidate, surface, skills, profileComponents).surface,
    materializeCandidate: rawMaterializeProfile,
    admitCandidate,
    materializeProfile,
    validateMaterialized,
  }
}

/** The profile's model hint as a moving alias; each cell records what it resolved. */
function profileModel(profile: AgentProfile): SearchModelIdentity {
  const hint = profile.model?.default
  if (!hint) {
    return {
      provider: 'unspecified',
      alias: 'unspecified',
      unknown: 'the profile names no model; each cell records the model it resolved',
    }
  }
  return {
    provider: profile.model?.provider ?? 'unspecified',
    alias: hint,
    unknown:
      'the profile names a model hint, not a snapshot; each cell records the model it resolved',
  }
}
