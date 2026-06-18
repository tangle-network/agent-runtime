[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / traceContextToEnv

# Function: traceContextToEnv()

> **traceContextToEnv**(`ctx`): `Record`\<`string`, `string`\>

Defined in: [mcp/trace-propagation.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L85)

Build env vars to pass to a child MCP subprocess so it inherits the
current trace context.

## Parameters

### ctx

[`TraceContext`](../interfaces/TraceContext.md)

## Returns

`Record`\<`string`, `string`\>
