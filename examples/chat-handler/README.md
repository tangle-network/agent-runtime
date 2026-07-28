# Stream an agent's reply over HTTP, then save it — in one call

You have an agent that emits its reply token-by-token. You want to serve that to a browser as a
live, streaming HTTP response, and once the reply finishes, save the final text to your database.
`handleChatTurn` (from the edge-safe `@tangle-network/agent-runtime/durable` entry point) does exactly that plumbing so you
don't hand-roll it.

Give it two things — a `produce()` function that yields your agent's token stream, and a
`persistAssistantMessage` hook — and it hands back a ready-to-return HTTP body that streams every
token as it arrives, wrapped in a clean start/finish envelope, and calls your save hook the instant
the stream ends.

## Why it matters

Every chat product re-implements the same fiddly middle layer: turn an async stream of partial
tokens into a well-framed HTTP response, tell the client when the turn starts and ends, and persist
the final message exactly once after the last token. Get the framing wrong and the client hangs,
double-saves, or drops the tail. `handleChatTurn` is that layer, done once and correctly:

- **Streams as NDJSON** — one JSON event per line (`application/x-ndjson`), so a browser or any HTTP
  client reads tokens live instead of waiting for the whole reply.
- **Wraps each turn** in a `session.run.started` / `session.run.completed` envelope, so the client
  always knows when a turn begins and ends.
- **Persists after the stream drains**, exactly once — your `persistAssistantMessage` hook fires
  with the final text after the last token, the natural place to write to your DB.

## Run it — no key, no network

```bash
pnpm tsx examples/chat-handler/chat-handler.ts
```

The example scripts a tiny two-turn tax-assistant conversation so it runs fully offline. You'll see
each turn start, stream (one `.` per token chunk), finish, persist, and print its final text:

```
[run started ] turn=0
...............
[run done    ] turn=0
[persist     ] turn=0 chars=52
[turn 0 text ] Acknowledged: "Where do I start with my 2026 return?". Drafting a reply.

[run started ] turn=1
...................
[run done    ] turn=1
[persist     ] turn=1 chars=62
[turn 1 text ] The 2026 return is missing Schedule B and one W-2. Please upload them.
```

The bottom half of `chat-handler.ts` reads the stream back by hand only so the example is
self-contained — that reader is illustrative, not something to copy. In your product you just return
`result.body` from your HTTP route and any NDJSON reader on the client consumes it.

## From offline to production — one swap

The only scripted part is `produce()`. In a real product it wraps your agent backend:

```ts
produce: () => runAgentTaskStream({ task, backend, input })
// backend = createOpenAICompatibleBackend(...)  — any OpenAI-compatible model
//         or createSandboxPromptBackend(...)     — a sandboxed coding agent
```

Everything else — the NDJSON framing, the `session.run.*` envelope, the after-drain persist — stays
identical. That framing is the whole point of `handleChatTurn`.

## Files

| file | what it is |
|---|---|
| `chat-handler.ts` | the full example: a scripted producer, `handleChatTurn`, and a hand-written reader that prints the stream |
