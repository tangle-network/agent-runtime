[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / streamToolLoop

# Function: streamToolLoop()

> **streamToolLoop**\<`Raw`\>(`opts`): `AsyncGenerator`\<[`StreamToolLoopYield`](../type-aliases/StreamToolLoopYield.md)\<`Raw`\>, `void`, `unknown`\>

Defined in: [tool-loop.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L336)

Streaming bounded tool loop: yields each raw turn event (the caller maps +
 telemetries + re-emits it) and each executed `tool_result`; emits one
 `capped` if it stops for any non-completed reason with calls still pending.

## Type Parameters

### Raw

`Raw`

## Parameters

### opts

[`StreamToolLoopOptions`](../interfaces/StreamToolLoopOptions.md)\<`Raw`\>

## Returns

`AsyncGenerator`\<[`StreamToolLoopYield`](../type-aliases/StreamToolLoopYield.md)\<`Raw`\>, `void`, `unknown`\>
