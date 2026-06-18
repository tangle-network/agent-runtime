[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / driverChild

# Function: driverChild()

> **driverChild**\<`Out`\>(`name`, `driver`, `journal`): [`Agent`](../interfaces/Agent.md)\<`unknown`, `Out`\>

Defined in: [runtime/supervise/driver-executor.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/driver-executor.ts#L77)

Mark + carry a driver `Agent` so the recursive registry resolves it to the
driver-executor. The returned agent is SPAWNED (never run directly): its
`executorSpec` is marked `role: 'driver'` and carries the driver agent + the shared
journal so the executor can run its `act` inside a nested scope. `act` fails loud if
called directly — a driver child runs THROUGH its nested-scope executor, never as a root.

## Type Parameters

### Out

`Out`

## Parameters

### name

`string`

### driver

[`Agent`](../interfaces/Agent.md)\<`unknown`, `Out`\>

### journal

[`SpawnJournal`](../interfaces/SpawnJournal.md)

## Returns

[`Agent`](../interfaces/Agent.md)\<`unknown`, `Out`\>
