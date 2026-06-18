[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / DelegationResumeDriver

# Interface: DelegationResumeDriver

Defined in: [mcp/task-queue.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L193)

**`Experimental`**

Re-attaches restored in-flight records to their detached runs. The queue
calls `tick` repeatedly — it never awaits a whole run — so the driver can
be a thin wrapper over a one-pass primitive: resolve the run named by
`detachedSessionRef`, advance/poll it once, report where it stands. A
thrown error settles the record as failed; `failed` ticks are treated as
terminal and are not retried.

## Properties

### intervalMs?

> `optional` **intervalMs?**: `number`

Defined in: [mcp/task-queue.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L199)

**`Experimental`**

Delay between `running` ticks, in milliseconds. Default 5000.

## Methods

### tick()

> **tick**(`task`, `ctx`): `Promise`\<[`DelegationResumeTick`](../type-aliases/DelegationResumeTick.md)\>

Defined in: [mcp/task-queue.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L194)

**`Experimental`**

#### Parameters

##### task

###### record

[`DelegationRecord`](DelegationRecord.md)

###### detachedSessionRef

`string`

##### ctx

[`DelegationResumeContext`](DelegationResumeContext.md)

#### Returns

`Promise`\<[`DelegationResumeTick`](../type-aliases/DelegationResumeTick.md)\>
