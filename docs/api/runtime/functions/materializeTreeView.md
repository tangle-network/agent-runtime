[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / materializeTreeView

# Function: materializeTreeView()

> **materializeTreeView**(`events`): [`TreeView`](../interfaces/TreeView.md)

Defined in: [durable/spawn-journal.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L383)

Materialize the live tree (`TreeView`) from a journaled event list for resume. Folds
`spawned`/`settled`/`cancelled` into a per-node snapshot in `seq` order, then adds each
`metered` event's driver-inference spend onto its node in a separate additive pass — so the
resumed view matches what `scope.view` showed at the recorded cursor position.

## Parameters

### events

[`SpawnEvent`](../type-aliases/SpawnEvent.md)[]

## Returns

[`TreeView`](../interfaces/TreeView.md)
