[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / eventToSnapshot

# Function: eventToSnapshot()

> **eventToSnapshot**(`event`): [`DelegationFeedbackSnapshot`](../interfaces/DelegationFeedbackSnapshot.md)

Defined in: [mcp/feedback-store.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L66)

**`Experimental`**

Project a `FeedbackEvent` down to the snapshot shape carried on
`delegation_history` entries.

## Parameters

### event

[`FeedbackEvent`](../interfaces/FeedbackEvent.md)

## Returns

[`DelegationFeedbackSnapshot`](../interfaces/DelegationFeedbackSnapshot.md)
