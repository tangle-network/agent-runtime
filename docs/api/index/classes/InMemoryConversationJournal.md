[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / InMemoryConversationJournal

# Class: InMemoryConversationJournal

Defined in: [conversation/journal.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L58)

## Implements

- [`ConversationJournal`](../interfaces/ConversationJournal.md)

## Constructors

### Constructor

> **new InMemoryConversationJournal**(): `InMemoryConversationJournal`

#### Returns

`InMemoryConversationJournal`

## Methods

### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](../interfaces/ConversationJournalEntry.md) \| `undefined`\>

Defined in: [conversation/journal.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L61)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

#### Parameters

##### runId

`string`

#### Returns

`Promise`\<[`ConversationJournalEntry`](../interfaces/ConversationJournalEntry.md) \| `undefined`\>

#### Implementation of

[`ConversationJournal`](../interfaces/ConversationJournal.md).[`loadRun`](../interfaces/ConversationJournal.md#loadrun)

***

### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L74)

Initialise journal state for a fresh run. Called once per run, before any
`appendTurn`. Idempotent: calling with an existing runId is a no-op if
the entry already exists with the same `startedAt`.

#### Parameters

##### runId

`string`

##### startedAt

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`ConversationJournal`](../interfaces/ConversationJournal.md).[`beginRun`](../interfaces/ConversationJournal.md#beginrun)

***

### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L87)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

#### Parameters

##### runId

`string`

##### turn

[`ConversationTurn`](../interfaces/ConversationTurn.md)

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`ConversationJournal`](../interfaces/ConversationJournal.md).[`appendTurn`](../interfaces/ConversationJournal.md#appendturn)

***

### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L102)

Record the run's terminal halt reason + end time. Once called, the run
is observed-final; subsequent `loadRun` returns the same halt.

#### Parameters

##### runId

`string`

##### halt

[`HaltReason`](../type-aliases/HaltReason.md)

##### endedAt

`string`

#### Returns

`Promise`\<`void`\>

#### Implementation of

[`ConversationJournal`](../interfaces/ConversationJournal.md).[`recordHalt`](../interfaces/ConversationJournal.md#recordhalt)
