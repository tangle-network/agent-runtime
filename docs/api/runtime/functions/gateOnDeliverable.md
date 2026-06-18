[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / gateOnDeliverable

# Function: gateOnDeliverable()

> **gateOnDeliverable**\<`Out`\>(`inner`, `deliverable`): [`Executor`](../interfaces/Executor.md)\<`Out`\>

Defined in: [runtime/supervise/completion-gate.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L44)

Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
executor has produced its output. The inner `score` is preserved; only `valid` is gated.

## Type Parameters

### Out

`Out`

## Parameters

### inner

[`Executor`](../interfaces/Executor.md)\<`Out`\>

### deliverable

[`DeliverableSpec`](../interfaces/DeliverableSpec.md)\<`Out`\>

## Returns

[`Executor`](../interfaces/Executor.md)\<`Out`\>
