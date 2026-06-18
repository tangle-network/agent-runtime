[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopDispatchOptions

# Interface: LoopDispatchOptions\<Task, Output, Decision, TScenario, TArtifact\>

Defined in: [runtime/loop-dispatch.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L49)

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

## Properties

### sandboxClient

> **sandboxClient**: [`SandboxClient`](SandboxClient.md)

Defined in: [runtime/loop-dispatch.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L57)

Sandbox client used for every cell's `runLoop`. Supplied once.

***

### toLoopOptions

> **toLoopOptions**: (`scenario`, `profile`) => [`LoopOptionsForDispatch`](../type-aliases/LoopOptionsForDispatch.md)\<`Task`, `Output`, `Decision`\>

Defined in: [runtime/loop-dispatch.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L60)

Build the per-cell runLoop options from the scenario (+ profile, when
 used with `runProfileMatrix`).

#### Parameters

##### scenario

`TScenario`

##### profile

`AgentProfile`

#### Returns

[`LoopOptionsForDispatch`](../type-aliases/LoopOptionsForDispatch.md)\<`Task`, `Output`, `Decision`\>

***

### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Defined in: [runtime/loop-dispatch.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L68)

Map the finished loop to the artifact the judges score. Default:
 `result.winner?.output`. A loop with no winner yields `undefined` (judges
 skip the cell) — but the loop's token usage is STILL reported, so the
 integrity guard sees real activity.

#### Parameters

##### result

[`LoopResult`](LoopResult.md)\<`Task`, `Output`, `Decision`\>

#### Returns

`TArtifact`

***

### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Defined in: [runtime/loop-dispatch.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L71)

Forward `loop.*` trace events into the campaign's scoped trace so loop
 spans correlate with the cell. Default true.

***

### costSource?

> `optional` **costSource?**: `string`

Defined in: [runtime/loop-dispatch.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L73)

Cost-meter source label for the loop's spend. Default `'loop'`.
