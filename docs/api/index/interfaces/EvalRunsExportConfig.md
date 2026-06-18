[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / EvalRunsExportConfig

# Interface: EvalRunsExportConfig

Defined in: [otel-export.ts:558](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L558)

## Properties

### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [otel-export.ts:560](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L560)

Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY.

***

### base?

> `optional` **base?**: `string`

Defined in: [otel-export.ts:562](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L562)

Intelligence base. Reads INTELLIGENCE_BASE env, else prod.

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [otel-export.ts:564](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L564)

Idempotency-Key header (e.g. the runId) — safe retries + upsert.
