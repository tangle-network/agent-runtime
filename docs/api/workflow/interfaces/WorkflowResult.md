[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowResult

# Interface: WorkflowResult\<TOutput\>

Defined in: [workflow/types.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L452)

## Type Parameters

### TOutput

`TOutput` = `unknown`

## Properties

### runId

> **runId**: `string`

Defined in: [workflow/types.ts:453](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L453)

***

### meta

> **meta**: [`WorkflowMeta`](WorkflowMeta.md)

Defined in: [workflow/types.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L454)

***

### output

> **output**: `TOutput`

Defined in: [workflow/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L455)

***

### events

> **events**: [`WorkflowTraceEvent`](../type-aliases/WorkflowTraceEvent.md)[]

Defined in: [workflow/types.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L456)

***

### durationMs

> **durationMs**: `number`

Defined in: [workflow/types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L457)

***

### costUsd

> **costUsd**: `number`

Defined in: [workflow/types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L458)

***

### tokenUsage

> **tokenUsage**: [`WorkflowTokenUsage`](WorkflowTokenUsage.md)

Defined in: [workflow/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L459)

***

### agentCalls

> **agentCalls**: `number`

Defined in: [workflow/types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L460)

***

### loopCalls

> **loopCalls**: `number`

Defined in: [workflow/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L461)
