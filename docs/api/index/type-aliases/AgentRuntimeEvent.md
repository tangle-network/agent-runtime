[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentRuntimeEvent

# Type Alias: AgentRuntimeEvent\<TState, TAction, TActionResult, TEval\>

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](../interfaces/AgentTaskSpec.md); `status`: [`AgentTaskStatus`](AgentTaskStatus.md); `reason`: `string`; \}

Defined in: [types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L147)

## Type Parameters

### TState

`TState` = `unknown`

### TAction

`TAction` = `unknown`

### TActionResult

`TActionResult` = `unknown`

### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

## Stable
