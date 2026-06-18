[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / runPersonaDispatch

# Function: runPersonaDispatch()

> **runPersonaDispatch**\<`TScenario`, `TArtifact`\>(`config`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: [conversation/run-persona.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L216)

Wrap [runPersonaConversation](runPersonaConversation.md) as a `ProfileDispatchFn` for
`runProfileMatrix`: the profile axis is the worker-under-test, the scenario
axis is the persona, and the runner is the cell. Meters the worker through
`ctx.cost` so the matrix's backend-integrity guard sees real usage.

## Type Parameters

### TScenario

`TScenario` *extends* `Scenario`

### TArtifact

`TArtifact`

## Parameters

### config

[`RunPersonaConfig`](../interfaces/RunPersonaConfig.md)\<`TScenario`, `TArtifact`\>

## Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>
