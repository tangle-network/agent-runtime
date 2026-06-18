[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ExecCtx

# Interface: ExecCtx

Defined in: [runtime/types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L471)

**`Experimental`**

## Properties

### sandboxClient

> **sandboxClient**: [`SandboxClient`](SandboxClient.md)

Defined in: [runtime/types.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L473)

**`Experimental`**

Sandbox SDK client — the kernel calls `.create()` per iteration.

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/types.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L475)

**`Experimental`**

Optional runtime hooks. Execution-scoped; never part of `AgentProfile`.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](LoopTraceEmitter.md)

Defined in: [runtime/types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L477)

**`Experimental`**

Optional trace emitter. When set, the kernel emits `loop.*` events.

***

### runHandle?

> `optional` **runHandle?**: [`RuntimeRunHandle`](../../index/interfaces/RuntimeRunHandle.md)

Defined in: [runtime/types.ts:483](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L483)

**`Experimental`**

Optional production-run handle. When set, every synthesized `llm_call`
the kernel infers from a sandbox event stream is forwarded via
`runHandle.observe` so per-run cost aggregates pick up loop spend.

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/types.ts:485](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L485)

**`Experimental`**

Cooperative cancellation signal.

***

### traceId?

> `optional` **traceId?**: `string`

Defined in: [runtime/types.ts:491](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L491)

**`Experimental`**

Trace id for OTEL correlation. When set alongside `traceEmitter`, the
exporter uses this as the parent trace for all emitted spans. Typically
inherited from TRACE_ID env var in MCP subprocess mode.

***

### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [runtime/types.ts:496](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L496)

**`Experimental`**

Parent span id for OTEL correlation. Loop events become children of
this span. Typically inherited from PARENT_SPAN_ID env var.
