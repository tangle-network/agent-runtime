[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / capDelegationTrace

# Function: capDelegationTrace()

> **capDelegationTrace**(`spans`, `caps?`): [`CappedDelegationTrace`](../interfaces/CappedDelegationTrace.md)

Defined in: [mcp/delegation-trace.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L97)

**`Experimental`**

Enforce the trace caps over an ordered (oldest-first) span list. Drops the
OLDEST spans first and reports `truncated: true` when anything was dropped;
the newest span always survives, so a non-empty input never caps to empty.
Dropping a parent may orphan surviving children's `parentSpanId` references
— acceptable for the flat journal shape; consumers treat unresolved parents
as roots.

## Parameters

### spans

readonly [`DelegationTraceSpan`](../interfaces/DelegationTraceSpan.md)[]

### caps?

[`DelegationTraceCaps`](../interfaces/DelegationTraceCaps.md)

## Returns

[`CappedDelegationTrace`](../interfaces/CappedDelegationTrace.md)
