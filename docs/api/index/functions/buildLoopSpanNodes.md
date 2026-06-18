[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / buildLoopSpanNodes

# Function: buildLoopSpanNodes()

> **buildLoopSpanNodes**(`events`): [`LoopSpanNode`](../interfaces/LoopSpanNode.md)[]

Defined in: [otel-export.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L263)

Sink-neutral core behind [buildLoopOtelSpans](buildLoopOtelSpans.md): reconstruct the
loop → round → branch span tree from one run's ordered `LoopTraceEvent`
stream. Consumed by the OTEL mapper above and by the MCP delegation
journal's compact trace tee — one topology reconstruction, two sinks.
Tolerates partial streams (a run that never reached `loop.ended` closes
at the last observed event's timestamp).

## Parameters

### events

readonly `object`[]

## Returns

[`LoopSpanNode`](../interfaces/LoopSpanNode.md)[]
