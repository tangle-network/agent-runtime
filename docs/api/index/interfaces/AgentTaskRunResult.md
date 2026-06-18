[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentTaskRunResult

# Interface: AgentTaskRunResult\<TState, TAction, TActionResult, TEval\>

Defined in: [types.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L540)

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

## Properties

### task

> **task**: [`AgentTaskSpec`](AgentTaskSpec.md)

Defined in: [types.ts:546](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L546)

***

### status

> **status**: [`AgentTaskStatus`](../type-aliases/AgentTaskStatus.md)

Defined in: [types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L547)

***

### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:548](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L548)

***

### questions

> **questions**: `UserQuestion`[]

Defined in: [types.ts:549](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L549)

***

### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

Defined in: [types.ts:550](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L550)

***

### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

Defined in: [types.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L551)

***

### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

Defined in: [types.ts:552](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L552)

***

### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

Defined in: [types.ts:553](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L553)

***

### runRecords

> **runRecords**: `RunRecord`[]

Defined in: [types.ts:554](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L554)
