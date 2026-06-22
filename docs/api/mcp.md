[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / mcp

# mcp

## Classes

### DelegationStateCorruptError

Defined in: [mcp/delegation-store.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L54)

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

Defined in: [mcp/delegation-store.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L55)

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

Defined in: [mcp/delegation-store.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L68)

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

Defined in: [mcp/delegation-store.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L69)

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

Defined in: [mcp/delegation-store.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L75)

**`Experimental`**

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

Defined in: [mcp/delegation-store.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L78)

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

Defined in: [mcp/delegation-store.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L82)

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

Defined in: [mcp/delegation-store.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L86)

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

Defined in: [mcp/delegation-store.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L93)

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

Defined in: [mcp/delegation-store.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L130)

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

Defined in: [mcp/delegation-store.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L138)

**`Experimental`**

###### Parameters

###### options

[`FileDelegationStoreOptions`](#filedelegationstoreoptions)

###### Returns

[`FileDelegationStore`](#filedelegationstore)

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Defined in: [mcp/delegation-store.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L143)

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

Defined in: [mcp/delegation-store.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L180)

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

Defined in: [mcp/delegation-store.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L186)

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

Defined in: [mcp/delegation-store.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L194)

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

Defined in: [mcp/task-queue.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L242)

**`Experimental`**

#### Constructors

##### Constructor

> **new DelegationTaskQueue**(`options?`): [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/task-queue.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L256)

**`Experimental`**

###### Parameters

###### options?

[`DelegationTaskQueueOptions`](#delegationtaskqueueoptions) = `{}`

###### Returns

[`DelegationTaskQueue`](#delegationtaskqueue)

#### Methods

##### restore()

> `static` **restore**(`options?`): `Promise`\<[`DelegationTaskQueue`](#delegationtaskqueue)\>

Defined in: [mcp/task-queue.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L292)

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

Defined in: [mcp/task-queue.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L305)

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

Defined in: [mcp/task-queue.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L355)

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

Defined in: [mcp/task-queue.ts:368](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L368)

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

Defined in: [mcp/task-queue.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L388)

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

Defined in: [mcp/task-queue.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L400)

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

Defined in: [mcp/task-queue.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L419)

**`Experimental`**

Await every journal write issued so far. Rejects with the recorded
`DelegationPersistenceError` when any of them failed. Call before
handing the store's backing file to another process.

###### Returns

`Promise`\<`void`\>

##### inflightCount()

> **inflightCount**(): `number`

Defined in: [mcp/task-queue.ts:435](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L435)

**`Experimental`**

Test-only — number of in-flight (non-terminal) records.

###### Returns

`number`

## Interfaces

### DetectExecutorArgs

Defined in: [mcp/bin-helpers.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L20)

**`Experimental`**

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [mcp/bin-helpers.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L21)

**`Experimental`**

##### env?

> `optional` **env?**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [mcp/bin-helpers.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L23)

**`Experimental`**

Raw env (defaults to `process.env`). Pass an explicit map for tests.

##### resolveFleet?

> `optional` **resolveFleet?**: (`client`, `fleetId`) => `Promise`\<[`FleetHandle`](#fleethandle)\>

Defined in: [mcp/bin-helpers.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L29)

**`Experimental`**

Override how a fleet handle is resolved from the client + fleet id. The
default reads `client.fleets.get(fleetId)` and validates the returned
shape against the structural `FleetHandle` contract.

###### Parameters

###### client

[`SandboxClient`](runtime.md#sandboxclient-1)

###### fleetId

`string`

###### Returns

`Promise`\<[`FleetHandle`](#fleethandle)\>

***

### DelegateRunCtx

Defined in: [mcp/delegates.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L56)

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L57)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/delegates.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L65)

**`Experimental`**

Detached-run resume key recorded on the queue record at submit time
(`formatDetachedSessionRef`). Present only when the submit path requested
detached dispatch — its presence is what routes a session-backed delegate
onto the `driveTurn` tick path instead of holding a stream.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegates.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L74)

**`Experimental`**

Per-delegation trace sink supplied by the queue — loop events emitted
here land on the delegation record as a compact span tree. Delegates
compose it with their configured OTEL emitter so both sinks observe
the same stream.

#### Methods

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/delegates.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L58)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()?

> `optional` **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/delegates.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L67)

**`Experimental`**

Rebind the record's resume key (e.g. once the sandbox id is known).

###### Parameters

###### ref

`string`

###### Returns

`void`

***

### CoderReview

Defined in: [mcp/delegates.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L97)

**`Experimental`**

Structured review verdict over a coder candidate.

#### Properties

##### approved

> **approved**: `boolean`

Defined in: [mcp/delegates.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L99)

**`Experimental`**

Gate: only approved candidates are eligible to win.

##### recommendation

> **recommendation**: `"ship"` \| `"approve-with-nits"` \| `"changes-requested"` \| `"reject"`

Defined in: [mcp/delegates.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L101)

**`Experimental`**

Reviewer's recommendation — surfaced in traces.

##### readiness

> **readiness**: `number`

Defined in: [mcp/delegates.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L103)

**`Experimental`**

Readiness 0..1, used by the `highest-readiness` winner-selection strategy.

##### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/delegates.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L104)

**`Experimental`**

***

### DetachedSessionDelegateOptions

Defined in: [mcp/delegates.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L136)

**`Experimental`**

#### Properties

##### executor?

> `optional` **executor?**: [`DelegationExecutor`](#delegationexecutor)

Defined in: [mcp/delegates.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L143)

**`Experimental`**

Execution placement. Pass a [DelegationExecutor](#delegationexecutor) (sibling or fleet)
to control where worker iterations land. `sandboxClient` is a
convenience shorthand that wraps the client in a sibling executor — pass
one or the other, not both.

##### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [mcp/delegates.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L148)

**`Experimental`**

Convenience shorthand for sibling placement. Equivalent to
`executor: createSiblingSandboxExecutor({ client: sandboxClient })`.

##### workerProfile?

> `optional` **workerProfile?**: `AgentProfile`

Defined in: [mcp/delegates.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L156)

**`Experimental`**

The worker's authored `AgentProfile` (§1.5: the system authors profiles). Spread onto the
sandbox-session run spec → `runLoop` → the executor's `harnessInvocation`, so the harness runs
under the caller's stance. Omit to use a minimal model-only default (no hardcoded skills/tools);
`harness` / `model` / `systemPrompt` below are convenience overrides layered onto whichever
profile is used.

##### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L158)

**`Experimental`**

Backend harness for the single-coder path (sets `metadata.backendType`). Default `claude-code`.

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L160)

**`Experimental`**

Model override for the single-coder path.

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [mcp/delegates.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L166)

**`Experimental`**

The worker's authored system prompt (§1.5). Flows onto the run spec's
`profile.prompt.systemPrompt` → through `runLoop` → the executor's `harnessInvocation`, so the
harness runs under this stance. Omit to keep the profile's own prompt.

##### fanoutHarnesses?

> `optional` **fanoutHarnesses?**: `string`[]

Defined in: [mcp/delegates.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L168)

**`Experimental`**

Default `['claude-code', 'codex', 'opencode/zai-coding-plan/glm-5.1']` when variants > 1.

##### fanoutModels?

> `optional` **fanoutModels?**: (`string` \| `undefined`)[]

Defined in: [mcp/delegates.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L170)

**`Experimental`**

Optional per-harness model override for `variants > 1`.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/delegates.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L172)

**`Experimental`**

Hard cap on the kernel's per-batch concurrency. Default 4.

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

Defined in: [mcp/delegates.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L179)

**`Experimental`**

Optional adversarial reviewer. When set, a candidate must pass mechanical
validation AND `reviewer.approved` to be eligible to win — empty/secret/
test-failing patches are already gone; this catches the "compiles + passes
but wrong/unsafe" class the deterministic validator can't see.

##### winnerSelection?

> `optional` **winnerSelection?**: [`DetachedWinnerSelection`](#detachedwinnerselection)

Defined in: [mcp/delegates.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L181)

**`Experimental`**

Winner-selection strategy among eligible candidates. Default `highest-score`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegates.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L193)

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

Defined in: [mcp/delegates.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L195)

**`Experimental`**

Tick cadence (ms) for the detached single-variant path. Default 5000.

##### detachedWallCapMs?

> `optional` **detachedWallCapMs?**: `number`

Defined in: [mcp/delegates.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L197)

**`Experimental`**

Wall-clock cap (ms) forwarded to `driveTurn` for detached turns.

***

### SettleDetachedCoderTurnOptions

Defined in: [mcp/delegates.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L438)

**`Experimental`**

#### Properties

##### task

> **task**: [`CoderTask`](profiles.md#codertask)

Defined in: [mcp/delegates.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L439)

**`Experimental`**

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/delegates.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L441)

**`Experimental`**

Session id of the detached turn — used as the synthesized event id.

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/delegates.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L442)

**`Experimental`**

##### harness?

> `optional` **harness?**: `string`

Defined in: [mcp/delegates.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L443)

**`Experimental`**

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/delegates.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L444)

**`Experimental`**

##### reviewer?

> `optional` **reviewer?**: [`CoderReviewer`](#coderreviewer)

Defined in: [mcp/delegates.ts:446](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L446)

**`Experimental`**

Same gate as the streaming path: an unapproved candidate cannot win.

***

### DelegationStore

Defined in: [mcp/delegation-store.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L23)

**`Experimental`**

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Defined in: [mcp/delegation-store.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L30)

**`Experimental`**

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Defined in: [mcp/delegation-store.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L32)

**`Experimental`**

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

Defined in: [mcp/delegation-store.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L39)

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

Defined in: [mcp/delegation-store.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L41)

**`Experimental`**

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### FileDelegationStoreOptions

Defined in: [mcp/delegation-store.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L99)

**`Experimental`**

#### Properties

##### filePath

> **filePath**: `string`

Defined in: [mcp/delegation-store.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L101)

**`Experimental`**

Absolute path of the JSON state file. Parent directories are created on first write.

##### recoverCorrupt?

> `optional` **recoverCorrupt?**: `boolean`

Defined in: [mcp/delegation-store.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-store.ts#L107)

**`Experimental`**

When the state file exists but cannot be parsed, archive it to
`<filePath>.corrupt-<timestamp>` and start empty instead of
throwing `DelegationStateCorruptError`. Default false.

***

### DelegationTraceSpan

Defined in: [mcp/delegation-trace.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L31)

**`Experimental`**

One span of a delegation's compact trace. Flat (parent linkage by id), all
values JSON-safe scalars — `FileDelegationStore` round-trips records
through `JSON.stringify`. `meta` carries the span's attributes (GenAI
semconv keys + `tangle.loop.*` extensions) exactly as the OTEL sink emits
them, so a consumer can re-export journal traces losslessly.

#### Properties

##### spanId

> **spanId**: `string`

Defined in: [mcp/delegation-trace.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L32)

**`Experimental`**

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/delegation-trace.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L34)

**`Experimental`**

Absent on the tree root.

##### name

> **name**: `string`

Defined in: [mcp/delegation-trace.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L36)

**`Experimental`**

`'loop'` | `'loop.round'` | `'loop.iteration'` (or a sink-specific name).

##### kind

> **kind**: `"loop"` \| `"round"` \| `"branch"`

Defined in: [mcp/delegation-trace.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L38)

**`Experimental`**

Topology level: loop root, plan round, or iteration branch.

##### startMs

> **startMs**: `number`

Defined in: [mcp/delegation-trace.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L39)

**`Experimental`**

##### endMs

> **endMs**: `number`

Defined in: [mcp/delegation-trace.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L40)

**`Experimental`**

##### meta?

> `optional` **meta?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: [mcp/delegation-trace.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L41)

**`Experimental`**

***

### DelegationTraceCaps

Defined in: [mcp/delegation-trace.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L51)

**`Experimental`**

#### Properties

##### maxSpans?

> `optional` **maxSpans?**: `number`

Defined in: [mcp/delegation-trace.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L53)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_SPANS](#delegation_trace_max_spans).

##### maxBytes?

> `optional` **maxBytes?**: `number`

Defined in: [mcp/delegation-trace.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L56)

**`Experimental`**

Default [DELEGATION\_TRACE\_MAX\_BYTES](#delegation_trace_max_bytes). Approximate — measured as the
 sum of per-span `JSON.stringify` lengths.

***

### CappedDelegationTrace

Defined in: [mcp/delegation-trace.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L60)

**`Experimental`**

#### Properties

##### trace

> **trace**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/delegation-trace.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L61)

**`Experimental`**

##### truncated

> **truncated**: `boolean`

Defined in: [mcp/delegation-trace.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L63)

**`Experimental`**

True when oldest spans were dropped to honor the caps.

***

### DelegationTraceCollector

Defined in: [mcp/delegation-trace.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L123)

**`Experimental`**

Per-delegation trace collector. Buffers `LoopTraceEvent`s per runId
(mirroring the OTEL emitter's buffering) and hands the derived compact
spans to `onSpans` when a run reaches `loop.ended`. `settle()` drains runs
that never ended — a hard-aborted loop still leaves its partial tree in the
journal, unlike the OTEL path which drops it.

#### Properties

##### emitter

> **emitter**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/delegation-trace.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L124)

**`Experimental`**

#### Methods

##### settle()

> **settle**(): `void`

Defined in: [mcp/delegation-trace.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L126)

**`Experimental`**

Flush buffered events of runs that never reached `loop.ended`.

###### Returns

`void`

***

### DriveTurnCapableBox

Defined in: [mcp/detached-turn.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L67)

**`Experimental`**

The box surface detached turns need. `SandboxInstance`
(`@tangle-network/sandbox` >= 0.6) satisfies it structurally; tests pass
in-memory fakes. `_sessionCancel` is the SDK's remote-cancellation surface —
optional here because older SDKs / fakes may not expose it; when present it
is invoked on abort so the remote run actually stops.

#### Methods

##### driveTurn()

> **driveTurn**(`message`, `opts`): `Promise`\<[`DriveTurnTick`](#driveturntick)\>

Defined in: [mcp/detached-turn.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L68)

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

Defined in: [mcp/detached-turn.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L72)

**`Experimental`**

###### Parameters

###### id

`string`

###### Returns

`Promise`\<`void`\>

***

### DetachedSessionRefParts

Defined in: [mcp/detached-turn.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L83)

**`Experimental`**

Decoded `DelegationRecord.detachedSessionRef`. `sandboxId` is absent between
submit and box acquisition — a record restored in that window is not
resumable (there is no box to resume on) and the resume driver fails it
loud rather than dispatching onto a guessed box.

#### Properties

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L84)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [mcp/detached-turn.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L85)

**`Experimental`**

***

### DetachedTurn

Defined in: [mcp/detached-turn.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L135)

**`Experimental`**

The terminal payload of a finished detached turn.

#### Properties

##### text

> **text**: `string`

Defined in: [mcp/detached-turn.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L137)

**`Experimental`**

Final assistant text.

##### result

> **result**: `Record`\<`string`, `unknown`\>

Defined in: [mcp/detached-turn.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L139)

**`Experimental`**

The SDK's cached AgentExecutionResult-shape record for the turn.

***

### RunDetachedTurnOptions

Defined in: [mcp/detached-turn.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L166)

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [mcp/detached-turn.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L168)

**`Experimental`**

Sandbox client used to acquire the box (the delegate's executor client).

##### spec

> **spec**: [`AgentRunSpec`](runtime.md#agentrunspec)\<`unknown`\>

Defined in: [mcp/detached-turn.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L170)

**`Experimental`**

Profile + overrides for box acquisition — same spec the streaming path uses.

##### prompt

> **prompt**: `string`

Defined in: [mcp/detached-turn.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L172)

**`Experimental`**

The full turn prompt; consumed by `driveTurn`'s dispatch leg.

##### sessionId

> **sessionId**: `string`

Defined in: [mcp/detached-turn.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L174)

**`Experimental`**

Deterministic resume key, minted at submit time (`parseDetachedSessionRef(ref).sessionId`).

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/detached-turn.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L181)

**`Experimental`**

##### tickIntervalMs?

> `optional` **tickIntervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L184)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L186)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` — the SDK cancels and fails a session past it.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/detached-turn.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L196)

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

Defined in: [mcp/detached-turn.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L198)

**`Experimental`**

Physical placement stamped on the synthesized dispatch event. Default `'sibling'`.

#### Methods

##### bindSandbox()

> **bindSandbox**(`sandboxId`): `void`

Defined in: [mcp/detached-turn.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L180)

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

Defined in: [mcp/detached-turn.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L182)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DetachedTurnResumeDriverOptions

Defined in: [mcp/detached-turn.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L365)

**`Experimental`**

#### Properties

##### intervalMs?

> `optional` **intervalMs?**: `number`

Defined in: [mcp/detached-turn.ts:390](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L390)

**`Experimental`**

Delay between `running` ticks (ms). Default 5000.

##### wallCapMs?

> `optional` **wallCapMs?**: `number`

Defined in: [mcp/detached-turn.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L392)

**`Experimental`**

Wall-clock cap forwarded to `driveTurn` on every tick.

#### Methods

##### resolveSandbox()

> **resolveSandbox**(`sandboxId`): `Promise`\<[`DriveTurnCapableBox`](#driveturncapablebox)\>

Defined in: [mcp/detached-turn.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L371)

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

Defined in: [mcp/detached-turn.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L378)

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

Defined in: [mcp/detached-turn.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L384)

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

Defined in: [mcp/executor.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L25)

**`Experimental`**

#### Properties

##### client

> `readonly` **client**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [mcp/executor.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L27)

**`Experimental`**

Sandbox client the kernel calls. Returned with `describePlacement` set.

##### placement?

> `readonly` `optional` **placement?**: `"sibling"` \| `"fleet"` \| `"in-process"`

Defined in: [mcp/executor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L37)

**`Experimental`**

Where delegated work physically runs. `sibling` and `fleet` placements are
session-backed (boxes expose `driveTurn`, so detached dispatch + resume
apply); `in-process` spawns local harness CLIs with no sandbox session to
detach. Optional so consumer-implemented executors stay source-compatible;
absent means "unknown" and detached dispatch is not enabled for it.

#### Methods

##### describe()

> **describe**(): `string`

Defined in: [mcp/executor.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L29)

**`Experimental`**

Best-effort one-liner used in stderr boot logs and diagnostics.

###### Returns

`string`

***

### SiblingSandboxExecutorOptions

Defined in: [mcp/executor.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L41)

**`Experimental`**

#### Properties

##### client

> **client**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [mcp/executor.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L42)

**`Experimental`**

***

### FleetHandle

Defined in: [mcp/executor.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L82)

**`Experimental`**

Minimal `SandboxFleet` surface the fleet executor calls. Declared
structurally so tests can pass an in-memory stub without instantiating the
sandbox SDK.

#### Properties

##### fleetId

> `readonly` **fleetId**: `string`

Defined in: [mcp/executor.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L83)

**`Experimental`**

##### ids

> `readonly` **ids**: readonly `string`[]

Defined in: [mcp/executor.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L85)

**`Experimental`**

Machine ids in dispatch-eligible order. The executor round-robins.

#### Methods

##### sandbox()

> **sandbox**(`machineId`): `Promise`\<`SandboxInstance`\>

Defined in: [mcp/executor.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L89)

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

Defined in: [mcp/executor.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L93)

**`Experimental`**

#### Properties

##### fleet

> **fleet**: [`FleetHandle`](#fleethandle)

Defined in: [mcp/executor.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L94)

**`Experimental`**

##### selectMachine?

> `optional` **selectMachine?**: (`call`) => `string`

Defined in: [mcp/executor.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L100)

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

Defined in: [mcp/executor.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L105)

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

Defined in: [mcp/in-process-executor.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L33)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/in-process-executor.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L35)

**`Experimental`**

Absolute path to the git repo (the workspace). Worktrees go under `<repoRoot>/.agent-worktrees/`.

##### harnesses?

> `optional` **harnesses?**: readonly [`LocalHarness`](#localharness)[]

Defined in: [mcp/in-process-executor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L37)

**`Experimental`**

Harnesses to round-robin across `create()` calls. One entry = no fanout. Default `['claude']`.

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L39)

**`Experimental`**

Optional per-delegation test command run in the worktree after the harness exits.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/in-process-executor.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L41)

**`Experimental`**

Optional per-delegation typecheck command. Same shape as `testCmd`.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L43)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5min.

##### postCheckTimeoutMs?

> `optional` **postCheckTimeoutMs?**: `number`

Defined in: [mcp/in-process-executor.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L45)

**`Experimental`**

Wall-clock cap per test/typecheck subprocess (ms). Default 2min.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/in-process-executor.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L47)

**`Experimental`**

Test seam — override the git runner used by the worktree helpers.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](#localharnessresult)\>

Defined in: [mcp/in-process-executor.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L49)

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

Defined in: [mcp/in-process-executor.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L52)

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

Defined in: [mcp/in-process-executor.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L60)

**`Experimental`**

#### Extends

- [`LoopSandboxPlacement`](runtime.md#loopsandboxplacement)

#### Properties

##### worktreePath?

> `optional` **worktreePath?**: `string`

Defined in: [mcp/in-process-executor.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L62)

**`Experimental`**

Worktree path in the parent sandbox's filesystem (set so traces correlate to on-disk artifacts).

##### harness?

> `optional` **harness?**: [`LocalHarness`](#localharness)

Defined in: [mcp/in-process-executor.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L64)

**`Experimental`**

Which harness handled this delegation.

##### kind

> **kind**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L314)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`kind`](runtime.md#kind-3)

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L315)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`sandboxId`](runtime.md#sandboxid)

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L316)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`fleetId`](runtime.md#fleetid)

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L317)

**`Experimental`**

###### Inherited from

[`LoopSandboxPlacement`](runtime.md#loopsandboxplacement).[`machineId`](runtime.md#machineid)

***

### FactCandidate

Defined in: [mcp/kb-gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L24)

**`Experimental`**

A fact proposed for the KB, with its grounding.

#### Properties

##### claim

> **claim**: `string`

Defined in: [mcp/kb-gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L26)

**`Experimental`**

The atomic claim text.

##### value?

> `optional` **value?**: `string` \| `number`

Defined in: [mcp/kb-gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L28)

**`Experimental`**

Optional extracted value (number or string) the claim asserts.

##### verbatimPassage

> **verbatimPassage**: `string`

Defined in: [mcp/kb-gate.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L30)

**`Experimental`**

Verbatim span lifted from the source that backs the claim.

##### sourceText

> **sourceText**: `string`

Defined in: [mcp/kb-gate.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L32)

**`Experimental`**

The raw source text the passage must be grounded in.

##### citation?

> `optional` **citation?**: `string`

Defined in: [mcp/kb-gate.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L34)

**`Experimental`**

Where the fact claims to come from — checked for circular/self citations.

***

### FactJudgeVerdict

Defined in: [mcp/kb-gate.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L38)

**`Experimental`**

#### Properties

##### accept

> **accept**: `boolean`

Defined in: [mcp/kb-gate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L39)

**`Experimental`**

##### reason?

> `optional` **reason?**: `string`

Defined in: [mcp/kb-gate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L40)

**`Experimental`**

***

### FactJudge

Defined in: [mcp/kb-gate.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L45)

**`Experimental`**

A pluggable fact validator. Throw is NOT allowed — return a
 verdict; a thrown judge is a programmer error, not a veto.

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/kb-gate.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L46)

**`Experimental`**

#### Methods

##### judge()

> **judge**(`candidate`): [`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

Defined in: [mcp/kb-gate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L47)

**`Experimental`**

###### Parameters

###### candidate

[`FactCandidate`](#factcandidate)

###### Returns

[`FactJudgeVerdict`](#factjudgeverdict) \| `Promise`\<[`FactJudgeVerdict`](#factjudgeverdict)\>

***

### KbGateResult

Defined in: [mcp/kb-gate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L51)

**`Experimental`**

#### Properties

##### accepted

> **accepted**: `boolean`

Defined in: [mcp/kb-gate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L52)

**`Experimental`**

##### vetoedBy?

> `optional` **vetoedBy?**: `string`

Defined in: [mcp/kb-gate.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L54)

**`Experimental`**

Name of the judge that vetoed; undefined when accepted.

##### reason?

> `optional` **reason?**: `string`

Defined in: [mcp/kb-gate.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L55)

**`Experimental`**

***

### CreateKbGateOptions

Defined in: [mcp/kb-gate.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L59)

**`Experimental`**

#### Properties

##### judges?

> `optional` **judges?**: [`FactJudge`](#factjudge)[]

Defined in: [mcp/kb-gate.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L61)

**`Experimental`**

Extra judges appended after the built-in floor (e.g. an LLM judge).

##### minPassageChars?

> `optional` **minPassageChars?**: `number`

Defined in: [mcp/kb-gate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L63)

**`Experimental`**

Minimum verbatim-passage length. Default 12 — kills empty/stub passages.

##### selfArtifactKinds?

> `optional` **selfArtifactKinds?**: `string`[]

Defined in: [mcp/kb-gate.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L70)

**`Experimental`**

Citation tokens that denote a SELF-generated artifact (e.g. `'spec'`,
`'cad_params'`, `'requirements'`). A citation naming one is circular
(laundering) — the fact cites a derived artifact, not a real source.
Default `[]` (no circular check unless the consumer declares its kinds).

***

### RunLocalHarnessOptions

Defined in: [mcp/local-harness.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L107)

**`Experimental`**

#### Properties

##### harness

> **harness**: [`LocalHarness`](#localharness)

Defined in: [mcp/local-harness.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L108)

**`Experimental`**

##### cwd

> **cwd**: `string`

Defined in: [mcp/local-harness.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L110)

**`Experimental`**

Working directory for the subprocess (typically a worktree path).

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [mcp/local-harness.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L112)

**`Experimental`**

Prompt forwarded as the harness CLI's task argument.

##### invocation?

> `optional` **invocation?**: `object`

Defined in: [mcp/local-harness.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L120)

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

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [mcp/local-harness.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L122)

**`Experimental`**

Wall-clock kill deadline (ms). Default 5 min. Subprocess SIGTERMed on expiry.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [mcp/local-harness.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L124)

**`Experimental`**

Caller cancellation. SIGTERM is sent on abort.

##### env?

> `optional` **env?**: `ProcessEnv`

Defined in: [mcp/local-harness.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L126)

**`Experimental`**

Override env (defaults to inheriting from the parent).

##### spawn?

> `optional` **spawn?**: (`command`, `args`, `opts`) => `ChildProcess`

Defined in: [mcp/local-harness.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L131)

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

###### Returns

`ChildProcess`

***

### LocalHarnessResult

Defined in: [mcp/local-harness.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L143)

**`Experimental`**

#### Properties

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/local-harness.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L145)

**`Experimental`**

OS exit code. `null` when killed before exit.

##### stdout

> **stdout**: `string`

Defined in: [mcp/local-harness.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L147)

**`Experimental`**

Concatenated stdout.

##### stderr

> **stderr**: `string`

Defined in: [mcp/local-harness.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L149)

**`Experimental`**

Concatenated stderr.

##### killedBySignal

> **killedBySignal**: `Signals` \| `null`

Defined in: [mcp/local-harness.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L151)

**`Experimental`**

Set when the process exited via signal (timeout / abort).

##### durationMs

> **durationMs**: `number`

Defined in: [mcp/local-harness.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L153)

**`Experimental`**

Wall-clock duration ms (spawn → exit).

##### timedOut

> **timedOut**: `boolean`

Defined in: [mcp/local-harness.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L155)

**`Experimental`**

Set when timeoutMs elapsed before exit.

***

### McpServerOptions

Defined in: [mcp/server.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L62)

**`Experimental`**

#### Properties

##### delegateSupervisor?

> `optional` **delegateSupervisor?**: [`DelegateHandlerOptions`](#delegatehandleroptions)

Defined in: [mcp/server.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L69)

**`Experimental`**

Required to enable `delegate` — the ONE generic delegation verb (the replacement for
delegate_code / delegate_research). Inject the supervisor substrate: its brain `router`, the
worker `backend`, and the completion `deliverable`. The supervisor AUTHORS its own worker from
the agent's intent, so there is no worker profile to wire here.

##### uiAuditorDelegate?

> `optional` **uiAuditorDelegate?**: [`UiAuditorDelegate`](#uiauditordelegate)

Defined in: [mcp/server.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L76)

**`Experimental`**

Required to enable delegate_ui_audit. Wire one that closes over your
`runLoop` + `uiAuditorProfile` + a `SandboxClient` (the
canonical in-process choice is `createInProcessUiAuditClient` from
`@tangle-network/agent-runtime/profiles`) + your vision judge.

##### feedbackStore?

> `optional` **feedbackStore?**: [`FeedbackStore`](#feedbackstore)

Defined in: [mcp/server.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L78)

**`Experimental`**

Override the default in-memory feedback store.

##### queue?

> `optional` **queue?**: [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/server.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L80)

**`Experimental`**

Override the default in-memory task queue.

##### extraTools?

> `optional` **extraTools?**: [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: [mcp/server.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L86)

**`Experimental`**

Extra tools to serve alongside the delegation tools, for example
`createCoordinationTools(...).tools`. Registered after the built-ins; a
duplicate name throws so delegation tools cannot be shadowed silently.

##### traceContext?

> `optional` **traceContext?**: [`TraceContext`](#tracecontext-2)

Defined in: [mcp/server.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L92)

**`Experimental`**

Inherited trace identity (`readTraceContextFromEnv()`) stamped on every
record the DEFAULT queue creates. Ignored when `queue` is supplied —
pass `traceContext` to that queue's constructor instead.

##### serverName?

> `optional` **serverName?**: `string`

Defined in: [mcp/server.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L94)

**`Experimental`**

Server display name surfaced via `initialize`. Default `'agent-runtime-mcp'`.

##### serverVersion?

> `optional` **serverVersion?**: `string`

Defined in: [mcp/server.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L96)

**`Experimental`**

Server version surfaced via `initialize`. Default = the package version baked at build time.

***

### McpToolDescriptor

Defined in: [mcp/server.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L100)

**`Experimental`**

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/server.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L101)

**`Experimental`**

##### description

> **description**: `string`

Defined in: [mcp/server.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L102)

**`Experimental`**

##### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\>

Defined in: [mcp/server.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L103)

**`Experimental`**

##### handler

> **handler**: (`raw`) => `Promise`\<`unknown`\>

Defined in: [mcp/server.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L104)

**`Experimental`**

###### Parameters

###### raw

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### McpServer

Defined in: [mcp/server.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L108)

**`Experimental`**

#### Properties

##### tools

> `readonly` **tools**: `ReadonlyMap`\<`string`, [`McpToolDescriptor`](#mcptooldescriptor)\>

Defined in: [mcp/server.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L110)

**`Experimental`**

Tools currently registered (depend on which delegates were wired).

##### queue

> `readonly` **queue**: [`DelegationTaskQueue`](#delegationtaskqueue)

Defined in: [mcp/server.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L112)

**`Experimental`**

The underlying queue — exposed so tests can introspect it.

##### feedbackStore

> `readonly` **feedbackStore**: [`FeedbackStore`](#feedbackstore)

Defined in: [mcp/server.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L114)

**`Experimental`**

The feedback store — exposed for the same reason.

#### Methods

##### handle()

> **handle**(`message`): `Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

Defined in: [mcp/server.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L116)

**`Experimental`**

Handle a single parsed JSON-RPC message. Returns the response object (or `null` for notifications).

###### Parameters

###### message

[`JsonRpcMessage`](#jsonrpcmessage)

###### Returns

`Promise`\<[`JsonRpcResponse`](#jsonrpcresponse) \| `null`\>

##### serve()

> **serve**(`transport?`): `Promise`\<`void`\>

Defined in: [mcp/server.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L118)

**`Experimental`**

Drive the server on a stdio-shaped transport until `stop()` is called.

###### Parameters

###### transport?

[`McpTransport`](#mcptransport)

###### Returns

`Promise`\<`void`\>

##### stop()

> **stop**(): `void`

Defined in: [mcp/server.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L120)

**`Experimental`**

Stop a `serve` call. Subsequent requests are rejected.

###### Returns

`void`

***

### McpTransport

Defined in: [mcp/server.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L124)

**`Experimental`**

#### Properties

##### input

> **input**: `ReadableStream`

Defined in: [mcp/server.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L125)

**`Experimental`**

##### output

> **output**: `WritableStream`

Defined in: [mcp/server.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L126)

**`Experimental`**

***

### JsonRpcMessage

Defined in: [mcp/server.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L130)

**`Experimental`**

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [mcp/server.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L131)

**`Experimental`**

##### id?

> `optional` **id?**: `string` \| `number` \| `null`

Defined in: [mcp/server.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L132)

**`Experimental`**

##### method

> **method**: `string`

Defined in: [mcp/server.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L133)

**`Experimental`**

##### params?

> `optional` **params?**: `unknown`

Defined in: [mcp/server.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L134)

**`Experimental`**

***

### JsonRpcResponse

Defined in: [mcp/server.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L138)

**`Experimental`**

#### Properties

##### jsonrpc

> **jsonrpc**: `"2.0"`

Defined in: [mcp/server.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L139)

**`Experimental`**

##### id

> **id**: `string` \| `number` \| `null`

Defined in: [mcp/server.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L140)

**`Experimental`**

##### result?

> `optional` **result?**: `unknown`

Defined in: [mcp/server.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L141)

**`Experimental`**

##### error?

> `optional` **error?**: `object`

Defined in: [mcp/server.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L142)

**`Experimental`**

###### code

> **code**: `number`

###### message

> **message**: `string`

###### data?

> `optional` **data?**: `unknown`

***

### DelegationRecord

Defined in: [mcp/task-queue.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L65)

**`Experimental`**

Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
persistent stores round-trip records through `JSON.stringify`.

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/task-queue.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L66)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/task-queue.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L67)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L68)

**`Experimental`**

##### args

> **args**: `AnyDelegateArgs`

Defined in: [mcp/task-queue.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L69)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/task-queue.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L70)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

Defined in: [mcp/task-queue.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L71)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

Defined in: [mcp/task-queue.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L72)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

Defined in: [mcp/task-queue.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L73)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/task-queue.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L74)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/task-queue.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L75)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/task-queue.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L76)

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L78)

**`Experimental`**

Sha-prefix hash of the canonical input — used for idempotency lookup.

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L85)

**`Experimental`**

Caller-generated deterministic id of a detached run (e.g. the sandbox
session id a single-tick driver resumes by). Presence is what makes a
restored in-flight record resumable via `resumeDelegate`; without it a
restart settles the record as failed.

##### feedback

> **feedback**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

Defined in: [mcp/task-queue.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L87)

**`Experimental`**

Feedback events keyed by this delegation's taskId.

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/task-queue.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L94)

**`Experimental`**

Compact loop-trace span tree teed from the delegation's run, oldest
spans first. Appended when a delegated loop reaches `loop.ended` and
settled (partial buffers included) at the terminal transition. Capped
via `capDelegationTrace` — see `traceTruncated`.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/task-queue.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L96)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/task-queue.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L103)

**`Experimental`**

Inherited trace identity (the queue's `traceContext` at submit time —
typically `readTraceContextFromEnv()`), distinct from the span payload:
a journal consumer joins records into the parent trace by these ids
without parsing spans. Restored records keep their persisted identity.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/task-queue.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L105)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### SubmitInput

Defined in: [mcp/task-queue.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L109)

**`Experimental`**

#### Type Parameters

##### Args

`Args` *extends* `AnyDelegateArgs`

#### Properties

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/task-queue.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L110)

**`Experimental`**

##### args

> **args**: `Args`

Defined in: [mcp/task-queue.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L111)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/task-queue.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L112)

**`Experimental`**

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Defined in: [mcp/task-queue.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L113)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L120)

**`Experimental`**

Records the detached-run resume key on the new record. The submitted
`run` function still executes in-process exactly as without it — the
ref only matters after a restart, when `DelegationTaskQueue.restore`
hands it to the `resumeDelegate` seam instead of failing the record.

##### run

> **run**: (`ctx`) => `Promise`\<`CoderOutput` \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

Defined in: [mcp/task-queue.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L127)

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

Defined in: [mcp/task-queue.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L131)

**`Experimental`**

Context handed to a `SubmitInput.run` function.

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L132)

**`Experimental`**

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Defined in: [mcp/task-queue.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L135)

**`Experimental`**

The `detachedSessionRef` recorded at submit, when one was supplied.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

Defined in: [mcp/task-queue.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L153)

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

Defined in: [mcp/task-queue.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L133)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()

> **updateDetachedSessionRef**(`ref`): `void`

Defined in: [mcp/task-queue.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L143)

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

Defined in: [mcp/task-queue.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L157)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/task-queue.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L158)

**`Experimental`**

##### reused

> **reused**: `boolean`

Defined in: [mcp/task-queue.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L160)

**`Experimental`**

True when a prior matching `idempotencyKey` returned an existing record.

***

### DelegationResumeContext

Defined in: [mcp/task-queue.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L177)

**`Experimental`**

#### Properties

##### signal

> **signal**: `AbortSignal`

Defined in: [mcp/task-queue.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L179)

**`Experimental`**

Fired by `cancel(taskId)`; the driver should stop the remote run when it can.

#### Methods

##### report()

> **report**(`progress`): `void`

Defined in: [mcp/task-queue.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L180)

**`Experimental`**

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DelegationResumeDriver

Defined in: [mcp/task-queue.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L193)

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

Defined in: [mcp/task-queue.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L199)

**`Experimental`**

Delay between `running` ticks, in milliseconds. Default 5000.

#### Methods

##### tick()

> **tick**(`task`, `ctx`): `Promise`\<[`DelegationResumeTick`](#delegationresumetick)\>

Defined in: [mcp/task-queue.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L194)

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

Defined in: [mcp/task-queue.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L203)

**`Experimental`**

#### Properties

##### generateId?

> `optional` **generateId?**: () => `string`

Defined in: [mcp/task-queue.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L205)

**`Experimental`**

ID generator override; default `randomTaskId`.

###### Returns

`string`

##### now?

> `optional` **now?**: () => `string`

Defined in: [mcp/task-queue.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L207)

**`Experimental`**

Clock override; default `() => new Date().toISOString()`.

###### Returns

`string`

##### store?

> `optional` **store?**: [`DelegationStore`](#delegationstore)

Defined in: [mcp/task-queue.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L215)

**`Experimental`**

Journal for record mutations and the `restore()` load source. Default
`InMemoryDelegationStore` — observably identical to an unjournaled
queue. Pass a `FileDelegationStore` through
`DelegationTaskQueue.restore` for state that survives a restart;
constructing with `new` never loads prior state.

##### resumeDelegate?

> `optional` **resumeDelegate?**: [`DelegationResumeDriver`](#delegationresumedriver)

Defined in: [mcp/task-queue.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L217)

**`Experimental`**

Resume seam for restored in-flight records that carry a `detachedSessionRef`.

##### maxTerminalRecords?

> `optional` **maxTerminalRecords?**: `number`

Defined in: [mcp/task-queue.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L223)

**`Experimental`**

Maximum number of terminal (completed | failed | cancelled) records
retained; the oldest (by `completedAt`) are evicted from memory and
store once the cap is exceeded. Default unbounded.

##### onPersistError?

> `optional` **onPersistError?**: (`error`) => `void`

Defined in: [mcp/task-queue.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L230)

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

Defined in: [mcp/task-queue.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L238)

**`Experimental`**

Inherited trace identity stamped on every submitted record
(`traceId` / `parentSpanId`). The bin passes
`readTraceContextFromEnv()` so journal consumers can join delegation
records into the caller's trace. Restored records keep the identity
they were persisted with.

***

### Check

Defined in: [mcp/tools/checks.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L82)

One lens — a composable analyst kind. Identity fields mirror `TraceAnalystKindSpec` so a kind is
 upgradeable to the full agentic factory; `lookFor` is the lens question the actor applies.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/checks.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L83)

##### description

> `readonly` **description**: `string`

Defined in: [mcp/tools/checks.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L84)

##### area

> `readonly` **area**: `string`

Defined in: [mcp/tools/checks.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L86)

Coarse classification stamped on every finding this kind emits (the renderer groups by it).

##### version

> `readonly` **version**: `string`

Defined in: [mcp/tools/checks.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L87)

##### lookFor

> `readonly` **lookFor**: `string`

Defined in: [mcp/tools/checks.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L89)

The lens — what this analyst looks for in the trace.

***

### CheckRunnerOptions

Defined in: [mcp/tools/checks.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L209)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [mcp/tools/checks.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L210)

##### routerKey

> **routerKey**: `string`

Defined in: [mcp/tools/checks.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L211)

##### model

> **model**: `string`

Defined in: [mcp/tools/checks.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L212)

##### chat?

> `optional` **chat?**: (`system`, `user`) => `Promise`\<`string`\>

Defined in: [mcp/tools/checks.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L214)

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

Defined in: [mcp/tools/coordination.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L21)

A worker the driver has drained via `await_event`.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L22)

##### status

> `readonly` **status**: `"done"` \| `"down"`

Defined in: [mcp/tools/coordination.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L23)

##### score?

> `readonly` `optional` **score?**: `number`

Defined in: [mcp/tools/coordination.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L24)

##### valid?

> `readonly` `optional` **valid?**: `boolean`

Defined in: [mcp/tools/coordination.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L25)

##### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [mcp/tools/coordination.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L26)

##### reason?

> `readonly` `optional` **reason?**: `string`

Defined in: [mcp/tools/coordination.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L27)

***

### Question

Defined in: [mcp/tools/coordination.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L38)

#### Extended by

- [`QuestionRecord`](#questionrecord)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L39)

##### from

> `readonly` **from**: `string`

Defined in: [mcp/tools/coordination.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L40)

##### level

> `readonly` **level**: `QuestionLevel`

Defined in: [mcp/tools/coordination.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L41)

##### question

> `readonly` **question**: `string`

Defined in: [mcp/tools/coordination.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L42)

##### reason

> `readonly` **reason**: `string`

Defined in: [mcp/tools/coordination.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L43)

##### urgency

> `readonly` **urgency**: `QuestionUrgency`

Defined in: [mcp/tools/coordination.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L44)

##### options?

> `readonly` `optional` **options?**: readonly `QuestionOption`[]

Defined in: [mcp/tools/coordination.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L45)

***

### QuestionRecord

Defined in: [mcp/tools/coordination.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L53)

#### Extends

- [`Question`](#question)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [mcp/tools/coordination.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L39)

###### Inherited from

[`Question`](#question).[`id`](#id-5)

##### from

> `readonly` **from**: `string`

Defined in: [mcp/tools/coordination.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L40)

###### Inherited from

[`Question`](#question).[`from`](#from)

##### level

> `readonly` **level**: `QuestionLevel`

Defined in: [mcp/tools/coordination.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L41)

###### Inherited from

[`Question`](#question).[`level`](#level)

##### question

> `readonly` **question**: `string`

Defined in: [mcp/tools/coordination.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L42)

###### Inherited from

[`Question`](#question).[`question`](#question-1)

##### reason

> `readonly` **reason**: `string`

Defined in: [mcp/tools/coordination.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L43)

###### Inherited from

[`Question`](#question).[`reason`](#reason-3)

##### urgency

> `readonly` **urgency**: `QuestionUrgency`

Defined in: [mcp/tools/coordination.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L44)

###### Inherited from

[`Question`](#question).[`urgency`](#urgency)

##### options?

> `readonly` `optional` **options?**: readonly `QuestionOption`[]

Defined in: [mcp/tools/coordination.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L45)

###### Inherited from

[`Question`](#question).[`options`](#options)

##### status

> `readonly` **status**: `"open"` \| `"answered"` \| `"deferred"` \| `"escalated"`

Defined in: [mcp/tools/coordination.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L54)

##### decision?

> `readonly` `optional` **decision?**: [`QuestionDecision`](#questiondecision)

Defined in: [mcp/tools/coordination.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L55)

##### openedAt

> `readonly` **openedAt**: `number`

Defined in: [mcp/tools/coordination.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L56)

***

### AnalystRegistry

Defined in: [mcp/tools/coordination.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L62)

#### Properties

##### kinds

> `readonly` **kinds**: readonly `object`[]

Defined in: [mcp/tools/coordination.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L63)

##### run

> `readonly` **run**: (`kindId`, `trace`) => `Promise`\<`unknown`\>

Defined in: [mcp/tools/coordination.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L64)

###### Parameters

###### kindId

`string`

###### trace

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### CoordinationToolsOptions

Defined in: [mcp/tools/coordination.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L94)

#### Properties

##### scope

> `readonly` **scope**: [`Scope`](runtime.md#scope-1)\<`unknown`\>

Defined in: [mcp/tools/coordination.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L95)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

Defined in: [mcp/tools/coordination.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L96)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: [mcp/tools/coordination.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L97)

##### perWorker

> `readonly` **perWorker**: [`Budget`](runtime.md#budget-10)

Defined in: [mcp/tools/coordination.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L98)

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: [mcp/tools/coordination.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L99)

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L100)

###### Parameters

###### event

[`CoordinationEvent`](runtime.md#coordinationevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### questionPolicy?

> `readonly` `optional` **questionPolicy?**: [`QuestionPolicy`](#questionpolicy)

Defined in: [mcp/tools/coordination.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L101)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [mcp/tools/coordination.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L106)

Analyst kind ids to run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle
 hook). Each result is published as a `finding` event on the bus — pass-through to subscribers
 and queued for the driver to pull via `await_event`. Omit/empty = no auto-analysis (default;
 the driver can still run lenses on demand via `run_analyst`). Requires `analysts`.

***

### CoordinationTools

Defined in: [mcp/tools/coordination.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L116)

The supervisor-side toolbox returned by [createCoordinationTools](#createcoordinationtools): the MCP tool
descriptors a driver `AgentProfile` calls to spawn, steer, observe, and settle workers
over a live `Scope`, plus the typed accessors (`settled`/`questions`/`history`/`stats`/
`raiseFinding`) for the bidirectional coordination bus. This is the live, backend-of-your-
choice, steerable counterpart to the one-shot own-sandbox delegation MCP.

#### Properties

##### tools

> `readonly` **tools**: [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: [mcp/tools/coordination.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L117)

#### Methods

##### isStopped()

> **isStopped**(): `boolean`

Defined in: [mcp/tools/coordination.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L118)

###### Returns

`boolean`

##### stopReason()

> **stopReason**(): `string` \| `undefined`

Defined in: [mcp/tools/coordination.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L119)

###### Returns

`string` \| `undefined`

##### settled()

> **settled**(): readonly [`SettledWorker`](#settledworker)[]

Defined in: [mcp/tools/coordination.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L120)

###### Returns

readonly [`SettledWorker`](#settledworker)[]

##### questions()

> **questions**(): readonly [`QuestionRecord`](#questionrecord)[]

Defined in: [mcp/tools/coordination.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L121)

###### Returns

readonly [`QuestionRecord`](#questionrecord)[]

##### history()

> **history**(): readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

Defined in: [mcp/tools/coordination.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L125)

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

##### stats()

> **stats**(): [`BusStats`](runtime.md#busstats)

Defined in: [mcp/tools/coordination.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L127)

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](runtime.md#busstats)

##### raiseFinding()

> **raiseFinding**(`finding`): `Promise`\<`void`\>

Defined in: [mcp/tools/coordination.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L131)

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

###### Parameters

###### finding

`AnalystFindingEvent`

###### Returns

`Promise`\<`void`\>

***

### DelegateArgs

Defined in: [mcp/tools/delegate.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L71)

Parsed `delegate` tool arguments.

#### Properties

##### intent

> **intent**: `string`

Defined in: [mcp/tools/delegate.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L72)

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/tools/delegate.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L73)

##### runId?

> `optional` **runId?**: `string`

Defined in: [mcp/tools/delegate.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L74)

***

### DelegateHandlerOptions

Defined in: [mcp/tools/delegate.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L106)

**`Experimental`**

#### Properties

##### router

> **router**: [`RouterConfig`](runtime.md#routerconfig)

Defined in: [mcp/tools/delegate.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L108)

**`Experimental`**

The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained).

##### backend

> **backend**: [`ExecutorConfig`](runtime.md#executorconfig)

Defined in: [mcp/tools/delegate.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L110)

**`Experimental`**

WHERE the authored workers run. Required for `supervise()` to spawn anything.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Defined in: [mcp/tools/delegate.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L112)

**`Experimental`**

The completion oracle the authored workers settle against (settled ⟺ delivered).

##### model?

> `optional` **model?**: `string`

Defined in: [mcp/tools/delegate.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L114)

**`Experimental`**

Default supervisor brain model when a call omits `model`.

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Defined in: [mcp/tools/delegate.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L116)

**`Experimental`**

Restrict the run to this subset of models.

***

### TraceContext

Defined in: [mcp/trace-propagation.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L24)

#### Properties

##### traceId

> **traceId**: `string`

Defined in: [mcp/trace-propagation.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L26)

Trace id inherited from the parent process, or a fresh one.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/trace-propagation.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L28)

Parent span id from the delegation that launched this MCP server.

***

### DelegateCodeConfig

Defined in: [mcp/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L34)

**`Experimental`**

Minimal `CoderTask` overrides exposed over the MCP wire. The full
`CoderTask` carries fields the kernel synthesizes from `goal` +
`repoRoot` — the agent only edits the few that materially gate
validator behavior.

#### Properties

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [mcp/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L35)

**`Experimental`**

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [mcp/types.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L36)

**`Experimental`**

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [mcp/types.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L37)

**`Experimental`**

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [mcp/types.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L38)

**`Experimental`**

***

### DelegateCodeArgs

Defined in: [mcp/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L42)

**`Experimental`**

#### Properties

##### goal

> **goal**: `string`

Defined in: [mcp/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L44)

**`Experimental`**

Natural-language description of what the coder must accomplish.

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L46)

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### contextHint?

> `optional` **contextHint?**: `string`

Defined in: [mcp/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L48)

**`Experimental`**

Optional free-form context the agent surfaces in the prompt prelude.

##### variants?

> `optional` **variants?**: `number`

Defined in: [mcp/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L54)

**`Experimental`**

When > 1, dispatches `multiHarnessCoderFanout` across N harnesses
(claude-code, codex, opencode-glm) and picks the highest-scoring
passing patch. Default 1.

##### config?

> `optional` **config?**: [`DelegateCodeConfig`](#delegatecodeconfig)

Defined in: [mcp/types.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L56)

**`Experimental`**

Validator + prompt overrides the agent knows for this repo.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L58)

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id).

***

### DelegateCodeResult

Defined in: [mcp/types.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L62)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L63)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L65)

**`Experimental`**

Best-effort hint — coder loops can take minutes-to-hours.

***

### DelegateResearchConfig

Defined in: [mcp/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L72)

**`Experimental`**

#### Properties

##### recencyWindow?

> `optional` **recencyWindow?**: `object`

Defined in: [mcp/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L73)

**`Experimental`**

###### since?

> `optional` **since?**: `string`

###### until?

> `optional` **until?**: `string`

##### maxItems?

> `optional` **maxItems?**: `number`

Defined in: [mcp/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L74)

**`Experimental`**

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [mcp/types.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L75)

**`Experimental`**

***

### DelegateResearchArgs

Defined in: [mcp/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L79)

**`Experimental`**

#### Properties

##### question

> **question**: `string`

Defined in: [mcp/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L80)

**`Experimental`**

##### namespace

> **namespace**: `string`

Defined in: [mcp/types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L81)

**`Experimental`**

##### scope?

> `optional` **scope?**: `string`

Defined in: [mcp/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L82)

**`Experimental`**

##### sources?

> `optional` **sources?**: [`ResearchSource`](#researchsource)[]

Defined in: [mcp/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L83)

**`Experimental`**

##### variants?

> `optional` **variants?**: `number`

Defined in: [mcp/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L84)

**`Experimental`**

##### config?

> `optional` **config?**: [`DelegateResearchConfig`](#delegateresearchconfig)

Defined in: [mcp/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L85)

**`Experimental`**

***

### DelegateResearchResult

Defined in: [mcp/types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L89)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L90)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L91)

**`Experimental`**

***

### FeedbackRefersTo

Defined in: [mcp/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L95)

**`Experimental`**

#### Properties

##### kind

> **kind**: `"artifact"` \| `"delegation"` \| `"outcome"`

Defined in: [mcp/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L96)

**`Experimental`**

##### ref

> **ref**: `string`

Defined in: [mcp/types.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L98)

**`Experimental`**

For `'delegation'`, this is the taskId.

***

### FeedbackRating

Defined in: [mcp/types.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L102)

**`Experimental`**

#### Properties

##### score

> **score**: `number`

Defined in: [mcp/types.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L104)

**`Experimental`**

[0, 1].

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

Defined in: [mcp/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L105)

**`Experimental`**

##### notes

> **notes**: `string`

Defined in: [mcp/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L106)

**`Experimental`**

***

### DelegateFeedbackArgs

Defined in: [mcp/types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L110)

**`Experimental`**

#### Properties

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

Defined in: [mcp/types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L111)

**`Experimental`**

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

Defined in: [mcp/types.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L112)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

Defined in: [mcp/types.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L113)

**`Experimental`**

##### capturedAt?

> `optional` **capturedAt?**: `string`

Defined in: [mcp/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L115)

**`Experimental`**

ISO timestamp; defaults to server clock when omitted.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L116)

**`Experimental`**

***

### DelegateFeedbackResult

Defined in: [mcp/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L120)

**`Experimental`**

#### Properties

##### recorded

> **recorded**: `true`

Defined in: [mcp/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L121)

**`Experimental`**

##### id

> **id**: `string`

Defined in: [mcp/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L122)

**`Experimental`**

***

### DelegationStatusArgs

Defined in: [mcp/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L126)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L127)

**`Experimental`**

##### includeTrace?

> `optional` **includeTrace?**: `boolean`

Defined in: [mcp/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L134)

**`Experimental`**

Return the delegation's compact loop-trace span tree alongside the
status. Default false — status polls stay light; opt in when you need
the topology (which iterations ran, where they were placed, what each
cost) rather than just the state machine.

***

### DelegationProgress

Defined in: [mcp/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L138)

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

Defined in: [mcp/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L139)

**`Experimental`**

##### phase

> **phase**: `string`

Defined in: [mcp/types.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L140)

**`Experimental`**

***

### DelegationError

Defined in: [mcp/types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L144)

**`Experimental`**

#### Properties

##### message

> **message**: `string`

Defined in: [mcp/types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L145)

**`Experimental`**

##### kind

> **kind**: `string`

Defined in: [mcp/types.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L146)

**`Experimental`**

***

### UiAuditorDelegationOutput

Defined in: [mcp/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L170)

**`Experimental`**

Wire-shape of a completed UI-audit delegation. The `findings` array
contains every finding persisted to the workspace during the run,
already enriched with `id` and `createdAt` by the writer. `workspaceDir`
is the absolute path to the workspace; `indexFile` is the workspace-
relative path to the regenerated index.md.

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L171)

**`Experimental`**

##### indexFile

> **indexFile**: `string`

Defined in: [mcp/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L172)

**`Experimental`**

##### findings

> **findings**: [`UiFinding`](profiles.md#uifinding)[]

Defined in: [mcp/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L173)

**`Experimental`**

##### iterations

> **iterations**: `number`

Defined in: [mcp/types.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L175)

**`Experimental`**

Total iterations the loop ran for this delegation.

***

### DelegateUiAuditRoute

Defined in: [mcp/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L182)

Optional per-route capture spec the agent surfaces over the wire.

#### Properties

##### name

> **name**: `string`

Defined in: [mcp/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L184)

Stable route name (used in screenshot filenames + finding metadata).

##### url

> **url**: `string`

Defined in: [mcp/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L186)

Fully-qualified URL.

##### viewports?

> `optional` **viewports?**: readonly `object`[]

Defined in: [mcp/types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L188)

Viewports to capture at. Defaults to `[{ width: 1280, height: 800 }]`.

##### fullPage?

> `optional` **fullPage?**: `boolean`

Defined in: [mcp/types.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L190)

Default false. Full-page captures for the broad lenses.

##### waitFor?

> `optional` **waitFor?**: `string`

Defined in: [mcp/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L192)

Selector to wait for before capture.

***

### DelegateUiAuditConfig

Defined in: [mcp/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L196)

**`Experimental`**

#### Properties

##### lenses?

> `optional` **lenses?**: `UiAuditLensFilter`

Defined in: [mcp/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L201)

**`Experimental`**

Lenses to iterate. Default: every lens except `'other'`. Order is
preserved — the driver iterates lens-by-lens.

##### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: [mcp/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L203)

**`Experimental`**

Maximum total iterations across all (lens × route) pairs. Default 33 (11 lenses × 3 routes).

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [mcp/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L205)

**`Experimental`**

Maximum concurrent iterations within a single plan() round. Default 2.

##### productContext?

> `optional` **productContext?**: `string`

Defined in: [mcp/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L207)

**`Experimental`**

Free-form product context surfaced to the judge.

***

### DelegateUiAuditArgs

Defined in: [mcp/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L211)

**`Experimental`**

#### Properties

##### workspaceDir

> **workspaceDir**: `string`

Defined in: [mcp/types.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L213)

**`Experimental`**

Workspace root for the audit (absolute path).

##### routes

> **routes**: readonly [`DelegateUiAuditRoute`](#delegateuiauditroute)[]

Defined in: [mcp/types.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L215)

**`Experimental`**

Routes to audit. Must be non-empty.

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L217)

**`Experimental`**

Multi-tenant scope.

##### config?

> `optional` **config?**: [`DelegateUiAuditConfig`](#delegateuiauditconfig)

Defined in: [mcp/types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L218)

**`Experimental`**

***

### DelegateUiAuditResult

Defined in: [mcp/types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L222)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L223)

**`Experimental`**

##### estimatedDurationMs?

> `optional` **estimatedDurationMs?**: `number`

Defined in: [mcp/types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L224)

**`Experimental`**

***

### ResearchOutputShape

Defined in: [mcp/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L234)

**`Experimental`**

Loose shape of a research output over the wire — the substrate cannot
import the `ResearchOutput` type from agent-knowledge without inducing
a dependency cycle, so the MCP layer treats it structurally.

#### Indexable

> \[`key`: `string`\]: `unknown`
**`Experimental`**

#### Properties

##### items

> **items**: `unknown`[]

Defined in: [mcp/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L235)

**`Experimental`**

##### citations

> **citations**: `unknown`[]

Defined in: [mcp/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L236)

**`Experimental`**

##### proposedWrites

> **proposedWrites**: `unknown`[]

Defined in: [mcp/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L237)

**`Experimental`**

##### gaps?

> `optional` **gaps?**: `string`[]

Defined in: [mcp/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L238)

**`Experimental`**

##### notes?

> `optional` **notes?**: `string`

Defined in: [mcp/types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L239)

**`Experimental`**

***

### DelegationStatusResult

Defined in: [mcp/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L244)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L245)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L246)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L247)

**`Experimental`**

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

Defined in: [mcp/types.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L248)

**`Experimental`**

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

Defined in: [mcp/types.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L249)

**`Experimental`**

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

Defined in: [mcp/types.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L250)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L251)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L252)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:253](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L253)

**`Experimental`**

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

Defined in: [mcp/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L255)

**`Experimental`**

Compact loop-trace span tree; present only when `includeTrace: true` was passed and spans were recorded.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

Defined in: [mcp/types.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L257)

**`Experimental`**

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L259)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [mcp/types.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L261)

**`Experimental`**

Caller span that dispatched the delegation, when one was inherited.

***

### DelegationHistoryArgs

Defined in: [mcp/types.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L265)

**`Experimental`**

#### Properties

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L266)

**`Experimental`**

##### profile?

> `optional` **profile?**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L267)

**`Experimental`**

##### since?

> `optional` **since?**: `string`

Defined in: [mcp/types.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L269)

**`Experimental`**

ISO date — only delegations started at-or-after `since` are returned.

##### limit?

> `optional` **limit?**: `number`

Defined in: [mcp/types.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L271)

**`Experimental`**

Default 50. Hard cap 500.

***

### DelegationFeedbackSnapshot

Defined in: [mcp/types.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L275)

**`Experimental`**

#### Properties

##### id

> **id**: `string`

Defined in: [mcp/types.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L276)

**`Experimental`**

##### score

> **score**: `number`

Defined in: [mcp/types.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L277)

**`Experimental`**

##### label?

> `optional` **label?**: `"good"` \| `"bad"` \| `"neutral"` \| `"mixed"`

Defined in: [mcp/types.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L278)

**`Experimental`**

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

Defined in: [mcp/types.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L279)

**`Experimental`**

##### notes

> **notes**: `string`

Defined in: [mcp/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L280)

**`Experimental`**

##### capturedAt

> **capturedAt**: `string`

Defined in: [mcp/types.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L281)

**`Experimental`**

***

### DelegationHistoryEntry

Defined in: [mcp/types.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L285)

**`Experimental`**

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [mcp/types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L286)

**`Experimental`**

##### profile

> **profile**: [`DelegationProfile`](#delegationprofile)

Defined in: [mcp/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L287)

**`Experimental`**

##### namespace?

> `optional` **namespace?**: `string`

Defined in: [mcp/types.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L288)

**`Experimental`**

##### args

> **args**: [`DelegateCodeArgs`](#delegatecodeargs) \| [`DelegateUiAuditArgs`](#delegateuiauditargs) \| [`DelegateResearchArgs`](#delegateresearchargs)

Defined in: [mcp/types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L289)

**`Experimental`**

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

Defined in: [mcp/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L290)

**`Experimental`**

##### feedback?

> `optional` **feedback?**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

Defined in: [mcp/types.ts:291](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L291)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [mcp/types.ts:292](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L292)

**`Experimental`**

##### startedAt

> **startedAt**: `string`

Defined in: [mcp/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L293)

**`Experimental`**

##### completedAt?

> `optional` **completedAt?**: `string`

Defined in: [mcp/types.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L294)

**`Experimental`**

##### hasTrace

> **hasTrace**: `boolean`

Defined in: [mcp/types.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L300)

**`Experimental`**

True when the record carries a journaled loop trace. History stays
light by design — fetch the spans via
`delegation_status { taskId, includeTrace: true }`.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [mcp/types.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L302)

**`Experimental`**

Inherited trace identity recorded at submit — join key into the caller's trace.

***

### DelegationHistoryResult

Defined in: [mcp/types.ts:306](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L306)

**`Experimental`**

#### Properties

##### delegations

> **delegations**: [`DelegationHistoryEntry`](#delegationhistoryentry)[]

Defined in: [mcp/types.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L307)

**`Experimental`**

***

### WorktreeHandle

Defined in: [mcp/worktree.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L21)

**`Experimental`**

#### Properties

##### path

> **path**: `string`

Defined in: [mcp/worktree.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L23)

**`Experimental`**

Absolute path to the worktree directory.

##### baseSha

> **baseSha**: `string`

Defined in: [mcp/worktree.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L25)

**`Experimental`**

SHA the worktree was created at.

##### branch

> **branch**: `string`

Defined in: [mcp/worktree.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L27)

**`Experimental`**

Branch name created for this worktree (typically `delegate/<runId>`).

***

### CreateWorktreeOptions

Defined in: [mcp/worktree.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L31)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L33)

**`Experimental`**

Absolute path to the main git checkout.

##### runId

> **runId**: `string`

Defined in: [mcp/worktree.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L35)

**`Experimental`**

Unique id for the worktree path + branch. Use the delegation run id.

##### variantsDir?

> `optional` **variantsDir?**: `string`

Defined in: [mcp/worktree.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L37)

**`Experimental`**

Parent directory the worktree lives under. Defaults to `.agent-worktrees`.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L39)

**`Experimental`**

Override the base ref (default `HEAD`).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L41)

**`Experimental`**

Test seam — inject a custom git runner.

***

### DiffOptions

Defined in: [mcp/worktree.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L45)

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

Defined in: [mcp/worktree.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L47)

**`Experimental`**

Worktree to diff.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [mcp/worktree.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L49)

**`Experimental`**

What to compare against. Default `worktree.baseSha`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L51)

**`Experimental`**

Test seam.

***

### DiffResult

Defined in: [mcp/worktree.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L55)

**`Experimental`**

#### Properties

##### patch

> **patch**: `string`

Defined in: [mcp/worktree.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L56)

**`Experimental`**

##### stats

> **stats**: `object`

Defined in: [mcp/worktree.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L57)

**`Experimental`**

###### filesChanged

> **filesChanged**: `number`

###### insertions

> **insertions**: `number`

###### deletions

> **deletions**: `number`

***

### RemoveWorktreeOptions

Defined in: [mcp/worktree.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L65)

**`Experimental`**

#### Properties

##### worktree

> **worktree**: [`WorktreeHandle`](#worktreehandle)

Defined in: [mcp/worktree.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L66)

**`Experimental`**

##### repoRoot

> **repoRoot**: `string`

Defined in: [mcp/worktree.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L67)

**`Experimental`**

##### force?

> `optional` **force?**: `boolean`

Defined in: [mcp/worktree.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L69)

**`Experimental`**

Force removal even if dirty (default true; the loser of a fanout has uncommitted changes).

##### runGit?

> `optional` **runGit?**: [`GitRunner`](#gitrunner)

Defined in: [mcp/worktree.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L71)

**`Experimental`**

Test seam.

## Type Aliases

### CoderDelegate

> **CoderDelegate** = (`args`, `ctx`) => `Promise`\<`CoderOutput`\>

Defined in: [mcp/delegates.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L80)

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

Defined in: [mcp/delegates.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L91)

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

Defined in: [mcp/delegates.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L116)

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

Defined in: [mcp/delegates.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L129)

**`Experimental`**

Winner-selection strategy among validated (+ reviewed) candidates on the
sandbox-session path. The base strategies (`highest-score` / `smallest-diff` /
`first-approved`) delegate to the shared `selectValidWinner`; `highest-readiness` is the
reviewer-only strategy this path keeps that the generic selector does not express. Default
`highest-score`.

***

### DriveTurnTick

> **DriveTurnTick** = \{ `state`: `"completed"`; `text`: `string`; `result`: `Record`\<`string`, `unknown`\>; \} \| \{ `state`: `"running"`; `startedAt?`: `Date`; `elapsedMs?`: `number`; \} \| \{ `state`: `"failed"`; `error`: `string`; \}

Defined in: [mcp/detached-turn.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L53)

**`Experimental`**

Structural mirror of the sandbox SDK's `TurnDriveResult` (>= 0.6).
Discriminated on `state`; `failed` is terminal and deterministic per the
SDK contract — re-invoking with the same ids returns the same outcome.

***

### LocalHarness

> **LocalHarness** = `"claude"` \| `"codex"` \| `"opencode"`

Defined in: [mcp/local-harness.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L23)

Local coding harness available inside the sandbox.

***

### DelegationResumeTick

> **DelegationResumeTick** = \{ `state`: `"running"`; \} \| \{ `state`: `"completed"`; `output`: [`DelegationResultPayload`](#delegationresultpayload)\[`"output"`\]; `costUsd?`: `number`; \} \| \{ `state`: `"failed"`; `error`: [`DelegationError`](#delegationerror); \}

Defined in: [mcp/task-queue.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L171)

**`Experimental`**

One observation of a detached run, mapped 1:1 from a single-tick driver
(e.g. the sandbox SDK's `driveTurn`, which reports
completed | running | failed per pass). `running` schedules another tick
after `intervalMs`; `completed` / `failed` settle the record.

***

### QuestionDecision

> **QuestionDecision** = \{ `kind`: `"answer"`; `answer`: `string`; `by`: `string`; \} \| \{ `kind`: `"defer"`; `reason`: `string`; \} \| \{ `kind`: `"escalate"`; `to`: `"parent"` \| `"user"` \| `string`; `reason`: `string`; \}

Defined in: [mcp/tools/coordination.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L48)

***

### QuestionPolicy

> **QuestionPolicy** = `"auto"` \| `"mustDecide"` \| `"bubble"` \| `"failClosed"`

Defined in: [mcp/tools/coordination.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L60)

***

### MakeWorkerAgent

> **MakeWorkerAgent** = (`profile`) => [`Agent`](runtime.md#agent)\<`unknown`, `unknown`\>

Defined in: [mcp/tools/coordination.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L92)

#### Parameters

##### profile

`unknown`

#### Returns

[`Agent`](runtime.md#agent)\<`unknown`, `unknown`\>

***

### DelegateResult

> **DelegateResult** = \{ `status`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \} \| \{ `status`: `"no-winner"`; `reason`: `string`; `spentTotal`: [`Spend`](runtime.md#spend); \}

Defined in: [mcp/tools/delegate.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L101)

The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 the no-winner reason) PLUS the conserved spend of the whole delegation.

***

### DelegationProfile

> **DelegationProfile** = `"coder"` \| `"researcher"` \| `"ui-auditor"`

Defined in: [mcp/types.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L21)

**`Experimental`**

***

### DelegationStatus

> **DelegationStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

Defined in: [mcp/types.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L24)

**`Experimental`**

***

### ResearchSource

> **ResearchSource** = `"web"` \| `"corpus"` \| `"twitter"` \| `"github"` \| `"docs"`

Defined in: [mcp/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L69)

**`Experimental`**

***

### DelegationResultPayload

> **DelegationResultPayload** = \{ `profile`: `"coder"`; `output`: `CoderOutput`; \} \| \{ `profile`: `"researcher"`; `output`: [`ResearchOutputShape`](#researchoutputshape); \} \| \{ `profile`: `"ui-auditor"`; `output`: [`UiAuditorDelegationOutput`](#uiauditordelegationoutput); \}

Defined in: [mcp/types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/types.ts#L156)

**`Experimental`**

Polymorphic `result` field: `CoderOutput` when the underlying profile
is `'coder'`, a structurally-typed research output when `'researcher'`.
The MCP wire carries it as JSON either way.

***

### GitRunner

> **GitRunner** = (`args`, `opts`) => `object`

Defined in: [mcp/worktree.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L75)

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

Defined in: [mcp/delegation-trace.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L45)

**`Experimental`**

Default cap on spans retained per delegation record.

***

### DELEGATION\_TRACE\_MAX\_BYTES

> `const` **DELEGATION\_TRACE\_MAX\_BYTES**: `number`

Defined in: [mcp/delegation-trace.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L48)

**`Experimental`**

Default cap on the serialized trace payload per record, in bytes.

***

### defaultChecks

> `const` **defaultChecks**: `Record`\<`string`, [`Check`](#check)\>

Defined in: [mcp/tools/checks.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L93)

The built-in lens directory. Domain-blind (about any agent trace); compose at test time.

***

### DELEGATE\_FEEDBACK\_TOOL\_NAME

> `const` **DELEGATE\_FEEDBACK\_TOOL\_NAME**: `"delegate_feedback"` = `'delegate_feedback'`

Defined in: [mcp/tools/delegate-feedback.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L24)

**`Experimental`**

***

### DELEGATE\_FEEDBACK\_DESCRIPTION

> `const` **DELEGATE\_FEEDBACK\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate-feedback.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L27)

**`Experimental`**

***

### DELEGATE\_FEEDBACK\_INPUT\_SCHEMA

> `const` **DELEGATE\_FEEDBACK\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-feedback.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L51)

**`Experimental`**

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

***

### DELEGATE\_UI\_AUDIT\_DESCRIPTION

> `const` **DELEGATE\_UI\_AUDIT\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate-ui-audit.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L33)

**`Experimental`**

***

### DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA

> `const` **DELEGATE\_UI\_AUDIT\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate-ui-audit.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-ui-audit.ts#L86)

**`Experimental`**

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

Defined in: [mcp/tools/delegate.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L29)

**`Experimental`**

***

### DELEGATE\_DESCRIPTION

> `const` **DELEGATE\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegate.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L32)

**`Experimental`**

***

### DELEGATE\_INPUT\_SCHEMA

> `const` **DELEGATE\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegate.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L50)

**`Experimental`**

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

Defined in: [mcp/tools/delegation-history.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L17)

**`Experimental`**

***

### DELEGATION\_HISTORY\_DESCRIPTION

> `const` **DELEGATION\_HISTORY\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegation-history.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L20)

**`Experimental`**

***

### DELEGATION\_HISTORY\_INPUT\_SCHEMA

> `const` **DELEGATION\_HISTORY\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-history.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L41)

**`Experimental`**

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

Defined in: [mcp/tools/delegation-status.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L16)

**`Experimental`**

***

### DELEGATION\_STATUS\_DESCRIPTION

> `const` **DELEGATION\_STATUS\_DESCRIPTION**: `string`

Defined in: [mcp/tools/delegation-status.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L19)

**`Experimental`**

***

### DELEGATION\_STATUS\_INPUT\_SCHEMA

> `const` **DELEGATION\_STATUS\_INPUT\_SCHEMA**: `object`

Defined in: [mcp/tools/delegation-status.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L41)

**`Experimental`**

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

> `readonly` **description**: `"Returned by delegate_code / delegate_research."` = `'Returned by delegate_code / delegate_research.'`

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

Defined in: [mcp/bin-helpers.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/bin-helpers.ts#L46)

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

Defined in: [mcp/delegates.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L217)

**`Experimental`**

Build the sandbox-session coder delegate. It drives `runLoop` against the project's
sandbox client + coder profile; when `args.variants > 1` it switches to the multi-harness fanout
topology.

This is the SANDBOX-SESSION coder path: workers run the in-box harness via the
`SandboxClient`'s `streamPrompt`, and single-variant turns can dispatch DETACHED
(driveTurn ticks) so a durable queue resumes them across an MCP restart — a substrate
the recursive worktree-CLI leaf does not yet have a journal-replay equivalent for.

For NEW local-repo coding use `worktreeFanout` / `worktreeLoopRunner` (author an `AgentProfile`
per harness → `createWorktreeCliExecutor` leaves → `gateOnDeliverable`). This delegate stays as the
MCP server's built-in `delegate_code` path; it runs held-stream by default and only its OPTIONAL
cross-restart resume (the `driveTurn` tick) is opt-in behind `MCP_ENABLE_DETACHED_RESUME`.

#### Parameters

##### options

[`DetachedSessionDelegateOptions`](#detachedsessiondelegateoptions)

#### Returns

[`CoderDelegate`](#coderdelegate)

***

### coderTaskFromArgs()

> **coderTaskFromArgs**(`args`): [`CoderTask`](profiles.md#codertask)

Defined in: [mcp/delegates.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L426)

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

Defined in: [mcp/delegates.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegates.ts#L464)

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

Defined in: [mcp/delegation-trace.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L73)

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

Defined in: [mcp/delegation-trace.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L97)

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

Defined in: [mcp/delegation-trace.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L130)

**`Experimental`**

#### Parameters

##### onSpans

(`spans`) => `void`

#### Returns

[`DelegationTraceCollector`](#delegationtracecollector)

***

### composeLoopTraceEmitters()

> **composeLoopTraceEmitters**(...`emitters`): [`LoopTraceEmitter`](runtime.md#looptraceemitter) \| `undefined`

Defined in: [mcp/delegation-trace.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/delegation-trace.ts#L184)

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

Defined in: [mcp/detached-turn.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L95)

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

Defined in: [mcp/detached-turn.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L103)

**`Experimental`**

Inverse of [formatDetachedSessionRef](#formatdetachedsessionref); throws `ValidationError` on malformed input.

#### Parameters

##### raw

`string`

#### Returns

[`DetachedSessionRefParts`](#detachedsessionrefparts)

***

### detachedTurnEvents()

> **detachedTurnEvents**(`sessionId`, `turn`): `SandboxEvent`[]

Defined in: [mcp/detached-turn.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L150)

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

Defined in: [mcp/detached-turn.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L211)

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

Defined in: [mcp/detached-turn.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/detached-turn.ts#L415)

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

Defined in: [mcp/executor.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L54)

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

Defined in: [mcp/executor.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/executor.ts#L116)

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

Defined in: [mcp/in-process-executor.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/in-process-executor.ts#L87)

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

Defined in: [mcp/kb-gate.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/kb-gate.ts#L137)

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

Defined in: [mcp/local-harness.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/local-harness.ts#L179)

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

### createMcpServer()

> **createMcpServer**(`options?`): [`McpServer`](#mcpserver)

Defined in: [mcp/server.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L150)

**`Experimental`**

#### Parameters

##### options?

[`McpServerOptions`](#mcpserveroptions) = `{}`

#### Returns

[`McpServer`](#mcpserver)

***

### createInProcessTransport()

> **createInProcessTransport**(): `object`

Defined in: [mcp/server.ts:334](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/server.ts#L334)

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

Defined in: [mcp/task-queue.ts:799](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/task-queue.ts#L799)

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

Defined in: [mcp/tools/checks.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L143)

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

Defined in: [mcp/tools/checks.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L183)

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

Defined in: [mcp/tools/checks.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L219)

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

Defined in: [mcp/tools/checks.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/checks.ts#L271)

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

Defined in: [mcp/tools/coordination.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L154)

Build the driver's MCP tools over a live scope.

#### Parameters

##### opts

[`CoordinationToolsOptions`](#coordinationtoolsoptions)

#### Returns

[`CoordinationTools`](#coordinationtools)

***

### validateDelegateFeedbackArgs()

> **validateDelegateFeedbackArgs**(`raw`): [`DelegateFeedbackArgs`](#delegatefeedbackargs)

Defined in: [mcp/tools/delegate-feedback.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L82)

**`Experimental`**

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegateFeedbackArgs`](#delegatefeedbackargs)

***

### createDelegateFeedbackHandler()

> **createDelegateFeedbackHandler**(`options`): (`raw`) => `Promise`\<[`DelegateFeedbackResult`](#delegatefeedbackresult)\>

Defined in: [mcp/tools/delegate-feedback.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate-feedback.ts#L159)

**`Experimental`**

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

#### Parameters

##### options

`DelegateUiAuditHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegateUiAuditResult`](#delegateuiauditresult)\>

***

### validateDelegateArgs()

> **validateDelegateArgs**(`raw`): [`DelegateArgs`](#delegateargs)

Defined in: [mcp/tools/delegate.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L78)

**`Experimental`**

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegateArgs`](#delegateargs)

***

### createDelegateHandler()

> **createDelegateHandler**(`options`): (`raw`) => `Promise`\<[`DelegateResult`](#delegateresult)\>

Defined in: [mcp/tools/delegate.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegate.ts#L139)

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

Defined in: [mcp/tools/delegation-history.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L53)

**`Experimental`**

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegationHistoryArgs`](#delegationhistoryargs)

***

### createDelegationHistoryHandler()

> **createDelegationHistoryHandler**(`options`): (`raw`) => `Promise`\<[`DelegationHistoryResult`](#delegationhistoryresult)\>

Defined in: [mcp/tools/delegation-history.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-history.ts#L94)

**`Experimental`**

#### Parameters

##### options

`DelegationHistoryHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegationHistoryResult`](#delegationhistoryresult)\>

***

### validateDelegationStatusArgs()

> **validateDelegationStatusArgs**(`raw`): [`DelegationStatusArgs`](#delegationstatusargs)

Defined in: [mcp/tools/delegation-status.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L56)

**`Experimental`**

#### Parameters

##### raw

`unknown`

#### Returns

[`DelegationStatusArgs`](#delegationstatusargs)

***

### createDelegationStatusHandler()

> **createDelegationStatusHandler**(`options`): (`raw`) => `Promise`\<[`DelegationStatusResult`](#delegationstatusresult)\>

Defined in: [mcp/tools/delegation-status.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/delegation-status.ts#L81)

**`Experimental`**

#### Parameters

##### options

`DelegationStatusHandlerOptions`

#### Returns

(`raw`) => `Promise`\<[`DelegationStatusResult`](#delegationstatusresult)\>

***

### readTraceContextFromEnv()

> **readTraceContextFromEnv**(): [`TraceContext`](#tracecontext-2)

Defined in: [mcp/trace-propagation.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L35)

Read trace context from the process environment.
Returns a context with inherited ids or a freshly generated root.

#### Returns

[`TraceContext`](#tracecontext-2)

***

### createPropagatingTraceEmitter()

> **createPropagatingTraceEmitter**(`ctx`): `object`

Defined in: [mcp/trace-propagation.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L48)

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

Defined in: [mcp/trace-propagation.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/trace-propagation.ts#L85)

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

Defined in: [mcp/worktree.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L113)

**`Experimental`**

#### Parameters

##### options

[`CreateWorktreeOptions`](#createworktreeoptions)

#### Returns

`Promise`\<[`WorktreeHandle`](#worktreehandle)\>

***

### captureWorktreeDiff()

> **captureWorktreeDiff**(`options`): `Promise`\<[`DiffResult`](#diffresult)\>

Defined in: [mcp/worktree.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L133)

**`Experimental`**

#### Parameters

##### options

[`DiffOptions`](#diffoptions)

#### Returns

`Promise`\<[`DiffResult`](#diffresult)\>

***

### removeWorktree()

> **removeWorktree**(`options`): `Promise`\<`void`\>

Defined in: [mcp/worktree.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree.ts#L173)

**`Experimental`**

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

### CoordinationEvent

Re-exports [CoordinationEvent](runtime.md#coordinationevent)
