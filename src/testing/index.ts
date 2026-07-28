import type {
  AgentImprovementProposal,
  AgentProfileImprovementMeasuredComparison,
} from '@tangle-network/agent-interface'

import { verifyAgentImprovementProposal } from '../intelligence/improvement-cycle'
import canonicalAgentImprovementProposalFixture from './fixtures/agent-improvement-proposal.json'
import canonicalAgentProfileImprovementProposalFixture from './fixtures/agent-profile-improvement-proposal.json'

const serializedAgentImprovementProposalFixture = JSON.stringify(
  canonicalAgentImprovementProposalFixture,
)
const serializedAgentProfileImprovementProposalFixture = JSON.stringify(
  canonicalAgentProfileImprovementProposalFixture,
)

/** A proposal produced by Runtime's opaque profile-improvement path. */
export type AgentProfileImprovementProposalFixture = Omit<
  AgentImprovementProposal,
  'evaluation'
> & {
  evaluation: AgentProfileImprovementMeasuredComparison
}

/** Load an isolated, production-validated Runtime proposal for consumer tests. */
export function loadAgentImprovementProposalFixture(): AgentImprovementProposal {
  return verifyAgentImprovementProposal(JSON.parse(serializedAgentImprovementProposalFixture))
}

/** Load an isolated proposal containing profile state hashes and diffs, never profiles. */
export function loadAgentProfileImprovementProposalFixture(): AgentProfileImprovementProposalFixture {
  const proposal = verifyAgentImprovementProposal(
    JSON.parse(serializedAgentProfileImprovementProposalFixture),
  )
  if (proposal.evaluation.kind !== 'agent-profile-improvement-measured-comparison') {
    throw new Error('profile improvement fixture contains a sealed candidate comparison')
  }
  return { ...proposal, evaluation: proposal.evaluation }
}
