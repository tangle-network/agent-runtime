[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / buildLoopOtelSpans

# Function: buildLoopOtelSpans()

> **buildLoopOtelSpans**(`events`, `traceId`, `rootParentSpanId?`): [`OtelSpan`](../interfaces/OtelSpan.md)[]

Defined in: [otel-export.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L232)

Build a nested, real-duration OTLP span tree for ONE loop run from its full
ordered `LoopTraceEvent` stream. Unlike `loopEventToOtelSpan` (one flat,
zero-duration span per event), this reconstructs the topology hierarchy a
GenAI trace viewer renders natively:

  loop (invoke_workflow)
    └─ loop.round[k] (invoke_workflow)   ← tangle.loop.move.{kind,width,rationale}
         ├─ loop.iteration[i] (invoke_agent)  ← gen_ai.agent.name + usage + verdict + placement
         └─ …

Attributes follow the current GenAI semconv (`gen_ai.*`) where they apply and
a namespaced `tangle.loop.*` / `tangle.cost.usd` extension for topology /
verdict / placement / cost (not yet standardized). Pure: feed it a buffered
per-runId event array (e.g. flushed on `loop.ended`) and export the result.

## Parameters

### events

readonly `object`[]

### traceId

`string`

### rootParentSpanId?

`string`

## Returns

[`OtelSpan`](../interfaces/OtelSpan.md)[]
