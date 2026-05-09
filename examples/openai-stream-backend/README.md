# openai-stream-backend

`runAgentTaskStream` against `createOpenAICompatibleBackend`. Use for any
OpenAI-shaped chat completions endpoint (TCloud router, official OpenAI,
Anthropic compat layers, vLLM, LiteLLM, …).

## Run

```bash
# To run end-to-end you need a real endpoint + key:
OPENAI_API_KEY=... \
OPENAI_BASE_URL=https://router.tangle.tools/v1 \
pnpm tsx examples/openai-stream-backend/openai-stream-backend.ts

# The example exits with a clear message if creds are missing.
```

## What it shows

- `createOpenAICompatibleBackend` — minimal config: base URL, model, api key
- Streaming text deltas from the model directly into your route's SSE
  output
- Session resumption via `InMemoryRuntimeSessionStore` — swap for a
  durable store in production
