[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CorpusFilter

# Interface: CorpusFilter

Defined in: [runtime/personify/wave-types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L436)

A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain.

## Properties

### area?

> `readonly` `optional` **area?**: `string`

Defined in: [runtime/personify/wave-types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L437)

***

### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L439)

Match records carrying ALL of these tags.

***

### minConfidence?

> `readonly` `optional` **minConfidence?**: `number`

Defined in: [runtime/personify/wave-types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L441)

Minimum confidence a record must clear to be returned (the render gate).

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [runtime/personify/wave-types.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L443)

Only records from this run (rare — usually a cross-run read).

***

### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [runtime/personify/wave-types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L445)

Cap the result count (most-confident first in the impl).
