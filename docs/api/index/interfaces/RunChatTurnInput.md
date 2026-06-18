[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RunChatTurnInput

# Interface: RunChatTurnInput

Defined in: [durable/chat-engine.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L76)

Turn-lifecycle helpers for `@tangle-network/agent-runtime`.

Execution state — long-running execution, reconnect, replay, dedup —
lives in the substrate (`@tangle-network/sandbox` + orchestrator).
agent-runtime owns:

  - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
    `session.run.*` envelope, persist / post-process / trace-flush
    hook ordering.
  - `deriveExecutionId` — convention helper for the stable id products
    persist so a retry of the same turn lands on the same execution.

## Properties

### identity

> **identity**: [`ChatTurnIdentity`](ChatTurnIdentity.md)

Defined in: [durable/chat-engine.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L77)

***

### hooks

> **hooks**: [`ChatTurnHooks`](ChatTurnHooks.md)

Defined in: [durable/chat-engine.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L78)

***

### waitUntil?

> `optional` **waitUntil?**: (`p`) => `void`

Defined in: [durable/chat-engine.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L81)

Worker liveness hook. When omitted, trace flush is awaited inline
 before the stream closes.

#### Parameters

##### p

`Promise`\<`unknown`\>

#### Returns

`void`

***

### log?

> `optional` **log?**: (`message`, `meta?`) => `void`

Defined in: [durable/chat-engine.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L84)

Structured logger for swallowed hook errors. Defaults to
 `console.error` so failures surface without product wiring.

#### Parameters

##### message

`string`

##### meta?

`Record`\<`string`, `unknown`\>

#### Returns

`void`
