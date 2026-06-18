[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ResultBlobStore

# Interface: ResultBlobStore

Defined in: [runtime/supervise/types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L415)

Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 invariant. Split from the journal so the journal stays small (decisions) and the
 payloads (evidence) live where a viewer/replayer rehydrates them.

## Methods

### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [runtime/supervise/types.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L416)

#### Parameters

##### outRef

`string`

##### artifact

`unknown`

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: [runtime/supervise/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L417)

#### Parameters

##### outRef

`string`

#### Returns

`Promise`\<`unknown`\>
