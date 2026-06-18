[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WaterfallReport

# Interface: WaterfallReport

Defined in: [runtime/waterfall.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L25)

## Properties

### spans

> **spans**: [`WaterfallSpan`](WaterfallSpan.md)[]

Defined in: [runtime/waterfall.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L26)

***

### totalMs

> **totalMs**: `number`

Defined in: [runtime/waterfall.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L28)

Wall-clock of the observed window (first spawn → last settle).

***

### totalUsd

> **totalUsd**: `number`

Defined in: [runtime/waterfall.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L29)

***

### totalTokens

> **totalTokens**: `object`

Defined in: [runtime/waterfall.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L30)

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### byKind

> **byKind**: `Record`\<`string`, \{ `count`: `number`; `ms`: `number`; `usd`: `number`; `tokens`: \{ `input`: `number`; `output`: `number`; \}; \}\>

Defined in: [runtime/waterfall.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L32)

Rollup by label prefix (the part before ':') — shots vs analysts vs anything else.
