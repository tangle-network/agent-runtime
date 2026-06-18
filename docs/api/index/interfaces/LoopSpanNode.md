[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / LoopSpanNode

# Interface: LoopSpanNode

Defined in: [otel-export.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L202)

Sink-neutral node in a reconstructed loop span tree. The root node's
`parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
mapper attaches the inherited delegation span; the delegation journal
leaves it as the tree root).

## Properties

### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L203)

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L204)

***

### name

> **name**: `string`

Defined in: [otel-export.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L206)

`'loop'` | `'loop.round'` | `'loop.iteration'`.

***

### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [otel-export.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L208)

Topology level: loop root, plan round, or iteration branch.

***

### startMs

> **startMs**: `number`

Defined in: [otel-export.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L209)

***

### endMs

> **endMs**: `number`

Defined in: [otel-export.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L210)

***

### attrs

> **attrs**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L211)

***

### error

> **error**: `boolean`

Defined in: [otel-export.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L213)

True when the iteration carried an error — maps to OTEL status code 2.
