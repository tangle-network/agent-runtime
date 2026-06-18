[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / createPushTraceSource

# Function: createPushTraceSource()

> **createPushTraceSource**(`opts?`): `object`

Defined in: [runtime/supervise/trace-source.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L163)

A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls
 `record(step)` for each tool call; it becomes a span, fan-out to live subscribers + buffered for
 `collect`.

## Parameters

### opts?

#### runId?

`string`

#### now?

() => `number`

## Returns

`object`

### source

> **source**: [`TraceSource`](../interfaces/TraceSource.md)

### record

> **record**: (`input`) => `ToolSpan`

#### Parameters

##### input

[`ToolStepInput`](../interfaces/ToolStepInput.md)

#### Returns

`ToolSpan`
