[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createSiblingSandboxExecutor

# Function: createSiblingSandboxExecutor()

> **createSiblingSandboxExecutor**(`options`): [`DelegationExecutor`](../interfaces/DelegationExecutor.md)

Defined in: [mcp/executor.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L54)

**`Experimental`**

Wrap a raw sandbox SDK client so the kernel emits
`loop.iteration.dispatch` events with `{ placement: 'sibling', sandboxId }`.

The returned client `.create()` delegates to the underlying client; the
only added behavior is a `describePlacement` tag the kernel reads.

## Parameters

### options

[`SiblingSandboxExecutorOptions`](../interfaces/SiblingSandboxExecutorOptions.md)

## Returns

[`DelegationExecutor`](../interfaces/DelegationExecutor.md)
