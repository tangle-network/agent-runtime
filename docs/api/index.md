[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / index

# index

## Classes

### CircuitOpenError

Defined in: [conversation/call-policy.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L41)

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CircuitOpenError**(`participant`, `retryAfterMs`): [`CircuitOpenError`](#circuitopenerror)

Defined in: [conversation/call-policy.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L42)

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

Defined in: [conversation/call-policy.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L50)

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new DeadlineExceededError**(`deadlineMs`): [`DeadlineExceededError`](#deadlineexceedederror)

Defined in: [conversation/call-policy.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L51)

###### Parameters

###### deadlineMs

`number`

###### Returns

[`DeadlineExceededError`](#deadlineexceedederror)

###### Overrides

`Error.constructor`

***

### CircuitBreakerState

Defined in: [conversation/call-policy.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L83)

Live circuit-breaker state — one instance per (participant, conversation run).

#### Constructors

##### Constructor

> **new CircuitBreakerState**(`config`): [`CircuitBreakerState`](#circuitbreakerstate)

Defined in: [conversation/call-policy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L87)

###### Parameters

###### config

[`CircuitBreakerConfig`](#circuitbreakerconfig) \| `undefined`

###### Returns

[`CircuitBreakerState`](#circuitbreakerstate)

#### Methods

##### preflight()

> **preflight**(`participant`, `now?`): `void`

Defined in: [conversation/call-policy.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L93)

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

Defined in: [conversation/call-policy.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L103)

###### Returns

`void`

##### recordFailure()

> **recordFailure**(`now?`): `void`

Defined in: [conversation/call-policy.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L108)

###### Parameters

###### now?

`number` = `...`

###### Returns

`void`

***

### SqlConversationJournal

Defined in: [conversation/journal-sql.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L119)

SQL-backed ConversationJournal. Two tables — runs (one row per runId, holds
start/halt timestamps + halt reason) and turns (one row per committed turn,
payload is the ConversationTurn JSON). Replays the turns table on
`loadRun` and writes append-only per `appendTurn`.

#### Implements

- [`ConversationJournal`](#conversationjournal)

#### Constructors

##### Constructor

> **new SqlConversationJournal**(`db`, `table?`): [`SqlConversationJournal`](#sqlconversationjournal)

Defined in: [conversation/journal-sql.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L126)

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

Defined in: [conversation/journal-sql.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L135)

Create the journal's tables if absent. Idempotent. Call once at deploy
(or at app boot) — running on every request is harmless but adds latency.

###### Returns

`Promise`\<`void`\>

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal-sql.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L141)

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

Defined in: [conversation/journal-sql.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L167)

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

Defined in: [conversation/journal-sql.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L186)

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

Defined in: [conversation/journal-sql.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L207)

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

Defined in: [conversation/journal.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L58)

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

Defined in: [conversation/journal.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L61)

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

Defined in: [conversation/journal.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L74)

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

Defined in: [conversation/journal.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L87)

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

Defined in: [conversation/journal.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L102)

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

Defined in: [conversation/journal.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L122)

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

Defined in: [conversation/journal.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L123)

###### Parameters

###### path

`string`

###### Returns

[`FileConversationJournal`](#fileconversationjournal)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L125)

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

Defined in: [conversation/journal.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L161)

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

Defined in: [conversation/journal.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L174)

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

Defined in: [conversation/journal.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L178)

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

Defined in: [errors.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L65)

#### Stable

A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
status. Distinct from `JudgeError` (which is structural / unrecoverable)
because backend failures are sometimes retryable and consumers may want to
branch on the upstream status code.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new BackendTransportError**(`backend`, `message`, `options?`): [`BackendTransportError`](#backendtransporterror)

Defined in: [errors.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L76)

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

Defined in: [errors.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L66)

##### status?

> `readonly` `optional` **status?**: `number`

Defined in: [errors.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L67)

##### body?

> `readonly` `optional` **body?**: `string`

Defined in: [errors.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L74)

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.

***

### RuntimeRunStateError

Defined in: [errors.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L94)

#### Stable

A runtime-run lifecycle method was called in an order the state machine does
not allow: `persist()` before `complete()`, `complete()` twice, etc.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new RuntimeRunStateError**(`message`, `options?`): [`RuntimeRunStateError`](#runtimerunstateerror)

Defined in: [errors.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L95)

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

Defined in: [errors.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L111)

#### Stable

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

Defined in: [errors.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/errors.ts#L112)

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

Defined in: [sessions.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L40)

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

Defined in: [sessions.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L44)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `undefined`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`get`](#get-1)

##### put()

> **put**(`session`): `void`

Defined in: [sessions.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L48)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`put`](#put-1)

##### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

Defined in: [sessions.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L52)

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

Defined in: [sessions.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/sessions.ts#L58)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`listEvents`](#listevents-1)

## Interfaces

### CircuitBreakerConfig

Defined in: [conversation/call-policy.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L23)

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

#### Properties

##### failuresToOpen

> **failuresToOpen**: `number`

Defined in: [conversation/call-policy.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L24)

##### cooldownMs

> **cooldownMs**: `number`

Defined in: [conversation/call-policy.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L25)

***

### BackendCallPolicy

Defined in: [conversation/call-policy.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L28)

#### Properties

##### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Defined in: [conversation/call-policy.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L30)

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Defined in: [conversation/call-policy.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L32)

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

##### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](#retrybackoff)

Defined in: [conversation/call-policy.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L34)

Backoff between attempts. Default 250ms with jitter.

##### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [conversation/call-policy.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L36)

Custom retry classifier. Defaults to [defaultIsRetryable](#defaultisretryable).

##### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](#circuitbreakerconfig)

Defined in: [conversation/call-policy.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L38)

Circuit breaker that opens after N consecutive failures per participant.

***

### EvalPersonaOptions

Defined in: [conversation/eval-persona.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L31)

#### Properties

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [conversation/eval-persona.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L34)

Router (or OpenAI-compatible) endpoint for the DEFAULT backend. Required unless `backendFor`
 is supplied (tests/advanced override the backend entirely and may omit these).

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: [conversation/eval-persona.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L35)

##### model?

> `optional` **model?**: `string`

Defined in: [conversation/eval-persona.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L36)

##### backendFor?

> `optional` **backendFor?**: (`profile`, `role`) => [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/eval-persona.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L39)

Override the backend seam directly instead of deriving it from `apiKey`/`baseUrl`/`model`
 (the offline-test path: pass a fake here and the credentials are not needed).

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

##### systemPromptOf?

> `optional` **systemPromptOf?**: (`profile`) => `string`

Defined in: [conversation/eval-persona.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L41)

Override system-prompt rendering. Default: `p.prompt?.systemPrompt ?? ''`.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string`

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [conversation/eval-persona.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L45)

Hard speaker-turn ceiling. REQUIRED for a profile-driven persona; for a scripted persona it
 defaults to `2 * turns.length`. `maxTurns` is a CEILING, NOT a target — `maxTurns: 0` is zero
 turns, not run-until-done; `haltOn` is the "until satisfied" knob.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [conversation/eval-persona.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L47)

Content-based early stop (the persona declares the goal met / unreachable).

##### seed?

> `optional` **seed?**: `string`

Defined in: [conversation/eval-persona.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L49)

Kickoff message to the persona. Default 'Begin.'

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/eval-persona.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L50)

##### workerName?

> `optional` **workerName?**: `string`

Defined in: [conversation/eval-persona.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L52)

Worker transcript speaker label. Default 'agent'.

***

### SqlAdapter

Defined in: [conversation/journal-sql.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L48)

Minimal SQL driver shape. Implementations forward to whichever client the
deployment already uses; agent-runtime takes no opinion on which.

Parameter placeholders MUST be `?` (positional). All adapters listed in the
file header accept this convention.

#### Methods

##### exec()

> **exec**(`sql`, `params?`): `Promise`\<\{ `rowsAffected`: `number`; \}\>

Defined in: [conversation/journal-sql.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L50)

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

Defined in: [conversation/journal-sql.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L52)

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

Defined in: [conversation/journal-sql.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L83)

Structural type matching the surface of `D1Database` we depend on, so the
SDK never imports `@cloudflare/workers-types`. Consumers pass their real
`D1Database` from `env.DB` and TS structural compatibility lines it up.

#### Methods

##### prepare()

> **prepare**(`sql`): [`D1StmtLike`](#d1stmtlike)

Defined in: [conversation/journal-sql.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L84)

###### Parameters

###### sql

`string`

###### Returns

[`D1StmtLike`](#d1stmtlike)

***

### D1StmtLike

Defined in: [conversation/journal-sql.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L86)

#### Methods

##### bind()

> **bind**(...`params`): [`D1StmtLike`](#d1stmtlike)

Defined in: [conversation/journal-sql.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L87)

###### Parameters

###### params

...`unknown`[]

###### Returns

[`D1StmtLike`](#d1stmtlike)

##### run()

> **run**(): `Promise`\<`unknown`\>

Defined in: [conversation/journal-sql.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L88)

###### Returns

`Promise`\<`unknown`\>

##### all()

> **all**\<`TRow`\>(): `Promise`\<\{ `results?`: `TRow`[]; \}\>

Defined in: [conversation/journal-sql.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L89)

###### Type Parameters

###### TRow

`TRow` = `unknown`

###### Returns

`Promise`\<\{ `results?`: `TRow`[]; \}\>

***

### ConversationJournalEntry

Defined in: [conversation/journal.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L19)

#### Properties

##### runId

> **runId**: `string`

Defined in: [conversation/journal.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L20)

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/journal.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L21)

##### halted?

> `optional` **halted?**: [`HaltReason`](#haltreason)

Defined in: [conversation/journal.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L23)

Set when the run reaches a terminal state.

##### endedAt?

> `optional` **endedAt?**: `string`

Defined in: [conversation/journal.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L24)

##### turns

> **turns**: [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/journal.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L25)

***

### ConversationJournal

Defined in: [conversation/journal.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L28)

#### Methods

##### loadRun()

> **loadRun**(`runId`): `Promise`\<[`ConversationJournalEntry`](#conversationjournalentry) \| `undefined`\>

Defined in: [conversation/journal.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L35)

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

Defined in: [conversation/journal.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L42)

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

Defined in: [conversation/journal.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L49)

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

Defined in: [conversation/journal.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal.ts#L55)

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

Defined in: [conversation/types.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L20)

#### Stable

#### Properties

##### name

> **name**: `string`

Defined in: [conversation/types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L25)

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L32)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so any
registered backend (iterable, sandbox, OpenAI-compatible) works without
adaptation.

##### label?

> `optional` **label?**: `string`

Defined in: [conversation/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L37)

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

##### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [conversation/types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L43)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

##### authSource?

> `optional` **authSource?**: [`AuthSource`](#authsource-1)

Defined in: [conversation/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L63)

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

Defined in: [conversation/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L76)

#### Stable

#### Extended by

- [`HaltContext`](#haltcontext)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L77)

##### turnIndex

> **turnIndex**: `number`

Defined in: [conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

***

### HaltContext

Defined in: [conversation/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L83)

#### Stable

#### Extends

- [`ConversationDriveState`](#conversationdrivestate)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L77)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`transcript`](#transcript-1)

##### turnIndex

> **turnIndex**: `number`

Defined in: [conversation/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L78)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`turnIndex`](#turnindex)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L79)

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`spentCreditsCents`](#spentcreditscents)

##### lastTurn

> **lastTurn**: [`ConversationTurn`](#conversationturn)

Defined in: [conversation/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L84)

***

### HaltSignal

Defined in: [conversation/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L88)

#### Stable

#### Properties

##### halted

> **halted**: `true`

Defined in: [conversation/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L89)

##### reason

> **reason**: `string`

Defined in: [conversation/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L90)

***

### ConversationPolicy

Defined in: [conversation/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L107)

#### Stable

#### Properties

##### maxTurns

> **maxTurns**: `number`

Defined in: [conversation/types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L109)

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

##### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Defined in: [conversation/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L116)

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

##### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](#turnorder)

Defined in: [conversation/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L121)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Defined in: [conversation/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L126)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

##### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Defined in: [conversation/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L132)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.

***

### ConversationTurn

Defined in: [conversation/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L136)

#### Stable

#### Properties

##### index

> **index**: `number`

Defined in: [conversation/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L137)

##### speaker

> **speaker**: `string`

Defined in: [conversation/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L138)

##### turnId

> **turnId**: `string`

Defined in: [conversation/types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L144)

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

##### text

> **text**: `string`

Defined in: [conversation/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L145)

##### usage?

> `optional` **usage?**: `object`

Defined in: [conversation/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L151)

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

Defined in: [conversation/types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L163)

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L164)

##### endedAt

> **endedAt**: `string`

Defined in: [conversation/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L165)

***

### Conversation

Defined in: [conversation/types.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L169)

#### Stable

#### Properties

##### participants

> **participants**: readonly [`ConversationParticipant`](#conversationparticipant)[]

Defined in: [conversation/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L170)

##### policy

> **policy**: [`ConversationPolicy`](#conversationpolicy)

Defined in: [conversation/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L171)

***

### RunConversationOptions

Defined in: [conversation/types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L175)

#### Stable

#### Properties

##### seed

> **seed**: `string`

Defined in: [conversation/types.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L177)

First message kicking off the conversation. Routes to the first speaker.

##### runId?

> `optional` **runId?**: `string`

Defined in: [conversation/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L184)

Optional run identifier for cross-participant trace correlation. Auto-
generated when omitted. Reusing a runId against the same `journal`
resumes the prior run — the runner replays the persisted transcript and
continues from the first un-recorded turn.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [conversation/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L186)

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [conversation/types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L193)

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

Defined in: [conversation/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L200)

Optional durable transcript. When set, the runner persists every
committed turn before yielding `turn_end`. Reusing the same `runId`
against the same journal resumes from the last committed turn — so a
driver process crash mid-run loses zero acknowledged turns.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [conversation/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L207)

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

##### inboundDepth?

> `optional` **inboundDepth?**: `number`

Defined in: [conversation/types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L213)

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_DEPTH`. Default 0 (origin caller).

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [conversation/types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L220)

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.

***

### ConversationResult

Defined in: [conversation/types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L224)

#### Stable

#### Properties

##### runId

> **runId**: `string`

Defined in: [conversation/types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L225)

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

Defined in: [conversation/types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L226)

##### turns

> **turns**: `number`

Defined in: [conversation/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L227)

##### spentCreditsCents

> **spentCreditsCents**: `number`

Defined in: [conversation/types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L228)

##### halted

> **halted**: [`HaltReason`](#haltreason)

Defined in: [conversation/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L229)

##### durationMs

> **durationMs**: `number`

Defined in: [conversation/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L230)

##### startedAt

> **startedAt**: `string`

Defined in: [conversation/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L231)

##### endedAt

> **endedAt**: `string`

Defined in: [conversation/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L232)

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

Defined in: [improvement/agentic-generator.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L41)

Outcome of verifying a candidate worktree. `feedback` (compiler errors,
 failing test output) is fed into the next shot when `ok` is false.

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [improvement/agentic-generator.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L42)

##### feedback?

> `optional` **feedback?**: `string`

Defined in: [improvement/agentic-generator.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L43)

***

### AgenticGeneratorOptions

Defined in: [improvement/agentic-generator.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L51)

`@tangle-network/agent-runtime` improvement — the CODE-surface proposer for
agent-eval's improvement loop.

The ONE entry point for optimization is agent-eval's `selfImprove`
(`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
`fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
cohorting. This module supplies only the one genuinely runtime-specific piece:
a CODE-surface `SurfaceProposer` you pass to `selfImprove` as `proposer`, which
mutates a git worktree via a pluggable `CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

#### Properties

##### harness?

> `optional` **harness?**: [`LocalHarness`](mcp.md#localharness)

Defined in: [improvement/agentic-generator.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L53)

Local coding harness to run in the worktree. Default `claude`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [improvement/agentic-generator.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L55)

Per-shot wall-clock timeout (ms). Default = `runLocalHarness` default (5m).

##### buildPrompt?

> `optional` **buildPrompt?**: (`args`) => `string`

Defined in: [improvement/agentic-generator.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L58)

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

Defined in: [improvement/agentic-generator.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L64)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. Omitted ⇒ legacy behavior:
 the first dirty shot is the candidate. See `commandVerifier`.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [improvement/agentic-generator.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L66)

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

Defined in: [improvement/agentic-generator.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L68)

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### ImproveOptions

Defined in: [improvement/improve.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L48)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### surface?

> `optional` **surface?**: [`ImproveSurface`](#improvesurface)

Defined in: [improvement/improve.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L51)

Which profile lever to optimize. Default `'prompt'`. Selects the default
 generator + the baseline-surface extraction shape.

##### generator?

> `optional` **generator?**: `SurfaceProposer`\<`unknown`\>

Defined in: [improvement/improve.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L55)

The `SurfaceProposer` that mutates the surface. When unset, the facade
 picks the default for `surface` (`gepaProposer` for prompt, `skillOptProposer`
 for skills); surfaces with no default REQUIRE this (fail-loud otherwise).

##### gate?

> `optional` **gate?**: `"none"` \| `"holdout"`

Defined in: [improvement/improve.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L58)

Gate mode. `'holdout'` (default) runs the held-out promotion gate;
 `'none'` is a baseline-only run (`budget.generations = 0`).

##### scenarios

> **scenarios**: `TScenario`[]

Defined in: [improvement/improve.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L60)

Scenarios to evaluate against. Passthrough to `selfImprove`.

##### judge

> **judge**: `JudgeConfig`\<`TArtifact`, `TScenario`\>

Defined in: [improvement/improve.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L62)

Judge that scores artifacts. Passthrough to `selfImprove`.

##### agent

> **agent**: (`surface`, `scenario`, `ctx`) => `Promise`\<`TArtifact`\>

Defined in: [improvement/improve.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L65)

The agent under improvement — same shape as `selfImprove.agent`: it takes
 the current surface + scenario + ctx and returns the artifact to judge.

###### Parameters

###### surface

`MutableSurface`

###### scenario

`TScenario`

###### ctx

`DispatchContext`

###### Returns

`Promise`\<`TArtifact`\>

##### budget?

> `optional` **budget?**: `SelfImproveBudget`

Defined in: [improvement/improve.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L67)

Budget + loop shape. Passthrough; `gate: 'none'` forces `generations = 0`.

##### llm?

> `optional` **llm?**: `SelfImproveLlm`

Defined in: [improvement/improve.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L70)

LLM config. Passthrough to `selfImprove` AND used to construct the default
 reflective proposer (`gepaProposer`/`skillOptProposer`) when `generator` is unset.

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [improvement/improve.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L74)

Restrict the run to this subset of models. When set, the reflection model
 (`llm.model`, or the default when unset) must be a member, or `improve()` throws
 a `ConfigError` before the generator is built. Unset = unrestricted.

***

### ImproveResult

Defined in: [improvement/improve.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L77)

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> **profile**: `AgentProfile`

Defined in: [improvement/improve.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L80)

The profile after improvement: the winner surface applied back into the
 matching field when the gate shipped, else the input profile unchanged.

##### shipped

> **shipped**: `boolean`

Defined in: [improvement/improve.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L82)

True when `gateDecision === 'ship'`.

##### lift

> **lift**: `number`

Defined in: [improvement/improve.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L84)

Held-out lift (`winner − baseline` composite).

##### gateDecision

> **gateDecision**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [improvement/improve.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L86)

The five-valued gate verdict from `selfImprove`.

##### raw

> **raw**: `SelfImproveResult`\<`TScenario`, `TArtifact`\>

Defined in: [improvement/improve.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L88)

Full `selfImprove` result for advanced inspection.

***

### CandidateGenerator

Defined in: [improvement/improvement-driver.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L35)

The byte-producing seam — the ONE thing that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

Defined in: [improvement/improvement-driver.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L36)

#### Methods

##### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; \}\>

Defined in: [improvement/improvement-driver.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L37)

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

Defined in: [improvement/improvement-driver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L53)

#### Properties

##### worktree

> **worktree**: `WorktreeAdapter`

Defined in: [improvement/improvement-driver.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L54)

##### generator

> **generator**: [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/improvement-driver.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L55)

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [improvement/improvement-driver.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L57)

Base ref candidate worktrees fork from. Default `main`.

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

### ReflectiveGeneratorOptions

Defined in: [improvement/reflective-generator.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L20)

#### Properties

##### improvementAdapter

> **improvementAdapter**: [`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

Defined in: [improvement/reflective-generator.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L21)

***

### DelegatedLoopResult

Defined in: [loop-runner.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L66)

**`Experimental`**

Uniform result — never throws from a registered runner; a
 thrown engine becomes `{ ok: false, error }` so a routine can record + move on.

#### Type Parameters

##### T

`T` = `unknown`

#### Properties

##### mode

> **mode**: `"code"` \| `"review"` \| `"research"` \| `"audit"` \| `"self-improve"`

Defined in: [loop-runner.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L67)

**`Experimental`**

##### ok

> **ok**: `boolean`

Defined in: [loop-runner.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L68)

**`Experimental`**

##### output?

> `optional` **output?**: `T`

Defined in: [loop-runner.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L69)

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: [loop-runner.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L70)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [loop-runner.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L71)

**`Experimental`**

***

### RunDelegatedLoopOptions

Defined in: [loop-runner.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L75)

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [loop-runner.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L76)

**`Experimental`**

##### now?

> `optional` **now?**: () => `number`

Defined in: [loop-runner.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L78)

**`Experimental`**

Clock override for deterministic tests.

###### Returns

`number`

***

### WorktreeLoopRunnerOptions

Defined in: [loop-runner.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L119)

**`Experimental`**

Options for the local-repo `code` runner over the GENERIC recursive path.

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [loop-runner.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L121)

**`Experimental`**

Absolute path to the local git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [loop-runner.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L123)

**`Experimental`**

The instruction handed to every authored harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](runtime.md#authoredharness)[]

Defined in: [loop-runner.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L125)

**`Experimental`**

The supervisor-authored harness profiles — one fanout item (one worktree-CLI leaf) each.

##### budget

> **budget**: [`Budget`](runtime.md#budget-10)

Defined in: [loop-runner.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L127)

**`Experimental`**

Conserved budget pool bounding the fanout (equal-k holds by construction).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [loop-runner.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L129)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [loop-runner.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L131)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [loop-runner.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L133)

**`Experimental`**

Which verification signals the deliverable REQUIRES present-and-passing (default none).

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [loop-runner.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L135)

**`Experimental`**

Diff-size cap (lines).

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [loop-runner.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L137)

**`Experimental`**

Literal path prefixes the patch must not touch (the secret-floor is always on regardless).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](runtime.md#winnerstrategy)

Defined in: [loop-runner.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L139)

**`Experimental`**

Winner-selection strategy among gated candidates. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [loop-runner.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L141)

**`Experimental`**

Test seams forwarded to the worktree-CLI leaves so the runner drives offline.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [loop-runner.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L142)

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

Defined in: [loop-runner.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L143)

**`Experimental`**

***

### VetoedFact

Defined in: [loop-runner.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L205)

**`Experimental`**

A fact rejected at the KB gate — surfaced, never dropped.

#### Properties

##### candidate

> **candidate**: [`FactCandidate`](mcp.md#factcandidate)

Defined in: [loop-runner.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L206)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

Defined in: [loop-runner.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L207)

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

Defined in: [loop-runner.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L208)

**`Experimental`**

***

### ResearchLoopResult

Defined in: [loop-runner.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L212)

**`Experimental`**

#### Properties

##### accepted

> **accepted**: [`FactCandidate`](mcp.md#factcandidate)[]

Defined in: [loop-runner.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L214)

**`Experimental`**

Facts that passed the fail-closed gate — safe to write to the KB.

##### vetoed

> **vetoed**: [`VetoedFact`](#vetoedfact)[]

Defined in: [loop-runner.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L216)

**`Experimental`**

Facts the gate vetoed in the final round — escalate, do not silently drop.

##### rounds

> **rounds**: `number`

Defined in: [loop-runner.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L218)

**`Experimental`**

Research rounds actually run.

***

### ResearchLoopRunnerOptions

Defined in: [loop-runner.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L222)

**`Experimental`**

Options for the default `research` runner.

#### Properties

##### research

> **research**: (`round`, `vetoed`) => `Promise`\<[`FactCandidate`](mcp.md#factcandidate)[]\>

Defined in: [loop-runner.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L229)

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

Defined in: [loop-runner.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L231)

**`Experimental`**

Gate config (extra judges, self-artifact kinds, …). The floor is always on.

##### maxRounds?

> `optional` **maxRounds?**: `number`

Defined in: [loop-runner.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L233)

**`Experimental`**

Max research rounds (correct-on-veto remediation). Default 1.

***

### ModelInfo

Defined in: [model-resolution.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L21)

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

#### Properties

##### id

> **id**: `string`

Defined in: [model-resolution.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L22)

##### name?

> `optional` **name?**: `string`

Defined in: [model-resolution.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L23)

##### description?

> `optional` **description?**: `string`

Defined in: [model-resolution.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L24)

##### provider?

> `optional` **provider?**: `string`

Defined in: [model-resolution.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L26)

Provider slug, when the router exposes it (`provider` or `_provider`).

##### \_provider?

> `optional` **\_provider?**: `string`

Defined in: [model-resolution.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L27)

##### architecture?

> `optional` **architecture?**: `object`

Defined in: [model-resolution.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L28)

###### modality?

> `optional` **modality?**: `string`

###### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

###### output\_modalities?

> `optional` **output\_modalities?**: `string`[]

***

### RouterEnv

Defined in: [model-resolution.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L36)

Env keys the router base URL is resolved from.

#### Properties

##### TANGLE\_ROUTER\_URL?

> `optional` **TANGLE\_ROUTER\_URL?**: `string`

Defined in: [model-resolution.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L37)

##### TANGLE\_ROUTER\_BASE\_URL?

> `optional` **TANGLE\_ROUTER\_BASE\_URL?**: `string`

Defined in: [model-resolution.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L38)

***

### ResolvedChatModel

Defined in: [model-resolution.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L78)

#### Properties

##### source

> **source**: `string`

Defined in: [model-resolution.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L79)

##### model

> **model**: `string`

Defined in: [model-resolution.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L80)

***

### OtelExportConfig

Defined in: [otel-export.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L12)

OTEL span exporter — streams LoopTraceEvents to an OTLP/HTTP collector.

Reads OTEL_EXPORTER_OTLP_ENDPOINT + OTEL_EXPORTER_OTLP_HEADERS from env
when no explicit config is given. Keeps the runtime dep-free from
@opentelemetry/sdk-trace-base — minimal OTLP/JSON serializer.

The exporter accepts both raw OtelSpan objects and LoopTraceEvents
(which get converted to OTLP spans automatically).

#### Properties

##### endpoint?

> `optional` **endpoint?**: `string`

Defined in: [otel-export.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L14)

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L16)

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

##### batchSize?

> `optional` **batchSize?**: `number`

Defined in: [otel-export.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L18)

Batch size before flush. Default 64.

##### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Defined in: [otel-export.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L20)

Flush interval ms. Default 5000.

##### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L22)

Resource attributes stamped on every export.

##### serviceName?

> `optional` **serviceName?**: `string`

Defined in: [otel-export.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L24)

Service name. Default 'agent-runtime'.

***

### OtelExporter

Defined in: [otel-export.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L27)

#### Methods

##### exportSpan()

> **exportSpan**(`span`): `void`

Defined in: [otel-export.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L29)

Export a span.

###### Parameters

###### span

[`OtelSpan`](#otelspan)

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L31)

Force flush pending spans.

###### Returns

`Promise`\<`void`\>

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Defined in: [otel-export.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L33)

Shutdown cleanly.

###### Returns

`Promise`\<`void`\>

***

### OtelSpan

Defined in: [otel-export.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L36)

#### Properties

##### traceId

> **traceId**: `string`

Defined in: [otel-export.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L37)

##### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L38)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L39)

##### name

> **name**: `string`

Defined in: [otel-export.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L40)

##### kind?

> `optional` **kind?**: `number`

Defined in: [otel-export.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L41)

##### startTimeUnixNano

> **startTimeUnixNano**: `string`

Defined in: [otel-export.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L42)

##### endTimeUnixNano

> **endTimeUnixNano**: `string`

Defined in: [otel-export.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L43)

##### attributes?

> `optional` **attributes?**: [`OtelAttribute`](#otelattribute)[]

Defined in: [otel-export.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L44)

##### status?

> `optional` **status?**: `object`

Defined in: [otel-export.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L45)

###### code

> **code**: `number`

###### message?

> `optional` **message?**: `string`

***

### OtelAttribute

Defined in: [otel-export.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L48)

#### Properties

##### key

> **key**: `string`

Defined in: [otel-export.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L49)

##### value

> **value**: `object`

Defined in: [otel-export.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L50)

###### stringValue?

> `optional` **stringValue?**: `string`

###### intValue?

> `optional` **intValue?**: `string`

###### doubleValue?

> `optional` **doubleValue?**: `number`

###### boolValue?

> `optional` **boolValue?**: `boolean`

***

### LoopSpanNode

Defined in: [otel-export.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L202)

Sink-neutral node in a reconstructed loop span tree. The root node's
`parentSpanId` is `undefined` — sinks decide how to parent it (the OTEL
mapper attaches the inherited delegation span; the delegation journal
leaves it as the tree root).

#### Properties

##### spanId

> **spanId**: `string`

Defined in: [otel-export.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L203)

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [otel-export.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L204)

##### name

> **name**: `string`

Defined in: [otel-export.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L206)

`'loop'` | `'loop.round'` | `'loop.iteration'`.

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [otel-export.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L208)

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

Defined in: [otel-export.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L209)

##### endMs

> **endMs**: `number`

Defined in: [otel-export.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L210)

##### attrs

> **attrs**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [otel-export.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L211)

##### error

> **error**: `boolean`

Defined in: [otel-export.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L213)

True when the iteration carried an error — maps to OTEL status code 2.

***

### EvalRunGeneration

Defined in: [otel-export.ts:529](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L529)

#### Properties

##### index

> **index**: `number`

Defined in: [otel-export.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L531)

0-based ordinal of this generation within the run (required by ingest).

##### surfaceHash

> **surfaceHash**: `string`

Defined in: [otel-export.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L533)

Identity of the proposed surface change (content-addressed hash).

##### surface?

> `optional` **surface?**: `unknown`

Defined in: [otel-export.ts:535](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L535)

Arbitrary provenance for this generation (rationale, evidence, source).

##### cells?

> `optional` **cells?**: `unknown`[]

Defined in: [otel-export.ts:537](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L537)

Per-scenario results; empty until the generation is measured.

##### compositeMean

> **compositeMean**: `number`

Defined in: [otel-export.ts:539](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L539)

Mean composite score (0 when unmeasured — pair with labels.measured).

##### costUsd

> **costUsd**: `number`

Defined in: [otel-export.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L540)

##### durationMs

> **durationMs**: `number`

Defined in: [otel-export.ts:541](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L541)

***

### EvalRunEvent

Defined in: [otel-export.ts:544](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L544)

#### Properties

##### runId

> **runId**: `string`

Defined in: [otel-export.ts:545](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L545)

##### runDir

> **runDir**: `string`

Defined in: [otel-export.ts:546](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L546)

##### timestamp

> **timestamp**: `string`

Defined in: [otel-export.ts:548](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L548)

ISO timestamp.

##### status

> **status**: `"started"` \| `"baseline-complete"` \| `"generation-complete"` \| `"gate-decided"` \| `"finished"` \| `"errored"`

Defined in: [otel-export.ts:549](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L549)

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string`\>

Defined in: [otel-export.ts:556](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L556)

##### baseline?

> `optional` **baseline?**: [`EvalRunGeneration`](#evalrungeneration)

Defined in: [otel-export.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L557)

##### generations?

> `optional` **generations?**: [`EvalRunGeneration`](#evalrungeneration)[]

Defined in: [otel-export.ts:558](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L558)

##### gateDecision?

> `optional` **gateDecision?**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Defined in: [otel-export.ts:559](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L559)

##### holdoutLift?

> `optional` **holdoutLift?**: `number`

Defined in: [otel-export.ts:560](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L560)

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [otel-export.ts:561](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L561)

##### totalDurationMs

> **totalDurationMs**: `number`

Defined in: [otel-export.ts:562](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L562)

##### errorMessage?

> `optional` **errorMessage?**: `string`

Defined in: [otel-export.ts:563](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L563)

***

### EvalRunsExportConfig

Defined in: [otel-export.ts:566](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L566)

#### Properties

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: [otel-export.ts:568](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L568)

Bearer key — tenant is resolved server-side from it. Reads TANGLE_API_KEY.

##### base?

> `optional` **base?**: `string`

Defined in: [otel-export.ts:570](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L570)

Intelligence base. Reads INTELLIGENCE_BASE env, else prod.

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [otel-export.ts:572](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L572)

Idempotency-Key header (e.g. the runId) — safe retries + upsert.

***

### EvalRunsExportResult

Defined in: [otel-export.ts:575](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L575)

#### Properties

##### ok

> **ok**: `boolean`

Defined in: [otel-export.ts:576](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L576)

##### status

> **status**: `number`

Defined in: [otel-export.ts:577](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L577)

##### accepted

> **accepted**: `number`

Defined in: [otel-export.ts:578](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L578)

##### rejected

> **rejected**: `object`[]

Defined in: [otel-export.ts:579](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L579)

###### index

> **index**: `number`

###### reason

> **reason**: `string`

***

### RuntimeHookEvent

Defined in: [runtime-hooks.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L35)

#### Type Parameters

##### Payload

`Payload` = `unknown`

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L36)

##### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L37)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L38)

##### target

> **target**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [runtime-hooks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L39)

##### phase

> **phase**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [runtime-hooks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L40)

##### timestamp

> **timestamp**: `number`

Defined in: [runtime-hooks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L41)

##### stepIndex?

> `optional` **stepIndex?**: `number`

Defined in: [runtime-hooks.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L42)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [runtime-hooks.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L43)

##### payload?

> `optional` **payload?**: `Payload`

Defined in: [runtime-hooks.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L44)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L45)

***

### RuntimeHookContext

Defined in: [runtime-hooks.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L48)

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime-hooks.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L49)

***

### RuntimeDecisionEvidenceRef

Defined in: [runtime-hooks.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L52)

#### Properties

##### source

> **source**: `string`

Defined in: [runtime-hooks.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L53)

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L54)

##### detail?

> `optional` **detail?**: `string`

Defined in: [runtime-hooks.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L55)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L56)

***

### RuntimeDecisionPoint

Defined in: [runtime-hooks.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L59)

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-hooks.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L60)

##### runId

> **runId**: `string`

Defined in: [runtime-hooks.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L61)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-hooks.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L62)

##### stepIndex

> **stepIndex**: `number`

Defined in: [runtime-hooks.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L63)

##### kind

> **kind**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [runtime-hooks.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L64)

##### candidateActions

> **candidateActions**: `string`[]

Defined in: [runtime-hooks.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L65)

##### context?

> `optional` **context?**: `string`

Defined in: [runtime-hooks.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L66)

##### evidence

> **evidence**: [`RuntimeDecisionEvidenceRef`](#runtimedecisionevidenceref)[]

Defined in: [runtime-hooks.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L67)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-hooks.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L68)

***

### RuntimeHookErrorContext

Defined in: [runtime-hooks.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L71)

#### Properties

##### hook

> **hook**: `"onEvent"` \| `"onDecisionPoint"`

Defined in: [runtime-hooks.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L72)

##### eventId?

> `optional` **eventId?**: `string`

Defined in: [runtime-hooks.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L73)

##### target?

> `optional` **target?**: [`RuntimeHookTarget`](#runtimehooktarget)

Defined in: [runtime-hooks.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L74)

##### phase?

> `optional` **phase?**: [`RuntimeHookPhase`](#runtimehookphase)

Defined in: [runtime-hooks.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L75)

##### decisionId?

> `optional` **decisionId?**: `string`

Defined in: [runtime-hooks.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L76)

##### decisionKind?

> `optional` **decisionKind?**: [`RuntimeDecisionKind`](#runtimedecisionkind)

Defined in: [runtime-hooks.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L77)

***

### RuntimeHooks

Defined in: [runtime-hooks.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L87)

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](#defineruntimehooks) for inference, and attach N
observers at once with [composeRuntimeHooks](#composeruntimehooks) — there is ONE event stream, not a
callback-prop zoo.

#### Properties

##### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime-hooks.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L93)

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

Defined in: [runtime-hooks.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L98)

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

Defined in: [runtime-hooks.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L102)

###### Parameters

###### error

`Error`

###### context

[`RuntimeHookErrorContext`](#runtimehookerrorcontext)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunRow

Defined in: [runtime-run.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L60)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [runtime-run.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L62)

Stable runtime-side identifier. Adapters may translate to their own primary key.

##### workspaceId

> **workspaceId**: `string`

Defined in: [runtime-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L63)

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: [runtime-run.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L64)

##### agentId?

> `optional` **agentId?**: `string`

Defined in: [runtime-run.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L65)

##### domain?

> `optional` **domain?**: `string`

Defined in: [runtime-run.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L66)

##### taskId

> **taskId**: `string`

Defined in: [runtime-run.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L67)

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L68)

##### status

> **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L69)

##### resultSummary?

> `optional` **resultSummary?**: `string`

Defined in: [runtime-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L70)

##### error?

> `optional` **error?**: `string`

Defined in: [runtime-run.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L71)

##### cost

> **cost**: `RuntimeRunCost`

Defined in: [runtime-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L72)

##### startedAt

> **startedAt**: `string`

Defined in: [runtime-run.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L73)

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [runtime-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L74)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L75)

***

### RuntimeRunPersistenceAdapter

Defined in: [runtime-run.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L79)

#### Stable

#### Methods

##### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

Defined in: [runtime-run.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L87)

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

Defined in: [runtime-run.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L106)

#### Stable

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [runtime-run.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L108)

Stable id assigned at start.

##### workspaceId

> `readonly` **workspaceId**: `string`

Defined in: [runtime-run.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L109)

##### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

Defined in: [runtime-run.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L110)

##### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [runtime-run.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L111)

##### status

> `readonly` **status**: `RuntimeRunStatus`

Defined in: [runtime-run.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L112)

#### Methods

##### observe()

> **observe**(`event`): `void`

Defined in: [runtime-run.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L119)

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

Defined in: [runtime-run.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L122)

Snapshot of the current cost ledger. Safe to call at any time.

###### Returns

`RuntimeRunCost`

##### complete()

> **complete**(`input`): `void`

Defined in: [runtime-run.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L129)

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

Defined in: [runtime-run.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L132)

Build the current row without writing it. Useful for tests + dry runs.

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

[`RuntimeRunRow`](#runtimerunrow)

##### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Defined in: [runtime-run.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L139)

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

Defined in: [sanitize.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L29)

#### Stable

#### Properties

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Defined in: [sanitize.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L34)

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Defined in: [sanitize.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L36)

Include requirement descriptions. Secret requirements are always redacted.

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Defined in: [sanitize.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L38)

Include evidence IDs. Off by default; counts are safer for shared reports.

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Defined in: [sanitize.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L40)

Include user answers from question preflight. Off by default.

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Defined in: [sanitize.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L42)

Include action payloads and action results for control steps. Off by default.

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Defined in: [sanitize.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L44)

Include task metadata. Off by default because metadata may carry IDs or policy internals.

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Defined in: [sanitize.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L46)

Include eval detail/evidence strings. Off by default because validators may echo private input.

***

### SanitizedKnowledgeReadinessReport

Defined in: [sanitize.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L67)

#### Stable

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [sanitize.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L68)

##### readinessScore

> **readinessScore**: `number`

Defined in: [sanitize.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L69)

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

Defined in: [sanitize.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L70)

##### severity

> **severity**: `ControlSeverity`

Defined in: [sanitize.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L71)

##### reason

> **reason**: `string`

Defined in: [sanitize.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L72)

##### blockingMissingRequirements

> **blockingMissingRequirements**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L73)

##### nonBlockingGaps

> **nonBlockingGaps**: `SanitizedKnowledgeRequirement`[]

Defined in: [sanitize.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L74)

##### evidenceCount

> **evidenceCount**: `number`

Defined in: [sanitize.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L75)

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

Defined in: [sanitize.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L76)

##### missingRequirementIds

> **missingRequirementIds**: `string`[]

Defined in: [sanitize.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L77)

***

### RuntimeEventCollector

Defined in: [sanitize.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L492)

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

Defined in: [sanitize.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L498)

###### Parameters

###### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`void`

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L499)

***

### RuntimeStreamEventCollector

Defined in: [sanitize.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L522)

#### Stable

#### Properties

##### onEvent

> **onEvent**: `RuntimeStreamEventSink`

Defined in: [sanitize.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L523)

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

Defined in: [sanitize.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L524)

#### Methods

##### summary()

> **summary**(): `RuntimeStreamEventSummary`

Defined in: [sanitize.ts:526](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L526)

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

Defined in: [types.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L26)

#### Stable

#### Properties

##### id

> **id**: `string`

Defined in: [types.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L27)

##### intent

> **intent**: `string`

Defined in: [types.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L28)

##### domain?

> `optional` **domain?**: `string`

Defined in: [types.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L30)

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L31)

##### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

Defined in: [types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L32)

##### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

Defined in: [types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L33)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L34)

***

### AgentKnowledgeProvider

Defined in: [types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L38)

#### Stable

#### Methods

##### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L39)

###### Parameters

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

##### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L40)

###### Parameters

###### questions

`UserQuestion`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

##### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

Defined in: [types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L44)

###### Parameters

###### plans

`DataAcquisitionPlan`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`string`[] \| `Promise`\<`string`[]\>

##### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

Defined in: [types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L48)

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

Defined in: [types.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L57)

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

Defined in: [types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L63)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L64)

##### state

> **state**: `TState`

Defined in: [types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L65)

##### evals

> **evals**: `TEval`[]

Defined in: [types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L66)

##### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

Defined in: [types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L67)

##### budget

> **budget**: `ControlBudget`

Defined in: [types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L68)

##### stepIndex

> **stepIndex**: `number`

Defined in: [types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L69)

##### wallMs

> **wallMs**: `number`

Defined in: [types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L70)

##### spentCostUsd

> **spentCostUsd**: `number`

Defined in: [types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L71)

##### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

Defined in: [types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L72)

##### abortSignal

> **abortSignal**: `AbortSignal`

Defined in: [types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L73)

***

### AgentAdapter

Defined in: [types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L77)

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

Defined in: [types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L83)

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

Defined in: [types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L90)

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

Defined in: [types.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L98)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

Defined in: [types.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L102)

###### Parameters

###### action

`TAction`

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

##### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

Defined in: [types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L107)

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

##### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

Defined in: [types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L121)

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

Defined in: [types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L128)

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

Defined in: [types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L137)

###### Parameters

###### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`RunRecord`[]

***

### BackendErrorDetail

Defined in: [types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L210)

#### Stable

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

> **kind**: `"transport"` \| `"backend"`

Defined in: [types.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L216)

`'transport'` — upstream HTTP / network failure with optional status code.
`'backend'` — the backend's `stream()` generator threw for a non-transport
reason (e.g. a custom adapter error, sandbox crash).

##### message

> **message**: `string`

Defined in: [types.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L217)

##### status?

> `optional` **status?**: `number`

Defined in: [types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L219)

Upstream HTTP status when known. `0` for connection / abort errors.

##### body?

> `optional` **body?**: `string`

Defined in: [types.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L221)

Truncated response body (≤2 KiB). Diagnostic only — never machine-parsed.

***

### OpenAIChatTool

Defined in: [types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L239)

#### Stable

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

#### Properties

##### type

> **type**: `"function"`

Defined in: [types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L240)

##### function

> **function**: `object`

Defined in: [types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L241)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSessionStore

Defined in: [types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L444)

#### Stable

#### Methods

##### get()

> **get**(`sessionId`): `RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

Defined in: [types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L445)

###### Parameters

###### sessionId

`string`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession` \| `undefined`\> \| `undefined`

##### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L446)

###### Parameters

###### session

`RuntimeSession`

###### Returns

`void` \| `Promise`\<`void`\>

##### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L447)

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

Defined in: [types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L448)

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

***

### AgentBackendInput

Defined in: [types.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L452)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:453](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L453)

##### message?

> `optional` **message?**: `string`

Defined in: [types.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L454)

##### messages?

> `optional` **messages?**: `object`[]

Defined in: [types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L455)

###### role

> **role**: `string`

###### content

> **content**: `string`

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

Defined in: [types.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L456)

***

### AgentBackendContext

Defined in: [types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L460)

#### Stable

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

Defined in: [types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L461)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:462](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L462)

##### session

> **session**: `RuntimeSession`

Defined in: [types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L463)

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L464)

##### runId?

> `optional` **runId?**: `string`

Defined in: [types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L470)

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

##### turnId?

> `optional` **turnId?**: `string`

Defined in: [types.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L475)

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Defined in: [types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L481)

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [types.ts:488](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L488)

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.

***

### AgentExecutionBackend

Defined in: [types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L492)

#### Stable

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### kind

> **kind**: `string`

Defined in: [types.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L493)

#### Methods

##### start()?

> `optional` **start**(`input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L494)

###### Parameters

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\> & `object`

###### Returns

`RuntimeSession` \| `Promise`\<`RuntimeSession`\>

##### resume()?

> `optional` **resume**(`session`, `input`, `context`): `RuntimeSession` \| `Promise`\<`RuntimeSession`\>

Defined in: [types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L498)

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

Defined in: [types.ts:503](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L503)

###### Parameters

###### input

`TInput`

###### context

[`AgentBackendContext`](#agentbackendcontext)

###### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

##### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

Defined in: [types.ts:504](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L504)

###### Parameters

###### session

`RuntimeSession`

###### reason

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### AgentTaskRunResult

Defined in: [types.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L540)

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

Defined in: [types.ts:546](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L546)

##### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

Defined in: [types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L547)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

Defined in: [types.ts:548](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L548)

##### questions

> **questions**: `UserQuestion`[]

Defined in: [types.ts:549](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L549)

##### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

Defined in: [types.ts:550](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L550)

##### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

Defined in: [types.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L551)

##### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

Defined in: [types.ts:552](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L552)

##### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

Defined in: [types.ts:553](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L553)

##### runRecords

> **runRecords**: `RunRecord`[]

Defined in: [types.ts:554](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L554)

## Type Aliases

### RetryableErrorPredicate

> **RetryableErrorPredicate** = (`err`) => `boolean`

Defined in: [conversation/call-policy.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L17)

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

#### Parameters

##### err

`unknown`

#### Returns

`boolean`

***

### RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Defined in: [conversation/call-policy.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L20)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.

***

### ForwardHeaderName

> **ForwardHeaderName** = *typeof* [`FORWARD_HEADERS`](#forward_headers)\[keyof *typeof* [`FORWARD_HEADERS`](#forward_headers)\]

Defined in: [conversation/headers.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L34)

***

### PropagatedHeaders

> **PropagatedHeaders** = `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [conversation/headers.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L110)

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

Defined in: [conversation/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L67)

#### Stable

***

### TurnOrder

> **TurnOrder** = `"alternate"` \| `"round-robin"` \| ((`state`) => `number`)

Defined in: [conversation/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L73)

#### Stable

***

### HaltPredicate

> **HaltPredicate** = (`ctx`) => `boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

Defined in: [conversation/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L94)

#### Parameters

##### ctx

[`HaltContext`](#haltcontext)

#### Returns

`boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

#### Stable

***

### HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

Defined in: [conversation/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L99)

#### Stable

***

### ConversationStreamEvent

> **ConversationStreamEvent** = \{ `type`: `"conversation_start"`; `runId`: `string`; `participants`: readonly `string`[]; `seed`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"conversation_resumed"`; `runId`: `string`; `participants`: readonly `string`[]; `transcript`: readonly [`ConversationTurn`](#conversationturn)[]; `timestamp`: `string`; \} \| \{ `type`: `"turn_start"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `timestamp`: `string`; \} \| \{ `type`: `"turn_text_delta"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"turn_retry"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_end"`; `runId`: `string`; `turn`: [`ConversationTurn`](#conversationturn); `timestamp`: `string`; \} \| \{ `type`: `"conversation_end"`; `runId`: `string`; `result`: [`ConversationResult`](#conversationresult); `timestamp`: `string`; \}

Defined in: [conversation/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/types.ts#L236)

#### Stable

***

### Verifier

> **Verifier** = (`worktreePath`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

Defined in: [improvement/agentic-generator.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L49)

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

> **ImproveSurface** = `"prompt"` \| `"skills"` \| `"tools"` \| `"mcp"` \| `"hooks"` \| `"code"`

Defined in: [improvement/improve.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L46)

The agent-profile lever `improve` optimizes. Mirrors the AgentProfile-law
 profile levers; `code` is the implementation-tier surface.

***

### DelegatedLoopMode

> **DelegatedLoopMode** = *typeof* [`DELEGATED_LOOP_MODES`](#delegated_loop_modes)\[`number`\]

Defined in: [loop-runner.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L49)

**`Experimental`**

***

### DelegatedLoopRunner

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

Defined in: [loop-runner.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L58)

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

Defined in: [loop-runner.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L62)

**`Experimental`**

Mode → configured runner. Partial: only register the modes a
 given product/routine actually uses.

***

### RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

Defined in: [runtime-hooks.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L9)

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.

***

### RuntimeHookTarget

> **RuntimeHookTarget** = `"agent.run"` \| `"agent.turn"` \| `"agent.tool_call"` \| `"agent.spawn"` \| `"agent.child"` \| `"agent.plan"` \| `"agent.decision"` \| `string` & `object`

Defined in: [runtime-hooks.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L11)

***

### RuntimeDecisionKind

> **RuntimeDecisionKind** = `"continue"` \| `"verify"` \| `"ask"` \| `"retry"` \| `"stop"` \| `"memory-write"` \| `"memory-read"` \| `"tool-select"` \| `"skill-select"` \| `"workflow-select"` \| `"surface-promote"` \| `string` & `object`

Defined in: [runtime-hooks.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L21)

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

Defined in: [types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L144)

#### Stable

***

### AgentRuntimeEvent

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; \}

Defined in: [types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L147)

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

Defined in: [types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L188)

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

Defined in: [types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L256)

#### Stable

`tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
spec: `'auto'` (default — model decides), `'none'` (disable tool calling
for this turn), `'required'` (force a tool call), or a specific function
pin `{ type: 'function', function: { name } }`.

***

### RuntimeStreamEvent

> **RuntimeStreamEvent** = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: `KnowledgeReadinessDecision`; `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `model`: `string`; `tokensIn?`: `number`; `tokensOut?`: `number`; `costUsd?`: `number`; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: `RuntimeSession`; `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: `RuntimeSession`; `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](#backenderrordetail); `timestamp`: `string`; \}

Defined in: [types.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/types.ts#L263)

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

### defaultIsRetryable

> `const` **defaultIsRetryable**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Defined in: [conversation/call-policy.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L62)

Default retryable classification — network/timeout class errors. Errors
a model deliberately throws (validation, refusal, 4xx) are not retried;
those represent real outcomes, not transient infrastructure faults.

***

### FORWARD\_HEADERS

> `const` **FORWARD\_HEADERS**: `object`

Defined in: [conversation/headers.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L19)

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

Defined in: [conversation/headers.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L37)

Hard cap on chained gateway hops; refused beyond this. Default keeps recursion bounded.

***

### DELEGATED\_LOOP\_MODES

> `const` **DELEGATED\_LOOP\_MODES**: readonly \[`"code"`, `"review"`, `"research"`, `"audit"`, `"self-improve"`\]

Defined in: [loop-runner.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L46)

**`Experimental`**

Every delegated-loop mode, for validation + CLI surfaces.

***

### DEFAULT\_ROUTER\_BASE\_URL

> `const` **DEFAULT\_ROUTER\_BASE\_URL**: `"https://router.tangle.tools"` = `'https://router.tangle.tools'`

Defined in: [model-resolution.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L41)

***

### INTELLIGENCE\_WIRE\_VERSION

> `const` **INTELLIGENCE\_WIRE\_VERSION**: `"2026-05-26.v1"` = `'2026-05-26.v1'`

Defined in: [otel-export.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L527)

Wire version the eval-runs ingest enforces (X-Tangle-Wire-Version + body).

## Functions

### createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

Defined in: [backends.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L28)

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

Defined in: [backends.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L39)

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

Defined in: [backends.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/backends.ts#L205)

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

###### fetchImpl?

(`input`, `init?`) => `Promise`\<`Response`\>

###### retry?

`BackendRetryPolicy`

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

#### Stable

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

***

### makePerAttemptSignal()

> **makePerAttemptSignal**(`parentSignal`, `deadlineMs`): `object`

Defined in: [conversation/call-policy.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L126)

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

Defined in: [conversation/call-policy.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L166)

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

Defined in: [conversation/call-policy.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/call-policy.ts#L176)

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

***

### createConversationBackend()

> **createConversationBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

Defined in: [conversation/conversation-backend.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/conversation-backend.ts#L28)

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

Defined in: [conversation/define-conversation.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/define-conversation.ts#L13)

#### Parameters

##### input

###### participants

[`ConversationParticipant`](#conversationparticipant)[]

###### policy

[`ConversationPolicy`](#conversationpolicy)

#### Returns

[`Conversation`](#conversation)

***

### evalPersona()

> **evalPersona**(`worker`, `persona`, `opts?`): `Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

Defined in: [conversation/eval-persona.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/eval-persona.ts#L60)

#### Parameters

##### worker

`AgentProfile`

##### persona

`EvalPersona`

##### opts?

[`EvalPersonaOptions`](#evalpersonaoptions) = `{}`

#### Returns

`Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

***

### readDepth()

> **readDepth**(`headers`): `number`

Defined in: [conversation/headers.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L52)

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

Defined in: [conversation/headers.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L70)

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

Defined in: [conversation/headers.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/headers.ts#L81)

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

Defined in: [conversation/journal-sql.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/journal-sql.ts#L60)

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

Defined in: [conversation/run-conversation.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L64)

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

Defined in: [conversation/run-conversation.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/run-conversation.ts#L82)

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

Defined in: [conversation/turn-id.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L14)

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

Deterministic turn identifier. Stable across retries of the same logical
turn so backends (and any caching gateway in between) can dedupe on it.
A retry triggered by a network blip or deadline timeout MUST produce the
same `turn_id`; only the underlying attempt count differs.

Shape: `${runId}.t${index}.${speakerSlug}` — readable in logs, sortable by
turn index, attributable to a speaker. Slugify keeps the speaker portion
URL-safe so it can ride in HTTP headers without escaping.

***

### slugifySpeaker()

> **slugifySpeaker**(`speaker`): `string`

Defined in: [conversation/turn-id.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/conversation/turn-id.ts#L24)

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

Defined in: [improvement/agentic-generator.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L71)

`@tangle-network/agent-runtime` improvement — the CODE-surface proposer for
agent-eval's improvement loop.

The ONE entry point for optimization is agent-eval's `selfImprove`
(`@tangle-network/agent-eval/contract`) — text/config surfaces, held-out gated,
with `analyzeGeneration` for analyst-fed reflection and `analyzeRuns` /
`fromOtelSpans` / `partitionRunsByAuthoringModel` for production intake +
cohorting. This module supplies only the one genuinely runtime-specific piece:
a CODE-surface `SurfaceProposer` you pass to `selfImprove` as `proposer`, which
mutates a git worktree via a pluggable `CandidateGenerator`:
  - `reflectiveGenerator` — cheap, no sandbox, applies pre-drafted patches
  - `agenticGenerator`     — full coding harness in the worktree, multi-shot

#### Parameters

##### opts?

[`AgenticGeneratorOptions`](#agenticgeneratoroptions) = `{}`

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

Defined in: [improvement/agentic-generator.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/agentic-generator.ts#L159)

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

Defined in: [improvement/build-prompts.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L30)

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### mcpBuildPrompt()

> **mcpBuildPrompt**(`args`): `string`

Defined in: [improvement/build-prompts.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/build-prompts.ts#L43)

#### Parameters

##### args

`FindingsArg`

#### Returns

`string`

***

### improve()

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `findings`, `opts`): `Promise`\<[`ImproveResult`](#improveresult)\<`TScenario`, `TArtifact`\>\>

Defined in: [improvement/improve.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improve.ts#L200)

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

> **improvementDriver**(`opts`): `SurfaceProposer`\<`AnalystFinding`\>

Defined in: [improvement/improvement-driver.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/improvement-driver.ts#L60)

#### Parameters

##### opts

[`ImprovementDriverOptions`](#improvementdriveroptions)

#### Returns

`SurfaceProposer`\<`AnalystFinding`\>

***

### mcpServeVerifier()

> **mcpServeVerifier**(`spec`): [`Verifier`](#verifier)

Defined in: [improvement/mcp-serve-verifier.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/mcp-serve-verifier.ts#L43)

#### Parameters

##### spec

[`McpServeSpec`](#mcpservespec)

#### Returns

[`Verifier`](#verifier)

***

### reflectiveGenerator()

> **reflectiveGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Defined in: [improvement/reflective-generator.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/improvement/reflective-generator.ts#L24)

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### isDelegatedLoopMode()

> **isDelegatedLoopMode**(`value`): value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

Defined in: [loop-runner.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L52)

**`Experimental`**

Type guard for an untrusted mode string (CLI / config input).

#### Parameters

##### value

`unknown`

#### Returns

value is "code" \| "review" \| "research" \| "audit" \| "self-improve"

***

### runDelegatedLoop()

> **runDelegatedLoop**\<`T`\>(`mode`, `registry`, `options?`): `Promise`\<[`DelegatedLoopResult`](#delegatedloopresult)\<`T`\>\>

Defined in: [loop-runner.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L89)

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

Defined in: [loop-runner.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L159)

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

Defined in: [loop-runner.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L244)

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

Defined in: [loop-runner.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L271)

**`Experimental`**

`self-improve` mode — agent-eval's one-call closed loop (held-out gated).

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

Defined in: [loop-runner.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/loop-runner.ts#L278)

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

Defined in: [mcp/openai-tools.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L62)

**`Experimental`**

Returns the queue-bound delegation tools projected into OpenAI Chat
Completions `tools[]` shape. The order is stable: `delegate_feedback`,
`delegation_status`, `delegation_history`.

#### Returns

[`OpenAIChatTool`](#openaichattool)[]

***

### mcpToolsForRuntimeMcpSubset()

> **mcpToolsForRuntimeMcpSubset**(`names`): [`OpenAIChatTool`](#openaichattool)[]

Defined in: [mcp/openai-tools.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/openai-tools.ts#L90)

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

Defined in: [model-resolution.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L44)

Resolve the router base URL from env, normalised — no trailing `/v1` or `/`.

#### Parameters

##### env?

[`RouterEnv`](#routerenv) = `{}`

#### Returns

`string`

***

### getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Defined in: [model-resolution.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L54)

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

Defined in: [model-resolution.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L66)

Trim a candidate model id; `undefined` for non-strings and blanks.

#### Parameters

##### value

`unknown`

#### Returns

`string` \| `undefined`

***

### resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](#resolvedchatmodel)

Defined in: [model-resolution.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L89)

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

Defined in: [model-resolution.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/model-resolution.ts#L129)

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

Defined in: [otel-export.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L81)

Create an OTEL exporter. Returns undefined when no endpoint is configured.

#### Parameters

##### config?

[`OtelExportConfig`](#otelexportconfig)

#### Returns

[`OtelExporter`](#otelexporter) \| `undefined`

***

### loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): [`OtelSpan`](#otelspan)

Defined in: [otel-export.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L162)

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

### buildLoopOtelSpans()

> **buildLoopOtelSpans**(`events`, `traceId`, `rootParentSpanId?`): [`OtelSpan`](#otelspan)[]

Defined in: [otel-export.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L232)

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

Defined in: [otel-export.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L263)

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

Defined in: [otel-export.ts:590](https://github.com/tangle-network/agent-runtime/blob/main/src/otel-export.ts#L590)

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

Defined in: [readiness.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/readiness.ts#L22)

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

### applyRunRecordDefaults()

> **applyRunRecordDefaults**(`records`, `scenarioId`, `controlFailureClass`): `RunRecord`[]

Defined in: [run.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L48)

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

Defined in: [run.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L83)

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

Defined in: [run.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/run.ts#L197)

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

Defined in: [runtime-hooks.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L106)

Identity helper that types a [RuntimeHooks](#runtimehooks) literal so the fields are inferred.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks)

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](#runtimehooks)

Defined in: [runtime-hooks.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L115)

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

Defined in: [runtime-hooks.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L156)

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

Defined in: [runtime-hooks.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-hooks.ts#L186)

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

Defined in: [runtime-run.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime-run.ts#L148)

#### Parameters

##### options

`RuntimeRunOptions`

#### Returns

[`RuntimeRunHandle`](#runtimerunhandle)

#### Stable

Construct a runtime-run handle. The returned handle is mutable across its
lifetime; consumers should not share it across requests.

***

### sanitizeKnowledgeReadinessReport()

> **sanitizeKnowledgeReadinessReport**(`report`, `options?`): [`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

Defined in: [sanitize.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L81)

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

Defined in: [sanitize.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L104)

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

Defined in: [sanitize.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L160)

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

Defined in: [sanitize.ts:530](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L530)

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

Defined in: [sanitize.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/sanitize.ts#L557)

#### Parameters

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`RuntimeStreamEventCollector`](#runtimestreameventcollector)

#### Stable

Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
event yielded by `runAgentTaskStream` through `onEvent` and read the
sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
flags apply. Kept distinct from `createRuntimeEventCollector` because the
stream and non-stream event shapes overlap on `type` literals — dispatching
on `type` alone would misroute events.

***

### readinessServerSentEvent()

> **readinessServerSentEvent**(`report`, `options?`): `string`

Defined in: [sse.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L41)

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

Defined in: [sse.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/sse.ts#L56)

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
