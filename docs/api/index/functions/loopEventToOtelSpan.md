[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / loopEventToOtelSpan

# Function: loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): [`OtelSpan`](../interfaces/OtelSpan.md)

Defined in: [otel-export.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L162)

Convert a LoopTraceEvent into an OtelSpan for export.

## Parameters

### event

#### kind

`string`

#### runId

`string`

#### timestamp

`number`

#### payload

`object`

### traceId

`string`

### parentSpanId?

`string`

## Returns

[`OtelSpan`](../interfaces/OtelSpan.md)
