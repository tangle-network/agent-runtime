# sse-stream

Encode lifecycle events as Server-Sent Events for a browser/HTTP route.
The package ships two helpers: `readinessServerSentEvent` for one-off
readiness reports, and `runtimeStreamServerSentEvent` for the streamed
event variant from `runAgentTaskStream`.

## Run

```bash
pnpm tsx examples/sse-stream/sse-stream.ts
```

## What it shows

- Encoding a `KnowledgeReadinessReport` to SSE in a single call
- Encoding a stream of `RuntimeStreamEvent` to SSE inside an
  `runAgentTaskStream` loop
- Why you should never `JSON.stringify` events directly — these helpers
  delegate to the same redaction rules as `createRuntimeEventCollector`
