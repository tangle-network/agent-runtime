[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / AnytimeTaskCurve

# Interface: AnytimeTaskCurve

Defined in: [runtime/anytime.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L25)

## Properties

### taskId

> **taskId**: `string`

Defined in: [runtime/anytime.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L26)

***

### strategy

> **strategy**: `string`

Defined in: [runtime/anytime.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L27)

***

### points

> **points**: `object`[]

Defined in: [runtime/anytime.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L30)

Best-so-far after each settled shot: elapsed ms from the task's first spawn,
 cumulative usd, and the running max score.

#### elapsedMs

> **elapsedMs**: `number`

#### cumUsd

> **cumUsd**: `number`

#### best

> **best**: `number`

***

### hits

> **hits**: `Record`\<`string`, \{ `ms`: `number`; `shots`: `number`; `usd`: `number`; \} \| `null`\>

Defined in: [runtime/anytime.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L33)

Per satisficing target (keyed by the target value as a string): the first point
 where best ≥ target, or null when never reached within budget.
