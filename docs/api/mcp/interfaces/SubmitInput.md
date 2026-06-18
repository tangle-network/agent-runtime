[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [mcp](../README.md) / SubmitInput

# Interface: SubmitInput\<Args\>

Defined in: [mcp/task-queue.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L109)

**`Experimental`**

## Type Parameters

### Args

`Args` *extends* `AnyDelegateArgs`

## Properties

### profile

> **profile**: [`DelegationProfile`](../type-aliases/DelegationProfile.md)

Defined in: [mcp/task-queue.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L110)

**`Experimental`**

***

### args

> **args**: `Args`

Defined in: [mcp/task-queue.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L111)

**`Experimental`**

***

### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L112)

**`Experimental`**

***

### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L113)

**`Experimental`**

***

### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L120)

**`Experimental`**

Records the detached-run resume key on the new record. The submitted
`run` function still executes in-process exactly as without it — the
ref only matters after a restart, when `DelegationTaskQueue.restore`
hands it to the `resumeDelegate` seam instead of failing the record.

***

### run

> **run**: (`ctx`) => `Promise`\<`CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md)\>

Defined in: [mcp/task-queue.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L127)

**`Experimental`**

Runs the underlying delegation. The queue passes a fresh `AbortSignal`
and a `report` channel for incremental progress updates. The function
MUST resolve with the typed `DelegationResultPayload['output']`; the
queue wraps it with the profile tag.

#### Parameters

##### ctx

[`DelegationRunContext`](DelegationRunContext.md)

#### Returns

`Promise`\<`CoderOutput` \| [`ResearchOutputShape`](ResearchOutputShape.md) \| [`UiAuditorDelegationOutput`](UiAuditorDelegationOutput.md)\>
