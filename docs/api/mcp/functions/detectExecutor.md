[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / detectExecutor

# Function: detectExecutor()

> **detectExecutor**(`args`): `Promise`\<[`DelegationExecutor`](../interfaces/DelegationExecutor.md)\>

Defined in: [mcp/bin-helpers.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L46)

**`Experimental`**

Pick the right executor for an MCP server invocation based on env vars.

- `TANGLE_FLEET_ID` set → fleet-workspace placement; resolves the handle
  via `sandboxClient.fleets.get(...)`.
- Otherwise → sibling-sandbox placement; each delegation creates a fresh
  sandbox via `sandboxClient.create(...)`.

Fails loud (throws) when fleet mode is requested but the SDK shape is
incompatible — the operator chose fleet semantics, silently degrading to
sibling mode would lie about workspace topology.

## Parameters

### args

[`DetectExecutorArgs`](../interfaces/DetectExecutorArgs.md)

## Returns

`Promise`\<[`DelegationExecutor`](../interfaces/DelegationExecutor.md)\>
