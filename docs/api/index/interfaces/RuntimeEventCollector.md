[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / RuntimeEventCollector

# Interface: RuntimeEventCollector\<TState, TAction, TActionResult, TEval\>

Defined in: [sanitize.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L492)

## Stable

## Type Parameters

### TState

`TState` = `unknown`

### TAction

`TAction` = `unknown`

### TActionResult

`TActionResult` = `unknown`

### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

## Properties

### onEvent

> **onEvent**: (`event`) => `void`

Defined in: [sanitize.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L498)

#### Parameters

##### event

[`AgentRuntimeEvent`](../type-aliases/AgentRuntimeEvent.md)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`void`

***

### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L499)
