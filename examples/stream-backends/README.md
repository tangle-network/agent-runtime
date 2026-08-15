# Choose where the tokens come from

## When to use it

Use this when you must choose where the tokens come from.
Three sources feed the same `runAgentTaskStream` call and emit the same typed events, so your route never learns which one ran.

| Source | Use it for |
|---|---|
| `createIterableBackend` | You own the loop. Write an async generator that yields events. Good for tests and scripted demos. |
| `createSandboxPromptBackend` | A remote sandbox box runs the agent and streams its native events. The default mapper reads them, so you write no translation. |
| `streamAgentTurn` | An exact `AgentProfile` through Runtime. Runtime keeps the prompt, provider, model, and generation controls, and meters the spend. |

Use a sibling instead when the backend is not the question.
[`../stream-a-turn`](../stream-a-turn) writes one backend by hand and reads the events.
[`../chat-handler`](../chat-handler) serves the same stream over HTTP.

## How to use it

```bash
pnpm build && pnpm tsx examples/stream-backends/stream-backends.ts
```

The first two sections run offline against an in-process box.
Each section serializes its events as Server-Sent Events, the `data: ...` format a browser reads with `EventSource`:

```text
--- iterable backend ---
data: {"type":"text_delta","text":"you said: hello\n"}

--- sandbox backend ---
data: {"type":"text_delta","text":"received: hello\n"}
data: {"type":"tool_call","toolName":"Read","toolCallId":"call_1", ...}
data: {"type":"tool_result","toolName":"Read", ...}
```

The third section needs a router key:

```bash
TANGLE_API_KEY=sk-... pnpm tsx examples/stream-backends/stream-backends.ts
```

`MODEL` and `MODEL_PROVIDER` override the defaults.
`ROUTER_BASE` changes only the transport endpoint.
The output keeps the same shape as the offline sections.

## Why this exists

The usual coupling in an agent app is that the frontend learns which backend it talks to, because each one streams a different shape.
Here every source lands on one typed event union and one SSE serialization.
You swap test, sandbox, and hosted model without touching the route or the collector.
