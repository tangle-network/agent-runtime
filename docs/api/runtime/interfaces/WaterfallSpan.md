[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WaterfallSpan

# Interface: WaterfallSpan

Defined in: [runtime/waterfall.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L11)

## Properties

### id

> **id**: `string`

Defined in: [runtime/waterfall.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L12)

***

### label

> **label**: `string`

Defined in: [runtime/waterfall.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L14)

The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name.

***

### runId

> **runId**: `string`

Defined in: [runtime/waterfall.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L15)

***

### parentId?

> `optional` **parentId?**: `string`

Defined in: [runtime/waterfall.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L16)

***

### startMs

> **startMs**: `number`

Defined in: [runtime/waterfall.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L17)

***

### endMs?

> `optional` **endMs?**: `number`

Defined in: [runtime/waterfall.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L18)

***

### status

> **status**: `"running"` \| `"done"` \| `"down"`

Defined in: [runtime/waterfall.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L19)

***

### usd

> **usd**: `number`

Defined in: [runtime/waterfall.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L20)

***

### tokens

> **tokens**: `object`

Defined in: [runtime/waterfall.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L21)

#### input

> **input**: `number`

#### output

> **output**: `number`

***

### score?

> `optional` **score?**: `number`

Defined in: [runtime/waterfall.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L22)
