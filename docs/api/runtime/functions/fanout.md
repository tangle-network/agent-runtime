[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / fanout

# Function: fanout()

> **fanout**\<`Task`, `Item`, `D`\>(`items`, `opts`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L138)

`fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
single-sourced selector. A round that admitted zero children, or whose synthesis child could
not be admitted, is a concrete blocker.

## Type Parameters

### Task

`Task`

### Item

`Item`

### D

`D`

## Parameters

### items

readonly `Item`[]

### opts

[`FanoutOptions`](../interfaces/FanoutOptions.md)\<`Item`, `D`\>

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
