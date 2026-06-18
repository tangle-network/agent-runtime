[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / registerShape

# Function: registerShape()

> **registerShape**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [runtime/personify/registry.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L53)

Register a composed shape on the default `builtinShapes` registry — the one-call extension
 point a caller invokes so its shape is resolvable by name with zero edits to the engine.

## Type Parameters

### Task

`Task`

### D

`D`

## Parameters

### name

`string`

### factory

[`LoopShape`](../type-aliases/LoopShape.md)\<`Task`, `D`\>

## Returns

`void`
