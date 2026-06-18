[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [analyst-loop](../README.md) / ImprovementAdapter

# Interface: ImprovementAdapter\<TEdit\>

Defined in: [analyst-loop/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L51)

Improvement-side bridge — proposes / applies prompt + tool + scaffolding edits.

## Type Parameters

### TEdit

`TEdit` = `unknown`

## Methods

### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`ImprovementEditBatch`](ImprovementEditBatch.md)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](ImprovementEditBatch.md)\<`TEdit`\>\>

Defined in: [analyst-loop/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L52)

#### Parameters

##### findings

readonly `AnalystFinding`[]

#### Returns

[`ImprovementEditBatch`](ImprovementEditBatch.md)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](ImprovementEditBatch.md)\<`TEdit`\>\>

***

### apply()?

> `optional` **apply**(`edits`): `Promise`\<\{ `applied`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [analyst-loop/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L55)

#### Parameters

##### edits

readonly `TEdit`[]

#### Returns

`Promise`\<\{ `applied`: `string`[]; `warnings`: `string`[]; \}\>
