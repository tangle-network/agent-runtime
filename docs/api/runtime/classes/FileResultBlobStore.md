[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FileResultBlobStore

# Class: FileResultBlobStore

Defined in: [durable/spawn-journal.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L87)

FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
`put` fsyncs so a crash between writes never loses an acknowledged blob.

## Implements

- [`ResultBlobStore`](../interfaces/ResultBlobStore.md)

## Constructors

### Constructor

> **new FileResultBlobStore**(`dir`): `FileResultBlobStore`

Defined in: [durable/spawn-journal.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L88)

#### Parameters

##### dir

`string`

#### Returns

`FileResultBlobStore`

## Methods

### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L90)

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

Defined in: [durable/spawn-journal.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L103)

#### Parameters

##### outRef

`string`

#### Returns

`Promise`\<`unknown`\>

#### Implementation of

[`ResultBlobStore`](../interfaces/ResultBlobStore.md).[`get`](../interfaces/ResultBlobStore.md#get)
