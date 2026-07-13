[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / index

# index

## Classes

### FileAgentCandidateExecutionClaimStore

Defined in: [candidate-execution/claim-file-store.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L74)

Cross-process lifecycle implemented as fsynced, create-if-absent records.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new FileAgentCandidateExecutionClaimStore**(`options`): [`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

Defined in: [candidate-execution/claim-file-store.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L78)

###### Parameters

###### options

[`FileAgentCandidateExecutionClaimStoreOptions`](#fileagentcandidateexecutionclaimstoreoptions)

###### Returns

[`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [candidate-execution/claim-file-store.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L86)

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [candidate-execution/claim-file-store.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L115)

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [candidate-execution/claim-file-store.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L121)

Persist the point after which candidate code may have run.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`markCandidateMayRun`](#markcandidatemayrun-1)

##### stageTerminal()

> **stageTerminal**(`requestedLease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

Defined in: [candidate-execution/claim-file-store.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L158)

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`stageTerminal`](#stageterminal-1)

##### finish()

> **finish**(`requestedLease`, `requestedTerminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim-file-store.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L191)

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### requestedTerminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`finish`](#finish-1)

##### recoverExpired()

> **recoverExpired**(`requestedAttempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim-file-store.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L228)

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`recoverExpired`](#recoverexpired-1)

***

### InMemoryAgentCandidateExecutionClaimStore

Defined in: [candidate-execution/claim.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L290)

Single-process lifecycle implementation.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new InMemoryAgentCandidateExecutionClaimStore**(`options?`): [`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

Defined in: [candidate-execution/claim.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L296)

###### Parameters

###### options?

`InMemoryAgentCandidateExecutionClaimStoreOptions` = `{}`

###### Returns

[`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [candidate-execution/claim.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L300)

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [candidate-execution/claim.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L323)

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [candidate-execution/claim.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L333)

Persist the point after which candidate code may have run.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`markCandidateMayRun`](#markcandidatemayrun-1)

##### stageTerminal()

> **stageTerminal**(`requestedLease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

Defined in: [candidate-execution/claim.ts:350](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L350)

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`stageTerminal`](#stageterminal-1)

##### finish()

> **finish**(`requestedLease`, `requestedTerminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L365)

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### requestedLease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### requestedTerminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`finish`](#finish-1)

##### recoverExpired()

> **recoverExpired**(`requestedAttempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L383)

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`recoverExpired`](#recoverexpired-1)

***

### CircuitOpenError

Defined in: [conversation/call-policy.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L43)

Thrown when the circuit breaker is open for a participant and no retry is allowed yet.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CircuitOpenError**(`participant`, `retryAfterMs`): [`CircuitOpenError`](#circuitopenerror)

Defined in: [conversation/call-policy.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L44)

###### Parameters

###### participant

`string`

###### retryAfterMs

`number`

###### Returns

[`CircuitOpenError`](#circuitopenerror)

###### Overrides

`Error.constructor`

***

### DeadlineExceededError

Defined in: [conversation/call-policy.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L53)

Thrown when a backend call exceeds its per-attempt deadline.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new DeadlineExceededError**(`deadlineMs`): [`DeadlineExceededError`](#deadlineexceedederror)

Defined in: [conversation/call-policy.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L54)

###### Parameters

###### deadlineMs

`number`

###### Returns

[`DeadlineExceededError`](#deadlineexceedederror)

###### Overrides

`Error.constructor`

***

### CircuitBreakerState

Defined in: [conversation/call-policy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L86)

Live circuit-breaker state — one instance per (participant, conversation run).

#### Constructors

##### Constructor

> **new CircuitBreakerState**(`config`): [`CircuitBreakerState`](#circuitbreakerstate)

Defined in: [conversation/call-policy.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L90)

###### Parameters

###### config

[`CircuitBreakerConfig`](#circuitbreakerconfig) \| `undefined`

###### Returns

[`CircuitBreakerState`](#circuitbreakerstate)

#### Methods

##### preflight()

> **preflight**(`participant`, `now?`): `void`

Defined in: [conversation/call-policy.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L96)

Check whether the next call is allowed. Throws `CircuitOpenError` when
the breaker is open and the cooldown hasn't elapsed.

###### Parameters

###### participant

`string`

###### now?

`number` = `...`

###### Returns

`void`

##### recordSuccess()

> **recordSuccess**(): `void`

Defined in: [conversation/call-policy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L106)

###### Returns

`void`

##### recordFailure()

> **recordFailure**(`now?`): `void`

Defined in: [conversation/call-policy.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L111)

###### Parameters

###### now?

`number` = `...`

###### Returns

`void`

***

### SqlConversationJournal

Defined in: [conversation/journal-sql.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L120)

SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
start/halt timestamps + halt reason) and turns (one row per committed turn,
payload is the ConversationTurn JSON). Replays the turns table on
`loadRun` and writes append-only per `appendTurn`.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new SqlConversationJournal**(`db`, `table?`): [`SqlConversationJournal`](#sqlconversationjournal)

Defined in: [conversation/journal-sql.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L127)

###### Parameters

###### db

[`SqlAdapter`](#sqladapter)

SQL adapter (D1, postgres, sqlite, libSQL — all work)

###### table?

`string` = `'agent_runtime_journal'`

Table-name prefix; the journal creates `${table}_runs` and
             `${table}_turns`. Lets multiple journals share a database
             without colliding (e.g. one per product surface).

###### Returns

[`SqlConversationJournal`](#sqlconversationjournal)

#### Methods

##### migrate()

> **migrate**(): `Promise`\<`void`\>

Defined in: [conversation/journal-sql.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L136)

Create the journal's tables if absent. Idempotent. Call once at deploy
(or at app boot) — running on every request is harmless but adds latency.

###### Returns

`Promise`\<`void`\>

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal-sql.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L142)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

###### Parameters

###### runId

`string`

###### Returns

`Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`loadRun`](#loadrun-1)

##### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal-sql.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L168)

Initialise journal state for a fresh run. Called once per run, before any
`appendTurn`. Idempotent: calling with an existing runId is a no-op if
the entry already exists with the same `startedAt`.

###### Parameters

###### runId

`string`

###### startedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`beginRun`](#beginrun-1)

##### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal-sql.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L187)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

###### Parameters

###### runId

`string`

###### turn

[`ConversationTurn`](#conversationturn)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`appendTurn`](#appendturn-1)

##### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal-sql.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L208)

Record the run's terminal halt reason + end time. Once called, the run
is observed-final; subsequent `loadRun` returns the same halt.

###### Parameters

###### runId

`string`

###### halt

[`HaltReason`](#haltreason)

###### endedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`recordHalt`](#recordhalt-1)

***

### InMemoryConversationJournal

Defined in: [conversation/journal.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L60)

In-memory `ConversationJournal` — suitable for testing and single-process runs.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new InMemoryConversationJournal**(): [`InMemoryConversationJournal`](#inmemoryconversationjournal)

###### Returns

[`InMemoryConversationJournal`](#inmemoryconversationjournal)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L63)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

###### Parameters

###### runId

`string`

###### Returns

`Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`loadRun`](#loadrun-1)

##### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L76)

Initialise journal state for a fresh run. Called once per run, before any
`appendTurn`. Idempotent: calling with an existing runId is a no-op if
the entry already exists with the same `startedAt`.

###### Parameters

###### runId

`string`

###### startedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`beginRun`](#beginrun-1)

##### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L89)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

###### Parameters

###### runId

`string`

###### turn

[`ConversationTurn`](#conversationturn)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`appendTurn`](#appendturn-1)

##### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L104)

Record the run's terminal halt reason + end time. Once called, the run
is observed-final; subsequent `loadRun` returns the same halt.

###### Parameters

###### runId

`string`

###### halt

[`HaltReason`](#haltreason)

###### endedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`recordHalt`](#recordhalt-1)

***

### FileConversationJournal

Defined in: [conversation/journal.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L124)

JSONL on disk. One line per record; first line is the `begin`, subsequent
lines are `turn` records, terminal line is `halt`. Replays the whole file
on `loadRun` — cheap for the conversation sizes this is designed for
(thousands of turns, not millions). For huge runs, plug in a real DB
adapter; the interface is small.

Each `appendTurn` / `recordHalt` calls `fsync` after the write so a
process crash between writes never loses an acknowledged turn.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new FileConversationJournal**(`path`): [`FileConversationJournal`](#fileconversationjournal)

Defined in: [conversation/journal.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L125)

###### Parameters

###### path

`string`

###### Returns

[`FileConversationJournal`](#fileconversationjournal)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L127)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

###### Parameters

###### runId

`string`

###### Returns

`Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`loadRun`](#loadrun-1)

##### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L163)

Initialise journal state for a fresh run. Called once per run, before any
`appendTurn`. Idempotent: calling with an existing runId is a no-op if
the entry already exists with the same `startedAt`.

###### Parameters

###### runId

`string`

###### startedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`beginRun`](#beginrun-1)

##### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L176)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

###### Parameters

###### runId

`string`

###### turn

[`ConversationTurn`](#conversationturn)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`appendTurn`](#appendturn-1)

##### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L180)

Record the run's terminal halt reason + end time. Once called, the run
is observed-final; subsequent `loadRun` returns the same halt.

###### Parameters

###### runId

`string`

###### halt

[`HaltReason`](#haltreason)

###### endedAt

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ConversationJournal`](#conversationjournal).[`recordHalt`](#recordhalt-1)

***

### BackendTransportError

Defined in: [errors.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L68)

A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
status. Distinct from `JudgeError` (which is structural / unrecoverable)
because backend failures are sometimes retryable and consumers may want to
branch on the upstream status code.

#### Stable

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new BackendTransportError**(`backend`, `message`, `options?`): [`BackendTransportError`](#backendtransporterror)

Defined in: [errors.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L79)

###### Parameters

###### backend

`string`

###### message

`string`

###### options?

###### cause?

`unknown`

###### status?

`number`

###### body?

`string`

###### Returns

[`BackendTransportError`](#backendtransporterror)

###### Overrides

`AgentEvalError.constructor`

#### Properties

##### backend

> `readonly` **backend**: `string`

Defined in: [errors.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L69)

##### status?

> `readonly` `optional` **status?**: `number`

Defined in: [errors.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L70)

##### body?

> `readonly` `optional` **body?**: `string`

Defined in: [errors.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L77)

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.

***

### RuntimeRunStateError

Defined in: [errors.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L98)

A runtime-run lifecycle method was called in an order the state machine does
not allow: `persist()` before `complete()`, `complete()` twice, etc.

#### Stable

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new RuntimeRunStateError**(`message`, `options?`): [`RuntimeRunStateError`](#runtimerunstateerror)

Defined in: [errors.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L99)

###### Parameters

###### message

`string`

###### options?

###### cause?

`unknown`

###### Returns

[`RuntimeRunStateError`](#runtimerunstateerror)

###### Overrides

`AgentEvalError.constructor`

***

### PlannerError

Defined in: [errors.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L116)

The dynamic-loop planner returned an unusable topology move — the LLM emitted
no parseable envelope, an unknown `kind`, or a structurally-invalid move
(e.g. a fanout with zero tasks). This is a structural failure of the
agent-authored topology, not a config mistake: the planner ran but its output
cannot drive the kernel. Carries `validation` so cross-package handlers can
pattern-match without importing the runtime. Fail loud — never substitute a
default move, or the loop silently runs a topology nobody chose.

#### Stable

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new PlannerError**(`message`, `options?`): [`PlannerError`](#plannererror)

Defined in: [errors.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L117)

###### Parameters

###### message

`string`

###### options?

###### cause?

`unknown`

###### Returns

[`PlannerError`](#plannererror)

###### Overrides

`AgentEvalError.constructor`

***

### InMemoryRuntimeSessionStore

Defined in: [sessions.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L41)

In-memory `RuntimeSessionStore` for single-process use and tests.

#### Stable

#### Implements

- [`RuntimeSessionStore`](#runtimesessionstore)

#### Constructors

##### Constructor

> **new InMemoryRuntimeSessionStore**(): [`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

###### Returns

[`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

#### Methods

##### get()

> **get**(`sessionId`): `RuntimeSession` \| `undefined`

Defined in: [sessions.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L45)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `undefined`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`get`](#get-1)

##### put()

> **put**(`session`): `void`

Defined in: [sessions.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L49)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`put`](#put-2)

##### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

Defined in: [sessions.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L53)

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`appendEvent`](#appendevent-1)

##### listEvents()

> **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[]

Defined in: [sessions.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L59)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`listEvents`](#listevents-1)

## Interfaces

### AgentCandidateCodeSurfaceSource

Defined in: [candidate-execution/builder.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L44)

The only accepted path from an agent-eval code candidate to executable bytes.

#### Properties

##### kind

> **kind**: `"code-surface"`

Defined in: [candidate-execution/builder.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L45)

##### surface

> **surface**: `CodeSurface`

Defined in: [candidate-execution/builder.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L46)

##### repository

> **repository**: `AgentCandidateGitHubRepository`

Defined in: [candidate-execution/builder.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L47)

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Defined in: [candidate-execution/builder.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L49)

Optional parent directory used to resolve a relative `surface.worktreeRef`.

***

### BuildAgentCandidateBundleInput

Defined in: [candidate-execution/builder.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L59)

Complete measured surfaces and execution policy compiled into one candidate bundle.

#### Properties

##### profile

> **profile**: [`AgentCandidateProfileSource`](#agentcandidateprofilesource)

Defined in: [candidate-execution/builder.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L60)

##### code

> **code**: [`AgentCandidateCodeSource`](#agentcandidatecodesource)

Defined in: [candidate-execution/builder.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L61)

##### execution

> **execution**: `AgentCandidateExecution`

Defined in: [candidate-execution/builder.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L62)

##### knowledge?

> `optional` **knowledge?**: `AgentCandidateKnowledge`

Defined in: [candidate-execution/builder.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L63)

##### memory

> **memory**: `AgentCandidateMemoryPolicy`

Defined in: [candidate-execution/builder.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L64)

##### lineage

> **lineage**: `Omit`\<`AgentCandidateLineage`, `"profileDiffIds"`\>

Defined in: [candidate-execution/builder.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L66)

`profileDiffIds` is derived from `profile`; callers cannot contradict it.

***

### FileAgentCandidateExecutionClaimStoreOptions

Defined in: [candidate-execution/claim-file-store.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L66)

#### Properties

##### directory

> **directory**: `string`

Defined in: [candidate-execution/claim-file-store.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L68)

Evaluator-owned directory shared by every process allowed to execute candidates.

##### now?

> `optional` **now?**: () => `number`

Defined in: [candidate-execution/claim-file-store.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L70)

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### AgentCandidateExecutionCleanupHandles

Defined in: [candidate-execution/claim.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L39)

Non-secret identities a trusted recovery worker needs to close an abandoned attempt.

#### Properties

##### preparationId

> `readonly` **preparationId**: `string`

Defined in: [candidate-execution/claim.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L40)

##### modelGrantDigest

> `readonly` **modelGrantDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/claim.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L41)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [candidate-execution/claim.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L42)

##### traceRunId

> `readonly` **traceRunId**: `string`

Defined in: [candidate-execution/claim.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L43)

##### cleanupTimeoutMs

> `readonly` **cleanupTimeoutMs**: `number`

Defined in: [candidate-execution/claim.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L44)

##### memory?

> `readonly` `optional` **memory?**: `object`

Defined in: [candidate-execution/claim.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L45)

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionClaim

Defined in: [candidate-execution/claim.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L52)

Immutable signed identity stored for one execution attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/claim.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L53)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [candidate-execution/claim.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L54)

##### maxAttempts

> `readonly` **maxAttempts**: `number`

Defined in: [candidate-execution/claim.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L55)

##### retryPolicy

> `readonly` **retryPolicy**: `"none"` \| `"pre-model-infrastructure-only"`

Defined in: [candidate-execution/claim.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L56)

##### bundleDigest

> `readonly` **bundleDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/claim.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L57)

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/claim.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L58)

##### retryLineageDigest

> `readonly` **retryLineageDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/claim.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L60)

Frozen plan identity with only attempt number and per-attempt grant identity normalized.

##### leaseExpiresAtMs

> `readonly` **leaseExpiresAtMs**: `number`

Defined in: [candidate-execution/claim.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L62)

The winning lease stops authorizing a new terminal write at this instant.

##### resultTimeoutMs

> `readonly` **resultTimeoutMs**: `number`

Defined in: [candidate-execution/claim.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L64)

Frozen budget for task verification, executable grading, and receipt construction.

##### cleanup

> `readonly` **cleanup**: [`AgentCandidateExecutionCleanupHandles`](#agentcandidateexecutioncleanuphandles)

Defined in: [candidate-execution/claim.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L66)

Non-secret handles retained so an expired attempt can be closed and reconciled.

***

### AgentCandidateExecutionLease

Defined in: [candidate-execution/claim.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L70)

Secret capability required to finish the acquired attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/claim.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L71)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [candidate-execution/claim.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L72)

##### token

> `readonly` **token**: `string`

Defined in: [candidate-execution/claim.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L73)

##### expiresAtMs

> `readonly` **expiresAtMs**: `number`

Defined in: [candidate-execution/claim.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L74)

***

### AgentCandidateExecutionUsage

Defined in: [candidate-execution/claim.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L85)

Exact fixed-point usage proven by the closed evaluator model ledger.

#### Properties

##### costUsdNanos

> `readonly` **costUsdNanos**: `number`

Defined in: [candidate-execution/claim.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L86)

##### inputTokens

> `readonly` **inputTokens**: `number`

Defined in: [candidate-execution/claim.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L87)

##### outputTokens

> `readonly` **outputTokens**: `number`

Defined in: [candidate-execution/claim.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L88)

##### cachedInputTokens

> `readonly` **cachedInputTokens**: `number`

Defined in: [candidate-execution/claim.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L89)

##### reasoningTokens

> `readonly` **reasoningTokens**: `number`

Defined in: [candidate-execution/claim.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L90)

##### modelCalls

> `readonly` **modelCalls**: `number`

Defined in: [candidate-execution/claim.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L91)

***

### AgentCandidateExecutionRecoveryEvidence

Defined in: [candidate-execution/claim.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L128)

Trusted, independently observed closure facts for one expired winning lease.

#### Properties

##### failureClass

> `readonly` **failureClass**: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass)

Defined in: [candidate-execution/claim.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L129)

##### usage

> `readonly` **usage**: [`AgentCandidateExecutionUsage`](#agentcandidateexecutionusage)

Defined in: [candidate-execution/claim.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L130)

##### modelSettlement

> `readonly` **modelSettlement**: `AgentCandidateArtifactRef`

Defined in: [candidate-execution/claim.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L131)

##### failureEvidence?

> `readonly` `optional` **failureEvidence?**: `AgentCandidateArtifactRef`

Defined in: [candidate-execution/claim.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L132)

##### process

> `readonly` **process**: `object`

Defined in: [candidate-execution/claim.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L133)

###### stopped

> `readonly` **stopped**: `true`

###### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

##### model

> `readonly` **model**: `object`

Defined in: [candidate-execution/claim.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L137)

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### grantDigest

> `readonly` **grantDigest**: `` `sha256:${string}` ``

##### memory?

> `readonly` `optional` **memory?**: `object`

Defined in: [candidate-execution/claim.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L142)

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionAttemptRef

Defined in: [candidate-execution/claim.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L150)

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/claim.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L151)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [candidate-execution/claim.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L152)

***

### AgentCandidateExecutionAttemptRecord

Defined in: [candidate-execution/claim.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L156)

Persisted state available to a fresh trusted recovery worker after a crash.

#### Properties

##### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

Defined in: [candidate-execution/claim.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L157)

##### phase

> `readonly` **phase**: [`AgentCandidateExecutionPhase`](#agentcandidateexecutionphase)

Defined in: [candidate-execution/claim.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L158)

##### staged?

> `readonly` `optional` **staged?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

Defined in: [candidate-execution/claim.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L160)

Durable outbox content written before the terminal compare-and-set.

##### terminal?

> `readonly` `optional` **terminal?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

Defined in: [candidate-execution/claim.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L161)

***

### AgentCandidateExecutionClaimStore

Defined in: [candidate-execution/claim.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L233)

Atomic one-shot store for candidate execution attempts.

Implementations must linearize both methods across every process sharing the
store. Terminal publication is deliberately two-step: `stageTerminal`
fsyncs the complete immutable outbox record, then `finish` publishes exactly
those staged bytes by digest. A crash between the two leaves recoverable
evidence rather than an ambiguous completed run.

#### Methods

##### tryClaim()

> **tryClaim**(`claim`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [candidate-execution/claim.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L234)

###### Parameters

###### claim

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

##### getAttempt()

> **getAttempt**(`attempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [candidate-execution/claim.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L235)

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

##### markCandidateMayRun()

> **markCandidateMayRun**(`lease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [candidate-execution/claim.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L239)

Persist the point after which candidate code may have run.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

##### stageTerminal()

> **stageTerminal**(`lease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

Defined in: [candidate-execution/claim.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L243)

Fsync the complete terminal record into the durable outbox.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### result

[`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult)

###### Returns

`Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

##### finish()

> **finish**(`lease`, `terminalDigest`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L248)

Publish exactly the staged terminal identified by `terminalDigest`.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### terminalDigest

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

##### recoverExpired()

> **recoverExpired**(`attempt`, `evidence`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/claim.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L256)

Write a failed terminal only after the lease expired and a trusted worker
independently proved process death plus model and memory closure.

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### evidence

[`AgentCandidateExecutionRecoveryEvidence`](#agentcandidateexecutionrecoveryevidence)

###### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### DisposePreparedAgentCandidateOptions

Defined in: [candidate-execution/dispose.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L10)

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [candidate-execution/dispose.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L11)

***

### ExecutePreparedAgentCandidateOptions

Defined in: [candidate-execution/execute.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L61)

#### Properties

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

Defined in: [candidate-execution/execute.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L62)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](#agentcandidatebenchmarkgraderport)

Defined in: [candidate-execution/execute.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L63)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

Defined in: [candidate-execution/execute.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L64)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [candidate-execution/execute.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L65)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

Defined in: [candidate-execution/execute.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L67)

Long-lived evaluator-owned store shared by every process that can run this benchmark.

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [candidate-execution/execute.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L69)

Maximum time to prove process death and revoke protected access after a run ends.

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [candidate-execution/execute.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L71)

Maximum time for task verification, executable grading, and receipt construction.

***

### PrepareAgentCandidateExecutionOptions

Defined in: [candidate-execution/prepare.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L91)

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [candidate-execution/prepare.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L92)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [candidate-execution/prepare.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L94)

Maximum time for task verification, executable grading, and receipt construction.

***

### AgentCandidateModelGrantClient

Defined in: [candidate-execution/protected-model-port.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L39)

Narrow transport contract for a service that owns scoped model credentials
and the authoritative per-call usage ledger.

An HTTP client can bind these methods to control-plane endpoints. Keeping
transport out of the runtime prevents parent credentials, endpoint paths,
and retry policy from becoming part of the portable candidate contract.

#### Methods

##### reserve()

> **reserve**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

Defined in: [candidate-execution/protected-model-port.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L40)

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### attempt

`AgentCandidateAttemptPolicy`

###### bundleDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### limits

[`AgentCandidateModelLimits`](#agentcandidatemodellimits)

###### Returns

`Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

##### activate()

> **activate**(`input`): `Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

Defined in: [candidate-execution/protected-model-port.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L41)

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

##### settle()

> **settle**(`input`): `Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

Defined in: [candidate-execution/protected-model-port.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L44)

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

***

### CreateProtectedAgentCandidateModelPortOptions

Defined in: [candidate-execution/protected-model-port.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L49)

#### Properties

##### client

> **client**: [`AgentCandidateModelGrantClient`](#agentcandidatemodelgrantclient)

Defined in: [candidate-execution/protected-model-port.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L50)

##### resolveModel

> **resolveModel**: (`input`) => `Promise`\<`AgentCandidateResolvedModel`\>

Defined in: [candidate-execution/protected-model-port.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L52)

Catalog/snapshot resolution stays separate from credential issuance.

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`ReasoningEffort` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### gatewayDomain

> **gatewayDomain**: `string`

Defined in: [candidate-execution/protected-model-port.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L54)

The only public DNS name candidate processes may reach for inference.

##### activationEnvNames

> **activationEnvNames**: readonly `string`[]

Defined in: [candidate-execution/protected-model-port.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L56)

Exact environment names the activation endpoint must return, no more or fewer.

***

### RecoverExpiredAgentCandidateOptions

Defined in: [candidate-execution/recover.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L23)

#### Properties

##### attempt

> **attempt**: [`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

Defined in: [candidate-execution/recover.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L24)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

Defined in: [candidate-execution/recover.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L25)

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

Defined in: [candidate-execution/recover.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L26)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [candidate-execution/recover.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L27)

##### ports

> **ports**: `Pick`\<[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports), `"models"` \| `"memory"`\>

Defined in: [candidate-execution/recover.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L28)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

Defined in: [candidate-execution/recover.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L29)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [candidate-execution/recover.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L30)

##### now?

> `optional` **now?**: () => `number`

Defined in: [candidate-execution/recover.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L32)

Evaluator clock; must be the same clock used by the claim store.

###### Returns

`number`

***

### AgentCandidateArtifactPort

Defined in: [candidate-execution/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L34)

Reads one content-addressed object from the closed S3/IPFS locator set.

#### Extended by

- [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [candidate-execution/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L35)

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### AgentCandidateOutputArtifactPort

Defined in: [candidate-execution/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L55)

Durable content-addressed evidence store controlled only by the evaluator.

#### Extends

- [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [candidate-execution/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L35)

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Inherited from

[`AgentCandidateArtifactPort`](#agentcandidateartifactport).[`read`](#read)

##### put()

> **put**(`input`): `Promise`\<`AgentCandidateArtifactRef`\>

Defined in: [candidate-execution/types.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L57)

Must be idempotent for identical bytes and return only a durable S3/IPFS locator.

###### Parameters

###### input

###### executionId

`string`

###### purpose

[`AgentCandidateOutputPurpose`](#agentcandidateoutputpurpose)

###### bytes

`Uint8Array`

###### signal?

`AbortSignal`

Abort must prevent durable publication when it happens before resolution.

###### Returns

`Promise`\<`AgentCandidateArtifactRef`\>

***

### AgentCandidateRepositoryPort

Defined in: [candidate-execution/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L67)

Resolves a declared GitHub repository to an already-present local Git object store.

#### Methods

##### resolve()

> **resolve**(`repository`): `Promise`\<`string`\>

Defined in: [candidate-execution/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L68)

###### Parameters

###### repository

`AgentCandidateGitHubRepository`

###### Returns

`Promise`\<`string`\>

***

### AgentCandidateVerificationPorts

Defined in: [candidate-execution/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L71)

#### Extended by

- [`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

Defined in: [candidate-execution/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L72)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

Defined in: [candidate-execution/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L73)

***

### AgentCandidateWorkspacePort

Defined in: [candidate-execution/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L83)

Materializes an already-verified workspace archive.

The runtime independently scans every resulting byte, mode, and path against
the signed manifest after this returns. Implementations may therefore unpack
any archive encoding, or no-op when the exact workspace is already present.

#### Methods

##### materialize()

> **materialize**(`input`): `Promise`\<`void`\>

Defined in: [candidate-execution/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L84)

###### Parameters

###### input

###### role

`"task"` \| `"memory"` \| `"candidate"`

###### snapshot

`AgentCandidateWorkspaceSnapshotEvidence`

###### archive

`Uint8Array`

###### destination

`string`

###### Returns

`Promise`\<`void`\>

***

### ResolvedAgentCandidateContainer

Defined in: [candidate-execution/types.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L92)

#### Properties

##### source

> **source**: `"pinned-container"` \| `"evaluator-task-container"`

Defined in: [candidate-execution/types.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L93)

##### image

> **image**: `string`

Defined in: [candidate-execution/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L94)

##### indexDigest

> **indexDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L95)

##### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L96)

##### platform

> **platform**: `AgentCandidateOciPlatform`

Defined in: [candidate-execution/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L97)

***

### AgentCandidateContainerPort

Defined in: [candidate-execution/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L100)

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

Defined in: [candidate-execution/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L101)

###### Parameters

###### input

###### candidate

`AgentCandidateContainer` \| `undefined`

###### evaluatorTaskContainer

[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer) \| `undefined`

###### Returns

`Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

***

### AgentCandidateModelPort

Defined in: [candidate-execution/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L107)

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<`AgentCandidateResolvedModel`\>

Defined in: [candidate-execution/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L108)

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`ReasoningEffort` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### reserveGrant()

> **reserveGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

Defined in: [candidate-execution/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L118)

Reserve a stable access identity without creating a live credential.
The reservation is scoped to `preparationId` and must automatically expire
at `expiresAtMs`, even if this call returns ambiguously to the runtime.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### attempt

`AgentCandidateAttemptPolicy`

###### bundleDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### limits

[`AgentCandidateModelLimits`](#agentcandidatemodellimits)

###### Returns

`Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

##### activateGrant()

> **activateGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

Defined in: [candidate-execution/types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L128)

Create the live scoped credential only after the execution attempt is durably claimed.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)\>

##### settleGrant()

> **settleGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

Defined in: [candidate-execution/types.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L141)

Atomically revoke the grant, drain in-flight calls, and return its immutable final ledger.
This operation must be idempotent for the exact preparation and must also
settle a reservation that was never activated. It must never affect a
different preparation, even when both reservations report the same digest.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### grantDigest

`` `sha256:${string}` ``

###### resolved

`AgentCandidateResolvedModel`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<[`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)\>

***

### AgentCandidateBenchmarkGraderIdentity

Defined in: [candidate-execution/types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L156)

#### Properties

##### name

> **name**: `string`

Defined in: [candidate-execution/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L157)

##### version

> **version**: `string`

Defined in: [candidate-execution/types.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L158)

##### artifact

> **artifact**: `AgentCandidateArtifactRef`

Defined in: [candidate-execution/types.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L159)

***

### AgentCandidateProtectedModelReservation

Defined in: [candidate-execution/types.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L162)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [candidate-execution/types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L163)

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L164)

##### expiresAtMs

> **expiresAtMs**: `number`

Defined in: [candidate-execution/types.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L166)

Evaluator service must expire and revoke this reservation at this epoch millisecond.

##### enforcedLimits

> **enforcedLimits**: [`AgentCandidateModelLimits`](#agentcandidatemodellimits)

Defined in: [candidate-execution/types.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L168)

The gateway must stop calls before any one of these limits is exceeded.

##### network

> **network**: `AgentCandidateModelAccessNetwork`

Defined in: [candidate-execution/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L170)

Exact public endpoint exception; every other candidate destination stays blocked.

***

### AgentCandidateProtectedModelActivation

Defined in: [candidate-execution/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L173)

#### Properties

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [candidate-execution/types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L175)

Injected only into the trusted executor after all pre-launch checks pass.

***

### AgentCandidateProtectedModelCall

Defined in: [candidate-execution/types.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L179)

One evaluator-gateway call in the final, revoked model-access ledger.

#### Properties

##### callId

> **callId**: `string`

Defined in: [candidate-execution/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L180)

##### generationId

> **generationId**: `string`

Defined in: [candidate-execution/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L182)

Router-generated public response identity.

##### traceSpanId

> **traceSpanId**: `string`

Defined in: [candidate-execution/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L184)

Exact protected agent-eval LLM span produced from the router ledger.

##### status

> **status**: `"failed"` \| `"succeeded"`

Defined in: [candidate-execution/types.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L185)

##### model

> **model**: `string`

Defined in: [candidate-execution/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L186)

##### startedAtMs

> **startedAtMs**: `number`

Defined in: [candidate-execution/types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L187)

##### endedAtMs

> **endedAtMs**: `number`

Defined in: [candidate-execution/types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L188)

##### inputTokens

> **inputTokens**: `number`

Defined in: [candidate-execution/types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L189)

##### outputTokens

> **outputTokens**: `number`

Defined in: [candidate-execution/types.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L190)

##### cachedInputTokens

> **cachedInputTokens**: `number`

Defined in: [candidate-execution/types.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L191)

##### reasoningTokens

> **reasoningTokens**: `number`

Defined in: [candidate-execution/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L192)

##### costUsdNanos

> **costUsdNanos**: `number`

Defined in: [candidate-execution/types.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L194)

Integer billionths of one US dollar; avoids floating-point ledger drift.

***

### AgentCandidateProtectedModelSettlement

Defined in: [candidate-execution/types.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L197)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [candidate-execution/types.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L198)

##### grantDigest

> **grantDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L199)

##### closed

> **closed**: `true`

Defined in: [candidate-execution/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L200)

##### calls

> **calls**: readonly [`AgentCandidateProtectedModelCall`](#agentcandidateprotectedmodelcall)[]

Defined in: [candidate-execution/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L201)

***

### AgentCandidateMemoryResetResult

Defined in: [candidate-execution/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L204)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [candidate-execution/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L205)

##### accessDigest

> **accessDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L206)

##### expiresAtMs

> **expiresAtMs**: `number`

Defined in: [candidate-execution/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L207)

##### evidence

> **evidence**: `AgentCandidateCapturedArtifact`

Defined in: [candidate-execution/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L208)

##### emptyStateDigest

> **emptyStateDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L209)

##### beforeState

> **beforeState**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [candidate-execution/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L210)

***

### AgentCandidateMemoryPort

Defined in: [candidate-execution/types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L213)

#### Methods

##### reset()

> **reset**(`input`): `Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

Defined in: [candidate-execution/types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L219)

Reset and reserve exact task memory without returning live access.
The service must scope the reservation to `preparationId`, automatically
revoke it at `expiresAtMs`, and never reuse it for another preparation.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### expiresAtMs

`number`

###### effectiveNamespace

`string`

###### seed?

`Uint8Array`\<`ArrayBufferLike`\>

###### seedDigest?

`` `sha256:${string}` ``

###### Returns

`Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

##### activate()

> **activate**(`input`): `Promise`\<\{ `env`: `Readonly`\<`Record`\<`string`, `string`\>\>; \}\>

Defined in: [candidate-execution/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L231)

Create live scoped access only after the execution attempt is durably claimed.
Activation must match the exact preparation/access pair and may not extend expiry.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### accessDigest

`` `sha256:${string}` ``

###### effectiveNamespace

`string`

###### deadlineAtMs

`number`

###### Returns

`Promise`\<\{ `env`: `Readonly`\<`Record`\<`string`, `string`\>\>; \}\>

##### close()

> **close**(`input`): `Promise`\<\{ `closed`: `true`; \}\>

Defined in: [candidate-execution/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L243)

Revoke evaluator-owned access after process death or a failed preparation.
Must be idempotent and concurrency-safe for the exact preparation/access
pair and must never close a different preparation.

###### Parameters

###### input

###### executionId

`string`

###### preparationId

`string`

###### accessDigest

`` `sha256:${string}` ``

###### effectiveNamespace

`string`

###### reason

`"completed"` \| `"failed"` \| `"timeout"` \| `"replayed"` \| `"preparation-failed"` \| `"abandoned"`

###### Returns

`Promise`\<\{ `closed`: `true`; \}\>

***

### AgentCandidateExecutionPorts

Defined in: [candidate-execution/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L252)

#### Extends

- [`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

Defined in: [candidate-execution/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L72)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`artifacts`](#artifacts)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

Defined in: [candidate-execution/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L73)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`repositories`](#repositories)

##### workspaces

> **workspaces**: [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

Defined in: [candidate-execution/types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L253)

##### containers

> **containers**: [`AgentCandidateContainerPort`](#agentcandidatecontainerport)

Defined in: [candidate-execution/types.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L254)

##### models

> **models**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

Defined in: [candidate-execution/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L255)

##### memory

> **memory**: [`AgentCandidateMemoryPort`](#agentcandidatememoryport)

Defined in: [candidate-execution/types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L256)

***

### AgentCandidateTaskExecution

Defined in: [candidate-execution/types.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L259)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [candidate-execution/types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L260)

##### benchmark

> **benchmark**: `string`

Defined in: [candidate-execution/types.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L261)

##### benchmarkVersion

> **benchmarkVersion**: `string`

Defined in: [candidate-execution/types.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L262)

##### taskId

> **taskId**: `string`

Defined in: [candidate-execution/types.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L263)

##### splitDigest

> **splitDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L264)

##### instruction

> **instruction**: `string`

Defined in: [candidate-execution/types.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L266)

Exact agent-visible task instruction. The runtime rejects malformed Unicode.

##### repository

> **repository**: `object`

Defined in: [candidate-execution/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L267)

###### identity

> **identity**: `string`

###### rootIdentity

> **rootIdentity**: `string`

###### baseCommit

> **baseCommit**: `string`

###### baseTree

> **baseTree**: `string`

##### attempt

> **attempt**: `AgentCandidateAttemptPolicy`

Defined in: [candidate-execution/types.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L273)

##### model

> **model**: `object`

Defined in: [candidate-execution/types.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L274)

###### requested

> **requested**: `string`

###### reasoningEffort

> **reasoningEffort**: `ReasoningEffort`

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderIdentity`](#agentcandidatebenchmarkgraderidentity)

Defined in: [candidate-execution/types.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L278)

##### executionRoots

> **executionRoots**: `object`

Defined in: [candidate-execution/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L280)

Absolute paths inside the evaluator-owned execution environment.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: [candidate-execution/types.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L285)

Host-side staging roots. These are verified but never signed as container paths.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### workspace

> **workspace**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [candidate-execution/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L290)

##### evaluatorTaskContainer?

> `optional` **evaluatorTaskContainer?**: [`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)

Defined in: [candidate-execution/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L291)

##### limits

> **limits**: `AgentCandidateExecutionLimits`

Defined in: [candidate-execution/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L292)

***

### VerifiedAgentCandidate

Defined in: [candidate-execution/types.ts:295](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L295)

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundleV1`

Defined in: [candidate-execution/types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L296)

##### materializedTree?

> `readonly` `optional` **materializedTree?**: `string`

Defined in: [candidate-execution/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L297)

##### \[verifiedCandidateBrand\]

> `readonly` **\[verifiedCandidateBrand\]**: `true`

Defined in: [candidate-execution/types.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L298)

***

### CanonicalCandidateDocument

Defined in: [candidate-execution/types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L301)

#### Type Parameters

##### T

`T`

#### Properties

##### value

> `readonly` **value**: `T`

Defined in: [candidate-execution/types.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L302)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [candidate-execution/types.ts:304](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L304)

Canonical UTF-8 bytes of `value` with its top-level digest omitted.

##### digest

> `readonly` **digest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L305)

***

### PreparedAgentCandidateLaunch

Defined in: [candidate-execution/types.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L308)

#### Properties

##### executable

> **executable**: `string`

Defined in: [candidate-execution/types.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L309)

##### args

> **args**: readonly `string`[]

Defined in: [candidate-execution/types.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L311)

Complete fixed argv, including profile materializer flags but excluding task delivery.

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [candidate-execution/types.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L312)

##### flags

> **flags**: readonly `string`[]

Defined in: [candidate-execution/types.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L314)

Informational subset already present at the tail of `args`; executors must not append twice.

##### cwd

> **cwd**: `string`

Defined in: [candidate-execution/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L315)

***

### PreparedAgentCandidateInstruction

Defined in: [candidate-execution/types.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L318)

#### Properties

##### bytes

> **bytes**: `Uint8Array`

Defined in: [candidate-execution/types.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L319)

##### delivery

> **delivery**: `AgentCandidateInstructionDelivery`

Defined in: [candidate-execution/types.ts:320](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L320)

***

### PreparedAgentCandidateTrace

Defined in: [candidate-execution/types.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L323)

#### Properties

##### runId

> **runId**: `string`

Defined in: [candidate-execution/types.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L324)

##### tags

> **tags**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [candidate-execution/types.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L325)

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [candidate-execution/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L326)

***

### PreparedAgentCandidateExecution

Defined in: [candidate-execution/types.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L329)

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundleV1`

Defined in: [candidate-execution/types.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L330)

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/types.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L331)

##### roots

> `readonly` **roots**: `object`

Defined in: [candidate-execution/types.ts:332](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L332)

###### execution

> **execution**: `object`

###### execution.taskRoot

> **taskRoot**: `string`

###### execution.candidateRoot?

> `optional` **candidateRoot?**: `string`

###### staging

> **staging**: `object`

###### staging.taskRoot

> **taskRoot**: `string`

###### staging.candidateRoot?

> `optional` **candidateRoot?**: `string`

###### staging.profileRoot

> **profileRoot**: `string`

##### profilePlan

> `readonly` **profilePlan**: `object`

Defined in: [candidate-execution/types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L343)

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### executionPlan

> `readonly` **executionPlan**: `object`

Defined in: [candidate-execution/types.ts:348](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L348)

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceiptV1`\>

Defined in: [candidate-execution/types.ts:352](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L352)

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

Defined in: [candidate-execution/types.ts:353](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L353)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

Defined in: [candidate-execution/types.ts:354](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L354)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [candidate-execution/types.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L355)

##### knowledge?

> `readonly` `optional` **knowledge?**: `object`

Defined in: [candidate-execution/types.ts:356](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L356)

###### snapshotId

> **snapshotId**: `string`

###### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

###### manifest

> **manifest**: `Uint8Array`

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

Defined in: [candidate-execution/types.ts:361](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L361)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

Defined in: [candidate-execution/types.ts:362](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L362)

##### \[preparedCandidateBrand\]

> `readonly` **\[preparedCandidateBrand\]**: `true`

Defined in: [candidate-execution/types.ts:363](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L363)

***

### AgentCandidateProtectedRunCapture

Defined in: [candidate-execution/types.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L366)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [candidate-execution/types.ts:367](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L367)

##### termination

> **termination**: `AgentCandidateTermination`

Defined in: [candidate-execution/types.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L368)

***

### AgentCandidateExecutorTaskOutcomeCapture

Defined in: [candidate-execution/types.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L372)

Raw evaluator capture made only after the candidate process is dead.

#### Properties

##### resultTree

> **resultTree**: `string`

Defined in: [candidate-execution/types.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L374)

Claimed final tree. The runtime recomputes it independently from `gitDiff`.

##### afterState

> **afterState**: `AgentCandidateWorkspaceManifestMaterialV1`

Defined in: [candidate-execution/types.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L376)

Complete evaluator-captured workspace description after candidate execution.

##### archive

> **archive**: `Uint8Array`

Defined in: [candidate-execution/types.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L378)

Reproducible workspace archive corresponding to `afterState`.

##### gitDiff

> **gitDiff**: `Uint8Array`

Defined in: [candidate-execution/types.ts:380](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L380)

Exact binary patch from the signed task base to `afterState`.

***

### AgentCandidateExecutorMemoryCapture

Defined in: [candidate-execution/types.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L384)

Raw isolated-memory capture made only after access has been revoked.

#### Properties

##### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterialV1`

Defined in: [candidate-execution/types.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L385)

##### archive

> `readonly` **archive**: `Uint8Array`

Defined in: [candidate-execution/types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L386)

***

### AgentCandidateExecutorFinalCapture

Defined in: [candidate-execution/types.ts:390](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L390)

Idempotent executor result after process death and trace drain.

#### Properties

##### stopped

> `readonly` **stopped**: `true`

Defined in: [candidate-execution/types.ts:391](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L391)

##### taskOutcome?

> `readonly` `optional` **taskOutcome?**: [`AgentCandidateExecutorTaskOutcomeCapture`](#agentcandidateexecutortaskoutcomecapture)

Defined in: [candidate-execution/types.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L392)

##### memoryAfter?

> `readonly` `optional` **memoryAfter?**: [`AgentCandidateExecutorMemoryCapture`](#agentcandidateexecutormemorycapture)

Defined in: [candidate-execution/types.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L394)

Required only when the prepared candidate uses isolated task memory.

***

### VerifiedAgentCandidateTaskOutcome

Defined in: [candidate-execution/types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L398)

Branded task outcome that has survived independent patch and tree verification.

#### Properties

##### evidence

> `readonly` **evidence**: `AgentCandidateTaskOutcomeEvidence` & `object`

Defined in: [candidate-execution/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L399)

###### Type Declaration

###### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

##### patch

> `readonly` **patch**: `Uint8Array`

Defined in: [candidate-execution/types.ts:402](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L402)

##### \[verifiedTaskOutcomeBrand\]

> `readonly` **\[verifiedTaskOutcomeBrand\]**: `true`

Defined in: [candidate-execution/types.ts:403](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L403)

***

### AgentCandidateBenchmarkGraderPort

Defined in: [candidate-execution/types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L415)

Evaluator-owned executable grader, pinned by immutable implementation bytes.

`run` is an isolation boundary, not an arbitrary scoring callback. The
implementation admitted to that boundary is supplied by the runtime after
artifact verification. Implementations must derive every returned binding
digest from the bytes and task outcome they actually admitted, rather than
copying an expected digest from ambient configuration.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [candidate-execution/types.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L416)

##### version

> `readonly` **version**: `string`

Defined in: [candidate-execution/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L417)

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

Defined in: [candidate-execution/types.ts:418](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L418)

#### Methods

##### run()

> **run**(`input`): `Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

Defined in: [candidate-execution/types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L419)

###### Parameters

###### input

###### executionId

`string`

###### termination

`AgentCandidateTermination`

###### outcome

[`VerifiedAgentCandidateTaskOutcome`](#verifiedagentcandidatetaskoutcome)

###### implementation

\{ `byteLength`: `number`; `bytes`: `Uint8Array`; \}

Exact verified artifact bytes. Each read returns a detached copy.

###### implementation.byteLength

`number`

###### implementation.bytes

`Uint8Array`

###### signal

`AbortSignal`

Frozen result deadline; runners must stop work and side effects when aborted.

###### Returns

`Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

***

### AgentCandidateExecutorRequest

Defined in: [candidate-execution/types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L447)

One detached request passed to the trusted environment-specific executor.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L448)

##### inputs

> `readonly` **inputs**: `object`

Defined in: [candidate-execution/types.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L450)

Immutable bytes from which the executor creates fresh isolated workspaces.

###### task

> `readonly` **task**: [`AgentCandidateExecutorWorkspaceInput`](#agentcandidateexecutorworkspaceinput)

###### candidate?

> `readonly` `optional` **candidate?**: [`AgentCandidateExecutorWorkspaceInput`](#agentcandidateexecutorworkspaceinput)

###### profile

> `readonly` **profile**: `object`

###### profile.files

> `readonly` **files**: readonly [`AgentCandidateExecutorProfileFile`](#agentcandidateexecutorprofilefile)[]

##### roots

> `readonly` **roots**: `object`

Defined in: [candidate-execution/types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L457)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### profilePlan

> `readonly` **profilePlan**: `object`

Defined in: [candidate-execution/types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L458)

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### executionPlan

> `readonly` **executionPlan**: `object`

Defined in: [candidate-execution/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L459)

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceiptV1`\>

Defined in: [candidate-execution/types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L460)

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

Defined in: [candidate-execution/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L461)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

Defined in: [candidate-execution/types.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L462)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [candidate-execution/types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L463)

##### hardLimits

> `readonly` **hardLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"timeoutMs"`\>

Defined in: [candidate-execution/types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L465)

Mechanically enforced by the runtime plus executor process-death acknowledgement.

##### observedLimits

> `readonly` **observedLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"maxSteps"`\>

Defined in: [candidate-execution/types.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L467)

Validity bound checked against protected traces; generic black-box executors cannot preempt it.

##### knowledge?

> `readonly` `optional` **knowledge?**: `object`

Defined in: [candidate-execution/types.ts:468](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L468)

###### snapshotId

> **snapshotId**: `string`

###### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

###### manifest

> **manifest**: `Uint8Array`

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

Defined in: [candidate-execution/types.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L469)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

Defined in: [candidate-execution/types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L470)

***

### AgentCandidateExecutorPort

Defined in: [candidate-execution/types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L481)

Executes one prepared request inside an evaluator-owned isolation boundary.

`request.launch.env` is the complete allowlisted environment, including
protected model, memory, and trace bindings. Implementations must not merge
ambient host variables into it. The returned capture deliberately contains
no candidate-authored usage or score fields.

#### Methods

##### execute()

> **execute**(`request`, `context`): `Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

Defined in: [candidate-execution/types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L482)

###### Parameters

###### request

[`AgentCandidateExecutorRequest`](#agentcandidateexecutorrequest)

###### context

###### traceStore

`TraceStore`

###### signal

`AbortSignal`

Aborted by the runtime at the exact frozen wall-time deadline.

###### deadlineAtMs

`number`

Absolute epoch-millisecond deadline owned by the runtime.

###### Returns

`Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

##### stopAndCapture()

> **stopAndCapture**(`request`, `context`): `Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

Defined in: [candidate-execution/types.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L499)

Kill any process/container still associated with the request, drain trace
writes, and capture the final task workspace before teardown.
The runtime calls this on success, failure, and timeout before model settlement.
Implementations must be idempotent and concurrency-safe for this exact
execution/plan pair because a fresh worker may repeat crash recovery.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### traceStore

`TraceStore`

###### reason

`"completed"` \| `"failed"` \| `"timeout"`

###### signal

`AbortSignal`

Aborted at the frozen execution deadline or evaluator cleanup deadline.

###### deadlineAtMs

`number`

Absolute execution deadline; a later stop acknowledgement cannot produce success.

###### Returns

`Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

***

### AgentCandidateExecutorStopRequest

Defined in: [candidate-execution/types.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L513)

Opaque process identity used for termination without re-exposing launch credentials.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [candidate-execution/types.ts:514](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L514)

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

Defined in: [candidate-execution/types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L515)

***

### AgentCandidateExecutorWorkspaceInput

Defined in: [candidate-execution/types.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L518)

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [candidate-execution/types.ts:519](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L519)

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

Defined in: [candidate-execution/types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L520)

***

### AgentCandidateExecutorWorkspaceFile

Defined in: [candidate-execution/types.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L523)

#### Properties

##### path

> `readonly` **path**: `string`

Defined in: [candidate-execution/types.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L524)

##### mode

> `readonly` **mode**: `420` \| `493`

Defined in: [candidate-execution/types.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L525)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [candidate-execution/types.ts:526](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L526)

***

### AgentCandidateExecutorProfileFile

Defined in: [candidate-execution/types.ts:529](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L529)

#### Properties

##### path

> `readonly` **path**: `string`

Defined in: [candidate-execution/types.ts:530](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L530)

##### mode

> `readonly` **mode**: `420` \| `493`

Defined in: [candidate-execution/types.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L531)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [candidate-execution/types.ts:532](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L532)

***

### AgentCandidateWorkspaceArchiveLimits

Defined in: [candidate-execution/workspace-archive.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L47)

#### Properties

##### maxArchiveBytes

> **maxArchiveBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L48)

##### maxEmbeddedArtifactBytes

> **maxEmbeddedArtifactBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L49)

##### maxFiles

> **maxFiles**: `number`

Defined in: [candidate-execution/workspace-archive.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L50)

##### maxFileBytes

> **maxFileBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L51)

##### maxTotalFileBytes

> **maxTotalFileBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L52)

##### maxPathBytes

> **maxPathBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L53)

##### maxRepositoryBundleBytes

> **maxRepositoryBundleBytes**: `number`

Defined in: [candidate-execution/workspace-archive.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L54)

***

### CaptureAgentCandidateWorkspaceOptions

Defined in: [candidate-execution/workspace-archive.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L93)

#### Properties

##### includeRepository?

> `optional` **includeRepository?**: `boolean`

Defined in: [candidate-execution/workspace-archive.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L95)

Include Git HEAD so task preparation can prove its exact commit and tree.

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

Defined in: [candidate-execution/workspace-archive.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L96)

##### artifactPersistence?

> `optional` **artifactPersistence?**: `object`

Defined in: [candidate-execution/workspace-archive.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L98)

Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded.

###### executionId

> **executionId**: `string`

###### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

###### signal?

> `optional` **signal?**: `AbortSignal`

***

### CreateAgentCandidateWorkspacePortOptions

Defined in: [candidate-execution/workspace-archive.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L105)

#### Properties

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

Defined in: [candidate-execution/workspace-archive.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L106)

***

### CapturedAgentCandidateWorkspace

Defined in: [candidate-execution/workspace-archive.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L109)

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [candidate-execution/workspace-archive.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L110)

##### archive

> `readonly` **archive**: `Uint8Array`

Defined in: [candidate-execution/workspace-archive.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L112)

Caller-owned bytes accepted by createAgentCandidateWorkspacePort.

***

### CircuitBreakerConfig

Defined in: [conversation/call-policy.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L24)

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

#### Properties

##### failuresToOpen

> **failuresToOpen**: `number`

Defined in: [conversation/call-policy.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L25)

##### cooldownMs

> **cooldownMs**: `number`

Defined in: [conversation/call-policy.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L26)

***

### BackendCallPolicy

Defined in: [conversation/call-policy.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L29)

#### Properties

##### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Defined in: [conversation/call-policy.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L31)

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [conversation/call-policy.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L33)

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

##### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](#retrybackoff)

Defined in: [conversation/call-policy.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L35)

Backoff between attempts. Default 250ms with jitter.

##### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [conversation/call-policy.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L37)

Custom retry classifier. Defaults to [defaultIsRetryable](#defaultisretryable).

##### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](#circuitbreakerconfig)

Defined in: [conversation/call-policy.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L39)

Circuit breaker that opens after N consecutive failures per participant.

***

### SqlAdapter

Defined in: [conversation/journal-sql.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L49)

Minimal SQL driver shape. Implementations forward to whichever client the
deployment already uses; agent-runtime takes no opinion on which.

Parameter placeholders MUST be `?` (positional). All adapters listed in the
file header accept this convention.

#### Methods

##### exec()

> **exec**(`sql`, `params?`): `Promise`\<\{ `rowsAffected`: `number`; \}\>

Defined in: [conversation/journal-sql.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L51)

Execute a write statement (INSERT/UPDATE/DELETE/DDL).

###### Parameters

###### sql

`string`

###### params?

readonly `unknown`[]

###### Returns

`Promise`\<\{ `rowsAffected`: `number`; \}\>

##### query()

> **query**\<`TRow`\>(`sql`, `params?`): `Promise`\<`TRow`[]\>

Defined in: [conversation/journal-sql.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L53)

Execute a read statement (SELECT). Returns rows as plain objects.

###### Type Parameters

###### TRow

`TRow` = `Record`\<`string`, `unknown`\>

###### Parameters

###### sql

`string`

###### params?

readonly `unknown`[]

###### Returns

`Promise`\<`TRow`[]\>

***

### D1DatabaseLike

Defined in: [conversation/journal-sql.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L84)

Structural type matching the surface of `D1Database` we depend on, so the
SDK never imports `@cloudflare/workers-types`. Consumers pass their real
`D1Database` from `env.DB` and TS structural compatibility lines it up.

#### Methods

##### prepare()

> **prepare**(`sql`): [`D1StmtLike`](#d1stmtlike)

Defined in: [conversation/journal-sql.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L85)

###### Parameters

###### sql

`string`

###### Returns

[`D1StmtLike`](#d1stmtlike)

***

### D1StmtLike

Defined in: [conversation/journal-sql.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L87)

#### Methods

##### bind()

> **bind**(...`params`): [`D1StmtLike`](#d1stmtlike)

Defined in: [conversation/journal-sql.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L88)

###### Parameters

###### params

...`unknown`[]

###### Returns

[`D1StmtLike`](#d1stmtlike)

##### run()

> **run**(): `Promise`\<`unknown`\>

Defined in: [conversation/journal-sql.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L89)

###### Returns

`Promise`\<`unknown`\>

##### all()

> **all**\<`TRow`\>(): `Promise`\<\{ `results?`: `TRow`[]; \}\>

Defined in: [conversation/journal-sql.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L90)

###### Type Parameters

###### TRow

`TRow` = `unknown`

###### Returns

`Promise`\<\{ `results?`: `TRow`[]; \}\>

***

### ConversationJournalEntry

Defined in: [conversation/journal.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L20)

#### Properties

##### runId

> **runId**: `string`

Defined in: [conversation/journal.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L21)

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/journal.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L22)

##### halted?

> `optional` **halted?**: [`HaltReason`](#haltreason)

Defined in: [conversation/journal.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L24)

Set when the run reaches a terminal state.

##### endedAt?

> `optional` **endedAt?**: `string`

Defined in: [conversation/journal.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L25)

##### turns

> **turns**: [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/journal.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L26)

***

### ConversationJournal

Defined in: [conversation/journal.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L29)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L36)

Load any prior state for `runId`. Returns `undefined` for a fresh run.
Implementations MUST NOT mutate the returned object — the runner clones
before continuing — but the runtime treats absence and emptiness
identically, so a journal with zero turns is equivalent to "fresh."

###### Parameters

###### runId

`string`

###### Returns

`Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

##### beginRun()

> **beginRun**(`runId`, `startedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L43)

Initialise journal state for a fresh run. Called once per run, before any
`appendTurn`. Idempotent: calling with an existing runId is a no-op if
the entry already exists with the same `startedAt`.

###### Parameters

###### runId

`string`

###### startedAt

`string`

###### Returns

`Promise`\<`void`\>

##### appendTurn()

> **appendTurn**(`runId`, `turn`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L50)

Append a committed turn. The runner only calls this AFTER the turn's
backend stream completed and the credit total has been updated, so an
appended turn is observed-committed and never speculative.

###### Parameters

###### runId

`string`

###### turn

[`ConversationTurn`](#conversationturn)

###### Returns

`Promise`\<`void`\>

##### recordHalt()

> **recordHalt**(`runId`, `halt`, `endedAt`): `Promise`\<`void`\>

Defined in: [conversation/journal.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L56)

Record the run's terminal halt reason + end time. Once called, the run
is observed-final; subsequent `loadRun` returns the same halt.

###### Parameters

###### runId

`string`

###### halt

[`HaltReason`](#haltreason)

###### endedAt

`string`

###### Returns

`Promise`\<`void`\>

***

### RunPersonaConversationOptions

Defined in: [conversation/run-persona.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L36)

#### Properties

##### worker

> **worker**: `AgentProfile`

Defined in: [conversation/run-persona.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L38)

The agent under test. Metered; its rendered prompt leads its turns.

##### persona

> **persona**: [`PersonaDriver`](#personadriver)

Defined in: [conversation/run-persona.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L40)

The simulated user driving the dialogue.

##### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/run-persona.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L43)

Turn an `AgentProfile` into a runnable backend (router / sandbox / fake).
 Applied to the worker and to a `profile`-kind persona.

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

##### systemPromptOf

> **systemPromptOf**: (`profile`) => `string`

Defined in: [conversation/run-persona.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L45)

Render a profile's system prompt — prepended to that profile's messages.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string`

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [conversation/run-persona.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L48)

Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
 (worker answers each user turn). REQUIRED for a `profile` persona.

##### seed?

> `optional` **seed?**: `string`

Defined in: [conversation/run-persona.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L50)

Kickoff message routed to the first speaker (the persona). Default 'Begin.'

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [conversation/run-persona.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L53)

Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
 hard ceiling; this is the early stop (the persona declares the goal met / unreachable).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/run-persona.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L54)

##### workerName?

> `optional` **workerName?**: `string`

Defined in: [conversation/run-persona.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L56)

Worker participant / transcript speaker label. Default 'agent'.

***

### PersonaConversationResult

Defined in: [conversation/run-persona.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L59)

#### Properties

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/run-persona.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L60)

##### turns

> **turns**: `number`

Defined in: [conversation/run-persona.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L61)

##### halted

> **halted**: [`HaltReason`](#haltreason)

Defined in: [conversation/run-persona.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L62)

##### costUsd

> **costUsd**: `number`

Defined in: [conversation/run-persona.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L64)

Worker-only spend (the side under test).

##### tokensIn

> **tokensIn**: `number`

Defined in: [conversation/run-persona.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L65)

##### tokensOut

> **tokensOut**: `number`

Defined in: [conversation/run-persona.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L66)

***

### RunPersonaConfig

Defined in: [conversation/run-persona.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L198)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/run-persona.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L200)

Turn an `AgentProfile` into a runnable backend (router / sandbox / fake).

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

##### systemPromptOf

> **systemPromptOf**: (`profile`) => `string`

Defined in: [conversation/run-persona.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L202)

Render a profile's system prompt.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string`

##### personaOf

> **personaOf**: (`scenario`) => [`PersonaDriver`](#personadriver)

Defined in: [conversation/run-persona.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L204)

The persona driving each scenario — a driver profile or scripted turns.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`PersonaDriver`](#personadriver)

##### artifactOf

> **artifactOf**: (`transcript`, `scenario`) => `TArtifact`

Defined in: [conversation/run-persona.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L206)

Build the scored artifact from the finished transcript.

###### Parameters

###### transcript

[`ConversationTurn`](#conversationturn)[]

###### scenario

`TScenario`

###### Returns

`TArtifact`

##### maxTurns?

> `optional` **maxTurns?**: (`scenario`) => `number`

Defined in: [conversation/run-persona.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L208)

Speaker-turn cap (required when a persona is profile-driven).

###### Parameters

###### scenario

`TScenario`

###### Returns

`number`

##### seed?

> `optional` **seed?**: (`scenario`) => `string`

Defined in: [conversation/run-persona.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L209)

###### Parameters

###### scenario

`TScenario`

###### Returns

`string`

##### workerName?

> `optional` **workerName?**: `string`

Defined in: [conversation/run-persona.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L210)

***

### ConversationParticipant

Defined in: [conversation/types.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L21)

#### Stable

#### Properties

##### name

> **name**: `string`

Defined in: [conversation/types.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L26)

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L33)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so any
registered backend (iterable, sandbox, OpenAI-compatible) works without
adaptation.

##### label?

> `optional` **label?**: `string`

Defined in: [conversation/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L38)

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

##### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [conversation/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L44)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

##### authSource?

> `optional` **authSource?**: [`AuthSource`](#authsource-1)

Defined in: [conversation/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L64)

Who pays for THIS participant's outbound calls?

- `'forward-user'` (default) — propagate the caller's
  `X-Tangle-Forwarded-Authorization` so the downstream gateway bills the
  original user. Right for pass-through agents that aggregate/route
  without taking economic risk.
- `'agent-owned'` — DO NOT forward the user's auth; the participant's
  backend uses its own credentials (typically a sk-tan-AGENT or x402
  wallet baked into the backend at construction). Downstream charges
  land on the agent, not the user. Right for resold-bundle agents that
  take margin between their inbound price and their sub-agent costs.
- `(state) => AuthSource` — per-turn / per-condition decision, e.g. base
  sub-services are agent-owned but premium add-ons forward the user.

The agent's own credentials live on the backend (set at construction
time, e.g. `createOpenAICompatibleBackend({ apiKey })`); this field is
purely about *whether to also forward the user's identity downstream*.

***

### ConversationDriveState

Defined in: [conversation/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L77)

#### Stable

#### Extended by

- [`HaltContext`](#haltcontext)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

##### turnIndex

> **turnIndex**: `number`

Defined in: [conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L80)

***

### HaltContext

Defined in: [conversation/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L84)

#### Stable

#### Extends

- [`ConversationDriveState`](#conversationdrivestate)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`transcript`](#transcript-1)

##### turnIndex

> **turnIndex**: `number`

Defined in: [conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`turnIndex`](#turnindex)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L80)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`spentCreditsCents`](#spentcreditscents)

##### lastTurn

> **lastTurn**: [`ConversationTurn`](#conversationturn)

Defined in: [conversation/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L85)

***

### HaltSignal

Defined in: [conversation/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L89)

#### Stable

#### Properties

##### halted

> **halted**: `true`

Defined in: [conversation/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L90)

##### reason

> **reason**: `string`

Defined in: [conversation/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L91)

***

### ConversationPolicy

Defined in: [conversation/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L108)

#### Stable

#### Properties

##### maxTurns

> **maxTurns**: `number`

Defined in: [conversation/types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L110)

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

##### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Defined in: [conversation/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L117)

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

##### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](#turnorder)

Defined in: [conversation/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L122)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [conversation/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L127)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

##### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [conversation/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L133)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.

***

### ConversationTurn

Defined in: [conversation/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L137)

#### Stable

#### Properties

##### index

> **index**: `number`

Defined in: [conversation/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L138)

##### speaker

> **speaker**: `string`

Defined in: [conversation/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L139)

##### turnId

> **turnId**: `string`

Defined in: [conversation/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L145)

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

##### text

> **text**: `string`

Defined in: [conversation/types.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L146)

##### usage?

> `optional` **usage?**: `object`

Defined in: [conversation/types.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L152)

Aggregated backend usage for this turn alone. Populated from any
`llm_call` stream events the backend emitted; `undefined` when the
backend reports no usage.

###### tokensIn?

> `optional` **tokensIn?**: `number`

###### tokensOut?

> `optional` **tokensOut?**: `number`

###### costUsd?

> `optional` **costUsd?**: `number`

###### latencyMs?

> `optional` **latencyMs?**: `number`

###### model?

> `optional` **model?**: `string`

##### attempts

> **attempts**: `number`

Defined in: [conversation/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L164)

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L165)

##### endedAt

> **endedAt**: `string`

Defined in: [conversation/types.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L166)

***

### Conversation

Defined in: [conversation/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L170)

#### Stable

#### Properties

##### participants

> **participants**: readonly [`ConversationParticipant`](#conversationparticipant)[]

Defined in: [conversation/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L171)

##### policy

> **policy**: [`ConversationPolicy`](#conversationpolicy)

Defined in: [conversation/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L172)

***

### RunConversationOptions

Defined in: [conversation/types.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L176)

#### Stable

#### Properties

##### seed

> **seed**: `string`

Defined in: [conversation/types.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L178)

First message kicking off the conversation. Routes to the first speaker.

##### runId?

> `optional` **runId?**: `string`

Defined in: [conversation/types.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L185)

Optional run identifier for cross-participant trace correlation. Auto-
generated when omitted. Reusing a runId against the same `journal`
resumes the prior run — the runner replays the persisted transcript and
continues from the first un-recorded turn.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L187)

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [conversation/types.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L194)

Event sink for per-turn micro-events. Distinct from the result transcript:
the sink fires for every text-delta, every turn-start/end, and the
conversation-start/end markers. Used to drive SSE / dashboard updates
without waiting for the conversation to finish.

###### Parameters

###### event

[`ConversationStreamEvent`](#conversationstreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### journal?

> `optional` **journal?**: [`ConversationJournal`](#conversationjournal)

Defined in: [conversation/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L201)

Optional durable transcript. When set, the runner persists every
committed turn before yielding `turn_end`. Reusing the same `runId`
against the same journal resumes from the last committed turn — so a
driver process crash mid-run loses zero acknowledged turns.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [conversation/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L208)

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

##### inboundDepth?

> `optional` **inboundDepth?**: `number`

Defined in: [conversation/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L214)

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_DEPTH`. Default 0 (origin caller).

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [conversation/types.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L221)

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.

***

### ConversationResult

Defined in: [conversation/types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L225)

#### Stable

#### Properties

##### runId

> **runId**: `string`

Defined in: [conversation/types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L226)

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L227)

##### turns

> **turns**: `number`

Defined in: [conversation/types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L228)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L229)

##### halted

> **halted**: [`HaltReason`](#haltreason)

Defined in: [conversation/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L230)

##### durationMs

> **durationMs**: `number`

Defined in: [conversation/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L231)

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L232)

##### endedAt

> **endedAt**: `string`

Defined in: [conversation/types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L233)

***

### ChatStreamEvent

Defined in: [durable/chat-engine.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L28)

The NDJSON line protocol every product chat client already speaks.

#### Properties

##### type

> **type**: `string`

Defined in: [durable/chat-engine.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L29)

##### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

Defined in: [durable/chat-engine.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L30)

***

### ChatTurnIdentity

Defined in: [durable/chat-engine.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L35)

Identity of a chat turn. `tenantId` is the workspace id for workspace-
 scoped products and the user id for session-scoped products.

#### Properties

##### tenantId

> **tenantId**: `string`

Defined in: [durable/chat-engine.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L36)

##### sessionId

> **sessionId**: `string`

Defined in: [durable/chat-engine.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L38)

Thread / session id.

##### userId

> **userId**: `string`

Defined in: [durable/chat-engine.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L39)

##### turnIndex

> **turnIndex**: `number`

Defined in: [durable/chat-engine.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L41)

Monotonic 0-based turn index within the session.

***

### ChatTurnProducer

Defined in: [durable/chat-engine.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L45)

The live side of a turn — what the product's `produce` hook returns.

#### Type Parameters

##### TEvent

`TEvent` *extends* [`ChatStreamEvent`](#chatstreamevent) = [`ChatStreamEvent`](#chatstreamevent)

#### Properties

##### stream

> **stream**: `AsyncGenerator`\<`TEvent`, `void`, `unknown`\>

Defined in: [durable/chat-engine.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L47)

The turn's event stream. Forwarded verbatim to the caller.

#### Methods

##### finalText()

> **finalText**(): `string`

Defined in: [durable/chat-engine.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L49)

The turn's final assistant text. Read once, after `stream` drains.

###### Returns

`string`

***

### ChatTurnHooks

Defined in: [durable/chat-engine.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L52)

Turn-lifecycle helpers for `@tangle-network/agent-runtime`.

Execution state — long-running execution, reconnect, replay, dedup —
lives in the substrate (`@tangle-network/sandbox` + orchestrator).
agent-runtime owns:

  - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
    `session.run.*` envelope, persist / post-process / trace-flush
    hook ordering.
  - `deriveExecutionId` — convention helper for the stable id products
    persist so a retry of the same turn lands on the same execution.

#### Methods

##### produce()

> **produce**(): [`ChatTurnProducer`](#chatturnproducer)

Defined in: [durable/chat-engine.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L55)

Build the backend stream. The engine forwards events verbatim and
 reads `finalText()` once the stream drains.

###### Returns

[`ChatTurnProducer`](#chatturnproducer)

##### persistAssistantMessage()

> **persistAssistantMessage**(`input`): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L58)

Persist the assistant message to the product's own store. Called
 once, after drain, with the assembled (transform-applied) text.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onTurnComplete()?

> `optional` **onTurnComplete**(`input`): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L62)

Optional post-processing (proposals, citations, credit metering …).
 Errors are swallowed + logged — post-process must never fail a turn
 that already streamed successfully.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onEvent()?

> `optional` **onEvent**(`event`): `void` \| `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L66)

Optional per-event side channel (e.g. DO broadcast). Runs for every
 emitted event, lifecycle envelope included. Errors swallowed — a
 broadcast failure must not break the chat stream.

###### Parameters

###### event

[`ChatStreamEvent`](#chatstreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### transformFinalText()?

> `optional` **transformFinalText**(`text`): `string` \| `Promise`\<`string`\>

Defined in: [durable/chat-engine.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L70)

Optional pre-persist transform of the final text (e.g. PII
 redaction). Affects only what is persisted; the live stream is
 never altered.

###### Parameters

###### text

`string`

###### Returns

`string` \| `Promise`\<`string`\>

##### traceFlush()?

> `optional` **traceFlush**(): `Promise`\<`void`\>

Defined in: [durable/chat-engine.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L73)

Optional trace flush — resolves when OTLP export completes. Handed
 to `waitUntil` so the worker isolate stays alive for the POST.

###### Returns

`Promise`\<`void`\>

***

### RunChatTurnInput

Defined in: [durable/chat-engine.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L76)

Turn-lifecycle helpers for `@tangle-network/agent-runtime`.

Execution state — long-running execution, reconnect, replay, dedup —
lives in the substrate (`@tangle-network/sandbox` + orchestrator).
agent-runtime owns:

  - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
    `session.run.*` envelope, persist / post-process / trace-flush
    hook ordering.
  - `deriveExecutionId` — convention helper for the stable id products
    persist so a retry of the same turn lands on the same execution.

#### Properties

##### identity

> **identity**: [`ChatTurnIdentity`](#chatturnidentity)

Defined in: [durable/chat-engine.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L77)

##### hooks

> **hooks**: [`ChatTurnHooks`](#chatturnhooks)

Defined in: [durable/chat-engine.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L78)

##### waitUntil?

> `optional` **waitUntil?**: (`p`) => `void`

Defined in: [durable/chat-engine.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L81)

Worker liveness hook. When omitted, trace flush is awaited inline
 before the stream closes.

###### Parameters

###### p

`Promise`\<`unknown`\>

###### Returns

`void`

##### log?

> `optional` **log?**: (`message`, `meta?`) => `void`

Defined in: [durable/chat-engine.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L84)

Structured logger for swallowed hook errors. Defaults to
 `console.error` so failures surface without product wiring.

###### Parameters

###### message

`string`

###### meta?

`Record`\<`string`, `unknown`\>

###### Returns

`void`

***

### ChatTurnResult

Defined in: [durable/chat-engine.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L87)

Turn-lifecycle helpers for `@tangle-network/agent-runtime`.

Execution state — long-running execution, reconnect, replay, dedup —
lives in the substrate (`@tangle-network/sandbox` + orchestrator).
agent-runtime owns:

  - `handleChatTurn` — framework-neutral turn lifecycle: NDJSON framing,
    `session.run.*` envelope, persist / post-process / trace-flush
    hook ordering.
  - `deriveExecutionId` — convention helper for the stable id products
    persist so a retry of the same turn lands on the same execution.

#### Properties

##### body

> **body**: `ReadableStream`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [durable/chat-engine.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L89)

NDJSON body — return this as the platform `Response` body.

##### contentType

> **contentType**: `"application/x-ndjson"`

Defined in: [durable/chat-engine.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L91)

Content type for the response.

***

### VerifyResult

Defined in: [improvement/agentic-generator.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L48)

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [improvement/agentic-generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L49)

##### feedback?

> `optional` **feedback?**: `string`

Defined in: [improvement/agentic-generator.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L50)

***

### AgenticGeneratorOptions

Defined in: [improvement/agentic-generator.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L58)

`@tangle-network/agent-runtime` improvement — the CODE-surface proposer for
agent-eval's improvement loop.

The public entry point is `improve()`, a profile-aware facade over agent-eval's
`selfImprove`. This module also supplies the runtime-specific code candidate
producer, which mutates an isolated git worktree via a pluggable
`CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

#### Properties

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [improvement/agentic-generator.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L60)

Local coding harness to run in the worktree. Default `claude`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/agentic-generator.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L62)

Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

##### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [improvement/agentic-generator.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L65)

Build the harness task prompt from the report + findings. Override for
 domain phrasing; the default turns findings into a concrete coder task.

###### Parameters

###### args

###### report

`unknown`

###### findings

`AnalystFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Defined in: [improvement/agentic-generator.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L71)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
 the first dirty shot is the candidate. See `commandVerifier`.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [improvement/agentic-generator.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L73)

Test seam — inject the harness runner (defaults to `runLocalHarness`).

**`Experimental`**

Spawn a local coding harness CLI as a subprocess + collect its output.

NOT responsible for parsing the harness's output or extracting a diff —
the in-process executor's `streamPrompt` orchestrates `git diff` against
the worktree after this resolves. This function is intentionally narrow:
spawn, wait, capture, return.

Fails loud — throws when:
  - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
  - the harness binary is not on PATH (ENOENT)

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - the subprocess is aborted / timed out (`result.killedBySignal` /
    `result.timedOut` carries the reason)

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Defined in: [improvement/agentic-generator.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L75)

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### ImproveSkillsOptions

Defined in: [improvement/improve.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L137)

#### Properties

##### document

> **document**: `string`

Defined in: [improvement/improve.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L139)

The skill document's current text — the baseline `skillOptProposer` patches.

##### writeBack?

> `optional` **writeBack?**: (`winnerDocument`) => `void` \| `Promise`\<`void`\>

Defined in: [improvement/improve.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L143)

Persist the shipped winner document (write the file the profile ref points at).
 Called only on a ship verdict. When omitted, the winner is still returned in
 `result.raw.winner.surface` for the caller to materialize.

###### Parameters

###### winnerDocument

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### ImproveMemoryOptions

Defined in: [improvement/improve.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L146)

#### Properties

##### document

> **document**: `string`

Defined in: [improvement/improve.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L148)

Current durable memory text used as the measured baseline.

##### writeBack?

> `optional` **writeBack?**: (`winnerDocument`) => `void` \| `Promise`\<`void`\>

Defined in: [improvement/improve.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L150)

Persist the promoted memory document. Never called on hold or error.

###### Parameters

###### winnerDocument

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### ImproveCodeOptions

Defined in: [improvement/improve.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L153)

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [improvement/improve.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L155)

Repo root candidate worktrees fork from.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [improvement/improve.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L157)

Base ref candidates fork from. Default `main`.

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Defined in: [improvement/improve.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L159)

Directory worktrees are created under. Default `<repoRoot>/.worktrees`.

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [improvement/improve.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L161)

Coding harness the agentic generator runs in each worktree. Default `claude`.

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Defined in: [improvement/improve.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L164)

Verify a candidate worktree before it becomes a measurable surface; failures
 feed the next shot (see `agenticGenerator.verify` / `commandVerifier`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/improve.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L166)

Per-shot wall-clock timeout for the harness (ms).

##### generator?

> `optional` **generator?**: [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/improve.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L169)

Byte-producer override — the test seam and the escape hatch for custom
 candidate production. When set, `harness`/`verify`/`timeoutMs` are unused.

***

### ImproveResult

Defined in: [improvement/improve.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L172)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> **profile**: `AgentProfile`

Defined in: [improvement/improve.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L175)

The profile after improvement: the winner surface applied back into the
 matching field when the gate shipped, else the input profile unchanged.

##### shipped

> **shipped**: `boolean`

Defined in: [improvement/improve.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L177)

True when `gateDecision === 'ship'`.

##### lift

> **lift**: `number`

Defined in: [improvement/improve.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L179)

Held-out lift (`winner − baseline` composite).

##### gateDecision

> **gateDecision**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [improvement/improve.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L181)

The five-valued gate verdict from `selfImprove`.

##### raw

> **raw**: `SelfImproveResult`\<`TScenario`, `TArtifact`\>

Defined in: [improvement/improve.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L183)

Full `selfImprove` result for advanced inspection.

***

### CandidateGenerator

Defined in: [improvement/improvement-driver.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L37)

The byte-producing seam — the ONE thing that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

Defined in: [improvement/improvement-driver.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L38)

##### proposesWithoutFindings?

> `optional` **proposesWithoutFindings?**: `boolean`

Defined in: [improvement/improvement-driver.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L49)

Whether this generator can produce a candidate from an EMPTY findings set
 and no phase-2 report — i.e. it draws its change signal from the repo and
 the raw-trace filesystem context on disk, not only from pre-summarized
 findings. An agentic coder (`agenticGenerator`) sets this: the seed repo +
 raw traces ARE the signal, so it must still run the full `populationSize`
 when the distiller yielded nothing (this is the meta-harness contract — the
 agent diagnoses from the raw traces itself). A patch-applier
 (`reflectiveGenerator`) leaves it unset — with no findings there is no
 patch to draft, so the driver short-circuits rather than spin up worktrees
 for a guaranteed no-op. Default `false`.

#### Methods

##### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

Defined in: [improvement/improvement-driver.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L50)

###### Parameters

###### args

###### worktreePath

`string`

The candidate worktree — a fresh checkout of baseRef. Write changes here.

###### report

`unknown`

Phase-2 research report (analyst findings + diff), opaque.

###### findings

`AnalystFinding`[]

Findings resolved from the report or the loop context.

###### dataset?

`LabeledScenarioStore`

Handle to all captured data, to ground the change.

###### maxShots

`number`

DEPTH: max iterations the generator may take (agentic uses this; the
 reflective generator ignores it).

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

***

### ImprovementDriverOptions

Defined in: [improvement/improvement-driver.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L66)

#### Properties

##### worktree

> **worktree**: `WorktreeAdapter`

Defined in: [improvement/improvement-driver.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L67)

##### generator

> **generator**: [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/improvement-driver.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L68)

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [improvement/improvement-driver.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L70)

Base ref candidate worktrees fork from. Default `main`.

***

### ManagedImprovementDriver

Defined in: [improvement/improvement-driver.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L73)

#### Extends

- `SurfaceProposer`\<`AnalystFinding`\>

#### Methods

##### cleanup()

> **cleanup**(`retainWorktreeRefs?`): `Promise`\<`void`\>

Defined in: [improvement/improvement-driver.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L75)

Remove every finalized candidate except explicitly retained winners.

###### Parameters

###### retainWorktreeRefs?

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### McpServeSpec

Defined in: [improvement/mcp-serve-verifier.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L24)

#### Properties

##### command

> **command**: `string`

Defined in: [improvement/mcp-serve-verifier.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L26)

Command that starts the built MCP server in the worktree (stdio transport).

##### args?

> `optional` **args?**: `string`[]

Defined in: [improvement/mcp-serve-verifier.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L27)

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [improvement/mcp-serve-verifier.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L29)

Extra env for the server process (merged over `process.env`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L31)

Handshake timeout (ms). Default 30s.

##### minTools?

> `optional` **minTools?**: `number`

Defined in: [improvement/mcp-serve-verifier.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L33)

Minimum tools the server must expose to pass. Default 1.

***

### AgentProfileDiffProposal

Defined in: [improvement/profile-diff-proposer.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L20)

#### Properties

##### diff

> **diff**: `AgentProfileDiff`

Defined in: [improvement/profile-diff-proposer.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L21)

##### label?

> `optional` **label?**: `string`

Defined in: [improvement/profile-diff-proposer.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L22)

##### rationale?

> `optional` **rationale?**: `string`

Defined in: [improvement/profile-diff-proposer.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L23)

***

### ProfileDiffProposerOptions

Defined in: [improvement/profile-diff-proposer.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L30)

#### Type Parameters

##### TFindings

`TFindings` = `unknown`

#### Methods

##### proposeDiffs()

> **proposeDiffs**(`context`): readonly [`AgentProfileDiffProposal`](#agentprofilediffproposal)[] \| `Promise`\<readonly [`AgentProfileDiffProposal`](#agentprofilediffproposal)[]\>

Defined in: [improvement/profile-diff-proposer.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L31)

###### Parameters

###### context

[`ProfileDiffProposerContext`](#profilediffproposercontext)\<`TFindings`\>

###### Returns

readonly [`AgentProfileDiffProposal`](#agentprofilediffproposal)[] \| `Promise`\<readonly [`AgentProfileDiffProposal`](#agentprofilediffproposal)[]\>

***

### RawTraceDistillerOptions

Defined in: [improvement/raw-trace-distiller.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L44)

#### Properties

##### runDir?

> `optional` **runDir?**: `string`

Defined in: [improvement/raw-trace-distiller.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L49)

Anchor the emitted paths at this run root instead of the generation `runDir`
 the loop passes in. Normally unset — each call points at that generation's
 own directory (`input.runDir`). Pass an absolute path when you construct the
 producer ahead of the loop and want a fixed anchor (e.g. a test fixture).

##### maxCandidates?

> `optional` **maxCandidates?**: `number`

Defined in: [improvement/raw-trace-distiller.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L51)

Max candidates to surface trace paths for, worst-scoring first. Default 12.

##### maxCellsPerCandidate?

> `optional` **maxCellsPerCandidate?**: `number`

Defined in: [improvement/raw-trace-distiller.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L54)

Max failing cells to enumerate per candidate before collapsing the rest into
 an "ls the candidate dir" pointer. Default 8.

##### maxFilesPerCell?

> `optional` **maxFilesPerCell?**: `number`

Defined in: [improvement/raw-trace-distiller.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L57)

Max concrete file paths to list per cell (the agent can always `ls` the dir
 for the rest). Default 24.

##### fallbackFindings?

> `optional` **fallbackFindings?**: `unknown`[]

Defined in: [improvement/raw-trace-distiller.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L61)

Findings to fall back to when the generation had NO failing cells, so a
 clean round never wipes the proposer's steering context. Mirrors the default
 distiller's static-seed fallback. Default: a single instruction finding.

***

### ReflectiveGeneratorOptions

Defined in: [improvement/reflective-generator.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L21)

#### Properties

##### improvementAdapter

> **improvementAdapter**: [`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

Defined in: [improvement/reflective-generator.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L22)

***

### RunKnowledgeImprovementJobOptions

Defined in: [knowledge/improvement-job.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L21)

#### Extends

- `Omit`\<`KnowledgeImprovementOptions`, `"updateKnowledge"`\>

#### Properties

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [knowledge/improvement-job.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L23)

##### readinessCheck?

> `optional` **readinessCheck?**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [knowledge/improvement-job.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L24)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [knowledge/improvement-job.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L25)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Defined in: [knowledge/improvement-job.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L26)

##### harness?

> `optional` **harness?**: `string`

Defined in: [knowledge/improvement-job.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L27)

##### supervisorModel?

> `optional` **supervisorModel?**: `string`

Defined in: [knowledge/improvement-job.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L28)

##### supervisorSystemPrompt?

> `optional` **supervisorSystemPrompt?**: `string`

Defined in: [knowledge/improvement-job.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L29)

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"backend"` \| `"budget"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

Defined in: [knowledge/improvement-job.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L30)

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [knowledge/improvement-job.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L36)

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

Defined in: [knowledge/improvement-job.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L37)

###### Parameters

###### profile

[`SupervisorProfile`](runtime.md#supervisorprofile)

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

##### onMeasurement?

> `optional` **onMeasurement?**: (`measurement`) => `void` \| `Promise`\<`void`\>

Defined in: [knowledge/improvement-job.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L42)

###### Parameters

###### measurement

[`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

###### Returns

`void` \| `Promise`\<`void`\>

***

### KnowledgeImprovementJobMeasurement

Defined in: [knowledge/improvement-job.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L45)

#### Properties

##### startedAt

> **startedAt**: `string`

Defined in: [knowledge/improvement-job.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L46)

##### finishedAt

> **finishedAt**: `string`

Defined in: [knowledge/improvement-job.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L47)

##### durationMs

> **durationMs**: `number`

Defined in: [knowledge/improvement-job.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L48)

##### updateCalls

> **updateCalls**: `number`

Defined in: [knowledge/improvement-job.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L49)

##### updateDurationMs

> **updateDurationMs**: `number`

Defined in: [knowledge/improvement-job.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L50)

##### supervisedSpent

> **supervisedSpent**: `object`

Defined in: [knowledge/improvement-job.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L51)

###### iterations

> **iterations**: `number`

###### inputTokens

> **inputTokens**: `number`

###### outputTokens

> **outputTokens**: `number`

###### usd

> **usd**: `number`

###### ms

> **ms**: `number`

***

### KnowledgeImprovementJobResult

Defined in: [knowledge/improvement-job.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L60)

#### Properties

##### improvement

> **improvement**: `KnowledgeImprovementResult`

Defined in: [knowledge/improvement-job.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L61)

##### measurement

> **measurement**: [`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

Defined in: [knowledge/improvement-job.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L62)

##### promoted

> **promoted**: `boolean`

Defined in: [knowledge/improvement-job.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L63)

##### blocked

> **blocked**: `boolean`

Defined in: [knowledge/improvement-job.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L64)

***

### AgentKnowledgeReadinessCheckOptions

Defined in: [knowledge/improvement-job.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L67)

#### Properties

##### goal

> **goal**: `string`

Defined in: [knowledge/improvement-job.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L68)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `KnowledgeReadinessSpec`[]

Defined in: [knowledge/improvement-job.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L69)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [knowledge/improvement-job.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L70)

##### readiness?

> `optional` **readiness?**: `Omit`\<`BuildEvalKnowledgeBundleOptions`, `"taskId"` \| `"index"` \| `"specs"`\>

Defined in: [knowledge/improvement-job.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L71)

##### strict?

> `optional` **strict?**: `boolean`

Defined in: [knowledge/improvement-job.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L72)

##### kbQuality?

> `optional` **kbQuality?**: `KnowledgeBaseQualityOptions`

Defined in: [knowledge/improvement-job.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L73)

***

### KnowledgeReadinessCheckInput

Defined in: [knowledge/supervised-update.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L22)

#### Properties

##### root

> **root**: `string`

Defined in: [knowledge/supervised-update.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L23)

##### goal

> **goal**: `string`

Defined in: [knowledge/supervised-update.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L24)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

Defined in: [knowledge/supervised-update.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L25)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [knowledge/supervised-update.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L26)

##### readiness?

> `optional` **readiness?**: `unknown`

Defined in: [knowledge/supervised-update.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L27)

***

### SupervisedKnowledgeUpdateInput

Defined in: [knowledge/supervised-update.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L42)

#### Properties

##### goal?

> `optional` **goal?**: `string`

Defined in: [knowledge/supervised-update.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L43)

##### root?

> `optional` **root?**: `string`

Defined in: [knowledge/supervised-update.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L44)

##### candidateRoot?

> `optional` **candidateRoot?**: `string`

Defined in: [knowledge/supervised-update.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L45)

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Defined in: [knowledge/supervised-update.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L46)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [knowledge/supervised-update.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L47)

***

### SupervisedKnowledgeUpdateResult

Defined in: [knowledge/supervised-update.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L50)

#### Properties

##### applied

> **applied**: `boolean`

Defined in: [knowledge/supervised-update.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L51)

##### summary

> **summary**: `string`

Defined in: [knowledge/supervised-update.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L52)

##### supervised

> **supervised**: [`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>

Defined in: [knowledge/supervised-update.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L53)

##### metadata

> **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [knowledge/supervised-update.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L54)

***

### SupervisedKnowledgeUpdateOptions

Defined in: [knowledge/supervised-update.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L57)

#### Properties

##### root

> **root**: `string`

Defined in: [knowledge/supervised-update.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L58)

##### goal

> **goal**: `string`

Defined in: [knowledge/supervised-update.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L59)

##### readiness

> **readiness**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [knowledge/supervised-update.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L60)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

Defined in: [knowledge/supervised-update.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L61)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [knowledge/supervised-update.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L62)

##### readinessOptions?

> `optional` **readinessOptions?**: `unknown`

Defined in: [knowledge/supervised-update.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L63)

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Defined in: [knowledge/supervised-update.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L64)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [knowledge/supervised-update.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L65)

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [knowledge/supervised-update.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L66)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [knowledge/supervised-update.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L67)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Defined in: [knowledge/supervised-update.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L68)

##### harness?

> `optional` **harness?**: `string`

Defined in: [knowledge/supervised-update.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L69)

##### supervisorModel?

> `optional` **supervisorModel?**: `string`

Defined in: [knowledge/supervised-update.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L70)

##### supervisorSystemPrompt?

> `optional` **supervisorSystemPrompt?**: `string`

Defined in: [knowledge/supervised-update.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L71)

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"backend"` \| `"budget"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

Defined in: [knowledge/supervised-update.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L72)

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [knowledge/supervised-update.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L78)

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

Defined in: [knowledge/supervised-update.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L79)

###### Parameters

###### profile

[`SupervisorProfile`](runtime.md#supervisorprofile)

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

***

### DelegatedLoopResult

Defined in: [loop-runner.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L67)

**`Experimental`**

Uniform result — never throws from a registered runner; a
 thrown engine becomes `{ ok: false, error }` so a routine can record + move on.

#### Type Parameters

##### T

`T` = `unknown`

#### Properties

##### mode

> **mode**: `"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

Defined in: [loop-runner.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L68)

**`Experimental`**

##### ok

> **ok**: `boolean`

Defined in: [loop-runner.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L69)

**`Experimental`**

##### output?

> `optional` **output?**: `T`

Defined in: [loop-runner.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L70)

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: [loop-runner.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L71)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [loop-runner.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L72)

**`Experimental`**

***

### RunDelegatedLoopOptions

Defined in: [loop-runner.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L76)

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [loop-runner.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L77)

**`Experimental`**

##### now?

> `optional` **now?**: () => `number`

Defined in: [loop-runner.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L79)

**`Experimental`**

Clock override for deterministic tests.

###### Returns

`number`

***

### WorktreeLoopRunnerOptions

Defined in: [loop-runner.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L121)

**`Experimental`**

Options for the local-repo `code` runner over the GENERIC recursive path.

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [loop-runner.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L123)

**`Experimental`**

Absolute path to the local git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [loop-runner.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L125)

**`Experimental`**

The instruction handed to every authored harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](runtime.md#authoredharness)[]

Defined in: [loop-runner.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L127)

**`Experimental`**

The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each.

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [loop-runner.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L129)

**`Experimental`**

Conserved budget pool bounding the fanout (equal-k holds by construction).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [loop-runner.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L131)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [loop-runner.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L133)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [loop-runner.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L135)

**`Experimental`**

Which verification signals the deliverable REQUIRES present-and-passing (default none).

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [loop-runner.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L137)

**`Experimental`**

Diff-size cap (lines).

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [loop-runner.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L139)

**`Experimental`**

Literal path prefixes the patch must not touch (the secret-floor is always on regardless).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](runtime.md#winnerstrategy)

Defined in: [loop-runner.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L141)

**`Experimental`**

Winner-selection strategy among gated candidates. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [loop-runner.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L143)

**`Experimental`**

Test seams forwarded to the worktree-CLI leaves so the runner drives offline.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [loop-runner.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L144)

**`Experimental`**

**`Experimental`**

Spawn a local coding harness CLI as a subprocess + collect its output.

NOT responsible for parsing the harness's output or extracting a diff —
the in-process executor's `streamPrompt` orchestrates `git diff` against
the worktree after this resolves. This function is intentionally narrow:
spawn, wait, capture, return.

Fails loud — throws when:
  - `cwd` doesn't exist (subprocess emits ENOENT; surfaced as Error)
  - the harness binary is not on PATH (ENOENT)

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - the subprocess is aborted / timed out (`result.killedBySignal` /
    `result.timedOut` carries the reason)

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### runCommand?

> `optional` **runCommand?**: `WorktreeCheckRunner`

Defined in: [loop-runner.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L145)

**`Experimental`**

***

### VetoedFact

Defined in: [loop-runner.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L208)

**`Experimental`**

A fact rejected at the KB gate — surfaced, never dropped.

#### Properties

##### candidate

> **candidate**: [`FactCandidate`](mcp.md#factcandidate)

Defined in: [loop-runner.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L209)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

Defined in: [loop-runner.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L210)

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

Defined in: [loop-runner.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L211)

**`Experimental`**

***

### ResearchLoopResult

Defined in: [loop-runner.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L215)

**`Experimental`**

#### Properties

##### accepted

> **accepted**: [`FactCandidate`](mcp.md#factcandidate)[]

Defined in: [loop-runner.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L217)

**`Experimental`**

Facts that passed the fail-closed gate — safe to write to the KB.

##### vetoed

> **vetoed**: [`VetoedFact`](#vetoedfact)[]

Defined in: [loop-runner.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L219)

**`Experimental`**

Facts the gate vetoed in the final round — escalate, do not silently drop.

##### rounds

> **rounds**: `number`

Defined in: [loop-runner.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L221)

**`Experimental`**

Research rounds actually run.

***

### ResearchLoopRunnerOptions

Defined in: [loop-runner.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L225)

**`Experimental`**

Options for the default `research` runner.

#### Properties

##### research

> **research**: (`round`, `vetoed`) => `Promise`\<[`FactCandidate`](mcp.md#factcandidate)[]\>

Defined in: [loop-runner.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L232)

**`Experimental`**

The research engine (the consumer's web/doc searcher + extractor). Called
each round with the prior round's vetoes so it can re-research the gaps.
Returns fact candidates carrying their grounding (`verbatimPassage` +
`sourceText`).

###### Parameters

###### round

`number`

###### vetoed

[`VetoedFact`](#vetoedfact)[]

###### Returns

`Promise`\<[`FactCandidate`](mcp.md#factcandidate)[]\>

##### gate?

> `optional` **gate?**: [`CreateKbGateOptions`](mcp.md#createkbgateoptions)

Defined in: [loop-runner.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L234)

**`Experimental`**

Gate config (extra judges, self-artifact kinds, …). The floor is always on.

##### maxRounds?

> `optional` **maxRounds?**: `number`

Defined in: [loop-runner.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L236)

**`Experimental`**

Max research rounds (correct-on-veto remediation). Default 1.

***

### ModelInfo

Defined in: [model-resolution.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L22)

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

#### Properties

##### id

> **id**: `string`

Defined in: [model-resolution.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L23)

##### name?

> `optional` **name?**: `string`

Defined in: [model-resolution.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L24)

##### description?

> `optional` **description?**: `string`

Defined in: [model-resolution.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L25)

##### provider?

> `optional` **provider?**: `string`

Defined in: [model-resolution.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L27)

Provider slug, when the router exposes it (`provider` or `_provider`).

##### \_provider?

> `optional` **\_provider?**: `string`

Defined in: [model-resolution.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L28)

##### architecture?

> `optional` **architecture?**: `object`

Defined in: [model-resolution.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L29)

###### modality?

> `optional` **modality?**: `string`

###### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

###### output\_modalities?

> `optional` **output\_modalities?**: `string`[]

***

### RouterEnv

Defined in: [model-resolution.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L37)

Env keys the router base URL is resolved from.

#### Properties

##### TANGLE\_ROUTER\_URL?

> `optional` **TANGLE\_ROUTER\_URL?**: `string`

Defined in: [model-resolution.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L38)

##### TANGLE\_ROUTER\_BASE\_URL?

> `optional` **TANGLE\_ROUTER\_BASE\_URL?**: `string`

Defined in: [model-resolution.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L39)

***

### ResolvedChatModel

Defined in: [model-resolution.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L80)

#### Properties

##### source

> **source**: `string`

Defined in: [model-resolution.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L81)

##### model

> **model**: `string`

Defined in: [model-resolution.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L82)

***

### OtelExportConfig

Defined in: [otel-export.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L15)

#### Properties

##### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [otel-export.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L17)

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L19)

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

##### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [otel-export.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L21)

Batch size before flush. Default 64.

##### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Defined in: [otel-export.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L23)

Flush interval ms. Default 5000.

##### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L25)

Resource attributes stamped on every export.

##### serviceName?

> `optional` **serviceName?**: `string`

Defined in: [otel-export.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L27)

Service name. Default 'agent-runtime'.

***

### OtelExporter

Defined in: [otel-export.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L30)

#### Methods

##### exportSpan()

> **exportSpan**(`span`): `void`

Defined in: [otel-export.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L32)

Export a span.

###### Parameters

###### span

[`OtelSpan`](#otelspan)

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L34)

Force flush pending spans.

###### Returns

`Promise`\<`void`\>

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L36)

Shutdown cleanly.

###### Returns

`Promise`\<`void`\>

***

### OtelSpan

Defined in: [otel-export.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L39)

#### Properties

##### traceId

> **traceId**: `string`

Defined in: [otel-export.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L40)

##### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L41)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L42)

##### name

> **name**: `string`

Defined in: [otel-export.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L43)

##### kind?

> `optional` **kind?**: `number`

Defined in: [otel-export.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L44)

##### startTimeUnixNano

> **startTimeUnixNano**: `string`

Defined in: [otel-export.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L45)

##### endTimeUnixNano

> **endTimeUnixNano**: `string`

Defined in: [otel-export.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L46)

##### attributes?

> `optional` **attributes?**: [`OtelAttribute`](#otelattribute)[]

Defined in: [otel-export.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L47)

##### status?

> `optional` **status?**: `object`

Defined in: [otel-export.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L48)

###### code

> **code**: `number`

###### message?

> `optional` **message?**: `string`

***

### OtelAttribute

Defined in: [otel-export.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L51)

#### Properties

##### key

> **key**: `string`

Defined in: [otel-export.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L52)

##### value

> **value**: `object`

Defined in: [otel-export.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L53)

###### stringValue?

> `optional` **stringValue?**: `string`

###### intValue?

> `optional` **intValue?**: `string`

###### doubleValue?

> `optional` **doubleValue?**: `number`

###### boolValue?

> `optional` **boolValue?**: `boolean`

***

### RuntimeEventOtelOptions

Defined in: [otel-export.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L230)

#### Stable

#### Extends

- [`RuntimeTelemetryOptions`](#runtimetelemetryoptions)

#### Properties

##### redact?

> `optional` **redact?**: (`value`) => `unknown`

Defined in: [otel-export.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L232)

Final customer redactor applied after the schema-aware runtime sanitizer.

###### Parameters

###### value

`unknown`

###### Returns

`unknown`

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [sanitize.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L35)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeInputs`](#includeinputs-1)

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [sanitize.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L37)

Include requirement descriptions. Secret requirements are always redacted.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeRequirementDescriptions`](#includerequirementdescriptions-1)

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [sanitize.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L39)

Include evidence IDs. Off by default; counts are safer for shared reports.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvidenceIds`](#includeevidenceids-1)

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [sanitize.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L41)

Include user answers from question preflight. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeUserAnswers`](#includeuseranswers-1)

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [sanitize.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L43)

Include action payloads and action results for control steps. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeControlPayloads`](#includecontrolpayloads-1)

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [sanitize.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L45)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeMetadata`](#includemetadata-1)

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [sanitize.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L47)

Include eval detail/evidence strings. Off by default because validators may echo private input.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvalDetails`](#includeevaldetails-1)

***

### LoopSpanNode

Defined in: [otel-export.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L334)

Sink-neutral node in a reconstructed loop span tree. The root node's
`parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
mapper attaches the inherited delegation span; the delegation journal
leaves it as the tree root).

#### Properties

##### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L335)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L336)

##### name

> **name**: `string`

Defined in: [otel-export.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L338)

`'loop'` | `'loop.round'` | `'loop.iteration'`.

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [otel-export.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L340)

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

Defined in: [otel-export.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L341)

##### endMs

> **endMs**: `number`

Defined in: [otel-export.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L342)

##### attrs

> **attrs**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L343)

##### error

> **error**: `boolean`

Defined in: [otel-export.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L345)

True when the iteration carried an error — maps to OTEL status code 2.

***

### EvalRunGeneration

Defined in: [otel-export.ts:667](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L667)

#### Properties

##### index

> **index**: `number`

Defined in: [otel-export.ts:669](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L669)

0-based ordinal of this generation within the run (required by ingest).

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [otel-export.ts:671](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L671)

Identity of the proposed surface change (content-addressed hash).

##### surface?

> `optional` **surface?**: `unknown`

Defined in: [otel-export.ts:673](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L673)

Arbitrary provenance for this generation (rationale, evidence, source).

##### cells?

> `optional` **cells?**: `unknown`[]

Defined in: [otel-export.ts:675](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L675)

Per-scenario results; empty until the generation is measured.

##### compositeMean

> **compositeMean**: `number`

Defined in: [otel-export.ts:677](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L677)

Mean composite score (0 when unmeasured — pair with labels.measured).

##### costUsd

> **costUsd**: `number`

Defined in: [otel-export.ts:678](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L678)

##### durationMs

> **durationMs**: `number`

Defined in: [otel-export.ts:679](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L679)

***

### EvalRunEvent

Defined in: [otel-export.ts:682](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L682)

#### Properties

##### runId

> **runId**: `string`

Defined in: [otel-export.ts:683](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L683)

##### runDir

> **runDir**: `string`

Defined in: [otel-export.ts:684](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L684)

##### timestamp

> **timestamp**: `string`

Defined in: [otel-export.ts:686](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L686)

ISO timestamp.

##### status

> **status**: `"started"` \| `"baseline-complete"` \| `"generation-complete"` \| `"gate-decided"` \| `"finished"` \| `"errored"`

Defined in: [otel-export.ts:687](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L687)

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:694](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L694)

##### baseline?

> `optional` **baseline?**: [`EvalRunGeneration`](#evalrungeneration)

Defined in: [otel-export.ts:695](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L695)

##### generations?

> `optional` **generations?**: [`EvalRunGeneration`](#evalrungeneration)[]

Defined in: [otel-export.ts:696](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L696)

##### gateDecision?

> `optional` **gateDecision?**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [otel-export.ts:697](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L697)

##### holdoutLift?

> `optional` **holdoutLift?**: `number`

Defined in: [otel-export.ts:698](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L698)

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [otel-export.ts:699](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L699)

##### totalDurationMs

> **totalDurationMs**: `number`

Defined in: [otel-export.ts:700](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L700)

##### errorMessage?

> `optional` **errorMessage?**: `string`

Defined in: [otel-export.ts:701](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L701)

***

### EvalRunsExportConfig

Defined in: [otel-export.ts:704](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L704)

#### Properties

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [otel-export.ts:706](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L706)

Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY.

##### base?

> `optional` **base?**: `string`

Defined in: [otel-export.ts:708](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L708)

Intelligence base. Reads TANGLE_INTELLIGENCE_URL env, else prod.

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [otel-export.ts:710](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L710)

Idempotency-Key header (e.g. the runId) — safe retries + upsert.

***

### EvalRunsExportResult

Defined in: [otel-export.ts:713](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L713)

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [otel-export.ts:714](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L714)

##### status

> **status**: `number`

Defined in: [otel-export.ts:715](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L715)

##### accepted

> **accepted**: `number`

Defined in: [otel-export.ts:716](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L716)

##### rejected

> **rejected**: `object`[]

Defined in: [otel-export.ts:717](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L717)

###### index

> **index**: `number`

###### reason

> **reason**: `string`

***

### ResolveAgentBackendOptions

Defined in: [resolve-agent-backend.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L51)

#### Extends

- `OpenAICompatPassthrough`

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### tools?

> `optional` **tools?**: readonly [`OpenAIChatTool`](#openaichattool)[]

Defined in: [backends.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L222)

OpenAI Chat Completions `tools[]` definitions surfaced to the model on
every request. Omit to send a tool-free request (existing behavior).
The runtime makes no assumption about the dispatcher — calls stream out
as `tool_call` events and the caller is responsible for executing them
and feeding `tool_result` messages back on a follow-up turn.

###### Inherited from

`OpenAICompatPassthrough.tools`

##### toolChoice?

> `optional` **toolChoice?**: [`OpenAIChatToolChoice`](#openaichattoolchoice)

Defined in: [backends.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L228)

OpenAI Chat Completions `tool_choice`. Default `undefined` (request
omits the field; provider falls back to its own default — typically
`'auto'`).

###### Inherited from

`OpenAICompatPassthrough.toolChoice`

##### responseFormat?

> `optional` **responseFormat?**: [`OpenAIChatResponseFormat`](#openaichatresponseformat)

Defined in: [backends.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L232)

OpenAI Chat Completions `response_format`. Omit for provider default text.

###### Inherited from

`OpenAICompatPassthrough.responseFormat`

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [backends.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L234)

OpenAI Chat Completions `temperature`. Omit for provider default.

###### Inherited from

`OpenAICompatPassthrough.temperature`

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [backends.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L236)

Maximum completion tokens, sent as OpenAI-compatible `max_tokens`. Omit for provider default.

###### Inherited from

`OpenAICompatPassthrough.maxTokens`

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [backends.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L237)

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

###### Inherited from

`OpenAICompatPassthrough.fetchImpl`

##### retry?

> `optional` **retry?**: `BackendRetryPolicy`

Defined in: [backends.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L238)

###### Inherited from

`OpenAICompatPassthrough.retry`

##### kind

> **kind**: [`AgentBackendKind`](#agentbackendkind)

Defined in: [resolve-agent-backend.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L54)

The chat transport to resolve.

##### apiKey

> **apiKey**: `string`

Defined in: [resolve-agent-backend.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L60)

Bearer credential for the OpenAI-compat kinds. Empty string is valid for a
loopback-anonymous cli-bridge; a `router`/`tcloud` route with an empty key
is a caller bug the product surfaces before calling in.

##### baseUrl

> **baseUrl**: `string`

Defined in: [resolve-agent-backend.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L62)

Base URL for the OpenAI-compat kinds. cli-bridge's is its `/v1`.

##### model

> **model**: `string`

Defined in: [resolve-agent-backend.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L64)

Model id sent on every request. cli-bridge rejects a request without it.

##### label?

> `optional` **label?**: `string`

Defined in: [resolve-agent-backend.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L66)

`kind` label stamped on the resolved backend + its traces. Defaults to `kind`.

##### sandboxBackend?

> `optional` **sandboxBackend?**: () => [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [resolve-agent-backend.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L72)

`sandbox` kind: the product's own domain backend. Required for that kind —
the substrate owns no product sandbox shape, so a `sandbox` resolution with
no seam is a caller bug, not a silent fallback.

###### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### RuntimeHookEvent

Defined in: [runtime-hooks.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L36)

#### Type Parameters

##### Payload

`Payload` = `unknown`

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L37)

##### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L38)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L39)

##### target

> **target**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [runtime-hooks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L40)

##### phase

> **phase**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [runtime-hooks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L41)

##### timestamp

> **timestamp**: `number`

Defined in: [runtime-hooks.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L42)

##### stepIndex?

> `optional` **stepIndex?**: `number`

Defined in: [runtime-hooks.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L43)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [runtime-hooks.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L44)

##### payload?

> `optional` **payload?**: `Payload`

Defined in: [runtime-hooks.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L45)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L46)

***

### RuntimeHookContext

Defined in: [runtime-hooks.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L49)

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime-hooks.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L50)

***

### RuntimeDecisionEvidenceRef

Defined in: [runtime-hooks.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L53)

#### Properties

##### source

> **source**: `string`

Defined in: [runtime-hooks.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L54)

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L55)

##### detail?

> `optional` **detail?**: `string`

Defined in: [runtime-hooks.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L56)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L57)

***

### RuntimeDecisionPoint

Defined in: [runtime-hooks.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L60)

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L61)

##### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L62)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L63)

##### stepIndex

> **stepIndex**: `number`

Defined in: [runtime-hooks.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L64)

##### kind

> **kind**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [runtime-hooks.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L65)

##### candidateActions

> **candidateActions**: `string`[]

Defined in: [runtime-hooks.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L66)

##### context?

> `optional` **context?**: `string`

Defined in: [runtime-hooks.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L67)

##### evidence

> **evidence**: [`RuntimeDecisionEvidenceRef`](#runtimedecisionevidenceref)[]

Defined in: [runtime-hooks.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L68)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L69)

***

### RuntimeHookErrorContext

Defined in: [runtime-hooks.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L72)

#### Properties

##### hook

> **hook**: `"onEvent"` \| `"onDecisionPoint"`

Defined in: [runtime-hooks.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L73)

##### eventId?

> `optional` **eventId?**: `string`

Defined in: [runtime-hooks.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L74)

##### target?

> `optional` **target?**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [runtime-hooks.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L75)

##### phase?

> `optional` **phase?**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [runtime-hooks.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L76)

##### decisionId?

> `optional` **decisionId?**: `string`

Defined in: [runtime-hooks.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L77)

##### decisionKind?

> `optional` **decisionKind?**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [runtime-hooks.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L78)

***

### RuntimeHooks

Defined in: [runtime-hooks.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L88)

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](#defineruntimehooks) for inference, and attach N
observers at once with [composeRuntimeHooks](#composeruntimehooks) — there is ONE event stream, not a
callback-prop zoo.

#### Properties

##### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L94)

General before/after/event hook. Use this for telemetry, memory capture,
policy wrapping, child lifecycle observers, or product-specific extension
points.

###### Parameters

###### event

[`RuntimeHookEvent`](#runtimehookevent)

###### context

[`RuntimeHookContext`](#runtimehookcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onDecisionPoint?

> `optional` **onDecisionPoint?**: (`point`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L99)

Semantic decision hook. Belief-state evaluation consumes this, but runtime
code should keep emitting ordinary lifecycle events as the base layer.

###### Parameters

###### point

[`RuntimeDecisionPoint`](#runtimedecisionpoint)

###### context

[`RuntimeHookContext`](#runtimehookcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onHookError?

> `optional` **onHookError?**: (`error`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L103)

###### Parameters

###### error

`Error`

###### context

[`RuntimeHookErrorContext`](#runtimehookerrorcontext)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunRow

Defined in: [runtime-run.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L61)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L63)

Stable runtime-side identifier. Adapters may translate to their own primary key.

##### workspaceId

> **workspaceId**: `string`

Defined in: [runtime-run.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L64)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [runtime-run.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L65)

##### agentId?

> `optional` **agentId?**: `string`

Defined in: [runtime-run.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L66)

##### domain?

> `optional` **domain?**: `string`

Defined in: [runtime-run.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L67)

##### taskId

> **taskId**: `string`

Defined in: [runtime-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L68)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L69)

##### status

> **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L70)

##### resultSummary?

> `optional` **resultSummary?**: `string`

Defined in: [runtime-run.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L71)

##### error?

> `optional` **error?**: `string`

Defined in: [runtime-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L72)

##### cost

> **cost**: `RuntimeRunCost`

Defined in: [runtime-run.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L73)

##### startedAt

> **startedAt**: `string`

Defined in: [runtime-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L74)

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [runtime-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L75)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-run.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L76)

***

### RuntimeRunPersistenceAdapter

Defined in: [runtime-run.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L80)

#### Stable

#### Methods

##### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

Defined in: [runtime-run.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L88)

Called once when `handle.persist()` runs. Implementations write `row` to
their durable store (D1, postgres, KV) and return whatever the consumer
wants the caller to see (often the storage-side row id). Errors thrown
here propagate out of `persist()` so the caller can decide whether to
retry or log-and-continue.

###### Parameters

###### row

[`RuntimeRunRow`](#runtimerunrow)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunHandle

Defined in: [runtime-run.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L107)

#### Stable

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [runtime-run.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L109)

Stable id assigned at start.

##### workspaceId

> `readonly` **workspaceId**: `string`

Defined in: [runtime-run.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L110)

##### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

Defined in: [runtime-run.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L111)

##### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [runtime-run.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L112)

##### status

> `readonly` **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L113)

#### Methods

##### observe()

> **observe**(`event`): `void`

Defined in: [runtime-run.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L120)

Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
(text deltas, tool calls) silently so consumers can pipe the whole stream
through `handle.observe`. `llm_call` events update the ledger.

###### Parameters

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void`

##### cost()

> **cost**(): `RuntimeRunCost`

Defined in: [runtime-run.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L123)

Snapshot of the current cost ledger. Safe to call at any time.

###### Returns

`RuntimeRunCost`

##### complete()

> **complete**(`input`): `void`

Defined in: [runtime-run.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L130)

Transition to a terminal state. Idempotent for the same status; throws
`RuntimeRunStateError` for a different terminal status (state machines
don't time-travel).

###### Parameters

###### input

`RuntimeRunCompleteInput`

###### Returns

`void`

##### toRow()

> **toRow**(`metadata?`): [`RuntimeRunRow`](#runtimerunrow)

Defined in: [runtime-run.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L133)

Build the current row without writing it. Useful for tests + dry runs.

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

[`RuntimeRunRow`](#runtimerunrow)

##### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Defined in: [runtime-run.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L140)

Persist the current row via the configured adapter. Must be called after
`complete()`. Idempotent for the same terminal state (the adapter sees
the same row on retry).

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`void`\>

***

### RuntimeTelemetryOptions

Defined in: [sanitize.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L30)

#### Stable

#### Extended by

- [`RuntimeEventOtelOptions`](#runtimeeventoteloptions)

#### Properties

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [sanitize.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L35)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [sanitize.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L37)

Include requirement descriptions. Secret requirements are always redacted.

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [sanitize.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L39)

Include evidence IDs. Off by default; counts are safer for shared reports.

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [sanitize.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L41)

Include user answers from question preflight. Off by default.

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [sanitize.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L43)

Include action payloads and action results for control steps. Off by default.

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [sanitize.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L45)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [sanitize.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L47)

Include eval detail/evidence strings. Off by default because validators may echo private input.

***

### SanitizedKnowledgeReadinessReport

Defined in: [sanitize.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L68)

#### Stable

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [sanitize.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L69)

##### readinessScore

> **readinessScore**: `number`

Defined in: [sanitize.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L70)

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

Defined in: [sanitize.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L71)

##### severity

> **severity**: `ControlSeverity`

Defined in: [sanitize.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L72)

##### reason

> **reason**: `string`

Defined in: [sanitize.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L73)

##### blockingMissingRequirements

> **blockingMissingRequirements**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L74)

##### nonBlockingGaps

> **nonBlockingGaps**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L75)

##### evidenceCount

> **evidenceCount**: `number`

Defined in: [sanitize.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L76)

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

Defined in: [sanitize.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L77)

##### missingRequirementIds

> **missingRequirementIds**: `string`[]

Defined in: [sanitize.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L78)

***

### RuntimeEventCollector

Defined in: [sanitize.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L493)

#### Stable

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### onEvent

> **onEvent**: (`event`) => `void`

Defined in: [sanitize.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L499)

###### Parameters

###### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`void`

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:500](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L500)

***

### RuntimeStreamEventCollector

Defined in: [sanitize.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L523)

#### Stable

#### Properties

##### onEvent

> **onEvent**: `RuntimeStreamEventSink`

Defined in: [sanitize.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L524)

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L525)

#### Methods

##### summary()

> **summary**(): `RuntimeStreamEventSummary`

Defined in: [sanitize.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L527)

Snapshot of a small streaming-flavored summary derived from collected events.

###### Returns

`RuntimeStreamEventSummary`

***

### ToolLoopCall

Defined in: [tool-loop.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L22)

#### Properties

##### toolCallId?

> `optional` **toolCallId?**: `string`

Defined in: [tool-loop.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L23)

##### toolName

> **toolName**: `string`

Defined in: [tool-loop.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L24)

##### args

> **args**: `Record`\<`string`, `unknown`\>

Defined in: [tool-loop.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L25)

***

### ToolLoopAssistantToolCall

Defined in: [tool-loop.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L45)

One OpenAI-shaped tool-call entry carried on an assistant message.

#### Properties

##### id

> **id**: `string`

Defined in: [tool-loop.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L46)

##### type

> **type**: `"function"`

Defined in: [tool-loop.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L47)

##### function

> **function**: `object`

Defined in: [tool-loop.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L48)

###### name

> **name**: `string`

###### arguments

> **arguments**: `string`

***

### ToolLoopResult

Defined in: [tool-loop.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L120)

#### Properties

##### finalText

> **finalText**: `string`

Defined in: [tool-loop.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L121)

##### toolResults

> **toolResults**: `object`[]

Defined in: [tool-loop.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L122)

###### call

> **call**: [`ToolLoopCall`](#toolloopcall)

###### label

> **label**: `string`

###### outcome

> **outcome**: [`ToolCallOutcome`](#toolcalloutcome)

##### turns

> **turns**: `number`

Defined in: [tool-loop.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L123)

##### stopReason

> **stopReason**: [`ToolLoopStopReason`](#toolloopstopreason)

Defined in: [tool-loop.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L124)

##### ~~cappedOut~~

> **cappedOut**: `boolean`

Defined in: [tool-loop.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L126)

###### Deprecated

Use `stopReason !== 'completed'` instead.

***

### RunToolLoopOptions

Defined in: [tool-loop.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L129)

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [tool-loop.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L130)

##### userMessage

> **userMessage**: `string`

Defined in: [tool-loop.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L131)

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

Defined in: [tool-loop.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L132)

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

Defined in: [tool-loop.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L133)

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

Defined in: [tool-loop.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L134)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [tool-loop.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L135)

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [tool-loop.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L138)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
 For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [tool-loop.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L141)

Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
 loop stops with stopReason `deadline`.

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [tool-loop.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L143)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [tool-loop.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L145)

Return the USD cost of one outcome. Required for `maxCostUsd` to work.

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`number`

##### renderResult?

> `optional` **renderResult?**: (`label`, `outcome`) => `string`

Defined in: [tool-loop.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L146)

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

Defined in: [tool-loop.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L147)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

Defined in: [tool-loop.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L148)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [tool-loop.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L149)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](#runtimehooks)

Defined in: [tool-loop.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L150)

***

### StreamToolLoopOptions

Defined in: [tool-loop.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L309)

#### Type Parameters

##### Raw

`Raw`

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [tool-loop.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L310)

##### userMessage

> **userMessage**: `string`

Defined in: [tool-loop.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L311)

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

Defined in: [tool-loop.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L312)

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<`Raw`\>

Defined in: [tool-loop.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L313)

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<`Raw`\>

##### extractText

> **extractText**: (`event`) => `string`

Defined in: [tool-loop.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L314)

###### Parameters

###### event

`Raw`

###### Returns

`string`

##### extractToolCall

> **extractToolCall**: (`event`) => [`ToolLoopCall`](#toolloopcall) \| `null`

Defined in: [tool-loop.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L315)

###### Parameters

###### event

`Raw`

###### Returns

[`ToolLoopCall`](#toolloopcall) \| `null`

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [tool-loop.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L316)

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

Defined in: [tool-loop.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L317)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [tool-loop.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L319)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [tool-loop.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L321)

Wall-clock deadline in ms since epoch (Date.now()-based).

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [tool-loop.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L323)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [tool-loop.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L325)

Return the USD cost of one outcome. Required for `maxCostUsd` to work.

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`number`

##### renderResult?

> `optional` **renderResult?**: (`label`, `outcome`) => `string`

Defined in: [tool-loop.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L326)

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

Defined in: [tool-loop.ts:327](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L327)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

Defined in: [tool-loop.ts:328](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L328)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [tool-loop.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L329)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](#runtimehooks)

Defined in: [tool-loop.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L330)

***

### AgentTaskSpec

Defined in: [types.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L27)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [types.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L28)

##### intent

> **intent**: `string`

Defined in: [types.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L29)

##### domain?

> `optional` **domain?**: `string`

Defined in: [types.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L31)

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L32)

##### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

Defined in: [types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L33)

##### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

Defined in: [types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L34)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L35)

***

### AgentKnowledgeProvider

Defined in: [types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L39)

#### Stable

#### Methods

##### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L40)

###### Parameters

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

##### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L41)

###### Parameters

###### questions

`UserQuestion`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

##### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

Defined in: [types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L45)

###### Parameters

###### plans

`DataAcquisitionPlan`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`string`[] \| `Promise`\<`string`[]\>

##### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L49)

###### Parameters

###### input

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### previous

`KnowledgeReadinessReport`

###### userAnswers

`Record`\<`string`, `string`\>

###### acquiredEvidenceIds

`string`[]

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

***

### AgentTaskContext

Defined in: [types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L58)

#### Stable

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L64)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L65)

##### state

> **state**: `TState`

Defined in: [types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L66)

##### evals

> **evals**: `TEval`[]

Defined in: [types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L67)

##### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

Defined in: [types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L68)

##### budget

> **budget**: `ControlBudget`

Defined in: [types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L69)

##### stepIndex

> **stepIndex**: `number`

Defined in: [types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L70)

##### wallMs

> **wallMs**: `number`

Defined in: [types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L71)

##### spentCostUsd

> **spentCostUsd**: `number`

Defined in: [types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L72)

##### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

Defined in: [types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L73)

##### abortSignal

> **abortSignal**: `AbortSignal`

Defined in: [types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L74)

***

### AgentAdapter

Defined in: [types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L78)

#### Stable

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Methods

##### observe()

> **observe**(`ctx`): `TState` \| `Promise`\<`TState`\>

Defined in: [types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L84)

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

###### Returns

`TState` \| `Promise`\<`TState`\>

##### validate()

> **validate**(`ctx`): `TEval`[] \| `Promise`\<`TEval`[]\>

Defined in: [types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L91)

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### state

`TState`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

###### Returns

`TEval`[] \| `Promise`\<`TEval`[]\>

##### decide()

> **decide**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L99)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

Defined in: [types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L103)

###### Parameters

###### action

`TAction`

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

##### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

Defined in: [types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L108)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

##### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L122)

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### questions

`UserQuestion`[]

###### acquisitionPlans

`DataAcquisitionPlan`[]

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### getActionCostUsd()?

> `optional` **getActionCostUsd**(`ctx`): `number` \| `undefined`

Defined in: [types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L129)

###### Parameters

###### ctx

###### action

`TAction`

###### result

`TActionResult`

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### state

`TState`

###### evals

`TEval`[]

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### Returns

`number` \| `undefined`

##### projectRunRecords()?

> `optional` **projectRunRecords**(`result`, `task`): `RunRecord`[]

Defined in: [types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L138)

###### Parameters

###### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`RunRecord`[]

***

### BackendErrorDetail

Defined in: [types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L212)

Typed transport / backend failure detail. Carried on `backend_error` and
`final` events when the backend's stream throws or the upstream HTTP call
returns a non-success status. Lets consumers (a) distinguish "stream
completed with no text" from "stream never reached the model" and
(b) reconstruct the precise upstream signal (status + truncated body) when
building a `RunRecord.error`.

`body` is truncated to 2 KiB by the backend so an HTML error page from a
misconfigured proxy never bloats event payloads or logs. Consumers needing
the full body should inspect the underlying `BackendTransportError.body`
via a custom `mapEvent` or backend wrapper.

#### Stable

#### Properties

##### kind

> **kind**: `"backend"` \| `"transport"`

Defined in: [types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L218)

`'transport'` — upstream HTTP / network failure with optional status code.
`'backend'` — the backend's `stream()` generator threw for a non-transport
reason (e.g. a custom adapter error, sandbox crash).

##### message

> **message**: `string`

Defined in: [types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L219)

##### status?

> `optional` **status?**: `number`

Defined in: [types.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L221)

Upstream HTTP status when known. `0` for connection / abort errors.

##### body?

> `optional` **body?**: `string`

Defined in: [types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L223)

Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed.

***

### OpenAIChatTool

Defined in: [types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L242)

OpenAI Chat Completions tool descriptor. The shape mirrors the
`/v1/chat/completions` `tools[]` parameter so callers can pass tool
definitions through `createOpenAICompatibleBackend({ tools })` without any
runtime translation. The router proxies this shape verbatim to Anthropic
(translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
that the eval surface targets.

Callers that build their tool list from MCP servers should run a one-shot
MCP `tools/list` at config time and project the result into this shape. The
runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
keeping the backend transport thin lets domain repos own MCP plumbing.

#### Stable

#### Properties

##### type

> **type**: `"function"`

Defined in: [types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L243)

##### function

> **function**: `object`

Defined in: [types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L244)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSessionStore

Defined in: [types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L461)

#### Stable

#### Methods

##### get()

> **get**(`sessionId`): `RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

Defined in: [types.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L462)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

##### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L463)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void` \| `Promise`\<`void`\>

##### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L464)

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

Defined in: [types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L465)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

***

### AgentBackendInput

Defined in: [types.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L469)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L470)

##### message?

> `optional` **message?**: `string`

Defined in: [types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L471)

##### messages?

> `optional` **messages?**: `object`[]

Defined in: [types.ts:472](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L472)

###### role

> **role**: `string`

###### content

> **content**: `string`

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L473)

***

### AgentBackendContext

Defined in: [types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L477)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L478)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L479)

##### session

> **session**: `RuntimeSession`

Defined in: [types.ts:480](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L480)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L481)

##### runId?

> `optional` **runId?**: `string`

Defined in: [types.ts:487](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L487)

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

##### turnId?

> `optional` **turnId?**: `string`

Defined in: [types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L492)

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L498)

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:505](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L505)

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.

***

### AgentExecutionBackend

Defined in: [types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L509)

#### Stable

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### kind

> **kind**: `string`

Defined in: [types.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L510)

#### Methods

##### start()?

> `optional` **start**(`input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:511](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L511)

###### Parameters

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\> & `object`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

##### resume()?

> `optional` **resume**(`session`, `input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L515)

###### Parameters

###### session

`RuntimeSession`

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\>

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

##### stream()

> **stream**(`input`, `context`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

Defined in: [types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L520)

###### Parameters

###### input

`TInput`

###### context

[`AgentBackendContext`](#agentbackendcontext)

###### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

##### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:521](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L521)

###### Parameters

###### session

`RuntimeSession`

###### reason

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### AgentTaskRunResult

Defined in: [types.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L557)

#### Stable

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:563](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L563)

##### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

Defined in: [types.ts:564](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L564)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:565](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L565)

##### questions

> **questions**: `UserQuestion`[]

Defined in: [types.ts:566](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L566)

##### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

Defined in: [types.ts:567](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L567)

##### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

Defined in: [types.ts:568](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L568)

##### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

Defined in: [types.ts:569](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L569)

##### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

Defined in: [types.ts:570](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L570)

##### runRecords

> **runRecords**: `RunRecord`[]

Defined in: [types.ts:571](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L571)

## Type Aliases

### AgentCandidateProfileSource

> **AgentCandidateProfileSource** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \} \| \{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

Defined in: [candidate-execution/builder.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L26)

A complete profile that can be frozen without losing behavior.

#### Union Members

##### Type Literal

\{ `kind`: `"profile"`; `profile`: `AgentProfile`; \}

***

##### Type Literal

\{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \}

###### kind

> **kind**: `"profile-diffs"`

###### base

> **base**: `AgentProfile`

###### diffs

> **diffs**: readonly `AgentProfileDiff`[]

Applied in order. Each exact diff is content-addressed into lineage.

***

##### Type Literal

\{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

###### kind

> **kind**: `"candidate-profile"`

###### profile

> **profile**: `AgentCandidateProfile`

Already converted to the closed, secret-free candidate profile contract.

***

### AgentCandidateCodeSource

> **AgentCandidateCodeSource** = `AgentCandidateCodeDisabled` \| `AgentCandidateCodeNoOp` \| [`AgentCandidateCodeSurfaceSource`](#agentcandidatecodesurfacesource)

Defined in: [candidate-execution/builder.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L53)

Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify.

***

### AgentCandidateBundleInput

> **AgentCandidateBundleInput** = `Omit`\<`AgentCandidateBundle`, `"digest"`\>

Defined in: [candidate-execution/bundle.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/bundle.ts#L7)

Exact candidate wire shape before the runtime computes its canonical digest.

***

### AgentCandidateExecutionFailureClass

> **AgentCandidateExecutionFailureClass** = `"pre-model-infrastructure"` \| `"execution"` \| `"post-model-infrastructure"` \| `"unknown"`

Defined in: [candidate-execution/claim.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L78)

Only the first class is retryable, and only when the closed model ledger has zero calls.

***

### AgentCandidateExecutionTerminalResult

> **AgentCandidateExecutionTerminalResult** = \{ `schemaVersion`: `1`; `status`: `"succeeded"`; `usage`: [`AgentCandidateExecutionUsage`](#agentcandidateexecutionusage); `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \} \| \{ `schemaVersion`: `1`; `status`: `"failed"`; `failureClass`: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass); `usage`: [`AgentCandidateExecutionUsage`](#agentcandidateexecutionusage); `modelSettlement`: `AgentCandidateArtifactRef`; `failureEvidence?`: `AgentCandidateArtifactRef`; \}

Defined in: [candidate-execution/claim.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L95)

Evaluator-owned terminal facts staged durably before the terminal CAS.

***

### AgentCandidateExecutionTerminalRecord

> **AgentCandidateExecutionTerminalRecord** = [`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult) & `object`

Defined in: [candidate-execution/claim.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L115)

Durable terminal record for one acquired execution attempt.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `string`

##### attempt

> `readonly` **attempt**: `number`

##### bundleDigest

> `readonly` **bundleDigest**: `Sha256Digest`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `Sha256Digest`

##### terminalDigest

> `readonly` **terminalDigest**: `Sha256Digest`

RFC 8785 SHA-256 of this record with `terminalDigest` omitted.

***

### AgentCandidateExecutionPhase

> **AgentCandidateExecutionPhase** = `"claimed"` \| `"candidate-may-run"`

Defined in: [candidate-execution/claim.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L125)

Monotonic durable phase: the second value means candidate code could have started.

***

### AgentCandidateExecutionClaimResult

> **AgentCandidateExecutionClaimResult** = \{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \} \| \{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \} \| \{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

Defined in: [candidate-execution/claim.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L165)

Result of atomically claiming one execution attempt.

#### Union Members

##### Type Literal

\{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \}

***

##### Type Literal

\{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \}

###### acquired

> `readonly` **acquired**: `false`

###### reason

> `readonly` **reason**: `"already-claimed"`

###### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

The durable winner already occupying this execution-attempt slot.

###### exactReplay

> `readonly` **exactReplay**: `boolean`

True only when every signed claim field matches the durable winner.

***

##### Type Literal

\{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

***

### AgentCandidateExecutionFinishResult

> **AgentCandidateExecutionFinishResult** = \{ `finished`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \} \| \{ `finished`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

Defined in: [candidate-execution/claim.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L187)

Result of atomically recording an attempt's terminal facts.

#### Union Members

##### Type Literal

\{ `finished`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \}

***

##### Type Literal

\{ `finished`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

###### finished

> `readonly` **finished**: `false`

###### terminal

> `readonly` **terminal**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

###### exactReplay

> `readonly` **exactReplay**: `boolean`

True when a repeated finish supplied the same terminal digest.

***

### AgentCandidateExecutionStageResult

> **AgentCandidateExecutionStageResult** = \{ `staged`: `true`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); \} \| \{ `staged`: `false`; `terminal`: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord); `exactReplay`: `boolean`; \}

Defined in: [candidate-execution/claim.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L200)

Result of durably staging the one immutable terminal outbox entry.

***

### AgentCandidateExecutionPhaseResult

> **AgentCandidateExecutionPhaseResult** = \{ `marked`: `true`; `phase`: `"candidate-may-run"`; \} \| \{ `marked`: `false`; `phase`: `"candidate-may-run"`; \}

Defined in: [candidate-execution/claim.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L212)

Result of crossing the irreversible candidate-may-run boundary.

***

### AgentCandidateRetryRejection

> **AgentCandidateRetryRejection** = `"prior-attempt-missing"` \| `"prior-attempt-running"` \| `"prior-attempt-succeeded"` \| `"prior-attempt-spent-model-calls"` \| `"prior-attempt-not-pre-model-infrastructure"` \| `"retry-lineage-mismatch"`

Defined in: [candidate-execution/claim.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L216)

***

### AgentCandidateModelGrantReserveInput

> **AgentCandidateModelGrantReserveInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"reserveGrant"`\]\>\[`0`\]

Defined in: [candidate-execution/protected-model-port.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L18)

***

### AgentCandidateModelGrantActivateInput

> **AgentCandidateModelGrantActivateInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"activateGrant"`\]\>\[`0`\]

Defined in: [candidate-execution/protected-model-port.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L21)

***

### AgentCandidateModelGrantSettleInput

> **AgentCandidateModelGrantSettleInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"settleGrant"`\]\>\[`0`\]

Defined in: [candidate-execution/protected-model-port.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L24)

***

### AgentCandidateModelGrantReservation

> **AgentCandidateModelGrantReservation** = [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

Defined in: [candidate-execution/protected-model-port.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L29)

Secret-free response from the service's reservation endpoint.

***

### AgentCandidateOutputPurpose

> **AgentCandidateOutputPurpose** = `"candidate-workspace-manifest"` \| `"candidate-workspace-archive"` \| `"task-manifest"` \| `"task-archive"` \| `"task-patch"` \| `"task-outcome"` \| `"memory-after-manifest"` \| `"memory-after-archive"` \| `"grader-evidence"` \| `"benchmark-result"` \| `"model-settlement"` \| `"trace"` \| `"run-receipt"` \| `"failure-evidence"`

Defined in: [candidate-execution/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L38)

***

### AgentCandidateModelLimits

> **AgentCandidateModelLimits** = `Pick`\<`AgentCandidateExecutionLimits`, `"maxModelCalls"` \| `"maxInputTokens"` \| `"maxOutputTokens"` \| `"maxCostUsd"`\>

Defined in: [candidate-execution/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L151)

Limits mechanically enforced by the evaluator-owned model gateway.

***

### AgentCandidateRunFinalization

> **AgentCandidateRunFinalization** = \{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceiptV2`\>; `artifacts`: \{ `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \} \| \{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateSpend` \| `null`; \}

Defined in: [candidate-execution/types.ts:535](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L535)

#### Union Members

##### Type Literal

\{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceiptV2`\>; `artifacts`: \{ `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \}

***

##### Type Literal

\{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateSpend` \| `null`; \}

###### succeeded

> **succeeded**: `false`

###### reason

> **reason**: `string`

###### partial

> **partial**: `object`

###### partial.executionId

> **executionId**: `string`

###### partial.bundleDigest

> **bundleDigest**: `Sha256Digest`

###### partial.executionPlanDigest

> **executionPlanDigest**: `Sha256Digest`

###### partial.materializationReceiptDigest

> **materializationReceiptDigest**: `Sha256Digest`

###### partial.termination?

> `optional` **termination?**: `AgentCandidateTermination`

###### usage

> **usage**: `AgentCandidateSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

***

### RetryableErrorPredicate

> **RetryableErrorPredicate** = (`err`) => `boolean`

Defined in: [conversation/call-policy.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L18)

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

#### Parameters

##### err

`unknown`

#### Returns

`boolean`

***

### RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Defined in: [conversation/call-policy.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L21)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.

***

### ForwardHeaderName

> **ForwardHeaderName** = *typeof* [`FORWARD_HEADERS`](#forward_headers)\[keyof *typeof* [`FORWARD_HEADERS`](#forward_headers)\]

Defined in: [conversation/headers.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L35)

***

### PropagatedHeaders

> **PropagatedHeaders** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [conversation/headers.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L111)

Header bag carried through `AgentBackendContext.propagatedHeaders` so
backends that opt in can merge them into their outbound HTTP requests.
Distinct from `buildForwardHeaders` so callers can attach extra
non-protocol headers (e.g. tracing) without colliding.

***

### PersonaDriver

> **PersonaDriver** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"scripted"`; `turns`: `string`[]; \}

Defined in: [conversation/run-persona.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L32)

A persona that drives the conversation: either a full driver `AgentProfile`
 (an LLM user-sim) or a deterministic script of user turns (the fast-path).

***

### AuthSource

> **AuthSource** = `"forward-user"` \| `"agent-owned"` \| ((`state`) => `"forward-user"` \| `"agent-owned"`)

Defined in: [conversation/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L68)

#### Stable

***

### TurnOrder

> **TurnOrder** = `"alternate"` \| `"round-robin"` \| ((`state`) => `number`)

Defined in: [conversation/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L74)

#### Stable

***

### HaltPredicate

> **HaltPredicate** = (`ctx`) => `boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

Defined in: [conversation/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L95)

#### Parameters

##### ctx

[`HaltContext`](#haltcontext)

#### Returns

`boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

#### Stable

***

### HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

Defined in: [conversation/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L100)

#### Stable

***

### ConversationStreamEvent

> **ConversationStreamEvent** = \{ `type`: `"conversation_start"`; `runId`: `string`; `participants`: readonly `string`[]; `seed`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"conversation_resumed"`; `runId`: `string`; `participants`: readonly `string`[]; `transcript`: readonly [`ConversationTurn`](#conversationturn)[]; `timestamp`: `string`; \} \| \{ `type`: `"turn_start"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `timestamp`: `string`; \} \| \{ `type`: `"turn_text_delta"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"turn_retry"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_end"`; `runId`: `string`; `turn`: [`ConversationTurn`](#conversationturn); `timestamp`: `string`; \} \| \{ `type`: `"conversation_end"`; `runId`: `string`; `result`: [`ConversationResult`](#conversationresult); `timestamp`: `string`; \}

Defined in: [conversation/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L237)

#### Stable

***

### Verifier

> **Verifier** = (`worktreePath`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

Defined in: [improvement/agentic-generator.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L56)

Verifies the edited worktree. Sync or async; throws only on a setup fault
 (a candidate that fails verification returns `{ok:false}`, it does not
 throw).

#### Parameters

##### worktreePath

`string`

#### Returns

`Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

***

### ImproveSurface

> **ImproveSurface** = `"prompt"` \| `"skills"` \| `"tools"` \| `"mcp"` \| `"hooks"` \| `"subagents"` \| `"agent-profile"` \| `"memory"` \| `"code"`

Defined in: [improvement/improve.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L66)

The executable agent lever `improve` optimizes. Profile fields remain
 portable AgentProfile coordinates; implementation and orchestration files
 use the code surface so a winner can be sealed into an exact candidate.

***

### ImproveOptions

> **ImproveOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SelfImproveOptions`\<`TScenario`, `TArtifact`\>, `"analyzeGeneration"` \| `"baselineSurface"` \| `"findings"` \| `"gate"` \| `"proposer"`\> & `object`

Defined in: [improvement/improve.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L77)

#### Type Declaration

##### surface?

> `optional` **surface?**: [`ImproveSurface`](#improvesurface)

Which profile lever to optimize. Default `'prompt'`. Selects the default
 generator + the baseline-surface extraction shape.

##### generator?

> `optional` **generator?**: `SurfaceProposer`

The `SurfaceProposer` that mutates the surface. When unset, the facade
 picks the default for prompt, skills, and memory; surfaces
 with no default REQUIRE this (fail-loud otherwise).

##### gate?

> `optional` **gate?**: `"holdout"` \| `"none"`

Gate mode. `'holdout'` (default) runs the held-out promotion gate;
 `'none'` is a baseline-only run (`budget.generations = 0`).

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Restrict the run to this subset of models. When set, the reflection model
 (`llm.model`, or the default when unset) must be a member, or `improve()` throws
 a `ConfigError` before the generator is built. Unset = unrestricted.

##### analyzeGeneration?

> `optional` **analyzeGeneration?**: `SelfImproveOptions`\<`TScenario`, `TArtifact`\>\[`"analyzeGeneration"`\] \| `null`

Per-generation findings producer passthrough (see selfImprove.analyzeGeneration).
 DEFAULT: the built-in failure distiller — after each generation it turns the
 worst-scoring/errored cells into structured findings ({ scenario, composite,
 notes, error }) for the NEXT proposal round, so the proposer reasons over what
 actually failed instead of a static seed. Pass your own producer (e.g. a
 trace-analyst over the runDir's traces) to replace it; pass `null` to disable
 and keep the static `findings` all the way through.

##### rawTraceContext?

> `optional` **rawTraceContext?**: `boolean`

META-HARNESS mode: instead of the ~400-char distilled findings, feed the
 proposer RAW-TRACE FILESYSTEM CONTEXT — the PATHS into the prior generation's
 real run traces under `runDir` (per-cell `spans.jsonl` event logs +
 `cached-result.json` scores + artifacts) plus a `grep`/`cat`-to-diagnose
 instruction — so the coding agent reads the actual failures itself rather than
 a pre-summary. Requires a REAL `runDir` (that is where the traces live).
 Ignored when `analyzeGeneration` is set explicitly (that wins) or is `null`
 (disabled). Equivalent to `analyzeGeneration: rawTraceDistiller()`; this flag
 is the one-line enable. Default `false` (the distiller stays the default).

##### code?

> `optional` **code?**: [`ImproveCodeOptions`](#improvecodeoptions)

CODE-surface wiring: name `surface: 'code'`, point at a repo, and the
 facade assembles the whole candidate pipeline — an isolated incumbent plus git worktrees
 (`gitWorktreeAdapter`) driven by `improvementDriver` with the full agentic
 generator (a real coding harness edits each candidate worktree; a `verify`
 hook gates candidates before they are ever measured). Ignored when
 `opts.generator` is supplied. Required for every code run because a real
 repository and base ref are necessary to measure the incumbent.

##### skills?

> `optional` **skills?**: [`ImproveSkillsOptions`](#improveskillsoptions)

SKILLS-surface wiring for real skill-DOCUMENT optimization. Without this,
 `surface: 'skills'` optimizes the profile's skills REFS array (file pointers)
 — which `skillOptProposer` (a document patcher) cannot meaningfully edit.
 Provide the document CONTENT to optimize + a `writeBack` to persist the
 shipped winner (the profile ref points at a file the caller owns). This is
 what makes skillOpt reachable through improve().

##### memory?

> `optional` **memory?**: [`ImproveMemoryOptions`](#improvememoryoptions)

MEMORY-surface wiring for a curated durable memory document. The default
 deterministic proposer deduplicates and ranks lessons from findings, then
 replaces its managed block instead of growing memory without bound.

##### promotionGate?

> `optional` **promotionGate?**: `SelfImproveOptions`\<`TScenario`, `TArtifact`\>\[`"gate"`\]

Custom held-back-exam decision. The string `gate` above controls whether
 the exam runs; this callback controls how its evidence decides promotion.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ProfileDiffProposerContext

> **ProfileDiffProposerContext**\<`TFindings`\> = `ProposeContext`\<`TFindings`\> & `object`

Defined in: [improvement/profile-diff-proposer.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L26)

#### Type Declaration

##### profile

> **profile**: `AgentProfile`

#### Type Parameters

##### TFindings

`TFindings` = `unknown`

***

### KnowledgeReadinessCheckResult

> **KnowledgeReadinessCheckResult** = `boolean` \| \{ `ready`: `boolean`; `summary?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; \}

Defined in: [knowledge/supervised-update.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L30)

***

### KnowledgeReadinessCheck

> **KnowledgeReadinessCheck** = (`input`) => `Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

Defined in: [knowledge/supervised-update.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L38)

#### Parameters

##### input

[`KnowledgeReadinessCheckInput`](#knowledgereadinesscheckinput)

#### Returns

`Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

***

### SupervisedKnowledgeUpdater

> **SupervisedKnowledgeUpdater** = (`input`) => `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

Defined in: [knowledge/supervised-update.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L86)

#### Parameters

##### input

[`SupervisedKnowledgeUpdateInput`](#supervisedknowledgeupdateinput)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### DelegatedLoopMode

> **DelegatedLoopMode** = *typeof* [`DELEGATED_LOOP_MODES`](#delegated_loop_modes)\[`number`\]

Defined in: [loop-runner.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L50)

**`Experimental`**

***

### DelegatedLoopRunner

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

Defined in: [loop-runner.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L59)

**`Experimental`**

A pre-configured loop for one mode. Returns the mode's raw
 output; the dispatcher wraps it in a [DelegatedLoopResult](#delegatedloopresult).

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`T`\>

***

### DelegatedLoopRegistry

> **DelegatedLoopRegistry** = `Partial`\<`Record`\<[`DelegatedLoopMode`](#delegatedloopmode), [`DelegatedLoopRunner`](#delegatedlooprunner)\>\>

Defined in: [loop-runner.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L63)

**`Experimental`**

Mode → configured runner. Partial: only register the modes a
 given product/routine actually uses.

***

### AgentBackendKind

> **AgentBackendKind** = `"router"` \| `"tcloud"` \| `"cli-bridge"` \| `"sandbox"`

Defined in: [resolve-agent-backend.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L38)

The transport a chat backend runs on.

***

### RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

Defined in: [runtime-hooks.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L10)

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.

***

### RuntimeHookTarget

> **RuntimeHookTarget** = `"agent.run"` \| `"agent.turn"` \| `"agent.tool_call"` \| `"agent.spawn"` \| `"agent.child"` \| `"agent.plan"` \| `"agent.decision"` \| `string` & `object`

Defined in: [runtime-hooks.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L12)

***

### RuntimeDecisionKind

> **RuntimeDecisionKind** = `"continue"` \| `"verify"` \| `"ask"` \| `"retry"` \| `"stop"` \| `"memory-write"` \| `"memory-read"` \| `"tool-select"` \| `"skill-select"` \| `"workflow-select"` \| `"surface-promote"` \| `string` & `object`

Defined in: [runtime-hooks.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L22)

***

### ToolCallOutcome

> **ToolCallOutcome** = \{ `ok`: `true`; `result`: `unknown`; \} \| \{ `ok`: `false`; `code`: `string`; `message`: `string`; `status?`: `number`; \}

Defined in: [tool-loop.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L30)

Outcome of one tool dispatch — structurally compatible with a hub/integration
 tool-outcome union, so callers can fold either through the loop.

***

### ToolLoopMessage

> **ToolLoopMessage** = `object`

Defined in: [tool-loop.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L68)

A message in the running conversation the loop sends to `streamTurn`.

The base `{ role, content }` covers `system` / `user` / plain `assistant`
turns. Two optional fields carry the OpenAI function-calling contract so a
strict model (Claude, and any OpenAI-compatible provider that validates tool
history) reads its own tool use back instead of re-issuing the same call:

  - an assistant turn that emitted tool calls carries `tool_calls`, and its
    `content` is `null` when the turn was tool-only;
  - each tool result is its own `{ role: 'tool', tool_call_id, content }`
    message keyed to the call that produced it.

Widening is additive: a `streamTurn` that reads only `role` + `content` still
works; one that forwards the whole message to an OpenAI-compatible endpoint
now sends correct tool history.

#### Properties

##### role

> **role**: `string`

Defined in: [tool-loop.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L69)

##### content

> **content**: `string` \| `null`

Defined in: [tool-loop.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L70)

##### tool\_calls?

> `optional` **tool\_calls?**: [`ToolLoopAssistantToolCall`](#toolloopassistanttoolcall)[]

Defined in: [tool-loop.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L71)

##### tool\_call\_id?

> `optional` **tool\_call\_id?**: `string`

Defined in: [tool-loop.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L72)

***

### ToolLoopEvent

> **ToolLoopEvent** = \{ `type`: `"text"`; `text`: `string`; \} \| \{ `type`: `"tool_call"`; `call`: [`ToolLoopCall`](#toolloopcall); \} \| \{ `type`: `"other"`; `event`: `unknown`; \}

Defined in: [tool-loop.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L108)

***

### ToolLoopStopReason

> **ToolLoopStopReason** = `"completed"` \| `"stuck-loop"` \| `"backstop"` \| `"deadline"` \| `"budget"`

Defined in: [tool-loop.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L118)

Why the loop stopped. `completed` = model finished naturally; `stuck-loop` =
 ≥3 consecutive identical tool calls (same tool + args); `backstop` = hit the
 runaway-backstop cap (200 by default); `deadline` = wall-clock deadlineMs
 exceeded; `budget` = maxCostUsd exhausted. Non-`completed` stops are infra /
 resource outcomes — eval scoring must distinguish them from capability failure.

***

### StreamToolLoopYield

> **StreamToolLoopYield**\<`Raw`\> = \{ `kind`: `"event"`; `event`: `Raw`; \} \| \{ `kind`: `"tool_result"`; `toolName`: `string`; `toolCallId?`: `string`; `label`: `string`; `outcome`: [`ToolCallOutcome`](#toolcalloutcome); \} \| \{ `kind`: `"capped"`; `pending`: `number`; `stopReason`: `Exclude`\<[`ToolLoopStopReason`](#toolloopstopreason), `"completed"`\>; \}

Defined in: [tool-loop.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L298)

#### Type Parameters

##### Raw

`Raw`

***

### AgentTaskStatus

> **AgentTaskStatus** = `"completed"` \| `"blocked"` \| `"failed"` \| `"aborted"`

Defined in: [types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L145)

#### Stable

***

### AgentRuntimeEvent

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; \}

Defined in: [types.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L148)

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Stable

***

### AgentRuntimeEventSink

> **AgentRuntimeEventSink**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = (`event`) => `Promise`\<`void`\> \| `void`

Defined in: [types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L189)

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<`void`\> \| `void`

#### Stable

***

### OpenAIChatToolChoice

> **OpenAIChatToolChoice** = `"auto"` \| `"none"` \| `"required"` \| \{ `type`: `"function"`; `function`: \{ `name`: `string`; \}; \}

Defined in: [types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L260)

`tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
spec: `'auto'` (default — model decides), `'none'` (disable tool calling
for this turn), `'required'` (force a tool call), or a specific function
pin `{ type: 'function', function: { name } }`.

#### Stable

***

### OpenAIChatResponseFormat

> **OpenAIChatResponseFormat** = \{ `type`: `"text"`; \} \| \{ `type`: `"json_object"`; \} \| \{ `type`: `"json_schema"`; `json_schema`: `Record`\<`string`, `unknown`\>; \}

Defined in: [types.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L274)

`response_format` parameter for OpenAI-compatible chat endpoints. Use
`json_object` when the caller needs syntactically valid JSON, or
`json_schema` when the upstream provider supports schema-constrained JSON.

#### Stable

***

### RuntimeStreamEvent

> **RuntimeStreamEvent** = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

Defined in: [types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L280)

#### Union Members

##### Type Literal

\{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

###### type

> **type**: `"backend_error"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: `RuntimeSession`

###### backend

> **backend**: `string`

###### message

> **message**: `string`

###### recoverable

> **recoverable**: `boolean`

###### error?

> `optional` **error?**: [`BackendErrorDetail`](#backenderrordetail)

Typed transport diagnostic. Present when the upstream returned a
non-success HTTP status or every retry attempt threw. Consumers MUST
surface this onto their `RunRecord.error` — silently treating a
`backend_error` as "no output" hides credit exhaustion, auth failure,
and upstream outages from operators.
 - `kind: 'transport'` — HTTP / network failure with optional `status`
   + truncated response `body`.
 - `kind: 'backend'` — the backend's `stream()` generator threw for a
   reason that isn't a recognized transport failure.

###### timestamp

> **timestamp**: `string`

***

##### Type Literal

\{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

###### type

> **type**: `"final"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: `RuntimeSession`

###### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

###### reason

> **reason**: `string`

###### text?

> `optional` **text?**: `string`

###### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

###### error?

> `optional` **error?**: [`BackendErrorDetail`](#backenderrordetail)

Typed terminal-error diagnostic. Mirrors the `backend_error.error`
shape so a consumer that only listens for `final` still receives a
loud, structured failure when the backend never produced output. Only
set when `status !== 'completed'`. Consumers building a `RunRecord`
MUST map this to `RunRecord.error` rather than recording silent
`error: null` with empty `finalText`.

###### timestamp

> **timestamp**: `string`

#### Stable

## Variables

### CANDIDATE\_TRACE\_TAGS

> `const` **CANDIDATE\_TRACE\_TAGS**: `object`

Defined in: [candidate-execution/types.ts:561](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L561)

Protected trace tags that bind a run to one prepared candidate execution.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `"tangle.candidate.execution_id"` = `'tangle.candidate.execution_id'`

##### bundleDigest

> `readonly` **bundleDigest**: `"tangle.candidate.bundle_digest"` = `'tangle.candidate.bundle_digest'`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `"tangle.candidate.execution_plan_digest"` = `'tangle.candidate.execution_plan_digest'`

##### materializationReceiptDigest

> `readonly` **materializationReceiptDigest**: `"tangle.candidate.materialization_receipt_digest"` = `'tangle.candidate.materialization_receipt_digest'`

***

### CANDIDATE\_TRACE\_ENV

> `const` **CANDIDATE\_TRACE\_ENV**: `object`

Defined in: [candidate-execution/types.ts:569](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L569)

Environment keys used to propagate immutable candidate trace identity.

#### Type Declaration

##### executionId

> `readonly` **executionId**: `"TANGLE_CANDIDATE_EXECUTION_ID"` = `'TANGLE_CANDIDATE_EXECUTION_ID'`

##### bundleDigest

> `readonly` **bundleDigest**: `"TANGLE_CANDIDATE_BUNDLE_DIGEST"` = `'TANGLE_CANDIDATE_BUNDLE_DIGEST'`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `"TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST"` = `'TANGLE_CANDIDATE_EXECUTION_PLAN_DIGEST'`

##### materializationReceiptDigest

> `readonly` **materializationReceiptDigest**: `"TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST"` = `'TANGLE_CANDIDATE_MATERIALIZATION_RECEIPT_DIGEST'`

##### traceRunId

> `readonly` **traceRunId**: `"TANGLE_TRACE_RUN_ID"` = `'TANGLE_TRACE_RUN_ID'`

***

### defaultIsRetryable

> `const` **defaultIsRetryable**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [conversation/call-policy.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L65)

Default retryable classification — network/timeout class errors. Errors
a model deliberately throws (validation, refusal, 4xx) are not retried;
those represent real outcomes, not transient infrastructure faults.

***

### FORWARD\_HEADERS

> `const` **FORWARD\_HEADERS**: `object`

Defined in: [conversation/headers.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L20)

Standard names — lowercased so Headers maps interop on every runtime.

#### Type Declaration

##### authorization

> `readonly` **authorization**: `"x-tangle-forwarded-authorization"` = `'x-tangle-forwarded-authorization'`

Forwarded original-user identity (`Bearer sk-tan-<user>`); downstream gateways bill against this.

##### depth

> `readonly` **depth**: `"x-tangle-forwarded-depth"` = `'x-tangle-forwarded-depth'`

Monotonically incremented on every gateway hop. Refused at MAX_DEPTH.

##### runId

> `readonly` **runId**: `"x-tangle-runid"` = `'x-tangle-runid'`

Top-level conversation run identifier, propagated through every nested call.

##### turnId

> `readonly` **turnId**: `"x-tangle-turnid"` = `'x-tangle-turnid'`

This call's turn within the run; deterministic + stable across retries.

##### parentTurnId

> `readonly` **parentTurnId**: `"x-tangle-parent-turnid"` = `'x-tangle-parent-turnid'`

When the call is *inside* another turn (recursion), the parent turn's id.

##### speaker

> `readonly` **speaker**: `"x-tangle-speaker"` = `'x-tangle-speaker'`

Logical conversation peer label at the sending side, for trace stitching.

***

### DEFAULT\_MAX\_DEPTH

> `const` **DEFAULT\_MAX\_DEPTH**: `4` = `4`

Defined in: [conversation/headers.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L38)

Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded.

***

### RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT

> `const` **RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT**: `string`

Defined in: [knowledge/supervised-update.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L9)

Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers.

***

### DELEGATED\_LOOP\_MODES

> `const` **DELEGATED\_LOOP\_MODES**: readonly \[`"code"`, `"review"`, `"research"`, `"audit"`, `"self-improve"`\]

Defined in: [loop-runner.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L47)

**`Experimental`**

All valid delegated-loop mode names — used for validation and CLI surfaces.

***

### DEFAULT\_ROUTER\_BASE\_URL

> `const` **DEFAULT\_ROUTER\_BASE\_URL**: `"https://router.tangle.tools"` = `'https://router.tangle.tools'`

Defined in: [model-resolution.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L43)

Default Tangle Router base URL used when no env override is set.

***

### INTELLIGENCE\_WIRE\_VERSION

> `const` **INTELLIGENCE\_WIRE\_VERSION**: `"2026-05-26.v1"` = `'2026-05-26.v1'`

Defined in: [otel-export.ts:665](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L665)

Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body).

## Functions

### createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [backends.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L30)

Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### kind

`string`

###### start?

(`input`, `context`) => `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

###### resume?

(`session`, `input`, `context`) => `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

###### stream

(`input`, `context`) => `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

###### stop?

(`session`, `reason`) => `void` \| `Promise`\<`void`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

#### Stable

***

### createSandboxPromptBackend()

> **createSandboxPromptBackend**\<`TBox`, `TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [backends.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L41)

Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call.

#### Type Parameters

##### TBox

`TBox`

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### kind?

`string`

###### getBox

###### streamPrompt

###### mapEvent?

(`event`, `context`) => [`RuntimeStreamEvent`](#runtimestreamevent) \| `undefined`

###### getSessionId?

(`box`, `input`) => `string` \| `undefined`

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

#### Stable

***

### createOpenAICompatibleBackend()

> **createOpenAICompatibleBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [backends.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L208)

OpenAI-compat streaming backend. Routes `runAgentTaskStream` through any
`POST /chat/completions` endpoint that speaks OpenAI's SSE protocol —
Tangle Router, OpenAI direct, OpenRouter, Groq, DeepSeek, Together. The
router also fronts Anthropic models in Anthropic-native SSE shape; this
backend handles both.

### Tool calls

Pass `tools` (and optionally `toolChoice`) to forward an OpenAI Chat
Completions `tools[]` array on every request. Streamed `tool_call` chunks
are buffered until the model finalizes them (either `finish_reason:
'tool_calls'` for OpenAI shape or a `content_block_stop` for Anthropic
`tool_use` blocks proxied through the router), then emitted as a single
`tool_call` RuntimeStreamEvent with the assembled `args`.

The backend does NOT execute tools — it surfaces calls for the caller's
own dispatcher (typically the product's MCP / sandbox runtime) to fulfill
and feed back as a subsequent `messages` turn. This keeps the transport
thin and lets the agent host own tool dispatch policy.

### Fail-loud errors

Non-success HTTP responses (4xx/5xx) and exhausted retry budgets throw
`BackendTransportError` from inside the `stream()` generator. The runtime
catches the throw, yields a `backend_error` with a typed `error` field
(`kind`, `status`, truncated `body`) and a terminal `final` event with
`status: 'failed'` carrying the same detail. Consumers MUST map
`final.error` onto their `RunRecord.error` — silently treating an empty
`finalText` as "agent produced nothing" hides credit exhaustion, auth
failure, and upstream outages.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### apiKey

`string`

###### baseUrl

`string`

###### model

`string`

###### kind?

`string`

###### tools?

readonly [`OpenAIChatTool`](#openaichattool)[]

OpenAI Chat Completions `tools[]` definitions surfaced to the model on
every request. Omit to send a tool-free request (existing behavior).
The runtime makes no assumption about the dispatcher — calls stream out
as `tool_call` events and the caller is responsible for executing them
and feeding `tool_result` messages back on a follow-up turn.

###### toolChoice?

[`OpenAIChatToolChoice`](#openaichattoolchoice)

OpenAI Chat Completions `tool_choice`. Default `undefined` (request
omits the field; provider falls back to its own default — typically
`'auto'`).

###### responseFormat?

[`OpenAIChatResponseFormat`](#openaichatresponseformat)

OpenAI Chat Completions `response_format`. Omit for provider default text.

###### temperature?

`number`

OpenAI Chat Completions `temperature`. Omit for provider default.

###### maxTokens?

`number`

Maximum completion tokens, sent as OpenAI-compatible `max_tokens`. Omit for provider default.

###### fetchImpl?

(`input`, `init?`) => `Promise`\<`Response`\>

###### retry?

`BackendRetryPolicy`

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

#### Stable

***

### buildAgentCandidateBundle()

> **buildAgentCandidateBundle**(`input`): `AgentCandidateBundleV1`

Defined in: [candidate-execution/builder.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L76)

Compile one measured profile/code candidate into the immutable execution
contract. Code bytes are re-read and verified by agent-eval before they are
embedded. The returned bundle is schema-validated, canonically digested, and
deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
to re-read external knowledge, memory, repository, and workspace artifacts.

#### Parameters

##### input

[`BuildAgentCandidateBundleInput`](#buildagentcandidatebundleinput)

#### Returns

`AgentCandidateBundleV1`

***

### sealAgentCandidateBundle()

> **sealAgentCandidateBundle**(`input`): `AgentCandidateBundleV1`

Defined in: [candidate-execution/bundle.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/bundle.ts#L10)

Validate and content-address a candidate bundle before it crosses an approval boundary.

#### Parameters

##### input

[`AgentCandidateBundleInput`](#agentcandidatebundleinput)

#### Returns

`AgentCandidateBundleV1`

***

### candidateExecutionClaim()

> **candidateExecutionClaim**(`prepared`): [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

Defined in: [candidate-execution/claim-plan.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-plan.ts#L10)

Extract the complete durable claim from a prepared execution.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

#### Returns

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

***

### disposePreparedAgentCandidateExecution()

> **disposePreparedAgentCandidateExecution**(`prepared`, `options?`): `Promise`\<\{ `disposed`: `true`; \}\>

Defined in: [candidate-execution/dispose.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L15)

Revoke reservations held by a prepared candidate that will not be executed.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options?

[`DisposePreparedAgentCandidateOptions`](#disposepreparedagentcandidateoptions) = `{}`

#### Returns

`Promise`\<\{ `disposed`: `true`; \}\>

***

### executePreparedAgentCandidate()

> **executePreparedAgentCandidate**(`prepared`, `options`): `Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

Defined in: [candidate-execution/execute.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L75)

Executes and finalizes one durably claimed candidate without exposing an unproven result.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options

[`ExecutePreparedAgentCandidateOptions`](#executepreparedagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

***

### persistCandidateOutputArtifact()

> **persistCandidateOutputArtifact**(`port`, `input`): `Promise`\<`AgentCandidateArtifactRef`\>

Defined in: [candidate-execution/output-artifacts.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/output-artifacts.ts#L11)

Persist evaluator evidence, read it back, and bind the returned locator to the exact bytes.

#### Parameters

##### port

[`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

##### input

###### executionId

`string`

###### purpose

[`AgentCandidateOutputPurpose`](#agentcandidateoutputpurpose)

###### bytes

`Uint8Array`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<`AgentCandidateArtifactRef`\>

***

### prepareAgentCandidateExecution()

> **prepareAgentCandidateExecution**(`candidate`, `task`, `ports`, `options?`): `Promise`\<[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)\>

Defined in: [candidate-execution/prepare.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L98)

Materializes a verified candidate into one immutable evaluator-owned execution plan.

#### Parameters

##### candidate

[`VerifiedAgentCandidate`](#verifiedagentcandidate)

##### task

[`AgentCandidateTaskExecution`](#agentcandidatetaskexecution)

##### ports

[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

##### options?

[`PrepareAgentCandidateExecutionOptions`](#prepareagentcandidateexecutionoptions) = `{}`

#### Returns

`Promise`\<[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)\>

***

### parseExactAgentProfile()

> **parseExactAgentProfile**(`input`, `label`): `AgentProfile`

Defined in: [candidate-execution/profile.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L96)

Parse a complete profile without silently discarding unsupported fields.

#### Parameters

##### input

`unknown`

##### label

`string`

#### Returns

`AgentProfile`

***

### parseExactAgentProfileDiff()

> **parseExactAgentProfileDiff**(`input`, `label`): `AgentProfileDiff`

Defined in: [candidate-execution/profile.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L103)

Parse a profile diff without silently discarding unsupported fields.

#### Parameters

##### input

`unknown`

##### label

`string`

#### Returns

`AgentProfileDiff`

***

### applyExactAgentProfileDiff()

> **applyExactAgentProfileDiff**(`baseInput`, `diffInput`, `label`): `AgentProfile`

Defined in: [candidate-execution/profile.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L110)

Apply one exact diff and reject any value that cannot be preserved canonically.

#### Parameters

##### baseInput

`unknown`

##### diffInput

`unknown`

##### label

`string`

#### Returns

`AgentProfile`

***

### createProtectedAgentCandidateModelPort()

> **createProtectedAgentCandidateModelPort**(`options`): [`AgentCandidateModelPort`](#agentcandidatemodelport)

Defined in: [candidate-execution/protected-model-port.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L90)

Bind a protected model-grant service to the immutable candidate runtime.

The service remains the authority for expiry, admission, revocation, and
metering. This adapter independently checks every response before allowing
it to cross into candidate execution or durable receipt finalization.

#### Parameters

##### options

[`CreateProtectedAgentCandidateModelPortOptions`](#createprotectedagentcandidatemodelportoptions)

#### Returns

[`AgentCandidateModelPort`](#agentcandidatemodelport)

***

### recoverExpiredAgentCandidateExecution()

> **recoverExpiredAgentCandidateExecution**(`options`): `Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

Defined in: [candidate-execution/recover.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L36)

Close an expired crashed attempt from persisted non-secret handles, then record failure.

#### Parameters

##### options

[`RecoverExpiredAgentCandidateOptions`](#recoverexpiredagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### verifyAgentCandidateBundle()

> **verifyAgentCandidateBundle**(`input`, `ports`): `Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

Defined in: [candidate-execution/verify.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/verify.ts#L37)

Verifies every digest, resource, workspace, and Git object in a candidate bundle.

#### Parameters

##### input

`unknown`

##### ports

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Returns

`Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

***

### captureAgentCandidateWorkspace()

> **captureAgentCandidateWorkspace**(`rootInput`, `options?`): `Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

Defined in: [candidate-execution/workspace-archive.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L116)

Capture one exact regular-file workspace for immutable candidate execution.

#### Parameters

##### rootInput

`string`

##### options?

[`CaptureAgentCandidateWorkspaceOptions`](#captureagentcandidateworkspaceoptions) = `{}`

#### Returns

`Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

***

### captureAgentCandidateWorkspaceFiles()

> **captureAgentCandidateWorkspaceFiles**(`input`, `options?`): `Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

Defined in: [candidate-execution/workspace-archive.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L137)

Capture detached files returned by a remote executor into the standard archive.

#### Parameters

##### input

readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

##### options?

`Omit`\<[`CaptureAgentCandidateWorkspaceOptions`](#captureagentcandidateworkspaceoptions), `"includeRepository"`\> = `{}`

#### Returns

`Promise`\<[`CapturedAgentCandidateWorkspace`](#capturedagentcandidateworkspace)\>

***

### createAgentCandidateWorkspacePort()

> **createAgentCandidateWorkspacePort**(`options?`): [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

Defined in: [candidate-execution/workspace-archive.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L199)

Create the standard bounded materializer for candidate execution ports.

#### Parameters

##### options?

[`CreateAgentCandidateWorkspacePortOptions`](#createagentcandidateworkspaceportoptions) = `{}`

#### Returns

[`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

***

### makePerAttemptSignal()

> **makePerAttemptSignal**(`parentSignal`, `deadlineMs`): `object`

Defined in: [conversation/call-policy.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L129)

Build a per-attempt AbortSignal linked to the parent signal AND fired when
the deadline elapses. The returned `dispose()` MUST be called in a
`finally` (clears the timer, detaches the listener) so we don't leak.

When the deadline fires, the signal's `reason` is a `DeadlineExceededError`
— callers can detect timeout-vs-cancel by reading `signal.reason` after
the underlying operation throws.

#### Parameters

##### parentSignal

`AbortSignal` \| `undefined`

##### deadlineMs

`number` \| `undefined`

#### Returns

`object`

##### signal

> **signal**: `AbortSignal`

##### dispose

> **dispose**: () => `void`

###### Returns

`void`

##### getDeadlineError()

> **getDeadlineError**(): [`DeadlineExceededError`](#deadlineexceedederror) \| `undefined`

###### Returns

[`DeadlineExceededError`](#deadlineexceedederror) \| `undefined`

***

### computeBackoff()

> **computeBackoff**(`spec`, `attempt`): `number`

Defined in: [conversation/call-policy.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L169)

Compute the delay before the next attempt. Default: 250ms exponential with jitter.

#### Parameters

##### spec

[`RetryBackoff`](#retrybackoff) \| `undefined`

##### attempt

`number`

#### Returns

`number`

***

### sleep()

> **sleep**(`ms`): `Promise`\<`void`\>

Defined in: [conversation/call-policy.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L180)

Resolve after `ms` milliseconds — used for retry backoff in conversation call policy.

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### createConversationBackend()

> **createConversationBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/conversation-backend.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/conversation-backend.ts#L29)

#### Parameters

##### options

###### conversation

[`Conversation`](#conversation)

###### kind?

`string`

Optional backend kind label. Defaults to `'conversation'`.

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

***

### defineConversation()

> **defineConversation**(`input`): [`Conversation`](#conversation)

Defined in: [conversation/define-conversation.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/define-conversation.ts#L14)

#### Parameters

##### input

###### participants

[`ConversationParticipant`](#conversationparticipant)[]

###### policy

[`ConversationPolicy`](#conversationpolicy)

#### Returns

[`Conversation`](#conversation)

***

### readDepth()

> **readDepth**(`headers`): `number`

Defined in: [conversation/headers.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L53)

Read the depth counter off an inbound request. Missing → 0 (caller is the
origin). Non-integer → throws — silent coercion would let a bad caller
reset depth and bypass the limit.

#### Parameters

##### headers

`Readonly`\<`Record`\<`string`, `string` \| `string`[] \| `undefined`\>\>

#### Returns

`number`

***

### isDepthExceeded()

> **isDepthExceeded**(`inboundDepth`, `max?`): `boolean`

Defined in: [conversation/headers.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L71)

Refuse further forwarding when the inbound depth has reached the limit.
Callers (the gateway middleware) translate the boolean to an HTTP 413.

#### Parameters

##### inboundDepth

`number`

##### max?

`number` = `DEFAULT_MAX_DEPTH`

#### Returns

`boolean`

***

### buildForwardHeaders()

> **buildForwardHeaders**(`input`): `Record`\<`string`, `string`\>

Defined in: [conversation/headers.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L82)

Build the headers to emit on an outbound participant call, given the
conversation's propagation context. Depth is incremented from the inbound
value; runId / turnId / speaker stamp the current hop; the user's
`Authorization` is preserved verbatim so the downstream gateway bills the
right wallet.

#### Parameters

##### input

###### inboundDepth

`number`

###### forwardedAuthorization?

`string`

###### runId

`string`

###### turnId

`string`

###### parentTurnId?

`string`

###### speaker

`string`

#### Returns

`Record`\<`string`, `string`\>

***

### d1ToSqlAdapter()

> **d1ToSqlAdapter**(`db`): [`SqlAdapter`](#sqladapter)

Defined in: [conversation/journal-sql.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L61)

Adapt a Cloudflare D1 binding to the SqlAdapter shape. Lives here so D1
consumers don't have to write the wrapper themselves; the runtime never
imports `@cloudflare/workers-types` directly (peer-style typing).

#### Parameters

##### db

[`D1DatabaseLike`](#d1databaselike)

#### Returns

[`SqlAdapter`](#sqladapter)

***

### runConversation()

> **runConversation**(`conversation`, `options`): `Promise`\<[`ConversationResult`](#conversationresult)\>

Defined in: [conversation/run-conversation.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L65)

#### Parameters

##### conversation

[`Conversation`](#conversation)

##### options

[`RunConversationOptions`](#runconversationoptions)

#### Returns

`Promise`\<[`ConversationResult`](#conversationresult)\>

***

### runConversationStream()

> **runConversationStream**(`conversation`, `options`): `AsyncIterable`\<[`ConversationStreamEvent`](#conversationstreamevent)\>

Defined in: [conversation/run-conversation.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L84)

Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers.

#### Parameters

##### conversation

[`Conversation`](#conversation)

##### options

[`RunConversationOptions`](#runconversationoptions)

#### Returns

`AsyncIterable`\<[`ConversationStreamEvent`](#conversationstreamevent)\>

***

### runPersonaConversation()

> **runPersonaConversation**(`opts`): `Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

Defined in: [conversation/run-persona.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L133)

Run one worker profile against one persona as a multi-round conversation.
The persona leads (participant 0): it speaks, the worker answers, repeat,
until `maxTurns`. Returns the persistent transcript + worker-only usage.

#### Parameters

##### opts

[`RunPersonaConversationOptions`](#runpersonaconversationoptions)

#### Returns

`Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

***

### runPersonaDispatch()

> **runPersonaDispatch**\<`TScenario`, `TArtifact`\>(`config`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: [conversation/run-persona.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L219)

Wrap [runPersonaConversation](#runpersonaconversation) as a `ProfileDispatchFn` for
`runProfileMatrix`: the profile axis is the worker-under-test, the scenario
axis is the persona, and the runner is the cell. Meters the worker through
`ctx.cost` so the matrix's backend-integrity guard sees real usage.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### config

[`RunPersonaConfig`](#runpersonaconfig)\<`TScenario`, `TArtifact`\>

#### Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

***

### turnId()

> **turnId**(`runId`, `index`, `speaker`): `string`

Defined in: [conversation/turn-id.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L15)

Deterministic turn identifier. Stable across retries of the same logical
turn so backends (and any caching gateway in between) can dedupe on it.
A retry triggered by a network blip or deadline timeout MUST produce the
same `turn_id`; only the underlying attempt count differs.

Shape: `${runId}.t${index}.${speakerSlug}` — readable in logs, sortable by
turn index, attributable to a speaker. Slugify keeps the speaker portion
URL-safe so it can ride in HTTP headers without escaping.

#### Parameters

##### runId

`string`

##### index

`number`

##### speaker

`string`

#### Returns

`string`

#### Stable

***

### slugifySpeaker()

> **slugifySpeaker**(`speaker`): `string`

Defined in: [conversation/turn-id.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L25)

Reduce a speaker name to ASCII alphanumerics + dashes. Preserves enough
substance to read in a log line; collisions between speakers within a
single Conversation are prevented by `defineConversation`'s
unique-name check, so the slug only needs to be deterministic, not unique.

#### Parameters

##### speaker

`string`

#### Returns

`string`

***

### handleChatTurn()

> **handleChatTurn**(`input`): [`ChatTurnResult`](#chatturnresult)

Defined in: [durable/chat-engine.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L110)

Run one chat turn. Returns immediately with a `ReadableStream` body;
the turn executes as the body is pulled. Never rejects — backend
failures surface as `error` + `session.run.failed` events.

#### Parameters

##### input

[`RunChatTurnInput`](#runchatturninput)

#### Returns

[`ChatTurnResult`](#chatturnresult)

***

### deriveExecutionId()

> **deriveExecutionId**(`input`): `string`

Defined in: [durable/execution-handle.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/execution-handle.ts#L17)

Derive a stable executionId from the run identity. The same
`(projectId, sessionId, turnIndex)` tuple yields the same id — so a
client retry of the same turn lands on the same substrate execution
and the orchestrator's buffer replays instead of starting a second
prompt.

Format is readable, not hashed: operators grepping orchestrator logs
for `gtm-agent:thread-abc:3` find the run without translating an
opaque id. Substrate executionIds are not a secrecy boundary.

Wire integration:
  - Sandbox PromptOptions accepts `executionId` and `lastEventId`.
    Products pass this id to make cross-process reconnect land on the
    same substrate execution instead of spawning a duplicate run.

#### Parameters

##### input

###### projectId

`string`

###### sessionId

`string`

###### turnIndex

`number`

#### Returns

`string`

***

### agenticGenerator()

> **agenticGenerator**(`opts?`): [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/agentic-generator.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L79)

Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place.

#### Parameters

##### opts?

[`AgenticGeneratorOptions`](#agenticgeneratoroptions) = `{}`

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

Defined in: [improvement/agentic-generator.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L247)

A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 FAILED candidate (a change that hangs the build is a bad change); a missing
 binary or spawn fault throws (a setup bug, not a failed candidate — no
 silent fallback).

#### Parameters

##### command

`string`

##### args?

`string`[] = `[]`

##### timeoutMs?

`number` = `300_000`

#### Returns

[`Verifier`](#verifier)

***

### toolBuildPrompt()

> **toolBuildPrompt**(`args`): `string`

Defined in: [improvement/build-prompts.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L31)

Build the starting instruction for a coder agent tasked with implementing a new tool.

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### mcpBuildPrompt()

> **mcpBuildPrompt**(`args`): `string`

Defined in: [improvement/build-prompts.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L45)

Build the starting instruction for a coder agent tasked with implementing a new MCP server.

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### applyImprovementWinnerToProfile()

> **applyImprovementWinnerToProfile**(`profile`, `surface`, `winner`): `AgentProfile`

Defined in: [improvement/improve.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L398)

Apply a promoted winner surface back into the profile field for `surface`.
 Returns a shallow copy; never mutates the input profile.

#### Parameters

##### profile

`AgentProfile`

##### surface

[`ImproveSurface`](#improvesurface)

##### winner

`MutableSurface`

#### Returns

`AgentProfile`

***

### improve()

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `findings`, `opts`): `Promise`\<[`ImproveResult`](#improveresult)\<`TScenario`, `TArtifact`\>\>

Defined in: [improvement/improve.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L461)

Run the held-out-gated self-improvement loop on ONE profile surface.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### profile

`AgentProfile`

##### findings

`unknown`[]

##### opts

[`ImproveOptions`](#improveoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ImproveResult`](#improveresult)\<`TScenario`, `TArtifact`\>\>

#### Example

```ts
Optimize the system prompt, default holdout gate:

  const out = await improve(profile, findings, {
    surface: 'prompt',
    scenarios,
    judge,
    agent: (surface, scenario, ctx) => runAgent(surface, scenario, ctx.signal),
  })
  if (out.shipped) deploy(out.profile)
```

***

### improvementDriver()

> **improvementDriver**(`opts`): [`ManagedImprovementDriver`](#managedimprovementdriver)

Defined in: [improvement/improvement-driver.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L79)

The one reflective/agentic improvement proposer (`SurfaceProposer`): owns the candidate worktree lifecycle and delegates HOW a change is produced to a pluggable `CandidateGenerator`.

#### Parameters

##### opts

[`ImprovementDriverOptions`](#improvementdriveroptions)

#### Returns

[`ManagedImprovementDriver`](#managedimprovementdriver)

***

### mcpServeVerifier()

> **mcpServeVerifier**(`spec`): [`Verifier`](#verifier)

Defined in: [improvement/mcp-serve-verifier.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L44)

Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools.

#### Parameters

##### spec

[`McpServeSpec`](#mcpservespec)

#### Returns

[`Verifier`](#verifier)

***

### profileDiffProposer()

> **profileDiffProposer**\<`TFindings`\>(`options`): `SurfaceProposer`\<`TFindings`\>

Defined in: [improvement/profile-diff-proposer.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-diff-proposer.ts#L41)

Turn exact AgentProfileDiffs from any source into full profile candidates for
the shared optimization loop. Research, catalogs, humans, and trace miners
differ only in `proposeDiffs`; measurement and promotion stay identical.

#### Type Parameters

##### TFindings

`TFindings` = `unknown`

#### Parameters

##### options

[`ProfileDiffProposerOptions`](#profilediffproposeroptions)\<`TFindings`\>

#### Returns

`SurfaceProposer`\<`TFindings`\>

***

### rawTraceDistiller()

> **rawTraceDistiller**\<`TScenario`, `TArtifact`\>(`options?`): (`input`) => `Promise`\<`unknown`[]\>

Defined in: [improvement/raw-trace-distiller.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L88)

Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
grep/cat-to-diagnose instruction — instead of a pre-summarized digest.

Drop-in for `opts.analyzeGeneration` on `improve()` / `selfImprove()`:

  await improve(profile, seedFindings, {
    surface: 'code',
    code: { repoRoot },
    runDir: '/abs/run',                 // MUST be a real path — the traces live here
    analyzeGeneration: rawTraceDistiller(),
    scenarios, judge, agent,
  })

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario` = `Scenario`

##### TArtifact

`TArtifact` = `unknown`

#### Parameters

##### options?

[`RawTraceDistillerOptions`](#rawtracedistilleroptions) = `{}`

#### Returns

(`input`) => `Promise`\<`unknown`[]\>

***

### reflectiveGenerator()

> **reflectiveGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/reflective-generator.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L26)

Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate.

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### createAgentKnowledgeReadinessCheck()

> **createAgentKnowledgeReadinessCheck**(`options`): [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [knowledge/improvement-job.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L77)

Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring.

#### Parameters

##### options

[`AgentKnowledgeReadinessCheckOptions`](#agentknowledgereadinesscheckoptions)

#### Returns

[`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

***

### runKnowledgeImprovementJob()

> **runKnowledgeImprovementJob**(`options`): `Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

Defined in: [knowledge/improvement-job.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L108)

Run the full KB improvement job: candidate workspace, runtime supervisor update, readiness check, and promotion.

#### Parameters

##### options

[`RunKnowledgeImprovementJobOptions`](#runknowledgeimprovementjoboptions)

#### Returns

`Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

***

### knowledgeReadinessDeliverable()

> **knowledgeReadinessDeliverable**(`options`): [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Defined in: [knowledge/supervised-update.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L91)

Build the completion check a supervised KB update uses to stop only when the KB is ready.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readiness"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"readinessOptions"`\>

#### Returns

[`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

***

### createSupervisedKnowledgeUpdater()

> **createSupervisedKnowledgeUpdater**(`options`): [`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

Defined in: [knowledge/supervised-update.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L113)

Create an `improveKnowledgeBase` update callback backed by runtime supervision.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

[`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

***

### runSupervisedKnowledgeUpdate()

> **runSupervisedKnowledgeUpdate**(`options`): `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

Defined in: [knowledge/supervised-update.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L127)

Run a runtime supervisor that updates one candidate knowledge base and stops on readiness.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### formatSupervisedKnowledgeTask()

> **formatSupervisedKnowledgeTask**(`options`): `string`

Defined in: [knowledge/supervised-update.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L169)

Format the supervisor task with the KB root, readiness requirements, current findings, and metadata.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"findings"` \| `"metadata"`\>

#### Returns

`string`

***

### isDelegatedLoopMode()

> **isDelegatedLoopMode**(`value`): value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

Defined in: [loop-runner.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L53)

**`Experimental`**

Type guard — returns true when `value` is a valid `DelegatedLoopMode` string.

#### Parameters

##### value

`unknown`

#### Returns

value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

***

### runDelegatedLoop()

> **runDelegatedLoop**\<`T`\>(`mode`, `registry`, `options?`): `Promise`\<[`DelegatedLoopResult`](#delegatedloopresult)\<`T`\>\>

Defined in: [loop-runner.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L91)

**`Experimental`**

Dispatch a configured loop by mode. Fails loud (throws `ConfigError`) when no
runner is registered for the mode — a routine pointed at an unwired mode is a
config bug, not a silent no-op. A runner that throws is captured as
`{ ok: false }` so unattended runs record the failure rather than crash.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### mode

`"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

##### registry

[`DelegatedLoopRegistry`](#delegatedloopregistry)

##### options?

[`RunDelegatedLoopOptions`](#rundelegatedloopoptions) = `{}`

#### Returns

`Promise`\<[`DelegatedLoopResult`](#delegatedloopresult)\<`T`\>\>

***

### worktreeLoopRunner()

> **worktreeLoopRunner**(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<`WorktreeHarnessResult`\>

Defined in: [loop-runner.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L162)

**`Experimental`**

`code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a
`worktreeFanout` (N `createWorktreeCliExecutor` leaves, each `gateOnDeliverable`) through
`runPersonified` on the keystone Supervisor. The sandbox-session counterpart that drives the in-box
harness over a `SandboxClient` is `detachedSessionDelegate` (`./mcp/delegates`); here there is no
`runLoop` driver, no role-coupled delegate — the harness list is the fanout, the gate is
`patchDelivered`,
the winner is the shared valid-only selector (NOT `defaultSelectWinner`, whose non-valid fallback
would surface an ungated patch). Equal-k holds by the conserved budget pool. Returns the winning
patch artifact, or throws when no candidate is delivered (fail loud, never a vacuous done).

#### Parameters

##### options

[`WorktreeLoopRunnerOptions`](#worktreelooprunneroptions)

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<`WorktreeHarnessResult`\>

***

### researchLoopRunner()

> **researchLoopRunner**(`o`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`ResearchLoopResult`](#researchloopresult)\>

Defined in: [loop-runner.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L249)

**`Experimental`**

`research` mode — research-in-a-loop with valid-only KB growth.

Each round: research → gate every candidate (fail-closed; passage MUST be in
the source) → accept the clean ones → re-research the vetoed ones next round,
up to `maxRounds`. Vetoed facts in the final round are RETURNED (escalate,
never silently dropped) so the caller audits vs retries.

#### Parameters

##### o

[`ResearchLoopRunnerOptions`](#researchlooprunneroptions)

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<[`ResearchLoopResult`](#researchloopresult)\>

***

### selfImproveLoopRunner()

> **selfImproveLoopRunner**\<`TScenario`, `TArtifact`\>(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<`SelfImproveResult`\<`TScenario`, `TArtifact`\>\>

Defined in: [loop-runner.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L280)

**`Experimental`**

`self-improve` mode — agent-eval's one-call closed improvement loop (held-out gated).

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

`SelfImproveOptions`\<`TScenario`, `TArtifact`\>

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<`SelfImproveResult`\<`TScenario`, `TArtifact`\>\>

***

### auditLoopRunner()

> **auditLoopRunner**\<`TProposal`, `TEdit`\>(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

Defined in: [loop-runner.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L291)

**`Experimental`**

`audit` mode — analyst loop over captured trace/run data.

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Parameters

##### options

[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts)

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

***

### mcpToolsForRuntimeMcp()

> **mcpToolsForRuntimeMcp**(): [`OpenAIChatTool`](#openaichattool)[]

Defined in: [mcp/openai-tools.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L64)

**`Experimental`**

Returns the queue-bound delegation tools projected into OpenAI Chat
Completions `tools[]` shape. The order is stable: `delegate_feedback`,
`delegation_status`, `delegation_history`.

#### Returns

[`OpenAIChatTool`](#openaichattool)[]

***

### mcpToolsForRuntimeMcpSubset()

> **mcpToolsForRuntimeMcpSubset**(`names`): [`OpenAIChatTool`](#openaichattool)[]

Defined in: [mcp/openai-tools.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L93)

**`Experimental`**

Subset filter — return only the projected tools whose `function.name`
appears in `names`. Useful for curated mounts (e.g. only the queue-bound
delegation tools, omitting `delegate_feedback`). Unknown names are
silently ignored; pass an empty array to get an empty result.

#### Parameters

##### names

readonly `string`[]

#### Returns

[`OpenAIChatTool`](#openaichattool)[]

***

### resolveRouterBaseUrl()

> **resolveRouterBaseUrl**(`env?`): `string`

Defined in: [model-resolution.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L46)

Resolve the router base URL from env, normalised — no trailing `/v1` or `/`.

#### Parameters

##### env?

[`RouterEnv`](#routerenv) = `{}`

#### Returns

`string`

***

### getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Defined in: [model-resolution.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L56)

Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
response — callers decide whether to fail open (empty catalog) or closed.

#### Parameters

##### routerBaseUrl?

`string` = `DEFAULT_ROUTER_BASE_URL`

#### Returns

`Promise`\<[`ModelInfo`](#modelinfo)[]\>

***

### cleanModelId()

> **cleanModelId**(`value`): `string` \| `undefined`

Defined in: [model-resolution.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L68)

Trim a candidate model id; `undefined` for non-strings and blanks.

#### Parameters

##### value

`unknown`

#### Returns

`string` \| `undefined`

***

### resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](#resolvedchatmodel)

Defined in: [model-resolution.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L91)

Resolve a chat model by precedence: the first candidate carrying a
non-blank model wins, else `fallback`. The caller owns the precedence
order, so each product keeps its own policy (request → workspace → env,
etc.) while the first-non-blank logic and the telemetry shape stay shared.

#### Parameters

##### candidates

`ChatModelCandidate`[]

##### fallback

[`ResolvedChatModel`](#resolvedchatmodel)

#### Returns

[`ResolvedChatModel`](#resolvedchatmodel)

***

### validateChatModelId()

> **validateChatModelId**(`modelId`, `options?`): `Promise`\<`ChatModelValidation`\>

Defined in: [model-resolution.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L131)

Validate a caller-supplied chat-model id. Rejects non-strings, malformed
ids, and ids absent from both the caller's `allowlist` and the live router
catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
id is rejected rather than admitted — a bad model never reaches the agent.

#### Parameters

##### modelId

`unknown`

##### options?

###### allowlist?

`string`[]

Known-good ids that skip the catalog round trip — e.g. the product's
default model plus any env-configured ids.

###### routerBaseUrl?

`string`

###### loadModels?

(`routerBaseUrl`) => `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Injectable catalog loader — overridden in tests.

#### Returns

`Promise`\<`ChatModelValidation`\>

***

### createOtelExporter()

> **createOtelExporter**(`config?`): [`OtelExporter`](#otelexporter) \| `undefined`

Defined in: [otel-export.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L84)

Create an OTEL exporter. Returns undefined when no endpoint is configured.

#### Parameters

##### config?

[`OtelExportConfig`](#otelexportconfig)

#### Returns

[`OtelExporter`](#otelexporter) \| `undefined`

***

### loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): [`OtelSpan`](#otelspan)

Defined in: [otel-export.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L165)

Convert a LoopTraceEvent into an OtelSpan for export.

#### Parameters

##### event

###### kind

`string`

###### runId

`string`

###### timestamp

`number`

###### payload

`object`

##### traceId

`string`

##### parentSpanId?

`string`

#### Returns

[`OtelSpan`](#otelspan)

***

### buildRuntimeEventOtelSpans()

> **buildRuntimeEventOtelSpans**(`events`, `traceId`, `parentSpanId?`, `options?`): [`OtelSpan`](#otelspan)[]

Defined in: [otel-export.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L261)

Convert normalized runtime events into lossless, redacted child spans.

#### Parameters

##### events

readonly [`RuntimeStreamEvent`](#runtimestreamevent)[]

##### traceId

`string`

##### parentSpanId?

`string`

##### options?

[`RuntimeEventOtelOptions`](#runtimeeventoteloptions) = `{}`

#### Returns

[`OtelSpan`](#otelspan)[]

***

### buildLoopOtelSpans()

> **buildLoopOtelSpans**(`events`, `traceId`, `rootParentSpanId?`): [`OtelSpan`](#otelspan)[]

Defined in: [otel-export.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L364)

Build a nested, real-duration OTLP span tree for ONE loop run from its full
ordered `LoopTraceEvent` stream. Unlike `loopEventToOtelSpan` (one flat,
zero-duration span per event), this reconstructs the topology hierarchy a
GenAI trace viewer renders natively:

  loop (invoke_workflow)
    └─ loop.round[k] (invoke_workflow)   ← tangle.loop.move.{kind,width,rationale}
         ├─ loop.iteration[i] (invoke_agent)  ← gen_ai.agent.name + usage + verdict + placement
         └─ …

Attributes follow the current GenAI semconv (`gen_ai.*`) where they apply and
a namespaced `tangle.loop.*` / `tangle.cost.usd` extension for topology /
verdict / placement / cost (not yet standardized). Pure: feed it a buffered
per-runId event array (e.g. flushed on `loop.ended`) and export the result.

#### Parameters

##### events

readonly `object`[]

##### traceId

`string`

##### rootParentSpanId?

`string`

#### Returns

[`OtelSpan`](#otelspan)[]

***

### buildLoopSpanNodes()

> **buildLoopSpanNodes**(`events`): [`LoopSpanNode`](#loopspannode)[]

Defined in: [otel-export.ts:395](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L395)

Sink-neutral core behind [buildLoopOtelSpans](#buildloopotelspans): reconstruct the
loop → round → branch span tree from one run's ordered `LoopTraceEvent`
stream. Consumed by the OTEL mapper above and by the MCP delegation
journal's compact trace tee — one topology reconstruction, two sinks.
Tolerates partial streams (a run that never reached `loop.ended` closes
at the last observed event's timestamp).

#### Parameters

##### events

readonly `object`[]

#### Returns

[`LoopSpanNode`](#loopspannode)[]

***

### exportEvalRuns()

> **exportEvalRuns**(`events`, `config?`): `Promise`\<[`EvalRunsExportResult`](#evalrunsexportresult)\>

Defined in: [otel-export.ts:728](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L728)

Ship self-improvement eval-run events to Tangle Intelligence. Unlike the
best-effort span exporter, this RESOLVES with the ingest verdict (accepted /
rejected per event) so a consumer's loop can assert its provenance landed.
Throws only on a missing key or network failure.

#### Parameters

##### events

[`EvalRunEvent`](#evalrunevent)[]

##### config?

[`EvalRunsExportConfig`](#evalrunsexportconfig)

#### Returns

`Promise`\<[`EvalRunsExportResult`](#evalrunsexportresult)\>

***

### decideKnowledgeReadiness()

> **decideKnowledgeReadiness**(`report`, `options?`): `KnowledgeReadinessDecision`

Defined in: [readiness.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/readiness.ts#L27)

Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

###### minimumScore?

`number`

#### Returns

`KnowledgeReadinessDecision`

#### Stable

***

### resolveAgentBackend()

> **resolveAgentBackend**\<`TInput`\>(`opts`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [resolve-agent-backend.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L79)

Resolve the `AgentExecutionBackend` for the chosen `kind`. Reuse this instead
of hand-rolling the `createOpenAICompatibleBackend` branch in each product.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### opts

[`ResolveAgentBackendOptions`](#resolveagentbackendoptions)\<`TInput`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### applyRunRecordDefaults()

> **applyRunRecordDefaults**(`records`, `scenarioId`, `controlFailureClass`): `RunRecord`[]

Defined in: [run.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L49)

Stamp cross-cutting defaults onto adapter-projected RunRecords without
 overriding anything the adapter set explicitly:
  - `scenarioId` — the run's scenario, when the record omits one.
  - `failureClass` — the control layer's failure classification promoted
    onto the canonical cross-agent key, but ONLY when it's a real taxonomy
    class. This is what lets the substrate aggregate failures across every
    agent in one vocabulary instead of per-agent ad-hoc strings.

#### Parameters

##### records

`RunRecord`[]

##### scenarioId

`string`

##### controlFailureClass

`string` \| `undefined`

#### Returns

`RunRecord`[]

***

### runAgentTask()

> **runAgentTask**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`options`): `Promise`\<[`AgentTaskRunResult`](#agenttaskrunresult)\<`TState`, `TAction`, `TActionResult`, `TEval`\>\>

Defined in: [run.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L88)

Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable.

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### options

`RunAgentTaskOptions`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<[`AgentTaskRunResult`](#agenttaskrunresult)\<`TState`, `TAction`, `TActionResult`, `TEval`\>\>

#### Stable

***

### runAgentTaskStream()

> **runAgentTaskStream**\<`TInput`\>(`options`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

Defined in: [run.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L206)

Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

`RunAgentTaskStreamOptions`\<`TInput`\>

#### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

#### Stable

***

### defineRuntimeHooks()

> **defineRuntimeHooks**(`hooks`): [`RuntimeHooks`](#runtimehooks)

Defined in: [runtime-hooks.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L107)

Identity helper that types a [RuntimeHooks](#runtimehooks) literal so the fields are inferred.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks)

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](#runtimehooks)

Defined in: [runtime-hooks.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L116)

Merge several [RuntimeHooks](#runtimehooks) into one. Falsy entries are dropped (so you can
pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
event. Use this to attach N observers to a loop instead of a second event bus.

#### Parameters

##### entries

...(`false` \| [`RuntimeHooks`](#runtimehooks) \| `null` \| `undefined`)[]

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### notifyRuntimeHookEvent()

> **notifyRuntimeHookEvent**(`hooks`, `event`, `context?`): `void`

Defined in: [runtime-hooks.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L158)

Fire `hooks.onEvent`, swallowing sync throws and surfacing async failures to `onError`.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks) \| `undefined`

##### event

[`RuntimeHookEvent`](#runtimehookevent)

##### context?

[`RuntimeHookContext`](#runtimehookcontext) = `{}`

#### Returns

`void`

***

### notifyRuntimeDecisionPoint()

> **notifyRuntimeDecisionPoint**(`hooks`, `point`, `context?`): `void`

Defined in: [runtime-hooks.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L189)

Fire `hooks.onDecisionPoint`, swallowing sync throws and surfacing async failures to `onError`.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks) \| `undefined`

##### point

[`RuntimeDecisionPoint`](#runtimedecisionpoint)

##### context?

[`RuntimeHookContext`](#runtimehookcontext) = `{}`

#### Returns

`void`

***

### startRuntimeRun()

> **startRuntimeRun**(`options`): [`RuntimeRunHandle`](#runtimerunhandle)

Defined in: [runtime-run.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L150)

Construct a runtime-run handle. The returned handle is mutable across its
lifetime; consumers should not share it across requests.

#### Parameters

##### options

`RuntimeRunOptions`

#### Returns

[`RuntimeRunHandle`](#runtimerunhandle)

#### Stable

***

### sanitizeKnowledgeReadinessReport()

> **sanitizeKnowledgeReadinessReport**(`report`, `options?`): [`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

Defined in: [sanitize.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L82)

Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

#### Stable

***

### sanitizeAgentRuntimeEvent()

> **sanitizeAgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`event`, `options?`): `Record`\<`string`, `unknown`\>

Defined in: [sanitize.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L105)

Reduce an `AgentRuntimeEvent` to a PII-safe, serializable plain object for telemetry.

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult`

#### Parameters

##### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

`Record`\<`string`, `unknown`\>

#### Stable

***

### sanitizeRuntimeStreamEvent()

> **sanitizeRuntimeStreamEvent**(`event`, `options?`): `Record`\<`string`, `unknown`\>

Defined in: [sanitize.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L161)

Reduce a `RuntimeStreamEvent` to a PII-safe, serializable plain object for telemetry.

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

`Record`\<`string`, `unknown`\>

#### Stable

***

### createRuntimeEventCollector()

> **createRuntimeEventCollector**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`options?`): [`RuntimeEventCollector`](#runtimeeventcollector)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

Defined in: [sanitize.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L531)

Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection.

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`RuntimeEventCollector`](#runtimeeventcollector)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Stable

***

### createRuntimeStreamEventCollector()

> **createRuntimeStreamEventCollector**(`options?`): [`RuntimeStreamEventCollector`](#runtimestreameventcollector)

Defined in: [sanitize.ts:559](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L559)

Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
event yielded by `runAgentTaskStream` through `onEvent` and read the
sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
flags apply. Kept distinct from `createRuntimeEventCollector` because the
stream and non-stream event shapes overlap on `type` literals — dispatching
on `type` alone would misroute events.

#### Parameters

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`RuntimeStreamEventCollector`](#runtimestreameventcollector)

#### Stable

***

### readinessServerSentEvent()

> **readinessServerSentEvent**(`report`, `options?`): `string`

Defined in: [sse.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L42)

Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & `ServerSentEventOptions` = `{}`

#### Returns

`string`

#### Stable

***

### runtimeStreamServerSentEvent()

> **runtimeStreamServerSentEvent**(`event`, `options?`): `string`

Defined in: [sse.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L57)

Serialize a `RuntimeStreamEvent` as a Server-Sent Event string.

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & `ServerSentEventOptions` = `{}`

#### Returns

`string`

#### Stable

***

### runToolLoop()

> **runToolLoop**(`opts`): `Promise`\<[`ToolLoopResult`](#toolloopresult)\>

Defined in: [tool-loop.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L156)

Run the bounded tool loop and return the final text + every executed tool
 outcome. Awaitable — callers needing to stream events to a UI use
 [streamToolLoop](#streamtoolloop).

#### Parameters

##### opts

[`RunToolLoopOptions`](#runtoolloopoptions)

#### Returns

`Promise`\<[`ToolLoopResult`](#toolloopresult)\>

***

### streamToolLoop()

> **streamToolLoop**\<`Raw`\>(`opts`): `AsyncGenerator`\<[`StreamToolLoopYield`](#streamtoolloopyield)\<`Raw`\>, `void`, `unknown`\>

Defined in: [tool-loop.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L336)

Streaming bounded tool loop: yields each raw turn event (the caller maps +
 telemetries + re-emits it) and each executed `tool_result`; emits one
 `capped` if it stops for any non-completed reason with calls still pending.

#### Type Parameters

##### Raw

`Raw`

#### Parameters

##### opts

[`StreamToolLoopOptions`](#streamtoolloopoptions)\<`Raw`\>

#### Returns

`AsyncGenerator`\<[`StreamToolLoopYield`](#streamtoolloopyield)\<`Raw`\>, `void`, `unknown`\>
