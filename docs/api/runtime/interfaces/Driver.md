[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Driver

# Interface: Driver\<Task, Output, Decision\>

Defined in: [runtime/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L138)

**`Experimental`**

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

## Properties

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [runtime/types.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L142)

**`Experimental`**

Stable identifier surfaced in trace events. Default `'driver'`.

## Methods

### plan()

> **plan**(`task`, `history`): `Promise`\<`Task`[]\>

Defined in: [runtime/types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L147)

**`Experimental`**

Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
`[]` → no more work this round (kernel proceeds to `decide`).

#### Parameters

##### task

`Task`

##### history

readonly [`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

#### Returns

`Promise`\<`Task`[]\>

***

### decide()

> **decide**(`history`): `Decision` \| `Promise`\<`Decision`\>

Defined in: [runtime/types.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L154)

**`Experimental`**

Inspect history and return the next state. The kernel terminates the
loop when `decide` returns a value listed in `isTerminalDecision`
(`'stop' | 'pick-winner' | 'fail' | 'done'`), when `maxIterations`
is hit, or when the abort signal fires.

#### Parameters

##### history

readonly [`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

#### Returns

`Decision` \| `Promise`\<`Decision`\>

***

### describePlan()?

> `optional` **describePlan**(): [`LoopPlanDescription`](LoopPlanDescription.md) \| `undefined`

Defined in: [runtime/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L164)

**`Experimental`**

Optional: describe the move `plan()` just produced, for trace emission.
The kernel calls this immediately after `plan()` and emits the result in
the `loop.plan` event so a topology viewer can render the agent's chosen
move + rationale (not just the inferred fan-width). Drivers whose topology
is a pure function of count (refine/fanout-vote) omit it — the kernel
infers `moveKind` from the planned-task count. A driver that authors its
own topology returns its chosen move's kind + rationale here.

#### Returns

[`LoopPlanDescription`](LoopPlanDescription.md) \| `undefined`

***

### selectWinner()?

> `optional` **selectWinner**(`history`): [`LoopWinner`](LoopWinner.md)\<`Task`, `Output`\> \| `undefined`

Defined in: [runtime/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L174)

**`Experimental`**

Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
kernel consults this at finalize ONLY when the caller did not pass an explicit
`selectWinner` to runLoop. Return the driver-declared winner (e.g. from a
`select` topology move) or `undefined` to fall through to the default
(best-valid-score, earliest index). This is the SELECTOR role made
agent-authorable — the planner runs the selection, not the kernel.

#### Parameters

##### history

readonly [`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

#### Returns

[`LoopWinner`](LoopWinner.md)\<`Task`, `Output`\> \| `undefined`
