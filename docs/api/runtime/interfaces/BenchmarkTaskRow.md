[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BenchmarkTaskRow

# Interface: BenchmarkTaskRow

Defined in: [runtime/run-benchmark.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L73)

## Properties

### taskId

> **taskId**: `string`

Defined in: [runtime/run-benchmark.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L74)

***

### cells?

> `optional` **cells?**: `Record`\<`string`, [`BenchmarkCell`](BenchmarkCell.md)\>

Defined in: [runtime/run-benchmark.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L76)

Per-strategy cells; absent when the task errored before completing all strategies.

***

### errors?

> `optional` **errors?**: `Record`\<`string`, `string`\>

Defined in: [runtime/run-benchmark.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L80)

Per-strategy failures on this task: the strategy competed, threw, and scored an
 honest zero — it loses, it does not poison the row. The message is kept so a later
 generation's author can see WHY a candidate died.

***

### error?

> `optional` **error?**: `string`

Defined in: [runtime/run-benchmark.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L82)

Why the task was excluded (infra/setup failure) — never silently dropped.
