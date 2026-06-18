[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationStore

# Interface: DelegationStore

Defined in: [mcp/delegation-store.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L23)

**`Experimental`**

## Methods

### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](DelegationRecord.md)[]\>

Defined in: [mcp/delegation-store.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L30)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

#### Returns

`Promise`\<[`DelegationRecord`](DelegationRecord.md)[]\>

***

### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L32)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

#### Parameters

##### record

[`DelegationRecord`](DelegationRecord.md)

#### Returns

`Promise`\<`void`\>

***

### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L39)

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

***

### remove()

> **remove**(`taskIds`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L41)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

#### Parameters

##### taskIds

readonly `string`[]

#### Returns

`Promise`\<`void`\>
