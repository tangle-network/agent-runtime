[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / sentinelCompletion

# Function: sentinelCompletion()

> **sentinelCompletion**\<`Task`\>(`sentinel`, `opts?`): [`CompletionAnalyst`](../interfaces/CompletionAnalyst.md)\<`Task`, `string`\>

Defined in: [runtime/completion.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L86)

Completion for a sandbox-agent node: done iff the latest output carries the node's stop
sentinel. PROBABILISTIC (the agent's own self-judgment) — the driver validates it.

## Type Parameters

### Task

`Task`

## Parameters

### sentinel

`string`

### opts?

#### confidence?

`number`

## Returns

[`CompletionAnalyst`](../interfaces/CompletionAnalyst.md)\<`Task`, `string`\>
