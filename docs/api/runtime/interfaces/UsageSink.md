[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / UsageSink

# Interface: UsageSink

Defined in: [runtime/report-usage.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L24)

The slice of an agent-eval campaign `DispatchContext.cost` this needs.

## Methods

### observe()

> **observe**(`amountUsd`, `source`): `void`

Defined in: [runtime/report-usage.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L25)

#### Parameters

##### amountUsd

`number`

##### source

`string`

#### Returns

`void`

***

### observeTokens()

> **observeTokens**(`usage`): `void`

Defined in: [runtime/report-usage.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L26)

#### Parameters

##### usage

[`LoopTokenUsage`](LoopTokenUsage.md)

#### Returns

`void`
