[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / analyzeTrace

# Function: analyzeTrace()

> **analyzeTrace**(`source`, `runId?`): `Promise`\<[`TrajectoryAnalysis`](../interfaces/TrajectoryAnalysis.md)\>

Defined in: [runtime/supervise/trajectory-recorder.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L27)

Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`.

## Parameters

### source

[`TraceSource`](../interfaces/TraceSource.md)

### runId?

`string` = `'worker'`

## Returns

`Promise`\<[`TrajectoryAnalysis`](../interfaces/TrajectoryAnalysis.md)\>
