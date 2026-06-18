[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BenchmarkConfig

# Interface: BenchmarkConfig

Defined in: [runtime/run-benchmark.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L32)

## Properties

### environment

> **environment**: [`AgenticSurface`](AgenticSurface.md)

Defined in: [runtime/run-benchmark.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L34)

The task domain (5 hooks).

***

### tasks

> **tasks**: [`AgenticTask`](AgenticTask.md)[]

Defined in: [runtime/run-benchmark.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L36)

The tasks to score across.

***

### worker

> **worker**: [`AgenticOptions`](AgenticOptions.md)

Defined in: [runtime/run-benchmark.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L38)

The worker: model + router + (optional) the critic's instruction (the steerer knob).

***

### strategies?

> `optional` **strategies?**: [`Strategy`](Strategy.md)[]

Defined in: [runtime/run-benchmark.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L41)

Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
 Default: [sample, refine].

***

### budget?

> `optional` **budget?**: `number`

Defined in: [runtime/run-benchmark.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L43)

Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3.

***

### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/run-benchmark.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L45)

Tasks scored in parallel. Default 3.

***

### onTask?

> `optional` **onTask?**: (`row`, `done`, `total`) => `void`

Defined in: [runtime/run-benchmark.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L48)

Progress hook — fires as each task settles (the live-monitoring seam: append to a
 progress file, render a tree, stream to a dashboard). `done` counts settled tasks.

#### Parameters

##### row

[`BenchmarkTaskRow`](BenchmarkTaskRow.md)

##### done

`number`

##### total

`number`

#### Returns

`void`

***

### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [runtime/run-benchmark.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L51)

Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
 here live (the watchdog/route-auditor seam, passed through to `runAgentic`).
