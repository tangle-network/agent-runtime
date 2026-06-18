[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / InMemoryFeedbackStore

# Class: InMemoryFeedbackStore

Defined in: [mcp/feedback-store.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L41)

**`Experimental`**

## Implements

- [`FeedbackStore`](../interfaces/FeedbackStore.md)

## Constructors

### Constructor

> **new InMemoryFeedbackStore**(): `InMemoryFeedbackStore`

**`Experimental`**

#### Returns

`InMemoryFeedbackStore`

## Methods

### put()

> **put**(`event`): `Promise`\<`void`\>

Defined in: [mcp/feedback-store.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L44)

**`Experimental`**

Append a new event. Never dedupes — every rating is its own event.

#### Parameters

##### event

[`FeedbackEvent`](../interfaces/FeedbackEvent.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`FeedbackStore`](../interfaces/FeedbackStore.md).[`put`](../interfaces/FeedbackStore.md#put)

***

### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](../interfaces/FeedbackEvent.md)[]\>

Defined in: [mcp/feedback-store.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L48)

**`Experimental`**

List events filtered by `namespace`. When `namespace` is omitted, list
across all namespaces. Returns events in insertion order.

#### Parameters

##### filter?

###### namespace?

`string`

###### refersToRef?

`string`

#### Returns

`Promise`\<[`FeedbackEvent`](../interfaces/FeedbackEvent.md)[]\>

#### Implementation of

[`FeedbackStore`](../interfaces/FeedbackStore.md).[`list`](../interfaces/FeedbackStore.md#list)
