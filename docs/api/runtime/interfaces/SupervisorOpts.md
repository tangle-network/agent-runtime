[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SupervisorOpts

# Interface: SupervisorOpts

Defined in: [runtime/supervise/types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L432)

## Properties

### budget

> `readonly` **budget**: [`Budget`](Budget.md)

Defined in: [runtime/supervise/types.ts:434](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L434)

The root conserved-pool ceiling (tokens + usd + iterations + deadline).

***

### runId

> `readonly` **runId**: `string`

Defined in: [runtime/supervise/types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L436)

Trace-correlation root + the journal/blob root key.

***

### journal

> `readonly` **journal**: [`SpawnJournal`](SpawnJournal.md)

Defined in: [runtime/supervise/types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L438)

Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability.

***

### blobs

> `readonly` **blobs**: [`ResultBlobStore`](ResultBlobStore.md)

Defined in: [runtime/supervise/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L440)

Result payload store backing `outRef` rehydration.

***

### executors

> `readonly` **executors**: [`ExecutorRegistry`](ExecutorRegistry.md)

Defined in: [runtime/supervise/types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L442)

Executor resolution — the open registry mapping `AgentSpec` → `Executor`.

***

### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/supervise/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L444)

Runtime recursion-depth ceiling (paired with the conserved pool per R3).

***

### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [runtime/supervise/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L449)

OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
trips the supervisor to `no-winner` rather than restarting forever.

***

### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [runtime/supervise/types.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L450)

***

### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/supervise/types.ts:451](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L451)

#### Returns

`number`

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [runtime/supervise/types.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L452)

***

### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/supervise/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L455)

Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
 same `agent.spawn`/`agent.child` stream `runLoop` feeds — one observable recursive tree.
