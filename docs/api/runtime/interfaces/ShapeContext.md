[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ShapeContext

# Interface: ShapeContext\<D\>

Defined in: [runtime/personify/types.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L167)

The construction context a `LoopShape` factory receives. Carries the persona's resolved
executor seams + the budget knobs, plus the ONE helper a shape needs to spawn a child
through the keystone: `spawnChild` resolves an `AgentSpec` (or a persona-derived child
profile) into an `Agent` the shape hands to `scope.spawn`. The shape never touches the
registry directly — it asks the context, keeping resolution single-sourced.

## Type Parameters

### D

`D` = `unknown`

## Properties

### persona

> `readonly` **persona**: [`Persona`](Persona.md)\<`D`\>

Defined in: [runtime/personify/types.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L168)

***

### budget

> `readonly` **budget**: [`ShapeBudget`](ShapeBudget.md)

Defined in: [runtime/personify/types.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L169)

***

### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](ScopeAnalyst.md)\<`D`\>

Defined in: [runtime/personify/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L182)

The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
 dormant default (empty findings → gates read deliverables/state only).

## Methods

### spawnChild()

> **spawnChild**(`name`, `spec`): [`Agent`](Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

Defined in: [runtime/personify/types.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L176)

Wrap an `AgentSpec` into a leaf `Agent` carrying it as `executorSpec`, so the shape can
`scope.spawn(spawnChild(spec), task, opts)`. `name` labels the child for traces. The
returned agent's `act` is never invoked by the keystone (it is spawned, not run) — the
spec drives the resolved `Executor`; `act` exists only to satisfy the `Agent` shape.

#### Parameters

##### name

`string`

##### spec

[`AgentSpec`](AgentSpec.md)

#### Returns

[`Agent`](Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

***

### childSpec()

> **childSpec**(`profile`, `harness?`): [`AgentSpec`](AgentSpec.md)

Defined in: [runtime/personify/types.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L179)

Derive a child `AgentSpec` from the persona's root spec with an overridden profile —
 the seam a shape uses to give a worker a narrower role/prompt than the root persona.

#### Parameters

##### profile

`AgentProfile`

##### harness?

`BackendType` \| `null`

#### Returns

[`AgentSpec`](AgentSpec.md)
