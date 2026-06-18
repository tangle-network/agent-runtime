[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InMemoryResultBlobStore

# Class: InMemoryResultBlobStore

Defined in: [durable/spawn-journal.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L69)

In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied
`outRef` matches the artifact's hash so a stale/forged ref fails loud rather than
silently rehydrating the wrong payload. Idempotent on an identical re-put.

## Implements

- [`ResultBlobStore`](../interfaces/ResultBlobStore.md)

## Constructors

### Constructor

> **new InMemoryResultBlobStore**(): `InMemoryResultBlobStore`

#### Returns

`InMemoryResultBlobStore`

## Methods

### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L72)

#### Parameters

##### outRef

`string`

##### artifact

`unknown`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`ResultBlobStore`](../interfaces/ResultBlobStore.md).[`put`](../interfaces/ResultBlobStore.md#put)

***

### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: [durable/spawn-journal.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L77)

#### Parameters

##### outRef

`string`

#### Returns

`Promise`\<`unknown`\>

#### Implementation of

[`ResultBlobStore`](../interfaces/ResultBlobStore.md).[`get`](../interfaces/ResultBlobStore.md#get)
