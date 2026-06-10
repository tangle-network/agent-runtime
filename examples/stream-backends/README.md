# stream-backends

The three stream transports behind `runAgentTaskStream`, side by side, all
landing on the same SSE serialization a browser route writes:

| Backend | Factory | When |
|---|---|---|
| Iterable | `createIterableBackend` | You own the event loop (tests, scripted demos, custom shapes) |
| Sandbox | `createSandboxPromptBackend` | A `@tangle-network/sandbox` box streams the canonical `SandboxEvent` vocabulary — the default mapper handles `message.part.updated` / `tool_call` / `tool_result`, no custom `mapEvent` needed |
| OpenAI-compatible | `createOpenAICompatibleBackend` | Any OpenAI-compatible chat endpoint (the Tangle router, OpenAI, vLLM, ...) |

Plus the two SSE helpers: `runtimeStreamServerSentEvent` for each
`RuntimeStreamEvent`, and `readinessServerSentEvent` for the one-off
knowledge-readiness event a gated task emits.

## Run

```bash
pnpm tsx examples/stream-backends/stream-backends.ts
```

The iterable and sandbox sections run offline (synthetic box). The
OpenAI-compatible section runs only when `OPENAI_API_KEY` is set
(`OPENAI_BASE_URL` / `OPENAI_MODEL` optional) and says so when skipped.

## What it shows

- All three backends yield the same typed `RuntimeStreamEvent` stream —
  swapping transports does not touch your route or your collector wiring
- The sandbox-SDK event vocabulary consumers copy verbatim (text deltas as
  `message.part.updated` with nested `part.text`, tool turns as
  `tool_call` / `tool_result`)
- SSE framing for browser routes in two helper calls
