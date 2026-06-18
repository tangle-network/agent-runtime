[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / mcpToolsForRuntimeMcp

# Function: mcpToolsForRuntimeMcp()

> **mcpToolsForRuntimeMcp**(): [`OpenAIChatTool`](../interfaces/OpenAIChatTool.md)[]

Defined in: [mcp/openai-tools.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L74)

**`Experimental`**

Returns the 5 delegation tools projected into OpenAI Chat Completions
`tools[]` shape. The order is stable: `delegate_code`,
`delegate_research`, `delegate_feedback`, `delegation_status`,
`delegation_history`.

## Returns

[`OpenAIChatTool`](../interfaces/OpenAIChatTool.md)[]
