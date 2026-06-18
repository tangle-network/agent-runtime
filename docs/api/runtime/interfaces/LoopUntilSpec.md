[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopUntilSpec

# Interface: LoopUntilSpec\<Task, State, D\>

Defined in: [runtime/personify/wave-types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L170)

`loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step`
child per round, ask `until` whether the accumulated state satisfies the goal, and stop when it
does OR when the pool can no longer admit a step (budget IS the loop bound — no unbounded
while). The deployable, non-oracle stop: `until` is the satisfiability gate, read from trace
findings + accumulated deliverables, never a fresh raw verdict the loop minted to stop itself.

No domain: "refine until tests pass" is `loopUntil` with a coder persona + a `step` that edits
and an `until` that reads the test-finding; the combinator owns only the round/stop wiring.

## Type Parameters

### Task

`Task`

### State

`State`

### D

`D`

## Methods

### step()

> **step**(`rootTask`, `state`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L172)

Build the next step child's task from the root task + the state accumulated so far.

#### Parameters

##### rootTask

`Task`

##### state

[`LoopUntilState`](LoopUntilState.md)\<`State`\>

##### ctx

[`ShapeContext`](ShapeContext.md)\<`D`\>

#### Returns

`unknown`

***

### fold()

> **fold**(`prior`, `settled`): [`LoopUntilState`](LoopUntilState.md)\<`State`\>

Defined in: [runtime/personify/wave-types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L174)

Fold one settled step into the accumulated state (the loop's running deliverable candidate).

#### Parameters

##### prior

[`LoopUntilState`](LoopUntilState.md)\<`State`\>

##### settled

[`Settled`](../type-aliases/Settled.md)\<[`Outcome`](../type-aliases/Outcome.md)\<`D`\>\>

#### Returns

[`LoopUntilState`](LoopUntilState.md)\<`State`\>

***

### until()

> **until**(`state`, `findings`): [`Outcome`](../type-aliases/Outcome.md)\<`D`\> \| `null`

Defined in: [runtime/personify/wave-types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L180)

The satisfiability gate: given the accumulated state + the round's trace findings, has the
goal been reached? Returns the terminal deliverable when satisfied, or `null` to keep going.
Reads `findings` (trace-derived), NOT a raw verdict score — the deployable-stop discipline.

#### Parameters

##### state

[`LoopUntilState`](LoopUntilState.md)\<`State`\>

##### findings

readonly `AnalystFinding`[]

#### Returns

[`Outcome`](../type-aliases/Outcome.md)\<`D`\> \| `null`

***

### label()?

> `optional` **label**(`round`): `string`

Defined in: [runtime/personify/wave-types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L182)

Per-round step label (defaults to `step:<round>` in the impl).

#### Parameters

##### round

`number`

#### Returns

`string`
