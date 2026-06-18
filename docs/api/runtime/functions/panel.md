[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / panel

# Function: panel()

> **panel**\<`Task`, `Artifact`, `D`\>(`spec`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/combinators.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L273)

`panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements,
and fold them into a panel verdict via the pure WRITE-ONLY `merge` (a judge's output never
reaches another judge's task; the merge never spawns or re-ranks). A `down` judge carries no
verdict and is excluded from the merge denominator. A panel that admitted no judge is a
concrete blocker before `merge` is consulted.

## Type Parameters

### Task

`Task`

### Artifact

`Artifact`

### D

`D`

## Parameters

### spec

[`PanelSpec`](../interfaces/PanelSpec.md)\<`Artifact`, `D`\>

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `D`\>
