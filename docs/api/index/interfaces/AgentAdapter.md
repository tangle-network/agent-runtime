[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentAdapter

# Interface: AgentAdapter\<TState, TAction, TActionResult, TEval\>

Defined in: [types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L77)

## Stable

## Type Parameters

### TState

`TState`

### TAction

`TAction`

### TActionResult

`TActionResult`

### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

## Methods

### observe()

> **observe**(`ctx`): `TState` \| `Promise`\<`TState`\>

Defined in: [types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L83)

#### Parameters

##### ctx

###### task

[`AgentTaskSpec`](AgentTaskSpec.md)

###### knowledge

`KnowledgeReadinessReport`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

#### Returns

`TState` \| `Promise`\<`TState`\>

***

### validate()

> **validate**(`ctx`): `TEval`[] \| `Promise`\<`TEval`[]\>

Defined in: [types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L90)

#### Parameters

##### ctx

###### task

[`AgentTaskSpec`](AgentTaskSpec.md)

###### knowledge

`KnowledgeReadinessReport`

###### state

`TState`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

#### Returns

`TEval`[] \| `Promise`\<`TEval`[]\>

***

### decide()

> **decide**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [types.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L98)

#### Parameters

##### ctx

[`AgentTaskContext`](AgentTaskContext.md)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

***

### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

Defined in: [types.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L102)

#### Parameters

##### action

`TAction`

##### ctx

[`AgentTaskContext`](AgentTaskContext.md)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

***

### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

Defined in: [types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L107)

#### Parameters

##### ctx

[`AgentTaskContext`](AgentTaskContext.md)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

***

### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L121)

#### Parameters

##### ctx

###### task

[`AgentTaskSpec`](AgentTaskSpec.md)

###### knowledge

`KnowledgeReadinessReport`

###### questions

`UserQuestion`[]

###### acquisitionPlans

`DataAcquisitionPlan`[]

#### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

***

### getActionCostUsd()?

> `optional` **getActionCostUsd**(`ctx`): `number` \| `undefined`

Defined in: [types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L128)

#### Parameters

##### ctx

###### action

`TAction`

###### result

`TActionResult`

###### task

[`AgentTaskSpec`](AgentTaskSpec.md)

###### state

`TState`

###### evals

`TEval`[]

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

#### Returns

`number` \| `undefined`

***

### projectRunRecords()?

> `optional` **projectRunRecords**(`result`, `task`): `RunRecord`[]

Defined in: [types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L137)

#### Parameters

##### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### task

[`AgentTaskSpec`](AgentTaskSpec.md)

#### Returns

`RunRecord`[]
