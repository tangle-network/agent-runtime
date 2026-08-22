[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / index

# index

## Classes

### FileAgentCandidateExecutionClaimStore

Cross-process lifecycle implemented as fsynced, create-if-absent records.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new FileAgentCandidateExecutionClaimStore**(`options`): [`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

###### Parameters

###### options

[`FileAgentCandidateExecutionClaimStoreOptions`](#fileagentcandidateexecutionclaimstoreoptions)

###### Returns

[`FileAgentCandidateExecutionClaimStore`](#fileagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

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

Single-process lifecycle implementation.

#### Implements

- [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

#### Constructors

##### Constructor

> **new InMemoryAgentCandidateExecutionClaimStore**(`options?`): [`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

###### Parameters

###### options?

[`InMemoryAgentCandidateExecutionClaimStoreOptions`](#inmemoryagentcandidateexecutionclaimstoreoptions) = `{}`

###### Returns

[`InMemoryAgentCandidateExecutionClaimStore`](#inmemoryagentcandidateexecutionclaimstore)

#### Methods

##### tryClaim()

> **tryClaim**(`requested`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Parameters

###### requested

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`tryClaim`](#tryclaim-1)

##### getAttempt()

> **getAttempt**(`requestedAttempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Parameters

###### requestedAttempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Implementation of

[`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore).[`getAttempt`](#getattempt-1)

##### markCandidateMayRun()

> **markCandidateMayRun**(`requestedLease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

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

Thrown when the circuit breaker is open for a participant and no retry is allowed yet.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CircuitOpenError**(`participant`, `retryAfterMs`): [`CircuitOpenError`](#circuitopenerror)

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

Thrown when a backend call exceeds its per-attempt deadline.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new DeadlineExceededError**(`deadlineMs`): [`DeadlineExceededError`](#deadlineexceedederror)

###### Parameters

###### deadlineMs

`number`

###### Returns

[`DeadlineExceededError`](#deadlineexceedederror)

###### Overrides

`Error.constructor`

***

### CircuitBreakerState

Live circuit-breaker state — one instance per (participant, conversation run).

#### Constructors

##### Constructor

> **new CircuitBreakerState**(`config`): [`CircuitBreakerState`](#circuitbreakerstate)

###### Parameters

###### config

[`CircuitBreakerConfig`](#circuitbreakerconfig) \| `undefined`

###### Returns

[`CircuitBreakerState`](#circuitbreakerstate)

#### Methods

##### preflight()

> **preflight**(`participant`, `now?`): `void`

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

###### Returns

`void`

##### recordFailure()

> **recordFailure**(`now?`): `void`

###### Parameters

###### now?

`number` = `...`

###### Returns

`void`

***

### SqlConversationJournal

SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
start/halt timestamps + halt reason) and turns (one row per committed turn,
payload is the ConversationTurn JSON). Replays the turns table on
`loadRun` and writes append-only per `appendTurn`.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new SqlConversationJournal**(`db`, `table?`): [`SqlConversationJournal`](#sqlconversationjournal)

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

Create the journal's tables if absent. Idempotent. Call once at deploy
(or at app boot) — running on every request is harmless but adds latency.

###### Returns

`Promise`\<`void`\>

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

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

JSONL on disk. One line per record; first line is the `begin`, subsequent
lines are `turn` records, terminal line is `halt`. Replays the whole file
on `loadRun` — cheap for the conversation sizes this is designed for
(thousands of turns, not millions). For huge runs, plug in a real DB
adapter; the interface is small.

Reads and appends over the shared append-only spine (`durable/jsonl-file`): each
`appendTurn` / `recordHalt` finishes a short write and calls `fsync`, so a process
crash between writes never loses an acknowledged turn, and a crash DURING one leaves
an uncommitted final line that the next read skips and the next append truncates.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new FileConversationJournal**(`path`): [`FileConversationJournal`](#fileconversationjournal)

###### Parameters

###### path

`string`

###### Returns

[`FileConversationJournal`](#fileconversationjournal)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

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

**`Stable`**

A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
status. Distinct from `JudgeError` (which is structural / unrecoverable)
because backend failures are sometimes retryable and consumers may want to
branch on the upstream status code.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new BackendTransportError**(`backend`, `message`, `options?`): [`BackendTransportError`](#backendtransporterror)

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

###### providerDispatch?

`"not_started"`

###### Returns

[`BackendTransportError`](#backendtransporterror)

###### Overrides

`AgentEvalError.constructor`

#### Properties

##### backend

> `readonly` **backend**: `string`

##### status?

> `readonly` `optional` **status?**: `number`

##### providerDispatch?

> `readonly` `optional` **providerDispatch?**: `"not_started"`

Router-owned proof that a rejected request never reached a provider.

This is intentionally one-sided. An absent value, or any value this
package does not understand, remains unknown to Runtime.

##### body?

> `readonly` `optional` **body?**: `string`

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.

***

### RuntimeRunStateError

**`Stable`**

A runtime-run lifecycle method was called in an order the state machine does
not allow: `persist()` before `complete()`, `complete()` twice, etc.

#### Extends

- `AgentEvalError`

#### Extended by

- [`DriverAttemptsExhaustedError`](runtime.md#driverattemptsexhaustederror)

#### Constructors

##### Constructor

> **new RuntimeRunStateError**(`message`, `options?`): [`RuntimeRunStateError`](#runtimerunstateerror)

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

**`Stable`**

The dynamic-loop planner returned an unusable topology move — the LLM emitted
no parseable envelope, an unknown `kind`, or a structurally-invalid move
(e.g. a fanout with zero tasks). This is a structural failure of the
agent-authored topology, not a config mistake: the planner ran but its output
cannot drive the kernel. Carries `validation` so cross-package handlers can
pattern-match without importing the runtime. Fail loud — never substitute a
default move, or the loop silently runs a topology nobody chose.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new PlannerError**(`message`, `options?`): [`PlannerError`](#plannererror)

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

### RetainedRunAdmissionError

**`Stable`**

The caller could not persist one detached-run recovery record.

#### Extends

- `RetainedAdmissionError`\<[`RetainedRunAdmission`](runtime.md#retainedrunadmission)\>

#### Constructors

##### Constructor

> **new RetainedRunAdmissionError**(`admission`, `options?`): [`RetainedRunAdmissionError`](#retainedrunadmissionerror)

###### Parameters

###### admission

[`RetainedRunAdmission`](runtime.md#retainedrunadmission)

###### options?

###### cause?

`unknown`

###### Returns

[`RetainedRunAdmissionError`](#retainedrunadmissionerror)

###### Inherited from

`RetainedAdmissionError<RetainedRunAdmission>.constructor`

#### Properties

##### phase

> `readonly` **phase**: `"intent"` \| `"environment"` \| `"dispatched"`

###### Inherited from

`RetainedAdmissionError.phase`

##### admission

> `readonly` **admission**: [`RetainedRunAdmission`](runtime.md#retainedrunadmission)

The exact record the hook failed to persist, for direct recovery.

###### Inherited from

`RetainedAdmissionError.admission`

***

### RetainedInteractiveAdmissionError

**`Stable`**

The caller could not persist one exact interactive-process recovery record.

#### Extends

- `RetainedAdmissionError`\<[`RetainedInteractiveAdmission`](runtime.md#retainedinteractiveadmission)\>

#### Constructors

##### Constructor

> **new RetainedInteractiveAdmissionError**(`admission`, `options?`): [`RetainedInteractiveAdmissionError`](#retainedinteractiveadmissionerror)

###### Parameters

###### admission

[`RetainedInteractiveAdmission`](runtime.md#retainedinteractiveadmission)

###### options?

###### cause?

`unknown`

###### Returns

[`RetainedInteractiveAdmissionError`](#retainedinteractiveadmissionerror)

###### Inherited from

`RetainedAdmissionError<RetainedInteractiveAdmission>.constructor`

#### Properties

##### phase

> `readonly` **phase**: `"interactive_intent"` \| `"interactive_environment"` \| `"interactive_started"`

###### Inherited from

`RetainedAdmissionError.phase`

##### admission

> `readonly` **admission**: [`RetainedInteractiveAdmission`](runtime.md#retainedinteractiveadmission)

The exact record the hook failed to persist, for direct recovery.

###### Inherited from

`RetainedAdmissionError.admission`

***

### RetainedInteractiveBindingError

**`Stable`**

A provider returned a valid interactive reference that does not bind to the
exact start request, or returned data that could not be parsed as one.

The requested start and any valid provider reference are detached snapshots.
Malformed provider data is never copied into the error, so the error remains
safe to persist while the environment remains available for orphan cleanup.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new RetainedInteractiveBindingError**(`requested`, `returned`, `options?`): [`RetainedInteractiveBindingError`](#retainedinteractivebindingerror)

###### Parameters

###### requested

###### returned

###### ref?

\{ \}

###### status?

\{ \} \| \{ \} \| \{ \}

###### options?

###### cause?

`unknown`

###### Returns

[`RetainedInteractiveBindingError`](#retainedinteractivebindingerror)

###### Overrides

`AgentEvalError.constructor`

#### Properties

##### requested

> `readonly` **requested**: `object`

The exact native-process start request sent to the provider.

##### returned

> `readonly` **returned**: `object`

The valid provider data, when the provider returned a parseable value.

###### ref?

> `readonly` `optional` **ref?**: `object`

###### status?

> `readonly` `optional` **status?**: \{ \} \| \{ \} \| \{ \}

***

### RetainedRunDispatchBindingError

**`Stable`**

A retained dispatch answered with coordinates that do not bind to the
identity the runtime requested, or failed exact verification. The
environment-phase admission is already durable at this point, so its
coordinates plus the provider reference carried here are the manual
recovery path. The environment is intentionally kept. Carries
`backend_integrity` because the provider violated its dispatch contract.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new RetainedRunDispatchBindingError**(`requested`, `returned`, `options?`): [`RetainedRunDispatchBindingError`](#retainedrundispatchbindingerror)

###### Parameters

###### requested

###### provider

`string`

###### environmentId

`string`

###### sessionId

`string`

###### executionId

`string`

###### returned

###### id?

`string`

###### provider?

`string`

###### controlRef?

`unknown`

###### options?

###### cause?

`unknown`

###### Returns

[`RetainedRunDispatchBindingError`](#retainedrundispatchbindingerror)

###### Overrides

`AgentEvalError.constructor`

#### Properties

##### requested

> `readonly` **requested**: `object`

The coordinates the runtime sent with the dispatch.

###### provider

> `readonly` **provider**: `string`

###### environmentId

> `readonly` **environmentId**: `string`

###### sessionId

> `readonly` **sessionId**: `string`

###### executionId

> `readonly` **executionId**: `string`

##### returned

> `readonly` **returned**: `object`

The loose reference the provider actually returned, for triage.

###### id?

> `readonly` `optional` **id?**: `string`

###### provider?

> `readonly` `optional` **provider?**: `string`

###### controlRef?

> `readonly` `optional` **controlRef?**: `unknown`

***

### OfficialOptimizerUnavailableError

Missing optional Python dependencies for an official optimizer.

#### Extends

- `ConfigError`

#### Constructors

##### Constructor

> **new OfficialOptimizerUnavailableError**(`optimizer`, `cause`): [`OfficialOptimizerUnavailableError`](#officialoptimizerunavailableerror)

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

***

### InMemoryRuntimeSessionStore

**`Stable`**

In-memory `RuntimeSessionStore` for single-process use and tests.

#### Implements

- [`RuntimeSessionStore`](#runtimesessionstore)

#### Constructors

##### Constructor

> **new InMemoryRuntimeSessionStore**(): [`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

###### Returns

[`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

#### Methods

##### get()

> **get**(`sessionId`): [`RuntimeSession`](#runtimesession) \| `undefined`

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeSession`](#runtimesession) \| `undefined`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`get`](#get-1)

##### put()

> **put**(`session`): `void`

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`put`](#put-2)

##### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

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

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`listEvents`](#listevents-1)

## Interfaces

### AgentCandidateCodeSurfaceSource

The only accepted path from an agent-eval code candidate to executable bytes.

#### Properties

##### kind

> **kind**: `"code-surface"`

##### surface

> **surface**: `CodeSurface`

##### repository

> **repository**: `AgentCandidateGitHubRepository`

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Optional parent directory used to resolve a relative `surface.worktreeRef`.

***

### BuildAgentCandidateBundleInput

Complete measured surfaces and execution policy compiled into one candidate bundle.

#### Properties

##### profile

> **profile**: [`AgentCandidateProfileSource`](#agentcandidateprofilesource)

##### code

> **code**: [`AgentCandidateCodeSource`](#agentcandidatecodesource)

##### execution

> **execution**: `AgentCandidateExecution`

##### knowledge?

> `optional` **knowledge?**: `AgentCandidateKnowledge`

##### memory

> **memory**: `AgentCandidateMemoryPolicy`

***

### AgentCandidatePreparationEvidence

#### Properties

##### executionPlan

> `readonly` **executionPlan**: `AgentCandidateArtifactRef`

##### materializationReceipt

> `readonly` **materializationReceipt**: `AgentCandidateArtifactRef`

***

### FileAgentCandidateExecutionClaimStoreOptions

#### Properties

##### directory

> **directory**: `string`

Evaluator-owned directory shared by every process allowed to execute candidates.

##### now?

> `optional` **now?**: () => `number`

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### AgentCandidateExecutionCleanupHandles

Non-secret identities a trusted recovery worker needs to close an abandoned attempt.

#### Properties

##### preparationId

> `readonly` **preparationId**: `string`

##### modelGrantDigest

> `readonly` **modelGrantDigest**: `` `sha256:${string}` ``

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

##### traceRunId

> `readonly` **traceRunId**: `string`

##### cleanupTimeoutMs

> `readonly` **cleanupTimeoutMs**: `number`

##### memory?

> `readonly` `optional` **memory?**: `object`

###### accessDigest

> `readonly` **accessDigest**: `` `sha256:${string}` ``

###### effectiveNamespace

> `readonly` **effectiveNamespace**: `string`

***

### AgentCandidateExecutionClaim

Immutable signed identity stored for one execution attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

##### attempt

> `readonly` **attempt**: `number`

##### maxAttempts

> `readonly` **maxAttempts**: `number`

##### retryPolicy

> `readonly` **retryPolicy**: `"none"` \| `"pre-model-infrastructure-only"`

##### bundleDigest

> `readonly` **bundleDigest**: `` `sha256:${string}` ``

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

##### preparationEvidence

> `readonly` **preparationEvidence**: [`AgentCandidatePreparationEvidence`](#agentcandidatepreparationevidence)

Durable canonical bytes needed to reconstruct the signed preparation.

##### retryLineageDigest

> `readonly` **retryLineageDigest**: `` `sha256:${string}` ``

Frozen plan identity with only attempt number and per-attempt grant identity normalized.

##### leaseExpiresAtMs

> `readonly` **leaseExpiresAtMs**: `number`

The winning lease stops authorizing a new terminal write at this instant.

##### resultTimeoutMs

> `readonly` **resultTimeoutMs**: `number`

Frozen budget for task verification, executable grading, and receipt construction.

##### cleanup

> `readonly` **cleanup**: [`AgentCandidateExecutionCleanupHandles`](#agentcandidateexecutioncleanuphandles)

Non-secret handles retained so an expired attempt can be closed and reconciled.

***

### AgentCandidateExecutionLease

Secret capability required to finish the acquired attempt.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

##### attempt

> `readonly` **attempt**: `number`

##### token

> `readonly` **token**: `string`

##### expiresAtMs

> `readonly` **expiresAtMs**: `number`

***

### AgentCandidateExecutionRecoveryEvidence

Trusted, independently observed closure facts for one expired winning lease.

#### Properties

##### failureClass

> `readonly` **failureClass**: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass)

##### usage

> `readonly` **usage**: `AgentCandidateFixedSpend`

##### modelSettlement

> `readonly` **modelSettlement**: `AgentCandidateArtifactRef`

##### failureEvidence?

> `readonly` `optional` **failureEvidence?**: `AgentCandidateArtifactRef`

##### process

> `readonly` **process**: `object`

###### stopped

> `readonly` **stopped**: `true`

###### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

##### model

> `readonly` **model**: `object`

###### closed

> `readonly` **closed**: `true`

###### preparationId

> `readonly` **preparationId**: `string`

###### grantDigest

> `readonly` **grantDigest**: `` `sha256:${string}` ``

##### memory?

> `readonly` `optional` **memory?**: `object`

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

#### Properties

##### executionId

> `readonly` **executionId**: `string`

##### attempt

> `readonly` **attempt**: `number`

***

### AgentCandidateExecutionAttemptRecord

Persisted state available to a fresh trusted recovery worker after a crash.

#### Properties

##### claim

> `readonly` **claim**: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

##### phase

> `readonly` **phase**: [`AgentCandidateExecutionPhase`](#agentcandidateexecutionphase)

##### staged?

> `readonly` `optional` **staged?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

Durable outbox content written before the terminal compare-and-set.

##### terminal?

> `readonly` `optional` **terminal?**: [`AgentCandidateExecutionTerminalRecord`](#agentcandidateexecutionterminalrecord)

***

### AgentCandidateExecutionClaimStore

Atomic one-shot store for candidate execution attempts.

Implementations must linearize both methods across every process sharing the
store. Terminal publication is deliberately two-step: `stageTerminal`
fsyncs the complete immutable outbox record, then `finish` publishes exactly
those staged bytes by digest. A crash between the two leaves recoverable
evidence rather than an ambiguous completed run.

#### Methods

##### tryClaim()

> **tryClaim**(`claim`): `Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

###### Parameters

###### claim

[`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

###### Returns

`Promise`\<[`AgentCandidateExecutionClaimResult`](#agentcandidateexecutionclaimresult)\>

##### getAttempt()

> **getAttempt**(`attempt`): `Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

###### Parameters

###### attempt

[`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

###### Returns

`Promise`\<[`AgentCandidateExecutionAttemptRecord`](#agentcandidateexecutionattemptrecord) \| `undefined`\>

##### markCandidateMayRun()

> **markCandidateMayRun**(`lease`): `Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

Persist the point after which candidate code may have run.

###### Parameters

###### lease

[`AgentCandidateExecutionLease`](#agentcandidateexecutionlease)

###### Returns

`Promise`\<[`AgentCandidateExecutionPhaseResult`](#agentcandidateexecutionphaseresult)\>

##### stageTerminal()

> **stageTerminal**(`lease`, `result`): `Promise`\<[`AgentCandidateExecutionStageResult`](#agentcandidateexecutionstageresult)\>

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

### InMemoryAgentCandidateExecutionClaimStoreOptions

#### Properties

##### now?

> `optional` **now?**: () => `number`

Testable evaluator clock; defaults to `Date.now`.

###### Returns

`number`

***

### DisposePreparedAgentCandidateOptions

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

***

### ExactProcessCandidateExecutorOptions

#### Properties

##### provider

> **provider**: `AgentEnvironmentProvider`

##### resources

> **resources**: `AgentExactProcessResources`

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

***

### ExecutePreparedAgentCandidateOptions

#### Properties

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](#agentcandidatebenchmarkgraderport)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

##### traceStore

> **traceStore**: `TraceStore`

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

Long-lived evaluator-owned store shared by every process that can run this benchmark.

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Maximum time to prove process death and revoke protected access after a run ends.

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Maximum time for task verification, executable grading, and receipt construction.

***

### PrepareAgentCandidateExecutionOptions

#### Properties

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Maximum time for task verification, executable grading, and receipt construction.

***

### ProtectedAgentCandidateModelGrantContext

Values available only while one protected model grant is active.

#### Properties

##### activation

> `readonly` **activation**: [`AgentCandidateProtectedModelActivation`](#agentcandidateprotectedmodelactivation)

##### reservation

> `readonly` **reservation**: [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

##### resolved

> `readonly` **resolved**: `AgentCandidateResolvedModel`

***

### RunProtectedAgentCandidateModelGrantOptions

Inputs for one protected grant scoped to one bounded caller unit.

#### Type Parameters

##### TResult

`TResult`

#### Properties

##### port

> `readonly` **port**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

Runtime port that validates and settles the evaluator-owned grant.

##### resolve

> `readonly` **resolve**: `object`

Provider-neutral model request resolved before any grant is reserved.

###### requested

> **requested**: `string`

###### harness

> **harness**: `HarnessType`

###### reasoningEffort

> **reasoningEffort**: `"medium"` \| `"none"` \| `"minimal"` \| `"low"` \| `"high"` \| `"xhigh"` \| `"ultracode"` \| `undefined`

##### reserve

> `readonly` **reserve**: [`AgentCandidateModelGrantRunReservationInput`](#agentcandidatemodelgrantrunreservationinput)

One bounded unit's immutable identity, attempt, expiry, and limits.

##### deadlineAtMs

> `readonly` **deadlineAtMs**: `number`

Must be no later than the reservation expiry.

##### execute

> `readonly` **execute**: (`context`) => `Promise`\<`TResult`\>

Execute exactly one bounded unit while the activated environment is valid.

###### Parameters

###### context

[`ProtectedAgentCandidateModelGrantContext`](#protectedagentcandidatemodelgrantcontext)

###### Returns

`Promise`\<`TResult`\>

***

### RunProtectedAgentCandidateModelGrantResult

Result and sealed settlement returned after one protected grant closes.

#### Type Parameters

##### TResult

`TResult`

#### Properties

##### value

> `readonly` **value**: `TResult`

##### resolved

> `readonly` **resolved**: `AgentCandidateResolvedModel`

##### reservation

> `readonly` **reservation**: [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

##### settlement

> `readonly` **settlement**: [`AgentCandidateProtectedModelSettlement`](#agentcandidateprotectedmodelsettlement)

***

### AgentCandidateModelGrantClient

Narrow transport contract for a service that owns scoped model credentials
and the authoritative per-call usage ledger.

An HTTP client can bind these methods to control-plane endpoints. Keeping
transport out of the runtime prevents parent credentials, endpoint paths,
and retry policy from becoming part of the portable candidate contract.

#### Methods

##### reserve()

> **reserve**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

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

#### Properties

##### client

> **client**: [`AgentCandidateModelGrantClient`](#agentcandidatemodelgrantclient)

##### resolveModel

> **resolveModel**: (`input`) => `Promise`\<`AgentCandidateResolvedModel`\>

Catalog/snapshot resolution stays separate from credential issuance.

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`"medium"` \| `"none"` \| `"minimal"` \| `"low"` \| `"high"` \| `"xhigh"` \| `"ultracode"` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### gatewayDomain

> **gatewayDomain**: `string`

The only public DNS name candidate processes may reach for inference.

##### activationEnvNames

> **activationEnvNames**: readonly `string`[]

Exact environment names the activation endpoint must return, no more or fewer.

***

### RecoverExpiredAgentCandidateOptions

#### Properties

##### attempt

> **attempt**: [`AgentCandidateExecutionAttemptRef`](#agentcandidateexecutionattemptref)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](#agentcandidateexecutionclaimstore)

##### executor

> **executor**: [`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

##### traceStore

> **traceStore**: `TraceStore`

##### ports

> **ports**: `Pick`\<[`AgentCandidateExecutionPorts`](#agentcandidateexecutionports), `"models"` \| `"memory"`\>

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

##### now?

> `optional` **now?**: () => `number`

Evaluator clock; must be the same clock used by the claim store.

###### Returns

`number`

***

### AgentCandidateArtifactPort

Reads one content-addressed object from the closed S3/IPFS locator set.

#### Extended by

- [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

***

### AgentCandidateOutputArtifactPort

Durable content-addressed evidence store controlled only by the evaluator.

#### Extends

- [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

#### Methods

##### read()

> **read**(`ref`): `Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Parameters

###### ref

`AgentCandidateArtifactRef`

###### Returns

`Promise`\<`Uint8Array`\<`ArrayBufferLike`\>\>

###### Inherited from

[`AgentCandidateArtifactPort`](#agentcandidateartifactport).[`read`](#read)

##### put()

> **put**(`input`): `Promise`\<`AgentCandidateArtifactRef`\>

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

Resolves a declared GitHub repository to an already-present local Git object store.

#### Methods

##### resolve()

> **resolve**(`repository`): `Promise`\<`string`\>

###### Parameters

###### repository

`AgentCandidateGitHubRepository`

###### Returns

`Promise`\<`string`\>

***

### AgentCandidateVerificationPorts

#### Extended by

- [`AgentCandidateExecutionPorts`](#agentcandidateexecutionports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

***

### AgentCandidateWorkspacePort

Materializes an already-verified workspace archive.

The runtime independently scans every resulting byte, mode, and path against
the signed manifest after this returns. Implementations may therefore unpack
any archive encoding, or no-op when the exact workspace is already present.

#### Methods

##### materialize()

> **materialize**(`input`): `Promise`\<`void`\>

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

#### Properties

##### source

> **source**: `"pinned-container"` \| `"evaluator-task-container"`

##### image

> **image**: `string`

##### indexDigest

> **indexDigest**: `` `sha256:${string}` ``

##### manifestDigest

> **manifestDigest**: `` `sha256:${string}` ``

##### platform

> **platform**: `AgentCandidateOciPlatform`

***

### AgentCandidateContainerPort

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<[`ResolvedAgentCandidateContainer`](#resolvedagentcandidatecontainer)\>

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

#### Methods

##### resolve()

> **resolve**(`input`): `Promise`\<`AgentCandidateResolvedModel`\>

###### Parameters

###### input

###### requested

`string`

###### harness

`HarnessType`

###### reasoningEffort

`"medium"` \| `"none"` \| `"minimal"` \| `"low"` \| `"high"` \| `"xhigh"` \| `"ultracode"` \| `undefined`

###### Returns

`Promise`\<`AgentCandidateResolvedModel`\>

##### reserveGrant()

> **reserveGrant**(`input`): `Promise`\<[`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)\>

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

#### Properties

##### preparationId

> **preparationId**: `string`

##### digest

> **digest**: `` `sha256:${string}` ``

##### expiresAtMs

> **expiresAtMs**: `number`

Evaluator service must expire and revoke this reservation at this epoch millisecond.

##### enforcedLimits

> **enforcedLimits**: [`AgentCandidateModelLimits`](#agentcandidatemodellimits)

The gateway must stop calls before any declared model limit is exceeded.

##### network

> **network**: `AgentCandidateModelAccessNetwork`

Exact public endpoint exception; every other candidate destination stays blocked.

***

### AgentCandidateProtectedModelActivation

#### Properties

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

Injected only into the trusted executor after all pre-launch checks pass.

***

### AgentCandidateProtectedModelSettlement

#### Properties

##### preparationId

> **preparationId**: `string`

##### grantDigest

> **grantDigest**: `` `sha256:${string}` ``

##### closed

> **closed**: `true`

##### usageWithinLimits

> **usageWithinLimits**: `boolean`

Router's terminal integrity result. False must never become a receipt.

##### calls

> **calls**: readonly [`AgentCandidateProtectedModelSettlementCall`](#agentcandidateprotectedmodelsettlementcall)[]

***

### AgentCandidateMemoryResetResult

#### Properties

##### preparationId

> **preparationId**: `string`

##### accessDigest

> **accessDigest**: `` `sha256:${string}` ``

##### expiresAtMs

> **expiresAtMs**: `number`

##### evidence

> **evidence**: `AgentCandidateCapturedArtifact`

##### emptyStateDigest

> **emptyStateDigest**: `` `sha256:${string}` ``

##### beforeState

> **beforeState**: `AgentCandidateWorkspaceSnapshotEvidence`

***

### AgentCandidateMemoryPort

#### Methods

##### reset()

> **reset**(`input`): `Promise`\<[`AgentCandidateMemoryResetResult`](#agentcandidatememoryresetresult)\>

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

#### Extends

- [`AgentCandidateVerificationPorts`](#agentcandidateverificationports)

#### Properties

##### artifacts

> **artifacts**: [`AgentCandidateArtifactPort`](#agentcandidateartifactport)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`artifacts`](#artifacts)

##### repositories

> **repositories**: [`AgentCandidateRepositoryPort`](#agentcandidaterepositoryport)

###### Inherited from

[`AgentCandidateVerificationPorts`](#agentcandidateverificationports).[`repositories`](#repositories)

##### workspaces

> **workspaces**: [`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

##### containers

> **containers**: [`AgentCandidateContainerPort`](#agentcandidatecontainerport)

##### models

> **models**: [`AgentCandidateModelPort`](#agentcandidatemodelport)

##### memory

> **memory**: [`AgentCandidateMemoryPort`](#agentcandidatememoryport)

***

### AgentCandidateTaskExecution

Runtime placement for one exact cell from a signed candidate experiment.

#### Properties

##### executionId

> **executionId**: `string`

##### runCell

> **runCell**: `AgentCandidateRunCell`

##### benchmarkSuite

> **benchmarkSuite**: `AgentCandidateBenchmarkSuite`

##### task

> **task**: `AgentCandidateBenchmarkTask`

##### executionRoots

> **executionRoots**: `object`

Absolute paths inside the evaluator-owned execution environment.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Host-side staging roots. These are verified but never signed as container paths.

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

***

### VerifiedAgentCandidate

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

##### materializedTree?

> `readonly` `optional` **materializedTree?**: `string`

##### \[verifiedCandidateBrand\]

> `readonly` **\[verifiedCandidateBrand\]**: `true`

***

### CanonicalCandidateDocument

#### Type Parameters

##### T

`T`

#### Properties

##### value

> `readonly` **value**: `T`

##### bytes

> `readonly` **bytes**: `Uint8Array`

Canonical UTF-8 bytes of `value` with its top-level digest omitted.

##### digest

> `readonly` **digest**: `` `sha256:${string}` ``

***

### PreparedAgentCandidateLaunch

#### Properties

##### executable

> **executable**: `string`

##### args

> **args**: readonly `string`[]

Complete fixed argv, including profile materializer flags but excluding task delivery.

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

##### flags

> **flags**: readonly `string`[]

Informational subset already present at the tail of `args`; executors must not append twice.

##### cwd

> **cwd**: `string`

***

### PreparedAgentCandidateInstruction

#### Properties

##### bytes

> **bytes**: `Uint8Array`

##### delivery

> **delivery**: `AgentCandidateInstructionDelivery`

***

### PreparedAgentCandidateKnowledge

Exact file-backed knowledge admitted by the candidate bundle.

#### Properties

##### candidate

> `readonly` **candidate**: `AgentCandidateKnowledgeRef`

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

##### retrievalConfig?

> `readonly` `optional` **retrievalConfig?**: `Uint8Array`\<`ArrayBufferLike`\>

***

### PreparedAgentCandidateTrace

#### Properties

##### runId

> **runId**: `string`

##### tags

> **tags**: `Readonly`\<`Record`\<`string`, `string`\>\>

##### env

> **env**: `Readonly`\<`Record`\<`string`, `string`\>\>

***

### PreparedAgentCandidateExecution

#### Properties

##### bundle

> `readonly` **bundle**: `AgentCandidateBundle`

##### benchmark

> `readonly` **benchmark**: `object`

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### executionId

> `readonly` **executionId**: `string`

##### roots

> `readonly` **roots**: `object`

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

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

##### executionPlan

> `readonly` **executionPlan**: `object`

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

##### \[preparedCandidateBrand\]

> `readonly` **\[preparedCandidateBrand\]**: `true`

***

### AgentCandidateProtectedRunCapture

#### Properties

##### executionId

> **executionId**: `string`

##### termination

> **termination**: `AgentCandidateTermination`

***

### AgentCandidateExecutorMemoryCapture

Raw isolated-memory capture made only after access has been revoked.

#### Properties

##### afterState

> `readonly` **afterState**: `AgentCandidateWorkspaceManifestMaterial`

##### archive

> `readonly` **archive**: `Uint8Array`

***

### AgentCandidateExecutorFinalCapture

Replayable evaluator result captured only after process death and trace drain.

#### Properties

##### taskOutcome?

> `readonly` `optional` **taskOutcome?**: [`AgentCandidateExecutorTaskOutcomeCapture`](#agentcandidateexecutortaskoutcomecapture)

##### memoryAfter?

> `readonly` `optional` **memoryAfter?**: [`AgentCandidateExecutorMemoryCapture`](#agentcandidateexecutormemorycapture)

Required only when the prepared candidate uses isolated task memory.

##### evidence?

> `readonly` `optional` **evidence?**: `Uint8Array`\<`ArrayBufferLike`\>

Executor-native bytes preserved when a fresh worker cannot reconstruct a verified outcome.

***

### AgentCandidateBenchmarkGraderPort

Evaluator-owned executable grader, pinned by immutable implementation bytes.

`run` is an isolation boundary, not an arbitrary scoring callback. The
implementation admitted to that boundary is supplied by the runtime after
artifact verification. Implementations must derive every returned binding
digest from the bytes and task outcome they actually admitted, rather than
copying an expected digest from ambient configuration.

#### Properties

##### name

> `readonly` **name**: `string`

##### version

> `readonly` **version**: `string`

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

#### Methods

##### run()

> **run**(`input`): `Promise`\<\{ `evaluation`: `BenchmarkEvaluation`; `evidence`: `Uint8Array`; `binding`: \{ `implementationDigest`: `` `sha256:${string}` ``; `taskOutcomeDigest`: `` `sha256:${string}` ``; `outputDigest`: `` `sha256:${string}` ``; \}; \}\>

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

One detached request passed to the trusted environment-specific executor.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

##### benchmark

> `readonly` **benchmark**: `object`

###### suite

> `readonly` **suite**: `AgentCandidateBenchmarkSuite`

###### task

> `readonly` **task**: `AgentCandidateBenchmarkTask`

##### inputs

> `readonly` **inputs**: `object`

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

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### profilePlan

> `readonly` **profilePlan**: `object`

###### value

> **value**: `AgentCandidateProfilePlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

###### written

> **written**: readonly `string`[]

##### profileActivation

> `readonly` **profileActivation**: `AgentCandidateProfileActivation`

##### executionPlan

> `readonly` **executionPlan**: `object`

###### value

> **value**: `AgentCandidateExecutionPlanEvidence`

###### bytes

> **bytes**: `Uint8Array`

##### materializationReceipt

> `readonly` **materializationReceipt**: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateMaterializationReceipt`\>

##### launch

> `readonly` **launch**: [`PreparedAgentCandidateLaunch`](#preparedagentcandidatelaunch)

##### instruction

> `readonly` **instruction**: [`PreparedAgentCandidateInstruction`](#preparedagentcandidateinstruction)

##### resolvedModel

> `readonly` **resolvedModel**: `AgentCandidateResolvedModel`

##### hardLimits

> `readonly` **hardLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"timeoutMs"`\>

Mechanically enforced by the runtime plus executor process-death acknowledgement.

##### observedLimits

> `readonly` **observedLimits**: `Pick`\<`AgentCandidateExecutionLimits`, `"maxSteps"`\>

Validity bound checked against protected traces; generic black-box executors cannot preempt it.

##### knowledge?

> `readonly` `optional` **knowledge?**: [`PreparedAgentCandidateKnowledge`](#preparedagentcandidateknowledge)

##### trace

> `readonly` **trace**: [`PreparedAgentCandidateTrace`](#preparedagentcandidatetrace)

##### memory

> `readonly` **memory**: `AgentCandidateEffectiveMemory`

***

### AgentCandidateExecutorPort

Executes one prepared request inside an evaluator-owned isolation boundary.

`request.launch.env` is the complete allowlisted environment, including
protected model, memory, and trace bindings. Implementations must not merge
ambient host variables into it. The returned capture deliberately contains
no candidate-authored usage or score fields.

#### Methods

##### execute()

> **execute**(`request`, `context`): `Promise`\<[`AgentCandidateProtectedRunCapture`](#agentcandidateprotectedruncapture)\>

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

Opaque process identity used for termination without re-exposing launch credentials.

#### Properties

##### executionId

> `readonly` **executionId**: `string`

##### executionPlanDigest

> `readonly` **executionPlanDigest**: `` `sha256:${string}` ``

***

### AgentCandidateExecutorWorkspaceInput

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

##### files

> `readonly` **files**: readonly [`AgentCandidateExecutorWorkspaceFile`](#agentcandidateexecutorworkspacefile)[]

***

### AgentCandidateExecutorWorkspaceFile

#### Properties

##### path

> `readonly` **path**: `string`

##### mode

> `readonly` **mode**: `number`

##### bytes

> `readonly` **bytes**: `Uint8Array`

***

### AgentCandidateExecutorProfileFile

One exact profile file supplied to an evaluator-owned executor.

#### Properties

##### path

> `readonly` **path**: `string`

##### mode

> `readonly` **mode**: `number`

##### bytes

> `readonly` **bytes**: `Uint8Array`

***

### AgentCandidateWorkspaceArchiveLimits

#### Properties

##### maxArchiveBytes

> **maxArchiveBytes**: `number`

##### maxEmbeddedArtifactBytes

> **maxEmbeddedArtifactBytes**: `number`

##### maxFiles

> **maxFiles**: `number`

##### maxFileBytes

> **maxFileBytes**: `number`

##### maxTotalFileBytes

> **maxTotalFileBytes**: `number`

##### maxPathBytes

> **maxPathBytes**: `number`

##### maxRepositoryBundleBytes

> **maxRepositoryBundleBytes**: `number`

***

### CaptureAgentCandidateWorkspaceOptions

#### Properties

##### includeRepository?

> `optional` **includeRepository?**: `boolean`

Include Git HEAD so task preparation can prove its exact commit and tree.

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

##### artifactPersistence?

> `optional` **artifactPersistence?**: `object`

Use the evaluator-owned artifact store when manifest or archive bytes should not be embedded.

###### executionId

> **executionId**: `string`

###### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

###### signal?

> `optional` **signal?**: `AbortSignal`

***

### CreateAgentCandidateWorkspacePortOptions

#### Properties

##### limits?

> `optional` **limits?**: `Partial`\<[`AgentCandidateWorkspaceArchiveLimits`](#agentcandidateworkspacearchivelimits)\>

***

### CapturedAgentCandidateWorkspace

#### Properties

##### snapshot

> `readonly` **snapshot**: `AgentCandidateWorkspaceSnapshotEvidence`

##### archive

> `readonly` **archive**: `Uint8Array`

Caller-owned bytes accepted by createAgentCandidateWorkspacePort.

***

### CircuitBreakerConfig

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

#### Properties

##### failuresToOpen

> **failuresToOpen**: `number`

##### cooldownMs

> **cooldownMs**: `number`

***

### BackendCallPolicy

#### Properties

##### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

##### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](#retrybackoff)

Backoff between attempts. Default 250ms with jitter.

##### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Custom retry classifier. Defaults to [defaultIsRetryable](#defaultisretryable).

##### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](#circuitbreakerconfig)

Circuit breaker that opens after N consecutive failures per participant.

***

### SqlAdapter

Minimal SQL driver shape. Implementations forward to whichever client the
deployment already uses; agent-runtime takes no opinion on which.

Parameter placeholders MUST be `?` (positional). All adapters listed in the
file header accept this convention.

#### Methods

##### exec()

> **exec**(`sql`, `params?`): `Promise`\<\{ `rowsAffected`: `number`; \}\>

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

Structural type matching the surface of `D1Database` we depend on, so the
SDK never imports `@cloudflare/workers-types`. Consumers pass their real
`D1Database` from `env.DB` and TS structural compatibility lines it up.

#### Methods

##### prepare()

> **prepare**(`sql`): [`D1StmtLike`](#d1stmtlike)

###### Parameters

###### sql

`string`

###### Returns

[`D1StmtLike`](#d1stmtlike)

***

### D1StmtLike

#### Methods

##### bind()

> **bind**(...`params`): [`D1StmtLike`](#d1stmtlike)

###### Parameters

###### params

...`unknown`[]

###### Returns

[`D1StmtLike`](#d1stmtlike)

##### run()

> **run**(): `Promise`\<`unknown`\>

###### Returns

`Promise`\<`unknown`\>

##### all()

> **all**\<`TRow`\>(): `Promise`\<\{ `results?`: `TRow`[]; \}\>

###### Type Parameters

###### TRow

`TRow` = `unknown`

###### Returns

`Promise`\<\{ `results?`: `TRow`[]; \}\>

***

### ConversationJournalEntry

#### Properties

##### runId

> **runId**: `string`

##### startedAt

> **startedAt**: `string`

##### halted?

> `optional` **halted?**: [`HaltReason`](#haltreason)

Set when the run reaches a terminal state.

##### endedAt?

> `optional` **endedAt?**: `string`

##### turns

> **turns**: [`ConversationTurn`](#conversationturn)[]

***

### ConversationJournal

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

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

#### Properties

##### worker

> **worker**: `AgentProfile`

The agent under test. Metered; its rendered prompt leads its turns.

##### persona

> **persona**: [`PersonaDriver`](#personadriver)

The simulated user driving the dialogue.

##### executorFor

> **executorFor**: (`profile`, `role`) => [`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

Resolve transport/executable ports for the exact profile. Runtime still materializes the
profile and owns every model call. Applied to the worker and a profile-driven persona.

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

##### maxTurns?

> `optional` **maxTurns?**: `number`

Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
 (worker answers each user turn). REQUIRED for a `profile` persona.

##### seed?

> `optional` **seed?**: `string`

Kickoff message routed to the first speaker (the persona). Default 'Begin.'

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
 hard ceiling; this is the early stop (the persona declares the goal met / unreachable).

##### signal?

> `optional` **signal?**: `AbortSignal`

##### workerName?

> `optional` **workerName?**: `string`

Worker participant / transcript speaker label. Default 'agent'.

***

### PersonaConversationResult

#### Properties

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

##### turns

> **turns**: `number`

##### halted

> **halted**: [`HaltReason`](#haltreason)

##### costUsd

> **costUsd**: `number`

Worker-only spend (the side under test).

##### tokensIn

> **tokensIn**: `number`

##### tokensOut

> **tokensOut**: `number`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

Absent means every worker call reported complete token usage.

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

Absent means every worker call reported provider-billed cost, including a known zero.

***

### RunPersonaConfig

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### executorFor

> **executorFor**: (`profile`, `role`) => [`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

Resolve transport/executable ports for each exact profile.

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

##### personaOf

> **personaOf**: (`scenario`) => [`PersonaDriver`](#personadriver)

The persona driving each scenario — a driver profile or scripted turns.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`PersonaDriver`](#personadriver)

##### artifactOf

> **artifactOf**: (`transcript`, `scenario`) => `TArtifact`

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

Speaker-turn cap (required when a persona is profile-driven).

###### Parameters

###### scenario

`TScenario`

###### Returns

`number`

##### seed?

> `optional` **seed?**: (`scenario`) => `string`

###### Parameters

###### scenario

`TScenario`

###### Returns

`string`

##### workerName?

> `optional` **workerName?**: `string`

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`worker`, `scenario`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for the whole worker conversation.
Required before execution when the enclosing campaign is cost-capped.

***

### ConversationParticipant

**`Stable`**

#### Properties

##### name

> **name**: `string`

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so an iterable,
sandbox, or profile-backed Runtime executor works through the same runner.

##### label?

> `optional` **label?**: `string`

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

##### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

##### authSource?

> `optional` **authSource?**: [`AuthSource`](#authsource-1)

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

The agent's own credentials live on its caller-owned backend or
profile-bound Runtime executor; this field is purely about *whether to
also forward the user's identity downstream*.

***

### ConversationDriveState

**`Stable`**

#### Extended by

- [`HaltContext`](#haltcontext)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

##### turnIndex

> **turnIndex**: `number`

##### spentCreditsCents

> **spentCreditsCents**: `number`

***

### HaltContext

**`Stable`**

#### Extends

- [`ConversationDriveState`](#conversationdrivestate)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`transcript`](#transcript-1)

##### turnIndex

> **turnIndex**: `number`

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`turnIndex`](#turnindex)

##### spentCreditsCents

> **spentCreditsCents**: `number`

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`spentCreditsCents`](#spentcreditscents)

##### lastTurn

> **lastTurn**: [`ConversationTurn`](#conversationturn)

***

### HaltSignal

**`Stable`**

#### Properties

##### halted

> **halted**: `true`

##### reason

> **reason**: `string`

***

### ConversationPolicy

**`Stable`**

#### Properties

##### maxTurns

> **maxTurns**: `number`

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

##### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

##### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](#turnorder)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

##### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.

***

### ConversationTurn

**`Stable`**

#### Properties

##### index

> **index**: `number`

##### speaker

> **speaker**: `string`

##### turnId

> **turnId**: `string`

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

##### sessionId?

> `optional` **sessionId?**: `string`

Backend session used for this turn. Present on turns recorded by session-aware runners.

##### text

> **text**: `string`

##### usage?

> `optional` **usage?**: `object`

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

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

##### startedAt

> **startedAt**: `string`

##### endedAt

> **endedAt**: `string`

***

### Conversation

**`Stable`**

#### Properties

##### participants

> **participants**: readonly [`ConversationParticipant`](#conversationparticipant)[]

##### policy

> **policy**: [`ConversationPolicy`](#conversationpolicy)

***

### RunConversationOptions

**`Stable`**

#### Properties

##### seed

> **seed**: `string`

First message kicking off the conversation. Routes to the first speaker.

##### runId?

> `optional` **runId?**: `string`

Optional run identifier for cross-participant trace correlation. Auto-
generated when omitted. Reusing a runId against the same `journal`
resumes the prior run — the runner replays the persisted transcript and
continues from the first un-recorded turn.

##### signal?

> `optional` **signal?**: `AbortSignal`

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

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

Optional durable transcript. When set, the runner persists every
committed turn before yielding `turn_end`. Reusing the same `runId`
against the same journal resumes from the last committed turn — so a
driver process crash mid-run loses zero acknowledged turns.

##### sessionStore?

> `optional` **sessionStore?**: [`RuntimeSessionStore`](#runtimesessionstore)

Stores each participant's backend session. The runner keeps an in-memory
store for one invocation when omitted. Reuse a durable store with the same
`runId` and journal after a process restart. Backends implementing `resume`
continue their provider session; other backends receive the full transcript.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

##### inboundDepth?

> `optional` **inboundDepth?**: `number`

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_DEPTH`. Default 0 (origin caller).

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.

***

### ConversationResult

**`Stable`**

#### Properties

##### runId

> **runId**: `string`

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

##### turns

> **turns**: `number`

##### spentCreditsCents

> **spentCreditsCents**: `number`

##### halted

> **halted**: [`HaltReason`](#haltreason)

##### durationMs

> **durationMs**: `number`

##### startedAt

> **startedAt**: `string`

##### endedAt

> **endedAt**: `string`

***

### VerifyResult

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

#### Properties

##### ok

> **ok**: `boolean`

##### feedback?

> `optional` **feedback?**: `string`

***

### AgenticGeneratorShotReceipt

`@tangle-network/agent-runtime` improvement.

The public entry point is `improve()`. Complete agent-eval methods optimize
profile surfaces. Runtime owns only code candidates that mutate an isolated
git worktree through a pluggable `CandidateGenerator`.

#### Properties

##### generation

> `readonly` **generation**: `number` \| `null`

##### candidateIndex

> `readonly` **candidateIndex**: `number` \| `null`

##### shot

> `readonly` **shot**: `number`

One-based shot number within this candidate.

##### maxShots

> `readonly` **maxShots**: `number`

##### profileDigest

> `readonly` **profileDigest**: `string`

Exact profile identity admitted before the shot.

##### harness

> `readonly` **harness**: `HarnessType`

##### provider

> `readonly` **provider**: `string`

##### model

> `readonly` **model**: `string`

##### reasoningEffort

> `readonly` **reasoningEffort**: `"medium"` \| `"none"` \| `"minimal"` \| `"low"` \| `"high"` \| `"xhigh"` \| `"ultracode"` \| `null`

##### promptSha256

> `readonly` **promptSha256**: `` `sha256:${string}` ``

##### startedAt

> `readonly` **startedAt**: `string`

##### completedAt

> `readonly` **completedAt**: `string`

##### durationMs

> `readonly` **durationMs**: `number`

##### status

> `readonly` **status**: [`AgentTaskStatus`](#agenttaskstatus) \| `null`

##### usage

> `readonly` **usage**: `Readonly`\<[`AgentTurnUsage`](runtime.md#agentturnusage)\> \| `null`

Runtime-normalized usage. Unknown token or dollar totals remain marked unknown.

##### transportAttempts

> `readonly` **transportAttempts**: `number` \| `null`

##### costCallId

> `readonly` **costCallId**: `string` \| `null`

Shared run-ledger call id for this exact shot.

##### costBasis

> `readonly` **costBasis**: `"unknown"` \| `"provider-reported"` \| `"estimated-pricing"`

Whether dollars came from the provider, the pricing table, or are unknown.

##### costUsd

> `readonly` **costUsd**: `number` \| `null`

##### costUsdKnown

> `readonly` **costUsdKnown**: `boolean`

True only for a provider-reported amount, never for a pricing estimate.

##### error

> `readonly` **error**: \{ `name`: `string`; `message`: `string`; \} \| `null`

***

### AgenticGeneratorOptions

`@tangle-network/agent-runtime` improvement.

The public entry point is `improve()`. Complete agent-eval methods optimize
profile surfaces. Runtime owns only code candidates that mutate an isolated
git worktree through a pluggable `CandidateGenerator`.

#### Properties

##### profile

> **profile**: `AgentProfile`

Complete author identity. Harness, provider, model, prompt, tools, and resources all come from here.

##### executorForWorktree

> **executorForWorktree**: [`AgenticGeneratorExecutorForWorktree`](#agenticgeneratorexecutorforworktree)

Place the exact profile on compute that can edit this existing worktree.
A Pi author normally returns `{ backend:'bridge', cwd: worktreePath, ...transport }`.

##### onShotCompleted?

> `optional` **onShotCompleted?**: (`receipt`, `execution`) => `void` \| `Promise`\<`void`\>

Awaited once for every attempted author shot, including execution failures.
The second argument is Runtime's exact terminal turn and event stream.
Throwing aborts the candidate so evidence persistence fails closed.

###### Parameters

###### receipt

[`AgenticGeneratorShotReceipt`](#agenticgeneratorshotreceipt)

###### execution

`Readonly`\<[`CollectedAgentTurn`](runtime.md#collectedagentturn)\> \| `null`

###### Returns

`void` \| `Promise`\<`void`\>

##### onShotDisposition?

> `optional` **onShotDisposition?**: (`receipt`, `disposition`) => `void` \| `Promise`\<`void`\>

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

Optional hard upper bound passed to the run-wide CostLedger before each author shot.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline.

##### buildPrompt

> **buildPrompt**: (`args`) => `string`

Build the task prompt from proposal findings. Required: Runtime invents no authoring policy.

###### Parameters

###### args

###### findings

readonly `ProposalFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted means the first dirty
 shot is the candidate. See `commandVerifier`.

##### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### BuildPromptFindingsInput

Evidence supplied to a generated tool or MCP build instruction.

#### Properties

##### findings

> **findings**: readonly `ProposalFinding`[]

***

### ImproveMethodContext

#### Properties

##### profile

> `readonly` **profile**: `object`

Validated baseline profile.

##### evaluationRef

> `readonly` **evaluationRef**: `` `sha256:${string}` ``

Runtime-derived identity for upstream optimizer resume state.

##### surface

> `readonly` **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Exact profile coordinate being optimized.

##### baselineSurface

> `readonly` **baselineSurface**: `MutableSurface`

Exact bytes supplied to the optimization method.

##### baselineValue

> `readonly` **baselineValue**: `unknown`

Structured value represented by `baselineSurface`, before serialization.

##### findings

> `readonly` **findings**: readonly `ProposalFinding`[]

Findings produced before this search, if any.

***

### ImproveCandidateValidationInput

Exact materialized profile presented for validation before any candidate run.

#### Extended by

- [`OfficialSensitiveCandidateInput`](#officialsensitivecandidateinput)

#### Properties

##### profile

> **profile**: `object`

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

##### candidateSurface

> **candidateSurface**: `MutableSurface`

##### value

> **value**: `unknown`

##### isBaseline

> **isBaseline**: `boolean`

***

### ImproveSkillsOptions

#### Properties

##### resourceName

> **resourceName**: `string`

`name` of one inline entry in `profile.resources.skills`.

***

### ImproveProfileComponents

Caller-owned mapping for optimizing several profile fields as one candidate.

#### Methods

##### read()

> **read**(`profile`): `Readonly`\<`Record`\<`string`, `string`\>\>

Extract the exact named text components optimized together.

###### Parameters

###### profile

###### Returns

`Readonly`\<`Record`\<`string`, `string`\>\>

##### apply()

> **apply**(`profile`, `components`): `object`

Apply a complete winning component map to a detached profile.

###### Parameters

###### profile

###### components

`Readonly`\<`Record`\<`string`, `string`\>\>

###### Returns

`object`

***

### ImproveCodeBaseOptions

#### Properties

##### repoRoot

> **repoRoot**: `string`

Repo root candidate worktrees fork from.

##### baseRef?

> `optional` **baseRef?**: `string`

Base ref candidates fork from. Default `main`.

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Directory worktrees are created under. Default `<repoRoot>/.worktrees`.

##### worktree?

> `optional` **worktree?**: `WorktreeAdapter`

Git-compatible adapter override, primarily for tests. Candidate advancement
still requires normal Git worktree and commit semantics.

##### profile

> **profile**: `AgentProfile`

Complete identity of the code author. No execution field may be filled from ambient defaults.

***

### ImproveRuntimeCodeGeneratorOptions

#### Properties

##### executorForWorktree

> **executorForWorktree**: [`AgenticGeneratorExecutorForWorktree`](#agenticgeneratorexecutorforworktree)

Place the exact author profile on compute that can edit the supplied worktree.

##### buildPrompt

> **buildPrompt**: (`args`) => `string`

Author the task from admitted findings. Required: Runtime invents no code-improvement prompt.

###### Parameters

###### args

###### findings

readonly `ProposalFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Verify a candidate worktree before it becomes a measurable surface; failures
feed the next shot (see `agenticGenerator.verify` / `commandVerifier`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge`

Optional provider-enforced maximum admitted by the run-wide cost ledger.

##### generator?

> `optional` **generator?**: `undefined`

***

### ImproveCustomCodeGeneratorOptions

#### Properties

##### generator

> **generator**: [`CandidateGenerator`](#candidategenerator)

Complete byte-producer replacement. Runtime still validates `profile` before creating worktrees.

##### executorForWorktree?

> `optional` **executorForWorktree?**: `undefined`

##### buildPrompt?

> `optional` **buildPrompt?**: `undefined`

##### verify?

> `optional` **verify?**: `undefined`

##### timeoutMs?

> `optional` **timeoutMs?**: `undefined`

##### maximumCharge?

> `optional` **maximumCharge?**: `undefined`

***

### ImprovementProfileCandidate

#### Properties

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Surface searched by this run.

##### value

> **value**: `MutableSurface`

Exact winning value returned by agent-eval.

##### profile

> **profile**: `object`

Exact complete profile instance measured on the final cases.

***

### ImprovementProfilePopulationArtifactSource

Digest-addressed Eval artifact.

#### Properties

##### path

> **path**: `string`

##### sha256

> **sha256**: `` `sha256:${string}` ``

***

### ImprovementProfilePopulationObservationSource

Exact callback observation that introduced one optimizer candidate.

#### Properties

##### proposalSequence

> **proposalSequence**: `number`

One-based JSONL line sequence in the verified observation artifact.

##### artifact

> **artifact**: [`ImprovementProfilePopulationArtifactSource`](#improvementprofilepopulationartifactsource)

***

### ImprovementProfilePopulationLineageNode

One exact node from GEPA's accepted candidate graph.

#### Properties

##### index

> **index**: `number`

##### parentIndices

> **parentIndices**: readonly (`number` \| `null`)[]

##### aggregateScore

> **aggregateScore**: `number` \| `null`

##### selectionScores

> **selectionScores**: readonly `object`[]

##### discoveryEvaluationCount

> **discoveryEvaluationCount**: `number`

***

### ImprovementProfilePopulationCandidateSource

Every verified source associated with one unique optimizer candidate.

#### Properties

##### candidateDigest

> **candidateDigest**: `` `sha256:${string}` ``

Eval identity of the external text or component candidate.

##### observation?

> `optional` **observation?**: [`ImprovementProfilePopulationObservationSource`](#improvementprofilepopulationobservationsource)

Present when the candidate crossed the evaluation callback.

##### lineage

> **lineage**: [`ImprovementProfilePopulationLineage`](#improvementprofilepopulationlineage)

Exact GEPA parents and scores, or an explicit statement that none were reported.

***

### ImprovementMaterializedProfilePopulationCandidate

A verified optimizer candidate that Runtime can express as an exact profile.

#### Properties

##### status

> **status**: `"materialized"`

##### source

> **source**: [`ImprovementProfilePopulationCandidateSource`](#improvementprofilepopulationcandidatesource)

##### value

> **value**: `MutableSurface`

Exact optimizer surface decoded by Eval.

##### surfaceDigest

> **surfaceDigest**: `` `sha256:${string}` ``

Interface identity of `value`.

##### profile

> **profile**: `object`

Exact complete profile produced by Runtime's configured materializer.

##### profileDigest

> **profileDigest**: `` `sha256:${string}` ``

Interface identity of `profile`.

##### diffs

> **diffs**: readonly `AgentProfileDiff`[]

Ordered Interface diffs that reproduce `profile` from the baseline.

##### diffDigests

> **diffDigests**: readonly `` `sha256:${string}` ``[]

Interface identity of each entry in `diffs`.

***

### ImprovementRefusedProfilePopulationCandidate

A verified optimizer candidate that Runtime refused to materialize.

#### Properties

##### status

> **status**: `"refused"`

##### source

> **source**: [`ImprovementProfilePopulationCandidateSource`](#improvementprofilepopulationcandidatesource)

##### value

> **value**: `MutableSurface`

Exact optimizer surface decoded by Eval.

##### surfaceDigest

> **surfaceDigest**: `` `sha256:${string}` ``

Interface identity of `value`.

##### error

> **error**: `object`

###### name

> **name**: `string`

###### message

> **message**: `string`

***

### ImprovementProfileCandidatePopulationAvailable

Complete verified population reported by one optimizer run.

#### Properties

##### status

> **status**: `"available"`

##### source

> **source**: `object`

###### observations?

> `optional` **observations?**: [`ImprovementProfilePopulationArtifactSource`](#improvementprofilepopulationartifactsource)

###### gepaCandidateGraph?

> `optional` **gepaCandidateGraph?**: [`ImprovementProfilePopulationArtifactSource`](#improvementprofilepopulationartifactsource) & `object`

###### Type Declaration

###### bestIndex

> **bestIndex**: `number`

##### uniqueCandidates

> **uniqueCandidates**: `number`

Distinct candidate surfaces across all verified source artifacts.

##### observedCandidates

> **observedCandidates**: `number`

Distinct candidate surfaces submitted through the evaluation callback.

##### gepaCandidateNodes

> **gepaCandidateNodes**: `number`

Exact GEPA graph nodes. Multiple nodes can have the same candidate surface.

##### materializedCandidates

> **materializedCandidates**: `number`

##### refusedCandidates

> **refusedCandidates**: `number`

##### candidates

> **candidates**: readonly [`ImprovementProfilePopulationCandidate`](#improvementprofilepopulationcandidate)[]

***

### ImprovementProfileCandidatePopulationUnavailable

Explicit absence for methods that do not report candidate population evidence.

#### Properties

##### status

> **status**: `"unavailable"`

##### reason

> **reason**: `"method-did-not-report-candidate-population"`

***

### ImprovementCodeCandidate

#### Properties

##### surface

> **surface**: `"code"`

##### value

> **value**: `MutableSurface`

##### profile?

> `optional` **profile?**: `undefined`

***

### ImproveCost

Normalized spend reported for one Runtime improvement run.

#### Properties

##### totalCostUsd

> **totalCostUsd**: `number`

##### accountingComplete

> **accountingComplete**: `boolean`

##### incompleteReasons

> **incompleteReasons**: `string`[]

***

### ImproveScenarioPartitions

Redacted task evidence retained for every optimizer-visible partition.

#### Properties

##### train

> **train**: readonly `CampaignScenarioIdentity`[]

##### selection

> **selection**: readonly `CampaignScenarioIdentity`[]

##### finalTest

> **finalTest**: readonly `CampaignScenarioIdentity`[]

##### optimizationReps

> **optimizationReps**: `number`

##### finalTestReps

> **finalTestReps**: `number`

***

### ImproveLineage

Optimizer ancestry sealed into downstream candidate experiments.

#### Extended by

- [`ImproveMethodLineage`](#improvemethodlineage)

#### Properties

##### invocationId

> **invocationId**: `string`

Unique Runtime invocation used to isolate this run's cost receipts.

##### runId

> **runId**: `string`

Upstream optimizer run when reported, otherwise this Runtime optimization invocation.

##### developmentSplitDigest

> **developmentSplitDigest**: `` `sha256:${string}` ``

Exact train-plus-selection scenario payloads exposed to candidate selection.

##### finalTestSplitDigest?

> `optional` **finalTestSplitDigest?**: `` `sha256:${string}` ``

Exact final-test scenario payloads measured after candidate selection.

##### scenarioPartitions?

> `optional` **scenarioPartitions?**: [`ImproveScenarioPartitions`](#improvescenariopartitions)

Redacted identities for all task partitions used by a method optimizer.

##### executionRef?

> `optional` **executionRef?**: `` `sha256:${string}` ``

Complete callback, materializer, model, tool, and closure identity for a profile run.

##### baselineProfileDigest?

> `optional` **baselineProfileDigest?**: `` `sha256:${string}` ``

Complete baseline profile identity for a profile run.

***

### ImproveMethodLineage

Method optimization always retains every identity needed to reject task reuse.

#### Extends

- [`ImproveLineage`](#improvelineage)

#### Properties

##### invocationId

> **invocationId**: `string`

Unique Runtime invocation used to isolate this run's cost receipts.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`invocationId`](#invocationid)

##### runId

> **runId**: `string`

Upstream optimizer run when reported, otherwise this Runtime optimization invocation.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`runId`](#runid-5)

##### developmentSplitDigest

> **developmentSplitDigest**: `` `sha256:${string}` ``

Exact train-plus-selection scenario payloads exposed to candidate selection.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`developmentSplitDigest`](#developmentsplitdigest)

##### finalTestSplitDigest

> **finalTestSplitDigest**: `` `sha256:${string}` ``

Exact final-test scenario payloads measured after candidate selection.

###### Overrides

[`ImproveLineage`](#improvelineage).[`finalTestSplitDigest`](#finaltestsplitdigest)

##### scenarioPartitions

> **scenarioPartitions**: [`ImproveScenarioPartitions`](#improvescenariopartitions)

Redacted identities for all task partitions used by a method optimizer.

###### Overrides

[`ImproveLineage`](#improvelineage).[`scenarioPartitions`](#scenariopartitions)

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

Complete callback, materializer, model, tool, and closure identity for a profile run.

###### Overrides

[`ImproveLineage`](#improvelineage).[`executionRef`](#executionref)

##### baselineProfileDigest

> **baselineProfileDigest**: `` `sha256:${string}` ``

Complete baseline profile identity for a profile run.

###### Overrides

[`ImproveLineage`](#improvelineage).[`baselineProfileDigest`](#baselineprofiledigest)

***

### ImproveMethodResult

#### Extends

- `ImproveResultBase`\<[`ImprovementProfileCandidate`](#improvementprofilecandidate)\>

#### Properties

##### candidate

> **candidate**: [`ImprovementProfileCandidate`](#improvementprofilecandidate)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Full search and final-test spend.

###### Inherited from

`ImproveResultBase.cost`

##### durationMs

> **durationMs**: `number`

Full wall-clock duration.

###### Inherited from

`ImproveResultBase.durationMs`

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Number of generations explored by Runtime's code path.

###### Inherited from

`ImproveResultBase.generationsExplored`

##### mode

> **mode**: `"method"`

##### method

> **method**: `string`

##### lineage

> **lineage**: [`ImproveMethodLineage`](#improvemethodlineage)

Optimizer ancestry used when sealing a candidate experiment.

###### Overrides

`ImproveResultBase.lineage`

##### provenance?

> `optional` **provenance?**: `OptimizationMethodProvenance`

External optimizer package and resumable run identity, when reported.

##### decision

> **decision**: `"ship"` \| `"hold"`

Final-test decision for this search result.

###### Overrides

`ImproveResultBase.decision`

##### lift

> **lift**: `number`

Final-test lift when one was measured.

###### Overrides

`ImproveResultBase.lift`

##### liftInterval

> **liftInterval**: `object`

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Overrides

`ImproveResultBase.liftInterval`

##### candidatePopulation

> **candidatePopulation**: [`ImprovementProfileCandidatePopulation`](#improvementprofilecandidatepopulation)

Every distinct verified candidate, including explicit materialization refusals.

##### raw

> **raw**: `OptimizationMethodComparison`

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### ImproveCodeResult

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

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### decision

> **decision**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Final-test decision for this search result.

###### Inherited from

`ImproveResultBase.decision`

##### lift?

> `optional` **lift?**: `number`

Final-test lift when one was measured.

###### Inherited from

`ImproveResultBase.lift`

##### liftInterval?

> `optional` **liftInterval?**: `object`

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Inherited from

`ImproveResultBase.liftInterval`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Full search and final-test spend.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`cost`](#cost)

##### durationMs

> **durationMs**: `number`

Full wall-clock duration.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`durationMs`](#durationms-2)

##### lineage

> **lineage**: [`ImproveLineage`](#improvelineage)

Optimizer ancestry used when sealing a candidate experiment.

###### Inherited from

`ImproveResultBase.lineage`

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Number of generations explored by Runtime's code path.

###### Inherited from

[`ImproveMethodResult`](#improvemethodresult).[`generationsExplored`](#generationsexplored)

##### mode

> **mode**: `"code"`

##### raw

> **raw**: `SelfImproveResult`\<`TScenario`, `TArtifact`\>

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### CandidateGenerator

The byte-producing path that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

##### proposesWithoutFindings?

> `optional` **proposesWithoutFindings?**: `boolean`

Whether this generator can produce a candidate from an empty findings set
 because it draws its change signal from the repo and raw traces on disk.
 An agentic coder (`agenticGenerator`) sets this so it still runs the full
 `populationSize` when the distiller yielded nothing. A patch-applier
 (`reflectiveGenerator`) leaves it unset — with no findings there is no
 patch to draft, so the driver short-circuits rather than spin up worktrees
 for a guaranteed no-op. Default `false`.

#### Methods

##### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; `label?`: `string`; `rationale?`: `string`; \}\>

###### Parameters

###### args

###### worktreePath

`string`

The candidate worktree — a clean checkout of the current incumbent.

###### findings

readonly `ProposalFinding`[]

Search or production findings explicitly admitted for proposal use.

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

#### Properties

##### command

> **command**: `string`

Command that starts the built MCP server in the worktree (stdio transport).

##### args?

> `optional` **args?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Extra env for the server process (merged over `process.env`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Handshake timeout (ms). Default 30s.

##### minTools?

> `optional` **minTools?**: `number`

Minimum tools the server must expose to pass. Default 1.

***

### OfficialOptimizerContextOptions

Runtime context appended to an official optimizer's own configuration.

#### Properties

##### background?

> `optional` **background?**: `string`

Context supplied to the optimizer before Runtime appends the profile surface and findings.

##### includeFindings?

> `optional` **includeFindings?**: `boolean`

Include current trace or analyst findings in the optimizer background. Default true.

##### maxFindingsChars?

> `optional` **maxFindingsChars?**: `number`

Reject oversized serialized findings before starting Python. Default 50,000 characters.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](intelligence.md#redactor)

Redact caller-supplied context and descriptors before they leave Runtime.
The built-in redactor is the default. Pass `false` only for public data
that has already been reviewed.

##### authorizeSensitiveCandidate?

> `optional` **authorizeSensitiveCandidate?**: (`input`) => `boolean`

Authorize one exact candidate containing structurally sensitive fields.
The callback must return true for every accepted baseline and candidate.

###### Parameters

###### input

[`OfficialSensitiveCandidateInput`](#officialsensitivecandidateinput)

###### Returns

`boolean`

***

### OfficialSensitiveCandidateInput

Exact materialized profile presented for validation before any candidate run.

#### Extends

- [`ImproveCandidateValidationInput`](#improvecandidatevalidationinput)

#### Properties

##### profile

> **profile**: `object`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`profile`](#profile-3)

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`surface`](#surface-2)

##### candidateSurface

> **candidateSurface**: `MutableSurface`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`candidateSurface`](#candidatesurface)

##### value

> **value**: `unknown`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`value`](#value-2)

##### isBaseline

> **isBaseline**: `boolean`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`isBaseline`](#isbaseline)

##### sensitivePaths

> **sensitivePaths**: readonly `string`[]

***

### CreateProfileImprovementHarnessOptions

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> **profile**: `AgentProfile`

Exact baseline profile. It is parsed, detached, and frozen at construction.

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

Immutable identity of the bound executor, models, tools, component mapping,
and every closure or external setting that can change measured behavior.

##### agent

> **agent**: [`ImproveProfileAgent`](#improveprofileagent)\<`TScenario`, `TArtifact`\>

Execute one exact materialized profile on one scenario.

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Optional validator shared by every run from this harness.

***

### ProfileImprovementHarness

A small, reusable front door over `improve(profile, options)`.

The harness freezes the baseline and binds execution identity once, which
removes the two easiest sources of accidental experiment drift when a
developer runs several methods, surfaces, or held-out suites against the
same agent. It does not replace or narrow `improve`; callers retain every
method option and may still use the lower-level API directly.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> `readonly` **profile**: `object`

Detached immutable baseline actually used by every run.

##### profileDigest

> `readonly` **profileDigest**: `` `sha256:${string}` ``

Canonical digest of the bound baseline profile.

##### executionRef

> `readonly` **executionRef**: `` `sha256:${string}` ``

Exact execution identity bound at construction.

#### Methods

##### run()

> **run**(`options`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

###### Parameters

###### options

[`ProfileImprovementHarnessRunOptions`](#profileimprovementharnessrunoptions)\<`TScenario`, `TArtifact`\>

###### Returns

`Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

***

### RawTraceDistillerOptions

#### Properties

##### runDir?

> `optional` **runDir?**: `string`

Anchor the emitted paths at this run root instead of the generation `runDir`
 the loop passes in. Normally unset — each call points at that generation's
 own directory (`input.runDir`). Pass an absolute path when you construct the
 producer ahead of the loop and want a fixed anchor (e.g. a test fixture).

##### maxCandidates?

> `optional` **maxCandidates?**: `number`

Max candidates to surface trace paths for, worst-scoring first. Default 12.

##### maxCellsPerCandidate?

> `optional` **maxCellsPerCandidate?**: `number`

Max failing cells to enumerate per candidate before collapsing the rest into
 an "ls the candidate dir" pointer. Default 8.

##### maxFilesPerCell?

> `optional` **maxFilesPerCell?**: `number`

Max concrete file paths to list per cell (the agent can always `ls` the dir
 for the rest). Default 24.

##### fallbackFindings?

> `optional` **fallbackFindings?**: readonly `ProposalFinding`[]

Findings to fall back to when the generation had NO failing cells, so a
 clean round never wipes the proposer's steering context. Mirrors the default
 distiller's static-seed fallback. Default: a single instruction finding.

***

### ReflectiveGeneratorOptions

#### Properties

##### improvementProposalSource

> **improvementProposalSource**: [`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

***

### CreateKnowledgeImprovementActivationExecutorOptions

#### Extends

- `Omit`\<`PromoteKnowledgeCandidateOptions`, `"root"` \| `"candidate"`\>

#### Properties

##### root

> **root**: `string`

##### identity

> **identity**: `string`

##### results

> **results**: [`AgentImprovementActivationResultStore`](intelligence.md#agentimprovementactivationresultstore)

***

### KnowledgeImprovementActivationExecutor

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](intelligence.md#agentimprovementactivationtransition)

##### reconcile

> **reconcile**: [`AgentImprovementActivationReconciliation`](intelligence.md#agentimprovementactivationreconciliation)

***

### RunKnowledgeImprovementJobOptions

#### Extends

- `Omit`\<`KnowledgeImprovementOptions`, `"updateKnowledge"`\>

#### Properties

##### budget

> **budget**: [`Budget`](#budget-4)

##### readinessCheck?

> `optional` **readinessCheck?**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

##### supervisorProfile

> **supervisorProfile**: `AgentProfile`

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"budget"` \| `"backend"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

###### Parameters

###### profile

`AgentProfile`

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

##### candidateArtifacts?

> `optional` **candidateArtifacts?**: [`AgentCandidateOutputArtifactPort`](#agentcandidateoutputartifactport)

##### onMeasurement?

> `optional` **onMeasurement?**: (`measurement`) => `void` \| `Promise`\<`void`\>

###### Parameters

###### measurement

[`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

###### Returns

`void` \| `Promise`\<`void`\>

***

### KnowledgeImprovementJobMeasurement

#### Properties

##### startedAt

> **startedAt**: `string`

##### finishedAt

> **finishedAt**: `string`

##### durationMs

> **durationMs**: `number`

##### updateCalls

> **updateCalls**: `number`

##### updateDurationMs

> **updateDurationMs**: `number`

##### supervisedSpent

> **supervisedSpent**: `object`

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

#### Properties

##### improvement

> **improvement**: `KnowledgeImprovementResult`

##### knowledge?

> `optional` **knowledge?**: [`KnowledgeImprovementCandidatePair`](#knowledgeimprovementcandidatepair)

##### measurement

> **measurement**: [`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

##### blocked

> **blocked**: `boolean`

***

### KnowledgeImprovementCandidatePair

#### Properties

##### reference

> **reference**: `AgentCandidateKnowledgeRef`

##### evaluation

> **evaluation**: `AgentCandidateCapturedArtifact`

##### baseline

> **baseline**: `AgentCandidateWorkspaceSnapshotEvidence`

##### candidate

> **candidate**: `AgentCandidateWorkspaceSnapshotEvidence`

***

### KnowledgeImprovementExperimentBundles

#### Properties

##### baseline

> **baseline**: `AgentCandidateBundle`

##### candidate

> **candidate**: `AgentCandidateBundle`

***

### AgentKnowledgeReadinessCheckOptions

#### Properties

##### goal

> **goal**: `string`

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `KnowledgeReadinessSpec`[]

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

##### readiness?

> `optional` **readiness?**: `Omit`\<`BuildEvalKnowledgeBundleOptions`, `"taskId"` \| `"index"` \| `"specs"`\>

##### strict?

> `optional` **strict?**: `boolean`

##### kbQuality?

> `optional` **kbQuality?**: `KnowledgeBaseQualityOptions`

***

### KnowledgeReadinessCheckInput

#### Properties

##### root

> **root**: `string`

##### goal

> **goal**: `string`

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

##### readiness?

> `optional` **readiness?**: `unknown`

***

### SupervisedKnowledgeUpdateInput

#### Properties

##### goal?

> `optional` **goal?**: `string`

##### root?

> `optional` **root?**: `string`

##### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### findings?

> `optional` **findings?**: readonly `unknown`[]

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### SupervisedKnowledgeUpdateResult

#### Properties

##### applied

> **applied**: `boolean`

##### summary

> **summary**: `string`

##### supervised

> **supervised**: [`SupervisedResult`](#supervisedresult)\<`unknown`\>

##### metadata

> **metadata**: `NonNullable`\<`RagKnowledgeUpdateResult`\[`"metadata"`\]\>

***

### SupervisedKnowledgeUpdateOptions

#### Properties

##### root

> **root**: `string`

##### goal

> **goal**: `string`

##### readiness

> **readiness**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

##### readinessOptions?

> `optional` **readinessOptions?**: `unknown`

##### findings?

> `optional` **findings?**: readonly `unknown`[]

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

##### budget

> **budget**: [`Budget`](#budget-4)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

##### supervisorProfile

> **supervisorProfile**: `AgentProfile`

Caller-owned exact supervisor harness/provider/model identity.

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"budget"` \| `"backend"` \| `"makeWorkerAgent"` \| `"deliverable"` \| `"allowedModels"`\>\>

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

###### Parameters

###### profile

`AgentProfile`

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

***

### DelegatedLoopResult

**`Experimental`**

Uniform result — never throws from a registered runner; a
 thrown engine becomes `{ ok: false, error }` so a routine can record + move on.

#### Type Parameters

##### T

`T` = `unknown`

#### Properties

##### mode

> **mode**: `"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

**`Experimental`**

##### ok

> **ok**: `boolean`

**`Experimental`**

##### output?

> `optional` **output?**: `T`

**`Experimental`**

##### error?

> `optional` **error?**: `string`

**`Experimental`**

##### durationMs

> **durationMs**: `number`

**`Experimental`**

***

### RunDelegatedLoopOptions

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

**`Experimental`**

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Clock override for deterministic tests.

###### Returns

`number`

***

### WorktreeLoopRunnerOptions

**`Experimental`**

Options for the local-repo `code` runner over the GENERIC recursive path.

#### Properties

##### rootProfile

> **rootProfile**: `AgentProfile`

**`Experimental`**

Exact profile carried by the personified root that owns this fanout.

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path to the local git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

**`Experimental`**

The instruction handed to every authored harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](runtime.md#authoredharness)[]

**`Experimental`**

The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each.

##### budget

> **budget**: [`Budget`](#budget-4)

**`Experimental`**

Conserved budget pool bounding the fanout (equal-k holds by construction).

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

**`Experimental`**

Which verification signals the deliverable REQUIRES present-and-passing (default none).

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

Diff-size cap (lines).

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

Literal path prefixes the patch must not touch (the secret-floor is always on regardless).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](runtime.md#winnerstrategy)

**`Experimental`**

Winner-selection strategy among gated candidates. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

**`Experimental`**

Test seams forwarded to the worktree-CLI leaves so the runner drives offline.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

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

> `optional` **runCommand?**: [`WorktreeCheckRunner`](#worktreecheckrunner)

**`Experimental`**

***

### VetoedFact

**`Experimental`**

A fact rejected at the KB gate — surfaced, never dropped.

#### Properties

##### candidate

> **candidate**: [`FactCandidate`](mcp.md#factcandidate)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

**`Experimental`**

***

### ResearchLoopResult

**`Experimental`**

#### Properties

##### accepted

> **accepted**: [`FactCandidate`](mcp.md#factcandidate)[]

**`Experimental`**

Facts that passed the fail-closed gate — safe to write to the KB.

##### vetoed

> **vetoed**: [`VetoedFact`](#vetoedfact)[]

**`Experimental`**

Facts the gate vetoed in the final round — escalate, do not silently drop.

##### rounds

> **rounds**: `number`

**`Experimental`**

Research rounds actually run.

***

### ResearchLoopRunnerOptions

**`Experimental`**

Options for the default `research` runner.

#### Properties

##### research

> **research**: (`round`, `vetoed`) => `Promise`\<[`FactCandidate`](mcp.md#factcandidate)[]\>

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

**`Experimental`**

Gate config (extra judges, self-artifact kinds, …). The floor is always on.

##### maxRounds?

> `optional` **maxRounds?**: `number`

**`Experimental`**

Max research rounds (correct-on-veto remediation). Default 1.

***

### AnalystRegistry

#### Properties

##### kinds

> `readonly` **kinds**: readonly `object`[]

##### run

> `readonly` **run**: (`kindId`, `trace`) => `Promise`\<[`AnalystLensOutput`](runtime.md#analystlensoutput)\>

###### Parameters

###### kindId

`string`

###### trace

`TraceAnalysisStore`

###### Returns

`Promise`\<[`AnalystLensOutput`](runtime.md#analystlensoutput)\>

***

### ModelInfo

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

#### Properties

##### id

> **id**: `string`

##### name?

> `optional` **name?**: `string`

##### description?

> `optional` **description?**: `string`

##### provider?

> `optional` **provider?**: `string`

Provider slug, when the router exposes it (`provider` or `_provider`).

##### \_provider?

> `optional` **\_provider?**: `string`

##### architecture?

> `optional` **architecture?**: `object`

###### modality?

> `optional` **modality?**: `string`

###### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

###### output\_modalities?

> `optional` **output\_modalities?**: `string`[]

***

### RouterEnv

Env keys the router base URL is resolved from.

#### Properties

##### TANGLE\_ROUTER\_URL?

> `optional` **TANGLE\_ROUTER\_URL?**: `string`

##### TANGLE\_ROUTER\_BASE\_URL?

> `optional` **TANGLE\_ROUTER\_BASE\_URL?**: `string`

***

### ChatModelCandidate

#### Properties

##### source

> **source**: `string`

Stable label for telemetry — e.g. `request`, `workspace`, `env`.

##### model

> **model**: `string` \| `undefined`

***

### ResolvedChatModel

#### Properties

##### source

> **source**: `string`

##### model

> **model**: `string`

***

### OtelExportConfig

#### Properties

##### endpoint?

> `optional` **endpoint?**: `string`

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

##### batchSize?

> `optional` **batchSize?**: `number`

Batch size before flush. Default 64.

##### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Flush interval ms. Default 5000.

##### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Resource attributes stamped on every export.

##### serviceName?

> `optional` **serviceName?**: `string`

Service name. Default 'agent-runtime'.

***

### OtelExporter

#### Methods

##### exportSpan()

> **exportSpan**(`span`): `void`

Export a span.

###### Parameters

###### span

[`OtelSpan`](#otelspan)

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Force flush pending spans.

###### Returns

`Promise`\<`void`\>

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Shutdown cleanly.

###### Returns

`Promise`\<`void`\>

***

### OtelSpan

#### Properties

##### traceId

> **traceId**: `string`

##### spanId

> **spanId**: `string`

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

##### name

> **name**: `string`

##### kind?

> `optional` **kind?**: `number`

##### startTimeUnixNano

> **startTimeUnixNano**: `string`

##### endTimeUnixNano

> **endTimeUnixNano**: `string`

##### attributes?

> `optional` **attributes?**: [`OtelAttribute`](#otelattribute)[]

##### status?

> `optional` **status?**: `object`

###### code

> **code**: `number`

###### message?

> `optional` **message?**: `string`

***

### OtelAttribute

#### Properties

##### key

> **key**: `string`

##### value

> **value**: `object`

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

**`Stable`**

#### Extends

- [`RuntimeTelemetryOptions`](#runtimetelemetryoptions)

#### Properties

##### redact?

> `optional` **redact?**: (`value`) => `unknown`

Final customer redactor applied after the schema-aware runtime sanitizer.

###### Parameters

###### value

`unknown`

###### Returns

`unknown`

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeInputs`](#includeinputs-1)

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Include requirement descriptions. Secret requirements are always redacted.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeRequirementDescriptions`](#includerequirementdescriptions-1)

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Include evidence IDs. Off by default; counts are safer for shared reports.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvidenceIds`](#includeevidenceids-1)

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Include user answers from question preflight. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeUserAnswers`](#includeuseranswers-1)

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Include action payloads and action results for control steps. Off by default.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeControlPayloads`](#includecontrolpayloads-1)

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Include task metadata. Off by default because metadata may carry IDs or policy internals.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeMetadata`](#includemetadata-1)

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Include eval detail/evidence strings. Off by default because validators may echo private input.

###### Inherited from

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions).[`includeEvalDetails`](#includeevaldetails-1)

***

### LoopSpanNode

Sink-neutral node in a reconstructed loop span tree. The root node's
`parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
mapper attaches the inherited delegation span; the delegation journal
leaves it as the tree root).

#### Properties

##### spanId

> **spanId**: `string`

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

##### name

> **name**: `string`

`'loop'` | `'loop.round'` | `'loop.iteration'`.

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

##### endMs

> **endMs**: `number`

##### attrs

> **attrs**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

##### error

> **error**: `boolean`

True when the iteration carried an error — maps to OTEL status code 2.

***

### EvalRunGeneration

#### Properties

##### index

> **index**: `number`

0-based ordinal of this generation within the run (required by ingest).

##### surfaceHash

> **surfaceHash**: `string`

Identity of the proposed surface change (content-addressed hash).

##### surface?

> `optional` **surface?**: `unknown`

Arbitrary provenance for this generation (rationale, evidence, source).

##### cells?

> `optional` **cells?**: `unknown`[]

Per-scenario results; empty until the generation is measured.

##### compositeMean

> **compositeMean**: `number`

Mean composite score (0 when unmeasured — pair with labels.measured).

##### costUsd

> **costUsd**: `number`

##### durationMs

> **durationMs**: `number`

***

### EvalRunEvent

#### Properties

##### runId

> **runId**: `string`

##### runDir

> **runDir**: `string`

##### timestamp

> **timestamp**: `string`

ISO timestamp.

##### status

> **status**: `"started"` \| `"baseline-complete"` \| `"generation-complete"` \| `"gate-decided"` \| `"finished"` \| `"errored"`

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string`\>

##### baseline?

> `optional` **baseline?**: [`EvalRunGeneration`](#evalrungeneration)

##### generations?

> `optional` **generations?**: [`EvalRunGeneration`](#evalrungeneration)[]

##### gateDecision?

> `optional` **gateDecision?**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

##### holdoutLift?

> `optional` **holdoutLift?**: `number`

##### totalCostUsd

> **totalCostUsd**: `number`

##### totalDurationMs

> **totalDurationMs**: `number`

##### errorMessage?

> `optional` **errorMessage?**: `string`

***

### EvalRunsExportConfig

#### Properties

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY.

##### base?

> `optional` **base?**: `string`

Intelligence base. Reads TANGLE_INTELLIGENCE_URL env, else prod.

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Idempotency-Key header (e.g. the runId) — safe retries + upsert.

***

### EvalRunsExportResult

#### Properties

##### ok

> **ok**: `boolean`

##### status

> **status**: `number`

##### accepted

> **accepted**: `number`

##### rejected

> **rejected**: `object`[]

###### index

> **index**: `number`

###### reason

> **reason**: `string`

***

### RuntimeHookEvent

#### Type Parameters

##### Payload

`Payload` = `unknown`

#### Properties

##### id

> **id**: `string`

##### pursuitId?

> `optional` **pursuitId?**: `string`

Stable identity for the long-lived objective. One pursuit may contain many runs.

##### runId

> **runId**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### target

> **target**: [`RuntimeHookTarget`](#runtimehooktarget)

##### phase

> **phase**: [`RuntimeHookPhase`](#runtimehookphase)

##### timestamp

> **timestamp**: `number`

##### stepIndex?

> `optional` **stepIndex?**: `number`

##### parentId?

> `optional` **parentId?**: `string`

##### payload?

> `optional` **payload?**: `Payload`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeHookContext

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### RuntimeDecisionEvidenceRef

#### Properties

##### source

> **source**: `string`

##### id

> **id**: `string`

##### detail?

> `optional` **detail?**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeDecisionPoint

#### Properties

##### id

> **id**: `string`

##### pursuitId?

> `optional` **pursuitId?**: `string`

Stable identity for the long-lived objective. One pursuit may contain many runs.

##### runId

> **runId**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### stepIndex

> **stepIndex**: `number`

##### kind

> **kind**: [`RuntimeDecisionKind`](#runtimedecisionkind)

##### candidateActions

> **candidateActions**: `string`[]

##### context?

> `optional` **context?**: `string`

##### evidence

> **evidence**: [`RuntimeDecisionEvidenceRef`](#runtimedecisionevidenceref)[]

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeHookErrorContext

#### Properties

##### hook

> **hook**: `"onEvent"` \| `"onDecisionPoint"`

##### eventId?

> `optional` **eventId?**: `string`

##### target?

> `optional` **target?**: [`RuntimeHookTarget`](#runtimehooktarget)

##### phase?

> `optional` **phase?**: [`RuntimeHookPhase`](#runtimehookphase)

##### decisionId?

> `optional` **decisionId?**: `string`

##### decisionKind?

> `optional` **decisionKind?**: [`RuntimeDecisionKind`](#runtimedecisionkind)

***

### RuntimeHooks

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](#defineruntimehooks) for inference, and attach N
observers at once with [composeRuntimeHooks](#composeruntimehooks) — there is ONE event stream, not a
callback-prop zoo.

#### Properties

##### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

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

###### Parameters

###### error

`Error`

###### context

[`RuntimeHookErrorContext`](#runtimehookerrorcontext)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunCost

**`Stable`**

#### Properties

##### tokensIn

> **tokensIn**: `number`

Cumulative input tokens across every observed `llm_call` event.

##### tokensOut

> **tokensOut**: `number`

Cumulative output tokens across every observed `llm_call` event.

##### costUsd

> **costUsd**: `number`

Sum of `costUsd` from every observed `llm_call` event.

##### wallMs

> **wallMs**: `number`

Wall time from `startRuntimeRun()` to `complete()` (or `now()` if not yet completed).

##### llmCalls

> **llmCalls**: `number`

Count of `llm_call` events observed during the run.

***

### RuntimeRunCompleteInput

**`Stable`**

#### Properties

##### status

> **status**: `"completed"` \| `"failed"` \| `"cancelled"`

##### resultSummary?

> `optional` **resultSummary?**: `string`

##### cost?

> `optional` **cost?**: `Partial`\<[`RuntimeRunCost`](#runtimeruncost)\>

Optional explicit cost override; if omitted, the accumulated ledger is used.

##### error?

> `optional` **error?**: `string`

Stable error message when `status === 'failed'`.

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Additional adapter-specific fields merged into the persisted row.

***

### RuntimeRunRow

**`Stable`**

#### Properties

##### id

> **id**: `string`

Stable runtime-side identifier. Adapters may translate to their own primary key.

##### workspaceId

> **workspaceId**: `string`

##### sessionId?

> `optional` **sessionId?**: `string`

##### agentId?

> `optional` **agentId?**: `string`

##### domain?

> `optional` **domain?**: `string`

##### taskId

> **taskId**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### status

> **status**: [`RuntimeRunStatus`](#runtimerunstatus)

##### resultSummary?

> `optional` **resultSummary?**: `string`

##### error?

> `optional` **error?**: `string`

##### cost

> **cost**: [`RuntimeRunCost`](#runtimeruncost)

##### startedAt

> **startedAt**: `string`

##### completedAt?

> `optional` **completedAt?**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeRunPersistenceAdapter

**`Stable`**

#### Methods

##### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

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

### RuntimeRunOptions

**`Stable`**

#### Properties

##### workspaceId

> **workspaceId**: `string`

##### sessionId?

> `optional` **sessionId?**: `string`

##### agentId?

> `optional` **agentId?**: `string`

##### taskSpec

> **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### adapter?

> `optional` **adapter?**: [`RuntimeRunPersistenceAdapter`](#runtimerunpersistenceadapter)

Optional persistence adapter; if omitted, `persist()` is a no-op.

##### id?

> `optional` **id?**: `string`

Override the row id; default = `${taskSpec.id}:${random suffix}`.

##### now?

> `optional` **now?**: () => `number`

Override the clock; default = `Date.now()`. Useful for deterministic tests.

###### Returns

`number`

***

### RuntimeRunHandle

**`Stable`**

#### Properties

##### id

> `readonly` **id**: `string`

Stable id assigned at start.

##### workspaceId

> `readonly` **workspaceId**: `string`

##### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

##### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

##### status

> `readonly` **status**: [`RuntimeRunStatus`](#runtimerunstatus)

#### Methods

##### observe()

> **observe**(`event`): `void`

Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
(text deltas, tool calls) silently so consumers can pipe the whole stream
through `handle.observe`. `llm_call` events update the ledger.

###### Parameters

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void`

##### cost()

> **cost**(): [`RuntimeRunCost`](#runtimeruncost)

Snapshot of the current cost ledger. Safe to call at any time.

###### Returns

[`RuntimeRunCost`](#runtimeruncost)

##### complete()

> **complete**(`input`): `void`

Transition to a terminal state. Idempotent for the same status; throws
`RuntimeRunStateError` for a different terminal status (state machines
don't time-travel).

###### Parameters

###### input

[`RuntimeRunCompleteInput`](#runtimeruncompleteinput)

###### Returns

`void`

##### toRow()

> **toRow**(`metadata?`): [`RuntimeRunRow`](#runtimerunrow)

Build the current row without writing it. Useful for tests + dry runs.

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

[`RuntimeRunRow`](#runtimerunrow)

##### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Persist the current row via the configured adapter. Must be called after
`complete()`. Idempotent for the same terminal state (the adapter sees
the same row on retry).

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`void`\>

***

### FinalizeContext

What a finalizer gets to decide with. `delivered` is the ONLY output material; `allSettled`
 and `tree` are metadata (record a disagreement, count the downs); `blobs` re-reads delivered
 artifacts only; `budget` is the conserved-pool readout at finalize time.

#### Properties

##### delivered

> `readonly` **delivered**: readonly [`DeliveredOutput`](runtime.md#deliveredoutput)[]

##### allSettled

> `readonly` **allSettled**: readonly [`FinalizerSettled`](runtime.md#finalizersettled)[]

##### tree

> `readonly` **tree**: [`TreeView`](runtime.md#treeview)

##### blobs

> `readonly` **blobs**: `Pick`\<[`ResultBlobStore`](runtime.md#resultblobstore), `"get"`\>

##### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

***

### Executor

The leaf runtime — ONE open interface, not a closed union. `execute` returns a
`Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
streaming ones; a streaming executor reports incremental normalized usage as it runs
(the budget pool reconciles against it) and exposes its terminal artifact via
`resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
meters every runtime identically.

Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
Router/HTTP inference call, no box), sandbox (COMPOSES `runAgentRounds` as a leaf, forwarding
PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
(Halo/RLM subprocess; `budgetExempt`, refused by budgeted supervision). A user's
own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.

#### Type Parameters

##### Out

`Out`

#### Properties

##### runtime

> `readonly` **runtime**: [`Runtime`](runtime.md#runtime-4)

Stable runtime tag for traces + the equal-k exemption check.

##### budgetExempt?

> `readonly` `optional` **budgetExempt?**: `boolean`

When true, this executor cannot report the usage a conserved pool would need (for example, a
subscription CLI with no token receipt). `Executor` can still be used directly, but `Scope`
refuses it before `execute` so unknown compute can never appear as measured zero in a
supervised or equal-resource run. A metered executor MUST report usage.

#### Methods

##### execute()

> **execute**(`task`, `signal`): `Promise`\<[`ExecutorResult`](runtime.md#executorresult)\<`Out`\>\> \| `AsyncIterable`\<[`UsageEvent`](runtime.md#usageevent), `any`, `any`\>

One-shot → resolves a `ExecutorResult`; streaming → yields incremental `UsageEvent`s and
the terminal artifact is read from `resultArtifact()` after the stream drains.
`signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).

###### Parameters

###### task

`unknown`

###### signal

`AbortSignal`

###### Returns

`Promise`\<[`ExecutorResult`](runtime.md#executorresult)\<`Out`\>\> \| `AsyncIterable`\<[`UsageEvent`](runtime.md#usageevent), `any`, `any`\>

##### deliver()?

> `optional` **deliver**(`msg`): `boolean` \| `void`

Optional inbox: receive an out-of-band message from the driver mid-run (the `send`/`steer_agent`
verb). A streaming executor drains pending messages between turns and folds them into the next
step (a steer / interrupt / resume). A one-shot executor that can't be steered mid-flight omits
this; `Scope.send` then returns `false` for it. Never throws — an inbox that rejects a malformed
message returns `false`, and that refusal propagates to the caller.

###### Parameters

###### msg

`unknown`

###### Returns

`boolean` \| `void`

##### progress()?

> `optional` **progress**(): [`ExecutorProgress`](runtime.md#executorprogress) \| `undefined`

Optional LIVE progress: what this worker is doing RIGHT NOW, read synchronously and
cheaply while `execute` is still streaming. The scope already derives activity timing,
turns, and spend from the metered usage stream for EVERY executor; this adds only what
the executor alone knows — the harness's tool/file activity, its own turn count, and how
many delivered steers it has not yet folded in. Never throws; a read that cannot be
answered returns `undefined`.

This is the observe half of steering: `deliver` lets a driver correct a worker, and this
is the evidence it corrects FROM. An executor that implements neither cannot be supervised
mid-flight — it can only be waited on.

###### Returns

[`ExecutorProgress`](runtime.md#executorprogress) \| `undefined`

##### traceSource()?

> `optional` **traceSource**(): [`TraceSource`](runtime.md#tracesource-1) \| `undefined`

Optional live tool-call trace for the ONLINE detectors (`watchTrace`). An executor that
can see its worker's tool calls exposes them here, so a supervisor can run the streaming
repeated-action / error-streak panel over a RUNNING worker and raise a `finding` the
moment it loops, instead of discovering it at settle. Omitted = no online detection for
this runtime (the settle-time analyzers still work).

###### Returns

[`TraceSource`](runtime.md#tracesource-1) \| `undefined`

##### interactive()?

> `optional` **interactive**(): [`WorkerInteractiveSession`](runtime.md#workerinteractivesession)

The exact interactive process this worker runs in, when its execution was started in an
attachable terminal. Read through `Scope.interactive`; synchronous and side-effect free, and
it must not throw. Omitting it is the honest answer for every headless executor: omission
reads as `executor-exposes-no-interactive-session`, never as an empty handle.

###### Returns

[`WorkerInteractiveSession`](runtime.md#workerinteractivesession)

##### cancel()?

> `optional` **cancel**(`request`): `Promise`\<[`ExecutorCancellation`](runtime.md#executorcancellation)\>

Optional provider-neutral CANCELLATION, distinct from `teardown`: it asks the backend to stop
the work and reports what the backend acknowledged, so a caller never has to read a local
iterator abort as remote acceptance. `teardown` remains the resource verb — it releases what
this process holds and says nothing about remote compute or billing.

An executor that cannot ask its backend anything omits this method; one whose backend has no
cancel operation implements it and answers `unknown` with the reason in `detail`.

###### Parameters

###### request

[`ExecutorCancellationRequest`](runtime.md#executorcancellationrequest)

###### Returns

`Promise`\<[`ExecutorCancellation`](runtime.md#executorcancellation)\>

##### teardown()

> **teardown**(`grace`): `Promise`\<\{ `destroyed`: `boolean`; \}\>

Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
(`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).

###### Parameters

###### grace

`number` \| `"brutalKill"` \| `"infinity"`

###### Returns

`Promise`\<\{ `destroyed`: `boolean`; \}\>

##### resultArtifact()

> **resultArtifact**(): `object`

The replay source (B1): the content-addressed `outRef` + the materialized output the
driver branched on, its verdict, and the conserved spend. Read once, after settle.

###### Returns

`object`

###### outRef

> **outRef**: `string`

###### out

> **out**: `Out`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](#spend)

##### accounting()?

> `optional` **accounting**(): [`ExecutorAccounting`](runtime.md#executoraccounting) \| `undefined`

Optional accounting split for recursive executors.
`reported` is the child-work spend written on this node's settlement; `reservation` is the
whole amount reconciled against this node's parent reservation.
They differ when a driver owns a nested allocation: its child work and own inference consume
that allocation together, while the journal keeps those two categories separate.
Valid after `execute` resolves or throws; ordinary leaf executors omit it.

###### Returns

[`ExecutorAccounting`](runtime.md#executoraccounting) \| `undefined`

##### metered()?

> `optional` **metered**(): [`Spend`](#spend) \| `undefined`

A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
(the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
executors omit it (returns `undefined`).

###### Returns

[`Spend`](#spend) \| `undefined`

***

### AgentSpec

`AgentProfile` is the complete execution authority. Scope parses and snapshots it before calling
any registry, including one that resolves caller-supplied executors and factories. The default
registry enforces the same rule when called directly. `AgentSpec.harness` records routing for one
concrete run; where a backend consumes both fields, it must agree with `AgentProfile.harness` and
cannot fill or override it.

Resolution (in `runtime.ts`):
 - `executorFactory` present → BYO: build it after admission with the live context.
 - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 - `harness === null`        → router/inline: a direct Router call, no box.
 - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
Fail loud on an unresolvable spec (no executor and an unknown harness).

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

##### harness

> `readonly` **harness**: `BackendType` \| `null`

`null` selects router/inline; a `BackendType` selects the sandboxed harness.

##### execution?

> `readonly` `optional` **execution?**: [`AgentExecutionRef`](runtime.md#agentexecutionref)

Trusted candidate/campaign attribution supplied by the caller. Profile/task digests are
 computed by Scope from the exact values it executes and cannot be supplied here.

##### executorFactory?

> `readonly` `optional` **executorFactory?**: [`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

Per-spawn factory carrying caller configuration. Constructed only after admission, with the
 real child signal and nested-scope context.

##### executor?

> `readonly` `optional` **executor?**: [`Executor`](#executor-2)\<`unknown`\>

Bring-your-own executor: highest routing precedence after exact-profile intake validation.

***

### ExecutorRegistry

The OPEN resolver maps an already-admitted `AgentSpec` to an `ExecutorFactory`. Scope validates
before invoking any implementation; the default registry repeats validation for direct callers,
resolves the three built-ins, and accepts a BYO `executor`/factory. Callers may register more
runtimes by name, but registration does not waive exact-profile validation.

#### Methods

##### register()

> **register**\<`Out`\>(`runtime`, `factory`): `void`

Register a factory for a named runtime. Throws on a duplicate name (fail loud).

###### Type Parameters

###### Out

`Out`

###### Parameters

###### runtime

[`Runtime`](runtime.md#runtime-4)

###### factory

[`ExecutorFactory`](runtime.md#executorfactory)\<`Out`\>

###### Returns

`void`

##### resolve()

> **resolve**\<`Out`\>(`spec`): \{ `succeeded`: `true`; `value`: [`ExecutorFactory`](runtime.md#executorfactory)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

Resolve a spec to a factory. Precedence: a BYO `spec.executorFactory` → `spec.executor` →
`harness === null` → the `'router'` factory; else a registered
factory for the harness-derived runtime. Returns a typed outcome — the caller
inspects `succeeded` before `value` (no silent fallback).

###### Type Parameters

###### Out

`Out`

###### Parameters

###### spec

[`AgentSpec`](#agentspec)

###### Returns

\{ `succeeded`: `true`; `value`: [`ExecutorFactory`](runtime.md#executorfactory)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

***

### Budget

A budget envelope on a spawn or the root. All ceilings; the pool reserves against them.

#### Properties

##### maxIterations

> `readonly` **maxIterations**: `number`

##### maxTokens

> `readonly` **maxTokens**: `number`

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

##### deadlineMs?

> `readonly` `optional` **deadlineMs?**: `number`

***

### Spend

Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 are separate channels (never folded).

#### Properties

##### iterations

> **iterations**: `number`

##### tokens

> **tokens**: [`LoopTokenUsage`](runtime.md#looptokenusage)

##### tokensKnown?

> `optional` **tokensKnown?**: `boolean`

Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
 an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
 not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
 turn whose provider reported no usage is recorded with this flag rather than omitted, because
 omitting it makes the turn look free.

##### usdKnown?

> `optional` **usdKnown?**: `boolean`

Dollar accounting is known unless explicitly false. A false value must not be treated as $0
 when enforcing a dollar-denominated comparison or limit.

##### usd

> **usd**: `number`

##### usdEstimated?

> `optional` **usdEstimated?**: `number`

The part of `usd` priced from a model catalog because no provider receipt covered the work.
 `usd - usdEstimated` is what a provider is known to have billed. Present only with
 `usdKnown: false`; absence means nothing here was catalog-priced, not that `usd` is
 measured.

##### ms

> **ms**: `number`

***

### Scope

**`Stable`**

The budget-conserving reactive scope an `Agent.act` runs inside. `spawn` reserves
budget atomically from the shared pool and fails closed when the pool cannot cover it.
`next()` waits for one settlement from this scope's live set; `view` reads live state,
not the replay log.

#### Type Parameters

##### Out

`Out`

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
 is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
 it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
 scope carries its own signal, chained off its driver child's abort.

##### resume?

> `readonly` `optional` **resume?**: [`ResumedWork`](runtime.md#resumedwork)\<`Out`\>

**`Experimental`**

Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
first; when a non-empty tree exists it rehydrates the already-settled children (via
`replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
maxima, so any NEW spawn appends without colliding with a journaled event.

 Same-process replay only — live supervised-tree recovery after a
coordinator restart is not implemented (docs/agent-managed-compute/README.md).

##### view

> `readonly` **view**: [`TreeView`](runtime.md#treeview)

The live tree — reads the in-memory nursery, not the journal.

##### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Conserved-pool readouts (post-reservation).

##### workerCapacity

> `readonly` **workerCapacity**: `Readonly`\<\{ `live`: `number`; `freeSlots`: `number` \| `null`; `unconfirmed`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; \}\>

One tree-wide view of simultaneous spawned work. Every nested scope reads the same counter;
 the root agent itself is not a spawned worker. `freeSlots` is `null` when no limit is set.
 `unconfirmed` NAMES the settled children whose executor teardown was never acknowledged —
 the nodes still holding a capacity slot. Empty on every healthy run.

#### Methods

##### spawn()

> **spawn**\<`C`\>(`agent`, `task`, `opts`): \{ `ok`: `true`; `handle`: [`Handle`](runtime.md#handle-3)\<`C`\>; `prior?`: [`SpawnPrior`](runtime.md#spawnprior)\<`C`\>; \} \| \{ `ok`: `false`; `reason`: [`SpawnRejection`](runtime.md#spawnrejection); \}

Spawn a child. For a fresh key or an unkeyed spawn, tree-wide worker admission happens before a
lazy factory is called, so a full worker allocation creates no worker, executor, or reservation.
Reserves `opts.budget` from the conserved pool atomically; refunds the unspent remainder on
settle. Returns a typed outcome — fail-closed on an exhausted pool, an exceeded depth ceiling, a
full worker allocation, or a still-live duplicate `key` (the caller inspects `ok` before
`handle`). A KEYED spawn whose key already settled `done` invokes the factory only far enough to
prepare and authorize the exact profile/task identity, then compares that identity with the
journal. On a match it spends nothing, constructs no executor, reserves no budget, and runs no
work: it returns the committed result on `prior` (see `SpawnOpts.key`).

###### Type Parameters

###### C

`C`

###### Parameters

###### agent

[`Agent`](runtime.md#agent-2)\<`unknown`, `C`\> \| (() => [`Agent`](runtime.md#agent-2)\<`unknown`, `C`\>)

###### task

`unknown`

###### opts

[`SpawnOpts`](runtime.md#spawnopts)

###### Returns

\{ `ok`: `true`; `handle`: [`Handle`](runtime.md#handle-3)\<`C`\>; `prior?`: [`SpawnPrior`](runtime.md#spawnprior)\<`C`\>; \} \| \{ `ok`: `false`; `reason`: [`SpawnRejection`](runtime.md#spawnrejection); \}

##### next()

> **next**(): `Promise`\<[`Settled`](#settled)\<`Out`\> \| `null`\>

ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
 `null` when the live set is empty.

###### Returns

`Promise`\<[`Settled`](#settled)\<`Out`\> \| `null`\>

##### nextResolved()

> **nextResolved**(): `Promise`\<[`Settled`](#settled)\<`Out`\> \| `null`\>

Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
when none is ready — never awaits a live child. The driver's post-loop drain reads this so
a child that settled while the driver was busy (or after it stopped pulling) still reaches
the finalize ledger instead of being silently lost.

###### Returns

`Promise`\<[`Settled`](#settled)\<`Out`\> \| `null`\>

##### send()

> **send**(`nodeId`, `msg`): `boolean`

Steer a RUNNING child out-of-band — deliver a message to its executor's inbox (the driver's
`send` verb: next-instruction, interrupt, or resume). Returns `true` if the message was
delivered to a live child whose executor accepts delivery, `false` otherwise (unknown id,
already settled, or an executor with no inbox). The executor drains its inbox between turns;
a leaf that does not implement `deliver` simply cannot be steered mid-flight. In-process this
is a direct call; the sandbox/Agent-Bus transports surface the SAME verb as an MCP tool.

###### Parameters

###### nodeId

`string`

###### msg

`unknown`

###### Returns

`boolean`

##### wait()

> **wait**(`spec`, `opts`): \{ `ok`: `true`; `handle`: [`Handle`](runtime.md#handle-3)\<[`WaitOutcome`](runtime.md#waitoutcome)\>; \} \| \{ `ok`: `false`; `reason`: [`WaitRejection`](runtime.md#waitrejection); \}

Arm a WAIT-STATE node: a first-class tree node that waits on wall-clock time (`timer`) or on
a named external predicate (`poll`) and settles through THIS scope's `next()` cursor like any
other child — but holds no executor, no sandbox, and no conserved budget. Waiting costs zero
tokens and zero dollars by construction.

It is journaled (`waiting` → `woken`) with its ABSOLUTE deadline, so a run that dies mid-wait
resumes still waiting: the supervisor surfaces the un-woken waits on `Scope.resume.waits`, and
re-arming the same `label` adopts the recorded node id and original instant instead of
restarting the countdown.

Fail-closed admission, mirroring `spawn`: `invalid-spec`, `unknown-probe` (a `poll` naming a
predicate this run's registry cannot resolve), or `deadline-exceeded` (the wait would outlive
the pool's hard wall-clock ceiling — a wait never extends a budget guard).

NOT `await_event`: that is an in-run rendezvous on the coordination bus whose 15s fence makes
the caller re-poll — each re-poll a driver inference turn against a process that must stay up,
and nothing about it survives a restart. See `supervise/wait.ts`.

###### Parameters

###### spec

[`WaitSpec`](runtime.md#waitspec)

###### opts

[`WaitOpts`](runtime.md#waitopts)

###### Returns

\{ `ok`: `true`; `handle`: [`Handle`](runtime.md#handle-3)\<[`WaitOutcome`](runtime.md#waitoutcome)\>; \} \| \{ `ok`: `false`; `reason`: [`WaitRejection`](runtime.md#waitrejection); \}

##### progress()

> **progress**(`nodeId`, `opts?`): [`WorkerProgress`](runtime.md#workerprogress) \| `undefined`

The LIVE read-model of one child, valid WHILE it runs: last-activity timestamp, idle time,
a derived `stalled` flag, tokens/turns spent so far, whether a steer can even reach it
(`steerable`), and whatever tool activity its executor exposes. `undefined` for an unknown
id. This is the counterpart to `send`: a driver that can steer but cannot observe has
nothing to steer on, which is precisely why steering went unused.

Pull-based and side-effect free — reading it starts no timer and spends nothing. `now` and
`stallAfterMs` are injectable so a caller (and a test) controls what counts as stalled.

###### Parameters

###### nodeId

`string`

###### opts?

###### now?

`number`

###### stallAfterMs?

`number`

###### Returns

[`WorkerProgress`](runtime.md#workerprogress) \| `undefined`

##### traceSource()

> **traceSource**(`nodeId`): [`TraceSource`](runtime.md#tracesource-1) \| `undefined`

The live tool-call trace of one child when its executor exposes one (`Executor.traceSource`),
 for running the online detector panel over a RUNNING worker. `undefined` otherwise.

###### Parameters

###### nodeId

`string`

###### Returns

[`TraceSource`](runtime.md#tracesource-1) \| `undefined`

##### interactive()

> **interactive**(`nodeId`): [`WorkerInteractiveSession`](runtime.md#workerinteractivesession)

Attach a human terminal to the exact process ONE child is running in.

Returns that child's `RetainedInteractiveRunHandle` when its executor holds an interactive
session — the caller then types, resizes, detaches, reconnects, and closes against the same
admitted execution, with one ordered output history. Every other worker returns an explicit
`unavailable` reason: a headless run, a runner whose provider publishes no interactive
contract, and an unknown or settled node are each distinguishable, and none of them is ever
converted into a fake attachment.

###### Parameters

###### nodeId

`string`

###### Returns

[`WorkerInteractiveSession`](runtime.md#workerinteractivesession)

##### cancel()

> **cancel**(`nodeId`, `request`): `Promise`\<[`ExecutorCancellation`](runtime.md#executorcancellation)\>

Ask one child's backend to stop, and report what it acknowledged. It delegates to
`Executor.cancel` when the runtime has one; otherwise the child is aborted locally and the
answer is `unknown`, never `accepted`. Resource release still belongs to teardown.

###### Parameters

###### nodeId

`string`

###### request

[`ExecutorCancellationRequest`](runtime.md#executorcancellationrequest)

###### Returns

`Promise`\<[`ExecutorCancellation`](runtime.md#executorcancellation)\>

##### meter()

> **meter**(`spend`, `detail?`): `Promise`\<`void`\>

Meter the driver's OWN compute against the conserved pool — its inference turns, which are
real tokens/usd but not a spawned child (no reserve/reconcile). A direct `free → committed`
debit, so equal-k counts the driver's tokens AND the in-loop budget guard (`budget.tokensLeft`)
halts a driver that thinks the pool dry. `detail` rides an `agent.turn` trace event for live
observability (turn index, tool calls, cumulative spend). It also journals a `metered` event —
the durable twin of the pool debit (as `settled` is the twin of `reconcile`) — so every
journal-based cost reader (`spentFromJournal`, `trajectoryReport`) sums driver inference
automatically. A leaf never calls this; a driver meters each chat turn and awaits it (the
metered event is cost-critical, so it lands before the join-barrier roll-up).

###### Parameters

###### spend

[`Spend`](#spend)

###### detail?

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`void`\>

***

### Supervisor

**`Stable`**

Owns the conserved pool, the spawn log, the abort cascade, the OTP intensity breaker,
and the root handle. `run` executes the root `Agent` to completion; `attach` wires a
live `RootHandle` (the Q2 substrate the chat/pi-viz client later consumes).

#### Type Parameters

##### Task

`Task`

##### Out

`Out`

#### Methods

##### run()

> **run**(`root`, `task`, `opts`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

###### Parameters

###### root

[`Agent`](runtime.md#agent-2)\<`Task`, `Out`\>

###### task

`Task`

###### opts

[`SupervisorOpts`](runtime.md#supervisoropts)

###### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

##### attach()

> **attach**(`h`): `void`

###### Parameters

###### h

[`RootHandle`](runtime.md#roothandle-1)\<`Out`\>

###### Returns

`void`

***

### ProviderModelAttemptEvidence

One provider/harness inference attempt. An empty observation list means the attempt started but
no trusted served model identity arrived before it failed or ended, unless Router explicitly
proves that admission rejected it before provider dispatch.

#### Properties

##### observations

> `readonly` **observations**: readonly `string`[]

##### identityConflict?

> `readonly` `optional` **identityConflict?**: `boolean`

##### providerDispatch?

> `readonly` `optional` **providerDispatch?**: `"not_started"`

Router-owned proof that this attempt never reached a provider.

***

### SpendGap

One journaled node whose usage accounting is incomplete — the named gap behind a `false`
`tokensKnown`/`usdKnown` on a terminal `spentTotal`. `never-settled`: the spawn is durable but
no terminal record landed, so the whole subtree is unaccounted on every channel and
`spentTotal` charges its budget ceiling instead of a fabricated zero. `unreported`: a settled
or metered record landed without a complete provider receipt, so the summed numbers are a
floor on the named channels, never the measured total.

#### Properties

##### id

> `readonly` **id**: `string`

##### label?

> `readonly` `optional` **label?**: `string`

The spawn label, when the node's `spawned` event is in this journal tree.

##### kind

> `readonly` **kind**: `"never-settled"` \| `"unreported"`

##### channels

> `readonly` **channels**: readonly [`SpendChannel`](#spendchannel)[]

***

### Driver

**`Stable`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Properties

##### name?

> `readonly` `optional` **name?**: `string`

Trace label surfaced in trace events. No behavioral effect: it never
selects a strategy or a decision path. Default `'driver'`.

#### Methods

##### plan()

> **plan**(`task`, `history`): `Promise`\<`Task`[]\>

Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
`[]` → no more work this round (kernel proceeds to `decide`).

###### Parameters

###### task

`Task`

###### history

readonly [`Iteration`](runtime.md#iteration-1)\<`Task`, `Output`\>[]

###### Returns

`Promise`\<`Task`[]\>

##### decide()

> **decide**(`history`): `Decision` \| `Promise`\<`Decision`\>

Inspect history and return the next state. The kernel terminates the
loop when `decide` returns a `TerminalDecision`
(`'stop' | 'pick-winner' | 'fail' | 'done'`, exported as
`TERMINAL_DECISIONS` with the `isTerminalDecision` guard), when
`maxIterations` is hit, or when the abort signal fires. Every other
value is caller vocabulary and continues the loop.

###### Parameters

###### history

readonly [`Iteration`](runtime.md#iteration-1)\<`Task`, `Output`\>[]

###### Returns

`Decision` \| `Promise`\<`Decision`\>

##### describePlan()?

> `optional` **describePlan**(): [`LoopPlanDescription`](runtime.md#loopplandescription) \| `undefined`

Optional: describe the move `plan()` just produced, for trace emission.
The kernel calls this immediately after `plan()` and emits the result in
the `loop.plan` event so a topology viewer can render the agent's chosen
move + rationale (not just the inferred fan-width). Drivers whose topology
is a pure function of count (refine/fanout-vote) omit it — the kernel
infers `moveKind` from the planned-task count. A driver that authors its
own topology returns its chosen move's kind + rationale here.

###### Returns

[`LoopPlanDescription`](runtime.md#loopplandescription) \| `undefined`

##### selectWinner()?

> `optional` **selectWinner**(`history`): [`LoopWinner`](runtime.md#loopwinner)\<`Task`, `Output`\> \| `undefined`

**`Experimental`**

Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
kernel consults this at finalize ONLY when the caller did not pass an explicit
`selectWinner` to runAgentRounds. Return the driver-declared winner (e.g. from a
`select` topology move) or `undefined` to fall through to the default
(best-valid-score, earliest index). This is the SELECTOR role made
agent-authorable — the planner runs the selection, not the kernel.

###### Parameters

###### history

readonly [`Iteration`](runtime.md#iteration-1)\<`Task`, `Output`\>[]

###### Returns

[`LoopWinner`](runtime.md#loopwinner)\<`Task`, `Output`\> \| `undefined`

***

### LoopResult

**`Stable`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Properties

##### decision

> **decision**: `Decision`

##### iterations

> **iterations**: [`Iteration`](runtime.md#iteration-1)\<`Task`, `Output`\>[]

##### winner?

> `optional` **winner?**: [`LoopWinner`](runtime.md#loopwinner)\<`Task`, `Output`\>

##### durationMs

> **durationMs**: `number`

##### costUsd

> **costUsd**: `number`

Sum of every iteration's `costUsd`.

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

False when `costUsd` is only the observed subtotal, not a complete bill.

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Sum of separately-labelled local/catalog estimates.

##### promptCache?

> `optional` **promptCache?**: `Record`\<`string`, `string` \| `number`\>

Aggregated provider-reported prompt-cache fields.

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](runtime.md#looptokenusage)

Sum of every iteration's token usage. `loopDispatch` commits it through
 the campaign's paid-call receipt.

##### provenance

> **provenance**: [`RunProvenance`](runtime.md#runprovenance)

Domain-free run provenance for auditability: the mount manifest recorded
 during `prepareBox` and the selection receipts for how the winner was
 chosen. Always present; empty arrays when nothing was recorded.

***

### RuntimeTelemetryOptions

**`Stable`**

#### Extended by

- [`RuntimeEventOtelOptions`](#runtimeeventoteloptions)

#### Properties

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Include requirement descriptions. Secret requirements are always redacted.

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Include evidence IDs. Off by default; counts are safer for shared reports.

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Include user answers from question preflight. Off by default.

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Include action payloads and action results for control steps. Off by default.

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Include task metadata. Off by default because metadata may carry IDs or policy internals.

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Include eval detail/evidence strings. Off by default because validators may echo private input.

***

### SanitizedKnowledgeRequirement

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### description?

> `optional` **description?**: `string`

##### requiredFor

> **requiredFor**: `string`[]

##### category

> **category**: `KnowledgeRequirementCategory`

##### acquisitionMode

> **acquisitionMode**: `KnowledgeAcquisitionMode`

##### importance

> **importance**: `KnowledgeImportance`

##### freshness

> **freshness**: `KnowledgeFreshness`

##### sensitivity

> **sensitivity**: `KnowledgeSensitivity`

##### confidenceNeeded

> **confidenceNeeded**: `number`

##### currentConfidence

> **currentConfidence**: `number`

##### evidenceCount

> **evidenceCount**: `number`

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

##### fallbackPolicy

> **fallbackPolicy**: `KnowledgeFallbackPolicy`

***

### SanitizedKnowledgeReadinessReport

**`Stable`**

#### Properties

##### taskId

> **taskId**: `string`

##### readinessScore

> **readinessScore**: `number`

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

##### severity

> **severity**: `ControlSeverity`

##### reason

> **reason**: `string`

##### blockingMissingRequirements

> **blockingMissingRequirements**: [`SanitizedKnowledgeRequirement`](#sanitizedknowledgerequirement)[]

##### nonBlockingGaps

> **nonBlockingGaps**: [`SanitizedKnowledgeRequirement`](#sanitizedknowledgerequirement)[]

##### evidenceCount

> **evidenceCount**: `number`

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

##### missingRequirementIds

> **missingRequirementIds**: `string`[]

***

### RuntimeEventCollector

**`Stable`**

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

###### Parameters

###### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`void`

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

***

### RuntimeStreamEventSummary

**`Stable`**

#### Properties

##### eventCount

> **eventCount**: `number`

Total count of sanitized events collected.

##### eventCountsByType

> **eventCountsByType**: `Record`\<`string`, `number`\>

Count of events per `type`. Useful for log-line summaries.

##### firstSessionId?

> `optional` **firstSessionId?**: `string`

First session id observed in a `session_created` / `session_resumed` event, if any.

##### finalStatus?

> `optional` **finalStatus?**: [`AgentTaskStatus`](#agenttaskstatus)

Last `final` event's status, if a final event was observed.

##### finalReason?

> `optional` **finalReason?**: `string`

Last `final` event's reason, if a final event was observed.

##### finalText

> **finalText**: `string`

Concatenated `text_delta.text` across the stream, even when payloads are redacted.

***

### RuntimeStreamEventCollector

**`Stable`**

#### Properties

##### onEvent

> **onEvent**: [`RuntimeStreamEventSink`](#runtimestreameventsink)

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

#### Methods

##### summary()

> **summary**(): [`RuntimeStreamEventSummary`](#runtimestreameventsummary)

Snapshot of a small streaming-flavored summary derived from collected events.

###### Returns

[`RuntimeStreamEventSummary`](#runtimestreameventsummary)

***

### ServerSentEventOptions

**`Stable`**

#### Properties

##### event?

> `optional` **event?**: `string`

##### id?

> `optional` **id?**: `string`

##### retry?

> `optional` **retry?**: `number`

***

### AgentTaskSpec

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### intent

> **intent**: `string`

##### domain?

> `optional` **domain?**: `string`

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

##### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

##### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### AgentKnowledgeProvider

**`Stable`**

#### Methods

##### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

###### Parameters

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

##### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

###### Parameters

###### questions

`UserQuestion`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

##### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

###### Parameters

###### plans

`DataAcquisitionPlan`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`string`[] \| `Promise`\<`string`[]\>

##### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

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

**`Stable`**

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

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### state

> **state**: `TState`

##### evals

> **evals**: `TEval`[]

##### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

##### budget

> **budget**: `ControlBudget`

##### stepIndex

> **stepIndex**: `number`

##### wallMs

> **wallMs**: `number`

##### spentCostUsd

> **spentCostUsd**: `number`

##### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

##### abortSignal

> **abortSignal**: `AbortSignal`

***

### AgentAdapter

**`Stable`**

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

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

###### Parameters

###### action

`TAction`

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

##### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

##### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

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

###### Parameters

###### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`RunRecord`[]

***

### BackendErrorDetail

**`Stable`**

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

#### Properties

##### kind

> **kind**: `"backend"` \| `"transport"`

`'transport'` — upstream HTTP / network failure with optional status code.
`'backend'` — the backend's `stream()` generator threw for a non-transport
reason (e.g. a custom adapter error, sandbox crash).

##### message

> **message**: `string`

##### status?

> `optional` **status?**: `number`

Upstream HTTP status when known. `0` for connection / abort errors.

##### body?

> `optional` **body?**: `string`

Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed.

***

### OpenAIChatTool

**`Stable`**

OpenAI Chat Completions tool descriptor. The shape mirrors the
`/v1/chat/completions` `tools[]` parameter so caller-owned compatible
transports can pass tool definitions without translation. A router can
proxy this shape to Anthropic
(translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
that the eval surface targets.

Callers that build their tool list from MCP servers should run a one-shot
MCP `tools/list` at config time and project the result into this shape. The
runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
keeping the backend transport thin lets domain repos own MCP plumbing.

#### Properties

##### type

> **type**: `"function"`

##### function

> **function**: `object`

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSession

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### backend

> **backend**: `string`

##### status

> **status**: `"completed"` \| `"aborted"` \| `"failed"` \| `"active"`

##### resumeToken?

> `optional` **resumeToken?**: `string`

##### createdAt

> **createdAt**: `string`

##### updatedAt

> **updatedAt**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSessionStore

**`Stable`**

#### Methods

##### get()

> **get**(`sessionId`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession) \| `undefined`\> \| `undefined`

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession) \| `undefined`\> \| `undefined`

##### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### Returns

`void` \| `Promise`\<`void`\>

##### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

***

### AgentBackendInput

**`Stable`**

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### message?

> `optional` **message?**: `string`

##### messages?

> `optional` **messages?**: `object`[]

###### role

> **role**: `string`

###### content

> **content**: `string`

##### parts?

> `optional` **parts?**: `InputPart`[]

##### interactions?

> `optional` **interactions?**: `Readonly`\<`Record`\<`string`, `boolean` \| `undefined`\>\>

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

***

### AgentBackendContext

**`Stable`**

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### session

> **session**: [`RuntimeSession`](#runtimesession)

##### signal?

> `optional` **signal?**: `AbortSignal`

##### runId?

> `optional` **runId?**: `string`

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

##### turnId?

> `optional` **turnId?**: `string`

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.

***

### AgentExecutionBackend

**`Stable`**

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### kind

> **kind**: `string`

#### Methods

##### start()?

> `optional` **start**(`input`, `context`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### Parameters

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\> & `object`

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

##### resume()?

> `optional` **resume**(`session`, `input`, `context`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\>

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

##### stream()

> **stream**(`input`, `context`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

###### Parameters

###### input

`TInput`

###### context

[`AgentBackendContext`](#agentbackendcontext)

###### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

##### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### reason

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### RunAgentTaskStreamOptions

**`Stable`**

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

##### input?

> `optional` **input?**: `Omit`\<`TInput`, `"task"`\>

##### knowledge?

> `optional` **knowledge?**: [`AgentKnowledgeProvider`](#agentknowledgeprovider)

##### sessionStore?

> `optional` **sessionStore?**: [`RuntimeSessionStore`](#runtimesessionstore)

##### sessionId?

> `optional` **sessionId?**: `string`

##### resume?

> `optional` **resume?**: `boolean`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### minimumReadinessScore?

> `optional` **minimumReadinessScore?**: `number`

***

### RunAgentTaskOptions

**`Stable`**

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

##### adapter

> **adapter**: [`AgentAdapter`](#agentadapter)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### knowledge?

> `optional` **knowledge?**: [`AgentKnowledgeProvider`](#agentknowledgeprovider)

##### onEvent?

> `optional` **onEvent?**: [`AgentRuntimeEventSink`](#agentruntimeeventsink)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### store?

> `optional` **store?**: `TraceStore`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### projectId?

> `optional` **projectId?**: `string`

##### variantId?

> `optional` **variantId?**: `string`

##### minimumReadinessScore?

> `optional` **minimumReadinessScore?**: `number`

***

### AgentTaskRunResult

**`Stable`**

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

##### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### questions

> **questions**: `UserQuestion`[]

##### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

##### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

##### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

##### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### runRecords

> **runRecords**: `RunRecord`[]

***

### KnowledgeReadinessDecision

**`Stable`**

#### Properties

##### passed

> **passed**: `boolean`

##### status

> **status**: `"blocked"` \| `"ready"` \| `"caveat"`

##### reason

> **reason**: `string`

##### readinessScore

> **readinessScore**: `number`

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

##### severity

> **severity**: `ControlSeverity`

##### blockingGapIds

> **blockingGapIds**: `string`[]

##### nonBlockingGapIds

> **nonBlockingGapIds**: `string`[]

## Type Aliases

### AgentCandidateProfileSource

> **AgentCandidateProfileSource** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"profile-diffs"`; `base`: `AgentProfile`; `diffs`: readonly `AgentProfileDiff`[]; \} \| \{ `kind`: `"candidate-profile"`; `profile`: `AgentCandidateProfile`; \}

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

Explicit control/no-op code or one finalized CodeSurface whose bytes must still verify.

***

### AgentCandidateBundleInput

> **AgentCandidateBundleInput** = `Omit`\<`AgentCandidateBundle`, `"digest"`\>

Exact candidate wire shape before the runtime computes its canonical digest.

***

### AgentCandidateExecutionFailureClass

> **AgentCandidateExecutionFailureClass** = `"pre-model-infrastructure"` \| `"execution"` \| `"post-model-infrastructure"` \| `"unknown"`

Only the first class is retryable, and only when the closed model ledger has zero calls.

***

### AgentCandidateExecutionTerminalResult

> **AgentCandidateExecutionTerminalResult** = \{ `status`: `"succeeded"`; `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \} \| \{ `status`: `"failed"`; `failureClass`: [`AgentCandidateExecutionFailureClass`](#agentcandidateexecutionfailureclass); `usage`: `AgentCandidateFixedSpend`; `modelSettlement`: `AgentCandidateArtifactRef`; `failureEvidence?`: `AgentCandidateArtifactRef`; \}

Evaluator-owned terminal facts staged durably before the terminal CAS.

***

### AgentCandidateExecutionTerminalRecord

> **AgentCandidateExecutionTerminalRecord** = [`AgentCandidateExecutionTerminalResult`](#agentcandidateexecutionterminalresult) & `object`

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

Monotonic durable phase: the second value means candidate code could have started.

***

### AgentCandidateExecutionClaimResult

> **AgentCandidateExecutionClaimResult** = \{ `acquired`: `true`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `lease`: [`AgentCandidateExecutionLease`](#agentcandidateexecutionlease); \} \| \{ `acquired`: `false`; `reason`: `"already-claimed"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `exactReplay`: `boolean`; \} \| \{ `acquired`: `false`; `reason`: `"retry-not-eligible"`; `claim`: [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim); `detail`: [`AgentCandidateRetryRejection`](#agentcandidateretryrejection); \}

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

Result of durably staging the one immutable terminal outbox entry.

***

### AgentCandidateExecutionPhaseResult

> **AgentCandidateExecutionPhaseResult** = \{ `marked`: `true`; `phase`: `"candidate-may-run"`; \} \| \{ `marked`: `false`; `phase`: `"candidate-may-run"`; \}

Result of crossing the irreversible candidate-may-run boundary.

***

### AgentCandidateRetryRejection

> **AgentCandidateRetryRejection** = `"prior-attempt-missing"` \| `"prior-attempt-running"` \| `"prior-attempt-succeeded"` \| `"prior-attempt-spent-model-calls"` \| `"prior-attempt-not-pre-model-infrastructure"` \| `"retry-lineage-mismatch"`

***

### AgentCandidateModelGrantRunReservationInput

> **AgentCandidateModelGrantRunReservationInput** = `Omit`\<[`AgentCandidateModelGrantReserveInput`](#agentcandidatemodelgrantreserveinput), `"resolved"`\>

Reservation fields supplied by a caller before Runtime resolves the model.

***

### AgentCandidateModelGrantReserveInput

> **AgentCandidateModelGrantReserveInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"reserveGrant"`\]\>\[`0`\]

***

### AgentCandidateModelGrantActivateInput

> **AgentCandidateModelGrantActivateInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"activateGrant"`\]\>\[`0`\]

***

### AgentCandidateModelGrantSettleInput

> **AgentCandidateModelGrantSettleInput** = `Parameters`\<[`AgentCandidateModelPort`](#agentcandidatemodelport)\[`"settleGrant"`\]\>\[`0`\]

***

### AgentCandidateModelGrantReservation

> **AgentCandidateModelGrantReservation** = [`AgentCandidateProtectedModelReservation`](#agentcandidateprotectedmodelreservation)

Secret-free response from the service's reservation endpoint.

***

### AgentCandidateOutputPurpose

> **AgentCandidateOutputPurpose** = `"execution-plan"` \| `"materialization-receipt"` \| `"candidate-workspace-manifest"` \| `"candidate-workspace-archive"` \| `"task-manifest"` \| `"task-archive"` \| `"task-patch"` \| `"task-output"` \| `"task-outcome"` \| `"memory-after-manifest"` \| `"memory-after-archive"` \| `"grader-evidence"` \| `"benchmark-result"` \| `"model-settlement"` \| `"trace"` \| `"executor-native-evidence"` \| `"executor-capture"` \| `"run-receipt"` \| `"knowledge-retrieval-config"` \| `"knowledge-evaluation"` \| `"failure-evidence"`

***

### AgentCandidateModelLimits

> **AgentCandidateModelLimits** = `Pick`\<`AgentCandidateExecutionLimits`, `"maxModelCalls"` \| `"maxInputTokens"` \| `"maxOutputTokens"` \| `"maxCostUsd"`\> & `object`

Limits mechanically enforced by the evaluator-owned model gateway.

#### Type Declaration

##### maxTotalTokens?

> `optional` **maxTotalTokens?**: `number`

Optional caller-declared cap across input and output tokens.

***

### AgentCandidateProtectedModelSettlementCall

> **AgentCandidateProtectedModelSettlementCall** = `AgentCandidateModelSettlementCall` & `object`

Protected-port wire call with the gateway's counted input total preserved.

#### Type Declaration

##### accountedInputTokens

> **accountedInputTokens**: `number`

***

### AgentCandidateExecutorTaskOutcomeCapture

> **AgentCandidateExecutorTaskOutcomeCapture** = \{ `kind`: `"workspace"`; `resultTree`: `string`; `afterState`: `AgentCandidateWorkspaceManifestMaterial`; `archive`: `Uint8Array`; `gitDiff`: `Uint8Array`; \} \| \{ `kind`: `"output"`; `bytes`: `Uint8Array`; \}

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

### PersistedTaskOutcomeEvidence

> **PersistedTaskOutcomeEvidence**\<`Kind`\> = `Omit`\<`AgentCandidateTaskOutcomeEvidence`, `"material"`\> & `object`

Immutable evaluator evidence retained with a verified candidate task outcome.

#### Type Declaration

##### artifact

> `readonly` **artifact**: `AgentCandidateArtifactRef`

##### material

> `readonly` **material**: `Omit`\<`AgentCandidateTaskOutcomeMaterial`, `"outcome"`\> & `object`

###### Type Declaration

###### outcome

> `readonly` **outcome**: `Extract`\<`AgentCandidateTaskOutcomeMaterial`\[`"outcome"`\], \{ `kind`: `Kind`; \}\>

#### Type Parameters

##### Kind

`Kind` *extends* `AgentCandidateTaskOutcomeMaterial`\[`"outcome"`\]\[`"kind"`\]

***

### VerifiedAgentCandidateTaskOutcome

> **VerifiedAgentCandidateTaskOutcome** = \{ `kind`: `"workspace"`; `evidence`: [`PersistedTaskOutcomeEvidence`](#persistedtaskoutcomeevidence)\<`"workspace"`\>; `patch`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \} \| \{ `kind`: `"output"`; `evidence`: [`PersistedTaskOutcomeEvidence`](#persistedtaskoutcomeevidence)\<`"output"`\>; `spec`: `AgentCandidateTaskOutputSpec`; `bytes`: `Uint8Array`; `[verifiedTaskOutcomeBrand]`: `true`; \}

Branded task outcome that has survived independent evaluator verification.

***

### AgentCandidateRunFinalization

> **AgentCandidateRunFinalization** = \{ `succeeded`: `true`; `receipt`: [`CanonicalCandidateDocument`](#canonicalcandidatedocument)\<`AgentCandidateRunReceipt`\>; `artifacts`: \{ `executorCapture`: `AgentCandidateArtifactRef`; `modelSettlement`: `AgentCandidateArtifactRef`; `taskOutcome`: `AgentCandidateArtifactRef`; `benchmarkResult`: `AgentCandidateArtifactRef`; `runReceipt`: `AgentCandidateArtifactRef`; \}; \} \| \{ `succeeded`: `false`; `reason`: `string`; `partial`: \{ `executionId`: `string`; `bundleDigest`: `Sha256Digest`; `executionPlanDigest`: `Sha256Digest`; `materializationReceiptDigest`: `Sha256Digest`; `termination?`: `AgentCandidateTermination`; \}; `usage`: `AgentCandidateFixedSpend` \| `null`; \}

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

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

#### Parameters

##### err

`unknown`

#### Returns

`boolean`

***

### RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.

***

### ForwardHeaderName

> **ForwardHeaderName** = *typeof* [`FORWARD_HEADERS`](#forward_headers)\[keyof *typeof* [`FORWARD_HEADERS`](#forward_headers)\]

***

### PropagatedHeaders

> **PropagatedHeaders** = `Readonly`\<`Record`\<`string`, `string`\>\>

Header bag carried through `AgentBackendContext.propagatedHeaders` so
backends that opt in can merge them into their outbound HTTP requests.
Distinct from `buildForwardHeaders` so callers can attach extra
non-protocol headers (e.g. tracing) without colliding.

***

### PersonaDriver

> **PersonaDriver** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"scripted"`; `turns`: `string`[]; \}

A persona that drives the conversation: either a full driver `AgentProfile`
 (an LLM user-sim) or a deterministic script of user turns (the fast-path).

***

### AuthSource

> **AuthSource** = `"forward-user"` \| `"agent-owned"` \| ((`state`) => `"forward-user"` \| `"agent-owned"`)

**`Stable`**

***

### TurnOrder

> **TurnOrder** = `"alternate"` \| `"round-robin"` \| ((`state`) => `number`)

**`Stable`**

***

### HaltPredicate

> **HaltPredicate** = (`ctx`) => `boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

**`Stable`**

#### Parameters

##### ctx

[`HaltContext`](#haltcontext)

#### Returns

`boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

***

### HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

**`Stable`**

***

### ConversationStreamEvent

> **ConversationStreamEvent** = \{ `type`: `"conversation_start"`; `runId`: `string`; `participants`: readonly `string`[]; `seed`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"conversation_resumed"`; `runId`: `string`; `participants`: readonly `string`[]; `transcript`: readonly [`ConversationTurn`](#conversationturn)[]; `timestamp`: `string`; \} \| \{ `type`: `"turn_start"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `timestamp`: `string`; \} \| \{ `type`: `"turn_text_delta"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"turn_retry"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_end"`; `runId`: `string`; `turn`: [`ConversationTurn`](#conversationturn); `timestamp`: `string`; \} \| \{ `type`: `"conversation_end"`; `runId`: `string`; `result`: [`ConversationResult`](#conversationresult); `timestamp`: `string`; \}

**`Stable`**

***

### Verifier

> **Verifier** = (`worktreePath`, `signal?`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

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

> **AgenticGeneratorShotExecution** = `Readonly`\<[`CollectedAgentTurn`](runtime.md#collectedagentturn)\>

Runtime's exact terminal turn plus its complete normalized event stream.

***

### AgenticGeneratorShotDisposition

> **AgenticGeneratorShotDisposition** = \{ `kind`: `"clean"`; `worktreePath`: `string`; \} \| \{ `kind`: `"rejected"`; `worktreePath`: `string`; `stage`: `"raw-trace-evidence"` \| `"verification"`; `feedback`: `string` \| `null`; \} \| \{ `kind`: `"accepted"`; `worktreePath`: `string`; `verified`: `boolean`; \} \| \{ `kind`: `"setup-error"`; `worktreePath`: `string`; `stage`: `"worktree-inspection"` \| `"raw-trace-evidence"` \| `"verification"`; `error`: \{ `name`: `string`; `message`: `string`; \}; \}

Worktree decision emitted before a completed shot is retried, accepted, or
 discarded. The callback runs while `worktreePath` is still available, so
 callers can persist the exact diff.

***

### AgenticGeneratorExecutorForWorktree

> **AgenticGeneratorExecutorForWorktree** = (`worktreePath`) => [`ExecutorConfig`](runtime.md#executorconfig)

`@tangle-network/agent-runtime` improvement.

The public entry point is `improve()`. Complete agent-eval methods optimize
profile surfaces. Runtime owns only code candidates that mutate an isolated
git worktree through a pluggable `CandidateGenerator`.

#### Parameters

##### worktreePath

`string`

#### Returns

[`ExecutorConfig`](runtime.md#executorconfig)

***

### ImproveSurface

> **ImproveSurface** = `Exclude`\<`AgentImprovementSurface`, `"knowledge"`\>

The executable agent lever `improve` optimizes — every surface a proposal can name
(`AgentImprovementSurface`) except `knowledge`, which the corpus lane owns and `improve`
does not produce. Deriving it means every surface `improve` produces can also be reported, which
is the property that lets a result reach a review or a gate.

Profile fields remain portable AgentProfile coordinates; implementation and orchestration files
use the code surface so a winner can be sealed into an exact candidate. `rollout-policy` is the
inference-time structuralRollout dials (`profile.extensions['structural-rollout']`).

***

### ImproveProfileSurface

> **ImproveProfileSurface** = `Exclude`\<[`ImproveSurface`](#improvesurface), `"code"`\>

***

### ImproveMethodFactory

> **ImproveMethodFactory**\<`TScenario`, `TArtifact`\> = (`context`) => `OptimizationMethod`\<`TScenario`, `TArtifact`\>

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

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveProfileAgent

> **ImproveProfileAgent**\<`TScenario`, `TArtifact`\> = (`profile`, `scenario`, `ctx`) => `Promise`\<`TArtifact`\>

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

### ImproveCandidateValidator

> **ImproveCandidateValidator** = (`input`) => `void`

#### Parameters

##### input

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput)

#### Returns

`void`

***

### ImproveOptimizationRunOptions

> **ImproveOptimizationRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`NonNullable`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>\[`"optimizationRunOptions"`\]\>, `"dispatchRef"`\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveMethodOptions

> **ImproveMethodOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>, `"baselineSurface"` \| `"dispatchRef"` \| `"dispatchWithSurface"` \| `"methods"` \| `"optimizationConcurrency"` \| `"optimizationRunOptions"`\> & `object`

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

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Reject a materialized profile before it reaches the agent callback.

##### findings?

> `optional` **findings?**: `ReadonlyArray`\<`ProposalFinding`\>

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

Runtime-owned code search in isolated git worktrees.

#### Type Declaration

##### surface

> **surface**: `"code"`

##### budget?

> `optional` **budget?**: `Omit`\<`SelfImproveBudget`, `"selectionFraction"`\>

Local code-search budget. Method-only selection controls do not apply.

##### findings?

> `optional` **findings?**: `ReadonlyArray`\<`ProposalFinding`\>

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

The canonical improvement API: complete methods for profiles, worktrees for code.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveCodeOptions

> **ImproveCodeOptions** = [`ImproveCodeBaseOptions`](#improvecodebaseoptions) & [`ImproveRuntimeCodeGeneratorOptions`](#improveruntimecodegeneratoroptions) \| [`ImproveCustomCodeGeneratorOptions`](#improvecustomcodegeneratoroptions)

***

### ImprovementProfilePopulationLineage

> **ImprovementProfilePopulationLineage** = \{ `status`: `"available"`; `artifact`: [`ImprovementProfilePopulationArtifactSource`](#improvementprofilepopulationartifactsource); `nodes`: readonly [`ImprovementProfilePopulationLineageNode`](#improvementprofilepopulationlineagenode)[]; \} \| \{ `status`: `"unavailable"`; `reason`: `"optimizer-did-not-report-candidate-lineage"`; \}

***

### ImprovementProfilePopulationCandidate

> **ImprovementProfilePopulationCandidate** = [`ImprovementMaterializedProfilePopulationCandidate`](#improvementmaterializedprofilepopulationcandidate) \| [`ImprovementRefusedProfilePopulationCandidate`](#improvementrefusedprofilepopulationcandidate)

***

### ImprovementProfileCandidatePopulation

> **ImprovementProfileCandidatePopulation** = [`ImprovementProfileCandidatePopulationAvailable`](#improvementprofilecandidatepopulationavailable) \| [`ImprovementProfileCandidatePopulationUnavailable`](#improvementprofilecandidatepopulationunavailable)

***

### ImprovementCandidate

> **ImprovementCandidate** = [`ImprovementProfileCandidate`](#improvementprofilecandidate) \| [`ImprovementCodeCandidate`](#improvementcodecandidate)

***

### ImproveResult

> **ImproveResult**\<`TScenario`, `TArtifact`\> = [`ImproveMethodResult`](#improvemethodresult) \| [`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### OfficialGepaOptions

> **OfficialGepaOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`GepaOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Official GEPA configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### OfficialSkillOptOptions

> **OfficialSkillOptOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SkillOptOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Official SkillOpt configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### ProfileImprovementHarnessRunOptions

> **ProfileImprovementHarnessRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\>, `"executionRef"` \| `"agent"` \| `"validateCandidate"`\> & `object`

#### Type Declaration

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Override the harness-level validator for this run.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### DeepReadonly

> **DeepReadonly**\<`T`\> = `T` *extends* (...`args`) => `unknown` ? `T` : `T` *extends* readonly infer TItem[] ? readonly [`DeepReadonly`](#deepreadonly)\<`TItem`\>[] : `T` *extends* `object` ? `{ readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }` : `T`

#### Type Parameters

##### T

`T`

***

### ReadonlyAgentProfile

> **ReadonlyAgentProfile** = [`DeepReadonly`](#deepreadonly)\<`AgentProfile`\>

Complete immutable profile value used during measured execution.

***

### KnowledgeReadinessCheckResult

> **KnowledgeReadinessCheckResult** = `boolean` \| \{ `ready`: `boolean`; `summary?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; \}

***

### KnowledgeReadinessCheck

> **KnowledgeReadinessCheck** = (`input`) => `Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

#### Parameters

##### input

[`KnowledgeReadinessCheckInput`](#knowledgereadinesscheckinput)

#### Returns

`Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

***

### SupervisedKnowledgeUpdater

> **SupervisedKnowledgeUpdater** = (`input`) => `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

#### Parameters

##### input

[`SupervisedKnowledgeUpdateInput`](#supervisedknowledgeupdateinput)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### DelegatedLoopMode

> **DelegatedLoopMode** = *typeof* [`DELEGATED_LOOP_MODES`](#delegated_loop_modes)\[`number`\]

**`Experimental`**

***

### DelegatedLoopRunner

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

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

**`Experimental`**

Mode → configured runner. Partial: only register the modes a
 given product/routine actually uses.

***

### CoordinationEvent

> **CoordinationEvent** = \{ `type`: `"question"`; `question`: [`QuestionRecord`](mcp.md#questionrecord); \} \| \{ `type`: `"settled"`; `worker`: [`SettledWorker`](mcp.md#settledworker); \} \| \{ `type`: `"finding"`; `finding`: [`AnalystFindingEvent`](runtime.md#analystfindingevent); \} \| \{ `type`: `"steer"`; `down`: [`DownMessageEvent`](runtime.md#downmessageevent); `analyst?`: `string`; \} \| \{ `type`: `"answer"`; `down`: [`DownMessageEvent`](runtime.md#downmessageevent); `questionId`: `string`; \} \| \{ `type`: `"instruction"`; `instruction`: [`ContinuationInstruction`](runtime.md#continuationinstruction); \} \| \{ `type`: `"delivery-attempt"`; `attempt`: [`DownMessageDeliveryAttempt`](runtime.md#downmessagedeliveryattempt); \} \| \{ `type`: `"mail"`; `mail`: [`PeerMailEvent`](runtime.md#peermailevent); \}

Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 the driver to `pull`. An `instruction` is the pre-delivery authorization receipt and is retained
 as evidence. DOWN (parent→child): steer / answer — record-only (history + subscribers), routed
 to the child inbox. SIDEWAYS (child→sibling): mail — also record-only, and deliberately NOT
 queued, so peer traffic audits through the parent without flooding the inbox it pulls from.
 Receipts are never auto-delivered on restart. New kinds are additive.

#### Union Members

##### Type Literal

\{ `type`: `"question"`; `question`: [`QuestionRecord`](mcp.md#questionrecord); \}

***

##### Type Literal

\{ `type`: `"settled"`; `worker`: [`SettledWorker`](mcp.md#settledworker); \}

***

##### Type Literal

\{ `type`: `"finding"`; `finding`: [`AnalystFindingEvent`](runtime.md#analystfindingevent); \}

***

##### Type Literal

\{ `type`: `"steer"`; `down`: [`DownMessageEvent`](runtime.md#downmessageevent); `analyst?`: `string`; \}

###### type

> `readonly` **type**: `"steer"`

###### down

> `readonly` **down**: [`DownMessageEvent`](runtime.md#downmessageevent)

###### analyst?

> `readonly` `optional` **analyst?**: `string`

Present when this steer DELIVERED an analyst's routed findings (an analyzes-edge
 traversal), naming the lens — absent on an ordinary driver-authored steer.

***

##### Type Literal

\{ `type`: `"answer"`; `down`: [`DownMessageEvent`](runtime.md#downmessageevent); `questionId`: `string`; \}

***

##### Type Literal

\{ `type`: `"instruction"`; `instruction`: [`ContinuationInstruction`](runtime.md#continuationinstruction); \}

***

##### Type Literal

\{ `type`: `"delivery-attempt"`; `attempt`: [`DownMessageDeliveryAttempt`](runtime.md#downmessagedeliveryattempt); \}

***

##### Type Literal

\{ `type`: `"mail"`; `mail`: [`PeerMailEvent`](runtime.md#peermailevent); \}

***

### WorktreeCheckRunner

> **WorktreeCheckRunner** = (`opts`) => `Promise`\<\{ `exitCode`: `number` \| `null`; `output`: `string`; \}\>

The single shell-command-in-worktree runner seam (replaces the per-executor copies).

#### Parameters

##### opts

###### command

`string`

###### cwd

`string`

###### timeoutMs

`number`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<\{ `exitCode`: `number` \| `null`; `output`: `string`; \}\>

***

### ChatModelValidation

> **ChatModelValidation** = \{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

***

### RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.

A `pursuitId` is deliberately orthogonal to `runId`: a pursuit can span many
resumed/retried/forked runs while every event remains attributable to the
durable objective that caused it. The observer plane is outside the agent
environment and must never be required for agent correctness.

***

### RuntimeHookTarget

> **RuntimeHookTarget** = `"agent.run"` \| `"agent.turn"` \| `"agent.tool_call"` \| `"agent.spawn"` \| `"agent.child"` \| `"agent.plan"` \| `"agent.decision"` \| `string` & `object`

***

### RuntimeDecisionKind

> **RuntimeDecisionKind** = `"continue"` \| `"verify"` \| `"ask"` \| `"retry"` \| `"stop"` \| `"memory-write"` \| `"memory-read"` \| `"tool-select"` \| `"skill-select"` \| `"workflow-select"` \| `"surface-promote"` \| `string` & `object`

***

### RuntimeRunStatus

> **RuntimeRunStatus** = `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

**`Stable`**

***

### SupervisorFinalizer

> **SupervisorFinalizer** = (`ctx`) => `Promise`\<`unknown` \| `undefined`\> \| `unknown` \| `undefined`

The finalization seam: ledger in, output (or `undefined` = nothing deliverable) out.

#### Parameters

##### ctx

[`FinalizeContext`](#finalizecontext)

#### Returns

`Promise`\<`unknown` \| `undefined`\> \| `unknown` \| `undefined`

***

### WorkerTraceUnavailableReason

> **WorkerTraceUnavailableReason** = `"execution-did-not-start"` \| `"executor-did-not-expose-trace-source"` \| `"trace-source-unavailable"` \| `"no-tool-spans-captured"` \| `"invalid-tool-spans"` \| `"trace-collection-failed"` \| `"trace-persistence-failed"` \| `"legacy-settlement-without-trace-evidence"` \| `"not-an-executor"`

Why Runtime cannot provide structured tool-call evidence for one settled execution.

***

### WorkerTraceEvidence

> **WorkerTraceEvidence** = \{ `status`: `"available"`; `traceRef`: `string`; `spanCount`: `number`; \} \| \{ `status`: `"unavailable"`; `reason`: [`WorkerTraceUnavailableReason`](#workertraceunavailablereason); \}

Durable proof of a worker's structured tool trace, or the exact reason it is unavailable.

#### Union Members

##### Type Literal

\{ `status`: `"available"`; `traceRef`: `string`; `spanCount`: `number`; \}

###### status

> `readonly` **status**: `"available"`

###### traceRef

> `readonly` **traceRef**: `string`

Content-addressed pointer to a persisted `WorkerToolTraceArtifact`.

###### spanCount

> `readonly` **spanCount**: `number`

***

##### Type Literal

\{ `status`: `"unavailable"`; `reason`: [`WorkerTraceUnavailableReason`](#workertraceunavailablereason); \}

***

### Settled

> **Settled**\<`Out`\> = \{ `kind`: `"done"`; `handle`: [`Handle`](runtime.md#handle-3)\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `trace`: [`WorkerTraceEvidence`](#workertraceevidence); `settledAt?`: `number`; `seq`: `number`; \} \| \{ `kind`: `"down"`; `handle`: [`Handle`](runtime.md#handle-3)\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `trace`: [`WorkerTraceEvidence`](#workertraceevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `settledAt?`: `number`; `seq`: `number`; \}

A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order
`next()` yielded this settlement (B2) — NOT wall-clock — and replay delivers strictly
in `seq` order. `outRef` rehydrates `out` from the `ResultBlobStore` on replay.

#### Type Parameters

##### Out

`Out`

#### Union Members

##### Type Literal

\{ `kind`: `"done"`; `handle`: [`Handle`](runtime.md#handle-3)\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `trace`: [`WorkerTraceEvidence`](#workertraceevidence); `settledAt?`: `number`; `seq`: `number`; \}

###### kind

> **kind**: `"done"`

###### handle

> **handle**: [`Handle`](runtime.md#handle-3)\<`Out`\>

###### out

> **out**: `Out`

###### outRef

> **outRef**: `string`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](#spend)

###### providerModel?

> `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Provider model evidence for every inference attempt owned by this node.

###### trace

> **trace**: [`WorkerTraceEvidence`](#workertraceevidence)

Structured tool evidence captured before this settlement was journaled.

###### settledAt?

> `optional` **settledAt?**: `number`

Epoch ms parsed from the durable settlement record when available.

###### seq

> **seq**: `number`

***

##### Type Literal

\{ `kind`: `"down"`; `handle`: [`Handle`](runtime.md#handle-3)\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `trace`: [`WorkerTraceEvidence`](#workertraceevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `settledAt?`: `number`; `seq`: `number`; \}

###### kind

> **kind**: `"down"`

###### handle

> **handle**: [`Handle`](runtime.md#handle-3)\<`Out`\>

###### reason

> **reason**: `string`

###### infra

> **infra**: `boolean`

True = infrastructure failure (excluded from merge `n` / equal-k), not a bad result.

###### trace

> **trace**: [`WorkerTraceEvidence`](#workertraceevidence)

Partial structured tool evidence captured before this failure was journaled.

###### providerModel?

> `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Partial provider model evidence survives an aborted or failed execution.

###### settledAt?

> `optional` **settledAt?**: `number`

Epoch ms parsed from the durable settlement/cancellation record when available.

###### seq

> **seq**: `number`

***

### RootProviderModelEvidence

> **RootProviderModelEvidence** = [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Provider-observed model identity for the root manager's settled inference turns.
Runtime records this only from a Runtime-owned provider/bridge receipt; an authored profile
alias is never substituted when the provider omits the identity.

***

### ProviderModelExecutionEvidence

> **ProviderModelExecutionEvidence** = \{ `status`: `"known"`; `attempts`: `ReadonlyArray`\<[`ProviderModelAttemptEvidence`](#providermodelattemptevidence)\>; `models`: `ReadonlyArray`\<`string`\>; \} \| \{ `status`: `"unknown"`; `attempts`: `ReadonlyArray`\<[`ProviderModelAttemptEvidence`](#providermodelattemptevidence)\>; `models`: `ReadonlyArray`\<`string`\>; `reason`: `"provider-model-missing"` \| `"provider-model-conflict"`; \}

Durable provider identity evidence, independent from the planned materialization alias.

***

### SpendChannel

> **SpendChannel** = `"tokens"` \| `"usd"`

The accounting channels a usage gap leaves incomplete.

***

### SupervisedResult

> **SupervisedResult**\<`Out`\> = \{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `spentBreakdown?`: \{ `driverInference`: [`Spend`](#spend); `childWork`: [`Spend`](#spend); \}; \} \| \{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `error?`: `never`; \} \| \{ `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \}

Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output.

#### Type Parameters

##### Out

`Out`

#### Union Members

##### Type Literal

\{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `spentBreakdown?`: \{ `driverInference`: [`Spend`](#spend); `childWork`: [`Spend`](#spend); \}; \}

###### kind

> **kind**: `"winner"`

###### out

> **out**: `Out`

###### outRef

> **outRef**: `string`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### tree

> **tree**: [`TreeView`](runtime.md#treeview)

###### spentTotal

> **spentTotal**: [`Spend`](#spend)

The run's terminal accounting. `iterations`/`tokens`/`usd` are per-channel journal sums;
 `ms` is the wall clock from supervise start (the ORIGINAL root instant on a resumed run)
 to this terminal state — executors under-report their own `ms` and parallel children
 overlap, so a per-event sum cannot state the run's real duration. `tokensKnown`/`usdKnown`
 are always explicit here: `true` is the checked claim that every spawn reached a terminal
 record and every settled/metered record carried a complete receipt on that channel;
 `false` comes with the unaccounted nodes named in `spendGaps`.

###### rootProviderModel?

> `readonly` `optional` **rootProviderModel?**: [`RootProviderModelEvidence`](#rootprovidermodelevidence)

Runtime-owned provider evidence for the root manager, when the root executed inference.

###### providerModel?

> `readonly` `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Runtime-owned provider evidence reduced across the complete journal forest.

###### teardownUnconfirmed?

> `optional` **teardownUnconfirmed?**: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>

Settled children whose executor teardown was never acknowledged — the resources this run
 could not prove destroyed. Their capacity slots stay charged for the rest of the run, and
 each is journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a
 healthy run never carries it.

###### spendGaps?

> `optional` **spendGaps?**: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>

The journaled nodes whose usage accounting is incomplete — the named gaps behind a
 `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty.

###### spentBreakdown?

> `optional` **spentBreakdown?**: `object`

Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
 `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
 `driverInference + childWork === spentTotal` on `iterations`/`tokens`/`usd`; the
 breakdown's `ms` fields stay executor-reported sums while `spentTotal.ms` is wall clock.
 Present whenever any driver metered.

###### spentBreakdown.driverInference

> **driverInference**: [`Spend`](#spend)

###### spentBreakdown.childWork

> **childWork**: [`Spend`](#spend)

***

##### Type Literal

\{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `error?`: `never`; \}

###### kind

> **kind**: `"no-winner"`

The LIFECYCLE no-winner arms: the supervisor itself proved why nothing was delivered, so
the reason is complete on its own and there is no driver rejection to hand back. A tripped
breaker or a real `down` child is `all-children-down`, a cascaded abort is `aborted`, an
empty pool is `budget-exhausted`. These outrank `driver-failed`: when the driver threw
BECAUSE the pool emptied or the run was aborted, the lifecycle cause is the explanation.

###### reason

> **reason**: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`

###### tree

> **tree**: [`TreeView`](runtime.md#treeview)

###### downCount

> **downCount**: `number`

###### spentTotal

> **spentTotal**: [`Spend`](#spend)

The conserved spend incurred before the run failed — real cost is paid even when no
 worker delivers, so the caller always learns what the delegation actually spent. Summed
 off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
 explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`.

###### rootProviderModel?

> `readonly` `optional` **rootProviderModel?**: [`RootProviderModelEvidence`](#rootprovidermodelevidence)

Runtime-owned provider evidence for the root manager, when the root executed inference.

###### providerModel?

> `readonly` `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Runtime-owned provider evidence reduced across the complete journal forest.

###### teardownUnconfirmed?

> `optional` **teardownUnconfirmed?**: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>

Settled children whose executor teardown was never acknowledged — the resources this run
 could not prove destroyed. Their capacity slots stay charged for the rest of the run, and
 each is journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a
 healthy run never carries it.

###### spendGaps?

> `optional` **spendGaps?**: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>

The journaled nodes whose usage accounting is incomplete — the named gaps behind a
 `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty.

###### error?

> `optional` **error?**: `never`

Never present on a lifecycle arm — the discriminant, not prose, is what makes
 `if (r.reason === 'driver-failed') r.error.message` compile and every other arm refuse it.

***

##### Type Literal

\{ `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); `rootProviderModel?`: [`RootProviderModelEvidence`](#rootprovidermodelevidence); `providerModel?`: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence); `teardownUnconfirmed?`: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>; `spendGaps?`: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \}

###### kind

> **kind**: `"no-winner"`

The DRIVER-FAULT arm: `act()` rejected, no child ever went down, and no lifecycle cause
(breaker/abort/budget) outranks it — so nothing about the tree explains the failure and the
driver's own rejection is the only thing that does. It is therefore REQUIRED here.
`all-children-down` with `downCount: 0` used to be indistinguishable from an honest empty
result; this arm is that configuration/authoring fault, named.

###### reason

> **reason**: `"driver-failed"`

###### tree

> **tree**: [`TreeView`](runtime.md#treeview)

###### downCount

> **downCount**: `number`

###### spentTotal

> **spentTotal**: [`Spend`](#spend)

The conserved spend incurred before the run failed — real cost is paid even when no
 worker delivers, so the caller always learns what the delegation actually spent. Summed
 off the same journal the `winner` path reads, with the same contract: wall-clock `ms`,
 explicit `tokensKnown`/`usdKnown`, gaps named in `spendGaps`.

###### rootProviderModel?

> `readonly` `optional` **rootProviderModel?**: [`RootProviderModelEvidence`](#rootprovidermodelevidence)

Runtime-owned provider evidence for the root manager, when the root executed inference.

###### providerModel?

> `readonly` `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](#providermodelexecutionevidence)

Runtime-owned provider evidence reduced across the complete journal forest.

###### teardownUnconfirmed?

> `optional` **teardownUnconfirmed?**: `ReadonlyArray`\<[`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)\>

Settled children whose executor teardown was never acknowledged — the resources this run
 could not prove destroyed. Their capacity slots stay charged for the rest of the run, and
 each is journaled as a `teardown-unconfirmed` event. Present exactly when non-empty; a
 healthy run never carries it.

###### spendGaps?

> `optional` **spendGaps?**: `ReadonlyArray`\<[`SpendGap`](#spendgap)\>

The journaled nodes whose usage accounting is incomplete — the named gaps behind a
 `false` `tokensKnown`/`usdKnown` on `spentTotal`. Present exactly when non-empty.

###### error

> **error**: [`NoWinnerError`](runtime.md#nowinnererror)

The driver's own rejection, carried across the typed no-winner boundary so the failure is
 recoverable by the caller. A non-`Error` rejection is normalized, never dropped.

***

### RuntimeStreamEventSink

> **RuntimeStreamEventSink** = (`event`) => `void`

**`Stable`**

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

#### Returns

`void`

***

### AgentTaskStatus

> **AgentTaskStatus** = `"completed"` \| `"blocked"` \| `"failed"` \| `"aborted"`

**`Stable`**

***

### AgentRuntimeEvent

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; \}

**`Stable`**

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

***

### AgentRuntimeEventSink

> **AgentRuntimeEventSink**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = (`event`) => `Promise`\<`void`\> \| `void`

**`Stable`**

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

***

### OpenAIChatToolChoice

> **OpenAIChatToolChoice** = `"auto"` \| `"none"` \| `"required"` \| \{ `type`: `"function"`; `function`: \{ `name`: `string`; \}; \}

**`Stable`**

`tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
spec: `'auto'` (default — model decides), `'none'` (disable tool calling
for this turn), `'required'` (force a tool call), or a specific function
pin `{ type: 'function', function: { name } }`.

***

### OpenAIChatResponseFormat

> **OpenAIChatResponseFormat** = \{ `type`: `"text"`; \} \| \{ `type`: `"json_object"`; \} \| \{ `type`: `"json_schema"`; `json_schema`: `Record`\<`string`, `unknown`\>; \}

**`Stable`**

`response_format` parameter for OpenAI-compatible chat endpoints. Use
`json_object` when the caller needs syntactically valid JSON, or
`json_schema` when the upstream provider supports schema-constrained JSON.

***

### RuntimeCanonicalStreamEvent

> **RuntimeCanonicalStreamEvent** = `StreamEvent` & `object`

Agent Interface events that do not belong to Runtime's task vocabulary.

#### Type Declaration

##### task?

> `optional` **task?**: [`AgentTaskSpec`](#agenttaskspec)

##### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

##### timestamp?

> `optional` **timestamp?**: `string`

***

### RuntimeStreamEvent

> **RuntimeStreamEvent** = [`RuntimeCanonicalStreamEvent`](#runtimecanonicalstreamevent) \| \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: [`KnowledgeReadinessDecision`](#knowledgereadinessdecision); `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `tokensKnown?`: `false`; `costUsd?`: `number`; `usdKnown?`: `false`; `estimatedCostUsd?`: `number`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

**`Stable`**

#### Union Members

[`RuntimeCanonicalStreamEvent`](#runtimecanonicalstreamevent)

***

##### Type Literal

\{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: [`KnowledgeReadinessDecision`](#knowledgereadinessdecision); `timestamp`: `string`; \}

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

\{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp`: `string`; \}

###### type

> **type**: `"backend_start"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session

> **session**: [`RuntimeSession`](#runtimesession)

###### backend

> **backend**: `string`

###### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Canonical execution identity and materialization evidence for this turn, when Runtime
 owns the selected executor. Generic metadata keeps the event vocabulary open while the
 values use Runtime's existing identity/materialization receipt shapes.

###### timestamp

> **timestamp**: `string`

***

##### Type Literal

\{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `tokensKnown?`: `false`; `costUsd?`: `number`; `usdKnown?`: `false`; `estimatedCostUsd?`: `number`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \}

###### type

> **type**: `"llm_call"`

###### task?

> `optional` **task?**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

###### model

> **model**: `string`

###### tokensIn?

> `optional` **tokensIn?**: `number`

###### tokensOut?

> `optional` **tokensOut?**: `number`

###### tokensKnown?

> `optional` **tokensKnown?**: `false`

False when the numeric token subtotal is incomplete or absent.

###### costUsd?

> `optional` **costUsd?**: `number`

###### usdKnown?

> `optional` **usdKnown?**: `false`

False when `costUsd` is only an observed floor, estimate, or absent.

###### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Separately-labelled local/catalog estimate; never billed spend.

###### promptCache?

> `optional` **promptCache?**: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>

Provider-reported prompt-cache fields; absent fields remain unknown.

###### latencyMs?

> `optional` **latencyMs?**: `number`

###### finishReason?

> `optional` **finishReason?**: `string`

###### timestamp?

> `optional` **timestamp?**: `string`

***

##### Type Literal

\{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

###### type

> **type**: `"backend_error"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

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

\{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

###### type

> **type**: `"final"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

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

## Variables

### CANDIDATE\_KNOWLEDGE\_ROOT\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_ROOT\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_ROOT"` = `'TANGLE_CANDIDATE_KNOWLEDGE_ROOT'`

Environment variable containing the materialized candidate knowledge root.

***

### CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV

> `const` **CANDIDATE\_KNOWLEDGE\_RETRIEVAL\_CONFIG\_ENV**: `"TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG"` = `'TANGLE_CANDIDATE_KNOWLEDGE_RETRIEVAL_CONFIG'`

Environment variable containing the materialized retrieval configuration path.

***

### CANDIDATE\_TRACE\_TAGS

> `const` **CANDIDATE\_TRACE\_TAGS**: `object`

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

Surfaces admitted by Runtime's verifier before an environment adapter is selected.

***

### defaultIsRetryable

> `const` **defaultIsRetryable**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Default retryable classification — network/timeout class errors. Errors
a model deliberately throws (validation, refusal, 4xx) are not retried;
those represent real outcomes, not transient infrastructure faults.

***

### FORWARD\_HEADERS

> `const` **FORWARD\_HEADERS**: `object`

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

Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded.

***

### optimizerMethod

> `const` **optimizerMethod**: `string`

The shared method block every build/author prompt embeds. Domain framing
(what a tool/MCP/codebase-edit deliverable looks like) wraps around it; this
is the process itself.

***

### strategyAuthorMethod

> `const` **strategyAuthorMethod**: `string`

The senior authoring process for `authorStrategy` — the same method, shaped
to the strategy contract (author-blind, conserved budget, one module out).

***

### PROMPT\_INSTRUCTION\_COMPONENT\_PREFIX

> `const` **PROMPT\_INSTRUCTION\_COMPONENT\_PREFIX**: `"prompt.instruction:"` = `'prompt.instruction:'`

Stable component-name prefix used for `profile.prompt.instructions`.

***

### promptInstructionsProfileComponents

> `const` **promptInstructionsProfileComponents**: [`ImproveProfileComponents`](#improveprofilecomponents)

Canonical `ImproveProfileComponents` mapping for the ordered
`AgentProfile.prompt.instructions` list.

Use it with `surface: 'agent-profile'` when an optimizer should rewrite the
exact instruction texts without being allowed to change their count, order,
labels, or any unrelated profile field:

```ts
await improve(profile, {
  surface: 'agent-profile',
  profileComponents: promptInstructionsProfileComponents,
  // method, scenarios, judge, executionRef, agent, ...
})
```

Component names are zero-padded and stable. Runtime's existing component
materializer requires every candidate to preserve the exact key set and
verifies that `apply(read(profile))` reproduces the baseline profile. A
profile with no prompt instructions is refused rather than inventing a
sentinel instruction that could accidentally ship.

***

### ROLLOUT\_POLICY\_EXTENSION

> `const` **ROLLOUT\_POLICY\_EXTENSION**: `"structural-rollout"` = `'structural-rollout'`

The profile extensions namespace the policy persists under.

***

### RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT

> `const` **RESEARCH\_SUPERVISOR\_SYSTEM\_PROMPT**: `string`

Standing prompt for a supervisor that grows a shared knowledge base through spawned researchers.

***

### DELEGATED\_LOOP\_MODES

> `const` **DELEGATED\_LOOP\_MODES**: readonly \[`"code"`, `"review"`, `"research"`, `"audit"`, `"self-improve"`\]

**`Experimental`**

All valid delegated-loop mode names — used for validation and CLI surfaces.

***

### DEFAULT\_ROUTER\_BASE\_URL

> `const` **DEFAULT\_ROUTER\_BASE\_URL**: `"https://router.tangle.tools"` = `'https://router.tangle.tools'`

Default Tangle Router base URL used when no env override is set.

***

### INTELLIGENCE\_WIRE\_VERSION

> `const` **INTELLIGENCE\_WIRE\_VERSION**: `"2026-05-26.v1"` = `'2026-05-26.v1'`

Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body).

## Functions

### createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

**`Stable`**

Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### kind

`string`

###### start?

(`input`, `context`) => [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### resume?

(`session`, `input`, `context`) => [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### stream

(`input`, `context`) => `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

###### stop?

(`session`, `reason`) => `void` \| `Promise`\<`void`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### createSandboxPromptBackend()

> **createSandboxPromptBackend**\<`TBox`, `TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

**`Stable`**

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

***

### buildAgentCandidateBundle()

> **buildAgentCandidateBundle**(`input`): `AgentCandidateBundle`

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

Validate and content-address a candidate bundle before it crosses an approval boundary.

#### Parameters

##### input

[`AgentCandidateBundleInput`](#agentcandidatebundleinput)

#### Returns

`AgentCandidateBundle`

***

### candidateExecutionClaim()

> **candidateExecutionClaim**(`prepared`, `preparationEvidence`): [`AgentCandidateExecutionClaim`](#agentcandidateexecutionclaim)

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

Adapt one neutral exact-process provider to Runtime's trusted candidate boundary.

#### Parameters

##### options

[`ExactProcessCandidateExecutorOptions`](#exactprocesscandidateexecutoroptions)

#### Returns

[`AgentCandidateExecutorPort`](#agentcandidateexecutorport)

***

### executePreparedAgentCandidate()

> **executePreparedAgentCandidate**(`prepared`, `options`): `Promise`\<[`AgentCandidateRunFinalization`](#agentcandidaterunfinalization)\>

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

### freezeGenericAgentCandidateProfile()

> **freezeGenericAgentCandidateProfile**(`input`): `AgentCandidateProfile`

Convert only behavior-preserving generic profile fields into the closed candidate contract.

#### Parameters

##### input

`AgentProfile`

#### Returns

`AgentCandidateProfile`

***

### assertCandidateProfileBinding()

> **assertCandidateProfileBinding**(`measuredInput`, `bundled`): `void`

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

### parseExactCandidateProfile()

> **parseExactCandidateProfile**(`input`): `AgentCandidateProfile`

Parse a candidate profile without silently discarding unsupported or non-canonical fields.

#### Parameters

##### input

`unknown`

#### Returns

`AgentCandidateProfile`

***

### agentCandidateProfileAsAgentProfile()

> **agentCandidateProfileAsAgentProfile**(`candidate`): `AgentProfile`

Convert the candidate profile contract into the portable interface profile it represents.

#### Parameters

##### candidate

`AgentCandidateProfile`

#### Returns

`AgentProfile`

***

### omitUndefinedObjectFields()

> **omitUndefinedObjectFields**(`value`, `path`): `unknown`

Recursively remove undefined object fields while refusing undefined array entries.

#### Parameters

##### value

`unknown`

##### path

`string`

#### Returns

`unknown`

***

### runProtectedAgentCandidateModelGrant()

> **runProtectedAgentCandidateModelGrant**\<`TResult`\>(`options`): `Promise`\<[`RunProtectedAgentCandidateModelGrantResult`](#runprotectedagentcandidatemodelgrantresult)\<`TResult`\>\>

Run one bounded unit under a protected model grant.

Runtime owns the grant lifecycle; callers own the unit boundary and any
durable scheduling or accounting around it. A reserved grant is settled
after activation failure or callback failure, and the callback error is
preserved when settlement also fails.

#### Type Parameters

##### TResult

`TResult`

#### Parameters

##### options

[`RunProtectedAgentCandidateModelGrantOptions`](#runprotectedagentcandidatemodelgrantoptions)\<`TResult`\>

#### Returns

`Promise`\<[`RunProtectedAgentCandidateModelGrantResult`](#runprotectedagentcandidatemodelgrantresult)\<`TResult`\>\>

***

### createProtectedAgentCandidateModelPort()

> **createProtectedAgentCandidateModelPort**(`options`): [`AgentCandidateModelPort`](#agentcandidatemodelport)

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

Close an expired crashed attempt from persisted non-secret handles, then record failure.

#### Parameters

##### options

[`RecoverExpiredAgentCandidateOptions`](#recoverexpiredagentcandidateoptions)

#### Returns

`Promise`\<[`AgentCandidateExecutionFinishResult`](#agentcandidateexecutionfinishresult)\>

***

### verifyAgentCandidateBundle()

> **verifyAgentCandidateBundle**(`input`, `ports`): `Promise`\<[`VerifiedAgentCandidate`](#verifiedagentcandidate)\>

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

Create the standard bounded materializer for candidate execution ports.

#### Parameters

##### options?

[`CreateAgentCandidateWorkspacePortOptions`](#createagentcandidateworkspaceportoptions) = `{}`

#### Returns

[`AgentCandidateWorkspacePort`](#agentcandidateworkspaceport)

***

### makePerAttemptSignal()

> **makePerAttemptSignal**(`parentSignal`, `deadlineMs`): `object`

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

Resolve after `ms` milliseconds — used for retry backoff in conversation call policy.

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### createConversationBackend()

> **createConversationBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

Adapt a multi-participant conversation into the standard execution backend contract.

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

Validate and define a conversation before execution.

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

Run a conversation to completion and return its terminal result.

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

**`Stable`**

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

***

### slugifySpeaker()

> **slugifySpeaker**(`speaker`): `string`

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

### agenticGenerator()

> **agenticGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree.

#### Parameters

##### opts

[`AgenticGeneratorOptions`](#agenticgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### defaultBuildPrompt()

> **defaultBuildPrompt**(`args`): `string`

Turn proposal findings into a concrete coder task —
 the senior scientific-method framing shared with the tool/MCP build prompts.

#### Parameters

##### args

###### findings

readonly `ProposalFinding`[]

#### Returns

`string`

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

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

Render findings as the ranked-evidence block every build prompt ends with.

#### Parameters

##### findings

readonly `ProposalFinding`[]

#### Returns

`string`[]

***

### toolBuildPrompt()

> **toolBuildPrompt**(`args`): `string`

Build the starting instruction for a coder agent tasked with implementing a new tool.

#### Parameters

##### args

[`BuildPromptFindingsInput`](#buildpromptfindingsinput)

#### Returns

`string`

***

### mcpBuildPrompt()

> **mcpBuildPrompt**(`args`): `string`

Build the starting instruction for a coder agent tasked with implementing a new MCP server.

#### Parameters

##### args

[`BuildPromptFindingsInput`](#buildpromptfindingsinput)

#### Returns

`string`

***

### improve()

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `opts`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

Optimize one exact profile surface with a complete method.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

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

Optimize repository code through Runtime's isolated worktree path.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

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

Build a `Verifier` that boots a generated MCP server over stdio and checks it exposes tools.

#### Parameters

##### spec

[`McpServeSpec`](#mcpservespec)

#### Returns

[`Verifier`](#verifier)

***

### officialGepa()

> **officialGepa**\<`TScenario`, `TArtifact`\>(`options`): [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

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

### createProfileImprovementHarness()

> **createProfileImprovementHarness**\<`TScenario`, `TArtifact`\>(`options`): [`ProfileImprovementHarness`](#profileimprovementharness)\<`TScenario`, `TArtifact`\>

Bind one exact profile and executor into a repeatable self-improvement
harness. The returned `run` method remains generic over every existing
profile surface, optimization method, split, gate, and budget option.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`CreateProfileImprovementHarnessOptions`](#createprofileimprovementharnessoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ProfileImprovementHarness`](#profileimprovementharness)\<`TScenario`, `TArtifact`\>

***

### rawTraceDistiller()

> **rawTraceDistiller**\<`TScenario`, `TArtifact`\>(`options?`): (`input`) => `Promise`\<readonly `ProposalFinding`[]\>

Build an `analyzeGeneration` producer that feeds the proposer RAW-TRACE
FILESYSTEM CONTEXT — paths into the prior generation's real run traces plus a
grep/cat-to-diagnose instruction — instead of a pre-summarized digest.

Drop-in for `analyzeGeneration` on `improve({ surface: 'code' })`:

  await improve({
    surface: 'code',
    findings: seedFindings,
    code: { repoRoot, profile, executorForWorktree, buildPrompt },
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

(`input`) => `Promise`\<readonly `ProposalFinding`[]\>

***

### reflectiveGenerator()

> **reflectiveGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate.

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### parseRolloutPolicy()

> **parseRolloutPolicy**(`surface`): [`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

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

Stable serialization with fixed field order.

#### Parameters

##### policy

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy)

#### Returns

`string`

***

### structuralRolloutPolicyFromProfile()

> **structuralRolloutPolicyFromProfile**(`profile`): [`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

Read the persisted policy off the profile. `undefined` when the profile does
 not opt into structural rollout.

#### Parameters

##### profile

#### Returns

[`StructuralRolloutPolicy`](runtime.md#structuralrolloutpolicy) \| `undefined`

***

### applyRolloutPolicyToProfile()

> **applyRolloutPolicyToProfile**(`profile`, `policy`): `AgentProfile`

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

Apply or restore one local knowledge candidate through the shared activation contract.

#### Parameters

##### options

[`CreateKnowledgeImprovementActivationExecutorOptions`](#createknowledgeimprovementactivationexecutoroptions)

#### Returns

[`KnowledgeImprovementActivationExecutor`](#knowledgeimprovementactivationexecutor)

***

### createAgentKnowledgeReadinessCheck()

> **createAgentKnowledgeReadinessCheck**(`options`): [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

Build the default readiness check backed by `@tangle-network/agent-knowledge` validation and scoring.

#### Parameters

##### options

[`AgentKnowledgeReadinessCheckOptions`](#agentknowledgereadinesscheckoptions)

#### Returns

[`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

***

### runKnowledgeImprovementJob()

> **runKnowledgeImprovementJob**(`options`): `Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

Produce a frozen KB candidate while leaving live knowledge content unchanged.

#### Parameters

##### options

[`RunKnowledgeImprovementJobOptions`](#runknowledgeimprovementjoboptions)

#### Returns

`Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

***

### buildKnowledgeImprovementExperimentBundles()

> **buildKnowledgeImprovementExperimentBundles**(`bundle`, `knowledge`): [`KnowledgeImprovementExperimentBundles`](#knowledgeimprovementexperimentbundles)

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

Build the completion check a supervised KB update uses to stop only when the KB is ready.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readiness"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"readinessOptions"`\>

#### Returns

[`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

***

### createSupervisedKnowledgeUpdater()

> **createSupervisedKnowledgeUpdater**(`options`): [`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

Create an `improveKnowledgeBase` update callback backed by runtime supervision.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

[`SupervisedKnowledgeUpdater`](#supervisedknowledgeupdater)

***

### runSupervisedKnowledgeUpdate()

> **runSupervisedKnowledgeUpdate**(`options`): `Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

Run a runtime supervisor that updates one candidate knowledge base and stops on readiness.

#### Parameters

##### options

[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions)

#### Returns

`Promise`\<[`SupervisedKnowledgeUpdateResult`](#supervisedknowledgeupdateresult)\>

***

### formatSupervisedKnowledgeTask()

> **formatSupervisedKnowledgeTask**(`options`): `string`

Format the supervisor task with the KB root, readiness requirements, current findings, and metadata.

#### Parameters

##### options

`Pick`\<[`SupervisedKnowledgeUpdateOptions`](#supervisedknowledgeupdateoptions), `"root"` \| `"goal"` \| `"readinessSpecs"` \| `"readinessTaskId"` \| `"findings"` \| `"metadata"`\>

#### Returns

`string`

***

### isDelegatedLoopMode()

> **isDelegatedLoopMode**(`value`): value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

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

> **worktreeLoopRunner**(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`WorktreeHarnessResult`](runtime.md#worktreeharnessresult)\>

**`Experimental`**

`code` mode on the GENERIC recursive path: author one `AgentProfile` per harness, run them as a
`worktreeFanout` (N `createWorktreeCliExecutor` leaves, each `gateOnDeliverable`) through
`runPersonified` on the keystone Supervisor. The sandbox-session counterpart that drives the in-box
harness over a `SandboxClient` is `detachedSessionDelegate` (`./mcp/delegates`); here there is no
`runAgentRounds` driver, no role-coupled delegate — the harness list is the fanout, the gate is
`patchDelivered`,
the winner is the shared valid-only selector (NOT `defaultSelectWinner`, whose non-valid fallback
would surface an ungated patch). Equal-k holds by the conserved budget pool. Returns the winning
patch artifact, or throws when no candidate is delivered (fail loud, never a vacuous done).

#### Parameters

##### options

[`WorktreeLoopRunnerOptions`](#worktreelooprunneroptions)

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<[`WorktreeHarnessResult`](runtime.md#worktreeharnessresult)\>

***

### researchLoopRunner()

> **researchLoopRunner**(`o`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`ResearchLoopResult`](#researchloopresult)\>

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

**`Experimental`**

Returns the queue-bound delegation tools projected into OpenAI Chat
Completions `tools[]` shape. The order is stable: `delegate_feedback`,
`delegation_status`, `delegation_history`.

#### Returns

[`OpenAIChatTool`](#openaichattool)[]

***

### mcpToolsForRuntimeMcpSubset()

> **mcpToolsForRuntimeMcpSubset**(`names`): [`OpenAIChatTool`](#openaichattool)[]

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

Resolve the router base URL from env, normalised — no trailing `/v1` or `/`.

#### Parameters

##### env?

[`RouterEnv`](#routerenv) = `{}`

#### Returns

`string`

***

### getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](#modelinfo)[]\>

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

Trim a candidate model id; `undefined` for non-strings and blanks.

#### Parameters

##### value

`unknown`

#### Returns

`string` \| `undefined`

***

### resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](#resolvedchatmodel)

Resolve a chat model by precedence: the first candidate carrying a
non-blank model wins, else `fallback`. The caller owns the precedence
order, so each product keeps its own policy (request → workspace → env,
etc.) while the first-non-blank logic and the telemetry shape stay shared.

#### Parameters

##### candidates

[`ChatModelCandidate`](#chatmodelcandidate)[]

##### fallback

[`ResolvedChatModel`](#resolvedchatmodel)

#### Returns

[`ResolvedChatModel`](#resolvedchatmodel)

***

### validateChatModelId()

> **validateChatModelId**(`modelId`, `options?`): `Promise`\<[`ChatModelValidation`](#chatmodelvalidation)\>

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

`Promise`\<[`ChatModelValidation`](#chatmodelvalidation)\>

***

### createOpenInferenceFileExporter()

> **createOpenInferenceFileExporter**(`filePath`): [`OtelExporter`](#otelexporter)

Create an exporter that APPENDS spans to a local OpenInference-JSONL file, one complete span per
line, instead of posting them to a collector.

Why this exists beside [createOtelExporter](#createotelexporter): that one needs an OTLP endpoint, so a run on a
laptop, in CI, or inside a sandbox with no collector emits nothing and its per-turn shape is
simply lost. The journal records the TREE (who spawned whom, what settled, what it spent); it
does not record what happened inside a turn. A run whose tree is readable but whose turns are not
is exactly the state that made an observability gap invisible until someone went looking.

The line shape is the one `@tangle-network/traces` reads (`spans.otlp.jsonl`) and is a standard
OpenInference representation, so the same file feeds any OpenInference tool with no conversion:
snake_case identity fields, ISO-8601 times, `parent_span_id` empty at the root, and attributes as
a plain object rather than OTLP's key/value array.

Appends synchronously per span so a killed process keeps every span it had already finished —
matching the spawn journal's durability posture, since a trace that only survives a clean exit is
useless for the runs you most want to look at.

#### Parameters

##### filePath

`string`

#### Returns

[`OtelExporter`](#otelexporter)

***

### createOtelExporter()

> **createOtelExporter**(`config?`): [`OtelExporter`](#otelexporter) \| `undefined`

Create an OTEL exporter. Returns undefined when no endpoint is configured.

#### Parameters

##### config?

[`OtelExportConfig`](#otelexportconfig)

#### Returns

[`OtelExporter`](#otelexporter) \| `undefined`

***

### loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): [`OtelSpan`](#otelspan)

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

### toOtelAttributes()

> **toOtelAttributes**(`record`): [`OtelAttribute`](#otelattribute)[]

Convert a flat record into the OTLP attribute list. Non-finite numbers are DROPPED (an OTLP
`doubleValue` of `NaN`/`Infinity` is not representable), integers ride as `intValue`. Exported so
a producer that mints its own `OtelSpan` (the supervisor span recorder) builds attributes exactly
the way every span in this file does, rather than re-deriving the encoding.

#### Parameters

##### record

`Record`\<`string`, `string` \| `number` \| `boolean`\>

#### Returns

[`OtelAttribute`](#otelattribute)[]

***

### padSpanId()

> **padSpanId**(`id`): `string`

Map a caller-supplied span id onto the 16-hex OTLP encoding. An id that is already a valid W3C
span id passes through UNCHANGED — that is what lets an inherited `PARENT_SPAN_ID`/`TRACEPARENT`
id keep parenting the same trace. A DASHED hex id (a UUID-form id) passes through dash-stripped:
that is the exact wire id every earlier release exported for it, so cross-version joins survive
the strict-W3C upgrade. Anything else (a human run id) is DERIVED via the zero-dep contract's
`deriveHexId`, the one legal derivation: the old slice-and-pad produced ids that embedded the
raw input in the wire id and were not even valid hex (the contract's own `non-hex-id` validator
rejected what this module exported). Exported as the ONE wire-id normalization every writer
shares — `traceContextToEnv` builds the child's `TRACEPARENT` through these same functions, so
a parent's exported spans and the context it hands its children always name the same trace.

#### Parameters

##### id

`string`

#### Returns

`string`

***

### padTraceId()

> **padTraceId**(`id`): `string`

Trace-id counterpart of [padSpanId](#padspanid): valid W3C trace ids pass through (dash-stripped when
 UUID-form, preserving the pre-strict-W3C wire id), everything else is derived with
 `deriveHexId(id, 16)` so every process derives the SAME wire id for the same run.

#### Parameters

##### id

`string`

#### Returns

`string`

***

### generateSpanId()

> **generateSpanId**(): `string`

Mint a fresh 16-hex-character OTLP span id. Exported so a producer that must know a span's id
 BEFORE the span closes (a node opened at spawn and parented by its children) uses this one
 generator instead of a second copy of it.

#### Returns

`string`

***

### exportEvalRuns()

> **exportEvalRuns**(`events`, `config?`): `Promise`\<[`EvalRunsExportResult`](#evalrunsexportresult)\>

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

> **decideKnowledgeReadiness**(`report`, `options?`): [`KnowledgeReadinessDecision`](#knowledgereadinessdecision)

**`Stable`**

Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

###### minimumScore?

`number`

#### Returns

[`KnowledgeReadinessDecision`](#knowledgereadinessdecision)

***

### applyRunRecordDefaults()

> **applyRunRecordDefaults**(`records`, `scenarioId`, `controlFailureClass`): `RunRecord`[]

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

**`Stable`**

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

[`RunAgentTaskOptions`](#runagenttaskoptions)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<[`AgentTaskRunResult`](#agenttaskrunresult)\<`TState`, `TAction`, `TActionResult`, `TEval`\>\>

***

### runAgentTaskStream()

> **runAgentTaskStream**\<`TInput`\>(`options`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

**`Stable`**

Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

[`RunAgentTaskStreamOptions`](#runagenttaskstreamoptions)\<`TInput`\>

#### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

***

### defineRuntimeHooks()

> **defineRuntimeHooks**(`hooks`): [`RuntimeHooks`](#runtimehooks)

Identity helper that types a [RuntimeHooks](#runtimehooks) literal so the fields are inferred.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks)

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](#runtimehooks)

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

**`Stable`**

Construct a runtime-run handle. The returned handle is mutable across its
lifetime; consumers should not share it across requests.

#### Parameters

##### options

[`RuntimeRunOptions`](#runtimerunoptions)

#### Returns

[`RuntimeRunHandle`](#runtimerunhandle)

***

### createProfileExecutionBackend()

> **createProfileExecutionBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

**`Stable`**

Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used
by `runAgentTaskStream` and conversations.

Runtime still owns the model call through `streamAgentTurn`.
The adapter only translates the two stream protocols and carries the caller's request headers
into `ExecutorContext` so an HTTP executor can preserve authorization, recursion depth, and
trace identity.

#### Parameters

##### options

###### profile

`AgentProfile`

###### executor

[`ExecutorFactory`](runtime.md#executorfactory)\<`unknown`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

***

### sanitizeKnowledgeReadinessReport()

> **sanitizeKnowledgeReadinessReport**(`report`, `options?`): [`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

**`Stable`**

Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

***

### sanitizeAgentRuntimeEvent()

> **sanitizeAgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`event`, `options?`): `Record`\<`string`, `unknown`\>

**`Stable`**

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

***

### sanitizeRuntimeStreamEvent()

> **sanitizeRuntimeStreamEvent**(`event`, `options?`): `Record`\<`string`, `unknown`\>

**`Stable`**

Reduce a `RuntimeStreamEvent` to a PII-safe, serializable plain object for telemetry.

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

`Record`\<`string`, `unknown`\>

***

### createRuntimeEventCollector()

> **createRuntimeEventCollector**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`options?`): [`RuntimeEventCollector`](#runtimeeventcollector)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

**`Stable`**

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

***

### createRuntimeStreamEventCollector()

> **createRuntimeStreamEventCollector**(`options?`): [`RuntimeStreamEventCollector`](#runtimestreameventcollector)

**`Stable`**

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

***

### readinessServerSentEvent()

> **readinessServerSentEvent**(`report`, `options?`): `string`

**`Stable`**

Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & [`ServerSentEventOptions`](#serversenteventoptions) = `{}`

#### Returns

`string`

***

### runtimeStreamServerSentEvent()

> **runtimeStreamServerSentEvent**(`event`, `options?`): `string`

**`Stable`**

Serialize a `RuntimeStreamEvent` as a Server-Sent Event string.

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & [`ServerSentEventOptions`](#serversenteventoptions) = `{}`

#### Returns

`string`
