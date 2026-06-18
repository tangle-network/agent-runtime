[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / RecordTraceMeta

# Interface: RecordTraceMeta

Defined in: [intelligence/index.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L190)

Metadata for [IntelligenceClient.recordTrace](IntelligenceClient.md#recordtrace).

## Properties

### traceId?

> `optional` **traceId?**: `string`

Defined in: [intelligence/index.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L192)

32-hex trace id to anchor every span to. Defaults to a fresh id.

***

### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Defined in: [intelligence/index.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L195)

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.
