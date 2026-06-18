[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / UiAuditorDelegationOutput

# Interface: UiAuditorDelegationOutput

Defined in: [mcp/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L170)

**`Experimental`**

Wire-shape of a completed UI-audit delegation. The `findings` array
contains every finding persisted to the workspace during the run,
already enriched with `id` and `createdAt` by the writer. `workspaceDir`
is the absolute path to the workspace; `indexFile` is the workspace-
relative path to the regenerated index.md.

## Properties

### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L171)

**`Experimental`**

***

### indexFile

> **indexFile**: `string`

Defined in: [mcp/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L172)

**`Experimental`**

***

### findings

> **findings**: [`UiFinding`](../../profiles/interfaces/UiFinding.md)[]

Defined in: [mcp/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L173)

**`Experimental`**

***

### iterations

> **iterations**: `number`

Defined in: [mcp/types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L175)

**`Experimental`**

Total iterations the loop ran for this delegation.
