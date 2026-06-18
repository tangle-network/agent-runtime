[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / renderTrace

# Function: renderTrace()

> **renderTrace**(`trace`): `string`

Defined in: [mcp/tools/checks.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L183)

Render a worker's trace (tool calls + results) into the text an analyst lens reads. Generic over
 the trace shape: a `{ messages }` conversation, a bare message array, else stringified.

## Parameters

### trace

`unknown`

## Returns

`string`
