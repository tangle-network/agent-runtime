[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RenderCorpusToInstructions

# Type Alias: RenderCorpusToInstructions

> **RenderCorpusToInstructions** = (`opts`) => `Promise`\<`AgentProfile`\>

Defined in: [runtime/personify/wave-types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L492)

`renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the
 durable corpus); returns a fresh `AgentProfile` with the accreted facts merged in.

## Parameters

### opts

[`RenderCorpusToInstructionsOptions`](../interfaces/RenderCorpusToInstructionsOptions.md)

## Returns

`Promise`\<`AgentProfile`\>
