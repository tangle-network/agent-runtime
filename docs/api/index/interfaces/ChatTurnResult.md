[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ChatTurnResult

# Interface: ChatTurnResult

Defined in: [durable/chat-engine.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L87)

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

### body

> **body**: `ReadableStream`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [durable/chat-engine.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L89)

NDJSON body — return this as the platform `Response` body.

***

### contentType

> **contentType**: `"application/x-ndjson"`

Defined in: [durable/chat-engine.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L91)

Content type for the response.
