[**@tangle-network/agent-runtime**](../../README.md)

***

[@tangle-network/agent-runtime](../../README.md) / [index](../README.md) / ConversationJournal

# Interface: ConversationJournal

Defined in: [conversation/journal.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L28)

## Methods

### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](ConversationJournalEntry.md) \| `undefined`\>

Defined in: [conversation/journal.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L35)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

#### Parameters

##### runId

`string`

#### Returns

`Promise`\<[`ConversationJournalEntry`](ConversationJournalEntry.md) \| `undefined`\>

***

### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L42)

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

***

### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L49)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

#### Parameters

##### runId

`string`

##### turn

[`ConversationTurn`](ConversationTurn.md)

#### Returns

`Promise`\<`void`\>

***

### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L55)

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
