[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / buildForwardHeaders

# Function: buildForwardHeaders()

> **buildForwardHeaders**(`input`): `Record`\<`string`, `string`\>

Defined in: [conversation/headers.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L81)

Build the headers to emit on an outbound participant call, given the
conversation's propagation context. Depth is incremented from the inbound
value; runId / turnId / speaker stamp the current hop; the user's
`Authorization` is preserved verbatim so the downstream gateway bills the
right wallet.

## Parameters

### input

#### inboundDepth

`number`

#### forwardedAuthorization?

`string`

#### runId

`string`

#### turnId

`string`

#### parentTurnId?

`string`

#### speaker

`string`

## Returns

`Record`\<`string`, `string`\>
