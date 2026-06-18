[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopOptionsForDispatch

# Type Alias: LoopOptionsForDispatch\<Task, Output, Decision\>

> **LoopOptionsForDispatch**\<`Task`, `Output`, `Decision`\> = `Omit`\<[`RunLoopOptions`](../interfaces/RunLoopOptions.md)\<`Task`, `Output`, `Decision`\>, `"ctx"`\>

Defined in: [runtime/loop-dispatch.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L44)

runLoop options minus the `ctx` (loopDispatch builds the ctx).

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`
