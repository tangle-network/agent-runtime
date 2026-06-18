[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createPropagatingTraceEmitter

# Function: createPropagatingTraceEmitter()

> **createPropagatingTraceEmitter**(`ctx`): `object`

Defined in: [mcp/trace-propagation.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L48)

Create a LoopTraceEmitter that:
  1. Parents all spans under the inherited PARENT_SPAN_ID.
  2. Exports spans to OTEL when OTEL_EXPORTER_OTLP_ENDPOINT is set.

Returns both the emitter and the optional exporter handle for shutdown.

## Parameters

### ctx

[`TraceContext`](../interfaces/TraceContext.md)

## Returns

`object`

### emitter

> **emitter**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

### exporter

> **exporter**: [`OtelExporter`](../../index/interfaces/OtelExporter.md) \| `undefined`

### context

> **context**: [`TraceContext`](../interfaces/TraceContext.md)
