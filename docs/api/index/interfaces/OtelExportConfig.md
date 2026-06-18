[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / OtelExportConfig

# Interface: OtelExportConfig

Defined in: [otel-export.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L12)

OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector.

Reads OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS from env
when no explicit config is given. Keeps the runtime dep-free from
@opentelemetry/sdk-trace-base — minimal OTLP/JSON serializer.

The exporter accepts both raw OtelSpan objects and LoopTraceEvents
(which get converted to OTLP spans automatically).

## Properties

### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [otel-export.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L14)

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

***

### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L16)

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

***

### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [otel-export.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L18)

Batch size before flush. Default 64.

***

### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Defined in: [otel-export.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L20)

Flush interval ms. Default 5000.

***

### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L22)

Resource attributes stamped on every export.

***

### serviceName?

> `optional` **serviceName?**: `string`

Defined in: [otel-export.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L24)

Service name. Default 'agent-runtime'.
