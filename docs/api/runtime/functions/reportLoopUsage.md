[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / reportLoopUsage

# Function: reportLoopUsage()

> **reportLoopUsage**\<`Task`, `Output`, `Decision`\>(`cost`, `result`, `source?`): `void`

Defined in: [runtime/report-usage.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L34)

Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost
meter so the backend-integrity guard sees real LLM activity. `source`
defaults to `'loop'`.

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

## Parameters

### cost

[`UsageSink`](../interfaces/UsageSink.md)

### result

`Pick`\<[`LoopResult`](../interfaces/LoopResult.md)\<`Task`, `Output`, `Decision`\>, `"costUsd"` \| `"tokenUsage"`\>

### source?

`string` = `'loop'`

## Returns

`void`
