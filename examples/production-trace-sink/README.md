# Production trace sink

The data-capture primitive every vertical agent's chat handler wires in
once. Until this existed, eval runs captured everything and production
captured nothing — RL training corpora, the analyst loop, and research
all ran on synthetic personas.

What `createProductionTraceSink` does:

- Gives the chat handler a `TraceStore` to write spans to during the
  request.
- On `endRun`, composes a canonical `ProductionRunRecord` (`projectId`,
  `scenarioId`, `pass`, `score`, `spanCount`, …), persists it via your
  `ProductionRunRecordStore` (Drizzle / D1 / Postgres).
- Optionally ships the run as OTLP to Langfuse (`otlp.endpoint`).
- `sink.recordFeedback({ runId, label })` writes the user's thumbs-up /
  thumbs-down into a `FeedbackTrajectory` — the corpus DPO/KTO trainers
  consume.

Errors are logged, never thrown — the chat handler is unaffected by a
failing OTLP collector.

The example uses an in-memory `runRecordStore` so it runs offline. Swap
in a real DB adapter and the wiring is unchanged.

```bash
pnpm tsx examples/production-trace-sink/production-trace-sink.ts
```
