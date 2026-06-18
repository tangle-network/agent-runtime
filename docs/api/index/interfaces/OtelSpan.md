[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / OtelSpan

# Interface: OtelSpan

Defined in: [otel-export.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L36)

## Properties

### traceId

> **traceId**: `string`

Defined in: [otel-export.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L37)

***

### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L38)

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L39)

***

### name

> **name**: `string`

Defined in: [otel-export.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L40)

***

### kind?

> `optional` **kind?**: `number`

Defined in: [otel-export.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L41)

***

### startTimeUnixNano

> **startTimeUnixNano**: `string`

Defined in: [otel-export.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L42)

***

### endTimeUnixNano

> **endTimeUnixNano**: `string`

Defined in: [otel-export.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L43)

***

### attributes?

> `optional` **attributes?**: [`OtelAttribute`](OtelAttribute.md)[]

Defined in: [otel-export.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L44)

***

### status?

> `optional` **status?**: `object`

Defined in: [otel-export.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L45)

#### code

> **code**: `number`

#### message?

> `optional` **message?**: `string`
