import { assertProposalFindings, type ProposalFinding } from '@tangle-network/agent-eval/analyst'
import type { CampaignScenarioIdentity } from '@tangle-network/agent-eval/campaign'
import {
  type AgentProfileImprovementExperimentExecutionInput,
  measuredComparisonFromAgentProfileImprovementExperiment,
  runAgentProfileImprovementExperiment,
  sealAgentProfileImprovementExperiment,
  verifyAgentProfileImprovementExperimentComparison,
} from '@tangle-network/agent-eval/contract'
import type {
  AgentCandidateLineage,
  AgentImprovementProposal,
  AgentImprovementSource,
  AgentProfile,
  AgentProfileImprovementExecutionRef,
  AgentProfileImprovementExperiment,
  AgentProfileImprovementMeasuredComparison,
  AgentProfileImprovementMeasurement,
  AgentProfileImprovementRunReceipt,
  AgentProfileImprovementSuiteInputs,
  Sha256Digest,
} from '@tangle-network/agent-interface'
import { agentImprovementSourceSchema } from '@tangle-network/agent-interface'
import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { parseExactAgentProfile } from '../candidate-execution/profile'
import {
  type AgentProfileImprovementBenchmark,
  createAgentImprovementProposal,
} from './improvement-cycle'
import { agentImprovementProfileDiffs } from './improvement-surfaces'
import type { AgentImprovementProfileStateDigest } from './profile-activation'
import {
  createProfileImprovementCostLedger,
  profileImprovementMetadata,
  profilePolicyWithBudget,
  profilePreparationAccounting,
  profileStateDigest,
  profileTaskScenarioIdentity,
  sealProfileImprovementBenchmark,
} from './profile-improvement-experiment'

/** Lineage accepted by the direct candidate path. Optimizer lineage belongs to `improve()`. */
export type AuthoredAgentProfileCandidateLineage = Omit<
  AgentCandidateLineage,
  'source' | 'profileDiffIds'
> & {
  source: Exclude<AgentCandidateLineage['source'], 'optimizer'>
  /** Runtime derives these from the exact profile change it seals. */
  profileDiffIds?: never
}

/** Provenance attached while Runtime derives the exact profile diff. */
export type AuthoredAgentProfileDiffOptions = NonNullable<
  Parameters<typeof agentImprovementProfileDiffs>[2]
>

/** Product-owned executor for exact baseline/candidate profile measurement. */
export interface AgentProfileCandidateMeasurementExecutor {
  executionRef: AgentProfileImprovementExecutionRef
  measure(
    input: AgentProfileImprovementExperimentExecutionInput & { profile: AgentProfile },
  ): Promise<AgentProfileImprovementRunReceipt>
}

/**
 * Measure a complete human-authored, imported, or compound profile candidate.
 * No optimizer runs and no optimizer receipt is fabricated.
 */
export interface ProposeAuthoredAgentProfileImprovementOptions {
  runId: string
  source: AgentImprovementSource
  profile: AgentProfile
  stateDigest: AgentImprovementProfileStateDigest
  candidateProfile: AgentProfile
  candidateLineage: AuthoredAgentProfileCandidateLineage
  /** Optional source/artifact metadata used on Runtime-derived profile diff steps. */
  diff?: AuthoredAgentProfileDiffOptions
  findings?: readonly ProposalFinding[]
  benchmark: AgentProfileImprovementBenchmark
  executor: AgentProfileCandidateMeasurementExecutor
  /** One customer-approved maximum for the held-out paired measurement. */
  budgetUsd: number
  /** Optional identities used to prove authored/imported development work is held out. */
  developmentScenarios?: readonly CampaignScenarioIdentity[]
  maxConcurrency?: number
  signal?: AbortSignal
  candidate?: AgentProfileImprovementMeasuredComparison['candidate']
  metadata?: AgentProfileImprovementMeasuredComparison['metadata']
  now?: () => Date
}

export interface ProposeAuthoredAgentProfileImprovementResult {
  candidateProfile: AgentProfile
  candidateLineage: AgentCandidateLineage
  experiment: AgentProfileImprovementExperiment
  measurements: AgentProfileImprovementMeasurement[]
  proposal: AgentImprovementProposal
}

/**
 * Put a complete authored/imported profile through the canonical profile
 * experiment and proposal path without invoking `improve()`.
 */
export async function proposeAuthoredAgentProfileImprovement(
  options: ProposeAuthoredAgentProfileImprovementOptions,
): Promise<ProposeAuthoredAgentProfileImprovementResult> {
  const source = agentImprovementSourceSchema.parse(options.source)
  // Validate and seal caller metadata before allocating a cost ledger or
  // invoking the product-owned executor. Reserved provenance fields and forged
  // optimizer receipts must fail closed without spending measurement budget.
  const metadata = profileImprovementMetadata(options.metadata, source)
  const inputLineage = options.candidateLineage as AgentCandidateLineage
  if (inputLineage.source === 'optimizer') {
    throw new Error('authored profile improvement refuses optimizer lineage; use improve()')
  }
  if (Object.hasOwn(inputLineage, 'profileDiffIds')) {
    throw new Error('authored profile improvement derives candidateLineage.profileDiffIds')
  }
  const findings = immutableCandidateValue([
    ...assertProposalFindings(options.findings ?? [], 'authored profile improvement findings'),
  ])
  const costLedger = createProfileImprovementCostLedger(
    options.budgetUsd,
    'authored profile improvement',
  )
  const preparationStartedAt = performance.now()
  const baselineProfile = parseExactAgentProfile(options.profile, 'authored profile baseline')
  const candidateProfile = parseExactAgentProfile(
    options.candidateProfile,
    'authored profile candidate',
  )
  const baselineStateDigest = profileStateDigest(
    options.stateDigest,
    source.sourceIdentity,
    baselineProfile,
  )
  if (baselineStateDigest !== source.sourceDigest) {
    throw new Error('authored profile source digest does not match the measured profile state')
  }
  const candidateStateDigest = profileStateDigest(
    options.stateDigest,
    source.sourceIdentity,
    candidateProfile,
  )
  if (candidateStateDigest === baselineStateDigest) {
    throw new Error('authored profile candidate state digest matches the baseline')
  }

  const change = agentImprovementProfileDiffs(baselineProfile, candidateProfile, {
    ...options.diff,
    id: options.diff?.id ?? `profile-improvement:${candidateStateDigest}`,
    metadata: {
      ...options.diff?.metadata,
      sourceIdentity: source.sourceIdentity,
      sourceRevision: source.sourceRevision,
    },
  })
  const profileDiffIds = change.map((step) => {
    if (!step.id) throw new Error('authored profile change requires an exact diff id')
    return step.id
  })
  const candidateLineage = immutableCandidateValue<AgentCandidateLineage>({
    ...inputLineage,
    profileDiffIds,
  })
  const policy = profilePolicyWithBudget(
    options.benchmark.policy,
    options.budgetUsd,
    'authored profile',
  )
  const benchmark = sealProfileImprovementBenchmark({ ...options.benchmark, policy })
  assertDirectCandidateReleaseWorkIsFresh(benchmark, candidateLineage, options.developmentScenarios)
  const experiment = sealAgentProfileImprovementExperiment({
    kind: 'agent-profile-improvement-experiment',
    digestAlgorithm: 'rfc8785-sha256',
    source,
    executionRef: options.executor.executionRef,
    baseline: { stateDigest: baselineStateDigest },
    candidate: { stateDigest: candidateStateDigest },
    change,
    candidateLineage,
    benchmark,
    policy,
  })
  const profilesByStateDigest = new Map<Sha256Digest, AgentProfile>([
    [baselineStateDigest, baselineProfile],
    [candidateStateDigest, candidateProfile],
  ])
  const preparation = profilePreparationAccounting(costLedger, preparationStartedAt)
  const run = await runAgentProfileImprovementExperiment({
    experiment,
    ...(options.maxConcurrency === undefined ? {} : { maxConcurrency: options.maxConcurrency }),
    costLedger,
    ...(options.signal ? { signal: options.signal } : {}),
    execute: async (input) => {
      const measuredProfile = profilesByStateDigest.get(input.stateDigest)
      if (!measuredProfile) {
        throw new Error('authored profile execution requested an unknown profile state')
      }
      return options.executor.measure({ ...input, profile: measuredProfile })
    },
  })
  const evaluation = verifyAgentProfileImprovementExperimentComparison(
    measuredComparisonFromAgentProfileImprovementExperiment({
      experiment,
      measurements: run.measurements,
      runId: options.runId,
      ...(options.candidate ? { candidate: options.candidate } : {}),
      generationsExplored: 0,
      preparation,
      measurement: run.measurement,
      metadata,
    }),
  )
  const proposal = createAgentImprovementProposal({
    runId: options.runId,
    findings,
    evaluation,
    ...(options.now ? { now: options.now } : {}),
  })
  return {
    candidateProfile,
    candidateLineage,
    experiment,
    measurements: run.measurements,
    proposal,
  }
}

function assertDirectCandidateReleaseWorkIsFresh(
  benchmark: AgentProfileImprovementSuiteInputs,
  lineage: AgentCandidateLineage,
  developmentScenarios: readonly CampaignScenarioIdentity[] | undefined,
): void {
  if (lineage.developmentSplitDigest === benchmark.suite.splitDigest) {
    throw new Error('authored profile development and held-out splits must be disjoint')
  }
  if (!developmentScenarios || developmentScenarios.length === 0) return
  const development = new Set(developmentScenarios.map(canonicalCandidateDigest))
  const reused = benchmark.tasks
    .map(profileTaskScenarioIdentity)
    .filter((scenario) => development.has(canonicalCandidateDigest(scenario)))
    .map((scenario) => scenario.id)
  if (reused.length > 0) {
    throw new Error(
      `authored profile release reuses development scenario(s): [${reused.join(', ')}]`,
    )
  }
}
