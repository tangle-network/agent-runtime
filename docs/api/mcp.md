[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / mcp

# mcp

## Classes

### FileDelegationStore

**`Stable`**

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

###### Parameters

###### options

[`FileDelegationStoreOptions`](#filedelegationstoreoptions)

###### Returns

[`FileDelegationStore`](#filedelegationstore)

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

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

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`DelegationStore`](#delegationstore).[`remove`](#remove)

***

### DelegationTaskQueue

**`Stable`**

In-process queue for async delegation tasks — submit, cancel, poll status, and read history.

#### Constructors

##### Constructor

> **new DelegationTaskQueue**(`options?`): [`DelegationTaskQueue`](#delegationtaskqueue)

###### Parameters

###### options?

[`DelegationTaskQueueOptions`](#delegationtaskqueueoptions) = `{}`

###### Returns

[`DelegationTaskQueue`](#delegationtaskqueue)

#### Methods

##### restore()

> `static` **restore**(`options?`): `Promise`\<[`DelegationTaskQueue`](#delegationtaskqueue)\>

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

Query the recorded delegations. Returns entries newest-first (by
`startedAt`), truncated to `limit`.

###### Parameters

###### args?

[`DelegationHistoryArgs`](#delegationhistoryargs) = `{}`

###### Returns

[`DelegationHistoryEntry`](#delegationhistoryentry)[]

##### flush()

> **flush**(): `Promise`\<`void`\>

Await every journal write issued so far. Rejects with the recorded
`DelegationPersistenceError` when any of them failed. Call before
handing the store's backing file to another process.

###### Returns

`Promise`\<`void`\>

##### inflightCount()

> **inflightCount**(): `number`

Test-only — number of in-flight (non-terminal) records.

###### Returns

`number`

## Interfaces

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

##### readiness

> **readiness**: `number`

**`Experimental`**

Readiness 0..1, used by the `highest-readiness` winner-selection strategy.

##### notes?

> `optional` **notes?**: `string`

**`Experimental`**

The reviewer's own words. Selection reads `approved` and `readiness`; anything a reviewer
 wants a caller to READ belongs here, because nothing else on this type is surfaced.

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

##### workerProfile

> **workerProfile**: `AgentProfile`

**`Experimental`**

The worker's exact authored `AgentProfile` (§1.5: the system authors profiles). It is the sole
harness/provider/model/prompt authority for the single-coder path and the default identity for
repeated fanout shots.

##### fanoutProfiles?

> `optional` **fanoutProfiles?**: readonly `AgentProfile`[]

**`Experimental`**

Optional exact identities for heterogeneous fanout. Omit to repeat `workerProfile`.

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

### DelegationStore

**`Stable`**

#### Methods

##### loadAll()

> **loadAll**(): `Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

Read every persisted record. Called once, by
`DelegationTaskQueue.restore`, before any write. A missing backing
file is an empty store; an unparseable one throws
`DelegationStateCorruptError`.

###### Returns

`Promise`\<[`DelegationRecord`](#delegationrecord)[]\>

##### upsert()

> **upsert**(`record`): `Promise`\<`void`\>

Insert or replace the record keyed by `record.taskId`.

###### Parameters

###### record

[`DelegationRecord`](#delegationrecord)

###### Returns

`Promise`\<`void`\>

##### lookupIdempotencyKey()

> **lookupIdempotencyKey**(`key`): `Promise`\<`string` \| `undefined`\>

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

Delete the named records — the retention-cap eviction path.

###### Parameters

###### taskIds

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### DelegationPersistenceError

**`Stable`**

A delegation-store read or write failed (filesystem error, store
called before `loadAll`, ...). Once the queue observes one, it stops
accepting new submissions — accepting work it cannot journal would
silently demote durable mode to in-memory mode.

#### Extends

- `AgentEvalError`

***

### FileDelegationStoreOptions

**`Stable`**

#### Properties

##### filePath

> **filePath**: `string`

Absolute path of the JSON state file. Parent directories are created on first write.

##### recoverCorrupt?

> `optional` **recoverCorrupt?**: `boolean`

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
and cost figures are structurally unavailable; zero observed subtotals are
marked incomplete under this driver tag.

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

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### refersTo

> **refersTo**: [`FeedbackRefersTo`](#feedbackrefersto)

##### rating

> **rating**: [`FeedbackRating`](#feedbackrating)

##### by

> **by**: `"agent"` \| `"user"` \| `"downstream-judge"`

##### capturedAt

> **capturedAt**: `string`

##### namespace?

> `optional` **namespace?**: `string`

***

### FeedbackStore

**`Stable`**

#### Methods

##### put()

> **put**(`event`): `Promise`\<`void`\>

Append a new event. Never dedupes — every rating is its own event.

###### Parameters

###### event

[`FeedbackEvent`](#feedbackevent)

###### Returns

`Promise`\<`void`\>

##### list()

> **list**(`filter?`): `Promise`\<[`FeedbackEvent`](#feedbackevent)[]\>

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

Optional wall-clock cap per harness subprocess (ms). Omit it for no timer.

##### postCheckTimeoutMs?

> `optional` **postCheckTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per test/typecheck subprocess (ms). Default 2min.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](runtime.md#gitrunner)

**`Experimental`**

Test seam — override the git runner used by the worktree helpers.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](runtime.md#localharnessresult)\>

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

`Promise`\<[`LocalHarnessResult`](runtime.md#localharnessresult)\>

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

Allow autonomous edits without an interactive approval gate, using whichever bypass argv the
 harness declares. Use only when `cwd` is an isolated candidate worktree.

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

Optional wall-clock kill deadline (ms). Omit it for no timer. A positive value sends
 SIGTERM on expiry.

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

### McpToolAnnotations

**`Experimental`**

MCP tool annotations (protocol 2025-03-26 and later). Hints a client reads
before calling, for example to run a read-only tool without confirmation.
They describe the tool; they do not enforce anything.

#### Properties

##### title?

> `optional` **title?**: `string`

**`Experimental`**

##### readOnlyHint?

> `optional` **readOnlyHint?**: `boolean`

**`Experimental`**

The tool does not modify its environment.

##### destructiveHint?

> `optional` **destructiveHint?**: `boolean`

**`Experimental`**

The tool may perform destructive updates. Meaningful only when not read-only.

##### idempotentHint?

> `optional` **idempotentHint?**: `boolean`

**`Experimental`**

Repeating a call with the same arguments has no additional effect.

##### openWorldHint?

> `optional` **openWorldHint?**: `boolean`

**`Experimental`**

The tool may reach entities outside its own data, such as the web.

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

##### annotations?

> `optional` **annotations?**: [`McpToolAnnotations`](#mcptoolannotations)

**`Experimental`**

Published in `tools/list` when present.

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

Required to enable delegate_ui_audit. Wire one that executes an exact
agent profile through Runtime and returns the provider-neutral UI audit result.

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

**`Stable`**

Must be JSON-safe end to end (`args`, `result`, `error`, `feedback`) —
persistent stores round-trip records through `JSON.stringify`.

#### Properties

##### taskId

> **taskId**: `string`

##### profile

> **profile**: `"coder"` \| `"researcher"` \| `"ui-auditor"`

##### namespace?

> `optional` **namespace?**: `string`

##### args

> **args**: [`DelegationArgs`](#delegationargs)

##### status

> **status**: [`DelegationStatus`](#delegationstatus)

##### progress?

> `optional` **progress?**: [`DelegationProgress`](#delegationprogress)

##### result?

> `optional` **result?**: [`DelegationResultPayload`](#delegationresultpayload)

##### error?

> `optional` **error?**: [`DelegationError`](#delegationerror)

##### costUsd?

> `optional` **costUsd?**: `number`

##### startedAt

> **startedAt**: `string`

##### completedAt?

> `optional` **completedAt?**: `string`

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

Sha-prefix hash of the canonical input — used for idempotency lookup.

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Caller-generated deterministic id of a detached run (e.g. the sandbox
session id a single-tick driver resumes by). Presence is what makes a
restored in-flight record resumable via `resumeDelegate`; without it a
restart settles the record as failed.

##### feedback

> **feedback**: [`DelegationFeedbackSnapshot`](#delegationfeedbacksnapshot)[]

Feedback events keyed by this delegation's taskId.

##### trace?

> `optional` **trace?**: [`DelegationTraceSpan`](#delegationtracespan)[]

Compact loop-trace span tree teed from the delegation's run, oldest
spans first. Appended when a delegated loop reaches `loop.ended` and
settled (partial buffers included) at the terminal transition. Capped
via `capDelegationTrace` — see `traceTruncated`.

##### traceTruncated?

> `optional` **traceTruncated?**: `true`

Present when oldest trace spans were dropped to honor the trace caps.

##### traceId?

> `optional` **traceId?**: `string`

Inherited trace identity (the queue's `traceContext` at submit time —
typically `readTraceContextFromEnv()`), distinct from the span payload:
a journal consumer joins records into the parent trace by these ids
without parsing spans. Restored records keep their persisted identity.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Caller span that dispatched the delegation, when one was inherited.

***

### SubmitInput

**`Stable`**

#### Type Parameters

##### Args

`Args` *extends* [`DelegationArgs`](#delegationargs)

#### Properties

##### profile

> **profile**: `"coder"` \| `"researcher"` \| `"ui-auditor"`

##### args

> **args**: `Args`

##### namespace?

> `optional` **namespace?**: `string`

##### idempotencyKey?

> `optional` **idempotencyKey?**: `string`

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

Records the detached-run resume key on the new record. The submitted
`run` function still executes in-process exactly as without it — the
ref only matters after a restart, when `DelegationTaskQueue.restore`
hands it to the `resumeDelegate` seam instead of failing the record.

##### run

> **run**: (`ctx`) => `Promise`\<[`CoderOutput`](#coderoutput) \| [`UiAuditorDelegationOutput`](#uiauditordelegationoutput) \| [`ResearchOutputShape`](#researchoutputshape)\>

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

**`Stable`**

Context handed to a `SubmitInput.run` function.

#### Properties

##### signal

> **signal**: `AbortSignal`

##### detachedSessionRef?

> `optional` **detachedSessionRef?**: `string`

The `detachedSessionRef` recorded at submit, when one was supplied.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](runtime.md#looptraceemitter)

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

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

##### updateDetachedSessionRef()

> **updateDetachedSessionRef**(`ref`): `void`

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

**`Stable`**

#### Properties

##### taskId

> **taskId**: `string`

##### reused

> **reused**: `boolean`

True when a prior matching `idempotencyKey` returned an existing record.

***

### DelegationResumeContext

**`Stable`**

#### Properties

##### signal

> **signal**: `AbortSignal`

Fired by `cancel(taskId)`; the driver should stop the remote run when it can.

#### Methods

##### report()

> **report**(`progress`): `void`

###### Parameters

###### progress

[`DelegationProgress`](#delegationprogress)

###### Returns

`void`

***

### DelegationResumeDriver

**`Stable`**

Re-attaches restored in-flight records to their detached runs. The queue
calls `tick` repeatedly — it never awaits a whole run — so the driver can
be a thin wrapper over a one-pass primitive: resolve the run named by
`detachedSessionRef`, advance/poll it once, report where it stands. A
thrown error settles the record as failed; `failed` ticks are treated as
terminal and are not retried.

#### Properties

##### intervalMs?

> `optional` **intervalMs?**: `number`

Delay between `running` ticks, in milliseconds. Default 5000.

#### Methods

##### tick()

> **tick**(`task`, `ctx`): `Promise`\<[`DelegationResumeTick`](#delegationresumetick)\>

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

**`Stable`**

#### Properties

##### generateId?

> `optional` **generateId?**: () => `string`

ID generator override; default `randomTaskId`.

###### Returns

`string`

##### now?

> `optional` **now?**: () => `string`

Clock override; default `() => new Date().toISOString()`.

###### Returns

`string`

##### store?

> `optional` **store?**: [`DelegationStore`](#delegationstore)

Journal for record mutations and the `restore()` load source. Default
`InMemoryDelegationStore` — observably identical to an unjournaled
queue. Pass a `FileDelegationStore` through
`DelegationTaskQueue.restore` for state that survives a restart;
constructing with `new` never loads prior state.

##### resumeDelegate?

> `optional` **resumeDelegate?**: [`DelegationResumeDriver`](#delegationresumedriver)

Resume seam for restored in-flight records that carry a `detachedSessionRef`.

##### maxTerminalRecords?

> `optional` **maxTerminalRecords?**: `number`

Maximum number of terminal (completed | failed | cancelled) records
retained; the oldest (by `completedAt`) are evicted from memory and
store once the cap is exceeded. Default unbounded.

##### onPersistError?

> `optional` **onPersistError?**: (`error`) => `void`

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

### CoordinationToolsOptions

#### Properties

##### scope

> `readonly` **scope**: [`Scope`](runtime.md#scope-2)\<`unknown`\>

##### peerAudit?

> `readonly` `optional` **peerAudit?**: [`PeerAuditAccess`](testing.md#peerauditaccess)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

##### sourceEvidenceRefs?

> `readonly` `optional` **sourceEvidenceRefs?**: readonly `string`[]

Trusted immutable source refs this manager may read using its granted observe_agent tool.

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

##### perWorker

> `readonly` **perWorker**: [`Budget`](runtime.md#budget-10)

##### graphs?

> `readonly` `optional` **graphs?**: [`GraphSubtasks`](testing.md#graphsubtasks)

Serve `run_graph`, which starts an agent graph as one subtask under this manager's conserved
 pool. Present only when the run's worker path pins graph nodes; absent, the verb is not
 mounted and a profile that grants it is refused at construction.

##### onStop?

> `readonly` `optional` **onStop?**: (`reason`) => `void`

Called once when this manager declares completion through `stop` or an accepted submission.

###### Parameters

###### reason

`string` \| `undefined`

###### Returns

`void`

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

The same independent completion check used for workers. When present, the driver receives a
`submit_result` tool and may finish work itself instead of being forced to delegate it. The
first passing submission is retained; a false or throwing check fails closed. A manager with a
check is not served `stop`: it ends through `submit_result`, or when a bound ends the run.

##### readContinuation?

> `readonly` `optional` **readContinuation?**: (`continuation`) => `unknown`

Serve `read_continuation`: the full continuation files the note refers to. Supplied by the
 manager's continuation policy; the director's box cannot read the driver's run directory.

###### Parameters

###### continuation

`number` \| `undefined`

###### Returns

`unknown`

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](runtime.md#analystregistry)

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`, `record`) => `void` \| `Promise`\<`void`\>

Event-first for source compatibility; the second argument is its exact bus ordering stamp.

###### Parameters

###### event

[`CoordinationEvent`](runtime.md#coordinationevent)

###### record

[`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

##### replaySettlements?

> `readonly` `optional` **replaySettlements?**: `boolean`

Re-publish resumed settlements through the awaited observer before the driver starts. This is
 the crash-window recovery path for product transactions; off preserves low-level legacy reads.

##### authorizeDownMessage?

> `readonly` `optional` **authorizeDownMessage?**: [`AuthorizeDownMessage`](testing.md#authorizedownmessage)

Authorize each continuation against the exact worker identity. The returned instruction is
detached, recorded durably through `onEvent`, and only then delivered.

##### questionPolicy?

> `readonly` `optional` **questionPolicy?**: [`QuestionPolicy`](runtime.md#questionpolicy)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](durable.md#analyzeonsettleroute))[]

Analyst lenses run AUTOMATICALLY when a worker settles `done` (the analyst-on-settle hook).
 A bare string names a lens whose findings go to THE DRIVER: published as a `finding` event on
 the bus — pass-through to subscribers and queued for the driver's next wake. An
 [AnalyzeOnSettleRoute](durable.md#analyzeonsettleroute) generalizes the DESTINATION: findings can be delivered to a
 named live WORKER (wrapped in the route's directive, through the same authorized steer
 machinery a driver steer uses) instead of being hardwired to the spawning driver, and `over`
 restricts which settled workers feed the lens. A route carrying `agent` generalizes the
 ANALYST itself: a tool-equipped agent spawned as a worker whose settle output is the
 findings (see [AnalyzeOnSettleRoute.agent](durable.md#agent)). Omit/empty = no auto-analysis (default;
 the driver can still run lenses on demand via `run_analyst`). Lens routes require
 `analysts`; agent routes do not.

##### mapOnSettle?

> `readonly` `optional` **mapOnSettle?**: readonly [`MapOnSettleRoute`](durable.md#maponsettleroute)[]

Maps expanded by the runtime when their source settles (see [MapOnSettleRoute](durable.md#maponsettleroute)). Omit =
 none.

##### routeFlow?

> `readonly` `optional` **routeFlow?**: [`RouteFlow`](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination-route-contracts.ts)

The flow this manager runs (see [RouteFlow](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination-route-contracts.ts)): Runtime spawns its entries when the
 coordination opens and routes every settle of a flow node. Set only by `runGraph` for a graph
 with `entry`, whose manager makes no decision of its own. Omit = none.

##### decideGate?

> `readonly` `optional` **decideGate?**: [`DecideGate`](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination-route-contracts.ts)

Answers each visit to a gate of `routeFlow`. The route step awaits it, bounded by the run's
 deadline and abort signal. Set by `runGraph` from `RunGraphOptions.decideGate`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](durable.md#workerwatchoptions)

OPT-IN: run the ONLINE detector panel over each spawned worker's live tool trace and raise a
`finding` on the bus the moment a detector fires — so the driver learns "this worker is
looping" mid-run, in its next wake, instead of at settle.

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

##### priorQuestions?

> `readonly` `optional` **priorQuestions?**: readonly [`QuestionRecord`](runtime.md#questionrecord)[]

Questions carried over from a prior process of the SAME run (a durable coordination log a
resuming caller replays). Seeded into the question ledger verbatim — `list_questions` shows
them, the stop policy counts the still-blocking ones, and `answer_question` can decide them.
Omit/empty = fresh ledger (every run that is not a resume).

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](durable.md#continuitymode)\>\>

Default continuity per PROFILE NAME (the stable node identity a graph pins). A name mapping
to `'resume'` makes its spawns re-attach to the node's most recent settled worker whenever
one exists — the node's FIRST spawn is effectively `'fresh'`, and a spawn while a prior
worker of the node is still LIVE fails closed (`resume-while-live`; steer is the live-worker
channel). The spawn tool's per-call `continuity` argument overrides the declared default in
either direction. Omit = every spawn is `'fresh'` (status quo). Resume lineage is
PROCESS-LOCAL (the same boundary as the analyst-run marker): workers settled by a prior
process of a durable run are not resume targets.

##### peerMail?

> `readonly` `optional` **peerMail?**: `object`

OPT-IN: give this manager's workers a bounded SIBLING channel (`../../runtime/supervise/
peer-mail`). Each spawn is minted a capability endpoint handed out on
[WorkerSpawnContext.peerMailUrl](runtime.md#peermailurl); every attempt, delivered or refused, publishes a
`mail` event so the parent audits a channel it no longer relays. Omit = no peer channel and no
capability is minted (the status quo: a worker is reachable only by its parent).

###### limits?

> `readonly` `optional` **limits?**: `Partial`\<[`PeerMailLimits`](runtime.md#peermaillimits)\>

##### preflightSpawn?

> `readonly` `optional` **preflightSpawn?**: [`SpawnPreflight`](testing.md#spawnpreflight)

OPT-IN async gate run on every spawn BEFORE an assignment is minted, budget is reserved, or
`Scope.spawn` is called — the one pre-journal point where a network question may be asked.

`Scope.spawn` and `MakeWorkerAgent` are synchronous, so a check that needs the backend's
answer (does this bridge route the child's wire id; is it already at admission capacity)
cannot live there. Returning a [SpawnRefusal](testing.md#spawnrefusal) refuses the spawn as a tool result: no
assignment, no reservation, no journal entry, no worker — and the refusal is counted on
[CoordinationTools.stats](#stats) so a gate that never refuses is visible as such.

Returning `undefined` admits the spawn. A THROW is not a refusal: it propagates, because a
pre-flight that fails open would hand back exactly the silent admission it exists to stop.

##### resolveSpawnProfile?

> `readonly` `optional` **resolveSpawnProfile?**: (`profile`) => `AgentProfile`

OPT-IN pre-journal PROFILE resolution: maps the profile a driver authored to the profile that
will actually run, before `preflightSpawn` asks the backend about it. A layer that pins
profiles by name (an agent graph) installs this so the gate judges the canonical profile —
its real model, tools and harness — never the `{ name }` stub the driver wrote. Synchronous,
throw-on-refusal, identity-free: it sees only the profile, never the assignment or budget,
because both are minted AFTER the pre-journal point. Omit = the authored profile is used.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfile`

##### composeSpawnProfile?

> `readonly` `optional` **composeSpawnProfile?**: (`profile`) => `AgentProfile`

OPT-IN composition of the profile a manager authored, applied right after it parses and before
continuity, pre-flight, authorization, or the journal see it. The composed profile is the
child's profile: its identity, its receipt, and what runs. Pure and synchronous; its output is
re-validated against the canonical schema. `supervise({ profileGuidance: 'profile-kb' })`
installs `withProfileKb` here so each child carries its harness and model guidance.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfile`

##### profiles?

> `readonly` `optional` **profiles?**: `ReadonlyMap`\<`string`, [`SuperviseProfileEntry`](runtime.md#superviseprofileentry)\>

The run's profiles table, validated and frozen by `supervise` (`SuperviseRegistry.profiles`).
When it holds an entry, `spawn_worker` also takes `profile` as one of its names and lists the
names in its schema. The named profile replaces the authored one before composition,
continuity, pre-flight, authorization, or the journal see it. An authored profile whose `name`
is a table name is refused, so one name never means two profiles. Omit or empty = the tool is
unchanged.

##### spawnResourceRoot?

> `readonly` `optional` **spawnResourceRoot?**: `string`

Directory the coordination server may read on the manager's behalf when a spawn names an
inline resource by path (`{ kind: 'inline', name, path }` under `profile.resources`). The
server substitutes the file's bytes as `content` BEFORE the canonical schema sees the
profile, so the model's own output never carries them. Omit = a resource by path is refused
with the reason; see `spawn-resource-paths.ts` for the measurement that motivates it.

##### spawnResourceReader?

> `readonly` `optional` **spawnResourceReader?**: [`SpawnResourceReader`](#spawnresourcereader-1)

Where a by-path resource's bytes come from when the manager's workspace is NOT a directory
this process can open: a manager inside a provider sandbox, whose files only the provider can
serve. Built with `environmentReader(environment)` from the manager's own `AgentEnvironment`.
Takes precedence over `spawnResourceRoot` when both are set, because a sandbox manager's files
are on its box, not on this host. Omit and `spawnResourceRoot` applies as before.

##### escalateQuestion?

> `readonly` `optional` **escalateQuestion?**: [`EscalateQuestion`](durable.md#escalatequestion-2)

OPT-IN parent channel for `ask_parent`. See [EscalateQuestion](durable.md#escalatequestion-2).

Omit and this manager is treated as the TOP of its question chain: `ask_parent` still raises and
journals the question, and answers `escalated: false, outcome: 'no-parent'` so the manager knows
it must decide the question itself rather than wait.

##### onChildQuestionInbox?

> `readonly` `optional` **onChildQuestionInbox?**: (`inbox`) => `void`

Receives this manager's [ChildQuestionInbox](testing.md#childquestioninbox) once its tools exist, so Runtime can route
 a child manager's `ask_parent` here.

###### Parameters

###### inbox

[`ChildQuestionInbox`](testing.md#childquestioninbox)

###### Returns

`void`

##### priorEscalations?

> `readonly` `optional` **priorEscalations?**: readonly [`QuestionEscalationRecord`](runtime.md#questionescalationrecord)[]

Escalations this manager made in a PRIOR process of the same durable run
(`PriorCoordination.escalations`). Seeded verbatim, so after a restart `stop` still knows which
blocking questions reached no parent and still names the way out. Without it the record is
journaled, reloaded, and then forgotten by the only reader that acts on it.

##### redactJournal?

> `readonly` `optional` **redactJournal?**: `false` \| [`Redactor`](intelligence.md#redactor)

Domain scrub COMPOSED IN FRONT OF the built-in one for every event `read_journal` returns.

The journal quotes model-authored instruction text and worker output, either of which may carry
a credential the run was given, so the built-in scrub is not something a domain hook may switch
off by accident: `resolveRedactor` runs the custom redactor first and `defaultRedactor`
over its result — the same rule the rest of the runtime applies to trace values. Omit for the
default alone; pass `false` to opt out deliberately. A redactor that throws is a refusal for
that one row (it returns a `redaction-failed` marker), never a reason to return the raw event.

##### resolveProbeTool?

> `readonly` `optional` **resolveProbeTool?**: (`name`) => [`McpToolDescriptor`](#mcptooldescriptor) \| `undefined`

The served tools `report_blocked` may probe, by bare name: the coordination verbs plus the
node tools bound to this manager. The transport that serves both supplies it; without it the
probe reaches the coordination verbs only.

###### Parameters

###### name

`string`

###### Returns

[`McpToolDescriptor`](#mcptooldescriptor) \| `undefined`

##### priorJournal?

> `readonly` `optional` **priorJournal?**: readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

Rows written by PRIOR processes of this durable run (`PriorCoordination.records`), prepended to
the live bus so `read_journal` answers for the whole run rather than the current process.

Without it a resumed manager reads a nearly empty journal and concludes it tried nothing —
which is the exact failure the verb exists to prevent. The rows are marked `prior: true` and
are never re-published on the bus: they are evidence, not events to react to.

##### maxDefinedAnalysts?

> `readonly` `optional` **maxDefinedAnalysts?**: `number`

Hard cap on lenses THIS manager may define through `define_analyst`. Omit =
 `ANALYST_DEFINITION_BOUNDS.maxDefinitionsPerManager`; `<= 0` = no cap. Reached, the verb
 refuses with `error: 'max-defined-analysts'` and names the cap, so a manager that has been
 defining instead of investigating reads why.

##### priorAnalystDefinitions?

> `readonly` `optional` **priorAnalystDefinitions?**: readonly [`DefinedAnalystRecord`](runtime.md#definedanalystrecord)[]

Lenses this manager DEFINED in a prior process of the same durable run
(`PriorCoordination.analystDefinitions`). Seeded verbatim: they are on the menu again, they
count against [CoordinationToolsOptions.maxDefinedAnalysts](#maxdefinedanalysts), and re-defining one is a
`duplicate-analyst` refusal rather than a silent second registration. Re-registering them with
the analyst registry is the owner's decision, because the registry may have changed between
processes; this option only restores what the manager is allowed to believe it already wrote.

***

### CoordinationStats

Bus throughput plus the pre-flight's own refusal ledger.

#### Extends

- [`BusStats`](runtime.md#busstats)

#### Properties

##### preflight?

> `readonly` `optional` **preflight?**: `Readonly`\<`Record`\<[`SpawnRefusalCause`](#spawnrefusalcause), `number`\>\>

One counter per refusal cause, present only when a pre-flight is installed.

##### published

> `readonly` **published**: `number`

###### Inherited from

[`BusStats`](runtime.md#busstats).[`published`](runtime.md#published)

##### pulled

> `readonly` **pulled**: `number`

###### Inherited from

[`BusStats`](runtime.md#busstats).[`pulled`](runtime.md#pulled)

##### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Count published per event `type`.

###### Inherited from

[`BusStats`](runtime.md#busstats).[`byKind`](runtime.md#bykind)

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

##### peerMail?

> `readonly` `optional` **peerMail?**: [`PeerMailbox`](runtime.md#peermailbox)

The run's peer-mail post office, present only when `peerMail` was enabled. The transport
 layer stands the capability endpoint up over it; the parent reads `history()` for the audit
 trail and calls `stopThread` to end a peer exchange.

#### Methods

##### ready()

> **ready**(): `Promise`\<`void`\>

Commit any resume-time event replay before a supervisor can reason or an MCP can listen.

###### Returns

`Promise`\<`void`\>

##### isStopped()

> **isStopped**(): `boolean`

###### Returns

`boolean`

##### stopReason()

> **stopReason**(): `string` \| `undefined`

###### Returns

`string` \| `undefined`

##### submittedResult()

> **submittedResult**(): \{ `result`: `unknown`; \} \| `undefined`

The first result whose injected independent check passed, if the driver submitted one.

###### Returns

\{ `result`: `unknown`; \} \| `undefined`

##### settled()

> **settled**(): readonly [`SettledWorker`](runtime.md#settledworker)[]

###### Returns

readonly [`SettledWorker`](runtime.md#settledworker)[]

##### questions()

> **questions**(): readonly [`QuestionRecord`](runtime.md#questionrecord)[]

###### Returns

readonly [`QuestionRecord`](runtime.md#questionrecord)[]

##### escalations()

> **escalations**(): readonly [`QuestionEscalationRecord`](runtime.md#questionescalationrecord)[]

Every `ask_parent` escalation and what became of it, in raise order. An undelivered one is a
 question this run raised and nothing answered — the operator's read of a run that went quiet.

###### Returns

readonly [`QuestionEscalationRecord`](runtime.md#questionescalationrecord)[]

##### definedAnalysts()

> **definedAnalysts**(): readonly [`DefinedAnalystRecord`](runtime.md#definedanalystrecord)[]

Every lens this manager defined at run time, in definition order — the same records published
 as `analyst-defined` events. Empty when the registry admits no authored lens.

###### Returns

readonly [`DefinedAnalystRecord`](runtime.md#definedanalystrecord)[]

##### history()

> **history**(): readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

The full ordered log of every bus event — UP (settled / question / finding), authorized
 instruction receipts, and DOWN delivery outcomes (steer / answer). Each record carries seq,
 timestamp, and priority. A receipt is evidence and is never auto-delivered on restart.

###### Returns

readonly [`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](runtime.md#coordinationevent)\>[]

##### stats()

> **stats**(): [`CoordinationStats`](#coordinationstats)

Bus throughput counters (published / pulled / by-kind) for live dashboards, plus one
 counter per [SpawnRefusalCause](#spawnrefusalcause) the pre-flight refused. `preflight` is present
 whenever `preflightSpawn` is installed, with every cause at 0 until one fires — a gate that
 never refuses has to be readable as such.

###### Returns

[`CoordinationStats`](#coordinationstats)

##### raiseFinding()

> **raiseFinding**(`finding`): `Promise`\<`void`\>

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for the next wake + pass-through.

###### Parameters

###### finding

[`AnalystFindingEvent`](runtime.md#analystfindingevent)

###### Returns

`Promise`\<`void`\>

##### steerWorker()

> **steerWorker**(`workerId`, `instruction`, `options?`): `Promise`\<[`DownMessageEvent`](runtime.md#downmessageevent)\>

Authorize, durably record, and attempt one external steer through the same down-leg used by
`steer_agent`. The returned outcome is exact and is never inferred from queue admission.

###### Parameters

###### workerId

`string`

###### instruction

`string`

###### options?

###### interrupt?

`boolean`

###### Returns

`Promise`\<[`DownMessageEvent`](runtime.md#downmessageevent)\>

##### abortWorker()

> **abortWorker**(`ref`, `reason?`): \{ `id`: `string`; `label`: `string`; \} \| `undefined`

Abort ONE live worker this manager spawned, through the worker's own per-child abort chain
(the scope cascades that abort into the worker's subtree and no sibling). `ref` resolves
workerId-first, then profile name, then spawn label, against LIVE workers only. Returns the
resolved identity, or `undefined` when no live worker matches — an already-settled or unknown
reference is never reported as aborted. The runtime cancel acknowledger is the intended
caller; the durable contract around it lives in `supervise/run-layout`.

###### Parameters

###### ref

`string`

###### reason?

`string`

###### Returns

\{ `id`: `string`; `label`: `string`; \} \| `undefined`

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

##### finishAnalysis()

> **finishAnalysis**(`input`): `Promise`\<`void`\>

Await opted-in manager-end analyst agents inside the original scope and resource limits.
Their findings remain evidence and never replace the manager's output or enter its ledger.

###### Parameters

###### input

###### status

`"done"` \| `"down"`

###### output?

`unknown`

###### reason?

`string`

###### Returns

`Promise`\<`void`\>

##### beginDriverAttempt()

> **beginDriverAttempt**(`attempt`): `void`

Mark the start of one driver attempt, so deliveries are attributed to the turn that got them.

###### Parameters

###### attempt

`number`

###### Returns

`void`

##### endDriverAttempt()

> **endDriverAttempt**(`outcome`): `Promise`\<`void`\>

Mark the end of the current driver attempt. A completed turn acknowledges what it received;
 a failed one leaves its deliveries unacknowledged for the next re-entry to name.

###### Parameters

###### outcome

`"completed"` \| `"failed"`

###### Returns

`Promise`\<`void`\>

##### hasOpenWork()

> **hasOpenWork**(): `boolean`

True while this manager has work it must hear back about: a worker running, a result or
 question not yet delivered, or a tool call still running past its response fence. A turn
 that ends with open work is a wait, not a completion.

###### Returns

`boolean`

##### awaitWake()

> **awaitWake**(`input`): `Promise`\<[`ManagerWake`](#managerwake) \| `undefined`\>

Wait, with no model turn, until something reaches this manager's inbox, the heartbeat
 elapses, or the deadline warning comes due; then deliver everything that arrived. Undefined
 when no work is open or the signal aborted.

###### Parameters

###### input

[`AwaitWakeInput`](#awaitwakeinput)

###### Returns

`Promise`\<[`ManagerWake`](#managerwake) \| `undefined`\>

##### awaitSettlement()

> **awaitSettlement**(`workerIds`, `signal?`): `Promise`\<readonly `string`[]\>

Wait in code, with no model turn, until at least one of `workerIds` has settled into this
 manager's ledger; returns the ids that have. Nothing is taken from the inbox: the manager
 still receives each settlement in its own wake. Empty when none of them is live or settled.

###### Parameters

###### workerIds

readonly `string`[]

###### signal?

`AbortSignal`

###### Returns

`Promise`\<readonly `string`[]\>

##### receiveLeadMessage()

> **receiveLeadMessage**(`message`): `boolean`

Queue a steer or answer from this manager's lead for its next wake. False when the message
 is neither. The publish is in-process; a durable subscriber records it.

###### Parameters

###### message

`unknown`

###### Returns

`boolean`

##### openToolReceipt()

> **openToolReceipt**(`tool`): `string`

Register a tool call that outlived its response fence; returns the receipt its caller is
 given. The call is open work until [CoordinationTools.settleToolReceipt](#settletoolreceipt).

###### Parameters

###### tool

`string`

###### Returns

`string`

##### settleToolReceipt()

> **settleToolReceipt**(`receipt`, `outcome`): `Promise`\<`void`\>

Publish the outcome of a receipted tool call to the inbox, where the next wake delivers it.

###### Parameters

###### receipt

`string`

###### outcome

\{ `ok`: `true`; `value`: `unknown`; \} \| \{ `ok`: `false`; `error`: `unknown`; \}

###### Returns

`Promise`\<`void`\>

##### reentryState()

> **reentryState**(): [`ManagerReentryState`](runtime.md#managerreentrystate)

The run state a re-entered manager is told, read from this coordinator's own records.

###### Returns

[`ManagerReentryState`](runtime.md#managerreentrystate)

##### checkReads()

> **checkReads**(): readonly [`CheckRead`](#checkread)[]

Every time this manager's completion check ran, oldest first: each `submit_result`, and each
 turn end the manager recorded through [CoordinationTools.recordCheckRead](#recordcheckread).

###### Returns

readonly [`CheckRead`](#checkread)[]

##### recordCheckRead()

> **recordCheckRead**(`read`): [`CheckRead`](#checkread)

Record a check read that happened outside `submit_result`, such as a turn end.

###### Parameters

###### read

###### source

`"submit"` \| `"turn-end"`

###### verdict?

[`CheckVerdict`](runtime.md#checkverdict)

###### unavailable?

`string`

###### Returns

[`CheckRead`](#checkread)

##### blocked()

> **blocked**(): readonly [`BlockedToolReport`](runtime.md#blockedtoolreport)[]

Every `report_blocked` whose probe failed too, in report order. A blocked tool is evidence,
 not a terminal condition: the run goes on, and turns without progress pace it with longer
 barren pauses until the check, the deadline, the budget or a cancel ends it.

###### Returns

readonly [`BlockedToolReport`](runtime.md#blockedtoolreport)[]

***

### AwaitWakeInput

What a manager waits for, from `awaitWake`.

#### Properties

##### attempt?

> `readonly` `optional` **attempt?**: `number`

The driver attempt the wake will start: its deliveries are acknowledged when that turn
 completes, and named again on re-entry when it fails. Omit for the current attempt.

##### signal

> `readonly` **signal**: `AbortSignal`

##### heartbeatMs

> `readonly` **heartbeatMs**: `number`

Wake with no event after this long, so a waiting manager can reconsider.

##### quietWhileProgressing?

> `readonly` `optional` **quietWhileProgressing?**: `boolean`

The wake starts a model turn: a heartbeat that finds every live worker progressing is
 re-armed instead of returned. A caller that uses the heartbeat as a poll bound omits it.

##### debounceMs

> `readonly` **debounceMs**: `number`

After the first event, wait this long for more and deliver them together.

##### deadlineAt?

> `readonly` `optional` **deadlineAt?**: `number`

Epoch ms of a deadline warning: wake once then, with or without an event.

##### alsoWakeOn?

> `readonly` `optional` **alsoWakeOn?**: `Promise`\<`unknown`\>

Something outside the bus that also ends the wait, such as a delivery to the manager's own
 inbox.

***

### ManagerWake

One wake of a manager that ended its turn with work open.

#### Properties

##### reason

> `readonly` **reason**: `"deadline"` \| `"events"` \| `"heartbeat"`

`events`: something reached the inbox. `heartbeat`: the heartbeat elapsed with nothing new.
 `deadline`: the deadline warning came due.

##### events

> `readonly` **events**: readonly `Record`\<`string`, `unknown`\> & `object`[]

Everything that reached the inbox since the last turn, in bus order.

##### live

> `readonly` **live**: readonly `Record`\<`string`, `unknown`\>[]

Workers still running.

##### freeSlots

> `readonly` **freeSlots**: `number` \| `null`

How many more workers can start now; `null` when uncapped.

##### idleMs

> `readonly` **idleMs**: `number`

How long the manager waited, with no model turn, before this wake.

##### quietHeartbeats?

> `readonly` `optional` **quietHeartbeats?**: `number`

Heartbeats that elapsed with every live worker still progressing, and woke no turn.

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

- [`QuestionRecord`](runtime.md#questionrecord)

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

### DelegateError

What killed a delegation, projected for the calling agent: the rejection's name and message.
 `reason` is a four-word code (`driver-failed`), and a code alone is not diagnosable — the
 supervisor attaches the rejection to the result precisely so a caller can read it.

#### Properties

##### name

> **name**: `string`

##### message

> **message**: `string`

***

### DelegateHandlerOptions

**`Stable`**

#### Properties

##### router

> **router**: [`RouterTransportConfig`](runtime.md#routertransportconfig)

The supervisor brain's router substrate (REQUIRED — the default supervisor is router-brained).

##### supervisorProfile

> **supervisorProfile**: `AgentProfile`

Exact executable supervisor identity selected by the trusted composition root.

##### backend

> **backend**: [`ExecutorConfig`](runtime.md#executorconfig)

WHERE the authored workers run. Required for `supervise()` to spawn anything.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

The completion oracle the authored workers settle against (settled ⟺ delivered).

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

Restrict the run to this subset of models.

***

### SpawnResourceBytes

One successful read: the bytes as a string plus the identity the journal records.

#### Properties

##### content

> `readonly` **content**: `string`

##### byteLength

> `readonly` **byteLength**: `number`

##### sha256

> `readonly` **sha256**: `string`

***

### SpawnResourceReader

Where a by-path resource's bytes come from. `describe` names the source in a refusal so a
manager reading "path X does not exist under the workspace root" and "path X: sandbox read
failed" can tell which filesystem was consulted.

#### Properties

##### describe

> `readonly` **describe**: `string`

#### Methods

##### read()

> **read**(`path`): `Promise`\<[`SpawnResourceRead`](#spawnresourceread)\>

###### Parameters

###### path

`string`

###### Returns

`Promise`\<[`SpawnResourceRead`](#spawnresourceread)\>

***

### ResolvedSpawnResourcePath

#### Properties

##### at

> `readonly` **at**: `string`

The `resources` location, e.g. `files[0].resource` or `skills[2]`.

##### path

> `readonly` **path**: `string`

The path as the manager wrote it.

##### byteLength

> `readonly` **byteLength**: `number`

##### sha256

> `readonly` **sha256**: `string`

***

### TraceContext

#### Properties

##### traceId

> **traceId**: `string`

Trace id inherited from the parent process, or a fresh one.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Parent span id from the delegation that launched this MCP server.

##### unpropagated?

> `optional` **unpropagated?**: `boolean`

True when NO context reached this process and the trace id is a fallback mint — the hop
 above this process is severed. Span trees emitted under this context are stamped
 `tangle.trace.unpropagated=true` so the severed hop is queryable.

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

When > 1, dispatches `multiHarnessCoderFanout` across the delegate's configured exact profiles
and picks the highest-scoring passing patch. Default 1.

##### config?

> `optional` **config?**: [`DelegateCodeConfig`](#delegatecodeconfig)

**`Experimental`**

Validator + prompt overrides the agent knows for this repo.

##### namespace?

> `optional` **namespace?**: `string`

**`Experimental`**

Multi-tenant scope (customer-id, workspace-id).

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

> `optional` **sources?**: [`ResearchSource`](profiles.md#researchsource)[]

**`Experimental`**

##### variants?

> `optional` **variants?**: `number`

**`Experimental`**

##### config?

> `optional` **config?**: [`DelegateResearchConfig`](#delegateresearchconfig)

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

> `optional` **label?**: `"mixed"` \| `"good"` \| `"bad"` \| `"neutral"`

**`Experimental`**

##### notes

> **notes**: `string`

**`Experimental`**

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

> **profile**: `"coder"` \| `"researcher"` \| `"ui-auditor"`

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

> `optional` **profile?**: `"coder"` \| `"researcher"` \| `"ui-auditor"`

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

> `optional` **label?**: `"mixed"` \| `"good"` \| `"bad"` \| `"neutral"`

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

> **profile**: `"coder"` \| `"researcher"` \| `"ui-auditor"`

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

### CoderTask

**`Experimental`**

The per-task inputs `coderTaskToPrompt` renders + the worktree gate enforces.

#### Properties

##### goal

> **goal**: `string`

**`Experimental`**

What the agent must accomplish. Free-form prose.

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path inside the sandbox where the repo lives.

##### baseBranch?

> `optional` **baseBranch?**: `string`

**`Experimental`**

Default `main`. The branch the agent diffs against.

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Default `pnpm test --run`.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Default `pnpm typecheck`.

##### contextFiles?

> `optional` **contextFiles?**: `string`[]

**`Experimental`**

Files the agent may inspect for context. Surfaced verbatim in the prompt.

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

Paths the agent must not touch. The mechanical gate hard-fails on any match.
Use glob-free literal path prefixes for unambiguous enforcement.

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

Default 400. Hard cap; the gate hard-fails when exceeded.

***

### CheckRead

One time the check ran inside the run, whatever started it.

#### Properties

##### read

> `readonly` **read**: `number`

1-based count of check reads in this manager, the unavailable ones included.

##### attempt

> `readonly` **attempt**: `number`

The driver attempt the read belongs to.

##### at

> `readonly` **at**: `number`

Epoch ms.

##### source

> `readonly` **source**: `"submit"` \| `"turn-end"`

`submit`: a `submit_result` call. `turn-end`: the turn ended with no accepted result.

##### verdict?

> `readonly` `optional` **verdict?**: [`CheckVerdict`](runtime.md#checkverdict)

Absent when the check could not run.

##### unavailable?

> `readonly` `optional` **unavailable?**: `string`

Why the check could not run.

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
default factory because execution belongs to a caller-supplied exact
agent profile and Runtime executor.

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

[`CoderTask`](#codertask)

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

### LocalHarness

> **LocalHarness** = `Extract`\<`HarnessType`, `"claude-code"` \| `"codex"` \| `"opencode"` \| `"pi"`\>

Local coding harness available inside the sandbox — a narrowing of the shared `HarnessType`
vocabulary, NOT a private spelling of it. The harness id is `claude-code`; `claude` is the
EXECUTABLE name and lives only in the `command` field below. Keeping one vocabulary is what
lets a `LocalHarness` be handed straight to the profile materializer and the capability table
with no translation step.

***

### DelegationArgs

> **DelegationArgs** = [`DelegateCodeArgs`](#delegatecodeargs) \| [`DelegateResearchArgs`](#delegateresearchargs) \| [`DelegateUiAuditArgs`](#delegateuiauditargs)

**`Stable`**

Arguments accepted by the durable delegation queue.

***

### DelegationResumeTick

> **DelegationResumeTick** = \{ `state`: `"running"`; \} \| \{ `state`: `"completed"`; `output`: [`DelegationResultPayload`](#delegationresultpayload)\[`"output"`\]; `costUsd?`: `number`; \} \| \{ `state`: `"failed"`; `error`: [`DelegationError`](#delegationerror); \}

**`Stable`**

One observation of a detached run, mapped 1:1 from a single-tick driver
(e.g. the sandbox SDK's `driveTurn`, which reports
completed | running | failed per pass). `running` schedules another tick
after `intervalMs`; `completed` / `failed` settle the record.

***

### SpawnRefusalCause

> **SpawnRefusalCause** = `"model-route"` \| `"bridge-full"` \| `"unmountable-tool"` \| `"unprovisionable-profile"`

Why a pre-flight refused a spawn. Each cause is a distinct, separately countable decision.

***

### QuestionLevel

> **QuestionLevel** = `"worker"` \| `"driver"` \| `"loop"`

***

### QuestionUrgency

> **QuestionUrgency** = `"continue-without"` \| `"blocks-step"` \| `"blocks-run"`

***

### DelegateResult

> **DelegateResult** = \{ `status`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `spentTotal`: [`Spend`](runtime.md#spend-1); \} \| \{ `status`: `"no-winner"`; `reason`: `string`; `error?`: [`DelegateError`](#delegateerror); `spentTotal`: [`Spend`](runtime.md#spend-1); \}

The synchronous result the `delegate` tool returns to the calling agent: the delivered output (or
 the no-winner reason) PLUS the conserved spend of the whole delegation.

***

### SpawnResourceRead

> **SpawnResourceRead** = `object` & [`SpawnResourceBytes`](#spawnresourcebytes) \| \{ `ok`: `false`; `reason`: `string`; \}

***

### ResolveSpawnResourcePathsResult

> **ResolveSpawnResourcePathsResult** = \{ `ok`: `true`; `profile`: `unknown`; `resolved`: readonly [`ResolvedSpawnResourcePath`](#resolvedspawnresourcepath)[]; \} \| \{ `ok`: `false`; `at`: `string`; `reason`: `string`; \}

***

### DelegationStatus

> **DelegationStatus** = `"pending"` \| `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

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

## Variables

### LOCAL\_HARNESSES

> `const` **LOCAL\_HARNESSES**: readonly [`LocalHarness`](#localharness)[]

Every local harness, in table order — the one list `AGENT_RUNTIME_LOCAL_HARNESSES` and any
 other harness enumeration reads, so adding a row above is the only edit a new harness needs.

## Functions

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

### harnessNativeToolNames()

> **harnessNativeToolNames**(`harness`): readonly `string`[] \| `undefined`

The tool names `harness` publishes natively, or `undefined` when no list has been sourced for it.
The two are different facts and a caller must not read one as the other.

#### Parameters

##### harness

`"opencode"` \| `"claude-code"` \| `"kimi-code"` \| `"codex"` \| `"amp"` \| `"factory-droids"` \| `"pi"` \| `"prime"` \| `"hermes"` \| `"forge"` \| `"openclaw"` \| `"nanoclaw"` \| `"acp"` \| `"cursor"` \| `"cli-base"` \| `"gemini"`

#### Returns

readonly `string`[] \| `undefined`

***

### collidesWithHarnessNativeTool()

> **collidesWithHarnessNativeTool**(`name`): readonly (`"opencode"` \| `"claude-code"` \| `"codex"`)[]

The sourced harnesses that publish `name` natively — empty when the name is clear of all of them.

The comparison folds case. A model resolving a bare word out of a prompt does not hold the
harness's exact casing, so `task` and `Task` are one collision, not two distinct names.

#### Parameters

##### name

`string`

#### Returns

readonly (`"opencode"` \| `"claude-code"` \| `"codex"`)[]

***

### createInProcessExecutor()

> **createInProcessExecutor**(`options`): [`DelegationExecutor`](#delegationexecutor)

**`Experimental`**

Build an in-process executor. Returns a [DelegationExecutor](#delegationexecutor) whose `client.create()`
returns a minimal virtual `SandboxInstance`; the kernel calls `streamPrompt(msg)` on it, which
runs the shared worktree-harness core and emits one `result` event whose `data.result` is the
raw `WorktreeHarnessResult` (the content-addressed patch artifact). The authored profile
(`backend.profile`) threads its systemPrompt + model into the harness via the core.

There is no box, so a per-prompt `backend` or `model` override is refused rather than dropped;
other per-prompt options (`timeoutMs`, `context`) are accepted and ignored.

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

### createStdioToolServer()

> **createStdioToolServer**(`options`): [`StdioToolServer`](#stdiotoolserver)

Build the generic stdio JSON-RPC tool server.

#### Parameters

##### options

[`StdioToolServerOptions`](#stdiotoolserveroptions)

#### Returns

[`StdioToolServer`](#stdiotoolserver)

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

### environmentReader()

> **environmentReader**(`environment`): [`SpawnResourceReader`](#spawnresourcereader-1)

The environment reader: a manager running inside a provider environment whose `read()` serves
its own workspace. The provider owns containment — it will not serve a path outside the box —
but the relative-path and `..` rules are enforced here too, so the refusal names the rule the
manager broke rather than whatever the provider says about an escape it declined.

`read()` returns a string, so an environment cannot hand back bytes that are not UTF-8; the
provider has already decoded. The size bound is checked on what arrives.

#### Parameters

##### environment

###### id

`string`

###### read

#### Returns

[`SpawnResourceReader`](#spawnresourcereader-1)

***

### resolveSpawnResourcePaths()

> **resolveSpawnResourcePaths**(`profile`, `source`): `Promise`\<[`ResolveSpawnResourcePathsResult`](#resolvespawnresourcepathsresult)\>

Replace every `{ kind: 'inline', name, path }` under `profile.resources` with the inline
resource its bytes make. Returns the profile unchanged (same reference) when nothing names a
path, so callers pay nothing on the common case.

`source` is a host directory (a string, kept for the existing call sites), a
[SpawnResourceReader](#spawnresourcereader-1), or `undefined` when the manager has neither — in which case a path
is refused with the reason and what to do instead.

#### Parameters

##### profile

`unknown`

##### source

`string` \| [`SpawnResourceReader`](#spawnresourcereader-1) \| `undefined`

#### Returns

`Promise`\<[`ResolveSpawnResourcePathsResult`](#resolvespawnresourcepathsresult)\>

***

### readTraceContextFromEnv()

> **readTraceContextFromEnv**(`env?`): [`TraceContext`](#tracecontext-2)

Read trace context from a process environment (defaults to `process.env`).
`TRACEPARENT` wins; the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair is the fallback; with
neither present a fresh root is generated AND marked `unpropagated` — see [TraceContext](#tracecontext-2).

#### Parameters

##### env?

`Record`\<`string`, `string` \| `undefined`\> = `process.env`

#### Returns

[`TraceContext`](#tracecontext-2)

***

### createPropagatingTraceEmitter()

> **createPropagatingTraceEmitter**(`ctx`): `object`

Create a LoopTraceEmitter that:
  1. Parents all spans under the inherited parent span id.
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

## References

### AnalystRegistry

Re-exports [AnalystRegistry](runtime.md#analystregistry)

***

### MakeWorkerAgent

Re-exports [MakeWorkerAgent](runtime.md#makeworkeragent)

***

### WorkerSpawnContext

Re-exports [WorkerSpawnContext](runtime.md#workerspawncontext)

***

### CoordinationEvent

Re-exports [CoordinationEvent](runtime.md#coordinationevent)
