[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegateUiAuditConfig

# Interface: DelegateUiAuditConfig

Defined in: [mcp/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L196)

**`Experimental`**

## Properties

### lenses?

> `optional` **lenses?**: `UiAuditLensFilter`

Defined in: [mcp/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L201)

**`Experimental`**

Lenses to iterate. Default: every lens except `'other'`. Order is
preserved — the driver iterates lens-by-lens.

***

### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: [mcp/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L203)

**`Experimental`**

Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes).

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L205)

**`Experimental`**

Maximum concurrent iterations within a single plan() round. Default 2.

***

### productContext?

> `optional` **productContext?**: `string`

Defined in: [mcp/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L207)

**`Experimental`**

Free-form product context surfaced to the judge.
