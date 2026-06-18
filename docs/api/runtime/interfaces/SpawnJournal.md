[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / SpawnJournal

# Interface: SpawnJournal

Defined in: [runtime/supervise/types.ts:406](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L406)

The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
`loadTree` replays the full ordered event list for resume/replay; `appendEvent` is
called only AFTER the event is observed-committed (never speculative).

## Methods

### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](../type-aliases/SpawnEvent.md)[] \| `undefined`\>

Defined in: [runtime/supervise/types.ts:407](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L407)

#### Parameters

##### root

`string`

#### Returns

`Promise`\<[`SpawnEvent`](../type-aliases/SpawnEvent.md)[] \| `undefined`\>

***

### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [runtime/supervise/types.ts:408](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L408)

#### Parameters

##### root

`string`

##### at

`string`

#### Returns

`Promise`\<`void`\>

***

### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

Defined in: [runtime/supervise/types.ts:409](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L409)

#### Parameters

##### root

`string`

##### ev

[`SpawnEvent`](../type-aliases/SpawnEvent.md)

#### Returns

`Promise`\<`void`\>
