[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / BenchmarkReport

# Interface: BenchmarkReport

Defined in: [runtime/run-benchmark.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L95)

## Properties

### n

> **n**: `number`

Defined in: [runtime/run-benchmark.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L96)

***

### excluded

> **excluded**: `number`

Defined in: [runtime/run-benchmark.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L97)

***

### perStrategy

> **perStrategy**: `Record`\<`string`, [`BenchmarkStrategySummary`](BenchmarkStrategySummary.md)\>

Defined in: [runtime/run-benchmark.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L99)

Per-strategy means (keyed by strategy.name).

***

### perTask

> **perTask**: [`BenchmarkTaskRow`](BenchmarkTaskRow.md)[]

Defined in: [runtime/run-benchmark.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L102)

The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
 strategy-author, an operator) consumes. Includes errored tasks with the reason.

***

### pareto

> **pareto**: `string`[]

Defined in: [runtime/run-benchmark.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L105)

The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
 a strategy that ties on score at half the cost WINS and a scalar would hide it.

***

### refineVsSample?

> `optional` **refineVsSample?**: [`BenchmarkLift`](BenchmarkLift.md)

Defined in: [runtime/run-benchmark.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L107)

The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample.
