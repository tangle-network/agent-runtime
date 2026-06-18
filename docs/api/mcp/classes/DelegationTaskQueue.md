[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationTaskQueue

# Class: DelegationTaskQueue

Defined in: [mcp/task-queue.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L242)

**`Experimental`**

## Constructors

### Constructor

> **new DelegationTaskQueue**(`options?`): `DelegationTaskQueue`

Defined in: [mcp/task-queue.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L256)

**`Experimental`**

#### Parameters

##### options?

[`DelegationTaskQueueOptions`](../interfaces/DelegationTaskQueueOptions.md) = `{}`

#### Returns

`DelegationTaskQueue`

## Methods

### restore()

> `static` **restore**(`options?`): `Promise`\<`DelegationTaskQueue`\>

Defined in: [mcp/task-queue.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L292)

**`Experimental`**

Construct a queue from previously-persisted state. Loads every record
from `options.store`, rebuilds the idempotency index (so a re-submitted
identical task returns the prior taskId and its terminal state), then:

  - terminal records stay queryable via `status()` / `history()`
  - in-flight records with a `detachedSessionRef` re-attach through
    `options.resumeDelegate` and report `running`
  - other in-flight records settle as failed — their driver died with
    the previous process and the result is unrecoverable

The retention cap applies to the loaded set as well.

#### Parameters

##### options?

[`DelegationTaskQueueOptions`](../interfaces/DelegationTaskQueueOptions.md) = `{}`

#### Returns

`Promise`\<`DelegationTaskQueue`\>

***

### submit()

> **submit**\<`Args`\>(`input`): [`SubmitOutput`](../interfaces/SubmitOutput.md)

Defined in: [mcp/task-queue.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L305)

**`Experimental`**

Kick off a delegation in the background. Returns immediately. The
`taskId` is queryable via `status` once this method returns. Throws
the recorded `DelegationPersistenceError` once the store has failed —
the queue does not accept work it cannot journal.

#### Type Parameters

##### Args

`Args` *extends* `AnyDelegateArgs`

#### Parameters

##### input

[`SubmitInput`](../interfaces/SubmitInput.md)\<`Args`\>

#### Returns

[`SubmitOutput`](../interfaces/SubmitOutput.md)

***

### status()

> **status**(`taskId`, `opts?`): [`DelegationStatusResult`](../interfaces/DelegationStatusResult.md) \| `undefined`

Defined in: [mcp/task-queue.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L355)

**`Experimental`**

Snapshot the current state of a delegation. Returns `undefined` for
unknown ids so callers can distinguish missing from terminal.
`includeTrace` attaches the journaled loop-trace span tree — off by
default so status polls stay light.

#### Parameters

##### taskId

`string`

##### opts?

###### includeTrace?

`boolean`

#### Returns

[`DelegationStatusResult`](../interfaces/DelegationStatusResult.md) \| `undefined`

***

### cancel()

> **cancel**(`taskId`): `boolean`

Defined in: [mcp/task-queue.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L368)

**`Experimental`**

Abort an in-flight delegation. Returns `false` if the task is unknown
or already terminal. The underlying `run` function MUST honor the
abort signal for the cancel to take effect; the queue marks the
record `cancelled` regardless so a misbehaving runner cannot pin the
UI on `running` forever.

#### Parameters

##### taskId

`string`

#### Returns

`boolean`

***

### attachFeedback()

> **attachFeedback**(`taskId`, `snapshot`): `boolean`

Defined in: [mcp/task-queue.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L388)

**`Experimental`**

Append a feedback event to the matching delegation. Returns `false`
when `ref` does not name a known taskId — the caller should still
record the feedback through a different surface (artifact/outcome
kinds are not queue-bound).

#### Parameters

##### taskId

`string`

##### snapshot

[`DelegationFeedbackSnapshot`](../interfaces/DelegationFeedbackSnapshot.md)

#### Returns

`boolean`

***

### history()

> **history**(`args?`): [`DelegationHistoryEntry`](../interfaces/DelegationHistoryEntry.md)[]

Defined in: [mcp/task-queue.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L400)

**`Experimental`**

Query the recorded delegations. Returns entries newest-first (by
`startedAt`), truncated to `limit`.

#### Parameters

##### args?

[`DelegationHistoryArgs`](../interfaces/DelegationHistoryArgs.md) = `{}`

#### Returns

[`DelegationHistoryEntry`](../interfaces/DelegationHistoryEntry.md)[]

***

### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [mcp/task-queue.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L419)

**`Experimental`**

Await every journal write issued so far. Rejects with the recorded
`DelegationPersistenceError` when any of them failed. Call before
handing the store's backing file to another process.

#### Returns

`Promise`\<`void`\>

***

### inflightCount()

> **inflightCount**(): `number`

Defined in: [mcp/task-queue.ts:435](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L435)

**`Experimental`**

Test-only — number of in-flight (non-terminal) records.

#### Returns

`number`
