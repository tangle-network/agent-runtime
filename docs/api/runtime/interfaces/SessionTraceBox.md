[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SessionTraceBox

# Interface: SessionTraceBox

Defined in: [runtime/supervise/trace-source.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L270)

The minimal box surface this needs: list a session's messages (incl. mid-turn partials).

## Methods

### messages()

> **messages**(`opts`): `Promise`\<readonly [`SessionMessageLike`](SessionMessageLike.md)[]\>

Defined in: [runtime/supervise/trace-source.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L271)

#### Parameters

##### opts

###### sessionId

`string`

#### Returns

`Promise`\<readonly [`SessionMessageLike`](SessionMessageLike.md)[]\>
