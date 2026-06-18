[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RunPersonaConversationOptions

# Interface: RunPersonaConversationOptions

Defined in: [conversation/run-persona.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L36)

## Properties

### worker

> **worker**: `AgentProfile`

Defined in: [conversation/run-persona.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L38)

The agent under test. Metered; its rendered prompt leads its turns.

***

### persona

> **persona**: [`PersonaDriver`](../type-aliases/PersonaDriver.md)

Defined in: [conversation/run-persona.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L40)

The simulated user driving the dialogue.

***

### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](AgentExecutionBackend.md)

Defined in: [conversation/run-persona.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L43)

Turn an `AgentProfile` into a runnable backend (router / sandbox / fake).
 Applied to the worker and to a `profile`-kind persona.

#### Parameters

##### profile

`AgentProfile`

##### role

`"worker"` \| `"persona"`

#### Returns

[`AgentExecutionBackend`](AgentExecutionBackend.md)

***

### systemPromptOf

> **systemPromptOf**: (`profile`) => `string`

Defined in: [conversation/run-persona.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L45)

Render a profile's system prompt — prepended to that profile's messages.

#### Parameters

##### profile

`AgentProfile`

#### Returns

`string`

***

### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [conversation/run-persona.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L48)

Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
 (worker answers each user turn). REQUIRED for a `profile` persona.

***

### seed?

> `optional` **seed?**: `string`

Defined in: [conversation/run-persona.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L50)

Kickoff message routed to the first speaker (the persona). Default 'Begin.'

***

### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/run-persona.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L51)

***

### workerName?

> `optional` **workerName?**: `string`

Defined in: [conversation/run-persona.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L53)

Worker participant / transcript speaker label. Default 'agent'.
