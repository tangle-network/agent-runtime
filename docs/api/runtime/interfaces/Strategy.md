[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Strategy

# Interface: Strategy

Defined in: [runtime/strategy.ts:652](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L652)

A Strategy is HOW you spend the compute budget to beat the Environment's check — it
builds the driver `Agent` the Supervisor runs. This is the OPEN extension point: a dev
authors their own by implementing `driver()` to return an Agent whose `act()` spawns
shots/analysts via `scope.spawn` / `scope.next` / `scope.send`. The two built-ins are
the reference implementations to copy:
  sample — K INDEPENDENT attempts, keep the best-verifying (best-of-N / resample).
  refine — attempt → observe() reads the trace → steer the next → repeat (iterate).
(A multi-agent "team" is just a Strategy whose driver spawns several different agents.)

## Properties

### name

> `readonly` **name**: `string`

Defined in: [runtime/strategy.ts:653](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L653)

## Methods

### driver()

> **driver**(`surface`, `task`, `opts`, `budget`): [`Agent`](Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:654](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L654)

#### Parameters

##### surface

[`AgenticSurface`](AgenticSurface.md)

##### task

[`AgenticTask`](AgenticTask.md)

##### opts

[`AgenticOptions`](AgenticOptions.md)

##### budget

`number`

#### Returns

[`Agent`](Agent.md)\<`unknown`, [`Outcome`](../type-aliases/Outcome.md)\<`unknown`\>\>
