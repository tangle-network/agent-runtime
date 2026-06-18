[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [agent](../README.md) / KnowledgeAdapterDeps

# Interface: KnowledgeAdapterDeps\<TProposal\>

Defined in: [agent/knowledge-adapter.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L40)

Build the adapter. We accept the agent-knowledge functions as DI so
the substrate stays decoupled from a specific agent-knowledge
version — the agent author imports them in their manifest module
and hands them to the factory.

`proposeFromFindings(findings)` returns
  `{ proposals: KnowledgeProposal[]; skipped: number; errors: ... }`.

`applyKnowledgeWriteBlocks(root, content)` returns
  `{ written: string[]; warnings: string[] }`.

`lintKnowledgeIndex(index)` (optional) returns `KnowledgeLintFinding[]`.

## Type Parameters

### TProposal

`TProposal`

## Properties

### proposeFromFindings

> **proposeFromFindings**: (`findings`) => `object`

Defined in: [agent/knowledge-adapter.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L41)

#### Parameters

##### findings

readonly `AnalystFinding`[]

#### Returns

`object`

##### proposals

> **proposals**: `TProposal`[]

##### skipped

> **skipped**: `number`

##### errors

> **errors**: `object`[]

***

### applyKnowledgeWriteBlocks

> **applyKnowledgeWriteBlocks**: (`root`, `proposalText`) => `Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [agent/knowledge-adapter.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L46)

#### Parameters

##### root

`string`

##### proposalText

`string`

#### Returns

`Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

***

### lintAfterApply?

> `optional` **lintAfterApply?**: (`root`) => `Promise`\<readonly `string`[]\>

Defined in: [agent/knowledge-adapter.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L55)

Optional post-apply lint hook. The substrate runs it after each
batch of writes; failures land in `warnings` (the apply is not
rolled back — lint signals drift to review, not block).

#### Parameters

##### root

`string`

#### Returns

`Promise`\<readonly `string`[]\>
