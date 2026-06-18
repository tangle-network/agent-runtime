[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TrajectoryReportOptions

# Interface: TrajectoryReportOptions

Defined in: [runtime/personify/wave-types.ts:545](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L545)

`trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
impl lives in `trajectory.ts`.

## Properties

### withOutputs?

> `readonly` `optional` **withOutputs?**: `boolean`

Defined in: [runtime/personify/wave-types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L547)

Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report).
