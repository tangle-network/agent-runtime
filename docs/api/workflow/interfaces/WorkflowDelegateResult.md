[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowDelegateResult

# Interface: WorkflowDelegateResult

Defined in: [workflow/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L100)

## Properties

### output

> **output**: `unknown`

Defined in: [workflow/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L101)

***

### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [workflow/types.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L102)

***

### tokenUsage?

> `optional` **tokenUsage?**: `Partial`\<[`WorkflowTokenUsage`](WorkflowTokenUsage.md)\>

Defined in: [workflow/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L103)

***

### agentCalls?

> `optional` **agentCalls?**: `number`

Defined in: [workflow/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L105)

Additional downstream workflow agent calls consumed inside this delegate.

***

### loopCalls?

> `optional` **loopCalls?**: `number`

Defined in: [workflow/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L107)

Additional downstream workflow loop calls consumed inside this delegate.

***

### trace?

> `optional` **trace?**: `unknown`

Defined in: [workflow/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L108)
