[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / handleChatTurn

# Function: handleChatTurn()

> **handleChatTurn**(`input`): [`ChatTurnResult`](../interfaces/ChatTurnResult.md)

Defined in: [durable/chat-engine.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L110)

Run one chat turn. Returns immediately with a `ReadableStream` body;
the turn executes as the body is pulled. Never rejects — backend
failures surface as `error` + `session.run.failed` events.

## Parameters

### input

[`RunChatTurnInput`](../interfaces/RunChatTurnInput.md)

## Returns

[`ChatTurnResult`](../interfaces/ChatTurnResult.md)
