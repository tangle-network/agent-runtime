[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / composeLoopTraceEmitters

# Function: composeLoopTraceEmitters()

> **composeLoopTraceEmitters**(...`emitters`): [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md) \| `undefined`

Defined in: [mcp/delegation-trace.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L184)

**`Experimental`**

Fan one `LoopTraceEvent` stream into several emitters — e.g. the
process-wide OTEL exporter AND the per-delegation journal collector.
`undefined` entries are skipped; returns `undefined` when nothing is left
so callers keep the kernel's "no emitter, no events" fast path.

## Parameters

### emitters

...readonly ([`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md) \| `undefined`)[]

## Returns

[`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md) \| `undefined`
