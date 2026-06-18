[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationRunContext

# Interface: DelegationRunContext

Defined in: [mcp/task-queue.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L131)

**`Experimental`**

Context handed to a `SubmitInput.run` function.

## Properties

### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L132)

**`Experimental`**

***

### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L135)

**`Experimental`**

The `detachedSessionRef` recorded at submit, when one was supplied.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](../../runtime/interfaces/LoopTraceEmitter.md)

Defined in: [mcp/task-queue.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L153)

**`Experimental`**

Per-delegation loop-trace sink, always provided by the queue. Events
emitted here are journaled onto the record as a compact span tree
(`record.trace`) when each loop run ends and at the delegation's
terminal transition. Delegates forward it into their `runLoop` ctx,
composed with any process-wide OTEL emitter
(`composeLoopTraceEmitters`). Optional in the type so consumer-built
contexts stay source-compatible.

## Methods

### report()

> **report**(`progress`): `void`

Defined in: [mcp/task-queue.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L133)

**`Experimental`**

#### Parameters

##### progress

[`DelegationProgress`](DelegationProgress.md)

#### Returns

`void`

***

### updateDetachedSessionRef()

> **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/task-queue.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L143)

**`Experimental`**

Replace the record's detached-run resume key — the detached dispatch path
calls this once the sandbox id is known so the persisted ref names a
resolvable box. Ignored after the record settles (a cancel racing the
rebind is legitimate; the ref no longer matters then). Throws on an empty
ref — erasing the resume key would silently make the record unresumable.

#### Parameters

##### ref

`string`

#### Returns

`void`
