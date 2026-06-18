[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopPlanPayload

# Interface: LoopPlanPayload

Defined in: [runtime/types.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L372)

**`Experimental`**

Emitted once per `plan()` round, immediately after the driver plans. Carries
the topology move so a viewer renders WHAT the agent decided + WHY, not just
the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).

## Properties

### roundIndex

> **roundIndex**: `number`

Defined in: [runtime/types.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L374)

**`Experimental`**

0-based plan round (one per `plan()` call).

***

### plannedCount

> **plannedCount**: `number`

Defined in: [runtime/types.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L376)

**`Experimental`**

Tasks the driver issued this round.

***

### moveKind

> **moveKind**: `string`

Defined in: [runtime/types.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L378)

**`Experimental`**

Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc.

***

### rationale?

> `optional` **rationale?**: `string`

Defined in: [runtime/types.ts:380](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L380)

**`Experimental`**

Driver rationale for the move, when available.

***

### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L386)

**`Experimental`**

Iteration index this round branched FROM (the edge source). `undefined`
for round 0 (root). Kernel-inferred branch point — the best-valid (else
latest) iteration so far — unless a driver later declares it explicitly.

***

### childIndices

> **childIndices**: `number`[]

Defined in: [runtime/types.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L388)

**`Experimental`**

Iteration indices this round dispatched (the edge targets).
