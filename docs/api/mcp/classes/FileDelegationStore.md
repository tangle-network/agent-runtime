[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FileDelegationStore

# Class: FileDelegationStore

Defined in: [mcp/delegation-store.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L130)

**`Experimental`**

JSON-file persistence for the delegation queue. Each write serializes
the full record set and lands it atomically (write to a sibling tmp
file, then `rename`), so readers never observe a torn file — a crash
mid-write leaves the previous snapshot intact. Writes are serialized
internally; concurrent `upsert`/`remove` calls cannot interleave.

Built for the MCP server's scale (one stdio process, hundreds of
records): full-snapshot writes keep the format trivially inspectable
and corruption-detectable without a database dependency.

## Implements

- [`DelegationStore`](../interfaces/DelegationStore.md)

## Constructors

### Constructor

> **new FileDelegationStore**(`options`): `FileDelegationStore`

Defined in: [mcp/delegation-store.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L138)

**`Experimental`**

#### Parameters

##### options

[`FileDelegationStoreOptions`](../interfaces/FileDelegationStoreOptions.md)

#### Returns

`FileDelegationStore`

## Methods

### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](../interfaces/DelegationRecord.md)[]\>

Defined in: [mcp/delegation-store.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L143)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

#### Returns

`Promise`\<[`DelegationRecord`](../interfaces/DelegationRecord.md)[]\>

#### Implementation of

[`DelegationStore`](../interfaces/DelegationStore.md).[`loadAll`](../interfaces/DelegationStore.md#loadall)

***

### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L180)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

#### Parameters

##### record

[`DelegationRecord`](../interfaces/DelegationRecord.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`DelegationStore`](../interfaces/DelegationStore.md).[`upsert`](../interfaces/DelegationStore.md#upsert)

***

### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L186)

**`Experimental`**

Resolve an idempotency key to the taskId that claimed it, if any.
The queue serves submit-time dedupe from its rehydrated in-memory
index; this read exists for consumers that share a store across
processes without holding the full record set.

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`string` \| `undefined`\>

#### Implementation of

[`DelegationStore`](../interfaces/DelegationStore.md).[`lookupIdempotencyKey`](../interfaces/DelegationStore.md#lookupidempotencykey)

***

### remove()

> **remove**(`taskIds`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L194)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

#### Parameters

##### taskIds

readonly `string`[]

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`DelegationStore`](../interfaces/DelegationStore.md).[`remove`](../interfaces/DelegationStore.md#remove)
