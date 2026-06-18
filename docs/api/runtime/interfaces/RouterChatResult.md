[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RouterChatResult

# Interface: RouterChatResult

Defined in: [runtime/router-client.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L21)

## Properties

### content

> **content**: `string`

Defined in: [runtime/router-client.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L22)

***

### usage?

> `optional` **usage?**: `object`

Defined in: [runtime/router-client.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L24)

REAL usage, or undefined when the provider reported none.

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [runtime/router-client.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L26)

Derived from usage via `estimateCost` when the model is priced; else undefined.
