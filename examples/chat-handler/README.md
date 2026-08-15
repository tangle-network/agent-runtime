# Serve one chat turn over HTTP

## When to use it

Use this when a web route must stream one turn to a browser and save the reply.
`handleChatTurn` owns the framing every chat product hand-rolls: NDJSON lines, a start and finish envelope, and one persist call after the last token.
You give it how to produce the response and how to persist it; it streams, traces, and persists.

Use a sibling instead when you do not need the HTTP layer.

| You need | Use |
|---|---|
| The event stream, with no HTTP framing | [`../stream-a-turn`](../stream-a-turn) |
| The model to call your tools inside the turn | [`../tool-loop`](../tool-loop) |
| A cost figure and one persisted row | [`../runtime-run`](../runtime-run) |
| A turn that survives the reader disconnecting | [`../retained-run`](../retained-run) |

## How to use it

```bash
pnpm build && pnpm tsx examples/chat-handler/chat-handler.ts
```

The example scripts a two-turn conversation, so it runs offline and needs no credentials.
It prints each turn as it starts, streams, finishes, and persists:

```text
[run started ] turn=0
...............
[run done    ] turn=0
[persist     ] turn=0 chars=52
[turn 0 text ] Acknowledged: "Where do I start with my 2026 return?". Drafting a reply.
```

In a route you return `result.body` and let the client read the NDJSON.

```ts
const executionId = deriveExecutionId({ projectId, sessionId: threadId, turnIndex })
const result = handleChatTurn({
  identity: { tenantId, sessionId: threadId, userId, turnIndex },
  hooks: {
    produce: () => ({ stream: box.streamPrompt(userMessage, { sessionId: threadId, executionId, turnId: executionId, detach: true }), finalText: () => box.lastResponse() }),
    persistAssistantMessage: async ({ identity, finalText }) => db.insertMessage(identity, finalText),
  },
  waitUntil,
})
return new Response(result.body, { headers: { 'content-type': result.contentType } })
```

Only `produce()` is scripted in the example.
In production it wraps a profile-bound turn: `streamAgentTurn({ kind: 'executor', profile, factory: createExecutor(config) }, input)`.

Two identity rules matter.
For a stream reconnect, call `streamPrompt` again with the same `executionId` and the last event id the client received.
For a repeated first dispatch, reuse both `sessionId` and `turnId`, because `executionId` alone is not an idempotency key.

The bottom half of [`chat-handler.ts`](./chat-handler.ts) reads the stream back by hand only to keep the file self-contained.
Do not copy that reader.

## Why this exists

The middle layer of a chat product is small, fiddly, and always the same.
Bad framing makes the client hang, save twice, or drop the tail of a reply.
`handleChatTurn` does that layer once: one JSON event per line, a `session.run.started` and `session.run.completed` envelope, and one persist call after the stream drains.
