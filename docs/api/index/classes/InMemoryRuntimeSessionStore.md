[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / InMemoryRuntimeSessionStore

# Class: InMemoryRuntimeSessionStore

Defined in: [sessions.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L40)

## Stable

## Implements

- [`RuntimeSessionStore`](../interfaces/RuntimeSessionStore.md)

## Constructors

### Constructor

> **new InMemoryRuntimeSessionStore**(): `InMemoryRuntimeSessionStore`

#### Returns

`InMemoryRuntimeSessionStore`

## Methods

### get()

> **get**(`sessionId`): `RuntimeSession` \| `undefined`

Defined in: [sessions.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L44)

#### Parameters

##### sessionId

`string`

#### Returns

`RuntimeSession` \| `undefined`

#### Implementation of

[`RuntimeSessionStore`](../interfaces/RuntimeSessionStore.md).[`get`](../interfaces/RuntimeSessionStore.md#get)

***

### put()

> **put**(`session`): `void`

Defined in: [sessions.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L48)

#### Parameters

##### session

`RuntimeSession`

#### Returns

`void`

#### Implementation of

[`RuntimeSessionStore`](../interfaces/RuntimeSessionStore.md).[`put`](../interfaces/RuntimeSessionStore.md#put)

***

### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

Defined in: [sessions.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L52)

#### Parameters

##### sessionId

`string`

##### event

[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)

#### Returns

`void`

#### Implementation of

[`RuntimeSessionStore`](../interfaces/RuntimeSessionStore.md).[`appendEvent`](../interfaces/RuntimeSessionStore.md#appendevent)

***

### listEvents()

> **listEvents**(`sessionId`): [`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[]

Defined in: [sessions.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L58)

#### Parameters

##### sessionId

`string`

#### Returns

[`RuntimeStreamEvent`](../type-aliases/RuntimeStreamEvent.md)[]

#### Implementation of

[`RuntimeSessionStore`](../interfaces/RuntimeSessionStore.md).[`listEvents`](../interfaces/RuntimeSessionStore.md#listevents)
