[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / LoopPlanDescription

# Interface: LoopPlanDescription

Defined in: [runtime/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L180)

**`Experimental`**

Driver-supplied description of the just-planned move.

## Properties

### kind

> **kind**: `string`

Defined in: [runtime/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L182)

**`Experimental`**

Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`.

***

### rationale?

> `optional` **rationale?**: `string`

Defined in: [runtime/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L184)

**`Experimental`**

Why the driver chose this move (the agent's rationale), when available.

***

### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L191)

**`Experimental`**

Iteration index this round branches FROM, when the driver declares it.
Overrides the kernel's inferred branch point — lets a planner that
branches off a specific (non-winner) iteration emit faithful edge lineage.
Omit to keep the inferred (best-valid / latest) branch point.
