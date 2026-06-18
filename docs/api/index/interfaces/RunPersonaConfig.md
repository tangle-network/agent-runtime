[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RunPersonaConfig

# Interface: RunPersonaConfig\<TScenario, TArtifact\>

Defined in: [conversation/run-persona.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L195)

## Type Parameters

### TScenario

`TScenario` *extends* `Scenario`

### TArtifact

`TArtifact`

## Properties

### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](AgentExecutionBackend.md)

Defined in: [conversation/run-persona.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L197)

Turn an `AgentProfile` into a runnable backend (router / sandbox / fake).

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

Defined in: [conversation/run-persona.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L199)

Render a profile's system prompt.

#### Parameters

##### profile

`AgentProfile`

#### Returns

`string`

***

### personaOf

> **personaOf**: (`scenario`) => [`PersonaDriver`](../type-aliases/PersonaDriver.md)

Defined in: [conversation/run-persona.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L201)

The persona driving each scenario — a driver profile or scripted turns.

#### Parameters

##### scenario

`TScenario`

#### Returns

[`PersonaDriver`](../type-aliases/PersonaDriver.md)

***

### artifactOf

> **artifactOf**: (`transcript`, `scenario`) => `TArtifact`

Defined in: [conversation/run-persona.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L203)

Build the scored artifact from the finished transcript.

#### Parameters

##### transcript

[`ConversationTurn`](ConversationTurn.md)[]

##### scenario

`TScenario`

#### Returns

`TArtifact`

***

### maxTurns?

> `optional` **maxTurns?**: (`scenario`) => `number`

Defined in: [conversation/run-persona.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L205)

Speaker-turn cap (required when a persona is profile-driven).

#### Parameters

##### scenario

`TScenario`

#### Returns

`number`

***

### seed?

> `optional` **seed?**: (`scenario`) => `string`

Defined in: [conversation/run-persona.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L206)

#### Parameters

##### scenario

`TScenario`

#### Returns

`string`

***

### workerName?

> `optional` **workerName?**: `string`

Defined in: [conversation/run-persona.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L207)
