[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / pipeline

# Function: pipeline()

> **pipeline**\<`Task`, `D`\>(`stages`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L100)

`pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the
next stage's task. The first stage that ends `blocked` (a child that went down, a child the
pool would not admit, or a stage whose `collect` chose to block) short-circuits — its blockers
ARE the pipeline's blockers, never coerced past a failed stage. The terminal stage's `done`
deliverable is the pipeline's deliverable.

## Type Parameters

### Task

`Task`

### D

`D`

## Parameters

### stages

readonly [`PipelineStage`](../interfaces/PipelineStage.md)\<`Task`, `unknown`, `unknown`\>[]

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
