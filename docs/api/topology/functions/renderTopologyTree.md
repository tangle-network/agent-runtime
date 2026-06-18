[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / renderTopologyTree

# Function: renderTopologyTree()

> **renderTopologyTree**(`tree`, `opts?`): `string`

Defined in: [topology/tree.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L161)

Render a forest of `TopologyNode`s to an aligned ASCII tree. Pure — given the same roots +
 node lookup it returns the same string. Exposed so a caller can render a tree it folded
 itself (e.g. from a journal replay) without the live view.

## Parameters

### tree

#### roots

[`TopologyNode`](../interfaces/TopologyNode.md)[]

#### node

(`id`) => [`TopologyNode`](../interfaces/TopologyNode.md) \| `undefined`

### opts?

[`RenderOptions`](../interfaces/RenderOptions.md) = `{}`

## Returns

`string`
