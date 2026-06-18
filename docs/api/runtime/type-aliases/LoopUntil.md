[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopUntil

# Type Alias: LoopUntil

> **LoopUntil** = \<`Task`, `State`, `D`\>(`seed`, `spec`) => [`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L193)

`loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state.

## Type Parameters

### Task

`Task`

### State

`State`

### D

`D`

## Parameters

### seed

`State`

### spec

[`LoopUntilSpec`](../interfaces/LoopUntilSpec.md)\<`Task`, `State`, `D`\>

## Returns

[`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>
