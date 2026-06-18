[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Handle

# Interface: Handle\<Out\>

Defined in: [runtime/supervise/types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L240)

A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into
the `acquireSandbox` signal and reaps a find-by-name orphan box, so a node aborted
mid-acquire never leaks (M1).

## Type Parameters

### Out

`Out`

## Properties

### id

> `readonly` **id**: `string`

Defined in: [runtime/supervise/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L241)

***

### label

> `readonly` **label**: `string`

Defined in: [runtime/supervise/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L242)

***

### status

> `readonly` **status**: [`NodeStatus`](../type-aliases/NodeStatus.md)

Defined in: [runtime/supervise/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L243)

***

### \_\_out?

> `readonly` `optional` **\_\_out?**: `Out`

Defined in: [runtime/supervise/types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L247)

Phantom: binds the handle to the child's output type so `spawn<C>` returns a
 `Handle<C>` distinct from a `Handle<other>`. Type-only — never present at runtime.

## Methods

### abort()

> **abort**(`reason?`): `void`

Defined in: [runtime/supervise/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L244)

#### Parameters

##### reason?

`string`

#### Returns

`void`
