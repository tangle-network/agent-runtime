[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationHistoryArgs

# Interface: DelegationHistoryArgs

Defined in: [mcp/types.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L265)

**`Experimental`**

## Properties

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L266)

**`Experimental`**

***

### profile?

> `optional` **profile?**: [`DelegationProfile`](../type-aliases/DelegationProfile.md)

Defined in: [mcp/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L267)

**`Experimental`**

***

### since?

> `optional` **since?**: `string`

Defined in: [mcp/types.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L269)

**`Experimental`**

ISO date — only delegations started at-or-after `since` are returned.

***

### limit?

> `optional` **limit?**: `number`

Defined in: [mcp/types.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L271)

**`Experimental`**

Default 50. Hard cap 500.
