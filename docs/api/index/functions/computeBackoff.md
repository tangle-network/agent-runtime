[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / computeBackoff

# Function: computeBackoff()

> **computeBackoff**(`spec`, `attempt`): `number`

Defined in: [conversation/call-policy.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L166)

Compute the delay before the next attempt. Default: 250ms exponential with jitter.

## Parameters

### spec

[`RetryBackoff`](../type-aliases/RetryBackoff.md) \| `undefined`

### attempt

`number`

## Returns

`number`
