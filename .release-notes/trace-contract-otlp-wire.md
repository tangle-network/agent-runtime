type: minor
---
OTLP ids, attribute encoding and partial-success parsing now come from `@tangle-network/agent-trace-contract` 2.2.0 (`toW3CTraceId`, `toW3CSpanId` and its `./otlp` subpath), so Runtime's spans carry the same wire ids and value types as the Sandbox SDK, agent-app and agent-eval. `padTraceId` and `padSpanId` keep their names and are now the contract's `toW3CTraceId` / `toW3CSpanId`, the same rule. `OtelSpan` and `OtelAttribute` are now the contract's `OtlpSpan` and `OtlpKeyValue`, so `kind` and `attributes` are required. Span timestamps keep microseconds.
