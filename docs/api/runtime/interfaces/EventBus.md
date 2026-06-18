[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / EventBus

# Interface: EventBus\<E\>

Defined in: [runtime/supervise/event-bus.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L56)

## Type Parameters

### E

`E` *extends* [`BusEvent`](BusEvent.md)

## Methods

### publish()

> **publish**(`event`, `opts?`): `Promise`\<[`BusRecord`](BusRecord.md)\<`E`\>\>

Defined in: [runtime/supervise/event-bus.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L59)

Stamp + queue the event, then deliver the stamped record to every subscriber in order.
 Returns the stamped record.

#### Parameters

##### event

`E`

##### opts?

[`PublishOptions`](PublishOptions.md)

#### Returns

`Promise`\<[`BusRecord`](BusRecord.md)\<`E`\>\>

***

### pull()

> **pull**(`kinds?`): `E` \| `undefined`

Defined in: [runtime/supervise/event-bus.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L62)

Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
 ties broken FIFO by `seq`; `undefined` when nothing matches.

#### Parameters

##### kinds?

readonly `E`\[`"type"`\][]

#### Returns

`E` \| `undefined`

***

### subscribe()

> **subscribe**(`handler`): () => `void`

Defined in: [runtime/supervise/event-bus.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L65)

Register a pass-through handler; it receives the stamped record of every event published after
 registration. Returns an unsubscribe fn.

#### Parameters

##### handler

(`record`) => `void` \| `Promise`\<`void`\>

#### Returns

() => `void`

***

### pending()

> **pending**(`kinds?`): `number`

Defined in: [runtime/supervise/event-bus.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L67)

Count of queued, not-yet-pulled events (filtered by `kinds` when given).

#### Parameters

##### kinds?

readonly `E`\[`"type"`\][]

#### Returns

`number`

***

### history()

> **history**(): readonly [`BusRecord`](BusRecord.md)\<`E`\>[]

Defined in: [runtime/supervise/event-bus.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L69)

The full ordered log of every event ever published (the audit/replay trail).

#### Returns

readonly [`BusRecord`](BusRecord.md)\<`E`\>[]

***

### stats()

> **stats**(): [`BusStats`](BusStats.md)

Defined in: [runtime/supervise/event-bus.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L71)

Throughput counters for observability dashboards.

#### Returns

[`BusStats`](BusStats.md)
