[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopIterationStartedPayload

# Interface: LoopIterationStartedPayload

Defined in: [runtime/types.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L392)

**`Experimental`**

## Properties

### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L393)

**`Experimental`**

***

### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L394)

**`Experimental`**

***

### taskHash

> **taskHash**: `string`

Defined in: [runtime/types.ts:395](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L395)

**`Experimental`**

***

### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L397)

**`Experimental`**

Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to.

***

### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L399)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.
