[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / replaySpawnTree

# Function: replaySpawnTree()

> **replaySpawnTree**(`journal`, `blobs`, `root`): `Promise`\<[`Settled`](../type-aliases/Settled.md)\<`unknown`\>[]\>

Defined in: [durable/spawn-journal.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L301)

Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled
child's `out` from the blob store by `outRef`, and return the `Settled[]` exactly
as `scope.next()` originally delivered them.

Determinism (B2): the events are sorted by `seq` BEFORE any blob `get`, so the
replay order is the recorded cursor order regardless of how fast each rehydration
resolves. `at` (wall-clock) is never a replay input. Fail loud on a tree that was
never begun, a settled-done event missing its `outRef`, or a blob the store can't
rehydrate — a silent gap would let `act` branch on the wrong evidence.

## Parameters

### journal

[`SpawnJournal`](../interfaces/SpawnJournal.md)

### blobs

[`ResultBlobStore`](../interfaces/ResultBlobStore.md)

### root

`string`

## Returns

`Promise`\<[`Settled`](../type-aliases/Settled.md)\<`unknown`\>[]\>
