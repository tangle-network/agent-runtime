[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AgenticTask

# Interface: AgenticTask

Defined in: [runtime/strategy.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L48)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [runtime/strategy.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L49)

***

### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [runtime/strategy.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L50)

***

### userPrompt

> `readonly` **userPrompt**: `string`

Defined in: [runtime/strategy.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L51)

***

### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime/strategy.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L53)

Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it.
