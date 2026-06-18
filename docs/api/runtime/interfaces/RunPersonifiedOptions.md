[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RunPersonifiedOptions

# Interface: RunPersonifiedOptions\<Task, D\>

Defined in: [runtime/personify/types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L222)

The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then
runs it through a fresh `createSupervisor` over the persona's executors + the supplied
budget/journal/blobs. Returns the keystone's typed `SupervisedResult<Outcome<D>>` — a
`winner` carries the synthesized `Outcome<D>`; a `no-winner` is never coerced into one.

`shape` is either a resolved `LoopShape` or a registered shape NAME (resolved through the
default registry). The journal/blobs default to in-memory impls in the engine when omitted
(durable FS impls are passed explicitly for a persisted run).

## Type Parameters

### Task

`Task`

### D

`D`

## Properties

### persona

> `readonly` **persona**: [`Persona`](Persona.md)\<`D`\>

Defined in: [runtime/personify/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L223)

***

### shape

> `readonly` **shape**: `string` \| [`LoopShape`](../type-aliases/LoopShape.md)\<`Task`, `D`\>

Defined in: [runtime/personify/types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L225)

A resolved shape factory OR a registered shape name.

***

### task

> `readonly` **task**: `Task`

Defined in: [runtime/personify/types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L226)

***

### budget

> `readonly` **budget**: [`Budget`](Budget.md)

Defined in: [runtime/personify/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L227)

***

### shapeBudget?

> `readonly` `optional` **shapeBudget?**: `Partial`\<[`ShapeBudget`](ShapeBudget.md)\>

Defined in: [runtime/personify/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L229)

Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`.

***

### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [runtime/personify/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L231)

Trace/journal root key. Defaults to the persona name + a run discriminator in the engine.

***

### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](SpawnJournal.md)

Defined in: [runtime/personify/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L232)

***

### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](ResultBlobStore.md)

Defined in: [runtime/personify/types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L233)

***

### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/personify/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L235)

Runtime recursion-depth ceiling, paired with the conserved pool.

***

### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [runtime/personify/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L237)

OTP intensity breaker bounds, forwarded to the supervisor verbatim.

***

### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [runtime/personify/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L238)

***

### handle?

> `readonly` `optional` **handle?**: [`RootHandle`](RootHandle.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

Defined in: [runtime/personify/types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L240)

A live root handle to attach (view/signal/abort) before the run starts.

***

### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/personify/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L241)

#### Returns

`number`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [runtime/personify/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L242)

***

### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](ScopeAnalyst.md)\<`D`\>

Defined in: [runtime/personify/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L245)

Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
 on trace-derived findings instead of the dormant empty default.

***

### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/personify/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L251)

Lifecycle stream sink, forwarded to `SupervisorOpts.hooks` so the root `Scope`'s
`agent.spawn`/`agent.child` events flow to an observer (e.g. the Intelligence SDK's
trace export). Absent ⇒ no stream (the run is silent, as today).
