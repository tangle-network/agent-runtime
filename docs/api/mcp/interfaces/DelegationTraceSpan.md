[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationTraceSpan

# Interface: DelegationTraceSpan

Defined in: [mcp/delegation-trace.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L31)

**`Experimental`**

One span of a delegation's compact trace. Flat (parent linkage by id), all
values JSON-safe scalars — `FileDelegationStore` round-trips records
through `JSON.stringify`. `meta` carries the span's attributes (GenAI
semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
them, so a consumer can re-export journal traces losslessly.

## Properties

### spanId

> **spanId**: `string`

Defined in: [mcp/delegation-trace.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L32)

**`Experimental`**

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/delegation-trace.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L34)

**`Experimental`**

Absent on the tree root.

***

### name

> **name**: `string`

Defined in: [mcp/delegation-trace.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L36)

**`Experimental`**

`'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name).

***

### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [mcp/delegation-trace.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L38)

**`Experimental`**

Topology level: loop root, plan round, or iteration branch.

***

### startMs

> **startMs**: `number`

Defined in: [mcp/delegation-trace.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L39)

**`Experimental`**

***

### endMs

> **endMs**: `number`

Defined in: [mcp/delegation-trace.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L40)

**`Experimental`**

***

### meta?

> `optional` **meta?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [mcp/delegation-trace.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L41)

**`Experimental`**
