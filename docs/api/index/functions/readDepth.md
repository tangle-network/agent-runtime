[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / readDepth

# Function: readDepth()

> **readDepth**(`headers`): `number`

Defined in: [conversation/headers.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L52)

Read the depth counter off an inbound request. Missing → 0 (caller is the
origin). Non-integer → throws — silent coercion would let a bad caller
reset depth and bypass the limit.

## Parameters

### headers

`Readonly`\<`Record`\<`string`, `string` \| `string`[] \| `undefined`\>\>

## Returns

`number`
