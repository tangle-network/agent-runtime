[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / loopUntil

# Function: loopUntil()

> **loopUntil**\<`Task`, `State`, `D`\>(`seed`, `spec`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L221)

`loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into
the running state; `until` (reading the round's trace findings, NOT a fresh raw verdict) is
the deployable stop. The conserved pool IS the loop bound: once `spawn` fails closed the loop
stops. A loop that exhausted the pool without `until` ever satisfying is a concrete blocker.

When `ctx.analyst` is set, each round runs it over the children settled so far and steers
`until` on the resulting trace-derived findings (the analyst spawns into THIS scope, so its
compute is conserved-pooled — equal-k holds by construction). Absent an analyst the findings
argument is the empty array — never a fabricated finding (fail-loud honesty over a silent default).

## Type Parameters

### Task

`Task`

### State

`State`

### D

`D`

## Parameters

### seed

`State`

### spec

[`LoopUntilSpec`](../interfaces/LoopUntilSpec.md)\<`Task`, `State`, `D`\>

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
