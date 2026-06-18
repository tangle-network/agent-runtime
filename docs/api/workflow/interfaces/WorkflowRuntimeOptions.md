[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / WorkflowRuntimeOptions

# Interface: WorkflowRuntimeOptions

Defined in: [workflow/types.ts:435](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L435)

## Properties

### source

> **source**: `string`

Defined in: [workflow/types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L436)

***

### agent

> **agent**: [`WorkflowAgentDelegate`](../type-aliases/WorkflowAgentDelegate.md)

Defined in: [workflow/types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L437)

***

### loop?

> `optional` **loop?**: [`WorkflowLoopDelegate`](../type-aliases/WorkflowLoopDelegate.md)

Defined in: [workflow/types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L438)

***

### verifier?

> `optional` **verifier?**: [`WorkflowVerifierDelegate`](../type-aliases/WorkflowVerifierDelegate.md)

Defined in: [workflow/types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L439)

***

### analyst?

> `optional` **analyst?**: [`WorkflowAnalystDelegate`](../type-aliases/WorkflowAnalystDelegate.md)

Defined in: [workflow/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L440)

***

### reviewer?

> `optional` **reviewer?**: [`WorkflowReviewerDelegate`](../type-aliases/WorkflowReviewerDelegate.md)

Defined in: [workflow/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L441)

***

### runId?

> `optional` **runId?**: `string`

Defined in: [workflow/types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L442)

***

### depth?

> `optional` **depth?**: `number`

Defined in: [workflow/types.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L443)

***

### caps?

> `optional` **caps?**: [`WorkflowBudgetCaps`](WorkflowBudgetCaps.md)

Defined in: [workflow/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L444)

***

### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [workflow/types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L445)

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [workflow/types.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L446)

***

### traceEmitter?

> `optional` **traceEmitter?**: [`WorkflowTraceEmitter`](WorkflowTraceEmitter.md)

Defined in: [workflow/types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L447)

***

### now?

> `optional` **now?**: () => `number`

Defined in: [workflow/types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L448)

#### Returns

`number`

***

### syncTimeoutMs?

> `optional` **syncTimeoutMs?**: `number`

Defined in: [workflow/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/types.ts#L449)
