[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentExecutionBackend

# Interface: AgentExecutionBackend\<TInput\>

Defined in: [types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L492)

## Stable

## Type Parameters

### TInput

`TInput` *extends* [`AgentBackendInput`](AgentBackendInput.md) = [`AgentBackendInput`](AgentBackendInput.md)

## Properties

### kind

> **kind**: `string`

Defined in: [types.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L493)

## Methods

### start()?

> `optional` **start**(`input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L494)

#### Parameters

##### input

`TInput`

##### context

`Omit`\<[`AgentBackendContext`](AgentBackendContext.md), `"session"`\> & `object`

#### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

***

### resume()?

> `optional` **resume**(`session`, `input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L498)

#### Parameters

##### session

`RuntimeSession`

##### input

`TInput`

##### context

`Omit`\<[`AgentBackendContext`](AgentBackendContext.md), `"session"`\>

#### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

***

### stream()

> **stream**(`input`, `context`): `AsyncIterable`\<[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)\>

Defined in: [types.ts:503](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L503)

#### Parameters

##### input

`TInput`

##### context

[`AgentBackendContext`](AgentBackendContext.md)

#### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)\>

***

### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:504](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L504)

#### Parameters

##### session

`RuntimeSession`

##### reason

`string`

#### Returns

`void` \| `Promise`\<`void`\>
