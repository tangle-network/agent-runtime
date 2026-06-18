[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [workflow](../README.md) / CreateRunLoopWorkflowDelegateOptions

# Interface: CreateRunLoopWorkflowDelegateOptions\<Input, Task, Output, Decision\>

Defined in: [workflow/loop-delegate.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L9)

## Type Parameters

### Input

`Input`

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

## Properties

### toOutput?

> `optional` **toOutput?**: (`result`) => `unknown`

Defined in: [workflow/loop-delegate.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L15)

#### Parameters

##### result

[`LoopResult`](../../runtime/interfaces/LoopResult.md)\<`Task`, `Output`, `Decision`\>

#### Returns

`unknown`

***

### toTrace?

> `optional` **toTrace?**: (`result`) => `unknown`

Defined in: [workflow/loop-delegate.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L16)

#### Parameters

##### result

[`LoopResult`](../../runtime/interfaces/LoopResult.md)\<`Task`, `Output`, `Decision`\>

#### Returns

`unknown`

## Methods

### toRunLoopOptions()

> **toRunLoopOptions**(`input`, `options`, `ctx`): [`RunLoopOptions`](../../runtime/interfaces/RunLoopOptions.md)\<`Task`, `Output`, `Decision`\>

Defined in: [workflow/loop-delegate.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/workflow/loop-delegate.ts#L10)

#### Parameters

##### input

`Input`

##### options

[`WorkflowLoopOptions`](WorkflowLoopOptions.md)

##### ctx

[`WorkflowDelegateContext`](WorkflowDelegateContext.md)

#### Returns

[`RunLoopOptions`](../../runtime/interfaces/RunLoopOptions.md)\<`Task`, `Output`, `Decision`\>
