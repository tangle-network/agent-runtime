[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TrajectoryReport

# Interface: TrajectoryReport

Defined in: [runtime/personify/wave-types.ts:528](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L528)

The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read.

## Properties

### root

> `readonly` **root**: `string`

Defined in: [runtime/personify/wave-types.ts:529](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L529)

***

### nodes

> `readonly` **nodes**: readonly [`TrajectoryNode`](TrajectoryNode.md)[]

Defined in: [runtime/personify/wave-types.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L531)

Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges).

***

### total

> `readonly` **total**: [`Spend`](Spend.md)

Defined in: [runtime/personify/wave-types.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L533)

The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms).

***

### statusCounts

> `readonly` **statusCounts**: `Readonly`\<`Record`\<[`TrajectoryNode`](TrajectoryNode.md)\[`"status"`\], `number`\>\>

Defined in: [runtime/personify/wave-types.ts:535](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L535)

Count of nodes by terminal status — a quick "how did the tree end" readout.
