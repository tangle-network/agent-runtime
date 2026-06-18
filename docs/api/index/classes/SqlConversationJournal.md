[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / SqlConversationJournal

# Class: SqlConversationJournal

Defined in: [conversation/journal-sql.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L119)

SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
start/halt timestamps + halt reason) and turns (one row per committed turn,
payload is the ConversationTurn JSON). Replays the turns table on
`loadRun` and writes append-only per `appendTurn`.

## Implements

- [`ConversationJournal`](../interfaces/ConversationJournal.md)

## Constructors

### Constructor

> **new SqlConversationJournal**(`db`, `table?`): `SqlConversationJournal`

Defined in: [conversation/journal-sql.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L126)

#### Parameters

##### db

[`SqlAdapter`](../interfaces/SqlAdapter.md)

SQL adapter (D1, postgres, sqlite, libSQL — all work)

##### table?

`string` = `'agent_runtime_journal'`

Table-name prefix; the journal creates `${table}_runs` and
             `${table}_turns`. Lets multiple journals share a database
             without colliding (e.g. one per product surface).

#### Returns

`SqlConversationJournal`

## Methods

### migrate()

> **migrate**(): `Promise`\<`void`\>

Defined in: [conversation/journal-sql.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L135)

Create the journal's tables if absent. Idempotent. Call once at deploy
(or at app boot) — running on every request is harmless but adds latency.

#### Returns

`Promise`\<`void`\>

***

### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](../interfaces/ConversationJournalEntry.md) \| `undefined`\>

Defined in: [conversation/journal-sql.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L141)

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

Defined in: [conversation/journal-sql.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L167)

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

Defined in: [conversation/journal-sql.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L186)

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

Defined in: [conversation/journal-sql.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L207)

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
