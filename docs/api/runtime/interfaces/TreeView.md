[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / TreeView

# Interface: TreeView

Defined in: [runtime/supervise/types.ts:351](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L351)

The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer.

## Properties

### root

> `readonly` **root**: `string`

Defined in: [runtime/supervise/types.ts:352](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L352)

***

### nodes

> `readonly` **nodes**: readonly [`NodeSnapshot`](NodeSnapshot.md)[]

Defined in: [runtime/supervise/types.ts:353](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L353)

***

### inFlight

> `readonly` **inFlight**: `number`

Defined in: [runtime/supervise/types.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L355)

Count of nodes in `running` or `acquiring` — the "what's in flow?" answer.
