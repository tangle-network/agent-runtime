[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / PromotionGateOptions

# Interface: PromotionGateOptions

Defined in: [runtime/promotion-gate.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L13)

## Properties

### report

> **report**: [`BenchmarkReport`](BenchmarkReport.md)

Defined in: [runtime/promotion-gate.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L15)

The HOLDOUT report — must carry per-task cells for both strategy names.

***

### incumbent

> **incumbent**: `string`

Defined in: [runtime/promotion-gate.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L17)

The incumbent champion's strategy name.

***

### candidate

> **candidate**: `string`

Defined in: [runtime/promotion-gate.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L19)

The challenger's strategy name.

***

### mode?

> `optional` **mode?**: `"superiority"` \| `"non-inferiority"`

Defined in: [runtime/promotion-gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L24)

'superiority' (default): the candidate must score significantly BETTER.
 'non-inferiority': the candidate must prove its score is not worse than the
 incumbent by more than `scoreTolerance` AND its cost savings are significant —
 the gate for "same quality, cheaper" claims.

***

### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [runtime/promotion-gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L26)

non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05.

***

### deltaThreshold?

> `optional` **deltaThreshold?**: `number`

Defined in: [runtime/promotion-gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L28)

The CI lower bound on the paired lift must EXCEED this (score scale). Default 0.

***

### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [runtime/promotion-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L31)

Minimum paired tasks before significance can be claimed. Default 6 — below that
 the bootstrap CI is too wide to separate a real lift from the per-task noise.

***

### statistic?

> `optional` **statistic?**: `"mean"` \| `"median"`

Defined in: [runtime/promotion-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L33)

Bootstrap statistic over the paired deltas. Default 'mean'.

***

### seed?

> `optional` **seed?**: `number`

Defined in: [runtime/promotion-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L35)

Fixed by the substrate by default — the same report always yields the same verdict.

***

### resamples?

> `optional` **resamples?**: `number`

Defined in: [runtime/promotion-gate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L36)
