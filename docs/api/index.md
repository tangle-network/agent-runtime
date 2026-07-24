[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / index

# index

## Classes

### FileAgentCandidateExecutionClaimStore

Defined in: [src/candidate-execution/claim-file-store.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L68)

Cross-process lifecycle implemented as fsynced, create-if-absent records.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new FileAgentCandidateExecutionClaimStore**(`options`): [`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

Defined in: [src/candidate-execution/claim-file-store.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L72)

###### Parameters

###### options

[`FileAgentCandidateExecutionClaimStoreOptions`](#fileagentcandidateexecutionclaimstoreoptions)

###### Returns

[`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [src/candidate-execution/claim-file-store.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L80)

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [src/candidate-execution/claim-file-store.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L108)

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [src/candidate-execution/claim-file-store.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L114)

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

Defined in: [src/candidate-execution/claim-file-store.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L150)

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

Defined in: [src/candidate-execution/claim-file-store.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L182)

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

Defined in: [src/candidate-execution/claim-file-store.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L218)

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

Defined in: [src/candidate-execution/claim.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L280)

Single-process lifecycle implementation.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new InMemoryAgentCandidateExecutionClaimStore**(`options?`): [`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

Defined in: [src/candidate-execution/claim.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L286)

###### Parameters

###### options?

`InMemoryAgentCandidateExecutionClaimStoreOptions` = `{}`

###### Returns

[`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [src/candidate-execution/claim.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L290)

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [src/candidate-execution/claim.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L313)

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [src/candidate-execution/claim.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L323)

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

Defined in: [src/candidate-execution/claim.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L340)

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

Defined in: [src/candidate-execution/claim.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L355)

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

Defined in: [src/candidate-execution/claim.ts:373](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L373)

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

Defined in: [src/conversation/call-policy.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L43)

Thrown when the circuit breaker is open for a participant and no retry is allowed yet.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CircuitOpenError**(`participant`, `retryAfterMs`): [`CircuitOpenError`](#circuitopenerror)

Defined in: [src/conversation/call-policy.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L44)

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

Defined in: [src/conversation/call-policy.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L53)

Thrown when a backend call exceeds its per-attempt deadline.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new DeadlineExceededError**(`deadlineMs`): [`DeadlineExceededError`](#deadlineexceedederror)

Defined in: [src/conversation/call-policy.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L54)

###### Parameters

###### deadlineMs

`number`

###### Returns

[`DeadlineExceededError`](#deadlineexceedederror)

###### Overrides

`Error.constructor`

***

### CircuitBreakerState

Defined in: [src/conversation/call-policy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L86)

Live circuit-breaker state — one instance per (participant, conversation run).

#### Constructors

##### Constructor

> **new CircuitBreakerState**(`config`): [`CircuitBreakerState`](#circuitbreakerstate)

Defined in: [src/conversation/call-policy.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L90)

###### Parameters

###### config

[`CircuitBreakerConfig`](#circuitbreakerconfig) \| `undefined`

###### Returns

[`CircuitBreakerState`](#circuitbreakerstate)

#### Methods

##### preflight()

> **preflight**(`participant`, `now?`): `void`

Defined in: [src/conversation/call-policy.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L96)

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

Defined in: [src/conversation/call-policy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L106)

###### Returns

`void`

##### recordFailure()

> **recordFailure**(`now?`): `void`

Defined in: [src/conversation/call-policy.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L111)

###### Parameters

###### now?

`number` = `...`

###### Returns

`void`

***

### SqlConversationJournal

Defined in: [src/conversation/journal-sql.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L120)

SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
start/halt timestamps + halt reason) and turns (one row per committed turn,
payload is the ConversationTurn JSON). Replays the turns table on
`loadRun` and writes append-only per `appendTurn`.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new SqlConversationJournal**(`db`, `table?`): [`SqlConversationJournal`](#sqlconversationjournal)

Defined in: [src/conversation/journal-sql.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L127)

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

Defined in: [src/conversation/journal-sql.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L136)

Create the journal's tables if absent. Idempotent. Call once at deploy
(or at app boot) — running on every request is harmless but adds latency.

###### Returns

`Promise`\<`void`\>

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [src/conversation/journal-sql.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L142)

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

Defined in: [src/conversation/journal-sql.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L168)

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

Defined in: [src/conversation/journal-sql.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L187)

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

Defined in: [src/conversation/journal-sql.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L208)

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

Defined in: [src/conversation/journal.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L60)

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

Defined in: [src/conversation/journal.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L63)

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

Defined in: [src/conversation/journal.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L76)

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

Defined in: [src/conversation/journal.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L89)

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

Defined in: [src/conversation/journal.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L104)

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

Defined in: [src/conversation/journal.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L124)

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

Defined in: [src/conversation/journal.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L125)

###### Parameters

###### path

`string`

###### Returns

[`FileConversationJournal`](#fileconversationjournal)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [src/conversation/journal.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L127)

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

Defined in: [src/conversation/journal.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L163)

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

Defined in: [src/conversation/journal.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L176)

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

Defined in: [src/conversation/journal.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L180)

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

Defined in: [src/errors.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L68)

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

Defined in: [src/errors.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L79)

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

Defined in: [src/errors.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L69)

##### status?

> `readonly` `optional` **status?**: `number`

Defined in: [src/errors.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L70)

##### body?

> `readonly` `optional` **body?**: `string`

Defined in: [src/errors.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L77)

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.

***

### RuntimeRunStateError

Defined in: [src/errors.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L98)

A runtime-run lifecycle method was called in an order the state machine does
not allow: `persist()` before `complete()`, `complete()` twice, etc.

#### Stable

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new RuntimeRunStateError**(`message`, `options?`): [`RuntimeRunStateError`](#runtimerunstateerror)

Defined in: [src/errors.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L99)

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

Defined in: [src/errors.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L116)

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

Defined in: [src/errors.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L117)

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

### OfficialOptimizerUnavailableError

Defined in: [src/improvement/official-optimizers.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L64)

Missing optional Python dependencies for an official optimizer.

#### Extends

- `ConfigError`

#### Constructors

##### Constructor

> **new OfficialOptimizerUnavailableError**(`optimizer`, `cause`): [`OfficialOptimizerUnavailableError`](#officialoptimizerunavailableerror)

Defined in: [src/improvement/official-optimizers.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L67)

###### Parameters

###### optimizer

`"gepa"` \| `"skillopt"`

###### cause

`unknown`

###### Returns

[`OfficialOptimizerUnavailableError`](#officialoptimizerunavailableerror)

###### Overrides

`ConfigError.constructor`

#### Properties

##### optimizer

> `readonly` **optimizer**: `"gepa"` \| `"skillopt"`

Defined in: [src/improvement/official-optimizers.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L65)

***

### InMemoryRuntimeSessionStore

Defined in: [src/sessions.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L111)

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

Defined in: [src/sessions.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L115)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `undefined`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`get`](#get-1)

##### put()

> **put**(`session`): `void`

Defined in: [src/sessions.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L119)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`put`](#put-2)

##### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

Defined in: [src/sessions.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L123)

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

Defined in: [src/sessions.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L129)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`listEvents`](#listevents-1)

## Interfaces

### AgentCandidateCodeSurfaceSource

Defined in: [src/candidate-execution/builder.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L43)

The only accepted path from an agent-eval code candidate to executable bytes.

#### Properties

##### kind

> **kind**: `"code-surface"`

Defined in: [src/candidate-execution/builder.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L44)

##### surface

> **surface**: `CodeSurface`

Defined in: [src/candidate-execution/builder.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L45)

##### repository

> **repository**: `AgentCandidateGitHubRepository`

Defined in: [src/candidate-execution/builder.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L46)

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Defined in: [src/candidate-execution/builder.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L48)

Optional parent directory used to resolve a relative `surface.worktreeRef`.

***

### BuildAgentCandidateBundleInput

Defined in: [src/candidate-execution/builder.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L58)

Complete measured surfaces and execution policy compiled into one candidate bundle.

#### Properties

##### profile

> **profile**: [`AgentCandidateProfileSource`](#agentcandidateprofilesource)

Defined in: [src/candidate-execution/builder.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L59)

##### code

> **code**: [`AgentCandidateCodeSource`](#agentcandidatecodesource)

Defined in: [src/candidate-execution/builder.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L60)

##### execution

> **execution**: `AgentCandidateExecution`

Defined in: [src/candidate-execution/builder.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L61)

##### knowledge?

> `optional` **knowledge?**: `AgentCandidateKnowledge`

Defined in: [src/candidate-execution/builder.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L62)

##### memory

> **memory**: `AgentCandidateMemoryPolicy`

Defined in: [src/candidate-execution/builder.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L63)

***

### AgentCandidatePreparationEvidence

Defined in: [src/candidate-execution/claim-file-formats.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-formats.ts#L11)

#### Properties

##### executionPlan

> `readonly` **executionPlan**: `AgentCandidateArtifactRef`

Defined in: [src/candidate-execution/claim-file-formats.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-formats.ts#L12)

##### materializationReceipt

> `readonly` **materializationReceipt**: `AgentCandidateArtifactRef`

Defined in: [src/candidate-execution/claim-file-formats.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-formats.ts#L13)

***

### FileAgentCandidateExecutionClaimStoreOptions

Defined in: [src/candidate-execution/claim-file-store.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L60)

#### Properties

##### directory

> **directory**: `string`

Defined in: [src/candidate-execution/claim-file-store.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L62)

Evaluator-owned directory shared by every process allowed to execute candidates.

##### now?

> `optional` **now?**: () => `number`

Defined in: [src/candidate-execution/claim-file-store.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-file-store.ts#L64)

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### AgentCandidateExecutionCleanupHandles

Defined in: [src/candidate-execution/claim.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L38)

Non-secret identities a trusted recovery worker needs to close an abandoned attempt.

#### Properties

##### preparationId

> `readonly` **preparationId**: `string`

Defined in: [src/candidate-execution/claim.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L39)

##### modelGrantDigest

> `readonly` **modelGrantDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/claim.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L40)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [src/candidate-execution/claim.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L41)

##### traceRunId

> `readonly` **traceRunId**: `string`

Defined in: [src/candidate-execution/claim.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L42)

##### cleanupTimeoutMs

> `readonly` **cleanupTimeoutMs**: `number`

Defined in: [src/candidate-execution/claim.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L43)

##### memory?

> `readonly` `optional` **memory?**: `object`

Defined in: [src/candidate-execution/claim.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L44)

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionClaim

Defined in: [src/candidate-execution/claim.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L51)

Immutable signed identity stored for one execution attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/claim.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L52)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [src/candidate-execution/claim.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L53)

##### maxAttempts

> `readonly` **maxAttempts**: `number`

Defined in: [src/candidate-execution/claim.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L54)

##### retryPolicy

> `readonly` **retryPolicy**: `"none"` \| `"pre-model-infrastructure-only"`

Defined in: [src/candidate-execution/claim.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L55)

##### bundleDigest

> `readonly` **bundleDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/claim.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L56)

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/claim.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L57)

##### preparationEvidence

> `readonly` **preparationEvidence**: [`AgentCandidatePreparationEvidence`](#agentcandidatepreparationevidence)

Defined in: [src/candidate-execution/claim.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L59)

Durable canonical bytes needed to reconstruct the signed preparation.

##### retryLineageDigest

> `readonly` **retryLineageDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/claim.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L61)

Frozen plan identity with only attempt number and per-attempt grant identity normalized.

##### leaseExpiresAtMs

> `readonly` **leaseExpiresAtMs**: `number`

Defined in: [src/candidate-execution/claim.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L63)

The winning lease stops authorizing a new terminal write at this instant.

##### resultTimeoutMs

> `readonly` **resultTimeoutMs**: `number`

Defined in: [src/candidate-execution/claim.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L65)

Frozen budget for task verification, executable grading, and receipt construction.

##### cleanup

> `readonly` **cleanup**: [`AgentCandidateExecutionCleanupHandles`](#agentcandidateexecutioncleanuphandles)

Defined in: [src/candidate-execution/claim.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L67)

Non-secret handles retained so an expired attempt can be closed and reconciled.

***

### AgentCandidateExecutionLease

Defined in: [src/candidate-execution/claim.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L71)

Secret capability required to finish the acquired attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/claim.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L72)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [src/candidate-execution/claim.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L73)

##### token

> `readonly` **token**: `string`

Defined in: [src/candidate-execution/claim.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L74)

##### expiresAtMs

> `readonly` **expiresAtMs**: `number`

Defined in: [src/candidate-execution/claim.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L75)

***

### AgentCandidateExecutionRecoveryEvidence

Defined in: [src/candidate-execution/claim.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L118)

Trusted, independently observed closure facts for one expired winning lease.

#### Properties

##### failureClass

> `readonly` **failureClass**: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass)

Defined in: [src/candidate-execution/claim.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L119)

##### usage

> `readonly` **usage**: `AgentCandidateFixedSpend`

Defined in: [src/candidate-execution/claim.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L120)

##### modelSettlement

> `readonly` **modelSettlement**: `AgentCandidateArtifactRef`

Defined in: [src/candidate-execution/claim.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L121)

##### failureEvidence?

> `readonly` `optional` **failureEvidence?**: `AgentCandidateArtifactRef`

Defined in: [src/candidate-execution/claim.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L122)

##### process

> `readonly` **process**: `object`

Defined in: [src/candidate-execution/claim.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L123)

###### stopped

> `readonly` **stopped**: `true`

###### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

##### model

> `readonly` **model**: `object`

Defined in: [src/candidate-execution/claim.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L127)

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### grantDigest

> `readonly` **grantDigest**: `` `sha256:${string}` ``

##### memory?

> `readonly` `optional` **memory?**: `object`

Defined in: [src/candidate-execution/claim.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L132)

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

Defined in: [src/candidate-execution/claim.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L140)

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/claim.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L141)

##### attempt

> `readonly` **attempt**: `number`

Defined in: [src/candidate-execution/claim.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L142)

***

### AgentCandidateExecutionAttemptRecord

Defined in: [src/candidate-execution/claim.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L146)

Persisted state available to a fresh trusted recovery worker after a crash.

#### Properties

##### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

Defined in: [src/candidate-execution/claim.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L147)

##### phase

> `readonly` **phase**: [`AgentCandidateExecutionPhase`](#agentcandidateexecutionphase)

Defined in: [src/candidate-execution/claim.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L148)

##### staged?

> `readonly` `optional` **staged?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

Defined in: [src/candidate-execution/claim.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L150)

Durable outbox content written before the terminal compare-and-set.

##### terminal?

> `readonly` `optional` **terminal?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

Defined in: [src/candidate-execution/claim.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L151)

***

### AgentCandidateExecutionClaimStore

Defined in: [src/candidate-execution/claim.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L223)

Atomic one-shot store for candidate execution attempts.

Implementations must linearize both methods across every process sharing the
store. Terminal publication is deliberately two-step: `stageTerminal`
fsyncs the complete immutable outbox record, then `finish` publishes exactly
those staged bytes by digest. A crash between the two leaves recoverable
evidence rather than an ambiguous completed run.

#### Methods

##### tryClaim()

> **tryClaim**(`claim`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

Defined in: [src/candidate-execution/claim.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L224)

###### Parameters

###### claim

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

##### getAttempt()

> **getAttempt**(`attempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

Defined in: [src/candidate-execution/claim.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L225)

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

##### markCandidateMayRun()

> **markCandidateMayRun**(`lease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Defined in: [src/candidate-execution/claim.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L229)

Persist the point after which candidate code may have run.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

##### stageTerminal()

> **stageTerminal**(`lease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

Defined in: [src/candidate-execution/claim.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L233)

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

Defined in: [src/candidate-execution/claim.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L238)

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

Defined in: [src/candidate-execution/claim.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L246)

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

Defined in: [src/candidate-execution/dispose.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L10)

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/candidate-execution/dispose.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L11)

***

### ExactProcessCandidateExecutorOptions

Defined in: [src/candidate-execution/exact-process-executor.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L52)

#### Properties

##### provider

> **provider**: `AgentEnvironmentProvider`

Defined in: [src/candidate-execution/exact-process-executor.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L53)

##### resources

> **resources**: `AgentExactProcessResources`

Defined in: [src/candidate-execution/exact-process-executor.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L54)

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

Defined in: [src/candidate-execution/exact-process-executor.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L55)

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

Defined in: [src/candidate-execution/exact-process-executor.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L56)

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

Defined in: [src/candidate-execution/exact-process-executor.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L57)

***

### ExecutePreparedAgentCandidateOptions

Defined in: [src/candidate-execution/execute.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L66)

#### Properties

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

Defined in: [src/candidate-execution/execute.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L67)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](#agentcandidatebenchmarkgraderport)

Defined in: [src/candidate-execution/execute.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L68)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

Defined in: [src/candidate-execution/execute.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L69)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [src/candidate-execution/execute.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L70)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

Defined in: [src/candidate-execution/execute.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L72)

Long-lived evaluator-owned store shared by every process that can run this benchmark.

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/candidate-execution/execute.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L74)

Maximum time to prove process death and revoke protected access after a run ends.

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [src/candidate-execution/execute.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L76)

Maximum time for task verification, executable grading, and receipt construction.

***

### PrepareAgentCandidateExecutionOptions

Defined in: [src/candidate-execution/prepare.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L85)

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/candidate-execution/prepare.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L86)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: [src/candidate-execution/prepare.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L88)

Maximum time for task verification, executable grading, and receipt construction.

***

### AgentCandidateModelGrantClient

Defined in: [src/candidate-execution/protected-model-port.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L39)

Narrow transport contract for a service that owns scoped model credentials
and the authoritative per-call usage ledger.

An HTTP client can bind these methods to control-plane endpoints. Keeping
transport out of the runtime prevents parent credentials, endpoint paths,
and retry policy from becoming part of the portable candidate contract.

#### Methods

##### reserve()

> **reserve**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

Defined in: [src/candidate-execution/protected-model-port.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L40)

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

Defined in: [src/candidate-execution/protected-model-port.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L41)

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

Defined in: [src/candidate-execution/protected-model-port.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L44)

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

Defined in: [src/candidate-execution/protected-model-port.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L49)

#### Properties

##### client

> **client**: [`AgentCandidateModelGrantClient`](#agentcandidatemodelgrantclient)

Defined in: [src/candidate-execution/protected-model-port.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L50)

##### resolveModel

> **resolveModel**: (`input`) => `Promise`\<`AgentCandidateResolvedModel`\>

Defined in: [src/candidate-execution/protected-model-port.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L52)

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

Defined in: [src/candidate-execution/protected-model-port.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L54)

The only public DNS name candidate processes may reach for inference.

##### activationEnvNames

> **activationEnvNames**: readonly `string`[]

Defined in: [src/candidate-execution/protected-model-port.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L56)

Exact environment names the activation endpoint must return, no more or fewer.

***

### RecoverExpiredAgentCandidateOptions

Defined in: [src/candidate-execution/recover.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L35)

#### Properties

##### attempt

> **attempt**: [`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

Defined in: [src/candidate-execution/recover.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L36)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

Defined in: [src/candidate-execution/recover.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L37)

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

Defined in: [src/candidate-execution/recover.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L38)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: [src/candidate-execution/recover.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L39)

##### ports

> **ports**: `Pick`\<[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports), `"models"` \| `"memory"`\>

Defined in: [src/candidate-execution/recover.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L40)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

Defined in: [src/candidate-execution/recover.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L41)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: [src/candidate-execution/recover.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L42)

##### now?

> `optional` **now?**: () => `number`

Defined in: [src/candidate-execution/recover.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L44)

Evaluator clock; must be the same clock used by the claim store.

###### Returns

`number`

***

### AgentCandidateArtifactPort

Defined in: [src/candidate-execution/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L41)

Reads one content-addressed object from the closed S3/IPFS locator set.

#### Extended by

- [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [src/candidate-execution/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L42)

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### AgentCandidateOutputArtifactPort

Defined in: [src/candidate-execution/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L69)

Durable content-addressed evidence store controlled only by the evaluator.

#### Extends

- [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

Defined in: [src/candidate-execution/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L42)

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Inherited from

[`AgentCandidateArtifactPort`](#agentcandidateartifactport).[`read`](#read)

##### put()

> **put**(`input`): `Promise`\<`AgentCandidateArtifactRef`\>

Defined in: [src/candidate-execution/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L71)

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

Defined in: [src/candidate-execution/types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L81)

Resolves a declared GitHub repository to an already-present local Git object store.

#### Methods

##### resolve()

> **resolve**(`repository`): `Promise`\<`string`\>

Defined in: [src/candidate-execution/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L82)

###### Parameters

###### repository

`AgentCandidateGitHubRepository`

###### Returns

`Promise`\<`string`\>

***

### AgentCandidateVerificationPorts

Defined in: [src/candidate-execution/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L85)

#### Extended by

- [`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

Defined in: [src/candidate-execution/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L86)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

Defined in: [src/candidate-execution/types.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L87)

***

### AgentCandidateWorkspacePort

Defined in: [src/candidate-execution/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L97)

Materializes an already-verified workspace archive.

The runtime independently scans every resulting byte, mode, and path against
the signed manifest after this returns. Implementations may therefore unpack
any archive encoding, or no-op when the exact workspace is already present.

#### Methods

##### materialize()

> **materialize**(`input`): `Promise`\<`void`\>

Defined in: [src/candidate-execution/types.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L98)

###### Parameters

###### input

###### role

`"task"` \| `"knowledge"` \| `"memory"` \| `"candidate"`

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

Defined in: [src/candidate-execution/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L106)

#### Properties

##### source

> **source**: `"pinned-container"` \| `"evaluator-task-container"`

Defined in: [src/candidate-execution/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L107)

##### image

> **image**: `string`

Defined in: [src/candidate-execution/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L108)

##### indexDigest

> **indexDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L109)

##### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L110)

##### platform

> **platform**: `AgentCandidateOciPlatform`

Defined in: [src/candidate-execution/types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L111)

***

### AgentCandidateContainerPort

Defined in: [src/candidate-execution/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L114)

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

Defined in: [src/candidate-execution/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L115)

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

Defined in: [src/candidate-execution/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L121)

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<`AgentCandidateResolvedModel`\>

Defined in: [src/candidate-execution/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L122)

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

Defined in: [src/candidate-execution/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L132)

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

Defined in: [src/candidate-execution/types.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L142)

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

Defined in: [src/candidate-execution/types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L155)

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

### AgentCandidateProtectedModelReservation

Defined in: [src/candidate-execution/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L170)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [src/candidate-execution/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L171)

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L172)

##### expiresAtMs

> **expiresAtMs**: `number`

Defined in: [src/candidate-execution/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L174)

Evaluator service must expire and revoke this reservation at this epoch millisecond.

##### enforcedLimits

> **enforcedLimits**: [`AgentCandidateModelLimits`](#agentcandidatemodellimits)

Defined in: [src/candidate-execution/types.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L176)

The gateway must stop calls before any one of these limits is exceeded.

##### network

> **network**: `AgentCandidateModelAccessNetwork`

Defined in: [src/candidate-execution/types.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L178)

Exact public endpoint exception; every other candidate destination stays blocked.

***

### AgentCandidateProtectedModelActivation

Defined in: [src/candidate-execution/types.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L181)

#### Properties

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/candidate-execution/types.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L183)

Injected only into the trusted executor after all pre-launch checks pass.

***

### AgentCandidateProtectedModelSettlement

Defined in: [src/candidate-execution/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L186)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [src/candidate-execution/types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L187)

##### grantDigest

> **grantDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L188)

##### closed

> **closed**: `true`

Defined in: [src/candidate-execution/types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L189)

##### calls

> **calls**: readonly `AgentCandidateModelSettlementCall`[]

Defined in: [src/candidate-execution/types.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L190)

***

### AgentCandidateMemoryResetResult

Defined in: [src/candidate-execution/types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L193)

#### Properties

##### preparationId

> **preparationId**: `string`

Defined in: [src/candidate-execution/types.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L194)

##### accessDigest

> **accessDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L195)

##### expiresAtMs

> **expiresAtMs**: `number`

Defined in: [src/candidate-execution/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L196)

##### evidence

> **evidence**: `AgentCandidateCapturedArtifact`

Defined in: [src/candidate-execution/types.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L197)

##### emptyStateDigest

> **emptyStateDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L198)

##### beforeState

> **beforeState**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/candidate-execution/types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L199)

***

### AgentCandidateMemoryPort

Defined in: [src/candidate-execution/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L202)

#### Methods

##### reset()

> **reset**(`input`): `Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

Defined in: [src/candidate-execution/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L208)

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

Defined in: [src/candidate-execution/types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L220)

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

Defined in: [src/candidate-execution/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L232)

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

Defined in: [src/candidate-execution/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L241)

#### Extends

- [`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

Defined in: [src/candidate-execution/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L86)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`artifacts`](#artifacts)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

Defined in: [src/candidate-execution/types.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L87)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`repositories`](#repositories)

##### workspaces

> **workspaces**: [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

Defined in: [src/candidate-execution/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L242)

##### containers

> **containers**: [`AgentCandidateContainerPort`](#agentcandidatecontainerport)

Defined in: [src/candidate-execution/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L243)

##### models

> **models**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

Defined in: [src/candidate-execution/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L244)

##### memory

> **memory**: [`AgentCandidateMemoryPort`](#agentcandidatememoryport)

Defined in: [src/candidate-execution/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L245)

***

### AgentCandidateTaskExecution

Defined in: [src/candidate-execution/types.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L249)

Runtime placement for one exact cell from a signed candidate experiment.

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [src/candidate-execution/types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L250)

##### runCell

> **runCell**: `AgentCandidateRunCell`

Defined in: [src/candidate-execution/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L251)

##### benchmarkSuite

> **benchmarkSuite**: `AgentCandidateBenchmarkSuite`

Defined in: [src/candidate-execution/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L252)

##### task

> **task**: `AgentCandidateBenchmarkTask`

Defined in: [src/candidate-execution/types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L253)

##### executionRoots

> **executionRoots**: `object`

Defined in: [src/candidate-execution/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L255)

Absolute paths inside the evaluator-owned execution environment.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: [src/candidate-execution/types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L260)

Host-side staging roots. These are verified but never signed as container paths.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

***

### VerifiedAgentCandidate

Defined in: [src/candidate-execution/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L267)

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

Defined in: [src/candidate-execution/types.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L268)

##### materializedTree?

> `readonly` `optional` **materializedTree?**: `string`

Defined in: [src/candidate-execution/types.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L269)

##### \[verifiedCandidateBrand\]

> `readonly` **\[verifiedCandidateBrand\]**: `true`

Defined in: [src/candidate-execution/types.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L270)

***

### CanonicalCandidateDocument

Defined in: [src/candidate-execution/types.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L273)

#### Type Parameters

##### T

`T`

#### Properties

##### value

> `readonly` **value**: `T`

Defined in: [src/candidate-execution/types.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L274)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [src/candidate-execution/types.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L276)

Canonical UTF-8 bytes of `value` with its top-level digest omitted.

##### digest

> `readonly` **digest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L277)

***

### PreparedAgentCandidateLaunch

Defined in: [src/candidate-execution/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L280)

#### Properties

##### executable

> **executable**: `string`

Defined in: [src/candidate-execution/types.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L281)

##### args

> **args**: readonly `string`[]

Defined in: [src/candidate-execution/types.ts:283](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L283)

Complete fixed argv, including profile materializer flags but excluding task delivery.

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/candidate-execution/types.ts:284](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L284)

##### flags

> **flags**: readonly `string`[]

Defined in: [src/candidate-execution/types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L286)

Informational subset already present at the tail of `args`; executors must not append twice.

##### cwd

> **cwd**: `string`

Defined in: [src/candidate-execution/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L287)

***

### PreparedAgentCandidateInstruction

Defined in: [src/candidate-execution/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L290)

#### Properties

##### bytes

> **bytes**: `Uint8Array`

Defined in: [src/candidate-execution/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L291)

##### delivery

> **delivery**: `AgentCandidateInstructionDelivery`

Defined in: [src/candidate-execution/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L292)

***

### PreparedAgentCandidateKnowledge

Defined in: [src/candidate-execution/types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L296)

Exact file-backed knowledge admitted by the candidate bundle.

#### Properties

##### candidate

> `readonly` **candidate**: `AgentCandidateKnowledgeRef`

Defined in: [src/candidate-execution/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L297)

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/candidate-execution/types.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L298)

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

Defined in: [src/candidate-execution/types.ts:299](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L299)

##### retrievalConfig?

> `readonly` `optional` **retrievalConfig?**: `Uint8Array`\<`ArrayBufferLike`\>

Defined in: [src/candidate-execution/types.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L300)

***

### PreparedAgentCandidateTrace

Defined in: [src/candidate-execution/types.ts:303](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L303)

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/candidate-execution/types.ts:304](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L304)

##### tags

> **tags**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/candidate-execution/types.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L305)

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/candidate-execution/types.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L306)

***

### PreparedAgentCandidateExecution

Defined in: [src/candidate-execution/types.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L309)

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

Defined in: [src/candidate-execution/types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L310)

##### benchmark

> `readonly` **benchmark**: `object`

Defined in: [src/candidate-execution/types.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L311)

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L315)

##### roots

> `readonly` **roots**: `object`

Defined in: [src/candidate-execution/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L316)

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

Defined in: [src/candidate-execution/types.ts:327](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L327)

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

Defined in: [src/candidate-execution/types.ts:332](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L332)

##### executionPlan

> `readonly` **executionPlan**: `object`

Defined in: [src/candidate-execution/types.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L333)

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

Defined in: [src/candidate-execution/types.ts:337](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L337)

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

Defined in: [src/candidate-execution/types.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L338)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

Defined in: [src/candidate-execution/types.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L339)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [src/candidate-execution/types.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L340)

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

Defined in: [src/candidate-execution/types.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L341)

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

Defined in: [src/candidate-execution/types.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L342)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

Defined in: [src/candidate-execution/types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L343)

##### \[preparedCandidateBrand\]

> `readonly` **\[preparedCandidateBrand\]**: `true`

Defined in: [src/candidate-execution/types.ts:344](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L344)

***

### AgentCandidateProtectedRunCapture

Defined in: [src/candidate-execution/types.ts:349](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L349)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: [src/candidate-execution/types.ts:350](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L350)

##### termination

> **termination**: `AgentCandidateTermination`

Defined in: [src/candidate-execution/types.ts:351](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L351)

***

### AgentCandidateExecutorMemoryCapture

Defined in: [src/candidate-execution/types.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L374)

Raw isolated-memory capture made only after access has been revoked.

#### Properties

##### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterial`

Defined in: [src/candidate-execution/types.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L375)

##### archive

> `readonly` **archive**: `Uint8Array`

Defined in: [src/candidate-execution/types.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L376)

***

### AgentCandidateExecutorFinalCapture

Defined in: [src/candidate-execution/types.ts:380](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L380)

Replayable evaluator result captured only after process death and trace drain.

#### Properties

##### taskOutcome?

> `readonly` `optional` **taskOutcome?**: [`AgentCandidateExecutorTaskOutcomeCapture`](#agentcandidateexecutortaskoutcomecapture)

Defined in: [src/candidate-execution/types.ts:381](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L381)

##### memoryAfter?

> `readonly` `optional` **memoryAfter?**: [`AgentCandidateExecutorMemoryCapture`](#agentcandidateexecutormemorycapture)

Defined in: [src/candidate-execution/types.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L383)

Required only when the prepared candidate uses isolated task memory.

##### evidence?

> `readonly` `optional` **evidence?**: `Uint8Array`\<`ArrayBufferLike`\>

Defined in: [src/candidate-execution/types.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L385)

Executor-native bytes preserved when a fresh worker cannot reconstruct a verified outcome.

***

### AgentCandidateBenchmarkGraderPort

Defined in: [src/candidate-execution/types.ts:422](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L422)

Evaluator-owned executable grader, pinned by immutable implementation bytes.

`run` is an isolation boundary, not an arbitrary scoring callback. The
implementation admitted to that boundary is supplied by the runtime after
artifact verification. Implementations must derive every returned binding
digest from the bytes and task outcome they actually admitted, rather than
copying an expected digest from ambient configuration.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/candidate-execution/types.ts:423](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L423)

##### version

> `readonly` **version**: `string`

Defined in: [src/candidate-execution/types.ts:424](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L424)

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

Defined in: [src/candidate-execution/types.ts:425](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L425)

#### Methods

##### run()

> **run**(`input`): `Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

Defined in: [src/candidate-execution/types.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L426)

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

Defined in: [src/candidate-execution/types.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L454)

One detached request passed to the trusted environment-specific executor.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L455)

##### benchmark

> `readonly` **benchmark**: `object`

Defined in: [src/candidate-execution/types.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L456)

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### inputs

> `readonly` **inputs**: `object`

Defined in: [src/candidate-execution/types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L458)

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

Defined in: [src/candidate-execution/types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L465)

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### profilePlan

> `readonly` **profilePlan**: `object`

Defined in: [src/candidate-execution/types.ts:466](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L466)

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

Defined in: [src/candidate-execution/types.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L467)

##### executionPlan

> `readonly` **executionPlan**: `object`

Defined in: [src/candidate-execution/types.ts:468](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L468)

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

Defined in: [src/candidate-execution/types.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L469)

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

Defined in: [src/candidate-execution/types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L470)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

Defined in: [src/candidate-execution/types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L471)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

Defined in: [src/candidate-execution/types.ts:472](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L472)

##### hardLimits

> `readonly` **hardLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"timeoutMs"`\>

Defined in: [src/candidate-execution/types.ts:474](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L474)

Mechanically enforced by the runtime plus executor process-death acknowledgement.

##### observedLimits

> `readonly` **observedLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"maxSteps"`\>

Defined in: [src/candidate-execution/types.ts:476](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L476)

Validity bound checked against protected traces; generic black-box executors cannot preempt it.

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

Defined in: [src/candidate-execution/types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L477)

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

Defined in: [src/candidate-execution/types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L478)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

Defined in: [src/candidate-execution/types.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L479)

***

### AgentCandidateExecutorPort

Defined in: [src/candidate-execution/types.ts:490](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L490)

Executes one prepared request inside an evaluator-owned isolation boundary.

`request.launch.env` is the complete allowlisted environment, including
protected model, memory, and trace bindings. Implementations must not merge
ambient host variables into it. The returned capture deliberately contains
no candidate-authored usage or score fields.

#### Methods

##### execute()

> **execute**(`request`, `context`): `Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

Defined in: [src/candidate-execution/types.ts:491](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L491)

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

##### stop()

> **stop**(`request`, `context`): `Promise`\<\{ `stopped`: `true`; \}\>

Defined in: [src/candidate-execution/types.ts:502](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L502)

Kill the exact process/container and drain trace writes. Must be idempotent.

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

`Promise`\<\{ `stopped`: `true`; \}\>

##### capture()

> **capture**(`request`, `context`): `Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

Defined in: [src/candidate-execution/types.ts:514](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L514)

Capture immutable final evidence after stop. Must be replayable by a fresh worker.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### traceStore

`TraceStore`

###### signal

`AbortSignal`

Aborted at the frozen execution deadline or evaluator cleanup deadline.

###### Returns

`Promise`\<[`AgentCandidateExecutorFinalCapture`](#agentcandidateexecutorfinalcapture)\>

##### dispose()?

> `optional` **dispose**(`request`, `context`): `Promise`\<\{ `disposed`: `true`; \}\>

Defined in: [src/candidate-execution/types.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L523)

Remove evaluator-owned execution resources after final capture. Must be idempotent.

###### Parameters

###### request

[`AgentCandidateExecutorStopRequest`](#agentcandidateexecutorstoprequest)

###### context

###### signal

`AbortSignal`

###### Returns

`Promise`\<\{ `disposed`: `true`; \}\>

***

### AgentCandidateExecutorStopRequest

Defined in: [src/candidate-execution/types.ts:532](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L532)

Opaque process identity used for termination without re-exposing launch credentials.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

Defined in: [src/candidate-execution/types.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L533)

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

Defined in: [src/candidate-execution/types.ts:534](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L534)

***

### AgentCandidateExecutorWorkspaceInput

Defined in: [src/candidate-execution/types.ts:537](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L537)

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/candidate-execution/types.ts:538](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L538)

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

Defined in: [src/candidate-execution/types.ts:539](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L539)

***

### AgentCandidateExecutorWorkspaceFile

Defined in: [src/candidate-execution/types.ts:542](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L542)

#### Properties

##### path

> `readonly` **path**: `string`

Defined in: [src/candidate-execution/types.ts:543](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L543)

##### mode

> `readonly` **mode**: `number`

Defined in: [src/candidate-execution/types.ts:544](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L544)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [src/candidate-execution/types.ts:545](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L545)

***

### AgentCandidateExecutorProfileFile

Defined in: [src/candidate-execution/types.ts:549](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L549)

One exact profile file supplied to an evaluator-owned executor.

#### Properties

##### path

> `readonly` **path**: `string`

Defined in: [src/candidate-execution/types.ts:550](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L550)

##### mode

> `readonly` **mode**: `number`

Defined in: [src/candidate-execution/types.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L551)

##### bytes

> `readonly` **bytes**: `Uint8Array`

Defined in: [src/candidate-execution/types.ts:552](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L552)

***

### AgentCandidateWorkspaceArchiveLimits

Defined in: [src/candidate-execution/workspace-archive.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L56)

#### Properties

##### maxArchiveBytes

> **maxArchiveBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L57)

##### maxEmbeddedArtifactBytes

> **maxEmbeddedArtifactBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L58)

##### maxFiles

> **maxFiles**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L59)

##### maxFileBytes

> **maxFileBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L60)

##### maxTotalFileBytes

> **maxTotalFileBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L61)

##### maxPathBytes

> **maxPathBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L62)

##### maxRepositoryBundleBytes

> **maxRepositoryBundleBytes**: `number`

Defined in: [src/candidate-execution/workspace-archive.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L63)

***

### CaptureAgentCandidateWorkspaceOptions

Defined in: [src/candidate-execution/workspace-archive.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L101)

#### Properties

##### includeRepository?

> `optional` **includeRepository?**: `boolean`

Defined in: [src/candidate-execution/workspace-archive.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L103)

Include Git HEAD so task preparation can prove its exact commit and tree.

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

Defined in: [src/candidate-execution/workspace-archive.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L104)

##### artifactPersistence?

> `optional` **artifactPersistence?**: `object`

Defined in: [src/candidate-execution/workspace-archive.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L106)

Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded.

###### executionId

> **executionId**: `string`

###### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

###### signal?

> `optional` **signal?**: `AbortSignal`

***

### CreateAgentCandidateWorkspacePortOptions

Defined in: [src/candidate-execution/workspace-archive.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L113)

#### Properties

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

Defined in: [src/candidate-execution/workspace-archive.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L114)

***

### CapturedAgentCandidateWorkspace

Defined in: [src/candidate-execution/workspace-archive.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L117)

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/candidate-execution/workspace-archive.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L118)

##### archive

> `readonly` **archive**: `Uint8Array`

Defined in: [src/candidate-execution/workspace-archive.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L120)

Caller-owned bytes accepted by createAgentCandidateWorkspacePort.

***

### CircuitBreakerConfig

Defined in: [src/conversation/call-policy.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L24)

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

#### Properties

##### failuresToOpen

> **failuresToOpen**: `number`

Defined in: [src/conversation/call-policy.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L25)

##### cooldownMs

> **cooldownMs**: `number`

Defined in: [src/conversation/call-policy.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L26)

***

### BackendCallPolicy

Defined in: [src/conversation/call-policy.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L29)

#### Properties

##### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Defined in: [src/conversation/call-policy.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L31)

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [src/conversation/call-policy.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L33)

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

##### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](#retrybackoff)

Defined in: [src/conversation/call-policy.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L35)

Backoff between attempts. Default 250ms with jitter.

##### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [src/conversation/call-policy.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L37)

Custom retry classifier. Defaults to [defaultIsRetryable](#defaultisretryable).

##### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](#circuitbreakerconfig)

Defined in: [src/conversation/call-policy.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L39)

Circuit breaker that opens after N consecutive failures per participant.

***

### SqlAdapter

Defined in: [src/conversation/journal-sql.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L49)

Minimal SQL driver shape. Implementations forward to whichever client the
deployment already uses; agent-runtime takes no opinion on which.

Parameter placeholders MUST be `?` (positional). All adapters listed in the
file header accept this convention.

#### Methods

##### exec()

> **exec**(`sql`, `params?`): `Promise`\<\{ `rowsAffected`: `number`; \}\>

Defined in: [src/conversation/journal-sql.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L51)

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

Defined in: [src/conversation/journal-sql.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L53)

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

Defined in: [src/conversation/journal-sql.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L84)

Structural type matching the surface of `D1Database` we depend on, so the
SDK never imports `@cloudflare/workers-types`. Consumers pass their real
`D1Database` from `env.DB` and TS structural compatibility lines it up.

#### Methods

##### prepare()

> **prepare**(`sql`): [`D1StmtLike`](#d1stmtlike)

Defined in: [src/conversation/journal-sql.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L85)

###### Parameters

###### sql

`string`

###### Returns

[`D1StmtLike`](#d1stmtlike)

***

### D1StmtLike

Defined in: [src/conversation/journal-sql.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L87)

#### Methods

##### bind()

> **bind**(...`params`): [`D1StmtLike`](#d1stmtlike)

Defined in: [src/conversation/journal-sql.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L88)

###### Parameters

###### params

...`unknown`[]

###### Returns

[`D1StmtLike`](#d1stmtlike)

##### run()

> **run**(): `Promise`\<`unknown`\>

Defined in: [src/conversation/journal-sql.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L89)

###### Returns

`Promise`\<`unknown`\>

##### all()

> **all**\<`TRow`\>(): `Promise`\<\{ `results?`: `TRow`[]; \}\>

Defined in: [src/conversation/journal-sql.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L90)

###### Type Parameters

###### TRow

`TRow` = `unknown`

###### Returns

`Promise`\<\{ `results?`: `TRow`[]; \}\>

***

### ConversationJournalEntry

Defined in: [src/conversation/journal.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L20)

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/conversation/journal.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L21)

##### startedAt

> **startedAt**: `string`

Defined in: [src/conversation/journal.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L22)

##### halted?

> `optional` **halted?**: [`HaltReason`](#haltreason)

Defined in: [src/conversation/journal.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L24)

Set when the run reaches a terminal state.

##### endedAt?

> `optional` **endedAt?**: `string`

Defined in: [src/conversation/journal.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L25)

##### turns

> **turns**: [`ConversationTurn`](#conversationturn)[]

Defined in: [src/conversation/journal.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L26)

***

### ConversationJournal

Defined in: [src/conversation/journal.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L29)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [src/conversation/journal.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L36)

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

Defined in: [src/conversation/journal.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L43)

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

Defined in: [src/conversation/journal.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L50)

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

Defined in: [src/conversation/journal.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L56)

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

Defined in: [src/conversation/run-persona.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L36)

#### Properties

##### worker

> **worker**: `AgentProfile`

Defined in: [src/conversation/run-persona.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L38)

The agent under test. Metered; its rendered prompt leads its turns.

##### persona

> **persona**: [`PersonaDriver`](#personadriver)

Defined in: [src/conversation/run-persona.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L40)

The simulated user driving the dialogue.

##### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [src/conversation/run-persona.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L43)

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

Defined in: [src/conversation/run-persona.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L45)

Render a profile's system prompt — prepended to that profile's messages.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string`

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [src/conversation/run-persona.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L48)

Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
 (worker answers each user turn). REQUIRED for a `profile` persona.

##### seed?

> `optional` **seed?**: `string`

Defined in: [src/conversation/run-persona.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L50)

Kickoff message routed to the first speaker (the persona). Default 'Begin.'

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [src/conversation/run-persona.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L53)

Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
 hard ceiling; this is the early stop (the persona declares the goal met / unreachable).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/conversation/run-persona.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L54)

##### workerName?

> `optional` **workerName?**: `string`

Defined in: [src/conversation/run-persona.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L56)

Worker participant / transcript speaker label. Default 'agent'.

***

### PersonaConversationResult

Defined in: [src/conversation/run-persona.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L59)

#### Properties

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

Defined in: [src/conversation/run-persona.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L60)

##### turns

> **turns**: `number`

Defined in: [src/conversation/run-persona.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L61)

##### halted

> **halted**: [`HaltReason`](#haltreason)

Defined in: [src/conversation/run-persona.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L62)

##### costUsd

> **costUsd**: `number`

Defined in: [src/conversation/run-persona.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L64)

Worker-only spend (the side under test).

##### tokensIn

> **tokensIn**: `number`

Defined in: [src/conversation/run-persona.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L65)

##### tokensOut

> **tokensOut**: `number`

Defined in: [src/conversation/run-persona.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L66)

***

### RunPersonaConfig

Defined in: [src/conversation/run-persona.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L198)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### backendFor

> **backendFor**: (`profile`, `role`) => [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [src/conversation/run-persona.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L200)

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

Defined in: [src/conversation/run-persona.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L202)

Render a profile's system prompt.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string`

##### personaOf

> **personaOf**: (`scenario`) => [`PersonaDriver`](#personadriver)

Defined in: [src/conversation/run-persona.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L204)

The persona driving each scenario — a driver profile or scripted turns.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`PersonaDriver`](#personadriver)

##### artifactOf

> **artifactOf**: (`transcript`, `scenario`) => `TArtifact`

Defined in: [src/conversation/run-persona.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L206)

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

Defined in: [src/conversation/run-persona.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L208)

Speaker-turn cap (required when a persona is profile-driven).

###### Parameters

###### scenario

`TScenario`

###### Returns

`number`

##### seed?

> `optional` **seed?**: (`scenario`) => `string`

Defined in: [src/conversation/run-persona.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L209)

###### Parameters

###### scenario

`TScenario`

###### Returns

`string`

##### workerName?

> `optional` **workerName?**: `string`

Defined in: [src/conversation/run-persona.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L210)

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`worker`, `scenario`) => MaximumCharge \| undefined)

Defined in: [src/conversation/run-persona.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L213)

Provider- or executor-enforced maximum for the whole worker conversation.
Required before execution when the enclosing campaign is cost-capped.

***

### ConversationParticipant

Defined in: [src/conversation/types.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L21)

#### Stable

#### Properties

##### name

> **name**: `string`

Defined in: [src/conversation/types.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L26)

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [src/conversation/types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L33)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so any
registered backend (iterable, sandbox, OpenAI-compatible) works without
adaptation.

##### label?

> `optional` **label?**: `string`

Defined in: [src/conversation/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L38)

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

##### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [src/conversation/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L44)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

##### authSource?

> `optional` **authSource?**: [`AuthSource`](#authsource-1)

Defined in: [src/conversation/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L64)

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

Defined in: [src/conversation/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L77)

#### Stable

#### Extended by

- [`HaltContext`](#haltcontext)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [src/conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

##### turnIndex

> **turnIndex**: `number`

Defined in: [src/conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [src/conversation/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L80)

***

### HaltContext

Defined in: [src/conversation/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L84)

#### Stable

#### Extends

- [`ConversationDriveState`](#conversationdrivestate)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [src/conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`transcript`](#transcript-1)

##### turnIndex

> **turnIndex**: `number`

Defined in: [src/conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`turnIndex`](#turnindex)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [src/conversation/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L80)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`spentCreditsCents`](#spentcreditscents)

##### lastTurn

> **lastTurn**: [`ConversationTurn`](#conversationturn)

Defined in: [src/conversation/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L85)

***

### HaltSignal

Defined in: [src/conversation/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L89)

#### Stable

#### Properties

##### halted

> **halted**: `true`

Defined in: [src/conversation/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L90)

##### reason

> **reason**: `string`

Defined in: [src/conversation/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L91)

***

### ConversationPolicy

Defined in: [src/conversation/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L108)

#### Stable

#### Properties

##### maxTurns

> **maxTurns**: `number`

Defined in: [src/conversation/types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L110)

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

##### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Defined in: [src/conversation/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L117)

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

##### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](#turnorder)

Defined in: [src/conversation/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L122)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [src/conversation/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L127)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

##### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [src/conversation/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L133)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.

***

### ConversationTurn

Defined in: [src/conversation/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L137)

#### Stable

#### Properties

##### index

> **index**: `number`

Defined in: [src/conversation/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L138)

##### speaker

> **speaker**: `string`

Defined in: [src/conversation/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L139)

##### turnId

> **turnId**: `string`

Defined in: [src/conversation/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L145)

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [src/conversation/types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L147)

Backend session used for this turn. Present on turns recorded by session-aware runners.

##### text

> **text**: `string`

Defined in: [src/conversation/types.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L148)

##### usage?

> `optional` **usage?**: `object`

Defined in: [src/conversation/types.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L154)

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

Defined in: [src/conversation/types.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L166)

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

##### startedAt

> **startedAt**: `string`

Defined in: [src/conversation/types.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L167)

##### endedAt

> **endedAt**: `string`

Defined in: [src/conversation/types.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L168)

***

### Conversation

Defined in: [src/conversation/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L172)

#### Stable

#### Properties

##### participants

> **participants**: readonly [`ConversationParticipant`](#conversationparticipant)[]

Defined in: [src/conversation/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L173)

##### policy

> **policy**: [`ConversationPolicy`](#conversationpolicy)

Defined in: [src/conversation/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L174)

***

### RunConversationOptions

Defined in: [src/conversation/types.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L178)

#### Stable

#### Properties

##### seed

> **seed**: `string`

Defined in: [src/conversation/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L180)

First message kicking off the conversation. Routes to the first speaker.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/conversation/types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L187)

Optional run identifier for cross-participant trace correlation. Auto-
generated when omitted. Reusing a runId against the same `journal`
resumes the prior run — the runner replays the persisted transcript and
continues from the first un-recorded turn.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/conversation/types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L189)

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [src/conversation/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L196)

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

Defined in: [src/conversation/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L203)

Optional durable transcript. When set, the runner persists every
committed turn before yielding `turn_end`. Reusing the same `runId`
against the same journal resumes from the last committed turn — so a
driver process crash mid-run loses zero acknowledged turns.

##### sessionStore?

> `optional` **sessionStore?**: [`RuntimeSessionStore`](#runtimesessionstore)

Defined in: [src/conversation/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L210)

Stores each participant's backend session. The runner keeps an in-memory
store for one invocation when omitted. Reuse a durable store with the same
`runId` and journal after a process restart. Backends implementing `resume`
continue their provider session; other backends receive the full transcript.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/conversation/types.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L217)

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

##### inboundDepth?

> `optional` **inboundDepth?**: `number`

Defined in: [src/conversation/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L223)

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_DEPTH`. Default 0 (origin caller).

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [src/conversation/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L230)

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.

***

### ConversationResult

Defined in: [src/conversation/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L234)

#### Stable

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/conversation/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L235)

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

Defined in: [src/conversation/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L236)

##### turns

> **turns**: `number`

Defined in: [src/conversation/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L237)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [src/conversation/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L238)

##### halted

> **halted**: [`HaltReason`](#haltreason)

Defined in: [src/conversation/types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L239)

##### durationMs

> **durationMs**: `number`

Defined in: [src/conversation/types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L240)

##### startedAt

> **startedAt**: `string`

Defined in: [src/conversation/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L241)

##### endedAt

> **endedAt**: `string`

Defined in: [src/conversation/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L242)

***

### ChatStreamEvent

Defined in: [src/durable/chat-engine.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L28)

The NDJSON line protocol every product chat client already speaks.

#### Properties

##### type

> **type**: `string`

Defined in: [src/durable/chat-engine.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L29)

##### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

Defined in: [src/durable/chat-engine.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L30)

***

### ChatTurnIdentity

Defined in: [src/durable/chat-engine.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L35)

Identity of a chat turn. `tenantId` is the workspace id for workspace-
 scoped products and the user id for session-scoped products.

#### Properties

##### tenantId

> **tenantId**: `string`

Defined in: [src/durable/chat-engine.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L36)

##### sessionId

> **sessionId**: `string`

Defined in: [src/durable/chat-engine.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L38)

Thread / session id.

##### userId

> **userId**: `string`

Defined in: [src/durable/chat-engine.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L39)

##### turnIndex

> **turnIndex**: `number`

Defined in: [src/durable/chat-engine.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L41)

Monotonic 0-based turn index within the session.

***

### ChatTurnProducer

Defined in: [src/durable/chat-engine.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L45)

The live side of a turn — what the product's `produce` hook returns.

#### Type Parameters

##### TEvent

`TEvent` *extends* [`ChatStreamEvent`](#chatstreamevent) = [`ChatStreamEvent`](#chatstreamevent)

#### Properties

##### stream

> **stream**: `AsyncGenerator`\<`TEvent`, `void`, `unknown`\>

Defined in: [src/durable/chat-engine.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L47)

The turn's event stream. Forwarded verbatim to the caller.

#### Methods

##### finalText()

> **finalText**(): `string`

Defined in: [src/durable/chat-engine.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L49)

The turn's final assistant text. Read once, after `stream` drains.

###### Returns

`string`

***

### ChatTurnHooks

Defined in: [src/durable/chat-engine.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L52)

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

Defined in: [src/durable/chat-engine.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L55)

Build the backend stream. The engine forwards events verbatim and
 reads `finalText()` once the stream drains.

###### Returns

[`ChatTurnProducer`](#chatturnproducer)

##### persistAssistantMessage()

> **persistAssistantMessage**(`input`): `Promise`\<`void`\>

Defined in: [src/durable/chat-engine.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L58)

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

Defined in: [src/durable/chat-engine.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L62)

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

Defined in: [src/durable/chat-engine.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L66)

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

Defined in: [src/durable/chat-engine.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L70)

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

Defined in: [src/durable/chat-engine.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L73)

Optional trace flush — resolves when OTLP export completes. Handed
 to `waitUntil` so the worker isolate stays alive for the POST.

###### Returns

`Promise`\<`void`\>

***

### RunChatTurnInput

Defined in: [src/durable/chat-engine.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L76)

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

Defined in: [src/durable/chat-engine.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L77)

##### hooks

> **hooks**: [`ChatTurnHooks`](#chatturnhooks)

Defined in: [src/durable/chat-engine.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L78)

##### waitUntil?

> `optional` **waitUntil?**: (`p`) => `void`

Defined in: [src/durable/chat-engine.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L81)

Worker liveness hook. When omitted, trace flush is awaited inline
 before the stream closes.

###### Parameters

###### p

`Promise`\<`unknown`\>

###### Returns

`void`

##### log?

> `optional` **log?**: (`message`, `meta?`) => `void`

Defined in: [src/durable/chat-engine.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L84)

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

Defined in: [src/durable/chat-engine.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L87)

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

Defined in: [src/durable/chat-engine.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L89)

NDJSON body — return this as the platform `Response` body.

##### contentType

> **contentType**: `"application/x-ndjson"`

Defined in: [src/durable/chat-engine.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L91)

Content type for the response.

***

### VerifyResult

Defined in: [src/improvement/agentic-generator.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L74)

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [src/improvement/agentic-generator.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L75)

##### feedback?

> `optional` **feedback?**: `string`

Defined in: [src/improvement/agentic-generator.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L76)

***

### AgenticGeneratorShotReceipt

Defined in: [src/improvement/agentic-generator.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L87)

`@tangle-network/agent-runtime` improvement.

The public entry point is `improve()`. Complete agent-eval methods optimize
profile surfaces. Runtime owns only code candidates that mutate an isolated
git worktree through a pluggable `CandidateGenerator`.

#### Properties

##### generation

> `readonly` **generation**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L88)

##### candidateIndex

> `readonly` **candidateIndex**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L89)

##### shot

> `readonly` **shot**: `number`

Defined in: [src/improvement/agentic-generator.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L91)

One-based shot number within this candidate.

##### maxShots

> `readonly` **maxShots**: `number`

Defined in: [src/improvement/agentic-generator.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L92)

##### harness

> `readonly` **harness**: [`LocalHarness`](mcp.md#localharness)

Defined in: [src/improvement/agentic-generator.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L93)

##### model

> `readonly` **model**: `string` \| `null`

Defined in: [src/improvement/agentic-generator.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L94)

##### reasoningEffort

> `readonly` **reasoningEffort**: `ReasoningEffort` \| `null`

Defined in: [src/improvement/agentic-generator.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L95)

##### promptSha256

> `readonly` **promptSha256**: `` `sha256:${string}` ``

Defined in: [src/improvement/agentic-generator.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L96)

##### startedAt

> `readonly` **startedAt**: `string`

Defined in: [src/improvement/agentic-generator.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L97)

##### completedAt

> `readonly` **completedAt**: `string`

Defined in: [src/improvement/agentic-generator.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L98)

##### durationMs

> `readonly` **durationMs**: `number`

Defined in: [src/improvement/agentic-generator.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L99)

##### exitCode

> `readonly` **exitCode**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L100)

##### timedOut

> `readonly` **timedOut**: `boolean`

Defined in: [src/improvement/agentic-generator.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L101)

##### aborted?

> `readonly` `optional` **aborted?**: `boolean`

Defined in: [src/improvement/agentic-generator.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L103)

True when caller cancellation reached the author process; absent in older receipts.

##### killedBySignal

> `readonly` **killedBySignal**: `Signals` \| `null`

Defined in: [src/improvement/agentic-generator.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L104)

##### stdoutBytes

> `readonly` **stdoutBytes**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L105)

##### stdoutSha256

> `readonly` **stdoutSha256**: `` `sha256:${string}` `` \| `null`

Defined in: [src/improvement/agentic-generator.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L106)

##### stderrBytes

> `readonly` **stderrBytes**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L107)

##### stderrSha256

> `readonly` **stderrSha256**: `` `sha256:${string}` `` \| `null`

Defined in: [src/improvement/agentic-generator.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L108)

##### usage

> `readonly` **usage**: [`CodexTokenUsage`](mcp.md#codextokenusage) \| `null`

Defined in: [src/improvement/agentic-generator.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L109)

##### profileWorkspacePlanDigest

> `readonly` **profileWorkspacePlanDigest**: `string` \| `null`

Defined in: [src/improvement/agentic-generator.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L111)

Digest of the exact profile-file workspace plan applied for this shot.

##### profileWorkspaceFileCount

> `readonly` **profileWorkspaceFileCount**: `number`

Defined in: [src/improvement/agentic-generator.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L112)

##### costCallId

> `readonly` **costCallId**: `string` \| `null`

Defined in: [src/improvement/agentic-generator.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L114)

Shared run-ledger call id for this exact shot.

##### costBasis

> `readonly` **costBasis**: `"unknown"` \| `"provider-reported"` \| `"estimated-pricing"`

Defined in: [src/improvement/agentic-generator.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L116)

Whether dollars came from the provider, the pricing table, or are unknown.

##### costUsd

> `readonly` **costUsd**: `number` \| `null`

Defined in: [src/improvement/agentic-generator.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L117)

##### costUsdKnown

> `readonly` **costUsdKnown**: `boolean`

Defined in: [src/improvement/agentic-generator.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L119)

True only for a provider-reported amount, never for a pricing estimate.

##### evidence

> `readonly` **evidence**: [`CodexExecutionEvidence`](mcp.md#codexexecutionevidence) \| `null`

Defined in: [src/improvement/agentic-generator.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L120)

##### error

> `readonly` **error**: \{ `name`: `string`; `message`: `string`; \} \| `null`

Defined in: [src/improvement/agentic-generator.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L121)

***

### AgenticGeneratorOptions

Defined in: [src/improvement/agentic-generator.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L164)

`@tangle-network/agent-runtime` improvement.

The public entry point is `improve()`. Complete agent-eval methods optimize
profile surfaces. Runtime owns only code candidates that mutate an isolated
git worktree through a pluggable `CandidateGenerator`.

#### Properties

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [src/improvement/agentic-generator.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L166)

Local coding harness to run in the worktree. Default `claude`.

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/improvement/agentic-generator.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L169)

Author profile rendered through the canonical harness mapper. Required
 for reproducible Codex so model and reasoning settings are explicit.

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

Defined in: [src/improvement/agentic-generator.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L172)

Run Codex with isolated configuration, exact prompt evidence, and required
 terminal token usage. Requires `harness: 'codex'` and `profile`.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[] \| ((`worktreePath`) => readonly `string`[])

Defined in: [src/improvement/agentic-generator.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L175)

Absolute paths reproducible Codex must not read. A function can derive
 candidate-specific paths after the driver creates its worktree.

##### onShotCompleted?

> `optional` **onShotCompleted?**: (`receipt`, `execution`) => `void` \| `Promise`\<`void`\>

Defined in: [src/improvement/agentic-generator.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L180)

Awaited once for every attempted author shot, including process failures.
 The second argument preserves the exact harness result, including stdout
 and stderr, before worktree inspection or verification can reject the
 shot. Throwing aborts the candidate so evidence persistence fails closed.

###### Parameters

###### receipt

[`AgenticGeneratorShotReceipt`](#agenticgeneratorshotreceipt)

###### execution

`Readonly`\<`Omit`\<[`LocalHarnessResult`](mcp.md#localharnessresult), `"usage"` \| `"evidence"`\> & `object`\> \| `null`

###### Returns

`void` \| `Promise`\<`void`\>

##### onShotDisposition?

> `optional` **onShotDisposition?**: (`receipt`, `disposition`) => `void` \| `Promise`\<`void`\>

Defined in: [src/improvement/agentic-generator.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L186)

Awaited after worktree inspection and before the shot is accepted,
 retried, or discarded. Throwing aborts the candidate.

###### Parameters

###### receipt

[`AgenticGeneratorShotReceipt`](#agenticgeneratorshotreceipt)

###### disposition

[`AgenticGeneratorShotDisposition`](#agenticgeneratorshotdisposition)

###### Returns

`void` \| `Promise`\<`void`\>

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge`

Defined in: [src/improvement/agentic-generator.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L194)

Optional hard upper bound passed to the run-wide CostLedger before each
 author shot. This MUST be enforced by the provider or executor; a planning
 estimate is not an admissible bound. Omit for an uncapped ledger. A capped
 ledger rejects before model dispatch when this is absent.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/improvement/agentic-generator.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L196)

Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

##### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [src/improvement/agentic-generator.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L199)

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

Defined in: [src/improvement/agentic-generator.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L205)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
 the first dirty shot is the candidate. See `commandVerifier`.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [src/improvement/agentic-generator.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L207)

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
  - the caller signal was already aborted before process launch

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
    `result.timedOut` carries the reason even when a TERM-aware child exits zero)

Reproducible Codex additionally requires a terminal usage event. If cancellation
prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
returning an incomplete reproducibility receipt.

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Defined in: [src/improvement/agentic-generator.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L209)

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### DriverLoopGeneratorOptions

Defined in: [src/improvement/driver-loop-generator.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L45)

#### Properties

##### brain

> **brain**: [`ToolLoopChat`](runtime.md#toolloopchat)

Defined in: [src/improvement/driver-loop-generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L49)

The driver-LLM seam — ONE inference turn over the conversation + tool specs (the canonical
 `ToolLoopChat`, same seam as `driverAgent`): `routerBrain(cfg)` in production, a scripted
 mock in tests.

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [src/improvement/driver-loop-generator.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L51)

Local coding harness the driver's worker sessions run in the worktree. Default `claude`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/improvement/driver-loop-generator.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L53)

Per-worker-session wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

##### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [src/improvement/driver-loop-generator.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L57)

Build the driver's task briefing (domain framing + method + findings) — the same senior
 prompt the worker path uses (`toolBuildPrompt` / `mcpBuildPrompt`). The driver reads it and
 folds what each worker needs into its instruction. Default `defaultBuildPrompt`.

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

Defined in: [src/improvement/driver-loop-generator.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L61)

Verify the worktree (the intrinsic check). Exposed to the driver as `run_verifier` AND
 re-run by code as the final keep/discard gate. Omitted ⇒ the final gate is dirty-tree only
 (legacy `agenticGenerator` behavior sans verifier).

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [src/improvement/driver-loop-generator.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L64)

Max driver inference turns. Default `max(8, 2 + maxShots * 3)` — room for one
 observe/rate/decide cycle per worker session plus orientation.

##### research?

> `optional` **research?**: (`query`) => `Promise`\<`string`\>

Defined in: [src/improvement/driver-loop-generator.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L70)

The research seam (adopt-not-build): when set, the driver gets a
 `research{query}` tool + the `researchDriverNote` doctrine, so it can
 discover an EXISTING external MCP instead of building one. Wire a real
 web/search backend here — none is provisioned by default (the build
 harness has no live web access yet; flagged).

###### Parameters

###### query

`string`

###### Returns

`Promise`\<`string`\>

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [src/improvement/driver-loop-generator.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L72)

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
  - the caller signal was already aborted before process launch

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
    `result.timedOut` carries the reason even when a TERM-aware child exits zero)

Reproducible Codex additionally requires a terminal usage event. If cancellation
prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
returning an incomplete reproducibility receipt.

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### readDiff?

> `optional` **readDiff?**: (`worktreePath`) => `string`

Defined in: [src/improvement/driver-loop-generator.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L74)

Test seam — inject the worktree diff reader (defaults to `git diff` in the worktree).

###### Parameters

###### worktreePath

`string`

###### Returns

`string`

##### changedPaths?

> `optional` **changedPaths?**: (`worktreePath`) => `string`[]

Defined in: [src/improvement/driver-loop-generator.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L76)

Test seam — inject the changed-paths reader (defaults to `git status --porcelain`).

###### Parameters

###### worktreePath

`string`

###### Returns

`string`[]

***

### ToAnalystFindingsOptions

Defined in: [src/improvement/findings.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L69)

#### Properties

##### analystId?

> `optional` **analystId?**: `string`

Defined in: [src/improvement/findings.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L72)

`analyst_id` stamped on lifted (non-conforming) values.
 Default [LIFTED\_FINDING\_ANALYST\_ID](#lifted_finding_analyst_id).

##### area?

> `optional` **area?**: `string`

Defined in: [src/improvement/findings.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L74)

`area` stamped on lifted values. Default `'seed'`.

***

### ImproveMethodContext

Defined in: [src/improvement/improve-types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L39)

#### Properties

##### profile

> `readonly` **profile**: `object`

Defined in: [src/improvement/improve-types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L41)

Validated baseline profile.

##### evaluationRef

> `readonly` **evaluationRef**: `` `sha256:${string}` ``

Defined in: [src/improvement/improve-types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L43)

Runtime-derived identity for upstream optimizer resume state.

##### surface

> `readonly` **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Defined in: [src/improvement/improve-types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L45)

Exact profile coordinate being optimized.

##### baselineSurface

> `readonly` **baselineSurface**: `MutableSurface`

Defined in: [src/improvement/improve-types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L47)

Exact bytes supplied to the optimization method.

##### baselineValue

> `readonly` **baselineValue**: `unknown`

Defined in: [src/improvement/improve-types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L49)

Structured value represented by `baselineSurface`, before serialization.

##### findings

> `readonly` **findings**: readonly `unknown`[]

Defined in: [src/improvement/improve-types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L51)

Findings produced before this search, if any.

***

### ImproveSkillsOptions

Defined in: [src/improvement/improve-types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L155)

#### Properties

##### resourceName

> **resourceName**: `string`

Defined in: [src/improvement/improve-types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L157)

`name` of one inline entry in `profile.resources.skills`.

***

### ImproveProfileComponents

Defined in: [src/improvement/improve-types.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L161)

Caller-owned mapping for optimizing several profile fields as one candidate.

#### Methods

##### read()

> **read**(`profile`): `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/improvement/improve-types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L163)

Extract the exact named text components optimized together.

###### Parameters

###### profile

###### Returns

`Readonly`\<`Record`\<`string`, `string`\>\>

##### apply()

> **apply**(`profile`, `components`): `object`

Defined in: [src/improvement/improve-types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L165)

Apply a complete winning component map to a detached profile.

###### Parameters

###### profile

###### components

`Readonly`\<`Record`\<`string`, `string`\>\>

###### Returns

`object`

***

### ImproveCodeOptions

Defined in: [src/improvement/improve-types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L171)

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [src/improvement/improve-types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L173)

Repo root candidate worktrees fork from.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [src/improvement/improve-types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L175)

Base ref candidates fork from. Default `main`.

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Defined in: [src/improvement/improve-types.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L177)

Directory worktrees are created under. Default `<repoRoot>/.worktrees`.

##### worktree?

> `optional` **worktree?**: `WorktreeAdapter`

Defined in: [src/improvement/improve-types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L180)

Git-compatible adapter override, primarily for tests. Candidate advancement
still requires normal Git worktree and commit semantics.

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [src/improvement/improve-types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L182)

Coding harness the agentic generator runs in each worktree. Default `claude`.

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Defined in: [src/improvement/improve-types.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L185)

Verify a candidate worktree before it becomes a measurable surface; failures
feed the next shot (see `agenticGenerator.verify` / `commandVerifier`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/improvement/improve-types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L187)

Per-shot wall-clock timeout for the harness (ms).

##### generator?

> `optional` **generator?**: [`CandidateGenerator`](#candidategenerator)

Defined in: [src/improvement/improve-types.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L190)

Byte-producer override, used for tests and custom candidate production.
When set, `harness`, `verify`, and `timeoutMs` are unused.

***

### ImprovementProfileCandidate

Defined in: [src/improvement/improve-types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L193)

#### Properties

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Defined in: [src/improvement/improve-types.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L195)

Surface searched by this run.

##### value

> **value**: `MutableSurface`

Defined in: [src/improvement/improve-types.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L197)

Exact winning value returned by agent-eval.

##### profile

> **profile**: `object`

Defined in: [src/improvement/improve-types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L199)

Exact complete profile instance measured on the final cases.

***

### ImprovementCodeCandidate

Defined in: [src/improvement/improve-types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L202)

#### Properties

##### surface

> **surface**: `"code"`

Defined in: [src/improvement/improve-types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L203)

##### value

> **value**: `MutableSurface`

Defined in: [src/improvement/improve-types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L204)

##### profile?

> `optional` **profile?**: `undefined`

Defined in: [src/improvement/improve-types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L205)

***

### ImproveCost

Defined in: [src/improvement/improve-types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L211)

Normalized spend reported for one Runtime improvement run.

#### Properties

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [src/improvement/improve-types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L212)

##### accountingComplete

> **accountingComplete**: `boolean`

Defined in: [src/improvement/improve-types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L213)

##### incompleteReasons

> **incompleteReasons**: `string`[]

Defined in: [src/improvement/improve-types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L214)

***

### ImproveLineage

Defined in: [src/improvement/improve-types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L218)

Optimizer ancestry sealed into downstream candidate experiments.

#### Properties

##### invocationId

> **invocationId**: `string`

Defined in: [src/improvement/improve-types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L220)

Unique Runtime invocation used to isolate this run's cost receipts.

##### runId

> **runId**: `string`

Defined in: [src/improvement/improve-types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L222)

Upstream optimizer run when reported, otherwise this Runtime optimization invocation.

##### developmentSplitDigest

> **developmentSplitDigest**: `` `sha256:${string}` ``

Defined in: [src/improvement/improve-types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L224)

Exact train-plus-selection scenario payloads exposed to candidate selection.

##### executionRef?

> `optional` **executionRef?**: `` `sha256:${string}` ``

Defined in: [src/improvement/improve-types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L226)

Complete callback, materializer, model, tool, and closure identity for a profile run.

##### baselineProfileDigest?

> `optional` **baselineProfileDigest?**: `` `sha256:${string}` ``

Defined in: [src/improvement/improve-types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L228)

Complete baseline profile identity for a profile run.

***

### ImproveMethodResult

Defined in: [src/improvement/improve-types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L253)

#### Extends

- `ImproveResultBase`\<[`ImprovementProfileCandidate`](#improvementprofilecandidate)\>

#### Properties

##### candidate

> **candidate**: [`ImprovementProfileCandidate`](#improvementprofilecandidate)

Defined in: [src/improvement/improve-types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L233)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Defined in: [src/improvement/improve-types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L241)

Full search and final-test spend.

###### Inherited from

`ImproveResultBase.cost`

##### durationMs

> **durationMs**: `number`

Defined in: [src/improvement/improve-types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L243)

Full wall-clock duration.

###### Inherited from

`ImproveResultBase.durationMs`

##### lineage

> **lineage**: [`ImproveLineage`](#improvelineage)

Defined in: [src/improvement/improve-types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L245)

Optimizer ancestry used when sealing a candidate experiment.

###### Inherited from

`ImproveResultBase.lineage`

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Defined in: [src/improvement/improve-types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L247)

Number of generations explored by Runtime's code path.

###### Inherited from

`ImproveResultBase.generationsExplored`

##### mode

> **mode**: `"method"`

Defined in: [src/improvement/improve-types.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L254)

##### method

> **method**: `string`

Defined in: [src/improvement/improve-types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L255)

##### provenance?

> `optional` **provenance?**: `OptimizationMethodProvenance`

Defined in: [src/improvement/improve-types.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L257)

External optimizer package and resumable run identity, when reported.

##### decision

> **decision**: `"ship"` \| `"hold"`

Defined in: [src/improvement/improve-types.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L258)

Final-test decision for this search result.

###### Overrides

`ImproveResultBase.decision`

##### lift

> **lift**: `number`

Defined in: [src/improvement/improve-types.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L259)

Final-test lift when one was measured.

###### Overrides

`ImproveResultBase.lift`

##### liftInterval

> **liftInterval**: `object`

Defined in: [src/improvement/improve-types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L260)

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Overrides

`ImproveResultBase.liftInterval`

##### raw

> **raw**: `OptimizationMethodComparison`

Defined in: [src/improvement/improve-types.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L261)

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [src/improvement/improve-types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L250)

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### ImproveCodeResult

Defined in: [src/improvement/improve-types.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L264)

#### Extends

- `ImproveResultBase`\<[`ImprovementCodeCandidate`](#improvementcodecandidate)\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### candidate

> **candidate**: [`ImprovementCodeCandidate`](#improvementcodecandidate)

Defined in: [src/improvement/improve-types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L233)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### decision

> **decision**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [src/improvement/improve-types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L235)

Final-test decision for this search result.

###### Inherited from

`ImproveResultBase.decision`

##### lift?

> `optional` **lift?**: `number`

Defined in: [src/improvement/improve-types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L237)

Final-test lift when one was measured.

###### Inherited from

`ImproveResultBase.lift`

##### liftInterval?

> `optional` **liftInterval?**: `object`

Defined in: [src/improvement/improve-types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L239)

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Inherited from

`ImproveResultBase.liftInterval`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Defined in: [src/improvement/improve-types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L241)

Full search and final-test spend.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`cost`](#cost)

##### durationMs

> **durationMs**: `number`

Defined in: [src/improvement/improve-types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L243)

Full wall-clock duration.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`durationMs`](#durationms-2)

##### lineage

> **lineage**: [`ImproveLineage`](#improvelineage)

Defined in: [src/improvement/improve-types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L245)

Optimizer ancestry used when sealing a candidate experiment.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`lineage`](#lineage)

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Defined in: [src/improvement/improve-types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L247)

Number of generations explored by Runtime's code path.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`generationsExplored`](#generationsexplored)

##### mode

> **mode**: `"code"`

Defined in: [src/improvement/improve-types.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L266)

##### raw

> **raw**: `SelfImproveResult`\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/improve-types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L267)

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Defined in: [src/improvement/improve-types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L250)

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### CandidateGenerator

Defined in: [src/improvement/improvement-driver.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L29)

The byte-producing seam — the ONE thing that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

Defined in: [src/improvement/improvement-driver.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L30)

##### proposesWithoutFindings?

> `optional` **proposesWithoutFindings?**: `boolean`

Defined in: [src/improvement/improvement-driver.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L41)

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

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; `label?`: `string`; `rationale?`: `string`; \}\>

Defined in: [src/improvement/improvement-driver.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L42)

###### Parameters

###### args

###### worktreePath

`string`

The candidate worktree — a clean checkout of the current incumbent.

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

###### generation?

`number`

Generation coordinates supplied by Runtime's internal code candidate driver.

###### candidateIndex?

`number`

###### costLedger?

`CostLedgerHandle`

Shared run-wide paid-call account supplied by agent-eval 0.117+.

###### costPhase?

`string`

Receipt attribution phase supplied alongside `costLedger`.

###### Returns

`Promise`\<\{ `applied`: `boolean`; `summary`: `string`; `label?`: `string`; `rationale?`: `string`; \}\>

***

### McpServeSpec

Defined in: [src/improvement/mcp-serve-verifier.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L27)

#### Properties

##### command

> **command**: `string`

Defined in: [src/improvement/mcp-serve-verifier.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L29)

Command that starts the built MCP server in the worktree (stdio transport).

##### args?

> `optional` **args?**: `string`[]

Defined in: [src/improvement/mcp-serve-verifier.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L30)

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [src/improvement/mcp-serve-verifier.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L32)

Extra env for the server process (merged over `process.env`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/improvement/mcp-serve-verifier.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L34)

Handshake timeout (ms). Default 30s.

##### minTools?

> `optional` **minTools?**: `number`

Defined in: [src/improvement/mcp-serve-verifier.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L36)

Minimum tools the server must expose to pass. Default 1.

***

### OfficialOptimizerContextOptions

Defined in: [src/improvement/official-optimizers.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L27)

Runtime context appended to an official optimizer's own configuration.

#### Properties

##### background?

> `optional` **background?**: `string`

Defined in: [src/improvement/official-optimizers.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L29)

Context supplied to the optimizer before Runtime appends the profile surface and findings.

##### includeFindings?

> `optional` **includeFindings?**: `boolean`

Defined in: [src/improvement/official-optimizers.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L31)

Include current trace or analyst findings in the optimizer background. Default true.

##### maxFindingsChars?

> `optional` **maxFindingsChars?**: `number`

Defined in: [src/improvement/official-optimizers.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L33)

Reject oversized serialized findings before starting Python. Default 50,000 characters.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](intelligence.md#redactor)

Defined in: [src/improvement/official-optimizers.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L39)

Redact caller-supplied context and descriptors before they leave Runtime.
The built-in redactor is the default. Pass `false` only for public data
that has already been reviewed.

##### approveSensitiveProfileSurface?

> `optional` **approveSensitiveProfileSurface?**: `boolean`

Defined in: [src/improvement/official-optimizers.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L46)

Confirm that structurally sensitive candidate fields contain only safe
references or public values. Required for fields such as MCP env, headers,
URLs, metadata, and extensions because candidate bytes cannot be redacted
without changing what the optimizer measures.

***

### RawTraceDistillerOptions

Defined in: [src/improvement/raw-trace-distiller.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L44)

#### Properties

##### runDir?

> `optional` **runDir?**: `string`

Defined in: [src/improvement/raw-trace-distiller.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L49)

Anchor the emitted paths at this run root instead of the generation `runDir`
 the loop passes in. Normally unset — each call points at that generation's
 own directory (`input.runDir`). Pass an absolute path when you construct the
 producer ahead of the loop and want a fixed anchor (e.g. a test fixture).

##### maxCandidates?

> `optional` **maxCandidates?**: `number`

Defined in: [src/improvement/raw-trace-distiller.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L51)

Max candidates to surface trace paths for, worst-scoring first. Default 12.

##### maxCellsPerCandidate?

> `optional` **maxCellsPerCandidate?**: `number`

Defined in: [src/improvement/raw-trace-distiller.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L54)

Max failing cells to enumerate per candidate before collapsing the rest into
 an "ls the candidate dir" pointer. Default 8.

##### maxFilesPerCell?

> `optional` **maxFilesPerCell?**: `number`

Defined in: [src/improvement/raw-trace-distiller.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L57)

Max concrete file paths to list per cell (the agent can always `ls` the dir
 for the rest). Default 24.

##### fallbackFindings?

> `optional` **fallbackFindings?**: `unknown`[]

Defined in: [src/improvement/raw-trace-distiller.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L61)

Findings to fall back to when the generation had NO failing cells, so a
 clean round never wipes the proposer's steering context. Mirrors the default
 distiller's static-seed fallback. Default: a single instruction finding.

***

### ReflectiveGeneratorOptions

Defined in: [src/improvement/reflective-generator.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L20)

#### Properties

##### improvementProposalSource

> **improvementProposalSource**: [`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

Defined in: [src/improvement/reflective-generator.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L21)

***

### CreateKnowledgeImprovementActivationExecutorOptions

Defined in: [src/knowledge/activation.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L25)

#### Extends

- `Omit`\<`PromoteKnowledgeCandidateOptions`, `"root"` \| `"candidate"`\>

#### Properties

##### root

> **root**: `string`

Defined in: [src/knowledge/activation.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L27)

##### identity

> **identity**: `string`

Defined in: [src/knowledge/activation.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L28)

##### results

> **results**: [`AgentImprovementActivationResultStore`](intelligence.md#agentimprovementactivationresultstore)

Defined in: [src/knowledge/activation.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L29)

***

### KnowledgeImprovementActivationExecutor

Defined in: [src/knowledge/activation.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L32)

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](intelligence.md#agentimprovementactivationtransition)

Defined in: [src/knowledge/activation.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L33)

##### reconcile

> **reconcile**: [`AgentImprovementActivationReconciliation`](intelligence.md#agentimprovementactivationreconciliation)

Defined in: [src/knowledge/activation.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L34)

***

### RunKnowledgeImprovementJobOptions

Defined in: [src/knowledge/improvement-job.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L40)

#### Extends

- `Omit`\<`KnowledgeImprovementOptions`, `"updateKnowledge"`\>

#### Properties

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [src/knowledge/improvement-job.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L42)

##### readinessCheck?

> `optional` **readinessCheck?**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [src/knowledge/improvement-job.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L43)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [src/knowledge/improvement-job.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L44)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Defined in: [src/knowledge/improvement-job.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L45)

##### harness?

> `optional` **harness?**: `string`

Defined in: [src/knowledge/improvement-job.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L46)

##### supervisorModel?

> `optional` **supervisorModel?**: `string`

Defined in: [src/knowledge/improvement-job.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L47)

##### supervisorSystemPrompt?

> `optional` **supervisorSystemPrompt?**: `string`

Defined in: [src/knowledge/improvement-job.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L48)

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"backend"` \| `"budget"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

Defined in: [src/knowledge/improvement-job.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L49)

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [src/knowledge/improvement-job.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L55)

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

Defined in: [src/knowledge/improvement-job.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L56)

###### Parameters

###### profile

[`SupervisorProfile`](runtime.md#supervisorprofile)

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

##### candidateArtifacts?

> `optional` **candidateArtifacts?**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

Defined in: [src/knowledge/improvement-job.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L61)

##### onMeasurement?

> `optional` **onMeasurement?**: (`measurement`) => `void` \| `Promise`\<`void`\>

Defined in: [src/knowledge/improvement-job.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L62)

###### Parameters

###### measurement

[`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

###### Returns

`void` \| `Promise`\<`void`\>

***

### KnowledgeImprovementJobMeasurement

Defined in: [src/knowledge/improvement-job.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L65)

#### Properties

##### startedAt

> **startedAt**: `string`

Defined in: [src/knowledge/improvement-job.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L66)

##### finishedAt

> **finishedAt**: `string`

Defined in: [src/knowledge/improvement-job.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L67)

##### durationMs

> **durationMs**: `number`

Defined in: [src/knowledge/improvement-job.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L68)

##### updateCalls

> **updateCalls**: `number`

Defined in: [src/knowledge/improvement-job.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L69)

##### updateDurationMs

> **updateDurationMs**: `number`

Defined in: [src/knowledge/improvement-job.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L70)

##### supervisedSpent

> **supervisedSpent**: `object`

Defined in: [src/knowledge/improvement-job.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L71)

###### iterations

> **iterations**: `number`

###### inputTokens

> **inputTokens**: `number`

###### outputTokens

> **outputTokens**: `number`

###### usdKnown

> **usdKnown**: `boolean`

###### usd

> **usd**: `number`

###### ms

> **ms**: `number`

***

### KnowledgeImprovementJobResult

Defined in: [src/knowledge/improvement-job.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L81)

#### Properties

##### improvement

> **improvement**: `KnowledgeImprovementResult`

Defined in: [src/knowledge/improvement-job.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L82)

##### knowledge?

> `optional` **knowledge?**: [`KnowledgeImprovementCandidatePair`](#knowledgeimprovementcandidatepair)

Defined in: [src/knowledge/improvement-job.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L83)

##### measurement

> **measurement**: [`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

Defined in: [src/knowledge/improvement-job.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L84)

##### blocked

> **blocked**: `boolean`

Defined in: [src/knowledge/improvement-job.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L85)

***

### KnowledgeImprovementCandidatePair

Defined in: [src/knowledge/improvement-job.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L88)

#### Properties

##### reference

> **reference**: `AgentCandidateKnowledgeRef`

Defined in: [src/knowledge/improvement-job.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L89)

##### evaluation

> **evaluation**: `AgentCandidateCapturedArtifact`

Defined in: [src/knowledge/improvement-job.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L90)

##### baseline

> **baseline**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/knowledge/improvement-job.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L91)

##### candidate

> **candidate**: `AgentCandidateWorkspaceSnapshotEvidence`

Defined in: [src/knowledge/improvement-job.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L92)

***

### KnowledgeImprovementExperimentBundles

Defined in: [src/knowledge/improvement-job.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L95)

#### Properties

##### baseline

> **baseline**: `AgentCandidateBundle`

Defined in: [src/knowledge/improvement-job.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L96)

##### candidate

> **candidate**: `AgentCandidateBundle`

Defined in: [src/knowledge/improvement-job.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L97)

***

### AgentKnowledgeReadinessCheckOptions

Defined in: [src/knowledge/improvement-job.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L100)

#### Properties

##### goal

> **goal**: `string`

Defined in: [src/knowledge/improvement-job.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L101)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `KnowledgeReadinessSpec`[]

Defined in: [src/knowledge/improvement-job.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L102)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [src/knowledge/improvement-job.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L103)

##### readiness?

> `optional` **readiness?**: `Omit`\<`BuildEvalKnowledgeBundleOptions`, `"taskId"` \| `"index"` \| `"specs"`\>

Defined in: [src/knowledge/improvement-job.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L104)

##### strict?

> `optional` **strict?**: `boolean`

Defined in: [src/knowledge/improvement-job.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L105)

##### kbQuality?

> `optional` **kbQuality?**: `KnowledgeBaseQualityOptions`

Defined in: [src/knowledge/improvement-job.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L106)

***

### KnowledgeReadinessCheckInput

Defined in: [src/knowledge/supervised-update.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L23)

#### Properties

##### root

> **root**: `string`

Defined in: [src/knowledge/supervised-update.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L24)

##### goal

> **goal**: `string`

Defined in: [src/knowledge/supervised-update.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L25)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

Defined in: [src/knowledge/supervised-update.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L26)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [src/knowledge/supervised-update.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L27)

##### readiness?

> `optional` **readiness?**: `unknown`

Defined in: [src/knowledge/supervised-update.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L28)

***

### SupervisedKnowledgeUpdateInput

Defined in: [src/knowledge/supervised-update.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L43)

#### Properties

##### goal?

> `optional` **goal?**: `string`

Defined in: [src/knowledge/supervised-update.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L44)

##### root?

> `optional` **root?**: `string`

Defined in: [src/knowledge/supervised-update.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L45)

##### candidateRoot?

> `optional` **candidateRoot?**: `string`

Defined in: [src/knowledge/supervised-update.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L46)

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Defined in: [src/knowledge/supervised-update.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L47)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/knowledge/supervised-update.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L48)

***

### SupervisedKnowledgeUpdateResult

Defined in: [src/knowledge/supervised-update.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L51)

#### Properties

##### applied

> **applied**: `boolean`

Defined in: [src/knowledge/supervised-update.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L52)

##### summary

> **summary**: `string`

Defined in: [src/knowledge/supervised-update.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L53)

##### supervised

> **supervised**: [`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>

Defined in: [src/knowledge/supervised-update.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L54)

##### metadata

> **metadata**: `NonNullable`\<`RagKnowledgeUpdateResult`\[`"metadata"`\]\>

Defined in: [src/knowledge/supervised-update.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L55)

***

### SupervisedKnowledgeUpdateOptions

Defined in: [src/knowledge/supervised-update.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L58)

#### Properties

##### root

> **root**: `string`

Defined in: [src/knowledge/supervised-update.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L59)

##### goal

> **goal**: `string`

Defined in: [src/knowledge/supervised-update.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L60)

##### readiness

> **readiness**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [src/knowledge/supervised-update.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L61)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

Defined in: [src/knowledge/supervised-update.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L62)

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

Defined in: [src/knowledge/supervised-update.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L63)

##### readinessOptions?

> `optional` **readinessOptions?**: `unknown`

Defined in: [src/knowledge/supervised-update.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L64)

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Defined in: [src/knowledge/supervised-update.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L65)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/knowledge/supervised-update.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L66)

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [src/knowledge/supervised-update.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L67)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [src/knowledge/supervised-update.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L68)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Defined in: [src/knowledge/supervised-update.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L69)

##### harness?

> `optional` **harness?**: `string`

Defined in: [src/knowledge/supervised-update.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L70)

##### supervisorModel?

> `optional` **supervisorModel?**: `string`

Defined in: [src/knowledge/supervised-update.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L71)

##### supervisorSystemPrompt?

> `optional` **supervisorSystemPrompt?**: `string`

Defined in: [src/knowledge/supervised-update.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L72)

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"backend"` \| `"budget"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

Defined in: [src/knowledge/supervised-update.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L73)

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [src/knowledge/supervised-update.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L79)

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

Defined in: [src/knowledge/supervised-update.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L80)

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

Defined in: [src/loop-runner.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L61)

**`Experimental`**

Uniform result — never throws from a registered runner; a
 thrown engine becomes `{ ok: false, error }` so a routine can record + move on.

#### Type Parameters

##### T

`T` = `unknown`

#### Properties

##### mode

> **mode**: `"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

Defined in: [src/loop-runner.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L62)

**`Experimental`**

##### ok

> **ok**: `boolean`

Defined in: [src/loop-runner.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L63)

**`Experimental`**

##### output?

> `optional` **output?**: `T`

Defined in: [src/loop-runner.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L64)

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: [src/loop-runner.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L65)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [src/loop-runner.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L66)

**`Experimental`**

***

### RunDelegatedLoopOptions

Defined in: [src/loop-runner.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L70)

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/loop-runner.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L71)

**`Experimental`**

##### now?

> `optional` **now?**: () => `number`

Defined in: [src/loop-runner.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L73)

**`Experimental`**

Clock override for deterministic tests.

###### Returns

`number`

***

### WorktreeLoopRunnerOptions

Defined in: [src/loop-runner.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L115)

**`Experimental`**

Options for the local-repo `code` runner over the GENERIC recursive path.

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [src/loop-runner.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L117)

**`Experimental`**

Absolute path to the local git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [src/loop-runner.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L119)

**`Experimental`**

The instruction handed to every authored harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](runtime.md#authoredharness)[]

Defined in: [src/loop-runner.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L121)

**`Experimental`**

The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each.

##### budget

> **budget**: [`Budget`](runtime.md#budget-12)

Defined in: [src/loop-runner.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L123)

**`Experimental`**

Conserved budget pool bounding the fanout (equal-k holds by construction).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [src/loop-runner.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L125)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [src/loop-runner.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L127)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [src/loop-runner.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L129)

**`Experimental`**

Which verification signals the deliverable REQUIRES present-and-passing (default none).

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [src/loop-runner.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L131)

**`Experimental`**

Diff-size cap (lines).

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [src/loop-runner.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L133)

**`Experimental`**

Literal path prefixes the patch must not touch (the secret-floor is always on regardless).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](runtime.md#winnerstrategy)

Defined in: [src/loop-runner.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L135)

**`Experimental`**

Winner-selection strategy among gated candidates. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [src/loop-runner.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L137)

**`Experimental`**

Test seams forwarded to the worktree-CLI leaves so the runner drives offline.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [src/loop-runner.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L138)

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
  - the caller signal was already aborted before process launch

Does NOT throw when:
  - the subprocess exits non-zero (`result.exitCode` carries the code)
  - a non-reproducible subprocess is aborted / timed out (`result.aborted` /
    `result.timedOut` carries the reason even when a TERM-aware child exits zero)

Reproducible Codex additionally requires a terminal usage event. If cancellation
prevents that event, this rejects with `CodexExecutionDiagnosticError` instead of
returning an incomplete reproducibility receipt.

###### Parameters

###### options

[`RunLocalHarnessOptions`](mcp.md#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

##### runCommand?

> `optional` **runCommand?**: `WorktreeCheckRunner`

Defined in: [src/loop-runner.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L139)

**`Experimental`**

***

### VetoedFact

Defined in: [src/loop-runner.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L202)

**`Experimental`**

A fact rejected at the KB gate — surfaced, never dropped.

#### Properties

##### candidate

> **candidate**: [`FactCandidate`](mcp.md#factcandidate)

Defined in: [src/loop-runner.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L203)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

Defined in: [src/loop-runner.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L204)

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

Defined in: [src/loop-runner.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L205)

**`Experimental`**

***

### ResearchLoopResult

Defined in: [src/loop-runner.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L209)

**`Experimental`**

#### Properties

##### accepted

> **accepted**: [`FactCandidate`](mcp.md#factcandidate)[]

Defined in: [src/loop-runner.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L211)

**`Experimental`**

Facts that passed the fail-closed gate — safe to write to the KB.

##### vetoed

> **vetoed**: [`VetoedFact`](#vetoedfact)[]

Defined in: [src/loop-runner.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L213)

**`Experimental`**

Facts the gate vetoed in the final round — escalate, do not silently drop.

##### rounds

> **rounds**: `number`

Defined in: [src/loop-runner.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L215)

**`Experimental`**

Research rounds actually run.

***

### ResearchLoopRunnerOptions

Defined in: [src/loop-runner.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L219)

**`Experimental`**

Options for the default `research` runner.

#### Properties

##### research

> **research**: (`round`, `vetoed`) => `Promise`\<[`FactCandidate`](mcp.md#factcandidate)[]\>

Defined in: [src/loop-runner.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L226)

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

Defined in: [src/loop-runner.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L228)

**`Experimental`**

Gate config (extra judges, self-artifact kinds, …). The floor is always on.

##### maxRounds?

> `optional` **maxRounds?**: `number`

Defined in: [src/loop-runner.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L230)

**`Experimental`**

Max research rounds (correct-on-veto remediation). Default 1.

***

### ModelInfo

Defined in: [src/model-resolution.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L22)

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

#### Properties

##### id

> **id**: `string`

Defined in: [src/model-resolution.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L23)

##### name?

> `optional` **name?**: `string`

Defined in: [src/model-resolution.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L24)

##### description?

> `optional` **description?**: `string`

Defined in: [src/model-resolution.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L25)

##### provider?

> `optional` **provider?**: `string`

Defined in: [src/model-resolution.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L27)

Provider slug, when the router exposes it (`provider` or `_provider`).

##### \_provider?

> `optional` **\_provider?**: `string`

Defined in: [src/model-resolution.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L28)

##### architecture?

> `optional` **architecture?**: `object`

Defined in: [src/model-resolution.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L29)

###### modality?

> `optional` **modality?**: `string`

###### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

###### output\_modalities?

> `optional` **output\_modalities?**: `string`[]

***

### RouterEnv

Defined in: [src/model-resolution.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L37)

Env keys the router base URL is resolved from.

#### Properties

##### TANGLE\_ROUTER\_URL?

> `optional` **TANGLE\_ROUTER\_URL?**: `string`

Defined in: [src/model-resolution.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L38)

##### TANGLE\_ROUTER\_BASE\_URL?

> `optional` **TANGLE\_ROUTER\_BASE\_URL?**: `string`

Defined in: [src/model-resolution.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L39)

***

### ResolvedChatModel

Defined in: [src/model-resolution.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L80)

#### Properties

##### source

> **source**: `string`

Defined in: [src/model-resolution.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L81)

##### model

> **model**: `string`

Defined in: [src/model-resolution.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L82)

***

### OtelExportConfig

Defined in: [src/otel-export.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L15)

#### Properties

##### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [src/otel-export.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L17)

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [src/otel-export.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L19)

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

##### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [src/otel-export.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L21)

Batch size before flush. Default 64.

##### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Defined in: [src/otel-export.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L23)

Flush interval ms. Default 5000.

##### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [src/otel-export.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L25)

Resource attributes stamped on every export.

##### serviceName?

> `optional` **serviceName?**: `string`

Defined in: [src/otel-export.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L27)

Service name. Default 'agent-runtime'.

***

### OtelExporter

Defined in: [src/otel-export.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L30)

#### Methods

##### exportSpan()

> **exportSpan**(`span`): `void`

Defined in: [src/otel-export.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L32)

Export a span.

###### Parameters

###### span

[`OtelSpan`](#otelspan)

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [src/otel-export.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L34)

Force flush pending spans.

###### Returns

`Promise`\<`void`\>

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Defined in: [src/otel-export.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L36)

Shutdown cleanly.

###### Returns

`Promise`\<`void`\>

***

### OtelSpan

Defined in: [src/otel-export.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L39)

#### Properties

##### traceId

> **traceId**: `string`

Defined in: [src/otel-export.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L40)

##### spanId

> **spanId**: `string`

Defined in: [src/otel-export.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L41)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [src/otel-export.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L42)

##### name

> **name**: `string`

Defined in: [src/otel-export.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L43)

##### kind?

> `optional` **kind?**: `number`

Defined in: [src/otel-export.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L44)

##### startTimeUnixNano

> **startTimeUnixNano**: `string`

Defined in: [src/otel-export.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L45)

##### endTimeUnixNano

> **endTimeUnixNano**: `string`

Defined in: [src/otel-export.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L46)

##### attributes?

> `optional` **attributes?**: [`OtelAttribute`](#otelattribute)[]

Defined in: [src/otel-export.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L47)

##### status?

> `optional` **status?**: `object`

Defined in: [src/otel-export.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L48)

###### code

> **code**: `number`

###### message?

> `optional` **message?**: `string`

***

### OtelAttribute

Defined in: [src/otel-export.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L51)

#### Properties

##### key

> **key**: `string`

Defined in: [src/otel-export.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L52)

##### value

> **value**: `object`

Defined in: [src/otel-export.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L53)

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

Defined in: [src/otel-export.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L230)

#### Stable

#### Extends

- [`RuntimeTelemetryOptions`](#runtimetelemetryoptions)

#### Properties

##### redact?

> `optional` **redact?**: (`value`) => `unknown`

Defined in: [src/otel-export.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L232)

Final customer redactor applied after the schema-aware runtime sanitizer.

###### Parameters

###### value

`unknown`

###### Returns

`unknown`

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [src/sanitize.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L35)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeInputs`](#includeinputs-1)

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [src/sanitize.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L37)

Include requirement descriptions. Secret requirements are always redacted.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeRequirementDescriptions`](#includerequirementdescriptions-1)

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [src/sanitize.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L39)

Include evidence IDs. Off by default; counts are safer for shared reports.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvidenceIds`](#includeevidenceids-1)

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [src/sanitize.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L41)

Include user answers from question preflight. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeUserAnswers`](#includeuseranswers-1)

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [src/sanitize.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L43)

Include action payloads and action results for control steps. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeControlPayloads`](#includecontrolpayloads-1)

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [src/sanitize.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L45)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeMetadata`](#includemetadata-1)

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [src/sanitize.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L47)

Include eval detail/evidence strings. Off by default because validators may echo private input.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvalDetails`](#includeevaldetails-1)

***

### LoopSpanNode

Defined in: [src/otel-export.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L334)

Sink-neutral node in a reconstructed loop span tree. The root node's
`parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
mapper attaches the inherited delegation span; the delegation journal
leaves it as the tree root).

#### Properties

##### spanId

> **spanId**: `string`

Defined in: [src/otel-export.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L335)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [src/otel-export.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L336)

##### name

> **name**: `string`

Defined in: [src/otel-export.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L338)

`'loop'` | `'loop.round'` | `'loop.iteration'`.

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [src/otel-export.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L340)

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

Defined in: [src/otel-export.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L341)

##### endMs

> **endMs**: `number`

Defined in: [src/otel-export.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L342)

##### attrs

> **attrs**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [src/otel-export.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L343)

##### error

> **error**: `boolean`

Defined in: [src/otel-export.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L345)

True when the iteration carried an error — maps to OTEL status code 2.

***

### EvalRunGeneration

Defined in: [src/otel-export.ts:667](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L667)

#### Properties

##### index

> **index**: `number`

Defined in: [src/otel-export.ts:669](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L669)

0-based ordinal of this generation within the run (required by ingest).

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [src/otel-export.ts:671](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L671)

Identity of the proposed surface change (content-addressed hash).

##### surface?

> `optional` **surface?**: `unknown`

Defined in: [src/otel-export.ts:673](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L673)

Arbitrary provenance for this generation (rationale, evidence, source).

##### cells?

> `optional` **cells?**: `unknown`[]

Defined in: [src/otel-export.ts:675](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L675)

Per-scenario results; empty until the generation is measured.

##### compositeMean

> **compositeMean**: `number`

Defined in: [src/otel-export.ts:677](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L677)

Mean composite score (0 when unmeasured — pair with labels.measured).

##### costUsd

> **costUsd**: `number`

Defined in: [src/otel-export.ts:678](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L678)

##### durationMs

> **durationMs**: `number`

Defined in: [src/otel-export.ts:679](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L679)

***

### EvalRunEvent

Defined in: [src/otel-export.ts:682](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L682)

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/otel-export.ts:683](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L683)

##### runDir

> **runDir**: `string`

Defined in: [src/otel-export.ts:684](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L684)

##### timestamp

> **timestamp**: `string`

Defined in: [src/otel-export.ts:686](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L686)

ISO timestamp.

##### status

> **status**: `"started"` \| `"baseline-complete"` \| `"generation-complete"` \| `"gate-decided"` \| `"finished"` \| `"errored"`

Defined in: [src/otel-export.ts:687](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L687)

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string`\>

Defined in: [src/otel-export.ts:694](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L694)

##### baseline?

> `optional` **baseline?**: [`EvalRunGeneration`](#evalrungeneration)

Defined in: [src/otel-export.ts:695](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L695)

##### generations?

> `optional` **generations?**: [`EvalRunGeneration`](#evalrungeneration)[]

Defined in: [src/otel-export.ts:696](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L696)

##### gateDecision?

> `optional` **gateDecision?**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [src/otel-export.ts:697](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L697)

##### holdoutLift?

> `optional` **holdoutLift?**: `number`

Defined in: [src/otel-export.ts:698](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L698)

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [src/otel-export.ts:699](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L699)

##### totalDurationMs

> **totalDurationMs**: `number`

Defined in: [src/otel-export.ts:700](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L700)

##### errorMessage?

> `optional` **errorMessage?**: `string`

Defined in: [src/otel-export.ts:701](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L701)

***

### EvalRunsExportConfig

Defined in: [src/otel-export.ts:704](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L704)

#### Properties

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [src/otel-export.ts:706](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L706)

Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY.

##### base?

> `optional` **base?**: `string`

Defined in: [src/otel-export.ts:708](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L708)

Intelligence base. Reads TANGLE_INTELLIGENCE_URL env, else prod.

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [src/otel-export.ts:710](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L710)

Idempotency-Key header (e.g. the runId) — safe retries + upsert.

***

### EvalRunsExportResult

Defined in: [src/otel-export.ts:713](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L713)

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [src/otel-export.ts:714](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L714)

##### status

> **status**: `number`

Defined in: [src/otel-export.ts:715](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L715)

##### accepted

> **accepted**: `number`

Defined in: [src/otel-export.ts:716](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L716)

##### rejected

> **rejected**: `object`[]

Defined in: [src/otel-export.ts:717](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L717)

###### index

> **index**: `number`

###### reason

> **reason**: `string`

***

### ResolveAgentBackendOptions

Defined in: [src/resolve-agent-backend.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L51)

#### Extends

- `OpenAICompatPassthrough`

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### tools?

> `optional` **tools?**: readonly [`OpenAIChatTool`](#openaichattool)[]

Defined in: [src/backends.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L222)

OpenAI Chat Completions `tools[]` definitions surfaced to the model on
every request. Omit to send a tool-free request (existing behavior).
The runtime makes no assumption about the dispatcher — calls stream out
as `tool_call` events and the caller is responsible for executing them
and feeding `tool_result` messages back on a follow-up turn.

###### Inherited from

`OpenAICompatPassthrough.tools`

##### toolChoice?

> `optional` **toolChoice?**: [`OpenAIChatToolChoice`](#openaichattoolchoice)

Defined in: [src/backends.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L228)

OpenAI Chat Completions `tool_choice`. Default `undefined` (request
omits the field; provider falls back to its own default — typically
`'auto'`).

###### Inherited from

`OpenAICompatPassthrough.toolChoice`

##### responseFormat?

> `optional` **responseFormat?**: [`OpenAIChatResponseFormat`](#openaichatresponseformat)

Defined in: [src/backends.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L232)

OpenAI Chat Completions `response_format`. Omit for provider default text.

###### Inherited from

`OpenAICompatPassthrough.responseFormat`

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/backends.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L234)

OpenAI Chat Completions `temperature`. Omit for provider default.

###### Inherited from

`OpenAICompatPassthrough.temperature`

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [src/backends.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L236)

Maximum completion tokens, sent as OpenAI-compatible `max_tokens`. Omit for provider default.

###### Inherited from

`OpenAICompatPassthrough.maxTokens`

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: [src/backends.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L237)

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

Defined in: [src/backends.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L238)

###### Inherited from

`OpenAICompatPassthrough.retry`

##### kind

> **kind**: [`AgentBackendKind`](#agentbackendkind)

Defined in: [src/resolve-agent-backend.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L54)

The chat transport to resolve.

##### apiKey

> **apiKey**: `string`

Defined in: [src/resolve-agent-backend.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L60)

Bearer credential for the OpenAI-compat kinds. Empty string is valid for a
loopback-anonymous cli-bridge; a `router`/`tcloud` route with an empty key
is a caller bug the product surfaces before calling in.

##### baseUrl

> **baseUrl**: `string`

Defined in: [src/resolve-agent-backend.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L62)

Base URL for the OpenAI-compat kinds. cli-bridge's is its `/v1`.

##### model

> **model**: `string`

Defined in: [src/resolve-agent-backend.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L64)

Model id sent on every request. cli-bridge rejects a request without it.

##### label?

> `optional` **label?**: `string`

Defined in: [src/resolve-agent-backend.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L66)

`kind` label stamped on the resolved backend + its traces. Defaults to `kind`.

##### sandboxBackend?

> `optional` **sandboxBackend?**: () => [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [src/resolve-agent-backend.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L72)

`sandbox` kind: the product's own domain backend. Required for that kind —
the substrate owns no product sandbox shape, so a `sandbox` resolution with
no seam is a caller bug, not a silent fallback.

###### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### RuntimeHookEvent

Defined in: [src/runtime-hooks.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L36)

#### Type Parameters

##### Payload

`Payload` = `unknown`

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime-hooks.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L37)

##### runId

> **runId**: `string`

Defined in: [src/runtime-hooks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L38)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/runtime-hooks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L39)

##### target

> **target**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [src/runtime-hooks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L40)

##### phase

> **phase**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [src/runtime-hooks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L41)

##### timestamp

> **timestamp**: `number`

Defined in: [src/runtime-hooks.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L42)

##### stepIndex?

> `optional` **stepIndex?**: `number`

Defined in: [src/runtime-hooks.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L43)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [src/runtime-hooks.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L44)

##### payload?

> `optional` **payload?**: `Payload`

Defined in: [src/runtime-hooks.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L45)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime-hooks.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L46)

***

### RuntimeHookContext

Defined in: [src/runtime-hooks.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L49)

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime-hooks.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L50)

***

### RuntimeDecisionEvidenceRef

Defined in: [src/runtime-hooks.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L53)

#### Properties

##### source

> **source**: `string`

Defined in: [src/runtime-hooks.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L54)

##### id

> **id**: `string`

Defined in: [src/runtime-hooks.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L55)

##### detail?

> `optional` **detail?**: `string`

Defined in: [src/runtime-hooks.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L56)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime-hooks.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L57)

***

### RuntimeDecisionPoint

Defined in: [src/runtime-hooks.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L60)

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime-hooks.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L61)

##### runId

> **runId**: `string`

Defined in: [src/runtime-hooks.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L62)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/runtime-hooks.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L63)

##### stepIndex

> **stepIndex**: `number`

Defined in: [src/runtime-hooks.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L64)

##### kind

> **kind**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [src/runtime-hooks.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L65)

##### candidateActions

> **candidateActions**: `string`[]

Defined in: [src/runtime-hooks.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L66)

##### context?

> `optional` **context?**: `string`

Defined in: [src/runtime-hooks.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L67)

##### evidence

> **evidence**: [`RuntimeDecisionEvidenceRef`](#runtimedecisionevidenceref)[]

Defined in: [src/runtime-hooks.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L68)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime-hooks.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L69)

***

### RuntimeHookErrorContext

Defined in: [src/runtime-hooks.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L72)

#### Properties

##### hook

> **hook**: `"onEvent"` \| `"onDecisionPoint"`

Defined in: [src/runtime-hooks.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L73)

##### eventId?

> `optional` **eventId?**: `string`

Defined in: [src/runtime-hooks.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L74)

##### target?

> `optional` **target?**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [src/runtime-hooks.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L75)

##### phase?

> `optional` **phase?**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [src/runtime-hooks.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L76)

##### decisionId?

> `optional` **decisionId?**: `string`

Defined in: [src/runtime-hooks.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L77)

##### decisionKind?

> `optional` **decisionKind?**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [src/runtime-hooks.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L78)

***

### RuntimeHooks

Defined in: [src/runtime-hooks.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L88)

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](#defineruntimehooks) for inference, and attach N
observers at once with [composeRuntimeHooks](#composeruntimehooks) — there is ONE event stream, not a
callback-prop zoo.

#### Properties

##### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime-hooks.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L94)

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

Defined in: [src/runtime-hooks.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L99)

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

Defined in: [src/runtime-hooks.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L103)

###### Parameters

###### error

`Error`

###### context

[`RuntimeHookErrorContext`](#runtimehookerrorcontext)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunRow

Defined in: [src/runtime-run.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L61)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L63)

Stable runtime-side identifier. Adapters may translate to their own primary key.

##### workspaceId

> **workspaceId**: `string`

Defined in: [src/runtime-run.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L64)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [src/runtime-run.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L65)

##### agentId?

> `optional` **agentId?**: `string`

Defined in: [src/runtime-run.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L66)

##### domain?

> `optional` **domain?**: `string`

Defined in: [src/runtime-run.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L67)

##### taskId

> **taskId**: `string`

Defined in: [src/runtime-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L68)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/runtime-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L69)

##### status

> **status**: `RuntimeRunStatus`

Defined in: [src/runtime-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L70)

##### resultSummary?

> `optional` **resultSummary?**: `string`

Defined in: [src/runtime-run.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L71)

##### error?

> `optional` **error?**: `string`

Defined in: [src/runtime-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L72)

##### cost

> **cost**: `RuntimeRunCost`

Defined in: [src/runtime-run.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L73)

##### startedAt

> **startedAt**: `string`

Defined in: [src/runtime-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L74)

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [src/runtime-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L75)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime-run.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L76)

***

### RuntimeRunPersistenceAdapter

Defined in: [src/runtime-run.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L80)

#### Stable

#### Methods

##### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

Defined in: [src/runtime-run.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L88)

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

Defined in: [src/runtime-run.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L107)

#### Stable

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [src/runtime-run.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L109)

Stable id assigned at start.

##### workspaceId

> `readonly` **workspaceId**: `string`

Defined in: [src/runtime-run.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L110)

##### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

Defined in: [src/runtime-run.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L111)

##### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [src/runtime-run.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L112)

##### status

> `readonly` **status**: `RuntimeRunStatus`

Defined in: [src/runtime-run.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L113)

#### Methods

##### observe()

> **observe**(`event`): `void`

Defined in: [src/runtime-run.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L120)

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

Defined in: [src/runtime-run.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L123)

Snapshot of the current cost ledger. Safe to call at any time.

###### Returns

`RuntimeRunCost`

##### complete()

> **complete**(`input`): `void`

Defined in: [src/runtime-run.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L130)

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

Defined in: [src/runtime-run.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L133)

Build the current row without writing it. Useful for tests + dry runs.

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

[`RuntimeRunRow`](#runtimerunrow)

##### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Defined in: [src/runtime-run.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L140)

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

Defined in: [src/sanitize.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L30)

#### Stable

#### Extended by

- [`RuntimeEventOtelOptions`](#runtimeeventoteloptions)

#### Properties

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [src/sanitize.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L35)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [src/sanitize.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L37)

Include requirement descriptions. Secret requirements are always redacted.

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [src/sanitize.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L39)

Include evidence IDs. Off by default; counts are safer for shared reports.

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [src/sanitize.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L41)

Include user answers from question preflight. Off by default.

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [src/sanitize.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L43)

Include action payloads and action results for control steps. Off by default.

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [src/sanitize.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L45)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [src/sanitize.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L47)

Include eval detail/evidence strings. Off by default because validators may echo private input.

***

### SanitizedKnowledgeReadinessReport

Defined in: [src/sanitize.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L68)

#### Stable

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [src/sanitize.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L69)

##### readinessScore

> **readinessScore**: `number`

Defined in: [src/sanitize.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L70)

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

Defined in: [src/sanitize.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L71)

##### severity

> **severity**: `ControlSeverity`

Defined in: [src/sanitize.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L72)

##### reason

> **reason**: `string`

Defined in: [src/sanitize.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L73)

##### blockingMissingRequirements

> **blockingMissingRequirements**: `SanitizedKnowledgeRequirement`[]

Defined in: [src/sanitize.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L74)

##### nonBlockingGaps

> **nonBlockingGaps**: `SanitizedKnowledgeRequirement`[]

Defined in: [src/sanitize.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L75)

##### evidenceCount

> **evidenceCount**: `number`

Defined in: [src/sanitize.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L76)

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

Defined in: [src/sanitize.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L77)

##### missingRequirementIds

> **missingRequirementIds**: `string`[]

Defined in: [src/sanitize.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L78)

***

### RuntimeEventCollector

Defined in: [src/sanitize.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L493)

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

Defined in: [src/sanitize.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L499)

###### Parameters

###### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`void`

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [src/sanitize.ts:500](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L500)

***

### RuntimeStreamEventCollector

Defined in: [src/sanitize.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L523)

#### Stable

#### Properties

##### onEvent

> **onEvent**: `RuntimeStreamEventSink`

Defined in: [src/sanitize.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L524)

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [src/sanitize.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L525)

#### Methods

##### summary()

> **summary**(): `RuntimeStreamEventSummary`

Defined in: [src/sanitize.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L527)

Snapshot of a small streaming-flavored summary derived from collected events.

###### Returns

`RuntimeStreamEventSummary`

***

### ToolLoopCall

Defined in: [src/tool-loop.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L22)

#### Properties

##### toolCallId?

> `optional` **toolCallId?**: `string`

Defined in: [src/tool-loop.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L23)

##### toolName

> **toolName**: `string`

Defined in: [src/tool-loop.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L24)

##### args

> **args**: `Record`\<`string`, `unknown`\>

Defined in: [src/tool-loop.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L25)

***

### ToolLoopAssistantToolCall

Defined in: [src/tool-loop.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L45)

One OpenAI-shaped tool-call entry carried on an assistant message.

#### Properties

##### id

> **id**: `string`

Defined in: [src/tool-loop.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L46)

##### type

> **type**: `"function"`

Defined in: [src/tool-loop.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L47)

##### function

> **function**: `object`

Defined in: [src/tool-loop.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L48)

###### name

> **name**: `string`

###### arguments

> **arguments**: `string`

***

### ToolLoopResult

Defined in: [src/tool-loop.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L120)

#### Properties

##### finalText

> **finalText**: `string`

Defined in: [src/tool-loop.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L121)

##### toolResults

> **toolResults**: `object`[]

Defined in: [src/tool-loop.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L122)

###### call

> **call**: [`ToolLoopCall`](#toolloopcall)

###### label

> **label**: `string`

###### outcome

> **outcome**: [`ToolCallOutcome`](#toolcalloutcome)

##### turns

> **turns**: `number`

Defined in: [src/tool-loop.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L123)

##### stopReason

> **stopReason**: [`ToolLoopStopReason`](#toolloopstopreason)

Defined in: [src/tool-loop.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L124)

##### ~~cappedOut~~

> **cappedOut**: `boolean`

Defined in: [src/tool-loop.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L126)

###### Deprecated

Use `stopReason !== 'completed'` instead.

***

### RunToolLoopOptions

Defined in: [src/tool-loop.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L129)

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [src/tool-loop.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L130)

##### userMessage

> **userMessage**: `string`

Defined in: [src/tool-loop.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L131)

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

Defined in: [src/tool-loop.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L132)

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

Defined in: [src/tool-loop.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L133)

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<[`ToolLoopEvent`](#toolloopevent)\>

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

Defined in: [src/tool-loop.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L134)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [src/tool-loop.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L135)

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [src/tool-loop.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L138)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.
 For per-workflow limits, use `maxCostUsd` or `deadlineMs` instead.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [src/tool-loop.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L141)

Wall-clock deadline in ms since epoch (Date.now()-based). When exceeded the
 loop stops with stopReason `deadline`.

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [src/tool-loop.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L143)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [src/tool-loop.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L145)

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

Defined in: [src/tool-loop.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L146)

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

Defined in: [src/tool-loop.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L147)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/tool-loop.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L148)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/tool-loop.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L149)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](#runtimehooks)

Defined in: [src/tool-loop.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L150)

***

### StreamToolLoopOptions

Defined in: [src/tool-loop.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L309)

#### Type Parameters

##### Raw

`Raw`

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [src/tool-loop.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L310)

##### userMessage

> **userMessage**: `string`

Defined in: [src/tool-loop.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L311)

##### priorMessages?

> `optional` **priorMessages?**: [`ToolLoopMessage`](#toolloopmessage)[]

Defined in: [src/tool-loop.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L312)

##### streamTurn

> **streamTurn**: (`messages`) => `AsyncIterable`\<`Raw`\>

Defined in: [src/tool-loop.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L313)

###### Parameters

###### messages

[`ToolLoopMessage`](#toolloopmessage)[]

###### Returns

`AsyncIterable`\<`Raw`\>

##### extractText

> **extractText**: (`event`) => `string`

Defined in: [src/tool-loop.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L314)

###### Parameters

###### event

`Raw`

###### Returns

`string`

##### extractToolCall

> **extractToolCall**: (`event`) => [`ToolLoopCall`](#toolloopcall) \| `null`

Defined in: [src/tool-loop.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L315)

###### Parameters

###### event

`Raw`

###### Returns

[`ToolLoopCall`](#toolloopcall) \| `null`

##### isExecutableTool

> **isExecutableTool**: (`toolName`) => `boolean`

Defined in: [src/tool-loop.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L316)

###### Parameters

###### toolName

`string`

###### Returns

`boolean`

##### executeToolCall

> **executeToolCall**: (`call`) => `Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

Defined in: [src/tool-loop.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L317)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`Promise`\<[`ToolCallOutcome`](#toolcalloutcome)\>

##### maxToolTurns?

> `optional` **maxToolTurns?**: `number`

Defined in: [src/tool-loop.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L319)

Runaway-backstop cap. Default 200 — set far above any legitimate workflow.

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [src/tool-loop.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L321)

Wall-clock deadline in ms since epoch (Date.now()-based).

##### maxCostUsd?

> `optional` **maxCostUsd?**: `number`

Defined in: [src/tool-loop.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L323)

Maximum total cost in USD. Requires `costOf` to meter each tool call.

##### costOf?

> `optional` **costOf?**: (`call`, `outcome`) => `number`

Defined in: [src/tool-loop.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L325)

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

Defined in: [src/tool-loop.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L326)

###### Parameters

###### label

`string`

###### outcome

[`ToolCallOutcome`](#toolcalloutcome)

###### Returns

`string`

##### labelFor?

> `optional` **labelFor?**: (`call`) => `string`

Defined in: [src/tool-loop.ts:327](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L327)

###### Parameters

###### call

[`ToolLoopCall`](#toolloopcall)

###### Returns

`string`

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/tool-loop.ts:328](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L328)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/tool-loop.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L329)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](#runtimehooks)

Defined in: [src/tool-loop.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L330)

***

### AgentTaskSpec

Defined in: [src/types.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L27)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [src/types.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L28)

##### intent

> **intent**: `string`

Defined in: [src/types.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L29)

##### domain?

> `optional` **domain?**: `string`

Defined in: [src/types.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L31)

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [src/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L32)

##### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

Defined in: [src/types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L33)

##### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

Defined in: [src/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L34)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L35)

***

### AgentKnowledgeProvider

Defined in: [src/types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L39)

#### Stable

#### Methods

##### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [src/types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L40)

###### Parameters

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

##### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

Defined in: [src/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L41)

###### Parameters

###### questions

`UserQuestion`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

##### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

Defined in: [src/types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L45)

###### Parameters

###### plans

`DataAcquisitionPlan`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`string`[] \| `Promise`\<`string`[]\>

##### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [src/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L49)

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

Defined in: [src/types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L58)

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

Defined in: [src/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L64)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [src/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L65)

##### state

> **state**: `TState`

Defined in: [src/types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L66)

##### evals

> **evals**: `TEval`[]

Defined in: [src/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L67)

##### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

Defined in: [src/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L68)

##### budget

> **budget**: `ControlBudget`

Defined in: [src/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L69)

##### stepIndex

> **stepIndex**: `number`

Defined in: [src/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L70)

##### wallMs

> **wallMs**: `number`

Defined in: [src/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L71)

##### spentCostUsd

> **spentCostUsd**: `number`

Defined in: [src/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L72)

##### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

Defined in: [src/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L73)

##### abortSignal

> **abortSignal**: `AbortSignal`

Defined in: [src/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L74)

***

### AgentAdapter

Defined in: [src/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L78)

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

Defined in: [src/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L84)

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

Defined in: [src/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L91)

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

Defined in: [src/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L99)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

Defined in: [src/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L103)

###### Parameters

###### action

`TAction`

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

##### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

Defined in: [src/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L108)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

##### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [src/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L122)

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

Defined in: [src/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L129)

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

Defined in: [src/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L138)

###### Parameters

###### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`RunRecord`[]

***

### BackendErrorDetail

Defined in: [src/types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L212)

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

Defined in: [src/types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L218)

`'transport'` — upstream HTTP / network failure with optional status code.
`'backend'` — the backend's `stream()` generator threw for a non-transport
reason (e.g. a custom adapter error, sandbox crash).

##### message

> **message**: `string`

Defined in: [src/types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L219)

##### status?

> `optional` **status?**: `number`

Defined in: [src/types.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L221)

Upstream HTTP status when known. `0` for connection / abort errors.

##### body?

> `optional` **body?**: `string`

Defined in: [src/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L223)

Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed.

***

### OpenAIChatTool

Defined in: [src/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L242)

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

Defined in: [src/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L243)

##### function

> **function**: `object`

Defined in: [src/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L244)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSessionStore

Defined in: [src/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L461)

#### Stable

#### Methods

##### get()

> **get**(`sessionId`): `RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

Defined in: [src/types.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L462)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

##### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

Defined in: [src/types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L463)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void` \| `Promise`\<`void`\>

##### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

Defined in: [src/types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L464)

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

Defined in: [src/types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L465)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

***

### AgentBackendInput

Defined in: [src/types.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L469)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [src/types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L470)

##### message?

> `optional` **message?**: `string`

Defined in: [src/types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L471)

##### messages?

> `optional` **messages?**: `object`[]

Defined in: [src/types.ts:472](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L472)

###### role

> **role**: `string`

###### content

> **content**: `string`

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [src/types.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L473)

***

### AgentBackendContext

Defined in: [src/types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L477)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [src/types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L478)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [src/types.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L479)

##### session

> **session**: `RuntimeSession`

Defined in: [src/types.ts:480](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L480)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L481)

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/types.ts:487](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L487)

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

##### turnId?

> `optional` **turnId?**: `string`

Defined in: [src/types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L492)

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [src/types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L498)

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/types.ts:505](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L505)

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.

***

### AgentExecutionBackend

Defined in: [src/types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L509)

#### Stable

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### kind

> **kind**: `string`

Defined in: [src/types.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L510)

#### Methods

##### start()?

> `optional` **start**(`input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [src/types.ts:511](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L511)

###### Parameters

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\> & `object`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

##### resume()?

> `optional` **resume**(`session`, `input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [src/types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L515)

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

Defined in: [src/types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L520)

###### Parameters

###### input

`TInput`

###### context

[`AgentBackendContext`](#agentbackendcontext)

###### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

##### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

Defined in: [src/types.ts:521](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L521)

###### Parameters

###### session

`RuntimeSession`

###### reason

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### AgentTaskRunResult

Defined in: [src/types.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L557)

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

Defined in: [src/types.ts:563](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L563)

##### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

Defined in: [src/types.ts:564](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L564)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [src/types.ts:565](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L565)

##### questions

> **questions**: `UserQuestion`[]

Defined in: [src/types.ts:566](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L566)

##### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

Defined in: [src/types.ts:567](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L567)

##### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

Defined in: [src/types.ts:568](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L568)

##### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

Defined in: [src/types.ts:569](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L569)

##### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

Defined in: [src/types.ts:570](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L570)

##### runRecords

> **runRecords**: `RunRecord`[]

Defined in: [src/types.ts:571](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L571)

## Type Aliases

### AgentCandidateProfileSource

> **AgentCandidateProfileSource** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \} \| \{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

Defined in: [src/candidate-execution/builder.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L25)

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

Applied in order before the resulting profile is frozen into the bundle.

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

Defined in: [src/candidate-execution/builder.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L52)

Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify.

***

### AgentCandidateBundleInput

> **AgentCandidateBundleInput** = `Omit`\<`AgentCandidateBundle`, `"digest"`\>

Defined in: [src/candidate-execution/bundle.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/bundle.ts#L7)

Exact candidate wire shape before the runtime computes its canonical digest.

***

### AgentCandidateExecutionFailureClass

> **AgentCandidateExecutionFailureClass** = `"pre-model-infrastructure"` \| `"execution"` \| `"post-model-infrastructure"` \| `"unknown"`

Defined in: [src/candidate-execution/claim.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L79)

Only the first class is retryable, and only when the closed model ledger has zero calls.

***

### AgentCandidateExecutionTerminalResult

> **AgentCandidateExecutionTerminalResult** = \{ `status`: `"succeeded"`; `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \} \| \{ `status`: `"failed"`; `failureClass`: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass); `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `failureEvidence?`: `AgentCandidateArtifactRef`; \}

Defined in: [src/candidate-execution/claim.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L86)

Evaluator-owned terminal facts staged durably before the terminal CAS.

***

### AgentCandidateExecutionTerminalRecord

> **AgentCandidateExecutionTerminalRecord** = [`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult) & `object`

Defined in: [src/candidate-execution/claim.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L104)

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

##### preparationEvidence

> `readonly` **preparationEvidence**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)\[`"preparationEvidence"`\]

##### terminalDigest

> `readonly` **terminalDigest**: `Sha256Digest`

RFC 8785 SHA-256 of this record with `terminalDigest` omitted.

***

### AgentCandidateExecutionPhase

> **AgentCandidateExecutionPhase** = `"claimed"` \| `"candidate-may-run"`

Defined in: [src/candidate-execution/claim.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L115)

Monotonic durable phase: the second value means candidate code could have started.

***

### AgentCandidateExecutionClaimResult

> **AgentCandidateExecutionClaimResult** = \{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \} \| \{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \} \| \{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

Defined in: [src/candidate-execution/claim.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L155)

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

Defined in: [src/candidate-execution/claim.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L177)

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

Defined in: [src/candidate-execution/claim.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L190)

Result of durably staging the one immutable terminal outbox entry.

***

### AgentCandidateExecutionPhaseResult

> **AgentCandidateExecutionPhaseResult** = \{ `marked`: `true`; `phase`: `"candidate-may-run"`; \} \| \{ `marked`: `false`; `phase`: `"candidate-may-run"`; \}

Defined in: [src/candidate-execution/claim.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L202)

Result of crossing the irreversible candidate-may-run boundary.

***

### AgentCandidateRetryRejection

> **AgentCandidateRetryRejection** = `"prior-attempt-missing"` \| `"prior-attempt-running"` \| `"prior-attempt-succeeded"` \| `"prior-attempt-spent-model-calls"` \| `"prior-attempt-not-pre-model-infrastructure"` \| `"retry-lineage-mismatch"`

Defined in: [src/candidate-execution/claim.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim.ts#L206)

***

### AgentCandidateModelGrantReserveInput

> **AgentCandidateModelGrantReserveInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"reserveGrant"`\]\>\[`0`\]

Defined in: [src/candidate-execution/protected-model-port.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L18)

***

### AgentCandidateModelGrantActivateInput

> **AgentCandidateModelGrantActivateInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"activateGrant"`\]\>\[`0`\]

Defined in: [src/candidate-execution/protected-model-port.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L21)

***

### AgentCandidateModelGrantSettleInput

> **AgentCandidateModelGrantSettleInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"settleGrant"`\]\>\[`0`\]

Defined in: [src/candidate-execution/protected-model-port.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L24)

***

### AgentCandidateModelGrantReservation

> **AgentCandidateModelGrantReservation** = [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

Defined in: [src/candidate-execution/protected-model-port.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L29)

Secret-free response from the service's reservation endpoint.

***

### AgentCandidateOutputPurpose

> **AgentCandidateOutputPurpose** = `"execution-plan"` \| `"materialization-receipt"` \| `"candidate-workspace-manifest"` \| `"candidate-workspace-archive"` \| `"task-manifest"` \| `"task-archive"` \| `"task-patch"` \| `"task-output"` \| `"task-outcome"` \| `"memory-after-manifest"` \| `"memory-after-archive"` \| `"grader-evidence"` \| `"benchmark-result"` \| `"model-settlement"` \| `"trace"` \| `"executor-native-evidence"` \| `"executor-capture"` \| `"run-receipt"` \| `"knowledge-retrieval-config"` \| `"knowledge-evaluation"` \| `"failure-evidence"`

Defined in: [src/candidate-execution/types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L45)

***

### AgentCandidateModelLimits

> **AgentCandidateModelLimits** = `Pick`\<`AgentCandidateExecutionLimits`, `"maxModelCalls"` \| `"maxInputTokens"` \| `"maxOutputTokens"` \| `"maxCostUsd"`\>

Defined in: [src/candidate-execution/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L165)

Limits mechanically enforced by the evaluator-owned model gateway.

***

### AgentCandidateExecutorTaskOutcomeCapture

> **AgentCandidateExecutorTaskOutcomeCapture** = \{ `kind`: `"workspace"`; `resultTree`: `string`; `afterState`: `AgentCandidateWorkspaceManifestMaterial`; `archive`: `Uint8Array`; `gitDiff`: `Uint8Array`; \} \| \{ `kind`: `"output"`; `bytes`: `Uint8Array`; \}

Defined in: [src/candidate-execution/types.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L355)

Raw evaluator capture made only after the candidate process is dead.

#### Union Members

##### Type Literal

\{ `kind`: `"workspace"`; `resultTree`: `string`; `afterState`: `AgentCandidateWorkspaceManifestMaterial`; `archive`: `Uint8Array`; `gitDiff`: `Uint8Array`; \}

###### kind

> `readonly` **kind**: `"workspace"`

###### resultTree

> `readonly` **resultTree**: `string`

Claimed final tree. The runtime recomputes it independently from `gitDiff`.

###### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterial`

Complete evaluator-captured workspace description after candidate execution.

###### archive

> `readonly` **archive**: `Uint8Array`

Reproducible workspace archive corresponding to `afterState`.

###### gitDiff

> `readonly` **gitDiff**: `Uint8Array`

Exact binary patch from the signed task base to `afterState`.

***

##### Type Literal

\{ `kind`: `"output"`; `bytes`: `Uint8Array`; \}

###### kind

> `readonly` **kind**: `"output"`

###### bytes

> `readonly` **bytes**: `Uint8Array`

Exact evaluator-captured final output bytes.

***

### VerifiedAgentCandidateTaskOutcome

> **VerifiedAgentCandidateTaskOutcome** = \{ `kind`: `"workspace"`; `evidence`: `PersistedTaskOutcomeEvidence`\<`"workspace"`\>; `patch`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \} \| \{ `kind`: `"output"`; `evidence`: `PersistedTaskOutcomeEvidence`\<`"output"`\>; `spec`: `AgentCandidateTaskOutputSpec`; `bytes`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \}

Defined in: [src/candidate-execution/types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L398)

Branded task outcome that has survived independent evaluator verification.

***

### AgentCandidateRunFinalization

> **AgentCandidateRunFinalization** = \{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceipt`\>; `artifacts`: \{ `executorCapture`: `AgentCandidateArtifactRef`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \} \| \{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateFixedSpend` \| `null`; \}

Defined in: [src/candidate-execution/types.ts:555](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L555)

#### Union Members

##### Type Literal

\{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceipt`\>; `artifacts`: \{ `executorCapture`: `AgentCandidateArtifactRef`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \}

***

##### Type Literal

\{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateFixedSpend` \| `null`; \}

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

> **usage**: `AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

***

### RetryableErrorPredicate

> **RetryableErrorPredicate** = (`err`) => `boolean`

Defined in: [src/conversation/call-policy.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L18)

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

#### Parameters

##### err

`unknown`

#### Returns

`boolean`

***

### RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Defined in: [src/conversation/call-policy.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L21)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.

***

### ForwardHeaderName

> **ForwardHeaderName** = *typeof* [`FORWARD_HEADERS`](#forward_headers)\[keyof *typeof* [`FORWARD_HEADERS`](#forward_headers)\]

Defined in: [src/conversation/headers.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L35)

***

### PropagatedHeaders

> **PropagatedHeaders** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/conversation/headers.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L111)

Header bag carried through `AgentBackendContext.propagatedHeaders` so
backends that opt in can merge them into their outbound HTTP requests.
Distinct from `buildForwardHeaders` so callers can attach extra
non-protocol headers (e.g. tracing) without colliding.

***

### PersonaDriver

> **PersonaDriver** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"scripted"`; `turns`: `string`[]; \}

Defined in: [src/conversation/run-persona.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L32)

A persona that drives the conversation: either a full driver `AgentProfile`
 (an LLM user-sim) or a deterministic script of user turns (the fast-path).

***

### AuthSource

> **AuthSource** = `"forward-user"` \| `"agent-owned"` \| ((`state`) => `"forward-user"` \| `"agent-owned"`)

Defined in: [src/conversation/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L68)

#### Stable

***

### TurnOrder

> **TurnOrder** = `"alternate"` \| `"round-robin"` \| ((`state`) => `number`)

Defined in: [src/conversation/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L74)

#### Stable

***

### HaltPredicate

> **HaltPredicate** = (`ctx`) => `boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

Defined in: [src/conversation/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L95)

#### Parameters

##### ctx

[`HaltContext`](#haltcontext)

#### Returns

`boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

#### Stable

***

### HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

Defined in: [src/conversation/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L100)

#### Stable

***

### ConversationStreamEvent

> **ConversationStreamEvent** = \{ `type`: `"conversation_start"`; `runId`: `string`; `participants`: readonly `string`[]; `seed`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"conversation_resumed"`; `runId`: `string`; `participants`: readonly `string`[]; `transcript`: readonly [`ConversationTurn`](#conversationturn)[]; `timestamp`: `string`; \} \| \{ `type`: `"turn_start"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `timestamp`: `string`; \} \| \{ `type`: `"turn_text_delta"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"turn_retry"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_end"`; `runId`: `string`; `turn`: [`ConversationTurn`](#conversationturn); `timestamp`: `string`; \} \| \{ `type`: `"conversation_end"`; `runId`: `string`; `result`: [`ConversationResult`](#conversationresult); `timestamp`: `string`; \}

Defined in: [src/conversation/types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L246)

#### Stable

***

### Verifier

> **Verifier** = (`worktreePath`, `signal?`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

Defined in: [src/improvement/agentic-generator.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L82)

Verifies the edited worktree. Sync or async; throws only on a setup fault
 (a candidate that fails verification returns `{ok:false}`, it does not
 throw).

#### Parameters

##### worktreePath

`string`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

***

### AgenticGeneratorShotExecution

> **AgenticGeneratorShotExecution** = `Readonly`\<`Omit`\<[`LocalHarnessResult`](mcp.md#localharnessresult), `"usage"` \| `"evidence"`\> & `object`\>

Defined in: [src/improvement/agentic-generator.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L128)

Frozen exact harness result for an author shot: full streams, process state,
 token usage, and execution-policy evidence.
 The `onShotCompleted` callback receives `null` when execution failed before
 the harness returned.

***

### AgenticGeneratorShotDisposition

> **AgenticGeneratorShotDisposition** = \{ `kind`: `"clean"`; `worktreePath`: `string`; \} \| \{ `kind`: `"rejected"`; `worktreePath`: `string`; `stage`: `"raw-trace-evidence"` \| `"verification"`; `feedback`: `string` \| `null`; \} \| \{ `kind`: `"accepted"`; `worktreePath`: `string`; `verified`: `boolean`; \} \| \{ `kind`: `"setup-error"`; `worktreePath`: `string`; `stage`: `"worktree-inspection"` \| `"raw-trace-evidence"` \| `"verification"`; `error`: \{ `name`: `string`; `message`: `string`; \}; \}

Defined in: [src/improvement/agentic-generator.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L141)

Worktree decision emitted before a completed shot is retried, accepted, or
 discarded. The callback runs while `worktreePath` is still available, so
 callers can persist the exact diff.

***

### ImproveSurface

> **ImproveSurface** = `"prompt"` \| `"skills"` \| `"tools"` \| `"mcp"` \| `"hooks"` \| `"subagents"` \| `"agent-profile"` \| `"memory"` \| `"code"` \| `"rollout-policy"`

Defined in: [src/improvement/improve-types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L25)

The executable agent lever `improve` optimizes. Profile fields remain
portable AgentProfile coordinates; implementation and orchestration files
use the code surface so a winner can be sealed into an exact candidate.
`rollout-policy` is the inference-time structuralRollout dials
(`profile.extensions['structural-rollout']`).

***

### ImproveProfileSurface

> **ImproveProfileSurface** = `Exclude`\<[`ImproveSurface`](#improvesurface), `"code"`\>

Defined in: [src/improvement/improve-types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L37)

***

### ImproveMethodFactory

> **ImproveMethodFactory**\<`TScenario`, `TArtifact`\> = (`context`) => `OptimizationMethod`\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/improve-types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L55)

Build a complete method after trace findings are available.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### context

[`ImproveMethodContext`](#improvemethodcontext)

#### Returns

`OptimizationMethod`\<`TScenario`, `TArtifact`\>

***

### ImproveMethodSource

> **ImproveMethodSource**\<`TScenario`, `TArtifact`\> = `OptimizationMethod`\<`TScenario`, `TArtifact`\> \| [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/improve-types.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L59)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveProfileAgent

> **ImproveProfileAgent**\<`TScenario`, `TArtifact`\> = (`profile`, `scenario`, `ctx`) => `Promise`\<`TArtifact`\>

Defined in: [src/improvement/improve-types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L64)

Runs one exact materialized profile on one scenario.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### profile

[`ReadonlyAgentProfile`](#readonlyagentprofile)

##### scenario

`TScenario`

##### ctx

`Parameters`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>\[`"dispatchWithSurface"`\]\>\[`2`\]

#### Returns

`Promise`\<`TArtifact`\>

***

### ImproveOptimizationRunOptions

> **ImproveOptimizationRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`NonNullable`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>\[`"optimizationRunOptions"`\]\>, `"dispatchRef"`\>

Defined in: [src/improvement/improve-types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L72)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveMethodOptions

> **ImproveMethodOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>, `"baselineSurface"` \| `"dispatchRef"` \| `"dispatchWithSurface"` \| `"methods"` \| `"optimizationConcurrency"` \| `"optimizationRunOptions"`\> & `object`

Defined in: [src/improvement/improve-types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L78)

Complete-method configuration for every non-code profile surface.

#### Type Declaration

##### surface?

> `optional` **surface?**: [`ImproveProfileSurface`](#improveprofilesurface)

Exact profile coordinate optimized by `method`. Default `'prompt'`.

##### executionRef

> **executionRef**: `Sha256Digest`

Immutable digest of `agent`, profile component mapping, models, tools, and
every closure or external setting that can change measured behavior.

##### method

> **method**: [`ImproveMethodSource`](#improvemethodsource)\<`TScenario`, `TArtifact`\>

A complete optimizer or a factory that can incorporate current findings.

##### agent

> **agent**: [`ImproveProfileAgent`](#improveprofileagent)\<`TScenario`, `TArtifact`\>

Runs the exact complete profile materialized from one candidate surface.

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Trace or analyst findings available to a method factory.

##### skills?

> `optional` **skills?**: [`ImproveSkillsOptions`](#improveskillsoptions)

Select the exact inline skill document for `surface: 'skills'`.

##### profileComponents?

> `optional` **profileComponents?**: [`ImproveProfileComponents`](#improveprofilecomponents)

Map a profile to named text components and apply the winning components.
Valid only with `surface: 'agent-profile'`.

##### optimizationRunOptions?

> `optional` **optimizationRunOptions?**: [`ImproveOptimizationRunOptions`](#improveoptimizationrunoptions)\<`TScenario`, `TArtifact`\>

Shared settings for method train and selection calls.

##### minimumLift?

> `optional` **minimumLift?**: `number`

Ship only when the paired final-test interval is entirely above this lift. Default `0`.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveCodeRunOptions

> **ImproveCodeRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SelfImproveOptions`\<`TScenario`, `TArtifact`\>, `"analyzeGeneration"` \| `"baselineSurface"` \| `"budget"` \| `"findings"` \| `"gate"` \| `"llm"` \| `"method"` \| `"mutationPrimitives"` \| `"proposer"` \| `"proposerTarget"` \| `"selectionScenarios"`\> & `object`

Defined in: [src/improvement/improve-types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L114)

Runtime-owned code search in isolated git worktrees.

#### Type Declaration

##### surface

> **surface**: `"code"`

##### budget?

> `optional` **budget?**: `Omit`\<`SelfImproveBudget`, `"selectionFraction"`\>

Local code-search budget. Method-only selection controls do not apply.

##### findings?

> `optional` **findings?**: readonly `unknown`[]

Findings supplied to Runtime's code candidate driver.

##### gate?

> `optional` **gate?**: `"holdout"` \| `"none"`

Gate mode. `'holdout'` (default) runs the held-out promotion gate;
`'none'` is a baseline-only run (`budget.generations = 0`).

##### analyzeGeneration?

> `optional` **analyzeGeneration?**: `SelfImproveOptions`\<`TScenario`, `TArtifact`\>\[`"analyzeGeneration"`\] \| `null`

Per-generation findings producer for Runtime's code search.
Pass your own producer to replace the code-trace distiller; pass `null`
to keep the static findings for every generation.

##### rawTraceContext?

> `optional` **rawTraceContext?**: `boolean`

Feed code candidates paths to prior raw traces instead of a failure digest.
Defaults to true for durable runs and false for in-memory runs.

##### code

> **code**: [`ImproveCodeOptions`](#improvecodeoptions)

Isolated repository and candidate generator settings.

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

### ImproveOptions

> **ImproveOptions**\<`TScenario`, `TArtifact`\> = [`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\> \| [`ImproveCodeRunOptions`](#improvecoderunoptions)\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/improve-types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L151)

The canonical improvement API: complete methods for profiles, worktrees for code.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImprovementCandidate

> **ImprovementCandidate** = [`ImprovementProfileCandidate`](#improvementprofilecandidate) \| [`ImprovementCodeCandidate`](#improvementcodecandidate)

Defined in: [src/improvement/improve-types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L208)

***

### ImproveResult

> **ImproveResult**\<`TScenario`, `TArtifact`\> = [`ImproveMethodResult`](#improvemethodresult) \| [`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/improve-types.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve-types.ts#L270)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### OfficialGepaOptions

> **OfficialGepaOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`GepaOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Defined in: [src/improvement/official-optimizers.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L50)

Official GEPA configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### OfficialSkillOptOptions

> **OfficialSkillOptOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SkillOptOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Defined in: [src/improvement/official-optimizers.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L57)

Official SkillOpt configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### DeepReadonly

> **DeepReadonly**\<`T`\> = `T` *extends* (...`args`) => `unknown` ? `T` : `T` *extends* readonly infer TItem[] ? readonly [`DeepReadonly`](#deepreadonly)\<`TItem`\>[] : `T` *extends* `object` ? `{ readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }` : `T`

Defined in: [src/improvement/profile-types.ts:3](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-types.ts#L3)

#### Type Parameters

##### T

`T`

***

### ReadonlyAgentProfile

> **ReadonlyAgentProfile** = [`DeepReadonly`](#deepreadonly)\<`AgentProfile`\>

Defined in: [src/improvement/profile-types.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/profile-types.ts#L12)

Complete immutable profile value used during measured execution.

***

### KnowledgeReadinessCheckResult

> **KnowledgeReadinessCheckResult** = `boolean` \| \{ `ready`: `boolean`; `summary?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; \}

Defined in: [src/knowledge/supervised-update.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L31)

***

### KnowledgeReadinessCheck

> **KnowledgeReadinessCheck** = (`input`) => `Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

Defined in: [src/knowledge/supervised-update.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L39)

#### Parameters

##### input

[`KnowledgeReadinessCheckInput`](#knowledgereadinesscheckinput)

#### Returns

`Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

***

### SupervisedKnowledgeUpdater

> **SupervisedKnowledgeUpdater** = (`input`) => `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

Defined in: [src/knowledge/supervised-update.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L87)

#### Parameters

##### input

[`SupervisedKnowledgeUpdateInput`](#supervisedknowledgeupdateinput)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### DelegatedLoopMode

> **DelegatedLoopMode** = *typeof* [`DELEGATED_LOOP_MODES`](#delegated_loop_modes)\[`number`\]

Defined in: [src/loop-runner.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L44)

**`Experimental`**

***

### DelegatedLoopRunner

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

Defined in: [src/loop-runner.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L53)

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

Defined in: [src/loop-runner.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L57)

**`Experimental`**

Mode → configured runner. Partial: only register the modes a
 given product/routine actually uses.

***

### AgentBackendKind

> **AgentBackendKind** = `"router"` \| `"tcloud"` \| `"cli-bridge"` \| `"sandbox"`

Defined in: [src/resolve-agent-backend.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L38)

The transport a chat backend runs on.

***

### RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

Defined in: [src/runtime-hooks.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L10)

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.

***

### RuntimeHookTarget

> **RuntimeHookTarget** = `"agent.run"` \| `"agent.turn"` \| `"agent.tool_call"` \| `"agent.spawn"` \| `"agent.child"` \| `"agent.plan"` \| `"agent.decision"` \| `string` & `object`

Defined in: [src/runtime-hooks.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L12)

***

### RuntimeDecisionKind

> **RuntimeDecisionKind** = `"continue"` \| `"verify"` \| `"ask"` \| `"retry"` \| `"stop"` \| `"memory-write"` \| `"memory-read"` \| `"tool-select"` \| `"skill-select"` \| `"workflow-select"` \| `"surface-promote"` \| `string` & `object`

Defined in: [src/runtime-hooks.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L22)

***

### ToolCallOutcome

> **ToolCallOutcome** = \{ `ok`: `true`; `result`: `unknown`; \} \| \{ `ok`: `false`; `code`: `string`; `message`: `string`; `status?`: `number`; \}

Defined in: [src/tool-loop.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L30)

Outcome of one tool dispatch — structurally compatible with a hub/integration
 tool-outcome union, so callers can fold either through the loop.

***

### ToolLoopMessage

> **ToolLoopMessage** = `object`

Defined in: [src/tool-loop.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L68)

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

Defined in: [src/tool-loop.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L69)

##### content

> **content**: `string` \| `null`

Defined in: [src/tool-loop.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L70)

##### tool\_calls?

> `optional` **tool\_calls?**: [`ToolLoopAssistantToolCall`](#toolloopassistanttoolcall)[]

Defined in: [src/tool-loop.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L71)

##### tool\_call\_id?

> `optional` **tool\_call\_id?**: `string`

Defined in: [src/tool-loop.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L72)

***

### ToolLoopEvent

> **ToolLoopEvent** = \{ `type`: `"text"`; `text`: `string`; \} \| \{ `type`: `"tool_call"`; `call`: [`ToolLoopCall`](#toolloopcall); \} \| \{ `type`: `"other"`; `event`: `unknown`; \}

Defined in: [src/tool-loop.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L108)

***

### ToolLoopStopReason

> **ToolLoopStopReason** = `"completed"` \| `"stuck-loop"` \| `"backstop"` \| `"deadline"` \| `"budget"`

Defined in: [src/tool-loop.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L118)

Why the loop stopped. `completed` = model finished naturally; `stuck-loop` =
 ≥3 consecutive identical tool calls (same tool + args); `backstop` = hit the
 runaway-backstop cap (200 by default); `deadline` = wall-clock deadlineMs
 exceeded; `budget` = maxCostUsd exhausted. Non-`completed` stops are infra /
 resource outcomes — eval scoring must distinguish them from capability failure.

***

### StreamToolLoopYield

> **StreamToolLoopYield**\<`Raw`\> = \{ `kind`: `"event"`; `event`: `Raw`; \} \| \{ `kind`: `"tool_result"`; `toolName`: `string`; `toolCallId?`: `string`; `label`: `string`; `outcome`: [`ToolCallOutcome`](#toolcalloutcome); \} \| \{ `kind`: `"capped"`; `pending`: `number`; `stopReason`: `Exclude`\<[`ToolLoopStopReason`](#toolloopstopreason), `"completed"`\>; \}

Defined in: [src/tool-loop.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L298)

#### Type Parameters

##### Raw

`Raw`

***

### AgentTaskStatus

> **AgentTaskStatus** = `"completed"` \| `"blocked"` \| `"failed"` \| `"aborted"`

Defined in: [src/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L145)

#### Stable

***

### AgentRuntimeEvent

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; \}

Defined in: [src/types.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L148)

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

Defined in: [src/types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L189)

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

Defined in: [src/types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L260)

`tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
spec: `'auto'` (default — model decides), `'none'` (disable tool calling
for this turn), `'required'` (force a tool call), or a specific function
pin `{ type: 'function', function: { name } }`.

#### Stable

***

### OpenAIChatResponseFormat

> **OpenAIChatResponseFormat** = \{ `type`: `"text"`; \} \| \{ `type`: `"json_object"`; \} \| \{ `type`: `"json_schema"`; `json_schema`: `Record`\<`string`, `unknown`\>; \}

Defined in: [src/types.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L274)

`response_format` parameter for OpenAI-compatible chat endpoints. Use
`json_object` when the caller needs syntactically valid JSON, or
`json_schema` when the upstream provider supports schema-constrained JSON.

#### Stable

***

### RuntimeStreamEvent

> **RuntimeStreamEvent** = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

Defined in: [src/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L280)

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

### CANDIDATE\_KNOWLEDGE\_ROOT\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_ROOT\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_ROOT"` = `'TANGLE_CANDIDATE_KNOWLEDGE_ROOT'`

Defined in: [src/candidate-execution/knowledge.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/knowledge.ts#L17)

Environment variable containing the materialized candidate knowledge root.

***

### CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG"` = `'TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG'`

Defined in: [src/candidate-execution/knowledge.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/knowledge.ts#L19)

Environment variable containing the materialized retrieval configuration path.

***

### CANDIDATE\_TRACE\_TAGS

> `const` **CANDIDATE\_TRACE\_TAGS**: `object`

Defined in: [src/candidate-execution/types.ts:582](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L582)

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

Defined in: [src/candidate-execution/types.ts:590](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/types.ts#L590)

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

### AGENT\_CANDIDATE\_EXECUTION\_SUPPORT

> `const` **AGENT\_CANDIDATE\_EXECUTION\_SUPPORT**: `Readonly`\<\{ `outcomes`: readonly \[`"workspace"`, `"output"`\]; `code`: readonly \[`"disabled"`, `"no-op"`, `"git-patch"`\]; `memory`: readonly \[`"disabled"`, `"isolated"`\]; `knowledge`: `true`; `profile`: `Readonly`\<\{ `mcpTransports`: readonly \[`"stdio"`\]; `remoteMcp`: `false`; `tools`: `false`; `permissions`: `false`; `modes`: `false`; `confidential`: `false`; \}\>; \}\>

Defined in: [src/candidate-execution/verify.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/verify.ts#L38)

Surfaces admitted by Runtime's verifier before an environment adapter is selected.

***

### defaultIsRetryable

> `const` **defaultIsRetryable**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [src/conversation/call-policy.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L65)

Default retryable classification — network/timeout class errors. Errors
a model deliberately throws (validation, refusal, 4xx) are not retried;
those represent real outcomes, not transient infrastructure faults.

***

### FORWARD\_HEADERS

> `const` **FORWARD\_HEADERS**: `object`

Defined in: [src/conversation/headers.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L20)

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

Defined in: [src/conversation/headers.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L38)

Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded.

***

### AGENTIC\_PROFILE\_RESOURCE\_ROOT

> `const` **AGENTIC\_PROFILE\_RESOURCE\_ROOT**: `".agent-runtime-profile-resources"` = `'.agent-runtime-profile-resources'`

Defined in: [src/improvement/agentic-generator.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L70)

Dedicated ephemeral root for generic author-profile files. Every declared
file must live below this root so cleanup cannot alter candidate-owned files.

***

### LIFTED\_FINDING\_ANALYST\_ID

> `const` **LIFTED\_FINDING\_ANALYST\_ID**: `"lifted-seed"` = `'lifted-seed'`

Defined in: [src/improvement/findings.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L24)

Analyst id stamped on findings lifted from untyped seed values.

***

### optimizerMethod

> `const` **optimizerMethod**: `string`

Defined in: [src/improvement/optimizer-prompt.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/optimizer-prompt.ts#L22)

The shared method block every build/author prompt embeds. Domain framing
(what a tool/MCP/codebase-edit deliverable looks like) wraps around it; this
is the process itself.

***

### buildDriverSystem

> `const` **buildDriverSystem**: `string`

Defined in: [src/improvement/optimizer-prompt.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/optimizer-prompt.ts#L61)

The driver's stance for `driverLoopGenerator` — the build-domain instance of
the supervisor doctrine (observe → rate → decide; refine / re-scope /
decompose; the check decides delivery, never the driver's prose).

***

### researchDriverNote

> `const` **researchDriverNote**: `string`

Defined in: [src/improvement/optimizer-prompt.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/optimizer-prompt.ts#L108)

The driver's ADOPT-not-build doctrine, appended to `buildDriverSystem` when
a `research` tool is wired into the loop (`DriverLoopGeneratorOptions.
research`). Kept separate so a driver WITHOUT the tool is never told to
call a tool it does not have.

***

### strategyAuthorMethod

> `const` **strategyAuthorMethod**: `string`

Defined in: [src/improvement/optimizer-prompt.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/optimizer-prompt.ts#L125)

The senior authoring process for `authorStrategy` — the same method, shaped
to the strategy contract (author-blind, conserved budget, one module out).

***

### ROLLOUT\_POLICY\_EXTENSION

> `const` **ROLLOUT\_POLICY\_EXTENSION**: `"structural-rollout"` = `'structural-rollout'`

Defined in: [src/improvement/rollout-policy.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L12)

The profile extensions namespace the policy persists under.

***

### RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT

> `const` **RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT**: `string`

Defined in: [src/knowledge/supervised-update.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L10)

Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers.

***

### DELEGATED\_LOOP\_MODES

> `const` **DELEGATED\_LOOP\_MODES**: readonly \[`"code"`, `"review"`, `"research"`, `"audit"`, `"self-improve"`\]

Defined in: [src/loop-runner.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L41)

**`Experimental`**

All valid delegated-loop mode names — used for validation and CLI surfaces.

***

### DEFAULT\_ROUTER\_BASE\_URL

> `const` **DEFAULT\_ROUTER\_BASE\_URL**: `"https://router.tangle.tools"` = `'https://router.tangle.tools'`

Defined in: [src/model-resolution.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L43)

Default Tangle Router base URL used when no env override is set.

***

### INTELLIGENCE\_WIRE\_VERSION

> `const` **INTELLIGENCE\_WIRE\_VERSION**: `"2026-05-26.v1"` = `'2026-05-26.v1'`

Defined in: [src/otel-export.ts:665](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L665)

Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body).

## Functions

### createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [src/backends.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L30)

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

Defined in: [src/backends.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L41)

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

Defined in: [src/backends.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L208)

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

> **buildAgentCandidateBundle**(`input`): `AgentCandidateBundle`

Defined in: [src/candidate-execution/builder.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/builder.ts#L73)

Compile one measured profile/code candidate into the immutable execution
contract. Code bytes are re-read and verified by agent-eval before they are
embedded. The returned bundle is schema-validated, canonically digested, and
deeply immutable; call `verifyAgentCandidateBundle` at the execution boundary
to re-read external memory, repository, and workspace artifacts.

#### Parameters

##### input

[`BuildAgentCandidateBundleInput`](#buildagentcandidatebundleinput)

#### Returns

`AgentCandidateBundle`

***

### sealAgentCandidateBundle()

> **sealAgentCandidateBundle**(`input`): `AgentCandidateBundle`

Defined in: [src/candidate-execution/bundle.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/bundle.ts#L10)

Validate and content-address a candidate bundle before it crosses an approval boundary.

#### Parameters

##### input

[`AgentCandidateBundleInput`](#agentcandidatebundleinput)

#### Returns

`AgentCandidateBundle`

***

### candidateExecutionClaim()

> **candidateExecutionClaim**(`prepared`, `preparationEvidence`): [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

Defined in: [src/candidate-execution/claim-plan.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/claim-plan.ts#L10)

Extract the complete durable claim from a prepared execution.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### preparationEvidence

###### executionPlan

`AgentCandidateArtifactRef`

###### materializationReceipt

`AgentCandidateArtifactRef`

#### Returns

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

***

### disposePreparedAgentCandidateExecution()

> **disposePreparedAgentCandidateExecution**(`prepared`, `options?`): `Promise`\<\{ `disposed`: `true`; \}\>

Defined in: [src/candidate-execution/dispose.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/dispose.ts#L15)

Revoke reservations held by a prepared candidate that will not be executed.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options?

[`DisposePreparedAgentCandidateOptions`](#disposepreparedagentcandidateoptions) = `{}`

#### Returns

`Promise`\<\{ `disposed`: `true`; \}\>

***

### exactProcessProviderAsCandidateExecutor()

> **exactProcessProviderAsCandidateExecutor**(`options`): [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

Defined in: [src/candidate-execution/exact-process-executor.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/exact-process-executor.ts#L61)

Adapt one neutral exact-process provider to Runtime's trusted candidate boundary.

#### Parameters

##### options

[`ExactProcessCandidateExecutorOptions`](#exactprocesscandidateexecutoroptions)

#### Returns

[`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

***

### executePreparedAgentCandidate()

> **executePreparedAgentCandidate**(`prepared`, `options`): `Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

Defined in: [src/candidate-execution/execute.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/execute.ts#L80)

Executes and finalizes one durably claimed candidate without exposing an unproven result.

#### Parameters

##### prepared

[`PreparedAgentCandidateExecution`](#preparedagentcandidateexecution)

##### options

[`ExecutePreparedAgentCandidateOptions`](#executepreparedagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

***

### candidateKnowledgeExecutionPaths()

> **candidateKnowledgeExecutionPaths**(`taskRoot`, `hasRetrievalConfig`): `object`

Defined in: [src/candidate-execution/knowledge.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/knowledge.ts#L23)

Deterministic, signed locations used by every candidate executor.

#### Parameters

##### taskRoot

`string`

##### hasRetrievalConfig

`boolean`

#### Returns

`object`

##### root

> **root**: `string`

##### retrievalConfig?

> `optional` **retrievalConfig?**: `string`

***

### persistCandidateOutputArtifact()

> **persistCandidateOutputArtifact**(`port`, `input`): `Promise`\<`AgentCandidateArtifactRef`\>

Defined in: [src/candidate-execution/output-artifacts.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/output-artifacts.ts#L11)

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

Defined in: [src/candidate-execution/prepare.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/prepare.ts#L92)

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

### assertCandidateProfileBinding()

> **assertCandidateProfileBinding**(`measuredInput`, `bundled`): `void`

Defined in: [src/candidate-execution/profile.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L183)

Prove the measured generic profile and sealed candidate profile describe the same behavior.

#### Parameters

##### measuredInput

`unknown`

##### bundled

`AgentCandidateProfile`

#### Returns

`void`

***

### parseExactAgentProfile()

> **parseExactAgentProfile**(`input`, `label`): `AgentProfile`

Defined in: [src/candidate-execution/profile.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L195)

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

Defined in: [src/candidate-execution/profile.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L207)

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

Defined in: [src/candidate-execution/profile.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/profile.ts#L219)

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

Defined in: [src/candidate-execution/protected-model-port.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/protected-model-port.ts#L90)

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

Defined in: [src/candidate-execution/recover.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/recover.ts#L48)

Close an expired crashed attempt from persisted non-secret handles, then record failure.

#### Parameters

##### options

[`RecoverExpiredAgentCandidateOptions`](#recoverexpiredagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### verifyAgentCandidateBundle()

> **verifyAgentCandidateBundle**(`input`, `ports`): `Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

Defined in: [src/candidate-execution/verify.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/verify.ts#L54)

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

Defined in: [src/candidate-execution/workspace-archive.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L124)

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

Defined in: [src/candidate-execution/workspace-archive.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L145)

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

Defined in: [src/candidate-execution/workspace-archive.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/candidate-execution/workspace-archive.ts#L206)

Create the standard bounded materializer for candidate execution ports.

#### Parameters

##### options?

[`CreateAgentCandidateWorkspacePortOptions`](#createagentcandidateworkspaceportoptions) = `{}`

#### Returns

[`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

***

### makePerAttemptSignal()

> **makePerAttemptSignal**(`parentSignal`, `deadlineMs`): `object`

Defined in: [src/conversation/call-policy.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L129)

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

Defined in: [src/conversation/call-policy.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L169)

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

Defined in: [src/conversation/call-policy.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L180)

Resolve after `ms` milliseconds — used for retry backoff in conversation call policy.

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### createConversationBackend()

> **createConversationBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [src/conversation/conversation-backend.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/conversation-backend.ts#L29)

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

Defined in: [src/conversation/define-conversation.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/define-conversation.ts#L14)

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

Defined in: [src/conversation/headers.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L53)

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

Defined in: [src/conversation/headers.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L71)

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

Defined in: [src/conversation/headers.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L82)

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

Defined in: [src/conversation/journal-sql.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L61)

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

Defined in: [src/conversation/run-conversation.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L67)

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

Defined in: [src/conversation/run-conversation.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L86)

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

Defined in: [src/conversation/run-persona.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L133)

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

Defined in: [src/conversation/run-persona.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-persona.ts#L224)

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

Defined in: [src/conversation/turn-id.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L15)

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

Defined in: [src/conversation/turn-id.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L25)

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

Defined in: [src/durable/chat-engine.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/chat-engine.ts#L110)

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

Defined in: [src/durable/execution-handle.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/execution-handle.ts#L17)

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

Defined in: [src/improvement/agentic-generator.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L213)

Full-agentic `CandidateGenerator` (the `shots=N, sandbox=on` setting): run a real coding harness inside the candidate worktree so the agent makes the change in place.

#### Parameters

##### opts?

[`AgenticGeneratorOptions`](#agenticgeneratoroptions) = `{}`

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### defaultBuildPrompt()

> **defaultBuildPrompt**(`args`): `string`

Defined in: [src/improvement/agentic-generator.ts:792](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L792)

Turn the analyst's findings (+ optional report) into a concrete coder task —
 the senior scientific-method framing shared with the tool/MCP build prompts.

#### Parameters

##### args

###### report

`unknown`

###### findings

`AnalystFinding`[]

#### Returns

`string`

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

Defined in: [src/improvement/agentic-generator.ts:902](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L902)

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

### findingLines()

> **findingLines**(`findings`): `string`[]

Defined in: [src/improvement/build-prompts.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L24)

Render findings as the ranked-evidence block every build prompt ends with.

#### Parameters

##### findings

`AnalystFinding`[]

#### Returns

`string`[]

***

### toolBuildPrompt()

> **toolBuildPrompt**(`args`): `string`

Defined in: [src/improvement/build-prompts.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L33)

Build the starting instruction for a coder agent tasked with implementing a new tool.

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### mcpBuildPrompt()

> **mcpBuildPrompt**(`args`): `string`

Defined in: [src/improvement/build-prompts.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L59)

Build the starting instruction for a coder agent tasked with implementing a new MCP server.

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### driverLoopGenerator()

> **driverLoopGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Defined in: [src/improvement/driver-loop-generator.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/driver-loop-generator.ts#L85)

Driver→worker `CandidateGenerator`: an LLM driver on the canonical tool-loop authors, observes, rates, and steers coding-harness sessions in the worktree until the verifier passes or the session budget is spent.

#### Parameters

##### opts

[`DriverLoopGeneratorOptions`](#driverloopgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### isAnalystFinding()

> **isAnalystFinding**(`value`): `value is AnalystFinding`

Defined in: [src/improvement/findings.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L29)

Structural guard for the schema-versioned `AnalystFinding` envelope.
 Strict on the identity fields `makeFinding` always populates — a partial
 look-alike is lifted (re-enveloped), not trusted.

#### Parameters

##### value

`unknown`

#### Returns

`value is AnalystFinding`

***

### toAnalystFindings()

> **toAnalystFindings**(`findings`, `opts?`): `AnalystFinding`[]

Defined in: [src/improvement/findings.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/findings.ts#L84)

Normalize a mixed `unknown[]` findings array to `AnalystFinding[]`:
conforming findings pass through by reference; strings and finding-ish
objects are lifted into envelopes (claim = most actionable text, original
value under `metadata.raw`); values with no extractable text are dropped.
Never throws — a malformed seed must not kill a proposal round.

#### Parameters

##### findings

readonly `unknown`[]

##### opts?

[`ToAnalystFindingsOptions`](#toanalystfindingsoptions) = `{}`

#### Returns

`AnalystFinding`[]

***

### improve()

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `opts`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

Defined in: [src/improvement/improve.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L53)

Optimize one exact profile surface with a complete method.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario$1`

###### TArtifact

`TArtifact`

##### Parameters

###### profile

`AgentProfile`

###### opts

[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`opts`): `Promise`\<[`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>\>

Defined in: [src/improvement/improve.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L60)

Optimize repository code through Runtime's isolated worktree path.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario$1`

###### TArtifact

`TArtifact`

##### Parameters

###### opts

[`ImproveCodeRunOptions`](#improvecoderunoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>\>

***

### mcpServeVerifier()

> **mcpServeVerifier**(`spec`): [`Verifier`](#verifier)

Defined in: [src/improvement/mcp-serve-verifier.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L40)

Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools.

#### Parameters

##### spec

[`McpServeSpec`](#mcpservespec)

#### Returns

[`Verifier`](#verifier)

***

### officialGepa()

> **officialGepa**\<`TScenario`, `TArtifact`\>(`options`): [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/official-optimizers.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L97)

Build a complete method backed by GEPA's official Optimize Anything API.

The recipe is passed through unchanged. Use `engine`, `sequential`,
`adaptive-sequential`, `best-of`, `vote`, or `omni` explicitly.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

#### Parameters

##### options

[`OfficialGepaOptions`](#officialgepaoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

***

### officialSkillOpt()

> **officialSkillOpt**\<`TScenario`, `TArtifact`\>(`options`): [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

Defined in: [src/improvement/official-optimizers.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/official-optimizers.ts#L161)

Build a complete method backed by Microsoft's official SkillOpt trainer.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

#### Parameters

##### options

[`OfficialSkillOptOptions`](#officialskilloptoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

***

### rawTraceDistiller()

> **rawTraceDistiller**\<`TScenario`, `TArtifact`\>(`options?`): (`input`) => `Promise`\<`unknown`[]\>

Defined in: [src/improvement/raw-trace-distiller.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/raw-trace-distiller.ts#L89)

Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
grep/cat-to-diagnose instruction — instead of a pre-summarized digest.

Drop-in for `analyzeGeneration` on `improve({ surface: 'code' })`:

  await improve({
    surface: 'code',
    findings: seedFindings,
    code: { repoRoot },
    runDir: '/abs/run',                 // MUST be a real path — the traces live here
    analyzeGeneration: rawTraceDistiller(),
    scenarios, judge, agent,
  })

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario$1` = `Scenario$1`

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

Defined in: [src/improvement/reflective-generator.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L25)

Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate.

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### parseRolloutPolicy()

> **parseRolloutPolicy**(`surface`): [`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

Defined in: [src/improvement/rollout-policy.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L20)

Parse a serialized policy surface. Returns `undefined` for non-strings,
malformed JSON, or values outside the policy invariants. Unknown fields are
dropped; supported optional fields are preserved.

#### Parameters

##### surface

`MutableSurface`

#### Returns

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

***

### normalizeRolloutPolicy()

> **normalizeRolloutPolicy**(`raw`): [`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

Defined in: [src/improvement/rollout-policy.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L36)

Normalize an untyped policy bag (a parsed surface or a profile extension) into
 a full `StructuralRolloutPolicy`, defaults merged. Returns `undefined` when any
 present dial violates the policy invariants (mirrors `resolvePolicy`: integer
 k ≥ 1, repairRounds ≥ 0, testgen ≥ 0) — a corrupt config must read as "not
 configured", never as a fabricated recipe.

#### Parameters

##### raw

`unknown`

#### Returns

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

***

### serializeRolloutPolicy()

> **serializeRolloutPolicy**(`policy`): `string`

Defined in: [src/improvement/rollout-policy.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L55)

Stable serialization with fixed field order.

#### Parameters

##### policy

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy)

#### Returns

`string`

***

### structuralRolloutPolicyFromProfile()

> **structuralRolloutPolicyFromProfile**(`profile`): [`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

Defined in: [src/improvement/rollout-policy.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L67)

Read the persisted policy off the profile. `undefined` when the profile does
 not opt into structural rollout.

#### Parameters

##### profile

#### Returns

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

***

### applyRolloutPolicyToProfile()

> **applyRolloutPolicyToProfile**(`profile`, `policy`): `AgentProfile`

Defined in: [src/improvement/rollout-policy.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/rollout-policy.ts#L76)

Persist a detached policy under the profile extension without mutating the input.

#### Parameters

##### profile

##### policy

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy)

#### Returns

`AgentProfile`

***

### createKnowledgeImprovementActivationExecutor()

> **createKnowledgeImprovementActivationExecutor**(`options`): [`KnowledgeImprovementActivationExecutor`](#knowledgeimprovementactivationexecutor)

Defined in: [src/knowledge/activation.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/activation.ts#L38)

Apply or restore one local knowledge candidate through the shared activation contract.

#### Parameters

##### options

[`CreateKnowledgeImprovementActivationExecutorOptions`](#createknowledgeimprovementactivationexecutoroptions)

#### Returns

[`KnowledgeImprovementActivationExecutor`](#knowledgeimprovementactivationexecutor)

***

### createAgentKnowledgeReadinessCheck()

> **createAgentKnowledgeReadinessCheck**(`options`): [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Defined in: [src/knowledge/improvement-job.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L110)

Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring.

#### Parameters

##### options

[`AgentKnowledgeReadinessCheckOptions`](#agentknowledgereadinesscheckoptions)

#### Returns

[`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

***

### runKnowledgeImprovementJob()

> **runKnowledgeImprovementJob**(`options`): `Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

Defined in: [src/knowledge/improvement-job.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L141)

Produce a frozen KB candidate while leaving live knowledge content unchanged.

#### Parameters

##### options

[`RunKnowledgeImprovementJobOptions`](#runknowledgeimprovementjoboptions)

#### Returns

`Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

***

### buildKnowledgeImprovementExperimentBundles()

> **buildKnowledgeImprovementExperimentBundles**(`bundle`, `knowledge`): [`KnowledgeImprovementExperimentBundles`](#knowledgeimprovementexperimentbundles)

Defined in: [src/knowledge/improvement-job.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/improvement-job.ts#L229)

Attach both frozen knowledge inputs to one otherwise-identical bundle pair.

#### Parameters

##### bundle

`AgentCandidateBundle`

##### knowledge

[`KnowledgeImprovementCandidatePair`](#knowledgeimprovementcandidatepair)

#### Returns

[`KnowledgeImprovementExperimentBundles`](#knowledgeimprovementexperimentbundles)

***

### knowledgeReadinessDeliverable()

> **knowledgeReadinessDeliverable**(`options`): [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Defined in: [src/knowledge/supervised-update.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L92)

Build the completion check a supervised KB update uses to stop only when the KB is ready.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readiness"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"readinessOptions"`\>

#### Returns

[`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

***

### createSupervisedKnowledgeUpdater()

> **createSupervisedKnowledgeUpdater**(`options`): [`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

Defined in: [src/knowledge/supervised-update.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L114)

Create an `improveKnowledgeBase` update callback backed by runtime supervision.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

[`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

***

### runSupervisedKnowledgeUpdate()

> **runSupervisedKnowledgeUpdate**(`options`): `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

Defined in: [src/knowledge/supervised-update.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L128)

Run a runtime supervisor that updates one candidate knowledge base and stops on readiness.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### formatSupervisedKnowledgeTask()

> **formatSupervisedKnowledgeTask**(`options`): `string`

Defined in: [src/knowledge/supervised-update.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/knowledge/supervised-update.ts#L170)

Format the supervisor task with the KB root, readiness requirements, current findings, and metadata.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"findings"` \| `"metadata"`\>

#### Returns

`string`

***

### isDelegatedLoopMode()

> **isDelegatedLoopMode**(`value`): value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

Defined in: [src/loop-runner.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L47)

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

Defined in: [src/loop-runner.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L85)

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

Defined in: [src/loop-runner.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L156)

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

Defined in: [src/loop-runner.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L243)

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

### auditLoopRunner()

> **auditLoopRunner**\<`TProposal`, `TEdit`\>(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

Defined in: [src/loop-runner.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L274)

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

Defined in: [src/mcp/openai-tools.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L64)

**`Experimental`**

Returns the queue-bound delegation tools projected into OpenAI Chat
Completions `tools[]` shape. The order is stable: `delegate_feedback`,
`delegation_status`, `delegation_history`.

#### Returns

[`OpenAIChatTool`](#openaichattool)[]

***

### mcpToolsForRuntimeMcpSubset()

> **mcpToolsForRuntimeMcpSubset**(`names`): [`OpenAIChatTool`](#openaichattool)[]

Defined in: [src/mcp/openai-tools.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L93)

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

Defined in: [src/model-resolution.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L46)

Resolve the router base URL from env, normalised — no trailing `/v1` or `/`.

#### Parameters

##### env?

[`RouterEnv`](#routerenv) = `{}`

#### Returns

`string`

***

### getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Defined in: [src/model-resolution.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L56)

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

Defined in: [src/model-resolution.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L68)

Trim a candidate model id; `undefined` for non-strings and blanks.

#### Parameters

##### value

`unknown`

#### Returns

`string` \| `undefined`

***

### resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](#resolvedchatmodel)

Defined in: [src/model-resolution.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L91)

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

Defined in: [src/model-resolution.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L131)

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

Defined in: [src/otel-export.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L84)

Create an OTEL exporter. Returns undefined when no endpoint is configured.

#### Parameters

##### config?

[`OtelExportConfig`](#otelexportconfig)

#### Returns

[`OtelExporter`](#otelexporter) \| `undefined`

***

### loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): [`OtelSpan`](#otelspan)

Defined in: [src/otel-export.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L165)

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

Defined in: [src/otel-export.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L261)

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

Defined in: [src/otel-export.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L364)

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

Defined in: [src/otel-export.ts:395](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L395)

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

Defined in: [src/otel-export.ts:728](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L728)

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

Defined in: [src/readiness.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/readiness.ts#L27)

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

Defined in: [src/resolve-agent-backend.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/resolve-agent-backend.ts#L79)

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

Defined in: [src/run.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L49)

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

Defined in: [src/run.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L86)

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

Defined in: [src/run.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L204)

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

Defined in: [src/runtime-hooks.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L107)

Identity helper that types a [RuntimeHooks](#runtimehooks) literal so the fields are inferred.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks)

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](#runtimehooks)

Defined in: [src/runtime-hooks.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L116)

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

Defined in: [src/runtime-hooks.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L158)

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

Defined in: [src/runtime-hooks.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L189)

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

Defined in: [src/runtime-run.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L150)

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

Defined in: [src/sanitize.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L82)

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

Defined in: [src/sanitize.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L105)

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

Defined in: [src/sanitize.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L161)

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

Defined in: [src/sanitize.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L531)

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

Defined in: [src/sanitize.ts:559](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L559)

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

Defined in: [src/sse.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L42)

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

Defined in: [src/sse.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L57)

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

Defined in: [src/tool-loop.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L156)

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

Defined in: [src/tool-loop.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/tool-loop.ts#L336)

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
