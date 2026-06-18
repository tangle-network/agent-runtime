[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FleetWorkspaceExecutorOptions

# Interface: FleetWorkspaceExecutorOptions

Defined in: [mcp/executor.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L93)

**`Experimental`**

## Properties

### fleet

> **fleet**: [`FleetHandle`](FleetHandle.md)

Defined in: [mcp/executor.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L94)

**`Experimental`**

***

### selectMachine?

> `optional` **selectMachine?**: (`call`) => `string`

Defined in: [mcp/executor.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L100)

**`Experimental`**

Override the machine-selection policy. Default = round-robin across
`fleet.ids`, skipping the optional `excludeMachineIds` set (typically the
coordinator machine the MCP server is running on).

#### Parameters

##### call

###### callIndex

`number`

###### ids

readonly `string`[]

#### Returns

`string`

***

### excludeMachineIds?

> `optional` **excludeMachineIds?**: readonly `string`[]

Defined in: [mcp/executor.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L105)

**`Experimental`**

Machine ids to skip during default round-robin. Set to the caller's own
machineId so workers don't compete with the orchestrator on the same VM.
