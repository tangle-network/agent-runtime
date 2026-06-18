[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createInMemoryRunContext

# Function: createInMemoryRunContext()

> **createInMemoryRunContext**(`opts?`): [`InMemoryRunContext`](../interfaces/InMemoryRunContext.md)

Defined in: [runtime/supervise/run-context.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L56)

Build a fresh in-memory run context. Every call returns NEW stores (no shared global
state between runs), so two runs never cross-contaminate their journals/blobs.

## Parameters

### opts?

[`InMemoryRunContextOptions`](../interfaces/InMemoryRunContextOptions.md) = `{}`

## Returns

[`InMemoryRunContext`](../interfaces/InMemoryRunContext.md)
