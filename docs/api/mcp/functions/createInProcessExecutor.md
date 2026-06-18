[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / createInProcessExecutor

# Function: createInProcessExecutor()

> **createInProcessExecutor**(`options`): [`DelegationExecutor`](../interfaces/DelegationExecutor.md)

Defined in: [mcp/in-process-executor.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L87)

**`Experimental`**

Build an in-process executor. Returns a [DelegationExecutor](../interfaces/DelegationExecutor.md) whose `client.create()`
returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
(`backend.profile`) threads its systemPrompt + model into the harness via the core.

## Parameters

### options

[`InProcessExecutorOptions`](../interfaces/InProcessExecutorOptions.md)

## Returns

[`DelegationExecutor`](../interfaces/DelegationExecutor.md)
