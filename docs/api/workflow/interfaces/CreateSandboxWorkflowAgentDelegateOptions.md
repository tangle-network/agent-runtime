[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / CreateSandboxWorkflowAgentDelegateOptions

# Interface: CreateSandboxWorkflowAgentDelegateOptions\<TOutput\>

Defined in: [workflow/agent-delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L47)

## Type Parameters

### TOutput

`TOutput` = `unknown`

## Properties

### client

> **client**: [`SandboxClient`](../../runtime/interfaces/SandboxClient.md)

Defined in: [workflow/agent-delegate.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L48)

***

### profile

> **profile**: [`WorkflowSandboxAgentProfileResolver`](../type-aliases/WorkflowSandboxAgentProfileResolver.md)

Defined in: [workflow/agent-delegate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L49)

***

### output?

> `optional` **output?**: [`OutputAdapter`](../../runtime/interfaces/OutputAdapter.md)\<`TOutput`\>

Defined in: [workflow/agent-delegate.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L50)

***

### stream?

> `optional` **stream?**: [`WorkflowSandboxAgentStream`](../type-aliases/WorkflowSandboxAgentStream.md)

Defined in: [workflow/agent-delegate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L51)

***

### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [workflow/agent-delegate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L52)

#### Type Declaration

##### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

***

### promptOptions?

> `optional` **promptOptions?**: [`WorkflowSandboxPromptOptionsResolver`](../type-aliases/WorkflowSandboxPromptOptionsResolver.md)\<`PromptOptions`\>

Defined in: [workflow/agent-delegate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L55)

***

### taskOptions?

> `optional` **taskOptions?**: [`WorkflowSandboxPromptOptionsResolver`](../type-aliases/WorkflowSandboxPromptOptionsResolver.md)\<`TaskOptions`\>

Defined in: [workflow/agent-delegate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L56)

***

### deleteAfter?

> `optional` **deleteAfter?**: `boolean`

Defined in: [workflow/agent-delegate.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L57)

***

### includeEventsInTrace?

> `optional` **includeEventsInTrace?**: `boolean`

Defined in: [workflow/agent-delegate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L58)

***

### toTrace?

> `optional` **toTrace?**: (`trace`) => `unknown`

Defined in: [workflow/agent-delegate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/agent-delegate.ts#L59)

#### Parameters

##### trace

[`WorkflowSandboxAgentTrace`](WorkflowSandboxAgentTrace.md)\<`TOutput`\>

#### Returns

`unknown`
