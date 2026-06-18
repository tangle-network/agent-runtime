[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / CheckRunnerOptions

# Interface: CheckRunnerOptions

Defined in: [mcp/tools/checks.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L209)

## Properties

### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [mcp/tools/checks.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L210)

***

### routerKey

> **routerKey**: `string`

Defined in: [mcp/tools/checks.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L211)

***

### model

> **model**: `string`

Defined in: [mcp/tools/checks.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L212)

***

### chat?

> `optional` **chat?**: (`system`, `user`) => `Promise`\<`string`\>

Defined in: [mcp/tools/checks.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L214)

Test/override seam — replace the LLM call. Default: a router chat completion.

#### Parameters

##### system

`string`

##### user

`string`

#### Returns

`Promise`\<`string`\>
