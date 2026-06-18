[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopResult

# Interface: LoopResult\<Task, Output, Decision\>

Defined in: [runtime/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L204)

**`Experimental`**

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

## Properties

### decision

> **decision**: `Decision`

Defined in: [runtime/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L205)

**`Experimental`**

***

### iterations

> **iterations**: [`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

Defined in: [runtime/types.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L206)

**`Experimental`**

***

### winner?

> `optional` **winner?**: [`LoopWinner`](LoopWinner.md)\<`Task`, `Output`\>

Defined in: [runtime/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L207)

**`Experimental`**

***

### durationMs

> **durationMs**: `number`

Defined in: [runtime/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L208)

**`Experimental`**

***

### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L210)

**`Experimental`**

Sum of every iteration's `costUsd`.

***

### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](LoopTokenUsage.md)

Defined in: [runtime/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L214)

**`Experimental`**

Sum of every iteration's token usage. Forward to
 `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch so the
 integrity guard sees real LLM activity.
