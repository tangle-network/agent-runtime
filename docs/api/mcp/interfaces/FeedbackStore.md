[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / FeedbackStore

# Interface: FeedbackStore

Defined in: [mcp/feedback-store.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L30)

**`Experimental`**

## Methods

### put()

> **put**(`event`): `Promise`\<`void`\>

Defined in: [mcp/feedback-store.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L32)

**`Experimental`**

Append a new event. Never dedupes — every rating is its own event.

#### Parameters

##### event

[`FeedbackEvent`](FeedbackEvent.md)

#### Returns

`Promise`\<`void`\>

***

### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](FeedbackEvent.md)[]\>

Defined in: [mcp/feedback-store.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L37)

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

`Promise`\<[`FeedbackEvent`](FeedbackEvent.md)[]\>
