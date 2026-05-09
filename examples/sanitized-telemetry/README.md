# sanitized-telemetry

How to capture redacted lifecycle events from a task run. Multi-tenant
products should never serialize raw events directly — they may carry
inputs, user answers, credentials, evidence ids, or eval details. The
`createRuntimeEventCollector` redacts all of those by default; you opt
back in field by field.

## Run

```bash
pnpm tsx examples/sanitized-telemetry/sanitized-telemetry.ts
```

## What it shows

- `createRuntimeEventCollector()` capturing every lifecycle event safely
- `summarizeAgentTaskRun` producing a one-line summary for logs
- The `RuntimeTelemetryOptions` flags (`includeInputs`, `includeUserAnswers`,
  `includeControlPayloads`, etc.) and what each enables
