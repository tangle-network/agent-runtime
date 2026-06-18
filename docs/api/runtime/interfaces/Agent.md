[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Agent

# Interface: Agent\<Task, Out\>

Defined in: [runtime/supervise/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L49)

One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver
is an `Agent` whose `act` spawns children and reacts to them via `scope.next()`. An
analyst is an `Agent` whose task is "read these traces → findings" — `where` it runs
is its executor, not a separate type.

`act` MUST be replay-safe: it may read `verdict`, `spent`, and `out` (rehydrated by
`outRef`) off each `Settled`; it MUST NOT read `Date.now`, `Math.random`, or any
unordered collection. `scope.next()` delivers strictly in recorded `seq` order.

## Type Parameters

### Task

`Task`

### Out

`Out`

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/supervise/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L50)

## Methods

### act()

> **act**(`task`, `scope`): `Promise`\<`Out`\>

Defined in: [runtime/supervise/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L51)

#### Parameters

##### task

`Task`

##### scope

[`Scope`](Scope.md)\<`Out`\>

#### Returns

`Promise`\<`Out`\>
