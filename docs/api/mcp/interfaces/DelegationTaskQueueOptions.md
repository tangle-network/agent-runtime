[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationTaskQueueOptions

# Interface: DelegationTaskQueueOptions

Defined in: [mcp/task-queue.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L203)

**`Experimental`**

## Properties

### generateId?

> `optional` **generateId?**: () => `string`

Defined in: [mcp/task-queue.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L205)

**`Experimental`**

ID generator override; default `randomTaskId`.

#### Returns

`string`

***

### now?

> `optional` **now?**: () => `string`

Defined in: [mcp/task-queue.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L207)

**`Experimental`**

Clock override; default `() => new Date().toISOString()`.

#### Returns

`string`

***

### store?

> `optional` **store?**: [`DelegationStore`](DelegationStore.md)

Defined in: [mcp/task-queue.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L215)

**`Experimental`**

Journal for record mutations and the `restore()` load source. Default
`InMemoryDelegationStore` — observably identical to an unjournaled
queue. Pass a `FileDelegationStore` through
`DelegationTaskQueue.restore` for state that survives a restart;
constructing with `new` never loads prior state.

***

### resumeDelegate?

> `optional` **resumeDelegate?**: [`DelegationResumeDriver`](DelegationResumeDriver.md)

Defined in: [mcp/task-queue.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L217)

**`Experimental`**

Resume seam for restored in-flight records that carry a `detachedSessionRef`.

***

### maxTerminalRecords?

> `optional` **maxTerminalRecords?**: `number`

Defined in: [mcp/task-queue.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L223)

**`Experimental`**

Maximum number of terminal (completed | failed | cancelled) records
retained; the oldest (by `completedAt`) are evicted from memory and
store once the cap is exceeded. Default unbounded.

***

### onPersistError?

> `optional` **onPersistError?**: (`error`) => `void`

Defined in: [mcp/task-queue.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L230)

**`Experimental`**

Observes the first store failure. After it fires, the queue refuses
new submissions and `flush()` rejects with the same error. Default:
rethrow on a microtask — an unhandled crash — because silently
degrading durable mode to memory-only would lie to the caller.

#### Parameters

##### error

[`DelegationPersistenceError`](../classes/DelegationPersistenceError.md)

#### Returns

`void`

***

### traceContext?

> `optional` **traceContext?**: [`TraceContext`](TraceContext.md)

Defined in: [mcp/task-queue.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L238)

**`Experimental`**

Inherited trace identity stamped on every submitted record
(`traceId` / `parentSpanId`). The bin passes
`readTraceContextFromEnv()` so journal consumers can join delegation
records into the caller's trace. Restored records keep the identity
they were persisted with.
