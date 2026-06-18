[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ChatTurnHooks

# Interface: ChatTurnHooks

Defined in: [durable/chat-engine.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L52)

Turn-lifecycle helpers for `@tangle-network/agent-runtime`.

Execution state — long-running execution, reconnect, replay, dedup —
lives in the substrate (`@tangle-network/sandbox` + orchestrator).
agent-runtime owns:

  - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
    `session.run.*` envelope, persist / post-process / trace-flush
    hook ordering.
  - `deriveExecutionId` — convention helper for the stable id products
    persist so a retry of the same turn lands on the same execution.

## Methods

### produce()

> **produce**(): [`ChatTurnProducer`](ChatTurnProducer.md)

Defined in: [durable/chat-engine.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L55)

Build the backend stream. The engine forwards events verbatim and
 reads `finalText()` once the stream drains.

#### Returns

[`ChatTurnProducer`](ChatTurnProducer.md)

***

### persistAssistantMessage()

> **persistAssistantMessage**(`input`): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L58)

Persist the assistant message to the product's own store. Called
 once, after drain, with the assembled (transform-applied) text.

#### Parameters

##### input

###### identity

[`ChatTurnIdentity`](ChatTurnIdentity.md)

###### finalText

`string`

#### Returns

`Promise`\<`void`\>

***

### onTurnComplete()?

> `optional` **onTurnComplete**(`input`): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L62)

Optional post-processing (proposals, citations, credit metering …).
 Errors are swallowed + logged — post-process must never fail a turn
 that already streamed successfully.

#### Parameters

##### input

###### identity

[`ChatTurnIdentity`](ChatTurnIdentity.md)

###### finalText

`string`

#### Returns

`Promise`\<`void`\>

***

### onEvent()?

> `optional` **onEvent**(`event`): `void` \| `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L66)

Optional per-event side channel (e.g. DO broadcast). Runs for every
 emitted event, lifecycle envelope included. Errors swallowed — a
 broadcast failure must not break the chat stream.

#### Parameters

##### event

[`ChatStreamEvent`](ChatStreamEvent.md)

#### Returns

`void` \| `Promise`\<`void`\>

***

### transformFinalText()?

> `optional` **transformFinalText**(`text`): `string` \| `Promise`\<`string`\>

Defined in: [durable/chat-engine.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L70)

Optional pre-persist transform of the final text (e.g. PII
 redaction). Affects only what is persisted; the live stream is
 never altered.

#### Parameters

##### text

`string`

#### Returns

`string` \| `Promise`\<`string`\>

***

### traceFlush()?

> `optional` **traceFlush**(): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L73)

Optional trace flush — resolves when OTLP export completes. Handed
 to `waitUntil` so the worker isolate stays alive for the POST.

#### Returns

`Promise`\<`void`\>
