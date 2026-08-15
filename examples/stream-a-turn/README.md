# Stream one agent turn

## When to use it

Use this when you run one agent turn and read its events yourself.
This is the smallest complete path through the runtime, and it is the path most products take.
Two contracts carry it: you write an `AgentExecutionBackend`, and you read `RuntimeStreamEvent` values back.

Use a sibling instead when you need more than the raw stream.

| You also need | Use |
|---|---|
| An HTTP response and a saved reply | [`../chat-handler`](../chat-handler) |
| A cost figure and one persisted row | [`../runtime-run`](../runtime-run) |
| A ready-made backend for a model, a sandbox, or your own loop | [`../stream-backends`](../stream-backends) |
| The model to call your tools inside the same turn | [`../tool-loop`](../tool-loop) |
| Several attempts under your own stop rule | [`../quickstart`](../quickstart) |

## How to use it

```bash
pnpm build && pnpm tsx examples/stream-a-turn/stream-a-turn.ts
```

The example runs offline and needs no credentials.
It prints:

```text
Checking the refund policy
A renewal is refundable within 14 days of the charge.

status: completed — backend completed
tools: search_policy
cost: $0.0009 — reply chars: 81
```

Read [`stream-a-turn.ts`](./stream-a-turn.ts) for the whole file.
The two contracts are these.

```ts
const backend: AgentExecutionBackend = {
  kind: 'scripted-support',
  async *stream(input, ctx): AsyncIterable<RuntimeStreamEvent> {
    yield { type: 'text_delta', text: 'Checking the refund policy', timestamp: now() }
  },
}

for await (const event of runAgentTaskStream({ task, backend, input, sessionStore, sessionId })) {
  if (event.type === 'text_delta') process.stdout.write(event.text)
}
```

Replace the scripted backend with your model call, your sandbox, or your coding CLI.
The reader code does not change.

## Why this exists

`RuntimeStreamEvent` is one union for every event source, so your product code reads one shape.
The runtime adds the parts a turn always needs around your backend: readiness checks, session start or resume, and a terminal `final` event.
Your backend stays small because it only produces events.
