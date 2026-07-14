[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / mcp

# mcp

## Classes

### CodexExecutionDiagnosticError

Defined in: [mcp/codex-diagnostics.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L19)

Thrown when reproducible Codex exits without one valid terminal usage event.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CodexExecutionDiagnosticError**(`reason`, `diagnostic`, `cause?`): [`CodexExecutionDiagnosticError`](#codexexecutiondiagnosticerror)

Defined in: [mcp/codex-diagnostics.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L22)

###### Parameters

###### reason

`string`

###### diagnostic

[`CodexExecutionFailureDiagnostic`](#codexexecutionfailurediagnostic)

###### cause?

`unknown`

###### Returns

[`CodexExecutionDiagnosticError`](#codexexecutiondiagnosticerror)

###### Overrides

`Error.constructor`

#### Properties

##### code

> `readonly` **code**: `"CODEX_EXECUTION_DIAGNOSTIC"` = `'CODEX_EXECUTION_DIAGNOSTIC'`

Defined in: [mcp/codex-diagnostics.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L20)

##### reason

> `readonly` **reason**: `string`

Defined in: [mcp/codex-diagnostics.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L23)

##### diagnostic

> `readonly` **diagnostic**: [`CodexExecutionFailureDiagnostic`](#codexexecutionfailurediagnostic)

Defined in: [mcp/codex-diagnostics.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L24)

***

### DelegationStateCorruptError

Defined in: [mcp/delegation-store.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L55)

**`Experimental`**

The persisted delegation state exists but cannot be parsed into
records. Fail loud: silently starting empty over a corrupt journal
would erase delegation history and re-run idempotent work. Opt into
recovery explicitly via `FileDelegationStoreOptions.recoverCorrupt`
(the bin maps `AGENT_RUNTIME_DELEGATION_STATE_RECOVER=1` onto it),
which archives the corrupt file and starts fresh.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new DelegationStateCorruptError**(`message`, `options?`): [`DelegationStateCorruptError`](#delegationstatecorrupterror)

Defined in: [mcp/delegation-store.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L56)

**`Experimental`**

###### Parameters

###### message

`string`

###### options?

###### cause?

`unknown`

###### Returns

[`DelegationStateCorruptError`](#delegationstatecorrupterror)

###### Overrides

`AgentEvalError.constructor`

***

### DelegationPersistenceError

Defined in: [mcp/delegation-store.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L69)

**`Experimental`**

A delegation-store read or write failed (filesystem error, store
called before `loadAll`, ...). Once the queue observes one, it stops
accepting new submissions — accepting work it cannot journal would
silently demote durable mode to in-memory mode.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new DelegationPersistenceError**(`message`, `options?`): [`DelegationPersistenceError`](#delegationpersistenceerror)

Defined in: [mcp/delegation-store.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L70)

**`Experimental`**

###### Parameters

###### message

`string`

###### options?

###### cause?

`unknown`

###### Returns

[`DelegationPersistenceError`](#delegationpersistenceerror)

###### Overrides

`AgentEvalError.constructor`

***

### InMemoryDelegationStore

Defined in: [mcp/delegation-store.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L76)

**`Experimental`**

In-memory `DelegationStore` — suitable for single-process use and tests.

#### Implements

- [`DelegationStore`](#delegationstore)

#### Constructors

##### Constructor

> **new InMemoryDelegationStore**(): [`InMemoryDelegationStore`](#inmemorydelegationstore)

**`Experimental`**

###### Returns

[`InMemoryDelegationStore`](#inmemorydelegationstore)

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Defined in: [mcp/delegation-store.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L79)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`loadAll`](#loadall)

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L83)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`upsert`](#upsert)

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L87)

**`Experimental`**

Resolve an idempotency key to the taskId that claimed it, if any.
The queue serves submit-time dedupe from its rehydrated in-memory
index; this read exists for consumers that share a store across
processes without holding the full record set.

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`lookupIdempotencyKey`](#lookupidempotencykey)

##### remove()

> **remove**(`taskIds`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L94)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`remove`](#remove)

***

### FileDelegationStore

Defined in: [mcp/delegation-store.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L131)

**`Experimental`**

JSON-file persistence for the delegation queue. Each write serializes
the full record set and lands it atomically (write to a sibling tmp
file, then `rename`), so readers never observe a torn file — a crash
mid-write leaves the previous snapshot intact. Writes are serialized
internally; concurrent `upsert`/`remove` calls cannot interleave.

Built for the MCP server's scale (one stdio process, hundreds of
records): full-snapshot writes keep the format trivially inspectable
and corruption-detectable without a database dependency.

#### Implements

- [`DelegationStore`](#delegationstore)

#### Constructors

##### Constructor

> **new FileDelegationStore**(`options`): [`FileDelegationStore`](#filedelegationstore)

Defined in: [mcp/delegation-store.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L139)

**`Experimental`**

###### Parameters

###### options

[`FileDelegationStoreOptions`](#filedelegationstoreoptions)

###### Returns

[`FileDelegationStore`](#filedelegationstore)

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Defined in: [mcp/delegation-store.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L144)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`loadAll`](#loadall)

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L181)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`upsert`](#upsert)

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L187)

**`Experimental`**

Resolve an idempotency key to the taskId that claimed it, if any.
The queue serves submit-time dedupe from its rehydrated in-memory
index; this read exists for consumers that share a store across
processes without holding the full record set.

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`lookupIdempotencyKey`](#lookupidempotencykey)

##### remove()

> **remove**(`taskIds`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L195)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`remove`](#remove)

***

### InMemoryFeedbackStore

Defined in: [mcp/feedback-store.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L41)

**`Experimental`**

In-memory `FeedbackStore` — suitable for single-process use and tests.

#### Implements

- [`FeedbackStore`](#feedbackstore)

#### Constructors

##### Constructor

> **new InMemoryFeedbackStore**(): [`InMemoryFeedbackStore`](#inmemoryfeedbackstore)

**`Experimental`**

###### Returns

[`InMemoryFeedbackStore`](#inmemoryfeedbackstore)

#### Methods

##### put()

> **put**(`event`): `Promise`\<`void`\>

Defined in: [mcp/feedback-store.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L44)

**`Experimental`**

Append a new event. Never dedupes — every rating is its own event.

###### Parameters

###### event

[`FeedbackEvent`](#feedbackevent)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`FeedbackStore`](#feedbackstore).[`put`](#put)

##### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

Defined in: [mcp/feedback-store.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L48)

**`Experimental`**

List events filtered by `namespace`. When `namespace` is omitted, list
across all namespaces. Returns events in insertion order.

###### Parameters

###### filter?

###### namespace?

`string`

###### refersToRef?

`string`

###### Returns

`Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

###### Implementation of

[`FeedbackStore`](#feedbackstore).[`list`](#list)

***

### DelegationTaskQueue

Defined in: [mcp/task-queue.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L243)

**`Experimental`**

In-process queue for async delegation tasks — submit, cancel, poll status, and read history.

#### Constructors

##### Constructor

> **new DelegationTaskQueue**(`options?`): [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/task-queue.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L257)

**`Experimental`**

###### Parameters

###### options?

[`DelegationTaskQueueOptions`](#delegationtaskqueueoptions) = `{}`

###### Returns

[`DelegationTaskQueue`](#delegationtaskqueue)

#### Methods

##### restore()

> `static` **restore**(`options?`): `Promise`\<[`DelegationTaskQueue`](#delegationtaskqueue)\>

Defined in: [mcp/task-queue.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L293)

**`Experimental`**

Construct a queue from previously-persisted state. Loads every record
from `options.store`, rebuilds the idempotency index (so a re-submitted
identical task returns the prior taskId and its terminal state), then:

  - terminal records stay queryable via `status()` / `history()`
  - in-flight records with a `detachedSessionRef` re-attach through
    `options.resumeDelegate` and report `running`
  - other in-flight records settle as failed — their driver died with
    the previous process and the result is unrecoverable

The retention cap applies to the loaded set as well.

###### Parameters

###### options?

[`DelegationTaskQueueOptions`](#delegationtaskqueueoptions) = `{}`

###### Returns

`Promise`\<[`DelegationTaskQueue`](#delegationtaskqueue)\>

##### submit()

> **submit**\<`Args`\>(`input`): [`SubmitOutput`](#submitoutput)

Defined in: [mcp/task-queue.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L306)

**`Experimental`**

Kick off a delegation in the background. Returns immediately. The
`taskId` is queryable via `status` once this method returns. Throws
the recorded `DelegationPersistenceError` once the store has failed —
the queue does not accept work it cannot journal.

###### Type Parameters

###### Args

`Args` *extends* `AnyDelegateArgs`

###### Parameters

###### input

[`SubmitInput`](#submitinput)\<`Args`\>

###### Returns

[`SubmitOutput`](#submitoutput)

##### status()

> **status**(`taskId`, `opts?`): [`DelegationStatusResult`](#delegationstatusresult) \| `undefined`

Defined in: [mcp/task-queue.ts:356](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L356)

**`Experimental`**

Snapshot the current state of a delegation. Returns `undefined` for
unknown ids so callers can distinguish missing from terminal.
`includeTrace` attaches the journaled loop-trace span tree — off by
default so status polls stay light.

###### Parameters

###### taskId

`string`

###### opts?

###### includeTrace?

`boolean`

###### Returns

[`DelegationStatusResult`](#delegationstatusresult) \| `undefined`

##### cancel()

> **cancel**(`taskId`): `boolean`

Defined in: [mcp/task-queue.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L369)

**`Experimental`**

Abort an in-flight delegation. Returns `false` if the task is unknown
or already terminal. The underlying `run` function MUST honor the
abort signal for the cancel to take effect; the queue marks the
record `cancelled` regardless so a misbehaving runner cannot pin the
UI on `running` forever.

###### Parameters

###### taskId

`string`

###### Returns

`boolean`

##### attachFeedback()

> **attachFeedback**(`taskId`, `snapshot`): `boolean`

Defined in: [mcp/task-queue.ts:389](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L389)

**`Experimental`**

Append a feedback event to the matching delegation. Returns `false`
when `ref` does not name a known taskId — the caller should still
record the feedback through a different surface (artifact/outcome
kinds are not queue-bound).

###### Parameters

###### taskId

`string`

###### snapshot

[`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)

###### Returns

`boolean`

##### history()

> **history**(`args?`): [`DelegationHistoryEntry`](#delegationhistoryentry)[]

Defined in: [mcp/task-queue.ts:401](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L401)

**`Experimental`**

Query the recorded delegations. Returns entries newest-first (by
`startedAt`), truncated to `limit`.

###### Parameters

###### args?

[`DelegationHistoryArgs`](#delegationhistoryargs) = `{}`

###### Returns

[`DelegationHistoryEntry`](#delegationhistoryentry)[]

##### flush()

> **flush**(): `Promise`\<`void`\>

Defined in: [mcp/task-queue.ts:420](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L420)

**`Experimental`**

Await every journal write issued so far. Rejects with the recorded
`DelegationPersistenceError` when any of them failed. Call before
handing the store's backing file to another process.

###### Returns

`Promise`\<`void`\>

##### inflightCount()

> **inflightCount**(): `number`

Defined in: [mcp/task-queue.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L436)

**`Experimental`**

Test-only — number of in-flight (non-terminal) records.

###### Returns

`number`

## Interfaces

### DetectExecutorArgs

Defined in: [mcp/bin-helpers.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L21)

**`Experimental`**

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [mcp/bin-helpers.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L22)

**`Experimental`**

##### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [mcp/bin-helpers.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L24)

**`Experimental`**

Raw env (defaults to `process.env`). Pass an explicit map for tests.

##### resolveFleet?

> `optional` **resolveFleet?**: (`client`, `fleetId`) => `Promise`\<[`FleetHandle`](#fleethandle)\>

Defined in: [mcp/bin-helpers.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L30)

**`Experimental`**

Override how a fleet handle is resolved from the client + fleet id. The
default reads `client.fleets.get(fleetId)` and validates the returned
shape against the structural `FleetHandle` contract.

###### Parameters

###### client

[`SandboxClient`](runtime.md#sandboxclient-3)

###### fleetId

`string`

###### Returns

`Promise`\<[`FleetHandle`](#fleethandle)\>

***

### CodexExecutionFailureDiagnostic

Defined in: [mcp/codex-diagnostics.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L7)

Bounded, credential-redacted process context attached when reproducible Codex output fails
validation. The process still fails closed; this only preserves enough evidence to diagnose it.

#### Properties

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/codex-diagnostics.ts:8](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L8)

##### killedBySignal

> **killedBySignal**: `Signals` \| `null`

Defined in: [mcp/codex-diagnostics.ts:9](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L9)

##### timedOut

> **timedOut**: `boolean`

Defined in: [mcp/codex-diagnostics.ts:10](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L10)

##### durationMs

> **durationMs**: `number`

Defined in: [mcp/codex-diagnostics.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L11)

##### stdout

> **stdout**: `string`

Defined in: [mcp/codex-diagnostics.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L12)

##### stderr

> **stderr**: `string`

Defined in: [mcp/codex-diagnostics.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L13)

##### stdoutTruncated

> **stdoutTruncated**: `boolean`

Defined in: [mcp/codex-diagnostics.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L14)

##### stderrTruncated

> **stderrTruncated**: `boolean`

Defined in: [mcp/codex-diagnostics.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/codex-diagnostics.ts#L15)

***

### DelegateRunCtx

Defined in: [mcp/delegates.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L57)

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L58)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/delegates.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L66)

**`Experimental`**

Detached-run resume key recorded on the queue record at submit time
(`formatDetachedSessionRef`). Present only when the submit path requested
detached dispatch — its presence is what routes a session-backed delegate
onto the `driveTurn` tick path instead of holding a stream.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegates.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L75)

**`Experimental`**

Per-delegation trace sink supplied by the queue — loop events emitted
here land on the delegation record as a compact span tree. Delegates
compose it with their configured OTEL emitter so both sinks observe
the same stream.

#### Methods

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/delegates.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L59)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()?

> `optional` **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/delegates.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L68)

**`Experimental`**

Rebind the record's resume key (e.g. once the sandbox id is known).

###### Parameters

###### ref

`string`

###### Returns

`void`

***

### CoderReview

Defined in: [mcp/delegates.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L98)

**`Experimental`**

Structured review verdict over a coder candidate.

#### Properties

##### approved

> **approved**: `boolean`

Defined in: [mcp/delegates.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L100)

**`Experimental`**

Gate: only approved candidates are eligible to win.

##### recommendation

> **recommendation**: `"ship"` \| `"reject"` \| `"approve-with-nits"` \| `"changes-requested"`

Defined in: [mcp/delegates.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L102)

**`Experimental`**

Reviewer's recommendation — surfaced in traces.

##### readiness

> **readiness**: `number`

Defined in: [mcp/delegates.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L104)

**`Experimental`**

Readiness 0..1, used by the `highest-readiness` winner-selection strategy.

##### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/delegates.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L105)

**`Experimental`**

***

### DetachedSessionDelegateOptions

Defined in: [mcp/delegates.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L138)

**`Experimental`**

#### Properties

##### executor?

> `optional` **executor?**: [`DelegationExecutor`](#delegationexecutor)

Defined in: [mcp/delegates.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L145)

**`Experimental`**

Execution placement. Pass a [DelegationExecutor](#delegationexecutor) (sibling or fleet)
to control where worker iterations land. `sandboxClient` is a
convenience shorthand that wraps the client in a sibling executor — pass
one or the other, not both.

##### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [mcp/delegates.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L150)

**`Experimental`**

Convenience shorthand for sibling placement. Equivalent to
`executor: createSiblingSandboxExecutor({ client: sandboxClient })`.

##### workerProfile?

> `optional` **workerProfile?**: `AgentProfile`

Defined in: [mcp/delegates.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L158)

**`Experimental`**

The worker's authored `AgentProfile` (§1.5: the system authors profiles). Spread onto the
sandbox-session run spec → `runLoop` → the executor's `harnessInvocation`, so the harness runs
under the caller's stance. Omit to use a minimal model-only default (no hardcoded skills/tools);
`harness` / `model` / `systemPrompt` below are convenience overrides layered onto whichever
profile is used.

##### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L160)

**`Experimental`**

Backend harness for the single-coder path (sets `metadata.backendType`). Default `claude-code`.

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L162)

**`Experimental`**

Model override for the single-coder path.

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [mcp/delegates.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L168)

**`Experimental`**

The worker's authored system prompt (§1.5). Flows onto the run spec's
`profile.prompt.systemPrompt` → through `runLoop` → the executor's `harnessInvocation`, so the
harness runs under this stance. Omit to keep the profile's own prompt.

##### fanoutHarnesses?

> `optional` **fanoutHarnesses?**: `string`[]

Defined in: [mcp/delegates.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L170)

**`Experimental`**

Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1.

##### fanoutModels?

> `optional` **fanoutModels?**: (`string` \| `undefined`)[]

Defined in: [mcp/delegates.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L172)

**`Experimental`**

Optional per-harness model override for `variants > 1`.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/delegates.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L174)

**`Experimental`**

Hard cap on the kernel's per-batch concurrency. Default 4.

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

Defined in: [mcp/delegates.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L181)

**`Experimental`**

Optional adversarial reviewer. When set, a candidate must pass mechanical
validation AND `reviewer.approved` to be eligible to win — empty/secret/
test-failing patches are already gone; this catches the "compiles + passes
but wrong/unsafe" class the deterministic validator can't see.

##### winnerSelection?

> `optional` **winnerSelection?**: [`DetachedWinnerSelection`](#detachedwinnerselection)

Defined in: [mcp/delegates.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L183)

**`Experimental`**

Winner-selection strategy among eligible candidates. Default `highest-score`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegates.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L195)

**`Experimental`**

Loop trace emitter forwarded into every delegated `runLoop`. Wire
`createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
does) so delegated build-loops export their topology spans to the OTLP /
Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
are a cheap no-op when it isn't. Configurable by construction.

Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
bypass `runLoop`; `runDetachedTurn` synthesizes a single-iteration loop
event stream for them so this emitter observes detached work too.

##### detachedTickIntervalMs?

> `optional` **detachedTickIntervalMs?**: `number`

Defined in: [mcp/delegates.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L197)

**`Experimental`**

Tick cadence (ms) for the detached single-variant path. Default 5000.

##### detachedWallCapMs?

> `optional` **detachedWallCapMs?**: `number`

Defined in: [mcp/delegates.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L199)

**`Experimental`**

Wall-clock cap (ms) forwarded to `driveTurn` for detached turns.

***

### SettleDetachedCoderTurnOptions

Defined in: [mcp/delegates.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L440)

**`Experimental`**

#### Properties

##### task

> **task**: [`CoderTask`](profiles.md#codertask)

Defined in: [mcp/delegates.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L441)

**`Experimental`**

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/delegates.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L443)

**`Experimental`**

Session id of the detached turn — used as the synthesized event id.

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L444)

**`Experimental`**

##### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L445)

**`Experimental`**

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L446)

**`Experimental`**

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

Defined in: [mcp/delegates.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L448)

**`Experimental`**

Same gate as the streaming path: an unapproved candidate cannot win.

***

### DelegationStore

Defined in: [mcp/delegation-store.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L24)

**`Experimental`**

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Defined in: [mcp/delegation-store.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L31)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L33)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L40)

**`Experimental`**

Resolve an idempotency key to the taskId that claimed it, if any.
The queue serves submit-time dedupe from its rehydrated in-memory
index; this read exists for consumers that share a store across
processes without holding the full record set.

###### Parameters

###### key

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

##### remove()

> **remove**(`taskIds`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L42)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### FileDelegationStoreOptions

Defined in: [mcp/delegation-store.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L100)

**`Experimental`**

#### Properties

##### filePath

> **filePath**: `string`

Defined in: [mcp/delegation-store.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L102)

**`Experimental`**

Absolute path of the JSON state file. Parent directories are created on first write.

##### recoverCorrupt?

> `optional` **recoverCorrupt?**: `boolean`

Defined in: [mcp/delegation-store.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L108)

**`Experimental`**

When the state file exists but cannot be parsed, archive it to
`<filePath>.corrupt-<timestamp>` and start empty instead of
throwing `DelegationStateCorruptError`. Default false.

***

### DelegationTraceSpan

Defined in: [mcp/delegation-trace.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L32)

**`Experimental`**

One span of a delegation's compact trace. Flat (parent linkage by id), all
values JSON-safe scalars — `FileDelegationStore` round-trips records
through `JSON.stringify`. `meta` carries the span's attributes (GenAI
semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
them, so a consumer can re-export journal traces losslessly.

#### Properties

##### spanId

> **spanId**: `string`

Defined in: [mcp/delegation-trace.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L33)

**`Experimental`**

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/delegation-trace.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L35)

**`Experimental`**

Absent on the tree root.

##### name

> **name**: `string`

Defined in: [mcp/delegation-trace.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L37)

**`Experimental`**

`'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name).

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [mcp/delegation-trace.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L39)

**`Experimental`**

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

Defined in: [mcp/delegation-trace.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L40)

**`Experimental`**

##### endMs

> **endMs**: `number`

Defined in: [mcp/delegation-trace.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L41)

**`Experimental`**

##### meta?

> `optional` **meta?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [mcp/delegation-trace.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L42)

**`Experimental`**

***

### DelegationTraceCaps

Defined in: [mcp/delegation-trace.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L52)

**`Experimental`**

#### Properties

##### maxSpans?

> `optional` **maxSpans?**: `number`

Defined in: [mcp/delegation-trace.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L54)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_SPANS](#delegation_trace_max_spans).

##### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [mcp/delegation-trace.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L57)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_BYTES](#delegation_trace_max_bytes). Approximate — measured as the
 sum of per-span `JSON.stringify` lengths.

***

### CappedDelegationTrace

Defined in: [mcp/delegation-trace.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L61)

**`Experimental`**

#### Properties

##### trace

> **trace**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/delegation-trace.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L62)

**`Experimental`**

##### truncated

> **truncated**: `boolean`

Defined in: [mcp/delegation-trace.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L64)

**`Experimental`**

True when oldest spans were dropped to honor the caps.

***

### DelegationTraceCollector

Defined in: [mcp/delegation-trace.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L124)

**`Experimental`**

Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
(mirroring the OTEL emitter's buffering) and hands the derived compact
spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
that never ended — a hard-aborted loop still leaves its partial tree in the
journal, unlike the OTEL path which drops it.

#### Properties

##### emitter

> **emitter**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegation-trace.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L125)

**`Experimental`**

#### Methods

##### settle()

> **settle**(): `void`

Defined in: [mcp/delegation-trace.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L127)

**`Experimental`**

Flush buffered events of runs that never reached `loop.ended`.

###### Returns

`void`

***

### DriveTurnCapableBox

Defined in: [mcp/detached-turn.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L68)

**`Experimental`**

The box surface detached turns need. `SandboxInstance`
(`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
optional here because older SDKs / fakes may not expose it; when present it
is invoked on abort so the remote run actually stops.

#### Methods

##### driveTurn()

> **driveTurn**(`message`, `opts`): `Promise`\<[`DriveTurnTick`](#driveturntick)\>

Defined in: [mcp/detached-turn.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L69)

**`Experimental`**

###### Parameters

###### message

`string`

###### opts

###### sessionId

`string`

###### turnId?

`string`

###### wallCapMs?

`number`

###### Returns

`Promise`\<[`DriveTurnTick`](#driveturntick)\>

##### \_sessionCancel()?

> `optional` **\_sessionCancel**(`id`): `Promise`\<`void`\>

Defined in: [mcp/detached-turn.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L73)

**`Experimental`**

###### Parameters

###### id

`string`

###### Returns

`Promise`\<`void`\>

***

### DetachedSessionRefParts

Defined in: [mcp/detached-turn.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L84)

**`Experimental`**

Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
submit and box acquisition — a record restored in that window is not
resumable (there is no box to resume on) and the resume driver fails it
loud rather than dispatching onto a guessed box.

#### Properties

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L85)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [mcp/detached-turn.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L86)

**`Experimental`**

***

### DetachedTurn

Defined in: [mcp/detached-turn.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L136)

**`Experimental`**

The terminal payload of a finished detached turn.

#### Properties

##### text

> **text**: `string`

Defined in: [mcp/detached-turn.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L138)

**`Experimental`**

Final assistant text.

##### result

> **result**: `Record`\<`string`, `unknown`\>

Defined in: [mcp/detached-turn.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L140)

**`Experimental`**

The SDK's cached AgentExecutionResult-shape record for the turn.

***

### RunDetachedTurnOptions

Defined in: [mcp/detached-turn.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L167)

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [mcp/detached-turn.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L169)

**`Experimental`**

Sandbox client used to acquire the box (the delegate's executor client).

##### spec

> **spec**: [`AgentRunSpec`](runtime.md#agentrunspec)\<`unknown`\>

Defined in: [mcp/detached-turn.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L171)

**`Experimental`**

Profile + overrides for box acquisition — same spec the streaming path uses.

##### prompt

> **prompt**: `string`

Defined in: [mcp/detached-turn.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L173)

**`Experimental`**

The full turn prompt; consumed by `driveTurn`'s dispatch leg.

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L175)

**`Experimental`**

Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`).

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/detached-turn.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L182)

**`Experimental`**

##### tickIntervalMs?

> `optional` **tickIntervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L185)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L187)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/detached-turn.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L197)

**`Experimental`**

Loop-trace sink. When set, the detached turn synthesizes a
single-iteration loop span tree (`runId` = `sessionId`, driver
`'detached-turn'`) so trace-context inheritance survives the detached
path — the same events the streaming `runLoop` path would emit, minus
per-token telemetry: `driveTurn` yields one terminal payload, so token
and cost figures are structurally unavailable and reported as 0 under
this driver tag.

##### placement?

> `optional` **placement?**: `"sibling"` \| `"fleet"`

Defined in: [mcp/detached-turn.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L199)

**`Experimental`**

Physical placement stamped on the synthesized dispatch event. Default `'sibling'`.

#### Methods

##### bindSandbox()

> **bindSandbox**(`sandboxId`): `void`

Defined in: [mcp/detached-turn.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L181)

**`Experimental`**

Called once the box exists, with its sandbox id. Callers persist
`formatDetachedSessionRef({ sandboxId, sessionId })` onto the record here so
a restart can resolve the box again.

###### Parameters

###### sandboxId

`string`

###### Returns

`void`

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/detached-turn.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L183)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DetachedTurnResumeDriverOptions

Defined in: [mcp/detached-turn.ts:366](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L366)

**`Experimental`**

#### Properties

##### intervalMs?

> `optional` **intervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:391](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L391)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L393)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` on every tick.

#### Methods

##### resolveSandbox()

> **resolveSandbox**(`sandboxId`): `Promise`\<[`DriveTurnCapableBox`](#driveturncapablebox)\>

Defined in: [mcp/detached-turn.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L372)

**`Experimental`**

Resolve the live box owning a detached session. The bin wires this to the
sandbox client's `get(sandboxId)`; throw when the box no longer exists —
a thrown tick settles the record as failed, which is the truth.

###### Parameters

###### sandboxId

`string`

###### Returns

`Promise`\<[`DriveTurnCapableBox`](#driveturncapablebox)\>

##### buildMessage()

> **buildMessage**(`record`): `string`

Defined in: [mcp/detached-turn.ts:379](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L379)

**`Experimental`**

Rebuild the turn prompt from the persisted record. Only consumed by
`driveTurn`'s dispatch leg — i.e. when the previous process died after
binding the box but before the session was dispatched. Must reproduce the
prompt the delegate would have sent.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`string`

##### settleOutput()

> **settleOutput**(`turn`, `record`, `ctx`): `CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape) \| `Promise`\<`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

Defined in: [mcp/detached-turn.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L385)

**`Experimental`**

Map a completed turn onto the delegation's typed output payload (parse +
validate per profile). Throw when the resumed result does not pass the
profile's gate — the queue settles the record as failed with that error.

###### Parameters

###### turn

[`DetachedTurn`](#detachedturn)

###### record

[`DelegationRecord`](#delegationrecord)

###### ctx

###### signal

`AbortSignal`

###### Returns

`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape) \| `Promise`\<`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

***

### DelegationExecutor

Defined in: [mcp/executor.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L26)

**`Experimental`**

#### Properties

##### client

> `readonly` **client**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [mcp/executor.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L28)

**`Experimental`**

Sandbox client the kernel calls. Returned with `describePlacement` set.

##### placement?

> `readonly` `optional` **placement?**: `"sibling"` \| `"fleet"` \| `"in-process"`

Defined in: [mcp/executor.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L38)

**`Experimental`**

Where delegated work physically runs. `sibling` and `fleet` placements are
session-backed (boxes expose `driveTurn`, so detached dispatch + resume
apply); `in-process` spawns local harness CLIs with no sandbox session to
detach. Optional so consumer-implemented executors stay source-compatible;
absent means "unknown" and detached dispatch is not enabled for it.

#### Methods

##### describe()

> **describe**(): `string`

Defined in: [mcp/executor.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L30)

**`Experimental`**

Best-effort one-liner used in stderr boot logs and diagnostics.

###### Returns

`string`

***

### SiblingSandboxExecutorOptions

Defined in: [mcp/executor.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L42)

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [mcp/executor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L43)

**`Experimental`**

***

### FleetHandle

Defined in: [mcp/executor.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L83)

**`Experimental`**

Minimal `SandboxFleet` surface the fleet executor calls. Declared
structurally so tests can pass an in-memory stub without instantiating the
sandbox SDK.

#### Properties

##### fleetId

> `readonly` **fleetId**: `string`

Defined in: [mcp/executor.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L84)

**`Experimental`**

##### ids

> `readonly` **ids**: readonly `string`[]

Defined in: [mcp/executor.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L86)

**`Experimental`**

Machine ids in dispatch-eligible order. The executor round-robins.

#### Methods

##### sandbox()

> **sandbox**(`machineId`): `Promise`\<`SandboxInstance`\>

Defined in: [mcp/executor.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L90)

**`Experimental`**

Resolve a machine id to its `SandboxInstance` — that machine is mounted
on the fleet's shared workspace, so any diff the worker writes lands on
every other fleet machine's filesystem too.

###### Parameters

###### machineId

`string`

###### Returns

`Promise`\<`SandboxInstance`\>

***

### FleetWorkspaceExecutorOptions

Defined in: [mcp/executor.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L94)

**`Experimental`**

#### Properties

##### fleet

> **fleet**: [`FleetHandle`](#fleethandle)

Defined in: [mcp/executor.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L95)

**`Experimental`**

##### selectMachine?

> `optional` **selectMachine?**: (`call`) => `string`

Defined in: [mcp/executor.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L101)

**`Experimental`**

Override the machine-selection policy. Default = round-robin across
`fleet.ids`, skipping the optional `excludeMachineIds` set (typically the
coordinator machine the MCP server is running on).

###### Parameters

###### call

###### callIndex

`number`

###### ids

readonly `string`[]

###### Returns

`string`

##### excludeMachineIds?

> `optional` **excludeMachineIds?**: readonly `string`[]

Defined in: [mcp/executor.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L106)

**`Experimental`**

Machine ids to skip during default round-robin. Set to the caller's own
machineId so workers don't compete with the orchestrator on the same VM.

***

### FeedbackEvent

Defined in: [mcp/feedback-store.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L20)

**`Experimental`**

#### Properties

##### id

> **id**: `string`

Defined in: [mcp/feedback-store.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L21)

**`Experimental`**

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

Defined in: [mcp/feedback-store.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L22)

**`Experimental`**

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

Defined in: [mcp/feedback-store.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L23)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

Defined in: [mcp/feedback-store.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L24)

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: [mcp/feedback-store.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L25)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/feedback-store.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L26)

**`Experimental`**

***

### FeedbackStore

Defined in: [mcp/feedback-store.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L30)

**`Experimental`**

#### Methods

##### put()

> **put**(`event`): `Promise`\<`void`\>

Defined in: [mcp/feedback-store.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L32)

**`Experimental`**

Append a new event. Never dedupes — every rating is its own event.

###### Parameters

###### event

[`FeedbackEvent`](#feedbackevent)

###### Returns

`Promise`\<`void`\>

##### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

Defined in: [mcp/feedback-store.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L37)

**`Experimental`**

List events filtered by `namespace`. When `namespace` is omitted, list
across all namespaces. Returns events in insertion order.

###### Parameters

###### filter?

###### namespace?

`string`

###### refersToRef?

`string`

###### Returns

`Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

***

### InProcessExecutorOptions

Defined in: [mcp/in-process-executor.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L34)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/in-process-executor.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L36)

**`Experimental`**

Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`.

##### harnesses?

> `optional` **harnesses?**: readonly [`LocalHarness`](#localharness)[]

Defined in: [mcp/in-process-executor.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L38)

**`Experimental`**

Harnesses to round-robin across `create()` calls. One entry = no fanout. Default `['claude']`.

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L40)

**`Experimental`**

Optional per-delegation test command run in the worktree after the harness exits.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L42)

**`Experimental`**

Optional per-delegation typecheck command. Same shape as `testCmd`.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L44)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5min.

##### postCheckTimeoutMs?

> `optional` **postCheckTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L46)

**`Experimental`**

Wall-clock cap per test/typecheck subprocess (ms). Default 2min.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/in-process-executor.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L48)

**`Experimental`**

Test seam — override the git runner used by the worktree helpers.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

Defined in: [mcp/in-process-executor.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L50)

**`Experimental`**

Test seam — override the harness runner (defaults to the real CLI via `runLocalHarness`).

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

[`RunLocalHarnessOptions`](#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

##### runPostCheck?

> `optional` **runPostCheck?**: (`cmd`, `cwd`, `signal?`) => `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

Defined in: [mcp/in-process-executor.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L53)

**`Experimental`**

Test seam — override the post-check runner (defaults to a `sh -c` spawn). A throw is folded
 into a non-fatal `{exitCode:-1}` so a broken check command fails the signal, not the run.

###### Parameters

###### cmd

`string`

###### cwd

`string`

###### signal?

`AbortSignal`

###### Returns

`Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

***

### InProcessExecutorDescribePlacement

Defined in: [mcp/in-process-executor.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L61)

**`Experimental`**

#### Extends

- [`LoopSandboxPlacement`](runtime.md#loopsandboxplacement)

#### Properties

##### worktreePath?

> `optional` **worktreePath?**: `string`

Defined in: [mcp/in-process-executor.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L63)

**`Experimental`**

Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts).

##### harness?

> `optional` **harness?**: [`LocalHarness`](#localharness)

Defined in: [mcp/in-process-executor.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L65)

**`Experimental`**

Which harness handled this delegation.

##### kind

> **kind**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L397)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`kind`](runtime.md#kind-4)

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L398)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`sandboxId`](runtime.md#sandboxid)

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L399)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`fleetId`](runtime.md#fleetid)

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L400)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`machineId`](runtime.md#machineid)

***

### FactCandidate

Defined in: [mcp/kb-gate.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L25)

**`Experimental`**

A fact proposed for the KB, with its grounding.

#### Properties

##### claim

> **claim**: `string`

Defined in: [mcp/kb-gate.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L27)

**`Experimental`**

The atomic claim text.

##### value?

> `optional` **value?**: `string` \| `number`

Defined in: [mcp/kb-gate.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L29)

**`Experimental`**

Optional extracted value (number or string) the claim asserts.

##### verbatimPassage

> **verbatimPassage**: `string`

Defined in: [mcp/kb-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L31)

**`Experimental`**

Verbatim span lifted from the source that backs the claim.

##### sourceText

> **sourceText**: `string`

Defined in: [mcp/kb-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L33)

**`Experimental`**

The raw source text the passage must be grounded in.

##### citation?

> `optional` **citation?**: `string`

Defined in: [mcp/kb-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L35)

**`Experimental`**

Where the fact claims to come from — checked for circular/self citations.

***

### FactJudgeVerdict

Defined in: [mcp/kb-gate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L39)

**`Experimental`**

#### Properties

##### accept

> **accept**: `boolean`

Defined in: [mcp/kb-gate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L40)

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

Defined in: [mcp/kb-gate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L41)

**`Experimental`**

***

### FactJudge

Defined in: [mcp/kb-gate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L46)

**`Experimental`**

A pluggable fact validator. Throw is NOT allowed — return a
 verdict; a thrown judge is a programmer error, not a veto.

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/kb-gate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L47)

**`Experimental`**

#### Methods

##### judge()

> **judge**(`candidate`): [`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

Defined in: [mcp/kb-gate.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L48)

**`Experimental`**

###### Parameters

###### candidate

[`FactCandidate`](#factcandidate)

###### Returns

[`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

***

### KbGateResult

Defined in: [mcp/kb-gate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L52)

**`Experimental`**

#### Properties

##### accepted

> **accepted**: `boolean`

Defined in: [mcp/kb-gate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L53)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

Defined in: [mcp/kb-gate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L55)

**`Experimental`**

Name of the judge that vetoed; undefined when accepted.

##### reason?

> `optional` **reason?**: `string`

Defined in: [mcp/kb-gate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L56)

**`Experimental`**

***

### CreateKbGateOptions

Defined in: [mcp/kb-gate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L60)

**`Experimental`**

#### Properties

##### judges?

> `optional` **judges?**: [`FactJudge`](#factjudge)[]

Defined in: [mcp/kb-gate.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L62)

**`Experimental`**

Extra judges appended after the built-in floor (e.g. an LLM judge).

##### minPassageChars?

> `optional` **minPassageChars?**: `number`

Defined in: [mcp/kb-gate.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L64)

**`Experimental`**

Minimum verbatim-passage length. Default 12 — kills empty/stub passages.

##### selfArtifactKinds?

> `optional` **selfArtifactKinds?**: `string`[]

Defined in: [mcp/kb-gate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L71)

**`Experimental`**

Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
`'cad_params'`, `'requirements'`). A citation naming one is circular
(laundering) — the fact cites a derived artifact, not a real source.
Default `[]` (no circular check unless the consumer declares its kinds).

***

### RunLocalHarnessOptions

Defined in: [mcp/local-harness.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L243)

**`Experimental`**

#### Properties

##### harness

> **harness**: [`LocalHarness`](#localharness)

Defined in: [mcp/local-harness.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L244)

**`Experimental`**

##### cwd

> **cwd**: `string`

Defined in: [mcp/local-harness.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L246)

**`Experimental`**

Working directory for the subprocess (typically a worktree path).

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [mcp/local-harness.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L248)

**`Experimental`**

Prompt forwarded as the harness CLI's task argument.

##### invocation?

> `optional` **invocation?**: `object`

Defined in: [mcp/local-harness.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L256)

**`Experimental`**

Pre-built command + args (e.g. from `harnessInvocation` so the full authored
`AgentProfile` — systemPrompt + model — reaches the harness). When set it OVERRIDES the
default prompt-only `buildArgs(taskPrompt)` path; `command` defaults to the harness's
default binary when only `args` is supplied. When absent the legacy prompt-only shape
is used unchanged.

###### command?

> `optional` **command?**: `string`

###### args

> **args**: readonly `string`[]

##### dangerouslySkipPermissions?

> `optional` **dangerouslySkipPermissions?**: `boolean`

Defined in: [mcp/local-harness.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L259)

**`Experimental`**

Allow autonomous Claude edits without an interactive permission prompt.
 Use only when `cwd` is an isolated candidate worktree.

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

Defined in: [mcp/local-harness.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L262)

**`Experimental`**

Isolate Codex from ambient configuration/instructions and require JSONL token usage.
 The invocation should come from `harnessInvocation(..., { codexReproducible: true })`.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

Defined in: [mcp/local-harness.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L265)

**`Experimental`**

Absolute host paths that reproducible Codex must not read. The normalized set is compiled
 into the controlled permission profile and its digest is returned in execution evidence.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [mcp/local-harness.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L267)

**`Experimental`**

Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [mcp/local-harness.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L269)

**`Experimental`**

Caller cancellation. SIGTERM is sent on abort.

##### env?

> `optional` **env?**: `ProcessEnv`

Defined in: [mcp/local-harness.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L271)

**`Experimental`**

Override env (defaults to inheriting from the parent).

##### spawn?

> `optional` **spawn?**: (`command`, `args`, `opts`) => `ChildProcess`

Defined in: [mcp/local-harness.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L276)

**`Experimental`**

Test seam — inject a custom spawner so unit tests can mock the
subprocess without touching the OS. Defaults to node's `child_process.spawn`.

###### Parameters

###### command

`string`

###### args

readonly `string`[]

###### opts

###### cwd

`string`

###### env

`ProcessEnv`

###### stdio

`"pipe"`

###### detached

`boolean`

###### Returns

`ChildProcess`

##### resolveCodexExecutable?

> `optional` **resolveCodexExecutable?**: (`command`, `env`) => `Promise`\<`string`\>

Defined in: [mcp/local-harness.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L287)

**`Experimental`**

Test seam for locating the native Codex executable before it is staged in the worktree.

###### Parameters

###### command

`string`

###### env

`ProcessEnv`

###### Returns

`Promise`\<`string`\>

***

### CodexTokenUsage

Defined in: [mcp/local-harness.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L291)

Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event.

#### Properties

##### inputTokens

> **inputTokens**: `number`

Defined in: [mcp/local-harness.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L292)

##### cachedInputTokens

> **cachedInputTokens**: `number`

Defined in: [mcp/local-harness.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L293)

##### outputTokens

> **outputTokens**: `number`

Defined in: [mcp/local-harness.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L294)

##### reasoningOutputTokens

> **reasoningOutputTokens**: `number`

Defined in: [mcp/local-harness.ts:295](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L295)

***

### CodexExecutionPolicy

Defined in: [mcp/local-harness.ts:299](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L299)

Isolation settings asserted before a reproducible Codex run is allowed to start.

#### Properties

##### sessionPersistence

> **sessionPersistence**: `"ephemeral"`

Defined in: [mcp/local-harness.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L300)

##### userConfig

> **userConfig**: `false`

Defined in: [mcp/local-harness.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L301)

##### rules

> **rules**: `false`

Defined in: [mcp/local-harness.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L302)

##### projectInstructions

> **projectInstructions**: `false`

Defined in: [mcp/local-harness.ts:303](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L303)

##### skillInstructions

> **skillInstructions**: `false`

Defined in: [mcp/local-harness.ts:304](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L304)

##### appInstructions

> **appInstructions**: `false`

Defined in: [mcp/local-harness.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L305)

##### toolSuggestions

> **toolSuggestions**: `false`

Defined in: [mcp/local-harness.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L306)

##### multiAgentInstructions

> **multiAgentInstructions**: `false`

Defined in: [mcp/local-harness.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L307)

##### sandbox

> **sandbox**: `"workspace-write"`

Defined in: [mcp/local-harness.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L308)

##### permissionProfile

> **permissionProfile**: `"agent_runtime_reproducible"`

Defined in: [mcp/local-harness.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L309)

##### approvalPolicy

> **approvalPolicy**: `"never"`

Defined in: [mcp/local-harness.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L310)

##### shellNetwork

> **shellNetwork**: `false`

Defined in: [mcp/local-harness.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L311)

##### webSearch

> **webSearch**: `false`

Defined in: [mcp/local-harness.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L312)

##### serviceTier

> **serviceTier**: `"default"`

Defined in: [mcp/local-harness.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L313)

##### shellEnvironment

> **shellEnvironment**: `"core-filtered"`

Defined in: [mcp/local-harness.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L314)

##### loginShell

> **loginShell**: `false`

Defined in: [mcp/local-harness.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L315)

##### credentialsReadable

> **credentialsReadable**: `false`

Defined in: [mcp/local-harness.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L316)

##### hostHomeReadable

> **hostHomeReadable**: `false`

Defined in: [mcp/local-harness.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L317)

##### procEnvironment

> **procEnvironment**: `"private-sanitized"`

Defined in: [mcp/local-harness.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L318)

##### sensitiveEnvironmentNamesVisible

> **sensitiveEnvironmentNamesVisible**: `false`

Defined in: [mcp/local-harness.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L319)

##### parentRepoRead

> **parentRepoRead**: `false`

Defined in: [mcp/local-harness.ts:320](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L320)

##### gitMetadata

> **gitMetadata**: `false`

Defined in: [mcp/local-harness.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L321)

##### temporaryDirectory

> **temporaryDirectory**: `"workspace-private"`

Defined in: [mcp/local-harness.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L322)

##### stagedExecutable

> **stagedExecutable**: `"static-elf-read-only"`

Defined in: [mcp/local-harness.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L323)

##### callerReadDeniedPaths

> **callerReadDeniedPaths**: `"enforced"`

Defined in: [mcp/local-harness.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L324)

##### containerSockets

> **containerSockets**: `false`

Defined in: [mcp/local-harness.ts:325](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L325)

***

### CodexExecutionEvidence

Defined in: [mcp/local-harness.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L329)

Zero-model-call evidence for the exact Codex process about to run.

#### Properties

##### cliVersion

> **cliVersion**: `string`

Defined in: [mcp/local-harness.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L330)

##### executableSha256

> **executableSha256**: `string`

Defined in: [mcp/local-harness.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L331)

##### requestedPromptSha256

> **requestedPromptSha256**: `string`

Defined in: [mcp/local-harness.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L333)

SHA-256 of the exact composed prompt argument proved present in the rendered prompt.

##### effectivePromptSha256

> **effectivePromptSha256**: `string`

Defined in: [mcp/local-harness.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L334)

##### nonPromptArgsSha256

> **nonPromptArgsSha256**: `string`

Defined in: [mcp/local-harness.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L335)

##### controlledConfigSha256

> **controlledConfigSha256**: `string`

Defined in: [mcp/local-harness.ts:336](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L336)

##### readDeniedPaths

> **readDeniedPaths**: `string`[]

Defined in: [mcp/local-harness.ts:338](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L338)

Sorted normalized paths compiled into the permission profile.

##### readDeniedPathsSha256

> **readDeniedPathsSha256**: `string`

Defined in: [mcp/local-harness.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L339)

##### readDeniedPathCount

> **readDeniedPathCount**: `number`

Defined in: [mcp/local-harness.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L340)

##### policy

> **policy**: [`CodexExecutionPolicy`](#codexexecutionpolicy)

Defined in: [mcp/local-harness.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L341)

***

### LocalHarnessResult

Defined in: [mcp/local-harness.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L345)

**`Experimental`**

#### Properties

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/local-harness.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L347)

**`Experimental`**

OS exit code. `null` when killed before exit.

##### stdout

> **stdout**: `string`

Defined in: [mcp/local-harness.ts:349](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L349)

**`Experimental`**

Concatenated stdout.

##### stderr

> **stderr**: `string`

Defined in: [mcp/local-harness.ts:351](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L351)

**`Experimental`**

Concatenated stderr.

##### killedBySignal

> **killedBySignal**: `Signals` \| `null`

Defined in: [mcp/local-harness.ts:353](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L353)

**`Experimental`**

Set when the process exited via signal (timeout / abort).

##### durationMs

> **durationMs**: `number`

Defined in: [mcp/local-harness.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L355)

**`Experimental`**

Wall-clock duration ms (spawn → exit).

##### timedOut

> **timedOut**: `boolean`

Defined in: [mcp/local-harness.ts:357](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L357)

**`Experimental`**

Set when timeoutMs elapsed before exit.

##### usage?

> `optional` **usage?**: [`CodexTokenUsage`](#codextokenusage)

Defined in: [mcp/local-harness.ts:359](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L359)

**`Experimental`**

Present for a reproducible Codex run; parsed from the real terminal JSONL event.

##### evidence?

> `optional` **evidence?**: [`CodexExecutionEvidence`](#codexexecutionevidence)

Defined in: [mcp/local-harness.ts:361](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L361)

**`Experimental`**

Present for reproducible Codex runs; generated and checked before model execution.

***

### McpServerOptions

Defined in: [mcp/server.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L63)

**`Experimental`**

#### Properties

##### delegateSupervisor?

> `optional` **delegateSupervisor?**: [`DelegateHandlerOptions`](#delegatehandleroptions)

Defined in: [mcp/server.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L70)

**`Experimental`**

Required to enable `delegate` — the ONE generic delegation verb. Inject the supervisor
substrate: its brain `router`, the worker `backend`, and the completion `deliverable`. The
supervisor AUTHORS its own worker from the agent's intent, so there is no worker profile to
wire here.

##### uiAuditorDelegate?

> `optional` **uiAuditorDelegate?**: [`UiAuditorDelegate`](#uiauditordelegate)

Defined in: [mcp/server.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L77)

**`Experimental`**

Required to enable delegate_ui_audit. Wire one that closes over your
`runLoop` + `uiAuditorProfile` + a `SandboxClient` (the
canonical in-process choice is `createInProcessUiAuditClient` from
`@tangle-network/agent-runtime/profiles`) + your vision judge.

##### feedbackStore?

> `optional` **feedbackStore?**: [`FeedbackStore`](#feedbackstore)

Defined in: [mcp/server.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L79)

**`Experimental`**

Override the default in-memory feedback store.

##### queue?

> `optional` **queue?**: [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/server.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L81)

**`Experimental`**

Override the default in-memory task queue.

##### extraTools?

> `optional` **extraTools?**: [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: [mcp/server.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L87)

**`Experimental`**

Extra tools to serve alongside the delegation tools, for example
`createCoordinationTools(...).tools`. Registered after the built-ins; a
duplicate name throws so delegation tools cannot be shadowed silently.

##### traceContext?

> `optional` **traceContext?**: [`TraceContext`](#tracecontext-2)

Defined in: [mcp/server.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L93)

**`Experimental`**

Inherited trace identity (`readTraceContextFromEnv()`) stamped on every
record the DEFAULT queue creates. Ignored when `queue` is supplied —
pass `traceContext` to that queue's constructor instead.

##### serverName?

> `optional` **serverName?**: `string`

Defined in: [mcp/server.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L95)

**`Experimental`**

Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`.

##### serverVersion?

> `optional` **serverVersion?**: `string`

Defined in: [mcp/server.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L97)

**`Experimental`**

Server version surfaced via `initialize`. Default = the package version baked at build time.

***

### McpToolDescriptor

Defined in: [mcp/server.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L101)

**`Experimental`**

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/server.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L102)

**`Experimental`**

##### description

> **description**: `string`

Defined in: [mcp/server.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L103)

**`Experimental`**

##### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\>

Defined in: [mcp/server.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L104)

**`Experimental`**

##### handler

> **handler**: (`raw`) => `Promise`\<`unknown`\>

Defined in: [mcp/server.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L105)

**`Experimental`**

###### Parameters

###### raw

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### McpServer

Defined in: [mcp/server.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L109)

**`Experimental`**

#### Properties

##### tools

> `readonly` **tools**: `ReadonlyMap`\<`string`, [`McpToolDescriptor`](#mcptooldescriptor)\>

Defined in: [mcp/server.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L111)

**`Experimental`**

Tools currently registered (depend on which delegates were wired).

##### queue

> `readonly` **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/server.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L113)

**`Experimental`**

The underlying queue — exposed so tests can introspect it.

##### feedbackStore

> `readonly` **feedbackStore**: [`FeedbackStore`](#feedbackstore)

Defined in: [mcp/server.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L115)

**`Experimental`**

The feedback store — exposed for the same reason.

#### Methods

##### handle()

> **handle**(`message`): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

Defined in: [mcp/server.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L117)

**`Experimental`**

Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications).

###### Parameters

###### message

[`JsonRpcMessage`](#jsonrpcmessage)

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

##### serve()

> **serve**(`transport?`): `Promise`\<`void`\>

Defined in: [mcp/server.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L119)

**`Experimental`**

Drive the server on a stdio-shaped transport until `stop()` is called.

###### Parameters

###### transport?

[`McpTransport`](#mcptransport)

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

Defined in: [mcp/server.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L121)

**`Experimental`**

Stop a `serve` call. Subsequent requests are rejected.

###### Returns

`void`

***

### McpTransport

Defined in: [mcp/server.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L125)

**`Experimental`**

#### Properties

##### input

> **input**: `ReadableStream`

Defined in: [mcp/server.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L126)

**`Experimental`**

##### output

> **output**: `WritableStream`

Defined in: [mcp/server.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L127)

**`Experimental`**

***

### JsonRpcMessage

Defined in: [mcp/server.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L131)

**`Experimental`**

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [mcp/server.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L132)

**`Experimental`**

##### id?

> `optional` **id?**: `string` \| `number` \| `null`

Defined in: [mcp/server.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L133)

**`Experimental`**

##### method

> **method**: `string`

Defined in: [mcp/server.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L134)

**`Experimental`**

##### params?

> `optional` **params?**: `unknown`

Defined in: [mcp/server.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L135)

**`Experimental`**

***

### JsonRpcResponse

Defined in: [mcp/server.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L139)

**`Experimental`**

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [mcp/server.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L140)

**`Experimental`**

##### id

> **id**: `string` \| `number` \| `null`

Defined in: [mcp/server.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L141)

**`Experimental`**

##### result?

> `optional` **result?**: `unknown`

Defined in: [mcp/server.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L142)

**`Experimental`**

##### error?

> `optional` **error?**: `object`

Defined in: [mcp/server.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L143)

**`Experimental`**

###### code

> **code**: `number`

###### message

> **message**: `string`

###### data?

> `optional` **data?**: `unknown`

***

### DelegationRecord

Defined in: [mcp/task-queue.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L66)

**`Experimental`**

Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
persistent stores round-trip records through `JSON.stringify`.

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/task-queue.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L67)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/task-queue.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L68)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L69)

**`Experimental`**

##### args

> **args**: `AnyDelegateArgs`

Defined in: [mcp/task-queue.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L70)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/task-queue.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L71)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

Defined in: [mcp/task-queue.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L72)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

Defined in: [mcp/task-queue.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L73)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

Defined in: [mcp/task-queue.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L74)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/task-queue.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L75)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/task-queue.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L76)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/task-queue.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L77)

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L79)

**`Experimental`**

Sha-prefix hash of the canonical input — used for idempotency lookup.

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L86)

**`Experimental`**

Caller-generated deterministic id of a detached run (e.g. the sandbox
session id a single-tick driver resumes by). Presence is what makes a
restored in-flight record resumable via `resumeDelegate`; without it a
restart settles the record as failed.

##### feedback

> **feedback**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

Defined in: [mcp/task-queue.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L88)

**`Experimental`**

Feedback events keyed by this delegation's taskId.

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/task-queue.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L95)

**`Experimental`**

Compact loop-trace span tree teed from the delegation's run, oldest
spans first. Appended when a delegated loop reaches `loop.ended` and
settled (partial buffers included) at the terminal transition. Capped
via `capDelegationTrace` — see `traceTruncated`.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/task-queue.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L97)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/task-queue.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L104)

**`Experimental`**

Inherited trace identity (the queue's `traceContext` at submit time —
typically `readTraceContextFromEnv()`), distinct from the span payload:
a journal consumer joins records into the parent trace by these ids
without parsing spans. Restored records keep their persisted identity.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/task-queue.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L106)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### SubmitInput

Defined in: [mcp/task-queue.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L110)

**`Experimental`**

#### Type Parameters

##### Args

`Args` *extends* `AnyDelegateArgs`

#### Properties

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/task-queue.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L111)

**`Experimental`**

##### args

> **args**: `Args`

Defined in: [mcp/task-queue.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L112)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L113)

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L114)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L121)

**`Experimental`**

Records the detached-run resume key on the new record. The submitted
`run` function still executes in-process exactly as without it — the
ref only matters after a restart, when `DelegationTaskQueue.restore`
hands it to the `resumeDelegate` seam instead of failing the record.

##### run

> **run**: (`ctx`) => `Promise`\<`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

Defined in: [mcp/task-queue.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L128)

**`Experimental`**

Runs the underlying delegation. The queue passes a fresh `AbortSignal`
and a `report` channel for incremental progress updates. The function
MUST resolve with the typed `DelegationResultPayload['output']`; the
queue wraps it with the profile tag.

###### Parameters

###### ctx

[`DelegationRunContext`](#delegationruncontext)

###### Returns

`Promise`\<`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

***

### DelegationRunContext

Defined in: [mcp/task-queue.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L132)

**`Experimental`**

Context handed to a `SubmitInput.run` function.

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L133)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L136)

**`Experimental`**

The `detachedSessionRef` recorded at submit, when one was supplied.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/task-queue.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L154)

**`Experimental`**

Per-delegation loop-trace sink, always provided by the queue. Events
emitted here are journaled onto the record as a compact span tree
(`record.trace`) when each loop run ends and at the delegation's
terminal transition. Delegates forward it into their `runLoop` ctx,
composed with any process-wide OTEL emitter
(`composeLoopTraceEmitters`). Optional in the type so consumer-built
contexts stay source-compatible.

#### Methods

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/task-queue.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L134)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()

> **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/task-queue.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L144)

**`Experimental`**

Replace the record's detached-run resume key — the detached dispatch path
calls this once the sandbox id is known so the persisted ref names a
resolvable box. Ignored after the record settles (a cancel racing the
rebind is legitimate; the ref no longer matters then). Throws on an empty
ref — erasing the resume key would silently make the record unresumable.

###### Parameters

###### ref

`string`

###### Returns

`void`

***

### SubmitOutput

Defined in: [mcp/task-queue.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L158)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/task-queue.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L159)

**`Experimental`**

##### reused

> **reused**: `boolean`

Defined in: [mcp/task-queue.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L161)

**`Experimental`**

True when a prior matching `idempotencyKey` returned an existing record.

***

### DelegationResumeContext

Defined in: [mcp/task-queue.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L178)

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L180)

**`Experimental`**

Fired by `cancel(taskId)`; the driver should stop the remote run when it can.

#### Methods

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/task-queue.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L181)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DelegationResumeDriver

Defined in: [mcp/task-queue.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L194)

**`Experimental`**

Re-attaches restored in-flight records to their detached runs. The queue
calls `tick` repeatedly — it never awaits a whole run — so the driver can
be a thin wrapper over a one-pass primitive: resolve the run named by
`detachedSessionRef`, advance/poll it once, report where it stands. A
thrown error settles the record as failed; `failed` ticks are treated as
terminal and are not retried.

#### Properties

##### intervalMs?

> `optional` **intervalMs?**: `number`

Defined in: [mcp/task-queue.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L200)

**`Experimental`**

Delay between `running` ticks, in milliseconds. Default 5000.

#### Methods

##### tick()

> **tick**(`task`, `ctx`): `Promise`\<[`DelegationResumeTick`](#delegationresumetick)\>

Defined in: [mcp/task-queue.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L195)

**`Experimental`**

###### Parameters

###### task

###### record

[`DelegationRecord`](#delegationrecord)

###### detachedSessionRef

`string`

###### ctx

[`DelegationResumeContext`](#delegationresumecontext)

###### Returns

`Promise`\<[`DelegationResumeTick`](#delegationresumetick)\>

***

### DelegationTaskQueueOptions

Defined in: [mcp/task-queue.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L204)

**`Experimental`**

#### Properties

##### generateId?

> `optional` **generateId?**: () => `string`

Defined in: [mcp/task-queue.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L206)

**`Experimental`**

ID generator override; default `randomTaskId`.

###### Returns

`string`

##### now?

> `optional` **now?**: () => `string`

Defined in: [mcp/task-queue.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L208)

**`Experimental`**

Clock override; default `() => new Date().toISOString()`.

###### Returns

`string`

##### store?

> `optional` **store?**: [`DelegationStore`](#delegationstore)

Defined in: [mcp/task-queue.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L216)

**`Experimental`**

Journal for record mutations and the `restore()` load source. Default
`InMemoryDelegationStore` — observably identical to an unjournaled
queue. Pass a `FileDelegationStore` through
`DelegationTaskQueue.restore` for state that survives a restart;
constructing with `new` never loads prior state.

##### resumeDelegate?

> `optional` **resumeDelegate?**: [`DelegationResumeDriver`](#delegationresumedriver)

Defined in: [mcp/task-queue.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L218)

**`Experimental`**

Resume seam for restored in-flight records that carry a `detachedSessionRef`.

##### maxTerminalRecords?

> `optional` **maxTerminalRecords?**: `number`

Defined in: [mcp/task-queue.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L224)

**`Experimental`**

Maximum number of terminal (completed | failed | cancelled) records
retained; the oldest (by `completedAt`) are evicted from memory and
store once the cap is exceeded. Default unbounded.

##### onPersistError?

> `optional` **onPersistError?**: (`error`) => `void`

Defined in: [mcp/task-queue.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L231)

**`Experimental`**

Observes the first store failure. After it fires, the queue refuses
new submissions and `flush()` rejects with the same error. Default:
rethrow on a microtask — an unhandled crash — because silently
degrading durable mode to memory-only would lie to the caller.

###### Parameters

###### error

[`DelegationPersistenceError`](#delegationpersistenceerror)

###### Returns

`void`

##### traceContext?

> `optional` **traceContext?**: [`TraceContext`](#tracecontext-2)

Defined in: [mcp/task-queue.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L239)

**`Experimental`**

Inherited trace identity stamped on every submitted record
(`traceId` / `parentSpanId`). The bin passes
`readTraceContextFromEnv()` so journal consumers can join delegation
records into the caller's trace. Restored records keep the identity
they were persisted with.

***

### Check

Defined in: [mcp/tools/checks.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L83)

One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is
 upgradeable to the full agentic factory; `lookFor` is the lens question the actor applies.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/checks.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L84)

##### description

> `readonly` **description**: `string`

Defined in: [mcp/tools/checks.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L85)

##### area

> `readonly` **area**: `string`

Defined in: [mcp/tools/checks.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L87)

Coarse classification stamped on every finding this kind emits (the renderer groups by it).

##### version

> `readonly` **version**: `string`

Defined in: [mcp/tools/checks.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L88)

##### lookFor

> `readonly` **lookFor**: `string`

Defined in: [mcp/tools/checks.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L90)

The lens — what this analyst looks for in the trace.

***

### CheckRunnerOptions

Defined in: [mcp/tools/checks.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L210)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [mcp/tools/checks.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L211)

##### routerKey

> **routerKey**: `string`

Defined in: [mcp/tools/checks.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L212)

##### model

> **model**: `string`

Defined in: [mcp/tools/checks.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L213)

##### chat?

> `optional` **chat?**: (`system`, `user`) => `Promise`\<`string`\>

Defined in: [mcp/tools/checks.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L215)

Test/override seam — replace the LLM call. Default: a router chat completion.

###### Parameters

###### system

`string`

###### user

`string`

###### Returns

`Promise`\<`string`\>

***

### SettledWorker

Defined in: [mcp/tools/coordination.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L22)

A worker the driver has drained via `await_event`.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L23)

##### status

> `readonly` **status**: `"done"` \| `"down"`

Defined in: [mcp/tools/coordination.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L24)

##### score?

> `readonly` `optional` **score?**: `number`

Defined in: [mcp/tools/coordination.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L25)

##### valid?

> `readonly` `optional` **valid?**: `boolean`

Defined in: [mcp/tools/coordination.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L26)

##### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [mcp/tools/coordination.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L27)

##### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [mcp/tools/coordination.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L28)

***

### Question

Defined in: [mcp/tools/coordination.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L39)

#### Extended by

- [`QuestionRecord`](#questionrecord)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L40)

##### from

> `readonly` **from**: `string`

Defined in: [mcp/tools/coordination.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L41)

##### level

> `readonly` **level**: `QuestionLevel`

Defined in: [mcp/tools/coordination.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L42)

##### question

> `readonly` **question**: `string`

Defined in: [mcp/tools/coordination.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L43)

##### reason

> `readonly` **reason**: `string`

Defined in: [mcp/tools/coordination.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L44)

##### urgency

> `readonly` **urgency**: `QuestionUrgency`

Defined in: [mcp/tools/coordination.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L45)

##### options?

> `readonly` `optional` **options?**: readonly `QuestionOption`[]

Defined in: [mcp/tools/coordination.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L46)

***

### QuestionRecord

Defined in: [mcp/tools/coordination.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L54)

#### Extends

- [`Question`](#question)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L40)

###### Inherited from

[`Question`](#question).[`id`](#id-5)

##### from

> `readonly` **from**: `string`

Defined in: [mcp/tools/coordination.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L41)

###### Inherited from

[`Question`](#question).[`from`](#from)

##### level

> `readonly` **level**: `QuestionLevel`

Defined in: [mcp/tools/coordination.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L42)

###### Inherited from

[`Question`](#question).[`level`](#level)

##### question

> `readonly` **question**: `string`

Defined in: [mcp/tools/coordination.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L43)

###### Inherited from

[`Question`](#question).[`question`](#question-1)

##### reason

> `readonly` **reason**: `string`

Defined in: [mcp/tools/coordination.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L44)

###### Inherited from

[`Question`](#question).[`reason`](#reason-4)

##### urgency

> `readonly` **urgency**: `QuestionUrgency`

Defined in: [mcp/tools/coordination.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L45)

###### Inherited from

[`Question`](#question).[`urgency`](#urgency)

##### options?

> `readonly` `optional` **options?**: readonly `QuestionOption`[]

Defined in: [mcp/tools/coordination.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L46)

###### Inherited from

[`Question`](#question).[`options`](#options)

##### status

> `readonly` **status**: `"open"` \| `"answered"` \| `"deferred"` \| `"escalated"`

Defined in: [mcp/tools/coordination.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L55)

##### decision?

> `readonly` `optional` **decision?**: [`QuestionDecision`](#questiondecision)

Defined in: [mcp/tools/coordination.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L56)

##### openedAt

> `readonly` **openedAt**: `number`

Defined in: [mcp/tools/coordination.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L57)

***

### CoordinationToolsOptions

Defined in: [mcp/tools/coordination.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L95)

#### Properties

##### scope

> `readonly` **scope**: [`Scope`](runtime.md#scope-1)\<`unknown`\>

Defined in: [mcp/tools/coordination.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L96)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

Defined in: [mcp/tools/coordination.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L97)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Defined in: [mcp/tools/coordination.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L98)

##### perWorker

> `readonly` **perWorker**: [`Budget`](runtime.md#budget-12)

Defined in: [mcp/tools/coordination.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L99)

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](runtime.md#analystregistry)

Defined in: [mcp/tools/coordination.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L100)

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L101)

###### Parameters

###### event

[`CoordinationEvent`](runtime.md#coordinationevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### questionPolicy?

> `readonly` `optional` **questionPolicy?**: [`QuestionPolicy`](#questionpolicy)

Defined in: [mcp/tools/coordination.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L102)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [mcp/tools/coordination.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L107)

Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
 hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
 and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
 the driver can still run lenses on demand via `run_analyst`). Requires `analysts`.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [mcp/tools/coordination.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L113)

Hard cap on how many workers may be LIVE (spawned but not yet settled) at once. `spawn_agent`
 counts the scope's non-terminal nodes and fails closed (`error: 'max-live-workers'`) BEFORE
 reserving from the pool when the cap is already met — a concurrency fence on top of the
 conserved-budget fence (the pool bounds total work; this bounds simultaneous work, e.g. live
 sandboxes/boxes). Omit or `<= 0` = no cap (the prior behavior; the pool stays the only fence).

##### awaitTimeoutMs?

> `readonly` `optional` **awaitTimeoutMs?**: `number`

Defined in: [mcp/tools/coordination.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L123)

Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
 before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
 The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
 transport that block outlives the client's per-request timeout, so an unbounded await surfaces
 to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
 blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
 drain keeps running, so a settlement that lands after the bound is published to the bus and
 pulled by the next call — nothing is lost. Omit = DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS; `<= 0`
 restores the prior UNBOUNDED block (only safe for in-process drivers with no transport timeout).

***

### CoordinationTools

Defined in: [mcp/tools/coordination.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L138)

The supervisor-side toolbox returned by [createCoordinationTools](#createcoordinationtools): the MCP tool
descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
`raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
choice, steerable counterpart to the one-shot own-sandbox delegation MCP.

#### Properties

##### tools

> `readonly` **tools**: [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: [mcp/tools/coordination.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L139)

#### Methods

##### isStopped()

> **isStopped**(): `boolean`

Defined in: [mcp/tools/coordination.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L140)

###### Returns

`boolean`

##### stopReason()

> **stopReason**(): `string` \| `undefined`

Defined in: [mcp/tools/coordination.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L141)

###### Returns

`string` \| `undefined`

##### settled()

> **settled**(): readonly [`SettledWorker`](#settledworker)[]

Defined in: [mcp/tools/coordination.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L142)

###### Returns

readonly [`SettledWorker`](#settledworker)[]

##### questions()

> **questions**(): readonly [`QuestionRecord`](#questionrecord)[]

Defined in: [mcp/tools/coordination.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L143)

###### Returns

readonly [`QuestionRecord`](#questionrecord)[]

##### history()

> **history**(): readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

Defined in: [mcp/tools/coordination.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L147)

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

##### stats()

> **stats**(): [`BusStats`](runtime.md#busstats)

Defined in: [mcp/tools/coordination.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L149)

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](runtime.md#busstats)

##### raiseFinding()

> **raiseFinding**(`finding`): `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L153)

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

###### Parameters

###### finding

`AnalystFindingEvent`

###### Returns

`Promise`\<`void`\>

##### drainResolved()

> **drainResolved**(): `Promise`\<`number`\>

Defined in: [mcp/tools/coordination.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L162)

Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
calls this once its brain loop ends, so a delivered child the brain never awaited still
reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
nobody is left to read a finding, and analysts spend real compute). Returns the count.

###### Returns

`Promise`\<`number`\>

***

### DelegateArgs

Defined in: [mcp/tools/delegate.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L68)

Parsed `delegate` tool arguments.

#### Properties

##### intent

> **intent**: `string`

Defined in: [mcp/tools/delegate.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L69)

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/tools/delegate.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L70)

##### runId?

> `optional` **runId?**: `string`

Defined in: [mcp/tools/delegate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L71)

***

### DelegateHandlerOptions

Defined in: [mcp/tools/delegate.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L103)

**`Experimental`**

#### Properties

##### router

> **router**: [`RouterConfig`](runtime.md#routerconfig)

Defined in: [mcp/tools/delegate.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L105)

**`Experimental`**

The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained).

##### backend

> **backend**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [mcp/tools/delegate.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L107)

**`Experimental`**

WHERE the authored workers run. Required for `supervise()` to spawn anything.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Defined in: [mcp/tools/delegate.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L109)

**`Experimental`**

The completion oracle the authored workers settle against (settled ⟺ delivered).

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/tools/delegate.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L111)

**`Experimental`**

Default supervisor brain model when a call omits `model`.

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [mcp/tools/delegate.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L113)

**`Experimental`**

Restrict the run to this subset of models.

***

### TraceContext

Defined in: [mcp/trace-propagation.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L25)

#### Properties

##### traceId

> **traceId**: `string`

Defined in: [mcp/trace-propagation.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L27)

Trace id inherited from the parent process, or a fresh one.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/trace-propagation.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L29)

Parent span id from the delegation that launched this MCP server.

***

### DelegateCodeConfig

Defined in: [mcp/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L35)

**`Experimental`**

Minimal `CoderTask` overrides exposed over the MCP wire. The full
`CoderTask` carries fields the kernel synthesizes from `goal` +
`repoRoot` — the agent only edits the few that materially gate
validator behavior.

#### Properties

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/types.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L36)

**`Experimental`**

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L37)

**`Experimental`**

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [mcp/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L38)

**`Experimental`**

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [mcp/types.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L39)

**`Experimental`**

***

### DelegateCodeArgs

Defined in: [mcp/types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L43)

**`Experimental`**

#### Properties

##### goal

> **goal**: `string`

Defined in: [mcp/types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L45)

**`Experimental`**

Natural-language description of what the coder must accomplish.

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L47)

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### contextHint?

> `optional` **contextHint?**: `string`

Defined in: [mcp/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L49)

**`Experimental`**

Optional free-form context the agent surfaces in the prompt prelude.

##### variants?

> `optional` **variants?**: `number`

Defined in: [mcp/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L55)

**`Experimental`**

When > 1, dispatches `multiHarnessCoderFanout` across N harnesses
(claude-code, codex, opencode-glm) and picks the highest-scoring
passing patch. Default 1.

##### config?

> `optional` **config?**: [`DelegateCodeConfig`](#delegatecodeconfig)

Defined in: [mcp/types.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L57)

**`Experimental`**

Validator + prompt overrides the agent knows for this repo.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L59)

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id).

***

### DelegateCodeResult

Defined in: [mcp/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L63)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L64)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L66)

**`Experimental`**

Best-effort hint — coder loops can take minutes-to-hours.

***

### DelegateResearchConfig

Defined in: [mcp/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L73)

**`Experimental`**

#### Properties

##### recencyWindow?

> `optional` **recencyWindow?**: `object`

Defined in: [mcp/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L74)

**`Experimental`**

###### since?

> `optional` **since?**: `string`

###### until?

> `optional` **until?**: `string`

##### maxItems?

> `optional` **maxItems?**: `number`

Defined in: [mcp/types.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L75)

**`Experimental`**

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [mcp/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L76)

**`Experimental`**

***

### DelegateResearchArgs

Defined in: [mcp/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L80)

**`Experimental`**

#### Properties

##### question

> **question**: `string`

Defined in: [mcp/types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L81)

**`Experimental`**

##### namespace

> **namespace**: `string`

Defined in: [mcp/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L82)

**`Experimental`**

##### scope?

> `optional` **scope?**: `string`

Defined in: [mcp/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L83)

**`Experimental`**

##### sources?

> `optional` **sources?**: [`ResearchSource`](#researchsource)[]

Defined in: [mcp/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L84)

**`Experimental`**

##### variants?

> `optional` **variants?**: `number`

Defined in: [mcp/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L85)

**`Experimental`**

##### config?

> `optional` **config?**: [`DelegateResearchConfig`](#delegateresearchconfig)

Defined in: [mcp/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L86)

**`Experimental`**

***

### DelegateResearchResult

Defined in: [mcp/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L90)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L91)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L92)

**`Experimental`**

***

### FeedbackRefersTo

Defined in: [mcp/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L96)

**`Experimental`**

#### Properties

##### kind

> **kind**: `"artifact"` \| `"delegation"` \| `"outcome"`

Defined in: [mcp/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L97)

**`Experimental`**

##### ref

> **ref**: `string`

Defined in: [mcp/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L99)

**`Experimental`**

For `'delegation'`, this is the taskId.

***

### FeedbackRating

Defined in: [mcp/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L103)

**`Experimental`**

#### Properties

##### score

> **score**: `number`

Defined in: [mcp/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L105)

**`Experimental`**

[0, 1].

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

Defined in: [mcp/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L106)

**`Experimental`**

##### notes

> **notes**: `string`

Defined in: [mcp/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L107)

**`Experimental`**

***

### DelegateFeedbackArgs

Defined in: [mcp/types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L111)

**`Experimental`**

#### Properties

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

Defined in: [mcp/types.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L112)

**`Experimental`**

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

Defined in: [mcp/types.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L113)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

Defined in: [mcp/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L114)

**`Experimental`**

##### capturedAt?

> `optional` **capturedAt?**: `string`

Defined in: [mcp/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L116)

**`Experimental`**

ISO timestamp; defaults to server clock when omitted.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L117)

**`Experimental`**

***

### DelegateFeedbackResult

Defined in: [mcp/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L121)

**`Experimental`**

#### Properties

##### recorded

> **recorded**: `true`

Defined in: [mcp/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L122)

**`Experimental`**

##### id

> **id**: `string`

Defined in: [mcp/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L123)

**`Experimental`**

***

### DelegationStatusArgs

Defined in: [mcp/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L127)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L128)

**`Experimental`**

##### includeTrace?

> `optional` **includeTrace?**: `boolean`

Defined in: [mcp/types.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L135)

**`Experimental`**

Return the delegation's compact loop-trace span tree alongside the
status. Default false — status polls stay light; opt in when you need
the topology (which iterations ran, where they were placed, what each
cost) rather than just the state machine.

***

### DelegationProgress

Defined in: [mcp/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L139)

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

Defined in: [mcp/types.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L140)

**`Experimental`**

##### phase

> **phase**: `string`

Defined in: [mcp/types.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L141)

**`Experimental`**

***

### DelegationError

Defined in: [mcp/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L145)

**`Experimental`**

#### Properties

##### message

> **message**: `string`

Defined in: [mcp/types.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L146)

**`Experimental`**

##### kind

> **kind**: `string`

Defined in: [mcp/types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L147)

**`Experimental`**

***

### UiAuditorDelegationOutput

Defined in: [mcp/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L171)

**`Experimental`**

Wire-shape of a completed UI-audit delegation. The `findings` array
contains every finding persisted to the workspace during the run,
already enriched with `id` and `createdAt` by the writer. `workspaceDir`
is the absolute path to the workspace; `indexFile` is the workspace-
relative path to the regenerated index.md.

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L172)

**`Experimental`**

##### indexFile

> **indexFile**: `string`

Defined in: [mcp/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L173)

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](profiles.md#uifinding)[]

Defined in: [mcp/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L174)

**`Experimental`**

##### iterations

> **iterations**: `number`

Defined in: [mcp/types.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L176)

**`Experimental`**

Total iterations the loop ran for this delegation.

***

### DelegateUiAuditRoute

Defined in: [mcp/types.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L183)

Optional per-route capture spec the agent surfaces over the wire.

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/types.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L185)

Stable route name (used in screenshot filenames + finding metadata).

##### url

> **url**: `string`

Defined in: [mcp/types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L187)

Fully-qualified URL.

##### viewports?

> `optional` **viewports?**: readonly `object`[]

Defined in: [mcp/types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L189)

Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`.

##### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: [mcp/types.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L191)

Default false. Full-page captures for the broad lenses.

##### waitFor?

> `optional` **waitFor?**: `string`

Defined in: [mcp/types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L193)

Selector to wait for before capture.

***

### DelegateUiAuditConfig

Defined in: [mcp/types.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L197)

**`Experimental`**

#### Properties

##### lenses?

> `optional` **lenses?**: `UiAuditLensFilter`

Defined in: [mcp/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L202)

**`Experimental`**

Lenses to iterate. Default: every lens except `'other'`. Order is
preserved — the driver iterates lens-by-lens.

##### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: [mcp/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L204)

**`Experimental`**

Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes).

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/types.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L206)

**`Experimental`**

Maximum concurrent iterations within a single plan() round. Default 2.

##### productContext?

> `optional` **productContext?**: `string`

Defined in: [mcp/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L208)

**`Experimental`**

Free-form product context surfaced to the judge.

***

### DelegateUiAuditArgs

Defined in: [mcp/types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L212)

**`Experimental`**

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L214)

**`Experimental`**

Workspace root for the audit (absolute path).

##### routes

> **routes**: readonly [`DelegateUiAuditRoute`](#delegateuiauditroute)[]

Defined in: [mcp/types.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L216)

**`Experimental`**

Routes to audit. Must be non-empty.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L218)

**`Experimental`**

Multi-tenant scope.

##### config?

> `optional` **config?**: [`DelegateUiAuditConfig`](#delegateuiauditconfig)

Defined in: [mcp/types.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L219)

**`Experimental`**

***

### DelegateUiAuditResult

Defined in: [mcp/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L223)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L224)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L225)

**`Experimental`**

***

### ResearchOutputShape

Defined in: [mcp/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L235)

**`Experimental`**

Provider-neutral research output carried over the MCP boundary. The MCP
layer accepts this structural shape instead of coupling its wire contract to
one research implementation.

#### Indexable

> \[`key`: `string`\]: `unknown`
**`Experimental`**

#### Properties

##### items

> **items**: `unknown`[]

Defined in: [mcp/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L236)

**`Experimental`**

##### citations

> **citations**: `unknown`[]

Defined in: [mcp/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L237)

**`Experimental`**

##### proposedWrites

> **proposedWrites**: `unknown`[]

Defined in: [mcp/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L238)

**`Experimental`**

##### gaps?

> `optional` **gaps?**: `string`[]

Defined in: [mcp/types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L239)

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L240)

**`Experimental`**

***

### DelegationStatusResult

Defined in: [mcp/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L245)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L246)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L247)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/types.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L248)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

Defined in: [mcp/types.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L249)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

Defined in: [mcp/types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L250)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

Defined in: [mcp/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L251)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L252)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L253)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L254)

**`Experimental`**

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L256)

**`Experimental`**

Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/types.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L258)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L260)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/types.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L262)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### DelegationHistoryArgs

Defined in: [mcp/types.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L266)

**`Experimental`**

#### Properties

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L267)

**`Experimental`**

##### profile?

> `optional` **profile?**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L268)

**`Experimental`**

##### since?

> `optional` **since?**: `string`

Defined in: [mcp/types.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L270)

**`Experimental`**

ISO date — only delegations started at-or-after `since` are returned.

##### limit?

> `optional` **limit?**: `number`

Defined in: [mcp/types.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L272)

**`Experimental`**

Default 50. Hard cap 500.

***

### DelegationFeedbackSnapshot

Defined in: [mcp/types.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L276)

**`Experimental`**

#### Properties

##### id

> **id**: `string`

Defined in: [mcp/types.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L277)

**`Experimental`**

##### score

> **score**: `number`

Defined in: [mcp/types.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L278)

**`Experimental`**

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

Defined in: [mcp/types.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L279)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

Defined in: [mcp/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L280)

**`Experimental`**

##### notes

> **notes**: `string`

Defined in: [mcp/types.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L281)

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: [mcp/types.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L282)

**`Experimental`**

***

### DelegationHistoryEntry

Defined in: [mcp/types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L286)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L287)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L288)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L289)

**`Experimental`**

##### args

> **args**: [`DelegateCodeArgs`](#delegatecodeargs) \| [`DelegateUiAuditArgs`](#delegateuiauditargs) \| [`DelegateResearchArgs`](#delegateresearchargs)

Defined in: [mcp/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L290)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L291)

**`Experimental`**

##### feedback?

> `optional` **feedback?**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

Defined in: [mcp/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L292)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L293)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L294)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:295](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L295)

**`Experimental`**

##### hasTrace

> **hasTrace**: `boolean`

Defined in: [mcp/types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L301)

**`Experimental`**

True when the record carries a journaled loop trace. History stays
light by design — fetch the spans via
`delegation_status { taskId, includeTrace: true }`.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:303](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L303)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

***

### DelegationHistoryResult

Defined in: [mcp/types.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L307)

**`Experimental`**

#### Properties

##### delegations

> **delegations**: [`DelegationHistoryEntry`](#delegationhistoryentry)[]

Defined in: [mcp/types.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L308)

**`Experimental`**

***

### WorktreeHandle

Defined in: [mcp/worktree.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L22)

**`Experimental`**

#### Properties

##### path

> **path**: `string`

Defined in: [mcp/worktree.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L24)

**`Experimental`**

Absolute path to the worktree directory.

##### baseSha

> **baseSha**: `string`

Defined in: [mcp/worktree.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L26)

**`Experimental`**

SHA the worktree was created at.

##### branch

> **branch**: `string`

Defined in: [mcp/worktree.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L28)

**`Experimental`**

Branch name created for this worktree (typically `delegate/<runId>`).

***

### CreateWorktreeOptions

Defined in: [mcp/worktree.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L32)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L34)

**`Experimental`**

Absolute path to the main git checkout.

##### runId

> **runId**: `string`

Defined in: [mcp/worktree.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L36)

**`Experimental`**

Unique id for the worktree path + branch. Use the delegation run id.

##### variantsDir?

> `optional` **variantsDir?**: `string`

Defined in: [mcp/worktree.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L38)

**`Experimental`**

Parent directory the worktree lives under. Defaults to `.agent-worktrees`.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L40)

**`Experimental`**

Override the base ref (default `HEAD`).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L42)

**`Experimental`**

Test seam — inject a custom git runner.

***

### DiffOptions

Defined in: [mcp/worktree.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L46)

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

Defined in: [mcp/worktree.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L48)

**`Experimental`**

Worktree to diff.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L50)

**`Experimental`**

What to compare against. Default `worktree.baseSha`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L52)

**`Experimental`**

Test seam.

***

### DiffResult

Defined in: [mcp/worktree.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L56)

**`Experimental`**

#### Properties

##### patch

> **patch**: `string`

Defined in: [mcp/worktree.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L57)

**`Experimental`**

##### stats

> **stats**: `object`

Defined in: [mcp/worktree.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L58)

**`Experimental`**

###### filesChanged

> **filesChanged**: `number`

###### insertions

> **insertions**: `number`

###### deletions

> **deletions**: `number`

***

### RemoveWorktreeOptions

Defined in: [mcp/worktree.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L66)

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

Defined in: [mcp/worktree.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L67)

**`Experimental`**

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L68)

**`Experimental`**

##### force?

> `optional` **force?**: `boolean`

Defined in: [mcp/worktree.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L70)

**`Experimental`**

Force removal even if dirty (default true; the loser of a fanout has uncommitted changes).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L72)

**`Experimental`**

Test seam.

## Type Aliases

### CoderDelegate

> **CoderDelegate** = (`args`, `ctx`) => `Promise`\<`CoderOutput`\>

Defined in: [mcp/delegates.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L81)

**`Experimental`**

The coder delegate closure — given the coder args + run context, drives the
 sandbox-session coder path to a validated `CoderOutput`. `detachedSessionDelegate` is the
 built-in implementation; the queue invokes one of these per coder delegation.

#### Parameters

##### args

[`DelegateCodeArgs`](#delegatecodeargs)

##### ctx

[`DelegateRunCtx`](#delegaterunctx)

#### Returns

`Promise`\<`CoderOutput`\>

***

### UiAuditorDelegate

> **UiAuditorDelegate** = (`args`, `ctx`) => `Promise`\<[`UiAuditorDelegationOutput`](#uiauditordelegationoutput)\>

Defined in: [mcp/delegates.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L92)

**`Experimental`**

UI-auditor delegate — fully consumer-injected. agent-runtime ships no
default factory because the inputs are workspace path + judge function
+ (optionally) a `SandboxClient`, and the judge is the consumer's
model seam. See `createInProcessUiAuditClient` + `uiAuditorProfile` in
`@tangle-network/agent-runtime/profiles` for the canonical wiring.

#### Parameters

##### args

[`DelegateUiAuditArgs`](#delegateuiauditargs)

##### ctx

[`DelegateRunCtx`](#delegaterunctx)

#### Returns

`Promise`\<[`UiAuditorDelegationOutput`](#uiauditordelegationoutput)\>

***

### CoderReviewer

> **CoderReviewer** = (`output`, `task`, `ctx`) => `Promise`\<[`CoderReview`](#coderreview)\> \| [`CoderReview`](#coderreview)

Defined in: [mcp/delegates.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L118)

**`Experimental`**

Optional adversarial reviewer over a coder candidate that already passed
mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
judge, a `pnpm review` command, anything returning a `CoderReview`.

#### Parameters

##### output

`CoderOutput`

##### task

[`CoderTask`](profiles.md#codertask)

##### ctx

###### signal

`AbortSignal`

#### Returns

`Promise`\<[`CoderReview`](#coderreview)\> \| [`CoderReview`](#coderreview)

***

### DetachedWinnerSelection

> **DetachedWinnerSelection** = `"highest-score"` \| `"smallest-diff"` \| `"highest-readiness"` \| `"first-approved"`

Defined in: [mcp/delegates.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L131)

**`Experimental`**

Winner-selection strategy among validated (+ reviewed) candidates on the
sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
`first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
reviewer-only strategy this path keeps that the generic selector does not express. Default
`highest-score`.

***

### DriveTurnTick

> **DriveTurnTick** = \{ `state`: `"completed"`; `text`: `string`; `result`: `Record`\<`string`, `unknown`\>; \} \| \{ `state`: `"running"`; `startedAt?`: `Date`; `elapsedMs?`: `number`; \} \| \{ `state`: `"failed"`; `error`: `string`; \}

Defined in: [mcp/detached-turn.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L54)

**`Experimental`**

Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
Discriminated on `state`; `failed` is terminal and deterministic per the
SDK contract — re-invoking with the same ids returns the same outcome.

***

### LocalHarness

> **LocalHarness** = `"claude"` \| `"codex"` \| `"opencode"`

Defined in: [mcp/local-harness.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L51)

Local coding harness available inside the sandbox.

***

### DelegationResumeTick

> **DelegationResumeTick** = \{ `state`: `"running"`; \} \| \{ `state`: `"completed"`; `output`: [`DelegationResultPayload`](#delegationresultpayload)\[`"output"`\]; `costUsd?`: `number`; \} \| \{ `state`: `"failed"`; `error`: [`DelegationError`](#delegationerror); \}

Defined in: [mcp/task-queue.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L172)

**`Experimental`**

One observation of a detached run, mapped 1:1 from a single-tick driver
(e.g. the sandbox SDK's `driveTurn`, which reports
completed | running | failed per pass). `running` schedules another tick
after `intervalMs`; `completed` / `failed` settle the record.

***

### QuestionDecision

> **QuestionDecision** = \{ `kind`: `"answer"`; `answer`: `string`; `by`: `string`; \} \| \{ `kind`: `"defer"`; `reason`: `string`; \} \| \{ `kind`: `"escalate"`; `to`: `"parent"` \| `"user"` \| `string`; `reason`: `string`; \}

Defined in: [mcp/tools/coordination.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L49)

***

### QuestionPolicy

> **QuestionPolicy** = `"auto"` \| `"mustDecide"` \| `"bubble"` \| `"failClosed"`

Defined in: [mcp/tools/coordination.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L61)

***

### DelegateResult

> **DelegateResult** = \{ `status`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \} \| \{ `status`: `"no-winner"`; `reason`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \}

Defined in: [mcp/tools/delegate.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L98)

The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 the no-winner reason) PLUS the conserved spend of the whole delegation.

***

### DelegationProfile

> **DelegationProfile** = `"coder"` \| `"researcher"` \| `"ui-auditor"`

Defined in: [mcp/types.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L22)

**`Experimental`**

***

### DelegationStatus

> **DelegationStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

Defined in: [mcp/types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L25)

**`Experimental`**

***

### ResearchSource

> **ResearchSource** = `"web"` \| `"corpus"` \| `"twitter"` \| `"github"` \| `"docs"`

Defined in: [mcp/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L70)

**`Experimental`**

***

### DelegationResultPayload

> **DelegationResultPayload** = \{ `profile`: `"coder"`; `output`: `CoderOutput`; \} \| \{ `profile`: `"researcher"`; `output`: [`ResearchOutputShape`](#researchoutputshape); \} \| \{ `profile`: `"ui-auditor"`; `output`: [`UiAuditorDelegationOutput`](#uiauditordelegationoutput); \}

Defined in: [mcp/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L157)

**`Experimental`**

Polymorphic `result` field: `CoderOutput` when the underlying profile
is `'coder'`, a structurally-typed research output when `'researcher'`.
The MCP wire carries it as JSON either way.

***

### GitRunner

> **GitRunner** = (`args`, `opts`) => `object`

Defined in: [mcp/worktree.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L76)

Pluggable git runner (sync) — replaceable in tests.

#### Parameters

##### args

`ReadonlyArray`\<`string`\>

##### opts

###### cwd

`string`

#### Returns

`object`

##### stdout

> **stdout**: `string`

##### stderr

> **stderr**: `string`

##### exitCode

> **exitCode**: `number`

## Variables

### DELEGATION\_TRACE\_MAX\_SPANS

> `const` **DELEGATION\_TRACE\_MAX\_SPANS**: `512` = `512`

Defined in: [mcp/delegation-trace.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L46)

**`Experimental`**

Default cap on spans retained per delegation record.

***

### DELEGATION\_TRACE\_MAX\_BYTES

> `const` **DELEGATION\_TRACE\_MAX\_BYTES**: `number`

Defined in: [mcp/delegation-trace.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L49)

**`Experimental`**

Default cap on the serialized trace payload per record, in bytes.

***

### defaultChecks

> `const` **defaultChecks**: `Record`\<`string`, [`Check`](#check)\>

Defined in: [mcp/tools/checks.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L94)

The built-in lens directory. Domain-blind (about any agent trace); compose at test time.

***

### DELEGATE\_FEEDBACK\_TOOL\_NAME

> `const` **DELEGATE\_FEEDBACK\_TOOL\_NAME**: `"delegate_feedback"` = `'delegate_feedback'`

Defined in: [mcp/tools/delegate-feedback.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L25)

**`Experimental`**

MCP tool name for the `delegate_feedback` feedback-recording tool.

***

### DELEGATE\_FEEDBACK\_DESCRIPTION

> `const` **DELEGATE\_FEEDBACK\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate-feedback.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L28)

**`Experimental`**

Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest.

***

### DELEGATE\_FEEDBACK\_INPUT\_SCHEMA

> `const` **DELEGATE\_FEEDBACK\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-feedback.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L52)

**`Experimental`**

JSON Schema for `delegate_feedback` tool arguments (`refersTo`, `rating`, `by`, optional fields).

#### Type Declaration

##### type

> `readonly` **type**: `"object"` = `'object'`

##### properties

> `readonly` **properties**: `object`

###### properties.refersTo

> `readonly` **refersTo**: `object`

###### properties.refersTo.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.refersTo.properties

> `readonly` **properties**: `object`

###### properties.refersTo.properties.kind

> `readonly` **kind**: `object`

###### properties.refersTo.properties.kind.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.refersTo.properties.kind.enum

> `readonly` **enum**: readonly \[`"delegation"`, `"artifact"`, `"outcome"`\]

###### properties.refersTo.properties.ref

> `readonly` **ref**: `object`

###### properties.refersTo.properties.ref.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.refersTo.required

> `readonly` **required**: readonly \[`"kind"`, `"ref"`\]

###### properties.refersTo.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.rating

> `readonly` **rating**: `object`

###### properties.rating.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.rating.properties

> `readonly` **properties**: `object`

###### properties.rating.properties.score

> `readonly` **score**: `object`

###### properties.rating.properties.score.type

> `readonly` **type**: `"number"` = `'number'`

###### properties.rating.properties.score.minimum

> `readonly` **minimum**: `0` = `0`

###### properties.rating.properties.score.maximum

> `readonly` **maximum**: `1` = `1`

###### properties.rating.properties.label

> `readonly` **label**: `object`

###### properties.rating.properties.label.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.rating.properties.label.enum

> `readonly` **enum**: readonly \[`"good"`, `"bad"`, `"neutral"`, `"mixed"`\]

###### properties.rating.properties.notes

> `readonly` **notes**: `object`

###### properties.rating.properties.notes.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.rating.required

> `readonly` **required**: readonly \[`"score"`, `"notes"`\]

###### properties.rating.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.by

> `readonly` **by**: `object`

###### properties.by.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.by.enum

> `readonly` **enum**: readonly \[`"agent"`, `"user"`, `"downstream-judge"`\]

###### properties.capturedAt

> `readonly` **capturedAt**: `object`

###### properties.capturedAt.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.namespace

> `readonly` **namespace**: `object`

###### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

##### required

> `readonly` **required**: readonly \[`"refersTo"`, `"rating"`, `"by"`\]

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

***

### DELEGATE\_UI\_AUDIT\_TOOL\_NAME

> `const` **DELEGATE\_UI\_AUDIT\_TOOL\_NAME**: `"delegate_ui_audit"` = `'delegate_ui_audit'`

Defined in: [mcp/tools/delegate-ui-audit.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L30)

**`Experimental`**

MCP tool name for the `delegate_ui_audit` async kickoff tool.

***

### DELEGATE\_UI\_AUDIT\_DESCRIPTION

> `const` **DELEGATE\_UI\_AUDIT\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate-ui-audit.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L33)

**`Experimental`**

Human-readable description of the `delegate_ui_audit` MCP tool, injected into the tool manifest.

***

### DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA

> `const` **DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-ui-audit.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L86)

**`Experimental`**

JSON Schema for `delegate_ui_audit` tool arguments (`workspaceDir`, `routes`, optional config).

#### Type Declaration

##### type

> `readonly` **type**: `"object"` = `'object'`

##### properties

> `readonly` **properties**: `object`

###### properties.workspaceDir

> `readonly` **workspaceDir**: `object`

###### properties.workspaceDir.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.workspaceDir.description

> `readonly` **description**: `"Absolute path for the audit workspace."` = `'Absolute path for the audit workspace.'`

###### properties.routes

> `readonly` **routes**: `object`

###### properties.routes.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.routes.items

> `readonly` **items**: `object` = `ROUTE_SCHEMA`

###### properties.routes.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.routes.items.properties

> `readonly` **properties**: `object`

###### properties.routes.items.properties.name

> `readonly` **name**: `object`

###### properties.routes.items.properties.name.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.routes.items.properties.name.description

> `readonly` **description**: `"Stable route name (used in screenshot filenames)."` = `'Stable route name (used in screenshot filenames).'`

###### properties.routes.items.properties.url

> `readonly` **url**: `object`

###### properties.routes.items.properties.url.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.routes.items.properties.url.description

> `readonly` **description**: `"Fully-qualified URL."` = `'Fully-qualified URL.'`

###### properties.routes.items.properties.viewports

> `readonly` **viewports**: `object`

###### properties.routes.items.properties.viewports.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.routes.items.properties.viewports.items

> `readonly` **items**: `object` = `VIEWPORT_SCHEMA`

###### properties.routes.items.properties.viewports.items.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.routes.items.properties.viewports.items.properties

> `readonly` **properties**: `object`

###### properties.routes.items.properties.viewports.items.properties.width

> `readonly` **width**: `object`

###### properties.routes.items.properties.viewports.items.properties.width.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.routes.items.properties.viewports.items.properties.width.minimum

> `readonly` **minimum**: `1` = `1`

###### properties.routes.items.properties.viewports.items.properties.height

> `readonly` **height**: `object`

###### properties.routes.items.properties.viewports.items.properties.height.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.routes.items.properties.viewports.items.properties.height.minimum

> `readonly` **minimum**: `1` = `1`

###### properties.routes.items.properties.viewports.items.required

> `readonly` **required**: readonly \[`"width"`, `"height"`\]

###### properties.routes.items.properties.viewports.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.routes.items.properties.viewports.description

> `readonly` **description**: `"Viewports to capture at. Default [{1280, 800}]."` = `'Viewports to capture at. Default [{1280, 800}].'`

###### properties.routes.items.properties.fullPage

> `readonly` **fullPage**: `object`

###### properties.routes.items.properties.fullPage.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.routes.items.properties.waitFor

> `readonly` **waitFor**: `object`

###### properties.routes.items.properties.waitFor.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.routes.items.properties.waitFor.description

> `readonly` **description**: `"CSS selector to wait for before capturing."` = `'CSS selector to wait for before capturing.'`

###### properties.routes.items.required

> `readonly` **required**: readonly \[`"name"`, `"url"`\]

###### properties.routes.items.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

###### properties.routes.minItems

> `readonly` **minItems**: `1` = `1`

###### properties.namespace

> `readonly` **namespace**: `object`

###### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.namespace.description

> `readonly` **description**: `"Multi-tenant scope."` = `'Multi-tenant scope.'`

###### properties.config

> `readonly` **config**: `object`

###### properties.config.type

> `readonly` **type**: `"object"` = `'object'`

###### properties.config.properties

> `readonly` **properties**: `object`

###### properties.config.properties.lenses

> `readonly` **lenses**: `object`

###### properties.config.properties.lenses.type

> `readonly` **type**: `"array"` = `'array'`

###### properties.config.properties.lenses.items

> `readonly` **items**: `object`

###### properties.config.properties.lenses.items.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.config.properties.lenses.items.enum

> `readonly` **enum**: readonly [`UiLens`](profiles.md#uilens)[]

###### properties.config.properties.lenses.description

> `readonly` **description**: "Lenses to iterate. Default: every lens except \"other\"." = `'Lenses to iterate. Default: every lens except "other".'`

###### properties.config.properties.maxIterations

> `readonly` **maxIterations**: `object`

###### properties.config.properties.maxIterations.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.config.properties.maxIterations.minimum

> `readonly` **minimum**: `1` = `1`

###### properties.config.properties.maxConcurrency

> `readonly` **maxConcurrency**: `object`

###### properties.config.properties.maxConcurrency.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.config.properties.maxConcurrency.minimum

> `readonly` **minimum**: `1` = `1`

###### properties.config.properties.productContext

> `readonly` **productContext**: `object`

###### properties.config.properties.productContext.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.config.additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

##### required

> `readonly` **required**: readonly \[`"workspaceDir"`, `"routes"`\]

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

***

### DELEGATE\_TOOL\_NAME

> `const` **DELEGATE\_TOOL\_NAME**: `"delegate"` = `'delegate'`

Defined in: [mcp/tools/delegate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L26)

**`Experimental`**

MCP tool name for the `delegate` generic-delegation tool.

***

### DELEGATE\_DESCRIPTION

> `const` **DELEGATE\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L29)

**`Experimental`**

Human-readable description of the `delegate` MCP tool, injected into the tool manifest.

***

### DELEGATE\_INPUT\_SCHEMA

> `const` **DELEGATE\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L47)

**`Experimental`**

JSON Schema for `delegate` tool arguments (`intent` + optional `model` and `runId`).

#### Type Declaration

##### type

> `readonly` **type**: `"object"` = `'object'`

##### properties

> `readonly` **properties**: `object`

###### properties.intent

> `readonly` **intent**: `object`

###### properties.intent.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.intent.description

> `readonly` **description**: `"What you want accomplished, as an outcome. The supervisor authors the worker."` = `'What you want accomplished, as an outcome. The supervisor authors the worker.'`

###### properties.model

> `readonly` **model**: `object`

###### properties.model.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.model.description

> `readonly` **description**: `"Optional per-call override for the supervisor brain model."` = `'Optional per-call override for the supervisor brain model.'`

###### properties.runId

> `readonly` **runId**: `object`

###### properties.runId.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.runId.description

> `readonly` **description**: `"Optional trace-correlation id for this delegation."` = `'Optional trace-correlation id for this delegation.'`

##### required

> `readonly` **required**: readonly \[`"intent"`\]

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

***

### DELEGATION\_HISTORY\_TOOL\_NAME

> `const` **DELEGATION\_HISTORY\_TOOL\_NAME**: `"delegation_history"` = `'delegation_history'`

Defined in: [mcp/tools/delegation-history.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L18)

**`Experimental`**

MCP tool name for the `delegation_history` read-past-delegations tool.

***

### DELEGATION\_HISTORY\_DESCRIPTION

> `const` **DELEGATION\_HISTORY\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegation-history.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L21)

**`Experimental`**

Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest.

***

### DELEGATION\_HISTORY\_INPUT\_SCHEMA

> `const` **DELEGATION\_HISTORY\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-history.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L42)

**`Experimental`**

JSON Schema for `delegation_history` tool arguments (optional `namespace`, `profile`, `since`, `limit`).

#### Type Declaration

##### type

> `readonly` **type**: `"object"` = `'object'`

##### properties

> `readonly` **properties**: `object`

###### properties.namespace

> `readonly` **namespace**: `object`

###### properties.namespace.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.profile

> `readonly` **profile**: `object`

###### properties.profile.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.profile.enum

> `readonly` **enum**: readonly \[`"coder"`, `"researcher"`\]

###### properties.since

> `readonly` **since**: `object`

###### properties.since.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.since.description

> `readonly` **description**: `"ISO datetime — earliest startedAt to include."` = `'ISO datetime — earliest startedAt to include.'`

###### properties.limit

> `readonly` **limit**: `object`

###### properties.limit.type

> `readonly` **type**: `"integer"` = `'integer'`

###### properties.limit.minimum

> `readonly` **minimum**: `1` = `1`

###### properties.limit.maximum

> `readonly` **maximum**: `500` = `500`

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

***

### DELEGATION\_STATUS\_TOOL\_NAME

> `const` **DELEGATION\_STATUS\_TOOL\_NAME**: `"delegation_status"` = `'delegation_status'`

Defined in: [mcp/tools/delegation-status.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L17)

**`Experimental`**

MCP tool name for the `delegation_status` synchronous-poll tool.

***

### DELEGATION\_STATUS\_DESCRIPTION

> `const` **DELEGATION\_STATUS\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegation-status.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L20)

**`Experimental`**

Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest.

***

### DELEGATION\_STATUS\_INPUT\_SCHEMA

> `const` **DELEGATION\_STATUS\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-status.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L42)

**`Experimental`**

JSON Schema for `delegation_status` tool arguments (`taskId` + optional `includeTrace`).

#### Type Declaration

##### type

> `readonly` **type**: `"object"` = `'object'`

##### properties

> `readonly` **properties**: `object`

###### properties.taskId

> `readonly` **taskId**: `object`

###### properties.taskId.type

> `readonly` **type**: `"string"` = `'string'`

###### properties.taskId.description

> `readonly` **description**: `"Returned by delegate_ui_audit."` = `'Returned by delegate_ui_audit.'`

###### properties.includeTrace

> `readonly` **includeTrace**: `object`

###### properties.includeTrace.type

> `readonly` **type**: `"boolean"` = `'boolean'`

###### properties.includeTrace.description

> `readonly` **description**: `"Also return the journaled loop-trace span tree for this delegation. Default false."` = `'Also return the journaled loop-trace span tree for this delegation. Default false.'`

##### required

> `readonly` **required**: readonly \[`"taskId"`\]

##### additionalProperties

> `readonly` **additionalProperties**: `false` = `false`

## Functions

### detectExecutor()

> **detectExecutor**(`args`): `Promise`\<[`DelegationExecutor`](#delegationexecutor)\>

Defined in: [mcp/bin-helpers.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L47)

**`Experimental`**

Pick the right executor for an MCP server invocation based on env vars.

- `TANGLE_FLEET_ID` set → fleet-workspace placement; resolves the handle
  via `sandboxClient.fleets.get(...)`.
- Otherwise → sibling-sandbox placement; each delegation creates a fresh
  sandbox via `sandboxClient.create(...)`.

Fails loud (throws) when fleet mode is requested but the SDK shape is
incompatible — the operator chose fleet semantics, silently degrading to
sibling mode would lie about workspace topology.

#### Parameters

##### args

[`DetectExecutorArgs`](#detectexecutorargs)

#### Returns

`Promise`\<[`DelegationExecutor`](#delegationexecutor)\>

***

### detachedSessionDelegate()

> **detachedSessionDelegate**(`options`): [`CoderDelegate`](#coderdelegate)

Defined in: [mcp/delegates.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L219)

**`Experimental`**

Build the sandbox-session coder delegate. It drives `runLoop` against the project's
sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
topology.

This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
`SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
(driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.

For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate runs
held-stream by default and only its OPTIONAL cross-restart resume (the `driveTurn` tick) is opt-in
behind `MCP_ENABLE_DETACHED_RESUME`.

#### Parameters

##### options

[`DetachedSessionDelegateOptions`](#detachedsessiondelegateoptions)

#### Returns

[`CoderDelegate`](#coderdelegate)

***

### coderTaskFromArgs()

> **coderTaskFromArgs**(`args`): [`CoderTask`](profiles.md#codertask)

Defined in: [mcp/delegates.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L428)

**`Experimental`**

Canonical `DelegateCodeArgs` → `CoderTask` mapping — the single source for
the delegate's live dispatch AND the resume driver's settle/message
rebuilding, so a resumed record reproduces exactly the task the original
process dispatched.

#### Parameters

##### args

[`DelegateCodeArgs`](#delegatecodeargs)

#### Returns

[`CoderTask`](profiles.md#codertask)

***

### settleDetachedCoderTurn()

> **settleDetachedCoderTurn**(`turn`, `options`): `Promise`\<`CoderOutput`\>

Defined in: [mcp/delegates.ts:466](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L466)

**`Experimental`**

Settle a completed detached coder turn through the same gate the streaming
path applies: parse the terminal payload with the coder output adapter,
run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
then the optional reviewer. Throws when nothing survives — a resumed or
detached run must not return an unvalidated patch.

SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
bound to the `runLoop` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
`createDetachedTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.

#### Parameters

##### turn

[`DetachedTurn`](#detachedturn)

##### options

[`SettleDetachedCoderTurnOptions`](#settledetachedcoderturnoptions)

#### Returns

`Promise`\<`CoderOutput`\>

***

### buildDelegationTraceSpans()

> **buildDelegationTraceSpans**(`events`): [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/delegation-trace.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L74)

**`Experimental`**

Derive the compact span tree for ONE loop run from its buffered
`LoopTraceEvent` stream. Same reconstruction as the OTEL exporter
([buildLoopSpanNodes](index.md#buildloopspannodes)); tolerates partial streams.

#### Parameters

##### events

readonly [`LoopTraceEvent`](runtime.md#looptraceevent)[]

#### Returns

[`DelegationTraceSpan`](#delegationtracespan)[]

***

### capDelegationTrace()

> **capDelegationTrace**(`spans`, `caps?`): [`CappedDelegationTrace`](#cappeddelegationtrace)

Defined in: [mcp/delegation-trace.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L98)

**`Experimental`**

Enforce the trace caps over an ordered (oldest-first) span list. Drops the
OLDEST spans first and reports `truncated: true` when anything was dropped;
the newest span always survives, so a non-empty input never caps to empty.
Dropping a parent may orphan surviving children's `parentSpanId` references
— acceptable for the flat journal shape; consumers treat unresolved parents
as roots.

#### Parameters

##### spans

readonly [`DelegationTraceSpan`](#delegationtracespan)[]

##### caps?

[`DelegationTraceCaps`](#delegationtracecaps)

#### Returns

[`CappedDelegationTrace`](#cappeddelegationtrace)

***

### createDelegationTraceCollector()

> **createDelegationTraceCollector**(`onSpans`): [`DelegationTraceCollector`](#delegationtracecollector)

Defined in: [mcp/delegation-trace.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L131)

**`Experimental`**

Build a `DelegationTraceCollector` that buffers loop-trace events and converts them to spans on settle.

#### Parameters

##### onSpans

(`spans`) => `void`

#### Returns

[`DelegationTraceCollector`](#delegationtracecollector)

***

### composeLoopTraceEmitters()

> **composeLoopTraceEmitters**(...`emitters`): [`LoopTraceEmitter`](runtime.md#looptraceemitter) \| `undefined`

Defined in: [mcp/delegation-trace.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L185)

**`Experimental`**

Fan one `LoopTraceEvent` stream into several emitters — e.g. the
process-wide OTEL exporter AND the per-delegation journal collector.
`undefined` entries are skipped; returns `undefined` when nothing is left
so callers keep the kernel's "no emitter, no events" fast path.

#### Parameters

##### emitters

...readonly ([`LoopTraceEmitter`](runtime.md#looptraceemitter) \| `undefined`)[]

#### Returns

[`LoopTraceEmitter`](runtime.md#looptraceemitter) \| `undefined`

***

### formatDetachedSessionRef()

> **formatDetachedSessionRef**(`parts`): `string`

Defined in: [mcp/detached-turn.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L96)

**`Experimental`**

Encode ref parts into the JSON-safe string stored on the record:
`session=<id>` before the box exists, `sandbox=<id>;session=<id>` once
bound. Ids must not contain the `;`/`=` delimiters.

#### Parameters

##### parts

[`DetachedSessionRefParts`](#detachedsessionrefparts)

#### Returns

`string`

***

### parseDetachedSessionRef()

> **parseDetachedSessionRef**(`raw`): [`DetachedSessionRefParts`](#detachedsessionrefparts)

Defined in: [mcp/detached-turn.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L104)

**`Experimental`**

Parse a `detachedSessionRef` string back to parts; throws `ValidationError` on malformed input.

#### Parameters

##### raw

`string`

#### Returns

[`DetachedSessionRefParts`](#detachedsessionrefparts)

***

### detachedTurnEvents()

> **detachedTurnEvents**(`sessionId`, `turn`): `SandboxEvent`[]

Defined in: [mcp/detached-turn.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L151)

**`Experimental`**

Synthesize the terminal event array a detached turn settles through. Shaped
so the existing event-stream output adapters (coder, researcher) parse it:
`data.result` for adapters that read a structured terminal record, `data.text`
for adapters that scan assistant text for the fenced result block.

#### Parameters

##### sessionId

`string`

##### turn

[`DetachedTurn`](#detachedturn)

#### Returns

`SandboxEvent`[]

***

### runDetachedTurn()

> **runDetachedTurn**(`options`): `Promise`\<[`DetachedTurn`](#detachedturn)\>

Defined in: [mcp/detached-turn.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L212)

**`Experimental`**

Dispatch one detached turn and advance it to a terminal state with
`driveTurn` ticks. The first tick dispatches (idempotent on `sessionId`);
subsequent ticks poll. On abort the remote session is cancelled via
`_sessionCancel` when the box exposes it. The box is torn down on every
in-process exit path (success, failure, abort) — only a process death skips
teardown, which is exactly the case the resume driver re-attaches to.

#### Parameters

##### options

[`RunDetachedTurnOptions`](#rundetachedturnoptions)

#### Returns

`Promise`\<[`DetachedTurn`](#detachedturn)\>

***

### createDetachedTurnResumeDriver()

> **createDetachedTurnResumeDriver**(`options`): [`DelegationResumeDriver`](#delegationresumedriver)

Defined in: [mcp/detached-turn.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L416)

**`Experimental`**

Build the `driveTurn`-backed [DelegationResumeDriver](#delegationresumedriver). Each `tick()`
is one settle/poll/dispatch pass:

  - ref without a sandbox binding → `failed` (`DetachedSessionUnboundError`):
    the previous process died before a box existed; there is nothing to resume.
  - `driveTurn` `completed` → `settleOutput` → `completed` tick.
  - `running` → progress via `ctx.report`, `running` tick (queue re-ticks
    after `intervalMs`).
  - `failed` → `failed` tick (`DetachedTurnFailedError`) — terminal per the
    SDK's deterministic-failure contract.

Abort: the queue stops ticking once `cancel()` flips the record, so remote
cancellation is hooked onto `ctx.signal` (once per task) and fires
`_sessionCancel` when the SDK surface exposes it. The driver never deletes
boxes — it cannot know whether `sandboxId` is a disposable sibling or a
fleet machine, and destroying a fleet machine would be unrecoverable.

#### Parameters

##### options

[`DetachedTurnResumeDriverOptions`](#detachedturnresumedriveroptions)

#### Returns

[`DelegationResumeDriver`](#delegationresumedriver)

***

### createSiblingSandboxExecutor()

> **createSiblingSandboxExecutor**(`options`): [`DelegationExecutor`](#delegationexecutor)

Defined in: [mcp/executor.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L55)

**`Experimental`**

Wrap a raw sandbox SDK client so the kernel emits
`loop.iteration.dispatch` events with `{ placement: 'sibling', sandboxId }`.

The returned client `.create()` delegates to the underlying client; the
only added behavior is a `describePlacement` tag the kernel reads.

#### Parameters

##### options

[`SiblingSandboxExecutorOptions`](#siblingsandboxexecutoroptions)

#### Returns

[`DelegationExecutor`](#delegationexecutor)

***

### createFleetWorkspaceExecutor()

> **createFleetWorkspaceExecutor**(`options`): [`DelegationExecutor`](#delegationexecutor)

Defined in: [mcp/executor.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L117)

**`Experimental`**

Build an executor that resolves each delegated iteration to an existing
machine in `fleet`. The fleet's shared-workspace policy means the worker
machine sees the caller's filesystem — diffs land in-place with no
cross-sandbox copy step.

#### Parameters

##### options

[`FleetWorkspaceExecutorOptions`](#fleetworkspaceexecutoroptions)

#### Returns

[`DelegationExecutor`](#delegationexecutor)

***

### eventToSnapshot()

> **eventToSnapshot**(`event`): [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)

Defined in: [mcp/feedback-store.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/feedback-store.ts#L66)

**`Experimental`**

Project a `FeedbackEvent` down to the snapshot shape carried on
`delegation_history` entries.

#### Parameters

##### event

[`FeedbackEvent`](#feedbackevent)

#### Returns

[`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)

***

### createInProcessExecutor()

> **createInProcessExecutor**(`options`): [`DelegationExecutor`](#delegationexecutor)

Defined in: [mcp/in-process-executor.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L88)

**`Experimental`**

Build an in-process executor. Returns a [DelegationExecutor](#delegationexecutor) whose `client.create()`
returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
(`backend.profile`) threads its systemPrompt + model into the harness via the core.

#### Parameters

##### options

[`InProcessExecutorOptions`](#inprocessexecutoroptions)

#### Returns

[`DelegationExecutor`](#delegationexecutor)

***

### createKbGate()

> **createKbGate**(`options?`): (`candidate`) => `Promise`\<[`KbGateResult`](#kbgateresult)\>

Defined in: [mcp/kb-gate.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L139)

**`Experimental`**

Build a fail-closed KB gate. The returned function runs the built-in floor
(passage-non-empty → passage-present → value-in-passage → no-circular-citation)
then any consumer judges, returning on the first veto.

#### Parameters

##### options?

[`CreateKbGateOptions`](#createkbgateoptions) = `{}`

#### Returns

(`candidate`) => `Promise`\<[`KbGateResult`](#kbgateresult)\>

***

### runLocalHarness()

> **runLocalHarness**(`options`): `Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

Defined in: [mcp/local-harness.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L386)

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

#### Parameters

##### options

[`RunLocalHarnessOptions`](#runlocalharnessoptions)

#### Returns

`Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

***

### parseCodexTokenUsage()

> **parseCodexTokenUsage**(`stdout`): [`CodexTokenUsage`](#codextokenusage)

Defined in: [mcp/local-harness.ts:1350](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L1350)

Parse and validate the one terminal usage event emitted by `codex exec --json`.

#### Parameters

##### stdout

`string`

#### Returns

[`CodexTokenUsage`](#codextokenusage)

***

### createMcpServer()

> **createMcpServer**(`options?`): [`McpServer`](#mcpserver)

Defined in: [mcp/server.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L155)

**`Experimental`**

Stdio JSON-RPC MCP server exposing the delegation tools (`delegate`, `delegate_feedback`, `delegation_status`, `delegation_history`, optional `delegate_ui_audit`) to sandbox coding-harness agents.

#### Parameters

##### options?

[`McpServerOptions`](#mcpserveroptions) = `{}`

#### Returns

[`McpServer`](#mcpserver)

***

### createInProcessTransport()

> **createInProcessTransport**(): `object`

Defined in: [mcp/server.ts:339](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L339)

**`Experimental`**

In-process pair of `Readable` + `Writable` streams suitable for driving
`server.serve(...)` from a test. Returns the agent-side stream (the
client writes to it) and the server-side stream (the test reads from it).

#### Returns

`object`

##### transport

> **transport**: [`McpTransport`](#mcptransport)

##### clientWrite()

> **clientWrite**(`line`): `void`

###### Parameters

###### line

`string`

###### Returns

`void`

##### clientClose()

> **clientClose**(): `void`

###### Returns

`void`

##### readServer()

> **readServer**(): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse)[]\>

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse)[]\>

***

### hashIdempotencyInput()

> **hashIdempotencyInput**(`value`): `string`

Defined in: [mcp/task-queue.ts:806](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L806)

**`Experimental`**

Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
collisions only affect dedupe, never correctness.

#### Parameters

##### value

`unknown`

#### Returns

`string`

***

### liftFindings()

> **liftFindings**(`kind`, `rows`, `producedAt`): `AnalystFinding`[]

Defined in: [mcp/tools/checks.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L144)

Lift validated raw rows into `AnalystFinding`s (agent-eval `makeFinding` stamps `finding_id`/
 `produced_at`), then enforce the trace-derived firewall (selector ≠ judge). Pure — no LLM.

#### Parameters

##### kind

[`Check`](#check)

##### rows

`unknown`[]

##### producedAt

`string`

#### Returns

`AnalystFinding`[]

***

### renderTrace()

> **renderTrace**(`trace`): `string`

Defined in: [mcp/tools/checks.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L184)

Render a worker's trace (tool calls + results) into the text an analyst lens reads. Generic over
 the trace shape: a `{ messages }` conversation, a bare message array, else stringified.

#### Parameters

##### trace

`unknown`

#### Returns

`string`

***

### runCheck()

> **runCheck**(`kind`, `trace`, `opts`, `producedAt`): `Promise`\<`AnalystFinding`[]\>

Defined in: [mcp/tools/checks.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L220)

Run ONE lens over a trace → findings. Generic over any kind: prompt = the lens + the agent-eval
 finding schema; the model's JSON array is parsed (`parseRawFinding`), lifted, and firewalled.

#### Parameters

##### kind

[`Check`](#check)

##### trace

`unknown`

##### opts

[`CheckRunnerOptions`](#checkrunneroptions)

##### producedAt

`string`

#### Returns

`Promise`\<`AnalystFinding`[]\>

***

### makeCheckRunner()

> **makeCheckRunner**(`kinds`, `opts`): (`kindId`, `trace`, `producedAt`) => `Promise`\<`AnalystFinding`[] \| \{ `error`: `string`; \}\>

Defined in: [mcp/tools/checks.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L272)

Build a `run_analyst` runner over a kind directory.
Returns findings, or a typed error for an unknown kind. `producedAt` is
passed in because replay-safe paths must not read `Date.now`.

#### Parameters

##### kinds

`Record`\<`string`, [`Check`](#check)\>

##### opts

[`CheckRunnerOptions`](#checkrunneroptions)

#### Returns

(`kindId`, `trace`, `producedAt`) => `Promise`\<`AnalystFinding`[] \| \{ `error`: `string`; \}\>

***

### createCoordinationTools()

> **createCoordinationTools**(`opts`): [`CoordinationTools`](#coordinationtools)

Defined in: [mcp/tools/coordination.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L185)

Build the driver's MCP tools over a live scope.

#### Parameters

##### opts

[`CoordinationToolsOptions`](#coordinationtoolsoptions)

#### Returns

[`CoordinationTools`](#coordinationtools)

***

### validateDelegateFeedbackArgs()

> **validateDelegateFeedbackArgs**(`raw`): [`DelegateFeedbackArgs`](#delegatefeedbackargs)

Defined in: [mcp/tools/delegate-feedback.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L83)

**`Experimental`**

Parse and validate raw MCP tool input into typed `DelegateFeedbackArgs`; throws `TypeError` on bad input.

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegateFeedbackArgs`](#delegatefeedbackargs)

***

### createDelegateFeedbackHandler()

> **createDelegateFeedbackHandler**(`options`): (`raw`) => `Promise`\<[`DelegateFeedbackResult`](#delegatefeedbackresult)\>

Defined in: [mcp/tools/delegate-feedback.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L160)

**`Experimental`**

Build the MCP tool handler that persists feedback events and attaches them to delegation records.

#### Parameters

##### options

`DelegateFeedbackHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegateFeedbackResult`](#delegatefeedbackresult)\>

***

### validateDelegateUiAuditArgs()

> **validateDelegateUiAuditArgs**(`raw`): [`DelegateUiAuditArgs`](#delegateuiauditargs)

Defined in: [mcp/tools/delegate-ui-audit.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L114)

**`Experimental`**

Parse and validate raw MCP tool input into typed `DelegateUiAuditArgs`; throws `TypeError` on bad input.

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegateUiAuditArgs`](#delegateuiauditargs)

***

### createDelegateUiAuditHandler()

> **createDelegateUiAuditHandler**(`options`): (`raw`) => `Promise`\<[`DelegateUiAuditResult`](#delegateuiauditresult)\>

Defined in: [mcp/tools/delegate-ui-audit.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L300)

**`Experimental`**

Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit.

#### Parameters

##### options

`DelegateUiAuditHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegateUiAuditResult`](#delegateuiauditresult)\>

***

### validateDelegateArgs()

> **validateDelegateArgs**(`raw`): [`DelegateArgs`](#delegateargs)

Defined in: [mcp/tools/delegate.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L75)

**`Experimental`**

Parse and validate raw MCP tool input into typed `DelegateArgs`; throws `TypeError` on bad input.

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegateArgs`](#delegateargs)

***

### createDelegateHandler()

> **createDelegateHandler**(`options`): (`raw`) => `Promise`\<[`DelegateResult`](#delegateresult)\>

Defined in: [mcp/tools/delegate.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L136)

Build the `delegate` tool handler. Closes over the injected supervisor substrate (`router` /
`backend` / `deliverable`); each call routes the agent's intent to `delegate()` and returns the
delivered output with its conserved cost.

#### Parameters

##### options

[`DelegateHandlerOptions`](#delegatehandleroptions)

#### Returns

(`raw`) => `Promise`\<[`DelegateResult`](#delegateresult)\>

***

### validateDelegationHistoryArgs()

> **validateDelegationHistoryArgs**(`raw`): [`DelegationHistoryArgs`](#delegationhistoryargs)

Defined in: [mcp/tools/delegation-history.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L54)

**`Experimental`**

Parse and validate raw MCP tool input into typed `DelegationHistoryArgs`; throws `TypeError` on bad input.

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegationHistoryArgs`](#delegationhistoryargs)

***

### createDelegationHistoryHandler()

> **createDelegationHistoryHandler**(`options`): (`raw`) => `Promise`\<[`DelegationHistoryResult`](#delegationhistoryresult)\>

Defined in: [mcp/tools/delegation-history.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L95)

**`Experimental`**

Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`.

#### Parameters

##### options

`DelegationHistoryHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegationHistoryResult`](#delegationhistoryresult)\>

***

### validateDelegationStatusArgs()

> **validateDelegationStatusArgs**(`raw`): [`DelegationStatusArgs`](#delegationstatusargs)

Defined in: [mcp/tools/delegation-status.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L57)

**`Experimental`**

Parse and validate raw MCP tool input into typed `DelegationStatusArgs`; throws `TypeError` on bad input.

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegationStatusArgs`](#delegationstatusargs)

***

### createDelegationStatusHandler()

> **createDelegationStatusHandler**(`options`): (`raw`) => `Promise`\<[`DelegationStatusResult`](#delegationstatusresult)\>

Defined in: [mcp/tools/delegation-status.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L82)

**`Experimental`**

Build the MCP tool handler that polls a `DelegationTaskQueue` for task status.

#### Parameters

##### options

`DelegationStatusHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegationStatusResult`](#delegationstatusresult)\>

***

### readTraceContextFromEnv()

> **readTraceContextFromEnv**(): [`TraceContext`](#tracecontext-2)

Defined in: [mcp/trace-propagation.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L36)

Read trace context from the process environment.
Returns a context with inherited ids or a freshly generated root.

#### Returns

[`TraceContext`](#tracecontext-2)

***

### createPropagatingTraceEmitter()

> **createPropagatingTraceEmitter**(`ctx`): `object`

Defined in: [mcp/trace-propagation.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L49)

Create a LoopTraceEmitter that:
  1. Parents all spans under the inherited PARENT_SPAN_ID.
  2. Exports spans to OTEL when OTEL_EXPORTER_OTLP_ENDPOINT is set.

Returns both the emitter and the optional exporter handle for shutdown.

#### Parameters

##### ctx

[`TraceContext`](#tracecontext-2)

#### Returns

`object`

##### emitter

> **emitter**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

##### exporter

> **exporter**: [`OtelExporter`](index.md#otelexporter) \| `undefined`

##### context

> **context**: [`TraceContext`](#tracecontext-2)

***

### traceContextToEnv()

> **traceContextToEnv**(`ctx`): `Record`\<`string`, `string`\>

Defined in: [mcp/trace-propagation.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L86)

Build env vars to pass to a child MCP subprocess so it inherits the
current trace context.

#### Parameters

##### ctx

[`TraceContext`](#tracecontext-2)

#### Returns

`Record`\<`string`, `string`\>

***

### createWorktree()

> **createWorktree**(`options`): `Promise`\<[`WorktreeHandle`](#worktreehandle)\>

Defined in: [mcp/worktree.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L114)

**`Experimental`**

Checkout a fresh git worktree for a delegation run on a new branch under `variantsDir`.

#### Parameters

##### options

[`CreateWorktreeOptions`](#createworktreeoptions)

#### Returns

`Promise`\<[`WorktreeHandle`](#worktreehandle)\>

***

### captureWorktreeDiff()

> **captureWorktreeDiff**(`options`): `Promise`\<[`DiffResult`](#diffresult)\>

Defined in: [mcp/worktree.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L134)

**`Experimental`**

Stage all changes in a worktree and return the diff patch + shortstat against the base ref.

#### Parameters

##### options

[`DiffOptions`](#diffoptions)

#### Returns

`Promise`\<[`DiffResult`](#diffresult)\>

***

### removeWorktree()

> **removeWorktree**(`options`): `Promise`\<`void`\>

Defined in: [mcp/worktree.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L174)

**`Experimental`**

Remove a git worktree and delete its branch; tolerates already-removed paths.

#### Parameters

##### options

[`RemoveWorktreeOptions`](#removeworktreeoptions)

#### Returns

`Promise`\<`void`\>

## References

### mcpToolsForRuntimeMcp

Re-exports [mcpToolsForRuntimeMcp](index.md#mcptoolsforruntimemcp)

***

### mcpToolsForRuntimeMcpSubset

Re-exports [mcpToolsForRuntimeMcpSubset](index.md#mcptoolsforruntimemcpsubset)

***

### AnalystRegistry

Re-exports [AnalystRegistry](runtime.md#analystregistry)

***

### CoordinationEvent

Re-exports [CoordinationEvent](runtime.md#coordinationevent)

***

### MakeWorkerAgent

Re-exports [MakeWorkerAgent](runtime.md#makeworkeragent)
