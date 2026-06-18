[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / authorStrategy

# Function: authorStrategy()

> **authorStrategy**(`opts`): `Promise`\<[`AuthoredStrategy`](../interfaces/AuthoredStrategy.md)\>

Defined in: [runtime/strategy-author.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L179)

Author + load a strategy from losses. Throws when the author emits no loadable module;
 with `fallbackModel` set, the named fallback gets one attempt first.

## Parameters

### opts

[`AuthorStrategyOptions`](../interfaces/AuthorStrategyOptions.md)

## Returns

`Promise`\<[`AuthoredStrategy`](../interfaces/AuthoredStrategy.md)\>
