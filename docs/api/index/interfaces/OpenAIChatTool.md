[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / OpenAIChatTool

# Interface: OpenAIChatTool

Defined in: [types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L239)

## Stable

OpenAI Chat Completions tool descriptor. The shape mirrors the
`/v1/chat/completions` `tools[]` parameter so callers can pass tool
definitions through `createOpenAICompatibleBackend({ tools })` without any
runtime translation. The router proxies this shape verbatim to Anthropic
(translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
that the eval surface targets.

Callers that build their tool list from MCP servers should run a one-shot
MCP `tools/list` at config time and project the result into this shape. The
runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
keeping the backend transport thin lets domain repos own MCP plumbing.

## Properties

### type

> **type**: `"function"`

Defined in: [types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L240)

***

### function

> **function**: `object`

Defined in: [types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L241)

#### name

> **name**: `string`

#### description?

> `optional` **description?**: `string`

#### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>
