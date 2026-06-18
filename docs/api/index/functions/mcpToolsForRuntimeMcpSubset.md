[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / mcpToolsForRuntimeMcpSubset

# Function: mcpToolsForRuntimeMcpSubset()

> **mcpToolsForRuntimeMcpSubset**(`names`): [`OpenAIChatTool`](../interfaces/OpenAIChatTool.md)[]

Defined in: [mcp/openai-tools.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L112)

**`Experimental`**

Subset filter — return only the projected tools whose `function.name`
appears in `names`. Useful for curated mounts (e.g. only the queue-bound
delegation tools, omitting `delegate_feedback`). Unknown names are
silently ignored; pass an empty array to get an empty result.

## Parameters

### names

readonly `string`[]

## Returns

[`OpenAIChatTool`](../interfaces/OpenAIChatTool.md)[]
