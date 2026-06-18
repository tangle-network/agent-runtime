[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / runToolLoop

# Function: runToolLoop()

> **runToolLoop**(`opts`): `Promise`\<[`ToolLoopResult`](../interfaces/ToolLoopResult.md)\>

Defined in: [tool-loop.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L156)

Run the bounded tool loop and return the final text + every executed tool
 outcome. Awaitable — callers needing to stream events to a UI use
 [streamToolLoop](streamToolLoop.md).

## Parameters

### opts

[`RunToolLoopOptions`](../interfaces/RunToolLoopOptions.md)

## Returns

`Promise`\<[`ToolLoopResult`](../interfaces/ToolLoopResult.md)\>
