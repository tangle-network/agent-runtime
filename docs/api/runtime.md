[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / runtime

# runtime

Driven-loop substrate. `runAgentRounds` orchestrates around the sandbox SDK; it
does not invent its own notion of "what an agent is". Each iteration is
a `sandboxClient.create({ backend: { profile } })` + `box.streamPrompt`
call. The driver owns topology; the validator owns scoring; the output
adapter owns event-stream decode; the kernel owns iteration accounting,
concurrency, abort, cost aggregation, and trace emission.

## Classes

### InMemoryResultBlobStore

**`Stable`**

In-memory `ResultBlobStore`. Content-addressed: `put` verifies the supplied
`outRef` matches the artifact's hash so a stale/forged ref fails loud rather than
silently rehydrating the wrong payload. Idempotent on an identical re-put.

#### Implements

- [`ResultBlobStore`](#resultblobstore)

#### Constructors

##### Constructor

> **new InMemoryResultBlobStore**(): [`InMemoryResultBlobStore`](#inmemoryresultblobstore)

###### Returns

[`InMemoryResultBlobStore`](#inmemoryresultblobstore)

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`put`](#put-2)

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### FileResultBlobStore

**`Stable`**

FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
`put` fsyncs so a crash between writes never loses an acknowledged blob.

#### Implements

- [`ResultBlobStore`](#resultblobstore)

#### Constructors

##### Constructor

> **new FileResultBlobStore**(`dir`): [`FileResultBlobStore`](#fileresultblobstore)

###### Parameters

###### dir

`string`

###### Returns

[`FileResultBlobStore`](#fileresultblobstore)

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`put`](#put-2)

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### InMemorySpawnJournal

**`Stable`**

In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces
the corruption guards a durable replay rests on:
 - an event before `beginTree` is a corrupted tree (fail loud),
 - a duplicate `seq` within a tree is a corrupted cursor (fail loud) — two
   settlements cannot share the cursor position replay orders by.

#### Implements

- [`SpawnJournal`](#spawnjournal)

#### Constructors

##### Constructor

> **new InMemorySpawnJournal**(): [`InMemorySpawnJournal`](#inmemoryspawnjournal)

###### Returns

[`InMemorySpawnJournal`](#inmemoryspawnjournal)

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`beginTree`](#begintree-2)

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### ev

[`SpawnEvent`](#spawnevent)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`appendEvent`](#appendevent-2)

***

### FileSpawnJournal

**`Stable`**

JSONL on disk. One line per record: the first record is `begin`, subsequent records
are `event` envelopes wrapping a `SpawnEvent`. `loadTree` replays the whole file,
filtering by `root`, and applies the same begin-precedes-events + unique-seq
corruption guards as the in-memory impl. Each append fsyncs so a crash between
writes never loses an acknowledged event.

#### Implements

- [`SpawnJournal`](#spawnjournal)

#### Constructors

##### Constructor

> **new FileSpawnJournal**(`path`): [`FileSpawnJournal`](#filespawnjournal)

###### Parameters

###### path

`string`

###### Returns

[`FileSpawnJournal`](#filespawnjournal)

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`beginTree`](#begintree-2)

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### ev

[`SpawnEvent`](#spawnevent)

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`appendEvent`](#appendevent-2)

***

### InMemoryCorpus

In-memory `Corpus`. Keyed by record `id`; `append` validates the record, is idempotent on an
identical re-append, and returns a typed `{ succeeded: false }` on a conflicting re-append under
the same `id` (never overwrites). `query` routes through the single-sourced `applyFilter`.

#### Implements

- [`Corpus`](#corpus-2)

#### Constructors

##### Constructor

> **new InMemoryCorpus**(): [`InMemoryCorpus`](#inmemorycorpus)

###### Returns

[`InMemoryCorpus`](#inmemorycorpus)

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

###### Implementation of

[`Corpus`](#corpus-2).[`append`](#append-2)

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

###### Implementation of

[`Corpus`](#corpus-2).[`query`](#query-2)

***

### FileCorpus

JSONL on disk — one validated `CorpusRecord` per line, append-only. `query` replays the whole
file, validating every line (a malformed line fails loud — a corrupted corpus must never read
back silently) and folding by `id`: a later identical line dedups, a later conflicting line
under the same `id` is a corruption (fail loud). `append` first replays to enforce the same
idempotence/conflict contract as the in-mem impl, then fsyncs the new line so a crash between
writes never loses an acknowledged fact. Shares the JSONL append-line spine with the spawn
journal, but the interface stays separate (a learned fact is not a replay record).

#### Implements

- [`Corpus`](#corpus-2)

#### Constructors

##### Constructor

> **new FileCorpus**(`path`): [`FileCorpus`](#filecorpus)

###### Parameters

###### path

`string`

###### Returns

[`FileCorpus`](#filecorpus)

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

###### Implementation of

[`Corpus`](#corpus-2).[`append`](#append-2)

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

###### Implementation of

[`Corpus`](#corpus-2).[`query`](#query-2)

***

### SandboxRunAbortError

**`Experimental`**

Thrown when a turn is aborted/timed-out mid-settle. Carries the events drained
BEFORE the abort fired (and any in-progress `readError`) so an aborted run is
DIAGNOSABLE — the caller can tell never-started (`events: []`) from looped
(many events, no terminal `result`) from produced-nothing-then-cancelled.

`name === 'AbortError'`, so existing `err.name === 'AbortError'` callers (the
loop kernel, scope, supervise runtime) keep matching it unchanged.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SandboxRunAbortError**(`events`, `readError?`): [`SandboxRunAbortError`](#sandboxrunaborterror)

**`Experimental`**

###### Parameters

###### events

`SandboxEvent`[]

###### readError?

`string`

###### Returns

[`SandboxRunAbortError`](#sandboxrunaborterror)

###### Overrides

`Error.constructor`

#### Properties

##### name

> `readonly` **name**: `"AbortError"` = `'AbortError'`

**`Experimental`**

###### Overrides

`Error.name`

##### events

> `readonly` **events**: `SandboxEvent`[]

**`Experimental`**

Events drained from the stream before the abort interrupted the turn.

##### readError?

> `readonly` `optional` **readError?**: `string`

**`Experimental`**

The last artifact read error, if the abort fired during the retry loop.

***

### McpSpawnFault

A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
 Graders (the serve verifier) must rethrow this instead of scoring it.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new McpSpawnFault**(`message?`): [`McpSpawnFault`](#mcpspawnfault)

###### Parameters

###### message?

`string`

###### Returns

[`McpSpawnFault`](#mcpspawnfault)

###### Inherited from

`Error.constructor`

##### Constructor

> **new McpSpawnFault**(`message?`, `options?`): [`McpSpawnFault`](#mcpspawnfault)

###### Parameters

###### message?

`string`

###### options?

`ErrorOptions`

###### Returns

[`McpSpawnFault`](#mcpspawnfault)

###### Inherited from

`Error.constructor`

***

### FileCoordinationLog

FS-backed `CoordinationLog`: append-only JSONL, fsynced per record.

#### Implements

- [`CoordinationLog`](#coordinationlog)

#### Constructors

##### Constructor

> **new FileCoordinationLog**(`path`): [`FileCoordinationLog`](#filecoordinationlog)

###### Parameters

###### path

`string`

###### Returns

[`FileCoordinationLog`](#filecoordinationlog)

#### Methods

##### append()

> **append**(`runId`, `record`, `ownerId?`): `Promise`\<`void`\>

###### Parameters

###### runId

`string`

###### record

[`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### ownerId?

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`CoordinationLog`](#coordinationlog).[`append`](#append-3)

##### load()

> **load**(`runId`, `ownerId?`): `Promise`\<[`PriorCoordination`](#priorcoordination)\>

###### Parameters

###### runId

`string`

###### ownerId?

`string`

###### Returns

`Promise`\<[`PriorCoordination`](#priorcoordination)\>

###### Implementation of

[`CoordinationLog`](#coordinationlog).[`load`](#load-1)

***

### DriverAttemptsExhaustedError

The error a give-up throws: the original cause, re-described with the attempt history so
 `driver-failed` carries a diagnosable message instead of one backend's last words.

#### Extends

- [`RuntimeRunStateError`](index.md#runtimerunstateerror)

#### Constructors

##### Constructor

> **new DriverAttemptsExhaustedError**(`cause`, `attempts`, `stop`): [`DriverAttemptsExhaustedError`](#driverattemptsexhaustederror)

###### Parameters

###### cause

`unknown`

###### attempts

readonly [`DriverAttemptRecord`](#driverattemptrecord)[]

###### stop

[`DriverAttemptStop`](#driverattemptstop)

###### Returns

[`DriverAttemptsExhaustedError`](#driverattemptsexhaustederror)

###### Overrides

[`RuntimeRunStateError`](index.md#runtimerunstateerror).[`constructor`](index.md#constructor-9)

#### Properties

##### attempts

> `readonly` **attempts**: readonly [`DriverAttemptRecord`](#driverattemptrecord)[]

##### stop

> `readonly` **stop**: [`DriverAttemptStop`](#driverattemptstop)

***

### GraphEdgeCapError

A delegates edge exhausted its traversal cap and the run produced no winner: the cap, not the
 task, ended it. Carries the full evidence so failing loud loses nothing.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new GraphEdgeCapError**(`exhaustedEdges`, `ledger`, `result`): [`GraphEdgeCapError`](#graphedgecaperror)

###### Parameters

###### exhaustedEdges

readonly `string`[]

###### ledger

readonly [`EdgeTraversal`](#edgetraversal)[]

###### result

[`SupervisedResult`](index.md#supervisedresult)\<`unknown`\>

###### Returns

[`GraphEdgeCapError`](#graphedgecaperror)

###### Overrides

`Error.constructor`

#### Properties

##### exhaustedEdges

> `readonly` **exhaustedEdges**: readonly `string`[]

##### ledger

> `readonly` **ledger**: readonly [`EdgeTraversal`](#edgetraversal)[]

##### result

> `readonly` **result**: [`SupervisedResult`](index.md#supervisedresult)\<`unknown`\>

## Interfaces

### SpawnForestTree

One journal tree in a recursively loaded supervision forest.

#### Properties

##### root

> `readonly` **root**: `string`

##### ownerNodeId?

> `readonly` `optional` **ownerNodeId?**: `string`

Driver node that owns this tree; absent for the requested root tree.

##### parentTreeRoot?

> `readonly` `optional` **parentTreeRoot?**: `string`

Journal tree containing `ownerNodeId`; absent for the requested root tree.

##### events

> `readonly` **events**: readonly [`SpawnEvent`](#spawnevent)[]

##### view

> `readonly` **view**: [`TreeView`](#treeview)

***

### SpawnForestEvent

One event with the journal tree that establishes its cursor namespace.

#### Properties

##### treeRoot

> `readonly` **treeRoot**: `string`

##### event

> `readonly` **event**: [`SpawnEvent`](#spawnevent)

***

### SpawnForestNode

One flattened node with the journal tree that owns its records.

#### Extends

- [`NodeSnapshot`](#nodesnapshot)

#### Properties

##### treeRoot

> `readonly` **treeRoot**: `string`

##### id

> `readonly` **id**: `string`

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`id`](#id-19)

##### parent?

> `readonly` `optional` **parent?**: `string`

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`parent`](#parent-4)

##### label

> `readonly` **label**: `string`

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`label`](#label-17)

##### status

> `readonly` **status**: [`NodeStatus`](#nodestatus)

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`status`](#status-12)

##### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-4)

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`runtime`](#runtime-5)

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`budget`](#budget-18)

##### ownedTreeRoot?

> `readonly` `optional` **ownedTreeRoot?**: `string`

Exact nested journal tree owned by this node, when Runtime attested recursive ownership.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`ownedTreeRoot`](#ownedtreeroot-1)

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Manager-scoped assignment identity, including deterministic ids for unkeyed siblings.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`assignmentId`](#assignmentid-7)

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`identity`](#identity-9)

##### materialization?

> `readonly` `optional` **materialization?**: [`ProfileMaterializationReceipt`](#profilematerializationreceipt)

Kernel-owned execution evidence. `unknown` is distinct from a known zero/empty plan.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`materialization`](#materialization-2)

##### executionBindings?

> `readonly` `optional` **executionBindings?**: readonly [`ExecutionBindingReceipt`](#executionbindingreceipt)[]

Immutable attempt bindings, oldest first. A retried/resumed node may have more than one.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`executionBindings`](#executionbindings-2)

##### settledAt?

> `readonly` `optional` **settledAt?**: `number`

Epoch ms of the terminal journal record; absent while live or when legacy evidence lacks it.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`settledAt`](#settledat-1)

##### spent

> `readonly` **spent**: [`Spend`](index.md#spend)

Conserved spend so far for this node.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`spent`](#spent-2)

##### providerModel?

> `readonly` `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence)

Provider model evidence persisted separately from the execution plan.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`providerModel`](#providermodel-1)

##### outRef?

> `readonly` `optional` **outRef?**: `string`

`outRef` once the node is `done` (the replay/result pointer).

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`outRef`](#outref-6)

##### trace?

> `readonly` `optional` **trace?**: [`WorkerTraceEvidence`](index.md#workertraceevidence)

Present on terminal executor nodes; legacy records carry an explicit unavailable reason.

###### Inherited from

[`NodeSnapshot`](#nodesnapshot).[`trace`](#trace-3)

***

### SpawnForestInDoubtNode

A spawned worker with no terminal record in a cold snapshot. Resume treats the same state as
in-doubt and conservatively retains its reservation. Root nodes and armed waits are excluded.

#### Properties

##### treeRoot

> `readonly` **treeRoot**: `string`

##### nodeId

> `readonly` **nodeId**: `string`

##### label

> `readonly` **label**: `string`

##### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-4)

***

### SpawnForestMissingTree

A driver spawn whose owned journal tree was never begun before the process stopped.

#### Properties

##### parentTreeRoot

> `readonly` **parentTreeRoot**: `string`

##### ownerNodeId

> `readonly` **ownerNodeId**: `string`

##### root

> `readonly` **root**: `string`

***

### SpawnForest

Complete cold-readable view of one recursive supervision run.

#### Properties

##### root

> `readonly` **root**: `string`

##### trees

> `readonly` **trees**: readonly [`SpawnForestTree`](#spawnforesttree)[]

##### nodes

> `readonly` **nodes**: readonly [`SpawnForestNode`](#spawnforestnode)[]

##### events

> `readonly` **events**: readonly [`SpawnForestEvent`](#spawnforestevent)[]

##### inDoubt

> `readonly` **inDoubt**: readonly [`SpawnForestInDoubtNode`](#spawnforestindoubtnode)[]

##### missingTrees

> `readonly` **missingTrees**: readonly [`SpawnForestMissingTree`](#spawnforestmissingtree)[]

***

### AnalystFindingEvent

A trace-analyst result re-entered as a message on the bus (the `finding` event kind).

#### Properties

##### fromWorker

> `readonly` **fromWorker**: `string`

##### analyst

> `readonly` **analyst**: `string`

##### findings?

> `readonly` `optional` **findings?**: `unknown`

The analyst's result. ABSENT when the analyst returned `undefined` (no findings); any other
 value is canonicalized to finite RFC 8785 JSON at publish (`canonicalFindingEvent`), so
 digesting subscribers (the coordination-event id) never throw on analyst-shaped data.

***

### AnalyzeOnSettleRoute

One analyst-on-settle ROUTE: which lens runs (`kind`), over WHICH settled workers (`over`),
delivered to WHOM (`to`), wrapped in WHAT standing instruction (`directive`). The generalized
form of the bare-string entry — a string `k` is exactly `{ kind: k }`: every settle feeds the
lens and the findings go to the driver via the bus. This is the analyzes-edge of an agent
graph expressed at the coordination layer; the finding is ALWAYS also published on the bus
(the audit trail), routing adds delivery, never replaces the record.

#### Properties

##### kind

> `readonly` **kind**: `string`

The analyst id: a lens id resolved against the `analysts` registry, or — when `agent` is
 present — the AGENT analyst's stable identity carried on its finding/steer events (it need
 not exist in any registry).

##### agent?

> `readonly` `optional` **agent?**: `AgentProfile`

Make this analyst a tool-equipped AGENT instead of a registry lens: on each matching settle
the runtime spawns this profile as a WORKER through the SAME spawn machinery a driver spawn
uses (`Scope.spawn` + the run's `makeWorkerAgent` seam) — so its spend reserves from the
conserved pool, its node is journaled and traced like any worker, and a node-pinning seam
sees the spawn context marker (`WorkerSpawnContext.analyst`). Its task is `directive` plus
the settled worker's tool-trace evidence; its settle OUTPUT is the findings, published as a
`finding` event (same canonicalization) and delivered per `to` exactly like registry-analyst
findings. A settle that failed publishes `{ analystRunFailed }`; a spawn the pool or fences
refuse publishes `{ analystSpawnRefused }` — observable, never a silent drop. An agent
analyst's settlement never enters the settled-worker ledger, never feeds the finalizer, and
never re-fires the analyst-on-settle hook (no analyst-on-analyst cascade by construction).

##### to?

> `readonly` `optional` **to?**: `string`

Deliver the findings to this live worker, named by its PROFILE NAME (the stable node
 identity a graph pins) or its spawn label. Omit = the driver (bus only). Delivery goes
 through the same authorization + steer machinery a driver-authored steer uses and is
 recorded as a `steer` event carrying `analyst`, so a routed delivery is observable and a
 failed one (`delivered: false`) is a recorded outcome, never a silent drop.

##### directive?

> `readonly` `optional` **directive?**: `string`

Standing instruction wrapped around the findings on a routed delivery — what the recipient
 should DO with the analysis. For an AGENT analyst (`agent` set) it is instead the analysis
 directive handed to the agent as its task; the routed delivery then carries the bare
 findings, because the directive was already consumed upstream. Omit = the bare findings
 JSON (and, for an agent analyst, a task of evidence only).

##### over?

> `readonly` `optional` **over?**: readonly `string`[]

Restrict which settled workers feed this lens, by profile name or spawn label. Omit =
 every settled `done` worker.

***

### WorkerResumeContext

The resume lineage a `'resume'` spawn hands the executor seam
 ([WorkerSpawnContext.resume](#resume)). The kernel owns identity, ordering, ledger truth, and
 spend continuity (the resumed worker reserves from the same conserved pool); the seam owns the
 re-attachment itself — e.g. mapping `ofWorker` to a backend session id.

#### Properties

##### ofWorker

> `readonly` **ofWorker**: `string`

The prior SETTLED worker whose session the new worker continues.

##### sequence

> `readonly` **sequence**: `number`

1-based position of the NEW worker in the node's continuity chain: a node spawned once and
 resumed once hands the resumed worker `sequence: 2`.

***

### DownMessageDeliveryAttempt

A durable marker written after authorization and immediately before Runtime calls `Scope.send`.
If a process dies with this marker but no matching outcome, delivery is unknown and is never
replayed automatically.

#### Properties

##### receiptId

> `readonly` **receiptId**: `string`

##### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

##### toWorker

> `readonly` **toWorker**: `string`

##### instructionDigest

> `readonly` **instructionDigest**: `string`

##### interrupt

> `readonly` **interrupt**: `boolean`

##### questionId?

> `readonly` `optional` **questionId?**: `string`

***

### DownMessageEvent

A parent→child delivery result (the down-leg): recorded for observability, never pulled back by
the parent. `receiptId` and `instructionDigest` link it to the pre-delivery authorization receipt
and attempt marker.

#### Properties

##### receiptId

> `readonly` **receiptId**: `string`

##### toWorker

> `readonly` **toWorker**: `string`

##### instruction

> `readonly` **instruction**: `string`

##### instructionDigest

> `readonly` **instructionDigest**: `string`

##### delivered

> `readonly` **delivered**: `boolean`

##### outcome

> `readonly` **outcome**: [`DownMessageDeliveryOutcome`](#downmessagedeliveryoutcome)

##### error?

> `readonly` `optional` **error?**: `string`

***

### ContinuationInstruction

Durable authorization receipt written before a continuation reaches a worker.

#### Properties

##### receiptId

> `readonly` **receiptId**: `string`

##### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

##### toWorker

> `readonly` **toWorker**: `string`

##### instruction

> `readonly` **instruction**: `string`

##### instructionDigest

> `readonly` **instructionDigest**: `string`

##### workerIdentity?

> `readonly` `optional` **workerIdentity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### interrupt

> `readonly` **interrupt**: `boolean`

##### questionId?

> `readonly` `optional` **questionId?**: `string`

***

### DownMessageAuthorizationInput

Detached continuation bytes and exact worker identity presented to product authorization before
Runtime records or delivers a steer/answer.

#### Properties

##### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

##### workerId

> `readonly` **workerId**: `string`

##### workerIdentity

> `readonly` **workerIdentity**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### instruction

> `readonly` **instruction**: `string`

##### interrupt

> `readonly` **interrupt**: `boolean`

##### questionId?

> `readonly` `optional` **questionId?**: `string`

***

### AuthorizedDownMessage

Product-authorized continuation bytes. Returning a narrowed instruction replaces the proposed
bytes; throwing refuses delivery.

#### Properties

##### instruction

> `readonly` **instruction**: `string`

***

### WorkerSpawnContext

Immutable task, allocation, identity attribution, and semantic key supplied while a manager's
complete worker profile is prepared for one spawn.

#### Properties

##### assignmentId

> `readonly` **assignmentId**: `string`

Stable assignment identity within this manager. A semantic key wins; otherwise Runtime mints
the manager's deterministic pre-factory spawn ordinal so identical unkeyed siblings stay
isolated and can recover by issuing the same assignments in the same order.

##### parentNodeId

> `readonly` **parentNodeId**: `string`

Trusted concrete manager node authorizing this spawn. Never accepted from model arguments.

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The exact allocation this node receives after the tool's optional override is merged.

##### task

> `readonly` **task**: `unknown`

Detached, deeply immutable task bytes from this spawn request.

##### label

> `readonly` **label**: `string`

Exact trace label selected for this spawn.

##### key?

> `readonly` `optional` **key?**: `string`

Semantic restart key, when the manager supplied one.

##### execution?

> `readonly` `optional` **execution?**: [`AgentExecutionRef`](#agentexecutionref)

Trusted candidate/campaign attribution attached by product authorization.

##### analyst?

> `readonly` `optional` **analyst?**: `string`

Present (as the analyst id) ONLY when this spawn is an analyst-AGENT run initiated by the
 runtime's analyst-on-settle hook ([AnalyzeOnSettleRoute.agent](#agent)) — authored by the
 runtime, never accepted from a driver's tool arguments. A node-pinning `makeWorkerAgent`
 reads it to admit the analyst node it would refuse as a driver-authored spawn.

##### continuity?

> `readonly` `optional` **continuity?**: [`ContinuityMode`](#continuitymode)

The EFFECTIVE continuity mode of this spawn — the spawn tool's per-call argument when given,
 else the profile name's declared default ([CoordinationToolsOptions.continuityByProfile](mcp.md#continuitybyprofile)),
 else `'fresh'`. Absent only from producers that predate continuity — read absence as
 `'fresh'`.

##### resume?

> `readonly` `optional` **resume?**: [`WorkerResumeContext`](#workerresumecontext)

Present iff `continuity === 'resume'`: the lineage the executor seam re-attaches with.

##### peerMailUrl?

> `readonly` `optional` **peerMailUrl?**: `string`

The PEER MAIL capability endpoint minted for this exact spawn, when the run enabled peer mail
([CoordinationToolsOptions.peerMail](mcp.md#peermail)). It serves `send_mail` / `read_mail` and nothing
else, and it speaks as this worker: the sender is bound to the capability, never passed as an
argument. Mount it on the worker the way `coordinationMcpUrl` is mounted on a driver.

It arrives HERE, out of band, rather than being merged into the worker's `AgentProfile.mcp`,
for the same reason the driver's coordination URL does: the URL carries fresh random bytes per
process, so writing it into the profile would change the canonical profile digest every run and
a keyed re-spawn would then fail its identity check against the journal.

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

### WorktreeCommandResult

Outcome of one verification command run in the worktree (test or typecheck).

#### Properties

##### command

> **command**: `string`

The shell command line that was run.

##### passed

> **passed**: `boolean`

Did the command exit 0? The PASS signal a deliverable gate / coder output reads.

##### exitCode

> **exitCode**: `number` \| `null`

OS exit code, or `null` when killed before exit.

##### output

> **output**: `string`

Combined stdout+stderr (capped) — surfaced in traces for diagnosis.

***

### WorktreeProfileMaterializationReceipt

Proof of the profile inputs delivered before the worker process started.

#### Properties

##### workspacePlanDigest

> **workspacePlanDigest**: `string`

Digest of the exact materializer plan: files, modes, environment, flags, and unsupported rows.

##### writtenPaths

> **writtenPaths**: `string`[]

Repository-relative profile input files written into the worker worktree.

##### unsupported

> **unsupported**: `Unsupported`[]

Must be empty on a successful run because this path fails closed.

##### environmentNames

> **environmentNames**: `string`[]

Environment variable names added to the worker process. Values remain out of telemetry.

##### flags

> **flags**: `string`[]

Exact additional CLI arguments emitted by the materializer.

##### resourceInstructions

> **resourceInstructions**: `object`

`resources.instructions` bypasses native project files so reproducible Codex cannot drop it.

###### delivery

> **delivery**: `"none"` \| `"invocation-prompt"`

###### sha256

> **sha256**: `string` \| `null`

###### byteLength

> **byteLength**: `number`

***

### WorktreeHarnessResult

The canonical result of one worktree-harness run, projected by each port to its own shape.

#### Properties

##### branch

> **branch**: `string`

The branch the worktree was cut on (`delegate/<runId>`).

##### patch

> **patch**: `string`

`git diff` of the worktree against its base — the unified patch the harness produced.

##### stats

> **stats**: `object`

Shortstat-derived change counts.

###### filesChanged

> **filesChanged**: `number`

###### insertions

> **insertions**: `number`

###### deletions

> **deletions**: `number`

##### profileMaterialization?

> `optional` **profileMaterialization?**: [`WorktreeProfileMaterializationReceipt`](#worktreeprofilematerializationreceipt)

Exact profile materialization applied before the harness launched.
Absent on transports that cannot return a materializer receipt; never fabricated.

##### harness

> **harness**: `object`

The harness subprocess outcome.

###### name

> **name**: [`LocalHarness`](mcp.md#localharness) \| `"bridge"`

###### exitCode

> **exitCode**: `number` \| `null`

###### timedOut

> **timedOut**: `boolean`

###### killedBySignal

> **killedBySignal**: `Signals` \| `null`

###### durationMs

> **durationMs**: `number`

###### stdout

> **stdout**: `string`

###### stderr

> **stderr**: `string`

###### usage?

> `optional` **usage?**: [`CodexTokenUsage`](mcp.md#codextokenusage)

Exact Codex JSONL usage when reproducible mode is enabled.

###### cliVersion?

> `optional` **cliVersion?**: `string`

Installed CLI version captured immediately before execution.

###### executableSha256?

> `optional` **executableSha256?**: `string`

SHA-256 of the native Codex executable staged read-only in the candidate worktree.

###### requestedPromptSha256?

> `optional` **requestedPromptSha256?**: `string`

SHA-256 of the exact composed prompt argument proved present in Codex's rendered prompt.

###### effectivePromptSha256?

> `optional` **effectivePromptSha256?**: `string`

SHA-256 of `codex debug prompt-input` output for the exact isolated prompt.

###### nonPromptArgsSha256?

> `optional` **nonPromptArgsSha256?**: `string`

SHA-256 of the exact executable + argv with prompt content replaced by `<PROMPT>`.

###### controlledConfigSha256?

> `optional` **controlledConfigSha256?**: `string`

SHA-256 of the isolated config that fixes permissions and shell environment.

###### readDeniedPathsSha256?

> `optional` **readDeniedPathsSha256?**: `string`

SHA-256 of the normalized caller-supplied host read-denial paths.

###### readDeniedPaths?

> `optional` **readDeniedPaths?**: `string`[]

Sorted normalized caller-supplied host read-denial paths.

###### readDeniedPathCount?

> `optional` **readDeniedPathCount?**: `number`

Number of normalized caller-supplied host read-denial paths.

###### executionPolicy?

> `optional` **executionPolicy?**: [`CodexExecutionPolicy`](mcp.md#codexexecutionpolicy)

Explicit isolation claims checked before model execution.

##### checks?

> `optional` **checks?**: `object`

Verification signals derived in the live worktree (present only when commands were given).

###### tests?

> `optional` **tests?**: [`WorktreeCommandResult`](#worktreecommandresult)

###### typecheck?

> `optional` **typecheck?**: [`WorktreeCommandResult`](#worktreecommandresult)

***

### AnytimeTaskCurve

#### Properties

##### taskId

> **taskId**: `string`

##### strategy

> **strategy**: `string`

##### points

> **points**: `object`[]

Best-so-far after each settled shot: elapsed ms from the task's first spawn,
 cumulative usd, and the running max score.

###### elapsedMs

> **elapsedMs**: `number`

###### cumUsd

> **cumUsd**: `number`

###### best

> **best**: `number`

##### hits

> **hits**: `Record`\<`string`, \{ `ms`: `number`; `shots`: `number`; `usd`: `number`; \} \| `null`\>

Per satisficing target (keyed by the target value as a string): the first point
 where best ≥ target, or null when never reached within budget.

***

### AnytimeStrategySummary

#### Properties

##### strategy

> **strategy**: `string`

##### target

> **target**: `number`

The satisficing target this row summarizes.

##### tasks

> **tasks**: `number`

##### reachedTarget

> **reachedTarget**: `number`

##### medianTttMs

> **medianTttMs**: `number` \| `null`

Median time-to-target over the tasks that reached it (null when none did).

##### medianShotsToTarget

> **medianShotsToTarget**: `number` \| `null`

##### ertMs

> **ertMs**: `number` \| `null`

COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed.

##### erUsd

> **erUsd**: `number` \| `null`

Same construction over dollars: Σ all spend / #successes.

##### curveByShot

> **curveByShot**: `number`[]

Mean best-so-far score by shot index (the anytime curve, averaged over tasks).

##### auc

> **auc**: `number`

Area under the per-shot anytime curve, normalized to [0,1].

***

### AnytimeReport

#### Properties

##### targets

> **targets**: `number`[]

##### perTask

> **perTask**: [`AnytimeTaskCurve`](#anytimetaskcurve)[]

##### perStrategy

> **perStrategy**: [`AnytimeStrategySummary`](#anytimestrategysummary)[]

One summary per (strategy, target) pair — the COCO-style multi-target view.

***

### AuditIntentInput

#### Properties

##### declaredIntent

> **declaredIntent**: `string`

The declared intent: the task text / acceptance criteria the agent was given.

##### trace

> **trace**: readonly `unknown`[]

The trajectory so far — tool calls + results + assistant turns (any event shapes).

##### userIntent?

> `optional` **userIntent?**: `string`

The principal's actual intent when it differs from the literal task (the contract).

##### metaIntent?

> `optional` **metaIntent?**: `string`

The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
 flag locally-sensible work that serves the wrong larger objective.

##### runId?

> `optional` **runId?**: `string`

***

### AuditIntentOptions

#### Properties

##### profile

> **profile**: `AgentProfile`

Exact auditor identity.

##### executor

> **executor**: [`ExecutorConfig`](#executorconfig)

Execution substrate. All behavior comes from the profile.

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Cap trace lines fed to the auditor. Default 80.

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### IntentAudit

#### Properties

##### revealedIntent

> **revealedIntent**: `string`

What the agent's actions reveal it is actually optimizing — one sentence.

##### verdict

> **verdict**: `"aligned"` \| `"drifting"` \| `"diverged"`

##### evidence

> **evidence**: `string`

Trajectory-grounded evidence for the verdict (specific calls/patterns).

##### recommendation

> **recommendation**: `"abort"` \| `"steer"` \| `"continue"`

The single recommended intervention.

##### steer?

> `optional` **steer?**: `string`

When recommendation is 'steer': the corrective instruction to inject.

##### confidence

> **confidence**: `number`

***

### LeaderboardOptions

#### Properties

##### title?

> `readonly` `optional` **title?**: `string`

##### scoreOf?

> `readonly` `optional` **scoreOf?**: [`ScoreOf`](#scoreof)

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: [`ProfileKeyOf`](#profilekeyof)

##### groupOf?

> `readonly` `optional` **groupOf?**: [`GroupOf`](#groupof)

##### axisScoresOf?

> `readonly` `optional` **axisScoresOf?**: [`AxisScoresOf`](#axisscoresof)

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

Display label for a profile key (default: the key itself).

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `string`\>

Commit SHA / dataset / dates surfaced in the provenance block.

##### stats?

> `readonly` `optional` **stats?**: `boolean`

Compute per-row confidence intervals (bootstrap on score, Wilson on pass rate). Needs a
 `scenarioId` on every record (reps are collapsed per scenario for the honest n). Default off.

##### passThreshold?

> `readonly` `optional` **passThreshold?**: `number`

A score ≥ this counts as a "pass" for the pass-rate proportion + its Wilson CI. Default 0.999
 (fully solved). Lower it (e.g. 0.6) for a partial-credit domain.

***

### Interval

A 95%-by-default confidence interval.

#### Properties

##### lower

> `readonly` **lower**: `number`

##### upper

> `readonly` **upper**: `number`

***

### LeaderboardRow

One leaderboard row — a harness×model profile, every measured column.

#### Properties

##### profileKey

> `readonly` **profileKey**: `string`

##### label

> `readonly` **label**: `string`

##### model

> `readonly` **model**: `string`

##### n

> `readonly` **n**: `number`

##### meanScore

> `readonly` **meanScore**: `number`

##### solveRate

> `readonly` **solveRate**: `number`

Fraction of records scoring ≥ `passThreshold` (default 0.999) — the binary pass rate.

##### perAxis

> `readonly` **perAxis**: `Record`\<`string`, `number`\>

axis → mean score for this profile (blank in render when the profile never ran that axis).

##### costUsd

> `readonly` **costUsd**: `number` \| `null`

Exact total when every run captured cost; otherwise `null`.

##### capturedCostUsd

> `readonly` **capturedCostUsd**: `number`

Sum of captured cost only. This is a lower bound when `uncapturedCostRuns > 0`.

##### uncapturedCostRuns

> `readonly` **uncapturedCostRuns**: `number`

Runs whose cost was unavailable, never treated as free.

##### tokensIn

> `readonly` **tokensIn**: `number`

##### tokensOut

> `readonly` **tokensOut**: `number`

##### latencyP50Ms

> `readonly` **latencyP50Ms**: `number`

##### latencyP90Ms

> `readonly` **latencyP90Ms**: `number`

##### scoreCi?

> `readonly` `optional` **scoreCi?**: [`Interval`](#interval)

Bootstrap CI on the mean score — present only when `opts.stats` is set. Computed over
 per-scenario means (reps collapsed first), so identical reps can't fake a narrow interval.

##### passCi?

> `readonly` `optional` **passCi?**: [`Interval`](#interval)

Wilson CI on the pass rate — present only when `opts.stats` is set.

***

### Leaderboard

#### Properties

##### title

> `readonly` **title**: `string`

##### axes

> `readonly` **axes**: readonly `string`[]

Column order — scenario groups (default) or dimension keys (`axisScoresOf`).

##### profiles

> `readonly` **profiles**: readonly [`LeaderboardRow`](#leaderboardrow)[]

Rows ranked by `meanScore` desc (ties → lower cost, then label).

##### meta

> `readonly` **meta**: `Record`\<`string`, `string`\>

##### provenance

> `readonly` **provenance**: `object`

Provenance counts — the denominators every honest report leads with.

###### records

> `readonly` **records**: `number`

###### profiles

> `readonly` **profiles**: `number`

###### axes

> `readonly` **axes**: `number`

###### models

> `readonly` **models**: readonly `string`[]

###### totalCostUsd

> `readonly` **totalCostUsd**: `number` \| `null`

Exact total when every record captured cost; otherwise `null`.

###### capturedCostUsd

> `readonly` **capturedCostUsd**: `number`

Sum of captured cost only.

###### uncapturedCostRecords

> `readonly` **uncapturedCostRecords**: `number`

Records whose cost was unavailable.

***

### PairwiseVerdict

One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict.

#### Properties

##### a

> `readonly` **a**: `string`

##### b

> `readonly` **b**: `string`

##### pairs

> `readonly` **pairs**: `number`

Paired unit count (shared scenarios). The significance is suppressed below `minPairs`.

##### delta

> `readonly` **delta**: `number`

Median paired delta (b − a) and its bootstrap CI.

##### ciLow

> `readonly` **ciLow**: `number`

##### ciHigh

> `readonly` **ciHigh**: `number`

##### nonZeroPairs

> `readonly` **nonZeroPairs**: `number`

Non-zero paired differences used by the signed-rank test.

##### testMethod

> `readonly` **testMethod**: `RankTestMethod`

How the signed-rank p-value was computed.

##### pFloor

> `readonly` **pFloor**: `number`

Smallest p-value attainable by this paired design.

##### p

> `readonly` **p**: `number`

Raw two-sided signed-rank p-value.

##### q

> `readonly` **q**: `number`

Benjamini-Hochberg adjusted q-value across every profile pair.

##### significant

> `readonly` **significant**: `boolean`

BH-significant and above the `minPairs` observation floor.

***

### PairwiseOptions

#### Properties

##### scoreOf?

> `readonly` `optional` **scoreOf?**: [`ScoreOf`](#scoreof)

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: [`ProfileKeyOf`](#profilekeyof)

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### fdr?

> `readonly` `optional` **fdr?**: `number`

False-discovery rate for the Benjamini–Hochberg correction. Default 0.05.

##### minPairs?

> `readonly` `optional` **minPairs?**: `number`

Below this many shared scenarios a paired test can't defensibly separate two profiles, so the
 `significant` tag is suppressed regardless of p (small-n mirage protection). Default 12.

***

### CompletionEvidence

Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 never the judge's own verdict. Mirrors the steer-firewall's provenance discipline.

#### Properties

##### kind

> **kind**: `"artifact"` \| `"metric"`

##### uri

> **uri**: `string`

***

### CompletionVerdict

The "is it done?" verdict an analyst returns to the parent.

#### Properties

##### done

> **done**: `boolean`

##### determinism

> **determinism**: `"deterministic"` \| `"probabilistic"`

How verifiable the claim is — sets whether the driver trusts it or validates it.

##### reasons?

> `optional` **reasons?**: `string`

Why the analyst believes it is (or isn't) done — what the driver validates.

##### confidence?

> `optional` **confidence?**: `number`

0..1, for probabilistic verdicts; the driver's validation threshold reads this.

##### evidence?

> `optional` **evidence?**: readonly [`CompletionEvidence`](#completionevidence)[]

***

### CompletionAnalyst

Reads a node's trace → a completion verdict. Same input shape as the `analyze` hook, so
 ONE analyst node can back both channels (findings for steer, a verdict for stop).

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Methods

##### assess()

> **assess**(`input`): [`CompletionVerdict`](#completionverdict) \| `Promise`\<[`CompletionVerdict`](#completionverdict)\>

###### Parameters

###### input

###### task

`Task`

###### history

readonly [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

[`CompletionVerdict`](#completionverdict) \| `Promise`\<[`CompletionVerdict`](#completionverdict)\>

***

### CompletionPolicy

When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 probabilistic → validate by confidence threshold (the driver's check).

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8.

***

### LeaderboardScore

Structured per-case verdict a `score` function may return (a bare number is
 shorthand for `{ composite }`). `composite` is the [0,1] leaderboard score;
 `dimensions` are recorded as extra judge dimensions.

#### Properties

##### composite

> **composite**: `number`

##### dimensions?

> `optional` **dimensions?**: `Record`\<`string`, `number`\>

##### notes?

> `optional` **notes?**: `string`

***

### LeaderboardScenario

The campaign scenario a case is wrapped into: the case rides along so
 judges and hooks can reach the full domain payload, not just its id.

#### Extends

- `Scenario`

#### Type Parameters

##### TCase

`TCase`

#### Properties

##### case

> **case**: `TCase`

***

### LeaderboardFlagSpec

One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>`
 and surfaced to every hook via `ctx.args`.

#### Properties

##### default?

> `optional` **default?**: `string`

##### description

> **description**: `string`

***

### LeaderboardRunContext

Resolved run configuration handed to `setup` / `teardown` / `export`.

#### Properties

##### name

> **name**: `string`

##### backend

> **backend**: `string`

Execution backend name (`--backend`), a key of `backends`.

##### runDir

> **runDir**: `string`

##### exportDir

> **exportDir**: `string`

##### args

> **args**: `Record`\<`string`, `string` \| `undefined`\>

Every parsed flag (standard + `spec.flags`), by name without `--`.

##### harnesses

> **harnesses**: readonly `HarnessType`[]

##### models

> **models**: readonly `string`[]

Snapshot-stamped model ids (`name@snapshot`) — the eval identity models.

##### caseIds

> **caseIds**: readonly `string`[]

##### shots

> **shots**: `number`

##### reps

> **reps**: `number`

***

### LeaderboardBenchTask

Structurally `BenchTask` (bench registry shape) — declared locally so this
 module adds no dependency on a benchmark package.

#### Properties

##### id

> **id**: `string`

##### prompt

> **prompt**: `string`

##### split?

> `optional` **split?**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### LeaderboardBenchScore

Structurally `BenchScore` (bench registry shape).

#### Properties

##### resolved

> **resolved**: `boolean`

##### score

> **score**: `number`

##### detail?

> `optional` **detail?**: `string`

***

### LeaderboardBenchmarkAdapter

Structurally `BenchmarkAdapter` (bench registry shape): `name`,
 `preflight()`, `loadTasks()`, deterministic `judge()`, `goldArtifact()`.
 Generic over the artifact channel; the `string` default IS the registry
 shape, so a default-artifact adapter registers unchanged.

#### Type Parameters

##### TArtifact

`TArtifact` = `string`

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### preflight()

> **preflight**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### loadTasks()

> **loadTasks**(`opts?`): `Promise`\<[`LeaderboardBenchTask`](#leaderboardbenchtask)[]\>

###### Parameters

###### opts?

###### limit?

`number`

###### split?

`string`

###### ids?

`string`[]

###### Returns

`Promise`\<[`LeaderboardBenchTask`](#leaderboardbenchtask)[]\>

##### judge()

> **judge**(`task`, `artifact`): `Promise`\<[`LeaderboardBenchScore`](#leaderboardbenchscore)\>

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### artifact

`TArtifact`

###### Returns

`Promise`\<[`LeaderboardBenchScore`](#leaderboardbenchscore)\>

##### goldArtifact()

> **goldArtifact**(`task`): `Promise`\<`string` \| `undefined`\>

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### LeaderboardIterationInfo

Per-shot outcome context passed as `onCellEvents`'s third argument — how a
 thrown shot (which never reaches `parseOutput`) stays visible through the
 facade instead of surfacing only as an empty zero-token cell.

#### Properties

##### index

> **index**: `number`

0-based shot index within the cell.

##### error?

> `optional` **error?**: `string`

The shot's thrown error message, when the shot failed before scoring.

##### verdict?

> `optional` **verdict?**: `object`

The shot's validator verdict, when the shot reached scoring.

###### score?

> `optional` **score?**: `number`

***

### LeaderboardSpec

The declarative leaderboard spec. `TArtifact` is the artifact channel the
dispatch produces and the judges score — `string` (the default) is the plain
agent-response-text path; a structured artifact type flows natively once the
spec supplies `parseOutput` (or a LEVEL-2 `dispatch`) producing it.

#### Type Parameters

##### TCase

`TCase`

##### TArtifact

`TArtifact` = `string`

#### Properties

##### name

> **name**: `string`

Leaderboard name — the scenario `kind`, default profile name, and report title.

##### cases

> **cases**: `TCase`[]

The case corpus. Every case needs a stable string id (see `caseId`).

##### caseId?

> `optional` **caseId?**: (`c`) => `string`

Stable id extractor. Default: the case's own `id` property (fail-loud
 when absent or not a string).

###### Parameters

###### c

`TCase`

###### Returns

`string`

##### prompt

> **prompt**: (`c`) => `string` \| `Promise`\<`string`\>

The per-case task prompt. May be async (e.g. built by shelling out to a
 reference implementation); resolved ONCE per case before dispatch.

###### Parameters

###### c

`TCase`

###### Returns

`string` \| `Promise`\<`string`\>

##### score

> **score**: (`output`, `c`) => `number` \| [`LeaderboardScore`](#leaderboardscore)

The domain grader: agent output artifact → score. Used BOTH as the
 per-shot validator (a shot with `composite > 0` stops the naive retry
 loop) and, wrapped as a campaign judge, as the recorded leaderboard score.

###### Parameters

###### output

`TArtifact`

###### c

`TCase`

###### Returns

`number` \| [`LeaderboardScore`](#leaderboardscore)

##### axis?

> `optional` **axis?**: `object`

Harness × model axes for `expandProfileAxes`. Defaults: the canonical
 `CODING_HARNESSES` × the base profile's `model.default`. `--harnesses` /
 `--models` override per run.

###### harnesses?

> `optional` **harnesses?**: readonly `HarnessType`[]

###### models?

> `optional` **models?**: readonly `string`[]

##### baseProfile

> **baseProfile**: `AgentProfile`

Exact base profile the axes expand over (prompt/tools/skills held fixed).
 Its provider remains authoritative while each axis cell replaces the
 harness and concrete model.

##### backends?

> `optional` **backends?**: `Record`\<`string`, (() => [`SandboxClient`](#sandboxclient-5)) \| `undefined`\>

Execution-backend registry: `--backend <name>` picks the factory that
yields the `SandboxClient` every cell runs on. Merged over the defaults:
  - `sandbox` — throws with guidance (a product must supply its real
    Sandbox-backed client; the facade has no credentials).
  - `cli-bridge` — `resolveSandboxClient({ backend: 'bridge' })` reading
    `CLI_BRIDGE_URL` + `BRIDGE_BEARER`/`CLI_BRIDGE_BEARER`; the per-cell
    harness/model ride in via `sandboxOverrides.backend`.

##### flags?

> `optional` **flags?**: `Record`\<`string`, [`LeaderboardFlagSpec`](#leaderboardflagspec)\>

Extra `--flag value` CLI args `run()` parses and surfaces via `ctx.args`.

##### setup?

> `optional` **setup?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Runs once before the matrix (fetch fixtures, warm caches).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### teardown?

> `optional` **teardown?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Runs once after the matrix, even on failure (reap boxes, close handles).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onCellEvents?

> `optional` **onCellEvents?**: (`events`, `c`, `iteration?`) => `void`

Per-cell event tap: the raw sandbox events of EVERY shot, with the case —
 the seam for domain metric capture (search counts, citations) without a
 substrate change. Fires once per shot after the cell's loop settles, in
 shot order, including thrown shots (whose events may be partial or empty);
 the third argument carries the shot's index + error/verdict outcome.

###### Parameters

###### events

readonly `SandboxEvent`[]

###### c

`TCase`

###### iteration?

[`LeaderboardIterationInfo`](#leaderboarditerationinfo)

###### Returns

`void`

##### parseOutput?

> `optional` **parseOutput?**: (`events`, `c`) => `TArtifact`

Output decode override: raw events → the scored artifact. Default: the
 sandbox SDK's `collectAgentResponseText` (final answer text; empty string
 when the stream carried none — which then scores 0). The default only
 produces `string`, so a spec with a structured `TArtifact` MUST supply
 this (or a LEVEL-2 `dispatch`).

###### Parameters

###### events

readonly `SandboxEvent`[]

###### c

`TCase`

###### Returns

`TArtifact`

##### resolveModel?

> `optional` **resolveModel?**: (`events`) => `string` \| `undefined`

Resolve the model the backend actually served from a shot's raw events.
When this returns a value the default dispatch records it on the paid-call
receipt. It cannot complete an inexact planning profile: every expanded
cell must already declare a concrete model before backend work starts.

###### Parameters

###### events

readonly `SandboxEvent`[]

###### Returns

`string` \| `undefined`

##### export?

> `optional` **export?**: (`result`, `ctx`) => `void` \| `Promise`\<`void`\>

Result export. Default: write `matrix-result.json` under the run dir and
 print (+ write) the ranked leaderboard markdown under the export dir.

###### Parameters

###### result

`RunProfileMatrixResult`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### dispatch?

> `optional` **dispatch?**: `ProfileDispatchFn`\<[`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>, `TArtifact`\>

LEVEL 2 — full dispatch replacement (in-process products bring their own).
 The default is `loopDispatch` + the naive retry driver over the resolved backend.

##### judges?

> `optional` **judges?**: `JudgeConfig`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>[]

LEVEL 2 — full judge replacement. Default: `score` wrapped as one judge.

##### shots?

> `optional` **shots?**: `number`

Naive-retry shot cap per cell (`--shots`). Default 1.

##### reps?

> `optional` **reps?**: `number`

Replicates per cell (`--reps`). Default 1.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`profile`, `scenario`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for one cell dispatch. Required
before execution when `matrix.costCeiling` is configured.

##### matrix?

> `optional` **matrix?**: `Partial`\<`RunProfileMatrixOptions`\<[`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>, `TArtifact`\>\>

Passthrough overrides spread onto the final `runProfileMatrix` call
 (e.g. `maxConcurrency`, `costCeiling`, `integrity`, `storage`) — spread
 LAST, so anything the facade wired can be overridden.

***

### DefinedLeaderboard

#### Type Parameters

##### TCase

`TCase`

##### TArtifact

`TArtifact` = `string`

#### Methods

##### run()

> **run**(`argv?`): `Promise`\<`RunProfileMatrixResult`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>\>

Parse flags, run the matrix, export, and return the raw result.

Standard flags: `--backend <name>` (default `sandbox`), `--harnesses a,b`,
`--models m1,m2`, `--cases id1,id2`, `--shots N`, `--reps N`,
`--model-snapshot <tag>`, `--run-dir <path>`, `--export-dir <path>`,
plus every `spec.flags` entry. `argv` defaults to `process.argv.slice(2)`.

The default run dir is FRESH per invocation (timestamp+pid under the OS
tmpdir). `runProfileMatrix` caches cells by run dir, and a stable default
would silently reuse a prior FAILED zero-token cell and skip dispatch —
only an explicit `--run-dir` opts into that resume behavior.

###### Parameters

###### argv?

`string`[]

###### Returns

`Promise`\<`RunProfileMatrixResult`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>\>

##### toBenchmarkAdapter()

> **toBenchmarkAdapter**(): [`LeaderboardBenchmarkAdapter`](#leaderboardbenchmarkadapter)\<`TArtifact`\>

The same domain surface in the structural `BenchmarkAdapter` shape.

###### Returns

[`LeaderboardBenchmarkAdapter`](#leaderboardbenchmarkadapter)\<`TArtifact`\>

***

### HarvestCorpusOptions

#### Properties

##### runs

> **runs**: `AsyncIterable`\<[`ObserveInput`](#observeinput), `any`, `any`\> \| `Iterable`\<[`ObserveInput`](#observeinput), `any`, `any`\>

The completed runs to analyze — map your store's rows to `ObserveInput`.

##### profile

> **profile**: `AgentProfile`

Exact analyst identity.

##### executor

> **executor**: [`ExecutorConfig`](#executorconfig)

Execution substrate. All behavior comes from the profile.

##### corpus

> **corpus**: [`Corpus`](#corpus-2)

The durable corpus the facts accrete into.

##### tags?

> `optional` **tags?**: readonly `string`[]

Tags written onto learned facts (the product/domain key the read side queries by).

##### concurrency?

> `optional` **concurrency?**: `number`

Runs analyzed in parallel. Default 4.

##### maxRuns?

> `optional` **maxRuns?**: `number`

Hard cap on runs consumed from the stream (a cost guard for unbounded stores).

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### HarvestFailure

#### Properties

##### runId

> **runId**: `string`

##### error

> **error**: `string`

***

### HarvestReport

#### Properties

##### runsObserved

> **runsObserved**: `number`

##### findings

> **findings**: `number`

Total findings the analyst produced (including ones already known).

##### learned

> **learned**: `number`

NEW facts actually appended (idempotent dedup excludes re-learned ones).

##### failures

> **failures**: [`HarvestFailure`](#harvestfailure)[]

Per-run analysis failures — reported, never silently dropped.

***

### InProcessPromptCtx

Context handed to each `onPrompt` call.

#### Properties

##### round

> **round**: `number`

0-based round index — increments per `streamPrompt` on the same box.
 Fresh boxes start at 0.

##### workdir?

> `optional` **workdir?**: `string`

Absolute path of this box's workspace, when a `workdir` was configured.
 Write the deliverable / fixtures here; `fs.read`/`fs.write`/`exec` operate
 over it. `undefined` for pure event-only boxes.

##### signal

> **signal**: `AbortSignal`

Cooperative cancellation channel for this turn.

##### options?

> `optional` **options?**: `Record`\<`string`, `unknown`\>

The verbatim per-call options the caller passed to the box verb (minus
 `signal`, surfaced above) — lets an offline test assert an options
 passthrough (`model`, `sessionId`, …) actually arrived.

***

### InProcessSandboxClientOptions

**`Experimental`**

#### Properties

##### onPrompt

> **onPrompt**: [`InProcessOnPrompt`](#inprocessonprompt)

**`Experimental`**

The per-turn behavior — see [InProcessOnPrompt](#inprocessonprompt).

##### workdir?

> `optional` **workdir?**: `string`

**`Experimental`**

Opt in to a REAL filesystem-backed box. When set, each `create()` mints a
fresh temp directory (prefixed `<workdir>-`) and the box exposes
`fs.read`/`fs.write` and `exec` over it; `delete()` removes the dir. Omit
for a pure event-only box (no `fs`/`exec` members), which is all a driver
or fanout loop needs.

##### id?

> `optional` **id?**: `string` \| ((`seq`) => `string`)

**`Experimental`**

Override the box `id`. A string is used verbatim; a function receives the
0-based create-sequence and returns the id (e.g. machine-keyed placement
demos). Default `in-process-<seq>`. The id is the value `describePlacement`
tags, so set it when a demo's output reads on a meaningful sandbox id.

***

### KeyProvider

Resolve named secrets. The ONE seam every secret store adapts to.

#### Methods

##### get()

> **get**(`name`): `Promise`\<`string` \| `undefined`\>

The value for `name`, or `undefined` when this provider does not hold it.

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### ResolvedMcpServerLaunch

The spawn-ready strings for one stdio MCP server: profile config values
 resolved, secrets separated so the client can redact them.

#### Properties

##### args?

> `optional` **args?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Public env, safe to appear in diagnostics.

##### protectedEnv?

> `optional` **protectedEnv?**: `Record`\<`string`, `string`\>

Resolved secret env. Reaches only the child process; redacted everywhere else.

***

### LocalSandboxClientOptions

#### Properties

##### router

> **router**: `object`

Router endpoint/auth. The exact per-create profile owns model and loop behavior.

###### baseUrl

> **baseUrl**: `string`

###### key

> **key**: `string`

##### profile?

> `optional` **profile?**: `AgentProfile`

Fallback profile when `create(options)` carries none on `backend.profile`.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Resolves profile-declared MCP secret names at child-process spawn time.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Explicit trust decision for the exact `profile` bytes supplied here.
Omit to refuse local processes. A permissive policy never transfers to a
different per-create profile and provides no host isolation.

***

### LoopDispatchOptions

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-5)

Sandbox client used for every cell's `runAgentRounds`. Supplied once.

##### toLoopOptions

> **toLoopOptions**: (`scenario`, `profile`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Build the per-cell runAgentRounds options from the scenario (+ profile, when
 used with `runProfileMatrix`).

###### Parameters

###### scenario

`TScenario`

###### profile

`AgentProfile`

###### Returns

[`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

##### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Map the finished loop to the artifact the judges score. Default:
 `result.winner?.output`. A loop with no winner yields `undefined` (judges
 skip the cell) — but the loop's token usage is STILL reported, so the
 integrity guard sees real activity.

###### Parameters

###### result

[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`TArtifact`

##### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Forward `loop.*` trace events into the campaign's scoped trace so loop
 spans correlate with the cell. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`, `profile`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for this whole cell dispatch.
Required by agent-eval before execution when the campaign is cost-capped.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`, `profile`) => `string` \| `undefined`

Resolve the model actually served from the completed loop.

###### Parameters

###### result

[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### scenario

`TScenario`

###### profile

`AgentProfile`

###### Returns

`string` \| `undefined`

***

### SuperviseDispatchOptions

Adapt a recursive Runtime `supervise()` tree to one Agent Eval profile-matrix cell.

The adapter starts Eval's paid-call record before the tree starts. Runtime remains the sole
owner of recursive execution, budgets, and the journal; Eval remains the sole owner of the
paid-call admission and resulting receipt.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### toTask

> **toTask**: (`scenario`, `profile`) => `unknown`

Build the task passed to the root supervisor for this profile/scenario cell.

###### Parameters

###### scenario

`TScenario`

###### profile

`AgentProfile`

###### Returns

`unknown`

##### toSuperviseOptions

> **toSuperviseOptions**: (`scenario`, `profile`) => [`SuperviseOptionsForDispatch`](#superviseoptionsfordispatch)

Build the Runtime-owned recursive-run options for this profile/scenario cell.

###### Parameters

###### scenario

`TScenario`

###### profile

`AgentProfile`

###### Returns

[`SuperviseOptionsForDispatch`](#superviseoptionsfordispatch)

##### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Map the terminal tree result to the artifact judges score. Default: winner output.

###### Parameters

###### result

[`SupervisedResult`](index.md#supervisedresult)\<`unknown`\>

###### Returns

`TArtifact`

##### costSource?

> `optional` **costSource?**: `string`

Cost-meter source label. Default `'supervise'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`, `profile`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for the complete supervised tree.

***

### LoopCampaignDispatchOptions

Options for adapting plain agent-eval campaign scenarios into Runtime cells.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-5)

Sandbox client used for every campaign cell's `runAgentRounds`.

##### toLoopOptions

> **toLoopOptions**: (`scenario`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Build the per-cell runAgentRounds options from the campaign scenario.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

##### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Map the finished loop to the artifact the campaign judges score.

###### Parameters

###### result

[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`TArtifact`

##### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Forward `loop.*` trace events into the campaign's scoped trace. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for this whole cell dispatch.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`) => `string` \| `undefined`

Resolve the model actually served from the completed loop.

###### Parameters

###### result

[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>

###### scenario

`TScenario`

###### Returns

`string` \| `undefined`

***

### McpEndpoint

Where a handle's MCP server lives; headers carry per-artifact scoping.

#### Properties

##### url

> **url**: `string`

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

***

### McpEnvironmentOptions

#### Properties

##### name

> **name**: `string`

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Cap on a tool result's text fed back to the worker. Default 1500 chars.

#### Methods

##### open()

> **open**(`task`): `Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

##### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](#surfacescore)\>

The deployable check over the artifact's current state.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`SurfaceScore`](#surfacescore)\>

##### close()?

> `optional` **close**(`handle`): `Promise`\<`void`\>

Teardown (delete the seeded artifact). Optional — omit for stateless servers.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

##### selectTools()?

> `optional` **selectTools**(`task`, `all`): [`AgenticTool`](#agentictool)[]

Restrict/order the server's tools per task (e.g. the task's selected_tools). Default: all.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### all

[`AgenticTool`](#agentictool)[]

###### Returns

[`AgenticTool`](#agentictool)[]

***

### ObserveInput

#### Properties

##### task

> **task**: `string`

What the worker was asked to do.

##### output

> **output**: `string`

What it produced (its final answer / artifact summary).

##### trace

> **trace**: readonly `unknown`[]

The worker's trace — any event array (sandbox events, tool-call records).

##### outcome?

> `optional` **outcome?**: `"unknown"` \| `"failed"` \| `"passed"`

Terminal status only (passed/failed/unknown) — NOT a judge score; the
 observer never reads the verdict, it reads behavior.

##### runId?

> `optional` **runId?**: `string`

Provenance back to the run.

***

### ObserveOptions

#### Properties

##### profile

> **profile**: `AgentProfile`

Exact analyst identity.

##### executor

> **executor**: [`ExecutorConfig`](#executorconfig)

Execution substrate. All behavior comes from the profile.

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

When set, learned facts are appended (idempotent) for the next run to read.

##### tags?

> `optional` **tags?**: readonly `string`[]

Tags written onto learned facts + used by the next run's corpus query.

##### signal?

> `optional` **signal?**: `AbortSignal`

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Cap the trace lines fed to the observer (keeps the call cheap). Default 80.

***

### Observation

#### Properties

##### findings

> **findings**: `ProposalFinding`[]

##### learned

> **learned**: [`CorpusRecord`](#corpusrecord)[]

Facts persisted to the corpus (empty when no corpus was supplied).

##### report

> **report**: `string`

Operator-facing markdown: what the observer noticed + what to change.

##### usage

> **usage**: `object`

Measured model usage for this analysis turn.

###### input

> **input**: `number`

###### output

> **output**: `number`

###### known

> **known**: `boolean`

***

### CreateScopeAnalystOptions

The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
The combinator supplies the analyst's task projection (how to frame the drained settlements as
the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.

#### Type Parameters

##### D

`D`

#### Properties

##### analyst

> `readonly` **analyst**: [`Agent`](#agent-2)\<`unknown`, readonly `AnalystFinding`[]\>

The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
 (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
 the RAW findings; this module asserts the firewall on them before returning.

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
 closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings.

##### label?

> `readonly` `optional` **label?**: `string`

Trace/journal label for the spawned analyst child. Default `'analyst'`.

#### Methods

##### buildTask()

> **buildTask**(`input`): `unknown`

Build the analyst agent's task from the analyze input (the root-task framing + the children
 drained so far). Pure projection — the analyst interprets it, this never reads it.

###### Parameters

###### input

[`ScopeAnalyzeInput`](#scopeanalyzeinput)\<`D`\>

###### Returns

`unknown`

***

### RegistryAnalyzeProjection

Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
`runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
settlements — so the CALLER owns the projection from the combinator's drained children to the
registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
bridge; it only runs the projected inputs and firewalls the merged findings.

#### Properties

##### runId

> `readonly` **runId**: `string`

##### inputs

> `readonly` **inputs**: `AnalystRunInputs`

##### opts?

> `readonly` `optional` **opts?**: `object`

Optional `run` opts (e.g. `priorFindings`, `chainFindings`) forwarded verbatim to the registry.

###### Index Signature

\[`k`: `string`\]: `unknown`

###### priorFindings?

> `optional` **priorFindings?**: readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

###### chainFindings?

> `optional` **chainFindings?**: `boolean`

***

### Persona

The "act like X" record. A thin composition over the keystone's `AgentSpec`: it pairs the
root spec (the executor mapping for the root agent the shape builds) with the CONTENT a
shape consumes — the goal framing (`directive`) and who the loop is acting as (`context`).

The framework never reads `directive`/`context` semantically; it threads them to the shape
verbatim through `ShapeContext`. This is the rule the mandate names: the FRAMEWORK is
structure, the PERSONA carries model/prompt/tools/directive. No model name, prompt, or
persona string is ever hardcoded in a shape or the engine.

`D` is the deliverable type this persona's loops produce; it flows into `Outcome<D>`.

#### Type Parameters

##### D

`D` = `unknown`

#### Properties

##### name

> `readonly` **name**: `string`

Stable persona name — used as the trace/journal label root, never as content.

##### root

> `readonly` **root**: [`AgentSpec`](index.md#agentspec)

The root agent's executor mapping (profile + harness + optional BYO executor). The
shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
are derived from / resolved against the same persona registry (see `ShapeContext`).

##### directive

> `readonly` **directive**: `string`

The goal framing handed to the shape — the "what to achieve", not "how".

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

Who the loop is acting as — the opaque persona context blob the shape may inject into
 child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it.

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
runtimes MUST supply a registry whose factories close over their seams (or BYO executors
on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
 the persona and the chosen shape must agree. Type-only — never present at runtime.

***

### PersonaContext

The persona context blob — who the loop is acting as. Open by intent: a persona names its
 own role/audience/constraints; the framework treats it as opaque content.

#### Indexable

> \[`key`: `string`\]: `unknown`

Open content bag — persona-specific fields a shape's child tasks may carry.

#### Properties

##### role

> `readonly` **role**: `string`

The role the loop embodies ("senior staff engineer", "equity research analyst", …).

##### notes?

> `readonly` `optional` **notes?**: `string`

Optional freeform framing the persona's prompts/profiles consume.

***

### PersonaExecutors

How a persona supplies executor resolution. Either a pre-built registry (factories already
closed over their seams) OR the raw seam bag the engine uses to construct a registry +
thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.

#### Properties

##### registry?

> `readonly` `optional` **registry?**: [`ExecutorRegistry`](index.md#executorregistry)

A registry whose factories already capture their seams. Highest precedence.

##### seams?

> `readonly` `optional` **seams?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys).

***

### DefinePersonaInput

The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 the executors-supplied invariant check and freeze the record.

#### Type Parameters

##### D

`D` = `unknown`

#### Properties

##### name

> `readonly` **name**: `string`

##### root

> `readonly` **root**: [`AgentSpec`](index.md#agentspec)

##### directive

> `readonly` **directive**: `string`

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
 the caller's shape must agree with. Type-only — never supplied at a call site.

***

### ShapeBudget

Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
against them and fails closed, so an over-eager shape can never overspend.

#### Properties

##### perChild

> `readonly` **perChild**: [`Budget`](index.md#budget-4)

Per-child spawn budget the shape reserves for each leaf/sub-loop it opens.

##### fanout

> `readonly` **fanout**: `number`

Max children a fanout step may open in one round (the shape's structural width).

***

### ShapeContext

The construction context a `LoopShape` factory receives. Carries the persona's resolved
executor seams + the budget knobs, plus the ONE helper a shape needs to spawn a child
through the keystone: `spawnChild` resolves an `AgentSpec` (or a persona-derived child
profile) into an `Agent` the shape hands to `scope.spawn`. The shape never touches the
registry directly — it asks the context, keeping resolution single-sourced.

#### Type Parameters

##### D

`D` = `unknown`

#### Properties

##### persona

> `readonly` **persona**: [`Persona`](#persona)\<`D`\>

##### budget

> `readonly` **budget**: [`ShapeBudget`](#shapebudget)

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
 dormant default (empty findings → gates read deliverables/state only).

#### Methods

##### spawnChild()

> **spawnChild**(`name`, `spec`): [`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`D`\>\>

Wrap an `AgentSpec` into a leaf `Agent` carrying it as `executorSpec`, so the shape can
`scope.spawn(spawnChild(spec), task, opts)`. `name` labels the child for traces. The
returned agent's `act` is never invoked by the keystone (it is spawned, not run) — the
spec drives the resolved `Executor`; `act` exists only to satisfy the `Agent` shape.

###### Parameters

###### name

`string`

###### spec

[`AgentSpec`](index.md#agentspec)

###### Returns

[`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`D`\>\>

##### childSpec()

> **childSpec**(`profile`, `harness?`): [`AgentSpec`](index.md#agentspec)

Derive a child `AgentSpec` from the persona's root spec with an overridden profile —
 the seam a shape uses to give a worker a narrower role/prompt than the root persona.

###### Parameters

###### profile

`AgentProfile`

###### harness?

`BackendType` \| `null`

###### Returns

[`AgentSpec`](index.md#agentspec)

***

### ShapeRegistry

The open shape registry — the extension point that makes a new loop-shape ONE file + one
`registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
`succeeded` before `value`); `register` fails loud on a duplicate name.

#### Methods

##### register()

> **register**\<`Task`, `D`\>(`name`, `factory`): `void`

###### Type Parameters

###### Task

`Task`

###### D

`D`

###### Parameters

###### name

`string`

###### factory

[`LoopShape`](#loopshape)\<`Task`, `D`\>

###### Returns

`void`

##### resolve()

> **resolve**\<`Task`, `D`\>(`name`): \{ `succeeded`: `true`; `value`: [`LoopShape`](#loopshape)\<`Task`, `D`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

###### Type Parameters

###### Task

`Task`

###### D

`D`

###### Parameters

###### name

`string`

###### Returns

\{ `succeeded`: `true`; `value`: [`LoopShape`](#loopshape)\<`Task`, `D`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

##### names()

> **names**(): `string`[]

The registered shape names — for diagnostics + a fail-loud "unknown shape" message.

###### Returns

`string`[]

***

### RunPersonifiedOptions

The end-to-end entrypoint. Builds the persona's root `Agent` from the chosen shape, then
runs it through a fresh `createSupervisor` over the persona's executors + the supplied
budget/journal/blobs. Returns the keystone's typed `SupervisedResult<Outcome<D>>` — a
`winner` carries the synthesized `Outcome<D>`; a `no-winner` is never coerced into one.

`shape` is either a resolved `LoopShape` or a registered shape NAME (resolved through the
default registry). The journal/blobs default to in-memory impls in the engine when omitted
(durable FS impls are passed explicitly for a persisted run).

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Properties

##### persona

> `readonly` **persona**: [`Persona`](#persona)\<`D`\>

##### shape

> `readonly` **shape**: `string` \| [`LoopShape`](#loopshape)\<`Task`, `D`\>

A resolved shape factory OR a registered shape name.

##### task

> `readonly` **task**: `Task`

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

##### shapeBudget?

> `readonly` `optional` **shapeBudget?**: `Partial`\<[`ShapeBudget`](#shapebudget)\>

Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`.

##### runId?

> `readonly` `optional` **runId?**: `string`

Trace/journal root key. Defaults to the persona name + a run discriminator in the engine.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Runtime recursion-depth ceiling, paired with the conserved pool.

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

OTP intensity breaker bounds, forwarded to the supervisor verbatim.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

##### handle?

> `readonly` `optional` **handle?**: [`RootHandle`](#roothandle-1)\<[`Outcome`](#outcome-2)\<`D`\>\>

A live root handle to attach (view/signal/abort) before the run starts.

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
 on trace-derived findings instead of the dormant empty default.

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle stream sink, forwarded to `SupervisorOpts.hooks` so the root `Scope`'s
`agent.spawn`/`agent.child` events flow to an observer (e.g. the Intelligence SDK's
trace export). Absent ⇒ no stream (the run is silent, as today).

***

### PipelineStage

`pipeline(stages)` — sequential composition: each stage's `Outcome.deliverable` feeds the next
stage's task (via `feed`). The first `blocked` stage short-circuits the whole pipeline (its
blockers ARE the pipeline's blockers — never coerced past a failed stage). The terminal
stage's `done` deliverable is the pipeline's deliverable. Spawns one child per stage in order;
a stage that the conserved pool cannot admit is a concrete blocker.

No domain: "code build test" is `pipeline([plan, implement, integrate])` under a coder persona,
not a named shape. A stage names only its label + how to derive its task from the prior output.

#### Type Parameters

##### Task

`Task`

##### StepIn

`StepIn`

##### StepOut

`StepOut`

#### Properties

##### label

> `readonly` **label**: `string`

Trace/journal label for this stage's spawned child.

#### Methods

##### feed()

> **feed**(`prior`, `ctx`, `rootTask`): `unknown`

Derive this stage's task from the prior stage's deliverable (or the root task for stage 0).
 Pure projection — the framework never interprets the result; the resolved leaf does.

###### Parameters

###### prior

`StepIn`

###### ctx

[`ShapeContext`](#shapecontext)\<`unknown`\>

###### rootTask

`Task`

###### Returns

`unknown`

##### collect()

> **collect**(`settled`): [`Outcome`](#outcome-2)\<`StepOut`\>

Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
 Fail loud (return a `blocked`) when the child produced nothing usable for the next stage.

###### Parameters

###### settled

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`StepOut`\>\>

###### Returns

[`Outcome`](#outcome-2)\<`StepOut`\>

***

### FanoutOptions

`fanout(items, { synthesize? })` — N children spawned in one round (one per item, bounded by
the conserved pool's fail-closed admission), drained via `scope.next()`, then optionally a
single SYNTHESIS child over the gathered results. Without `synthesize`, the combinator returns
the best-valid child via the single-sourced selector (selector≠judge). A round that admitted
zero children, or whose synthesis child could not be admitted, is a concrete blocker.

No domain: a "research sweep over angles" is `fanout(angles, { synthesize: cite })` under a
research persona; a "fanout-vote" is `fanout(copies)` with the default selector. The item list
+ the synthesis posture are the SHAPE's args; the prompt that turns an item into work is the
persona's.

#### Type Parameters

##### Item

`Item`

##### D

`D`

#### Properties

##### synthesize?

> `optional` **synthesize?**: [`FanoutSynthesis`](#fanoutsynthesis)\<`D`\>

Optional synthesis over the gathered child results: when present, the combinator spawns ONE
synthesis child whose task is built from the drained settlements, and its `done` output is
the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).

##### selectWinner?

> `optional` **selectWinner?**: [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
Receives the SAME `Iteration[]` the default selector reads (each child's output is its
`Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
…) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
synthesis child IS the selection); supplying both is a config error.

##### width?

> `optional` **width?**: `number`

Cap on how many item children run AT ONCE. When set, the fanout dispatches through
`rollingDispatch`: it fills `width` slots and admits the next item the moment one settles,
instead of opening every item in a single round. Same items, same selection, same conserved
pool — only the simultaneity changes.

Unset (the default) keeps the single-round batch behavior every existing caller has. Set it
when the items outnumber the live capacity a host can actually afford, so the pool is not
spent opening children that then queue behind a real fence.

#### Methods

##### itemTask()

> **itemTask**(`item`, `index`, `ctx`): `unknown`

One child task per item: `item` + the index discriminator. The persona's directive/context
 is threaded in by the combinator; this only supplies the per-item discriminator.

###### Parameters

###### item

`Item`

###### index

`number`

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### label()?

> `optional` **label**(`item`, `index`): `string`

Per-item child label (defaults to `item:<index>` in the impl).

###### Parameters

###### item

`Item`

###### index

`number`

###### Returns

`string`

##### itemSpec()?

> `optional` **itemSpec**(`item`, `index`, `ctx`): [`AgentSpec`](index.md#agentspec)

Optional per-item `AgentSpec` override. When set, each item's child is spawned against the
returned spec instead of `persona.root` — the seam a heterogeneous fanout uses to give each
item a DISTINCT executor (e.g. N authored harness profiles, each on its own worktree-CLI
leaf). Absent ⇒ every item runs against the persona's root spec (the homogeneous default).

###### Parameters

###### item

`Item`

###### index

`number`

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

[`AgentSpec`](index.md#agentspec)

***

### FanoutSynthesis

How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 settlements into the synthesis child's task; `collect` reads its settled output into the
 deliverable `Outcome<D>`.

#### Type Parameters

##### D

`D`

#### Methods

##### synthesisTask()

> **synthesisTask**(`gathered`, `ctx`): `unknown`

###### Parameters

###### gathered

readonly [`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`settled`): [`Outcome`](#outcome-2)\<`D`\>

###### Parameters

###### settled

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>

###### Returns

[`Outcome`](#outcome-2)\<`D`\>

***

### LoopUntilSpec

`loopUntil({ until, step })` — iterative deepening inside the conserved pool: spawn one `step`
child per round, ask `until` whether the accumulated state satisfies the goal, and stop when it
does OR when the pool can no longer admit a step (budget IS the loop bound — no unbounded
while). The deployable, non-oracle stop: `until` is the satisfiability gate, read from trace
findings + accumulated deliverables, never a fresh raw verdict the loop minted to stop itself.

No domain: "refine until tests pass" is `loopUntil` with a coder persona + a `step` that edits
and an `until` that reads the test-finding; the combinator owns only the round/stop wiring.

#### Type Parameters

##### Task

`Task`

##### State

`State`

##### D

`D`

#### Methods

##### step()

> **step**(`rootTask`, `state`, `ctx`): `unknown`

Build the next step child's task from the root task + the state accumulated so far.

###### Parameters

###### rootTask

`Task`

###### state

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### fold()

> **fold**(`prior`, `settled`): [`LoopUntilState`](#loopuntilstate-2)\<`State`\>

Fold one settled step into the accumulated state (the loop's running deliverable candidate).

###### Parameters

###### prior

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### settled

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>

###### Returns

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

##### until()

> **until**(`state`, `findings`): [`Outcome`](#outcome-2)\<`D`\> \| `null`

The satisfiability gate: given the accumulated state + the round's trace findings, has the
goal been reached? Returns the terminal deliverable when satisfied, or `null` to keep going.
Reads `findings` (trace-derived), NOT a raw verdict score — the deployable-stop discipline.

###### Parameters

###### state

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### findings

readonly `AnalystFinding`[]

###### Returns

[`Outcome`](#outcome-2)\<`D`\> \| `null`

##### label()?

> `optional` **label**(`round`): `string`

Per-round step label (defaults to `step:<round>` in the impl).

###### Parameters

###### round

`number`

###### Returns

`string`

***

### LoopUntilState

The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock).

#### Type Parameters

##### State

`State`

#### Properties

##### round

> `readonly` **round**: `number`

##### value

> `readonly` **value**: `State`

***

### PanelSpec

`panel(judges)` — M judges over ONE artifact, merged WRITE-ONLY (selector≠judge taken to its
limit). The combinator spawns the M judge children over the same input artifact, drains their
settlements, and MERGES their findings into a panel verdict via `merge` — a pure WRITE-ONLY
fold (a judge's output is never fed back to steer another judge, and the merge never re-ranks
the children behind the driver). The merged verdict gates the deliverable.

No domain: a "code review panel" and an "essay rubric panel" are the same `panel` shape under
different personas; the rubric lives in each judge persona's profile, not the combinator.

#### Type Parameters

##### Artifact

`Artifact`

##### D

`D`

#### Properties

##### judges

> `readonly` **judges**: readonly [`PanelJudge`](#paneljudge)[]

The M judge child specs: each is a persona-derived child (a narrower judge profile). The
 combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
 output reach another's task (write-only).

#### Methods

##### judgeTask()

> **judgeTask**(`artifact`, `judge`, `ctx`): `unknown`

Build one judge child's task from the shared artifact under review + the judge descriptor.

###### Parameters

###### artifact

`Artifact`

###### judge

[`PanelJudge`](#paneljudge)

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### merge()

> **merge**(`verdicts`, `artifact`): [`Outcome`](#outcome-2)\<`D`\>

Write-only merge: fold the M settled judge verdicts into the panel's terminal `Outcome<D>`.
Pure over the drained settlements — it MUST NOT spawn, re-judge, or feed one verdict into
another. A panel that reached no quorum is a concrete blocker (fail loud, never a vacuous done).

###### Parameters

###### verdicts

readonly [`PanelVerdict`](#panelverdict)[]

###### artifact

`Artifact`

###### Returns

[`Outcome`](#outcome-2)\<`D`\>

***

### PanelJudge

One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 the judge's profile; this carries only the label + the optional weight the merge may read.

#### Properties

##### label

> `readonly` **label**: `string`

##### weight?

> `readonly` `optional` **weight?**: `number`

Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl).

***

### PanelVerdict

One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 verdict (excluded from the merge `n`, like an infra-errored cell).

#### Properties

##### judge

> `readonly` **judge**: [`PanelJudge`](#paneljudge)

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

##### output?

> `readonly` `optional` **output?**: `unknown`

The judge child's raw output — what it was asked to assess, for a merge that quotes it.

##### down

> `readonly` **down**: `boolean`

True when the judge child went `down` (no usable verdict — kept out of the merge denominator).

***

### VerifySpec

`verify({ implement, verifier })` — the 2-node sequential gate: an IMPLEMENT child produces a
candidate, then a SEPARATE VERIFIER child's verdict GATES shippability. A `valid` verifier
verdict ships the implement deliverable; any other outcome (implement down, verifier down,
invalid verdict) becomes a concrete blocker carrying the failure verbatim — never a coerced
"done". The verifier is a distinct keystone agent (selector≠judge: the implement child does
not grade itself).

No domain: "write code then run the test gate" and "draft then fact-check" are the same `verify`
shape under different personas; the gate rubric is the verifier persona's, not the combinator's.

#### Type Parameters

##### Task

`Task`

##### Candidate

`Candidate`

##### D

`D`

#### Properties

##### implementLabel?

> `readonly` `optional` **implementLabel?**: `string`

Implement / verifier child labels (default `implement` / `verify` in the impl).

##### verifierLabel?

> `readonly` `optional` **verifierLabel?**: `string`

#### Methods

##### implement()

> **implement**(`rootTask`, `ctx`): `unknown`

Build the implement child's task from the root task.

###### Parameters

###### rootTask

`Task`

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### verifier()

> **verifier**(`candidate`, `ctx`): `unknown`

Build the verifier child's task from the implement child's settled candidate.

###### Parameters

###### candidate

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`Candidate`\>\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`candidate`, `verdict`): [`Outcome`](#outcome-2)\<`D`\>

Project the gated (verifier-`valid`) candidate into the terminal deliverable.

###### Parameters

###### candidate

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`Candidate`\>\>

###### verdict

`DefaultVerdict`

###### Returns

[`Outcome`](#outcome-2)\<`D`\>

***

### WidenSpec

`widen({ gate })` (G5) — the STREAMING spawn-on-completion driver. Unlike the static-fanout
combinators above, the widener REACTS to each `scope.next()`: as each child settles it consults
the `WidenGate` and, when a lineage is `promising`, widens by AT MOST ONE child toward it under
the remaining conserved pool. Defaults to FLAT (the gate never widens) so a gate run stays
non-widening and the R2 selector≠judge collision is dormant. `promising` is derived from the
round's analyst FINDINGS (via `ScopeAnalyst`, §2), NOT a child's raw `verdict` — the firewall.

This is the progressive-widening (MCTS-PW) combinator: the one shape whose breadth is decided
at runtime from the diagnosis, not fixed at spawn. It is the mechanism the diverse-strategy-vs-
blind GATE is run with — kept FLAT by default until that gate returns positive (don't build
mechanism ahead of the gate).

#### Type Parameters

##### Seed

`Seed`

##### D

`D`

#### Properties

##### seeds

> `readonly` **seeds**: readonly `Seed`[]

The initial children to spawn before any widening — the seed lineages the gate widens from.
 One child task per seed; bounded by the conserved pool's fail-closed admission.

##### gate

> `readonly` **gate**: [`ScopeWidenGate`](#scopewidengate)\<`D`\>

The progressive-widening gate. Consulted on EVERY settled child with the round's
trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.

#### Methods

##### seedTask()

> **seedTask**(`seed`, `index`, `ctx`): `unknown`

###### Parameters

###### seed

`Seed`

###### index

`number`

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### widenTask()

> **widenTask**(`toward`, `ctx`): `unknown`

Build the widened child's task from the lineage the gate chose to extend.

###### Parameters

###### toward

[`WidenLineage`](#widenlineage)\<`D`\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### synthesize()

> **synthesize**(`gathered`, `ctx`): [`Outcome`](#outcome-2)\<`D`\>

Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
 single-sourced selector over the gathered children, never a re-judge).

###### Parameters

###### gathered

readonly [`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

[`Outcome`](#outcome-2)\<`D`\>

***

### ScopeWidenGate

The runtime widening gate (the reactive analogue of the keystone's `WidenGate`, lifted to read
trace FINDINGS instead of a raw verdict). `decide` is consulted per settled child; it MUST
derive `promising` from `findings`, never from `settled.verdict`, unless `judgeExempt` is
explicitly argued (the documented off-by-default escape hatch). Flat default never widens.

#### Type Parameters

##### D

`D`

#### Properties

##### judgeExempt?

> `readonly` `optional` **judgeExempt?**: `boolean`

When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
 so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`).

#### Methods

##### decide()

> **decide**(`settled`, `findings`, `budget`): [`WidenDecision`](#widendecision)\<`D`\>

###### Parameters

###### settled

[`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>

###### findings

readonly `AnalystFinding`[]

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

[`WidenDecision`](#widendecision)\<`D`\>

***

### WidenLineage

A lineage the gate may widen toward — the settled child that looked promising + the findings
 that justified it (the trace-derived provenance the firewall requires).

#### Type Parameters

##### D

`D`

#### Properties

##### settled

> `readonly` **settled**: `object`

###### kind

> **kind**: `"done"`

###### handle

> **handle**: [`Handle`](#handle-3)\<[`Outcome`](#outcome-2)\<`D`\>\>

###### out

> **out**: [`Outcome`](#outcome-2)

###### outRef

> **outRef**: `string`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](index.md#spend)

###### providerModel?

> `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence)

Provider model evidence for every inference attempt owned by this node.

###### trace

> **trace**: [`WorkerTraceEvidence`](index.md#workertraceevidence)

Structured tool evidence captured before this settlement was journaled.

###### settledAt?

> `optional` **settledAt?**: `number`

Epoch ms parsed from the durable settlement record when available.

###### seq

> **seq**: `number`

##### findings

> `readonly` **findings**: readonly `AnalystFinding`[]

***

### ScopeAnalyst

The reactive analyst seam — the PORT of the round-synchronous driver's `analyze` hook
(dynamic.ts) onto the reactive `Scope`. The old driver wired the analyst at round
boundaries (`plan` ran the analyst over `history` BEFORE the planner); the reactive `Scope` has
no rounds, so this carries the wire across: a combinator's `act` asks the `ScopeAnalyst` to turn
the settled children SO FAR into `AnalystFinding[]`, and steers from THOSE findings.

The firewall is preserved (selector≠judge): `analyze` runs the trace-derived analyst and the
impl asserts `assertTraceDerivedFindings` semantics — a finding citing judge/verdict/score
`metric` evidence aborts the round. The steer decision reads `findings`, NEVER the children's
raw `verdict`. Fail loud — a throwing or non-array analyst aborts (no silent empty findings).

#### Type Parameters

##### D

`D`

#### Methods

##### analyze()

> **analyze**(`input`): `Promise`\<readonly `AnalystFinding`[]\>

Turn the children settled so far into trace-derived findings. `settledSoFar` is the cursor-
ordered settlement list a combinator has drained (the reactive analogue of the old driver's
`history`). The impl runs the analyst, then enforces the trace-derived firewall before
returning — a judge-derived finding is rejected, not filtered.

###### Parameters

###### input

[`ScopeAnalyzeInput`](#scopeanalyzeinput)\<`D`\>

###### Returns

`Promise`\<readonly `AnalystFinding`[]\>

***

### ScopeAnalyzeInput

Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far.

#### Type Parameters

##### D

`D`

#### Properties

##### task

> `readonly` **task**: `unknown`

Opaque root-task framing (whatever the combinator was invoked with).

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>[]

The children this combinator has drained off `scope.next()`, in cursor order.

##### nodeId

> `readonly` **nodeId**: `string`

This combinator's scope id (the trace-correlation root for the analyst).

***

### SteerContext

How a combinator's `act` consumes findings to steer — the SINGLE firewalled steer surface a
reactive combinator reads. `loopUntil.until`, `widen` gate, and any future steer all funnel
through a `SteerContext` so the firewall is enforced in one place: `findings` is trace-derived
(the analyst already asserted it), and a combinator MUST NOT reach back to `settled.verdict`
for the steer decision. `lastValidScore` is provided for OBSERVABILITY only (rendering/traces),
explicitly NOT for steering — reading it to steer is the coupling the architecture forbids.

#### Type Parameters

##### D

`D`

#### Properties

##### findings

> `readonly` **findings**: readonly `AnalystFinding`[]

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>[]

##### lastValidScore?

> `readonly` `optional` **lastValidScore?**: `number`

Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
 off this re-introduces selector=judge. Marked so a reviewer catches a misuse.

***

### CorpusRecord

One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
relevant, high-confidence subset.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

##### id

> `readonly` **id**: `string`

Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups.

##### runId

> `readonly` **runId**: `string`

The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace.

##### producedAt

> `readonly` **producedAt**: `string`

##### area

> `readonly` **area**: `string`

Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`).

##### claim

> `readonly` **claim**: `string`

The accreted fact — the instruction-shaped statement the next run reads back.

##### rationale?

> `readonly` `optional` **rationale?**: `string`

Optional supporting detail the renderer may include under the claim.

##### tags

> `readonly` **tags**: readonly `string`[]

Free-form tags for `query` filtering (domain, persona, surface).

##### confidence

> `readonly` **confidence**: `number`

0..1 — the producing run's confidence in this fact (the render threshold reads it).

##### evidence?

> `readonly` `optional` **evidence?**: readonly `object`[]

Optional provenance back into the run that learned it (a finding id / outRef / span).

***

### CorpusFilter

A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain.

#### Properties

##### area?

> `readonly` `optional` **area?**: `string`

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Match records carrying ALL of these tags.

##### minConfidence?

> `readonly` `optional` **minConfidence?**: `number`

Minimum confidence a record must clear to be returned (the render gate).

##### runId?

> `readonly` `optional` **runId?**: `string`

Only records from this run (rare — usually a cross-run read).

##### limit?

> `readonly` `optional` **limit?**: `number`

Cap the result count (most-confident first in the impl).

***

### Corpus

The durable cross-run corpus — the learning-flywheel store. DISTINCT from `SpawnJournal`
(per-run decisions, replay) and `ResultBlobStore` (per-run payloads): `Corpus` holds accreted
FACTS across runs that the next run reads back. `InMemoryCorpus` + `FileCorpus` (JSONL) impls
live in `corpus.ts` and MAY share a storage spine with the JSONL journal, but the INTERFACE is
separate so a consumer never confuses a replay record with a learned fact.

Fail-loud, typed-outcome boundary: `append` is idempotent on an identical record (same `id` +
`claim`); a conflicting re-append under the same `id` is a typed error, never a silent overwrite.

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

***

### RenderCorpusToInstructionsOptions

Project accreted corpus facts into an `AgentProfile`'s instruction seams — the learning-flywheel
READ side. Reads the corpus through `filter`, renders the matching facts into instruction lines,
and returns a NEW profile with them merged into `prompt.instructions` (the append-line seam) so
the next run's persona reads the accreted world-model. Pure projection over the queried records;
never mutates the input profile (returns a fresh one). The impl lives in `corpus.ts`.

`resources.instructions` is `string | AgentProfileResourceRef`; `prompt.instructions` is
`string[]`. The render targets `prompt.instructions` (additive lines) by default; a caller that
wants the single-blob `resources.instructions` form passes `target: 'resources'`.

#### Properties

##### corpus

> `readonly` **corpus**: [`Corpus`](#corpus-2)

##### filter

> `readonly` **filter**: [`CorpusFilter`](#corpusfilter)

##### profile

> `readonly` **profile**: `AgentProfile`

The profile to project the facts into. The result is a fresh profile — the input is unchanged.

##### target?

> `readonly` `optional` **target?**: `"resources"` \| `"prompt"`

Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
 the single-blob `resources.instructions` string.

##### maxLines?

> `readonly` `optional` **maxLines?**: `number`

Optional cap on rendered lines (most-confident first), independent of the query `limit`.

***

### TrajectoryNode

One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
`Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.

#### Properties

##### id

> `readonly` **id**: `string`

##### parent?

> `readonly` `optional` **parent?**: `string`

##### children

> `readonly` **children**: readonly `string`[]

##### label

> `readonly` **label**: `string`

##### runtime

> `readonly` **runtime**: `string`

##### status

> `readonly` **status**: `"done"` \| `"failed"` \| `"cancelled"` \| `"pending"` \| `"waiting"`

Terminal status the journal recorded for this node. `'waiting'` is a wait-state node that was
 armed and never woken — the journal's record of a run that died mid-wait.

##### ownSpend

> `readonly` **ownSpend**: [`Spend`](index.md#spend)

This node's OWN conserved spend (from its `settled` event).

##### rolledUpSpend

> `readonly` **rolledUpSpend**: [`Spend`](index.md#spend)

This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
 "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis).

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

The node's verdict, when its settlement carried one (observability — NOT a steer input).

##### output?

> `readonly` `optional` **output?**: `unknown`

The rehydrated output artifact, when `withOutputs` was requested + the blob resolved.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

***

### TrajectoryReport

The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read.

#### Properties

##### root

> `readonly` **root**: `string`

##### nodes

> `readonly` **nodes**: readonly [`TrajectoryNode`](#trajectorynode)[]

Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges).

##### total

> `readonly` **total**: [`Spend`](index.md#spend)

The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms).

##### statusCounts

> `readonly` **statusCounts**: `Readonly`\<`Record`\<[`TrajectoryNode`](#trajectorynode)\[`"status"`\], `number`\>\>

Count of nodes by terminal status — a quick "how did the tree end" readout.

***

### TrajectoryReportOptions

`trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
impl lives in `trajectory.ts`.

#### Properties

##### withOutputs?

> `readonly` `optional` **withOutputs?**: `boolean`

Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report).

***

### EqualKArm

One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
(not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
iteration count.

#### Properties

##### label

> `readonly` **label**: `string`

##### report

> `readonly` **report**: [`TrajectoryReport`](#trajectoryreport-3)

***

### EqualKVerdict

The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
NOT comparable at equal compute — a confound to report, not a result to publish.

#### Properties

##### withinTolerance

> `readonly` **withinTolerance**: `boolean`

##### arms

> `readonly` **arms**: readonly `object`[]

Per-arm conserved cost (the basis: tokens total + usd).

##### spread

> `readonly` **spread**: `object`

The realized spread on each channel (max − min across arms), for the report.

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

##### tolerance

> `readonly` **tolerance**: `number`

The fractional tolerance the check used (spread / median ≤ tolerance per channel).

***

### EqualKOnCostOptions

`equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
(tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
impl lives in `trajectory.ts`. Pure over the reports — no I/O.

#### Properties

##### tolerance?

> `readonly` `optional` **tolerance?**: `number`

Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
 the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim.

***

### PromotionGateOptions

#### Properties

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

The HOLDOUT report — must carry per-task cells for both strategy names.

##### incumbent

> **incumbent**: `string`

The incumbent champion's strategy name.

##### candidate

> **candidate**: `string`

The challenger's strategy name.

##### mode?

> `optional` **mode?**: `"superiority"` \| `"non-inferiority"`

'superiority' (default): the candidate must score significantly BETTER.
 'non-inferiority': the candidate must prove its score is not worse than the
 incumbent by more than `scoreTolerance` AND its cost savings are significant —
 the gate for "same quality, cheaper" claims.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### deltaThreshold?

> `optional` **deltaThreshold?**: `number`

The CI lower bound on the paired lift must EXCEED this (score scale). Default 0.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Minimum paired tasks before significance can be claimed. Default 6 — below that
 the bootstrap CI is too wide to separate a real lift from the per-task noise.

##### statistic?

> `optional` **statistic?**: `"mean"` \| `"median"`

Bootstrap statistic over the paired deltas. Default 'mean'.

##### seed?

> `optional` **seed?**: `number`

Fixed by the substrate by default — the same report always yields the same verdict.

##### resamples?

> `optional` **resamples?**: `number`

***

### PromotionVerdict

#### Properties

##### promoted

> **promoted**: `boolean`

##### reason

> **reason**: `"identical-champion"` \| `"few-tasks"` \| `"no-margin"` \| `"significant"` \| `"non-inferior-and-cheaper"` \| `"non-inferiority-unproven"` \| `"not-cheaper"`

##### mode

> **mode**: `"superiority"` \| `"non-inferiority"`

##### n

> **n**: `number`

Paired tasks that carried both strategies' cells.

##### lift

> **lift**: `object`

Paired (candidate − incumbent) lift across the holdout tasks. `low` and `high`
 are the bounds that carried the decision; `mean` and `median` are diagnostics.

###### mean

> **mean**: `number`

###### median

> **median**: `number`

###### low

> **low**: `number`

###### high

> **high**: `number`

##### costSavings?

> `optional` **costSavings?**: `object`

non-inferiority mode: paired (incumbent − candidate) cost savings per task (usd).
 Positive means the candidate is cheaper; `low` and `high` carried the decision.

###### mean

> **mean**: `number`

###### median

> **median**: `number`

###### low

> **low**: `number`

###### high

> **high**: `number`

##### latency?

> `optional` **latency?**: `object`

Paired (candidate − incumbent) wall-clock per task (ms) — negative = the candidate
 is FASTER. Informational in every mode (never gates); the latency answer to "what
 does this win actually cost the user?".

###### mean

> **mean**: `number`

###### median

> **median**: `number`

###### low

> **low**: `number`

###### high

> **high**: `number`

***

### ResolveSandboxClientOptions

#### Properties

##### backend

> **backend**: `"router"` \| `"sandbox"` \| `"bridge"` \| `"local"`

The execution transport for the driven loop.

##### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](#sandboxclient-5)

`sandbox` backend: the caller's real Sandbox-backed client. Required for that backend.

##### bridge?

> `optional` **bridge?**: `object`

`bridge` backend: local cli-bridge transport. The per-create profile owns the model.

###### url?

> `optional` **url?**: `string`

cli-bridge base URL. Defaults to `http://127.0.0.1:3355`.

###### bearer

> **bearer**: `string`

###### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-turn deadline (ms).

##### router?

> `optional` **router?**: `object`

`router` backend: endpoint/auth only; the per-create profile owns behavior.

###### baseUrl

> **baseUrl**: `string`

###### key

> **key**: `string`

##### local?

> `optional` **local?**: [`LocalSandboxClientOptions`](#localsandboxclientoptions)

`local` backend: same-host pseudo-box — the router brain drives a tool loop
 with the profile's stdio MCP servers spawned as local children.

***

### ClaimRetainedInteractiveControlOptions

**`Stable`**

Input for acquiring write authority over one exact interactive process.

#### Properties

##### handle

> `readonly` **handle**: [`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle)

##### holderId

> `readonly` **holderId**: `string`

##### expectedGeneration?

> `readonly` `optional` **expectedGeneration?**: `number`

Last known provider generation. Zero discovers the current generation safely.

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### RetainedInteractiveStartMaterial

**`Stable`**

Material used to create and start one native coding-agent TUI.

#### Extended by

- [`StartRetainedInteractiveRunOptions`](#startretainedinteractiverunoptions)

#### Properties

##### environment

> `readonly` **environment**: [`RetainedInteractiveEnvironmentInput`](#retainedinteractiveenvironmentinput)

##### interactiveIdempotencyKey

> `readonly` **interactiveIdempotencyKey**: `string`

##### initialPrompt?

> `readonly` `optional` **initialPrompt?**: `string`

##### cwd?

> `readonly` `optional` **cwd?**: `string`

##### cols?

> `readonly` `optional` **cols?**: `number`

##### rows?

> `readonly` `optional` **rows?**: `number`

***

### StartRetainedInteractiveRunOptions

**`Stable`**

Start one retry-safe native coding-agent TUI in a new environment.

#### Extends

- [`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial)

#### Properties

##### environment

> `readonly` **environment**: [`RetainedInteractiveEnvironmentInput`](#retainedinteractiveenvironmentinput)

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`environment`](#environment)

##### interactiveIdempotencyKey

> `readonly` **interactiveIdempotencyKey**: `string`

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`interactiveIdempotencyKey`](#interactiveidempotencykey)

##### initialPrompt?

> `readonly` `optional` **initialPrompt?**: `string`

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`initialPrompt`](#initialprompt)

##### cwd?

> `readonly` `optional` **cwd?**: `string`

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`cwd`](#cwd)

##### cols?

> `readonly` `optional` **cols?**: `number`

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`cols`](#cols)

##### rows?

> `readonly` `optional` **rows?**: `number`

###### Inherited from

[`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial).[`rows`](#rows)

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### intent?

> `readonly` `optional` **intent?**: [`RetainedInteractiveIntentAdmission`](#retainedinteractiveintentadmission)

A previously persisted intent used to replay the exact create operation.

##### onAdmission

> `readonly` **onAdmission**: [`RetainedInteractiveAdmissionHook`](#retainedinteractiveadmissionhook)

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### ReconnectRetainedInteractiveRunOptions

**`Stable`**

Reconstruct one exact provider-owned native coding-agent process.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### ref

> `readonly` **ref**: `object`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### RecoverRetainedInteractiveRunOptions

**`Stable`**

Recover a start after a pre-create crash or a lost provider response.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### admission

> `readonly` **admission**: [`RetainedInteractiveIntentAdmission`](#retainedinteractiveintentadmission) \| [`RetainedInteractiveEnvironmentAdmission`](#retainedinteractiveenvironmentadmission)

##### replay?

> `readonly` `optional` **replay?**: [`RetainedInteractiveStartMaterial`](#retainedinteractivestartmaterial)

Required when recovering from an intent before an environment existed.

##### onAdmission

> `readonly` **onAdmission**: [`RetainedInteractiveAdmissionHook`](#retainedinteractiveadmissionhook)

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### RetainedInteractiveRunHandle

**`Stable`**

Exact interactive process controls plus measured environment capabilities.

#### Extends

- `AgentInteractiveSession`

#### Properties

##### capabilities

> `readonly` **capabilities**: `AgentEnvironmentCapabilities`

#### Methods

##### sendPrompt()

> **sendPrompt**(`command`, `options?`): `Promise`\<`AgentInteractiveSessionPromptAcknowledgement`\>

###### Parameters

###### command

`AgentInteractiveSessionPromptCommand`

###### options?

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`AgentInteractiveSessionPromptAcknowledgement`\>

###### Overrides

`AgentInteractiveSession.sendPrompt`

***

### RetainedRunReplayPoint

**`Stable`**

Cursor plus runtime sequence needed to continue one ordered replay.

#### Properties

##### cursor

> `readonly` **cursor**: `string`

##### sequence

> `readonly` **sequence**: `number`

***

### RetainedRunEventOptions

**`Stable`**

Options for replaying canonical events strictly after a saved point.

#### Properties

##### after?

> `readonly` `optional` **after?**: [`RetainedRunReplayPoint`](#retainedrunreplaypoint)

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### RetainedRunSnapshot

**`Stable`**

Stable status snapshot for a retained run.

#### Properties

##### runId

> `readonly` **runId**: `string`

##### controlRef

> `readonly` **controlRef**: `AgentExactRunControlRef`

##### status

> `readonly` **status**: `AgentSessionStatus` \| `null`

##### effect

> `readonly` **effect**: [`RetainedRunEffect`](#retainedruneffect)

##### observedAt

> `readonly` **observedAt**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

##### signal?

> `readonly` `optional` **signal?**: `string`

***

### RetainedRunCancellation

**`Stable`**

Durable acknowledgement state for one retained control operation.

#### Properties

##### operationId

> `readonly` **operationId**: `string`

##### requestDigest

> `readonly` **requestDigest**: `` `sha256:${string}` ``

##### status

> `readonly` **status**: `"unknown"` \| `"replayed"` \| `"accepted"` \| `"conflict"`

##### effect

> `readonly` **effect**: [`RetainedRunEffect`](#retainedruneffect)

##### snapshot

> `readonly` **snapshot**: [`RetainedRunSnapshot`](#retainedrunsnapshot)

##### reason?

> `readonly` `optional` **reason?**: `string`

##### signal?

> `readonly` `optional` **signal?**: `string`

***

### RetainedRunCancelOptions

**`Stable`**

Options for an idempotent retained cancellation.

#### Properties

##### operationId

> `readonly` **operationId**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

***

### RetainedRunHandle

**`Stable`**

Reconstructable control of one provider-retained run.

#### Properties

##### controlRef

> `readonly` **controlRef**: `AgentExactRunControlRef`

##### capabilities

> `readonly` **capabilities**: `AgentEnvironmentCapabilities`

Capabilities measured from the exact environment that owns this run.

#### Methods

##### status()

> **status**(`options?`): `Promise`\<[`RetainedRunSnapshot`](#retainedrunsnapshot)\>

###### Parameters

###### options?

###### waitMs?

`number`

###### signal?

`AbortSignal`

###### Returns

`Promise`\<[`RetainedRunSnapshot`](#retainedrunsnapshot)\>

##### events()

> **events**(`options?`): `AsyncIterable`\<`RuntimeEventEnvelope`\>

###### Parameters

###### options?

[`RetainedRunEventOptions`](#retainedruneventoptions)

###### Returns

`AsyncIterable`\<`RuntimeEventEnvelope`\>

##### result()

> **result**(): `Promise`\<`AgentTurnResult`\>

###### Returns

`Promise`\<`AgentTurnResult`\>

##### respondToInteraction()

> **respondToInteraction**(`command`, `options?`): `Promise`\<\{ \}\>

###### Parameters

###### command

###### options?

###### signal?

`AbortSignal`

###### Returns

`Promise`\<\{ \}\>

##### contextBoundary()

> **contextBoundary**(`options?`): `Promise`\<\{ \} \| `null`\>

###### Parameters

###### options?

###### signal?

`AbortSignal`

###### Returns

`Promise`\<\{ \} \| `null`\>

##### continueNative()

> **continueNative**(`request`, `turn`): `Promise`\<\{ \} \| \{ \}\>

###### Parameters

###### request

`NativeContextContinuationRequest`

###### turn

[`NativeContextContinuationInput`](#nativecontextcontinuationinput)

###### Returns

`Promise`\<\{ \} \| \{ \}\>

##### cancel()

> **cancel**(`options`): `Promise`\<[`RetainedRunCancellation`](#retainedruncancellation)\>

###### Parameters

###### options

[`RetainedRunCancelOptions`](#retainedruncanceloptions)

###### Returns

`Promise`\<[`RetainedRunCancellation`](#retainedruncancellation)\>

***

### RetainedRunIntentAdmission

**`Stable`**

Sanitized headless intent durable before environment creation.

The request digest binds the public create and turn material without
retaining secret values. The original start material is required to replay
this record after a process crash.

#### Properties

##### phase

> `readonly` **phase**: `"intent"`

##### provider

> `readonly` **provider**: `string`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### turnId

> `readonly` **turnId**: `string`

##### sessionId

> `readonly` **sessionId**: `string`

##### executionId

> `readonly` **executionId**: `string`

##### runId

> `readonly` **runId**: `string`

##### requestedProfileDigest

> `readonly` **requestedProfileDigest**: `` `sha256:${string}` ``

##### requestDigest

> `readonly` **requestDigest**: `` `sha256:${string}` ``

***

### RetainedRunEnvironmentAdmission

**`Stable`**

Recovery coordinates durable after environment creation and before dispatch.

#### Properties

##### phase

> `readonly` **phase**: `"environment"`

##### provider

> `readonly` **provider**: `string`

##### environmentId

> `readonly` **environmentId**: `string`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### turnId

> `readonly` **turnId**: `string`

##### sessionId

> `readonly` **sessionId**: `string`

Caller-supplied or runtime-minted; always the identity the dispatch will request.

##### executionId

> `readonly` **executionId**: `string`

Caller-supplied or runtime-minted; always the identity the dispatch will request.

***

### RetainedRunDispatchedAdmission

**`Stable`**

The verified exact reference, durable before the start promise resolves.

#### Properties

##### phase

> `readonly` **phase**: `"dispatched"`

##### controlRef

> `readonly` **controlRef**: `AgentExactRunControlRef`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### turnId

> `readonly` **turnId**: `string`

***

### RetainedInteractiveIntentAdmission

**`Stable`**

Sanitized intent durable before an interactive environment create begins.

The digest covers the public start and create material without retaining that
material. It never carries environment variables, secret values, or provider
options. The replay input supplies private values after this check.

#### Properties

##### phase

> `readonly` **phase**: `"interactive_intent"`

##### provider

> `readonly` **provider**: `string`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### interactiveIdempotencyKey

> `readonly` **interactiveIdempotencyKey**: `string`

##### sessionId

> `readonly` **sessionId**: `string`

##### executionId

> `readonly` **executionId**: `string`

##### runId

> `readonly` **runId**: `string`

##### requestedProfileDigest

> `readonly` **requestedProfileDigest**: `` `sha256:${string}` ``

##### requestDigest

> `readonly` **requestDigest**: `` `sha256:${string}` ``

***

### RetainedInteractiveEnvironmentAdmission

**`Stable`**

Exact interactive start request durable after environment creation.

#### Properties

##### phase

> `readonly` **phase**: `"interactive_environment"`

##### provider

> `readonly` **provider**: `string`

##### environmentId

> `readonly` **environmentId**: `string`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### interactiveIdempotencyKey

> `readonly` **interactiveIdempotencyKey**: `string`

##### request

> `readonly` **request**: `object`

***

### RetainedInteractiveStartedAdmission

**`Stable`**

Provider-issued interactive process reference durable before start returns.

#### Properties

##### phase

> `readonly` **phase**: `"interactive_started"`

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### interactiveIdempotencyKey

> `readonly` **interactiveIdempotencyKey**: `string`

##### ref

> `readonly` **ref**: `object`

***

### RetainedRunStartMaterial

**`Stable`**

Environment, turn, and optional identity needed to replay one retained start.

#### Extended by

- [`StartRetainedRunOptions`](#startretainedrunoptions)

#### Properties

##### environment

> `readonly` **environment**: `CreateAgentEnvironmentInput` & `object`

###### Type Declaration

###### idempotencyKey

> **idempotencyKey**: `string`

##### turn

> `readonly` **turn**: `AgentTurnInput` & `object`

###### Type Declaration

###### turnId

> **turnId**: `string`

##### identity?

> `readonly` `optional` **identity?**: `object`

Explicit dispatch coordinates. When omitted, the runtime mints
deterministic coordinates from `(environment.idempotencyKey, turn.turnId)`
so every process derives the same values.

###### sessionId

> `readonly` **sessionId**: `string`

###### executionId

> `readonly` **executionId**: `string`

***

### StartRetainedRunOptions

**`Stable`**

A retained start is retry-safe only when environment and turn keys are explicit.

#### Extends

- [`RetainedRunStartMaterial`](#retainedrunstartmaterial)

#### Properties

##### environment

> `readonly` **environment**: `CreateAgentEnvironmentInput` & `object`

###### Type Declaration

###### idempotencyKey

> **idempotencyKey**: `string`

###### Inherited from

[`RetainedRunStartMaterial`](#retainedrunstartmaterial).[`environment`](#environment-2)

##### turn

> `readonly` **turn**: `AgentTurnInput` & `object`

###### Type Declaration

###### turnId

> **turnId**: `string`

###### Inherited from

[`RetainedRunStartMaterial`](#retainedrunstartmaterial).[`turn`](#turn)

##### identity?

> `readonly` `optional` **identity?**: `object`

Explicit dispatch coordinates. When omitted, the runtime mints
deterministic coordinates from `(environment.idempotencyKey, turn.turnId)`
so every process derives the same values.

###### sessionId

> `readonly` **sessionId**: `string`

###### executionId

> `readonly` **executionId**: `string`

###### Inherited from

[`RetainedRunStartMaterial`](#retainedrunstartmaterial).[`identity`](#identity-1)

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### intent?

> `readonly` `optional` **intent?**: [`RetainedRunIntentAdmission`](#retainedrunintentadmission)

A previously persisted intent used to replay the exact create operation.

##### onAdmission

> `readonly` **onAdmission**: [`RetainedRunAdmissionHook`](#retainedrunadmissionhook)

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### StartRetainedRunInEnvironmentOptions

**`Stable`**

A fresh retained session inside a provider environment that already exists.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### environment

> `readonly` **environment**: `object`

###### id

> `readonly` **id**: `string`

Stable provider environment identifier used by `provider.get`.

###### idempotencyKey

> `readonly` **idempotencyKey**: `string`

Original environment key. The provider must return the matching retained metadata.

##### turn

> `readonly` **turn**: `AgentTurnInput` & `object`

###### Type Declaration

###### turnId

> **turnId**: `string`

##### identity?

> `readonly` `optional` **identity?**: `object`

Explicit fresh-session coordinates. When omitted, the runtime mints them
from `(environment.idempotencyKey, turn.turnId)`.

###### sessionId

> `readonly` **sessionId**: `string`

###### executionId

> `readonly` **executionId**: `string`

##### onAdmission

> `readonly` **onAdmission**: [`RetainedRunAdmissionHook`](#retainedrunadmissionhook)

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### ReconnectRetainedRunOptions

**`Stable`**

Inputs sufficient to rebuild a control client in a new process.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### controlRef

> `readonly` **controlRef**: `AgentExactRunControlRef`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### RecoverRetainedRunIntentOptions

**`Stable`**

Recover a headless start after its pre-create intent was persisted.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### admission

> `readonly` **admission**: [`RetainedRunIntentAdmission`](#retainedrunintentadmission)

##### replay

> `readonly` **replay**: [`RetainedRunStartMaterial`](#retainedrunstartmaterial)

The exact original environment, turn, and optional identity material.

##### onAdmission

> `readonly` **onAdmission**: [`RetainedRunAdmissionHook`](#retainedrunadmissionhook)

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### RecoverRetainedRunOptions

**`Stable`**

Pre-dispatch admission coordinates for one recovery attempt.

A `phase: 'environment'` admission record carries these fields, so a caller
can pass that record after a crash before the dispatched record landed.

#### Properties

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

##### environmentId

> `readonly` **environmentId**: `string`

##### sessionId

> `readonly` **sessionId**: `string`

##### executionId

> `readonly` **executionId**: `string`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### RouterTransportConfig

Connection details for Runtime's Router-backed executors.

This is deliberately transport-only: model, prompt, tools, generation settings, and retry
policy belong to the exact executable `AgentProfile` consumed by `streamAgentTurn`.

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

##### routerKey

> **routerKey**: `string`

##### complete?

> `optional` **complete?**: (`body`, `request?`) => `Promise`\<`unknown`\>

Injectable OpenAI-compatible transport for offline execution.

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### request?

###### headers

`Readonly`\<`Record`\<`string`, `string`\>\>

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`unknown`\>

***

### ToolSpec

#### Properties

##### type

> **type**: `"function"`

##### function

> **function**: `object`

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `unknown`

***

### BenchmarkConfig

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

The task domain (5 hooks).

##### tasks

> **tasks**: [`AgenticTask`](#agentictask)[]

The tasks to score across.

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

The worker: model + router + (optional) the critic's instruction (the steerer knob).

##### strategies?

> `optional` **strategies?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>[]

Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
 Default: [sample, refine].

##### budget?

> `optional` **budget?**: `number`

Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Tasks scored in parallel. Default 3.

##### onTask?

> `optional` **onTask?**: (`row`, `done`, `total`) => `void`

Progress hook — fires as each task settles (the live-monitoring seam: append to a
 progress file, render a tree, stream to a dashboard). `done` counts settled tasks.

###### Parameters

###### row

[`BenchmarkTaskRow`](#benchmarktaskrow)

###### done

`number`

###### total

`number`

###### Returns

`void`

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
 here live (the watchdog/route-auditor seam, passed through to `runAgentic`).

##### modelPreflight?

> `optional` **modelPreflight?**: `false` \| ((`model`, `worker`, `signal`) => `Promise`\<`void`\>)

Model availability check before tasks start.

By default, live router workers send one one-token request per unique worker and analyst
model. Injected `worker.complete` transports skip the check. Pass `false` to disable it or a
callback to check each unique model through a custom transport.

##### modelPreflightTimeoutMs?

> `optional` **modelPreflightTimeoutMs?**: `number`

Maximum time for each model availability check. Default 30 seconds.

***

### BenchmarkLift

#### Properties

##### mean

> **mean**: `number`

Mean of paired deltas (refine − sample).

##### low

> **low**: `number`

##### high

> **high**: `number`

##### n

> **n**: `number`

***

### BenchmarkCell

One strategy's outcome on one task — the per-task cell an optimizer consumes.

#### Properties

##### score

> **score**: `number`

##### resolved

> **resolved**: `boolean`

##### progression

> **progression**: `number`[]

The progress curve (refine: score per shot; sample: best-so-far per rollout).

##### usd

> **usd**: `number`

##### usdKnown

> **usdKnown**: `boolean`

##### ms

> **ms**: `number`

##### tokens

> **tokens**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

##### tokensKnown

> **tokensKnown**: `boolean`

***

### BenchmarkTaskRow

#### Properties

##### taskId

> **taskId**: `string`

##### cells?

> `optional` **cells?**: `Record`\<`string`, [`BenchmarkCell`](#benchmarkcell)\>

Per-strategy cells; absent when the task errored before completing all strategies.

##### errors?

> `optional` **errors?**: `Record`\<`string`, `string`\>

Per-strategy failures on this task: the strategy competed, threw, and scored an
 honest zero — it loses, it does not poison the row. The message is kept so a later
 generation's author can see WHY a candidate died.

##### error?

> `optional` **error?**: `string`

Why the task was excluded (infra/setup failure) — never silently dropped.

***

### BenchmarkStrategySummary

#### Properties

##### score

> **score**: `number`

Mean verifier score (0..1).

##### resolved

> **resolved**: `number`

Fraction of tasks fully resolved.

##### usd

> **usd**: `number`

Mean cost vector per task.

##### usdKnownRate

> **usdKnownRate**: `number`

Fraction of task cells whose billed-dollar total was complete.

##### ms

> **ms**: `number`

***

### BenchmarkReport

Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines.

#### Properties

##### n

> **n**: `number`

##### excluded

> **excluded**: `number`

##### perStrategy

> **perStrategy**: `Record`\<`string`, [`BenchmarkStrategySummary`](#benchmarkstrategysummary)\>

Per-strategy means (keyed by strategy.name).

##### perTask

> **perTask**: [`BenchmarkTaskRow`](#benchmarktaskrow)[]

The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
 strategy-author, an operator) consumes. Includes errored tasks with the reason.

##### pareto

> **pareto**: `string`[]

The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
 a strategy that ties on score at half the cost WINS and a scalar would hide it.

##### refineVsSample?

> `optional` **refineVsSample?**: [`BenchmarkLift`](#benchmarklift)

The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample.

***

### RunAgentRoundsOptions

**`Stable`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Properties

##### driver

> **driver**: [`Driver`](index.md#driver)\<`Task`, `Output`, `Decision`\>

##### agentRun?

> `optional` **agentRun?**: [`AgentRunSpec`](#agentrunspec)\<`Task`\>

Single agent spec — every iteration uses this profile. Mutually
exclusive with `agentRuns`.

##### agentRuns?

> `optional` **agentRuns?**: [`AgentRunSpec`](#agentrunspec)\<`Task`\>[]

Multiple specs for heterogeneous fanout. The kernel round-robins
through them when the driver plans N tasks. Mutually exclusive with
`agentRun`.

##### output

> **output**: [`OutputAdapter`](#outputadapter)\<`Output`\>

##### validator?

> `optional` **validator?**: [`Validator`](#validator-2)\<`Output`, `DefaultVerdict`\>

##### task

> **task**: `Task`

##### ctx

> **ctx**: [`ExecCtx`](#execctx)

##### maxIterations?

> `optional` **maxIterations?**: `number`

Default 10. Hard cap on total iterations across all `plan()` rounds.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Default 4. In-flight worker cap within a single `plan()` batch.

##### runId?

> `optional` **runId?**: `string`

Pre-allocated id for trace correlation. Default = `loop-${random}`.
Surfaces as `runId` on every emitted `LoopTraceEvent`.

##### now?

> `optional` **now?**: () => `number`

Clock override; default `Date.now`. Deterministic tests pass a
monotonic counter to stabilize iteration timing fields.

###### Returns

`number`

##### selectWinner?

> `optional` **selectWinner?**: (`iterations`) => [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

Override the default winner selector (highest-valid-score, ties broken
by earliest iteration).

###### Parameters

###### iterations

[`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

[`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

##### onWorkerBox?

> `optional` **onWorkerBox?**: (`box`) => `void`

Same-sandbox driver mode — a kernel→caller out-channel, not a value handed
in. When set, the kernel keeps each finished worker box alive across the
`plan()` boundary and hands it here, so a same-sandbox planner
(one that reuses the worker's box) can stream its move INTO the
worker's live box — steering from the worker's real filesystem and state,
not just a history summary. The kernel owns teardown: every box kept alive
this way is destroyed at loop end (and the callback is invoked with
`undefined` then as a teardown sentinel). Without it, worker boxes are torn
down per-iteration (default) and a same-sandbox planner has nothing to
reuse. Intended for single-worker (refine) loops: under fanout every box is
still kept for teardown, but only the last-finishing box is handed here, so
a planner sees an arbitrary branch's filesystem — pair it with refine.

###### Parameters

###### box

`SandboxInstance` \| `undefined`

###### Returns

`void`

##### lineage?

> `optional` **lineage?**: [`LoopLineageOptions`](#looplineageoptions)

**`Experimental`**

Opt-in box-lineage controls. Default OFF — unset means every iteration
acquires a fresh box, streams once, and tears it down (today's behavior,
byte-identical). With `sessionContinuity` on, a refine round continues the
parent iteration's session on its live box; with `forkFanout` on, a fanout
round branches the parent's live box so the branches share a context prefix.
The lineage owns every box it starts or
forks and tears them all down at loop end — so these paths are mutually
exclusive with `onWorkerBox`, which claims the same box-ownership channel.

***

### AcquireOptions

**`Experimental`**

#### Properties

##### readyTimeoutMs?

> `optional` **readyTimeoutMs?**: `number`

**`Experimental`**

Total budget for the sandbox to reach `running`, covering on-demand node
cold-start. Default 600_000ms — matches the orchestrator's pending-host
registration window so we never give up before the platform itself would.

##### pollIntervalMs?

> `optional` **pollIntervalMs?**: `number`

**`Experimental`**

Poll interval while waiting for `running` / for the named sandbox to appear.

##### signal?

> `optional` **signal?**: `AbortSignal`

**`Experimental`**

Cancellation (user abort). Distinct from create-call timeouts.

##### name?

> `optional` **name?**: `string`

**`Experimental`**

Stamp a name so a timed-out create is recoverable by lookup. Auto-generated if absent.

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Clock override for deterministic tests.

###### Returns

`number`

##### sleep?

> `optional` **sleep?**: (`ms`) => `Promise`\<`void`\>

**`Experimental`**

Sleep override for deterministic tests.

###### Parameters

###### ms

`number`

###### Returns

`Promise`\<`void`\>

***

### SandboxCapabilities

**`Experimental`**

What the loop kernel is allowed to know about a sandbox backend: a single
capability bit, never the backend's identity. `canFork` gates the legacy
checkpoint+fork fanout path; current live branching is detected on the box.

#### Properties

##### canFork

> **canFork**: `boolean`

**`Experimental`**

True only when `client.criuStatus()` returned `{ available: true }`.
Current live `branch(count)` boxes do not need this bit. When both paths
are absent, a fork-enabled fanout degrades to independent fresh boxes.

***

### CriuCapableClient

**`Experimental`**

Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
does not require `criuStatus`; this widens it optionally so the probe can be
read without importing sandbox-backend specifics.

#### Properties

##### criuStatus?

> `optional` **criuStatus?**: () => `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

**`Experimental`**

###### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

***

### SandboxServedBackend

The provider/model the platform reports it actually bound to a turn, when it reports one.
 `source` is the platform's own account of where that choice came from — `environment` means
 the platform chose, not the request.

#### Properties

##### provider?

> `readonly` `optional` **provider?**: `string`

##### model?

> `readonly` `optional` **model?**: `string`

##### source?

> `readonly` `optional` **source?**: `string`

***

### SandboxToolPartState

**`Experimental`**

Cross-event state for [mapSandboxToolEvent](#mapsandboxtoolevent). Sandbox backends emit a
tool invocation as MANY `message.part.updated` frames on the same call id
(pending → running → completed), so faithful projection needs per-call
status memory: one `tool_call` on first sighting, at most one `tool_result`
on the terminal transition, nothing on intermediate re-frames. Create one
state per turn via [createSandboxToolPartState](#createsandboxtoolpartstate).

#### Properties

##### statusByCall

> **statusByCall**: `Map`\<`string`, `string`\>

**`Experimental`**

Last seen status per tool call id. A terminal status is sticky — later
 frames on a settled call project to nothing.

##### seq

> **seq**: `number`

**`Experimental`**

Sequence for synthesized call ids when an event carries none.

***

### SandboxLeafOut

Parsed output of one Sandbox executor turn.

#### Properties

##### events

> **events**: `SandboxEvent`[]

##### content

> **content**: `string` \| `undefined`

The observed answer. `undefined` when no text-bearing event was observed — never `''`.

##### output

> **output**: [`SandboxOutputMarker`](#sandboxoutputmarker)

Explicit account of what the turn produced.

##### servedBackend?

> `optional` **servedBackend?**: [`SandboxServedBackend`](#sandboxservedbackend)

Provider and model the platform reported serving this turn, when it reported one. Absent means
the platform said nothing; it is never filled from the request, because a request is not a
receipt.

##### toolCalls?

> `optional` **toolCalls?**: [`ExecutorToolCall`](#executortoolcall)[]

##### outcome?

> `optional` **outcome?**: `AgentRunOutcome`

***

### SandboxLineageHandle

**`Experimental`**

A live box plus the session that threads its iterations together. Handed back
by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).

#### Properties

##### box

> **box**: `SandboxInstance`

**`Experimental`**

The owned, running sandbox this handle drives.

##### sessionId

> **sessionId**: `string`

**`Experimental`**

Stable session id threaded through this box's `streamPrompt` calls. Minted
by the lineage on `start`; reused on `continue` so the server continues the
same conversation. A forked handle starts a fresh session on its new box —
the shared context comes from the live branch or legacy checkpoint, not a
shared session id.

***

### SandboxLineage

**`Experimental`**

Owns box + session handles for one loop run and offers the three
capability-gated lifecycle moves. Construct via `createSandboxLineage`.

#### Methods

##### start()

> **start**(`spec`, `prompt`, `signal`, `promptOptions?`): `Promise`\<\{ `handle`: [`SandboxLineageHandle`](#sandboxlineagehandle); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

**`Experimental`**

Acquire a fresh box and begin a new session on it. Returns the handle and
the live `streamPrompt` iterable for the first turn (caller drains it).

###### Parameters

###### spec

[`AgentRunSpec`](#agentrunspec)\<`unknown`\>

###### prompt

`string`

###### signal

`AbortSignal`

###### promptOptions?

`Omit`\<`PromptOptions`, `"signal"` \| `"sessionId"`\>

###### Returns

`Promise`\<\{ `handle`: [`SandboxLineageHandle`](#sandboxlineagehandle); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

##### continue()

> **continue**(`handle`, `prompt`, `signal`, `promptOptions?`): `Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

**`Experimental`**

Continue an existing handle's session with one more turn on the SAME box.
The prior context is server-side; `prompt` is only the new turn. Asserts the
session is still known to the sandbox first (fail-loud) so a platform that
silently dropped the client-minted session id surfaces as an error instead
of a contextless turn the caller mistakes for a real continuation.

###### Parameters

###### handle

[`SandboxLineageHandle`](#sandboxlineagehandle)

###### prompt

`string`

###### signal

`AbortSignal`

###### promptOptions?

`Omit`\<`PromptOptions`, `"signal"` \| `"sessionId"`\>

###### Returns

`Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

##### fork()

> **fork**(`parent`, `prompts`, `specs`, `signal`): `Promise`\<`object`[]\>

**`Experimental`**

Branch `count` children from `parent`. When the platform exposes live
branching, each child inherits the parent's running state — and therefore
the parent's IMAGE and PROFILE: under a real fork `specs[i]` does NOT
re-select a per-branch
profile (the SDK forks the running box, it can't swap the image). `specs[i]`
picks the per-branch profile ONLY on the degraded fresh-box path (no branch
or legacy fork support).
A heterogeneous-profile fanout therefore homogenizes to the parent's profile
when fork is available — pass a single shared spec for forked fanouts, or
use `random@k` (no fork) when branches must differ. Each child's first turn
streams `prompts[i]`. Child-box creation is bounded by `maxConcurrency`.

###### Parameters

###### parent

[`SandboxLineageHandle`](#sandboxlineagehandle)

###### prompts

`string`[]

###### specs

[`AgentRunSpec`](#agentrunspec)\<`unknown`\>[]

###### signal

`AbortSignal`

###### Returns

`Promise`\<`object`[]\>

##### prune()

> **prune**(`keep`): `Promise`\<`void`\>

**`Experimental`**

Destroy every owned box whose handle is NOT in `keep`, freeing it before
loop end. The kernel calls this after a round when it can prove no future
round will descend from the pruned boxes (deterministic, monotonic branch
selection); boxes still reachable as a future branch source are retained.
Best-effort, bounded, parallel — a failed delete never throws.

###### Parameters

###### keep

`Iterable`\<[`SandboxLineageHandle`](#sandboxlineagehandle)\>

###### Returns

`Promise`\<`void`\>

##### teardown()

> **teardown**(): `Promise`\<`void`\>

**`Experimental`**

Destroy every box this lineage owns. Best-effort, bounded, parallel.

###### Returns

`Promise`\<`void`\>

***

### CheckpointCapableBox

**`Experimental`**

Loop-side widening of the box's optional checkpoint method. The
`SandboxClient`/`SandboxInstance` surface the kernel relies on does not
require checkpointing; this reads it optionally so the lineage can probe-gate
without importing sandbox-backend specifics.

#### Properties

##### checkpoint?

> `optional` **checkpoint?**: (`options?`) => `Promise`\<\{ `checkpointId`: `string`; \}\>

**`Experimental`**

###### Parameters

###### options?

###### leaveRunning?

`boolean`

###### tags?

`string`[]

###### Returns

`Promise`\<\{ `checkpointId`: `string`; \}\>

***

### BranchCapableBox

**`Experimental`**

Loop-side view of the current Sandbox SDK's live branch method.

#### Properties

##### branch?

> `optional` **branch?**: (`count`, `options?`) => `Promise`\<`SandboxInstance`[]\>

**`Experimental`**

###### Parameters

###### count

`number`

###### options?

`BranchOptions`

###### Returns

`Promise`\<`SandboxInstance`[]\>

***

### ForkCapableBox

**`Experimental`**

Loop-side widening of the legacy checkpoint fork method.

#### Properties

##### fork?

> `optional` **fork?**: (`checkpointId`, `options?`) => `Promise`\<`SandboxInstance`\>

**`Experimental`**

###### Parameters

###### checkpointId

`string`

###### options?

###### name?

`string`

###### Returns

`Promise`\<`SandboxInstance`\>

***

### SessionCapableBox

**`Experimental`**

Loop-side widening of the box's optional session accessor. The real
`SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
so `continue` can assert session liveness without requiring it of the test
fakes. `status()` resolves `null` when the id is unknown to the sandbox.

#### Properties

##### session?

> `optional` **session?**: (`id`) => `object`

**`Experimental`**

###### Parameters

###### id

`string`

###### Returns

`object`

###### status

> **status**: () => `Promise`\<`unknown`\>

###### Returns

`Promise`\<`unknown`\>

***

### TurnResult

**`Experimental`**

One finished turn over the artifact. A failed FS read is surfaced in `readError`
(never masked as an empty deliverable) so a caller distinguishes "agent produced
nothing" from a transport/FS fault.

#### Type Parameters

##### Out

`Out`

#### Properties

##### out

> **out**: `Out`

**`Experimental`**

##### events

> **events**: `SandboxEvent`[]

**`Experimental`**

##### outcome

> **outcome**: `AgentRunOutcome`

**`Experimental`**

Outcome settled by the public Sandbox tracker after the stream drained.

##### readError?

> `optional` **readError?**: `string`

**`Experimental`**

***

### SandboxRun

**`Experimental`**

A live run over ONE persistent artifact (box + session). Close it
 when done — `close()` tears the box down.

#### Type Parameters

##### Out

`Out`

#### Properties

##### box

> `readonly` **box**: `SandboxInstance`

**`Experimental`**

##### sessionId

> `readonly` **sessionId**: `string`

**`Experimental`**

#### Methods

##### start()

> **start**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

**`Experimental`**

First turn over the fresh box (mints the session). Throws if already started.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### resume()

> **resume**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

**`Experimental`**

Continue THE SAME session over THE SAME artifact — a resumed turn/rollout.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### close()

> **close**(): `Promise`\<`void`\>

**`Experimental`**

###### Returns

`Promise`\<`void`\>

***

### OpenSandboxRunBeforeStartContext

Context available after the box/session exists and before the first prompt is
drained. Intended for benchmark-owned workspace setup such as cloning a repo
into a fixed path.

#### Properties

##### box

> `readonly` **box**: `SandboxInstance`

##### sessionId

> `readonly` **sessionId**: `string`

##### signal

> `readonly` **signal**: `AbortSignal`

***

### OpenSandboxRunOptions

**`Experimental`**

#### Properties

##### agentRun

> **agentRun**: [`AgentRunSpec`](#agentrunspec)\<`string`\>

**`Experimental`**

Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness.

##### signal

> **signal**: `AbortSignal`

**`Experimental`**

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

**`Experimental`**

Optional execution-scoped observers. Hook failures never fail the run.

##### runId?

> `optional` **runId?**: `string`

**`Experimental`**

Stable run id for trace joins. Defaults to a short runtime-minted id.

##### scenarioId?

> `optional` **scenarioId?**: `string`

**`Experimental`**

Optional benchmark/scenario id carried into emitted hook events.

##### promptOptions?

> `optional` **promptOptions?**: [`OpenSandboxRunPromptOptions`](#opensandboxrunpromptoptions)

**`Experimental`**

Per-prompt sandbox SDK options forwarded to both `start()` and `resume()`.
 The runtime still owns the session id and abort signal for each turn.

##### beforeStart?

> `optional` **beforeStart?**: (`ctx`) => `void` \| `Promise`\<`void`\>

**`Experimental`**

Optional pre-start workspace setup. Runs after `lineage.start()` creates the
box/session and before the first prompt stream is consumed. A thrown error
fails the turn before the agent spends tokens.

###### Parameters

###### ctx

[`OpenSandboxRunBeforeStartContext`](#opensandboxrunbeforestartcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onSandboxEvent?

> `optional` **onSandboxEvent?**: (`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>

**`Experimental`**

Receives a defensive copy of every streamed event. Observer work is
non-blocking; synchronous throws and rejected promises never fail the run.

###### Parameters

###### event

`SandboxEvent`

###### meta

###### turnIndex

`number`

###### turnKind

`"start"` \| `"resume"`

###### agentRunName

`string`

###### Returns

`void` \| `PromiseLike`\<`void`\>

##### now?

> `optional` **now?**: () => `number`

**`Experimental`**

Test seam for deterministic hook timestamps. Defaults to `Date.now`.

###### Returns

`number`

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

**`Experimental`**

Bounds box-creation bursts inside lineage fanout. Default from lineage.

##### readRetryDelayMs?

> `optional` **readRetryDelayMs?**: `number`

**`Experimental`**

Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
 retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests).

***

### StdioMcpServerSpec

#### Properties

##### command

> **command**: `string`

Command that starts the MCP server (stdio transport).

##### args?

> `optional` **args?**: `string`[]

##### cwd?

> `optional` **cwd?**: `string`

Working directory the server starts in (a built candidate's worktree, typically).

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Declared public env for the server process. Only a minimal non-sensitive
subset of the parent env is inherited.

##### protectedEnv?

> `optional` **protectedEnv?**: `Record`\<`string`, `string`\>

Sensitive env for the server process. These values override `env` and are
redacted from child-supplied errors, tool metadata, and tool results.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Handshake AND per-request timeout (ms). Default 30s.

***

### McpToolDescriptor

#### Properties

##### name

> **name**: `string`

##### description?

> `optional` **description?**: `string`

##### inputSchema?

> `optional` **inputSchema?**: `unknown`

***

### StdioMcpConnection

#### Properties

##### tools

> `readonly` **tools**: readonly [`McpToolDescriptor`](#mcptooldescriptor)[]

The tools the server exposed at connect time (`tools/list`).

#### Methods

##### callTool()

> **callTool**(`name`, `args`): `Promise`\<`string`\>

`tools/call` → the result's text content. A JSON-RPC error / `isError`
 result becomes an `ERROR: …` string (the agent's outcome); a dead
 transport or timeout throws (an infra fault).

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string`\>

##### close()

> **close**(): `Promise`\<`void`\>

Kill the server child. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### MaterializeLocalMcpOptions

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Handshake / per-request timeout per server (ms). Default 30s.

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Cap on a tool result's text fed back to the worker. Default 2000 chars.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Resolves a server's DECLARED secrets at spawn time — env entries of kind
 `secret-ref` (interface ≥0.40) and the legacy `metadata.secretEnv` map
 (env var name → provider key name). The resolved values reach ONLY the
 child process env — never the profile, the logs, or an error message.
 Fail-closed: a server declaring secrets without a provider (or with a
 missing key) throws instead of booting keyless.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Required trust decision for profiles that declare local MCP processes.
Omit to refuse all profile-controlled host execution. Passing
`allowLocalMcp: true` is only safe for an author-controlled profile: the
process receives this Runtime's filesystem and network privileges.

***

### LocalMcpMaterialization

The live same-host materialization of a profile's `mcp` surface.

#### Properties

##### tools

> **tools**: [`AgenticTool`](#agentictool)[]

Worker-facing tool specs: namespaced `<server>__<tool>`, provider-safe schemas.

#### Methods

##### owns()

> **owns**(`name`): `boolean`

Whether `name` is one of this materialization's namespaced tools.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### call()

> **call**(`name`, `args`): `Promise`\<`string`\>

Route a namespaced call to its server's live stdio child.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string`\>

##### close()

> **close**(): `Promise`\<`void`\>

Kill every spawned server. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### AuthorStrategyOptions

#### Properties

##### profile

> **profile**: `AgentProfile`

Exact author identity. Runtime binds it to every authoring turn.

##### executor

> **executor**: [`ExecutorConfig`](#executorconfig)

Execution substrate for the author. Behavioral settings are forbidden here.

##### fallbackProfile?

> `optional` **fallbackProfile?**: `AgentProfile`

An exact fallback author tried once when the primary call fails or returns no code
 block (thinking models time out at the edge on long authoring prompts, or return
 empty content without `maxTokens`). Opt-in — absent means the primary's failure
 propagates.

##### contract?

> `optional` **contract?**: `string`

The contract text shown to the author. Default `strategyAuthorContract`. The
 meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
 variant on the same frozen holdout as any strategy.

##### environmentName

> **environmentName**: `string`

The environment the losses came from (orientation only — never the verifiers).

##### lossesJson

> **lossesJson**: `string`

The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient.

##### budget

> **budget**: `number`

The budget the strategy must respect (shots/width).

##### outDir

> **outDir**: `string`

Where the authored module file is written (created if missing).

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### AuthoredStrategy

#### Properties

##### strategy

> **strategy**: [`Strategy`](#strategy-3)

##### file

> **file**: `string`

##### code

> **code**: `string`

***

### EvolutionAuthor

#### Properties

##### profile

> **profile**: `AgentProfile`

Exact author identity.

##### executor

> **executor**: [`ExecutorConfig`](#executorconfig)

Execution substrate. All behavior comes from the profile.

##### fallbackProfile?

> `optional` **fallbackProfile?**: `AgentProfile`

Optional exact fallback identity.

***

### StrategyEvolutionConfig

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

##### tasks

> **tasks**: (`offset`, `n`) => `Promise`\<[`AgenticTask`](#agentictask)[]\>

Task supply by DISJOINT slice: `(offset, n)` must return n tasks unique to that
 offset range. Train draws [0, trainN); the holdout draws [trainN + holdoutOffset,
 …) — tasks the search never touched.

###### Parameters

###### offset

`number`

###### n

`number`

###### Returns

`Promise`\<[`AgenticTask`](#agentictask)[]\>

##### trainN

> **trainN**: `number`

##### holdoutN

> **holdoutN**: `number`

##### holdoutOffset?

> `optional` **holdoutOffset?**: `number`

Extra offset past the train slice for the holdout draw (rotate across runs).

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

##### modelPreflight?

> `optional` **modelPreflight?**: `false` \| ((`model`, `worker`, `signal`) => `Promise`\<`void`\>)

Model availability check before the first benchmark phase.

A successful check is reused for the remaining phases in this evolution run.
See `BenchmarkConfig.modelPreflight`.

##### modelPreflightTimeoutMs?

> `optional` **modelPreflightTimeoutMs?**: `number`

Maximum time for each model availability check. Default 30 seconds.

##### author

> **author**: [`EvolutionAuthor`](#evolutionauthor)

##### budget?

> `optional` **budget?**: `number`

Rollouts (sample) / shots (refine) per strategy per task. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

##### generations?

> `optional` **generations?**: `number`

Author→tournament rounds after gen0. Default 2.

##### populationSize?

> `optional` **populationSize?**: `number`

Authored candidates per generation. Default 2.

##### baselines?

> `optional` **baselines?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>[]

The gen0 field. Default [sample, refine, sampleThenRefine].

##### objective?

> `optional` **objective?**: `"cost"` \| `"score"`

What "better" means for PROMOTION. 'score' (default): the candidate must beat the
 incumbent's score (superiority gate). 'cost': the candidate must prove score
 NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
 savings — the "same quality, cheaper" objective. The author is told the objective
 and sees per-task spend either way.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### champion?

> `optional` **champion?**: [`ChampionPolicy`](#championpolicy)

Search-side champion selection. Default 'costAware'.

##### championEpsilon?

> `optional` **championEpsilon?**: `number`

Score band treated as a tie under 'costAware'. Default 0.01.

##### outDir

> **outDir**: `string`

Where authored modules are written.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Promotion-gate evidence floor (paired holdout tasks).

##### band?

> `optional` **band?**: `object`

BAND-AWARE scoring — concentrate the measurement where lift is possible.
 Holdout: draw `holdoutPoolN` candidate tasks and run `baselines[0]` once at the run
 budget as an INDEPENDENT reference screen; keep tasks scoring ≤ `maxRefScore`
 (headroom exists) and take the first `holdoutN`. Band membership is decided before
 either finalist touches a task and both finalists then face the SAME tasks — the
 estimand becomes "paired lift on headroom tasks", pre-registered by this config.
 Train: champion selection ignores zero-spread tasks (every field strategy scored
 identically — zero selection information, pure noise dilution).

###### holdoutPoolN

> **holdoutPoolN**: `number`

###### maxRefScore?

> `optional` **maxRefScore?**: `number`

Keep holdout tasks where the reference scores ≤ this. Default 0.99 — drop only
 tasks the reference already solves fully (no headroom, a candidate can only tie).

##### lossesDetail?

> `optional` **lossesDetail?**: `"exact"` \| `"binary"`

What the author learns from a tournament. 'exact' (default) = scores + progressions
 per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
 per generation reaches the author from the evaluation data).

##### reproducerCheck?

> `optional` **reproducerCheck?**: `object`

Reproducer certification (arXiv:2606.11045): when the final champion is AUTHORED,
 compress it to a short natural-language summary, have a fresh author re-implement
 from the summary alone (no losses, no code), and score the reproduction on the same
 holdout. A reproduction gap is an overfitting signal (their detector: 100%
 sensitivity / 91% specificity in the ML-agent setting) — recorded on the report,
 never gate-blocking in v1.

###### summaryMaxWords?

> `optional` **summaryMaxWords?**: `number`

Word budget for the strategy summary. Default 64.

###### tolerance?

> `optional` **tolerance?**: `number`

Reproduction counts as faithful when reproducedScore ≥ championScore − tolerance.
 Default 0.05.

##### checkpoint?

> `optional` **checkpoint?**: `object`

Endurance: write the run state after every completed phase; with `resume`, a
 restart skips completed phases (authored modules re-imported from their files).
 Worst case after a mid-run death is re-paying ONE phase, never the run.

###### path

> **path**: `string`

###### resume?

> `optional` **resume?**: `boolean`

##### onPhase?

> `optional` **onPhase?**: (`phase`) => `Promise`\<`void`\>

Called before each benchmark phase (gen0, gen1…, band-screen, holdout, reproduce).
 The seam for environment recycling — no artifacts span phases, so a runner may
 recreate a wedge-prone environment container here.

###### Parameters

###### phase

`string`

###### Returns

`Promise`\<`void`\>

##### onTask?

> `optional` **onTask?**: (`phase`, `row`, `done`, `total`) => `void`

###### Parameters

###### phase

`string`

###### row

[`BenchmarkTaskRow`](#benchmarktaskrow)

###### done

`number`

###### total

`number`

###### Returns

`void`

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

***

### ChampionPick

#### Properties

##### name

> **name**: `string`

##### score

> **score**: `number`

##### usd

> **usd**: `number`

***

### EvolutionCandidate

#### Properties

##### name

> **name**: `string`

##### file?

> `optional` **file?**: `string`

##### gzipBits?

> `optional` **gzipBits?**: `number`

##### codeChars?

> `optional` **codeChars?**: `number`

##### error?

> `optional` **error?**: `string`

Present when this author attempt failed (recorded, never silent).

***

### EvolutionGeneration

#### Properties

##### generation

> **generation**: `number`

##### candidates

> **candidates**: [`EvolutionCandidate`](#evolutioncandidate)[]

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

##### champion

> **champion**: [`ChampionPick`](#championpick)

***

### EvolutionArchiveNode

#### Properties

##### name

> **name**: `string`

##### source

> **source**: `"baseline"` \| `"authored"`

##### generation

> **generation**: `number`

##### parent?

> `optional` **parent?**: `string`

The champion whose tournament losses this candidate was authored from.

##### gzipBits?

> `optional` **gzipBits?**: `number`

##### file?

> `optional` **file?**: `string`

##### score

> **score**: `number`

Latest measured tournament result — 0 until the node's first tournament settles
 (an authored node is created before its generation's benchmark runs).

##### usd

> **usd**: `number`

***

### ReproductionCheck

#### Properties

##### summary

> **summary**: `string`

The compressed strategy description the reproducer implemented from.

##### reproducedName

> **reproducedName**: `string`

##### file?

> `optional` **file?**: `string`

##### championHoldoutScore

> **championHoldoutScore**: `number`

##### reproducedHoldoutScore

> **reproducedHoldoutScore**: `number`

##### gap

> **gap**: `number`

champion − reproduced (positive = the reproduction fell short).

##### reproducible

> **reproducible**: `boolean`

reproducedScore ≥ championScore − tolerance. A failed reproduction is an
 overfitting signal: the champion's win did not fit through the summary.

##### error?

> `optional` **error?**: `string`

Infra failure during reproduction (distinct from a semantic reproduction failure).

***

### EvolutionBandInfo

#### Properties

##### screened

> **screened**: `number`

Tasks screened by the reference on the holdout pool.

##### inBand

> **inBand**: `number`

Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN.

##### refScores

> **refScores**: `object`[]

Reference scores per screened task (the screening record).

###### taskId

> **taskId**: `string`

###### score

> **score**: `number`

***

### EvolutionReport

#### Properties

##### gen0

> **gen0**: [`BenchmarkReport`](#benchmarkreport)

##### gen0Champion

> **gen0Champion**: [`ChampionPick`](#championpick)

##### generations

> **generations**: [`EvolutionGeneration`](#evolutiongeneration)[]

##### archive

> **archive**: [`EvolutionArchiveNode`](#evolutionarchivenode)[]

##### finalChampion

> **finalChampion**: [`ChampionPick`](#championpick)

##### holdout

> **holdout**: [`BenchmarkReport`](#benchmarkreport)

##### verdict

> **verdict**: [`PromotionVerdict`](#promotionverdict)

##### band?

> `optional` **band?**: [`EvolutionBandInfo`](#evolutionbandinfo)

Present when band screening ran — the verdict's estimand is then "paired lift on
 headroom tasks" (band membership fixed by the reference screen, pre-registered).

##### reproduction?

> `optional` **reproduction?**: [`ReproductionCheck`](#reproductioncheck)

Present when reproducerCheck ran (final champion was authored).

##### trajectory

> **trajectory**: `object`[]

SEARCH TELEMETRY, not evidence: each entry is that generation's own train-slice
 re-measurement, so cross-generation deltas mix true drift with run-to-run variance
 (entries are unpaired across generations). The only evidence-grade comparison in
 this report is `verdict` — both finalists measured fresh, paired, on the holdout.

###### generation

> **generation**: `number`

###### champion

> **champion**: `string`

###### score

> **score**: `number`

###### usd

> **usd**: `number`

***

### AgenticTask

#### Properties

##### id

> `readonly` **id**: `string`

##### userPrompt

> `readonly` **userPrompt**: `string`

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `unknown`\>

Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it.

***

### ArtifactHandle

#### Properties

##### id

> `readonly` **id**: `string`

##### surface

> `readonly` **surface**: `string`

##### ctx?

> `readonly` `optional` **ctx?**: `unknown`

Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id).

***

### AgenticTool

#### Properties

##### type

> `readonly` **type**: `"function"`

##### function

> `readonly` **function**: `object`

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

***

### SurfaceScore

#### Properties

##### passes

> **passes**: `number`

##### total

> **total**: `number`

##### errored

> **errored**: `number`

Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable.

***

### AgenticSurface

A stateful, checkable environment an agent operates over with tools. Open behind one interface.

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](#artifacthandle)\>

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<[`ArtifactHandle`](#artifacthandle)\>

##### tools()

> **tools**(`task`, `handle`): `Promise`\<[`AgenticTool`](#agentictool)[]\>

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`AgenticTool`](#agentictool)[]\>

##### call()

> **call**(`handle`, `name`, `args`): `Promise`\<`string`\>

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string`\>

##### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](#surfacescore)\>

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`SurfaceScore`](#surfacescore)\>

##### close()

> **close**(`handle`): `Promise`\<`void`\>

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

***

### AgenticOptions

#### Extended by

- [`RunAgenticOptions`](#runagenticoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

##### routerKey

> **routerKey**: `string`

##### workerProfile

> **workerProfile**: `AgentProfile`

Exact worker identity. Model and standing instructions are read only from this profile.

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Optional completion transport (see `RouterConfig.complete`): when set, BOTH legs of an
 offline run use it instead of `fetch`-ing the router — the worker's tool loop (threaded into
 its `routerToolLoop` cfg) AND the analyst's critic (its `ChatClient` is bound to this same
 transport). One injected responder serves both, as a localhost mock endpoint would. Absent ⇒
 the live router fetch path (the default).

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`unknown`\>

##### analystProfile?

> `optional` **analystProfile?**: `AgentProfile`

Exact critic identity. Omitted means the exact worker profile also runs the critic.

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Tags written onto learned facts (and used by the caller's priming query).

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

***

### CorpusReadbackOptions

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Minimum confidence for a fact to be injected. Default 0.7.

##### tags?

> `optional` **tags?**: readonly `string`[]

Extra tags a fact must carry, in addition to `corpusTags`.

##### maxFacts?

> `optional` **maxFacts?**: `number`

Max facts injected per shot. Default 3.

##### includeOperatorFacts?

> `optional` **includeOperatorFacts?**: `boolean`

Default false: only facts tagged `audience:agent` are injected into the worker.

***

### StrategyShotResult

Measured result of one strategy shot.

#### Properties

##### messages

> **messages**: [`StrategyMessage`](#strategymessage)[]

##### score

> **score**: `number`

##### passes

> **passes**: `number`

##### total

> **total**: `number`

##### completions

> **completions**: `number`

##### toolErrors

> **toolErrors**: `number`

***

### AgenticRunResult

#### Properties

##### mode

> **mode**: `string`

The strategy name (built-in 'depth'/'breadth' or a custom strategy's name).

##### score

> **score**: `number`

##### resolved

> **resolved**: `boolean`

##### completions

> **completions**: `number`

##### progression

> **progression**: `number`[]

DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout.

##### shots

> **shots**: `number`

##### usd

> **usd**: `number`

Observed billed subtotal. `usdKnown:false` means it is incomplete, never a measured zero.

##### usdKnown

> **usdKnown**: `boolean`

##### ms

> **ms**: `number`

##### tokens

> **tokens**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

##### tokensKnown

> **tokensKnown**: `boolean`

***

### Strategy

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### driver()

> **driver**(`surface`, `task`, `opts`, `budget`): [`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

###### Parameters

###### surface

[`AgenticSurface`](#agenticsurface)

###### task

[`AgenticTask`](#agentictask)

###### opts

[`AgenticOptions`](#agenticoptions)

###### budget

`number`

###### Returns

[`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

***

### ShotSpec

#### Properties

##### handle?

> `optional` **handle?**: [`ArtifactHandle`](#artifacthandle)

present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart).

##### messages?

> `optional` **messages?**: [`StrategyMessage`](#strategymessage)[]

##### steer?

> `optional` **steer?**: `string`

##### profile?

> `optional` **profile?**: `AgentProfile`

Exact profile for this shot. Omitted means `AgenticOptions.workerProfile`.

##### tools?

> `optional` **tools?**: `string`[]

Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
 the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all.

***

### StrategyResult

#### Extended by

- [`StructuralRolloutResult`](#structuralrolloutresult)

#### Properties

##### score

> **score**: `number`

##### resolved

> **resolved**: `boolean`

##### completions

> **completions**: `number`

##### progression

> **progression**: `number`[]

##### shots

> **shots**: `number`

***

### StrategyArtifacts

Artifact lifecycle a strategy may manage itself — open/close ONLY. Raw `call`/`score`
 are withheld: scores reach the body solely through `shot()`'s StrategyShotResult (the
 harness-verified channel), so a body cannot peek the check or fabricate around it.

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](#artifacthandle)\>

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<[`ArtifactHandle`](#artifacthandle)\>

##### close()

> **close**(`handle`): `Promise`\<`void`\>

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

***

### StrategyCtx

What a strategy body composes with: the artifact lifecycle, the budget, and the two steps.

#### Properties

##### surface

> `readonly` **surface**: [`StrategyArtifacts`](#strategyartifacts)

Open/close artifacts the body manages itself (e.g. one persistent handle for depth).

##### task

> `readonly` **task**: [`AgenticTask`](#agentictask)

##### opts

> `readonly` **opts**: [`AgenticOptions`](#agenticoptions)

##### budget

> `readonly` **budget**: `number`

##### scope

> `readonly` **scope**: [`Scope`](index.md#scope)\<[`Outcome`](#outcome-2)\<`unknown`\>\>

#### Methods

##### shot()

> **shot**(`spec?`): `Promise`\<[`StrategyShotResult`](#strategyshotresult) \| `null`\>

Run ONE worker shot; its harness-scored result, or null if it went down.

###### Parameters

###### spec?

[`ShotSpec`](#shotspec)

###### Returns

`Promise`\<[`StrategyShotResult`](#strategyshotresult) \| `null`\>

##### critique()

> **critique**(`messages`): `Promise`\<`string` \| `null`\>

The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down.

###### Parameters

###### messages

[`StrategyMessage`](#strategymessage)[]

###### Returns

`Promise`\<`string` \| `null`\>

##### consult()

> **consult**(`messages`, `instruction`): `Promise`\<`string` \| `null`\>

The RAW analyst channel: the firewalled critic answers `instruction` over the
 trajectory verbatim — no findings extraction, so verdict-shaped formats
 (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
 trajectory in, never scores. Null when the analyst went down.

###### Parameters

###### messages

[`StrategyMessage`](#strategymessage)[]

###### instruction

`string`

###### Returns

`Promise`\<`string` \| `null`\>

##### listTools()

> **listTools**(`handle`): `Promise`\<`object`[]\>

The tools THIS artifact's task actually offers (names + descriptions only — never
 the implementations). Tool sets vary per task on heterogeneous domains; a strategy
 that restricts shots MUST select from this list, never from hardcoded names.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`object`[]\>

***

### RunAgenticOptions

#### Extends

- [`AgenticOptions`](#agenticoptions)

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerBaseUrl`](#routerbaseurl-1)

##### routerKey

> **routerKey**: `string`

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerKey`](#routerkey-1)

##### workerProfile

> **workerProfile**: `AgentProfile`

Exact worker identity. Model and standing instructions are read only from this profile.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`workerProfile`](#workerprofile)

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Optional completion transport (see `RouterConfig.complete`): when set, BOTH legs of an
 offline run use it instead of `fetch`-ing the router — the worker's tool loop (threaded into
 its `routerToolLoop` cfg) AND the analyst's critic (its `ChatClient` is bound to this same
 transport). One injected responder serves both, as a localhost mock endpoint would. Absent ⇒
 the live router fetch path (the default).

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`unknown`\>

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`complete`](#complete-1)

##### analystProfile?

> `optional` **analystProfile?**: `AgentProfile`

Exact critic identity. Omitted means the exact worker profile also runs the critic.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`analystProfile`](#analystprofile)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpus`](#corpus-4)

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Tags written onto learned facts (and used by the caller's priming query).

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpusTags`](#corpustags)

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpusReadback`](#corpusreadback)

##### surface

> **surface**: [`AgenticSurface`](#agenticsurface)

##### task

> **task**: [`AgenticTask`](#agentictask)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
 The seam online watchdogs/route-auditors subscribe to.

##### strategy?

> `optional` **strategy?**: [`Strategy`](#strategy-3)\<`Result`\>

A Strategy (the open way) — author/pass your own. Overrides `mode` when present.

##### mode?

> `optional` **mode?**: `"depth"` \| `"breadth"`

Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'.

##### budget

> **budget**: `number`

budget: refine→max shots; sample→rollout width.

##### rootBudget?

> `optional` **rootBudget?**: [`Budget`](index.md#budget-4)

***

### StreamAgentTurnOptions

**`Stable`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Wall-clock deadline for the whole turn in ms. An expired deadline aborts
the backend and terminates the stream with `final.status: 'failed'`
(a blown deadline is a turn failure, not a caller cancellation).

##### callId?

> `optional` **callId?**: `string`

Stable logical paid-call id, forwarded as the provider idempotency key and retained in evidence.

##### correlationId?

> `optional` **correlationId?**: `string`

Caller trace tag retained in evidence and forwarded when the transport supports it.

##### preserveToolParts?

> `optional` **preserveToolParts?**: `boolean`

Opt-in tool-part projection for box and executor backends: sandbox tool
parts additionally surface in-stream as
`tool_call` / `tool_result` events (`mapSandboxToolEvent`), so a consumer
rendering tool activity needs no bespoke sandbox-event parser. Default
off — the stream vocabulary existing consumers see is unchanged. No-op
for the `chat` kind (its backend emits `RuntimeStreamEvent`s directly,
tool events included when the backend produces them).

##### onRawEvent?

> `optional` **onRawEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Raw-event tap for box-kind backends: called (and awaited) with every
unmapped `SandboxEvent` BEFORE it is projected, so a consumer can read
parts the chat-UX projection drops (part ids, step markers, custom
backend events) without forking the mapper. Purely observational — it
cannot alter the mapped stream. Never called for the `chat` kind, which
has no sandbox events.

###### Parameters

###### event

`SandboxEvent`

###### Returns

`void` \| `Promise`\<`void`\>

***

### AgentTurnUsage

**`Stable`**

Metered usage of one turn, summed over every cost-bearing event the backend
emitted. `input`/`output` are token counts and are accompanied by
`tokensKnown: false` when the backend did not report them. `costUsd`/`model`
are present only when the backend actually reported them.

#### Properties

##### input

> **input**: `number`

##### output

> **output**: `number`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

Present when a real turn ran but the provider did not report token usage.

##### costUsd?

> `optional` **costUsd?**: `number`

##### usdKnown?

> `optional` **usdKnown?**: `false`

Present when Runtime could not prove the full dollar amount.

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Separately-labelled local/catalog estimate; never billed spend.

##### promptCache?

> `optional` **promptCache?**: `Readonly`\<`Record`\<`string`, `string` \| `number`\>\>

Provider-reported prompt-cache fields; absent fields remain unknown.

##### reasoningTokens?

> `optional` **reasoningTokens?**: `number`

Provider-reported reasoning-token subset of output, when available.

##### model?

> `optional` **model?**: `string`

***

### CollectedAgentTurn

**`Stable`**

A drained turn: the terminal summary plus every event the stream yielded.
`status`/`error` mirror the terminal `final` event so a failed or aborted
turn stays inspectable without re-scanning `events`.

#### Properties

##### finalText

> **finalText**: `string`

##### output?

> `optional` **output?**: `unknown`

Exact terminal artifact output from a Runtime-owned executor.

##### usage

> **usage**: [`AgentTurnUsage`](#agentturnusage)

##### transportAttempts?

> `optional` **transportAttempts?**: `number`

Exact underlying transport calls when the Runtime-owned executor reports them.

##### toolCalls

> **toolCalls**: `object`[]

###### id?

> `optional` **id?**: `string`

###### name

> **name**: `string`

###### arguments

> **arguments**: `string`

##### events

> **events**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

##### status

> **status**: [`AgentTaskStatus`](index.md#agenttaskstatus)

##### error?

> `optional` **error?**: [`BackendErrorDetail`](index.md#backenderrordetail)

##### sandboxOutcome?

> `optional` **sandboxOutcome?**: `AgentRunOutcome`

Public Sandbox outcome, when the turn ran through a Sandbox stream or executor.

***

### StructuralRolloutPolicy

The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/
 TESTGEN/DIVERSE/TEMPERATURE). Defaults are the measured sweet spot: repair value
 concentrates at low k (~+12pp at k=1, +1–3pp at k=5), so `k=5, repairRounds=2` is the
 full recipe and `k=1, repairRounds=2` the low-compute preset.

#### Properties

##### k

> **k**: `number`

Independent samples per task (selection breadth).

##### repairRounds

> **repairRounds**: `number`

Repair shots after selection, each steered by the checks' failure output.

##### testgen

> **testgen**: `number`

Model-authored visible checks requested per task; 0 disables authoring.

##### diverse?

> `optional` **diverse?**: `boolean`

Per-slot strategy-lens prefixes on the k samples (attacks the all-k-fail bucket).
 Measured as a paired null (+0.6pp) — kept as an optional knob, off by default.

***

### VisibleCheck

One task-visible executable check (e.g. a single-line Python assert).

#### Properties

##### code

> **code**: `string`

##### kind

> **kind**: `"authored"` \| `"official"`

'official' = shown in the task itself (docstring example, shown assert);
 'authored' = the model's own guess. Official outranks authored in selection.

***

### CheckSourceCtx

What a CheckSource composes with. `consult` is the strategy family's raw analyst
 channel (metered by the conserved pool, offline-injectable via `opts.complete`) —
 check authoring goes through it rather than a bespoke model client.

#### Properties

##### count

> **count**: `number`

Authored-check budget for this task (`policy.testgen`).

##### entrySymbol?

> `optional` **entrySymbol?**: `string`

The symbol authored checks must reference; undefined ⇒ authoring is skipped
 (no guesses beats guesses pinned to nothing).

#### Methods

##### consult()

> **consult**(`instruction`): `Promise`\<`string` \| `null`\>

One metered LLM call: instruction in, reply text out, null when the channel went
 down. The task's visible prompt is included by the channel itself.

###### Parameters

###### instruction

`string`

###### Returns

`Promise`\<`string` \| `null`\>

***

### CheckSource

Produces the task's visible checks. MUST derive them from agent-visible information
 only, before any candidate exists — the strategy freezes the returned set for every
 sample and repair round of the task.

#### Methods

##### generate()

> **generate**(`task`, `ctx`): `Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### ctx

[`CheckSourceCtx`](#checksourcectx)

###### Returns

`Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

***

### CheckOutcome

How one candidate fared against the frozen visible checks, split by check kind.

#### Properties

##### passedOfficial

> **passedOfficial**: `number`

##### totalOfficial

> **totalOfficial**: `number`

##### passedAuthored

> **passedAuthored**: `number`

##### totalAuthored

> **totalAuthored**: `number`

##### failureOutput

> **failureOutput**: `string`

The checks' failure report — the ONLY feedback the repair loop may see.

##### crashed?

> `optional` **crashed?**: `boolean`

True when the candidate crashed before any check could run — ranks below a
 candidate that ran and failed everything.

***

### CheckExecChannel

Minimal exec channel the default runner needs. `SandboxInstance` (and therefore
 `ValidationCtx.box`) satisfies it structurally.

#### Methods

##### exec()

> **exec**(`command`, `options?`): `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

###### Parameters

###### command

`string`

###### options?

###### timeoutMs?

`number`

###### Returns

`Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

***

### CheckRunContext

#### Properties

##### task

> **task**: [`AgenticTask`](#agentictask)

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Live exec channel for this run (`ValidationCtx.box` / a sandbox instance).

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### CheckRunner

Executes the frozen checks against one candidate. Implementations MUST fail loud
 (throw) when they cannot execute — a silent zero poisons selection.

#### Methods

##### run()

> **run**(`candidate`, `checks`, `ctx`): `Promise`\<[`CheckOutcome`](#checkoutcome)\>

###### Parameters

###### candidate

`string`

###### checks

[`VisibleCheck`](#visiblecheck)[]

###### ctx

[`CheckRunContext`](#checkruncontext)

###### Returns

`Promise`\<[`CheckOutcome`](#checkoutcome)\>

***

### StructuralRolloutResult

The body's deliverable — a `StrategyResult` plus selection provenance. The extra
 fields ride through `defineStrategy`'s deliverable spread onto `AgenticRunResult`
 (score/resolved stay harness-verified, exactly as for every authored strategy).

#### Extends

- [`StrategyResult`](#strategyresult-1)

#### Properties

##### score

> **score**: `number`

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`score`](#score-10)

##### resolved

> **resolved**: `boolean`

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`resolved`](#resolved-4)

##### completions

> **completions**: `number`

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`completions`](#completions-2)

##### progression

> **progression**: `number`[]

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`progression`](#progression-2)

##### shots

> **shots**: `number`

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`shots`](#shots-3)

##### artifact

> **artifact**: `string` \| `null`

Exact selected candidate text passed to the visible checks, or null when no shot ran.

##### selection

> **selection**: [`SelectionReceipt`](#selectionreceipt)[]

One receipt per scored candidate (k samples, then repairs), `SelectionReceipt`
 shaped like the kernel's (`types.ts`), selector 'driver'.

##### repairStop

> **repairStop**: [`RepairStop`](#repairstop)

##### officialChecks

> **officialChecks**: `number`

##### authoredChecks

> **authoredChecks**: `number`

***

### StructuralRolloutConfig

#### Properties

##### policy?

> `optional` **policy?**: `Partial`\<[`StructuralRolloutPolicy`](#structuralrolloutpolicy)\>

Knobs; missing fields take the measured defaults (k=5, repairRounds=2, testgen=6).

##### checkSource?

> `optional` **checkSource?**: [`CheckSource`](#checksource)

Where the visible checks come from. Default: official checks from
 `task.meta.visibleChecks` composed with `modelAuthoredChecks()`.

##### checkRunner?

> `optional` **checkRunner?**: [`CheckRunner`](#checkrunner)

How candidates are measured. Default `sandboxCheckRunner()` — it needs an exec
 channel (bind one to the runner, or pass `box` here) and fails loud without one.

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Exec channel threaded into every check run of this strategy (a sandbox instance /
 `ValidationCtx.box`). The strategy seam itself carries no sandbox, so the caller
 who owns one supplies it here or binds it into the runner.

##### extractCandidate?

> `optional` **extractCandidate?**: (`messages`) => `string`

Candidate extraction from a shot's conversation. Default `defaultExtractCandidate`.

###### Parameters

###### messages

readonly [`StructuralRolloutMessage`](#structuralrolloutmessage)[]

###### Returns

`string`

***

### SurfaceWorkerOut

What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is
 the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit fraction; `failing`
 carries the tests this worker left red (so the analyst can target them).

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

##### score

> `readonly` **score**: `number`

##### shots

> `readonly` **shots**: `number`

##### summary

> `readonly` **summary**: `string`

##### failing?

> `readonly` `optional` **failing?**: readonly `string`[]

***

### SurfaceWorkerConfig

How a worker runs the surface task (its router substrate + per-attempt bounds).

#### Properties

##### routerBaseUrl

> `readonly` **routerBaseUrl**: `string`

##### routerKey

> `readonly` **routerKey**: `string`

##### profile

> `readonly` **profile**: `AgentProfile`

Exact worker behavior, tools, and model.

##### analystProfile?

> `readonly` `optional` **analystProfile?**: `AgentProfile`

##### innerTurns?

> `readonly` `optional` **innerTurns?**: `number`

##### budget?

> `readonly` `optional` **budget?**: `number`

Refine-shot budget for ONE worker attempt (max steered shots). Default 1.

***

### SuperviseSurfaceOptions

#### Properties

##### surface

> `readonly` **surface**: [`AgenticSurface`](#agenticsurface)

The graded surface workers solve (open/tools/call/score/close).

##### worker

> `readonly` **worker**: [`SurfaceWorkerConfig`](#surfaceworkerconfig)

Where/how each worker runs the surface task.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](index.md#budget-4)

The conserved compute pool for the whole supervised run. Default: sized off the worker's inner-loop
 bounds for a handful of worker spawns — raise it to let the driver try more.

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](#routertransportconfig)

The driver brain's Router endpoint/auth. Model and behavior remain owned by `profile`.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry) \| `null`

The self-improvement lens fed to the driver on each settled worker. Default `failuresAnalyst()`
 (target the still-failing tests). Pass a custom registry to change it, or `null` to turn the
 within-run self-improvement OFF (the driver sees raw settled outputs).

##### strategy?

> `readonly` `optional` **strategy?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>

The strategy each worker runs over the surface. Default `refine` (iterate-with-feedback).

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Max workers live at once. Default 1 (serial — required when workers share a persistent artifact, so
 they continue each other instead of racing the file).

***

### SuperviseSurfaceResult

The deployable outcome of a supervised surface run.

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

##### score

> `readonly` **score**: `number`

##### usd

> `readonly` **usd**: `number`

##### tokensIn

> `readonly` **tokensIn**: `number`

##### tokensOut

> `readonly` **tokensOut**: `number`

##### ms

> `readonly` **ms**: `number`

##### completions

> `readonly` **completions**: `number`

Total conserved-pool iterations = the driver + worker LLM rounds the run actually spent.

***

### ProfileRichnessThresholds

Thresholds below which a system prompt is treated as a thin stub. Tunable per call.

#### Properties

##### minSystemPromptChars

> `readonly` **minSystemPromptChars**: `number`

A prompt shorter than this many characters is thin (default 600).

##### minSystemPromptLines

> `readonly` **minSystemPromptLines**: `number`

A prompt with fewer than this many non-blank lines is thin (default 6).

***

### ProfileRichness

Per-field verdict on one authored profile — the raw material the bench renders + scores.

#### Properties

##### name

> `readonly` **name**: `string`

##### systemPrompt

> `readonly` **systemPrompt**: `string`

The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
 convention, or a bare-string prompt — whichever the author used).

##### systemPromptChars

> `readonly` **systemPromptChars**: `number`

##### systemPromptLines

> `readonly` **systemPromptLines**: `number`

##### sentenceCount

> `readonly` **sentenceCount**: `number`

##### hasDescription

> `readonly` **hasDescription**: `boolean`

##### hasTools

> `readonly` **hasTools**: `boolean`

##### hasSkills

> `readonly` **hasSkills**: `boolean`

##### hasMcp

> `readonly` **hasMcp**: `boolean`

##### hasSubagents

> `readonly` **hasSubagents**: `boolean`

##### richness

> `readonly` **richness**: `number`

0..1 — fraction of richness signals present (prompt-depth + the four levers).

##### thin

> `readonly` **thin**: `boolean`

True when the supervisor authored a stub instead of a real profile.

##### reasons

> `readonly` **reasons**: `string`[]

The specific reasons it is thin (empty when rich) — used in the finding's action.

***

### ReservationTicket

Opaque, single-use reservation handle returned by `reserve` and consumed by
 `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup.

#### Properties

##### id

> `readonly` **id**: `number`

##### reserved

> `readonly` **reserved**: `object`

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

###### iterations

> `readonly` **iterations**: `number`

###### usdBudgeted?

> `readonly` `optional` **usdBudgeted?**: `boolean`

Whether the child's `Budget` actually declared `maxUsd`. `reserved.usd` is `0` for BOTH a
child that named no dollar ceiling and one that named `$0`, and the two settle differently:
an undeclared ceiling cannot be exceeded, so the child's real dollars are committed as
OBSERVED spend, while a declared ceiling of `$0` is a limit whose breach is fail-loud.
Optional so an externally constructed ticket stays valid; an absent flag is read as
`true` — the strict, fail-closed reading.

***

### BudgetPoolRestore

State recovered from a prior process before new work is admitted. `committed` is measured spend
already present in the durable journal. Each `uncertainReservation` is a child that was recorded
as started but never recorded as settled: its full declared ceiling is charged conservatively,
while the public readout remains explicitly unknown.

#### Properties

##### committed?

> `readonly` `optional` **committed?**: [`Spend`](index.md#spend)

##### uncertainReservations?

> `readonly` `optional` **uncertainReservations?**: readonly [`Budget`](index.md#budget-4)[]

##### absoluteDeadlineMs?

> `readonly` `optional` **absoluteDeadlineMs?**: `number`

Original absolute deadline from the first process. It may never slide on restart.

***

### BudgetPool

#### Methods

##### reserve()

> **reserve**(`b`): \{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: [`ReservationRejection`](#reservationrejection); \}

Atomically reserve a child's full ceiling from the free balance. Fails closed
({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
caller inspects `ok` before `ticket`.

###### Parameters

###### b

[`Budget`](index.md#budget-4)

###### Returns

\{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: [`ReservationRejection`](#reservationrejection); \}

##### reconcile()

> **reconcile**(`ticket`, `spent`): `void`

Release a reservation: commit the actual `spent`, refund the unspent remainder
to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
a double refund would silently break conservation).

###### Parameters

###### ticket

[`ReservationTicket`](#reservationticket)

###### spent

[`Spend`](index.md#spend)

###### Returns

`void`

##### spendFrom()

> **spendFrom**(`events`): `Promise`\<[`Spend`](index.md#spend)\>

Fold a normalized `UsageEvent` stream (or array) into a `Spend`. Tokens via
 `addTokenUsage`, usd on its own channel, iterations from `'iteration'` events.
 `ms` is left zero — wall-clock duration is the caller's to record, not the pool's.

###### Parameters

###### events

`AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| [`UsageEvent`](#usageevent)[]

###### Returns

`Promise`\<[`Spend`](index.md#spend)\>

##### readout()

> **readout**(): [`BudgetReadout`](#budgetreadout)

The current readout, reflecting all outstanding reservations.

###### Returns

[`BudgetReadout`](#budgetreadout)

##### observe()

> **observe**(`spend`): `void`

Record OBSERVED spend that did NOT go through reserve/reconcile — the driver's OWN inference
(its chat turns), which is real compute but not a spawned child. A direct `free → committed`
debit, so `total ≡ free + reserved + committed` is preserved: equal-k counts the driver's
tokens and the in-loop budget guard (`readout().tokensLeft`) sees them. `free` may go negative
when a run overspends — that is honest (the readout then signals exhaustion). It never throws:
the spend already happened, so accounting records reality; the in-loop guard prevents MORE.
The DURABLE record is the journal's `metered` event (written by `Scope.meter`); this debit
only makes the live `readout()` reflect driver inference for the in-loop guard.

###### Parameters

###### spend

[`Spend`](index.md#spend)

###### Returns

`void`

##### assertNoOpenTickets()

> **assertNoOpenTickets**(): `void`

Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
 supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
 reservation would silently break `total ≡ free + reserved + committed`).

###### Returns

`void`

***

### ChatSessionStore

Conversation history keyed by the settled Runtime worker id.

#### Methods

##### load()

> **load**(`workerId`): readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[] \| `undefined`

###### Parameters

###### workerId

`string`

###### Returns

readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[] \| `undefined`

##### save()

> **save**(`workerId`, `messages`): `void`

###### Parameters

###### workerId

`string`

###### messages

readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[]

###### Returns

`void`

***

### ChatTransportTool

One profile-authorized function tool and its host implementation.

#### Properties

##### spec

> `readonly` **spec**: [`ToolSpec`](#toolspec)

##### execute

> `readonly` **execute**: (`args`, `task`) => `Promise`\<`string`\>

###### Parameters

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

***

### ChatTransportExecutorOptions

Transport and session data for one exact profile-driven conversation.
Behavioral controls belong only in `profile.model.metadata`.

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

##### url?

> `readonly` `optional` **url?**: `string`

##### bearer?

> `readonly` `optional` **bearer?**: `string`

##### tools?

> `readonly` `optional` **tools?**: readonly [`ChatTransportTool`](#chattransporttool)[]

##### complete?

> `readonly` `optional` **complete?**: (`body`, `request?`) => `Promise`\<`unknown`\>

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### request?

###### headers

`Readonly`\<`Record`\<`string`, `string`\>\>

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`unknown`\>

##### sessions?

> `readonly` `optional` **sessions?**: [`ChatSessionStore`](#chatsessionstore)

##### sessionKey?

> `readonly` `optional` **sessionKey?**: `string`

##### resume?

> `readonly` `optional` **resume?**: [`WorkerResumeContext`](#workerresumecontext)

***

### ChatWorkerSeamOptions

Transport/session configuration shared by every spawned exact profile.

#### Properties

##### url?

> `readonly` `optional` **url?**: `string`

##### bearer?

> `readonly` `optional` **bearer?**: `string`

##### tools?

> `readonly` `optional` **tools?**: readonly [`ChatTransportTool`](#chattransporttool)[]

##### complete?

> `readonly` `optional` **complete?**: (`body`, `request?`) => `Promise`\<`unknown`\>

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### request?

###### headers

`Readonly`\<`Record`\<`string`, `string`\>\>

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`unknown`\>

##### sessions?

> `readonly` `optional` **sessions?**: [`ChatSessionStore`](#chatsessionstore)

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

***

### DeliverableSpec

The deployable completion oracle passed to [gateOnDeliverable](#gateondeliverable): a `check` that
decides DELIVERED (settles `valid` ⟺ it resolves true) plus an optional `describe` of
what the spawn was supposed to produce. The check reads the child's output — never the
model judging itself.

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### check

> **check**: (`out`) => `boolean` \| `Promise`\<`boolean`\>

The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`.

###### Parameters

###### out

`Out`

###### Returns

`boolean` \| `Promise`\<`boolean`\>

##### describe?

> `optional` **describe?**: `string`

What the spawn was supposed to produce — surfaced in traces/reports.

***

### ExecutorResultMapping

#### Type Parameters

##### Out

`Out`

#### Properties

##### outRef

> **outRef**: `string`

##### out

> **out**: `Out`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

***

### PriorCoordination

Coordination evidence loaded from prior processes of one durable supervised run.

#### Properties

##### ownerId?

> `readonly` `optional` **ownerId?**: `string`

The owner filter used for this replay. Omitted only for the compatibility all-owner read.

##### questions

> `readonly` **questions**: readonly [`QuestionRecord`](mcp.md#questionrecord)[]

Every question the prior process raised, with answer-status folded in, raise order.

##### findings

> `readonly` **findings**: readonly [`AnalystFindingEvent`](#analystfindingevent)[]

Every analyst finding the prior process published, publish order.

##### continuations

> `readonly` **continuations**: readonly [`ContinuationInstruction`](#continuationinstruction)[]

Every authorized continuation, in commit order. These are evidence, never replayed to a new
worker automatically.

##### deliveryEvidence

> `readonly` **deliveryEvidence**: readonly [`CoordinationDeliveryEvidence`](#coordinationdeliveryevidence)[]

Delivery intent and result records in commit order, linked to receipts by `receiptId`.

##### mail

> `readonly` **mail**: readonly [`PeerMailEvent`](#peermailevent)[]

Every peer-mail attempt the prior process made, delivered and refused alike, in commit order.
Evidence of what siblings told each other; never replayed into a new worker's inbox.

##### records

> `readonly` **records**: readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>[]

Exact source-bus stamps in durable append order. Bus `seq` restarts with each process; append
order remains the cross-process replay order.

***

### CoordinationLog

The durable coordination side-log seam. `append` records one bus event (kinds it does not
 persist are ignored); `load` replays a run's prior records folded into `PriorCoordination`.

#### Methods

##### append()

> **append**(`runId`, `record`, `ownerId?`): `Promise`\<`void`\>

###### Parameters

###### runId

`string`

###### record

[`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### ownerId?

`string`

###### Returns

`Promise`\<`void`\>

##### load()

> **load**(`runId`, `ownerId?`): `Promise`\<[`PriorCoordination`](#priorcoordination)\>

###### Parameters

###### runId

`string`

###### ownerId?

`string`

###### Returns

`Promise`\<[`PriorCoordination`](#priorcoordination)\>

***

### CoordinationMcpHandle

#### Properties

##### url

> `readonly` **url**: `string`

The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`.

##### port

> `readonly` **port**: `number`

##### submittedResult

> **submittedResult**: () => \{ `result`: `unknown`; \} \| `undefined`

The first driver-authored result whose injected independent check passed.

The first result whose injected independent check passed, if the driver submitted one.

###### Returns

\{ `result`: `unknown`; \} \| `undefined`

##### drainResolved

> **drainResolved**: () => `Promise`\<`number`\>

Post-loop drain of already-settled, unpulled children into the ledger — call before reading
 `settled()` for a finalize, so a delivered child the harness never awaited is not lost.

Post-loop drain: pull every ALREADY-settled, unpulled child into the ledger (publishing each
as a `settled` bus event for the audit trail) WITHOUT awaiting live children. The driver
calls this once its brain loop ends, so a delivered child the brain never awaited still
reaches `finalizeBestDelivered` — a gate-verified delivery must never be lost to the
driver's pull discipline. Analyst-on-settle hooks do NOT fire here (the driver has stopped;
nobody is left to read a finding, and analysts spend real compute). Returns the count.

###### Returns

`Promise`\<`number`\>

##### history

> **history**: () => readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>[]

The full ordered bus-event log for current-process observability and audit evidence.

The full ordered log of every bus event — UP (settled / question / finding), authorized
 instruction receipts, and DOWN delivery outcomes (steer / answer). Each record carries seq,
 timestamp, and priority. A receipt is evidence and is never auto-delivered on restart.

###### Returns

readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>[]

##### stats

> **stats**: () => [`BusStats`](#busstats)

Bus throughput counters for live dashboards.

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](#busstats)

##### raiseFinding

> **raiseFinding**: (`finding`) => `Promise`\<`void`\>

Raise a `finding` on the bus from an online detector watching a worker's live pipe.

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

###### Parameters

###### finding

[`AnalystFindingEvent`](#analystfindingevent)

###### Returns

`Promise`\<`void`\>

#### Methods

##### settled()

> **settled**(): readonly [`SettledWorker`](mcp.md#settledworker)[]

The coordination tools' settled-worker ledger (for the driver's finalize).

###### Returns

readonly [`SettledWorker`](mcp.md#settledworker)[]

##### isStopped()

> **isStopped**(): `boolean`

###### Returns

`boolean`

##### mailHistory()

> **mailHistory**(): readonly [`PeerMailEvent`](#peermailevent)[]

Every peer-mail attempt in order, delivered and refused alike. Empty when peer mail is off.

###### Returns

readonly [`PeerMailEvent`](#peermailevent)[]

##### stopMailThread()

> **stopMailThread**(`threadId`): `boolean`

End one peer exchange: every further mail on the thread is refused `thread-stopped`. Returns
 false when peer mail is off or the thread was already stopped.

###### Parameters

###### threadId

`string`

###### Returns

`boolean`

##### close()

> **close**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

***

### DelegateOptions

Inputs to [delegate](#delegate). The intent is the first positional arg; everything here is optional
 with explicit execution identity, so the common call names one exact supervisor profile.

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`Out`\>

The completion oracle (settled ⟺ delivered) the authored workers settle against. Strongly
 recommended — without it the supervisor trusts a worker's self-report. For a code intent,
 `patchDelivered()` is the canonical example; for a free-form answer, a content check.

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

WHERE the authored workers run — the worker-execution backend (`router-tools` / `sandbox` /
 `cli-worktree` / …). The supervisor authors the worker PROFILE; this is the substrate it runs
 on. Provide this OR `makeWorkerAgent`-style wiring through `supervise()` is unavailable.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](index.md#budget-4)

The conserved compute pool for the whole delegation. Defaults to [defaultDelegateBudget](#defaultdelegatebudget).

##### supervisorProfile

> `readonly` **supervisorProfile**: `AgentProfile`

Exact executable authoring supervisor. Model, prompt, harness, and provider live here.

##### router

> `readonly` **router**: [`RouterTransportConfig`](#routertransportconfig)

Router endpoint/auth for a `cli-base` supervisor; contains no behavioral settings.

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Restrict the run to this subset of models (forwarded to `supervise()`).

##### runId?

> `readonly` `optional` **runId?**: `string`

***

### WatchTraceOptions

#### Properties

##### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

The detectors to run online. Defaults to a stuck-loop + error-streak panel.

##### onSignal?

> `readonly` `optional` **onSignal?**: (`signal`, `span`) => `void` \| `Promise`\<`void`\>

Fired for each signal a detector raises — the seam that raises a `finding` on the bus.

###### Parameters

###### signal

`DetectorSignal`

###### span

`ToolSpan`

###### Returns

`void` \| `Promise`\<`void`\>

***

### DispatchUnit

One unit of queued work: the agent to run, its task, and the spawn options (budget + label).
 `nextUnit` mints these lazily so a queue can be generated, re-ordered, or grown while the
 dispatcher runs.

#### Type Parameters

##### Out

`Out`

#### Properties

##### agent

> `readonly` **agent**: [`Agent`](#agent-2)\<`unknown`, `Out`\>

##### task

> `readonly` **task**: `unknown`

##### opts

> `readonly` **opts**: [`SpawnOpts`](#spawnopts)

***

### RollingDispatchOptions

#### Type Parameters

##### Out

`Out`

#### Properties

##### width

> `readonly` **width**: `number`

How many children to hold in flight. Must be a positive integer. This is a SIMULTANEITY fence
only — the conserved pool still bounds total work, and a `width` larger than the pool can
afford simply hits `not-admitted` sooner. Derive it with `effectiveConcurrency` when the host
also runs a fleet-level box governor.

#### Methods

##### nextUnit()

> **nextUnit**(): [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

Produce the next unit of work, or `undefined` when the queue is dry. Called only when a slot
is free, so a caller may compute the next unit from what has already settled (the point of a
refilling dispatcher: the queue is allowed to react). Never called after a stop.

###### Returns

[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

##### onSettled()?

> `optional` **onSettled**(`settled`): `void` \| `Promise`\<`void`\>

Called once per settlement, in cursor order, BEFORE the freed slot is refilled — so an
`onSettled` that appends to the caller's queue is visible to the very next `nextUnit`.

###### Parameters

###### settled

[`Settled`](index.md#settled)\<`Out`\>

###### Returns

`void` \| `Promise`\<`void`\>

##### shouldStop()?

> `optional` **shouldStop**(): `boolean`

Consulted before each admission. `true` stops admitting; the already-live children are still
drained to completion (no orphan, no lost settlement). Use it for a progress/plateau rule.

###### Returns

`boolean`

***

### DispatchReport

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](index.md#settled)\<`Out`\>[]

Every settlement, in the order `scope.next()` yielded them.

##### admitted

> `readonly` **admitted**: `number`

How many children this dispatcher admitted.

##### rejected

> `readonly` **rejected**: readonly `string`[]

Admission rejections, in order — `label: reason`. Non-empty ⇒ the pool or depth fenced.

##### stopReason

> `readonly` **stopReason**: [`DispatchStopReason`](#dispatchstopreason)

##### peakLive

> `readonly` **peakLive**: `number`

The highest simultaneous live count actually reached — the number to compare against
 `width` when asking "did the slots really stay full?"

***

### ConcurrencyCaps

The caps a host can set on simultaneous work. See the ledger in this module's header for what
 each one actually bounds.

#### Properties

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Supervisor level: max spawned-but-unsettled workers.

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

Fleet level: max live sandboxes/boxes across the host process (a `ComputeGovernor`-style
 cap). Applies to the worker layer, so it participates in the minimum.

***

### DriverRetryPolicy

How hard the root driver is retried after a transient failure. The defaults retry; a caller
 that wants the pre-#741 behavior sets `enabled: false` and owns the consequence.

#### Properties

##### enabled?

> `readonly` `optional` **enabled?**: `boolean`

`false` restores the historical behavior: the first driver failure ends the run.

##### maxConsecutiveFailures?

> `readonly` `optional` **maxConsecutiveFailures?**: `number`

Consecutive failures that changed NOTHING (no metered spend, no settlement, no submission)
 before the run gives up. Default 3. A failure that made progress resets the count.

##### maxAttempts?

> `readonly` `optional` **maxAttempts?**: `number`

Absolute ceiling on attempts, regardless of progress. Default 8. The barren counter alone
 cannot bound a driver that crashes every turn AFTER metering a little: each attempt looks like
 progress, so without this backstop such a run would retry until it had eaten the entire
 envelope. A caller who wants budget-only bounding sets this high deliberately.

##### initialBackoffMs?

> `readonly` `optional` **initialBackoffMs?**: `number`

Backoff before the first retry, doubling per consecutive failure. Default 2000ms.

##### maxBackoffMs?

> `readonly` `optional` **maxBackoffMs?**: `number`

Ceiling on the doubling. Default 30000ms.

***

### DriverAttemptRecord

One attempt's record — the legible failure the issue's third ask names. Emitted per attempt so
 an operator sees `driver failed after N attempts` instead of one opaque `pi exit unknown`.

#### Properties

##### attempt

> `readonly` **attempt**: `number`

1-based.

##### durationMs

> `readonly` **durationMs**: `number`

##### error?

> `readonly` `optional` **error?**: `string`

Absent when the attempt completed.

##### classification?

> `readonly` `optional` **classification?**: `"transient"` \| `"terminal"`

##### madeProgress

> `readonly` **madeProgress**: `boolean`

Did anything change since the previous attempt (spend, settlement, submission)?

##### stop?

> `readonly` `optional` **stop?**: [`DriverAttemptStop`](#driverattemptstop)

Set when this attempt ended the loop.

##### retryInMs?

> `readonly` `optional` **retryInMs?**: `number`

Set when another attempt follows.

***

### DriverProgressMark

The comparable mark used to decide whether an attempt did anything at all. Any field moving
 counts as progress — a driver that metered one turn before dying is not dead on arrival.

#### Properties

##### poolTokensSpent

> `readonly` **poolTokensSpent**: `number`

Monotone total of POOL spend since the first reading, in tokens — the driver's own metered
 turns AND any child settlement, because the conserved pool is shared. Deliberately not
 driver-only: a child that settled during the attempt is progress by any reading, and the
 coarser signal can only bias toward rescuing a run, never toward abandoning one.

##### settledCount

> `readonly` **settledCount**: `number`

Monotone count of settled children.

##### submitted

> `readonly` **submitted**: `boolean`

Whether an accepted deliverable exists.

***

### BusEvent

Every bus event is a discriminated union member keyed by `type`.

#### Properties

##### type

> `readonly` **type**: `string`

***

### BusRecord

A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms).

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Properties

##### seq

> `readonly` **seq**: `number`

##### at

> `readonly` **at**: `number`

##### priority

> `readonly` **priority**: `number`

##### event

> `readonly` **event**: `E`

***

### PublishOptions

#### Properties

##### priority?

> `readonly` `optional` **priority?**: `number`

Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
 this so it bumps to the front of the driver's inbox.

##### queue?

> `readonly` `optional` **queue?**: `boolean`

Whether the event enters the pull queue (default true). Set `false` for record-only events —
 the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
 `subscribe` observers, but the parent must never `pull` its own outbound message back.

***

### BusStats

#### Properties

##### published

> `readonly` **published**: `number`

##### pulled

> `readonly` **pulled**: `number`

##### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Count published per event `type`.

***

### EventBus

**`Experimental`**

The child→parent coordination bus surface: publish, priority-ordered pull, pass-through subscribe, history, and stats.
 In-process only — the durable cross-process mailbox this interface is designed
to admit is not implemented (docs/agent-managed-compute/README.md).

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Methods

##### publish()

> **publish**(`event`, `opts?`): `Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

**`Experimental`**

Stamp the event, await every subscriber in order, then make it pull-visible. A subscriber
 failure leaves the event invisible and retrying the SAME event object reuses the exact stamp.
 This lets an awaited product observer commit its record before a supervisor can consume it.

###### Parameters

###### event

`E`

###### opts?

[`PublishOptions`](#publishoptions)

###### Returns

`Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

##### pull()

> **pull**(`kinds?`): `E` \| `undefined`

**`Experimental`**

Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
 ties broken FIFO by `seq`; `undefined` when nothing matches.

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`E` \| `undefined`

##### subscribe()

> **subscribe**(`handler`): () => `void`

**`Experimental`**

Register a pass-through handler; it receives the stamped record of every event published after
 registration. Returns an unsubscribe fn.

###### Parameters

###### handler

(`record`) => `void` \| `Promise`\<`void`\>

###### Returns

() => `void`

##### pending()

> **pending**(`kinds?`): `number`

**`Experimental`**

Count of queued, not-yet-pulled events (filtered by `kinds` when given).

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`number`

##### history()

> **history**(): readonly [`BusRecord`](#busrecord)\<`E`\>[]

**`Experimental`**

The full ordered log of every event published in this process (audit evidence, not replay).

###### Returns

readonly [`BusRecord`](#busrecord)\<`E`\>[]

##### stats()

> **stats**(): [`BusStats`](#busstats)

**`Experimental`**

Throughput counters for observability dashboards.

###### Returns

[`BusStats`](#busstats)

***

### FinalizerSettled

One settled worker as the finalizer sees it — the ledger row (structural fields only).

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

***

### DeliveredOutput

One DELIVERED child, materialized: settled `done`, oracle-passed, output rehydrated. `out` is
 `undefined` only when the child settled without an `outRef` (no artifact to rehydrate).

#### Properties

##### id

> `readonly` **id**: `string`

##### score?

> `readonly` `optional` **score?**: `number`

##### outRef?

> `readonly` `optional` **outRef?**: `string`

##### out?

> `readonly` `optional` **out?**: `unknown`

***

### GraphNode

A graph node: an id and a canonical `AgentProfile`. The profile is the ONLY way a node is
 described — its `prompt.systemPrompt` is the standing role (the 0.117 canonical resolution;
 never a legacy top-level-only reduction), its tools/mcp/resources are its capabilities.

#### Properties

##### id

> `readonly` **id**: `string`

##### profile

> `readonly` **profile**: `AgentProfile`

***

### AgentGraph

#### Properties

##### nodes

> `readonly` **nodes**: readonly [`GraphNode`](#graphnode)[]

##### edges

> `readonly` **edges**: readonly [`GraphEdge`](#graphedge)[]

##### deliverable

> `readonly` **deliverable**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Termination is mandatory, not optional: the independent completion oracle.

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

One conserved pool across the whole graph — cycles without conservation never terminate.

***

### EdgeTraversal

One recorded edge traversal — the in-memory row; the journal twin is the `edge` SpawnEvent.

#### Properties

##### edge

> `readonly` **edge**: `string`

Stable edge id: `delegates:<from>-><to>` or `analyzes:<analyst>:<over…>-><to>`.

##### kind

> `readonly` **kind**: `"delegates"` \| `"analyzes"`

##### from

> `readonly` **from**: `string`

##### to

> `readonly` **to**: `string`

##### directive

> `readonly` **directive**: `string`

The resolved directive reference (`<surface>/v<n>`).

##### traversal

> `readonly` **traversal**: `number`

1-based per-edge ordinal.

##### outcome

> `readonly` **outcome**: [`EdgeDeliveryOutcome`](#edgedeliveryoutcome)

##### continuity

> `readonly` **continuity**: [`TraversalContinuity`](#traversalcontinuity)

How this hop continued — see [TraversalContinuity](#traversalcontinuity).

##### bytes

> `readonly` **bytes**: `number`

Bytes of directive + payload that actually crossed the edge.

##### reason?

> `readonly` `optional` **reason?**: `string`

##### workerId?

> `readonly` `optional` **workerId?**: `string`

The concrete worker node id, once known.

***

### RunGraphOptions

#### Extended by

- [`RunGraphTestOptions`](testing.md#rungraphtestoptions)

#### Properties

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

WHERE worker nodes run — the executor backend. Provide this OR `makeWorkerAgent`.

##### driverBackend?

> `readonly` `optional` **driverBackend?**: [`ExecutorConfig`](#executorconfig)

WHERE the ROOT node's harness brain runs — forwarded to `supervise()` verbatim (see
 `SuperviseOptions.driverBackend`). Needed when the root node's profile declares an external
 harness (`codex`, `claude-code`, `opencode`): that root is driven by the harness, not by the
 router brain, and automatic execution supports a local `bridge`. Unlike `supervise()`, this
 does NOT default to `backend`: a graph's `backend` places WORKER nodes, so the root driver
 is selected only by this field. Omit = no harness driver, which is correct for a root whose
 `profile.harness` is omitted or `cli-base` (that root runs on the router brain).

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](#makeworkeragent)

Leaf-execution override (offline tests / advanced). `runGraph` still owns node pinning,
 directive delivery, and the edge ledger AROUND this seam — only the leaf `act` is yours.

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](#routertransportconfig)

The driver brain's router substrate (`profile.harness` omitted or `cli-base`).

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

The ROOT driver's inference seam — a caller-owned `ToolLoopChat` that makes every root
 model call. Use it when the root's decisions must be caller-owned orchestration (a
 deterministic conversation driver, a persona loop with its own LLM calls) rather than a
 router-derived model call. The graph machinery around the seam is unchanged: node pinning,
 directive delivery, the edge ledger, and the journal twin all run the same shipped path,
 and the root profile keeps prompt control (`prompt-control-execution` materialization —
 `systemPrompt`/`instructions` still apply). What moves to the caller with the brain:
 model selection and provider-identity validation (`expectedModel` cannot be enforced on a
 call the runtime did not place) and per-turn usage reporting (a brain that reports no
 usage meters nothing into the pool). Omit = the router brain derived from the root
 profile — the unchanged default. Mutually exclusive with `driverBackend`, and refused
 when the root profile declares an external harness (that root is driven BY the harness).

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Caller-side runtime hooks (telemetry, policy, product extensions). Composed AFTER the
 graph's own spawn-binding hook on the SAME event stream — the graph never swallows the
 seam supervise() exposes.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry)

The analyst lens registry `analyzes` edges resolve against. ENVIRONMENT — needed only for
 lens analysts; an analyzes edge naming a graph NODE as its analyst needs no registry.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](#workerwatchoptions)

Watch every worker's LIVE tool trace with the online detector panel and raise a `finding`
 on the bus the moment one loops or error-storms — forwarded to `supervise()` verbatim (see
 `SuperviseOptions.watchWorkers`). Online findings (`analyst: 'online:<detector>'`) are bus
 events for the driver, not graph edges, so they are never ledgered as traversals. Omit =
 off (no online watching, no extra events).

##### registry?

> `readonly` `optional` **registry?**: [`PromptRegistry`](#promptregistry)

Directive registry. Default: the seeded kernel registry (`kernelPromptRegistry()`).

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

The run journal the edge ledger and every spawn/settle ride. Default: in-memory.

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

##### runId?

> `readonly` `optional` **runId?**: `string`

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](index.md#budget-4)

Per-child budget reserved from the conserved pool on each spawn.

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

##### authorizeMessage?

> `readonly` `optional` **authorizeMessage?**: (`input`) => [`AuthorizedDownMessage`](#authorizeddownmessage)

Product authority over every steer/answer instruction (the filter seam). `runGraph` observes
 what it CHANGES: a narrowed instruction ledgers its steer traversal as `stripped`.

###### Parameters

###### input

[`DownMessageAuthorizationInput`](#downmessageauthorizationinput) & `object`

###### Returns

[`AuthorizedDownMessage`](#authorizeddownmessage)

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

##### otel?

> `readonly` `optional` **otel?**: `Omit`\<[`SupervisorSpanOptions`](#supervisorspanoptions), `"runId"` \| `"now"`\>

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

***

### GraphResult

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### result

> `readonly` **result**: [`SupervisedResult`](index.md#supervisedresult)\<`Out`\>

##### ledger

> `readonly` **ledger**: readonly [`EdgeTraversal`](#edgetraversal)[]

Every edge traversal, in occurrence order — the observable-edge contract.

##### exhaustedEdges

> `readonly` **exhaustedEdges**: readonly `string`[]

Edge ids whose traversal cap was hit — analyzes exhaustion included (observable here, never
 a refusal). A DELEGATES cap paired with a `no-winner` result THROWS
 ([GraphEdgeCapError](#graphedgecaperror)) instead of returning: only delegates caps refuse spawns, so only
 they can have ended the run. A LIFECYCLE no-winner (`aborted` / `budget-exhausted`) returns
 normally even with an exhausted delegates cap — the abort or the pool, not the cap, ended
 that run, and the exhaustion stays observable here.

##### runId

> `readonly` **runId**: `string`

***

### AuthorityInboxMessage

A message from the run's AUTHORITY — the parent driver. These two kinds carry instruction.

#### Properties

##### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

##### text

> `readonly` **text**: `string`

##### interrupt

> `readonly` **interrupt**: `boolean`

Forceful messages abort the in-flight turn; queued ones wait for the boundary flush.

##### questionId?

> `readonly` `optional` **questionId?**: `string`

Present for an `answer` — the question id it resolves.

***

### PeerInboxMessage

A message from a SIBLING worker. Information, never instruction — the parent stays the only
 authority over this worker's task.

#### Properties

##### kind

> `readonly` **kind**: `"mail"`

##### text

> `readonly` **text**: `string`

##### interrupt

> `readonly` **interrupt**: `false`

Always false. Peer mail is queued by construction; see this file's header.

##### envelope

> `readonly` **envelope**: [`PeerMailEnvelope`](#peermailenvelope)

***

### Inbox

#### Methods

##### deliver()

> **deliver**(`msg`): `boolean`

The `Executor.deliver` implementation. Returns false when the raw message is malformed and
therefore was not queued; callers must not acknowledge a message this inbox discarded.

###### Parameters

###### msg

`unknown`

###### Returns

`boolean`

##### drain()

> **drain**(): [`InboxMessage`](#inboxmessage)[]

Remove and return all pending messages (the flush).

###### Returns

[`InboxMessage`](#inboxmessage)[]

##### pending()

> **pending**(): `number`

###### Returns

`number`

##### pendingAuthority()

> **pendingAuthority**(): `number`

Pending messages from the run's AUTHORITY only. This is what the pre-settle fence counts:
 a worker may not finish while a steer or answer it never read is queued, but peer mail must
 never be able to hold a finished worker open.

###### Returns

`number`

##### freshInterrupt()

> **freshInterrupt**(): `AbortSignal`

Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
 this into the signal it passes to its inference call, then re-plans when it fires.

###### Returns

`AbortSignal`

##### fold()

> **fold**(`messages`): `string`

Render drained messages as ONE operator turn to fold into the worker's conversation.

###### Parameters

###### messages

readonly [`InboxMessage`](#inboxmessage)[]

###### Returns

`string`

***

### SupervisorSpanOptions

#### Properties

##### runId

> `readonly` **runId**: `string`

The supervised run id (`SupervisorOpts.runId`). Roots the trace, identifies the root span, and
is the parent lookup key for every depth-0 spawn (a root scope's `parentId` IS the run id).

##### exporter?

> `readonly` `optional` **exporter?**: [`OtelExporter`](index.md#otelexporter)

Bring your own exporter. It is FLUSHED but never shut down by `finish()` — a caller that owns
the exporter owns its lifecycle. Takes precedence over `exportConfig`.

##### exportConfig?

> `readonly` `optional` **exportConfig?**: [`OtelExportConfig`](index.md#otelexportconfig)

Otherwise build one with [createOtelExporter](index.md#createotelexporter). With no `endpoint` here it reads
`OTEL_EXPORTER_OTLP_ENDPOINT`, and with neither it resolves to `undefined` — which makes
[createSupervisorSpanRecorder](#createsupervisorspanrecorder) return `undefined` and the run emit nothing.

##### traceId?

> `readonly` `optional` **traceId?**: `string`

Trace id (32 hex chars). Pass the caller's own to JOIN an outer trace. Default: derived
deterministically from `runId`, so a resumed run lands in the SAME trace as the process that
started it.

##### parentSpanId?

> `readonly` `optional` **parentSpanId?**: `string`

Parent span id (16 hex chars) to hang the run's root span under — an inherited delegation span.

##### agentName?

> `readonly` `optional` **agentName?**: `string`

`agent.name` on the root span. Default `'supervisor'`.

##### attributes?

> `readonly` `optional` **attributes?**: [`SupervisorSpanAttributes`](#supervisorspanattributes)

Extra attributes stamped on every span this recorder emits (subject, workspace, campaign, …).

##### now?

> `readonly` `optional` **now?**: () => `number`

Injectable clock; used only for the root span's start/end. Default `Date.now`.

###### Returns

`number`

***

### SupervisorSpanOutcome

How the supervised run ended, as `finish()` records it on the root span.

#### Properties

##### result?

> `readonly` `optional` **result?**: [`SupervisedResult`](index.md#supervisedresult)\<`unknown`\>

##### error?

> `readonly` `optional` **error?**: `unknown`

A rejection out of the run itself (the supervisor never resolved).

***

### SupervisorSpanRecorder

#### Properties

##### hooks

> `readonly` **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Attach to `SupervisorOpts.hooks` (compose with a caller's own via `composeRuntimeHooks`).

##### traceId

> `readonly` **traceId**: `string`

The trace every span of this run belongs to.

##### rootSpanId

> `readonly` **rootSpanId**: `string`

The run's root span id — pass it to a child process to join this trace.

##### workerTrace

> `readonly` **workerTrace**: [`WorkerTraceResolver`](#workertraceresolver)

The trace context a worker spawned BY node `spawningNodeId` should inherit, so its own spans
join THIS trace under the span of the node that spawned it. Thread it to a run as
`SupervisorOpts.workerTrace` (`supervise()` does this whenever it builds a recorder) and the
`Scope` seeds it onto every child's `ExecutorContext`; a backend with an environment channel
stamps it with `workerTraceEnv`. An unknown node — one whose span was never opened — resolves
to the run's root span rather than to nothing, so a worker is never filed outside its own run.

#### Methods

##### finish()

> **finish**(`outcome?`): `Promise`\<`void`\>

Close the root span (and any node that never settled, marked as such), export, and flush. Safe
to call twice; never throws — a telemetry failure is not a run failure.

###### Parameters

###### outcome?

[`SupervisorSpanOutcome`](#supervisorspanoutcome)

###### Returns

`Promise`\<`void`\>

***

### PatchDeliverableOptions

**`Experimental`**

#### Extends

- `CoderCheckConstraints`

#### Extended by

- [`WorktreeFanoutOptions`](#worktreefanoutoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

`CoderCheckConstraints.maxDiffLines`

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

`CoderCheckConstraints.forbiddenPaths`

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

***

### PeerMailEnvelope

One admitted peer message. `threadId` is the root mail's id; `depth` is 0 for a root mail and
 one more than its parent for a reply, which is what the reply-depth cap counts.

#### Properties

##### mailId

> `readonly` **mailId**: `string`

##### threadId

> `readonly` **threadId**: `string`

##### depth

> `readonly` **depth**: `number`

##### from

> `readonly` **from**: `string`

The bound sender — resolved from the capability, never from a tool argument.

##### to

> `readonly` **to**: `string`

##### kind

> `readonly` **kind**: [`PeerMailKind`](#peermailkind)

##### subject

> `readonly` **subject**: `string`

##### body

> `readonly` **body**: `string`

##### evidenceRefs

> `readonly` **evidenceRefs**: readonly `string`[]

Evidence the receiver can re-check for itself. Required for `tell` and `challenge`.

##### replyTo?

> `readonly` `optional` **replyTo?**: `string`

The mail id this replies to. Never a coordination question id — a peer cannot address the
 parent's answer channel.

##### at

> `readonly` **at**: `number`

***

### PeerMailEvent

The audit record for one attempt — published whether it delivered or was refused, because a
 refused attempt is exactly what a parent auditing a channel needs to see.

#### Properties

##### envelope

> `readonly` **envelope**: [`PeerMailEnvelope`](#peermailenvelope)

##### delivered

> `readonly` **delivered**: `boolean`

##### outcome

> `readonly` **outcome**: [`PeerMailOutcome`](#peermailoutcome)

##### bodyDigest

> `readonly` **bodyDigest**: `string`

Canonical digest of the exact admitted body, so a later claim can name the bytes it read.

##### error?

> `readonly` `optional` **error?**: `string`

***

### PeerMailLimits

Hard bounds. Every one fails closed with a refusal the sender can read.

#### Properties

##### maxSentPerWorker

> `readonly` **maxSentPerWorker**: `number`

Mail one worker may attempt to send for the whole run.

##### maxInboxPerWorker

> `readonly` **maxInboxPerWorker**: `number`

Mail one worker may receive for the whole run.

##### maxInboxBytesPerWorker

> `readonly` **maxInboxBytesPerWorker**: `number`

Total admitted body bytes one worker may receive for the whole run.

##### maxThreadDepth

> `readonly` **maxThreadDepth**: `number`

Maximum reply depth; a root mail is depth 0, so `2` allows ask → answer → answer.

##### maxBodyBytes

> `readonly` **maxBodyBytes**: `number`

##### maxSubjectBytes

> `readonly` **maxSubjectBytes**: `number`

***

### PeerMailReadout

What a worker sees when it reads its own mailbox.

#### Properties

##### you

> `readonly` **you**: `string`

The reading worker's own id, so a worker can address a reply correctly.

##### inbox

> `readonly` **inbox**: readonly [`PeerMailEnvelope`](#peermailenvelope)[]

Every envelope admitted to this worker so far, oldest first.

##### peers

> `readonly` **peers**: readonly `object`[]

Live siblings this worker may write to (itself excluded). Without this a worker knows no
 peer's id and the channel is unusable.

##### sent

> `readonly` **sent**: `number`

##### sendQuotaLeft

> `readonly` **sendQuotaLeft**: `number` \| `null`

Sends still allowed, or `null` when this run set no send quota.

##### limits

> `readonly` **limits**: [`PeerMailLimits`](#peermaillimits)

***

### PeerMailSendInput

#### Properties

##### to

> `readonly` **to**: `unknown`

##### kind

> `readonly` **kind**: `unknown`

##### subject

> `readonly` **subject**: `unknown`

##### body

> `readonly` **body**: `unknown`

##### evidenceRefs?

> `readonly` `optional` **evidenceRefs?**: `unknown`

##### replyTo?

> `readonly` `optional` **replyTo?**: `unknown`

***

### PeerMailbox

#### Properties

##### limits

> `readonly` **limits**: [`PeerMailLimits`](#peermaillimits)

#### Methods

##### setEndpoint()

> **setEndpoint**(`baseUrl`): `void`

Publish the base URL of the capability listener once it has a port. Until it is set no spawn
receives a mail endpoint: a capability nobody can reach is not worth handing out, and a URL
built from an unassigned port would be a lie.

###### Parameters

###### baseUrl

`string`

###### Returns

`void`

##### mintCapability()

> **mintCapability**(`assignmentId`): `string` \| `undefined`

Mint (idempotently, per assignment) the capability URL for one spawn. Undefined before the
 listener has published its endpoint.

###### Parameters

###### assignmentId

`string`

###### Returns

`string` \| `undefined`

##### bindCapability()

> **bindCapability**(`assignmentId`, `workerId`): `void`

Bind a minted capability to the concrete worker the spawn produced. Until this runs the
 capability can send nothing.

###### Parameters

###### assignmentId

`string`

###### workerId

`string`

###### Returns

`void`

##### hasCapability()

> **hasCapability**(`capabilityId`): `boolean`

Resolve the capability path segment carried in a request URL.

###### Parameters

###### capabilityId

`string`

###### Returns

`boolean`

##### tools()

> **tools**(`capabilityId`): [`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

The two tools a single capability serves, with the sender closed over.

###### Parameters

###### capabilityId

`string`

###### Returns

[`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

##### send()

> **send**(`capabilityId`, `input`): `Promise`\<[`PeerMailEvent`](#peermailevent)\>

###### Parameters

###### capabilityId

`string`

###### input

[`PeerMailSendInput`](#peermailsendinput)

###### Returns

`Promise`\<[`PeerMailEvent`](#peermailevent)\>

##### read()

> **read**(`capabilityId`): [`PeerMailReadout`](#peermailreadout)

###### Parameters

###### capabilityId

`string`

###### Returns

[`PeerMailReadout`](#peermailreadout)

##### stopThread()

> **stopThread**(`threadId`): `boolean`

The parent's control: refuse every further mail on one thread. Returns false when the thread
 was already stopped. Mail already delivered is not recalled — this stops the next reply.

###### Parameters

###### threadId

`string`

###### Returns

`boolean`

##### history()

> **history**(): readonly [`PeerMailEvent`](#peermailevent)[]

Every attempt in order — delivered and refused alike.

###### Returns

readonly [`PeerMailEvent`](#peermailevent)[]

***

### PeerMailboxOptions

#### Properties

##### scope

> `readonly` **scope**: [`Scope`](index.md#scope)\<`unknown`\>

##### publish

> `readonly` **publish**: (`event`) => `Promise`\<`void`\>

Publish one attempt as a coordination event. Awaited, so a durable subscriber commits the
 record before the sender learns the outcome.

###### Parameters

###### event

[`PeerMailEvent`](#peermailevent)

###### Returns

`Promise`\<`void`\>

##### limits?

> `readonly` `optional` **limits?**: `Partial`\<[`PeerMailLimits`](#peermaillimits)\>

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### ActivityNote

The most recent activity the executor can name — one tool call, one turn, or a free-form note.
 `label` is the tool/file/turn name; `detail` is a short, already-truncated descriptor (a path,
 a command head) that a driver can read without pulling the whole transcript.

#### Properties

##### at

> `readonly` **at**: `number`

##### kind

> `readonly` **kind**: `"tool"` \| `"turn"` \| `"note"`

##### label

> `readonly` **label**: `string`

##### status?

> `readonly` `optional` **status?**: `"error"` \| `"ok"`

##### detail?

> `readonly` `optional` **detail?**: `string`

***

### ExecutorProgress

What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every
 field is optional: an executor that knows only its own turn count reports only that.

#### Properties

##### turns?

> `readonly` `optional` **turns?**: `number`

The executor's own turn/step count when it is more meaningful than metered iterations.

##### pendingMessages?

> `readonly` `optional` **pendingMessages?**: `number`

Steers/answers delivered but not yet folded into the worker's conversation.

##### recentActivity?

> `readonly` `optional` **recentActivity?**: readonly [`ActivityNote`](#activitynote)[]

Newest-last window of what the worker has been doing.

##### derived?

> `readonly` `optional` **derived?**: readonly `string`[]

What the executor CHANGED about what the caller declared, one short line each — an MCP config
it materialized, an extension it had to add for the caller's own servers to mount at all.

Deliberately NOT part of `recentActivity`: that is a bounded newest-last ring, so a derived
change made before the first turn is evicted by turn 13 and gone by the time anyone looks. And
deliberately not only on the settled artifact: a run that fails on turn 40 never produces one,
yet "what was this worker actually given?" is exactly the question a failure raises. This
channel is append-only and readable at any moment, including from a run that never finishes.

##### note?

> `readonly` `optional` **note?**: `string`

A one-line human-readable state ("turn 3, running tests").

***

### WorkerProgress

The full live view of one worker, as `observe_agent` returns it mid-flight.

#### Properties

##### id

> `readonly` **id**: `string`

##### status

> `readonly` **status**: [`NodeStatus`](#nodestatus)

##### live

> `readonly` **live**: `boolean`

True while the node is neither done, failed, nor cancelled — i.e. a steer could still land.

##### steerable

> `readonly` **steerable**: `boolean`

True when this worker's executor exposes an inbox (`Executor.deliver`) — i.e. `steer_agent`
 can actually reach it. False means a steer would be recorded and dropped.

##### startedAt

> `readonly` **startedAt**: `number`

##### lastActivityAt

> `readonly` **lastActivityAt**: `number`

Epoch ms of the last metered usage event or executor-reported activity.

##### idleMs

> `readonly` **idleMs**: `number`

##### stalled

> `readonly` **stalled**: `boolean`

##### stallAfterMs

> `readonly` **stallAfterMs**: `number`

##### turns

> `readonly` **turns**: `number`

Metered iterations so far (the executor's own count when it reports one).

##### tokens

> `readonly` **tokens**: `object`

###### input

> `readonly` **input**: `number`

###### output

> `readonly` **output**: `number`

##### tokensKnown?

> `readonly` `optional` **tokensKnown?**: `boolean`

False when observed `tokens` is only a known subtotal, not a complete total — the worker did
 work whose token count its provider never reported. The twin of `usdKnown`, carried for the
 same reason: a driver reading this over `observe_agent` would otherwise read the subtotal as
 the measurement and conclude a busy worker was cheap.

##### usd

> `readonly` **usd**: `number`

##### usdKnown?

> `readonly` `optional` **usdKnown?**: `boolean`

False when observed dollar spend is only a known subtotal, not a complete total.

##### pendingMessages

> `readonly` **pendingMessages**: `number`

Steers delivered but not yet read by the worker.

##### recentActivity

> `readonly` **recentActivity**: readonly [`ActivityNote`](#activitynote)[]

Newest-last window of tool/turn activity; empty when the executor exposes none.

##### derived?

> `readonly` `optional` **derived?**: readonly `string`[]

What the executor changed about the caller's declaration; absent when it changed nothing.
 Unlike `recentActivity` this is never evicted, so it still answers on a failed run.

##### note?

> `readonly` `optional` **note?**: `string`

***

### ActivityLog

A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`.

#### Methods

##### push()

> **push**(`note`): `void`

###### Parameters

###### note

[`ActivityNote`](#activitynote)

###### Returns

`void`

##### read()

> **read**(): readonly [`ActivityNote`](#activitynote)[]

Newest-last, at most `limit` entries.

###### Returns

readonly [`ActivityNote`](#activitynote)[]

##### last()

> **last**(): [`ActivityNote`](#activitynote) \| `undefined`

###### Returns

[`ActivityNote`](#activitynote) \| `undefined`

##### size()

> **size**(): `number`

###### Returns

`number`

***

### ScopeProgressInput

The scope-side facts about a child, independent of whether its executor cooperates.

#### Properties

##### id

> `readonly` **id**: `string`

##### status

> `readonly` **status**: [`NodeStatus`](#nodestatus)

##### steerable

> `readonly` **steerable**: `boolean`

##### startedAt

> `readonly` **startedAt**: `number`

##### lastActivityAt

> `readonly` **lastActivityAt**: `number`

##### turns

> `readonly` **turns**: `number`

##### tokens

> `readonly` **tokens**: `object`

###### input

> `readonly` **input**: `number`

###### output

> `readonly` **output**: `number`

##### tokensKnown?

> `readonly` `optional` **tokensKnown?**: `boolean`

##### usd

> `readonly` **usd**: `number`

##### usdKnown?

> `readonly` `optional` **usdKnown?**: `boolean`

***

### PromptHandle

A versioned reference into a prompt registry: `surface` names the role/edge the text serves,
 `version` pins the exact text. The string form is `<surface>/v<n>` (e.g. `delegates/worker-brief/v1`).

#### Properties

##### surface

> `readonly` **surface**: `string`

##### version

> `readonly` **version**: `number`

***

### RegisteredPrompt

One registry entry: the handle plus the text it pins.

#### Properties

##### surface

> `readonly` **surface**: `string`

##### version

> `readonly` **version**: `number`

##### text

> `readonly` **text**: `string`

##### description?

> `readonly` `optional` **description?**: `string`

What the surface is FOR — shown by `list()`, never sent to a model.

***

### PromptRegistry

Versioned prompt store. `resolve` fails loud on an unknown handle: a directive that silently
 resolved to nothing is the unobservable-edge failure this whole design exists to end.

#### Methods

##### resolve()

> **resolve**(`handle`): [`RegisteredPrompt`](#registeredprompt)

###### Parameters

###### handle

[`PromptHandle`](#prompthandle)

###### Returns

[`RegisteredPrompt`](#registeredprompt)

##### register()

> **register**(`entry`): `void`

Register a new entry; a duplicate (surface, version) fails loud — versions are immutable.

###### Parameters

###### entry

[`RegisteredPrompt`](#registeredprompt)

###### Returns

`void`

##### list()

> **list**(): readonly [`RegisteredPrompt`](#registeredprompt)[]

###### Returns

readonly [`RegisteredPrompt`](#registeredprompt)[]

***

### InMemoryRunContextOptions

Options for a supervised run context.

#### Properties

##### withDriver?

> `readonly` `optional` **withDriver?**: `boolean`

Wrap the executor registry with `withDriverExecutor` so a spawned child marked
`role: 'driver'` resolves to the recursive driver-executor (agents driving agents
over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
leaf workers. Default `false`.

***

### InMemoryRunContext

The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.

#### Properties

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](index.md#executorregistry)

##### resume?

> `readonly` `optional` **resume?**: `boolean`

Present (and `true`) only on a DURABLE context (`createFileRunContext`), so spreading the
context into `SupervisorOpts` also opts the run into resume-first. An in-memory context
leaves it undefined: there is never a prior tree to resume, and the default stays fresh-run.

##### coordinationLog?

> `readonly` `optional` **coordinationLog?**: [`CoordinationLog`](#coordinationlog)

Present only on a DURABLE context: the coordination side-log stores questions, analyst
findings, answer decisions, and authorized continuation receipts that the spawn journal does
not own. `supervise({ runDir })` appends them as they publish and loads them on resume.
Continuation receipts are evidence and are never auto-delivered to a replacement worker.
In-memory contexts have none: nothing outlives the process.

***

### WorkerSteerRequest

One durable down-leg request appended to a worker's inbox file.

#### Properties

##### id

> `readonly` **id**: `string`

##### at

> `readonly` **at**: `string`

ISO timestamp of the append.

##### source

> `readonly` **source**: `string`

Who asked — 'human', a brain label, a tool name. Provenance, not authorization.

##### worker

> `readonly` **worker**: `string`

The worker LABEL the request targets (already resolved by the caller).

##### message

> `readonly` **message**: `string`

***

### WorkerCancelRequest

One durable worker-scoped cancel request appended to the run's cancellation inbox.

#### Properties

##### operationId

> `readonly` **operationId**: `string`

Caller-minted stable operation identifier — the idempotency key of the whole operation.

##### at

> `readonly` **at**: `string`

ISO timestamp of the append.

##### source

> `readonly` **source**: `string`

Who asked — 'human', a brain label, a tool name. Provenance, not authorization.

##### worker

> `readonly` **worker**: `string`

The worker the request targets: a workerId (node id — routed to the owning manager at any
 depth), or a profile name or spawn label (resolved by the root manager against its direct
 children only).

##### reason?

> `readonly` `optional` **reason?**: `string`

***

### WorkerCancellation

The durable acknowledgement state for one worker-scoped cancel operation, keyed by
`operationId`. The runtime acknowledger is the ONLY writer; `cancelWorker` only reads it.

`effect` reuses the retained-run vocabulary ([RetainedRunEffect](#retainedruneffect)) so the runtime has one
spelling of the four cancellation states:
 - `'unknown'`          — not yet resolved by the runtime (also what `cancelWorker` returns for
                          a request no acknowledger has answered), or — terminally, with the
                          run-over detail — an abort was issued but the run ended before the
                          termination could be observed. Never a success.
 - `'cancel_requested'` — the runtime issued the worker's abort; termination not yet proven.
 - `'cancelled'`        — the worker reached a terminal `down` state on the settle path.
 - `'not_live'`         — the worker was not live to cancel (already settled, it settled
                          `done` despite the abort, or the run ended before the request was
                          ever applied). Never a success of THIS operation.

Expiry is run end: the owning manager's final pass closes every still-open request it owns
(`not_live` never applied, `unknown` issued-but-unproven), so a pending request cannot outlive
its run and abort a future spawn that happens to reuse a label.

#### Properties

##### operationId

> `readonly` **operationId**: `string`

##### worker

> `readonly` **worker**: `string`

The worker reference exactly as requested.

##### effect

> `readonly` **effect**: [`RetainedRunEffect`](#retainedruneffect)

##### requestedAt

> `readonly` **requestedAt**: `string`

ISO timestamp of the original request.

##### observedAt

> `readonly` **observedAt**: `string`

ISO timestamp of the runtime's most recent observation of this operation.

##### workerId?

> `readonly` `optional` **workerId?**: `string`

The node id the acknowledger resolved `worker` to, once resolved.

##### reason?

> `readonly` `optional` **reason?**: `string`

The caller's reason, carried verbatim from the request.

##### detail?

> `readonly` `optional` **detail?**: `string`

The runtime's explanation of how it arrived at `effect`.

##### terminated

> `readonly` **terminated**: readonly `string`[]

Every node id this operation PROVED terminated: the requested worker plus each descendant of
its subtree observed to reach a terminal `down`/`cancelled` journal record at or after the
abort was ISSUED — the acknowledger's own `observedAt` on the `cancel_requested` record
(runtime clock), never the client's `requestedAt` (a cancelled lead cascades to its subtree
by design — the scope signal chain — so the acknowledgement names the set, not one id).
Proven at acknowledgement time; post-abort causation is approximate: a descendant that died
of its own cause after the abort is indistinguishable from the cascade and may be included,
a late teardown journal joins the set on a later pass while the manager still runs, and one
still absent at run end is absent from the set. Grows monotonically; empty until termination
is proven.

***

### RouterSeam

Router/inline transport seam. The profile owns model, prompt, and generation behavior.

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

##### routerKey

> **routerKey**: `string`

##### complete?

> `optional` **complete?**: (`body`, `request?`) => `Promise`\<`unknown`\>

Injectable transport for offline/local execution; still passes through Runtime metering.

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### request?

###### headers

`Readonly`\<`Record`\<`string`, `string`\>\>

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`unknown`\>

##### tools?

> `optional` **tools?**: readonly [`ToolSpec`](#toolspec)[]

When present, return one turn's requested tool calls without executing them.

***

### SandboxSeam

Sandbox executor seam. The `sandboxClient` the composed `runAgentRounds` creates
boxes through, plus the optional trace/run/lineage wiring forwarded into the
loop. `lineage` is opaque here (PR #150's `RunAgentRoundsOptions.lineage`): forwarded
forward-compatibly, never inspected — this executor does NOT reinvent
checkpoint/fork.

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-5)

##### loopCtx?

> `optional` **loopCtx?**: `Partial`\<`Omit`\<[`ExecCtx`](#execctx), `"signal"` \| `"sandboxClient"`\>\>

Forwarded into the composed `runAgentRounds`'s `ctx` (trace emitter, run handle, etc.).

##### lineage?

> `optional` **lineage?**: `unknown`

PR #150 `RunAgentRoundsOptions.lineage` passthrough — opaque; forwarded, not parsed.

##### maxIterations?

> `optional` **maxIterations?**: `number`

Hard cap on the composed loop's iterations. The budget pool reserves against
 the spawn `Budget.maxIterations`; this is the leaf's own ceiling. Default 1.

##### validator?

> `optional` **validator?**: [`Validator`](#validator-2)\<[`SandboxLeafOut`](#sandboxleafout), `DefaultVerdict`\>

OPT-IN executable score for this worker. Forwarded to the composed
`runAgentRounds` as its `validator`, so the kernel calls `validate` while the
iteration's box is still alive: `ValidationCtx.box` is a LIVE `SandboxInstance`
and the check can run commands or read files in the container it is scoring.
Every other supervised hook fires after teardown and can only read the artifact.

The resulting verdict becomes the winner's verdict, which this executor already
surfaces on its `ExecutorResult`. Absent, nothing changes: the loop runs
unscored and the leaf falls back to its own settle verdict.

Not representable with `steering` — a steerable session is a multi-turn session
on one box, not a `runAgentRounds` composition, so the pair is rejected instead
of silently dropping the score.

##### steering?

> `optional` **steering?**: [`SandboxSteeringOptions`](#sandboxsteeringoptions)

OPT-IN: run this worker as a multi-turn, STEERABLE session instead of the historical
single-shot `runAgentRounds` composition. Setting it gives the sandbox worker an `Executor.deliver`
inbox (so `Scope.send` / `steer_agent` actually reach it), a live tool-activity trace, and a
`progress()` read — turning the default cloud worker from something a supervisor can only
wait on into something it can watch and correct.

Absent, nothing changes: the same `runAgentRounds` leaf, no inbox, `steer_agent` still reports
`delivered:false`. Opt-in because a steerable worker holds ONE box across several turns,
which is a different resource profile from a fire-and-forget shot.

***

### CliSeam

UNMETERED CLI subprocess seam. `bin` + `args` describe the process to spawn.

READ THIS BEFORE CHOOSING `backend: 'cli'`. This backend pipes a prompt to a subprocess's stdin
and reads its stdout. It has no usage receipt of any kind, so it reports its spend with
`Spend.tokensKnown: false`: the work is recorded, its `{0,0}` tokens and `$0` are a FLOOR rather
than a measurement, and a ceiling priced from either is a ceiling that cannot fire. The executor
is also `budgetExempt: true`, which is why `driveHarnessFromBackend` refuses it outright rather
than pretending to budget it.

If you need a metered harness worker, use `backend: 'bridge'` (a cli-bridge session, which
reports the harness's real per-turn tokens and cost) or `backend: 'cli-worktree'` with
`codexReproducible`. Reach for this seam only when the subprocess genuinely is not an inference
agent, or when you have accepted that its cost is invisible.

`args` is argv for a LOCAL, in-process spawn under this process's own privileges. It is not a
remote channel and nothing forwards it over a wire.

#### Properties

##### bin

> **bin**: `string`

##### args?

> `optional` **args?**: `string`[]

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Extra environment for the subprocess (merged over `process.env`).

##### cwd?

> `optional` **cwd?**: `string`

Working directory for the subprocess.

***

### CliWorktreeSeam

cli-worktree seam. A supervisor-authored `AgentProfile` driving a local coding-harness CLI
(claude / codex / opencode) on its own git worktree — the leaf `createWorktreeCliExecutor`
named as data. `repoRoot` is transport data; `AgentProfile.harness` selects the CLI.
`taskPrompt` remains an optional direct-call fallback for callers that execute with `undefined`.
The authored
`profile.prompt.systemPrompt` + `profile.model.default` reach the harness via the §1.5
`harnessInvocation` mapper. Everything else mirrors `WorktreeCliExecutorOptions`.

#### Properties

##### repoRoot

> **repoRoot**: `string`

##### taskPrompt?

> `optional` **taskPrompt?**: `string`

##### runId?

> `optional` **runId?**: `string`

##### baseRef?

> `optional` **baseRef?**: `string`

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

Isolated, network-off Codex execution with terminal JSONL usage capture.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

Absolute host paths denied to reproducible Codex.

##### testCmd?

> `optional` **testCmd?**: `string`

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

##### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

##### checkOutputCap?

> `optional` **checkOutputCap?**: `number`

##### budgetExempt?

> `optional` **budgetExempt?**: `boolean`

##### bridge?

> `optional` **bridge?**: [`CliWorktreeBridgeSeam`](#cliworktreebridgeseam)

Live cli-bridge transport inside the worktree. When set, the worktree leaf accepts
 `deliver()` messages and resumes the same bridge session in this worktree cwd.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Test seam — forwarded to worktree helpers.

##### runCommand?

> `optional` **runCommand?**: [`WorktreeCheckRunner`](index.md#worktreecheckrunner)

Test seam — forwarded to verification checks.

***

### CliWorktreeBridgeSeam

#### Properties

##### bridgeUrl

> **bridgeUrl**: `string`

##### bridgeBearer

> **bridgeBearer**: `string`

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
 same value in `execution.timeoutMs` so cli-bridge cannot substitute its own cutoff.

##### sessionId?

> `optional` **sessionId?**: `string`

Stable cli-bridge session id. Defaults to `bridge-worktree-${runId}`.

##### maxReconnects?

> `optional` **maxReconnects?**: `number`

Transport reconnects allowed after the first POST. Default 3; set 0 to disable.

***

### BridgeSeam

cli-bridge seam. A local OpenAI-compatible bridge that fronts harness CLIs
(claude-code / opencode / kimi / pi) behind one HTTP surface. The spawned
`AgentProfile` is the sole harness/provider/model and behavioral authority and
is forwarded verbatim per request; this seam carries transport data only.

The executor opens a resumable cli-bridge session. `sessionId` identifies the
harness conversation across turns; each turn also receives its own durable run id.
A dropped HTTP reader reattaches to that exact run and explicit cancel is the only
operation allowed to stop it. Omit `sessionId` and the executor mints one per spawn.

── HOW TO CONTROL WHAT THE HARNESS LOADS (there is no argv field, by design) ──

A worker often needs the harness started in a KNOWN state — no ambient extensions, skills,
context files, or prompt templates — because ambient state is how a paired experiment silently
loses its pairing: an installed extension that persists memory across runs carries arm A's state
into arm B, and nothing reports it.

That is what the spawned `AgentProfile` is FOR. `agent_profile`
rides every request verbatim, and cli-bridge maps it onto each harness's own native controls:

  - Materializing any profile at all already starts the harness isolated from ambient
    workspace state — for pi that is `--no-context-files --no-skills --no-prompt-templates`,
    applied to every request that carries an `agent_profile`.
  - `AgentProfile.extensions.<harness>` is the named, per-harness control channel. An explicit
    `extensions: { pi: { load: [] } }` disables ambient extension discovery outright
    (pi's `--no-extensions`); listing package names loads exactly those and nothing else.
  - `permissions` / `tools` / `mcp` map onto the harness's native tool and server controls.

A caller therefore does NOT need to hand-roll an `Executor` to isolate a harness run, and the
profile expressing it stays portable: the same declaration means the same thing on a different
harness, whereas an argv string means nothing anywhere else.

WHY NOT A GENERAL ARGV PASSTHROUGH. `bridgeUrl` addresses a process-spawning server. Forwarding
an arbitrary argv array to it would let any caller holding a bearer token choose the flags of a
process on the bridge host — which for real harness CLIs includes flags that load code from a
path, read a file into the prompt, redirect the working directory, or turn off the isolation the
bridge applies. cli-bridge deliberately confines workers (a filesystem jail and deny-by-default
network egress), and every one of those confinements is expressed as spawn configuration, so an
argv channel is a channel for unwinding them. It would also break this executor's own contract:
the durable-run replay protocol, session pinning, and streaming mode are all argv the bridge
owns, and a caller-supplied duplicate silently wins or corrupts the parse. The structured profile
channel is validated, per-harness, portable, and refuses controls it does not understand — keep
new harness capability there.

#### Properties

##### bridgeUrl

> **bridgeUrl**: `string`

##### bridgeBearer

> **bridgeBearer**: `string`

##### modelCredential?

> `optional` **modelCredential?**: [`BridgeModelCredential`](#bridgemodelcredential)

Optional request-scoped model credential.

The key name is portable configuration. The provider is a live service and is intentionally
not serialised. Runtime resolves both values immediately before every bridge POST and sends
them only to a loopback bridge through private request headers.

##### cwd?

> `optional` **cwd?**: `string`

Optional working directory forwarded to cli-bridge and persisted with the session.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Caller-owned deadline for each bridge turn. Runtime enforces it locally and sends the
 same value in `execution.timeoutMs` so the bridge-owned process follows the same policy.

##### sessionId?

> `optional` **sessionId?**: `string`

Stable, caller-owned cli-bridge session id for harness-side resume. Defaults
 to a freshly minted per-spawn id so each worker is its own resumable session.

##### maxReconnects?

> `optional` **maxReconnects?**: `number`

Transport reconnects allowed after the first POST. Default 3; set 0 to disable.

##### activityWindow?

> `optional` **activityWindow?**: `number`

Newest-last activity window `progress()` reports. Default 12.

***

### BridgeModelCredential

A live, request-scoped model credential reference for a local cli-bridge.

#### Properties

##### key

> **key**: `string`

Provider key name for the scoped model token.

##### baseUrlKey

> **baseUrlKey**: `string`

Provider key name for the exact scoped HTTPS model gateway URL.

##### provider

> **provider**: [`KeyProvider`](#keyprovider)

Live credential service. Runtime retains this reference through reusable captures.

***

### ProviderSeam

Generic environment provider executor config. External packages implement
 `AgentEnvironmentProvider`; this built-in wrapper lets `createExecutor`
 consume them as backend data while preserving the existing usage channel.

#### Extends

- [`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`defaults`](runtime/environment-provider.md#defaults-1)

##### runtime?

> `optional` **runtime?**: [`Runtime`](#runtime-4)

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`runtime`](runtime/environment-provider.md#runtime)

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`destroyOnSettle`](runtime/environment-provider.md#destroyonsettle)

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`requireTerminalEvent`](runtime/environment-provider.md#requireterminalevent-1)

##### profileForCreate?

> `optional` **profileForCreate?**: (`profile`) => `AgentProfile`

Transform only the profile sent to `provider.create`. The original profile
remains the input to `taskToTurn`, so execution-only normalization cannot
rewrite the caller's task mapping.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfile`

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`profileForCreate`](runtime/environment-provider.md#profileforcreate)

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

**`Experimental`**

###### Parameters

###### task

`unknown`

###### specProfile

`AgentProfile`

###### Returns

`AgentTurnInput`

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`taskToTurn`](runtime/environment-provider.md#tasktoturn)

##### provider

> **provider**: `string` \| `AgentEnvironmentProvider`

##### registry?

> `optional` **registry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

##### steering?

> `optional` **steering?**: [`SandboxSteeringOptions`](#sandboxsteeringoptions)

Compose the provider through the existing steerable sandbox session.
The exact profile must name its harness, and the provider must expose live
continuation plus session controls. The provider still owns environment
creation and session semantics.

***

### RouterToolsSeam

Router seam WITH tool use — the tool-using router backend. Same direct
OpenAI-compatible endpoint as `RouterSeam`, but each turn passes `tools`; when
the model emits tool_calls they run via `executeToolCall` ON THIS HOST and the
results fold back as `tool` messages, repeating until the model answers without
a tool or `maxTurns` is hit. A real agentic loop, OFF-BOX — no sandbox, so it
is unaffected by a box's egress allowlist. One turn = one completion = the
equal-compute unit. `executeToolCall` receives the task so per-task tool
surfaces (e.g. a gym keyed by task) can dispatch correctly.

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

##### routerKey

> **routerKey**: `string`

##### complete?

> `optional` **complete?**: (`body`, `request?`) => `Promise`\<`unknown`\>

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### request?

###### headers

`Readonly`\<`Record`\<`string`, `string`\>\>

###### signal?

`AbortSignal`

###### Returns

`Promise`\<`unknown`\>

##### tools

> **tools**: readonly [`ToolSpec`](#toolspec)[]

##### executeToolCall

> **executeToolCall**: (`name`, `args`, `task`) => `Promise`\<`string`\>

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### initialMessages?

> `optional` **initialMessages?**: readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[]

Exact conversation to continue. Runtime validates its system message against the profile.

##### onMessages?

> `optional` **onMessages?**: (`messages`) => `void` \| `Promise`\<`void`\>

Observe the detached final conversation for session persistence.

###### Parameters

###### messages

readonly `Readonly`\<`Record`\<`string`, `unknown`\>\>[]

###### Returns

`void` \| `Promise`\<`void`\>

##### onToolStep?

> `optional` **onToolStep?**: (`step`) => `void`

Online observer of each tool step — the seam a `DetectorMonitor` taps to watch the live pipe
 (raise a `finding` when the worker loops/errors). Called after every tool call resolves, with
 real per-call wall-clock (`startedAt`/`endedAt`/`durationMs`) so a push `TraceSource` can carry
 non-zero span durations onto the unified timeline.

###### Parameters

###### step

###### toolName

`string`

###### args

`Record`\<`string`, `unknown`\>

###### status

`"error"` \| `"ok"`

###### startedAt?

`number`

###### endedAt?

`number`

###### durationMs?

`number`

###### Returns

`void`

***

### SandboxSteeringOptions

Opt-in configuration for the steerable sandbox worker (`SandboxSeam.steering`). Absent, the
 sandbox executor keeps its historical single-shot `runAgentRounds` composition verbatim.

#### Properties

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Max turns for one worker (turn 0 + folded steers). Default [DEFAULT\_SANDBOX\_STEERING\_MAX\_TURNS](#default_sandbox_steering_max_turns).

##### activityWindow?

> `readonly` `optional` **activityWindow?**: `number`

How many recent tool/turn notes `progress()` reports. Default 12.

##### turnTimeoutMs?

> `readonly` `optional` **turnTimeoutMs?**: `number`

Per-turn wall-clock ceiling; the turn's stream is aborted when it elapses.

***

### SteerableSandboxSession

What the steerable session exposes to its executor: the usage stream plus the live reads.

#### Methods

##### stream()

> **stream**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](#usageevent)\>

Drive the worker to settlement. `signal` is the spawn-scoped abort handed to `execute`.

###### Parameters

###### task

`unknown`

###### signal

`AbortSignal`

###### Returns

`AsyncIterable`\<[`UsageEvent`](#usageevent)\>

##### progress()

> **progress**(): [`ExecutorProgress`](#executorprogress)

###### Returns

[`ExecutorProgress`](#executorprogress)

##### traceSource()

> **traceSource**(): [`TraceSource`](#tracesource-1)

###### Returns

[`TraceSource`](#tracesource-1)

##### artifact()

> **artifact**(): \{ `outRef`: `string`; `out`: `unknown`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](index.md#spend); \} \| `undefined`

###### Returns

\{ `outRef`: `string`; `out`: `unknown`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](index.md#spend); \} \| `undefined`

##### teardown()

> **teardown**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

***

### SteerableSandboxArgs

#### Properties

##### controller

> `readonly` **controller**: `AbortController`

##### profile

> `readonly` **profile**: `AgentProfile`

##### harness

> `readonly` **harness**: `BackendType`

##### sandboxClient

> `readonly` **sandboxClient**: [`SandboxClient`](#sandboxclient-5)

##### inbox

> `readonly` **inbox**: [`Inbox`](#inbox)

##### taskToPrompt

> `readonly` **taskToPrompt**: (`task`) => `string`

###### Parameters

###### task

`unknown`

###### Returns

`string`

##### options?

> `readonly` `optional` **options?**: [`SandboxSteeringOptions`](#sandboxsteeringoptions)

##### loopCtx?

> `readonly` `optional` **loopCtx?**: `Partial`\<`Omit`\<[`ExecCtx`](#execctx), `"signal"` \| `"sandboxClient"`\>\>

##### traceEnv?

> `readonly` `optional` **traceEnv?**: `Record`\<`string`, `string`\>

Inherited `TRACE_ID` / `PARENT_SPAN_ID` for the box, merged into `CreateSandboxOptions.env` so
the remote worker's own spans join the supervisor's trace under the spawning node's span.
Absent when the run records no spans — the create options are then untouched.

##### contentRef

> `readonly` **contentRef**: (`prefix`, `value`) => `string`

###### Parameters

###### prefix

`string`

###### value

`unknown`

###### Returns

`string`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

***

### ScopeArgs

Construction args for `createScope`. The supervisor threads the shared pool, journal,
 blob store, and executor registry through; `depth`/`maxDepth` pair the runtime
 recursion ceiling with the conserved pool (R3).

#### Properties

##### parentId

> `readonly` **parentId**: `string`

This scope's owning node id — children get `${parentId}:s${seq}` ids.

##### root

> `readonly` **root**: `string`

Journal/blob root key the supervisor `beginTree`'d.

##### pool

> `readonly` **pool**: [`BudgetPool`](#budgetpool)

The reservation pool for this scope: the root total or one nested allocated partition.

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Append-only spawn journal; this scope writes `spawned` + `settled` records.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Content-addressed result store backing `outRef` rehydration.

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](index.md#executorregistry)

The open executor resolver (BYO → router/inline → registered harness factory).

##### probes?

> `readonly` `optional` **probes?**: [`WaitProbeRegistry`](#waitproberegistry)

Predicate resolver for `poll` wait-states. Absent ⇒ `wait` refuses a `poll` with
 `unknown-probe`; `timer` waits never touch it.

##### waitSleep?

> `readonly` `optional` **waitSleep?**: (`ms`, `signal`) => `Promise`\<`void`\>

Injected sleeper for wait-states — a test drives a week-long timer in microseconds.

###### Parameters

###### ms

`number`

###### signal

`AbortSignal`

###### Returns

`Promise`\<`void`\>

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Per-spawn executor-construction seams (sandbox client, router config, cli bin).

##### depth

> `readonly` **depth**: `number`

This scope's recursion depth (root = 0).

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Runtime recursion-depth ceiling — a spawn past it fails closed `depth-exceeded`.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Root-owned limit on live spawned workers across this scope and every nested scope.

##### signal

> `readonly` **signal**: `AbortSignal`

Abort signal for this scope; an abort cascades into every live child's executor.

##### now?

> `readonly` `optional` **now?**: () => `number`

Injected clock — keeps the journal `at` timestamp deterministic in tests.

###### Returns

`number`

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle stream sink. `spawn` emits `agent.spawn`, `next` emits `agent.child` — the
 SAME stream `runAgentRounds`/`tool-loop` feed, so the recursive tree is ONE observable stream
 (the topology viewer reads it). Undefined ⇒ the journal stays the only record.

##### workerTrace?

> `readonly` `optional` **workerTrace?**: [`WorkerTraceResolver`](#workertraceresolver)

Trace context to hand down to each spawned worker (`SupervisorOpts.workerTrace`). Called with
THIS scope's own `parentId` — the node doing the spawning — and the resolved context is seeded
onto each child's `ExecutorContext` under `workerTraceSeamKey`. Absent (the untraced default)
⇒ no seam is seeded and no worker environment is touched.

##### workerTraceUnpropagated?

> `readonly` `optional` **workerTraceUnpropagated?**: `object`

Present when this run RECORDS spans but the worker backend has NO channel to carry the trace
context (`WORKER_TRACE_PROPAGATION[backend] === false` — cli-worktree has no env
channel; router / router-tools / provider have no worker process). Each spawn then journals a
`trace-unpropagated` event naming the severed hop, so a child whose trace shows up as a
disconnected root is a recorded fact rather than a silent stranger. Absent ⇒ either the run
is untraced or the backend propagates; nothing is journaled.

###### backend

> `readonly` **backend**: `string`

###### reason

> `readonly` **reason**: `"no-env-channel"` \| `"no-worker-process"` \| `"caller-omitted"`

##### resumeFrom?

> `readonly` `optional` **resumeFrom?**: `object`

Resume seam — set ONLY by the supervisor when `SupervisorOpts.resume` is on AND a non-empty
journal tree exists for this root. It carries the replayed committed work (so `scope.resume`
exposes it to a resume-aware `act`) and the recorded ordinal/cursor maxima the new counters
continue past, so a freshly-spawned child never reuses a journaled `seq`. Absent ⇒ fresh run.

###### settled

> `readonly` **settled**: readonly [`Settled`](index.md#settled)\<`unknown`\>[]

###### view

> `readonly` **view**: [`TreeView`](#treeview)

###### maxSpawnOrdinal

> `readonly` **maxSpawnOrdinal**: `number`

Highest `spawned` ordinal already journaled; new spawns start at `+1`.

###### maxCursorSeq

> `readonly` **maxCursorSeq**: `number`

Highest cursor `seq` already journaled; new settlements start at `+1`.

###### maxWaitOrdinal

> `readonly` **maxWaitOrdinal**: `number`

Highest `waiting` ordinal already journaled; new waits start at `+1`.

###### waits

> `readonly` **waits**: readonly [`PendingWait`](#pendingwait)[]

Waits journaled as armed but never woken — re-armed (same node id, same absolute deadline)
 when `wait` is called again with the SAME label.

###### keys

> `readonly` **keys**: `ReadonlyMap`\<`string`, [`ResumedKeyState`](#resumedkeystate)\<`unknown`\>\>

Keyed assignments from the prior journal — what a keyed re-spawn resolves against.

###### priorSpend

> `readonly` **priorSpend**: `object`

Prior committed spend summed off the journal (settled child work + metered inference).

###### priorSpend.childWork

> `readonly` **childWork**: [`Spend`](index.md#spend)

###### priorSpend.driverInference

> `readonly` **driverInference**: [`Spend`](index.md#spend)

***

### ProgressSample

One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own
 quality signal (a verdict score, a test pass-rate, a judge rating); `undefined` = this
 settlement produced no measurable objective (it failed, or nothing scored it).

#### Properties

##### id

> `readonly` **id**: `string`

##### at

> `readonly` **at**: `number`

Epoch ms the settlement was observed.

##### objective?

> `readonly` `optional` **objective?**: `number`

##### delivered

> `readonly` **delivered**: `boolean`

True when the settlement passed its deliverable check — a scored-but-undelivered result is
 not progress.

***

### ProgressView

The read-model a `StopRule` decides from — the run's progress, not its budget.

#### Properties

##### now

> `readonly` **now**: `number`

##### settles

> `readonly` **settles**: `number`

Settlements observed so far, in the order they landed.

##### delivered

> `readonly` **delivered**: `number`

Of those, how many passed their deliverable check.

##### curve

> `readonly` **curve**: readonly `number`[]

Best-so-far objective after each settlement (`anytime.bestSoFar`).

##### best

> `readonly` **best**: `number`

The current best objective; `0` when nothing has scored.

##### auc

> `readonly` **auc**: `number`

Mean of the best-so-far curve — how EARLY the run climbed (`anytime.areaUnderCurve`).

##### lastSettleAt

> `readonly` **lastSettleAt**: `number`

Epoch ms of the most recent settlement; `0` when none has landed.

##### lastImprovementAt

> `readonly` **lastImprovementAt**: `number`

Epoch ms of the most recent improvement in best-so-far; `0` when none.

##### settlesSinceImprovement

> `readonly` **settlesSinceImprovement**: `number`

Settlements since the last improvement — `0` right after one improves.

##### workers

> `readonly` **workers**: readonly [`WorkerProgress`](#workerprogress)[]

Live read of every non-terminal worker (the `Scope.progress` feed). Empty when the caller
 supplied no scope.

##### inFlight

> `readonly` **inFlight**: `number`

Nodes running or acquiring.

##### waiting

> `readonly` **waiting**: `number`

Armed wait-state nodes — deliberately separate from `inFlight`: a tree whose only remaining
 nodes are waits is NOT stalled, it is waiting on the world.

***

### ProgressTracker

Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a
 caller may re-push its whole roster every turn (the driver does exactly that) without
 double-counting or moving a recorded timestamp.

#### Methods

##### record()

> **record**(`sample`): `boolean`

Record a settlement. A second call with the same `id` is ignored. Returns true when it was
 new.

###### Parameters

###### sample

[`ProgressSample`](#progresssample)

###### Returns

`boolean`

##### view()

> **view**(`scope?`, `opts?`): [`ProgressView`](#progressview)

Materialize the view. Pass the live `Scope` to include the worker feed and tree shape.

###### Parameters

###### scope?

[`Scope`](index.md#scope)\<`unknown`\>

###### opts?

###### stallAfterMs?

`number`

###### Returns

[`ProgressView`](#progressview)

##### evaluate()

> **evaluate**(`rule`, `scope?`, `opts?`): [`StopDecision`](#stopdecision)

Evaluate a rule against the current view.

###### Parameters

###### rule

[`StopRule`](#stoprule)

###### scope?

[`Scope`](index.md#scope)\<`unknown`\>

###### opts?

###### stallAfterMs?

`number`

###### Returns

[`StopDecision`](#stopdecision)

##### samples()

> **samples**(): readonly [`ProgressSample`](#progresssample)[]

The samples recorded so far, in order.

###### Returns

readonly [`ProgressSample`](#progresssample)[]

***

### ProgressTrackerOptions

#### Properties

##### now?

> `readonly` `optional` **now?**: () => `number`

Clock for `view().now`. Defaults to `Date.now`.

###### Returns

`number`

##### requireDelivered?

> `readonly` `optional` **requireDelivered?**: `boolean`

Treat a settlement that did NOT pass its deliverable check as having no objective. Default
 true — "scored 0.9 but never delivered" is not progress, and counting it as progress is the
 exact way a plateau rule gets talked out of firing.

##### minImprovement?

> `readonly` `optional` **minImprovement?**: `number`

How much the best-so-far must rise for a settlement to count as an IMPROVEMENT. Default 0
 (any strict rise counts). Raise it to ignore score noise.

***

### NoProgressForOptions

#### Properties

##### ms?

> `readonly` `optional` **ms?**: `number`

Stop when this many ms have passed since the last SETTLEMENT. Omit to not bound on time.

##### settles?

> `readonly` `optional` **settles?**: `number`

Stop when this many settlements have landed with no improvement in best-so-far. Omit to not
 bound on settles.

##### minSettles?

> `readonly` `optional` **minSettles?**: `number`

Never stop before this many settlements have landed — the warm-up that stops a rule from
 firing on an empty run. Default 1.

***

### PlateauOptions

#### Properties

##### window

> `readonly` **window**: `number`

How many trailing settlements to judge. The rule fires when the whole window failed to lift
 the best-so-far by more than `minDelta`.

##### minDelta

> `readonly` **minDelta**: `number`

The rise that counts as an improvement — the domain's noise floor. `0` means any strict rise
 counts.

##### minSettles?

> `readonly` `optional` **minSettles?**: `number`

Never fire before this many settlements. Defaults to `window` (so the first decision is made
 on a full window, not on a partial one).

***

### AllWorkersStalledOptions

#### Properties

##### minWorkers?

> `readonly` `optional` **minWorkers?**: `number`

Require at least this many live workers before the rule can fire — one stalled worker in a
 one-worker tree is a weaker signal than a whole fleet going quiet. Default 1.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time that counts as stalled, passed through to the live progress read. Omit = the
 runtime default (`DEFAULT_STALL_AFTER_MS`).

***

### SuperviseRegistryTable

A name→value table, in this package's resolver-port shape (the same one `WaitProbeRegistry`
 uses): construction stays the caller's, lookup stays lazy, and a table backed by a file, a
 plugin loader, or a plain object all satisfy one interface.

#### Type Parameters

##### T

`T`

#### Methods

##### resolve()

> **resolve**(`name`): `T` \| `undefined`

###### Parameters

###### name

`string`

###### Returns

`T` \| `undefined`

***

### SuperviseRegistry

The name→value tables that make the four CODE-valued options expressible as run DATA.

`deliverable` / `finalizer` / `analysts` / `probes` are functions and registries, so a recorded
run configuration (a JSON row, a campaign spec, a resumed run's options) cannot carry them — and
a run with no `deliverable` cannot return a `winner` at all outside the sandbox backend, because
the finalizer keeps only children whose oracle passed and nothing else writes that verdict. A
caller that owns the code registers it here once and names it from data thereafter.

#### Properties

##### deliverables?

> `readonly` `optional` **deliverables?**: [`SuperviseRegistryTable`](#superviseregistrytable)\<[`DeliverableSpec`](#deliverablespec)\<`unknown`\>\>

##### finalizers?

> `readonly` `optional` **finalizers?**: [`SuperviseRegistryTable`](#superviseregistrytable)\<[`SupervisorFinalizer`](index.md#supervisorfinalizer)\>

##### analysts?

> `readonly` `optional` **analysts?**: [`SuperviseRegistryTable`](#superviseregistrytable)\<[`AnalystRegistry`](index.md#analystregistry)\>

##### probes?

> `readonly` `optional` **probes?**: [`SuperviseRegistryTable`](#superviseregistrytable)\<[`WaitProbeRegistry`](#waitproberegistry)\>

***

### SuperviseOptions

#### Extended by

- [`SupervisePursuitOptions`](durable.md#supervisepursuitoptions)
- [`SuperviseTestOptions`](testing.md#supervisetestoptions)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The conserved compute pool for the whole run.

##### rootHandle?

> `readonly` `optional` **rootHandle?**: [`RootHandle`](#roothandle-1)\<`unknown`\>

Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
attaches it before execution and detaches it after the join barrier.

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
root scope and every live child, including acquisition and backend execution.

##### execution?

> `readonly` `optional` **execution?**: [`AgentExecutionRef`](#agentexecutionref)

Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
digests itself from the exact detached values it executes.

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`.

##### deliverable?

> `readonly` `optional` **deliverable?**: `string` \| [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

The independent completion check for backend-derived workers and direct supervisor
 submissions. Strongly recommended: without it the supervisor cannot submit its own work and
 backend-derived workers fall back to their own validity signal. A `string` names an entry in
 `registry.deliverables`.

##### resolveDeliverable?

> `readonly` `optional` **resolveDeliverable?**: (`input`) => [`DeliverableSpec`](#deliverablespec)\<`unknown`\> \| `undefined`

Resolve the completion check for one exact authorized backend-derived leaf. The callback runs
after spawn authorization and driver classification, receives a detached immutable context,
and may return `undefined` to use the run-wide `deliverable`. Driver profiles never call it.

###### Parameters

###### input

[`AuthorizedSpawnContext`](#authorizedspawncontext)

###### Returns

[`DeliverableSpec`](#deliverablespec)\<`unknown`\> \| `undefined`

##### registry?

> `readonly` `optional` **registry?**: [`SuperviseRegistry`](#superviseregistry)

Name→value tables for the four code-valued options, so a recorded run configuration can name
 them instead of carrying closures. See [SuperviseRegistry](#superviseregistry).

##### coordination?

> `readonly` `optional` **coordination?**: [`CoordinationBinding`](#coordinationbinding)

Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
 port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
 unless `allowUnauthenticatedRemote` acknowledges that the verbs are unauthenticated.

##### peerMail?

> `readonly` `optional` **peerMail?**: `boolean` \| \{ `limits?`: `Partial`\<[`PeerMailLimits`](#peermaillimits)\>; \}

OPT-IN peer mail for the run's workers: sibling-to-sibling `send_mail` / `read_mail`, bounded
 and audited (`CoordinationToolsOptions.peerMail`). The runtime mints one capability URL per
 spawn, serves the mail listener beside the coordination MCP, and hands each worker its
 endpoint on [WorkerSpawnContext.peerMailUrl](#peermailurl). Mounting that URL into the worker is the
 `makeWorkerAgent` owner's job today: the runtime never writes it into a worker profile, since
 the fresh random URL would move the canonical profile digest, and bridge workers cannot mount
 it out of band until the bridge carries runtime attachments (#774). Requires a harness-brained
 supervisor; a router-brained supervisor is refused rather than silently unmailed.

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](#makeworkeragent)

Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
 This is caller-owned execution: profile security, spawn authorization, and recursive-driver
 selection below apply only to the backend-derived worker path. `authorizeMessage` still
 governs continuations sent through Runtime's coordination tools.

##### driverBackend?

> `readonly` `optional` **driverBackend?**: [`ExecutorConfig`](#executorconfig)

Run harness-brained supervisors here. Automatic execution supports a local `bridge`; a remote
 sandbox requires an explicit `driveHarness` with a reachable coordination relay or tunnel.
 Defaults to `backend`; separate it when managers and workers use different services.

##### profileSecurity?

> `readonly` `optional` **profileSecurity?**: `AgentProfileSecurityPolicy`

Security policy applied to every manager-authored child profile before budget reservation.
 The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
 allowlist to grant remote MCP hosts or other author-controlled capabilities.

##### authorizeSpawn?

> `readonly` `optional` **authorizeSpawn?**: (`input`) => [`AuthorizedSpawn`](#authorizedspawn)

Product authority over one complete manager-authored spawn. The callback sees the detached,
 immutable profile, task, budget, label, and key together, so approving a profile cannot
 authorize a different task. Return the exact allowed profile (which may be narrowed) plus
 trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation.

###### Parameters

###### input

###### profile

`AgentProfile`

###### parent

`AgentProfile`

###### parentIdentity

[`NodeExecutionIdentity`](#nodeexecutionidentity)

Trusted identity of the manager authorizing this exact child.

###### parentNodeId

`string`

Concrete manager node; never accepted from model-authored tool arguments.

###### assignmentId

`string`

Stable manager-scoped assignment, including deterministic unkeyed siblings.

###### task

`unknown`

###### budget

[`Budget`](index.md#budget-4)

###### label

`string`

###### key?

`string`

###### depth

`number`

###### Returns

[`AuthorizedSpawn`](#authorizedspawn)

##### authorizeMessage?

> `readonly` `optional` **authorizeMessage?**: (`input`) => [`AuthorizedDownMessage`](#authorizeddownmessage)

Product authority over every continuation sent to a live child. When spawn authorization is
enabled, omitting this refuses steer/answer instructions instead of silently extending the
authorized task. The exact worker identity and detached bytes are recorded before delivery.

###### Parameters

###### input

[`DownMessageAuthorizationInput`](#downmessageauthorizationinput) & `object`

###### Returns

[`AuthorizedDownMessage`](#authorizeddownmessage)

##### isDriverProfile?

> `readonly` `optional` **isDriverProfile?**: (`input`) => `boolean`

Decide whether an authorized child becomes another supervisor. By default only
 `metadata.role === 'driver'` does. Products receive the same frozen post-authorization
 context as `resolveDeliverable`, so trusted execution/assignment authority can override
 model-authored metadata without a side channel.

###### Parameters

###### input

[`AuthorizedSpawnContext`](#authorizedspawncontext)

###### Returns

`boolean`

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](#routertransportconfig)

The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
 model wins.

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
 caller-owned override for a local bridge.

##### driverRetry?

> `readonly` `optional` **driverRetry?**: [`DriverRetryPolicy`](#driverretrypolicy)

How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
`driver-failed`. A harness process SIGKILLed at a bridge timeout, a stream cut mid-turn, or an
upstream 5xx used to end a run of arbitrary length while its budget and deadline sat almost
untouched (#741). A retry re-enters the driver over the SAME scope, coordination server, and
live children; the bridge backend reattaches the harness session by its durable execution id.

Runtime's own refusals (a validation guard, an exhausted budget, an abort, a client-side
transport status) are never retried — they were decisions. Retries stop at the budget, the
deadline, an abort, or a run of attempts that changed nothing at all.

Omit = retry under the defaults. `{ enabled: false }` = the historical behavior where the first
driver failure ends the run. Applies to the root manager and every recursive manager under it.

##### onDriverAttempt?

> `readonly` `optional` **onDriverAttempt?**: (`record`) => `void` \| `Promise`\<`void`\>

Per-attempt record for every external driver in the tree — what makes "failed after N
 attempts, last cause X" visible instead of one backend's last words.

###### Parameters

###### record

[`DriverAttemptRecord`](#driverattemptrecord)

###### Returns

`void` \| `Promise`\<`void`\>

##### childSettleGraceMs?

> `readonly` `optional` **childSettleGraceMs?**: `number`

How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
cascades the abort into them. A root that died did not make its children unhealthy: a child
mid-unit holds work already paid for, and an immediate cascade discards everything it has not
yet written. Bounded by the run's own deadline. Omit/`0` = immediate teardown.

##### resolveDriveHarness?

> `readonly` `optional` **resolveDriveHarness?**: [`ResolveDriveHarness`](#resolvedriveharness-1)

Resolve one custom external-harness session per trusted manager identity. Use this instead of
`driveHarness` when recursive managers must be independently steerable.

##### driveHarnessMaterialization?

> `readonly` `optional` **driveHarnessMaterialization?**: [`ProfileMaterializationContract`](agent.md#profilematerializationcontract)

Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
AgentProfile axes that path really applies. Built-in bridge driving supplies its own
full-profile contract.

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](#resolvesupervisortools-1)

Resolve product-owned tools from the exact trusted manager context. The same descriptors and
handlers are bound to router and external-harness managers; resolution happens once per node.
Each handler receives that manager scope's live cancellation signal in its trusted invocation
context, including recursive parent and root cascades.

##### onCoordinationEvent?

> `readonly` `optional` **onCoordinationEvent?**: (`context`, `eventId`, `record`) => `void` \| `Promise`\<`void`\>

Awaited product transaction hook for every coordination record. `eventId` is stable across a
lost acknowledgement and durable restart; the record is not pull-visible until this commits.

###### Parameters

###### context

[`SupervisorNodeContext`](#supervisornodecontext)

###### eventId

`` `sha256:${string}` ``

###### record

[`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](index.md#budget-4)

Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on simultaneously executing spawned workers across the WHOLE recursive tree. The
 root is excluded; nested drivers and leaves share one allocation, so recursion cannot multiply
 the cap. Omit/`<= 0` = no cap (the conserved pool stays the only bound).

##### analysts?

> `readonly` `optional` **analysts?**: `string` \| [`AnalystRegistry`](index.md#analystregistry)

Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
 (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
 `registry.analysts`.

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](#analyzeonsettleroute))[]

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
 the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
 threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
 Omit/empty = status quo (no analyst feed). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](#workerwatchoptions)

Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
is the correction. Requires a backend whose executor exposes a trace source (the steerable
sandbox worker and the pi wrapper do); other runtimes are simply not watched.

Omit = off (status quo — no online watching, no extra events).

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
 at observation time — nothing is killed or retried. Omit = the runtime default.

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](#continuitymode)\>\>

Default continuity per worker PROFILE NAME: `'resume'` makes each spawn of that name after
 the first re-attach to the node's most recent SETTLED worker — a NEW live worker whose spawn
 context carries the prior worker's identity (`WorkerSpawnContext.resume`), which the executor
 seam re-attaches with. `spawn_agent`'s per-call `continuity` argument overrides in either
 direction; `runGraph` derives this from delegates-edge `continuity`. Omit = every spawn is
 `'fresh'` (status quo). See `CoordinationToolsOptions.continuityByProfile` for the
 refusal semantics (no-prior / while-live / with-key) and the process-local resume boundary.

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Worker output store. Defaults to in-memory.

##### runDir?

> `readonly` `optional` **runDir?**: `string`

Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
root profile/task identity and declared budget match. The original absolute deadline and prior
measured spend are restored before new admission. The built-in driver is resume-aware: children
that already settled, including their exact execution identities, are replayed onto
`Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
(`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
waits re-arm on their original deadlines, and the coordination log loads prior questions,
findings, and instruction receipts. The router arm receives all three in its resume brief; the
external arm seeds prior questions while findings and receipts remain in the durable log.
Instruction receipts are evidence and are never delivered automatically to a replacement
worker. The final result spans both processes' work. Unset = in-memory, fresh every call.

The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
the built-in executors cannot re-attach to a dead process's executions. Each such assignment
resumes as explicitly lost/in-doubt, its full declared reservation is charged conservatively,
and its token/dollar telemetry remains unknown. A retry is admitted only from safely remaining
capacity, so restart cannot mint a fresh budget or slide the original absolute deadline.

`runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
resumable run per directory but collides across concurrent runs sharing one `runDir`.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
 with `blobs` — a journal whose result payloads live in a different store cannot replay.

##### probes?

> `readonly` `optional` **probes?**: `string` \| [`WaitProbeRegistry`](#waitproberegistry)

Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
 wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
 refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
 `registry.probes`.

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](#stoprule)

PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped LEARNING before it
exhausts a ceiling — the answer to "a run should end because it is done or stuck, not because
it ran out". It composes with the budget guards and can never override one.

The evaluation boundary differs by arm because the loop does: a router-brained supervisor is
evaluated before each of its own inference turns; a harness-brained supervisor is evaluated on
each worker settle, and a stop aborts its stop signal so the harness ends at its next turn
boundary. Both arms fold the same settled ledger through the same evaluator.

Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
`noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
only (unchanged behavior).

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
 reason instead of inferring an early stop from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
 driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
 stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
 boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
 pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
 arm's default cap, and no turn cap on the harness arm.

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
 a harness owns its own context window and its own compaction, so this is refused for a
 harness-brained supervisor rather than silently ignored): once its coordination transcript
 exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
 re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
 to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
 Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

##### runId?

> `readonly` `optional` **runId?**: `string`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Restrict the run to this subset of models. When set, every configured model — the
 supervisor router model, the profile's model, and the backend's model — must be a member,
 or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.

 This is a MODEL-ID filter, not a route filter. The compared values are the bare ids a profile
 declares — `model.default`, `model.small`, `subagents[].model`, `modes[].model`. The composed
 wire id (`harness/provider/model`) is never built here and never compared, so an entry written
 in qualified form matches nothing, and a child that names an allowed id is admitted whatever
 harness and provider its own profile declares. Pin the route with `authorizeSpawn`: it reads
 the authored child profile and may refuse the spawn before any reservation.

##### finalizer?

> `readonly` `optional` **finalizer?**: `string` \| [`SupervisorFinalizer`](index.md#supervisorfinalizer)

How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
 highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
 `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
 disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
 structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
 `string` names an entry in `registry.finalizers`.

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
 scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
 is the behavior every existing caller has.

##### otel?

> `readonly` `optional` **otel?**: `Omit`\<[`SupervisorSpanOptions`](#supervisorspanoptions), `"runId"` \| `"now"`\>

OPT-IN OTLP tracing: emit one span per supervised node (opened at spawn, closed at settle,
parented to its parent node's span) plus an `LLM` child span per metered driver turn, so the
tree is readable by any trace viewer instead of only by a journal parser. See `otel-spans.ts`.

Omit and the run emits nothing, allocates no recorder, and installs no hook — telemetry is
never a default. Present with no reachable endpoint (no `exportConfig.endpoint` and no
`OTEL_EXPORTER_OTLP_ENDPOINT`) is also a no-op. The spawn journal is untouched either way:
spans are telemetry, never the replay/resume record.

***

### AuthorizedSpawn

The product-authorized result for one complete spawn request. Attribution is never accepted
from the manager itself; it enters only through this trusted callback.

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

##### execution?

> `readonly` `optional` **execution?**: [`AgentExecutionRef`](#agentexecutionref)

***

### AuthorizedSpawnContext

Exact trusted context after a manager-authored spawn has passed product authorization.

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

##### parent

> `readonly` **parent**: `AgentProfile`

##### parentIdentity

> `readonly` **parentIdentity**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### execution

> `readonly` **execution**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### parentNodeId

> `readonly` **parentNodeId**: `string`

##### assignmentId

> `readonly` **assignmentId**: `string`

##### task

> `readonly` **task**: `unknown`

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

##### label

> `readonly` **label**: `string`

##### key?

> `readonly` `optional` **key?**: `string`

##### depth

> `readonly` **depth**: `number`

***

### ResolvedSupervisorProfile

The exact profile fields consumed by supervisor materialization.

#### Properties

##### name

> `readonly` **name**: `string`

##### harness

> `readonly` **harness**: `string` \| `null`

##### modelId

> `readonly` **modelId**: `string`

##### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

***

### CoordinationBinding

Where the coordination MCP binds. Omit = an ephemeral port on `127.0.0.1` (the local-harness
 default); set `host` when the root or the harness runs off-host.

#### Properties

##### host?

> `readonly` `optional` **host?**: `string`

##### port?

> `readonly` `optional` **port?**: `number`

##### allowUnauthenticatedRemote?

> `readonly` `optional` **allowUnauthenticatedRemote?**: `boolean`

Explicit acknowledgment required to bind a NON-loopback host — see
 [assertCoordinationBinding](#assertcoordinationbinding) for what is being accepted.

***

### SupervisorNodeContext

Trusted run/node identity Runtime binds to one manager. Model-authored tool arguments cannot
 provide or replace any of these fields.

#### Extended by

- [`SupervisorToolInvocationContext`](#supervisortoolinvocationcontext)

#### Properties

##### runId

> `readonly` **runId**: `string`

##### runNamespace

> `readonly` **runNamespace**: `string`

Stable across a durable restart; unique per in-memory invocation.

##### nodeId

> `readonly` **nodeId**: `string`

Concrete Scope node that owns this manager's coordination stream.

##### ownerId

> `readonly` **ownerId**: `string`

Stable identity of this manager's coordination stream.

##### depth

> `readonly` **depth**: `number`

##### identity

> `readonly` **identity**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Assignment identity within the parent manager; absent only for the root.

##### profile

> `readonly` **profile**: `AgentProfile`

##### task

> `readonly` **task**: `unknown`

***

### SupervisorToolInvocationContext

Trusted context for one product-tool invocation. The node identity remains the same detached,
immutable snapshot supplied to the resolver; `signal` is the one live control reference Runtime
adds. It aborts when this manager's scope is cancelled by the caller, RootHandle, deadline,
breaker, or a recursive parent.

#### Extends

- [`SupervisorNodeContext`](#supervisornodecontext)

#### Properties

##### runId

> `readonly` **runId**: `string`

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`runId`](#runid-18)

##### runNamespace

> `readonly` **runNamespace**: `string`

Stable across a durable restart; unique per in-memory invocation.

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`runNamespace`](#runnamespace)

##### nodeId

> `readonly` **nodeId**: `string`

Concrete Scope node that owns this manager's coordination stream.

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`nodeId`](#nodeid-2)

##### ownerId

> `readonly` **ownerId**: `string`

Stable identity of this manager's coordination stream.

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`ownerId`](#ownerid-1)

##### depth

> `readonly` **depth**: `number`

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`depth`](#depth-3)

##### identity

> `readonly` **identity**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`identity`](#identity-4)

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Assignment identity within the parent manager; absent only for the root.

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`assignmentId`](#assignmentid-3)

##### profile

> `readonly` **profile**: `AgentProfile`

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`profile`](#profile-15)

##### task

> `readonly` **task**: `unknown`

###### Inherited from

[`SupervisorNodeContext`](#supervisornodecontext).[`task`](#task-21)

##### signal

> `readonly` **signal**: `AbortSignal`

***

### SupervisorToolDescriptor

One product-owned tool. It reuses the canonical MCP descriptor fields while Runtime supplies
 the trusted invocation context as a separate argument and binds the result for either
 transport. Existing handlers remain compatible: the second argument only gains `signal`.

#### Extends

- `Omit`\<[`McpToolDescriptor`](mcp.md#mcptooldescriptor), `"handler"`\>

#### Properties

##### name

> **name**: `string`

###### Inherited from

[`McpToolDescriptor`](mcp.md#mcptooldescriptor).[`name`](mcp.md#name-2)

##### description

> **description**: `string`

###### Inherited from

[`McpToolDescriptor`](mcp.md#mcptooldescriptor).[`description`](mcp.md#description)

##### inputSchema

> **inputSchema**: `Record`\<`string`, `unknown`\>

###### Inherited from

[`McpToolDescriptor`](mcp.md#mcptooldescriptor).[`inputSchema`](mcp.md#inputschema)

##### handler

> `readonly` **handler**: (`raw`, `context`) => `Promise`\<`unknown`\>

###### Parameters

###### raw

`unknown`

###### context

[`SupervisorToolInvocationContext`](#supervisortoolinvocationcontext)

###### Returns

`Promise`\<`unknown`\>

***

### DriveHarness()

How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate
 seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 `task` in its backend (remote sandbox or local CLI bridge) with `coordinationMcpUrl` mounted as an MCP server,
 so the harness calls spawn_agent / await_event / stop as native tools over the live scope.

> **DriveHarness**(`args`): `Promise`\<`void`\>

How to run an external harness as the DRIVER, with the coordination verbs mounted — the substrate
 seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 `task` in its backend (remote sandbox or local CLI bridge) with `coordinationMcpUrl` mounted as an MCP server,
 so the harness calls spawn_agent / await_event / stop as native tools over the live scope.

#### Parameters

##### args

###### profile

`AgentProfile`

The caller's profile, EXACTLY as passed to `supervisorAgent` — never rewritten. A canonical
 `AgentProfile` stays schema-valid here (the canonical schema rejects unknown top-level keys,
 so hoisting a resolved prompt onto it would make a profile its own validator refuses).

###### systemPrompt?

`string`

The standing instruction assembled from the profile: its system prompt in either spelling,
 plus the `prompt.instructions` and `resources.instructions` lines. Absent when the profile
 names none — the harness's own default then applies. This, not `profile.systemPrompt`, is
 what the harness should run under.

###### task

`unknown`

###### scope

[`Scope`](index.md#scope)\<`unknown`\>

###### coordinationMcpUrl

`string`

###### stopSignal?

`AbortSignal`

Fires when the coordination server accepts a result or declares completion.

###### coordinationTools

readonly `Omit`\<[`McpToolDescriptor`](mcp.md#mcptooldescriptor), `"handler"`\>[]

Data-only product tool surface mounted on the coordination MCP. Runtime-owned drivers include
 this in their materialization evidence without persisting executable handlers.

#### Returns

`Promise`\<`void`\>

#### Methods

##### deliver()?

> `optional` **deliver**(`message`): `boolean`

Optional live inbox for the manager session this adapter currently drives. Return `false`
when no executor inbox is active instead of claiming a message was delivered.

###### Parameters

###### message

`unknown`

###### Returns

`boolean`

***

### SupervisorAgentDeps

#### Extended by

- [`SupervisorAgentTestDeps`](testing.md#supervisoragenttestdeps)

#### Properties

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms).

##### authorizeDownMessage?

> `readonly` `optional` **authorizeDownMessage?**: [`AuthorizeDownMessage`](#authorizedownmessage)

Product authorization for every down-leg continuation to a child.

##### perWorker

> `readonly` **perWorker**: [`Budget`](index.md#budget-4)

Per-child budget reserved from the conserved pool on each spawn.

##### onProviderModel?

> `readonly` `optional` **onProviderModel?**: (`model`) => `void`

Runtime-owned sink for provider identity observed by this manager's own turns.

###### Parameters

###### model

`string` \| `undefined`

###### Returns

`void`

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Independent completion check for direct driver work (`submit_result`).

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
 this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
 boxes/sandboxes, not total work). Omit/`<= 0` = no cap.

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](#routertransportconfig)

Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
 profile's model wins.

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Required to run an external-harness supervisor: runs the harness as the driver.

##### driverRetry?

> `readonly` `optional` **driverRetry?**: [`DriverRetryPolicy`](#driverretrypolicy)

How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
 `driver-failed` (#741). Retries reuse the same scope, coordination server, and live children;
 the bridge backend reattaches the harness session by its durable execution id. Omit = retry
 under the defaults; `{ enabled: false }` = the historical first-failure-ends-the-run behavior.
 The router arm is unaffected: its transport already retries.

##### onDriverAttempt?

> `readonly` `optional` **onDriverAttempt?**: (`record`) => `void` \| `Promise`\<`void`\>

Per-attempt record for the external driver — how an operator sees "failed after N attempts"
 instead of one backend's last words.

###### Parameters

###### record

[`DriverAttemptRecord`](#driverattemptrecord)

###### Returns

`void` \| `Promise`\<`void`\>

##### nodeContext?

> `readonly` `optional` **nodeContext?**: [`SupervisorNodeContextSeed`](#supervisornodecontextseed)

Trusted identity for this manager. Required with node-scoped tools or observation.

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](#resolvesupervisortools-1)

Resolve product-owned tools for this exact manager. Static `extraTools` remain a router-only
 compatibility seam and deliberately receive no new recursive authority.

##### observeNodeEvent?

> `readonly` `optional` **observeNodeEvent?**: [`ObserveSupervisorNodeEvent`](#observesupervisornodeevent)

Awaited product observation, enriched with this manager's actual live node context.

##### replaySettlements?

> `readonly` `optional` **replaySettlements?**: `boolean`

Replay resume-time settlements through `observeNodeEvent` before the manager starts.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
 only delegate when it needs parallelism. Pair with `executeExtraTool`.

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry)

Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`.

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](#analyzeonsettleroute))[]

Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
 (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](#workerwatchoptions)

Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
 learns a worker is looping mid-run instead of at settle. Omit = no online watching.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default.

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](#continuitymode)\>\>

Default continuity per worker PROFILE NAME (both arms) — `'resume'` re-attaches spawns of
 that name to the node's latest settled worker; `spawn_agent`'s per-call `continuity`
 overrides. Omit = every spawn fresh (status quo).

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](#stoprule)

PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped learning BEFORE it
 exhausts a ceiling; it can never keep a run alive past one. Router arm: evaluated before each
 driver inference turn. External arm: evaluated on each worker settle, and a stop aborts
 `stopSignal` so the harness ends at its next turn boundary. Build it with `plateau` /
 `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
 caller's judgment. Omit = ceilings only.

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run (BOTH arms).

###### Parameters

###### reason

`string`

###### Returns

`void`

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Turn cap for the supervisor's own loop. Router arm: driver inference turns (see
 `DriverAgentOptions.maxTurns`). External arm: the cap belongs to the harness loop, so
 `supervise()` applies it in the drive seam it builds and this field is not read here.

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY; a
 harness-brained supervisor is refused at construction rather than silently ignoring it) — it
 distills its coordination transcript to a compact progress note once it exceeds the threshold,
 instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`.

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`, `record`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every coordination bus event (both arms) — the seam a durable
 caller hooks its coordination log onto.

###### Parameters

###### event

[`CoordinationEvent`](index.md#coordinationevent)

###### record

[`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

##### priorCoordination?

> `readonly` `optional` **priorCoordination?**: [`PriorCoordination`](#priorcoordination)

Questions, findings, and authorized continuation receipts loaded from a prior process.
 Router arm: questions seed the ledger and all evidence enters the resume brief. External arm:
 questions seed the ledger; receipts remain durable evidence and are never auto-delivered.

##### loadPriorCoordination?

> `readonly` `optional` **loadPriorCoordination?**: () => `Promise`\<[`PriorCoordination`](#priorcoordination)\>

Deferred owner-scoped replay for a recursive supervisor. Its stable owner is known while the
parent authorizes the child, but loading remains asynchronous; Runtime calls this before the
nested brain can publish or act on coordination state.

###### Returns

`Promise`\<[`PriorCoordination`](#priorcoordination)\>

##### finalizer?

> `readonly` `optional` **finalizer?**: [`SupervisorFinalizer`](index.md#supervisorfinalizer)

How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
 exact keep-best every existing caller had. Always runs under the delivered-only invariant.

##### coordination?

> `readonly` `optional` **coordination?**: [`CoordinationBinding`](#coordinationbinding)

Where the coordination MCP binds (external arm). Omit = an ephemeral loopback port, which is
 unreachable from an off-host harness. A non-loopback host fails closed — see
 [assertCoordinationBinding](#assertcoordinationbinding).

##### peerMail?

> `readonly` `optional` **peerMail?**: `boolean` \| \{ `limits?`: `Partial`\<[`PeerMailLimits`](#peermaillimits)\>; \}

OPT-IN peer mail (external arm): serve the sibling `send_mail` / `read_mail` post office
 beside the coordination MCP and mint each spawn a capability URL on
 `WorkerSpawnContext.peerMailUrl`. A router-brained supervisor is refused: it serves no
 listener, so there is no post office a worker could reach.

##### controlDir?

> `readonly` `optional` **controlDir?**: `string`

The durable run directory this manager acknowledges worker-scoped cancel requests from
 (router arm only — the in-process turn loop is the acknowledger). See
 `DriverAgentOptions.controlDir`.

##### controlScope?

> `readonly` `optional` **controlScope?**: `"run"` \| `"subtree"`

Which cancel requests this manager's acknowledger owns: `'run'` (default; the tree root —
 its own direct-child node ids plus label/profile-name references) or `'subtree'` (a nested
 manager — exact direct-child node ids only). Exactly one manager owns any request, so two
 acknowledgers can never apply one operation. See `DriverAgentOptions.controlScope`.

***

### WorkerToolTraceArtifact

Bytes stored under `WorkerTraceEvidence.traceRef`.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `1`

##### spans

> `readonly` **spans**: readonly `ToolSpan`[]

***

### ToolStepInput

#### Properties

##### toolName

> `readonly` **toolName**: `string`

##### args

> `readonly` **args**: `unknown`

##### argsCaptured?

> `readonly` `optional` **argsCaptured?**: `boolean`

False when the call was observed but its original arguments were unavailable.

##### status?

> `readonly` `optional` **status?**: `"error"` \| `"ok"`

##### statusCaptured?

> `readonly` `optional` **statusCaptured?**: `boolean`

False when the source observed the call being MADE but never observed it finishing — so no
outcome is knowable, not even by default. Some wires (cli-bridge's OpenAI-shaped `tool_calls`
deltas) report the model's DECISION to call a tool and never report the call's result at all.
Without this marker such a call would project as `status: 'ok'` and be counted as a success in
every downstream error-rate read. Set it and the span carries NO status, which is the truth.

##### result?

> `readonly` `optional` **result?**: `unknown`

##### error?

> `readonly` `optional` **error?**: `string`

##### callId?

> `readonly` `optional` **callId?**: `string`

Stable id of the tool call — used to de-duplicate the repeated state transitions a harness
 streams for one call (opencode emits pending→running→completed, plus a `raw`-wrapped copy).

##### startedAt?

> `readonly` `optional` **startedAt?**: `number`

Real per-call wall-clock when the source has it (owned tool-loop; opencode parts with `time`).
 When omitted the span collapses to a single instant (`at`) — order + counts only, no duration.

##### endedAt?

> `readonly` `optional` **endedAt?**: `number`

***

### TraceSource

#### Methods

##### onSpan()

> **onSpan**(`handler`): () => `void`

Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
 only exposes its trace at the end registers nothing and returns a no-op.

###### Parameters

###### handler

(`span`) => `void`

###### Returns

() => `void`

##### collect()

> **collect**(): `Promise`\<`ToolSpan`[]\>

The full set of tool spans for the run (SETTLE / batch). Always available.

###### Returns

`Promise`\<`ToolSpan`[]\>

***

### SessionMessageLike

A harness session message carrying parts (the shape `box.messages()` returns). Structurally typed
 so this works with the real `@tangle-network/sandbox` box AND a test double, no SDK import.

#### Properties

##### parts?

> `readonly` `optional` **parts?**: readonly `unknown`[]

***

### SessionTraceBox

The minimal box surface this needs: list a session's messages (incl. mid-turn partials).

#### Methods

##### messages()

> **messages**(`opts`): `Promise`\<readonly [`SessionMessageLike`](#sessionmessagelike)[]\>

###### Parameters

###### opts

###### sessionId

`string`

###### Returns

`Promise`\<readonly [`SessionMessageLike`](#sessionmessagelike)[]\>

***

### TrajectoryAnalysis

#### Properties

##### trajectory

> `readonly` **trajectory**: `Trajectory`

Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
 duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations.

##### stuckLoop

> `readonly` **stuckLoop**: `StuckLoopReport`

Full-run repeated-call view (total occurrences + window) — allows one intervening call so it
catches a loop the online consecutive detector interleaves past.

##### toolWaste

> `readonly` **toolWaste**: `ToolWasteReport`

Wasted-vs-total tool-call ratio for the run.

***

### WaitOpts

Options for `Scope.wait`. `label` is the wait's identity within its parent scope — it is what
 a resumed run matches to re-adopt a journaled, still-unfired wait, so it must be stable across
 processes (a label derived from wall-clock would resume as a NEW wait).

#### Properties

##### label

> `readonly` **label**: `string`

***

### Agent

One self-similar atom. A leaf is an `Agent` that never calls `scope.spawn`; a driver
is an `Agent` whose `act` spawns children and reacts to them via `scope.next()`. An
analyst is an `Agent` whose task is "read these traces → findings" — `where` it runs
is its executor, not a separate type.

`act` MUST be replay-safe: it may read `verdict`, `spent`, and `out` (rehydrated by
`outRef`) off each `Settled`; it MUST NOT read `Date.now`, `Math.random`, or any
unordered collection. `scope.next()` delivers strictly in recorded `seq` order.

#### Type Parameters

##### Task

`Task`

##### Out

`Out`

#### Properties

##### name

> `readonly` **name**: `string`

#### Methods

##### act()

> **act**(`task`, `scope`): `Promise`\<`Out`\>

###### Parameters

###### task

`Task`

###### scope

[`Scope`](index.md#scope)\<`Out`\>

###### Returns

`Promise`\<`Out`\>

##### deliver()?

> `optional` **deliver**(`msg`): `boolean` \| `void`

Optional manager inbox. A parent or attached `RootHandle` uses this to deliver the same raw
down-message accepted by executor inboxes. Return `false` when the manager has no live receive
path; returning `true` means the message was accepted for the current manager session.

###### Parameters

###### msg

`unknown`

###### Returns

`boolean` \| `void`

***

### ExecutorAccounting

Split used by a recursive executor when journaled child work differs from the full amount
reconciled against its parent reservation.

#### Properties

##### reported

> `readonly` **reported**: [`Spend`](index.md#spend)

##### reservation

> `readonly` **reservation**: [`Spend`](index.md#spend)

***

### ExecutorResult

Terminal artifact of a one-shot `Executor.execute`.

#### Type Parameters

##### Out

`Out`

#### Properties

##### outRef

> **outRef**: `string`

##### out

> **out**: `Out`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

##### spent

> **spent**: [`Spend`](index.md#spend)

***

### ExecutorToolCall

One tool call retained in an executor artifact. Every Runtime-owned executor reports this exact
shape, so `streamAgentTurn` projects terminal tool activity through one reader instead of a
per-backend parser. `arguments` holds the captured argument value; an empty object means the
source reported the call without its arguments.

#### Properties

##### id?

> `readonly` `optional` **id?**: `string`

##### name

> `readonly` **name**: `string`

##### arguments

> `readonly` **arguments**: `unknown`

***

### AgentExecutionRef

Caller-owned identity beyond the exact profile/task bytes Scope can compute itself.

#### Extended by

- [`NodeExecutionIdentity`](#nodeexecutionidentity)

#### Properties

##### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `` `sha256:${string}` ``

##### correlation?

> `readonly` `optional` **correlation?**: `Readonly`\<`Record`\<`string`, `string`\>\>

***

### NodeExecutionIdentity

Durable identity of one realized node. Missing digests mean the input was not canonical JSON.

#### Extends

- [`AgentExecutionRef`](#agentexecutionref)

#### Properties

##### candidateDigest?

> `readonly` `optional` **candidateDigest?**: `` `sha256:${string}` ``

###### Inherited from

[`AgentExecutionRef`](#agentexecutionref).[`candidateDigest`](#candidatedigest)

##### correlation?

> `readonly` `optional` **correlation?**: `Readonly`\<`Record`\<`string`, `string`\>\>

###### Inherited from

[`AgentExecutionRef`](#agentexecutionref).[`correlation`](#correlation)

##### profileDigest?

> `readonly` `optional` **profileDigest?**: `` `sha256:${string}` ``

##### taskDigest?

> `readonly` `optional` **taskDigest?**: `` `sha256:${string}` ``

***

### MaterializedExecutionIdentity

External execution identity that operators can use to join this node to its backend.

#### Properties

##### kind

> `readonly` **kind**: `string`

Backend-native identity kind, for example `request`, `session`, `run`, `process`, or `tree`.

##### id

> `readonly` **id**: `string`

***

### ExecutorMaterialization

Data-only declaration from trusted executor code about the exact sealed plan `execute` uses.
Scope snapshots this value and computes the durable receipt; callers never provide digests.

#### Properties

##### effectiveProfile

> `readonly` **effectiveProfile**: `AgentProfile`

Complete profile after trusted runtime-owned attachments or backend overlays were applied.

##### backend

> `readonly` **backend**: `string`

Concrete backend or harness selected for this run.

##### model

> `readonly` **model**: [`MaterializedModelIdentity`](#materializedmodelidentity)

Exact selected model, or an explicit unknown reason.

##### execution

> `readonly` **execution**: [`MaterializedExecutionIdentity`](#materializedexecutionidentity)

Backend-native session/run/request/process identity.

##### materializer

> `readonly` **materializer**: `string`

Named implementation that turns the effective profile into executable backend inputs.

##### plan

> `readonly` **plan**: `unknown`

Finite JSON describing the exact materialization plan. Persisted by digest only.

##### platformAttachments?

> `readonly` `optional` **platformAttachments?**: `unknown`

Trusted runtime-only attachments, such as the coordination MCP. Persisted by digest only.

***

### ExecutorExecutionBinding

Volatile execution routing that is true for one attempt but is not profile identity. The full
binding is hashed and discarded; only the safe structural descriptor is journaled.

#### Properties

##### attemptId

> `readonly` **attemptId**: `string`

##### binding

> `readonly` **binding**: `unknown`

##### descriptor

> `readonly` **descriptor**: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>

***

### ExecutorNodeContext

Kernel-owned context for the concrete supervised node a factory is constructing.

#### Properties

##### rootId

> `readonly` **rootId**: `string`

##### parentId

> `readonly` **parentId**: `string`

##### nodeId

> `readonly` **nodeId**: `string`

##### attemptId

> `readonly` **attemptId**: `string`

Kernel-minted identity for this concrete execution attempt.

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

***

### ExecutorContext

Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 (sandbox client for the sandbox executor, router config for router/inline) without
 the factory reaching into module globals.

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

##### propagatedHeaders?

> `readonly` `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Request headers inherited from an enclosing task or conversation.
Network executors forward these after their own connection headers so caller authorization,
recursion depth, and trace identity survive the profile-to-executor boundary.

##### node?

> `readonly` `optional` **node?**: [`ExecutorNodeContext`](#executornodecontext)

Present when Scope constructs the executor for a supervised node.

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Opaque seams the registry threads through; a built-in narrows what it needs.

***

### SpawnOpts

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

##### label

> `readonly` **label**: `string`

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Manager-scoped semantic assignment identity. Unlike `key`, this names every spawn, including
unkeyed siblings, so product traces can join authorization, node, and backend execution.

##### restart?

> `readonly` `optional` **restart?**: [`Restart`](#restart)

##### shutdown?

> `readonly` `optional` **shutdown?**: `number` \| `"brutalKill"` \| `"infinity"`

Teardown grace handed to the executor when this node is reaped.

##### key?

> `readonly` `optional` **key?**: `string`

Semantic identity of this assignment ACROSS process lifetimes. A keyed spawn is
idempotent per key: once a child spawned under a key settles `done` — in this process or in a
journaled prior one — spawning the same key returns that committed result (`prior.state:
'completed'`) instead of paying for the work again. A key whose prior attempt settled `down`
or was journaled as started-but-never-settled spawns FRESH but says so explicitly
(`prior.state: 'retried' | 'lost'`), and a key that is currently LIVE is refused
(`'duplicate-key'`) — the same assignment can never run twice concurrently. Unkeyed spawns
(the default) are position-identified and always run.

***

### Handle

A live child handle. `abort()` is defined over the ACQUIRE lifecycle: it chains into
the `acquireSandbox` signal and reaps a find-by-name orphan box, so a node aborted
mid-acquire never leaks (M1).

#### Type Parameters

##### Out

`Out`

#### Properties

##### id

> `readonly` **id**: `string`

##### label

> `readonly` **label**: `string`

##### status

> `readonly` **status**: [`NodeStatus`](#nodestatus)

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Manager-scoped assignment identity supplied at admission.

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

Durable identity of the authorized profile/task/candidate represented by this handle.

##### materialization?

> `readonly` `optional` **materialization?**: [`ProfileMaterializationReceipt`](#profilematerializationreceipt)

Stable execution plan once Runtime has committed it.

##### executionBindings?

> `readonly` `optional` **executionBindings?**: readonly [`ExecutionBindingReceipt`](#executionbindingreceipt)[]

Immutable per-attempt backend bindings committed so far, oldest first.

##### \_\_out?

> `readonly` `optional` **\_\_out?**: `Out`

Phantom: binds the handle to the child's output type so `spawn<C>` returns a
 `Handle<C>` distinct from a `Handle<other>`. Type-only — never present at runtime.

#### Methods

##### abort()

> **abort**(`reason?`): `void`

###### Parameters

###### reason?

`string`

###### Returns

`void`

***

### ResumedWork

The committed work a resumed run inherits from its journal. `settled` is the replayed
`Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
is the tree as `materializeTreeView` folded it at the recorded cursor position. A
resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](index.md#settled)\<`Out`\>[]

##### view

> `readonly` **view**: [`TreeView`](#treeview)

##### waits

> `readonly` **waits**: readonly [`PendingWait`](#pendingwait)[]

Wait-state nodes the journal shows as ARMED but never woken — the run died mid-wait. Each
carries the ORIGINAL arm instant and absolute deadline, so re-arming the same `label` through
`Scope.wait` resumes the countdown instead of restarting it. Empty on a fresh run and on a
resumed run that was not waiting.

##### keys

> `readonly` **keys**: `ReadonlyMap`\<`string`, [`ResumedKeyState`](#resumedkeystate)\<`Out`\>\>

Keyed assignments from the prior journal: `SpawnOpts.key` → what the journal proves about it.
`completed`/`down` carry the rehydrated settlement; `in-doubt` means the spawn was journaled
but no settlement ever landed — the process died with it in flight. `Scope.spawn` consults
this so a keyed re-spawn resolves instead of duplicating (see `SpawnOpts.key`). Empty when no
prior spawn carried a key.

##### priorSpend

> `readonly` **priorSpend**: `object`

The conserved spend the prior process(es) already committed for this run, summed off the same
journal replay reads: every `settled` child's reconciled spend (`childWork`) plus every
`metered` driver-inference record (`driverInference`). What a resume-aware driver reports as
"already paid" — the run's final `spentTotal` includes it because the journal spans processes.

###### childWork

> `readonly` **childWork**: [`Spend`](index.md#spend)

###### driverInference

> `readonly` **driverInference**: [`Spend`](index.md#spend)

***

### ResumedKeyState

What the journal proves about one keyed assignment at resume time.

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### id

> `readonly` **id**: `string`

##### label

> `readonly` **label**: `string`

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

Identity recorded when this key was first admitted. Every reuse must match it exactly.

##### state

> `readonly` **state**: `"completed"` \| `"down"` \| `"in-doubt"`

##### settled?

> `readonly` `optional` **settled?**: [`Settled`](index.md#settled)\<`Out`\>

The rehydrated settlement; absent exactly when `state` is `'in-doubt'`.

***

### NodeSnapshot

#### Extended by

- [`SpawnForestNode`](#spawnforestnode)

#### Properties

##### id

> `readonly` **id**: `string`

##### parent?

> `readonly` `optional` **parent?**: `string`

##### label

> `readonly` **label**: `string`

##### status

> `readonly` **status**: [`NodeStatus`](#nodestatus)

##### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-4)

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

##### ownedTreeRoot?

> `readonly` `optional` **ownedTreeRoot?**: `string`

Exact nested journal tree owned by this node, when Runtime attested recursive ownership.

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

Manager-scoped assignment identity, including deterministic ids for unkeyed siblings.

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

##### materialization?

> `readonly` `optional` **materialization?**: [`ProfileMaterializationReceipt`](#profilematerializationreceipt)

Kernel-owned execution evidence. `unknown` is distinct from a known zero/empty plan.

##### executionBindings?

> `readonly` `optional` **executionBindings?**: readonly [`ExecutionBindingReceipt`](#executionbindingreceipt)[]

Immutable attempt bindings, oldest first. A retried/resumed node may have more than one.

##### settledAt?

> `readonly` `optional` **settledAt?**: `number`

Epoch ms of the terminal journal record; absent while live or when legacy evidence lacks it.

##### spent

> `readonly` **spent**: [`Spend`](index.md#spend)

Conserved spend so far for this node.

##### providerModel?

> `readonly` `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence)

Provider model evidence persisted separately from the execution plan.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

`outRef` once the node is `done` (the replay/result pointer).

##### trace?

> `readonly` `optional` **trace?**: [`WorkerTraceEvidence`](index.md#workertraceevidence)

Present on terminal executor nodes; legacy records carry an explicit unavailable reason.

***

### TreeView

The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer.

#### Properties

##### root

> `readonly` **root**: `string`

##### nodes

> `readonly` **nodes**: readonly [`NodeSnapshot`](#nodesnapshot)[]

##### inFlight

> `readonly` **inFlight**: `number`

Count of nodes in `running` or `acquiring` — the "what's in flow?" answer.

##### waiting

> `readonly` **waiting**: `number`

Count of nodes in `waiting` — armed wait-states. Deliberately NOT folded into `inFlight`:
 a wait burns no executor and no budget, so counting it as flow would misreport both idle
 capacity and how much work is actually running.

***

### SpawnJournal

The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
`loadTree` returns events for inspection and completed-settlement replay, not live process
recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

###### Parameters

###### root

`string`

###### ev

[`SpawnEvent`](#spawnevent)

###### Returns

`Promise`\<`void`\>

***

### ResultBlobStore

Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 invariant. Split from the journal so the journal stays small (decisions) and the
 payloads (evidence) live where a viewer/replayer rehydrates them.

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

***

### SupervisorOpts

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The root conserved-pool ceiling (tokens + usd + iterations + deadline).

##### rootIdentity?

> `readonly` `optional` **rootIdentity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

Exact root profile/task identity supplied by the one-call composition surface.

##### rootMaterialization?

> `readonly` `optional` **rootMaterialization?**: [`RootMaterialization`](#rootmaterialization)

Trusted composition evidence for a root whose `act` drives an external backend. A generic
 root omits it and is durably marked unknown; model-facing Scope never receives this writer.

##### runId

> `readonly` **runId**: `string`

Trace-correlation root + the journal/blob root key.

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Result payload store backing `outRef` rehydration.

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](index.md#executorregistry)

Executor resolution — the open registry mapping `AgentSpec` → `Executor`.

##### probes?

> `readonly` `optional` **probes?**: [`WaitProbeRegistry`](#waitproberegistry)

Predicate resolution for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so
 the wait can be journaled and re-armed by a later process; this is what the name resolves
 against. Unset ⇒ `poll` waits are refused (`unknown-probe`); `timer` waits are unaffected.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Runtime recursion-depth ceiling (paired with the conserved pool per R3).

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard tree-wide cap on simultaneously executing spawned workers. The root is excluded; every
 nested driver and leaf shares this one allocation. Omit/`<= 0` leaves worker count uncapped.

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
trips the supervisor to `no-winner` rather than restarting forever.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

##### childSettleGraceMs?

> `readonly` `optional` **childSettleGraceMs?**: `number`

How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
cascades the abort into them (#741). A root that dies did not make its children unhealthy: a
child mid-unit holds work already paid for, and killing it instantly discards everything it has
not yet written. The window applies ONLY to a driver failure on an un-cancelled run, and never
extends past the run's own deadline. Omit/`0` = the historical immediate teardown.

##### resume?

> `readonly` `optional` **resume?**: `boolean`

**`Experimental`**

Opt into RESUME-FIRST: read any prior journal tree for this `runId` BEFORE beginning a fresh
one, and when a non-empty tree exists rehydrate its committed work onto `Scope.resume`
(`replaySpawnTree` + `materializeTreeView`) instead of starting over. Requires a journal +
blob store that OUTLIVE the process (`createFileRunContext(dir)`); against the in-memory
stores there is never a prior tree, so it is a no-op.

Default `false` — a run always begins a fresh tree, which is the behavior every existing
consumer has. Resume is a durability contract the caller opts into, never a silent default.

 Rehydrates committed settlements only; live supervised-tree recovery after a
coordinator restart is not implemented (docs/agent-managed-compute/README.md).

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
 same `agent.spawn`/`agent.child` stream `runAgentRounds` feeds — one observable recursive tree.

##### workerTrace?

> `readonly` `optional` **workerTrace?**: [`WorkerTraceResolver`](#workertraceresolver)

Trace context to hand DOWN to each spawned worker, so a worker in another process or on another
machine emits spans that join THIS run's trace instead of opening its own root. Supply
`SupervisorSpanRecorder.workerTrace`; the `Scope` seeds the resolved context onto every child's
`ExecutorContext` and the backends with an environment channel stamp it as
`TRACEPARENT` plus the legacy `TRACE_ID` / `PARENT_SPAN_ID` pair (see `worker-trace.ts` for
the precedence rule and for which backends propagate). Omit and no worker environment is
touched at all.

##### workerTraceUnpropagated?

> `readonly` `optional` **workerTraceUnpropagated?**: `object`

Declare that this run's worker backend CANNOT carry the trace context
(`WORKER_TRACE_PROPAGATION[backend] === false`). With `workerTrace` also set, every spawn then
journals a `trace-unpropagated` event naming the severed hop — the host-side record of a
distributed trace that will surface disconnected. `supervise()` derives this from its backend;
a direct `createSupervisor()` caller may set it for a caller-owned executor registry.

###### backend

> `readonly` **backend**: `string`

###### reason

> `readonly` **reason**: `"no-env-channel"` \| `"no-worker-process"` \| `"caller-omitted"`

***

### NoWinnerError

A driver's `act()` rejection, normalized to a serializable triple so it survives the typed
no-winner boundary (an `Error` does not cross a structured-clone / JSON hop intact). A
non-`Error` rejection normalizes to `{ name: 'NonError', message }` — never dropped.
Exported so a consumer handling `reason: 'driver-failed'` names this type instead of retyping
its fields.

#### Properties

##### name

> **name**: `string`

##### message

> **message**: `string`

##### stack?

> `optional` **stack?**: `string`

***

### RootHandle

Live root handle — a chat/pi-viz client uses it to inspect and control one root run.

#### Extended by

- [`SteerableRootHandle`](#steerableroothandle)

#### Type Parameters

##### Out

`Out`

#### Properties

##### \_\_out?

> `readonly` `optional` **\_\_out?**: `Out`

Phantom: binds the handle to the supervised run's output type. Type-only — never
 present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed.

#### Methods

##### view()

> **view**(): [`TreeView`](#treeview)

###### Returns

[`TreeView`](#treeview)

##### deliver()?

> `optional` **deliver**(`msg`): `boolean`

Optional for structural compatibility with existing view/signal/abort wrappers. Handles
minted by `createRootHandle` implement the required form in `SteerableRootHandle`.

###### Parameters

###### msg

`unknown`

###### Returns

`boolean`

##### signal()

> **signal**(`msg`): `void`

###### Parameters

###### msg

[`RootSignal`](#rootsignal)

###### Returns

`void`

##### abort()

> **abort**(`reason?`): `void`

###### Parameters

###### reason?

`string`

###### Returns

`void`

***

### SteerableRootHandle

A Runtime-minted root handle that can deliver raw steering or answers to a live manager inbox.
Delivery returns `false` when the manager has no receive path; detached calls fail loud.

#### Extends

- [`RootHandle`](#roothandle-1)\<`Out`\>

#### Type Parameters

##### Out

`Out`

#### Properties

##### \_\_out?

> `readonly` `optional` **\_\_out?**: `Out`

Phantom: binds the handle to the supervised run's output type. Type-only — never
 present at runtime; lets `attach(h: RootHandle<Out>)` stay output-typed.

###### Inherited from

[`RootHandle`](#roothandle-1).[`__out`](#__out-1)

#### Methods

##### view()

> **view**(): [`TreeView`](#treeview)

###### Returns

[`TreeView`](#treeview)

###### Inherited from

[`RootHandle`](#roothandle-1).[`view`](#view-3)

##### signal()

> **signal**(`msg`): `void`

###### Parameters

###### msg

[`RootSignal`](#rootsignal)

###### Returns

`void`

###### Inherited from

[`RootHandle`](#roothandle-1).[`signal`](#signal-25)

##### abort()

> **abort**(`reason?`): `void`

###### Parameters

###### reason?

`string`

###### Returns

`void`

###### Inherited from

[`RootHandle`](#roothandle-1).[`abort`](#abort-1)

##### deliver()

> **deliver**(`msg`): `boolean`

Optional for structural compatibility with existing view/signal/abort wrappers. Handles
minted by `createRootHandle` implement the required form in `SteerableRootHandle`.

###### Parameters

###### msg

`unknown`

###### Returns

`boolean`

###### Overrides

[`RootHandle`](#roothandle-1).[`deliver`](#deliver-3)

***

### WidenGate

The progressive-widening gate (MCTS-PW). Decides whether a settled child is
`promising` enough to spawn another under the remaining pool. DEFAULTS TO FLAT
(`shouldWiden` always false) so a gate run never widens and the selector≠judge
firewall conflict (R2) stays dormant. When widening IS enabled, `promising` MUST be
derived from TRACE findings (`analyses`), never raw `verdict` — or the gate carries
an explicit, argued `judgeExempt: true` (the documented escape hatch, off by default).

#### Type Parameters

##### Out

`Out`

#### Properties

##### judgeExempt?

> `readonly` `optional` **judgeExempt?**: `boolean`

When true, widening may read `verdict` directly (collides with the steer firewall —
 must be explicitly argued per cell, never defaulted on).

#### Methods

##### shouldWiden()

> **shouldWiden**(`settled`, `budget`): `boolean`

Default impl returns false for every settlement (flat — never widens).

###### Parameters

###### settled

[`Settled`](index.md#settled)\<`Out`\>

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

`boolean`

***

### UntrackedCopyStats

#### Properties

##### copied

> **copied**: `number`

Files + symlinks that landed in the clone.

##### bytes

> **bytes**: `number`

Total regular-file bytes enumerated (pre-copy, so the size warning fires first).

***

### CopyOptions

#### Properties

##### warnBytes?

> `optional` **warnBytes?**: `number`

##### log?

> `optional` **log?**: (`message`) => `void`

###### Parameters

###### message

`string`

###### Returns

`void`

***

### WaitProbeRegistry

Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so
 the SAME registry a fresh run used is what a resumed run re-resolves against.

#### Methods

##### resolve()

> **resolve**(`name`): [`WaitProbe`](#waitprobe) \| `undefined`

###### Parameters

###### name

`string`

###### Returns

[`WaitProbe`](#waitprobe) \| `undefined`

***

### WaitOutcome

The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the
 caller branches on: `'fired'` = the timer reached its instant or the predicate flipped;
 `'timeout'` = a bounded poll gave up. A timeout is a first-class ANSWER, not a failure — a
 wait only settles `down` when it is cancelled or aborted.

#### Properties

##### waitOutcome

> `readonly` **waitOutcome**: `true`

Tag for `isWaitOutcome` — a wait outcome arrives on the same cursor as worker outputs.

##### kind

> `readonly` **kind**: `"poll"` \| `"timer"`

##### settled

> `readonly` **settled**: `"timeout"` \| `"fired"`

##### label

> `readonly` **label**: `string`

##### untilMs?

> `readonly` `optional` **untilMs?**: `number`

The absolute instant this wait was armed for (timer `untilMs` / poll `timeoutAtMs`); absent
 for an unbounded poll.

##### armedAt

> `readonly` **armedAt**: `number`

Epoch ms the wait was FIRST armed — preserved across a resume, so `wokenAt - armedAt` is
 the true end-to-end wait even when it spanned several processes.

##### wokenAt

> `readonly` **wokenAt**: `number`

##### polls

> `readonly` **polls**: `number`

Predicate checks performed in the process that settled it (a resume restarts this count).

##### probeErrors

> `readonly` **probeErrors**: `number`

Probe checks that threw (counted, not fatal).

##### resumed

> `readonly` **resumed**: `boolean`

True when a later process re-armed this wait from the journal instead of creating it.

***

### PendingWait

A wait recorded in the journal that never woke — what a resumed run re-arms.

#### Properties

##### id

> `readonly` **id**: `string`

##### label

> `readonly` **label**: `string`

##### spec

> `readonly` **spec**: [`WaitSpec`](#waitspec)

##### armedAt

> `readonly` **armedAt**: `number`

The ORIGINAL arm instant. A re-armed wait keeps it, so its deadline never slides.

##### ordinal

> `readonly` **ordinal**: `number`

The wait ordinal in its parent scope, so a resumed scope continues past it.

***

### WorkerEvidenceInput

#### Properties

##### passed

> `readonly` **passed**: `boolean`

##### testPassed

> `readonly` **testPassed**: `boolean`

##### typecheckPassed

> `readonly` **typecheckPassed**: `boolean`

##### testOutput

> `readonly` **testOutput**: `string`

Combined stdout+stderr of the verify/test command (already backend-capped).

##### typecheckOutput

> `readonly` **typecheckOutput**: `string`

##### patch

> `readonly` **patch**: `string`

##### reviewerNotes?

> `readonly` `optional` **reviewerNotes?**: `string`

The worker's own closing commentary, when the backend surfaces one.

***

### WorkerTraceSeamCarrier

What the two readers below need off an `ExecutorContext` — its seam bag, and nothing else.
Structural (not an `ExecutorContext` import) so this module stays free of the keystone type
surface, and exported because it is part of a public signature.

#### Properties

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

***

### WorktreeCliExecutorOptions

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path to the git checkout the worktree is cut from.

##### profile

> **profile**: `AgentProfile`

**`Experimental`**

The supervisor-authored prompt/model plus materializable structural resources.
`model.default` selects the one-shot model. Routing-only model hints, placement concerns,
provider extensions, and `resources.failOnError` fail before execution because this path
cannot honor them. Harness-specific values the materializer cannot preserve also fail closed.

##### taskPrompt?

> `optional` **taskPrompt?**: `string`

**`Experimental`**

Default instruction for direct `execute(undefined, signal)` calls. An execution-time task
 is authoritative. Omit when the caller always supplies the task to `execute`.

##### runId?

> `optional` **runId?**: `string`

**`Experimental`**

Unique id for the worktree path + branch. Defaults to a fresh UUID.

##### baseRef?

> `optional` **baseRef?**: `string`

**`Experimental`**

Override the base ref the worktree is cut from (default `HEAD`).

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default).

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

**`Experimental`**

Run Codex with an ephemeral session, isolated config/instructions, network disabled, and
 JSONL usage capture. Requires `profile.harness: 'codex'`; metered by default.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

**`Experimental`**

Absolute host paths denied to reproducible Codex (for benchmark answer copies, credentials,
 or other task-specific ambient state).

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`).

##### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min.

##### checkOutputCap?

> `optional` **checkOutputCap?**: `number`

**`Experimental`**

Cap on each check's captured output. Default 16k.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

**`Experimental`**

Test seam — inject a git runner so unit tests drive the worktree helpers without git.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

**`Experimental`**

Test seam — inject the harness runner so unit tests script a `LocalHarnessResult`.

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

> `optional` **runCommand?**: [`WorktreeCheckRunner`](index.md#worktreecheckrunner)

**`Experimental`**

Test seam — inject the verification-command runner so unit tests script test/typecheck
 outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree.

##### budgetExempt?

> `optional` **budgetExempt?**: `boolean`

**`Experimental`**

Exclude this leaf's spend from accounting. Defaults to `true` for ordinary CLI runs and
`false` for `codexReproducible`, which captures real token usage. A metered custom runner must
likewise return `LocalHarnessResult.usage`.

***

### AuthoredHarness

**`Experimental`**

One authored profile in a worktree fanout. Its exact `harness` field chooses the
local CLI; the supervisor authors the complete profile per sub-task.

#### Properties

##### name

> **name**: `string`

**`Experimental`**

A short label for the worktree branch + trace node.

##### profile

> **profile**: `AgentProfile`

**`Experimental`**

The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5).

##### budgetExempt?

> `optional` **budgetExempt?**: `boolean`

**`Experimental`**

Require measured usage from this leaf. Budgeted supervision refuses the default unmetered
 local-CLI mode; set false only when the selected runner actually returns token usage.

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

**`Experimental`**

Run Codex through its measured, isolated JSONL path. This implies `budgetExempt: false`.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

**`Experimental`**

Host paths denied to a reproducible Codex leaf.

##### runId?

> `optional` **runId?**: `string`

**`Experimental`**

Per-harness model/runId/baseRef overrides flow through the profile + these.

##### baseRef?

> `optional` **baseRef?**: `string`

**`Experimental`**

***

### WorktreeFanoutOptions

**`Experimental`**

#### Extends

- [`PatchDeliverableOptions`](#patchdeliverableoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`maxDiffLines`](#maxdifflines)

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`forbiddenPaths`](#forbiddenpaths)

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`require`](#require)

##### repoRoot

> **repoRoot**: `string`

**`Experimental`**

Absolute path to the git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

**`Experimental`**

The per-task instruction handed to every harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](#authoredharness)[]

**`Experimental`**

The authored harness profiles — one fanout item (and one worktree-CLI leaf) each.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<[`WorktreeHarnessResult`](#worktreeharnessresult)\>

**`Experimental`**

The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
`DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.

##### testCmd?

> `optional` **testCmd?**: `string`

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

**`Experimental`**

Wall-clock cap per harness subprocess (ms).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](#winnerstrategy)

**`Experimental`**

Winner-selection strategy. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

**`Experimental`**

Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
 whole fanout runs offline). Production callers leave these unset.

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

> `optional` **runCommand?**: [`WorktreeCheckRunner`](index.md#worktreecheckrunner)

**`Experimental`**

***

### SurfaceDiff

One watched surface whose settled state differs from what was mounted (or from absence).

- `modified` — the surface exists with different bytes (`settledSha256`/`settledBytes` present).
- `removed` — the surface no longer exists at its mounted path.
- `created` — a watched path that was never mounted now exists (`settledSha256`/`settledBytes`
  present, no `mountedSha256`) — the shape a harness's new memory/skill file takes.
- `unreadable` — the read seam failed for a reason other than absence; `error` carries the
  diagnostic. Reported rather than dropped so a permissions or transport failure cannot
  masquerade as "nothing changed".

#### Properties

##### path

> **path**: `string`

The mounted/watched path, exactly as recorded.

##### status

> **status**: `"modified"` \| `"removed"` \| `"created"` \| `"unreadable"`

##### mountedSha256?

> `optional` **mountedSha256?**: `string`

Hex SHA-256 of the bytes that were mounted (from the manifest). Absent for `created`.

##### source

> **source**: `string`

Free-form origin: the manifest entry's `source`, or the watch entry's `source`.

##### settledSha256?

> `optional` **settledSha256?**: `string`

Hex SHA-256 of the settled bytes. Present for `modified` and `created`.

##### settledBytes?

> `optional` **settledBytes?**: `number`

Size of the settled bytes. Present for `modified` and `created`.

##### error?

> `optional` **error?**: `string`

The read seam's diagnostic. Present only for `unreadable`.

***

### WatchedSurface

A path to check at settle that was NOT necessarily mounted — where a harness is known to write
 self-authored surfaces (a memory dir's files, a refinement log). A watched path that was also
 mounted compares against its mount; one that wasn't reports `created` if it now exists.
 `created` is an inference from the mount manifest, not a proof of authorship: a file the box
 IMAGE shipped at a never-mounted path also reports `created`. Watch paths known absent at run
 start (or enumerate the tree at start AND settle and watch the difference) to make the label
 mean what it says.

#### Properties

##### path

> **path**: `string`

##### source?

> `optional` **source?**: `string`

Origin label carried onto the diff (default `'watched'`).

***

### HarvestSurfaceDiffsOptions

Inputs to [harvestSurfaceDiffs](#harvestsurfacediffs): the run's mount manifest, the read seam, and optional
 watch paths for surfaces the agent may have created.

#### Properties

##### mounts

> **mounts**: readonly [`MountManifestEntry`](#mountmanifestentry)[]

The run's mount manifest (`RunProvenance.mounts`). Entries sharing a path are collapsed to the
 LAST entry — the bytes the agent actually saw at start.

##### read

> **read**: [`SurfaceReader`](#surfacereader)

How to read a mounted path's current bytes.

##### watch?

> `optional` **watch?**: readonly [`WatchedSurface`](#watchedsurface)[]

Additional paths to check that may not have been mounted (see [WatchedSurface](#watchedsurface)). The
 caller enumerates them (it knows the harness's state layout — e.g. via the box's file tree);
 the harvest stays layout-agnostic.

***

### SurfaceReadBox

The minimal box surface the box-backed reader needs — structurally typed so the real
 `@tangle-network/sandbox` box and a test double both satisfy it, no SDK import.

#### Properties

##### fs

> **fs**: `object`

###### read()

> **read**(`path`): `Promise`\<`string`\>

###### Parameters

###### path

`string`

###### Returns

`Promise`\<`string`\>

***

### BoxSurfaceReaderOptions

Retry and cancellation controls for [boxSurfaceReader](#boxsurfacereader).

#### Properties

##### attempts?

> `optional` **attempts?**: `number`

Read attempts per path before settling on a failed outcome. The data plane can transiently
 404 a just-written file (the same blip `openSandboxRun`'s deliverable read retries for), and a
 first-attempt 404 taken at face value turns a fresh self-edit into a false `removed`/dropped
 `created`. Default 3.

##### retryDelayMs?

> `optional` **retryDelayMs?**: `number`

Linear backoff base between attempts (delay = base × attempt). Default 250.

##### signal?

> `optional` **signal?**: `AbortSignal`

Cuts the retry waits short when the run is abandoned. The reader still returns a typed
 outcome — the harvest reports what it managed to read rather than rejecting.

***

### CreateTangleSandboxExactProcessProviderOptions

#### Properties

##### name?

> `optional` **name?**: `string`

***

### ToolLoopToolCall

One provider-neutral tool request emitted by a tool-loop model.

#### Properties

##### id

> **id**: `string`

##### name

> **name**: `string`

##### arguments

> **arguments**: `string`

Raw JSON arguments emitted by the model.

***

### ToolLoopCallContext

Runtime-owned identity and cancellation for one logical inference call. The wrapper is frozen
before dispatch; a transport may observe the signal but cannot replace the authority it names.

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

##### callId

> `readonly` **callId**: `string`

##### correlationId

> `readonly` **correlationId**: `string`

***

### ToolLoopCompaction

Self-compaction — bound the loop's OWN context window the way a fresh-respawn (dumb-Ralph) loop
 does, but in place. A stateless chat API re-sends the WHOLE running conversation every turn, so an
 agent that accumulates dozens of turns of tool results re-bills its entire transcript on every
 inference — the context-overflow-one-level-up that the conserved budget pool cannot fix. With
 compaction set, once the conversation exceeds `thresholdTokens` the accumulated middle (every prior
 assistant turn + tool result) is distilled into ONE compact progress note and the conversation is
 reset to `[...head, digest]`: the preserved head (system + the original task) survives, the stale
 turn-by-turn history does not. The model keeps deciding; it stops re-billing the whole transcript.
 Fires at a CLEAN turn boundary (after a turn's tool results are folded in, before the next
 inference) so it never orphans an assistant `tool_calls` from its `tool` replies.

#### Properties

##### thresholdTokens

> `readonly` **thresholdTokens**: `number`

Compact once the estimated token count of the conversation exceeds this.

##### distill

> `readonly` **distill**: (`messages`) => `string` \| `Promise`\<`string`\>

Distill the conversation into a compact progress note that REPLACES the middle. Receives the
 full conversation (so it can summarize everything done so far); returns the digest string.

###### Parameters

###### messages

readonly [`ToolLoopMessageRecord`](#toolloopmessagerecord)[]

###### Returns

`string` \| `Promise`\<`string`\>

##### preserveHead?

> `readonly` `optional` **preserveHead?**: `number`

Leading messages preserved verbatim (system + the original task). Default 2.

##### estimateTokens?

> `readonly` `optional` **estimateTokens?**: (`messages`) => `number`

Token estimator over the conversation. Default ≈ chars/4 (incl. tool-call arguments).

###### Parameters

###### messages

readonly [`ToolLoopMessageRecord`](#toolloopmessagerecord)[]

###### Returns

`number`

##### onCompact?

> `readonly` `optional` **onCompact?**: (`info`) => `void`

Notified each time a compaction fires — for observability/metering.

###### Parameters

###### info

###### turn

`number`

###### beforeTokens

`number`

###### afterTokens

`number`

###### Returns

`void`

***

### ValidationCtx

**`Stable`**

#### Properties

##### iteration

> **iteration**: `number`

Iteration index this output came from (0-based).

##### box?

> `optional` **box?**: `SandboxInstance`

Live sandbox for this iteration. Validators that need execution-grounded
evidence can inspect files or run commands here instead of forcing callers
to bypass the loop kernel with raw Sandbox SDK orchestration.

##### signal

> **signal**: `AbortSignal`

Cooperative cancellation channel.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Optional trace emitter. When set, validator implementations that make
LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.

***

### Validator

**`Stable`**

#### Type Parameters

##### Output

`Output`

##### Verdict

`Verdict` = `DefaultVerdict`

#### Methods

##### validate()

> **validate**(`output`, `ctx`): `Promise`\<`Verdict`\>

###### Parameters

###### output

`Output`

###### ctx

[`ValidationCtx`](#validationctx)

###### Returns

`Promise`\<`Verdict`\>

***

### AgentRunSpec

**`Stable`**

Sandbox-SDK-shaped agent specification.

The kernel uses `profile` to instantiate a sandbox per iteration, formats
`task` into a prompt via `taskToPrompt`, and merges `sandboxOverrides` into
the `CreateSandboxOptions` it passes to `client.create`. Heterogeneous
fanout supplies multiple `AgentRunSpec`s and the kernel round-robins
through them when the driver plans N tasks.

#### Type Parameters

##### Task

`Task`

#### Properties

##### profile

> **profile**: `AgentProfile`

Sandbox SDK profile — what kind of agent runs the task.

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

Task → prompt formatter. Pure and deterministic.

###### Parameters

###### task

`Task`

###### Returns

`string`

##### prepareBox?

> `optional` **prepareBox?**: (`box`, `ctx`) => `void` \| `Promise`\<`void`\>

Optional pre-prompt sandbox provisioner. Runs after the sandbox is acquired
and before the first prompt is streamed into that box. Use this for
domain-agnostic setup such as repo snapshots, benchmark fixtures, policy
files, or seed datasets. The hook is part of the runtime surface so loop
consumers do not hand-roll Sandbox SDK orchestration just to prepare a
workspace before the agent sees it.

`ctx.recordMount` records what was placed into the box so the run carries a
provenance manifest (`LoopResult.provenance.mounts`). It is optional and
provenance-only — the kernel never reads box contents and attaches no
meaning to the entries; not calling it simply leaves the manifest empty.

###### Parameters

###### box

`SandboxInstance`

###### ctx

###### signal

`AbortSignal`

###### recordMount

[`MountRecorder`](#mountrecorder)

###### Returns

`void` \| `Promise`\<`void`\>

##### name?

> `optional` **name?**: `string`

Per-spec stable name. Surfaced in trace events and the default winner
selector tiebreak. Falls back to `profile.name ?? 'agent'`.

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
the kernel's defaults. `backend.profile` is set to `profile` by the
kernel and cannot be overridden here — use `profile` itself for that.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

***

### OutputAdapter

**`Stable`**

Stream of `SandboxEvent`s → typed `Output`.

Adapters are pure functions over the already-collected event array; they
do not receive the live AsyncIterable so they can be replayed against
persisted streams during tests / replays.

#### Type Parameters

##### Output

`Output`

#### Methods

##### parse()

> **parse**(`events`): `Output`

###### Parameters

###### events

`SandboxEvent`[]

###### Returns

`Output`

***

### LoopTokenUsage

LLM token usage. Structurally maps into agent-eval's paid-call receipt so a
campaign dispatch settles real usage instead of appearing as a stub.

#### Properties

##### input

> **input**: `number`

Total provider-reported prompt tokens. Budgets always use this total.

##### output

> **output**: `number`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

False when the subtotal is incomplete.

##### freshInput?

> `optional` **freshInput?**: `number`

Prompt tokens newly processed by the provider, when every prompt class is known.

##### cacheRead?

> `optional` **cacheRead?**: `number`

Prompt tokens the provider reported serving from its cache.

##### cacheWrite?

> `optional` **cacheWrite?**: `number`

Prompt tokens the provider reported writing to its cache.

##### cacheBreakdownKnown?

> `optional` **cacheBreakdownKnown?**: `false`

False when any positive-input observation omitted or contradicted the prompt-cache split.
This marker is sticky during aggregation. Missing cache fields must never become zero.

***

### MountManifestEntry

**`Stable`**

One mounted resource recorded during box preparation — a pure provenance
record of what the caller placed into a box before the agent saw it. The
kernel never reads box contents itself (it does not know what was mounted);
the caller, which owns the bytes inside `prepareBox`, supplies each entry via
`recordMount`. Carries no domain semantics — just where the resource landed,
its content fingerprint, its size, and where it came from — so a run is
auditable after the fact ("what exactly was this agent given?").

#### Properties

##### path

> **path**: `string`

Destination path inside the box where the resource was placed.

##### sha256

> **sha256**: `string`

Hex SHA-256 of the mounted bytes. The caller computes it from the bytes
 it wrote — the kernel does not hash box contents.

##### bytes

> **bytes**: `number`

Size of the mounted resource in bytes.

##### source

> **source**: `string`

Free-form origin of the resource (e.g. a repo ref, a corpus id, a local
 path, a URL). Provenance only — the kernel attaches no meaning to it.

***

### SelectionReceipt

**`Stable`**

A record of one candidate-selection decision: which iteration the selector
picked (or rejected) and why. Pure audit trail of the SELECTOR role — it
carries the selector's identity, the candidate's score, and an optional
human-readable reason, with no domain semantics. The kernel emits one receipt
per scored candidate at finalize so a run answers "why did THIS one win?".

#### Properties

##### candidateIndex

> **candidateIndex**: `number`

Iteration index this receipt is about.

##### selected

> **selected**: `boolean`

True for the iteration the selector chose as winner; false otherwise.

##### score?

> `optional` **score?**: `number`

The candidate's verdict score, when it has one.

##### reason?

> `optional` **reason?**: `string`

Why this candidate was (or was not) selected, when the selector states it.

##### selector

> **selector**: `"default"` \| `"driver"` \| `"caller"`

Identity of the selector that produced this receipt — `'caller'` (an
 explicit `selectWinner`), `'driver'` (a driver-authored winner), or
 `'default'` (the kernel's best-valid-score argmax).

***

### RunProvenance

**`Stable`**

Domain-free run provenance: a manifest of what was mounted into the run's
boxes and the receipts for how the winner was selected. Surfaced on
`LoopResult` purely for run auditability — nothing in the kernel branches on
it. Empty arrays when the caller recorded no mounts and there was no
candidate to select.

#### Properties

##### mounts

> **mounts**: [`MountManifestEntry`](#mountmanifestentry)[]

Every resource recorded via `prepareBox`'s `recordMount`, in record order.

##### selectionReceipts

> **selectionReceipts**: [`SelectionReceipt`](#selectionreceipt)[]

One receipt per scored candidate at finalize, in iteration order.

***

### Iteration

**`Stable`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### index

> **index**: `number`

0-based iteration index assigned by the kernel.

##### task

> **task**: `Task`

##### agentRunName

> **agentRunName**: `string`

Stable name of the `AgentRunSpec` that produced this iteration.

##### output?

> `optional` **output?**: `Output`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

##### error?

> `optional` **error?**: `Error`

##### sandboxOutcome?

> `optional` **sandboxOutcome?**: `AgentRunOutcome`

Public Sandbox outcome settled after the complete event stream.

##### events

> **events**: `SandboxEvent`[]

Raw sandbox event stream collected for this iteration. Present on a failed iteration too,
 holding the events received before the failure — including the one that reported it.

##### startedAt

> **startedAt**: `number`

##### endedAt

> **endedAt**: `number`

##### costUsd

> **costUsd**: `number`

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

False when `costUsd` is only the observed subtotal, not a complete bill.

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Local/catalog estimates remain separate from billed spend.

##### promptCache?

> `optional` **promptCache?**: `Record`\<`string`, `string` \| `number`\>

Provider-reported prompt-cache fields; absent fields remain unknown.

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Summed LLM token usage across every `llm_call` event in this iteration.

***

### LoopPlanDescription

**`Stable`**

Driver-supplied description of the just-planned move.

#### Properties

##### kind

> **kind**: `string`

Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`.

##### rationale?

> `optional` **rationale?**: `string`

Why the driver chose this move (the agent's rationale), when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Iteration index this round branches FROM, when the driver declares it.
Overrides the kernel's inferred branch point — lets a planner that
branches off a specific (non-winner) iteration emit faithful edge lineage.
Omit to keep the inferred (best-valid / latest) branch point.

***

### LoopWinner

**`Stable`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### task

> **task**: `Task`

##### output

> **output**: `Output`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

##### iterationIndex

> **iterationIndex**: `number`

##### agentRunName

> **agentRunName**: `string`

***

### SandboxClient

**`Stable`**

Minimal sandbox client surface the kernel calls. Satisfied structurally by
`new Sandbox({ apiKey, baseUrl })` — declared as a structural type so
tests can pass a stub without instantiating the SDK.

`describePlacement` is optional. When present, the kernel calls it after
each `create()` so the `loop.iteration.dispatch` trace event carries fleet
coordinates (fleetId + machineId) instead of just the sibling sandboxId.
Fleet-aware adapters set this; the raw `Sandbox` SDK class does not, and
the kernel falls back to `{ placement: 'sibling', sandboxId: box.id }`.

#### Methods

##### create()

> **create**(`options?`, `requestOptions?`): `Promise`\<`SandboxInstance`\>

###### Parameters

###### options?

`CreateSandboxOptions`

###### requestOptions?

`CreateRequestOptions`

###### Returns

`Promise`\<`SandboxInstance`\>

##### describePlacement()?

> `optional` **describePlacement**(`box`): [`LoopSandboxPlacement`](#loopsandboxplacement)

###### Parameters

###### box

`SandboxInstance`

###### Returns

[`LoopSandboxPlacement`](#loopsandboxplacement)

##### criuStatus()?

> `optional` **criuStatus**(): `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

**`Experimental`**

Optional legacy CRIU capability probe. When present and it resolves
`{ available: true }`, the loop's `lineage.fork` seam may checkpoint and fork
a parent box when live `branch(count)` is unavailable. Current Sandbox boxes
expose live branching directly. The kernel reads this ONLY through the
capability probe — it never branches on backend kind.
The raw `Sandbox` SDK class satisfies it; the loop's test fakes omit it
(⇒ `canFork = false`).

###### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

***

### LoopLineageOptions

**`Experimental`**

Opt-in box-lineage controls for `runAgentRounds`. Default OFF — with both flags
unset the kernel's per-iteration behavior is byte-identical to acquiring a
fresh box, streaming once, and tearing it down. The independence of N fresh
boxes (e.g. `random@k`) is a compute-control invariant; these flags must
never apply to it. Enable them ONLY on a steered loop (refine / planner-driven
fanout) where reusing the parent's context is intended.

Live-box footprint: the lineage keeps every box it starts or forks alive
across rounds so a later round can descend from it, and tears them down at
loop end. When the driver's branch point is kernel-inferred (no
`describePlan` — refine, fanout-vote), the kernel prunes boxes no future
round can reach after each round, so the live set tracks the active frontier.
When the driver authors its own branch point (`describePlan().parentIndex`),
it may descend from any prior
iteration, so no box is pruned and the live-box count rises to the total
iterations across all rounds. Size `forkFanout` runs accordingly. Live branch
children use copy-on-write, but each is still a live box until loop end.

#### Properties

##### sessionContinuity?

> `optional` **sessionContinuity?**: `boolean`

**`Experimental`**

When true, a refine round (1 planned task) descending from a prior round
CONTINUES the parent iteration's session on the SAME box
(`streamPrompt({ sessionId })`) instead of acquiring a fresh box and
re-injecting prior context as prompt text. Round 0 (no parent) always
starts fresh. Usable on any single-task path, not just the refine driver.

Requires a platform that honors a client-supplied `sessionId`. The lineage
mints the id and `continue` asserts the session is still live
(`box.session(id).status()`), failing loud if the platform dropped it — so a
non-honoring platform errors instead of silently running contextless turns.
Verify continuity against the live platform before enabling: the assertion
proves the session EXISTS server-side, not that prior turns replay into it.

##### forkFanout?

> `optional` **forkFanout?**: `boolean`

**`Experimental`**

When true, a fanout round (N planned tasks) descending from a prior round
branches the parent's live box so all N branches inherit its context prefix.
If live branching is unavailable, the lineage uses legacy CRIU when its
probe is positive. Otherwise it degrades to N fresh boxes with no prefix.
Round 0 always starts fresh. NEVER set this for a `random@k` control arm —
forking would couple the independent samples.

A real fork inherits the parent's IMAGE/PROFILE: per-branch `AgentRunSpec`
profiles are honored only on the degraded fresh-box path, so a
heterogeneous-profile fanout silently homogenizes to the parent's profile
when fork is available. Use this for same-profile branching; for
different-per-branch profiles use the unforked fanout path.

##### streaming?

> `optional` **streaming?**: `"sse"` \| `"poll"`

**`Experimental`**

Per-turn sandbox streaming mode. Default `'sse'` (live `streamPrompt` —
low-latency, full per-token trace; best for interactive chat). `'poll'`
fire-and-detaches via `dispatchPrompt` and awaits the terminal result by
status-polling, so a long, quiet in-box turn (clone + build + test) never
holds a live stream a proxy idle-timeout can drop mid-execution. Lower trace
fidelity (one terminal event), so it is opt-in — intended for BATCH eval
runs, which don't need live streaming and were losing long turns to the
idle-drop. Applies to the default fresh-box path too, not only when
`sessionContinuity`/`forkFanout` are on.

***

### LoopSandboxPlacement

**`Stable`**

#### Extended by

- [`InProcessExecutorDescribePlacement`](mcp.md#inprocessexecutordescribeplacement)

#### Properties

##### kind

> **kind**: `"sibling"` \| `"fleet"`

##### sandboxId?

> `optional` **sandboxId?**: `string`

##### fleetId?

> `optional` **fleetId?**: `string`

##### machineId?

> `optional` **machineId?**: `string`

***

### LoopTraceEmitter

**`Stable`**

#### Methods

##### emit()

> **emit**(`event`): `void` \| `Promise`\<`void`\>

###### Parameters

###### event

[`LoopTraceEvent`](#looptraceevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### LoopStartedPayload

**`Stable`**

#### Properties

##### driver

> **driver**: `string`

##### agentRunNames

> **agentRunNames**: `string`[]

##### maxIterations

> **maxIterations**: `number`

##### maxConcurrency

> **maxConcurrency**: `number`

***

### LoopPlanPayload

**`Stable`**

Emitted once per `plan()` round, immediately after the driver plans. Carries
the topology move so a viewer renders WHAT the agent decided + WHY, not just
the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).

#### Properties

##### roundIndex

> **roundIndex**: `number`

0-based plan round (one per `plan()` call).

##### plannedCount

> **plannedCount**: `number`

Tasks the driver issued this round.

##### moveKind

> **moveKind**: `string`

Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc.

##### rationale?

> `optional` **rationale?**: `string`

Driver rationale for the move, when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Iteration index this round branched FROM (the edge source). `undefined`
for round 0 (root). Kernel-inferred branch point — the best-valid (else
latest) iteration so far — unless a driver later declares it explicitly.

##### childIndices

> **childIndices**: `number`[]

Iteration indices this round dispatched (the edge targets).

***

### LoopIterationStartedPayload

**`Stable`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

##### agentRunName

> **agentRunName**: `string`

##### taskHash

> **taskHash**: `string`

##### groupId?

> `optional` **groupId?**: `number`

Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationDispatchPayload

**`Stable`**

Where the iteration's worker was placed. `sibling` = a fresh sandbox the
kernel created via `sandboxClient.create`. `fleet` = an existing machine in
a shared-workspace fleet — workers see the caller's filesystem and any diff
they write lands on it directly.

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

##### agentRunName

> **agentRunName**: `string`

##### placement

> **placement**: `"sibling"` \| `"fleet"`

##### sandboxId?

> `optional` **sandboxId?**: `string`

Set on every placement. Lets analyst loops correlate per-iteration logs.

##### fleetId?

> `optional` **fleetId?**: `string`

Set only when `placement === 'fleet'`.

##### machineId?

> `optional` **machineId?**: `string`

Set only when `placement === 'fleet'`.

##### groupId?

> `optional` **groupId?**: `number`

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationEndedPayload

**`Stable`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

##### agentRunName

> **agentRunName**: `string`

##### outputHash?

> `optional` **outputHash?**: `string`

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

##### error?

> `optional` **error?**: `string`

##### costUsd

> **costUsd**: `number`

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

##### durationMs

> **durationMs**: `number`

##### tokenUsage?

> `optional` **tokenUsage?**: [`LoopTokenUsage`](#looptokenusage)

Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
 branch span. Omitted when no `llm_call` events carried token counts.

##### groupId?

> `optional` **groupId?**: `number`

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Iteration this one was planned from; `undefined` ⇒ root.

##### outputPreview?

> `optional` **outputPreview?**: `string`

Truncated string preview of the parsed output — for a viewer's drawer.
 Bounded to ~280 chars; never the full payload.

***

### LoopDecisionPayload

**`Stable`**

#### Properties

##### decision

> **decision**: `string`

##### historyLength

> **historyLength**: `number`

***

### LoopEndedPayload

**`Stable`**

#### Properties

##### winnerIterationIndex?

> `optional` **winnerIterationIndex?**: `number`

##### totalCostUsd

> **totalCostUsd**: `number`

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

##### durationMs

> **durationMs**: `number`

##### iterations

> **iterations**: `number`

***

### LoopTeardownFailedPayload

**`Stable`**

Emitted when a box's `delete()` throws or times out during teardown — the
 loop swallows the failure (platform reaps on expiry) but surfaces it here so
 a real leak (e.g. mid-loop auth expiry) is observable.

#### Properties

##### sandboxId?

> `optional` **sandboxId?**: `string`

##### reason

> **reason**: `string`

`'timeout'` or the delete error message.

***

### ExecCtx

**`Stable`**

Execution context for `runAgentRounds`: the sandbox client the kernel creates boxes through, plus optional runtime hooks.

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-5)

Sandbox SDK client — the kernel calls `.create()` per iteration.

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Optional runtime hooks. Execution-scoped; never part of `AgentProfile`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Optional trace emitter. When set, the kernel emits `loop.*` events.

##### onSandboxEvent?

> `optional` **onSandboxEvent?**: (`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>

**`Experimental`**

Optional per-event tee. When set, the kernel forwards EVERY raw event from
each iteration's `streamPrompt` stream as it arrives, so a host can stream
the agent's live output (tokens, tool calls) token-by-token. The observer
receives a defensive copy of each event — mutating it cannot affect the
run's own cost accounting or output parsing. Called synchronously in the hot
stream loop and never awaited, so a slow or never-settling observer cannot
stall the stream; keep it cheap. An async observer is fire-and-forget: its
promise is not awaited, so events carry no ordering or backpressure
guarantees (the next event may be observed before a prior async observer
settles) — use it for side-effect telemetry, not sequential processing.
Both a synchronous throw and a rejected returned promise are caught +
ignored so the observer can never break the run — but prefer not to depend
on that.

###### Parameters

###### event

`SandboxEvent`

###### meta

###### iterationIndex

`number`

###### agentRunName

`string`

###### Returns

`void` \| `PromiseLike`\<`void`\>

##### runHandle?

> `optional` **runHandle?**: [`RuntimeRunHandle`](index.md#runtimerunhandle)

Optional production-run handle. When set, every synthesized `llm_call`
the kernel infers from a sandbox event stream is forwarded via
`runHandle.observe` so per-run cost aggregates pick up loop spend.

##### signal?

> `optional` **signal?**: `AbortSignal`

Cooperative cancellation signal.

##### traceId?

> `optional` **traceId?**: `string`

Trace id for OTEL correlation. When set alongside `traceEmitter`, the
exporter uses this as the parent trace for all emitted spans. Typically
inherited from TRACE_ID env var in MCP subprocess mode.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Parent span id for OTEL correlation. Loop events become children of
this span. Typically inherited from PARENT_SPAN_ID env var.

***

### VerifierEnvironmentOptions

#### Properties

##### name

> **name**: `string`

##### extraTools?

> `optional` **extraTools?**: [`AgenticTool`](#agentictool)[]

Extra domain tools (read-only helpers: calculator, retrieval, style lookup).

#### Methods

##### check()

> **check**(`task`, `answer`): [`SurfaceScore`](#surfacescore) \| `Promise`\<[`SurfaceScore`](#surfacescore)\>

The deployable check over a submitted answer. Graded via passes/total.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### answer

`string`

###### Returns

[`SurfaceScore`](#surfacescore) \| `Promise`\<[`SurfaceScore`](#surfacescore)\>

##### callExtra()?

> `optional` **callExtra**(`task`, `name`, `args`): `string` \| `Promise`\<`string`\>

Executes the extra tools. Required when `extraTools` is set.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`string` \| `Promise`\<`string`\>

***

### WaterfallSpan

#### Properties

##### id

> **id**: `string`

##### label

> **label**: `string`

The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name.

##### runId

> **runId**: `string`

##### parentId?

> `optional` **parentId?**: `string`

##### startMs

> **startMs**: `number`

##### endMs?

> `optional` **endMs?**: `number`

##### status

> **status**: `"running"` \| `"done"` \| `"down"`

##### usd

> **usd**: `number`

##### tokens

> **tokens**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

##### score?

> `optional` **score?**: `number`

***

### WaterfallReport

#### Properties

##### spans

> **spans**: [`WaterfallSpan`](#waterfallspan)[]

##### totalMs

> **totalMs**: `number`

Wall-clock of the observed window (first spawn → last settle).

##### totalUsd

> **totalUsd**: `number`

##### totalTokens

> **totalTokens**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

##### byKind

> **byKind**: `Record`\<`string`, \{ `count`: `number`; `ms`: `number`; `usd`: `number`; `tokens`: \{ `input`: `number`; `output`: `number`; \}; \}\>

Rollup by label prefix (the part before ':') — shots vs analysts vs anything else.

***

### WaterfallCollector

#### Properties

##### hooks

> **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks.

#### Methods

##### report()

> **report**(): [`WaterfallReport`](#waterfallreport)

###### Returns

[`WaterfallReport`](#waterfallreport)

##### render()

> **render**(`opts?`): `string`

The text waterfall — one row per span, bars scaled to the observed window.

###### Parameters

###### opts?

###### width?

`number`

###### maxRows?

`number`

###### Returns

`string`

##### reset()

> **reset**(): `void`

###### Returns

`void`

***

### Workspace

#### Properties

##### ref

> `readonly` **ref**: `string`

#### Methods

##### materialize()

> **materialize**(`dir`): `Promise`\<`void`\>

###### Parameters

###### dir

`string`

###### Returns

`Promise`\<`void`\>

##### commit()

> **commit**(`dir`, `message`): `Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

###### Parameters

###### dir

`string`

###### message

`string`

###### Returns

`Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

##### head()

> **head**(): `Promise`\<`string`\>

###### Returns

`Promise`\<`string`\>

***

### GitWorkspaceOptions

#### Properties

##### ref

> `readonly` **ref**: `string`

##### shell?

> `readonly` `optional` **shell?**: [`Shell`](#shell)

##### branch?

> `readonly` `optional` **branch?**: `string`

##### noHooks?

> `readonly` `optional` **noHooks?**: `boolean`

***

### WorkspaceRun

#### Type Parameters

##### T

`T`

#### Properties

##### valid

> `readonly` **valid**: `boolean`

##### value

> `readonly` **value**: `T`

##### commit?

> `readonly` `optional` **commit?**: [`WorkspaceCommit`](#workspacecommit)

Present when a commit was attempted (valid, or `commitOnInvalid`).

## Type Aliases

### AnalystLensOutput

> **AnalystLensOutput** = `ReadonlyArray`\<`AnalystFinding`\> \| \{ `summary`: `string`; \}

What one analyst lens may return.

Two shapes, because two real producers exist and neither can be dropped. An eval-registry lens
returns validated `AnalystFinding`s — the schema every upstream consumer already reads. An
authored lens like `failuresAnalyst` returns a written brief for the driver and has no findings
to validate against. The union names both, so the boundary can no longer silently accept an
unvalidated shape (#630) while the authored lens keeps working.

***

### ContinuityMode

> **ContinuityMode** = `"fresh"` \| `"resume"`

How a spawn CONTINUES a node's prior work: `'fresh'` starts a brand-new session (the default,
 and the only pre-continuity behavior); `'resume'` re-attaches to the node's most recent
 SETTLED worker — a NEW live worker is spawned whose spawn context carries the prior worker's
 identity ([WorkerResumeContext](#workerresumecontext)), and the executor seam owns the actual session
 re-attachment.

***

### DownMessageDeliveryOutcome

> **DownMessageDeliveryOutcome** = `"delivered"` \| `"unknown-worker"` \| `"already-settled"` \| `"runtime-has-no-inbox"` \| `"scope-stopped"` \| `"runtime-error"`

The exact result of one parent→child delivery attempt.

***

### AuthorizeDownMessage

> **AuthorizeDownMessage** = (`input`) => [`AuthorizedDownMessage`](#authorizeddownmessage)

Product decision over an exact continuation before it is durably recorded or delivered.

#### Parameters

##### input

[`DownMessageAuthorizationInput`](#downmessageauthorizationinput)

#### Returns

[`AuthorizedDownMessage`](#authorizeddownmessage)

***

### MakeWorkerAgent

> **MakeWorkerAgent** = (`profile`, `context?`) => [`Agent`](#agent-2)\<`unknown`, `unknown`\>

#### Parameters

##### profile

`AgentProfile`

##### context?

[`WorkerSpawnContext`](#workerspawncontext)

#### Returns

[`Agent`](#agent-2)\<`unknown`, `unknown`\>

***

### ScoreOf

> **ScoreOf** = (`record`) => `number` \| `undefined`

Pull the headline score in [0,1] from a record. Default: the held-out split, else the search split,
 else a `composite`/`passed`/`score` entry in the raw bag. Override to score a domain differently.

#### Parameters

##### record

`RunRecord`

#### Returns

`number` \| `undefined`

***

### ProfileKeyOf

> **ProfileKeyOf** = (`record`) => `string`

The profile (matrix row) a record belongs to — default `harness·model` from the record's profile cell,
 falling back to the model. This is the leaderboard's unit of comparison.

#### Parameters

##### record

`RunRecord`

#### Returns

`string`

***

### GroupOf

> **GroupOf** = (`record`) => `string`

The axis (matrix column) a record contributes to — default the scenario group.

#### Parameters

##### record

`RunRecord`

#### Returns

`string`

***

### AxisScoresOf

> **AxisScoresOf** = (`record`) => `Record`\<`string`, `number`\>

Decompose ONE record into per-axis scores (e.g. judge dimensions). When set, it REPLACES the
 scenario-group axes: the column set is the union of returned keys.

#### Parameters

##### record

`RunRecord`

#### Returns

`Record`\<`string`, `number`\>

***

### InProcessOnPrompt

> **InProcessOnPrompt** = (`prompt`, `ctx`) => `SandboxEvent`[] \| `AsyncIterable`\<`SandboxEvent`\> \| `Promise`\<`SandboxEvent`[]\>

The user callback: given a prompt and its round, produce the box's event
stream for that turn. Return a plain `SandboxEvent[]` (the common case) or an
async iterable for streaming. The callback may also write files into
`ctx.workdir` (read back via `fs.read` or graded by `exec`).

#### Parameters

##### prompt

`string`

##### ctx

[`InProcessPromptCtx`](#inprocesspromptctx)

#### Returns

`SandboxEvent`[] \| `AsyncIterable`\<`SandboxEvent`\> \| `Promise`\<`SandboxEvent`[]\>

***

### LoopOptionsForDispatch

> **LoopOptionsForDispatch**\<`Task`, `Output`, `Decision`\> = `Omit`\<[`RunAgentRoundsOptions`](#runagentroundsoptions)\<`Task`, `Output`, `Decision`\>, `"ctx"`\>

runAgentRounds options minus the `ctx` (loopDispatch builds the ctx).

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

***

### SuperviseOptionsForDispatch

> **SuperviseOptionsForDispatch** = `Omit`\<[`SuperviseOptions`](#superviseoptions), `"signal"`\>

`supervise` options minus Eval-owned cancellation.

***

### Outcome

> **Outcome**\<`D`\> = \{ `kind`: `"done"`; `deliverable`: `D`; \} \| \{ `kind`: `"blocked"`; `blockers`: `string`[]; \}

The terminal contract Drew wants: a loop returns a FINISHED deliverable, or the concrete
list of blockers that stopped it — never a half-done best-effort coercion. A `blocked`
outcome with an empty `blockers` list is a contract violation (a shape that can't finish
MUST name why); impls fail loud on it rather than emitting a vacuous block.

`Outcome` is the `Out` type a personified `Agent`/`Supervisor` is parameterized by, so the
keystone's typed `SupervisedResult<Outcome<D>>` carries it end to end with no coercion.

#### Type Parameters

##### D

`D`

***

### DefinePersona

> **DefinePersona** = \<`D`\>(`input`) => [`Persona`](#persona)\<`D`\>

Builds a frozen `Persona`, failing loud on the executors-supplied invariant (neither a
 registry nor seams = an unresolvable persona). Pure — no I/O, no engine.

#### Type Parameters

##### D

`D` = `unknown`

#### Parameters

##### input

[`DefinePersonaInput`](#definepersonainput)\<`D`\>

#### Returns

[`Persona`](#persona)\<`D`\>

***

### LoopShape

> **LoopShape**\<`Task`, `D`\> = (`ctx`) => [`Agent`](#agent-2)\<`Task`, [`Outcome`](#outcome-2)\<`D`\>\>

A reusable act-body factory. Given the persona's content + seams (`ShapeContext`), it
returns the root `Agent<Task, Outcome<D>>` whose `act` decomposes the task, fans out
children through `scope.spawn`, verifies/selects across their settlements (selector≠judge:
via `settledToIteration` + `defaultSelectWinner`, never re-ranking behind the driver), and
synthesizes the terminal `Outcome<D>`. The shape is STRUCTURE; the persona is CONTENT.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

#### Returns

[`Agent`](#agent-2)\<`Task`, [`Outcome`](#outcome-2)\<`D`\>\>

***

### RunPersonified

> **RunPersonified** = \<`Task`, `D`\>(`options`) => `Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<[`Outcome`](#outcome-2)\<`D`\>\>\>

The composed run signature.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### options

[`RunPersonifiedOptions`](#runpersonifiedoptions)\<`Task`, `D`\>

#### Returns

`Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<[`Outcome`](#outcome-2)\<`D`\>\>\>

***

### CombinatorShape

> **CombinatorShape**\<`Task`, `D`\> = [`LoopShape`](#loopshape)\<`Task`, `D`\>

A combinator is just a `LoopShape`: a factory `(ShapeContext) => Agent` whose `Agent.act`
runs the combinator's structure over the `Scope` (spawn children, drain `next()`, select via
the single-sourced `settledToIteration`+`defaultSelectWinner`, synthesize an `Outcome<D>`).
Aliased — NOT a new type — so a combinator stays a first-class shape the persona layer's
`runPersonified`/`ShapeRegistry` resolve with zero new machinery. The SHAPE is content-free;
the persona carries the domain.

#### Type Parameters

##### Task

`Task`

##### D

`D`

***

### Pipeline

> **Pipeline** = \<`Task`, `D`\>(`stages`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`pipeline(stages)` — build the sequential combinator from an ordered stage list. The first
 stage's `StepIn` is the root `Task`; the last stage's `StepOut` is the deliverable `D`.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### stages

`ReadonlyArray`\<[`PipelineStage`](#pipelinestage)\<`Task`, `unknown`, `unknown`\>\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### FanoutWinnerSelector

> **FanoutWinnerSelector**\<`D`\> = (`iterations`) => \{ `output?`: [`Outcome`](#outcome-2)\<`D`\>; \} \| `undefined`

A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the
 child's `Outcome<D>`), returning the chosen iteration or `undefined` when none qualifies.

#### Type Parameters

##### D

`D`

#### Parameters

##### iterations

[`Iteration`](#iteration-1)\<`unknown`, [`Outcome`](#outcome-2)\<`D`\>\>[]

#### Returns

\{ `output?`: [`Outcome`](#outcome-2)\<`D`\>; \} \| `undefined`

***

### WinnerStrategy

> **WinnerStrategy** = `"highest-score"` \| `"smallest-artifact"` \| `"first-valid"`

Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid.

***

### Fanout

> **Fanout** = \<`Task`, `Item`, `D`\>(`items`, `opts`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`fanout(items, opts)` — build the fanout combinator over a static item list.

#### Type Parameters

##### Task

`Task`

##### Item

`Item`

##### D

`D`

#### Parameters

##### items

`ReadonlyArray`\<`Item`\>

##### opts

[`FanoutOptions`](#fanoutoptions)\<`Item`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### LoopUntil

> **LoopUntil** = \<`Task`, `State`, `D`\>(`seed`, `spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`loopUntil(spec)` — build the iterative-deepening combinator. `seed` is the initial state.

#### Type Parameters

##### Task

`Task`

##### State

`State`

##### D

`D`

#### Parameters

##### seed

`State`

##### spec

[`LoopUntilSpec`](#loopuntilspec)\<`Task`, `State`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### Panel

> **Panel** = \<`Task`, `Artifact`, `D`\>(`spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`panel(spec)` — build the M-judge write-only-merge combinator.

#### Type Parameters

##### Task

`Task`

##### Artifact

`Artifact`

##### D

`D`

#### Parameters

##### spec

[`PanelSpec`](#panelspec)\<`Artifact`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### Verify

> **Verify** = \<`Task`, `Candidate`, `D`\>(`spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`verify(spec)` — build the 2-node implement→verifier-gate combinator.

#### Type Parameters

##### Task

`Task`

##### Candidate

`Candidate`

##### D

`D`

#### Parameters

##### spec

[`VerifySpec`](#verifyspec)\<`Task`, `Candidate`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### WidenDecision

> **WidenDecision**\<`D`\> = \{ `kind`: `"widen"`; `toward`: [`WidenLineage`](#widenlineage)\<`D`\>; \} \| \{ `kind`: `"stop"`; `rationale?`: `string`; \}

A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 always returns `{ kind: 'stop' }`.

#### Type Parameters

##### D

`D`

***

### Widen

> **Widen** = \<`Task`, `Seed`, `D`\>(`spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

`widen(spec)` — build the streaming progressive-widening combinator.

#### Type Parameters

##### Task

`Task`

##### Seed

`Seed`

##### D

`D`

#### Parameters

##### spec

[`WidenSpec`](#widenspec)\<`Seed`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### FlatWidenGate

> **FlatWidenGate** = \<`D`\>() => [`ScopeWidenGate`](#scopewidengate)\<`D`\>

The flat default `ScopeWidenGate` factory contract — never widens, keeping the R2 firewall
 conflict dormant. Exported so a gate run can pass it explicitly and a test can assert the
 default is flat.

#### Type Parameters

##### D

`D`

#### Returns

[`ScopeWidenGate`](#scopewidengate)\<`D`\>

***

### AssertTraceDerivedFindings

> **AssertTraceDerivedFindings** = (`findings`) => `void`

The firewall assertion contract, re-stated for the reactive seam (PORT of
`assertTraceDerivedFindings`). A PROVENANCE check, not a content check: span/event/artifact/
finding refs and empty-evidence findings pass; only a `metric` ref whose uri is a
judge/verdict/score scheme is rejected. Fail loud — a tainted finding aborts. The impl lives in
`analyst.ts`; this type pins its signature so callers depend on the contract, not the impl.

#### Parameters

##### findings

`ReadonlyArray`\<`AnalystFinding`\>

#### Returns

`void`

***

### RenderCorpusToInstructions

> **RenderCorpusToInstructions** = (`opts`) => `Promise`\<`AgentProfile`\>

`renderCorpusToInstructions(opts)` — the flywheel read-back projection. Async (queries the
 durable corpus); returns a fresh `AgentProfile` with the accreted facts merged in.

#### Parameters

##### opts

[`RenderCorpusToInstructionsOptions`](#rendercorpustoinstructionsoptions)

#### Returns

`Promise`\<`AgentProfile`\>

***

### TrajectoryReportFn

> **TrajectoryReportFn** = (`journal`, `blobs`, `root`, `options?`) => `Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

`trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs).

#### Parameters

##### journal

[`SpawnJournal`](#spawnjournal)

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### root

[`NodeId`](#nodeid-5)

##### options?

[`TrajectoryReportOptions`](#trajectoryreportoptions)

#### Returns

`Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

***

### EqualKOnCost

> **EqualKOnCost** = (`arms`, `options?`) => [`EqualKVerdict`](#equalkverdict)

`equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost.

#### Parameters

##### arms

`ReadonlyArray`\<[`EqualKArm`](#equalkarm)\>

##### options?

[`EqualKOnCostOptions`](#equalkoncostoptions)

#### Returns

[`EqualKVerdict`](#equalkverdict)

***

### RetainedInteractiveEnvironmentInput

> **RetainedInteractiveEnvironmentInput** = `Omit`\<`CreateAgentEnvironmentInput`, `"idempotencyKey"` \| `"profile"` \| `"signal"`\> & `object`

**`Stable`**

Environment and exact AgentProfile used to start one native coding-agent process.

#### Type Declaration

##### idempotencyKey

> `readonly` **idempotencyKey**: `string`

##### profile

> `readonly` **profile**: `AgentProfile`

***

### RetainedInteractiveAdmissionHook

> **RetainedInteractiveAdmissionHook** = (`admission`) => `Promise`\<`void`\>

**`Stable`**

Persist each exact interactive record before the runtime proceeds.

#### Parameters

##### admission

[`RetainedInteractiveAdmission`](#retainedinteractiveadmission)

#### Returns

`Promise`\<`void`\>

***

### RetainedRunEffect

> **RetainedRunEffect** = `"cancel_requested"` \| `"cancelled"` \| `"not_live"` \| `"unknown"`

**`Stable`**

Effect recorded for one retained control operation.

***

### NativeContextContinuationInput

> **NativeContextContinuationInput** = `NativeContextContinuationTurn` & `Omit`\<`AgentNativeContextContinuationOptions`, `"turn"`\>

**`Stable`**

Runtime controls plus the exact user turn bound into a continuation request.

***

### NativeContextContinuationExecution

> **NativeContextContinuationExecution** = `AgentNativeContextContinuationResult`

**`Stable`**

Result of one verified same-session continuation.

***

### RetainedInteractiveAdmission

> **RetainedInteractiveAdmission** = [`RetainedInteractiveIntentAdmission`](#retainedinteractiveintentadmission) \| [`RetainedInteractiveEnvironmentAdmission`](#retainedinteractiveenvironmentadmission) \| [`RetainedInteractiveStartedAdmission`](#retainedinteractivestartedadmission)

**`Stable`**

Durable records for one exact native coding-agent process.

***

### RetainedRunAdmission

> **RetainedRunAdmission** = [`RetainedRunIntentAdmission`](#retainedrunintentadmission) \| [`RetainedRunEnvironmentAdmission`](#retainedrunenvironmentadmission) \| [`RetainedRunDispatchedAdmission`](#retainedrundispatchedadmission)

**`Stable`**

One detached-run admission record the runtime persists before creation or dispatch proceeds.

***

### RetainedRunAdmissionHook

> **RetainedRunAdmissionHook** = (`admission`) => `Promise`\<`void`\>

**`Stable`**

Awaited durability hook for retained admission records.

The runtime blocks after the pre-create intent, environment creation, and
provider work until the hook resolves. No retained run becomes caller-visible
before its exact recovery record is durable. A rejection keeps provider state
for recovery when provider work has already started.

#### Parameters

##### admission

[`RetainedRunAdmission`](#retainedrunadmission)

#### Returns

`Promise`\<`void`\>

***

### RecoverRetainedRunResult

> **RecoverRetainedRunResult** = \{ `outcome`: `"recovered"`; `handle`: [`RetainedRunHandle`](#retainedrunhandle); \} \| \{ `outcome`: `"not_found"`; \} \| \{ `outcome`: `"unverifiable"`; `environment`: `AgentEnvironment`; \}

**`Stable`**

Outcome of one recovery attempt from pre-dispatch admission coordinates.

`not_found`: the provider no longer holds the environment; nothing remains
to destroy. `recovered`: the provider self-identified the session with a
strict exact reference matching the recorded coordinates. `unverifiable`:
the environment exists but the provider cannot self-identify the session;
never destroy on this outcome — keep the environment, retry
`reconnectRetainedRun` with a dispatched admission record, or inspect it
with provider-native tools.

***

### Environment

> **Environment** = [`AgenticSurface`](#agenticsurface)

A checkable task domain — implement these 5 hooks and the suite does the rest. The
 same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it.

***

### TerminalDecision

> **TerminalDecision** = *typeof* [`TERMINAL_DECISIONS`](#terminal_decisions)\[`number`\]

**`Stable`**

One of the kernel's terminal decision values.

***

### SandboxOutputMarker

> **SandboxOutputMarker** = \{ `kind`: `"text"`; `bytes`: `number`; \} \| \{ `kind`: `"empty"`; \} \| \{ `kind`: `"absent"`; \}

What a settled turn produced, as an explicit marker.

`text` carries the byte length of the answer, `empty` says a text-bearing terminal event was
observed and carried nothing, and `absent` says no text-bearing event was observed at all.
The three are distinct on purpose: an empty settle blob used to be indistinguishable from lost
output, so a reader could not tell a box that produced nothing from one whose answer never
arrived.

***

### Deliverable

> **Deliverable**\<`Out`\> = \{ `kind`: `"events"`; `fromEvents`: (`events`) => `Out`; \} \| \{ `kind`: `"artifact"`; `path`: `string`; `fromArtifact`: (`raw`, `events`) => `Out`; \}

**`Experimental`**

How a typed deliverable `Out` is materialized from a finished turn.
- `events`   — pure parse over the event array (identical to `OutputAdapter`).
- `artifact` — read a file off the box AFTER the turn drains, then map it (+ the
               events). For diffs/codebases/documents that don't fit the chat
               stream. `path` relative ⇒ workspace root; absolute ⇒ container FS.

#### Type Parameters

##### Out

`Out`

***

### OpenSandboxRunPromptOptions

> **OpenSandboxRunPromptOptions** = `Omit`\<`PromptOptions`, `"signal"` \| `"sessionId"`\>

**`Experimental`**

Prompt options forwarded to every sandbox prompt turn in this run. The
runtime owns `sessionId` and `signal` so callers cannot accidentally break
resume or cancellation semantics while still setting backend-level prompt
controls such as `timeoutMs`.

***

### ChampionPolicy

> **ChampionPolicy** = `"score"` \| `"costAware"`

***

### StrategyMessage

> **StrategyMessage** = `Record`\<`string`, `unknown`\>

One provider-neutral conversation record carried between strategy shots.

***

### AgentTurnBackend

> **AgentTurnBackend** = `object`

**`Stable`**

The execution substrate one turn runs on — a closed discriminated union over
the three stream surfaces the runtime already owns.

#### Properties

##### kind

> **kind**: `"executor"`

A Runtime-owned executor factory materialized from this exact canonical profile.

##### factory

> **factory**: [`ExecutorFactory`](#executorfactory)\<`unknown`\>

##### profile

> **profile**: `AgentProfile`

Exact canonical identity materialized by the executor.

##### agentRunName?

> `optional` **agentRunName?**: `string`

Model label stamped on cost-only `llm_call` events. Default `'agent'`.

***

### StructuralRolloutMessage

> **StructuralRolloutMessage** = `Record`\<`string`, `unknown`\>

Provider-neutral conversation records read by structural candidate extraction.

***

### RepairStop

> **RepairStop** = `"already-passing"` \| `"no-signal"` \| `"repaired-pass"` \| `"rounds-exhausted"` \| `"no-candidates"`

***

### AuthoredProfile

> **AuthoredProfile** = `AgentProfile` & `object`

What the supervisor AUTHORS per sub-task: one complete canonical profile whose name and
 task-specific system prompt are present. Every other `AgentProfile` axis is preserved exactly.

#### Type Declaration

##### name

> `readonly` **name**: `string`

##### prompt

> `readonly` **prompt**: `AgentProfilePrompt` & `object`

###### Type Declaration

###### systemPrompt

> `readonly` **systemPrompt**: `string`

***

### BudgetReadout

> **BudgetReadout** = `Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 `iterationsLeft` is the remaining iteration capacity.
 `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver.

***

### ReservationRejection

> **ReservationRejection** = `"budget-exhausted"` \| `"usd-unbudgeted"`

Why a reservation was refused. `budget-exhausted` means the pool ran out of a channel it
budgets; `usd-unbudgeted` means the root declared no dollar ceiling, so a dollar request is
unsatisfiable at any amount and the fix is to budget the root, not to ask for less.

***

### ChatCompletionsTransport

> **ChatCompletionsTransport** = `NonNullable`\<[`RouterToolsSeam`](#routertoolsseam)\[`"complete"`\]\>

Buffered OpenAI-compatible completion port used only for offline execution.

***

### CoordinationOwnerId

> **CoordinationOwnerId** = `string`

Stable identity of the supervisor that owns one coordination stream. High-level supervision
derives it from the exact root/child execution identity plus its parent assignment.

***

### CoordinationDeliveryEvidence

> **CoordinationDeliveryEvidence** = `Extract`\<[`CoordinationEvent`](index.md#coordinationevent), \{ `type`: `"delivery-attempt"` \| `"steer"` \| `"answer"`; \}\>

Durable delivery evidence retained in commit order. An attempt without a later event carrying
the same `receiptId` has an unknown outcome after a crash and is never replayed.

***

### DispatchStopReason

> **DispatchStopReason** = `"drained"` \| `"not-admitted"` \| `"stopped"` \| `"aborted"`

Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end);
 `not-admitted` = the conserved pool or the depth ceiling refused a spawn; `stopped` = the
 caller's `shouldStop` returned true; `aborted` = the scope's signal fired.

***

### DriverAttemptStop

> **DriverAttemptStop** = `"completed"` \| `"terminal-error"` \| `"retry-disabled"` \| `"aborted"` \| `"budget-exhausted"` \| `"deadline"` \| `"no-progress"` \| `"max-attempts"`

Why the retry loop stopped. `completed` is the only non-failure.

***

### GraphEdge

> **GraphEdge** = \{ `kind`: `"delegates"`; `from`: [`NodeId`](#nodeid-5); `to`: [`NodeId`](#nodeid-5); `directive`: [`PromptHandle`](#prompthandle); `maxTraversals?`: `number`; `continuity?`: [`ContinuityMode`](#continuitymode); \} \| \{ `kind`: `"analyzes"`; `analyst`: `string`; `over`: `ReadonlyArray`\<[`NodeId`](#nodeid-5)\>; `to`: [`NodeId`](#nodeid-5); `directive`: [`PromptHandle`](#prompthandle); `maxTraversals?`: `number`; \}

#### Union Members

##### Type Literal

\{ `kind`: `"delegates"`; `from`: [`NodeId`](#nodeid-5); `to`: [`NodeId`](#nodeid-5); `directive`: [`PromptHandle`](#prompthandle); `maxTraversals?`: `number`; `continuity?`: [`ContinuityMode`](#continuitymode); \}

Work flows down. The delegation directive is DATA → versionable, sweepable, optimizable.
 Each spawn of `to` by `from` — and each mid-run steer from `from` to a live `to` worker —
 is one traversal.

###### kind

> `readonly` **kind**: `"delegates"`

###### from

> `readonly` **from**: [`NodeId`](#nodeid-5)

###### to

> `readonly` **to**: [`NodeId`](#nodeid-5)

###### directive

> `readonly` **directive**: [`PromptHandle`](#prompthandle)

###### maxTraversals?

> `readonly` `optional` **maxTraversals?**: `number`

Cyclic-graph backstop: traversals beyond this REFUSE (fail loud). Default
 [defaultEdgeTraversalCap](#defaultedgetraversalcap).

###### continuity?

> `readonly` `optional` **continuity?**: [`ContinuityMode`](#continuitymode)

Default continuity for this edge's SPAWN traversals. `'resume'` makes every spawn after
 the node's first re-attach to its most recent SETTLED worker: a NEW live worker whose
 spawn context carries `resume: { ofWorker, sequence }` for the executor seam, spending
 from the same conserved pool — the node's first spawn is effectively `'fresh'`, and a
 spawn while a prior worker is still live refuses loudly (steer is the live channel).
 The driver's per-call `spawn_agent` `continuity` argument overrides either way. Omit =
 `'fresh'` (today's behavior, byte-identical). Caps count resumes exactly like fresh
 spawns.

***

##### Type Literal

\{ `kind`: `"analyzes"`; `analyst`: `string`; `over`: `ReadonlyArray`\<[`NodeId`](#nodeid-5)\>; `to`: [`NodeId`](#nodeid-5); `directive`: [`PromptHandle`](#prompthandle); `maxTraversals?`: `number`; \}

Findings flow anywhere: an analyst over N nodes' settled traces, delivered to ONE node.
 With a LENS analyst the directive wraps the findings for the recipient; with a NODE analyst
 the directive is the analyst agent's task and the findings are its settle output.

###### kind

> `readonly` **kind**: `"analyzes"`

###### analyst

> `readonly` **analyst**: `string`

The analyst REFERENCE, in one of two forms: a lens id resolved against
 `RunGraphOptions.analysts` (environment), or the id of a graph NODE with no delegates
 edge pointing at it — then each matching settle spawns that node's pinned profile as a
 tool-equipped analyst WORKER (same spawn machinery, conserved budget, trace join) whose
 task is this edge's directive plus the settled worker's trace evidence and whose settle
 output is the findings. An id that is both a node and a registry lens is refused.

###### over

> `readonly` **over**: `ReadonlyArray`\<[`NodeId`](#nodeid-5)\>

###### to

> `readonly` **to**: [`NodeId`](#nodeid-5)

###### directive

> `readonly` **directive**: [`PromptHandle`](#prompthandle)

###### maxTraversals?

> `readonly` `optional` **maxTraversals?**: `number`

Observability cap: traversals beyond this are LEDGERED as exhausted (`unpropagated`).
 Only delegates caps refuse traversal — they are what close the spawn cycle.

***

### EdgeDeliveryOutcome

> **EdgeDeliveryOutcome** = `"delivered"` \| `"stripped"` \| `"empty"` \| `"unpropagated"`

***

### TraversalContinuity

> **TraversalContinuity** = [`ContinuityMode`](#continuitymode) \| `"steer"`

How one ledgered hop CONTINUED: a spawn traversal stamps its effective spawn mode
 (`'fresh'` | `'resume'`), and every mid-run delivery into an already-live recipient — a
 driver steer leg and every analyzes delivery (routed steer or driver-destined finding) —
 stamps `'steer'`. Zero ambiguity: every row carries exactly one of the three.

***

### InboxMessage

> **InboxMessage** = [`AuthorityInboxMessage`](#authorityinboxmessage) \| [`PeerInboxMessage`](#peerinboxmessage)

***

### SupervisorSpanAttributes

> **SupervisorSpanAttributes** = `Record`\<`string`, `string` \| `number` \| `boolean`\>

OTLP span attribute values. Exported because `SupervisorSpanOptions.attributes` is public and
 a consumer cannot name the type it is asked to supply otherwise.

***

### PeerMailKind

> **PeerMailKind** = `"ask"` \| `"tell"` \| `"challenge"` \| `"answer"`

What one envelope IS, typed so a reader can act on it without parsing prose.

 - `ask` — request a fact the sender lacks; expects an `answer`.
 - `tell` — share a result; MUST carry evidence refs.
 - `challenge` — dispute a peer's claim; MUST cite the refs of the claim it disputes.
 - `answer` — reply to an `ask` or a `challenge`.

***

### PeerMailRefusal

> **PeerMailRefusal** = `"sender-unbound"` \| `"self-addressed"` \| `"send-quota-exhausted"` \| `"mailbox-full"` \| `"thread-depth-exceeded"` \| `"thread-stopped"` \| `"unknown-reply-target"` \| `"evidence-required"` \| `"subject-too-large"` \| `"body-too-large"` \| `"forged-authority"` \| `"unknown-worker"` \| `"already-settled"` \| `"worker-has-no-inbox"` \| `"scope-stopped"` \| `"runtime-error"`

Why an attempt did not reach a sibling. Each value is a fact the sender can read and act on.

***

### PeerMailOutcome

> **PeerMailOutcome** = `"delivered"` \| [`PeerMailRefusal`](#peermailrefusal)

***

### RunContext

> **RunContext** = [`InMemoryRunContext`](#inmemoryruncontext)

The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the
 historical name for the same shape.

***

### ExecutorConfig

> **ExecutorConfig** = `object` & [`RouterSeam`](#routerseam) \| `object` & [`RouterToolsSeam`](#routertoolsseam) \| `object` & [`BridgeSeam`](#bridgeseam) \| `object` & [`CliSeam`](#cliseam) \| `object` & [`CliWorktreeSeam`](#cliworktreeseam) \| `object` & [`ProviderSeam`](#providerseam) \| `object` & [`SandboxSeam`](#sandboxseam)

Config for [createExecutor](#createexecutor): the backend is DATA — the cost dial a profile,
an experiment config, or a replay journal can name — not an import choice. Each
variant carries its backend's seam (router/router-tools/bridge/cli/cli-worktree/sandbox).

***

### StopDecision

> **StopDecision** = \{ `stop`: `false`; \} \| \{ `stop`: `true`; `reason`: `string`; \}

A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say
 why in the result, and an unexplained early stop is indistinguishable from a bug.

***

### StopRule

> **StopRule** = (`view`) => [`StopDecision`](#stopdecision)

Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on
 the driver's hot path, once per turn.

#### Parameters

##### view

[`ProgressView`](#progressview)

#### Returns

[`StopDecision`](#stopdecision)

***

### DeliverableResolutionInput

> **DeliverableResolutionInput** = [`AuthorizedSpawnContext`](#authorizedspawncontext)

Exact trusted context for selecting one backend-derived leaf's completion check.

***

### SupervisorProfile

> **SupervisorProfile** = `AgentProfile`

A supervisor is an exact canonical AgentProfile; no looser model/prompt shape exists.

***

### SupervisorNodeContextSeed

> **SupervisorNodeContextSeed** = `Omit`\<[`SupervisorNodeContext`](#supervisornodecontext), `"nodeId"` \| `"profile"` \| `"task"`\>

Context known before `Agent.act`; Runtime adds the concrete node, profile, and task.

***

### ResolveSupervisorTools

> **ResolveSupervisorTools** = (`context`) => `ReadonlyArray`\<[`SupervisorToolDescriptor`](#supervisortooldescriptor)\> \| `Promise`\<`ReadonlyArray`\<[`SupervisorToolDescriptor`](#supervisortooldescriptor)\>\>

Product policy for the tools one exact supervisor node may call. Resolved once per node.

#### Parameters

##### context

[`SupervisorNodeContext`](#supervisornodecontext)

#### Returns

`ReadonlyArray`\<[`SupervisorToolDescriptor`](#supervisortooldescriptor)\> \| `Promise`\<`ReadonlyArray`\<[`SupervisorToolDescriptor`](#supervisortooldescriptor)\>\>

***

### ObserveSupervisorNodeEvent

> **ObserveSupervisorNodeEvent** = (`context`, `event`, `record`) => `void` \| `Promise`\<`void`\>

Context-aware observer used internally to bind product transactions to the actual live node.

#### Parameters

##### context

[`SupervisorNodeContext`](#supervisornodecontext)

##### event

[`CoordinationEvent`](index.md#coordinationevent)

##### record

[`BusRecord`](#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

#### Returns

`void` \| `Promise`\<`void`\>

***

### DriveHarnessOwnerContext

> **DriveHarnessOwnerContext** = `Omit`\<[`SupervisorNodeContext`](#supervisornodecontext), `"nodeId"`\>

Trusted manager identity available before its external harness starts. A product uses this to
return one independently steerable harness session per recursive manager.

***

### ResolveDriveHarness

> **ResolveDriveHarness** = (`context`) => [`DriveHarness`](#driveharness-1)

Resolve an external harness for one exact Runtime-owned manager identity.

#### Parameters

##### context

[`DriveHarnessOwnerContext`](#driveharnessownercontext)

#### Returns

[`DriveHarness`](#driveharness-1)

***

### WorkerInteractiveUnavailableReason

> **WorkerInteractiveUnavailableReason** = `"unknown-node"` \| `"not-live"` \| `"executor-exposes-no-interactive-session"` \| `"provider-has-no-interactive-contract"` \| `"interactive-session-not-started"`

Why Runtime cannot hand a caller the exact interactive process one worker runs in.

***

### WorkerInteractiveSession

> **WorkerInteractiveSession** = \{ `status`: `"available"`; `handle`: [`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle); \} \| \{ `status`: `"unavailable"`; `reason`: [`WorkerInteractiveUnavailableReason`](#workerinteractiveunavailablereason); \}

One worker's attachable process, or the named reason there is none.

`available` carries the exact `RetainedInteractiveRunHandle` bound to THAT child's admitted
execution: input, resize, ordered replay, detach, and an acknowledged close all check every
provider answer against the session reference, so a second process that merely resumes the same
conversation cannot present itself as this one. `unavailable` names why, and is never a handle.

***

### ExecutorProgressEvent

> **ExecutorProgressEvent** = \{ `kind`: `"text_delta"`; `text`: `string`; \} \| \{ `kind`: `"reasoning_delta"`; `text`: `string`; \} \| \{ `kind`: `"tool_call"`; `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; \} \| \{ `kind`: `"tool_result"`; `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; \} \| \{ `kind`: `"interaction"`; `request`: `InteractionRequest`; \}

Live output observed while an executor runs, in Runtime's own vocabulary. It carries what the
backend produced — text, reasoning, tool activity, an interaction request — and never carries
accounting: tokens and dollars stay on the `tokens`/`cost` channels, so a progress event can
never meter a budget.

***

### UsageEvent

> **UsageEvent** = \{ `kind`: `"tokens"`; `tokensKnown?`: `false`; `input`: `number`; `output`: `number`; `freshInput?`: `number`; `cacheRead?`: `number`; `cacheWrite?`: `number`; `cacheBreakdownKnown?`: `false`; \} \| \{ `kind`: `"cost"`; `usdKnown?`: `false`; `usd`: `number`; `usdEstimated?`: `number`; \} \| \{ `kind`: `"progress"`; `progress`: [`ExecutorProgressEvent`](#executorprogressevent); \} \| \{ `kind`: `"iteration"`; \}

#### Union Members

##### Type Literal

\{ `kind`: `"tokens"`; `tokensKnown?`: `false`; `input`: `number`; `output`: `number`; `freshInput?`: `number`; `cacheRead?`: `number`; `cacheWrite?`: `number`; `cacheBreakdownKnown?`: `false`; \}

###### kind

> **kind**: `"tokens"`

###### tokensKnown?

> `optional` **tokensKnown?**: `false`

Known token subtotal. When false, these counts are only the observed/estimated floor.

###### input

> **input**: `number`

###### output

> **output**: `number`

###### freshInput?

> `optional` **freshInput?**: `number`

Newly processed prompt tokens. Present only with a complete cache split.

###### cacheRead?

> `optional` **cacheRead?**: `number`

Prompt tokens the provider reported reading from cache.

###### cacheWrite?

> `optional` **cacheWrite?**: `number`

Prompt tokens the provider reported writing to cache.

###### cacheBreakdownKnown?

> `optional` **cacheBreakdownKnown?**: `false`

False when this observation cannot classify all positive prompt tokens — including a
provider that reports a read with no write counter. The measured counters are still
carried; the marker says the remaining prompt tokens are unclassified, so a charge over
them is an upper bound. A counter the provider did not report is absent, never zero.

***

##### Type Literal

\{ `kind`: `"cost"`; `usdKnown?`: `false`; `usd`: `number`; `usdEstimated?`: `number`; \}

###### kind

> **kind**: `"cost"`

###### usdKnown?

> `optional` **usdKnown?**: `false`

Known dollar subtotal. When false, `usd` must not be treated as total cost.

###### usd

> **usd**: `number`

###### usdEstimated?

> `optional` **usdEstimated?**: `number`

The part of `usd` this runtime priced from a model catalog because no provider receipt
covered the work. Requires `usdKnown: false` — a catalog price approximates what a
provider would bill and never measures what it did.

Absence means this runtime priced nothing here, NOT that `usd` is a receipt. `usdKnown`
is what says whether a dollar figure is measured.

***

##### Type Literal

\{ `kind`: `"progress"`; `progress`: [`ExecutorProgressEvent`](#executorprogressevent); \}

###### kind

> **kind**: `"progress"`

Observed output, not accounting. Meters ignore it; the turn projection publishes it.

###### progress

> **progress**: [`ExecutorProgressEvent`](#executorprogressevent)

***

##### Type Literal

\{ `kind`: `"iteration"`; \}

***

### Runtime

> **Runtime** = `"router"` \| `"inline"` \| `"sandbox"` \| `"cli"` \| `string` & `object`

The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
External executors can register additional runtime strings without widening this type.

***

### MaterializedModelIdentity

> **MaterializedModelIdentity** = \{ `status`: `"known"`; `id`: `string`; \} \| \{ `status`: `"unknown"`; `reason`: `string`; \}

A named model carried into an execution, or an explicit reason the exact model is unknowable.

***

### UnknownMaterializationReason

> **UnknownMaterializationReason** = `"executor-did-not-report"` \| `"executor-failed-before-receipt"` \| `"executor-receipt-pending"` \| `"invalid-executor-report"` \| `"root-agent-did-not-report"`

Why exact materialization evidence is unavailable for a node.

`executor-receipt-pending` is an IN-FLIGHT value only. It states that a pending executor has
declared its plan and has not yet sent the terminal acknowledgement, so the answer can still
arrive. A terminal record must never carry it: the attempt is over and no receipt is coming.
A terminal attempt that ended before its acknowledgement records
`executor-failed-before-receipt` instead, which names the outcome rather than a wait that
already finished.

***

### ProfileMaterializationReceipt

> **ProfileMaterializationReceipt** = \{ `status`: `"known"`; `authoredProfileDigest`: `Sha256Digest`; `effectiveProfileDigest`: `Sha256Digest`; `materializationPlanDigest`: `Sha256Digest`; `platformAttachmentsDigest?`: `Sha256Digest`; `runtime`: [`Runtime`](#runtime-4); `backend`: `string`; `model`: [`MaterializedModelIdentity`](#materializedmodelidentity); `execution`: [`MaterializedExecutionIdentity`](#materializedexecutionidentity); `materializer`: `string`; \} \| \{ `status`: `"unknown"`; `authoredProfileDigest?`: `Sha256Digest`; `runtime`: [`Runtime`](#runtime-4); `reason`: [`UnknownMaterializationReason`](#unknownmaterializationreason); \}

What the kernel can prove about one node's actual execution plan.

***

### ExecutionBindingReceipt

> **ExecutionBindingReceipt** = \{ `status`: `"known"`; `attemptId`: `string`; `materializationReceiptDigest`: `Sha256Digest`; `bindingDigest`: `Sha256Digest`; `descriptor`: `Readonly`\<`Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>\>; \} \| \{ `status`: `"unknown"`; `attemptId`: `string`; `materializationReceiptDigest`: `Sha256Digest`; `reason`: [`UnknownMaterializationReason`](#unknownmaterializationreason); \}

One attempt's immutable link from a stable materialization plan to its actual transport.

***

### RootMaterialization

> **RootMaterialization** = \{ `runtime`: [`Runtime`](#runtime-4); `declaration`: [`ExecutorMaterialization`](#executormaterialization); `binding`: `Omit`\<[`ExecutorExecutionBinding`](#executorexecutionbinding), `"attemptId"`\>; \} \| \{ `runtime`: [`Runtime`](#runtime-4); `declaration`: `"deferred"`; `authoredProfile`: `AgentProfile`; \}

Trusted root composition evidence. Generic `Agent.act` roots omit this and remain unknown.

#### Union Members

##### Type Literal

\{ `runtime`: [`Runtime`](#runtime-4); `declaration`: [`ExecutorMaterialization`](#executormaterialization); `binding`: `Omit`\<[`ExecutorExecutionBinding`](#executorexecutionbinding), `"attemptId"`\>; \}

***

##### Type Literal

\{ `runtime`: [`Runtime`](#runtime-4); `declaration`: `"deferred"`; `authoredProfile`: `AgentProfile`; \}

###### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-4)

The runtime-owned external adapter will publish the exact declaration after its dynamic
platform attachment (for example a coordination URL) exists and before paid work starts.

###### declaration

> `readonly` **declaration**: `"deferred"`

###### authoredProfile

> `readonly` **authoredProfile**: `AgentProfile`

Exact admitted profile used to validate the stable effective identity at publication.

***

### ExecutorFactory

> **ExecutorFactory**\<`Out`\> = (`spec`, `ctx`) => [`Executor`](index.md#executor-2)\<`Out`\>

Builds a fresh `Executor` for one spawn from the resolved, immutable spec. Per-spawn (not shared)
so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a user supply
construction args without pre-instantiating; it never bypasses exact-profile validation.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### spec

[`AgentSpec`](index.md#agentspec)

##### ctx

[`ExecutorContext`](#executorcontext)

#### Returns

[`Executor`](index.md#executor-2)\<`Out`\>

***

### Restart

> **Restart** = `"temporary"` \| `"transient"` \| `"permanent"`

OTP child-spec restart class.

***

### NodeStatus

> **NodeStatus** = `"pending"` \| `"acquiring"` \| `"running"` \| `"waiting"` \| `"done"` \| `"failed"` \| `"cancelled"`

`'acquiring'` is first-class (M1): a node spends real time + reaps an orphan box
 during sandbox acquire BEFORE it is `running`, so abort must be defined over it.
 `'waiting'` is first-class for the opposite reason: a wait-state node holds NO executor, NO
 box, and no conserved budget — it is neither in flight nor settled, so neither `inFlight` nor
 a terminal status describes it (see `Scope.wait`).

***

### NodeId

> **NodeId** = `string`

Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock.

***

### SpawnRejection

> **SpawnRejection** = `"budget-exhausted"` \| `"usd-unbudgeted"` \| `"depth-exceeded"` \| `"duplicate-key"` \| `"invalid-identity"` \| `"key-conflict"` \| `"max-live-workers"` \| `"scope-aborted"`

Fail-closed spawn rejections: an exhausted pool, a dollar request against a root that budgets
 no dollars, an exceeded recursion ceiling, a full tree-wide worker allocation, or a `key` that
 is still LIVE in this scope (the same assignment may not run twice concurrently).

`usd-unbudgeted` is separate from `budget-exhausted` because the two call for opposite
 responses: an exhausted pool may admit a smaller request, while an unbudgeted dollar channel
refuses every amount until the ROOT budget names a `maxUsd`.

***

### SpawnPrior

> **SpawnPrior**\<`Out`\> = \{ `state`: `"completed"`; `settled`: [`Settled`](index.md#settled)\<`Out`\> & `object`; \} \| \{ `state`: `"retried"`; `priorId`: [`NodeId`](#nodeid-5); `reason`: `string`; \} \| \{ `state`: `"lost"`; `priorId`: [`NodeId`](#nodeid-5); \}

What a KEYED spawn resolved to when the key had a prior attempt. Absent on a fresh key (and on
every unkeyed spawn). `'completed'` is the exactly-once path: NOTHING was spawned — the handle
references the prior settled node and `settled` is the committed result. `'retried'` /
`'lost'` DID spawn fresh: the prior attempt settled `down` (retried) or was journaled as
started but never settled — the process died with it in flight and the built-in executors
cannot re-attach to a dead process's work, so the result is explicitly in doubt (lost), never
silently duplicated. On restart, an in-doubt attempt's full declared reservation is charged and
its telemetry remains unknown; a fresh retry is admitted only from safely remaining capacity.
An executor that CAN re-attach to a still-running external execution extends this union with an
adoption state; none of the built-ins can today.

#### Type Parameters

##### Out

`Out` = `unknown`

***

### SpawnEvent

> **SpawnEvent** = \{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-5); `parent?`: [`NodeId`](#nodeid-5); `label`: `string`; `key?`: `string`; `assignmentId?`: `string`; `budget`: [`Budget`](index.md#budget-4); `runtime`: [`Runtime`](#runtime-4); `ownedTreeRoot?`: [`NodeId`](#nodeid-5); `identity?`: [`NodeExecutionIdentity`](#nodeexecutionidentity); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"execution-bound"`; `id`: [`NodeId`](#nodeid-5); `binding`: [`ExecutionBindingReceipt`](#executionbindingreceipt); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"materialized"`; `id`: [`NodeId`](#nodeid-5); `receipt`: [`ProfileMaterializationReceipt`](#profilematerializationreceipt); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"settled"`; `id`: [`NodeId`](#nodeid-5); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `infra?`: `boolean`; `reason?`: `string`; `trace?`: [`WorkerTraceEvidence`](index.md#workertraceevidence); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: [`NodeId`](#nodeid-5); `reason`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"waiting"`; `id`: [`NodeId`](#nodeid-5); `parent?`: [`NodeId`](#nodeid-5); `label`: `string`; `spec`: [`WaitSpec`](#waitspec); `armedAt`: `number`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"woken"`; `id`: [`NodeId`](#nodeid-5); `by`: `"fired"` \| `"timeout"` \| `"cancelled"`; `outRef?`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"metered"`; `id`: [`NodeId`](#nodeid-5); `spend`: [`Spend`](index.md#spend); `accountingOnly?`: `true`; `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"edge"`; `id`: [`NodeId`](#nodeid-5); `edge`: \{ `kind`: `"delegates"` \| `"analyzes"`; `from`: `string`; `to`: `string`; `directive`: `string`; \}; `traversal`: `number`; `outcome`: `"delivered"` \| `"stripped"` \| `"empty"` \| `"unpropagated"`; `continuity?`: `"fresh"` \| `"resume"` \| `"steer"`; `bytes`: `number`; `reason?`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"trace-unpropagated"`; `id`: [`NodeId`](#nodeid-5); `expectedTraceId`: `string`; `backend`: `string`; `reason`: `"no-env-channel"` \| `"no-worker-process"` \| `"caller-omitted"`; `seq`: `number`; `at`: `string`; \}

Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 timestamp for human inspection only (NOT a replay input).

#### Union Members

##### Type Literal

\{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-5); `parent?`: [`NodeId`](#nodeid-5); `label`: `string`; `key?`: `string`; `assignmentId?`: `string`; `budget`: [`Budget`](index.md#budget-4); `runtime`: [`Runtime`](#runtime-4); `ownedTreeRoot?`: [`NodeId`](#nodeid-5); `identity?`: [`NodeExecutionIdentity`](#nodeexecutionidentity); `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"spawned"`

###### id

> **id**: [`NodeId`](#nodeid-5)

###### parent?

> `optional` **parent?**: [`NodeId`](#nodeid-5)

###### label

> **label**: `string`

###### key?

> `optional` **key?**: `string`

The semantic spawn key (`SpawnOpts.key`), when the spawn carried one — what a resumed
 run matches to resolve the same assignment to its committed result.

###### assignmentId?

> `optional` **assignmentId?**: `string`

Manager-scoped assignment identity used to join unkeyed and keyed work alike.

###### budget

> **budget**: [`Budget`](index.md#budget-4)

###### runtime

> **runtime**: [`Runtime`](#runtime-4)

###### ownedTreeRoot?

> `optional` **ownedTreeRoot?**: [`NodeId`](#nodeid-5)

Exact nested journal tree this node owns. Runtime writes this only after privately
attesting the executor as a recursive scope owner. Its absence means no tree is followed,
including records written before this field existed and caller leaves named `driver`.

###### identity?

> `optional` **identity?**: [`NodeExecutionIdentity`](#nodeexecutionidentity)

Exact profile/task digests plus trusted candidate/campaign attribution when available.

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"execution-bound"`; `id`: [`NodeId`](#nodeid-5); `binding`: [`ExecutionBindingReceipt`](#executionbindingreceipt); `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"execution-bound"`

Volatile transport/session binding for exactly one attempt. The full binding is retained
only by digest; descriptor fields are safe structural labels, never credential-bearing URLs.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### binding

> **binding**: [`ExecutionBindingReceipt`](#executionbindingreceipt)

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"materialized"`; `id`: [`NodeId`](#nodeid-5); `receipt`: [`ProfileMaterializationReceipt`](#profilematerializationreceipt); `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"materialized"`

Trusted runtime transformation from the authorized profile to actual wire bytes.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### receipt

> **receipt**: [`ProfileMaterializationReceipt`](#profilematerializationreceipt)

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"settled"`; `id`: [`NodeId`](#nodeid-5); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `infra?`: `boolean`; `reason?`: `string`; `trace?`: [`WorkerTraceEvidence`](index.md#workertraceevidence); `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"settled"`

###### id

> **id**: [`NodeId`](#nodeid-5)

###### status

> **status**: `"done"` \| `"down"`

###### outRef?

> `optional` **outRef?**: `string`

Content-addressed result pointer; rehydrates `out` from `ResultBlobStore`.

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](index.md#spend)

###### providerModel?

> `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence)

Provider model evidence is independent from the planned materialization receipt.

###### infra?

> `optional` **infra?**: `boolean`

###### reason?

> `optional` **reason?**: `string`

Exact child failure. Present on every new `status: 'down'` record; optional only so
journals written before this field existed remain replayable.

###### trace?

> `optional` **trace?**: [`WorkerTraceEvidence`](index.md#workertraceevidence)

Structured tool evidence. Optional only for journals written before trace capture.

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"cancelled"`; `id`: [`NodeId`](#nodeid-5); `reason`: `string`; `seq`: `number`; `at`: `string`; \}

***

##### Type Literal

\{ `kind`: `"waiting"`; `id`: [`NodeId`](#nodeid-5); `parent?`: [`NodeId`](#nodeid-5); `label`: `string`; `spec`: [`WaitSpec`](#waitspec); `armedAt`: `number`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"waiting"`

A wait-state node was ARMED. Lives in the SPAWN-ORDINAL namespace (`seq` is the wait
 ordinal within its parent scope), exactly like `spawned` — it creates a node, it does not
 settle one. It carries the whole `spec` and the original `armedAt` so a brand-new process
 re-arms the identical wait with the identical ABSOLUTE deadline.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### parent?

> `optional` **parent?**: [`NodeId`](#nodeid-5)

###### label

> **label**: `string`

###### spec

> **spec**: [`WaitSpec`](#waitspec)

###### armedAt

> **armedAt**: `number`

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"woken"`; `id`: [`NodeId`](#nodeid-5); `by`: `"fired"` \| `"timeout"` \| `"cancelled"`; `outRef?`: `string`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"woken"`

A wait-state node SETTLED — the cursor-namespace twin of `settled`, kept distinct so a
 reader can tell zero-cost waiting apart from paid work without inspecting payloads. A
 wait carries no `spent` (it is free by construction, not by measurement); `outRef`
 rehydrates its `WaitOutcome`, absent when the wait was cancelled.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### by

> **by**: `"fired"` \| `"timeout"` \| `"cancelled"`

###### outRef?

> `optional` **outRef?**: `string`

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"metered"`; `id`: [`NodeId`](#nodeid-5); `spend`: [`Spend`](index.md#spend); `accountingOnly?`: `true`; `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"metered"`

A driver's OWN inference spend, journaled separately from spawned-child work — the journal
 TWIN of `BudgetPool.observe`, exactly as `settled` is the twin of `reconcile`. So every
 journal-based cost reader sums it automatically — the journal is the single cost ledger.
 It carries spend only and is NOT a settlement: replay + `materializeTreeView` skip it for
 structure, and its `seq` lives outside the cursor-uniqueness namespace. A
 driver re-homes its nested subtree's metered total up to its parent (like settled spend),
 so summing any sub-tree root yields that sub-tree's true driver-inference cost.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### spend

> **spend**: [`Spend`](index.md#spend)

###### accountingOnly?

> `optional` **accountingOnly?**: `true`

Runtime bookkeeping only; this record carries no provider inference attempt.

###### providerModel?

> `optional` **providerModel?**: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence)

Runtime-owned provider attempt evidence for this driver's own inference turn.

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"edge"`; `id`: [`NodeId`](#nodeid-5); `edge`: \{ `kind`: `"delegates"` \| `"analyzes"`; `from`: `string`; `to`: `string`; `directive`: `string`; \}; `traversal`: `number`; `outcome`: `"delivered"` \| `"stripped"` \| `"empty"` \| `"unpropagated"`; `continuity?`: `"fresh"` \| `"resume"` \| `"steer"`; `bytes`: `number`; `reason?`: `string`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"edge"`

One GRAPH-EDGE traversal (`runGraph`): what the runtime actually DELIVERED across a
 delegates/analyzes edge, with byte counts — the observability that makes an edge's
 directive trustable and therefore optimizable. Informational: replay,
 `materializeTreeView`, and cost readers skip it; its `seq` is the per-run edge-ledger
 ordinal, outside the cursor-uniqueness namespace.

###### id

> **id**: [`NodeId`](#nodeid-5)

The destination node when known (a spawned worker's id), else `graph:<node>`.

###### edge

> **edge**: `object`

###### edge.kind

> **kind**: `"delegates"` \| `"analyzes"`

###### edge.from

> **from**: `string`

###### edge.to

> **to**: `string`

###### edge.directive

> **directive**: `string`

The resolved directive reference (`<surface>/v<n>`), never the directive bytes.

###### traversal

> **traversal**: `number`

1-based traversal ordinal for THIS edge within the run.

###### outcome

> **outcome**: `"delivered"` \| `"stripped"` \| `"empty"` \| `"unpropagated"`

###### continuity?

> `optional` **continuity?**: `"fresh"` \| `"resume"` \| `"steer"`

How the hop CONTINUED the node's work: spawn traversals stamp their effective mode
 (`'fresh'` = new session, `'resume'` = re-attached to the node's prior settled session),
 and every mid-run delivery into an already-live recipient — a driver steer leg and every
 analyzes delivery — stamps `'steer'`. Optional only so journals written before
 continuity stamping remain replayable; every new event carries it.

###### bytes

> **bytes**: `number`

Bytes of directive + payload that actually crossed the edge (0 for `empty`).

###### reason?

> `optional` **reason?**: `string`

Why a non-`delivered` outcome happened, when the runtime knows.

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"trace-unpropagated"`; `id`: [`NodeId`](#nodeid-5); `expectedTraceId`: `string`; `backend`: `string`; `reason`: `"no-env-channel"` \| `"no-worker-process"` \| `"caller-omitted"`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"trace-unpropagated"`

A spawned worker ran WITHOUT the run's trace context because its backend has no channel
 to carry one — the severed distributed-trace hop, journaled so a disconnected child trace
 is a queryable fact instead of a silent stranger tree. The child-side twin is the
 `tangle.trace.unpropagated=true` span attribute a fallback-minted root stamps.
 Informational: replay, `materializeTreeView`, and cost readers skip it; `seq` shares the
 spawn-ordinal namespace of the `spawned` event it annotates.

###### id

> **id**: [`NodeId`](#nodeid-5)

###### expectedTraceId

> **expectedTraceId**: `string`

The trace id the worker SHOULD have inherited.

###### backend

> **backend**: `string`

The worker-execution backend that has no propagation channel.

###### reason

> **reason**: `"no-env-channel"` \| `"no-worker-process"` \| `"caller-omitted"`

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

### RootSignal

> **RootSignal** = \{ `kind`: `"pause"`; \} \| \{ `kind`: `"resume"`; \} \| \{ `kind`: `"cancel"`; `reason?`: `string`; \} \| \{ `kind`: `"ask"`; `question`: `string`; \}

Out-of-band message to a running root. Open by intent — a client extends it.

***

### WaitSpec

> **WaitSpec** = \{ `kind`: `"timer"`; `untilMs`: `number`; \} \| \{ `kind`: `"poll"`; `probe`: `string`; `intervalMs`: `number`; `timeoutAtMs?`: `number`; `args?`: `Record`\<`string`, `unknown`\>; \}

What a wait node is waiting for. Both variants carry ABSOLUTE epoch-ms instants so a wait
 re-armed by a later process keeps the deadline the first process set.

#### Union Members

##### Type Literal

\{ `kind`: `"timer"`; `untilMs`: `number`; \}

###### kind

> `readonly` **kind**: `"timer"`

###### untilMs

> `readonly` **untilMs**: `number`

Absolute epoch ms to wake at. A past instant fires immediately.

***

##### Type Literal

\{ `kind`: `"poll"`; `probe`: `string`; `intervalMs`: `number`; `timeoutAtMs?`: `number`; `args?`: `Record`\<`string`, `unknown`\>; \}

###### kind

> `readonly` **kind**: `"poll"`

###### probe

> `readonly` **probe**: `string`

Name of the predicate in the run's `WaitProbeRegistry`. Named (not a closure) so a
 resumed process can re-resolve it — see the module header.

###### intervalMs

> `readonly` **intervalMs**: `number`

How often to re-run the predicate, in ms. Must be > 0.

###### timeoutAtMs?

> `readonly` `optional` **timeoutAtMs?**: `number`

Absolute epoch ms after which an unfired poll settles `timeout`. Omit = no timeout
 (then the run's own deadline is the only bound, and a run WITH a deadline refuses an
 unbounded poll — see `assertWaitWithinDeadline`).

###### args?

> `readonly` `optional` **args?**: `Record`\<`string`, `unknown`\>

Opaque JSON handed to the probe on every check. Journaled with the spec, so a resumed
 probe gets the same arguments.

***

### WaitProbe

> **WaitProbe** = (`args`, `signal`) => `boolean` \| `Promise`\<`boolean`\>

A named predicate a `poll` node re-checks. Returns true when the condition it watches has
flipped. A throw is treated as "not yet" (an unreachable CI endpoint is not a settled answer),
and is counted in the outcome's `probeErrors` so a probe that never works is visible rather
than silently polling forever.

#### Parameters

##### args

`Record`\<`string`, `unknown`\> \| `undefined`

##### signal

`AbortSignal`

#### Returns

`boolean` \| `Promise`\<`boolean`\>

***

### WaitRejection

> **WaitRejection** = `"invalid-spec"` \| `"unknown-probe"` \| `"deadline-exceeded"`

Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape.

***

### WorkerTraceResolver

> **WorkerTraceResolver** = (`spawningNodeId`) => [`TraceContext`](mcp.md#tracecontext-2) \| `undefined`

Resolve the trace context a worker spawned BY `spawningNodeId` should inherit. `undefined` means
this run records no spans, so nothing is stamped. Supplied by
`SupervisorSpanRecorder.workerTrace` and threaded to the scope as `SupervisorOpts.workerTrace`.

#### Parameters

##### spawningNodeId

`string`

#### Returns

[`TraceContext`](mcp.md#tracecontext-2) \| `undefined`

***

### WorktreePatchArtifact

> **WorktreePatchArtifact** = [`WorktreeHarnessResult`](#worktreeharnessresult)

Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 diff + the harness's run record + the derived checks).

***

### SurfaceReadOutcome

> **SurfaceReadOutcome** = \{ `succeeded`: `true`; `value`: `Uint8Array`; \} \| \{ `succeeded`: `false`; `missing`: `boolean`; `error`: `string`; \}

Outcome of reading one surface back at settle. `missing: true` means the path no longer exists
 (a deletion — a valid, reportable outcome); any other failure carries its diagnostic.

***

### SurfaceReader

> **SurfaceReader** = (`path`) => `Promise`\<[`SurfaceReadOutcome`](#surfacereadoutcome)\>

The read seam: fetch the current bytes at a mounted path. Implemented by a sandbox box's
 `fs.read`, a local worktree read ([fsSurfaceReader](#fssurfacereader)), or a test double.

#### Parameters

##### path

`string`

#### Returns

`Promise`\<[`SurfaceReadOutcome`](#surfacereadoutcome)\>

***

### SandboxControlClient

> **SandboxControlClient** = `Pick`\<`Sandbox`, `"create"` \| `"get"` \| `"list"`\>

***

### ToolLoopMessageRecord

> **ToolLoopMessageRecord** = `Record`\<`string`, `unknown`\>

Provider-neutral conversation record accepted by a tool-loop brain.

***

### ToolLoopChat

> **ToolLoopChat** = (`messages`, `tools`, `context?`) => `Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`ToolLoopToolCall`](#toollooptoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; `reasoning?`: `number`; \}; `costUsd?`: `number`; `costProvenance?`: `"provider-receipt"` \| `"billing-receipt"` \| `"catalog-estimate"`; `usageUnknown?`: `true`; `model?`: `string`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `transportAttempts?`: `number`; \}\>

One inference turn over the running conversation + the tool specs → the model's text, any
 tool calls, and token usage. The seam every brain satisfies.

#### Parameters

##### messages

`ReadonlyArray`\<[`ToolLoopMessageRecord`](#toolloopmessagerecord)\>

##### tools

`ReadonlyArray`\<[`ToolSpec`](#toolspec)\>

##### context?

[`ToolLoopCallContext`](#toolloopcallcontext)

#### Returns

`Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`ToolLoopToolCall`](#toollooptoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; `reasoning?`: `number`; \}; `costUsd?`: `number`; `costProvenance?`: `"provider-receipt"` \| `"billing-receipt"` \| `"catalog-estimate"`; `usageUnknown?`: `true`; `model?`: `string`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `transportAttempts?`: `number`; \}\>

***

### ToolLoopCompactionOptions

> **ToolLoopCompactionOptions** = `Omit`\<[`ToolLoopCompaction`](#toolloopcompaction), `"distill"`\> & `object`

Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional
 because the supervisor has a default digest that combines a brain note with live worker state.

#### Type Declaration

##### distill?

> `readonly` `optional` **distill?**: [`ToolLoopCompaction`](#toolloopcompaction)\[`"distill"`\]

***

### MountRecorder

> **MountRecorder** = (`entry`) => `void`

**`Stable`**

Records a mounted resource into the run's provenance manifest. Passed to
`prepareBox` so the caller — which owns the bytes it writes into the box —
declares what it mounted without the kernel having to inspect box contents.

#### Parameters

##### entry

[`MountManifestEntry`](#mountmanifestentry)

#### Returns

`void`

***

### LoopTraceEvent

> **LoopTraceEvent** = \{ `kind`: `"loop.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopStartedPayload`](#loopstartedpayload); \} \| \{ `kind`: `"loop.plan"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopPlanPayload`](#loopplanpayload); \} \| \{ `kind`: `"loop.iteration.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationStartedPayload`](#loopiterationstartedpayload); \} \| \{ `kind`: `"loop.iteration.dispatch"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationDispatchPayload`](#loopiterationdispatchpayload); \} \| \{ `kind`: `"loop.iteration.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationEndedPayload`](#loopiterationendedpayload); \} \| \{ `kind`: `"loop.decision"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopDecisionPayload`](#loopdecisionpayload); \} \| \{ `kind`: `"loop.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopEndedPayload`](#loopendedpayload); \} \| \{ `kind`: `"loop.teardown.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopTeardownFailedPayload`](#loopteardownfailedpayload); \}

**`Stable`**

***

### Shell

> **Shell** = (`args`, `cwd?`) => `Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

Command runner seam. Host code can use `localShell`; sandbox code can wrap `box.exec`.

#### Parameters

##### args

`ReadonlyArray`\<`string`\>

##### cwd?

`string`

#### Returns

`Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

***

### WorkspaceCommit

> **WorkspaceCommit** = \{ `ok`: `true`; `rev`: `string`; \} \| \{ `ok`: `false`; `conflict`: `string`; \}

## Variables

### DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS

> `const` **DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS**: `15000` = `15_000`

Default ceiling for a single `await_event` block (ms). Chosen well under any reasonable remote
 MCP client request timeout so the call returns a `pending` liveness snapshot instead of erroring;
 the supervisor re-polls until the worker settles.

***

### defaultAuditorInstruction

> `const` **defaultAuditorInstruction**: `string`

Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories.

***

### mcpSecretEnvMetadataKey

> `const` **mcpSecretEnvMetadataKey**: `"secretEnv"` = `'secretEnv'`

The `AgentProfileMcpServer.metadata` key the declarative secret-env map
 rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
 are resolved at materialize time and never stored.

***

### defaultAnalystInstruction

> `const` **defaultAnalystInstruction**: `string`

The default observer instruction — exported so an optimizer can seed its population.

***

### assertTraceDerivedFindings

> `const` **assertTraceDerivedFindings**: [`AssertTraceDerivedFindings`](#asserttracederivedfindings-1)

Reject analyst findings derived from evaluation scores instead of execution traces.

***

### builtinShapes

> `const` **builtinShapes**: [`ShapeRegistry`](#shaperegistry)

The default registry `runPersonified` resolves a shape name against. Empty by construction —
 a caller registers its own composed shapes; the engine ships no domain shape.

***

### TERMINAL\_DECISIONS

> `const` **TERMINAL\_DECISIONS**: readonly \[`"stop"`, `"pick-winner"`, `"fail"`, `"done"`\]

**`Stable`**

Decision values the kernel treats as terminal. Every other value returned by
`decide` continues the loop. Type a driver's `decide` return as
`'your-word' | TerminalDecision` so caller vocabulary and kernel keywords
stay visibly distinct.

***

### strategyAuthorContract

> `const` **strategyAuthorContract**: "\nYou author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to\nspend a compute budget to beat a task's deployable check. You compose exactly two steps:\n\n  shot(spec?: \{ handle?, messages?, steer?, persona?, tools? \}): Promise\<ShotResult \| null\>\n    Runs ONE worker attempt (a bounded tool loop) over an artifact.\n    - omit handle  =\> the shot opens its OWN fresh artifact and closes it after (a sample).\n    - pass handle  =\> the shot CONTINUES that artifact (state accumulates across shots).\n    - messages     =\> the carried conversation (pass the previous ShotResult.messages to continue).\n    - steer        =\> a corrective instruction injected before the shot.\n    - persona      =\> \{ systemPrompt?, model? \} — give THIS shot its own role and/or model\n      (multi-agent strategies: a researcher shot then an engineer shot, a panel of k\n      personas over one budget). On a fresh shot the systemPrompt replaces the task's; on\n      a carried conversation it arrives as a hand-off message. Same conserved budget.\n    - tools        =\> string\[\] — restrict THIS shot to a subset of the task's tools by\n      name (focus an explore shot on read-only tools, an execute shot on write tools).\n      Restriction-only; unknown names make the shot fail. ALWAYS select from\n      await listTools(handle) — never hardcode. Omitted =\> the shot sees every tool.\n    ShotResult = \{ messages, score (0..1 on the task's check), passes, total, completions, toolErrors \}\n    Returns null if the attempt failed infra-wise.\n\n  critique(messages): Promise\<string \| null\>\n    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective\n    instruction (or null when it judges the work complete). Costs ~1 completion.\n\n  consult(messages, instruction): Promise\<string \| null\>\n    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the\n    trajectory verbatim (no reformatting) — use it when you need a specific reply format\n    (a decision, a prediction). Costs ~1 completion.\n\n  surface.open(task) / surface.close(handle)\n    Open a persistent artifact you manage yourself (remember to close in a finally).\n    close is idempotent — closing an already-closed handle is a safe no-op.\n\n  listTools(handle): Promise\<Array\<\{ name, description? \}\>\>\n    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a\n    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding\n    names from an example kills your shots on every task whose tools differ.\n\nRules:\n- ALWAYS await every shot/critique/surface call — a floating promise that rejects\n  crashes the whole benchmark run.\n- Stay within ~budget total shots; every shot/critique spends from a conserved pool.\n- For a FRESH attempt OMIT \`messages\` entirely (never pass \`\[\]\` — an empty array is a\n  fresh conversation too, but be explicit). To CONTINUE, pass the previous\n  ShotResult.messages unchanged.\n- Return \{ score, resolved, completions, progression, shots \} — score = the BEST checkpoint\n  you reached (keep-best, never final-state), progression = score after each shot.\n- The module must be EXACTLY this shape (no other imports, no commentary outside code):\n\nimport \{ defineStrategy \} from '@tangle-network/agent-runtime/kernel'\nexport default defineStrategy('your-strategy-name', async (\{ surface, task, budget, shot, critique, listTools \}) =\> \{\n  // your composition (listTools comes from the destructured context — it is NOT a global)\n\})\n"

The compressed consumable a skill carries: everything an author needs to emit a loop.

***

### strategyAuthorSystemPrompt

> `const` **strategyAuthorSystemPrompt**: `string`

Standing behavior callers put in the strategy-author AgentProfile.

***

### sample

> `const` **sample**: [`Strategy`](#strategy-3)

Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample).

***

### refine

> `const` **refine**: [`Strategy`](#strategy-3)

Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage).

***

### adaptiveRefine

> `const` **adaptiveRefine**: [`Strategy`](#strategy-3)\<\{ `score`: `number`; `resolved`: `boolean`; `completions`: `number`; `progression`: `number`[]; `shots`: `number`; \}\>

A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 optimizations" path: a new technique, compact, with zero Supervisor ceremony.

***

### sampleThenRefine

> `const` **sampleThenRefine**: [`Strategy`](#strategy-3)\<\{ `score`: `number`; `resolved`: `boolean`; `completions`: `number`; `progression`: `number`[]; `shots`: `number`; \}\>

The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 then refine the best-verifying line with the remaining budget. Sample's basin escape +
 refine's accumulation — the third built-in, authored from the public steps.

***

### defaultStructuralRolloutPolicy

> `const` **defaultStructuralRolloutPolicy**: [`StructuralRolloutPolicy`](#structuralrolloutpolicy)

The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks.

***

### defaultProfileRichnessThresholds

> `const` **defaultProfileRichnessThresholds**: [`ProfileRichnessThresholds`](#profilerichnessthresholds)

Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt.

***

### defaultDelegateBudget

> `const` **defaultDelegateBudget**: [`Budget`](index.md#budget-4)

The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
 A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
 bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`.

***

### bestDelivered

> `const` **bestDelivered**: [`SupervisorFinalizer`](index.md#supervisorfinalizer)

Keep-best under the completion oracle — the DEFAULT finalizer and the exact behavior every
 existing caller had: the highest-scoring delivered child's output, `undefined` when nothing
 delivered (or the best delivered child carries no artifact).

***

### collectDelivered

> `const` **collectDelivered**: [`SupervisorFinalizer`](index.md#supervisorfinalizer)

Every verified distinct output, highest score first — the shape for competing hypotheses, a
Pareto front, or a recorded evaluator split (three judges 2:1 → both outputs survive, with
provenance, instead of the minority report being erased). Distinct by `outRef` (content
address), so identical outputs collapse to one entry. `undefined` when nothing delivered —
an empty collection is a no-winner, not a winner wrapping `[]`.

***

### defaultEdgeTraversalCap

> `const` **defaultEdgeTraversalCap**: `32` = `32`

Default per-edge traversal cap — the cyclic-graph backstop when an edge names none.

***

### DEFAULT\_PEER\_MAIL\_LIMITS

> `const` **DEFAULT\_PEER\_MAIL\_LIMITS**: [`PeerMailLimits`](#peermaillimits)

Bounds chosen so a peer channel cannot become the dominant cost of a run: eight sends and
 sixteen receives per worker, 32 KiB of received body, and a reply chain that terminates.

***

### AUTHORITY\_MARKERS

> `const` **AUTHORITY\_MARKERS**: `ReadonlyArray`\<`string`\>

Phrases that mark the run's AUTHORITY in a folded prompt. A peer that writes one of these is
trying to speak as the supervisor, so intake refuses the envelope outright.

The render-time fence in the inbox is the second half of this defence and neither half is
sufficient alone: a fence loses to a body that closes it, and an intake filter loses to a body
that invents a new authority phrase. Together they make forgery mechanically detectable and give
the standing prompt one concrete boundary to bind to. Neither makes a model OBEY a boundary.

***

### PEER\_MAIL\_WIRE\_KEY

> `const` **PEER\_MAIL\_WIRE\_KEY**: `"mail"` = `'mail'`

The wire property carrying an envelope to a worker inbox. Deliberately its OWN discriminant:
 reusing `steer`/`answer` would let a peer mint a message on the parent's channels.

***

### peerMailVerbNames

> `const` **peerMailVerbNames**: readonly \[`"send_mail"`, `"read_mail"`\]

The tool names a mail capability endpoint serves. It serves NOTHING else.

***

### DEFAULT\_STALL\_AFTER\_MS

> `const` **DEFAULT\_STALL\_AFTER\_MS**: `180000` = `180_000`

How long a worker may produce no metered activity before a `progress()` read calls it stalled.
 Deliberately generous: a coding harness routinely spends minutes inside one tool call, and a
 false stall that provokes a steer is worse than a late one.

***

### supervisorPolicyPrompt

> `const` **supervisorPolicyPrompt**: [`RegisteredPrompt`](#registeredprompt)

THE supervisor policy — one stance, both front doors. The work-vs-delegate rule is conditional
on capability (work tools present or not), which is what dissolves the old contradiction: "do
small work yourself" was written for a supervisor WITH work tools, "you do not do the work" for
one WITHOUT — one policy states both branches explicitly.

***

### delegatesWorkerBriefPrompt

> `const` **delegatesWorkerBriefPrompt**: [`RegisteredPrompt`](#registeredprompt)

Default DELEGATES-edge directive: the standing instruction a worker receives with every
traversal of a delegates edge that names this surface. Seeded from the bounded-brief knowledge
in the supervisor policy, phrased for the RECEIVING side of the edge.

***

### analyzesFindingsReportPrompt

> `const` **analyzesFindingsReportPrompt**: [`RegisteredPrompt`](#registeredprompt)

Default ANALYZES-edge directive: what the RECEIVING node should do with an analyst's findings.
Wrapped around the findings payload on every traversal of an analyzes edge naming this surface.

***

### naiveContinuationPrompt

> `const` **naiveContinuationPrompt**: [`RegisteredPrompt`](#registeredprompt)

Default NAIVE steering continuation — the no-signal control re-expressed as data: the same
fixed continuation every round, reading nothing from any verdict.

***

### dumbContinuationFailPrompt

> `const` **dumbContinuationFailPrompt**: [`RegisteredPrompt`](#registeredprompt)

Default DUMB steering continuations — the pass/fail-only control re-expressed as data: two
fixed texts keyed on the verdict's boolean and nothing else.

***

### dumbContinuationPassPrompt

> `const` **dumbContinuationPassPrompt**: [`RegisteredPrompt`](#registeredprompt)

The pass branch of the dumb steering control — see [dumbContinuationFailPrompt](#dumbcontinuationfailprompt).

***

### cliWorktreeExecutor

> `const` **cliWorktreeExecutor**: [`ExecutorFactory`](#executorfactory)\<`unknown`\>

The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
`AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.

***

### DEFAULT\_SANDBOX\_STEERING\_MAX\_TURNS

> `const` **DEFAULT\_SANDBOX\_STEERING\_MAX\_TURNS**: `24` = `24`

Ceiling on continuation turns. Turn 0 is the task; every later turn is a folded steer, so
 this bounds how many times a supervisor may redirect ONE worker before it must respawn.

***

### DEFAULT\_AUTHORED\_PROFILE\_SECURITY\_POLICY

> `const` **DEFAULT\_AUTHORED\_PROFILE\_SECURITY\_POLICY**: `AgentProfileSecurityPolicy`

Manager-authored profiles are untrusted until product policy says otherwise. Remote MCP and
ambient connection grants therefore fail closed by default, in addition to local MCP and hooks.

***

### WORKER\_TOOL\_TRACE\_SCHEMA\_VERSION

> `const` **WORKER\_TOOL\_TRACE\_SCHEMA\_VERSION**: `1`

Schema version for content-addressed worker tool-trace artifacts.

***

### EVIDENCE\_MAX\_CHARS

> `const` **EVIDENCE\_MAX\_CHARS**: `3000` = `3000`

Hard cap on one worker's evidence block so the brain's context cannot blow up.

***

### VERIFY\_TAIL\_CHARS

> `const` **VERIFY\_TAIL\_CHARS**: `1200` = `1200`

Tail of the verify output — the failing assertion lives at the END of a test log.

***

### NOTE\_MAX\_CHARS

> `const` **NOTE\_MAX\_CHARS**: `300` = `300`

Cap on the worker's closing note inside the evidence block.

***

### workerTraceSeamKey

> `const` **workerTraceSeamKey**: `"worker-trace"` = `'worker-trace'`

Seam key the `Scope` seeds a [TraceContext](mcp.md#tracecontext-2) under on each child's `ExecutorContext.seams`.
Single-sourced here so the scope and every backend agree on it without a circular import — the
same arrangement `nestedScopeSeamKey` uses.

## Functions

### contentAddress()

> **contentAddress**(`artifact`): `string`

Stable content address shared by result and trace artifacts.

#### Parameters

##### artifact

`unknown`

#### Returns

`string`

***

### loadSpawnForest()

> **loadSpawnForest**(`journal`, `root`): `Promise`\<[`SpawnForest`](#spawnforest)\>

Load every journal tree owned by one recursive supervision run and flatten its nodes/events.

Nested driver tree keys are a Runtime implementation detail; callers should use this reader
instead of deriving or scanning keys themselves. The reader follows only the explicit
`ownedTreeRoot` written after Runtime privately attested a recursive executor; the open runtime
string `driver` is never treated as ownership. Legacy records without `ownedTreeRoot` are
intentionally treated as leaves rather than guessing or scanning convention-derived keys.
This preserves each tree's independent cursor namespace on flattened events.
A driver whose subtree was never begun is reported in `missingTrees`; any spawned non-root node
without a terminal record is reported in `inDoubt`, matching resume's conservative lost-work
interpretation.

This is a cold/quiescent reader, not a transaction across an actively mutating file. Every value
returned is a detached immutable snapshot, so later journal writes or caller mutation cannot
change the result already observed.

#### Parameters

##### journal

[`SpawnJournal`](#spawnjournal)

##### root

`string`

#### Returns

`Promise`\<[`SpawnForest`](#spawnforest)\>

***

### replaySpawnTree()

> **replaySpawnTree**(`journal`, `blobs`, `root`): `Promise`\<[`Settled`](index.md#settled)\<`unknown`\>[]\>

**`Stable`**

Re-feed a journaled spawn tree in strict `seq` order, rehydrating each settled
child's `out` from the blob store by `outRef`, and return the `Settled[]` exactly
as `scope.next()` originally delivered them.

Determinism (B2): the events are sorted by `seq` BEFORE any blob `get`, so the
replay order is the recorded cursor order regardless of how fast each rehydration
resolves. `at` (wall-clock) is never a replay input. Fail loud on a tree that was
never begun, a settled-done event missing its `outRef`, or a blob the store can't
rehydrate — a silent gap would let `act` branch on the wrong evidence.

#### Parameters

##### journal

[`SpawnJournal`](#spawnjournal)

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### root

`string`

#### Returns

`Promise`\<[`Settled`](index.md#settled)\<`unknown`\>[]\>

***

### materializeTreeView()

> **materializeTreeView**(`events`): [`TreeView`](#treeview)

Materialize a recorded `TreeView` from a journaled event list for inspection. Folds
`spawned`/`settled`/`cancelled` into a per-node snapshot in `seq` order, then adds each
`metered` event's driver-inference spend onto its node in a separate additive pass so the view
matches the recorded cursor. It does not recover live executors or driver state after restart.

#### Parameters

##### events

[`SpawnEvent`](#spawnevent)[]

#### Returns

[`TreeView`](#treeview)

***

### pendingWaits()

> **pendingWaits**(`events`): [`PendingWait`](#pendingwait)[]

The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the
ORIGINAL absolute deadline. Reading it from the journal (rather than from any live state) is
what makes "SIGKILL a waiting tree, a new process keeps waiting to the same instant" true.

#### Parameters

##### events

[`SpawnEvent`](#spawnevent)[]

#### Returns

[`PendingWait`](#pendingwait)[]

***

### canonicalFindingEvent()

> **canonicalFindingEvent**(`finding`): [`AnalystFindingEvent`](#analystfindingevent)

Producer-side cleanliness for the `finding` event. The findings payload is arbitrary analyst
 output, the digest a subscriber computes (RFC 8785) throws on ANY `undefined` value — nested
 included — and a throwing subscriber leaves the event invisible to EVERY subscriber. The
 producer, not the digest, owns keeping the event canonical: an `undefined` payload is stripped
 to key-absence, everything else is JSON round-tripped (nested `undefined` object values drop,
 `undefined` array slots become `null`), and a payload JSON cannot represent at all (cycle,
 BigInt, bare function) becomes a record OF that fact — degraded findings beat a vanished
 event.

#### Parameters

##### finding

[`AnalystFindingEvent`](#analystfindingevent)

#### Returns

[`AnalystFindingEvent`](#analystfindingevent)

***

### normalizeAnalyzeOnSettle()

> **normalizeAnalyzeOnSettle**(`entry`): [`AnalyzeOnSettleRoute`](#analyzeonsettleroute)

Normalize the two spellings of an analyst-on-settle entry to the route form.

#### Parameters

##### entry

`string` \| [`AnalyzeOnSettleRoute`](#analyzeonsettleroute)

#### Returns

[`AnalyzeOnSettleRoute`](#analyzeonsettleroute)

***

### bestSoFar()

> **bestSoFar**(`values`): `number`[]

The best-so-far fold — the ONE definition of "how good was the run after k results", shared by
the post-run anytime report below and by the LIVE progress-based stop rules
(`supervise/stop-rules.ts`). Given the observed objective per settled result in order, it returns
the running maximum. A result with no objective (`undefined` — it failed, or it was never
scored) carries the previous best forward rather than resetting it.

It is extracted rather than duplicated on purpose: a stop rule that decides a run has plateaued
must agree, number for number, with the report that later says whether stopping was right.

#### Parameters

##### values

readonly (`number` \| `undefined`)[]

#### Returns

`number`[]

***

### areaUnderCurve()

> **areaUnderCurve**(`curve`): `number`

Mean of a best-so-far curve — the anytime AUC when the curve is normalized to [0,1]. Higher =
 the run climbed earlier. Shared with the stop rules so "improving" means one thing.

#### Parameters

##### curve

readonly `number`[]

#### Returns

`number`

***

### plateauLength()

> **plateauLength**(`curve`, `minDelta`): `number`

How many trailing entries of a best-so-far curve are within `minDelta` of the curve's value
`window` steps back — i.e. the length of the current PLATEAU, in settles. `0` means the most
recent settle improved the best by more than `minDelta`.

The plateau math the live stop rules read. Defined here, beside the report that measures whether
the plateau was real, so there is exactly one notion of "not improving".

#### Parameters

##### curve

readonly `number`[]

##### minDelta

`number`

#### Returns

`number`

***

### anytimeReport()

> **anytimeReport**(`spans`, `opts?`): [`AnytimeReport`](#anytimereport)

Derive anytime metrics from waterfall spans. `targets` are the satisficing score
 bars (default [1] = fully resolved; COCO-style multi-target: [0.5, 0.8, 1]);
 `targetFor` overrides the bar per task (task-specific satisfaction) — when set, the
 per-task bar replaces every entry of `targets` for that task.

#### Parameters

##### spans

[`WaterfallSpan`](#waterfallspan)[]

##### opts?

###### targets?

`number`[]

###### targetFor?

(`taskId`) => `number`

#### Returns

[`AnytimeReport`](#anytimereport)

***

### renderAnytimeTable()

> **renderAnytimeTable**(`report`): `string`

One row per (strategy, satisficing target): the shareable time-to-satisfactory table.

#### Parameters

##### report

[`AnytimeReport`](#anytimereport)

#### Returns

`string`

***

### auditIntent()

> **auditIntent**(`input`, `opts`): `Promise`\<[`IntentAudit`](#intentaudit)\>

The route-rigor analyst: compare declared vs revealed vs user intent over a trajectory and return aligned / drifting / diverged with evidence and one recommended intervention.

#### Parameters

##### input

[`AuditIntentInput`](#auditintentinput)

##### opts

[`AuditIntentOptions`](#auditintentoptions)

#### Returns

`Promise`\<[`IntentAudit`](#intentaudit)\>

***

### leaderboard()

> **leaderboard**(`records`, `opts?`): [`Leaderboard`](#leaderboard)

Aggregate a fleet of records into the ranked, multi-axis report. Pure — no IO, deterministic.

#### Parameters

##### records

readonly `RunRecord`[]

##### opts?

[`LeaderboardOptions`](#leaderboardoptions) = `{}`

#### Returns

[`Leaderboard`](#leaderboard)

***

### pairwiseSignificance()

> **pairwiseSignificance**(`records`, `opts?`): [`PairwiseVerdict`](#pairwiseverdict)[]

Compare EVERY profile pair on the scenarios they both ran — paired-bootstrap effect + CI, a real
 paired-test p-value, BH-corrected across all pairs. This is the honest "did A beat B" table the
 leaderboard's point ranking cannot answer. Reuses the agent-eval statistics substrate.

#### Parameters

##### records

readonly `RunRecord`[]

##### opts?

[`PairwiseOptions`](#pairwiseoptions) = `{}`

#### Returns

[`PairwiseVerdict`](#pairwiseverdict)[]

***

### renderLeaderboardMarkdown()

> **renderLeaderboardMarkdown**(`report`): `string`

Render the report as a publishable Markdown document: provenance → leaderboard → the full profile×axis
 matrix → cost/latency/token columns. Every axis is shown — a curated subset is a reporting failure.

#### Parameters

##### report

[`Leaderboard`](#leaderboard)

#### Returns

`string`

***

### renderPairwiseMarkdown()

> **renderPairwiseMarkdown**(`verdicts`, `title?`): `string`

Render the pairwise-significance table — every profile pair's paired delta, CI, and BH-corrected
 verdict. Feed it `pairwiseSignificance(records)`. This is the "did A really beat B" evidence the point
 ranking cannot give.

#### Parameters

##### verdicts

readonly [`PairwiseVerdict`](#pairwiseverdict)[]

##### title?

`string` = `'Pairwise significance (paired, BH-corrected)'`

#### Returns

`string`

***

### renderLeaderboardSvg()

> **renderLeaderboardSvg**(`report`): `string`

Render a self-contained SVG: a ranked score bar chart on top, the profile×axis heatmap below. No deps,
 embeddable anywhere (README, HTML page, hosted leaderboard).

#### Parameters

##### report

[`Leaderboard`](#leaderboard)

#### Returns

`string`

***

### renderLeaderboardHtml()

> **renderLeaderboardHtml**(`report`): `string`

Render a self-contained HTML leaderboard page (the hosted surface): the SVG charts + the full Markdown
 matrix as a table. Single file, no assets, opens in any browser.

#### Parameters

##### report

[`Leaderboard`](#leaderboard)

#### Returns

`string`

***

### completionAuthorizes()

> **completionAuthorizes**(`v`, `policy?`): `boolean`

Decide whether a `CompletionVerdict` may end the node under the policy: authority scales with the verdict's determinism, and probabilistic verdicts must clear `minConfidence`.

#### Parameters

##### v

[`CompletionVerdict`](#completionverdict)

##### policy?

[`CompletionPolicy`](#completionpolicy)

#### Returns

`boolean`

***

### stopSentinel()

> **stopSentinel**(`seed`): `string`

A unique, attributable stop sentinel for a node (ralph-loop style). Deterministic from the
seed (no Math.random — reproducible + attributable to the node); the agent is instructed to
emit it VERBATIM when it judges itself done. Unguessable enough that content never trips it.

#### Parameters

##### seed

`string`

#### Returns

`string`

***

### sentinelCompletion()

> **sentinelCompletion**\<`Task`\>(`sentinel`, `opts?`): [`CompletionAnalyst`](#completionanalyst)\<`Task`, `string`\>

Completion for a sandbox-agent node: done iff the latest output carries the node's stop
sentinel. PROBABILISTIC (the agent's own self-judgment) — the driver validates it.

#### Type Parameters

##### Task

`Task`

#### Parameters

##### sentinel

`string`

##### opts?

###### confidence?

`number`

#### Returns

[`CompletionAnalyst`](#completionanalyst)\<`Task`, `string`\>

***

### deterministicCompletion()

> **deterministicCompletion**\<`Task`, `Output`\>(`check`): [`CompletionAnalyst`](#completionanalyst)\<`Task`, `Output`\>

Completion for a DETERMINISTIC check (build/test/lint/citation/proof): done iff the check
passes. Ground truth — the driver ends directly, no validation. The check reads the output
(a verifier), never the judge verdict — selector ≠ judge stays intact.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Parameters

##### check

(`output`, `history`) => `object`

#### Returns

[`CompletionAnalyst`](#completionanalyst)\<`Task`, `Output`\>

***

### defineLeaderboard()

> **defineLeaderboard**\<`TCase`, `TArtifact`\>(`spec`): [`DefinedLeaderboard`](#definedleaderboard)\<`TCase`, `TArtifact`\>

Assemble a declarative spec (`cases` + `prompt` + `score`) into a runnable
harness×model leaderboard — `run()` executes the matrix, `toBenchmarkAdapter()`
exposes the same domain as a structural `BenchmarkAdapter`.

#### Type Parameters

##### TCase

`TCase`

##### TArtifact

`TArtifact` = `string`

#### Parameters

##### spec

[`LeaderboardSpec`](#leaderboardspec)\<`TCase`, `TArtifact`\>

#### Returns

[`DefinedLeaderboard`](#definedleaderboard)\<`TCase`, `TArtifact`\>

***

### harvestCorpus()

> **harvestCorpus**(`opts`): `Promise`\<[`HarvestReport`](#harvestreport)\>

Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel.

#### Parameters

##### opts

[`HarvestCorpusOptions`](#harvestcorpusoptions)

#### Returns

`Promise`\<[`HarvestReport`](#harvestreport)\>

***

### inProcessSandboxClient()

> **inProcessSandboxClient**(`options`): [`SandboxClient`](#sandboxclient-5)

**`Experimental`**

Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for
`runAgentRounds` / `openSandboxRun`. Returns a PROPERLY-TYPED `SandboxClient`: the
lone `SandboxInstance` cast (object literal → `declare class`) lives inside
this function, so call sites stay cast-free.

#### Parameters

##### options

[`InProcessSandboxClientOptions`](#inprocesssandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-5)

***

### inlineSandboxClient()

> **inlineSandboxClient**(`factory`, `defaults?`): [`SandboxClient`](#sandboxclient-5)

Adapt an `ExecutorFactory` into a `SandboxClient` for `runAgentRounds`. The factory is
instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
run once on the prompt, emit the terminal result event, tear down.

#### Parameters

##### factory

[`ExecutorFactory`](#executorfactory)\<`unknown`\>

##### defaults?

###### profile?

`AgentProfile`

#### Returns

[`SandboxClient`](#sandboxclient-5)

***

### envKeyProvider()

> **envKeyProvider**(`env?`): [`KeyProvider`](#keyprovider)

The env-backed provider: reads the (dotenvx-loaded) process env. Empty /
 whitespace-only values count as absent — fail loud, not with a blank key.

#### Parameters

##### env?

`Record`\<`string`, `string` \| `undefined`\> = `process.env`

#### Returns

[`KeyProvider`](#keyprovider)

***

### secretEnvOfMcpServer()

> **secretEnvOfMcpServer**(`server`): `Record`\<`string`, `string`\> \| `undefined`

Read (and validate) a server entry's declared secret-env map, if any.
 Malformed metadata throws — a half-declared secret must never half-boot.

#### Parameters

##### server

`AgentProfileMcpServer`

#### Returns

`Record`\<`string`, `string`\> \| `undefined`

***

### resolveSecretEnv()

> **resolveSecretEnv**(`secretEnv`, `keys`, `label`): `Promise`\<`Record`\<`string`, `string`\>\>

Resolve a declared secret-env map into the real env entries for a server
spawn. Fail-closed: no provider or a missing key throws, naming the KEY
NAME only (the value never appears in any message). `label` names the
server for the error (e.g. `profile.mcp['exa']`).

#### Parameters

##### secretEnv

`Record`\<`string`, `string`\>

##### keys

[`KeyProvider`](#keyprovider) \| `undefined`

##### label

`string`

#### Returns

`Promise`\<`Record`\<`string`, `string`\>\>

***

### resolveMcpServerLaunch()

> **resolveMcpServerLaunch**(`server`, `keys`, `label`): `Promise`\<[`ResolvedMcpServerLaunch`](#resolvedmcpserverlaunch)\>

Resolve a profile MCP server's `args`/`env` config values (interface ≥0.40
`AgentProfileConfigValue`) plus the legacy `metadata.secretEnv` channel into
the plain strings a spawn needs.

Rules, all fail-closed:
- `args` must be public values. A secret-ref in argv is refused: argv is
  readable by every host process (/proc/PID/cmdline) and outside the
  protected-value redaction channel, so a secret there cannot be contained.
- `env` secret-refs resolve through the KeyProvider (missing provider or key
  throws, naming the KEY NAME only) and land in `protectedEnv`.
- An env var declared secret on BOTH channels (env secret-ref and
  metadata.secretEnv) is ambiguous configuration and throws.
- A public `env` entry shadowed by a legacy metadata secret keeps the
  pre-0.40 spawn precedence: the secret value wins in the child env.

#### Parameters

##### server

`AgentProfileMcpServer`

##### keys

[`KeyProvider`](#keyprovider) \| `undefined`

##### label

`string`

#### Returns

`Promise`\<[`ResolvedMcpServerLaunch`](#resolvedmcpserverlaunch)\>

***

### localSandboxClient()

> **localSandboxClient**(`opts`): [`SandboxClient`](#sandboxclient-5)

A same-host `SandboxClient` adapter with no process isolation. Local MCP is
refused unless the caller explicitly supplies a policy that allows it.

#### Parameters

##### opts

[`LocalSandboxClientOptions`](#localsandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-5)

***

### superviseDispatch()

> **superviseDispatch**\<`TScenario`, `TArtifact`\>(`opts`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Run one recursive supervised tree inside Eval's pre-execution paid-call lifecycle.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### opts

[`SuperviseDispatchOptions`](#supervisedispatchoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

***

### loopCampaignDispatch()

> **loopCampaignDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `DispatchFn`\<`TScenario`, `TArtifact`\>

Adapter for plain `runCampaign` scenarios. This is the Runtime-side pair for
agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
the Runtime cell here, and keep paid-call admission, receipts, and traces
automatic.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### opts

[`LoopCampaignDispatchOptions`](#loopcampaigndispatchoptions)\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>

#### Returns

`DispatchFn`\<`TScenario`, `TArtifact`\>

***

### loopDispatch()

> **loopDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Adapter for `runProfileMatrix` (profile is an axis). Returns a
`ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell
inside Eval's paid-call lifecycle.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### opts

[`LoopDispatchOptions`](#loopdispatchoptions)\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>

#### Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

***

### sanitizeMcpToolSchema()

> **sanitizeMcpToolSchema**(`s`): `Record`\<`string`, `unknown`\>

Coerce an MCP inputSchema to an OpenAI-tool-valid top-level object schema.
 Shared with the same-host stdio client (`materializeLocalMcp`) — one coercion
 rule for every MCP tool a worker sees, regardless of transport.

#### Parameters

##### s

`unknown`

#### Returns

`Record`\<`string`, `unknown`\>

***

### createMcpEnvironment()

> **createMcpEnvironment**(`opts`): [`AgenticSurface`](#agenticsurface)

Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks.

#### Parameters

##### opts

[`McpEnvironmentOptions`](#mcpenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### observe()

> **observe**(`input`, `opts`): `Promise`\<[`Observation`](#observation)\>

The third-person trace analyst: read a worker's trace and produce steer findings for the next attempt plus durable `learned` facts for the cross-run corpus.

#### Parameters

##### input

[`ObserveInput`](#observeinput)

##### opts

[`ObserveOptions`](#observeoptions)

#### Returns

`Promise`\<[`Observation`](#observation)\>

***

### renderReport()

> **renderReport**(`findings`): `string`

Operator-facing report, split by who should act. The agent block is the
 steer; the operator block is the advice.

#### Parameters

##### findings

readonly `AnalystFinding`[]

#### Returns

`string`

***

### createScopeAnalyst()

> **createScopeAnalyst**\<`D`\>(`scope`, `options`): [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Build a `ScopeAnalyst` that spawns the analyst agent through `Scope.spawn` (so its compute is
metered by the conserved pool), drains its single settlement, and enforces the trace-derived
firewall before returning. The `scope` is the SAME scope the combinator is draining its children
from — the analyst is spawned as a sibling and its result is read off `scope.next()` in cursor
order, replay-safe like any other child.

Fail loud (no silent empty findings):
 - the pool refuses the analyst spawn → `AnalystError` (the steer would otherwise run on nothing)
 - the analyst settles `down` → `AnalystError` (a broken capture path, not a verdict)
 - the analyst returns a non-array → `PlannerError`
 - any finding cites judge-derived metric evidence → `PlannerError` via the firewall

#### Type Parameters

##### D

`D`

#### Parameters

##### scope

[`Scope`](index.md#scope)\<[`Outcome`](#outcome-2)\<`D`\>\>

##### options

[`CreateScopeAnalystOptions`](#createscopeanalystoptions)\<`D`\>

#### Returns

[`ScopeAnalyst`](#scopeanalyst)\<`D`\>

***

### registryScopeAnalyst()

> **registryScopeAnalyst**\<`D`\>(`registry`, `buildInputs`): [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

A `ScopeAnalyst` backed by an `AnalystRegistry` — the panel-of-analysts seam. The registry merges
N analyst KINDS into one `AnalystRunResult.findings`; `analyze` runs it over the caller-projected
`{ runId, inputs }` and pipes the merged findings through the SAME `assertTraceDerivedFindings`
firewall `createScopeAnalyst` uses (single-sourced selector≠judge). Distinct from `panel()`
(judges-vs-one-artifact) — this is analysts-over-a-trace, the diagnosis side of the wire.

Fail loud: a registry that throws propagates; a judge-derived finding aborts via the firewall.
The projection is the caller's (`buildInputs`) — if the scope settlements do not cleanly map to
the registry's `AnalystRunInputs`, that is a caller-side contract gap, surfaced there, not papered
over with a fabricated input here.

#### Type Parameters

##### D

`D`

#### Parameters

##### registry

[`AnalystRegistryLike`](analyst-loop.md#analystregistrylike)

##### buildInputs

(`input`) => [`RegistryAnalyzeProjection`](#registryanalyzeprojection)

#### Returns

[`ScopeAnalyst`](#scopeanalyst)\<`D`\>

***

### buildSteerContext()

> **buildSteerContext**\<`D`\>(`findings`, `settledSoFar`): [`SteerContext`](#steercontext)\<`D`\>

Build the `SteerContext` a combinator reads to steer (its `loopUntil.until`, `widen` gate, any
future steer). One place enforces the firewall: `findings` is asserted trace-derived before it is
surfaced, and `lastValidScore` is provided for OBSERVABILITY only — a combinator that steers off
it re-introduces selector = judge, the coupling the architecture forbids.

`findings` is re-asserted here even when it came from `createScopeAnalyst` (which already asserted
it): the assertion is cheap and idempotent, and a `SteerContext` may be built from findings that
arrived by another path (a caller-supplied diagnosis). Belt-and-suspenders on the one coupling
that must never leak.

#### Type Parameters

##### D

`D`

#### Parameters

##### findings

readonly `AnalystFinding`[]

##### settledSoFar

readonly [`Settled`](index.md#settled)\<[`Outcome`](#outcome-2)\<`D`\>\>[]

#### Returns

[`SteerContext`](#steercontext)\<`D`\>

***

### selectValidWinner()

> **selectValidWinner**\<`D`\>(`opts?`): [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

The single content-free valid-only winner selector. Among the gated-VALID children only
(`verdict.valid === true`), pick by `strategy` — best score / smallest delivered artifact /
earliest — ties broken by earliest index; returns `undefined` when NONE is valid (an ungated
output can never win — the deliverable gate is the point). `sizeOf` (for `'smallest-artifact'`)
reads the child's settled deliverable — the raw value a leaf settles, or the unwrapped `Outcome<D>`
a delegate path produces; a domain passes e.g. patch diff-lines. This is the de-duplicated home of
the selection logic previously copied per role.

#### Type Parameters

##### D

`D`

#### Parameters

##### opts?

###### strategy?

[`WinnerStrategy`](#winnerstrategy)

###### sizeOf?

(`deliverable`) => `number`

#### Returns

[`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

***

### pipeline()

> **pipeline**\<`Task`, `D`\>(`stages`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`pipeline(stages)` — run the stages in order, feeding each stage's `done` deliverable into the
next stage's task. The first stage that ends `blocked` (a child that went down, a child the
pool would not admit, or a stage whose `collect` chose to block) short-circuits — its blockers
ARE the pipeline's blockers, never coerced past a failed stage. The terminal stage's `done`
deliverable is the pipeline's deliverable.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### stages

readonly [`PipelineStage`](#pipelinestage)\<`Task`, `unknown`, `unknown`\>[]

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### fanout()

> **fanout**\<`Task`, `Item`, `D`\>(`items`, `opts`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
single-sourced selector. A round that admitted zero children, or whose synthesis child could
not be admitted, is a concrete blocker.

`opts.width` swaps the single round for `rollingDispatch`: at most `width` items live at once,
refilled the instant one settles. Selection, blockers, and the conserved pool are unchanged —
the refill behavior lives in the existing combinator rather than in a rival primitive.

#### Type Parameters

##### Task

`Task`

##### Item

`Item`

##### D

`D`

#### Parameters

##### items

readonly `Item`[]

##### opts

[`FanoutOptions`](#fanoutoptions)\<`Item`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### loopUntil()

> **loopUntil**\<`Task`, `State`, `D`\>(`seed`, `spec`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`loopUntil(seed, spec)` — one `step` child per round; `fold` accumulates each settlement into
the running state; `until` (reading the round's trace findings, NOT a fresh raw verdict) is
the deployable stop. The conserved pool IS the loop bound: once `spawn` fails closed the loop
stops. A loop that exhausted the pool without `until` ever satisfying is a concrete blocker.

When `ctx.analyst` is set, each round runs it over the children settled so far and steers
`until` on the resulting trace-derived findings (the analyst spawns into THIS scope, so its
compute is conserved-pooled — equal-k holds by construction). Absent an analyst the findings
argument is the empty array — never a fabricated finding (fail-loud honesty over a silent default).

#### Type Parameters

##### Task

`Task`

##### State

`State`

##### D

`D`

#### Parameters

##### seed

`State`

##### spec

[`LoopUntilSpec`](#loopuntilspec)\<`Task`, `State`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### panel()

> **panel**\<`Task`, `Artifact`, `D`\>(`spec`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`panel(spec)` — spawn the M judge children over the SAME artifact, drain their settlements,
and fold them into a panel verdict via the pure WRITE-ONLY `merge` (a judge's output never
reaches another judge's task; the merge never spawns or re-ranks). A `down` judge carries no
verdict and is excluded from the merge denominator. A panel that admitted no judge is a
concrete blocker before `merge` is consulted.

#### Type Parameters

##### Task

`Task`

##### Artifact

`Artifact`

##### D

`D`

#### Parameters

##### spec

[`PanelSpec`](#panelspec)\<`Artifact`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### verify()

> **verify**\<`Task`, `Candidate`, `D`\>(`spec`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`verify(spec)` — an IMPLEMENT child produces a candidate, then a SEPARATE VERIFIER child grades
it; only a `valid` verifier verdict ships. Any other outcome (implement down, verifier down,
verifier verdict absent or not `valid`) is a concrete blocker carrying the failure verbatim —
never a coerced "done". The implement child does not grade itself.

#### Type Parameters

##### Task

`Task`

##### Candidate

`Candidate`

##### D

`D`

#### Parameters

##### spec

[`VerifySpec`](#verifyspec)\<`Task`, `Candidate`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### widen()

> **widen**\<`Task`, `Seed`, `D`\>(`spec`): [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

**`Stable`**

`widen(spec)` — the streaming spawn-on-completion driver. Spawns the seed lineages, then REACTS
to each `scope.next()`: on every settled child it consults `spec.gate.decide` and, when the gate
returns `widen`, spawns AT MOST ONE more child toward the chosen lineage under the remaining
conserved pool. `promising` is derived from the round's trace findings (the analyst seam),
never a child's raw `verdict` — and the default gate (`flatWidenGate`) never widens, so the R2
firewall stays dormant. Terminal selection is `spec.synthesize` over every settled lineage.

When `ctx.analyst` is set, `decide` is consulted with that round's trace-derived findings;
absent an analyst the findings argument is the empty array a flat gate ignores. The analyst
spawns into THIS scope (conserved-pooled, so equal-k holds). Streaming caveat: a wired analyst
drains its own child off the SHARED cursor by id-match, so on a NON-flat gate (which spawns
widen children that are live concurrently) the analyst can consume a sibling's settlement before
the widen loop sees it. The shipped default (`flatWidenGate`) never widens, so no widen child is
ever live when the analyst runs and the wire is exact; a non-flat gate must drive the analyst on
a scope whose siblings are quiesced, or read findings without the shared-cursor drain.

#### Type Parameters

##### Task

`Task`

##### Seed

`Seed`

##### D

`D`

#### Parameters

##### spec

[`WidenSpec`](#widenspec)\<`Seed`, `D`\>

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

***

### flatWidenGate()

> **flatWidenGate**\<`D`\>(): [`ScopeWidenGate`](#scopewidengate)\<`D`\>

The flat default `ScopeWidenGate` — never widens, keeping the R2 selector≠judge collision
dormant. A gate run passes this explicitly; a test asserts the default is flat.

#### Type Parameters

##### D

`D`

#### Returns

[`ScopeWidenGate`](#scopewidengate)\<`D`\>

***

### renderCorpusToInstructions()

> **renderCorpusToInstructions**(`opts`): `Promise`\<`AgentProfile`\>

The learning-flywheel READ side. Queries the corpus through `filter`, renders the matching facts
(most-confident first, capped by `maxLines`) into instruction lines, and returns a FRESH
`AgentProfile` with them merged in — never mutates the input profile. Default `target: 'prompt'`
appends the lines to `prompt.instructions[]` (the additive append-line seam); `target:
'resources'` folds them into the single-blob `resources.instructions` string (preserving any
existing blob, but failing loud on a non-string existing blob — a `resources.instructions` that
was already an `AgentProfileResourceRef` cannot be string-appended without dropping it).

An empty query result returns a fresh COPY of the profile with no instruction change (a valid
"nothing learned yet" read, not an error).

#### Parameters

##### opts

[`RenderCorpusToInstructionsOptions`](#rendercorpustoinstructionsoptions)

#### Returns

`Promise`\<`AgentProfile`\>

***

### definePersona()

> **definePersona**\<`D`\>(`input`): [`Persona`](#persona)\<`D`\>

**`Stable`**

Build a frozen `Persona`. Fails loud on the executors-supplied invariant: a persona with
neither a pre-built registry nor a seam bag cannot resolve its built-in runtimes, so it is
unrunnable — refuse it at definition time, not at the first spawn. Pure; no I/O.

#### Type Parameters

##### D

`D` = `unknown`

#### Parameters

##### input

[`DefinePersonaInput`](#definepersonainput)\<`D`\>

#### Returns

[`Persona`](#persona)\<`D`\>

***

### runPersonified()

> **runPersonified**\<`Task`, `D`\>(`options`): `Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<[`Outcome`](#outcome-2)\<`D`\>\>\>

**`Stable`**

Compose the persona + chosen shape onto a fresh keystone `Supervisor`. Resolves the shape
(a factory verbatim, or a registered name through `builtinShapes`), applies it to a
`ShapeContext`, and runs the resulting root `Agent` to a typed `SupervisedResult<Outcome>`.
Fail loud on an unknown shape name or an unresolvable persona registry — never a silent
default-shape fallback.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### options

[`RunPersonifiedOptions`](#runpersonifiedoptions)\<`Task`, `D`\>

#### Returns

`Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<[`Outcome`](#outcome-2)\<`D`\>\>\>

***

### createShapeRegistry()

> **createShapeRegistry**(): [`ShapeRegistry`](#shaperegistry)

Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.

#### Returns

[`ShapeRegistry`](#shaperegistry)

***

### registerShape()

> **registerShape**\<`Task`, `D`\>(`name`, `factory`): `void`

Register a composed shape on the default `builtinShapes` registry — the one-call extension
 point a caller invokes so its shape is resolvable by name with zero edits to the engine.

#### Type Parameters

##### Task

`Task`

##### D

`D`

#### Parameters

##### name

`string`

##### factory

[`LoopShape`](#loopshape)\<`Task`, `D`\>

#### Returns

`void`

***

### trajectoryReport()

> **trajectoryReport**(`journal`, `blobs`, `root`, `options?`): `Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
journal for structure + spend and, when `withOutputs`, the blob store for each `done`
node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).

#### Parameters

##### journal

[`SpawnJournal`](#spawnjournal)

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### root

`string`

##### options?

[`TrajectoryReportOptions`](#trajectoryreportoptions) = `{}`

#### Returns

`Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

***

### equalKOnCost()

> **equalKOnCost**(`arms`, `options?`): [`EqualKVerdict`](#equalkverdict)

Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
within-tolerance when the per-channel spread (max − min across arms) over the median is
`≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
compare) so a vacuous "equal" is never returned.

The token channel uses `chargedTokens`, the same unit the conserved pool spends, so the cross-run
check and the within-run pool cannot disagree about what an arm cost. Charging the rolled-up
prompt total instead would rate an arm by how often it re-read a cached prefix: two arms given
identical work would read as unequal compute whenever their cache hit rates differed.

#### Parameters

##### arms

readonly [`EqualKArm`](#equalkarm)[]

##### options?

[`EqualKOnCostOptions`](#equalkoncostoptions) = `{}`

#### Returns

[`EqualKVerdict`](#equalkverdict)

***

### profileChatClient()

> **profileChatClient**(`args`): `ChatClient`

Profile-exact adapter for packages that consume agent-eval's ChatClient contract.
Every call still enters Runtime through createExecutor -> streamAgentTurn, and every
behavioral field is checked against the exact AgentProfile before any transport runs.

#### Parameters

##### args

###### profile

`AgentProfile`

###### executor

[`ExecutorConfig`](#executorconfig)

###### context

`string`

#### Returns

`ChatClient`

***

### profileOptimizerModelCall()

> **profileOptimizerModelCall**(`args`): `ExternalOptimizerModelCall`

Profile-exact adapter for agent-eval's external optimizer callback.
Eval validates and freezes the provider-neutral request; Runtime owns the exact
AgentProfile, execution route, retries, usage, and finite execution evidence.

#### Parameters

##### args

###### profile

`AgentProfile`

###### executor

[`ExecutorConfig`](#executorconfig)

###### context

`string`

###### pricing?

`CustomTokenPricing`

#### Returns

`ExternalOptimizerModelCall`

***

### promotionGate()

> **promotionGate**(`opts`): [`PromotionVerdict`](#promotionverdict)

Statistical promotion decision over a holdout benchmark using the outcome-appropriate interval selected by `heldoutSignificance`.

#### Parameters

##### opts

[`PromotionGateOptions`](#promotiongateoptions)

#### Returns

[`PromotionVerdict`](#promotionverdict)

***

### resolveSandboxClient()

> **resolveSandboxClient**(`opts`): [`SandboxClient`](#sandboxclient-5)

Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core
that `resolveBenchClient` builds on — reuse this instead of hand-rolling the
`createExecutor`/`inlineSandboxClient` branch in each product.

#### Parameters

##### opts

[`ResolveSandboxClientOptions`](#resolvesandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-5)

***

### claimRetainedInteractiveControl()

> **claimRetainedInteractiveControl**(`options`): `Promise`\<\{ \}\>

**`Stable`**

Acquire provider-issued write authority without reading authority from status.

A new coordinator starts at generation zero. If another claim already exists,
the provider returns its public generation and this helper retries one new
compare-and-swap operation. Every generation has a deterministic operation
identifier, so retrying after an ambiguous response cannot create two claims.

#### Parameters

##### options

[`ClaimRetainedInteractiveControlOptions`](#claimretainedinteractivecontroloptions)

#### Returns

`Promise`\<\{ \}\>

***

### startRetainedInteractiveRun()

> **startRetainedInteractiveRun**(`options`): `Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle)\>

**`Stable`**

Start one retry-safe native coding-agent TUI without dispatching a headless turn.
The intent admission is durable before provider.create; the environment and
process admissions follow only after their exact provider coordinates exist.

#### Parameters

##### options

[`StartRetainedInteractiveRunOptions`](#startretainedinteractiverunoptions)

#### Returns

`Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle)\>

***

### recoverRetainedInteractiveRun()

> **recoverRetainedInteractiveRun**(`options`): `Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle) \| `null`\>

**`Stable`**

Retry one exact start after its provider response may have been lost.

#### Parameters

##### options

[`RecoverRetainedInteractiveRunOptions`](#recoverretainedinteractiverunoptions)

#### Returns

`Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle) \| `null`\>

***

### reconnectRetainedInteractiveRun()

> **reconnectRetainedInteractiveRun**(`options`): `Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle) \| `null`\>

**`Stable`**

Rebuild controls for one exact provider-owned coding-agent process.

#### Parameters

##### options

[`ReconnectRetainedInteractiveRunOptions`](#reconnectretainedinteractiverunoptions)

#### Returns

`Promise`\<[`RetainedInteractiveRunHandle`](#retainedinteractiverunhandle) \| `null`\>

***

### startRetainedRun()

> **startRetainedRun**(`options`): `Promise`\<[`RetainedRunHandle`](#retainedrunhandle)\>

**`Stable`**

Dispatch one detached, replayable run and return only after exact durable
coordinates are confirmed by the provider and persisted by the caller.

The required `onAdmission` hook first records a digest-only intent before
creation, then records recovery coordinates and the verified exact control
reference. The returned promise resolves only after the dispatched admission
is durable, so a crash cannot lose a successful start's exact reference.

#### Parameters

##### options

[`StartRetainedRunOptions`](#startretainedrunoptions)

#### Returns

`Promise`\<[`RetainedRunHandle`](#retainedrunhandle)\>

***

### startRetainedRunInEnvironment()

> **startRetainedRunInEnvironment**(`options`): `Promise`\<[`RetainedRunHandle`](#retainedrunhandle)\>

**`Stable`**

Dispatch a fresh retained session inside an existing provider environment.

This operation reuses only the environment. It does not append to a prior
harness chat and does not claim native conversation continuity. The caller
must use `RetainedRunHandle.continueNative` for a verified same-chat turn.

#### Parameters

##### options

[`StartRetainedRunInEnvironmentOptions`](#startretainedruninenvironmentoptions)

#### Returns

`Promise`\<[`RetainedRunHandle`](#retainedrunhandle)\>

***

### recoverRetainedRun()

#### Call Signature

> **recoverRetainedRun**(`options`): `Promise`\<[`RecoverRetainedRunResult`](#recoverretainedrunresult)\>

**`Stable`**

Rebuild the exact run named by a persisted pre-create intent or pre-dispatch
admission coordinates, or report why the provider cannot prove it.

An intent recovery replays the exact original start material through
`startRetainedRun`; a changed replay is rejected before provider creation.

`not_found`: the provider no longer holds the environment, so nothing
remains to destroy. `recovered`: the provider self-identified the session
with a strict exact reference matching the recorded coordinates.
`unverifiable`: the environment exists but the provider cannot
self-identify the session — no session accessor, an accessor that throws,
a lazy accessor with no stored reference, or a loose reference. That
outcome is never destroy-safe: keep the environment, retry
`reconnectRetainedRun` with a dispatched admission record, or inspect the
environment with provider-native tools. A session that self-identifies
with different coordinates throws: something live is not the recorded run.

##### Parameters

###### options

[`RecoverRetainedRunIntentOptions`](#recoverretainedrunintentoptions)

##### Returns

`Promise`\<[`RecoverRetainedRunResult`](#recoverretainedrunresult)\>

#### Call Signature

> **recoverRetainedRun**(`options`): `Promise`\<[`RecoverRetainedRunResult`](#recoverretainedrunresult)\>

**`Stable`**

Rebuild the exact run named by a persisted pre-create intent or pre-dispatch
admission coordinates, or report why the provider cannot prove it.

An intent recovery replays the exact original start material through
`startRetainedRun`; a changed replay is rejected before provider creation.

`not_found`: the provider no longer holds the environment, so nothing
remains to destroy. `recovered`: the provider self-identified the session
with a strict exact reference matching the recorded coordinates.
`unverifiable`: the environment exists but the provider cannot
self-identify the session — no session accessor, an accessor that throws,
a lazy accessor with no stored reference, or a loose reference. That
outcome is never destroy-safe: keep the environment, retry
`reconnectRetainedRun` with a dispatched admission record, or inspect the
environment with provider-native tools. A session that self-identifies
with different coordinates throws: something live is not the recorded run.

##### Parameters

###### options

[`RecoverRetainedRunOptions`](#recoverretainedrunoptions)

##### Returns

`Promise`\<[`RecoverRetainedRunResult`](#recoverretainedrunresult)\>

***

### reconnectRetainedRun()

> **reconnectRetainedRun**(`options`): `Promise`\<[`RetainedRunHandle`](#retainedrunhandle) \| `null`\>

**`Stable`**

Rebuild a retained-run client without retaining any object from the starter.

#### Parameters

##### options

[`ReconnectRetainedRunOptions`](#reconnectretainedrunoptions)

#### Returns

`Promise`\<[`RetainedRunHandle`](#retainedrunhandle) \| `null`\>

***

### runBenchmark()

> **runBenchmark**(`cfg`): `Promise`\<[`BenchmarkReport`](#benchmarkreport)\>

Run the requested strategies over the tasks, scored by the Environment's own check.
 Resilient: a task whose rollouts fail (transient infra) is excluded from the stats but
 reported in `perTask` with the error — never silently dropped.

#### Parameters

##### cfg

[`BenchmarkConfig`](#benchmarkconfig)

#### Returns

`Promise`\<[`BenchmarkReport`](#benchmarkreport)\>

***

### printBenchmarkReport()

> **printBenchmarkReport**(`report`): `void`

Pretty-print a report — the "free optimization" verdict, with the cost vector.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

#### Returns

`void`

***

### runAgentRounds()

> **runAgentRounds**\<`Task`, `Output`, `Decision`\>(`options`): `Promise`\<[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>\>

**`Stable`**

The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks
out to N sandboxes (bounded concurrency), parses + validates each output, and folds
the round's results through `driver.decide` — fanout → validate → vote/select →
refine, repeated until the driver says stop. One call spans many agent sessions.

Not to be confused with `runToolLoop` / `streamToolLoop` (`/tool-loop`): those
run ONE chat turn against ONE model, dispatching the tool calls that turn emits and
folding the results back in until the model stops calling tools. No sandboxes, no
rounds, no winner selection.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Parameters

##### options

[`RunAgentRoundsOptions`](#runagentroundsoptions)\<`Task`, `Output`, `Decision`\>

#### Returns

`Promise`\<[`LoopResult`](index.md#loopresult)\<`Task`, `Output`, `Decision`\>\>

***

### defaultSelectWinner()

> **defaultSelectWinner**\<`Task`, `Output`\>(`iterations`): [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

The kernel's winner argmax — best-valid-score, ties broken by earliest index,
falling back to the best-scoring non-errored output when none is valid. Exported
so the `runProgram` tree executor selects across merged sub-loop iterations with
the SAME semantics the kernel uses at a single loop's finalize (one selector, not
a forked copy).

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Parameters

##### iterations

[`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

#### Returns

[`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

***

### isTerminalDecision()

> **isTerminalDecision**(`decision`): decision is "stop" \| "done" \| "pick-winner" \| "fail"

**`Stable`**

True when the kernel stops the loop for this decision value.

#### Parameters

##### decision

`unknown`

#### Returns

decision is "stop" \| "done" \| "pick-winner" \| "fail"

***

### acquireSandbox()

> **acquireSandbox**(`client`, `options`, `acquire?`): `Promise`\<`SandboxInstance`\>

**`Experimental`**

Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts.

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-5)

##### options

`CreateSandboxOptions`

##### acquire?

[`AcquireOptions`](#acquireoptions) = `{}`

#### Returns

`Promise`\<`SandboxInstance`\>

***

### probeSandboxCapabilities()

> **probeSandboxCapabilities**(`client`): `Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

**`Experimental`**

Probe (and memoize per client) what the loop may rely on. A client without a
`criuStatus` method, or whose probe rejects, yields `canFork = false` — a
failed probe must never claim a capability the platform may not have. The
promise is cached so concurrent fanout branches share one round-trip.

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-5)

#### Returns

`Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

***

### sandboxEventServedBackend()

> **sandboxEventServedBackend**(`event`): [`SandboxServedBackend`](#sandboxservedbackend) \| `undefined`

Read the served execution identity off one Sandbox event.

The platform reports `effectiveBackend` on `execution.started` and again on the terminal
event (`@tangle-network/sandbox`, `EffectiveBackend`). Absence returns `undefined`
and must stay unknown — a request is not a receipt, so nothing here may be inferred from
what was asked for.

#### Parameters

##### event

`SandboxEvent`

#### Returns

[`SandboxServedBackend`](#sandboxservedbackend) \| `undefined`

***

### assertSandboxServedModel()

> **assertSandboxServedModel**(`event`, `expected`): `void`

Fail the execution when the platform reports serving a model other than the exact one asked for.

Measured motive (agent-runtime#892, live infrastructure 2026-08-17): 6 of 6 boxes whose profile
declared `zai-coding-plan/glm-5.2` reported
`{"provider":"openai-compat","model":"deepseek/deepseek-v4-flash","source":"environment"}`,
while the materialization receipt recorded the declared model as `status: "known"`. Sending
`backend.model` makes that substitution unlikely; only reading the report back makes it
detectable. A run that cannot say which model produced its evidence must not settle as one
that can.

Silent when the platform reports no served model: unobserved stays unobserved.

#### Parameters

##### event

`SandboxEvent`

##### expected

\{ `provider?`: `string`; `model?`: `string`; \} \| `undefined`

#### Returns

`void`

***

### extractLlmCallEvent()

> **extractLlmCallEvent**(`event`, `agentRunName`): RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
the event carries usage/cost data. Returns `undefined` for non-cost events
so the kernel can iterate the full stream without branching.

Pure by contract: it never throws on a failed run. The terminal truth
boundary is the public Sandbox outcome tracker, applied after the complete
stream. Post-hoc readers — [sumSandboxUsage](#sumsandboxusage), the
analyst trace store, the chat projection — must stay able to read a failed
turn's events, which is when reading them matters most.

Canonical cost-carrying types observed in the wild:
  - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
  - `message.completed` / `result` — `data: { usage: { inputTokens,
     outputTokens, totalCostUsd? } }`
  - `cost.usage` / `usage` — same shape under a dedicated type

Numeric coercion is strict: `Number.isFinite` gates every accumulator write
so a sentinel `NaN` from a misbehaving backend cannot poison the ledger.

#### Parameters

##### event

`SandboxEvent`

##### agentRunName

`string`

#### Returns

RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

***

### sumSandboxUsage()

> **sumSandboxUsage**(`events`, `agentRunName?`): `object`

Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
`openSandboxRun` cell. Folds `extractLlmCallEvent` over the stream (which reads usage off EVERY backend
event shape), so a `runProfileMatrix` dispatch can report it to `ctx.cost`:

    receipt: (turn) => {
      const u = sumSandboxUsage(turn.events)
      return { model, inputTokens: u.input, outputTokens: u.output,
        ...(u.tokensKnown === false ? { usageUnknown: true } : {}),
        ...(u.usdKnown !== false && u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}),
        ...(u.usdKnown === false ? { costUnknown: true } : {}),
        ...(u.estimatedCostUsd !== undefined ? { estimatedCostUsd: u.estimatedCostUsd } : {}) }
    }

Without this a cell reads `{tokens:0, cost:0}` and the backend-integrity guard correctly aborts the
matrix as a stub. `agentRunName` is the fallback model label for cost-only events (default `'agent'`).

#### Parameters

##### events

readonly `SandboxEvent`[]

##### agentRunName?

`string` = `'agent'`

#### Returns

`object`

##### input

> **input**: `number`

##### output

> **output**: `number`

##### costUsd

> **costUsd**: `number`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

##### usdKnown?

> `optional` **usdKnown?**: `false`

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

***

### createSandboxToolPartState()

> **createSandboxToolPartState**(): [`SandboxToolPartState`](#sandboxtoolpartstate)

**`Experimental`**

Fresh per-turn [SandboxToolPartState](#sandboxtoolpartstate) for [mapSandboxToolEvent](#mapsandboxtoolevent) — an
empty call-status map so each turn projects tool frames independently.

#### Returns

[`SandboxToolPartState`](#sandboxtoolpartstate)

***

### mapSandboxToolEvent()

> **mapSandboxToolEvent**(`event`, `state`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) & `object`[]

**`Experimental`**

Project one `SandboxEvent` onto the `tool_call` / `tool_result` variants of
`RuntimeStreamEvent` — the tool-part projection `mapSandboxEvent`
deliberately does NOT perform. Opt-in and additive: `mapSandboxEvent`'s
default vocabulary (text/reasoning deltas + `llm_call`) is unchanged;
consumers that need the tool surface (chat UIs rendering tool activity)
compose this projector alongside it — `streamAgentTurn` does exactly that
under its `preserveToolParts` option.

Handled shapes (observed on the opencode / claude-code sandbox backends):
  - `message.part.updated` with `part.type === 'tool'` — stateful: a
    `tool_call` on the call id's first frame (args from `state.input` or
    `state.metadata.input`), a `tool_result` when the status transitions to
    `completed` (result from `state.output` / `metadata.output`) or to a
    terminal failure (result is `{ error, status, output? }` — the error
    surfaced in-band, never dropped).
  - bare `tool*` event types (`tool.call`, `tool_result`, …) — stateless:
    `*result*` types project to `tool_result`, the rest to `tool_call`.

Returns `[]` for every non-tool event.

#### Parameters

##### event

`SandboxEvent`

##### state

[`SandboxToolPartState`](#sandboxtoolpartstate)

#### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) & `object`[]

***

### mapSandboxEvent()

> **mapSandboxEvent**(`event`, `opts?`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Project one `SandboxEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
for runtimes that bridge a sandbox `streamPrompt` into the
`AgentRuntime.act` streaming contract. Returns `undefined` for events that
have no faithful projection — the raw stream is preserved separately for the
`OutputAdapter`, so an unmapped event never loses data.

Mapped (the task-optional incremental variants — no synthesized task
lifecycle, no guessed tool-part shapes):
  - `message.part.updated` text part → `text_delta`
  - `message.part.updated` reasoning/thinking part → `reasoning_delta`
  - cost-bearing events → `llm_call` (shared with the ledger extractor)

Tool parts are deliberately NOT mapped here (unchanged default) — compose
[mapSandboxToolEvent](#mapsandboxtoolevent) alongside when a consumer needs them.

The opencode backend emits incremental text as
`{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
`delta` is the increment, `part.text` the running accumulation.

#### Parameters

##### event

`SandboxEvent`

##### opts?

###### agentRunName?

`string`

#### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

***

### sandboxProgressEvents()

> **sandboxProgressEvents**(`event`, `state`): [`ExecutorProgressEvent`](#executorprogressevent)[]

**`Experimental`**

Project one `SandboxEvent` onto Runtime's executor progress vocabulary: incremental text and
reasoning, tool calls and results, and an interaction request. It composes the existing
projections ([mapSandboxEvent](#mapsandboxevent), [mapSandboxToolEvent](#mapsandboxtoolevent), and the canonical Agent
Interface decode) so every sandbox-shaped executor publishes live output through one reader.
Usage-bearing events project to nothing here — accounting stays on the `tokens`/`cost`
channels.

Pass one [SandboxToolPartState](#sandboxtoolpartstate) per turn so a multi-frame tool call yields one call and
at most one result.

#### Parameters

##### event

`SandboxEvent`

##### state

[`SandboxToolPartState`](#sandboxtoolpartstate)

#### Returns

[`ExecutorProgressEvent`](#executorprogressevent)[]

***

### createSandboxLineage()

> **createSandboxLineage**(`client`, `capabilities`, `options?`): [`SandboxLineage`](#sandboxlineage)

**`Experimental`**

Build a lineage bound to one client + its probed capabilities. The
capabilities are passed in (not re-probed) so the kernel probes once per run
and the lineage stays a pure function of "what this platform can do".

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-5)

##### capabilities

[`SandboxCapabilities`](#sandboxcapabilities)

##### options?

###### maxConcurrency?

`number`

###### streaming?

`"sse"` \| `"poll"`

###### recordMount?

[`MountRecorder`](#mountrecorder)

Run provenance recorder forwarded to every `prepareBox` the lineage runs
 (fresh start, continue, and fork branches). Absent ⇒ mounts go unrecorded
 (a no-op recorder stands in so the ctx shape is always satisfied).

#### Returns

[`SandboxLineage`](#sandboxlineage)

***

### openSandboxRun()

> **openSandboxRun**\<`Out`\>(`client`, `options`, `deliverable`): `Promise`\<[`SandboxRun`](#sandboxrun)\<`Out`\>\>

**`Experimental`**

Open a sandbox run. Harness-agnostic: the harness lives in
`options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
kimi-code all flow through this one entrypoint with identical env/auth wiring.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-5)

##### options

[`OpenSandboxRunOptions`](#opensandboxrunoptions)

##### deliverable

[`Deliverable`](#deliverable)\<`Out`\>

#### Returns

`Promise`\<[`SandboxRun`](#sandboxrun)\<`Out`\>\>

***

### connectStdioMcp()

> **connectStdioMcp**(`spec`): `Promise`\<[`StdioMcpConnection`](#stdiomcpconnection)\>

Spawn a trusted host command, complete the stdio MCP handshake, and return
the live connection. This low-level function provides no process isolation.

#### Parameters

##### spec

[`StdioMcpServerSpec`](#stdiomcpserverspec)

#### Returns

`Promise`\<[`StdioMcpConnection`](#stdiomcpconnection)\>

***

### materializeLocalMcp()

> **materializeLocalMcp**(`profile`, `opts?`): `Promise`\<[`LocalMcpMaterialization`](#localmcpmaterialization)\>

Spawn every explicitly trusted stdio server in `profile.mcp` as a same-host
child and expose its tools under `<server>__<tool>` names. The default policy
refuses local processes. A profile with no MCP surface returns zero tools.

#### Parameters

##### profile

`AgentProfile`

##### opts?

[`MaterializeLocalMcpOptions`](#materializelocalmcpoptions) = `{}`

#### Returns

`Promise`\<[`LocalMcpMaterialization`](#localmcpmaterialization)\>

***

### assertStrategyContract()

> **assertStrategyContract**(`code`): `void`

Static CONTRACT lint over an authored strategy module — the module-boundary
 enforcement of the harness's two measurement invariants:
   - author blindness: the only import allowed is the kernel surface. A body that could
     reach the filesystem, network, or process could read or mutate verifier/artifact
     state outside the brokered shots, and the harness-verified score would stop
     meaning "what the shots achieved".
   - conserved dose: no out-of-band compute (fetch/require/eval) — every unit a
     strategy spends is metered by the Supervisor's pool, which is what makes
     equal-budget comparisons between strategies valid.
 A lint, not a sandbox: its job is keeping the benchmark numbers interpretable.

#### Parameters

##### code

`string`

#### Returns

`void`

***

### authorStrategy()

> **authorStrategy**(`opts`): `Promise`\<[`AuthoredStrategy`](#authoredstrategy)\>

Author + load a strategy from losses. Throws when the author emits no loadable module;
 with `fallbackModel` set, the named fallback gets one attempt first.

#### Parameters

##### opts

[`AuthorStrategyOptions`](#authorstrategyoptions)

#### Returns

`Promise`\<[`AuthoredStrategy`](#authoredstrategy)\>

***

### discriminatingMeans()

> **discriminatingMeans**(`report`, `fieldOrder`): `Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\> \| `null`

Strategy means recomputed over the DISCRIMINATING tasks only — tasks where the field
 strategies did not all score identically. Zero-spread tasks (everyone 1.0, everyone
 0.0, everyone tied) carry no selection information; averaging over them dilutes real
 differences toward zero. Search-side denoising only — the gate never uses this.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

##### fieldOrder

`string`[]

#### Returns

`Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\> \| `null`

***

### pickChampion()

> **pickChampion**(`means`, `fieldOrder`, `policy`, `epsilon`): [`ChampionPick`](#championpick)

The champion pick over a means table. 'score' takes the best mean score (ties →
 field order). 'costAware' treats scores within `epsilon` of the best as tied and
 takes the cheapest — the (score, $) Pareto rule collapsed to one pick.

#### Parameters

##### means

`Record`\<`string`, \{ `score`: `number`; `usd`: `number`; \}\>

##### fieldOrder

`string`[]

##### policy

[`ChampionPolicy`](#championpolicy)

##### epsilon

`number`

#### Returns

[`ChampionPick`](#championpick)

***

### selectChampion()

> **selectChampion**(`report`, `fieldOrder`, `policy`, `epsilon`): [`ChampionPick`](#championpick)

Search-side champion selection over a tournament report.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

##### fieldOrder

`string`[]

##### policy

[`ChampionPolicy`](#championpolicy)

##### epsilon

`number`

#### Returns

[`ChampionPick`](#championpick)

***

### runStrategyEvolution()

> **runStrategyEvolution**(`cfg`): `Promise`\<[`EvolutionReport`](#evolutionreport)\>

Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice.

#### Parameters

##### cfg

[`StrategyEvolutionConfig`](#strategyevolutionconfig)

#### Returns

`Promise`\<[`EvolutionReport`](#evolutionreport)\>

***

### depthStrategy()

> **depthStrategy**(`surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

DEPTH: one persistent artifact, carried across analyst-steered shots.

#### Parameters

##### surface

[`AgenticSurface`](#agenticsurface)

##### task

[`AgenticTask`](#agentictask)

##### opts

[`AgenticOptions`](#agenticoptions)

##### cfg

###### maxShots

`number`

#### Returns

[`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

***

### breadthStrategy()

> **breadthStrategy**(`_surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

BREADTH: K independent rollouts (each own artifact), verifier picks the best.

#### Parameters

##### \_surface

[`AgenticSurface`](#agenticsurface)

##### task

[`AgenticTask`](#agentictask)

##### opts

[`AgenticOptions`](#agenticoptions)

##### cfg

###### width

`number`

#### Returns

[`Agent`](#agent-2)\<`unknown`, [`Outcome`](#outcome-2)\<`unknown`\>\>

***

### defineStrategy()

> **defineStrategy**\<`Result`\>(`name`, `run`): [`Strategy`](#strategy-3)\<`Result`\>

Author a Strategy from the composable steps — the open, compact way.

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1)

#### Parameters

##### name

`string`

##### run

(`ctx`) => `Promise`\<`Result`\>

#### Returns

[`Strategy`](#strategy-3)\<`Result`\>

***

### runAgentic()

> **runAgentic**\<`Result`\>(`opts`): `Promise`\<[`AgenticRunResult`](#agenticrunresult) & `Result`\>

Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope.

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Parameters

##### opts

[`RunAgenticOptions`](#runagenticoptions)\<`Result`\>

#### Returns

`Promise`\<[`AgenticRunResult`](#agenticrunresult) & `Result`\>

***

### streamAgentTurn()

> **streamAgentTurn**(`backend`, `input`, `opts?`): `AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

**`Stable`**

Run ONE agent turn on any backend kind and stream its events. Yields the
`RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
event carrying the turn's text and usage (`metadata.tokenUsage`,
`metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
timeout alike. The generator never throws; failures surface in-band as
`backend_error` + `final` with a typed `error` detail.

#### Parameters

##### backend

[`AgentTurnBackend`](#agentturnbackend)

##### input

`AgentTurnInput`

##### opts?

[`StreamAgentTurnOptions`](#streamagentturnoptions) = `{}`

#### Returns

`AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

***

### collectAgentTurn()

> **collectAgentTurn**(`stream`): `Promise`\<[`CollectedAgentTurn`](#collectedagentturn)\>

**`Stable`**

Drain a `streamAgentTurn` stream (or any `RuntimeStreamEvent` stream that
honors its terminal contract) into the turn summary plus the full event
list. Fail-loud: throws when the stream ends without a terminal `final`
event — a stream that violates the contract must not read as an empty turn.

#### Parameters

##### stream

`AsyncIterable`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

#### Returns

`Promise`\<[`CollectedAgentTurn`](#collectedagentturn)\>

***

### filterAuthoredAsserts()

> **filterAuthoredAsserts**(`reply`, `entrySymbol`, `count`): `string`[]

The proven authored-assert filter (lifted from the rigs' generateTests): keep only
 single-line, paren-balanced asserts that reference the entry symbol — malformed lines
 are dropped here rather than poisoning every candidate's score identically.

#### Parameters

##### reply

`string`

##### entrySymbol

`string`

##### count

`number`

#### Returns

`string`[]

***

### modelAuthoredChecks()

> **modelAuthoredChecks**(`overrides?`): [`CheckSource`](#checksource)

Default authored-check source: one metered LLM call per task, before sampling,
 filtered through `filterAuthoredAsserts`. Returns [] (no signal, never a fabricated
 check) when the budget is 0, no entry symbol resolves, or the channel went down.

#### Parameters

##### overrides?

###### count?

`number`

#### Returns

[`CheckSource`](#checksource)

***

### officialChecksFromMeta()

> **officialChecksFromMeta**(`key?`): [`CheckSource`](#checksource)

Official checks the surface stashed on the task (e.g. MBPP's shown assert). Reads
 `task.meta[key]` as a string array; anything else means no official checks.

#### Parameters

##### key?

`string` = `'visibleChecks'`

#### Returns

[`CheckSource`](#checksource)

***

### composeCheckSources()

> **composeCheckSources**(...`sources`): [`CheckSource`](#checksource)

Concatenate check sources (official first by convention — ordering does not affect
 scoring, which reads each check's `kind`).

#### Parameters

##### sources

...[`CheckSource`](#checksource)[]

#### Returns

[`CheckSource`](#checksource)

***

### resolveEntrySymbol()

> **resolveEntrySymbol**(`task`): `string` \| `undefined`

The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface
 provides it, else the LAST `def name(` in the visible prompt (a code-completion stub
 lists helpers first, the entry stub last). Undefined ⇒ authoring is skipped.

#### Parameters

##### task

[`AgenticTask`](#agentictask)

#### Returns

`string` \| `undefined`

***

### sandboxCheckRunner()

> **sandboxCheckRunner**(`options?`): [`CheckRunner`](#checkrunner)

Default CheckRunner backend: pipes the check program into `python3` over the sandbox
 exec channel (`ctx.box`, or one bound at construction). Never shells out to docker
 itself — the jail is the sandbox's concern. No channel ⇒ throws; it must never
 silently score 0. Empty check sets short-circuit to a no-signal outcome (nothing to
 execute, so no channel is required).

#### Parameters

##### options?

###### box?

[`CheckExecChannel`](#checkexecchannel)

###### python?

`string`

###### timeoutMs?

`number`

#### Returns

[`CheckRunner`](#checkrunner)

***

### compareCheckOutcomes()

> **compareCheckOutcomes**(`a`, `b`): `number`

The selection order: crash < ran; then official pass-fraction; authored guesses only
 break ties. Returns > 0 when `a` outranks `b`. Strictly lexicographic — on MBPP,
 letting 6 noisy guesses outvote the one official check flipped selection negative.

#### Parameters

##### a

[`CheckOutcome`](#checkoutcome)

##### b

[`CheckOutcome`](#checkoutcome)

#### Returns

`number`

***

### visibleCheckScore()

> **visibleCheckScore**(`o`): `number`

Display scalar for receipts/reports (the rigs' `visibleScore` shape): crash = -1,
 else official fraction + 0.001 × authored fraction. Selection itself uses the exact
 lexicographic comparator, never this scalar.

#### Parameters

##### o

[`CheckOutcome`](#checkoutcome)

#### Returns

`number`

***

### selectBestIndex()

> **selectBestIndex**(`outcomes`): `number`

Argmax by `compareCheckOutcomes`, FIRST index wins ties (deterministic; with zero
 visible coverage every candidate ties at no-signal and index 0 is the blind pick).

#### Parameters

##### outcomes

readonly [`CheckOutcome`](#checkoutcome)[]

#### Returns

`number`

***

### canDisplace()

> **canDisplace**(`challenger`, `incumbent`): `boolean`

The repair keep-best guard: a challenger displaces the incumbent only when it is
 strictly better in the selection order AND passes at least as many official checks.
 The raw-count clause is deliberate belt-and-braces over the comparator (a custom
 runner can report shifted totals): repair must NEVER replace a candidate that passes
 more official checks with one that passes fewer.

#### Parameters

##### challenger

[`CheckOutcome`](#checkoutcome)

##### incumbent

[`CheckOutcome`](#checkoutcome)

#### Returns

`boolean`

***

### defaultExtractCandidate()

> **defaultExtractCandidate**(`messages`): `string`

The candidate a shot produced, read from its conversation: the LAST `submit_answer`
 tool-call argument (verifier environments submit the artifact explicitly), else the
 latest assistant reply's fenced code block — preferring a block containing a `def`,
 because repair replies echo the failure report in a bare fence BEFORE the fixed code
 (the rigs' extractRepairCode lesson) — else the latest non-empty assistant text.

#### Parameters

##### messages

readonly [`StructuralRolloutMessage`](#structuralrolloutmessage)[]

#### Returns

`string`

***

### structuralRollout()

> **structuralRollout**(`config?`): [`Strategy`](#strategy-3)\<[`StructuralRolloutResult`](#structuralrolloutresult)\>

Build the structuralRollout `Strategy`: k shots → score each by the frozen visible
checks (official above authored, crash lowest) → argmax with first-index tie-break →
up to `repairRounds` repair shots steered by the failure output, keep-best under the
official-check guard. Authored via `defineStrategy`, so the deliverable score stays
harness-verified and every shot is metered by the conserved pool.

Budget note: `runAgentic`'s `budget` sizes the pool — pass at least
`k + repairRounds + 1` so the samples, repairs, and the check-author consult all admit.

#### Parameters

##### config?

[`StructuralRolloutConfig`](#structuralrolloutconfig) = `{}`

#### Returns

[`Strategy`](#strategy-3)\<[`StructuralRolloutResult`](#structuralrolloutresult)\>

***

### analystsFromRegistry()

> **analystsFromRegistry**(`registry`, `kinds?`, `opts?`): [`AnalystRegistry`](index.md#analystregistry)

Adapt an `agent-eval` `AnalystRegistry` into the lens shape `supervise({ analysts })` takes.

The two registries were never structurally compatible: eval's class exposes `list()` and
`run(runId, inputs, opts)` and returns an `AnalystRunResult`, while `supervise` wants `kinds`
and `run(kindId, trace)`. So `'kinds' in buildDefaultAnalystRegistry()` is `false` and the five
calibrated lenses in `DEFAULT_TRACE_ANALYST_KINDS` were unreachable from any supervised run —
every consumer hand-rolled a lens instead (#630).

The adapter lives HERE, not in eval, for one reason: eval must never import runtime, and runtime
already owns both shapes — it consumes `AnalystFinding` / `AnalystRunResult` from eval for its
analyst loop and defines the supervise lens itself. Writing it in eval would mean eval declaring
a duck-typed copy of a type this package already exports.

`kinds` is the DEFINITION list, not `registry.list()`, because `Analyst` carries no `area` while
`TraceAnalystDefinition` does — `list()` cannot supply the field the lens shape requires. Every
id must be registered: an unknown kind throws at adapt time rather than returning nothing at run
time, when the driver would read the silence as "no findings".

#### Parameters

##### registry

[`AnalystRegistryLike`](analyst-loop.md#analystregistrylike)

##### kinds?

readonly `object`[] = `DEFAULT_TRACE_ANALYST_KINDS`

##### opts?

###### runOpts?

`RegistryRunOpts`

#### Returns

[`AnalystRegistry`](index.md#analystregistry)

***

### failuresAnalyst()

> **failuresAnalyst**(): [`AnalystRegistry`](index.md#analystregistry)

The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 cases. Swap `analysts` to change what the driver improves from — that's the one knob.

#### Returns

[`AnalystRegistry`](index.md#analystregistry)

***

### superviseSurface()

> **superviseSurface**(`profile`, `task`, `opts`): `Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and
 report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
 — there is no other entrypoint to learn.

#### Parameters

##### profile

`AgentProfile`

##### task

[`AgenticTask`](#agentictask)

##### opts

[`SuperviseSurfaceOptions`](#supervisesurfaceoptions)

#### Returns

`Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

***

### asAuthoredProfile()

> **asAuthoredProfile**(`raw`): [`AuthoredProfile`](#authoredprofile) \| `null`

Narrow an untyped `spawn_agent` profile argument to an `AuthoredProfile`, or null if the
 supervisor failed to author one (empty/placeholder profile — a skill violation worth catching).

#### Parameters

##### raw

`unknown`

#### Returns

[`AuthoredProfile`](#authoredprofile) \| `null`

***

### supervisorInstructions()

> **supervisorInstructions**(`opts?`): `string`

The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable
 surface: editing this changes how the supervisor designs every agent it spawns.

 The POLICY paragraph is the registry's one `supervisor/policy` entry — the same stance
 `defaultSupervisorPrompt` carries — so both front doors run the same work-vs-delegate rule;
 this function ADDS the profile-authoring skill (how to WRITE the workers it spawns), which is
 additive craft, not a different policy.

#### Parameters

##### opts?

###### goal?

`string`

#### Returns

`string`

***

### assessAuthoredProfile()

> **assessAuthoredProfile**(`profile`, `opts?`): [`ProfileRichness`](#profilerichness)

OBSERVE one authored `AgentProfile` and score its richness (no judge verdict is read). The task
 context (`needsMcp`) lets a domain say "this work needs a data/tool MCP" so a missing MCP counts.

#### Parameters

##### profile

`AgentProfile`

##### opts?

###### needsMcp?

`boolean`

###### thresholds?

`Partial`\<[`ProfileRichnessThresholds`](#profilerichnessthresholds)\>

#### Returns

[`ProfileRichness`](#profilerichness)

***

### profileRichnessFinding()

> **profileRichnessFinding**(`richness`, `opts?`): `AnalystFinding`

Turn a [ProfileRichness](#profilerichness) verdict into a bus-routable `AnalystFinding` (area `profile-quality`).
 Severity scales with thinness; the recommended action names the MISSING lever so the supervisor can
 re-author. `subject` = the worker name so per-worker findings diff cleanly across re-authors.

#### Parameters

##### richness

[`ProfileRichness`](#profilerichness)

##### opts?

###### analystId?

`string`

###### runId?

`string`

#### Returns

`AnalystFinding`

***

### spendFromUsageEvents()

> **spendFromUsageEvents**(`events`): [`Spend`](index.md#spend)

Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 pool does not read wall-clock).

#### Parameters

##### events

[`UsageEvent`](#usageevent)[]

#### Returns

[`Spend`](index.md#spend)

***

### createBudgetPool()

> **createBudgetPool**(`root`, `now?`, `restore?`): [`BudgetPool`](#budgetpool)

Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
absolute deadline for a fresh pool is fixed at construction (`now() + budget.deadlineMs`). A
restored pool instead retains `restore.absoluteDeadlineMs`, so restart never slides the original
wall-clock limit. The readout is an absolute instant, not a shrinking remainder.

#### Parameters

##### root

[`Budget`](index.md#budget-4)

##### now?

() => `number`

##### restore?

[`BudgetPoolRestore`](#budgetpoolrestore) = `{}`

#### Returns

[`BudgetPool`](#budgetpool)

***

### createChatSessionStore()

> **createChatSessionStore**(): [`ChatSessionStore`](#chatsessionstore)

In-memory, process-local conversation store with detached reads and writes.

#### Returns

[`ChatSessionStore`](#chatsessionstore)

***

### chatTransportExecutor()

> **chatTransportExecutor**(`opts`): [`Executor`](index.md#executor-2)\<`string`\>

Build one exact profile-driven chat executor through `createExecutor`.
Prefer `chatWorkerSeam` for supervised work because it supplies trusted node identity.

#### Parameters

##### opts

[`ChatTransportExecutorOptions`](#chattransportexecutoroptions)

#### Returns

[`Executor`](index.md#executor-2)\<`string`\>

***

### chatWorkerSeam()

> **chatWorkerSeam**(`opts`): [`MakeWorkerAgent`](#makeworkeragent)

Session-owning worker factory for graph continuity.

#### Parameters

##### opts

[`ChatWorkerSeamOptions`](#chatworkerseamoptions)

#### Returns

[`MakeWorkerAgent`](#makeworkeragent)

***

### gateOnDeliverable()

> **gateOnDeliverable**\<`Out`\>(`inner`, `deliverable`): [`Executor`](index.md#executor-2)\<`Out`\>

Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
executor has produced its output. The inner `score` is preserved; only `valid` is gated.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### inner

[`Executor`](index.md#executor-2)\<`Out`\>

##### deliverable

[`DeliverableSpec`](#deliverablespec)\<`Out`\>

#### Returns

[`Executor`](index.md#executor-2)\<`Out`\>

***

### mapExecutorResult()

> **mapExecutorResult**\<`In`, `Out`\>(`inner`, `map`): [`Executor`](index.md#executor-2)\<`Out`\>

Transform a Runtime executor's terminal artifact without losing its private
profile-materialization attestation or altering its measured spend. This is
the composition point for deterministic post-processing and grading; callers
must not rebuild an Executor around a model transport merely to change `out`.

#### Type Parameters

##### In

`In`

##### Out

`Out`

#### Parameters

##### inner

[`Executor`](index.md#executor-2)\<`In`\>

##### map

(`result`, `task`) => [`ExecutorResultMapping`](#executorresultmapping)\<`Out`\> \| `Promise`\<[`ExecutorResultMapping`](#executorresultmapping)\<`Out`\>\>

#### Returns

[`Executor`](index.md#executor-2)\<`Out`\>

***

### finalizeBestDelivered()

> **finalizeBestDelivered**(`settled`, `blobs`): `Promise`\<`unknown`\>

Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's
 output (settled `done` AND `valid` — its deliverable check passed). Returns undefined when no
 child delivered — an honest "the driver produced nothing", never a high-scoring result that
 ran without passing its check (Foreman's 0/18 lesson). `valid` is the single delivery signal,
 matching `defaultSelectWinner`'s valid-first rule; the oracle just doesn't fall back to an
 unchecked best-effort. The same argmax as the `bestDelivered` finalizer (`pickBestDelivered`);
 this direct form serves callers that hold a bare ledger + blob store.

#### Parameters

##### settled

readonly `object`[]

##### blobs

[`ResultBlobStore`](#resultblobstore)

#### Returns

`Promise`\<`unknown`\>

***

### serveCoordinationMcp()

> **serveCoordinationMcp**(`opts`): `Promise`\<[`CoordinationMcpHandle`](#coordinationmcphandle)\>

Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 opencode locally, same host); pass `host` to bind elsewhere when the harness is remote — a
 non-loopback host additionally requires `allowUnauthenticatedRemote`.

#### Parameters

##### opts

###### scope

[`Scope`](index.md#scope)\<`unknown`\>

###### blobs

[`ResultBlobStore`](#resultblobstore)

###### makeWorkerAgent

[`MakeWorkerAgent`](#makeworkeragent)

###### authorizeDownMessage?

[`AuthorizeDownMessage`](#authorizedownmessage)

###### perWorker

[`Budget`](index.md#budget-4)

###### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Independent completion check exposed to the driver as `submit_result`.

###### onStop?

(`reason`) => `void`

Called once when the external manager accepts a result or declares completion.

###### maxLiveWorkers?

`number`

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap.

###### awaitTimeoutMs?

`number`

Max wall-clock ms a single `await_event` may block before returning a re-pollable
 `{ pending, live }` snapshot instead of erroring on the client's request timeout. Omit =
 [DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS](#default_await_event_timeout_ms); `<= 0` = prior unbounded block (in-process only).

###### port?

`number`

###### host?

`string`

Bind address. Omit = `127.0.0.1`. A non-loopback host is REFUSED unless
 `allowUnauthenticatedRemote` acknowledges the exposure.

###### allowUnauthenticatedRemote?

`boolean`

Explicit acknowledgment that binding a non-loopback `host` publishes UNAUTHENTICATED
 spawn_agent / steer_agent / stop to everyone who can reach the port. Required for any
 non-loopback bind; ignored for loopback ones.

###### analysts?

[`AnalystRegistry`](index.md#analystregistry)

Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle.

###### analyzeOnSettle?

readonly (`string` \| [`AnalyzeOnSettleRoute`](#analyzeonsettleroute))[]

Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus.

###### watchWorkers?

[`WorkerWatchOptions`](#workerwatchoptions)

Run the ONLINE detector panel over each worker's live tool trace (raises `finding` events).

###### stallAfterMs?

`number`

Idle time after which `observe_agent` reports a worker as stalled.

###### continuityByProfile?

`Readonly`\<`Record`\<`string`, [`ContinuityMode`](#continuitymode)\>\>

Default continuity per worker profile name — `'resume'` re-attaches spawns of that name to
 the node's latest settled worker; the tool's per-call `continuity` overrides.

###### onEvent?

(`event`, `record`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every bus event, including pre-delivery instruction receipts and
steer/answer delivery outcomes.

###### replaySettlements?

`boolean`

Re-publish resume-time settlements through the awaited observer before this server listens.

###### questionPolicy?

[`QuestionPolicy`](mcp.md#questionpolicy)

###### priorQuestions?

readonly [`QuestionRecord`](mcp.md#questionrecord)[]

Questions replayed from a prior process of this run — seeds the question ledger.

###### nodeTools?

readonly [`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

Product-selected tools already bound to this exact supervisor node. They share this server
 with the coordination verbs, so the existing MCP duplicate-name guard applies before listen.

###### peerMail?

`boolean` \| \{ `limits?`: `Partial`\<[`PeerMailLimits`](#peermaillimits)\>; \}

OPT-IN peer mail: let this manager's workers message each other directly, bounded and audited
(`runtime/supervise/peer-mail`). Each spawn receives a capability URL on
`WorkerSpawnContext.peerMailUrl`.

It is a SEPARATE listener on its own port, not another tool on this server, and that is the
whole point: this server mounts spawn_agent / steer_agent / stop with no authentication, so a
worker handed its URL could send a REAL `[SUPERVISOR]` instruction to a sibling and the peer
channel's authority marking would mean nothing. The mail listener serves `send_mail` and
`read_mail` and no other verb, on a per-worker secret path bound to that worker's identity.

The residual, stated plainly: the boundary is between AGENTS, not between processes. A worker
that can read another worker's environment or process memory still holds that worker's
capability. Loopback plus an unguessable path is what this layer can honestly enforce.

#### Returns

`Promise`\<[`CoordinationMcpHandle`](#coordinationmcphandle)\>

***

### delegate()

> **delegate**\<`Out`\>(`intent`, `opts`): `Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<`Out`\>\>

Delegate an INTENT to a default authoring supervisor and return its `SupervisedResult` unchanged.

The supervisor authors + spawns whatever worker the intent needs over the conserved-budget pool;
`result.spentTotal` reports what the whole delegation actually cost. A `winner` result carries the
authored worker's delivered output; a `no-winner` result names why (never a fabricated success).

#### Type Parameters

##### Out

`Out` = `unknown`

#### Parameters

##### intent

`string`

##### opts

[`DelegateOptions`](#delegateoptions)\<`Out`\>

#### Returns

`Promise`\<[`SupervisedResult`](index.md#supervisedresult)\<`Out`\>\>

***

### defaultToolDetectors()

> **defaultToolDetectors**(): `StreamingDetector`[]

The default online panel for a tool-call pipe: a worker repeating the same call, or hammering
 consecutive errors. (No-progress needs a domain progress-probe, so it is opt-in, not default.)

 Coverage note: `repeated-action` works for EVERY harness (it needs only tool name + args, which
 every adapter provides). `error-streak` needs per-call status — opencode carries it inline
 (`state.status`, VALIDATED live), but claude-code/codex tool-call parts do NOT (their errors live
 in separate result blocks not yet decoded), so error-streak is silent for those until result-block
 decoding is added + live-validated. It is in the panel because it is correct where status exists.

#### Returns

`StreamingDetector`[]

***

### watchTrace()

> **watchTrace**(`source`, `opts?`): () => `void`

Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
 unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel.

#### Parameters

##### source

[`TraceSource`](#tracesource-1)

##### opts?

[`WatchTraceOptions`](#watchtraceoptions) = `{}`

#### Returns

() => `void`

***

### rollingDispatch()

> **rollingDispatch**\<`Out`\>(`scope`, `opts`): `Promise`\<[`DispatchReport`](#dispatchreport)\<`Out`\>\>

Run the refilling dispatch loop over `scope` until the queue is dry (or a stop fires) and every
admitted child has settled. Returns the settlements in cursor order plus the admission ledger.

The loop is: fill free slots from `nextUnit` → `await scope.next()` → deliver the settlement →
refill → repeat. Because the refill happens immediately after each settlement rather than after
a whole round, a slow child never idles the other slots.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### scope

[`Scope`](index.md#scope)\<`Out`\>

##### opts

[`RollingDispatchOptions`](#rollingdispatchoptions)\<`Out`\>

#### Returns

`Promise`\<[`DispatchReport`](#dispatchreport)\<`Out`\>\>

***

### freeSlots()

> **freeSlots**(`liveCount`, `cap`): `number` \| `null`

Free worker slots under a simultaneity cap: `cap - live`, floored at 0, or `null` when there is
no cap (the conserved pool is then the only fence and "free slots" is not a finite number).
The one place the answer is computed, so the driver-facing tool payload and a dispatcher agree.

#### Parameters

##### liveCount

`number`

##### cap

`number` \| `undefined`

#### Returns

`number` \| `null`

***

### effectiveConcurrency()

> **effectiveConcurrency**(`caps`): `number` \| `undefined`

The ONE honest effective limit on simultaneous workers: the minimum of the caps that actually
bound the worker layer. Ignores unset/non-positive caps; returns `undefined` when no cap applies
(uncapped — the conserved pool remains the only fence).

Deliberately does NOT fold in `SandboxLineage`'s fork concurrency: that bounds boxes inside ONE
leaf's fork wave, a different unit. Folding it in would report a 4-worker ceiling for what is
really a 4-box fanout inside a single worker.

Use it once, at the top of a run, and pass the result to BOTH `maxLiveWorkers` and a
dispatcher's `width` — that is what turns three unrelated numbers into one.

#### Parameters

##### caps

[`ConcurrencyCaps`](#concurrencycaps)

#### Returns

`number` \| `undefined`

***

### queueOf()

> **queueOf**\<`Out`\>(`units`, `budget`): () => [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`

Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where
 the queue is known up front and only the refill behavior is wanted.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### units

readonly `object`[]

##### budget

[`Budget`](index.md#budget-4)

#### Returns

() => [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`

***

### classifyDriverFailure()

> **classifyDriverFailure**(`error`, `signal?`): `"transient"` \| `"terminal"`

Classify one driver failure. Runtime's own typed refusals are decisions and stay terminal;
anything foreign is an accident and is retryable. A `BackendTransportError` is split by status
because the taxonomy already promises consumers may branch on it: a 5xx/429/408 is the upstream
having a bad moment, while a 401/404/422 is a request that will fail identically forever.

#### Parameters

##### error

`unknown`

##### signal?

`AbortSignal`

#### Returns

`"transient"` \| `"terminal"`

***

### createEventBus()

> **createEventBus**\<`E`\>(`now?`): [`EventBus`](#eventbus)\<`E`\>

**`Experimental`**

Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane.
 In-process queue; durability is a transport swap that does not exist yet.

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Parameters

##### now?

() => `number`

#### Returns

[`EventBus`](#eventbus)\<`E`\>

***

### pickBestDelivered()

> **pickBestDelivered**\<`T`\>(`delivered`): `T` \| `undefined`

The single argmax both the default finalizer and `finalizeBestDelivered` share: highest
 score wins, missing scores count 0, ties keep the earliest ledger entry.

#### Type Parameters

##### T

`T` *extends* `object`

#### Parameters

##### delivered

readonly `T`[]

#### Returns

`T` \| `undefined`

***

### runFinalizer()

> **runFinalizer**(`finalizer`, `args`): `Promise`\<`unknown`\>

Run a finalizer over a settled-worker ledger under the delivered-only invariant: filter the
ledger to structurally delivered children, materialize their outputs, and hand the finalizer a
blob reader that throws on any ref outside that set. This is the one call site both driver arms
(the in-process tool-loop and the MCP-mounted harness) finalize through.

#### Parameters

##### finalizer

[`SupervisorFinalizer`](index.md#supervisorfinalizer)

##### args

###### settled

readonly [`FinalizerSettled`](#finalizersettled)[]

###### blobs

[`ResultBlobStore`](#resultblobstore)

###### tree

[`TreeView`](#treeview)

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `tokensKnown`: `boolean`; `cacheBreakdownKnown`: `boolean`; `usdLeft`: `number`; `usdCapped`: `boolean`; `usdKnown`: `boolean`; `iterationsLeft`: `number`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

#### Returns

`Promise`\<`unknown`\>

***

### runGraph()

> **runGraph**(`graph`, `opts`): `Promise`\<[`GraphResult`](#graphresult)\<`unknown`\>\>

Execute an [AgentGraph](#agentgraph). The root node becomes the supervisor (`supervise()` — the
execution core), each worker node is spawnable BY NODE ID (`spawn_agent` with
`profile: { name: '<node id>' }`; the node's canonical profile is pinned by the graph), each
delegates directive is appended to the worker profile's `prompt.instructions` per traversal,
and each analyzes edge becomes an analyst-on-settle route with a real DESTINATION. Every
traversal is ledgered and journaled.

#### Parameters

##### graph

[`AgentGraph`](#agentgraph)

##### opts

[`RunGraphOptions`](#rungraphoptions)

#### Returns

`Promise`\<[`GraphResult`](#graphresult)\<`unknown`\>\>

***

### createInbox()

> **createInbox**(): [`Inbox`](#inbox)

Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages and a sibling's peer mail queue here, and the worker's loop drains them at step boundaries and before settle.

#### Returns

[`Inbox`](#inbox)

***

### assertModelAllowed()

> **assertModelAllowed**(`model`, `allowed`): `void`

Throw a `ConfigError` when `allowed` is set, `model` is defined, and `model` is not a
member of `allowed`. No-op when `allowed` is unset (the unrestricted default) or when
`model` is undefined (nothing was configured to check).

#### Parameters

##### model

`string` \| `undefined`

##### allowed

readonly `string`[] \| `undefined`

#### Returns

`void`

***

### assertProfileModelsAllowed()

> **assertProfileModelsAllowed**(`profile`, `allowed`): `void`

Check every canonical model-bearing field in a complete profile, including the models a
backend may select for cheap work, named subagents, or modes.

Every compared value is a bare model id. The composed `harness/provider/model` wire id
(`profileBridgeWireModel`) is neither built nor compared here, so this admits any route that
declares an allowed id, and a qualified entry in `allowed` matches nothing. Route pinning
belongs to `SuperviseOptions.authorizeSpawn`.

#### Parameters

##### profile

`AgentProfile`

##### allowed

readonly `string`[] \| `undefined`

#### Returns

`void`

***

### createSupervisorSpanRecorder()

> **createSupervisorSpanRecorder**(`opts`): [`SupervisorSpanRecorder`](#supervisorspanrecorder) \| `undefined`

Build the span recorder for one supervised run, or `undefined` when no exporter resolves — the
off-by-default path. A run that passes no `exporter` and no `exportConfig` never reaches this
function at all; one that passes an `exportConfig` with no endpoint (and no env endpoint) gets
`undefined` here, so "configured but unreachable" also costs nothing.

#### Parameters

##### opts

[`SupervisorSpanOptions`](#supervisorspanoptions)

#### Returns

[`SupervisorSpanRecorder`](#supervisorspanrecorder) \| `undefined`

***

### patchDelivered()

> **patchDelivered**(`options?`): [`DeliverableSpec`](#deliverablespec)\<[`WorktreeHarnessResult`](#worktreeharnessresult)\>

**`Experimental`**

Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
whether the patch is DELIVERED (the `valid` conjunction).

#### Parameters

##### options?

[`PatchDeliverableOptions`](#patchdeliverableoptions) = `{}`

#### Returns

[`DeliverableSpec`](#deliverablespec)\<[`WorktreeHarnessResult`](#worktreeharnessresult)\>

***

### claimsAuthority()

> **claimsAuthority**(`text`): `boolean`

True when `text` carries a phrase reserved for the run's authority. Case-insensitive, because
 the render is read by a model and case is not what distinguishes an instruction.

#### Parameters

##### text

`string`

#### Returns

`boolean`

***

### isPeerMailEnvelope()

> **isPeerMailEnvelope**(`value`): `value is PeerMailEnvelope`

True when `value` is an envelope this runtime produced. The worker inbox parses with this, so a
 malformed or partial wire object is discarded rather than rendered as a peer message.

#### Parameters

##### value

`unknown`

#### Returns

`value is PeerMailEnvelope`

***

### createPeerMailbox()

> **createPeerMailbox**(`opts`): [`PeerMailbox`](#peermailbox)

Create the run's post office. One per manager scope; the manager's siblings are its addresses.

#### Parameters

##### opts

[`PeerMailboxOptions`](#peermailboxoptions)

#### Returns

[`PeerMailbox`](#peermailbox)

***

### peerMailTools()

> **peerMailTools**(`mailbox`, `capabilityId`): [`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

The two tools ONE capability serves. `capabilityId` is closed over and `from` is not a parameter,
so the endpoint a worker holds can only ever speak as that worker. The descriptions carry the
authority rule, because the receiving model reads them as part of the channel's contract.

#### Parameters

##### mailbox

[`PeerMailbox`](#peermailbox)

##### capabilityId

`string`

#### Returns

[`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

***

### createActivityLog()

> **createActivityLog**(`limit?`): [`ActivityLog`](#activitylog)

Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools.

#### Parameters

##### limit?

`number` = `12`

#### Returns

[`ActivityLog`](#activitylog)

***

### readWorkerProgress()

> **readWorkerProgress**(`scope`, `executor`, `now`, `stallAfterMs?`): [`WorkerProgress`](#workerprogress)

Fold the scope-derived facts and the executor's optional enrichment into one read. Pure: the
 caller supplies `now`, so a test can observe a stall without waiting for one.

#### Parameters

##### scope

[`ScopeProgressInput`](#scopeprogressinput)

##### executor

[`ExecutorProgress`](#executorprogress) \| `undefined`

##### now

`number`

##### stallAfterMs?

`number` = `DEFAULT_STALL_AFTER_MS`

#### Returns

[`WorkerProgress`](#workerprogress)

***

### promptHandle()

> **promptHandle**(`ref`): [`PromptHandle`](#prompthandle)

Parse `'<surface>/v<n>'` into a [PromptHandle](#prompthandle). The shorthand for authoring a graph edge:
`directive: promptHandle('delegates/worker-brief/v1')`.

#### Parameters

##### ref

`string`

#### Returns

[`PromptHandle`](#prompthandle)

***

### formatPromptHandle()

> **formatPromptHandle**(`handle`): `string`

The string form of a handle: `<surface>/v<n>`.

#### Parameters

##### handle

[`PromptHandle`](#prompthandle)

#### Returns

`string`

***

### createPromptRegistry()

> **createPromptRegistry**(`seed?`): [`PromptRegistry`](#promptregistry)

Create a registry, optionally seeded. Entries are copied; the registry never aliases caller state.

#### Parameters

##### seed?

readonly [`RegisteredPrompt`](#registeredprompt)[]

#### Returns

[`PromptRegistry`](#promptregistry)

***

### kernelPromptRegistry()

> **kernelPromptRegistry**(): [`PromptRegistry`](#promptregistry)

The kernel's seeded registry: every surface the runtime's own builders derive from. A caller
 may register additional surfaces/versions on the returned registry.

#### Returns

[`PromptRegistry`](#promptregistry)

***

### createInMemoryRunContext()

> **createInMemoryRunContext**(`opts?`): [`InMemoryRunContext`](#inmemoryruncontext)

Build a fresh in-memory run context. Every call returns NEW stores (no shared global
state between runs), so two runs never cross-contaminate their journals/blobs.

#### Parameters

##### opts?

[`InMemoryRunContextOptions`](#inmemoryruncontextoptions) = `{}`

#### Returns

[`InMemoryRunContext`](#inmemoryruncontext)

***

### createFileRunContext()

> **createFileRunContext**(`dir`, `opts?`): [`InMemoryRunContext`](#inmemoryruncontext)

Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced
per append/write) under `dir`, and the context carries `resume: true` so spreading it into
`SupervisorOpts` makes the supervisor `loadTree`-first. A run that dies mid-flight therefore
resumes when it is re-run with the SAME `runId` and the SAME `dir`: the committed children come
back on `Scope.resume` (rehydrated by `replaySpawnTree`) instead of being re-executed.

Layout: `${dir}/spawn-journal.jsonl` (one JSONL record per event), `${dir}/blobs/` (one
content-addressed JSON file per settled result), and `${dir}/coordination-log.jsonl`
(questions, findings, answer decisions, and authorized continuation receipts retained as
evidence). The directory is created on first write.

Opt-in by construction — `createInMemoryRunContext()` is unchanged and stays the default, so no
existing consumer writes to disk or resumes unless it asks for this.

#### Parameters

##### dir

`string`

##### opts?

[`InMemoryRunContextOptions`](#inmemoryruncontextoptions) = `{}`

#### Returns

[`InMemoryRunContext`](#inmemoryruncontext)

***

### supervisorRunsRoot()

> **supervisorRunsRoot**(`rootDir`): `string`

The root every supervisor run of one workspace lives under.

#### Parameters

##### rootDir

`string`

#### Returns

`string`

***

### supervisorRunDir()

> **supervisorRunDir**(`rootDir`, `id`): `string`

The run directory every artifact of one supervisor run lives under.

#### Parameters

##### rootDir

`string`

##### id

`string`

#### Returns

`string`

***

### legacySupervisorRunDir()

> **legacySupervisorRunDir**(`rootDir`, `id`): `string`

Where a pre-rename writer put the same run (`<root>/.loops/supervisor/<id>`). Readers that must
see historical runs check [supervisorRunDir](#supervisorrundir) first and fall back to this; nothing writes
here anymore.

#### Parameters

##### rootDir

`string`

##### id

`string`

#### Returns

`string`

***

### legacySupervisorRunsRoot()

> **legacySupervisorRunsRoot**(`rootDir`): `string`

The pre-rename runs root (`<root>/.loops/supervisor`). Only readers that ENUMERATE historical
runs need this — the per-id form is [legacySupervisorRunDir](#legacysupervisorrundir). Nothing writes here.

#### Parameters

##### rootDir

`string`

#### Returns

`string`

***

### safeWorkerFile()

> **safeWorkerFile**(`label`): `string`

A worker label reduced to a safe filename stem. Empty labels get a stable fallback.

#### Parameters

##### label

`string`

#### Returns

`string`

***

### supervisorWorkersDir()

> **supervisorWorkersDir**(`eventDir`): `string`

The directory holding every per-worker file of one run (inboxes and control-event logs).

#### Parameters

##### eventDir

`string`

#### Returns

`string`

***

### workerInboxFile()

> **workerInboxFile**(`rootDir`, `supervisorId`, `worker`): `string`

The durable inbox file for one worker of one run.

#### Parameters

##### rootDir

`string`

##### supervisorId

`string`

##### worker

`string`

#### Returns

`string`

***

### workerInboxFileFromEventDir()

> **workerInboxFileFromEventDir**(`eventDir`, `worker`): `string`

Same, addressed from an already-known run directory (the reader's usual entry point).

#### Parameters

##### eventDir

`string`

##### worker

`string`

#### Returns

`string`

***

### workerControlLogFile()

> **workerControlLogFile**(`eventDir`, `worker`): `string`

The best-effort control-event log for one worker (`workers/<label>.ndjson`) — delivery
bookkeeping for steers, plus whatever lifecycle events a writer chooses to append. Distinct from
the inbox: the inbox is the durable down-leg queue, this is the record of what happened to it.

#### Parameters

##### eventDir

`string`

##### worker

`string`

#### Returns

`string`

***

### writeWorkerSteer()

> **writeWorkerSteer**(`rootDir`, `supervisorId`, `worker`, `message`, `source?`): `object`

Durably append one steer request to a worker's inbox and log the delivery attempt.

The inbox append is the durable act; the control-event log is best-effort bookkeeping and may
silently fail without voiding the steer.

#### Parameters

##### rootDir

`string`

##### supervisorId

`string`

##### worker

`string`

##### message

`string`

##### source?

`string` = `'human'`

#### Returns

`object`

##### worker

> **worker**: `string`

##### file

> **file**: `string`

##### request

> **request**: [`WorkerSteerRequest`](#workersteerrequest)

***

### readWorkerSteerRequests()

> **readWorkerSteerRequests**(`eventDir`, `worker`): [`WorkerSteerRequest`](#workersteerrequest)[]

Read every valid steer request in a worker's inbox. Corrupt or partial lines are skipped.

#### Parameters

##### eventDir

`string`

##### worker

`string`

#### Returns

[`WorkerSteerRequest`](#workersteerrequest)[]

***

### workerCancellationsDir()

> **workerCancellationsDir**(`eventDir`): `string`

The directory holding every cancellation artifact of one run (request inbox + acknowledgements).

#### Parameters

##### eventDir

`string`

#### Returns

`string`

***

### workerCancelRequestsFile()

> **workerCancelRequestsFile**(`eventDir`): `string`

The durable cancel-request inbox of one run — one NDJSON line per [WorkerCancelRequest](#workercancelrequest).

#### Parameters

##### eventDir

`string`

#### Returns

`string`

***

### workerCancellationFile()

> **workerCancellationFile**(`eventDir`, `operationId`): `string`

The acknowledgement file for one cancel operation. The filename is a sanitized stem of the
`operationId`; the record inside carries the exact id, and readers verify it so two distinct
ids that sanitize to one stem fail loud instead of answering for each other.

#### Parameters

##### eventDir

`string`

##### operationId

`string`

#### Returns

`string`

***

### readWorkerCancelRequests()

> **readWorkerCancelRequests**(`eventDir`): [`WorkerCancelRequest`](#workercancelrequest)[]

Read every valid cancel request in the run's cancellation inbox. Corrupt lines are skipped.

#### Parameters

##### eventDir

`string`

#### Returns

[`WorkerCancelRequest`](#workercancelrequest)[]

***

### readWorkerCancellation()

> **readWorkerCancellation**(`eventDir`, `operationId`): [`WorkerCancellation`](#workercancellation) \| `undefined`

Read the acknowledgement for one cancel operation. `undefined` when the runtime has not
answered. A record whose stored `operationId` differs from the requested one is a filename
collision between two sanitized ids — fail loud rather than return another operation's answer.

#### Parameters

##### eventDir

`string`

##### operationId

`string`

#### Returns

[`WorkerCancellation`](#workercancellation) \| `undefined`

***

### cancelWorker()

> **cancelWorker**(`eventDir`, `worker`, `operationId`, `options?`): [`WorkerCancellation`](#workercancellation)

Request the cancellation of ONE worker, idempotently, and return the operation's current
durable state.

The write half of the acknowledged-cancellation contract (`writeWorkerSteer` is the steer
analog): append the request to the run's cancellation inbox, where the OWNING manager's
acknowledger (its turn loop — the root for label/profile references, the parent manager for an
exact node id at any depth) applies it — aborting exactly that worker's subtree and recording
what it proved. This function never applies the cancellation itself; writing a
request file is not an acknowledgement.

Idempotency is a lookup: when an acknowledgement for `operationId` already exists, it is
returned AS-IS and nothing is appended — repeating one operation can never apply twice. A
request the runtime has not answered yet returns `effect: 'unknown'` (never a success); call
again with the same `operationId` — or `readWorkerCancellation` — to read the acknowledged
result after a reconnect.

#### Parameters

##### eventDir

`string`

##### worker

`string`

##### operationId

`string`

##### options?

###### reason?

`string`

###### source?

`string`

#### Returns

[`WorkerCancellation`](#workercancellation)

***

### createExecutor()

> **createExecutor**(`config`): [`ExecutorFactory`](#executorfactory)\<`unknown`\>

The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
injects the matching seam, and delegates to that backend's built-in implementation.
The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly, while Scope
or `createExecutorRegistry` still parses and seals their exact profile before use. Use this instead of a
per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
`UsageEvent` reporting channel.

#### Parameters

##### config

[`ExecutorConfig`](#executorconfig)

#### Returns

[`ExecutorFactory`](#executorfactory)\<`unknown`\>

***

### createExecutorRegistry()

> **createExecutorRegistry**(): [`ExecutorRegistry`](index.md#executorregistry)

The open resolver/registry. Pre-registers the three built-ins under their
runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
factory)` for any additional runtime. A BYO `AgentSpec.executor` has highest routing precedence
after the same exact-profile intake validation. Registration + BYO remain open extension points.

`resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executorFactory` →
`spec.executor` → `harness === null` → the `'router'` factory; else a registered factory for the
harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.

#### Returns

[`ExecutorRegistry`](index.md#executorregistry)

***

### createSteerableSandboxSession()

> **createSteerableSandboxSession**(`args`): [`SteerableSandboxSession`](#steerablesandboxsession)

One steerable sandbox worker. The returned session is inert until `stream()` is drained.

#### Parameters

##### args

[`SteerableSandboxArgs`](#steerablesandboxargs)

#### Returns

[`SteerableSandboxSession`](#steerablesandboxsession)

***

### createScope()

> **createScope**\<`Out`\>(`args`): [`Scope`](index.md#scope)\<`Out`\>

Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### args

[`ScopeArgs`](#scopeargs)

#### Returns

[`Scope`](index.md#scope)\<`Out`\>

***

### settledToIteration()

> **settledToIteration**\<`Out`\>(`settled`): [`Iteration`](#iteration-1)\<`unknown`, `Out`\>

The step-8 merge-boundary adapter (M4): rehydrate a `Settled.done` into the kernel's
`Iteration` shape so `defaultSelectWinner` stays single-sourced — the supervisor selects
across settled children with the SAME argmax the loop kernel uses, not a forked copy.

`index` is the cursor `seq` (the recorded, replay-stable order); `output`/`verdict`/
`tokenUsage`/`costUsd` are read straight off the settlement (already rehydrated from the
`outRef` blob by `next()`). Events are empty — a settled child is an opaque leaf result,
not a sandbox event stream — and the timing/cost fields project its conserved `Spend`.
Fail loud on a `down` settlement: only a `done` child is an iteration.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### settled

[`Settled`](index.md#settled)\<`Out`\>

#### Returns

[`Iteration`](#iteration-1)\<`unknown`, `Out`\>

***

### createProgressTracker()

> **createProgressTracker**(`opts?`): [`ProgressTracker`](#progresstracker)

Build the settled-work ledger a `StopRule` decides from: record each settlement (idempotent by
 id) and materialize a `ProgressView` combining the best-so-far curve with the live worker feed.

#### Parameters

##### opts?

[`ProgressTrackerOptions`](#progresstrackeroptions) = `{}`

#### Returns

[`ProgressTracker`](#progresstracker)

***

### sampleFromSettled()

> **sampleFromSettled**(`settled`, `at`): [`ProgressSample`](#progresssample)

Build a `ProgressSample` from a scope settlement. The objective is the verdict score and
 `delivered` is the verdict's `valid` — the SAME single delivery signal `finalizeBestDelivered`
 and `defaultSelectWinner` use, so "progress" and "winner" cannot disagree.

#### Parameters

##### settled

[`Settled`](index.md#settled)\<`unknown`\>

##### at

`number`

#### Returns

[`ProgressSample`](#progresssample)

***

### noProgressFor()

> **noProgressFor**(`opts`): [`StopRule`](#stoprule)

"Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no
IMPROVEMENT over the last `settles` settlements.

A tree whose only remaining nodes are armed WAITS is exempt from the time bound: a run waiting
on CI is not a run that stopped making progress, and killing it there would defeat mechanic C.

#### Parameters

##### opts

[`NoProgressForOptions`](#noprogressforoptions)

#### Returns

[`StopRule`](#stoprule)

***

### plateau()

> **plateau**(`opts`): [`StopRule`](#stoprule)

"The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than
`minDelta` across the last `window` settlements.

Built on `anytime.plateauLength` — the same plateau math the post-run anytime report uses, so a
rule that stops a run and a report that grades the decision cannot disagree about whether the
run was flat.

#### Parameters

##### opts

[`PlateauOptions`](#plateauoptions)

#### Returns

[`StopRule`](#stoprule)

***

### allWorkersStalled()

> **allWorkersStalled**(`opts?`): [`StopRule`](#stoprule)

"Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for
longer than the stall threshold — and none of the tree is merely waiting.

`stalled` is a derived read at observation time, never a background watchdog; this rule only
reads it. A tree with armed waits never fires: waiting is not stalling.

#### Parameters

##### opts?

[`AllWorkersStalledOptions`](#allworkersstalledoptions) = `{}`

#### Returns

[`StopRule`](#stoprule)

***

### anyOf()

> **anyOf**(...`rules`): [`StopRule`](#stoprule)

Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end).

#### Parameters

##### rules

...readonly [`StopRule`](#stoprule)[]

#### Returns

[`StopRule`](#stoprule)

***

### allOf()

> **allOf**(...`rules`): [`StopRule`](#stoprule)

Stop only when EVERY rule stops — for a conservative gate that needs corroboration.

#### Parameters

##### rules

...readonly [`StopRule`](#stoprule)[]

#### Returns

[`StopRule`](#stoprule)

***

### workerFromBackend()

> **workerFromBackend**(`backend`, `deliverable?`, `seams?`): [`MakeWorkerAgent`](#makeworkeragent)

Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
deliver"). The ONE place a backend becomes a spawnable worker.

`seams` exists because this path builds the leaf executor EAGERLY and hands it back as a BYO
`executorSpec.executor`. The registry resolves a BYO executor without ever consulting the
per-child `ExecutorContext` the `Scope` seeds, so anything the scope would have supplied is
invisible here and has to be passed in. It is a FUNCTION because it is resolved once per worker
construction, so a caller may hand back something the run only learns later — which is exactly how
`supervise()` gives a traced run's workers their trace context without ordering the span recorder
ahead of the worker seam.

Continuity: the `bridge` backend honors `continuity: 'resume'` by session re-attachment. A
bridge session id IS the harness conversation key (cli-bridge maps it to the CLI's own resume —
opencode `-s <id>`, claude `--resume`), so this seam records the session id each supervised
spawn was bound to, keyed by the worker id the Scope assigned, and a resume spawn binds the
prior worker's recorded session id instead of deriving a fresh one. The record is process-local
by construction, which matches the kernel's resume boundary (a prior process's workers are not
resume targets). Every other backend keeps failing loud: their executors have no re-attachable
session, and accepting the spawn would ledger `continuity: 'resume'` over a brand-new session —
a stamp asserting something that never happened.

#### Parameters

##### backend

[`ExecutorConfig`](#executorconfig)

##### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

##### seams?

() => `Readonly`\<`Record`\<`string`, `unknown`\>\>

#### Returns

[`MakeWorkerAgent`](#makeworkeragent)

***

### supervise()

> **supervise**(`profile`, `task`, `opts`): `Promise`\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>

**`Stable`**

One-call supervisor: build + run a supervisor from its exact profile.

#### Parameters

##### profile

`AgentProfile`

##### task

`unknown`

##### opts

[`SuperviseOptions`](#superviseoptions)

#### Returns

`Promise`\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>

***

### resolveSupervisorProfile()

> **resolveSupervisorProfile**(`profile`): [`ResolvedSupervisorProfile`](#resolvedsupervisorprofile)

Reduce one canonical executable profile to the scalars the two brain arms consume.

#### Parameters

##### profile

`AgentProfile`

#### Returns

[`ResolvedSupervisorProfile`](#resolvedsupervisorprofile)

***

### assertCoordinationBinding()

> **assertCoordinationBinding**(`binding`): `void`

Fail closed on a non-loopback coordination bind. `serveCoordinationMcp` mounts spawn_agent /
steer_agent / stop with NO authentication of any kind (it is a bare JSON-RPC-over-HTTP handler),
so a non-loopback bind lets anyone who can reach the port spawn agents and spend the run's
conserved budget. There is no token to require yet, so the only honest options are loopback or an
explicit, recorded acknowledgment — never a silent bind.

#### Parameters

##### binding

[`CoordinationBinding`](#coordinationbinding) \| `undefined`

#### Returns

`void`

***

### supervisorAgent()

> **supervisorAgent**(`profile`, `deps`): [`Agent`](#agent-2)\<`unknown`, `unknown`\>

Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness`
(backend-as-data), the same resolution rule as every worker.

#### Parameters

##### profile

`AgentProfile`

##### deps

[`SupervisorAgentDeps`](#supervisoragentdeps)

#### Returns

[`Agent`](#agent-2)\<`unknown`, `unknown`\>

***

### createSupervisor()

> **createSupervisor**\<`Task`, `Out`\>(): [`Supervisor`](index.md#supervisor)\<`Task`, `Out`\>

Create a supervisor that owns one recursive agent execution tree.

#### Type Parameters

##### Task

`Task`

##### Out

`Out`

#### Returns

[`Supervisor`](index.md#supervisor)\<`Task`, `Out`\>

***

### createRootHandle()

> **createRootHandle**\<`Out`\>(): [`SteerableRootHandle`](#steerableroothandle)\<`Out`\>

Mint a `RootHandle` plus its supervisor-private control. The handle is the substrate a
chat/pi-viz client attaches to (Q2): `view()` reads the live tree, `signal()` delivers
an out-of-band message, `abort()` cascades. Before `run` binds it (and after `run`
unbinds it) the handle is fail-loud: a client that talks to a handle that is not
driving a live run gets a typed error, never a silent no-op.

#### Type Parameters

##### Out

`Out`

#### Returns

[`SteerableRootHandle`](#steerableroothandle)\<`Out`\>

***

### captureWorkerTraceEvidence()

> **captureWorkerTraceEvidence**(`readSource`, `blobs`, `executed`): `Promise`\<[`WorkerTraceEvidence`](index.md#workertraceevidence)\>

Collect and persist one executor's structured tool trace without changing its task outcome.

#### Parameters

##### readSource

(() => [`TraceSource`](#tracesource-1) \| `undefined`) \| `undefined`

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### executed

`boolean`

#### Returns

`Promise`\<[`WorkerTraceEvidence`](index.md#workertraceevidence)\>

***

### workerTraceAnalysisStore()

> **workerTraceAnalysisStore**(`evidence`, `blobs`): `Promise`\<`TraceAnalysisStore`\>

Rehydrate exact persisted spans through agent-eval's one bounded trace-analysis adapter.

#### Parameters

##### evidence

[`WorkerTraceEvidence`](index.md#workertraceevidence)

##### blobs

`Pick`\<[`ResultBlobStore`](#resultblobstore), `"get"`\>

#### Returns

`Promise`\<`TraceAnalysisStore`\>

***

### parseWorkerToolTraceArtifact()

> **parseWorkerToolTraceArtifact**(`value`, `traceRef?`): [`WorkerToolTraceArtifact`](#workertooltraceartifact)

Validate a stored trace artifact before an analyst or replay trusts it.

#### Parameters

##### value

`unknown`

##### traceRef?

`string` = `'<unknown>'`

#### Returns

[`WorkerToolTraceArtifact`](#workertooltraceartifact)

***

### decodeToolPart()

> **decodeToolPart**(`part`, `harness?`): [`ToolStepInput`](#toolstepinput) \| `undefined`

Decode a part with a specific harness's adapter when known, else try every registered adapter
 (the composite — robust to mixed/unknown streams). Never throws.

#### Parameters

##### part

`unknown`

##### harness?

`string`

#### Returns

[`ToolStepInput`](#toolstepinput) \| `undefined`

***

### createPushTraceSource()

> **createPushTraceSource**(`opts?`): `object`

A push source for OWNED tool loops (router-tools / cli-bridge tool dispatch): the loop calls
 `record(step)` for each tool call; it becomes a span, fan-out to live subscribers + buffered for
 `collect`.

#### Parameters

##### opts?

###### runId?

`string`

###### now?

() => `number`

#### Returns

`object`

##### source

> **source**: [`TraceSource`](#tracesource-1)

##### record

> **record**: (`input`) => `ToolSpan`

###### Parameters

###### input

[`ToolStepInput`](#toolstepinput)

###### Returns

`ToolSpan`

***

### sandboxSessionTraceSource()

> **sandboxSessionTraceSource**(`box`, `sessionId`, `opts?`): [`TraceSource`](#tracesource-1)

The SANDBOX / fleet trace source: read a box session's message parts and decode the harness's tool
 calls into spans. `collect` (settle) is the solid path — `box.messages({sessionId})` → parts → spans;
 black-box harnesses aren't mid-step interruptible, so online steering is the owned-loop's job and a
 live `subscribe` is opt-in (pass `subscribeParts` from `streamPrompt` when the harness streams parts).

#### Parameters

##### box

[`SessionTraceBox`](#sessiontracebox)

##### sessionId

`string`

##### opts?

###### harness?

`string`

The box's harness (e.g. 'opencode', 'claude-code') → selects its decoder adapter.

###### subscribeParts?

(`onPart`) => () => `void`

###### runId?

`string`

###### now?

() => `number`

#### Returns

[`TraceSource`](#tracesource-1)

***

### analyzeTrace()

> **analyzeTrace**(`source`, `runId?`): `Promise`\<[`TrajectoryAnalysis`](#trajectoryanalysis)\>

Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`.

#### Parameters

##### source

[`TraceSource`](#tracesource-1)

##### runId?

`string` = `'worker'`

#### Returns

`Promise`\<[`TrajectoryAnalysis`](#trajectoryanalysis)\>

***

### copyUntrackedIntoClone()

> **copyUntrackedIntoClone**(`sourceDir`, `cloneDir`, `opts?`): [`UntrackedCopyStats`](#untrackedcopystats)

Copy every untracked file of `sourceDir`'s working tree — including git-ignored
build outputs (`git ls-files --others` with NO exclude flags lists both) — into
`cloneDir`, then shield the copied paths from the clone's `git add -A` via
`.git/info/exclude`. Nested git repos (listed as bare `dir/` entries), any path
containing a `.git` segment, and loop-infra dirs are skipped.

#### Parameters

##### sourceDir

`string`

##### cloneDir

`string`

##### opts?

[`CopyOptions`](#copyoptions) = `{}`

#### Returns

[`UntrackedCopyStats`](#untrackedcopystats)

***

### withUntrackedArtifacts()

> **withUntrackedArtifacts**(`ws`, `sourceDir`, `log?`): [`Workspace`](#workspace)

Wrap a `Workspace` so every `materialize` (the per-worker `git clone` inside
`runInWorkspace`) is followed by the untracked-artifact copy above — the clone
the worker starts in matches the source WORKING TREE, not just its history.
`commit`/`head` pass through untouched, so delivery semantics are unchanged.

#### Parameters

##### ws

[`Workspace`](#workspace)

##### sourceDir

`string`

##### log?

(`message`) => `void`

#### Returns

[`Workspace`](#workspace)

***

### timerAt()

> **timerAt**(`ms`, `now`): [`WaitSpec`](#waitspec)

Build a `timer` spec from a DURATION. The instant is resolved once, at arm time — a resumed
 wait re-uses the journaled instant, never a fresh `now + ms`.

#### Parameters

##### ms

`number`

##### now

`number`

#### Returns

[`WaitSpec`](#waitspec)

***

### pollFor()

> **pollFor**(`probe`, `opts`, `now`): [`WaitSpec`](#waitspec)

Build a bounded `poll` spec from a duration.

#### Parameters

##### probe

`string`

##### opts

###### intervalMs

`number`

###### timeoutMs?

`number`

###### args?

`Record`\<`string`, `unknown`\>

##### now

`number`

#### Returns

[`WaitSpec`](#waitspec)

***

### createWaitProbes()

> **createWaitProbes**(`entries`): [`WaitProbeRegistry`](#waitproberegistry)

Registry over a plain name→predicate record.

#### Parameters

##### entries

`Record`\<`string`, [`WaitProbe`](#waitprobe)\>

#### Returns

[`WaitProbeRegistry`](#waitproberegistry)

***

### isWaitOutcome()

> **isWaitOutcome**(`value`): `value is WaitOutcome`

Narrow a settlement's `out` to a wait outcome — a wait settles on the SAME cursor as workers,
 so a driver that mixes them tags them apart with this.

#### Parameters

##### value

`unknown`

#### Returns

`value is WaitOutcome`

***

### waitUntil()

> **waitUntil**(`spec`): `number` \| `undefined`

The absolute instant a spec is bounded by, or `undefined` for an unbounded poll.

#### Parameters

##### spec

[`WaitSpec`](#waitspec)

#### Returns

`number` \| `undefined`

***

### validateWaitSpec()

> **validateWaitSpec**(`spec`): `string` \| `null`

Structural validation, independent of the run. Returns null when the spec is usable.

#### Parameters

##### spec

[`WaitSpec`](#waitspec)

#### Returns

`string` \| `null`

***

### composeWorkerEvidence()

> **composeWorkerEvidence**(`input`): `string`

Compose the settle evidence block. Section order is priority order under the
hard cap: the verify tail (what failed) survives before the diff head (what
was tried) and the worker note — a truncated diff is recoverable from the
persisted patch file, a truncated failing assertion is not recoverable at all.

#### Parameters

##### input

[`WorkerEvidenceInput`](#workerevidenceinput)

#### Returns

`string`

***

### settledWorkerOut()

> **settledWorkerOut**(`input`): `string`

What a settled worker exposes as its output artifact (the blob the brain's
`observe_agent` reads). A passing worker's output is its patch — the
deliverable. A failing worker's output is its evidence block. A passing
worker with NO edits — the post-delivery read-only reviewer: the workspace
already holds a delivered fix, so the gate stays green under an empty diff —
would otherwise settle with an EMPTY output and its review would be lost, so
it exposes its evidence block instead (the worker note carries the review).

#### Parameters

##### input

###### passed

`boolean`

###### patch

`string`

###### evidence

`string`

#### Returns

`string`

***

### closingWorkerNote()

> **closingWorkerNote**(`stdout`, `stderr`): `string` \| `undefined`

The worker's closing commentary off a local harness run: the TAIL of its
stdout (falling back to stderr), bounded to the note cap so a reviewer's
final verdict line — written last — survives into the evidence block
(`composeWorkerEvidence` keeps the note's FIRST `NOTE_MAX_CHARS` chars).

#### Parameters

##### stdout

`string`

##### stderr

`string`

#### Returns

`string` \| `undefined`

***

### readWorkerTraceContext()

> **readWorkerTraceContext**(`ctx`): [`TraceContext`](mcp.md#tracecontext-2) \| `undefined`

Read the inherited trace context off an `ExecutorContext`, or `undefined` when the run records no
spans. Fails CLOSED on a malformed seam value (returns `undefined`) rather than stamping a
half-formed id that would produce an unjoinable orphan span downstream.

#### Parameters

##### ctx

[`WorkerTraceSeamCarrier`](#workertraceseamcarrier)

#### Returns

[`TraceContext`](mcp.md#tracecontext-2) \| `undefined`

***

### workerTraceEnv()

> **workerTraceEnv**(`ctx`): `Record`\<`string`, `string`\>

The trace env to merge into a worker's environment — `TRACEPARENT` plus the legacy
`TRACE_ID` / `PARENT_SPAN_ID` pair (dual-written for one release) — EMPTY when the run
records no spans, which is what keeps the untraced path byte-identical. Merge it BELOW the
caller's own seam env so a deliberately-set id wins (see the precedence note above).

#### Parameters

##### ctx

[`WorkerTraceSeamCarrier`](#workertraceseamcarrier)

#### Returns

`Record`\<`string`, `string`\>

***

### workerTraceHeaders()

> **workerTraceHeaders**(`ctx`): `Record`\<`string`, `string`\>

The trace request headers for a worker dispatched over the cli-bridge HTTP transport — W3C
`traceparent` plus the legacy `x-trace-id` / `x-parent-span-id` pair the bridge also reads —
EMPTY when the run records no spans, which keeps the untraced request byte-identical. Derived
from the same dual-write the env channel uses ([workerTraceEnv](#workertraceenv)), so the header and env
spellings can never name different traces. `traceparent` is present only when a parent span id
exists (the W3C grammar requires one); the legacy pair still carries a lone trace id.

#### Parameters

##### ctx

[`WorkerTraceSeamCarrier`](#workertraceseamcarrier)

#### Returns

`Record`\<`string`, `string`\>

***

### createWorktreeCliExecutor()

> **createWorktreeCliExecutor**(`options`): [`Executor`](index.md#executor-2)\<[`WorktreeHarnessResult`](#worktreeharnessresult)\>

**`Experimental`**

Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a
fanout of N profiles = N parallel worktrees that never clobber each other.

Fail-loud: an empty `repoRoot`, an incomplete/unsupported profile, a separate harness override,
or an explicitly empty `taskPrompt` throws at construction. Calling `execute(undefined, signal)`
without a configured prompt throws before a worktree is created. `resultArtifact()` before
`execute()` resolves throws.

#### Parameters

##### options

[`WorktreeCliExecutorOptions`](#worktreecliexecutoroptions)

#### Returns

[`Executor`](index.md#executor-2)\<[`WorktreeHarnessResult`](#worktreeharnessresult)\>

***

### worktreeFanout()

> **worktreeFanout**\<`Task`\>(`options`): [`CombinatorShape`](#combinatorshape)\<`Task`, [`WorktreeHarnessResult`](#worktreeharnessresult)\>

**`Experimental`**

Build the worktree fanout combinator. Run it with `runPersonified({ persona, shape, task, budget })`
— equal-k holds by construction (the conserved budget pool bounds the N leaves), and selection is
the shared valid-only `selectValidWinner` (never a judge).

#### Type Parameters

##### Task

`Task`

#### Parameters

##### options

[`WorktreeFanoutOptions`](#worktreefanoutoptions)

#### Returns

[`CombinatorShape`](#combinatorshape)\<`Task`, [`WorktreeHarnessResult`](#worktreeharnessresult)\>

***

### harvestSurfaceDiffs()

> **harvestSurfaceDiffs**(`options`): `Promise`\<[`SurfaceDiff`](#surfacediff)[]\>

Re-read every mounted (and watched) surface and report the ones whose settled state differs from
the manifest — modified, removed, or created. Unchanged surfaces and still-absent watched paths
produce no entry; reads run concurrently; output preserves record order, mounts before
watch-only paths. Mounts and watches sharing a path key are each collapsed to the LAST entry,
and a watched path that was also mounted compares against its mount (never reports `created`).

The harvest takes no `AbortSignal`: it is pure fan-out over the read seam and waits on nothing
itself, so every cancellable moment belongs to the reader. Pass a signal to the reader instead
([BoxSurfaceReaderOptions.signal](#signal-27), or close over one in a custom [SurfaceReader](#surfacereader)) —
that cuts the backoff waits, and the harvest still returns the diffs it did establish rather
than discarding settle-time evidence on a late cancellation.

#### Parameters

##### options

[`HarvestSurfaceDiffsOptions`](#harvestsurfacediffsoptions)

#### Returns

`Promise`\<[`SurfaceDiff`](#surfacediff)[]\>

***

### boxSurfaceReader()

> **boxSurfaceReader**(`box`, `options?`): [`SurfaceReader`](#surfacereader)

A [SurfaceReader](#surfacereader) over a sandbox box's filesystem — the same `box.fs.read` seam
`openSandboxRun` reads deliverables through, with the same transient-404 posture (bounded
retry). The box wire returns UTF-8 TEXT (the SDK's binary path is `download()`), which profile
surfaces are; hashes are computed over the UTF-8 encoding, and content the wire had to
lossy-decode (a U+FFFD replacement character) is reported `unreadable` rather than hashed as
mojibake. The SDK's not-found error is detected structurally (`err.name === 'NotFoundError'`)
and maps to `missing: true` — unless its `resourceType` names something other than a file/path
(the BOX or session being gone), which is a transport failure, not an absent surface.

#### Parameters

##### box

[`SurfaceReadBox`](#surfacereadbox)

##### options?

[`BoxSurfaceReaderOptions`](#boxsurfacereaderoptions) = `{}`

#### Returns

[`SurfaceReader`](#surfacereader)

***

### fsSurfaceReader()

> **fsSurfaceReader**(`root`): [`SurfaceReader`](#surfacereader)

A [SurfaceReader](#surfacereader) over the local filesystem, for worktree/local workers. Every path —
relative or absolute — must resolve INSIDE `root`: a path that escapes it (`../`, an absolute
path elsewhere) fails as a contained non-missing outcome rather than reading outside the
worktree, so a persisted or mistyped manifest path cannot turn the harvest into an
existence/hash oracle over the host filesystem. Containment is checked twice — once on the
lexical path, then again on the symlink-resolved path, because `readFile` follows a link and a
link planted inside the root would otherwise read host bytes through a contained-looking name.
Absence maps to `missing: true`; every other failure carries the error message.

#### Parameters

##### root

`string`

#### Returns

[`SurfaceReader`](#surfacereader)

***

### createTangleSandboxExactProcessProvider()

> **createTangleSandboxExactProcessProvider**(`client`, `options?`): `AgentEnvironmentProvider`

Adapt Tangle Sandbox's managed control runtime to Runtime's exact-process provider.

The adapter deliberately exposes no ordinary agent environment: an exact experiment
must start a fresh Sandbox with no managed agent and launch its declared argv directly.

#### Parameters

##### client

[`SandboxControlClient`](#sandboxcontrolclient)

##### options?

[`CreateTangleSandboxExactProcessProviderOptions`](#createtanglesandboxexactprocessprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### createVerifierEnvironment()

> **createVerifierEnvironment**(`opts`): [`AgenticSurface`](#agenticsurface)

Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it.

#### Parameters

##### opts

[`VerifierEnvironmentOptions`](#verifierenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### createWaterfallCollector()

> **createWaterfallCollector**(): [`WaterfallCollector`](#waterfallcollector)

Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline.

#### Returns

[`WaterfallCollector`](#waterfallcollector)

***

### localShell()

> **localShell**(): [`Shell`](#shell)

Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit).

#### Returns

[`Shell`](#shell)

***

### gitWorkspace()

> **gitWorkspace**(`opts`): [`Workspace`](#workspace)

A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned.

#### Parameters

##### opts

[`GitWorkspaceOptions`](#gitworkspaceoptions)

#### Returns

[`Workspace`](#workspace)

***

### jjWorkspace()

> **jjWorkspace**(`opts`): [`Workspace`](#workspace)

A jj-backed `Workspace` (Jujutsu, colocated with git for the durable remote).
 Same port, same `Shell` — a drop-in for `gitWorkspace`. jj suits agent loops:
 no staging area, and a first-class operation log (native resume/undo). Live use
 requires `jj` on the `Shell`'s host.

#### Parameters

##### opts

[`GitWorkspaceOptions`](#gitworkspaceoptions)

#### Returns

[`Workspace`](#workspace)

***

### runInWorkspace()

> **runInWorkspace**\<`T`\>(`ws`, `body`, `opts?`): `Promise`\<[`WorkspaceRun`](#workspacerun)\<`T`\>\>

Run a worker `body` inside a FRESH clone of a shared `Workspace`, then commit its work back
so the next worker (or the supervisor) builds on it. This is the seam that turns isolated
per-worker cwds into one compounding artifact — `body` gets a real materialized dir, its
delivery is committed to the shared ref iff it's valid (a conflict is returned, never thrown).
The clone is removed after; durable state lives only in the ref.

#### Type Parameters

##### T

`T`

#### Parameters

##### ws

[`Workspace`](#workspace)

##### body

(`cwd`) => `Promise`\<\{ `valid`: `boolean`; `value`: `T`; `message?`: `string`; \}\>

##### opts?

###### tmpPrefix?

`string`

###### commitOnInvalid?

`boolean`

#### Returns

`Promise`\<[`WorkspaceRun`](#workspacerun)\<`T`\>\>

## References

### AnalystRegistry

Re-exports [AnalystRegistry](index.md#analystregistry)

***

### CoordinationEvent

Re-exports [CoordinationEvent](index.md#coordinationevent)

***

### WorktreeCheckRunner

Re-exports [WorktreeCheckRunner](index.md#worktreecheckrunner)

***

### createOpenInferenceFileExporter

Re-exports [createOpenInferenceFileExporter](index.md#createopeninferencefileexporter)

***

### createOtelExporter

Re-exports [createOtelExporter](index.md#createotelexporter)

***

### AgentEnvironmentProviderRef

Re-exports [AgentEnvironmentProviderRef](runtime/environment-provider.md#agentenvironmentproviderref)

***

### AgentEnvironmentProviderRegistry

Re-exports [AgentEnvironmentProviderRegistry](runtime/environment-provider.md#agentenvironmentproviderregistry)

***

### createAgentEnvironmentProviderRegistry

Re-exports [createAgentEnvironmentProviderRegistry](runtime/environment-provider.md#createagentenvironmentproviderregistry)

***

### ProviderAsSandboxClientOptions

Re-exports [ProviderAsSandboxClientOptions](runtime/environment-provider.md#providerassandboxclientoptions)

***

### ProviderExecutorOptions

Re-exports [ProviderExecutorOptions](runtime/environment-provider.md#providerexecutoroptions)

***

### providerAsExecutor

Re-exports [providerAsExecutor](runtime/environment-provider.md#providerasexecutor)

***

### providerAsSandboxClient

Re-exports [providerAsSandboxClient](runtime/environment-provider.md#providerassandboxclient)

***

### resolveAgentEnvironmentProvider

Re-exports [resolveAgentEnvironmentProvider](runtime/environment-provider.md#resolveagentenvironmentprovider)

***

### SandboxClientProviderOptions

Re-exports [SandboxClientProviderOptions](runtime/environment-provider.md#sandboxclientprovideroptions)

***

### sandboxClientAsProvider

Re-exports [sandboxClientAsProvider](runtime/environment-provider.md#sandboxclientasprovider)

***

### FinalizeContext

Re-exports [FinalizeContext](index.md#finalizecontext)

***

### SupervisorFinalizer

Re-exports [SupervisorFinalizer](index.md#supervisorfinalizer)

***

### AgentSpec

Re-exports [AgentSpec](index.md#agentspec)

***

### Budget

Re-exports [Budget](index.md#budget-4)

***

### Executor

Re-exports [Executor](index.md#executor-2)

***

### ExecutorRegistry

Re-exports [ExecutorRegistry](index.md#executorregistry)

***

### ProviderModelAttemptEvidence

Re-exports [ProviderModelAttemptEvidence](index.md#providermodelattemptevidence)

***

### ProviderModelExecutionEvidence

Re-exports [ProviderModelExecutionEvidence](index.md#providermodelexecutionevidence)

***

### RootProviderModelEvidence

Re-exports [RootProviderModelEvidence](index.md#rootprovidermodelevidence)

***

### Scope

Re-exports [Scope](index.md#scope)

***

### Settled

Re-exports [Settled](index.md#settled)

***

### Spend

Re-exports [Spend](index.md#spend)

***

### SpendChannel

Re-exports [SpendChannel](index.md#spendchannel)

***

### SpendGap

Re-exports [SpendGap](index.md#spendgap)

***

### SupervisedResult

Re-exports [SupervisedResult](index.md#supervisedresult)

***

### Supervisor

Re-exports [Supervisor](index.md#supervisor)

***

### WorkerTraceEvidence

Re-exports [WorkerTraceEvidence](index.md#workertraceevidence)

***

### WorkerTraceUnavailableReason

Re-exports [WorkerTraceUnavailableReason](index.md#workertraceunavailablereason)

***

### Driver

Re-exports [Driver](index.md#driver)

***

### LoopResult

Re-exports [LoopResult](index.md#loopresult)
