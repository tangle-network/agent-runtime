[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopUntilState

# Interface: LoopUntilState\<State\>

Defined in: [runtime/personify/wave-types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L187)

The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock).

## Type Parameters

### State

`State`

## Properties

### round

> `readonly` **round**: `number`

Defined in: [runtime/personify/wave-types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L188)

***

### value

> `readonly` **value**: `State`

Defined in: [runtime/personify/wave-types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L189)
