[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RootHandle

# Interface: RootHandle\<Out\>

Defined in: [runtime/supervise/types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L481)

Live root handle — the substrate a chat/pi-viz client attaches to (Q2). `signal`
 delivers an out-of-band message to the running root; `view()` materializes the tree.

## Type Parameters

### Out

`Out`

## Properties

### \_\_out?

> `readonly` `optional` **\_\_out?**: `Out`

Defined in: [runtime/supervise/types.ts:487](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L487)

Phantom: binds the handle to the supervised run's output type. Type-only — never
 present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed.

## Methods

### view()

> **view**(): [`TreeView`](TreeView.md)

Defined in: [runtime/supervise/types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L482)

#### Returns

[`TreeView`](TreeView.md)

***

### signal()

> **signal**(`msg`): `void`

Defined in: [runtime/supervise/types.ts:483](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L483)

#### Parameters

##### msg

[`RootSignal`](../type-aliases/RootSignal.md)

#### Returns

`void`

***

### abort()

> **abort**(`reason?`): `void`

Defined in: [runtime/supervise/types.ts:484](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L484)

#### Parameters

##### reason?

`string`

#### Returns

`void`
