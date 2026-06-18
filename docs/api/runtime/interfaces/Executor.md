[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Executor

# Interface: Executor\<Out\>

Defined in: [runtime/supervise/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L70)

The leaf runtime — ONE open interface, not a closed union. `execute` returns a
`Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
streaming ones; a streaming executor reports incremental normalized usage as it runs
(the budget pool reconciles against it) and exposes its terminal artifact via
`resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
meters every runtime identically.

Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
Router/HTTP inference call, no box), sandbox (COMPOSES `runLoop` as a leaf, forwarding
PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
(Halo/RLM subprocess; `budgetExempt`, excluded from equal-k by construction). A user's
own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.

## Type Parameters

### Out

`Out`

## Properties

### runtime

> `readonly` **runtime**: [`Runtime`](../type-aliases/Runtime.md)

Defined in: [runtime/supervise/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L72)

Stable runtime tag for traces + the equal-k exemption check.

***

### budgetExempt?

> `readonly` `optional` **budgetExempt?**: `boolean`

Defined in: [runtime/supervise/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L78)

When true, this executor's spend is NOT metered against the conserved pool and its
iterations are excluded from the equal-k assertion (a `cli` subprocess without
token accounting). Fail-loud everywhere else: a metered executor MUST report usage.

## Methods

### execute()

> **execute**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](../type-aliases/UsageEvent.md), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](ExecutorResult.md)\<`Out`\>\>

Defined in: [runtime/supervise/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L84)

One-shot → resolves a `ExecutorResult`; streaming → yields incremental `UsageEvent`s and
the terminal artifact is read from `resultArtifact()` after the stream drains.
`signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).

#### Parameters

##### task

`unknown`

##### signal

`AbortSignal`

#### Returns

`AsyncIterable`\<[`UsageEvent`](../type-aliases/UsageEvent.md), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](ExecutorResult.md)\<`Out`\>\>

***

### deliver()?

> `optional` **deliver**(`msg`): `void`

Defined in: [runtime/supervise/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L95)

Optional inbox: receive an out-of-band message from the driver mid-run (the `send`/`steer_worker`
verb). A streaming executor drains pending messages between turns and folds them into the next
step (a steer / interrupt / resume). A one-shot executor that can't be steered mid-flight omits
this; `Scope.send` then returns `false` for it. Never throws — a malformed message is the
executor's to ignore.

#### Parameters

##### msg

`unknown`

#### Returns

`void`

***

### teardown()

> **teardown**(`grace`): `Promise`\<\{ `destroyed`: `boolean`; \}\>

Defined in: [runtime/supervise/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L100)

Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
(`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).

#### Parameters

##### grace

`number` \| `"brutalKill"` \| `"infinity"`

#### Returns

`Promise`\<\{ `destroyed`: `boolean`; \}\>

***

### resultArtifact()

> **resultArtifact**(): `object`

Defined in: [runtime/supervise/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L105)

The replay source (B1): the content-addressed `outRef` + the materialized output the
driver branched on, its verdict, and the conserved spend. Read once, after settle.

#### Returns

`object`

##### outRef

> **outRef**: `string`

##### out

> **out**: `Out`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

##### spent

> **spent**: [`Spend`](Spend.md)

***

### metered()?

> `optional` **metered**(): [`Spend`](Spend.md) \| `undefined`

Defined in: [runtime/supervise/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L114)

A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
(the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
executors omit it (returns `undefined`).

#### Returns

[`Spend`](Spend.md) \| `undefined`
