[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / StreamToolLoopYield

# Type Alias: StreamToolLoopYield\<Raw\>

> **StreamToolLoopYield**\<`Raw`\> = \{ `kind`: `"event"`; `event`: `Raw`; \} \| \{ `kind`: `"tool_result"`; `toolName`: `string`; `toolCallId?`: `string`; `label`: `string`; `outcome`: [`ToolCallOutcome`](ToolCallOutcome.md); \} \| \{ `kind`: `"capped"`; `pending`: `number`; `stopReason`: `Exclude`\<[`ToolLoopStopReason`](ToolLoopStopReason.md), `"completed"`\>; \}

Defined in: [tool-loop.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L298)

## Type Parameters

### Raw

`Raw`
