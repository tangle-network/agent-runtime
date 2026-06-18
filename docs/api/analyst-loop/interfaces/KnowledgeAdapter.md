[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / KnowledgeAdapter

# Interface: KnowledgeAdapter\<TProposal\>

Defined in: [analyst-loop/types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L25)

Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge.

## Type Parameters

### TProposal

`TProposal` = `unknown`

## Methods

### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`KnowledgeProposalBatch`](KnowledgeProposalBatch.md)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](KnowledgeProposalBatch.md)\<`TProposal`\>\>

Defined in: [analyst-loop/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L32)

Convert a findings batch into proposals. Returns the partitioned
result so the loop can report (and optionally fail on) malformed
findings. Implementations SHOULD honour the convention "non-
knowledge subjects return null and are counted in `skipped`."

#### Parameters

##### findings

readonly `AnalystFinding`[]

#### Returns

[`KnowledgeProposalBatch`](KnowledgeProposalBatch.md)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](KnowledgeProposalBatch.md)\<`TProposal`\>\>

***

### apply()?

> `optional` **apply**(`proposals`): `Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [analyst-loop/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L41)

Optional auto-apply. The loop calls this only when
`autoApply.knowledge` is true AND the proposal's source-finding
confidence ≥ `autoApply.knowledgeConfidenceThreshold`. Anything
below the threshold is returned in the report but never written.

#### Parameters

##### proposals

readonly `TProposal`[]

#### Returns

`Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>
