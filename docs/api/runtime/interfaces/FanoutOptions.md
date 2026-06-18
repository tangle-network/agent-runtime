[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FanoutOptions

# Interface: FanoutOptions\<Item, D\>

Defined in: [runtime/personify/wave-types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L105)

`fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by
the conserved pool's fail-closed admission), drained via `scope.next()`, then optionally a
single SYNTHESIS child over the gathered results. Without `synthesize`, the combinator returns
the best-valid child via the single-sourced selector (selector≠judge). A round that admitted
zero children, or whose synthesis child could not be admitted, is a concrete blocker.

No domain: a "research sweep over angles" is `fanout(angles, { synthesize: cite })` under a
research persona; a "fanout-vote" is `fanout(copies)` with the default selector. The item list
+ the synthesis posture are the SHAPE's args; the prompt that turns an item into work is the
persona's.

## Type Parameters

### Item

`Item`

### D

`D`

## Properties

### synthesize?

> `optional` **synthesize?**: [`FanoutSynthesis`](FanoutSynthesis.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L124)

Optional synthesis over the gathered child results: when present, the combinator spawns ONE
synthesis child whose task is built from the drained settlements, and its `done` output is
the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).

***

### selectWinner?

> `optional` **selectWinner?**: [`FanoutWinnerSelector`](../type-aliases/FanoutWinnerSelector.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L133)

Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
Receives the SAME `Iteration[]` the default selector reads (each child's output is its
`Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
…) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
synthesis child IS the selection); supplying both is a config error.

## Methods

### itemTask()

> **itemTask**(`item`, `index`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L108)

One child task per item: `item` + the index discriminator. The persona's directive/context
 is threaded in by the combinator; this only supplies the per-item discriminator.

#### Parameters

##### item

`Item`

##### index

`number`

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### label()?

> `optional` **label**(`item`, `index`): `string`

Defined in: [runtime/personify/wave-types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L110)

Per-item child label (defaults to `item:<index>` in the impl).

#### Parameters

##### item

`Item`

##### index

`number`

#### Returns

`string`

***

### itemSpec()?

> `optional` **itemSpec**(`item`, `index`, `ctx`): [`AgentSpec`](AgentSpec.md)

Defined in: [runtime/personify/wave-types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L117)

Optional per-item `AgentSpec` override. When set, each item's child is spawned against the
returned spec instead of `persona.root` — the seam a heterogeneous fanout uses to give each
item a DISTINCT executor (e.g. N authored harness profiles, each on its own worktree-CLI
leaf). Absent ⇒ every item runs against the persona's root spec (the homogeneous default).

#### Parameters

##### item

`Item`

##### index

`number`

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

[`AgentSpec`](AgentSpec.md)
