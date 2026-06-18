[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeRunPersistenceAdapter

# Interface: RuntimeRunPersistenceAdapter

Defined in: [runtime-run.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L79)

## Stable

## Methods

### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

Defined in: [runtime-run.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L87)

Called once when `handle.persist()` runs. Implementations write `row` to
their durable store (D1, postgres, KV) and return whatever the consumer
wants the caller to see (often the storage-side row id). Errors thrown
here propagate out of `persist()` so the caller can decide whether to
retry or log-and-continue.

#### Parameters

##### row

[`RuntimeRunRow`](RuntimeRunRow.md)

#### Returns

`void` \| `Promise`\<`void`\>
