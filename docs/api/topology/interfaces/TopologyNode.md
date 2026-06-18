[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / TopologyNode

# Interface: TopologyNode

Defined in: [topology/tree.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L24)

One agent in the tree. A leaf never spawns; a driver's `childIds` is non-empty.

## Properties

### id

> `readonly` **id**: `string`

Defined in: [topology/tree.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L25)

***

### label

> **label**: `string`

Defined in: [topology/tree.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L27)

Display label (spawn `label`, or the driver name on the root).

***

### runtime?

> `optional` **runtime?**: `string`

Defined in: [topology/tree.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L29)

Leaf runtime (`router`/`sandbox`/`cli`) when known.

***

### parentId?

> `optional` **parentId?**: `string`

Defined in: [topology/tree.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L31)

Parent agent id; undefined ⇒ a root.

***

### depth

> **depth**: `number`

Defined in: [topology/tree.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L33)

Recursion depth (root = 0).

***

### status

> **status**: [`TopologyStatus`](../type-aliases/TopologyStatus.md)

Defined in: [topology/tree.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L34)

***

### steps

> **steps**: `number`

Defined in: [topology/tree.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L36)

Count of in-agent steps (turns + tool calls + plan/decision rounds) folded so far.

***

### score?

> `optional` **score?**: `number`

Defined in: [topology/tree.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L38)

Deployable score in [0,1] once settled `done`.

***

### reason?

> `optional` **reason?**: `string`

Defined in: [topology/tree.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L40)

Failure reason once settled `down`.

***

### childIds

> `readonly` **childIds**: `string`[]

Defined in: [topology/tree.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L42)

Children in spawn order.
