# sanitized-telemetry-streaming

Shows `createRuntimeStreamEventCollector` consuming a `runAgentTaskStream`
loop with redaction on by default. Multi-tenant products should never
serialize raw events directly — they may carry inputs, user answers,
credentials, evidence ids, or eval details. The collector redacts all of
those by default; you opt back in field by field.

## Non-streaming counterpart

For non-streaming `runAgentTask` runs, use `createRuntimeEventCollector()`
instead — same default redaction, same `RuntimeTelemetryOptions` flags
(`includeInputs`, `includeMetadata`, `includeEvalDetails`, ...), passed as
`onEvent: collector.onEvent`. `runAgentTaskStream` yields a different event
shape than `runAgentTask` (timestamps, sessions, text/tool deltas) so it has
its own collector factory; both honor the same options.

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
