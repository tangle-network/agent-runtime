[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ShapeRegistry

# Interface: ShapeRegistry

Defined in: [runtime/personify/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L201)

The open shape registry — the extension point that makes a new loop-shape ONE file + one
`registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
`succeeded` before `value`); `register` fails loud on a duplicate name.

## Methods

### register()

> **register**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [runtime/personify/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L202)

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### name

`string`

##### factory

[`LoopShape`](../type-aliases/LoopShape.md)\<`Task`, `D`\>

#### Returns

`void`

***

### resolve()

> **resolve**\<`Task`, `D`\>(`name`): \{ `succeeded`: `true`; `value`: [`LoopShape`](../type-aliases/LoopShape.md)\<`Task`, `D`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

Defined in: [runtime/personify/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L203)

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### name

`string`

#### Returns

\{ `succeeded`: `true`; `value`: [`LoopShape`](../type-aliases/LoopShape.md)\<`Task`, `D`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

***

### names()

> **names**(): `string`[]

Defined in: [runtime/personify/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L207)

The registered shape names — for diagnostics + a fail-loud "unknown shape" message.

#### Returns

`string`[]
