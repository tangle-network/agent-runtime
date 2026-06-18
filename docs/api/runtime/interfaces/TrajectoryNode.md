[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TrajectoryNode

# Interface: TrajectoryNode

Defined in: [runtime/personify/wave-types.ts:506](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L506)

One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
`Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [runtime/personify/wave-types.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L507)

***

### parent?

> `readonly` `optional` **parent?**: `string`

Defined in: [runtime/personify/wave-types.ts:508](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L508)

***

### children

> `readonly` **children**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L509)

***

### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L510)

***

### runtime

> `readonly` **runtime**: `string`

Defined in: [runtime/personify/wave-types.ts:511](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L511)

***

### status

> `readonly` **status**: `"failed"` \| `"cancelled"` \| `"pending"` \| `"done"`

Defined in: [runtime/personify/wave-types.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L513)

Terminal status the journal recorded for this node.

***

### ownSpend

> `readonly` **ownSpend**: [`Spend`](Spend.md)

Defined in: [runtime/personify/wave-types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L515)

This node's OWN conserved spend (from its `settled` event).

***

### rolledUpSpend

> `readonly` **rolledUpSpend**: [`Spend`](Spend.md)

Defined in: [runtime/personify/wave-types.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L518)

This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
 "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis).

***

### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/personify/wave-types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L520)

The node's verdict, when its settlement carried one (observability — NOT a steer input).

***

### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [runtime/personify/wave-types.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L522)

The rehydrated output artifact, when `withOutputs` was requested + the blob resolved.

***

### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [runtime/personify/wave-types.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L523)
