[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / defaultSelectWinner

# Function: defaultSelectWinner()

> **defaultSelectWinner**\<`Task`, `Output`\>(`iterations`): [`LoopWinner`](../interfaces/LoopWinner.md)\<`Task`, `Output`\> \| `undefined`

Defined in: [runtime/run-loop.ts:983](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L983)

The kernel's winner argmax — best-valid-score, ties broken by earliest index,
falling back to the best-scoring non-errored output when none is valid. Exported
so the `runProgram` tree executor selects across merged sub-loop iterations with
the SAME semantics the kernel uses at a single loop's finalize (one selector, not
a forked copy).

## Type Parameters

### Task

`Task`

### Output

`Output`

## Parameters

### iterations

[`Iteration`](../interfaces/Iteration.md)\<`Task`, `Output`\>[]

## Returns

[`LoopWinner`](../interfaces/LoopWinner.md)\<`Task`, `Output`\> \| `undefined`
