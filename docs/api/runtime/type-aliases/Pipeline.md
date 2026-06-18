[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Pipeline

# Type Alias: Pipeline

> **Pipeline** = \<`Task`, `D`\>(`stages`) => [`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L89)

`pipeline(stages)` — build the sequential combinator from an ordered stage list. The first
 stage's `StepIn` is the root `Task`; the last stage's `StepOut` is the deliverable `D`.

## Type Parameters

### Task

`Task`

### D

`D`

## Parameters

### stages

`ReadonlyArray`\<[`PipelineStage`](../interfaces/PipelineStage.md)\<`Task`, `unknown`, `unknown`\>\>

## Returns

[`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>
