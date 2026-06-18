[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopShape

# Type Alias: LoopShape\<Task, D\>

> **LoopShape**\<`Task`, `D`\> = (`ctx`) => [`Agent`](../interfaces/Agent.md)\<`Task`, [`Outcome`](Outcome.md)\<`D`\>\>

Defined in: [runtime/personify/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L192)

A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it
returns the root `Agent<Task, Outcome<D>>` whose `act` decomposes the task, fans out
children through `scope.spawn`, verifies/selects across their settlements (selector≠judge:
via `settledToIteration` + `defaultSelectWinner`, never re-ranking behind the driver), and
synthesizes the terminal `Outcome<D>`. The shape is STRUCTURE; the persona is CONTENT.

## Type Parameters

### Task

`Task`

### D

`D`

## Parameters

### ctx

[`ShapeContext`](../interfaces/ShapeContext.md)\<`D`\>

## Returns

[`Agent`](../interfaces/Agent.md)\<`Task`, [`Outcome`](Outcome.md)\<`D`\>\>
