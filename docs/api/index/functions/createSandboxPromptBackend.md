[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / createSandboxPromptBackend

# Function: createSandboxPromptBackend()

> **createSandboxPromptBackend**\<`TBox`, `TInput`\>(`options`): [`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

Defined in: [backends.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L39)

## Type Parameters

### TBox

`TBox`

### TInput

`TInput` *extends* [`AgentBackendInput`](../interfaces/AgentBackendInput.md) = [`AgentBackendInput`](../interfaces/AgentBackendInput.md)

## Parameters

### options

#### kind?

`string`

#### getBox

#### streamPrompt

#### mapEvent?

(`event`, `context`) => [`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md) \| `undefined`

#### getSessionId?

(`box`, `input`) => `string` \| `undefined`

## Returns

[`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

## Stable
