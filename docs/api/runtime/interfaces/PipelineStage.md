[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PipelineStage

# Interface: PipelineStage\<Task, StepIn, StepOut\>

Defined in: [runtime/personify/wave-types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L76)

`pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next
stage's task (via `feed`). The first `blocked` stage short-circuits the whole pipeline (its
blockers ARE the pipeline's blockers — never coerced past a failed stage). The terminal
stage's `done` deliverable is the pipeline's deliverable. Spawns one child per stage in order;
a stage that the conserved pool cannot admit is a concrete blocker.

No domain: "code build test" is `pipeline([plan, implement, integrate])` under a coder persona,
not a named shape. A stage names only its label + how to derive its task from the prior output.

## Type Parameters

### Task

`Task`

### StepIn

`StepIn`

### StepOut

`StepOut`

## Properties

### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L78)

Trace/journal label for this stage's spawned child.

## Methods

### feed()

> **feed**(`prior`, `ctx`, `rootTask`): `unknown`

Defined in: [runtime/personify/wave-types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L81)

Derive this stage's task from the prior stage's deliverable (or the root task for stage 0).
 Pure projection — the framework never interprets the result; the resolved leaf does.

#### Parameters

##### prior

`StepIn`

##### ctx

[`ShapeContext`](ShapeContext.md)\<`unknown`\>

##### rootTask

`Task`

#### Returns

`unknown`

***

### collect()

> **collect**(`settled`): [`Outcome`](../type-aliases/Outcome.md)\<`StepOut`\>

Defined in: [runtime/personify/wave-types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L84)

Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
 Fail loud (return a `blocked`) when the child produced nothing usable for the next stage.

#### Parameters

##### settled

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`StepOut`\>\>

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`StepOut`\>
