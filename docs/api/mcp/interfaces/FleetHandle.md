[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FleetHandle

# Interface: FleetHandle

Defined in: [mcp/executor.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L82)

**`Experimental`**

Minimal `SandboxFleet` surface the fleet executor calls. Declared
structurally so tests can pass an in-memory stub without instantiating the
sandbox SDK.

## Properties

### fleetId

> `readonly` **fleetId**: `string`

Defined in: [mcp/executor.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L83)

**`Experimental`**

***

### ids

> `readonly` **ids**: readonly `string`[]

Defined in: [mcp/executor.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L85)

**`Experimental`**

Machine ids in dispatch-eligible order. The executor round-robins.

## Methods

### sandbox()

> **sandbox**(`machineId`): `Promise`\<`SandboxInstance`\>

Defined in: [mcp/executor.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L89)

**`Experimental`**

Resolve a machine id to its `SandboxInstance` — that machine is mounted
on the fleet's shared workspace, so any diff the worker writes lands on
every other fleet machine's filesystem too.

#### Parameters

##### machineId

`string`

#### Returns

`Promise`\<`SandboxInstance`\>
