[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationResumeContext

# Interface: DelegationResumeContext

Defined in: [mcp/task-queue.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L177)

**`Experimental`**

## Properties

### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L179)

**`Experimental`**

Fired by `cancel(taskId)`; the driver should stop the remote run when it can.

## Methods

### report()

> **report**(`progress`): `void`

Defined in: [mcp/task-queue.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L180)

**`Experimental`**

#### Parameters

##### progress

[`DelegationProgress`](DelegationProgress.md)

#### Returns

`void`
