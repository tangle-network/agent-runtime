[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / InMemoryDelegationStore

# Class: InMemoryDelegationStore

Defined in: [mcp/delegation-store.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L75)

**`Experimental`**

## Implements

- [`DelegationStore`](../interfaces/DelegationStore.md)

## Constructors

### Constructor

> **new InMemoryDelegationStore**(): `InMemoryDelegationStore`

**`Experimental`**

#### Returns

`InMemoryDelegationStore`

## Methods

### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](../interfaces/DelegationRecord.md)[]\>

Defined in: [mcp/delegation-store.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L78)

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

Defined in: [mcp/delegation-store.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L82)

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

Defined in: [mcp/delegation-store.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L86)

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

Defined in: [mcp/delegation-store.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L93)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

#### Parameters

##### taskIds

readonly `string`[]

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`DelegationStore`](../interfaces/DelegationStore.md).[`remove`](../interfaces/DelegationStore.md#remove)
