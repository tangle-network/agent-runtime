[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateUiAuditArgs

# Interface: DelegateUiAuditArgs

Defined in: [mcp/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L211)

**`Experimental`**

## Properties

### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L213)

**`Experimental`**

Workspace root for the audit (absolute path).

***

### routes

> **routes**: readonly [`DelegateUiAuditRoute`](DelegateUiAuditRoute.md)[]

Defined in: [mcp/types.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L215)

**`Experimental`**

Routes to audit. Must be non-empty.

***

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L217)

**`Experimental`**

Multi-tenant scope.

***

### config?

> `optional` **config?**: [`DelegateUiAuditConfig`](DelegateUiAuditConfig.md)

Defined in: [mcp/types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L218)

**`Experimental`**
