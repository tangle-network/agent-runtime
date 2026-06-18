[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SandboxSeam

# Interface: SandboxSeam

Defined in: [runtime/supervise/runtime.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L79)

Sandbox executor seam. The `sandboxClient` the composed `runLoop` creates
boxes through, plus the optional trace/run/lineage wiring forwarded into the
loop. `lineage` is opaque here (PR #150's `RunLoopOptions.lineage`): forwarded
forward-compatibly, never inspected — this executor does NOT reinvent
checkpoint/fork.

## Properties

### sandboxClient

> **sandboxClient**: [`SandboxClient`](SandboxClient.md)

Defined in: [runtime/supervise/runtime.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L80)

***

### loopCtx?

> `optional` **loopCtx?**: `Partial`\<`Omit`\<[`ExecCtx`](ExecCtx.md), `"signal"` \| `"sandboxClient"`\>\>

Defined in: [runtime/supervise/runtime.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L82)

Forwarded into the composed `runLoop`'s `ctx` (trace emitter, run handle, etc.).

***

### lineage?

> `optional` **lineage?**: `unknown`

Defined in: [runtime/supervise/runtime.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L84)

PR #150 `RunLoopOptions.lineage` passthrough — opaque; forwarded, not parsed.

***

### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: [runtime/supervise/runtime.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L87)

Hard cap on the composed loop's iterations. The budget pool reserves against
 the spawn `Budget.maxIterations`; this is the leaf's own ceiling. Default 1.
