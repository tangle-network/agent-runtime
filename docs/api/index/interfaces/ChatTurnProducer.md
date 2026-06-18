[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ChatTurnProducer

# Interface: ChatTurnProducer\<TEvent\>

Defined in: [durable/chat-engine.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L45)

The live side of a turn — what the product's `produce` hook returns.

## Type Parameters

### TEvent

`TEvent` *extends* [`ChatStreamEvent`](ChatStreamEvent.md) = [`ChatStreamEvent`](ChatStreamEvent.md)

## Properties

### stream

> **stream**: `AsyncGenerator`\<`TEvent`, `void`, `unknown`\>

Defined in: [durable/chat-engine.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L47)

The turn's event stream. Forwarded verbatim to the caller.

## Methods

### finalText()

> **finalText**(): `string`

Defined in: [durable/chat-engine.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L49)

The turn's final assistant text. Read once, after `stream` drains.

#### Returns

`string`
