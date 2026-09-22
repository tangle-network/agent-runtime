import {
  type AgentImprovementProposal,
  verifyAgentImprovementProposal,
} from '../intelligence/improvement-cycle'
import canonicalAgentImprovementProposalFixture from './fixtures/agent-improvement-proposal.json'

const serializedAgentImprovementProposalFixture = JSON.stringify(
  canonicalAgentImprovementProposalFixture,
)

/** Load an isolated, production-validated Runtime proposal for consumer tests. */
export function loadAgentImprovementProposalFixture(): AgentImprovementProposal {
  return verifyAgentImprovementProposal(JSON.parse(serializedAgentImprovementProposalFixture))
}
