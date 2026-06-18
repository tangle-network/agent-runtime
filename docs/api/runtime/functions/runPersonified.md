[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / runPersonified

# Function: runPersonified()

> **runPersonified**\<`Task`, `D`\>(`options`): `Promise`\<[`SupervisedResult`](../type-aliases/SupervisedResult.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>\>

Defined in: [runtime/personify/persona.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L131)

Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape
(a factory verbatim, or a registered name through `builtinShapes`), applies it to a
`ShapeContext`, and runs the resulting root `Agent` to a typed `SupervisedResult<Outcome>`.
Fail loud on an unknown shape name or an unresolvable persona registry — never a silent
default-shape fallback.

## Type Parameters

### Task

`Task`

### D

`D`

## Parameters

### options

[`RunPersonifiedOptions`](../interfaces/RunPersonifiedOptions.md)\<`Task`, `D`\>

## Returns

`Promise`\<[`SupervisedResult`](../type-aliases/SupervisedResult.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>\>
