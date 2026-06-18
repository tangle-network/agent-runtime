[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationTraceCollector

# Interface: DelegationTraceCollector

Defined in: [mcp/delegation-trace.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L123)

**`Experimental`**

Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
(mirroring the OTEL emitter's buffering) and hands the derived compact
spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
that never ended — a hard-aborted loop still leaves its partial tree in the
journal, unlike the OTEL path which drops it.

## Properties

### emitter

> **emitter**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

Defined in: [mcp/delegation-trace.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L124)

**`Experimental`**

## Methods

### settle()

> **settle**(): `void`

Defined in: [mcp/delegation-trace.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L126)

**`Experimental`**

Flush buffered events of runs that never reached `loop.ended`.

#### Returns

`void`
