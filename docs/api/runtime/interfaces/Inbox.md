[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [runtime](../README.md) / Inbox

# Interface: Inbox

Defined in: [runtime/supervise/inbox.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L27)

## Methods

### deliver()

> **deliver**(`msg`): `void`

Defined in: [runtime/supervise/inbox.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L29)

The `Executor.deliver` implementation — accept a raw down-message from `Scope.send`.

#### Parameters

##### msg

`unknown`

#### Returns

`void`

***

### drain()

> **drain**(): [`InboxMessage`](InboxMessage.md)[]

Defined in: [runtime/supervise/inbox.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L31)

Remove and return all pending messages (the flush).

#### Returns

[`InboxMessage`](InboxMessage.md)[]

***

### pending()

> **pending**(): `number`

Defined in: [runtime/supervise/inbox.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L32)

#### Returns

`number`

***

### freshInterrupt()

> **freshInterrupt**(): `AbortSignal`

Defined in: [runtime/supervise/inbox.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L35)

Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
 this into the signal it passes to its inference call, then re-plans when it fires.

#### Returns

`AbortSignal`

***

### fold()

> **fold**(`messages`): `string`

Defined in: [runtime/supervise/inbox.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L37)

Render drained messages as ONE operator turn to fold into the worker's conversation.

#### Parameters

##### messages

readonly [`InboxMessage`](InboxMessage.md)[]

#### Returns

`string`
