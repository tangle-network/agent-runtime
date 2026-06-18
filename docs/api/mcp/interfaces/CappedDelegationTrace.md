[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CappedDelegationTrace

# Interface: CappedDelegationTrace

Defined in: [mcp/delegation-trace.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L60)

**`Experimental`**

## Properties

### trace

> **trace**: [`DelegationTraceSpan`](DelegationTraceSpan.md)[]

Defined in: [mcp/delegation-trace.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L61)

**`Experimental`**

***

### truncated

> **truncated**: `boolean`

Defined in: [mcp/delegation-trace.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L63)

**`Experimental`**

True when oldest spans were dropped to honor the caps.
