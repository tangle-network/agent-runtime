[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / CreateNestedWorkflowAgentDelegateOptions

# Interface: CreateNestedWorkflowAgentDelegateOptions

Defined in: [workflow/nested-workflow-delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L47)

## Properties

### agent

> **agent**: [`WorkflowAgentDelegate`](../type-aliases/WorkflowAgentDelegate.md)

Defined in: [workflow/nested-workflow-delegate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L52)

Real worker delegate used for normal agent() calls and for child workflow
agent() calls that do not opt into allowWorkflow.

***

### caps

> **caps**: [`NestedWorkflowCapsResolver`](../type-aliases/NestedWorkflowCapsResolver.md)

Defined in: [workflow/nested-workflow-delegate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L53)

***

### loop?

> `optional` **loop?**: [`WorkflowLoopDelegate`](../type-aliases/WorkflowLoopDelegate.md)

Defined in: [workflow/nested-workflow-delegate.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L54)

***

### verifier?

> `optional` **verifier?**: [`WorkflowVerifierDelegate`](../type-aliases/WorkflowVerifierDelegate.md)

Defined in: [workflow/nested-workflow-delegate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L55)

***

### analyst?

> `optional` **analyst?**: [`WorkflowAnalystDelegate`](../type-aliases/WorkflowAnalystDelegate.md)

Defined in: [workflow/nested-workflow-delegate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L56)

***

### reviewer?

> `optional` **reviewer?**: [`WorkflowReviewerDelegate`](../type-aliases/WorkflowReviewerDelegate.md)

Defined in: [workflow/nested-workflow-delegate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L57)

***

### metadata?

> `optional` **metadata?**: [`NestedWorkflowMetadataResolver`](../type-aliases/NestedWorkflowMetadataResolver.md)

Defined in: [workflow/nested-workflow-delegate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L58)

***

### traceEmitter?

> `optional` **traceEmitter?**: [`WorkflowTraceEmitter`](WorkflowTraceEmitter.md)

Defined in: [workflow/nested-workflow-delegate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L59)

***

### includeEventsInTrace?

> `optional` **includeEventsInTrace?**: `boolean`

Defined in: [workflow/nested-workflow-delegate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L60)

***

### runId?

> `optional` **runId?**: (`input`) => `string`

Defined in: [workflow/nested-workflow-delegate.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L61)

#### Parameters

##### input

[`NestedWorkflowDelegateInput`](NestedWorkflowDelegateInput.md)

#### Returns

`string`

***

### toOutput?

> `optional` **toOutput?**: (`result`, `input`) => `unknown`

Defined in: [workflow/nested-workflow-delegate.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L62)

#### Parameters

##### result

[`WorkflowResult`](WorkflowResult.md)

##### input

[`NestedWorkflowDelegateInput`](NestedWorkflowDelegateInput.md)

#### Returns

`unknown`

***

### toTrace?

> `optional` **toTrace?**: (`result`, `input`) => `unknown`

Defined in: [workflow/nested-workflow-delegate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/nested-workflow-delegate.ts#L63)

#### Parameters

##### result

[`WorkflowResult`](WorkflowResult.md)

##### input

[`NestedWorkflowDelegateInput`](NestedWorkflowDelegateInput.md)

#### Returns

`unknown`
