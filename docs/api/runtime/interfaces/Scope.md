[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Scope

# Interface: Scope\<Out\>

Defined in: [runtime/supervise/types.ts:283](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L283)

The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
budget atomically from the shared pool and fails closed when the pool cannot cover it.
`next()` waits for one settlement from this scope's live set; `view` reads live state,
not the replay log.

## Type Parameters

### Out

`Out`

## Properties

### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [runtime/supervise/types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L310)

This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
 is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
 it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
 scope carries its own signal, chained off its driver child's abort.

***

### view

> `readonly` **view**: [`TreeView`](TreeView.md)

Defined in: [runtime/supervise/types.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L324)

The live tree — reads the in-memory nursery, not the journal.

***

### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [runtime/supervise/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L326)

Conserved-pool readouts (post-reservation).

## Methods

### spawn()

> **spawn**\<`C`\>(`agent`, `task`, `opts`): \{ `ok`: `true`; `handle`: [`Handle`](Handle.md)\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

Defined in: [runtime/supervise/types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L289)

Spawn a child. Reserves `opts.budget` from the conserved pool atomically; refunds the
unspent remainder on settle. Returns a typed outcome — fail-closed on an exhausted
pool or an exceeded depth ceiling (the caller inspects `ok` before `handle`).

#### Type Parameters

##### C

`C`

#### Parameters

##### agent

[`Agent`](Agent.md)\<`unknown`, `C`\>

##### task

`unknown`

##### opts

[`SpawnOpts`](SpawnOpts.md)

#### Returns

\{ `ok`: `true`; `handle`: [`Handle`](Handle.md)\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

***

### next()

> **next**(): `Promise`\<[`Settled`](../type-aliases/Settled.md)\<`Out`\> \| `null`\>

Defined in: [runtime/supervise/types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L296)

ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
 `null` when the live set is empty.

#### Returns

`Promise`\<[`Settled`](../type-aliases/Settled.md)\<`Out`\> \| `null`\>

***

### send()

> **send**(`nodeId`, `msg`): `boolean`

Defined in: [runtime/supervise/types.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L305)

Steer a RUNNING child out-of-band — deliver a message to its executor's inbox (the driver's
`send` verb: next-instruction, interrupt, or resume). Returns `true` if the message was
delivered to a live child whose executor accepts delivery, `false` otherwise (unknown id,
already settled, or an executor with no inbox). The executor drains its inbox between turns;
a leaf that does not implement `deliver` simply cannot be steered mid-flight. In-process this
is a direct call; the sandbox/Agent-Bus transports surface the SAME verb as an MCP tool.

#### Parameters

##### nodeId

`string`

##### msg

`unknown`

#### Returns

`boolean`

***

### meter()

> **meter**(`spend`, `detail?`): `Promise`\<`void`\>

Defined in: [runtime/supervise/types.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L322)

Meter the driver's OWN compute against the conserved pool — its inference turns, which are
real tokens/usd but not a spawned child (no reserve/reconcile). A direct `free → committed`
debit, so equal-k counts the driver's tokens AND the in-loop budget guard (`budget.tokensLeft`)
halts a driver that thinks the pool dry. `detail` rides an `agent.turn` trace event for live
observability (turn index, tool calls, cumulative spend). It also journals a `metered` event —
the durable twin of the pool debit (as `settled` is the twin of `reconcile`) — so every
journal-based cost reader (`spentFromJournal`, `trajectoryReport`) sums driver inference
automatically. A leaf never calls this; a driver meters each chat turn and awaits it (the
metered event is cost-critical, so it lands before the join-barrier roll-up).

#### Parameters

##### spend

[`Spend`](Spend.md)

##### detail?

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`void`\>
