[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TrajectoryReportFn

# Type Alias: TrajectoryReportFn

> **TrajectoryReportFn** = (`journal`, `blobs`, `root`, `options?`) => `Promise`\<[`TrajectoryReport`](../interfaces/TrajectoryReport.md)\>

Defined in: [runtime/personify/wave-types.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L551)

`trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs).

## Parameters

### journal

[`SpawnJournal`](../interfaces/SpawnJournal.md)

### blobs

[`ResultBlobStore`](../interfaces/ResultBlobStore.md)

### root

[`NodeId`](NodeId.md)

### options?

[`TrajectoryReportOptions`](../interfaces/TrajectoryReportOptions.md)

## Returns

`Promise`\<[`TrajectoryReport`](../interfaces/TrajectoryReport.md)\>
