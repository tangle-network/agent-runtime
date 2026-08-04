import {
  type AgentImprovementProposal,
  type AgentProfile,
  type AgentProfileImprovementMeasuredComparison,
  SANDBOX_SIZE_PRESET_NAMES,
  type SandboxSizePreset,
} from '@tangle-network/agent-interface'

import { canonicalCandidateDigest, immutableCandidateValue } from '../candidate-execution/digest'
import { applyExactAgentProfileDiff, parseExactAgentProfile } from '../candidate-execution/profile'
import { verifyAgentImprovementProposal } from '../intelligence/improvement-cycle'
import canonicalAgentImprovementProposalFixture from './fixtures/agent-improvement-proposal.json'
import canonicalAgentProfileImprovementProposalFixture from './fixtures/agent-profile-improvement-proposal.json'
import canonicalAgentProfileImprovementStateFixture from './fixtures/agent-profile-improvement-state.json'

export {
  type DriverAgentOptions,
  driverAgent,
} from '../runtime/supervise/coordination-driver'
export {
  type RunGraphTestOptions,
  runGraphWithTestBrain,
} from '../runtime/supervise/graph'
export {
  type SuperviseTestOptions,
  superviseWithTestBrain,
} from '../runtime/supervise/supervise'
export {
  type SupervisorAgentTestDeps,
  supervisorAgentWithTestBrain,
} from '../runtime/supervise/supervisor-agent'
export type { ToolLoopCallContext, ToolLoopChat } from '../runtime/tool-loop'

const serializedAgentImprovementProposalFixture = JSON.stringify(
  canonicalAgentImprovementProposalFixture,
)
const serializedAgentProfileImprovementProposalFixture = JSON.stringify(
  canonicalAgentProfileImprovementProposalFixture,
)
const serializedAgentProfileImprovementStateFixture = JSON.stringify(
  canonicalAgentProfileImprovementStateFixture,
)

/** A proposal produced by Runtime's opaque profile-improvement path. */
export type AgentProfileImprovementProposalFixture = Omit<
  AgentImprovementProposal,
  'evaluation'
> & {
  evaluation: AgentProfileImprovementMeasuredComparison
}

/** Complete private state for exercising profile activation and restore in consumer tests. */
export interface AgentProfileImprovementFixture {
  proposal: AgentProfileImprovementProposalFixture
  baselineProfile: AgentProfile
  candidateProfile: AgentProfile
  recommendedSize: SandboxSizePreset
}

/** Load an isolated, production-validated Runtime proposal for consumer tests. */
export function loadAgentImprovementProposalFixture(): AgentImprovementProposal {
  return verifyAgentImprovementProposal(JSON.parse(serializedAgentImprovementProposalFixture))
}

/** Load an isolated profile proposal and its private activation state for consumer tests. */
export function loadAgentProfileImprovementFixture(): AgentProfileImprovementFixture {
  const proposal = loadAgentProfileImprovementProposal()
  const state = parseAgentProfileImprovementState(
    JSON.parse(serializedAgentProfileImprovementStateFixture),
  )
  const experiment = proposal.evaluation.experiment
  const baselineStateDigest = profileStateDigest(state.baselineProfile, state.recommendedSize)
  const candidateStateDigest = profileStateDigest(state.candidateProfile, state.recommendedSize)
  if (
    baselineStateDigest !== experiment.baseline.stateDigest ||
    candidateStateDigest !== experiment.candidate.stateDigest
  ) {
    throw new Error('profile improvement fixture state does not match its proposal')
  }
  const appliedCandidate = experiment.change.reduce(
    (profile, change, index) =>
      applyExactAgentProfileDiff(profile, change, `profile improvement fixture change ${index}`),
    state.baselineProfile,
  )
  if (
    canonicalCandidateDigest(appliedCandidate) !== canonicalCandidateDigest(state.candidateProfile)
  ) {
    throw new Error('profile improvement fixture candidate does not match its proposal changes')
  }
  return immutableCandidateValue({ proposal, ...state })
}

function loadAgentProfileImprovementProposal(): AgentProfileImprovementProposalFixture {
  const proposal = verifyAgentImprovementProposal(
    JSON.parse(serializedAgentProfileImprovementProposalFixture),
  )
  if (proposal.evaluation.kind !== 'agent-profile-improvement-measured-comparison') {
    throw new Error('profile improvement fixture contains a sealed candidate comparison')
  }
  return { ...proposal, evaluation: proposal.evaluation }
}

function parseAgentProfileImprovementState(
  input: unknown,
): Omit<AgentProfileImprovementFixture, 'proposal'> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('profile improvement fixture state must be an object')
  }
  const record = input as Record<string, unknown>
  const fields = Object.keys(record).sort()
  const expectedFields = ['baselineProfile', 'candidateProfile', 'recommendedSize']
  if (
    fields.length !== expectedFields.length ||
    fields.some((field, i) => field !== expectedFields[i])
  ) {
    throw new Error('profile improvement fixture state contains unsupported fields')
  }
  const recommendedSize = SANDBOX_SIZE_PRESET_NAMES.find((size) => size === record.recommendedSize)
  if (!recommendedSize) {
    throw new Error('profile improvement fixture has an invalid recommended size')
  }
  return {
    baselineProfile: parseExactAgentProfile(
      record.baselineProfile,
      'profile improvement fixture baseline',
    ),
    candidateProfile: parseExactAgentProfile(
      record.candidateProfile,
      'profile improvement fixture candidate',
    ),
    recommendedSize,
  }
}

function profileStateDigest(
  profile: AgentProfile,
  recommendedSize: SandboxSizePreset,
): ReturnType<typeof canonicalCandidateDigest> {
  return canonicalCandidateDigest({ definition: profile, recommendedSize })
}
