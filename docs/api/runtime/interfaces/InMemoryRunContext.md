[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InMemoryRunContext

# Interface: InMemoryRunContext

Defined in: [runtime/supervise/run-context.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L46)

The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.

## Properties

### journal

> `readonly` **journal**: [`SpawnJournal`](SpawnJournal.md)

Defined in: [runtime/supervise/run-context.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L47)

***

### blobs

> `readonly` **blobs**: [`ResultBlobStore`](ResultBlobStore.md)

Defined in: [runtime/supervise/run-context.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L48)

***

### executors

> `readonly` **executors**: [`ExecutorRegistry`](ExecutorRegistry.md)

Defined in: [runtime/supervise/run-context.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L49)
