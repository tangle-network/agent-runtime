[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / testing

# testing

## Type Aliases

### AgentProfileImprovementProposalFixture

> **AgentProfileImprovementProposalFixture** = `Omit`\<`AgentImprovementProposal`, `"evaluation"`\> & `object`

A proposal produced by Runtime's opaque profile-improvement path.

#### Type Declaration

##### evaluation

> **evaluation**: `AgentProfileImprovementMeasuredComparison`

## Functions

### loadAgentImprovementProposalFixture()

> **loadAgentImprovementProposalFixture**(): `AgentImprovementProposal`

Load an isolated, production-validated Runtime proposal for consumer tests.

#### Returns

`AgentImprovementProposal`

***

### loadAgentProfileImprovementProposalFixture()

> **loadAgentProfileImprovementProposalFixture**(): [`AgentProfileImprovementProposalFixture`](#agentprofileimprovementproposalfixture)

Load an isolated proposal containing profile state hashes and diffs, never profiles.

#### Returns

[`AgentProfileImprovementProposalFixture`](#agentprofileimprovementproposalfixture)
