[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / createIterableBackend

# Function: createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

Defined in: [backends.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L28)

## Type Parameters

### TInput

`TInput` *extends* [`AgentBackendInput`](../interfaces/AgentBackendInput.md)

## Parameters

### options

#### kind

`string`

#### start?

(`input`, `context`) => `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

#### resume?

(`session`, `input`, `context`) => `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

#### stream

(`input`, `context`) => `AsyncIterable`\<[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)\>

#### stop?

(`session`, `reason`) => `void` \| `Promise`\<`void`\>

## Returns

[`AgentExecutionBackend`](../interfaces/AgentExecutionBackend.md)\<`TInput`\>

## Stable
