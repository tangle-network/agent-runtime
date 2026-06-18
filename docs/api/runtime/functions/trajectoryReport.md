[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / trajectoryReport

# Function: trajectoryReport()

> **trajectoryReport**(`journal`, `blobs`, `root`, `options?`): `Promise`\<[`TrajectoryReport`](../interfaces/TrajectoryReport.md)\>

Defined in: [runtime/personify/trajectory.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L52)

Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
journal for structure + spend and, when `withOutputs`, the blob store for each `done`
node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).

## Parameters

### journal

[`SpawnJournal`](../interfaces/SpawnJournal.md)

### blobs

[`ResultBlobStore`](../interfaces/ResultBlobStore.md)

### root

`string`

### options?

[`TrajectoryReportOptions`](../interfaces/TrajectoryReportOptions.md) = `{}`

## Returns

`Promise`\<[`TrajectoryReport`](../interfaces/TrajectoryReport.md)\>
