[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / testing

# testing

## Interfaces

### AgentProfileImprovementFixture

Complete private state for exercising profile activation and restore in consumer tests.

#### Properties

##### proposal

> **proposal**: [`AgentProfileImprovementProposalFixture`](#agentprofileimprovementproposalfixture)

##### baselineProfile

> **baselineProfile**: `AgentProfile`

##### candidateProfile

> **candidateProfile**: `AgentProfile`

##### recommendedSize

> **recommendedSize**: `"nano"` \| `"small"` \| `"medium"` \| `"large"`

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

### loadAgentProfileImprovementFixture()

> **loadAgentProfileImprovementFixture**(): [`AgentProfileImprovementFixture`](#agentprofileimprovementfixture)

Load an isolated profile proposal and its private activation state for consumer tests.

#### Returns

[`AgentProfileImprovementFixture`](#agentprofileimprovementfixture)
