[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [topology](../README.md) / RenderOptions

# Interface: RenderOptions

Defined in: [topology/tree.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L45)

## Properties

### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [topology/tree.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L47)

Cap the rendered depth (deeper nodes collapse to a `… N more` line). Default: no cap.

***

### compact?

> `readonly` `optional` **compact?**: `boolean`

Defined in: [topology/tree.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/topology/tree.ts#L49)

Drop the per-node detail suffix (steps/children/score) — labels only. Default: false.
