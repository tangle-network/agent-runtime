[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeSessionStore

# Interface: RuntimeSessionStore

Defined in: [types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L444)

## Stable

## Methods

### get()

> **get**(`sessionId`): `RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

Defined in: [types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L445)

#### Parameters

##### sessionId

`string`

#### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

***

### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L446)

#### Parameters

##### session

`RuntimeSession`

#### Returns

`void` \| `Promise`\<`void`\>

***

### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L447)

#### Parameters

##### sessionId

`string`

##### event

[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[] \| `Promise`\<[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[]\>

Defined in: [types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L448)

#### Parameters

##### sessionId

`string`

#### Returns

[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[] \| `Promise`\<[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[]\>
