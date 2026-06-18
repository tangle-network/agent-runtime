[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / CompletionAnalyst

# Interface: CompletionAnalyst\<Task, Output\>

Defined in: [runtime/completion.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L48)

Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so
 ONE analyst node can back both channels (findings for steer, a verdict for stop).

## Type Parameters

### Task

`Task`

### Output

`Output`

## Methods

### assess()

> **assess**(`input`): [`CompletionVerdict`](CompletionVerdict.md) \| `Promise`\<[`CompletionVerdict`](CompletionVerdict.md)\>

Defined in: [runtime/completion.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L49)

#### Parameters

##### input

###### task

`Task`

###### history

readonly [`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

#### Returns

[`CompletionVerdict`](CompletionVerdict.md) \| `Promise`\<[`CompletionVerdict`](CompletionVerdict.md)\>
