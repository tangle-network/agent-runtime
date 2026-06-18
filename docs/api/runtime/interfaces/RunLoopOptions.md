[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / RunLoopOptions

# Interface: RunLoopOptions\<Task, Output, Decision\>

Defined in: [runtime/run-loop.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L69)

**`Experimental`**

## Type Parameters

### Task

`Task`

### Output

`Output`

### Decision

`Decision`

## Properties

### driver

> **driver**: [`Driver`](Driver.md)\<`Task`, `Output`, `Decision`\>

Defined in: [runtime/run-loop.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L70)

**`Experimental`**

***

### agentRun?

> `optional` **agentRun?**: [`AgentRunSpec`](AgentRunSpec.md)\<`Task`\>

Defined in: [runtime/run-loop.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L75)

**`Experimental`**

Single agent spec — every iteration uses this profile. Mutually
exclusive with `agentRuns`.

***

### agentRuns?

> `optional` **agentRuns?**: [`AgentRunSpec`](AgentRunSpec.md)\<`Task`\>[]

Defined in: [runtime/run-loop.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L81)

**`Experimental`**

Multiple specs for heterogeneous fanout. The kernel round-robins
through them when the driver plans N tasks. Mutually exclusive with
`agentRun`.

***

### output

> **output**: [`OutputAdapter`](OutputAdapter.md)\<`Output`\>

Defined in: [runtime/run-loop.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L82)

**`Experimental`**

***

### validator?

> `optional` **validator?**: [`Validator`](Validator.md)\<`Output`, `DefaultVerdict`\>

Defined in: [runtime/run-loop.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L83)

**`Experimental`**

***

### task

> **task**: `Task`

Defined in: [runtime/run-loop.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L84)

**`Experimental`**

***

### ctx

> **ctx**: [`ExecCtx`](ExecCtx.md)

Defined in: [runtime/run-loop.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L85)

**`Experimental`**

***

### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: [runtime/run-loop.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L87)

**`Experimental`**

Default 10. Hard cap on total iterations across all `plan()` rounds.

***

### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [runtime/run-loop.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L89)

**`Experimental`**

Default 4. In-flight worker cap within a single `plan()` batch.

***

### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/run-loop.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L94)

**`Experimental`**

Pre-allocated id for trace correlation. Default = `loop-${random}`.
Surfaces as `runId` on every emitted `LoopTraceEvent`.

***

### now?

> `optional` **now?**: () => `number`

Defined in: [runtime/run-loop.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L99)

**`Experimental`**

Clock override; default `Date.now`. Deterministic tests pass a
monotonic counter to stabilize iteration timing fields.

#### Returns

`number`

***

### selectWinner?

> `optional` **selectWinner?**: (`iterations`) => [`LoopWinner`](LoopWinner.md)\<`Task`, `Output`\> \| `undefined`

Defined in: [runtime/run-loop.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L104)

**`Experimental`**

Override the default winner selector (highest-valid-score, ties broken
by earliest iteration).

#### Parameters

##### iterations

[`Iteration`](Iteration.md)\<`Task`, `Output`\>[]

#### Returns

[`LoopWinner`](LoopWinner.md)\<`Task`, `Output`\> \| `undefined`

***

### onWorkerBox?

> `optional` **onWorkerBox?**: (`box`) => `void`

Defined in: [runtime/run-loop.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L119)

**`Experimental`**

Same-sandbox driver mode — a kernel→caller out-channel, not a value handed
in. When set, the kernel keeps each finished worker box alive across the
`plan()` boundary and hands it here, so a same-sandbox planner
(one that reuses the worker's box) can stream its move INTO the
worker's live box — steering from the worker's real filesystem and state,
not just a history summary. The kernel owns teardown: every box kept alive
this way is destroyed at loop end (and the callback is invoked with
`undefined` then as a teardown sentinel). Without it, worker boxes are torn
down per-iteration (default) and a same-sandbox planner has nothing to
reuse. Intended for single-worker (refine) loops: under fanout every box is
still kept for teardown, but only the last-finishing box is handed here, so
a planner sees an arbitrary branch's filesystem — pair it with refine.

#### Parameters

##### box

`SandboxInstance` \| `undefined`

#### Returns

`void`

***

### lineage?

> `optional` **lineage?**: [`LoopLineageOptions`](LoopLineageOptions.md)

Defined in: [runtime/run-loop.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L131)

**`Experimental`**

Opt-in box-lineage controls. Default OFF — unset means every iteration
acquires a fresh box, streams once, and tears it down (today's behavior,
byte-identical). With `sessionContinuity` on, a refine round continues the
parent iteration's session on its live box; with `forkFanout` on (and a
fork-capable platform), a fanout round forks the parent's checkpoint so the
branches share a context prefix. The lineage owns every box it starts or
forks and tears them all down at loop end — so these paths are mutually
exclusive with `onWorkerBox`, which claims the same box-ownership channel.
