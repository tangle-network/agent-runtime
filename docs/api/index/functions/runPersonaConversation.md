[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / runPersonaConversation

# Function: runPersonaConversation()

> **runPersonaConversation**(`opts`): `Promise`\<[`PersonaConversationResult`](../interfaces/PersonaConversationResult.md)\>

Defined in: [conversation/run-persona.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L130)

Run one worker profile against one persona as a multi-round conversation.
The persona leads (participant 0): it speaks, the worker answers, repeat,
until `maxTurns`. Returns the persistent transcript + worker-only usage.

## Parameters

### opts

[`RunPersonaConversationOptions`](../interfaces/RunPersonaConversationOptions.md)

## Returns

`Promise`\<[`PersonaConversationResult`](../interfaces/PersonaConversationResult.md)\>
