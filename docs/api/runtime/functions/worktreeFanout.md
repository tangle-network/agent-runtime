[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / worktreeFanout

# Function: worktreeFanout()

> **worktreeFanout**\<`Task`\>(`options`): [`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `WorktreeHarnessResult`\>

Defined in: [runtime/supervise/worktree-fanout.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L78)

**`Experimental`**

Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
— equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
the shared valid-only `selectValidWinner` (never a judge).

## Type Parameters

### Task

`Task`

## Parameters

### options

[`WorktreeFanoutOptions`](../interfaces/WorktreeFanoutOptions.md)

## Returns

[`CombinatorShape`](../type-aliases/CombinatorShape.md)\<`Task`, `WorktreeHarnessResult`\>
