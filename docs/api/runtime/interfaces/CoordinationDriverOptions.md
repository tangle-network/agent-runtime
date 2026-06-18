[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CoordinationDriverOptions

# Interface: CoordinationDriverOptions

Defined in: [runtime/supervise/coordination-driver.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L70)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L71)

***

### chat

> `readonly` **chat**: [`DriverChat`](DriverChat.md)

Defined in: [runtime/supervise/coordination-driver.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L73)

The driver-LLM seam (scripted mock offline; router tool-calling in production).

***

### blobs

> `readonly` **blobs**: [`ResultBlobStore`](ResultBlobStore.md)

Defined in: [runtime/supervise/coordination-driver.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L75)

Shared blob store — `observe_worker` reads settled outputs through it.

***

### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](../../mcp/type-aliases/MakeWorkerAgent.md)

Defined in: [runtime/supervise/coordination-driver.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L77)

Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam).

***

### perWorker

> `readonly` **perWorker**: [`Budget`](Budget.md)

Defined in: [runtime/supervise/coordination-driver.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L79)

Per-child budget reserved from the conserved pool on each spawn.

***

### systemPrompt

> `readonly` **systemPrompt**: `string` \| ((`task`) => `string`)

Defined in: [runtime/supervise/coordination-driver.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L82)

The driver's stance — a string, or built from the task (the worker-driver prompt /
 the generator). INJECTED so the prompt is a pluggable, optimizable role.

***

### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [runtime/supervise/coordination-driver.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L87)

Max driver turns before the loop force-finalizes on the best settled child. Default 16.
 `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
 an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
 anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool.

***

### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/supervise/coordination-driver.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L90)

Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
 deterministic in tests. Defaults to `Date.now`.

#### Returns

`number`
