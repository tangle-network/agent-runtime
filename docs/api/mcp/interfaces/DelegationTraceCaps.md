[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationTraceCaps

# Interface: DelegationTraceCaps

Defined in: [mcp/delegation-trace.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L51)

**`Experimental`**

## Properties

### maxSpans?

> `optional` **maxSpans?**: `number`

Defined in: [mcp/delegation-trace.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L53)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_SPANS](../variables/DELEGATION_TRACE_MAX_SPANS.md).

***

### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [mcp/delegation-trace.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L56)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_BYTES](../variables/DELEGATION_TRACE_MAX_BYTES.md). Approximate — measured as the
 sum of per-span `JSON.stringify` lengths.
