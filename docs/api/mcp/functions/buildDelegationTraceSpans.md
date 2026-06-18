[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / buildDelegationTraceSpans

# Function: buildDelegationTraceSpans()

> **buildDelegationTraceSpans**(`events`): [`DelegationTraceSpan`](../interfaces/DelegationTraceSpan.md)[]

Defined in: [mcp/delegation-trace.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L73)

**`Experimental`**

Derive the compact span tree for ONE loop run from its buffered
`LoopTraceEvent` stream. Same reconstruction as the OTEL exporter
([buildLoopSpanNodes](../../index/functions/buildLoopSpanNodes.md)); tolerates partial streams.

## Parameters

### events

readonly [`LoopTraceEvent`](../../runtime/type-aliases/LoopTraceEvent.md)[]

## Returns

[`DelegationTraceSpan`](../interfaces/DelegationTraceSpan.md)[]
