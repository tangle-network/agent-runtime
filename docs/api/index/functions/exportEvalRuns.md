[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / exportEvalRuns

# Function: exportEvalRuns()

> **exportEvalRuns**(`events`, `config?`): `Promise`\<[`EvalRunsExportResult`](../interfaces/EvalRunsExportResult.md)\>

Defined in: [otel-export.ts:582](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L582)

Ship self-improvement eval-run events to Tangle Intelligence. Unlike the
best-effort span exporter, this RESOLVES with the ingest verdict (accepted /
rejected per event) so a consumer's loop can assert its provenance landed.
Throws only on a missing key or network failure.

## Parameters

### events

[`EvalRunEvent`](../interfaces/EvalRunEvent.md)[]

### config?

[`EvalRunsExportConfig`](../interfaces/EvalRunsExportConfig.md)

## Returns

`Promise`\<[`EvalRunsExportResult`](../interfaces/EvalRunsExportResult.md)\>
