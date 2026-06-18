[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createFleetWorkspaceExecutor

# Function: createFleetWorkspaceExecutor()

> **createFleetWorkspaceExecutor**(`options`): [`DelegationExecutor`](../interfaces/DelegationExecutor.md)

Defined in: [mcp/executor.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L116)

**`Experimental`**

Build an executor that resolves each delegated iteration to an existing
machine in `fleet`. The fleet's shared-workspace policy means the worker
machine sees the caller's filesystem — diffs land in-place with no
cross-sandbox copy step.

## Parameters

### options

[`FleetWorkspaceExecutorOptions`](../interfaces/FleetWorkspaceExecutorOptions.md)

## Returns

[`DelegationExecutor`](../interfaces/DelegationExecutor.md)
