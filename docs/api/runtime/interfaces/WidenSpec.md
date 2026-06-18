[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / WidenSpec

# Interface: WidenSpec\<Seed, D\>

Defined in: [runtime/personify/wave-types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L286)

`widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout
combinators above, the widener REACTS to each `scope.next()`: as each child settles it consults
the `WidenGate` and, when a lineage is `promising`, widens by AT MOST ONE child toward it under
the remaining conserved pool. Defaults to FLAT (the gate never widens) so a gate run stays
non-widening and the R2 selector≠judge collision is dormant. `promising` is derived from the
round's analyst FINDINGS (via `ScopeAnalyst`, §2), NOT a child's raw `verdict` — the firewall.

This is the progressive-widening (MCTS-PW) combinator: the one shape whose breadth is decided
at runtime from the diagnosis, not fixed at spawn. It is the mechanism the diverse-strategy-vs-
blind GATE is run with — kept FLAT by default until that gate returns positive (don't build
mechanism ahead of the gate).

## Type Parameters

### Seed

`Seed`

### D

`D`

## Properties

### seeds

> `readonly` **seeds**: readonly `Seed`[]

Defined in: [runtime/personify/wave-types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L289)

The initial children to spawn before any widening — the seed lineages the gate widens from.
 One child task per seed; bounded by the conserved pool's fail-closed admission.

***

### gate

> `readonly` **gate**: [`ScopeWidenGate`](ScopeWidenGate.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L296)

The progressive-widening gate. Consulted on EVERY settled child with the round's
trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.

## Methods

### seedTask()

> **seedTask**(`seed`, `index`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L290)

#### Parameters

##### seed

`Seed`

##### index

`number`

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### widenTask()

> **widenTask**(`toward`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L298)

Build the widened child's task from the lineage the gate chose to extend.

#### Parameters

##### toward

[`WidenLineage`](WidenLineage.md)\<`D`\>

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### synthesize()

> **synthesize**(`gathered`, `ctx`): [`Outcome`](../type-aliases/Outcome.md)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L301)

Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
 single-sourced selector over the gathered children, never a re-judge).

#### Parameters

##### gathered

readonly [`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>[]

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`D`\>
