[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Supervisor

# Interface: Supervisor\<Task, Out\>

Defined in: [runtime/supervise/types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L427)

Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker,
and the root handle. `run` executes the root `Agent` to completion; `attach` wires a
live `RootHandle` (the Q2 substrate the chat/pi-viz client later consumes).

## Type Parameters

### Task

`Task`

### Out

`Out`

## Methods

### run()

> **run**(`root`, `task`, `opts`): `Promise`\<[`SupervisedResult`](../type-aliases/SupervisedResult.md)\<`Out`\>\>

Defined in: [runtime/supervise/types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L428)

#### Parameters

##### root

[`Agent`](Agent.md)\<`Task`, `Out`\>

##### task

`Task`

##### opts

[`SupervisorOpts`](SupervisorOpts.md)

#### Returns

`Promise`\<[`SupervisedResult`](../type-aliases/SupervisedResult.md)\<`Out`\>\>

***

### attach()

> **attach**(`h`): `void`

Defined in: [runtime/supervise/types.ts:429](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L429)

#### Parameters

##### h

[`RootHandle`](RootHandle.md)\<`Out`\>

#### Returns

`void`
