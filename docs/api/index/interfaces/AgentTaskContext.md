[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / AgentTaskContext

# Interface: AgentTaskContext\<TState, TAction, TActionResult, TEval\>

Defined in: [types.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L57)

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

Defined in: [types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L63)

***

### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L64)

***

### state

> **state**: `TState`

Defined in: [types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L65)

***

### evals

> **evals**: `TEval`[]

Defined in: [types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L66)

***

### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

Defined in: [types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L67)

***

### budget

> **budget**: `ControlBudget`

Defined in: [types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L68)

***

### stepIndex

> **stepIndex**: `number`

Defined in: [types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L69)

***

### wallMs

> **wallMs**: `number`

Defined in: [types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L70)

***

### spentCostUsd

> **spentCostUsd**: `number`

Defined in: [types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L71)

***

### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

Defined in: [types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L72)

***

### abortSignal

> **abortSignal**: `AbortSignal`

Defined in: [types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L73)
