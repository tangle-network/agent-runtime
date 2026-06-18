[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / routerChatWithTools

# Function: routerChatWithTools()

> **routerChatWithTools**(`cfg`, `messages`, `tools`, `opts?`): `Promise`\<[`RouterChatToolsResult`](../interfaces/RouterChatToolsResult.md)\>

Defined in: [runtime/router-client.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L116)

A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape
`messages` (system/user/assistant-with-tool_calls/tool roles) + function `tools`, and returns the
assistant text plus the tool calls the model wants run. Same fail-loud + real-usage discipline as
`routerChatWithUsage`. `tool_choice: 'auto'` lets the model decide; the driver loops on the result.

## Parameters

### cfg

[`RouterConfig`](../interfaces/RouterConfig.md)

### messages

readonly `Record`\<`string`, `unknown`\>[]

### tools

readonly `object`[]

### opts?

#### temperature?

`number`

#### signal?

`AbortSignal`

#### toolChoice?

`"auto"` \| `"none"` \| `"required"`

#### maxTokens?

`number`

## Returns

`Promise`\<[`RouterChatToolsResult`](../interfaces/RouterChatToolsResult.md)\>
