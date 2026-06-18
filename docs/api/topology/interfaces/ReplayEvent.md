[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / ReplayEvent

# Interface: ReplayEvent

Defined in: [topology/replay.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L18)

One normalized animation frame — a node appearing, settling, or stepping, at a wall-clock ms.

## Properties

### t

> **t**: `number`

Defined in: [topology/replay.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L19)

***

### kind

> **kind**: `"root"` \| `"spawn"` \| `"settle"` \| `"step"`

Defined in: [topology/replay.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L20)

***

### id

> **id**: `string`

Defined in: [topology/replay.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L21)

***

### parentId?

> `optional` **parentId?**: `string`

Defined in: [topology/replay.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L22)

***

### label?

> `optional` **label?**: `string`

Defined in: [topology/replay.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L23)

***

### runtime?

> `optional` **runtime?**: `string`

Defined in: [topology/replay.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L24)

***

### depth?

> `optional` **depth?**: `number`

Defined in: [topology/replay.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L25)

***

### status?

> `optional` **status?**: `"running"` \| `"done"` \| `"down"`

Defined in: [topology/replay.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L26)

***

### valid?

> `optional` **valid?**: `boolean`

Defined in: [topology/replay.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L28)

The completion-oracle signal: delivered ⟺ a deployable check passed (not self-report).

***

### score?

> `optional` **score?**: `number`

Defined in: [topology/replay.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L29)

***

### reason?

> `optional` **reason?**: `string`

Defined in: [topology/replay.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L30)

***

### tokens?

> `optional` **tokens?**: `number`

Defined in: [topology/replay.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L31)

***

### usd?

> `optional` **usd?**: `number`

Defined in: [topology/replay.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/replay.ts#L32)
