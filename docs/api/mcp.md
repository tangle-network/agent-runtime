[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / mcp

# mcp

## Classes

### CodexExecutionDiagnosticError

Thrown when reproducible Codex exits without one valid terminal usage event.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CodexExecutionDiagnosticError**(`reason`, `diagnostic`, `cause?`): [`CodexExecutionDiagnosticError`](#codexexecutiondiagnosticerror)

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

##### reason

> `readonly` **reason**: `string`

##### diagnostic

> `readonly` **diagnostic**: [`CodexExecutionFailureDiagnostic`](#codexexecutionfailurediagnostic)

***

### DelegationStateCorruptError

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

**`Experimental`**

###### Parameters

###### options

[`FileDelegationStoreOptions`](#filedelegationstoreoptions)

###### Returns

[`FileDelegationStore`](#filedelegationstore)

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

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

**`Experimental`**

In-process queue for async delegation tasks — submit, cancel, poll status, and read history.

#### Constructors

##### Constructor

> **new DelegationTaskQueue**(`options?`): [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

###### Parameters

###### options?

[`DelegationTaskQueueOptions`](#delegationtaskqueueoptions) = `{}`

###### Returns

[`DelegationTaskQueue`](#delegationtaskqueue)

#### Methods

##### restore()

> `static` **restore**(`options?`): `Promise`\<[`DelegationTaskQueue`](#delegationtaskqueue)\>

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

**`Experimental`**

Kick off a delegation in the background. Returns immediately. The
`taskId` is queryable via `status` once this method returns. Throws
the recorded `DelegationPersistenceError` once the store has failed —
the queue does not accept work it cannot journal.

###### Type Parameters

###### Args

`Args` *extends* [`DelegationArgs`](#delegationargs)

###### Parameters

###### input

[`SubmitInput`](#submitinput)\<`Args`\>

###### Returns

[`SubmitOutput`](#submitoutput)

##### status()

> **status**(`taskId`, `opts?`): [`DelegationStatusResult`](#delegationstatusresult) \| `undefined`

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

**`Experimental`**

Await every journal write issued so far. Rejects with the recorded
`DelegationPersistenceError` when any of them failed. Call before
handing the store's backing file to another process.

###### Returns

`Promise`\<`void`\>

##### inflightCount()

> **inflightCount**(): `number`

**`Experimental`**

Test-only — number of in-flight (non-terminal) records.

###### Returns

`number`

## Interfaces

### DetectExecutorArgs

**`Experimental`**

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-5)

**`Experimental`**

##### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

**`Experimental`**

Raw env (defaults to `process.env`). Pass an explicit map for tests.

##### resolveFleet?

> `optional` **resolveFleet?**: (`client`, `fleetId`) => `Promise`\<[`FleetHandle`](#fleethandle)\>

**`Experimental`**

Override how a fleet handle is resolved from the client + fleet id. The
default reads `client.fleets.get(fleetId)` and validates the returned
shape against the structural `FleetHandle` contract.

###### Parameters

###### client

[`SandboxClient`](runtime.md#sandboxclient-5)

###### fleetId

`string`

###### Returns

`Promise`\<[`FleetHandle`](#fleethandle)\>

***

### CodexExecutionFailureDiagnostic

Bounded, credential-redacted process context attached when reproducible Codex output fails
validation. The process still fails closed; this only preserves enough evidence to diagnose it.

#### Properties

##### exitCode

> **exitCode**: `number` \| `null`

##### killedBySignal

> **killedBySignal**: `Signals` \| `null`

##### timedOut

> **timedOut**: `boolean`

##### aborted?

> `optional` **aborted?**: `boolean`

##### durationMs

> **durationMs**: `number`

##### stdout

> **stdout**: `string`

##### stderr

> **stderr**: `string`

##### stdoutTruncated

> **stdoutTruncated**: `boolean`

##### stderrTruncated

> **stderrTruncated**: `boolean`

***

### DelegateRunCtx

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

**`Experimental`**

Detached-run resume key recorded on the queue record at submit time
(`formatDetachedSessionRef`). Present only when the submit path requested
detached dispatch — its presence is what routes a session-backed delegate
onto the `driveTurn` tick path instead of holding a stream.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

**`Experimental`**

Per-delegation trace sink supplied by the queue — loop events emitted
here land on the delegation record as a compact span tree. Delegates
compose it with their configured OTEL emitter so both sinks observe
the same stream.

#### Methods

##### report()

> **report**(`progress`): `void`

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()?

> `optional` **updateDetachedSessionRef**(`ref`): `void`

**`Experimental`**

Rebind the record's resume key (e.g. once the sandbox id is known).

###### Parameters

###### ref

`string`

###### Returns

`void`

***

### CoderReview

**`Experimental`**

Structured review verdict over a coder candidate.

#### Properties

##### approved

> **approved**: `boolean`

**`Experimental`**

Gate: only approved candidates are eligible to win.

##### recommendation

> **recommendation**: `"ship"` \| `"reject"` \| `"approve-with-nits"` \| `"changes-requested"`

**`Experimental`**

Reviewer's recommendation — surfaced in traces.

##### readiness

> **readiness**: `number`

**`Experimental`**

Readiness 0..1, used by the `highest-readiness` winner-selection strategy.

##### notes?

> `optional` **notes?**: `string`

**`Experimental`**

***

### DetachedSessionDelegateOptions

**`Experimental`**

#### Properties

##### executor?

> `optional` **executor?**: [`DelegationExecutor`](#delegationexecutor)

**`Experimental`**

Execution placement. Pass a [DelegationExecutor](#delegationexecutor) (sibling or fleet)
to control where worker iterations land. `sandboxClient` is a
convenience shorthand that wraps the client in a sibling executor — pass
one or the other, not both.

##### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](runtime.md#sandboxclient-5)

**`Experimental`**

Convenience shorthand for sibling placement. Equivalent to
`executor: createSiblingSandboxExecutor({ client: sandboxClient })`.

##### workerProfile?

> `optional` **workerProfile?**: `AgentProfile`

**`Experimental`**

The worker's authored `AgentProfile` (§1.5: the system authors profiles). Spread onto the
sandbox-session run spec → `runAgentRounds` → the executor's `harnessInvocation`, so the harness runs
under the caller's stance. Omit to use a minimal model-only default (no hardcoded skills/tools);
`harness` / `model` / `systemPrompt` below are convenience overrides layered onto whichever
profile is used.

##### harness?

> `optional` **harness?**: `string`

**`Experimental`**

Backend harness for the single-coder path (sets `metadata.backendType`). Default `claude-code`.

##### model?

> `optional` **model?**: `string`

**`Experimental`**

Model override for the single-coder path.

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

**`Experimental`**

The worker's authored system prompt (§1.5). Flows onto the run spec's
`profile.prompt.systemPrompt` → through `runAgentRounds` → the executor's `harnessInvocation`, so the
harness runs under this stance. Omit to keep the profile's own prompt.

##### fanoutHarnesses?

> `optional` **fanoutHarnesses?**: `string`[]

**`Experimental`**

Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1.

##### fanoutModels?

> `optional` **fanoutModels?**: (`string` \| `undefined`)[]

**`Experimental`**

Optional per-harness model override for `variants > 1`.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

**`Experimental`**

Hard cap on the kernel's per-batch concurrency. Default 4.

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

**`Experimental`**

Optional adversarial reviewer. When set, a candidate must pass mechanical
validation AND `reviewer.approved` to be eligible to win — empty/secret/
test-failing patches are already gone; this catches the "compiles + passes
but wrong/unsafe" class the deterministic validator can't see.

##### winnerSelection?

> `optional` **winnerSelection?**: [`DetachedWinnerSelection`](#detachedwinnerselection)

**`Experimental`**

Winner-selection strategy among eligible candidates. Default `highest-score`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

**`Experimental`**

Loop trace emitter forwarded into every delegated `runAgentRounds`. Wire
`createPropagatingTraceEmitter(readTraceContextFromEnv())` here (the bin
does) so delegated build-loops export their topology spans to the OTLP /
Tangle Intelligence sink when `OTEL_EXPORTER_OTLP_ENDPOINT` is set — and
are a cheap no-op when it isn't. Configurable by construction.

Detached single-variant turns (taken when `ctx.detachedSessionRef` is set)
bypass `runAgentRounds`; `runDetachedTurn` synthesizes a single-iteration loop
event stream for them so this emitter observes detached work too.

##### detachedTickIntervalMs?

> `optional` **detachedTickIntervalMs?**: `number`

**`Experimental`**

Tick cadence (ms) for the detached single-variant path. Default 5000.

##### detachedWallCapMs?

> `optional` **detachedWallCapMs?**: `number`

**`Experimental`**

Wall-clock cap (ms) forwarded to `driveTurn` for detached turns.

***

### SettleDetachedCoderTurnOptions

**`Experimental`**

#### Properties

##### task

> **task**: [`CoderTask`](profiles.md#codertask)

**`Experimental`**

##### sessionId

> **sessionId**: `string`

**`Experimental`**

Session id of the detached turn — used as the synthesized event id.

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

##### harness?

> `optional` **harness?**: `string`

**`Experimental`**

##### model?

> `optional` **model?**: `string`

**`Experimental`**

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

**`Experimental`**

Same gate as the streaming path: an unapproved candidate cannot win.

***

### DelegationStore

**`Experimental`**

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

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

**`Experimental`**

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### FileDelegationStoreOptions

**`Experimental`**

#### Properties

##### filePath

> **filePath**: `string`

**`Experimental`**

Absolute path of the JSON state file. Parent directories are created on first write.

##### recoverCorrupt?

> `optional` **recoverCorrupt?**: `boolean`

**`Experimental`**

When the state file exists but cannot be parsed, archive it to
`<filePath>.corrupt-<timestamp>` and start empty instead of
throwing `DelegationStateCorruptError`. Default false.

***

### DelegationTraceSpan

**`Experimental`**

One span of a delegation's compact trace. Flat (parent linkage by id), all
values JSON-safe scalars — `FileDelegationStore` round-trips records
through `JSON.stringify`. `meta` carries the span's attributes (GenAI
semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
them, so a consumer can re-export journal traces losslessly.

#### Properties

##### spanId

> **spanId**: `string`

**`Experimental`**

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

**`Experimental`**

Absent on the tree root.

##### name

> **name**: `string`

**`Experimental`**

`'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name).

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

**`Experimental`**

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

**`Experimental`**

##### endMs

> **endMs**: `number`

**`Experimental`**

##### meta?

> `optional` **meta?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

**`Experimental`**

***

### DelegationTraceCaps

**`Experimental`**

#### Properties

##### maxSpans?

> `optional` **maxSpans?**: `number`

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_SPANS](#delegation_trace_max_spans).

##### maxBytes?

> `optional` **maxBytes?**: `number`

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_BYTES](#delegation_trace_max_bytes). Approximate — measured as the
 sum of per-span `JSON.stringify` lengths.

***

### CappedDelegationTrace

**`Experimental`**

#### Properties

##### trace

> **trace**: [`DelegationTraceSpan`](#delegationtracespan)[]

**`Experimental`**

##### truncated

> **truncated**: `boolean`

**`Experimental`**

True when oldest spans were dropped to honor the caps.

***

### DelegationTraceCollector

**`Experimental`**

Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
(mirroring the OTEL emitter's buffering) and hands the derived compact
spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
that never ended — a hard-aborted loop still leaves its partial tree in the
journal, unlike the OTEL path which drops it.

#### Properties

##### emitter

> **emitter**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

**`Experimental`**

#### Methods

##### settle()

> **settle**(): `void`

**`Experimental`**

Flush buffered events of runs that never reached `loop.ended`.

###### Returns

`void`

***

### CoderOutput

**`Experimental`**

The structured coder result the sandbox-session path decodes + gates.

#### Properties

##### branch

> **branch**: `string`

**`Experimental`**

Branch the agent wrote the patch on.

##### patch

> **patch**: `string`

**`Experimental`**

Unified diff (`git diff <base>..HEAD`).

##### testResult

> **testResult**: `object`

**`Experimental`**

###### passed

> **passed**: `boolean`

###### output

> **output**: `string`

##### typecheckResult

> **typecheckResult**: `object`

**`Experimental`**

###### passed

> **passed**: `boolean`

###### output

> **output**: `string`

##### diffStats

> **diffStats**: `object`

**`Experimental`**

###### filesChanged

> **filesChanged**: `number`

###### insertions

> **insertions**: `number`

###### deletions

> **deletions**: `number`

##### reviewerNotes?

> `optional` **reviewerNotes?**: `string`

**`Experimental`**

Optional reviewer commentary surfaced by the agent.

***

### DriveTurnCapableBox

**`Experimental`**

The box surface detached turns need. `SandboxInstance`
(`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
optional here because older SDKs / fakes may not expose it; when present it
is invoked on abort so the remote run actually stops.

#### Methods

##### driveTurn()

> **driveTurn**(`message`, `opts`): `Promise`\<[`DriveTurnTick`](#driveturntick)\>

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

**`Experimental`**

###### Parameters

###### id

`string`

###### Returns

`Promise`\<`void`\>

***

### DetachedSessionRefParts

**`Experimental`**

Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
submit and box acquisition — a record restored in that window is not
resumable (there is no box to resume on) and the resume driver fails it
loud rather than dispatching onto a guessed box.

#### Properties

##### sessionId

> **sessionId**: `string`

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

**`Experimental`**

***

### DetachedTurn

**`Experimental`**

The terminal payload of a finished detached turn.

#### Properties

##### text

> **text**: `string`

**`Experimental`**

Final assistant text.

##### result

> **result**: `Record`\<`string`, `unknown`\>

**`Experimental`**

The SDK's cached AgentExecutionResult-shape record for the turn.

***

### RunDetachedTurnOptions

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-5)

**`Experimental`**

Sandbox client used to acquire the box (the delegate's executor client).

##### spec

> **spec**: [`AgentRunSpec`](runtime.md#agentrunspec)\<`unknown`\>

**`Experimental`**

Profile + overrides for box acquisition — same spec the streaming path uses.

##### prompt

> **prompt**: `string`

**`Experimental`**

The full turn prompt; consumed by `driveTurn`'s dispatch leg.

##### sessionId

> **sessionId**: `string`

**`Experimental`**

Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`).

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

##### tickIntervalMs?

> `optional` **tickIntervalMs?**: `number`

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

**`Experimental`**

Loop-trace sink. When set, the detached turn synthesizes a
single-iteration loop span tree (`runId` = `sessionId`, driver
`'detached-turn'`) so trace-context inheritance survives the detached
path — the same events the streaming `runAgentRounds` path would emit, minus
per-token telemetry: `driveTurn` yields one terminal payload, so token
and cost figures are structurally unavailable and reported as 0 under
this driver tag.

##### placement?

> `optional` **placement?**: `"sibling"` \| `"fleet"`

**`Experimental`**

Physical placement stamped on the synthesized dispatch event. Default `'sibling'`.

#### Methods

##### bindSandbox()

> **bindSandbox**(`sandboxId`): `void`

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

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DetachedTurnResumeDriverOptions

**`Experimental`**

#### Properties

##### intervalMs?

> `optional` **intervalMs?**: `number`

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` on every tick.

#### Methods

##### resolveSandbox()

> **resolveSandbox**(`sandboxId`): `Promise`\<[`DriveTurnCapableBox`](#driveturncapablebox)\>

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

> **settleOutput**(`turn`, `record`, `ctx`): [`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape) \| `Promise`\<[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

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

[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape) \| `Promise`\<[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

***

### DelegationExecutor

**`Experimental`**

#### Properties

##### client

> `readonly` **client**: [`SandboxClient`](runtime.md#sandboxclient-5)

**`Experimental`**

Sandbox client the kernel calls. Returned with `describePlacement` set.

##### placement?

> `readonly` `optional` **placement?**: `"sibling"` \| `"fleet"` \| `"in-process"`

**`Experimental`**

Where delegated work physically runs. `sibling` and `fleet` placements are
session-backed (boxes expose `driveTurn`, so detached dispatch + resume
apply); `in-process` spawns local harness CLIs with no sandbox session to
detach. Optional so consumer-implemented executors stay source-compatible;
absent means "unknown" and detached dispatch is not enabled for it.

#### Methods

##### describe()

> **describe**(): `string`

**`Experimental`**

Best-effort one-liner used in stderr boot logs and diagnostics.

###### Returns

`string`

***

### SiblingSandboxExecutorOptions

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-5)

**`Experimental`**

***

### FleetHandle

**`Experimental`**

Minimal `SandboxFleet` surface the fleet executor calls. Declared
structurally so tests can pass an in-memory stub without instantiating the
sandbox SDK.

#### Properties

##### fleetId

> `readonly` **fleetId**: `string`

**`Experimental`**

##### ids

> `readonly` **ids**: readonly `string`[]

**`Experimental`**

Machine ids in dispatch-eligible order. The executor round-robins.

#### Methods

##### sandbox()

> **sandbox**(`machineId`): `Promise`\<`SandboxInstance`\>

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

**`Experimental`**

#### Properties

##### fleet

> **fleet**: [`FleetHandle`](#fleethandle)

**`Experimental`**

##### selectMachine?

> `optional` **selectMachine?**: (`call`) => `string`

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

**`Experimental`**

Machine ids to skip during default round-robin. Set to the caller's own
machineId so workers don't compete with the orchestrator on the same VM.

***

### FeedbackEvent

**`Experimental`**

#### Properties

##### id

> **id**: `string`

**`Experimental`**

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

**`Experimental`**

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

***

### FeedbackStore

**`Experimental`**

#### Methods

##### put()

> **put**(`event`): `Promise`\<`void`\>

**`Experimental`**

Append a new event. Never dedupes — every rating is its own event.

###### Parameters

###### event

[`FeedbackEvent`](#feedbackevent)

###### Returns

`Promise`\<`void`\>

##### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

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

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`.

##### harnesses?

> `optional` **harnesses?**: readonly [`LocalHarness`](#localharness)[]

**`Experimental`**

Harnesses to round-robin across `create()` calls. One entry = no fanout. Default `['claude']`.

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Optional per-delegation test command run in the worktree after the harness exits.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Optional per-delegation typecheck command. Same shape as `testCmd`.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5min.

##### postCheckTimeoutMs?

> `optional` **postCheckTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per test/typecheck subprocess (ms). Default 2min.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

**`Experimental`**

Test seam — override the git runner used by the worktree helpers.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

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

[`RunLocalHarnessOptions`](#runlocalharnessoptions)

###### Returns

`Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

##### runPostCheck?

> `optional` **runPostCheck?**: (`cmd`, `cwd`, `signal?`) => `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

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

**`Experimental`**

#### Extends

- [`LoopSandboxPlacement`](runtime.md#loopsandboxplacement)

#### Properties

##### worktreePath?

> `optional` **worktreePath?**: `string`

**`Experimental`**

Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts).

##### harness?

> `optional` **harness?**: [`LocalHarness`](#localharness)

**`Experimental`**

Which harness handled this delegation.

##### kind

> **kind**: `"sibling"` \| `"fleet"`

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`kind`](runtime.md#kind-6)

##### sandboxId?

> `optional` **sandboxId?**: `string`

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`sandboxId`](runtime.md#sandboxid)

##### fleetId?

> `optional` **fleetId?**: `string`

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`fleetId`](runtime.md#fleetid)

##### machineId?

> `optional` **machineId?**: `string`

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`machineId`](runtime.md#machineid)

***

### FactCandidate

**`Experimental`**

A fact proposed for the KB, with its grounding.

#### Properties

##### claim

> **claim**: `string`

**`Experimental`**

The atomic claim text.

##### value?

> `optional` **value?**: `string` \| `number`

**`Experimental`**

Optional extracted value (number or string) the claim asserts.

##### verbatimPassage

> **verbatimPassage**: `string`

**`Experimental`**

Verbatim span lifted from the source that backs the claim.

##### sourceText

> **sourceText**: `string`

**`Experimental`**

The raw source text the passage must be grounded in.

##### citation?

> `optional` **citation?**: `string`

**`Experimental`**

Where the fact claims to come from — checked for circular/self citations.

***

### FactJudgeVerdict

**`Experimental`**

#### Properties

##### accept

> **accept**: `boolean`

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

**`Experimental`**

***

### FactJudge

**`Experimental`**

A pluggable fact validator. Throw is NOT allowed — return a
 verdict; a thrown judge is a programmer error, not a veto.

#### Properties

##### name

> **name**: `string`

**`Experimental`**

#### Methods

##### judge()

> **judge**(`candidate`): [`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

**`Experimental`**

###### Parameters

###### candidate

[`FactCandidate`](#factcandidate)

###### Returns

[`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

***

### KbGateResult

**`Experimental`**

#### Properties

##### accepted

> **accepted**: `boolean`

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

**`Experimental`**

Name of the judge that vetoed; undefined when accepted.

##### reason?

> `optional` **reason?**: `string`

**`Experimental`**

***

### CreateKbGateOptions

**`Experimental`**

#### Properties

##### judges?

> `optional` **judges?**: [`FactJudge`](#factjudge)[]

**`Experimental`**

Extra judges appended after the built-in floor (e.g. an LLM judge).

##### minPassageChars?

> `optional` **minPassageChars?**: `number`

**`Experimental`**

Minimum verbatim-passage length. Default 12 — kills empty/stub passages.

##### selfArtifactKinds?

> `optional` **selfArtifactKinds?**: `string`[]

**`Experimental`**

Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
`'cad_params'`, `'requirements'`). A citation naming one is circular
(laundering) — the fact cites a derived artifact, not a real source.
Default `[]` (no circular check unless the consumer declares its kinds).

***

### RunLocalHarnessOptions

**`Experimental`**

#### Properties

##### harness

> **harness**: [`LocalHarness`](#localharness)

**`Experimental`**

##### cwd

> **cwd**: `string`

**`Experimental`**

Working directory for the subprocess (typically a worktree path).

##### taskPrompt

> **taskPrompt**: `string`

**`Experimental`**

Prompt forwarded as the harness CLI's task argument.

##### invocation?

> `optional` **invocation?**: `object`

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

**`Experimental`**

Allow autonomous Claude edits without an interactive permission prompt.
 Use only when `cwd` is an isolated candidate worktree.

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

**`Experimental`**

Isolate Codex from ambient configuration/instructions and require JSONL token usage.
 The invocation should come from `harnessInvocation(..., { codexReproducible: true })`.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

**`Experimental`**

Absolute host paths that reproducible Codex must not read. The normalized set is compiled
 into the controlled permission profile and its digest is returned in execution evidence.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

**`Experimental`**

Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry.

##### maxOutputBytes?

> `optional` **maxOutputBytes?**: `number`

**`Experimental`**

Newest stdout/stderr bytes retained per stream. Default 64 MiB.

##### signal?

> `optional` **signal?**: `AbortSignal`

**`Experimental`**

Caller cancellation. SIGTERM is sent on abort.

##### env?

> `optional` **env?**: `ProcessEnv`

**`Experimental`**

Override env (defaults to inheriting from the parent).

##### spawn?

> `optional` **spawn?**: (`command`, `args`, `opts`) => `ChildProcess`

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

Exact aggregate usage emitted by Codex's terminal `turn.completed` JSONL event.

#### Properties

##### inputTokens

> **inputTokens**: `number`

##### cachedInputTokens

> **cachedInputTokens**: `number`

##### outputTokens

> **outputTokens**: `number`

##### reasoningOutputTokens

> **reasoningOutputTokens**: `number`

***

### CodexExecutionPolicy

Isolation settings asserted before a reproducible Codex run is allowed to start.

#### Properties

##### sessionPersistence

> **sessionPersistence**: `"ephemeral"`

##### userConfig

> **userConfig**: `false`

##### rules

> **rules**: `false`

##### projectInstructions

> **projectInstructions**: `false`

##### skillInstructions

> **skillInstructions**: `false`

##### appInstructions

> **appInstructions**: `false`

##### toolSuggestions

> **toolSuggestions**: `false`

##### multiAgentInstructions

> **multiAgentInstructions**: `false`

##### sandbox

> **sandbox**: `"workspace-write"`

##### permissionProfile

> **permissionProfile**: `"agent_runtime_reproducible"`

##### approvalPolicy

> **approvalPolicy**: `"never"`

##### shellNetwork

> **shellNetwork**: `false`

##### webSearch

> **webSearch**: `false`

##### serviceTier

> **serviceTier**: `"default"`

##### shellEnvironment

> **shellEnvironment**: `"core-filtered"`

##### loginShell

> **loginShell**: `false`

##### credentialsReadable

> **credentialsReadable**: `false`

##### hostHomeReadable

> **hostHomeReadable**: `false`

##### procEnvironment

> **procEnvironment**: `"private-sanitized"`

##### sensitiveEnvironmentNamesVisible

> **sensitiveEnvironmentNamesVisible**: `false`

##### parentRepoRead

> **parentRepoRead**: `false`

##### gitMetadata

> **gitMetadata**: `false`

##### temporaryDirectory

> **temporaryDirectory**: `"workspace-private"`

##### stagedExecutable

> **stagedExecutable**: `"static-elf-read-only"`

##### callerReadDeniedPaths

> **callerReadDeniedPaths**: `"enforced"`

##### containerSockets

> **containerSockets**: `false`

***

### CodexExecutionEvidence

Zero-model-call evidence for the exact Codex process about to run.

#### Properties

##### cliVersion

> **cliVersion**: `string`

##### executableSha256

> **executableSha256**: `string`

##### requestedPromptSha256

> **requestedPromptSha256**: `string`

SHA-256 of the exact composed prompt argument proved present in the rendered prompt.

##### effectivePromptSha256

> **effectivePromptSha256**: `string`

##### nonPromptArgsSha256

> **nonPromptArgsSha256**: `string`

##### controlledConfigSha256

> **controlledConfigSha256**: `string`

##### readDeniedPaths

> **readDeniedPaths**: `string`[]

Sorted normalized paths compiled into the permission profile.

##### readDeniedPathsSha256

> **readDeniedPathsSha256**: `string`

##### readDeniedPathCount

> **readDeniedPathCount**: `number`

##### policy

> **policy**: [`CodexExecutionPolicy`](#codexexecutionpolicy)

***

### LocalHarnessResult

**`Experimental`**

#### Properties

##### exitCode

> **exitCode**: `number` \| `null`

**`Experimental`**

OS exit code. `null` when killed before exit.

##### stdout

> **stdout**: `string`

**`Experimental`**

Concatenated stdout.

##### stderr

> **stderr**: `string`

**`Experimental`**

Concatenated stderr.

##### killedBySignal

> **killedBySignal**: `Signals` \| `null`

**`Experimental`**

Set when the process exited via signal (timeout / abort).

##### durationMs

> **durationMs**: `number`

**`Experimental`**

Wall-clock duration ms (spawn → exit).

##### timedOut

> **timedOut**: `boolean`

**`Experimental`**

Set when timeoutMs elapsed before exit.

##### aborted?

> `optional` **aborted?**: `boolean`

**`Experimental`**

Set when the caller's AbortSignal fired before this result settled.
Optional so injected runners and stored results from older releases remain valid.

##### usage?

> `optional` **usage?**: [`CodexTokenUsage`](#codextokenusage)

**`Experimental`**

Present for a reproducible Codex run; parsed from the real terminal JSONL event.

##### evidence?

> `optional` **evidence?**: [`CodexExecutionEvidence`](#codexexecutionevidence)

**`Experimental`**

Present for reproducible Codex runs; generated and checked before model execution.

***

### MemoryItem

One row of agent memory: a crisp lesson/fact with provenance.

#### Properties

##### id

> **id**: `string`

Stable id (content-hash by convention; see `memoryArtifactFromLessons`).

##### text

> **text**: `string`

The lesson itself — one imperative or observation the agent should recall.

##### tags?

> `optional` **tags?**: `string`[]

Optional retrieval tags, matched by `memory_search` alongside the text.

##### source?

> `optional` **source?**: `string`

Provenance: the finding / trace / curation pass this row came from.

***

### AgentMemorySpec

The `memory` artifact payload — HOW a profile's memory is stored and served:

  - `store: 'file'` — served by the in-repo memory bin
    (`agent-runtime-memory-mcp`, src/mcp/memory-bin.ts): rows load from
    `path` (a JSON array or JSONL file of `MemoryItem`) and/or the inline
    `items` seed (inline wins on id collision). At least one of
    `path`/`items` is required.
  - `store: 'mcp'`  — an EXTERNAL, already-runnable MCP server that exposes
    the memory tools itself; `server` is required and mounts verbatim.

`logPath` makes the served memory append one JSONL row per `memory_search`
— the retrieval log a holdout estimator reads (see module doc).

#### Properties

##### store

> **store**: `"mcp"` \| `"file"`

##### path?

> `optional` **path?**: `string`

`store:'file'` — host path to the durable row store (JSON array or JSONL).

##### items?

> `optional` **items?**: [`MemoryItem`](#memoryitem)[]

Inline seed rows, served alongside (and winning over) `path` rows.

##### server?

> `optional` **server?**: `AgentProfileMcpServer`

`store:'mcp'` — the external server that already serves memory tools.

##### logPath?

> `optional` **logPath?**: `string`

JSONL retrieval log: one row per `memory_search` (ts, query, k, returned).

***

### CreateMemoryToolServerOptions

#### Properties

##### items

> **items**: readonly [`MemoryItem`](#memoryitem)[]

The rows to serve. MUST be non-empty (an empty memory is never served).

##### serverName?

> `optional` **serverName?**: `string`

Server display name surfaced via `initialize`. Default 'agent-memory'.

##### serverVersion?

> `optional` **serverVersion?**: `string`

Server version surfaced via `initialize`. Default '0'.

##### defaultK?

> `optional` **defaultK?**: `number`

Default result count for `memory_search`. Default 5.

##### logPath?

> `optional` **logPath?**: `string`

Append one JSONL row per `memory_search` (the retrieval-holdout seam).

***

### ResolvedMemoryEnv

What the memory bin resolved from its environment.

#### Properties

##### items

> **items**: [`MemoryItem`](#memoryitem)[]

##### serverName?

> `optional` **serverName?**: `string`

##### logPath?

> `optional` **logPath?**: `string`

***

### McpToolDescriptor

**`Experimental`**

A callable MCP tool exposed by either stdio server.

#### Properties

##### name

> **name**: `string`

**`Experimental`**

##### description

> **description**: `string`

**`Experimental`**

##### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\>

**`Experimental`**

##### handler

> **handler**: (`raw`) => `Promise`\<`unknown`\>

**`Experimental`**

###### Parameters

###### raw

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### McpTransport

**`Experimental`**

Stdio-shaped transport used by the shared JSON-RPC server implementation.

#### Properties

##### input

> **input**: `ReadableStream`

**`Experimental`**

##### output

> **output**: `WritableStream`

**`Experimental`**

***

### JsonRpcMessage

**`Experimental`**

One JSON-RPC 2.0 request or notification.

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

**`Experimental`**

##### id?

> `optional` **id?**: `string` \| `number` \| `null`

**`Experimental`**

##### method

> **method**: `string`

**`Experimental`**

##### params?

> `optional` **params?**: `unknown`

**`Experimental`**

***

### JsonRpcResponse

**`Experimental`**

One JSON-RPC 2.0 response.

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

**`Experimental`**

##### id

> **id**: `string` \| `number` \| `null`

**`Experimental`**

##### result?

> `optional` **result?**: `unknown`

**`Experimental`**

##### error?

> `optional` **error?**: `object`

**`Experimental`**

###### code

> **code**: `number`

###### message

> **message**: `string`

###### data?

> `optional` **data?**: `unknown`

***

### McpServerOptions

**`Experimental`**

#### Properties

##### delegateSupervisor?

> `optional` **delegateSupervisor?**: [`DelegateHandlerOptions`](#delegatehandleroptions)

**`Experimental`**

Required to enable `delegate` — the ONE generic delegation verb. Inject the supervisor
substrate: its brain `router`, the worker `backend`, and the completion `deliverable`. The
supervisor AUTHORS its own worker from the agent's intent, so there is no worker profile to
wire here.

##### uiAuditorDelegate?

> `optional` **uiAuditorDelegate?**: [`UiAuditorDelegate`](#uiauditordelegate)

**`Experimental`**

Required to enable delegate_ui_audit. Wire one that closes over your
`runAgentRounds` + `uiAuditorProfile` + a `SandboxClient` (the
canonical in-process choice is `createInProcessUiAuditClient` from
`@tangle-network/agent-runtime/profiles`) + your vision judge.

##### feedbackStore?

> `optional` **feedbackStore?**: [`FeedbackStore`](#feedbackstore)

**`Experimental`**

Override the default in-memory feedback store.

##### queue?

> `optional` **queue?**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

Override the default in-memory task queue.

##### extraTools?

> `optional` **extraTools?**: [`McpToolDescriptor`](#mcptooldescriptor)[]

**`Experimental`**

Extra tools to serve alongside the delegation tools, for example
`createCoordinationTools(...).tools`. Registered after the built-ins; a
duplicate name throws so delegation tools cannot be shadowed silently.

##### traceContext?

> `optional` **traceContext?**: [`TraceContext`](#tracecontext-2)

**`Experimental`**

Inherited trace identity (`readTraceContextFromEnv()`) stamped on every
record the DEFAULT queue creates. Ignored when `queue` is supplied —
pass `traceContext` to that queue's constructor instead.

##### serverName?

> `optional` **serverName?**: `string`

**`Experimental`**

Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`.

##### serverVersion?

> `optional` **serverVersion?**: `string`

**`Experimental`**

Server version surfaced via `initialize`. Default = the package version baked at build time.

***

### McpServer

**`Experimental`**

#### Properties

##### tools

> `readonly` **tools**: `ReadonlyMap`\<`string`, [`McpToolDescriptor`](#mcptooldescriptor)\>

**`Experimental`**

Tools currently registered (depend on which delegates were wired).

##### queue

> `readonly` **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

The underlying queue — exposed so tests can introspect it.

##### feedbackStore

> `readonly` **feedbackStore**: [`FeedbackStore`](#feedbackstore)

**`Experimental`**

The feedback store — exposed for the same reason.

#### Methods

##### handle()

> **handle**(`message`): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

**`Experimental`**

Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications).

###### Parameters

###### message

[`JsonRpcMessage`](#jsonrpcmessage)

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

##### serve()

> **serve**(`transport?`): `Promise`\<`void`\>

**`Experimental`**

Drive the server on a stdio-shaped transport until `stop()` is called.

###### Parameters

###### transport?

[`McpTransport`](#mcptransport)

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

**`Experimental`**

Stop a `serve` call. Subsequent requests are rejected.

###### Returns

`void`

***

### DelegationRecord

**`Experimental`**

Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
persistent stores round-trip records through `JSON.stringify`.

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

##### args

> **args**: [`DelegationArgs`](#delegationargs)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

**`Experimental`**

##### startedAt

> **startedAt**: `string`

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

**`Experimental`**

Sha-prefix hash of the canonical input — used for idempotency lookup.

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

**`Experimental`**

Caller-generated deterministic id of a detached run (e.g. the sandbox
session id a single-tick driver resumes by). Presence is what makes a
restored in-flight record resumable via `resumeDelegate`; without it a
restart settles the record as failed.

##### feedback

> **feedback**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

**`Experimental`**

Feedback events keyed by this delegation's taskId.

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

**`Experimental`**

Compact loop-trace span tree teed from the delegation's run, oldest
spans first. Appended when a delegated loop reaches `loop.ended` and
settled (partial buffers included) at the terminal transition. Capped
via `capDelegationTrace` — see `traceTruncated`.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

**`Experimental`**

Inherited trace identity (the queue's `traceContext` at submit time —
typically `readTraceContextFromEnv()`), distinct from the span payload:
a journal consumer joins records into the parent trace by these ids
without parsing spans. Restored records keep their persisted identity.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### SubmitInput

**`Experimental`**

#### Type Parameters

##### Args

`Args` *extends* [`DelegationArgs`](#delegationargs)

#### Properties

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

**`Experimental`**

##### args

> **args**: `Args`

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

**`Experimental`**

Records the detached-run resume key on the new record. The submitted
`run` function still executes in-process exactly as without it — the
ref only matters after a restart, when `DelegationTaskQueue.restore`
hands it to the `resumeDelegate` seam instead of failing the record.

##### run

> **run**: (`ctx`) => `Promise`\<[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

**`Experimental`**

Runs the underlying delegation. The queue passes a fresh `AbortSignal`
and a `report` channel for incremental progress updates. The function
MUST resolve with the typed `DelegationResultPayload['output']`; the
queue wraps it with the profile tag.

###### Parameters

###### ctx

[`DelegationRunContext`](#delegationruncontext)

###### Returns

`Promise`\<[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

***

### DelegationRunContext

**`Experimental`**

Context handed to a `SubmitInput.run` function.

#### Properties

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

**`Experimental`**

The `detachedSessionRef` recorded at submit, when one was supplied.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

**`Experimental`**

Per-delegation loop-trace sink, always provided by the queue. Events
emitted here are journaled onto the record as a compact span tree
(`record.trace`) when each loop run ends and at the delegation's
terminal transition. Delegates forward it into their `runAgentRounds` ctx,
composed with any process-wide OTEL emitter
(`composeLoopTraceEmitters`). Optional in the type so consumer-built
contexts stay source-compatible.

#### Methods

##### report()

> **report**(`progress`): `void`

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()

> **updateDetachedSessionRef**(`ref`): `void`

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

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### reused

> **reused**: `boolean`

**`Experimental`**

True when a prior matching `idempotencyKey` returned an existing record.

***

### DelegationResumeContext

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

Fired by `cancel(taskId)`; the driver should stop the remote run when it can.

#### Methods

##### report()

> **report**(`progress`): `void`

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DelegationResumeDriver

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

**`Experimental`**

Delay between `running` ticks, in milliseconds. Default 5000.

#### Methods

##### tick()

> **tick**(`task`, `ctx`): `Promise`\<[`DelegationResumeTick`](#delegationresumetick)\>

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

**`Experimental`**

#### Properties

##### generateId?

> `optional` **generateId?**: () => `string`

**`Experimental`**

ID generator override; default `randomTaskId`.

###### Returns

`string`

##### now?

> `optional` **now?**: () => `string`

**`Experimental`**

Clock override; default `() => new Date().toISOString()`.

###### Returns

`string`

##### store?

> `optional` **store?**: [`DelegationStore`](#delegationstore)

**`Experimental`**

Journal for record mutations and the `restore()` load source. Default
`InMemoryDelegationStore` — observably identical to an unjournaled
queue. Pass a `FileDelegationStore` through
`DelegationTaskQueue.restore` for state that survives a restart;
constructing with `new` never loads prior state.

##### resumeDelegate?

> `optional` **resumeDelegate?**: [`DelegationResumeDriver`](#delegationresumedriver)

**`Experimental`**

Resume seam for restored in-flight records that carry a `detachedSessionRef`.

##### maxTerminalRecords?

> `optional` **maxTerminalRecords?**: `number`

**`Experimental`**

Maximum number of terminal (completed | failed | cancelled) records
retained; the oldest (by `completedAt`) are evicted from memory and
store once the cap is exceeded. Default unbounded.

##### onPersistError?

> `optional` **onPersistError?**: (`error`) => `void`

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

**`Experimental`**

Inherited trace identity stamped on every submitted record
(`traceId` / `parentSpanId`). The bin passes
`readTraceContextFromEnv()` so journal consumers can join delegation
records into the caller's trace. Restored records keep the identity
they were persisted with.

***

### StdioToolServerOptions

**`Experimental`**

#### Properties

##### serverName

> **serverName**: `string`

**`Experimental`**

Server display name surfaced via `initialize`.

##### serverVersion

> **serverVersion**: `string`

**`Experimental`**

Server version surfaced via `initialize`.

##### tools

> **tools**: readonly [`McpToolDescriptor`](#mcptooldescriptor)[]

**`Experimental`**

The tools to serve. Duplicate names throw — a silent shadow would hide a tool.

***

### StdioToolServer

**`Experimental`**

#### Properties

##### tools

> `readonly` **tools**: `ReadonlyMap`\<`string`, [`McpToolDescriptor`](#mcptooldescriptor)\>

**`Experimental`**

Tools currently registered, keyed by name.

#### Methods

##### handle()

> **handle**(`message`): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

**`Experimental`**

Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications).

###### Parameters

###### message

[`JsonRpcMessage`](#jsonrpcmessage)

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

##### serve()

> **serve**(`transport?`): `Promise`\<`void`\>

**`Experimental`**

Drive the server on a stdio-shaped transport until `stop()` is called.

###### Parameters

###### transport?

[`McpTransport`](#mcptransport)

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

**`Experimental`**

Stop a `serve` call. Subsequent requests are rejected.

###### Returns

`void`

***

### Check

One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is
 upgradeable to the full agentic factory; `lookFor` is the lens question the actor applies.

#### Properties

##### id

> `readonly` **id**: `string`

##### description

> `readonly` **description**: `string`

##### area

> `readonly` **area**: `string`

Coarse classification stamped on every finding this kind emits (the renderer groups by it).

##### version

> `readonly` **version**: `string`

##### lookFor

> `readonly` **lookFor**: `string`

The lens — what this analyst looks for in the trace.

***

### CheckRunnerOptions

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

##### routerKey

> **routerKey**: `string`

##### model

> **model**: `string`

##### chat?

> `optional` **chat?**: (`system`, `user`) => `Promise`\<`string`\>

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

A worker the driver has drained via `await_event`.

#### Properties

##### id

> `readonly` **id**: `string`

##### status

> `readonly` **status**: `"done"` \| `"down"`

##### score?

> `readonly` `optional` **score?**: `number`

##### valid?

> `readonly` `optional` **valid?**: `boolean`

##### outRef?

> `readonly` `optional` **outRef?**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

##### settledAt?

> `readonly` `optional` **settledAt?**: `number`

Epoch ms the ledger recorded this settlement — the resolution a progress-based stop rule
 needs to answer "how long since anything landed?" without inventing a timestamp at read
 time. Stamped when the cursor yields the settlement, not when a reader first looks.

***

### QuestionOption

#### Properties

##### label

> `readonly` **label**: `string`

##### tradeoff

> `readonly` **tradeoff**: `string`

***

### Question

#### Extended by

- [`QuestionRecord`](#questionrecord)

#### Properties

##### id

> `readonly` **id**: `string`

##### from

> `readonly` **from**: `string`

##### level

> `readonly` **level**: [`QuestionLevel`](#questionlevel)

##### question

> `readonly` **question**: `string`

##### reason

> `readonly` **reason**: `string`

##### urgency

> `readonly` **urgency**: [`QuestionUrgency`](#questionurgency)

##### options?

> `readonly` `optional` **options?**: readonly [`QuestionOption`](#questionoption)[]

***

### QuestionRecord

#### Extends

- [`Question`](#question)

#### Properties

##### id

> `readonly` **id**: `string`

###### Inherited from

[`Question`](#question).[`id`](#id-6)

##### from

> `readonly` **from**: `string`

###### Inherited from

[`Question`](#question).[`from`](#from)

##### level

> `readonly` **level**: [`QuestionLevel`](#questionlevel)

###### Inherited from

[`Question`](#question).[`level`](#level)

##### question

> `readonly` **question**: `string`

###### Inherited from

[`Question`](#question).[`question`](#question-1)

##### reason

> `readonly` **reason**: `string`

###### Inherited from

[`Question`](#question).[`reason`](#reason-4)

##### urgency

> `readonly` **urgency**: [`QuestionUrgency`](#questionurgency)

###### Inherited from

[`Question`](#question).[`urgency`](#urgency)

##### options?

> `readonly` `optional` **options?**: readonly [`QuestionOption`](#questionoption)[]

###### Inherited from

[`Question`](#question).[`options`](#options)

##### status

> `readonly` **status**: `"open"` \| `"answered"` \| `"deferred"` \| `"escalated"`

##### decision?

> `readonly` `optional` **decision?**: [`QuestionDecision`](#questiondecision)

##### openedAt

> `readonly` **openedAt**: `number`

***

### CoordinationToolsOptions

#### Properties

##### scope

> `readonly` **scope**: [`Scope`](runtime.md#scope-1)\<`unknown`\>

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

##### perWorker

> `readonly` **perWorker**: [`Budget`](runtime.md#budget-12)

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](runtime.md#analystregistry)

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

###### Parameters

###### event

[`CoordinationEvent`](runtime.md#coordinationevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### questionPolicy?

> `readonly` `optional` **questionPolicy?**: [`QuestionPolicy`](#questionpolicy)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
 hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
 and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
 the driver can still run lenses on demand via `run_analyst`). Requires `analysts`.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on how many workers may be LIVE (spawned but not yet settled) at once. `spawn_agent`
 counts the scope's non-terminal nodes and fails closed (`error: 'max-live-workers'`) BEFORE
 reserving from the pool when the cap is already met — a concurrency fence on top of the
 conserved-budget fence (the pool bounds total work; this bounds simultaneous work, e.g. live
 sandboxes/boxes). Omit or `<= 0` = no cap (the prior behavior; the pool stays the only fence).

##### awaitTimeoutMs?

> `readonly` `optional` **awaitTimeoutMs?**: `number`

Max wall-clock ms a single `await_event` call may block waiting on a live worker to settle
 before it returns a non-error `{ pending: true, live }` snapshot and lets the caller re-poll.
 The underlying `scope.next()` blocks for the WHOLE (multi-minute) worker run; over a remote MCP
 transport that block outlives the client's per-request timeout, so an unbounded await surfaces
 to the supervisor as a hard tool ERROR on every call — the exact failure that leaves it flying
 blind. Bounding the wait converts that error into a re-pollable liveness signal. The background
 drain keeps running, so a settlement that lands after the bound is published to the bus and
 pulled by the next call — nothing is lost. Omit = [DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS](runtime.md#default_await_event_timeout_ms); `<= 0`
 restores the prior UNBOUNDED block (only safe for in-process drivers with no transport timeout).

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](#workerwatchoptions)

OPT-IN: run the ONLINE detector panel over each spawned worker's live tool trace and raise a
`finding` on the bus the moment a detector fires — so the driver learns "this worker is
looping" mid-run, from `await_event`, instead of at settle.

This closes the `watchTrace` → `raiseFinding` wire whose own docstring already described it
("the seam an ONLINE detector uses to tell the driver 'this worker is looping/erroring' the
moment it happens") but which nothing connected. Workers whose executor exposes no
`traceSource` are simply not watched; nothing fails.

Omit = no online watching (the settle-time analysts are unaffected).

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

How long a worker may go without metered activity before `observe_agent` reports it as
`stalled`. A derived read at observation time, never a background watchdog — nothing is
killed or retried. Omit = the runtime default.

***

### WorkerWatchOptions

Online-detector wiring for spawned workers (`CoordinationToolsOptions.watchWorkers`).

#### Properties

##### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

Detector panel; omit for the default stuck-loop + error-streak pair.

##### maxFindingsPerWorker?

> `readonly` `optional` **maxFindingsPerWorker?**: `number`

Raise at most this many findings per worker, so one pathological worker cannot flood the
 driver's inbox with the same signal every span. Default 3; `<= 0` = unlimited.

***

### CoordinationTools

The supervisor-side toolbox returned by [createCoordinationTools](#createcoordinationtools): the MCP tool
descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
`raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
choice, steerable counterpart to the one-shot own-sandbox delegation MCP.

#### Properties

##### tools

> `readonly` **tools**: [`McpToolDescriptor`](#mcptooldescriptor)[]

#### Methods

##### isStopped()

> **isStopped**(): `boolean`

###### Returns

`boolean`

##### stopReason()

> **stopReason**(): `string` \| `undefined`

###### Returns

`string` \| `undefined`

##### settled()

> **settled**(): readonly [`SettledWorker`](#settledworker)[]

###### Returns

readonly [`SettledWorker`](#settledworker)[]

##### questions()

> **questions**(): readonly [`QuestionRecord`](#questionrecord)[]

###### Returns

readonly [`QuestionRecord`](#questionrecord)[]

##### history()

> **history**(): readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

##### stats()

> **stats**(): [`BusStats`](runtime.md#busstats)

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](runtime.md#busstats)

##### raiseFinding()

> **raiseFinding**(`finding`): `Promise`\<`void`\>

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

###### Parameters

###### finding

[`AnalystFindingEvent`](runtime.md#analystfindingevent)

###### Returns

`Promise`\<`void`\>

##### drainResolved()

> **drainResolved**(): `Promise`\<`number`\>

Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
calls this once its brain loop ends, so a delivered child the brain never awaited still
reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
nobody is left to read a finding, and analysts spend real compute). Returns the count.

###### Returns

`Promise`\<`number`\>

***

### DelegateFeedbackHandlerOptions

**`Experimental`**

#### Properties

##### queue

> **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

##### store

> **store**: [`FeedbackStore`](#feedbackstore)

**`Experimental`**

##### generateId?

> `optional` **generateId?**: () => `string`

**`Experimental`**

###### Returns

`string`

##### now?

> `optional` **now?**: () => `string`

**`Experimental`**

###### Returns

`string`

***

### DelegateUiAuditHandlerOptions

**`Experimental`**

#### Properties

##### queue

> **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

##### delegate

> **delegate**: [`UiAuditorDelegate`](#uiauditordelegate)

**`Experimental`**

##### estimateDurationMs?

> `optional` **estimateDurationMs?**: (`args`) => `number`

**`Experimental`**

###### Parameters

###### args

[`DelegateUiAuditArgs`](#delegateuiauditargs)

###### Returns

`number`

***

### DelegateArgs

Parsed `delegate` tool arguments.

#### Properties

##### intent

> **intent**: `string`

##### model?

> `optional` **model?**: `string`

##### runId?

> `optional` **runId?**: `string`

***

### DelegateHandlerOptions

**`Experimental`**

#### Properties

##### router

> **router**: [`RouterConfig`](runtime.md#routerconfig)

**`Experimental`**

The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained).

##### backend

> **backend**: [`ExecutorConfig`](runtime.md#executorconfig)

**`Experimental`**

WHERE the authored workers run. Required for `supervise()` to spawn anything.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

**`Experimental`**

The completion oracle the authored workers settle against (settled ⟺ delivered).

##### model?

> `optional` **model?**: `string`

**`Experimental`**

Default supervisor brain model when a call omits `model`.

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

**`Experimental`**

Restrict the run to this subset of models.

***

### DelegationHistoryHandlerOptions

**`Experimental`**

#### Properties

##### queue

> **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

***

### DelegationStatusHandlerOptions

**`Experimental`**

#### Properties

##### queue

> **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

**`Experimental`**

***

### TraceContext

#### Properties

##### traceId

> **traceId**: `string`

Trace id inherited from the parent process, or a fresh one.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Parent span id from the delegation that launched this MCP server.

***

### DelegateCodeConfig

**`Experimental`**

Minimal `CoderTask` overrides exposed over the MCP wire. The full
`CoderTask` carries fields the kernel synthesizes from `goal` +
`repoRoot` — the agent only edits the few that materially gate
validator behavior.

#### Properties

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

***

### DelegateCodeArgs

**`Experimental`**

#### Properties

##### goal

> **goal**: `string`

**`Experimental`**

Natural-language description of what the coder must accomplish.

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### contextHint?

> `optional` **contextHint?**: `string`

**`Experimental`**

Optional free-form context the agent surfaces in the prompt prelude.

##### variants?

> `optional` **variants?**: `number`

**`Experimental`**

When > 1, dispatches `multiHarnessCoderFanout` across N harnesses
(claude-code, codex, opencode-glm) and picks the highest-scoring
passing patch. Default 1.

##### config?

> `optional` **config?**: [`DelegateCodeConfig`](#delegatecodeconfig)

**`Experimental`**

Validator + prompt overrides the agent knows for this repo.

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id).

***

### DelegateCodeResult

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

**`Experimental`**

Best-effort hint — coder loops can take minutes-to-hours.

***

### DelegateResearchConfig

**`Experimental`**

#### Properties

##### recencyWindow?

> `optional` **recencyWindow?**: `object`

**`Experimental`**

###### since?

> `optional` **since?**: `string`

###### until?

> `optional` **until?**: `string`

##### maxItems?

> `optional` **maxItems?**: `number`

**`Experimental`**

##### minConfidence?

> `optional` **minConfidence?**: `number`

**`Experimental`**

***

### DelegateResearchArgs

**`Experimental`**

#### Properties

##### question

> **question**: `string`

**`Experimental`**

##### namespace

> **namespace**: `string`

**`Experimental`**

##### scope?

> `optional` **scope?**: `string`

**`Experimental`**

##### sources?

> `optional` **sources?**: [`ResearchSource`](#researchsource)[]

**`Experimental`**

##### variants?

> `optional` **variants?**: `number`

**`Experimental`**

##### config?

> `optional` **config?**: [`DelegateResearchConfig`](#delegateresearchconfig)

**`Experimental`**

***

### DelegateResearchResult

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

**`Experimental`**

***

### FeedbackRefersTo

**`Experimental`**

#### Properties

##### kind

> **kind**: `"artifact"` \| `"outcome"` \| `"delegation"`

**`Experimental`**

##### ref

> **ref**: `string`

**`Experimental`**

For `'delegation'`, this is the taskId.

***

### FeedbackRating

**`Experimental`**

#### Properties

##### score

> **score**: `number`

**`Experimental`**

[0, 1].

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

**`Experimental`**

##### notes

> **notes**: `string`

**`Experimental`**

***

### DelegateFeedbackArgs

**`Experimental`**

#### Properties

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

**`Experimental`**

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

**`Experimental`**

##### capturedAt?

> `optional` **capturedAt?**: `string`

**`Experimental`**

ISO timestamp; defaults to server clock when omitted.

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

***

### DelegateFeedbackResult

**`Experimental`**

#### Properties

##### recorded

> **recorded**: `true`

**`Experimental`**

##### id

> **id**: `string`

**`Experimental`**

***

### DelegationStatusArgs

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### includeTrace?

> `optional` **includeTrace?**: `boolean`

**`Experimental`**

Return the delegation's compact loop-trace span tree alongside the
status. Default false — status polls stay light; opt in when you need
the topology (which iterations ran, where they were placed, what each
cost) rather than just the state machine.

***

### DelegationProgress

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

**`Experimental`**

##### phase

> **phase**: `string`

**`Experimental`**

***

### DelegationError

**`Experimental`**

#### Properties

##### message

> **message**: `string`

**`Experimental`**

##### kind

> **kind**: `string`

**`Experimental`**

***

### UiAuditorDelegationOutput

**`Experimental`**

Wire-shape of a completed UI-audit delegation. The `findings` array
contains every finding persisted to the workspace during the run,
already enriched with `id` and `createdAt` by the writer. `workspaceDir`
is the absolute path to the workspace; `indexFile` is the workspace-
relative path to the regenerated index.md.

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

**`Experimental`**

##### indexFile

> **indexFile**: `string`

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](profiles.md#uifinding)[]

**`Experimental`**

##### iterations

> **iterations**: `number`

**`Experimental`**

Total iterations the loop ran for this delegation.

***

### DelegateUiAuditRoute

Optional per-route capture spec the agent surfaces over the wire.

#### Properties

##### name

> **name**: `string`

Stable route name (used in screenshot filenames + finding metadata).

##### url

> **url**: `string`

Fully-qualified URL.

##### viewports?

> `optional` **viewports?**: readonly `object`[]

Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`.

##### fullPage?

> `optional` **fullPage?**: `boolean`

Default false. Full-page captures for the broad lenses.

##### waitFor?

> `optional` **waitFor?**: `string`

Selector to wait for before capture.

***

### DelegateUiAuditConfig

**`Experimental`**

#### Properties

##### lenses?

> `optional` **lenses?**: [`UiAuditLensFilter`](#uiauditlensfilter)

**`Experimental`**

Lenses to iterate. Default: every lens except `'other'`. Order is
preserved — the driver iterates lens-by-lens.

##### maxIterations?

> `optional` **maxIterations?**: `number`

**`Experimental`**

Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes).

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

**`Experimental`**

Maximum concurrent iterations within a single plan() round. Default 2.

##### productContext?

> `optional` **productContext?**: `string`

**`Experimental`**

Free-form product context surfaced to the judge.

***

### DelegateUiAuditArgs

**`Experimental`**

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

**`Experimental`**

Workspace root for the audit (absolute path).

##### routes

> **routes**: readonly [`DelegateUiAuditRoute`](#delegateuiauditroute)[]

**`Experimental`**

Routes to audit. Must be non-empty.

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

Multi-tenant scope.

##### config?

> `optional` **config?**: [`DelegateUiAuditConfig`](#delegateuiauditconfig)

**`Experimental`**

***

### DelegateUiAuditResult

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

**`Experimental`**

***

### ResearchOutputShape

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

**`Experimental`**

##### citations

> **citations**: `unknown`[]

**`Experimental`**

##### proposedWrites

> **proposedWrites**: `unknown`[]

**`Experimental`**

##### gaps?

> `optional` **gaps?**: `string`[]

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

**`Experimental`**

***

### DelegationStatusResult

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

**`Experimental`**

##### startedAt

> **startedAt**: `string`

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

**`Experimental`**

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

**`Experimental`**

Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### DelegationHistoryArgs

**`Experimental`**

#### Properties

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

##### profile?

> `optional` **profile?**: [`DelegationProfile`](#delegationprofile)

**`Experimental`**

##### since?

> `optional` **since?**: `string`

**`Experimental`**

ISO date — only delegations started at-or-after `since` are returned.

##### limit?

> `optional` **limit?**: `number`

**`Experimental`**

Default 50. Hard cap 500.

***

### DelegationFeedbackSnapshot

**`Experimental`**

#### Properties

##### id

> **id**: `string`

**`Experimental`**

##### score

> **score**: `number`

**`Experimental`**

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

**`Experimental`**

##### notes

> **notes**: `string`

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

**`Experimental`**

***

### DelegationHistoryEntry

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

##### args

> **args**: [`DelegateCodeArgs`](#delegatecodeargs) \| [`DelegateUiAuditArgs`](#delegateuiauditargs) \| [`DelegateResearchArgs`](#delegateresearchargs)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

**`Experimental`**

##### feedback?

> `optional` **feedback?**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

**`Experimental`**

##### startedAt

> **startedAt**: `string`

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

**`Experimental`**

##### hasTrace

> **hasTrace**: `boolean`

**`Experimental`**

True when the record carries a journaled loop trace. History stays
light by design — fetch the spans via
`delegation_status { taskId, includeTrace: true }`.

##### traceId?

> `optional` **traceId?**: `string`

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

***

### DelegationHistoryResult

**`Experimental`**

#### Properties

##### delegations

> **delegations**: [`DelegationHistoryEntry`](#delegationhistoryentry)[]

**`Experimental`**

***

### WorktreeHandle

**`Experimental`**

#### Properties

##### path

> **path**: `string`

**`Experimental`**

Absolute path to the worktree directory.

##### baseSha

> **baseSha**: `string`

**`Experimental`**

SHA the worktree was created at.

##### branch

> **branch**: `string`

**`Experimental`**

Branch name created for this worktree (typically `delegate/<runId>`).

***

### CreateWorktreeOptions

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path to the main git checkout.

##### runId

> **runId**: `string`

**`Experimental`**

Unique id for the worktree path + branch. Use the delegation run id.

##### variantsDir?

> `optional` **variantsDir?**: `string`

**`Experimental`**

Parent directory the worktree lives under. Defaults to `.agent-worktrees`.

##### baseRef?

> `optional` **baseRef?**: `string`

**`Experimental`**

Override the base ref (default `HEAD`).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

**`Experimental`**

Test seam — inject a custom git runner.

***

### DiffOptions

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

**`Experimental`**

Worktree to diff.

##### baseRef?

> `optional` **baseRef?**: `string`

**`Experimental`**

What to compare against. Default `worktree.baseSha`.

##### excludePaths?

> `optional` **excludePaths?**: readonly `string`[]

**`Experimental`**

Repository-relative input paths to omit from the captured worker patch.
Paths are passed to Git with literal exclusion magic, so profile-provided
`*`, `?`, `[` and `:` characters can never expand into broader pathspecs.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

**`Experimental`**

Test seam.

***

### DiffResult

**`Experimental`**

#### Properties

##### patch

> **patch**: `string`

**`Experimental`**

##### stats

> **stats**: `object`

**`Experimental`**

###### filesChanged

> **filesChanged**: `number`

###### insertions

> **insertions**: `number`

###### deletions

> **deletions**: `number`

***

### RemoveWorktreeOptions

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

**`Experimental`**

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

##### force?

> `optional` **force?**: `boolean`

**`Experimental`**

Force removal even if dirty (default true; the loser of a fanout has uncommitted changes).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

**`Experimental`**

Test seam.

## Type Aliases

### CoderDelegate

> **CoderDelegate** = (`args`, `ctx`) => `Promise`\<[`CoderOutput`](#coderoutput)\>

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

`Promise`\<[`CoderOutput`](#coderoutput)\>

***

### UiAuditorDelegate

> **UiAuditorDelegate** = (`args`, `ctx`) => `Promise`\<[`UiAuditorDelegationOutput`](#uiauditordelegationoutput)\>

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

**`Experimental`**

Optional adversarial reviewer over a coder candidate that already passed
mechanical validation (tests/typecheck/forbidden/diff/no-op/secrets). Folded
from the ai-trading-blueprint delegation MCP: a candidate is only eligible to
win if the reviewer approves it. The reviewer is the consumer's seam — an LLM
judge, a `pnpm review` command, anything returning a `CoderReview`.

#### Parameters

##### output

[`CoderOutput`](#coderoutput)

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

**`Experimental`**

Winner-selection strategy among validated (+ reviewed) candidates on the
sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
`first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
reviewer-only strategy this path keeps that the generic selector does not express. Default
`highest-score`.

***

### DriveTurnTick

> **DriveTurnTick** = \{ `state`: `"completed"`; `text`: `string`; `result`: `Record`\<`string`, `unknown`\>; \} \| \{ `state`: `"running"`; `startedAt?`: `Date`; `elapsedMs?`: `number`; \} \| \{ `state`: `"failed"`; `error`: `string`; \}

**`Experimental`**

Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
Discriminated on `state`; `failed` is terminal and deterministic per the
SDK contract — re-invoking with the same ids returns the same outcome.

***

### ~~StdioToolDescriptor~~

> **StdioToolDescriptor** = [`McpToolDescriptor`](#mcptooldescriptor)

#### Deprecated

Use `McpToolDescriptor`; both names are the same protocol contract.

***

### LocalHarness

> **LocalHarness** = `"claude"` \| `"codex"` \| `"opencode"`

Local coding harness available inside the sandbox.

***

### DelegationArgs

> **DelegationArgs** = [`DelegateCodeArgs`](#delegatecodeargs) \| [`DelegateResearchArgs`](#delegateresearchargs) \| [`DelegateUiAuditArgs`](#delegateuiauditargs)

**`Experimental`**

Arguments accepted by the durable delegation queue.

***

### DelegationResumeTick

> **DelegationResumeTick** = \{ `state`: `"running"`; \} \| \{ `state`: `"completed"`; `output`: [`DelegationResultPayload`](#delegationresultpayload)\[`"output"`\]; `costUsd?`: `number`; \} \| \{ `state`: `"failed"`; `error`: [`DelegationError`](#delegationerror); \}

**`Experimental`**

One observation of a detached run, mapped 1:1 from a single-tick driver
(e.g. the sandbox SDK's `driveTurn`, which reports
completed | running | failed per pass). `running` schedules another tick
after `intervalMs`; `completed` / `failed` settle the record.

***

### QuestionLevel

> **QuestionLevel** = `"worker"` \| `"driver"` \| `"loop"`

***

### QuestionUrgency

> **QuestionUrgency** = `"continue-without"` \| `"blocks-step"` \| `"blocks-run"`

***

### QuestionDecision

> **QuestionDecision** = \{ `kind`: `"answer"`; `answer`: `string`; `by`: `string`; \} \| \{ `kind`: `"defer"`; `reason`: `string`; \} \| \{ `kind`: `"escalate"`; `to`: `"parent"` \| `"user"` \| `string`; `reason`: `string`; \}

***

### QuestionPolicy

> **QuestionPolicy** = `"auto"` \| `"mustDecide"` \| `"bubble"` \| `"failClosed"`

***

### DelegateResult

> **DelegateResult** = \{ `status`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \} \| \{ `status`: `"no-winner"`; `reason`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \}

The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 the no-winner reason) PLUS the conserved spend of the whole delegation.

***

### DelegationProfile

> **DelegationProfile** = `"coder"` \| `"researcher"` \| `"ui-auditor"`

**`Experimental`**

***

### DelegationStatus

> **DelegationStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

**`Experimental`**

***

### ResearchSource

> **ResearchSource** = `"web"` \| `"corpus"` \| `"twitter"` \| `"github"` \| `"docs"`

**`Experimental`**

***

### DelegationResultPayload

> **DelegationResultPayload** = \{ `profile`: `"coder"`; `output`: [`CoderOutput`](#coderoutput); \} \| \{ `profile`: `"researcher"`; `output`: [`ResearchOutputShape`](#researchoutputshape); \} \| \{ `profile`: `"ui-auditor"`; `output`: [`UiAuditorDelegationOutput`](#uiauditordelegationoutput); \}

**`Experimental`**

Polymorphic `result` field: `CoderOutput` when the underlying profile
is `'coder'`, a structurally-typed research output when `'researcher'`.
The MCP wire carries it as JSON either way.

***

### UiAuditLensFilter

> **UiAuditLensFilter** = readonly [`UiLens`](profiles.md#uilens)[]

**`Experimental`**

***

### GitRunner

> **GitRunner** = (`args`, `opts`) => `object`

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

**`Experimental`**

Default cap on spans retained per delegation record.

***

### DELEGATION\_TRACE\_MAX\_BYTES

> `const` **DELEGATION\_TRACE\_MAX\_BYTES**: `number`

**`Experimental`**

Default cap on the serialized trace payload per record, in bytes.

***

### MEMORY\_FILE\_ENV

> `const` **MEMORY\_FILE\_ENV**: `"AGENT_MEMORY_FILE"` = `'AGENT_MEMORY_FILE'`

Env var naming the durable row store file the memory bin loads (the
 `memoryMcpServer` ↔ memory-bin contract).

***

### MEMORY\_ITEMS\_ENV

> `const` **MEMORY\_ITEMS\_ENV**: `"AGENT_MEMORY_ITEMS"` = `'AGENT_MEMORY_ITEMS'`

Env var carrying inline JSON `MemoryItem` rows (win over file rows on id).

***

### MEMORY\_LOG\_ENV

> `const` **MEMORY\_LOG\_ENV**: `"AGENT_MEMORY_LOG"` = `'AGENT_MEMORY_LOG'`

Env var naming the JSONL retrieval log (one row per `memory_search`).

***

### MEMORY\_NAME\_ENV

> `const` **MEMORY\_NAME\_ENV**: `"AGENT_MEMORY_NAME"` = `'AGENT_MEMORY_NAME'`

Env var overriding the served display name (default 'agent-memory').

***

### defaultChecks

> `const` **defaultChecks**: `Record`\<`string`, [`Check`](#check)\>

The built-in lens directory. Domain-blind (about any agent trace); compose at test time.

***

### DELEGATE\_FEEDBACK\_TOOL\_NAME

> `const` **DELEGATE\_FEEDBACK\_TOOL\_NAME**: `"delegate_feedback"` = `'delegate_feedback'`

**`Experimental`**

MCP tool name for the `delegate_feedback` feedback-recording tool.

***

### DELEGATE\_FEEDBACK\_DESCRIPTION

> `const` **DELEGATE\_FEEDBACK\_DESCRIPTION**: `string`

**`Experimental`**

Human-readable description of the `delegate_feedback` MCP tool, injected into the tool manifest.

***

### DELEGATE\_FEEDBACK\_INPUT\_SCHEMA

> `const` **DELEGATE\_FEEDBACK\_INPUT\_SCHEMA**: `object`

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

**`Experimental`**

MCP tool name for the `delegate_ui_audit` async kickoff tool.

***

### DELEGATE\_UI\_AUDIT\_DESCRIPTION

> `const` **DELEGATE\_UI\_AUDIT\_DESCRIPTION**: `string`

**`Experimental`**

Human-readable description of the `delegate_ui_audit` MCP tool, injected into the tool manifest.

***

### DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA

> `const` **DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA**: `object`

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

**`Experimental`**

MCP tool name for the `delegate` generic-delegation tool.

***

### DELEGATE\_DESCRIPTION

> `const` **DELEGATE\_DESCRIPTION**: `string`

**`Experimental`**

Human-readable description of the `delegate` MCP tool, injected into the tool manifest.

***

### DELEGATE\_INPUT\_SCHEMA

> `const` **DELEGATE\_INPUT\_SCHEMA**: `object`

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

**`Experimental`**

MCP tool name for the `delegation_history` read-past-delegations tool.

***

### DELEGATION\_HISTORY\_DESCRIPTION

> `const` **DELEGATION\_HISTORY\_DESCRIPTION**: `string`

**`Experimental`**

Human-readable description of the `delegation_history` MCP tool, injected into the tool manifest.

***

### DELEGATION\_HISTORY\_INPUT\_SCHEMA

> `const` **DELEGATION\_HISTORY\_INPUT\_SCHEMA**: `object`

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

**`Experimental`**

MCP tool name for the `delegation_status` synchronous-poll tool.

***

### DELEGATION\_STATUS\_DESCRIPTION

> `const` **DELEGATION\_STATUS\_DESCRIPTION**: `string`

**`Experimental`**

Human-readable description of the `delegation_status` MCP tool, injected into the tool manifest.

***

### DELEGATION\_STATUS\_INPUT\_SCHEMA

> `const` **DELEGATION\_STATUS\_INPUT\_SCHEMA**: `object`

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

**`Experimental`**

Build the sandbox-session coder delegate. It drives `runAgentRounds` against the project's
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

> **settleDetachedCoderTurn**(`turn`, `options`): `Promise`\<[`CoderOutput`](#coderoutput)\>

**`Experimental`**

Settle a completed detached coder turn through the same gate the streaming
path applies: parse the terminal payload with the coder output adapter,
run the mechanical validator (tests/typecheck/forbidden/diff/no-op/secrets),
then the optional reviewer. Throws when nothing survives — a resumed or
detached run must not return an unvalidated patch.

SCOPE NOTE (detached/resume): the detached `driveTurn`-tick + cross-restart resume path is
bound to the `runAgentRounds` + sandbox-session substrate. The recursive `Scope`/worktree-CLI leaf has
journal→replay but no driveTurn-over-a-detached-sandbox-session equivalent yet, so resume is NOT
advertised on the generic `worktreeFanout` path. This helper (with `coderTaskFromArgs` and
`createDetachedTurnResumeDriver`) stays as the resume seam `bin.ts` wires for in-flight records.

#### Parameters

##### turn

[`DetachedTurn`](#detachedturn)

##### options

[`SettleDetachedCoderTurnOptions`](#settledetachedcoderturnoptions)

#### Returns

`Promise`\<[`CoderOutput`](#coderoutput)\>

***

### buildDelegationTraceSpans()

> **buildDelegationTraceSpans**(`events`): [`DelegationTraceSpan`](#delegationtracespan)[]

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

#### Parameters

##### options

[`RunLocalHarnessOptions`](#runlocalharnessoptions)

#### Returns

`Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

***

### parseCodexTokenUsage()

> **parseCodexTokenUsage**(`stdout`): [`CodexTokenUsage`](#codextokenusage)

Parse and validate the one terminal usage event emitted by `codex exec --json`.

#### Parameters

##### stdout

`string`

#### Returns

[`CodexTokenUsage`](#codextokenusage)

***

### createMemoryToolServer()

> **createMemoryToolServer**(`opts`): [`StdioToolServer`](#stdiotoolserver)

Build the memory MCP server: `memory_search` (lexical top-k over the rows)
and `memory_get` (one row by id) on the generic stdio JSON-RPC core.

#### Parameters

##### opts

[`CreateMemoryToolServerOptions`](#creatememorytoolserveroptions)

#### Returns

[`StdioToolServer`](#stdiotoolserver)

***

### parseMemoryItems()

> **parseMemoryItems**(`value`, `source`): [`MemoryItem`](#memoryitem)[]

Coerce an untrusted JSON array into validated `MemoryItem` rows.

#### Parameters

##### value

`unknown`

##### source

`string`

#### Returns

[`MemoryItem`](#memoryitem)[]

***

### readMemoryItemsFile()

> **readMemoryItemsFile**(`path`): [`MemoryItem`](#memoryitem)[]

Read a memory store file: a JSON array, or JSONL (one `MemoryItem` per line).

#### Parameters

##### path

`string`

#### Returns

[`MemoryItem`](#memoryitem)[]

***

### resolveMemoryFromEnv()

> **resolveMemoryFromEnv**(`env`): [`ResolvedMemoryEnv`](#resolvedmemoryenv)

Resolve the bin's memory from `AGENT_MEMORY_FILE` (durable store) and/or
`AGENT_MEMORY_ITEMS` (inline JSON rows; wins on id collision). Zero rows is
a boot FAILURE, matching the fail-closed materialization discipline.

#### Parameters

##### env

`Record`\<`string`, `string` \| `undefined`\>

#### Returns

[`ResolvedMemoryEnv`](#resolvedmemoryenv)

***

### createMcpServer()

> **createMcpServer**(`options?`): [`McpServer`](#mcpserver)

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

**`Experimental`**

Best-effort stable hash for use as `idempotencyKey`. Not cryptographic;
collisions only affect dedupe, never correctness.

#### Parameters

##### value

`unknown`

#### Returns

`string`

***

### createStdioToolServer()

> **createStdioToolServer**(`options`): [`StdioToolServer`](#stdiotoolserver)

Build the generic stdio JSON-RPC tool server.

#### Parameters

##### options

[`StdioToolServerOptions`](#stdiotoolserveroptions)

#### Returns

[`StdioToolServer`](#stdiotoolserver)

***

### liftFindings()

> **liftFindings**(`kind`, `rows`, `producedAt`): `AnalystFinding`[]

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

Build the driver's MCP tools over a live scope.

#### Parameters

##### opts

[`CoordinationToolsOptions`](#coordinationtoolsoptions)

#### Returns

[`CoordinationTools`](#coordinationtools)

***

### validateDelegateFeedbackArgs()

> **validateDelegateFeedbackArgs**(`raw`): [`DelegateFeedbackArgs`](#delegatefeedbackargs)

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

**`Experimental`**

Build the MCP tool handler that persists feedback events and attaches them to delegation records.

#### Parameters

##### options

[`DelegateFeedbackHandlerOptions`](#delegatefeedbackhandleroptions)

#### Returns

(`raw`) => `Promise`\<[`DelegateFeedbackResult`](#delegatefeedbackresult)\>

***

### validateDelegateUiAuditArgs()

> **validateDelegateUiAuditArgs**(`raw`): [`DelegateUiAuditArgs`](#delegateuiauditargs)

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

**`Experimental`**

Build the MCP tool handler that validates input, deduplicates via idempotency key, and enqueues a UI audit.

#### Parameters

##### options

[`DelegateUiAuditHandlerOptions`](#delegateuiaudithandleroptions)

#### Returns

(`raw`) => `Promise`\<[`DelegateUiAuditResult`](#delegateuiauditresult)\>

***

### validateDelegateArgs()

> **validateDelegateArgs**(`raw`): [`DelegateArgs`](#delegateargs)

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

**`Experimental`**

Build the MCP tool handler that reads filtered past delegations from a `DelegationTaskQueue`.

#### Parameters

##### options

[`DelegationHistoryHandlerOptions`](#delegationhistoryhandleroptions)

#### Returns

(`raw`) => `Promise`\<[`DelegationHistoryResult`](#delegationhistoryresult)\>

***

### validateDelegationStatusArgs()

> **validateDelegationStatusArgs**(`raw`): [`DelegationStatusArgs`](#delegationstatusargs)

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

**`Experimental`**

Build the MCP tool handler that polls a `DelegationTaskQueue` for task status.

#### Parameters

##### options

[`DelegationStatusHandlerOptions`](#delegationstatushandleroptions)

#### Returns

(`raw`) => `Promise`\<[`DelegationStatusResult`](#delegationstatusresult)\>

***

### readTraceContextFromEnv()

> **readTraceContextFromEnv**(): [`TraceContext`](#tracecontext-2)

Read trace context from the process environment.
Returns a context with inherited ids or a freshly generated root.

#### Returns

[`TraceContext`](#tracecontext-2)

***

### createPropagatingTraceEmitter()

> **createPropagatingTraceEmitter**(`ctx`): `object`

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

**`Experimental`**

Stage worker changes and return the diff + shortstat, excluding declared input paths.

#### Parameters

##### options

[`DiffOptions`](#diffoptions)

#### Returns

`Promise`\<[`DiffResult`](#diffresult)\>

***

### removeWorktree()

> **removeWorktree**(`options`): `Promise`\<`void`\>

**`Experimental`**

Remove a git worktree and delete its branch. Already-removed paths are harmless; every other
Git failure rejects so callers cannot report a worktree as destroyed when cleanup failed.

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

### AnalystFindingEvent

Re-exports [AnalystFindingEvent](runtime.md#analystfindingevent)

***

### AnalystRegistry

Re-exports [AnalystRegistry](runtime.md#analystregistry)

***

### CoordinationEvent

Re-exports [CoordinationEvent](runtime.md#coordinationevent)

***

### DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS

Re-exports [DEFAULT_AWAIT_EVENT_TIMEOUT_MS](runtime.md#default_await_event_timeout_ms)

***

### DownMessageEvent

Re-exports [DownMessageEvent](runtime.md#downmessageevent)

***

### MakeWorkerAgent

Re-exports [MakeWorkerAgent](runtime.md#makeworkeragent)
