[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / slugifySpeaker

# Function: slugifySpeaker()

> **slugifySpeaker**(`speaker`): `string`

Defined in: [conversation/turn-id.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L24)

Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough
substance to read in a log line; collisions between speakers within a
single Conversation are prevented by `defineConversation`'s
unique-name check, so the slug only needs to be deterministic, not unique.

## Parameters

### speaker

`string`

## Returns

`string`
