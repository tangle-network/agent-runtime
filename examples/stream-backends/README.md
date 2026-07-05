# Three sources of an AI's streaming output, one wire format for your app

An agent's output arrives as a live stream of events: text as it's typed, tool calls as they
fire, tool results as they return. That stream can come from three very different places — a
function you wrote, a remote sandbox running a coding agent, or any OpenAI-compatible chat
API. This example runs all three and shows they emit the **same typed events** and serialize
to the **same format a browser reads**, so the source is a swappable detail your UI never
sees.

## Why it matters

The painful coupling in agent apps is that the frontend ends up knowing which backend it's
talking to — mock in tests, a real model in prod, a sandbox for the heavy stuff — because
each streams a different shape. Here they don't. Every backend lands on one typed event
stream and one SSE serialization, so you swap transports (test → sandbox → hosted model)
without touching the route that streams to the browser or the code that collects the events.

("SSE" is Server-Sent Events, the plain `data: ...\n\n` streaming format a browser reads with
`EventSource` — the standard way a web app receives a live token stream.)

## The three backends

| Backend | You'd use it for |
|---|---|
| **Iterable** (`createIterableBackend`) | You own the loop: write an async generator that yields events directly. For tests, scripted demos, or wrapping a stream shape the others don't map. |
| **Sandbox** (`createSandboxPromptBackend`) | A remote `@tangle-network/sandbox` box runs the agent and streams back its native events (text updates, tool calls, tool results). The default mapper already understands them, so you write no translation code. |
| **OpenAI-compatible** (`createOpenAICompatibleBackend`) | Any OpenAI-style chat endpoint: OpenAI itself, the Tangle router, a local vLLM server. |

All three feed `runAgentTaskStream`, which emits a typed `RuntimeStreamEvent` stream, which
two helpers serialize to SSE (`runtimeStreamServerSentEvent` per event, plus
`readinessServerSentEvent` for a one-off "still waiting on required info" event a gated task
can emit).

## Run it

```bash
pnpm tsx examples/stream-backends/stream-backends.ts
```

No API key needed for the first two backends: the iterable and sandbox sections run offline
against a synthetic in-process box. You'll see each section stream SSE frames to stdout,
e.g.:

```
--- iterable backend ---
data: {"type":"text_delta","text":"you said: hello\n"}

--- sandbox backend ---
data: {"type":"text_delta","text":"received: hello\n"}
data: {"type":"tool_call","toolName":"Read","toolCallId":"call_1", ...}
data: {"type":"tool_result","toolName":"Read", ...}
```

The third (OpenAI-compatible) section is skipped with a printed note unless you give it a real
endpoint:

```bash
OPENAI_API_KEY=sk-... pnpm tsx examples/stream-backends/stream-backends.ts
```

Point it anywhere OpenAI-compatible with `OPENAI_BASE_URL` and `OPENAI_MODEL` — e.g. set
`OPENAI_BASE_URL=https://router.tangle.tools/v1` and pass a Tangle key as `OPENAI_API_KEY` to
stream from the Tangle router. The output is the same SSE shape as the offline sections.
