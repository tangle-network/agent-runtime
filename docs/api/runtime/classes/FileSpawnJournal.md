[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / FileSpawnJournal

# Class: FileSpawnJournal

Defined in: [durable/spawn-journal.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L178)

JSONL on disk. One line per record: the first record is `begin`, subsequent records
are `event` envelopes wrapping a `SpawnEvent`. `loadTree` replays the whole file,
filtering by `root`, and applies the same begin-precedes-events + unique-seq
corruption guards as the in-memory impl. Each append fsyncs so a crash between
writes never loses an acknowledged event.

## Implements

- [`SpawnJournal`](../interfaces/SpawnJournal.md)

## Constructors

### Constructor

> **new FileSpawnJournal**(`path`): `FileSpawnJournal`

Defined in: [durable/spawn-journal.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L179)

#### Parameters

##### path

`string`

#### Returns

`FileSpawnJournal`

## Methods

### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](../type-aliases/SpawnEvent.md)[] \| `undefined`\>

Defined in: [durable/spawn-journal.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L181)

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

Defined in: [durable/spawn-journal.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L211)

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

Defined in: [durable/spawn-journal.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L224)

#### Parameters

##### root

`string`

##### ev

[`SpawnEvent`](../type-aliases/SpawnEvent.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`SpawnJournal`](../interfaces/SpawnJournal.md).[`appendEvent`](../interfaces/SpawnJournal.md#appendevent)
