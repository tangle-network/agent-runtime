[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [intelligence](../README.md) / IntelligenceClient

# Interface: IntelligenceClient

Defined in: [intelligence/index.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L215)

The Observe-mode Intelligence client.

## Properties

### project

> `readonly` **project**: `string`

Defined in: [intelligence/index.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L217)

The resolved project id.

***

### effort

> `readonly` **effort**: [`EffortSettings`](EffortSettings.md)

Defined in: [intelligence/index.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L219)

The resolved effort settings.

## Methods

### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Defined in: [intelligence/index.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L225)

Run `fn` under a trace, export one span best-effort, and return whatever
`fn` returns. Telemetry-export failures are swallowed; an error THROWN by
`fn` propagates to the caller (the agent's own failures are not masked).

#### Type Parameters

##### T

`T`

#### Parameters

##### meta

[`TraceMeta`](TraceMeta.md)

##### fn

(`trace`) => `Promise`\<`T`\>

#### Returns

`Promise`\<`T`\>

***

### recordTrace()

> **recordTrace**(`events`, `meta?`): `string`

Defined in: [intelligence/index.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L235)

Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
`runLoop`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
(NO second span builder), so the topology a viewer renders matches the
kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
loop root under an enclosing span (e.g. a `traceRun` span) when given.
Best-effort: export failures are swallowed. Returns the resolved `traceId`.

#### Parameters

##### events

readonly [`LoopTraceEvent`](../../runtime/type-aliases/LoopTraceEvent.md)[]

##### meta?

[`RecordTraceMeta`](RecordTraceMeta.md)

#### Returns

`string`

***

### doctor()

> **doctor**(): [`DoctorReport`](DoctorReport.md)

Defined in: [intelligence/index.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L241)

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

#### Returns

[`DoctorReport`](DoctorReport.md)

***

### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [intelligence/index.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/intelligence/index.ts#L243)

Flush any pending export spans. Best-effort; resolves even if export fails.

#### Returns

`Promise`\<`void`\>
