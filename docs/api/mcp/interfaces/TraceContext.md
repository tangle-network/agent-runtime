[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / TraceContext

# Interface: TraceContext

Defined in: [mcp/trace-propagation.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L24)

## Properties

### traceId

> **traceId**: `string`

Defined in: [mcp/trace-propagation.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L26)

Trace id inherited from the parent process, or a fresh one.

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/trace-propagation.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L28)

Parent span id from the delegation that launched this MCP server.
