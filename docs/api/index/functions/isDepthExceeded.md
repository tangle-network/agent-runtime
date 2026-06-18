[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / isDepthExceeded

# Function: isDepthExceeded()

> **isDepthExceeded**(`inboundDepth`, `max?`): `boolean`

Defined in: [conversation/headers.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L70)

Refuse further forwarding when the inbound depth has reached the limit.
Callers (the gateway middleware) translate the boolean to an HTTP 413.

## Parameters

### inboundDepth

`number`

### max?

`number` = `DEFAULT_MAX_DEPTH`

## Returns

`boolean`
