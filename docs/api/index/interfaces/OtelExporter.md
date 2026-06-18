[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / OtelExporter

# Interface: OtelExporter

Defined in: [otel-export.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L27)

## Methods

### exportSpan()

> **exportSpan**(`span`): `void`

Defined in: [otel-export.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L29)

Export a span.

#### Parameters

##### span

[`OtelSpan`](OtelSpan.md)

#### Returns

`void`

***

### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L31)

Force flush pending spans.

#### Returns

`Promise`\<`void`\>

***

### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L33)

Shutdown cleanly.

#### Returns

`Promise`\<`void`\>
