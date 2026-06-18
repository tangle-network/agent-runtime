[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Fanout

# Type Alias: Fanout

> **Fanout** = \<`Task`, `Item`, `D`\>(`items`, `opts`) => [`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L155)

`fanout(items, opts)` — build the fanout combinator over a static item list.

## Type Parameters

### Task

`Task`

### Item

`Item`

### D

`D`

## Parameters

### items

`ReadonlyArray`\<`Item`\>

### opts

[`FanoutOptions`](../interfaces/FanoutOptions.md)\<`Item`, `D`\>

## Returns

[`CombinatorShape`](CombinatorShape.md)\<`Task`, `D`\>
