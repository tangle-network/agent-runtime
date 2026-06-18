[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / NodeSnapshot

# Interface: NodeSnapshot

Defined in: [runtime/supervise/types.ts:337](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L337)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [runtime/supervise/types.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L338)

***

### parent?

> `readonly` `optional` **parent?**: `string`

Defined in: [runtime/supervise/types.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L339)

***

### label

> `readonly` **label**: `string`

Defined in: [runtime/supervise/types.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L340)

***

### status

> `readonly` **status**: [`NodeStatus`](../type-aliases/NodeStatus.md)

Defined in: [runtime/supervise/types.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L341)

***

### runtime

> `readonly` **runtime**: [`Runtime`](../type-aliases/Runtime.md)

Defined in: [runtime/supervise/types.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L342)

***

### budget

> `readonly` **budget**: [`Budget`](Budget.md)

Defined in: [runtime/supervise/types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L343)

***

### spent

> `readonly` **spent**: [`Spend`](Spend.md)

Defined in: [runtime/supervise/types.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L345)

Conserved spend so far for this node.

***

### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [runtime/supervise/types.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L347)

`outRef` once the node is `done` (the replay/result pointer).
