[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / widen

# Function: widen()

> **widen**\<`Task`, `Seed`, `D`\>(`spec`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L387)

`widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS
to each `scope.next()`: on every settled child it consults `spec.gate.decide` and, when the gate
returns `widen`, spawns AT MOST ONE more child toward the chosen lineage under the remaining
conserved pool. `promising` is derived from the round's trace findings (the analyst seam),
never a child's raw `verdict` — and the default gate (`flatWidenGate`) never widens, so the R2
firewall stays dormant. Terminal selection is `spec.synthesize` over every settled lineage.

When `ctx.analyst` is set, `decide` is consulted with that round's trace-derived findings;
absent an analyst the findings argument is the empty array a flat gate ignores. The analyst
spawns into THIS scope (conserved-pooled, so equal-k holds). Streaming caveat: a wired analyst
drains its own child off the SHARED cursor by id-match, so on a NON-flat gate (which spawns
widen children that are live concurrently) the analyst can consume a sibling's settlement before
the widen loop sees it. The shipped default (`flatWidenGate`) never widens, so no widen child is
ever live when the analyst runs and the wire is exact; a non-flat gate must drive the analyst on
a scope whose siblings are quiesced, or read findings without the shared-cursor drain.

## Type Parameters

### Task

`Task`

### Seed

`Seed`

### D

`D`

## Parameters

### spec

[`WidenSpec`](../interfaces/WidenSpec.md)\<`Seed`, `D`\>

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
