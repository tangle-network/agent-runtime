[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EvolutionArchiveNode

# Interface: EvolutionArchiveNode

Defined in: [runtime/strategy-evolution.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L174)

## Properties

### name

> **name**: `string`

Defined in: [runtime/strategy-evolution.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L175)

***

### source

> **source**: `"baseline"` \| `"authored"`

Defined in: [runtime/strategy-evolution.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L176)

***

### generation

> **generation**: `number`

Defined in: [runtime/strategy-evolution.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L177)

***

### parent?

> `optional` **parent?**: `string`

Defined in: [runtime/strategy-evolution.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L179)

The champion whose tournament losses this candidate was authored from.

***

### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: [runtime/strategy-evolution.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L180)

***

### file?

> `optional` **file?**: `string`

Defined in: [runtime/strategy-evolution.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L181)

***

### score

> **score**: `number`

Defined in: [runtime/strategy-evolution.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L184)

Latest measured tournament result — 0 until the node's first tournament settles
 (an authored node is created before its generation's benchmark runs).

***

### usd

> **usd**: `number`

Defined in: [runtime/strategy-evolution.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L185)
