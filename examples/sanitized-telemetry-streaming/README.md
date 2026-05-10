# sanitized-telemetry-streaming

Streaming-event counterpart of [`sanitized-telemetry/`](../sanitized-telemetry/).
Shows `createRuntimeStreamEventCollector` consuming a `runAgentTaskStream`
loop with redaction on by default.

`runAgentTaskStream` yields a different event shape than `runAgentTask`
(timestamps, sessions, text/tool deltas) so it has its own collector
factory. Both honor the same `RuntimeTelemetryOptions` flags.

## Run

```bash
pnpm tsx examples/sanitized-telemetry-streaming/sanitized-telemetry-streaming.ts
```

## What it shows

- `createRuntimeStreamEventCollector()` capturing each yielded
  `RuntimeStreamEvent` safely
- The opt-in pattern via `includeInputs` / `includeControlPayloads` /
  `includeEvidenceIds` / `includeMetadata`
- `collector.summary()` rolling up event counts, session id, final
  status, and concatenated `text_delta` text

## `task.intent` is sanitized telemetry by default

The `task.intent` string flows through sanitized telemetry on every
event. Treat it like a static label — set it to a fixed operation kind
(`"Look up a customer record"`, `"Score a tax return"`), never to user
input. If you need to log user-visible intent, route it through `inputs`
(redacted by default).
