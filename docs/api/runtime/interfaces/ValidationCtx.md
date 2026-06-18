[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / ValidationCtx

# Interface: ValidationCtx

Defined in: [runtime/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L32)

**`Experimental`**

## Properties

### iteration

> **iteration**: `number`

Defined in: [runtime/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L34)

**`Experimental`**

Iteration index this output came from (0-based).

***

### box?

> `optional` **box?**: `SandboxInstance`

Defined in: [runtime/types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L40)

**`Experimental`**

Live sandbox for this iteration. Validators that need execution-grounded
evidence can inspect files or run commands here instead of forcing callers
to bypass the loop kernel with raw Sandbox SDK orchestration.

***

### signal

> **signal**: `AbortSignal`

Defined in: [runtime/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L42)

**`Experimental`**

Cooperative cancellation channel.

***

### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](LoopTraceEmitter.md)

Defined in: [runtime/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L48)

**`Experimental`**

Optional trace emitter. When set, validator implementations that make
LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.
