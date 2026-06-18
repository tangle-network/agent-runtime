[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FanoutWinnerSelector

# Type Alias: FanoutWinnerSelector\<D\>

> **FanoutWinnerSelector**\<`D`\> = (`iterations`) => \{ `output?`: [`Outcome`](Outcome.md)\<`D`\>; \} \| `undefined`

Defined in: [runtime/personify/wave-types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L138)

A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the
 child's `Outcome<D>`), returning the chosen iteration or `undefined` when none qualifies.

## Type Parameters

### D

`D`

## Parameters

### iterations

[`Iteration`](../interfaces/Iteration.md)\<`unknown`, [`Outcome`](Outcome.md)\<`D`\>\>[]

## Returns

\{ `output?`: [`Outcome`](Outcome.md)\<`D`\>; \} \| `undefined`
