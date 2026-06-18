[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopTokenUsage

# Interface: LoopTokenUsage

Defined in: [runtime/types.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L113)

LLM token usage. Structurally matches agent-eval's `RunTokenUsage` /
 `CampaignTokenUsage` ({ input, output }) so a loop result maps straight
 onto `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch — without
 which the backend-integrity guard reads the run as a stub.

## Properties

### input

> **input**: `number`

Defined in: [runtime/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L114)

***

### output

> **output**: `number`

Defined in: [runtime/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L115)
