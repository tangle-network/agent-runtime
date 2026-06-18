[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / loopDispatch

# Function: loopDispatch()

> **loopDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: [runtime/loop-dispatch.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L114)

Adapter for `runProfileMatrix` (profile is an axis). Returns a
`ProfileDispatchFn` that runs `runLoop` per (profile, scenario) cell and
reports usage automatically.

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

### TScenario

`TScenario` *extends* `Scenario`

### TArtifact

`TArtifact`

## Parameters

### opts

[`LoopDispatchOptions`](../interfaces/LoopDispatchOptions.md)\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>

## Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>
