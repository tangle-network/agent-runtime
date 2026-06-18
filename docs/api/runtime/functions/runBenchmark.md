[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / runBenchmark

# Function: runBenchmark()

> **runBenchmark**(`cfg`): `Promise`\<[`BenchmarkReport`](../interfaces/BenchmarkReport.md)\>

Defined in: [runtime/run-benchmark.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L132)

Run the requested strategies over the tasks, scored by the Environment's own check.
 Resilient: a task whose rollouts fail (transient infra) is excluded from the stats but
 reported in `perTask` with the error — never silently dropped.

## Parameters

### cfg

[`BenchmarkConfig`](../interfaces/BenchmarkConfig.md)

## Returns

`Promise`\<[`BenchmarkReport`](../interfaces/BenchmarkReport.md)\>
