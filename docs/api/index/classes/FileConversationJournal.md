[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / FileConversationJournal

# Class: FileConversationJournal

Defined in: [conversation/journal.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L122)

JSONL on disk. One line per record; first line is the `begin`, subsequent
lines are `turn` records, terminal line is `halt`. Replays the whole file
on `loadRun` — cheap for the conversation sizes this is designed for
(thousands of turns, not millions). For huge runs, plug in a real DB
adapter; the interface is small.

Each `appendTurn` / `recordHalt` calls `fsync` after the write so a
process crash between writes never loses an acknowledged turn.

## Implements

- [`ConversationJournal`](../interfaces/ConversationJournal.md)

## Constructors

### Constructor

> **new FileConversationJournal**(`path`): `FileConversationJournal`

Defined in: [conversation/journal.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L123)

#### Parameters

##### path

`string`

#### Returns

`FileConversationJournal`

## Methods

### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](../interfaces/ConversationJournalEntry.md) \| `undefined`\>

Defined in: [conversation/journal.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L125)

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

Defined in: [conversation/journal.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L161)

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

Defined in: [conversation/journal.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L174)

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

Defined in: [conversation/journal.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L178)

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
