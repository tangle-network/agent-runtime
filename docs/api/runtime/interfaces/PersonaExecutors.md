[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PersonaExecutors

# Interface: PersonaExecutors

Defined in: [runtime/personify/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L118)

How a persona supplies executor resolution. Either a pre-built registry (factories already
closed over their seams) OR the raw seam bag the engine uses to construct a registry +
thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.

## Properties

### registry?

> `readonly` `optional` **registry?**: [`ExecutorRegistry`](ExecutorRegistry.md)

Defined in: [runtime/personify/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L120)

A registry whose factories already capture their seams. Highest precedence.

***

### seams?

> `readonly` `optional` **seams?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L122)

Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys).
