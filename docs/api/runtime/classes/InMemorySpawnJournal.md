[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / InMemorySpawnJournal

# Class: InMemorySpawnJournal

Defined in: [durable/spawn-journal.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L139)

In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces
the corruption guards a durable replay rests on:
 - an event before `beginTree` is a corrupted tree (fail loud),
 - a duplicate `seq` within a tree is a corrupted cursor (fail loud) — two
   settlements cannot share the cursor position replay orders by.

## Implements

- [`SpawnJournal`](../interfaces/SpawnJournal.md)

## Constructors

### Constructor

> **new InMemorySpawnJournal**(): `InMemorySpawnJournal`

#### Returns

`InMemorySpawnJournal`

## Methods

### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](../type-aliases/SpawnEvent.md)[] \| `undefined`\>

Defined in: [durable/spawn-journal.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L142)

#### Parameters

##### root

`string`

#### Returns

`Promise`\<[`SpawnEvent`](../type-aliases/SpawnEvent.md)[] \| `undefined`\>

#### Implementation of

[`SpawnJournal`](../interfaces/SpawnJournal.md).[`loadTree`](../interfaces/SpawnJournal.md#loadtree)

***

### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L148)

#### Parameters

##### root

`string`

##### at

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`SpawnJournal`](../interfaces/SpawnJournal.md).[`beginTree`](../interfaces/SpawnJournal.md#begintree)

***

### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L161)

#### Parameters

##### root

`string`

##### ev

[`SpawnEvent`](../type-aliases/SpawnEvent.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`SpawnJournal`](../interfaces/SpawnJournal.md).[`appendEvent`](../interfaces/SpawnJournal.md#appendevent)
