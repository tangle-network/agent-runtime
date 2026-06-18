[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WaterfallCollector

# Interface: WaterfallCollector

Defined in: [runtime/waterfall.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L49)

## Properties

### hooks

> **hooks**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/waterfall.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L51)

Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks.

## Methods

### report()

> **report**(): [`WaterfallReport`](WaterfallReport.md)

Defined in: [runtime/waterfall.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L52)

#### Returns

[`WaterfallReport`](WaterfallReport.md)

***

### render()

> **render**(`opts?`): `string`

Defined in: [runtime/waterfall.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L54)

The text waterfall — one row per span, bars scaled to the observed window.

#### Parameters

##### opts?

###### width?

`number`

###### maxRows?

`number`

#### Returns

`string`

***

### reset()

> **reset**(): `void`

Defined in: [runtime/waterfall.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L55)

#### Returns

`void`
