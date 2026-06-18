[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / TopologyView

# Interface: TopologyView

Defined in: [topology/tree.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L52)

## Properties

### hooks

> `readonly` **hooks**: [`RuntimeHooks`](../../index/interfaces/RuntimeHooks.md)

Defined in: [topology/tree.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L54)

The `RuntimeHooks` sink — attach to `SupervisorOpts.hooks` / `runLoop` options.

## Methods

### ingest()

> **ingest**(`event`): `void`

Defined in: [topology/tree.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L56)

Fold one event into the tree (the same call `hooks.onEvent` makes — exposed for replay).

#### Parameters

##### event

[`RuntimeHookEvent`](../../index/interfaces/RuntimeHookEvent.md)

#### Returns

`void`

***

### nodes()

> **nodes**(): [`TopologyNode`](TopologyNode.md)[]

Defined in: [topology/tree.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L58)

Every node, insertion order.

#### Returns

[`TopologyNode`](TopologyNode.md)[]

***

### roots()

> **roots**(): [`TopologyNode`](TopologyNode.md)[]

Defined in: [topology/tree.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L60)

Nodes with no in-tree parent (the run roots).

#### Returns

[`TopologyNode`](TopologyNode.md)[]

***

### node()

> **node**(`id`): [`TopologyNode`](TopologyNode.md) \| `undefined`

Defined in: [topology/tree.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L62)

One node by id.

#### Parameters

##### id

`string`

#### Returns

[`TopologyNode`](TopologyNode.md) \| `undefined`

***

### render()

> **render**(`opts?`): `string`

Defined in: [topology/tree.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L64)

Render the tree as an aligned ASCII forest.

#### Parameters

##### opts?

[`RenderOptions`](RenderOptions.md)

#### Returns

`string`
