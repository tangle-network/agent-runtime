[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / settledToIteration

# Function: settledToIteration()

> **settledToIteration**\<`Out`\>(`settled`): [`Iteration`](../interfaces/Iteration.md)\<`unknown`, `Out`\>

Defined in: [runtime/supervise/scope.ts:648](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L648)

The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
`Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
across settled children with the SAME argmax the loop kernel uses, not a forked copy.

`index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
`tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
`outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
Fail loud on a `down` settlement: only a `done` child is an iteration.

## Type Parameters

### Out

`Out`

## Parameters

### settled

[`Settled`](../type-aliases/Settled.md)\<`Out`\>

## Returns

[`Iteration`](../interfaces/Iteration.md)\<`unknown`, `Out`\>
