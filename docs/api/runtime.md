[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / runtime

# runtime

## Classes

### InMemoryResultBlobStore

Defined in: [src/durable/spawn-journal.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L70)

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

Defined in: [src/durable/spawn-journal.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L73)

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

Defined in: [src/durable/spawn-journal.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L78)

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### FileResultBlobStore

Defined in: [src/durable/spawn-journal.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L88)

FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
`put` fsyncs so a crash between writes never loses an acknowledged blob.

#### Implements

- [`ResultBlobStore`](#resultblobstore)

#### Constructors

##### Constructor

> **new FileResultBlobStore**(`dir`): [`FileResultBlobStore`](#fileresultblobstore)

Defined in: [src/durable/spawn-journal.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L89)

###### Parameters

###### dir

`string`

###### Returns

[`FileResultBlobStore`](#fileresultblobstore)

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [src/durable/spawn-journal.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L91)

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

Defined in: [src/durable/spawn-journal.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L104)

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### InMemorySpawnJournal

Defined in: [src/durable/spawn-journal.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L140)

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

Defined in: [src/durable/spawn-journal.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L143)

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [src/durable/spawn-journal.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L149)

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

Defined in: [src/durable/spawn-journal.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L162)

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

Defined in: [src/durable/spawn-journal.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L179)

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

Defined in: [src/durable/spawn-journal.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L180)

###### Parameters

###### path

`string`

###### Returns

[`FileSpawnJournal`](#filespawnjournal)

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

Defined in: [src/durable/spawn-journal.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L182)

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [src/durable/spawn-journal.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L212)

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

Defined in: [src/durable/spawn-journal.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L225)

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

Defined in: [src/runtime/personify/corpus.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L162)

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

Defined in: [src/runtime/personify/corpus.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L165)

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

Defined in: [src/runtime/personify/corpus.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L187)

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

Defined in: [src/runtime/personify/corpus.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L203)

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

Defined in: [src/runtime/personify/corpus.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L204)

###### Parameters

###### path

`string`

###### Returns

[`FileCorpus`](#filecorpus)

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [src/runtime/personify/corpus.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L206)

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

Defined in: [src/runtime/personify/corpus.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L234)

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

Defined in: [src/runtime/sandbox-run.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L79)

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

Defined in: [src/runtime/sandbox-run.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L85)

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

Defined in: [src/runtime/sandbox-run.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L80)

**`Experimental`**

###### Overrides

`Error.name`

##### events

> `readonly` **events**: `SandboxEvent`[]

Defined in: [src/runtime/sandbox-run.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L82)

**`Experimental`**

Events drained from the stream before the abort interrupted the turn.

##### readError?

> `readonly` `optional` **readError?**: `string`

Defined in: [src/runtime/sandbox-run.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L84)

**`Experimental`**

The last artifact read error, if the abort fired during the retry loop.

***

### McpSpawnFault

Defined in: [src/runtime/stdio-mcp-client.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L90)

A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
 Graders (the serve verifier) must rethrow this instead of scoring it.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new McpSpawnFault**(`message?`): [`McpSpawnFault`](#mcpspawnfault)

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1082

###### Parameters

###### message?

`string`

###### Returns

[`McpSpawnFault`](#mcpspawnfault)

###### Inherited from

`Error.constructor`

##### Constructor

> **new McpSpawnFault**(`message?`, `options?`): [`McpSpawnFault`](#mcpspawnfault)

Defined in: node\_modules/.pnpm/typescript@5.9.3/node\_modules/typescript/lib/lib.es5.d.ts:1082

###### Parameters

###### message?

`string`

###### options?

`ErrorOptions`

###### Returns

[`McpSpawnFault`](#mcpspawnfault)

###### Inherited from

`Error.constructor`

## Interfaces

### AnalystRegistry

Defined in: [src/mcp/tools/coordination.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L64)

#### Properties

##### kinds

> `readonly` **kinds**: readonly `object`[]

Defined in: [src/mcp/tools/coordination.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L65)

##### run

> `readonly` **run**: (`kindId`, `trace`) => `Promise`\<`unknown`\>

Defined in: [src/mcp/tools/coordination.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L66)

###### Parameters

###### kindId

`string`

###### trace

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### WorktreeCommandResult

Defined in: [src/mcp/worktree-harness.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L49)

Outcome of one verification command run in the worktree (test or typecheck).

#### Properties

##### command

> **command**: `string`

Defined in: [src/mcp/worktree-harness.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L51)

The shell command line that was run.

##### passed

> **passed**: `boolean`

Defined in: [src/mcp/worktree-harness.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L53)

Did the command exit 0? The PASS signal a deliverable gate / coder output reads.

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: [src/mcp/worktree-harness.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L55)

OS exit code, or `null` when killed before exit.

##### output

> **output**: `string`

Defined in: [src/mcp/worktree-harness.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L57)

Combined stdout+stderr (capped) — surfaced in traces for diagnosis.

***

### WorktreeProfileMaterializationReceipt

Defined in: [src/mcp/worktree-harness.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L61)

Proof of the profile inputs delivered before the worker process started.

#### Properties

##### workspacePlanDigest

> **workspacePlanDigest**: `string`

Defined in: [src/mcp/worktree-harness.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L63)

Digest of the exact materializer plan: files, modes, environment, flags, and unsupported rows.

##### writtenPaths

> **writtenPaths**: `string`[]

Defined in: [src/mcp/worktree-harness.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L65)

Repository-relative profile input files written into the worker worktree.

##### unsupported

> **unsupported**: `Unsupported`[]

Defined in: [src/mcp/worktree-harness.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L67)

Must be empty on a successful run because this path fails closed.

##### environmentNames

> **environmentNames**: `string`[]

Defined in: [src/mcp/worktree-harness.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L69)

Environment variable names added to the worker process. Values remain out of telemetry.

##### flags

> **flags**: `string`[]

Defined in: [src/mcp/worktree-harness.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L71)

Exact additional CLI arguments emitted by the materializer.

##### resourceInstructions

> **resourceInstructions**: `object`

Defined in: [src/mcp/worktree-harness.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L73)

`resources.instructions` bypasses native project files so reproducible Codex cannot drop it.

###### delivery

> **delivery**: `"none"` \| `"invocation-prompt"`

###### sha256

> **sha256**: `string` \| `null`

###### byteLength

> **byteLength**: `number`

***

### AnytimeTaskCurve

Defined in: [src/runtime/anytime.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L25)

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [src/runtime/anytime.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L26)

##### strategy

> **strategy**: `string`

Defined in: [src/runtime/anytime.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L27)

##### points

> **points**: `object`[]

Defined in: [src/runtime/anytime.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L30)

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

Defined in: [src/runtime/anytime.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L33)

Per satisficing target (keyed by the target value as a string): the first point
 where best ≥ target, or null when never reached within budget.

***

### AnytimeStrategySummary

Defined in: [src/runtime/anytime.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L36)

#### Properties

##### strategy

> **strategy**: `string`

Defined in: [src/runtime/anytime.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L37)

##### target

> **target**: `number`

Defined in: [src/runtime/anytime.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L39)

The satisficing target this row summarizes.

##### tasks

> **tasks**: `number`

Defined in: [src/runtime/anytime.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L40)

##### reachedTarget

> **reachedTarget**: `number`

Defined in: [src/runtime/anytime.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L41)

##### medianTttMs

> **medianTttMs**: `number` \| `null`

Defined in: [src/runtime/anytime.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L43)

Median time-to-target over the tasks that reached it (null when none did).

##### medianShotsToTarget

> **medianShotsToTarget**: `number` \| `null`

Defined in: [src/runtime/anytime.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L44)

##### ertMs

> **ertMs**: `number` \| `null`

Defined in: [src/runtime/anytime.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L46)

COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed.

##### erUsd

> **erUsd**: `number` \| `null`

Defined in: [src/runtime/anytime.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L48)

Same construction over dollars: Σ all spend / #successes.

##### curveByShot

> **curveByShot**: `number`[]

Defined in: [src/runtime/anytime.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L50)

Mean best-so-far score by shot index (the anytime curve, averaged over tasks).

##### auc

> **auc**: `number`

Defined in: [src/runtime/anytime.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L52)

Area under the per-shot anytime curve, normalized to [0,1].

***

### AnytimeReport

Defined in: [src/runtime/anytime.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L55)

#### Properties

##### targets

> **targets**: `number`[]

Defined in: [src/runtime/anytime.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L56)

##### perTask

> **perTask**: [`AnytimeTaskCurve`](#anytimetaskcurve)[]

Defined in: [src/runtime/anytime.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L57)

##### perStrategy

> **perStrategy**: [`AnytimeStrategySummary`](#anytimestrategysummary)[]

Defined in: [src/runtime/anytime.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L59)

One summary per (strategy, target) pair — the COCO-style multi-target view.

***

### AuditIntentInput

Defined in: [src/runtime/audit-intent.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L29)

#### Properties

##### declaredIntent

> **declaredIntent**: `string`

Defined in: [src/runtime/audit-intent.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L31)

The declared intent: the task text / acceptance criteria the agent was given.

##### trace

> **trace**: readonly `unknown`[]

Defined in: [src/runtime/audit-intent.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L33)

The trajectory so far — tool calls + results + assistant turns (any event shapes).

##### userIntent?

> `optional` **userIntent?**: `string`

Defined in: [src/runtime/audit-intent.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L35)

The principal's actual intent when it differs from the literal task (the contract).

##### metaIntent?

> `optional` **metaIntent?**: `string`

Defined in: [src/runtime/audit-intent.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L38)

The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
 flag locally-sensible work that serves the wrong larger objective.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/runtime/audit-intent.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L39)

***

### AuditIntentOptions

Defined in: [src/runtime/audit-intent.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L42)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [src/runtime/audit-intent.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L43)

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/audit-intent.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L44)

##### auditorInstruction?

> `optional` **auditorInstruction?**: `string`

Defined in: [src/runtime/audit-intent.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L46)

Override the auditor instruction (optimizable like any analyst prompt).

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [src/runtime/audit-intent.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L48)

Cap trace lines fed to the auditor. Default 80.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/audit-intent.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L49)

***

### IntentAudit

Defined in: [src/runtime/audit-intent.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L52)

#### Properties

##### revealedIntent

> **revealedIntent**: `string`

Defined in: [src/runtime/audit-intent.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L54)

What the agent's actions reveal it is actually optimizing — one sentence.

##### verdict

> **verdict**: `"aligned"` \| `"drifting"` \| `"diverged"`

Defined in: [src/runtime/audit-intent.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L55)

##### evidence

> **evidence**: `string`

Defined in: [src/runtime/audit-intent.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L57)

Trajectory-grounded evidence for the verdict (specific calls/patterns).

##### recommendation

> **recommendation**: `"abort"` \| `"continue"` \| `"steer"`

Defined in: [src/runtime/audit-intent.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L59)

The single recommended intervention.

##### steer?

> `optional` **steer?**: `string`

Defined in: [src/runtime/audit-intent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L61)

When recommendation is 'steer': the corrective instruction to inject.

##### confidence

> **confidence**: `number`

Defined in: [src/runtime/audit-intent.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L62)

***

### LeaderboardOptions

Defined in: [src/runtime/benchmark-report.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L38)

#### Properties

##### title?

> `readonly` `optional` **title?**: `string`

Defined in: [src/runtime/benchmark-report.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L39)

##### scoreOf?

> `readonly` `optional` **scoreOf?**: `ScoreOf`

Defined in: [src/runtime/benchmark-report.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L40)

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: `ProfileKeyOf`

Defined in: [src/runtime/benchmark-report.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L41)

##### groupOf?

> `readonly` `optional` **groupOf?**: `GroupOf`

Defined in: [src/runtime/benchmark-report.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L42)

##### axisScoresOf?

> `readonly` `optional` **axisScoresOf?**: `AxisScoresOf`

Defined in: [src/runtime/benchmark-report.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L43)

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

Defined in: [src/runtime/benchmark-report.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L45)

Display label for a profile key (default: the key itself).

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/benchmark-report.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L47)

Commit SHA / dataset / dates surfaced in the provenance block.

##### stats?

> `readonly` `optional` **stats?**: `boolean`

Defined in: [src/runtime/benchmark-report.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L50)

Compute per-row confidence intervals (bootstrap on score, Wilson on pass rate). Needs a
 `scenarioId` on every record (reps are collapsed per scenario for the honest n). Default off.

##### passThreshold?

> `readonly` `optional` **passThreshold?**: `number`

Defined in: [src/runtime/benchmark-report.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L53)

A score ≥ this counts as a "pass" for the pass-rate proportion + its Wilson CI. Default 0.999
 (fully solved). Lower it (e.g. 0.6) for a partial-credit domain.

***

### Interval

Defined in: [src/runtime/benchmark-report.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L57)

A 95%-by-default confidence interval.

#### Properties

##### lower

> `readonly` **lower**: `number`

Defined in: [src/runtime/benchmark-report.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L58)

##### upper

> `readonly` **upper**: `number`

Defined in: [src/runtime/benchmark-report.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L59)

***

### LeaderboardRow

Defined in: [src/runtime/benchmark-report.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L63)

One leaderboard row — a harness×model profile, every measured column.

#### Properties

##### profileKey

> `readonly` **profileKey**: `string`

Defined in: [src/runtime/benchmark-report.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L64)

##### label

> `readonly` **label**: `string`

Defined in: [src/runtime/benchmark-report.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L65)

##### model

> `readonly` **model**: `string`

Defined in: [src/runtime/benchmark-report.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L66)

##### n

> `readonly` **n**: `number`

Defined in: [src/runtime/benchmark-report.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L67)

##### meanScore

> `readonly` **meanScore**: `number`

Defined in: [src/runtime/benchmark-report.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L68)

##### solveRate

> `readonly` **solveRate**: `number`

Defined in: [src/runtime/benchmark-report.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L70)

Fraction of records scoring ≥ `passThreshold` (default 0.999) — the binary pass rate.

##### perAxis

> `readonly` **perAxis**: `Record`\<`string`, `number`\>

Defined in: [src/runtime/benchmark-report.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L72)

axis → mean score for this profile (blank in render when the profile never ran that axis).

##### costUsd

> `readonly` **costUsd**: `number`

Defined in: [src/runtime/benchmark-report.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L73)

##### tokensIn

> `readonly` **tokensIn**: `number`

Defined in: [src/runtime/benchmark-report.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L74)

##### tokensOut

> `readonly` **tokensOut**: `number`

Defined in: [src/runtime/benchmark-report.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L75)

##### latencyP50Ms

> `readonly` **latencyP50Ms**: `number`

Defined in: [src/runtime/benchmark-report.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L76)

##### latencyP90Ms

> `readonly` **latencyP90Ms**: `number`

Defined in: [src/runtime/benchmark-report.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L77)

##### scoreCi?

> `readonly` `optional` **scoreCi?**: [`Interval`](#interval)

Defined in: [src/runtime/benchmark-report.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L80)

Bootstrap CI on the mean score — present only when `opts.stats` is set. Computed over
 per-scenario means (reps collapsed first), so identical reps can't fake a narrow interval.

##### passCi?

> `readonly` `optional` **passCi?**: [`Interval`](#interval)

Defined in: [src/runtime/benchmark-report.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L82)

Wilson CI on the pass rate — present only when `opts.stats` is set.

***

### Leaderboard

Defined in: [src/runtime/benchmark-report.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L85)

#### Properties

##### title

> `readonly` **title**: `string`

Defined in: [src/runtime/benchmark-report.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L86)

##### axes

> `readonly` **axes**: readonly `string`[]

Defined in: [src/runtime/benchmark-report.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L88)

Column order — scenario groups (default) or dimension keys (`axisScoresOf`).

##### profiles

> `readonly` **profiles**: readonly [`LeaderboardRow`](#leaderboardrow)[]

Defined in: [src/runtime/benchmark-report.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L90)

Rows ranked by `meanScore` desc (ties → lower cost, then label).

##### meta

> `readonly` **meta**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/benchmark-report.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L91)

##### provenance

> `readonly` **provenance**: `object`

Defined in: [src/runtime/benchmark-report.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L93)

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

> `readonly` **totalCostUsd**: `number`

***

### PairwiseVerdict

Defined in: [src/runtime/benchmark-report.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L264)

One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict.

#### Properties

##### a

> `readonly` **a**: `string`

Defined in: [src/runtime/benchmark-report.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L265)

##### b

> `readonly` **b**: `string`

Defined in: [src/runtime/benchmark-report.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L266)

##### pairs

> `readonly` **pairs**: `number`

Defined in: [src/runtime/benchmark-report.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L268)

Paired unit count (shared scenarios). The significance is suppressed below `minPairs`.

##### delta

> `readonly` **delta**: `number`

Defined in: [src/runtime/benchmark-report.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L270)

Median paired delta (b − a) and its bootstrap CI.

##### ciLow

> `readonly` **ciLow**: `number`

Defined in: [src/runtime/benchmark-report.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L271)

##### ciHigh

> `readonly` **ciHigh**: `number`

Defined in: [src/runtime/benchmark-report.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L272)

##### p

> `readonly` **p**: `number`

Defined in: [src/runtime/benchmark-report.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L274)

Paired-test p-value (before correction).

##### significant

> `readonly` **significant**: `boolean`

Defined in: [src/runtime/benchmark-report.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L276)

BH-significant across ALL pairs AND above the `minPairs` power floor.

***

### PairwiseOptions

Defined in: [src/runtime/benchmark-report.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L279)

#### Properties

##### scoreOf?

> `readonly` `optional` **scoreOf?**: `ScoreOf`

Defined in: [src/runtime/benchmark-report.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L280)

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: `ProfileKeyOf`

Defined in: [src/runtime/benchmark-report.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L281)

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

Defined in: [src/runtime/benchmark-report.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L282)

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### fdr?

> `readonly` `optional` **fdr?**: `number`

Defined in: [src/runtime/benchmark-report.ts:284](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L284)

False-discovery rate for the Benjamini–Hochberg correction. Default 0.05.

##### minPairs?

> `readonly` `optional` **minPairs?**: `number`

Defined in: [src/runtime/benchmark-report.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L287)

Below this many shared scenarios a paired test can't defensibly separate two profiles, so the
 `significant` tag is suppressed regardless of p (small-n mirage protection). Default 12.

***

### CompletionEvidence

Defined in: [src/runtime/completion.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L30)

Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 never the judge's own verdict. Mirrors the steer-firewall's provenance discipline.

#### Properties

##### kind

> **kind**: `"artifact"` \| `"metric"`

Defined in: [src/runtime/completion.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L31)

##### uri

> **uri**: `string`

Defined in: [src/runtime/completion.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L32)

***

### CompletionVerdict

Defined in: [src/runtime/completion.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L36)

The "is it done?" verdict an analyst returns to the parent.

#### Properties

##### done

> **done**: `boolean`

Defined in: [src/runtime/completion.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L37)

##### determinism

> **determinism**: `"deterministic"` \| `"probabilistic"`

Defined in: [src/runtime/completion.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L39)

How verifiable the claim is — sets whether the driver trusts it or validates it.

##### reasons?

> `optional` **reasons?**: `string`

Defined in: [src/runtime/completion.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L41)

Why the analyst believes it is (or isn't) done — what the driver validates.

##### confidence?

> `optional` **confidence?**: `number`

Defined in: [src/runtime/completion.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L43)

0..1, for probabilistic verdicts; the driver's validation threshold reads this.

##### evidence?

> `optional` **evidence?**: readonly [`CompletionEvidence`](#completionevidence)[]

Defined in: [src/runtime/completion.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L44)

***

### CompletionAnalyst

Defined in: [src/runtime/completion.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L49)

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

Defined in: [src/runtime/completion.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L50)

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

Defined in: [src/runtime/completion.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L58)

When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 probabilistic → validate by confidence threshold (the driver's check).

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [src/runtime/completion.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L60)

Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8.

***

### LeaderboardScore

Defined in: [src/runtime/define-leaderboard.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L62)

Structured per-case verdict a `score` function may return (a bare number is
 shorthand for `{ composite }`). `composite` is the [0,1] leaderboard score;
 `dimensions` are recorded as extra judge dimensions.

#### Properties

##### composite

> **composite**: `number`

Defined in: [src/runtime/define-leaderboard.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L63)

##### dimensions?

> `optional` **dimensions?**: `Record`\<`string`, `number`\>

Defined in: [src/runtime/define-leaderboard.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L64)

##### notes?

> `optional` **notes?**: `string`

Defined in: [src/runtime/define-leaderboard.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L65)

***

### LeaderboardScenario

Defined in: [src/runtime/define-leaderboard.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L70)

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

Defined in: [src/runtime/define-leaderboard.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L71)

***

### LeaderboardFlagSpec

Defined in: [src/runtime/define-leaderboard.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L76)

One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>`
 and surfaced to every hook via `ctx.args`.

#### Properties

##### default?

> `optional` **default?**: `string`

Defined in: [src/runtime/define-leaderboard.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L77)

##### description

> **description**: `string`

Defined in: [src/runtime/define-leaderboard.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L78)

***

### LeaderboardRunContext

Defined in: [src/runtime/define-leaderboard.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L82)

Resolved run configuration handed to `setup` / `teardown` / `export`.

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/define-leaderboard.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L83)

##### backend

> **backend**: `string`

Defined in: [src/runtime/define-leaderboard.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L85)

Execution backend name (`--backend`), a key of `backends`.

##### runDir

> **runDir**: `string`

Defined in: [src/runtime/define-leaderboard.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L86)

##### exportDir

> **exportDir**: `string`

Defined in: [src/runtime/define-leaderboard.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L87)

##### args

> **args**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: [src/runtime/define-leaderboard.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L89)

Every parsed flag (standard + `spec.flags`), by name without `--`.

##### harnesses

> **harnesses**: readonly `HarnessType`[]

Defined in: [src/runtime/define-leaderboard.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L90)

##### models

> **models**: readonly `string`[]

Defined in: [src/runtime/define-leaderboard.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L92)

Snapshot-stamped model ids (`name@snapshot`) — the eval identity models.

##### caseIds

> **caseIds**: readonly `string`[]

Defined in: [src/runtime/define-leaderboard.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L93)

##### shots

> **shots**: `number`

Defined in: [src/runtime/define-leaderboard.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L94)

##### reps

> **reps**: `number`

Defined in: [src/runtime/define-leaderboard.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L95)

***

### LeaderboardBenchTask

Defined in: [src/runtime/define-leaderboard.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L100)

Structurally `BenchTask` (bench registry shape) — declared locally so this
 module adds no dependency on a benchmark package.

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime/define-leaderboard.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L101)

##### prompt

> **prompt**: `string`

Defined in: [src/runtime/define-leaderboard.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L102)

##### split?

> `optional` **split?**: `string`

Defined in: [src/runtime/define-leaderboard.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L103)

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime/define-leaderboard.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L104)

***

### LeaderboardBenchScore

Defined in: [src/runtime/define-leaderboard.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L108)

Structurally `BenchScore` (bench registry shape).

#### Properties

##### resolved

> **resolved**: `boolean`

Defined in: [src/runtime/define-leaderboard.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L109)

##### score

> **score**: `number`

Defined in: [src/runtime/define-leaderboard.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L110)

##### detail?

> `optional` **detail?**: `string`

Defined in: [src/runtime/define-leaderboard.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L111)

***

### LeaderboardBenchmarkAdapter

Defined in: [src/runtime/define-leaderboard.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L118)

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

Defined in: [src/runtime/define-leaderboard.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L119)

#### Methods

##### preflight()

> **preflight**(): `Promise`\<`void`\>

Defined in: [src/runtime/define-leaderboard.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L120)

###### Returns

`Promise`\<`void`\>

##### loadTasks()

> **loadTasks**(`opts?`): `Promise`\<[`LeaderboardBenchTask`](#leaderboardbenchtask)[]\>

Defined in: [src/runtime/define-leaderboard.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L121)

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

Defined in: [src/runtime/define-leaderboard.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L126)

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### artifact

`TArtifact`

###### Returns

`Promise`\<[`LeaderboardBenchScore`](#leaderboardbenchscore)\>

##### goldArtifact()

> **goldArtifact**(`task`): `Promise`\<`string` \| `undefined`\>

Defined in: [src/runtime/define-leaderboard.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L127)

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### LeaderboardIterationInfo

Defined in: [src/runtime/define-leaderboard.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L133)

Per-shot outcome context passed as `onCellEvents`'s third argument — how a
 thrown shot (which never reaches `parseOutput`) stays visible through the
 facade instead of surfacing only as an empty zero-token cell.

#### Properties

##### index

> **index**: `number`

Defined in: [src/runtime/define-leaderboard.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L135)

0-based shot index within the cell.

##### error?

> `optional` **error?**: `string`

Defined in: [src/runtime/define-leaderboard.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L137)

The shot's thrown error message, when the shot failed before scoring.

##### verdict?

> `optional` **verdict?**: `object`

Defined in: [src/runtime/define-leaderboard.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L139)

The shot's validator verdict, when the shot reached scoring.

###### score?

> `optional` **score?**: `number`

***

### LeaderboardSpec

Defined in: [src/runtime/define-leaderboard.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L148)

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

Defined in: [src/runtime/define-leaderboard.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L150)

Leaderboard name — the scenario `kind`, default profile name, and report title.

##### cases

> **cases**: `TCase`[]

Defined in: [src/runtime/define-leaderboard.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L152)

The case corpus. Every case needs a stable string id (see `caseId`).

##### caseId?

> `optional` **caseId?**: (`c`) => `string`

Defined in: [src/runtime/define-leaderboard.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L155)

Stable id extractor. Default: the case's own `id` property (fail-loud
 when absent or not a string).

###### Parameters

###### c

`TCase`

###### Returns

`string`

##### prompt

> **prompt**: (`c`) => `string` \| `Promise`\<`string`\>

Defined in: [src/runtime/define-leaderboard.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L158)

The per-case task prompt. May be async (e.g. built by shelling out to a
 reference implementation); resolved ONCE per case before dispatch.

###### Parameters

###### c

`TCase`

###### Returns

`string` \| `Promise`\<`string`\>

##### score

> **score**: (`output`, `c`) => `number` \| [`LeaderboardScore`](#leaderboardscore)

Defined in: [src/runtime/define-leaderboard.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L162)

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

Defined in: [src/runtime/define-leaderboard.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L166)

Harness × model axes for `expandProfileAxes`. Defaults: the canonical
 `CODING_HARNESSES` × the base profile's `model.default`. `--harnesses` /
 `--models` override per run.

###### harnesses?

> `optional` **harnesses?**: readonly `HarnessType`[]

###### models?

> `optional` **models?**: readonly `string`[]

##### baseProfile?

> `optional` **baseProfile?**: `AgentProfile`

Defined in: [src/runtime/define-leaderboard.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L169)

Base profile the axes expand over (prompt/tools/skills held fixed).
 Default: a minimal `{ name, model: { default: <first model> } }`.

##### backends?

> `optional` **backends?**: `Record`\<`string`, (() => [`SandboxClient`](#sandboxclient-3)) \| `undefined`\>

Defined in: [src/runtime/define-leaderboard.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L179)

Execution-backend registry: `--backend <name>` picks the factory that
yields the `SandboxClient` every cell runs on. Merged over the defaults:
  - `sandbox` — throws with guidance (a product must supply its real
    Sandbox-backed client; the facade has no credentials).
  - `cli-bridge` — `resolveSandboxClient({ backend: 'bridge' })` reading
    `CLI_BRIDGE_URL` + `BRIDGE_BEARER`/`CLI_BRIDGE_BEARER`; the per-cell
    harness/model ride in via `sandboxOverrides.backend`.

##### flags?

> `optional` **flags?**: `Record`\<`string`, [`LeaderboardFlagSpec`](#leaderboardflagspec)\>

Defined in: [src/runtime/define-leaderboard.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L181)

Extra `--flag value` CLI args `run()` parses and surfaces via `ctx.args`.

##### modelBackend?

> `optional` **modelBackend?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime/define-leaderboard.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L185)

Extra fields merged into each cell's `backend.model` create override —
 e.g. `{ provider: 'openai-compat', apiKey, baseUrl }` for a router-backed
 sandbox. The cell's bare model id is set by the facade from the axis.

##### setup?

> `optional` **setup?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/define-leaderboard.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L187)

Runs once before the matrix (fetch fixtures, warm caches).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### teardown?

> `optional` **teardown?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/define-leaderboard.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L189)

Runs once after the matrix, even on failure (reap boxes, close handles).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onCellEvents?

> `optional` **onCellEvents?**: (`events`, `c`, `iteration?`) => `void`

Defined in: [src/runtime/define-leaderboard.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L195)

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

Defined in: [src/runtime/define-leaderboard.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L205)

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

Defined in: [src/runtime/define-leaderboard.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L215)

Resolve the model the backend ACTUALLY served off a shot's raw events.
Required for HARNESS_NATIVE_MODEL-snapped cells (a vendor-locked harness ×
an out-of-family model expands to the `default` sentinel): the RunRecord
must pin a real snapshot-bearing model id, which only the dispatch —
reading the backend's usage/terminal events — can know. When this returns
a value the default dispatch records it on the paid-call receipt;
in-family cells (concrete declared model) never need it.

###### Parameters

###### events

readonly `SandboxEvent`[]

###### Returns

`string` \| `undefined`

##### export?

> `optional` **export?**: (`result`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/define-leaderboard.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L218)

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

Defined in: [src/runtime/define-leaderboard.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L224)

LEVEL 2 — full dispatch replacement (in-process products bring their own).
 The default is `loopDispatch` + `naiveDriver` over the resolved backend.

##### judges?

> `optional` **judges?**: `JudgeConfig`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>[]

Defined in: [src/runtime/define-leaderboard.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L226)

LEVEL 2 — full judge replacement. Default: `score` wrapped as one judge.

##### shots?

> `optional` **shots?**: `number`

Defined in: [src/runtime/define-leaderboard.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L228)

Naive-retry shot cap per cell (`--shots`). Default 1.

##### reps?

> `optional` **reps?**: `number`

Defined in: [src/runtime/define-leaderboard.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L230)

Replicates per cell (`--reps`). Default 1.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`profile`, `scenario`) => MaximumCharge \| undefined)

Defined in: [src/runtime/define-leaderboard.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L233)

Provider- or executor-enforced maximum for one cell dispatch. Required
before execution when `matrix.costCeiling` is configured.

##### matrix?

> `optional` **matrix?**: `Partial`\<`RunProfileMatrixOptions`\<[`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>, `TArtifact`\>\>

Defined in: [src/runtime/define-leaderboard.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L239)

Passthrough overrides spread onto the final `runProfileMatrix` call
 (e.g. `maxConcurrency`, `costCeiling`, `integrity`, `storage`) — spread
 LAST, so anything the facade wired can be overridden.

***

### DefinedLeaderboard

Defined in: [src/runtime/define-leaderboard.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L242)

#### Type Parameters

##### TCase

`TCase`

##### TArtifact

`TArtifact` = `string`

#### Methods

##### run()

> **run**(`argv?`): `Promise`\<`RunProfileMatrixResult`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>\>

Defined in: [src/runtime/define-leaderboard.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L256)

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

Defined in: [src/runtime/define-leaderboard.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L258)

The same domain surface in the structural `BenchmarkAdapter` shape.

###### Returns

[`LeaderboardBenchmarkAdapter`](#leaderboardbenchmarkadapter)\<`TArtifact`\>

***

### HarvestCorpusOptions

Defined in: [src/runtime/harvest-corpus.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L28)

#### Properties

##### runs

> **runs**: `AsyncIterable`\<[`ObserveInput`](#observeinput), `any`, `any`\> \| `Iterable`\<[`ObserveInput`](#observeinput), `any`, `any`\>

Defined in: [src/runtime/harvest-corpus.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L30)

The completed runs to analyze — map your store's rows to `ObserveInput`.

##### chat

> **chat**: `ChatClient`

Defined in: [src/runtime/harvest-corpus.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L32)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/harvest-corpus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L33)

##### corpus

> **corpus**: [`Corpus`](#corpus-2)

Defined in: [src/runtime/harvest-corpus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L35)

The durable corpus the facts accrete into.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [src/runtime/harvest-corpus.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L37)

Tags written onto learned facts (the product/domain key the read side queries by).

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [src/runtime/harvest-corpus.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L39)

Override the analyst instruction (the GEPA-tunable knob).

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [src/runtime/harvest-corpus.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L41)

Runs analyzed in parallel. Default 4.

##### maxRuns?

> `optional` **maxRuns?**: `number`

Defined in: [src/runtime/harvest-corpus.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L43)

Hard cap on runs consumed from the stream (a cost guard for unbounded stores).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/harvest-corpus.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L44)

***

### HarvestFailure

Defined in: [src/runtime/harvest-corpus.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L47)

#### Properties

##### runId

> **runId**: `string`

Defined in: [src/runtime/harvest-corpus.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L48)

##### error

> **error**: `string`

Defined in: [src/runtime/harvest-corpus.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L49)

***

### HarvestReport

Defined in: [src/runtime/harvest-corpus.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L52)

#### Properties

##### runsObserved

> **runsObserved**: `number`

Defined in: [src/runtime/harvest-corpus.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L53)

##### findings

> **findings**: `number`

Defined in: [src/runtime/harvest-corpus.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L55)

Total findings the analyst produced (including ones already known).

##### learned

> **learned**: `number`

Defined in: [src/runtime/harvest-corpus.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L57)

NEW facts actually appended (idempotent dedup excludes re-learned ones).

##### failures

> **failures**: [`HarvestFailure`](#harvestfailure)[]

Defined in: [src/runtime/harvest-corpus.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L59)

Per-run analysis failures — reported, never silently dropped.

***

### InProcessPromptCtx

Defined in: [src/runtime/in-process-sandbox-client.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L44)

Context handed to each `onPrompt` / `onTask` call.

#### Properties

##### round

> **round**: `number`

Defined in: [src/runtime/in-process-sandbox-client.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L48)

0-based round index — increments per `streamPrompt`/`streamTask` on the
 SAME box (so a refine driver's round N can differ from round N-1). Fresh
 boxes start at 0.

##### workdir?

> `optional` **workdir?**: `string`

Defined in: [src/runtime/in-process-sandbox-client.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L52)

Absolute path of this box's workspace, when a `workdir` was configured.
 Write the deliverable / fixtures here; `fs.read`/`fs.write`/`exec` operate
 over it. `undefined` for pure event-only boxes.

##### signal

> **signal**: `AbortSignal`

Defined in: [src/runtime/in-process-sandbox-client.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L54)

Cooperative cancellation channel for this turn.

##### mode

> **mode**: `"task"` \| `"prompt"`

Defined in: [src/runtime/in-process-sandbox-client.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L57)

Which box verb produced this call: `prompt` = `streamPrompt`,
 `task` = `streamTask`.

##### options?

> `optional` **options?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime/in-process-sandbox-client.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L61)

The verbatim per-call options the caller passed to the box verb (minus
 `signal`, surfaced above) — lets an offline test assert an options
 passthrough (`model`, `sessionId`, `maxTurns`, …) actually arrived.

***

### InProcessSandboxClientOptions

Defined in: [src/runtime/in-process-sandbox-client.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L76)

**`Experimental`**

#### Properties

##### onPrompt

> **onPrompt**: [`InProcessOnPrompt`](#inprocessonprompt)

Defined in: [src/runtime/in-process-sandbox-client.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L78)

**`Experimental`**

The per-turn behavior — see [InProcessOnPrompt](#inprocessonprompt).

##### onTask?

> `optional` **onTask?**: [`InProcessOnPrompt`](#inprocessonprompt)

Defined in: [src/runtime/in-process-sandbox-client.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L86)

**`Experimental`**

Task-mode behavior, driven by `box.streamTask` (the verb `streamAgentTurn`'s
`box-task` backend calls). When omitted, `streamTask` drives `onPrompt` —
the pseudo-box has ONE behavior callback and both verbs exercise it
(`ctx.mode` tells them apart). Provide `onTask` when a test must
discriminate the verbs or script different task-mode behavior.

##### workdir?

> `optional` **workdir?**: `string`

Defined in: [src/runtime/in-process-sandbox-client.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L94)

**`Experimental`**

Opt in to a REAL filesystem-backed box. When set, each `create()` mints a
fresh temp directory (prefixed `<workdir>-`) and the box exposes
`fs.read`/`fs.write` and `exec` over it; `delete()` removes the dir. Omit
for a pure event-only box (no `fs`/`exec` members), which is all a driver
or fanout loop needs.

##### id?

> `optional` **id?**: `string` \| ((`seq`) => `string`)

Defined in: [src/runtime/in-process-sandbox-client.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L101)

**`Experimental`**

Override the box `id`. A string is used verbatim; a function receives the
0-based create-sequence and returns the id (e.g. machine-keyed placement
demos). Default `in-process-<seq>`. The id is the value `describePlacement`
tags, so set it when a demo's output reads on a meaningful sandbox id.

***

### KeyProvider

Defined in: [src/runtime/key-provider.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L36)

Resolve named secrets. The ONE seam every secret store adapts to.

#### Methods

##### get()

> **get**(`name`): `Promise`\<`string` \| `undefined`\>

Defined in: [src/runtime/key-provider.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L38)

The value for `name`, or `undefined` when this provider does not hold it.

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### LocalSandboxClientOptions

Defined in: [src/runtime/local-sandbox-client.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L33)

#### Properties

##### router

> **router**: `object`

Defined in: [src/runtime/local-sandbox-client.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L35)

The worker brain: router chat-completions with tool-calling. All three required.

###### baseUrl

> **baseUrl**: `string`

###### key

> **key**: `string`

###### model

> **model**: `string`

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: [src/runtime/local-sandbox-client.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L37)

Tool-loop turns per prompt. Default 8.

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/local-sandbox-client.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L39)

Brain sampling temperature. Default: `routerBrain`'s (0.4).

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: [src/runtime/local-sandbox-client.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L41)

Fallback profile when `create(options)` carries none on `backend.profile`.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Defined in: [src/runtime/local-sandbox-client.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L43)

Resolves profile-declared MCP secret names at child-process spawn time.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Defined in: [src/runtime/local-sandbox-client.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L47)

Explicit trust decision for the exact `profile` bytes supplied here.
Omit to refuse local processes. A permissive policy never transfers to a
different per-create profile and provides no host isolation.

***

### LoopDispatchOptions

Defined in: [src/runtime/loop-dispatch.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L49)

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

> **sandboxClient**: [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/loop-dispatch.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L57)

Sandbox client used for every cell's `runLoop`. Supplied once.

##### toLoopOptions

> **toLoopOptions**: (`scenario`, `profile`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Defined in: [src/runtime/loop-dispatch.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L60)

Build the per-cell runLoop options from the scenario (+ profile, when
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

Defined in: [src/runtime/loop-dispatch.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L68)

Map the finished loop to the artifact the judges score. Default:
 `result.winner?.output`. A loop with no winner yields `undefined` (judges
 skip the cell) — but the loop's token usage is STILL reported, so the
 integrity guard sees real activity.

###### Parameters

###### result

[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`TArtifact`

##### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Defined in: [src/runtime/loop-dispatch.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L71)

Forward `loop.*` trace events into the campaign's scoped trace so loop
 spans correlate with the cell. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Defined in: [src/runtime/loop-dispatch.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L73)

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`, `profile`) => MaximumCharge \| undefined)

Defined in: [src/runtime/loop-dispatch.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L76)

Provider- or executor-enforced maximum for this whole cell dispatch.
Required by agent-eval before execution when the campaign is cost-capped.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`, `profile`) => `string` \| `undefined`

Defined in: [src/runtime/loop-dispatch.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L80)

Resolve the model actually served from the completed loop.

###### Parameters

###### result

[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>

###### scenario

`TScenario`

###### profile

`AgentProfile`

###### Returns

`string` \| `undefined`

***

### LoopCampaignDispatchOptions

Defined in: [src/runtime/loop-dispatch.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L186)

Options for adapting plain agent-eval campaign scenarios into runtime `runLoop` cells.

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

> **sandboxClient**: [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/loop-dispatch.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L194)

Sandbox client used for every campaign cell's `runLoop`.

##### toLoopOptions

> **toLoopOptions**: (`scenario`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Defined in: [src/runtime/loop-dispatch.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L196)

Build the per-cell runLoop options from the campaign scenario.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

##### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Defined in: [src/runtime/loop-dispatch.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L198)

Map the finished loop to the artifact the campaign judges score.

###### Parameters

###### result

[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`TArtifact`

##### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Defined in: [src/runtime/loop-dispatch.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L200)

Forward `loop.*` trace events into the campaign's scoped trace. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Defined in: [src/runtime/loop-dispatch.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L202)

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`) => MaximumCharge \| undefined)

Defined in: [src/runtime/loop-dispatch.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L204)

Provider- or executor-enforced maximum for this whole cell dispatch.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`) => `string` \| `undefined`

Defined in: [src/runtime/loop-dispatch.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L206)

Resolve the model actually served from the completed loop.

###### Parameters

###### result

[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>

###### scenario

`TScenario`

###### Returns

`string` \| `undefined`

***

### McpEndpoint

Defined in: [src/runtime/mcp-environment.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L25)

Where a handle's MCP server lives; headers carry per-artifact scoping.

#### Properties

##### url

> **url**: `string`

Defined in: [src/runtime/mcp-environment.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L26)

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/mcp-environment.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L27)

***

### McpEnvironmentOptions

Defined in: [src/runtime/mcp-environment.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L30)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/mcp-environment.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L31)

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: [src/runtime/mcp-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L41)

Cap on a tool result's text fed back to the worker. Default 1500 chars.

#### Methods

##### open()

> **open**(`task`): `Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

Defined in: [src/runtime/mcp-environment.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L33)

Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

##### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](#surfacescore)\>

Defined in: [src/runtime/mcp-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L35)

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

Defined in: [src/runtime/mcp-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L37)

Teardown (delete the seeded artifact). Optional — omit for stateless servers.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

##### selectTools()?

> `optional` **selectTools**(`task`, `all`): [`AgenticTool`](#agentictool)[]

Defined in: [src/runtime/mcp-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L39)

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

Defined in: [src/runtime/observe.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L23)

#### Properties

##### task

> **task**: `string`

Defined in: [src/runtime/observe.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L25)

What the worker was asked to do.

##### output

> **output**: `string`

Defined in: [src/runtime/observe.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L27)

What it produced (its final answer / artifact summary).

##### trace

> **trace**: readonly `unknown`[]

Defined in: [src/runtime/observe.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L29)

The worker's trace — any event array (sandbox events, tool-call records).

##### outcome?

> `optional` **outcome?**: `"failed"` \| `"unknown"` \| `"passed"`

Defined in: [src/runtime/observe.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L32)

Terminal status only (passed/failed/unknown) — NOT a judge score; the
 observer never reads the verdict, it reads behavior.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/runtime/observe.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L34)

Provenance back to the run.

***

### ObserveOptions

Defined in: [src/runtime/observe.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L37)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [src/runtime/observe.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L39)

The model-call seam (agent-eval `createChatClient`: router / cli-bridge / …).

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/observe.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L40)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [src/runtime/observe.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L42)

When set, learned facts are appended (idempotent) for the next run to read.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [src/runtime/observe.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L44)

Tags written onto learned facts + used by the next run's corpus query.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/observe.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L45)

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [src/runtime/observe.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L47)

Cap the trace lines fed to the observer (keeps the call cheap). Default 80.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [src/runtime/observe.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L53)

Override the analyst's system instruction — the prompt that turns a trace into
 findings + recommended_actions. The analyst IS the steerer, so this is the knob a
 prompt optimizer (GEPA) tunes. Omitted ⇒ the default observer instruction. The
 firewall (trace-only, never the verdict) is structural (input has no score), so a
 custom instruction cannot break it.

***

### Observation

Defined in: [src/runtime/observe.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L64)

#### Properties

##### findings

> **findings**: `AnalystFinding`[]

Defined in: [src/runtime/observe.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L65)

##### learned

> **learned**: [`CorpusRecord`](#corpusrecord)[]

Defined in: [src/runtime/observe.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L67)

Facts persisted to the corpus (empty when no corpus was supplied).

##### report

> **report**: `string`

Defined in: [src/runtime/observe.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L69)

Operator-facing markdown: what the observer noticed + what to change.

***

### CreateScopeAnalystOptions

Defined in: [src/runtime/personify/analyst.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L69)

The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
The combinator supplies the analyst's task projection (how to frame the drained settlements as
the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.

#### Type Parameters

##### D

`D`

#### Properties

##### analyst

> `readonly` **analyst**: [`Agent`](#agent-1)\<`unknown`, readonly `AnalystFinding`[]\>

Defined in: [src/runtime/personify/analyst.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L73)

The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
 (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
 the RAW findings; this module asserts the firewall on them before returning.

##### budget

> `readonly` **budget**: [`Budget`](#budget-12)

Defined in: [src/runtime/personify/analyst.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L79)

The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
 closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings.

##### label?

> `readonly` `optional` **label?**: `string`

Defined in: [src/runtime/personify/analyst.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L81)

Trace/journal label for the spawned analyst child. Default `'analyst'`.

#### Methods

##### buildTask()

> **buildTask**(`input`): `unknown`

Defined in: [src/runtime/personify/analyst.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L76)

Build the analyst agent's task from the analyze input (the root-task framing + the children
 drained so far). Pure projection — the analyst interprets it, this never reads it.

###### Parameters

###### input

[`ScopeAnalyzeInput`](#scopeanalyzeinput)\<`D`\>

###### Returns

`unknown`

***

### RegistryAnalyzeProjection

Defined in: [src/runtime/personify/analyst.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L184)

Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
`runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
settlements — so the CALLER owns the projection from the combinator's drained children to the
registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
bridge; it only runs the projected inputs and firewalls the merged findings.

#### Properties

##### runId

> `readonly` **runId**: `string`

Defined in: [src/runtime/personify/analyst.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L185)

##### inputs

> `readonly` **inputs**: `AnalystRunInputs`

Defined in: [src/runtime/personify/analyst.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L186)

##### opts?

> `readonly` `optional` **opts?**: `object`

Defined in: [src/runtime/personify/analyst.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L188)

Optional `run` opts (e.g. `priorFindings`) forwarded verbatim to the registry.

###### Index Signature

\[`k`: `string`\]: `unknown`

###### priorFindings?

> `optional` **priorFindings?**: readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

***

### Persona

Defined in: [src/runtime/personify/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L71)

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

Defined in: [src/runtime/personify/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L73)

Stable persona name — used as the trace/journal label root, never as content.

##### root

> `readonly` **root**: [`AgentSpec`](#agentspec)

Defined in: [src/runtime/personify/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L79)

The root agent's executor mapping (profile + harness + optional BYO executor). The
shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
are derived from / resolved against the same persona registry (see `ShapeContext`).

##### directive

> `readonly` **directive**: `string`

Defined in: [src/runtime/personify/types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L81)

The goal framing handed to the shape — the "what to achieve", not "how".

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

Defined in: [src/runtime/personify/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L84)

Who the loop is acting as — the opaque persona context blob the shape may inject into
 child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it.

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

Defined in: [src/runtime/personify/types.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L92)

The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
runtimes MUST supply a registry whose factories close over their seams (or BYO executors
on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/runtime/personify/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L97)

Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [src/runtime/personify/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L100)

Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
 the persona and the chosen shape must agree. Type-only — never present at runtime.

***

### PersonaContext

Defined in: [src/runtime/personify/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L105)

The persona context blob — who the loop is acting as. Open by intent: a persona names its
 own role/audience/constraints; the framework treats it as opaque content.

#### Indexable

> \[`key`: `string`\]: `unknown`

Open content bag — persona-specific fields a shape's child tasks may carry.

#### Properties

##### role

> `readonly` **role**: `string`

Defined in: [src/runtime/personify/types.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L107)

The role the loop embodies ("senior staff engineer", "equity research analyst", …).

##### notes?

> `readonly` `optional` **notes?**: `string`

Defined in: [src/runtime/personify/types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L109)

Optional freeform framing the persona's prompts/profiles consume.

***

### PersonaExecutors

Defined in: [src/runtime/personify/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L119)

How a persona supplies executor resolution. Either a pre-built registry (factories already
closed over their seams) OR the raw seam bag the engine uses to construct a registry +
thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.

#### Properties

##### registry?

> `readonly` `optional` **registry?**: [`ExecutorRegistry`](#executorregistry)

Defined in: [src/runtime/personify/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L121)

A registry whose factories already capture their seams. Highest precedence.

##### seams?

> `readonly` `optional` **seams?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/runtime/personify/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L123)

Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys).

***

### DefinePersonaInput

Defined in: [src/runtime/personify/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L130)

The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 the executors-supplied invariant check and freeze the record.

#### Type Parameters

##### D

`D` = `unknown`

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/runtime/personify/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L131)

##### root

> `readonly` **root**: [`AgentSpec`](#agentspec)

Defined in: [src/runtime/personify/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L132)

##### directive

> `readonly` **directive**: `string`

Defined in: [src/runtime/personify/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L133)

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

Defined in: [src/runtime/personify/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L134)

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

Defined in: [src/runtime/personify/types.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L135)

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/runtime/personify/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L136)

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [src/runtime/personify/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L139)

Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
 the caller's shape must agree with. Type-only — never supplied at a call site.

***

### ShapeBudget

Defined in: [src/runtime/personify/types.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L154)

Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
against them and fails closed, so an over-eager shape can never overspend.

#### Properties

##### perChild

> `readonly` **perChild**: [`Budget`](#budget-12)

Defined in: [src/runtime/personify/types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L156)

Per-child spawn budget the shape reserves for each leaf/sub-loop it opens.

##### fanout

> `readonly` **fanout**: `number`

Defined in: [src/runtime/personify/types.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L158)

Max children a fanout step may open in one round (the shape's structural width).

***

### ShapeContext

Defined in: [src/runtime/personify/types.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L168)

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

Defined in: [src/runtime/personify/types.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L169)

##### budget

> `readonly` **budget**: [`ShapeBudget`](#shapebudget)

Defined in: [src/runtime/personify/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L170)

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: [src/runtime/personify/types.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L183)

The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
 dormant default (empty findings → gates read deliverables/state only).

#### Methods

##### spawnChild()

> **spawnChild**(`name`, `spec`): [`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [src/runtime/personify/types.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L177)

Wrap an `AgentSpec` into a leaf `Agent` carrying it as `executorSpec`, so the shape can
`scope.spawn(spawnChild(spec), task, opts)`. `name` labels the child for traces. The
returned agent's `act` is never invoked by the keystone (it is spawned, not run) — the
spec drives the resolved `Executor`; `act` exists only to satisfy the `Agent` shape.

###### Parameters

###### name

`string`

###### spec

[`AgentSpec`](#agentspec)

###### Returns

[`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`D`\>\>

##### childSpec()

> **childSpec**(`profile`, `harness?`): [`AgentSpec`](#agentspec)

Defined in: [src/runtime/personify/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L180)

Derive a child `AgentSpec` from the persona's root spec with an overridden profile —
 the seam a shape uses to give a worker a narrower role/prompt than the root persona.

###### Parameters

###### profile

`AgentProfile`

###### harness?

`BackendType` \| `null`

###### Returns

[`AgentSpec`](#agentspec)

***

### ShapeRegistry

Defined in: [src/runtime/personify/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L202)

The open shape registry — the extension point that makes a new loop-shape ONE file + one
`registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
`succeeded` before `value`); `register` fails loud on a duplicate name.

#### Methods

##### register()

> **register**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [src/runtime/personify/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L203)

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

Defined in: [src/runtime/personify/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L204)

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

Defined in: [src/runtime/personify/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L208)

The registered shape names — for diagnostics + a fail-loud "unknown shape" message.

###### Returns

`string`[]

***

### RunPersonifiedOptions

Defined in: [src/runtime/personify/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L223)

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

Defined in: [src/runtime/personify/types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L224)

##### shape

> `readonly` **shape**: `string` \| [`LoopShape`](#loopshape)\<`Task`, `D`\>

Defined in: [src/runtime/personify/types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L226)

A resolved shape factory OR a registered shape name.

##### task

> `readonly` **task**: `Task`

Defined in: [src/runtime/personify/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L227)

##### budget

> `readonly` **budget**: [`Budget`](#budget-12)

Defined in: [src/runtime/personify/types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L228)

##### shapeBudget?

> `readonly` `optional` **shapeBudget?**: `Partial`\<[`ShapeBudget`](#shapebudget)\>

Defined in: [src/runtime/personify/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L230)

Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`.

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/runtime/personify/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L232)

Trace/journal root key. Defaults to the persona name + a run discriminator in the engine.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

Defined in: [src/runtime/personify/types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L233)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/personify/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L234)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [src/runtime/personify/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L236)

Runtime recursion-depth ceiling, paired with the conserved pool.

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [src/runtime/personify/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L238)

OTP intensity breaker bounds, forwarded to the supervisor verbatim.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [src/runtime/personify/types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L239)

##### handle?

> `readonly` `optional` **handle?**: `RootHandle`\<[`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [src/runtime/personify/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L241)

A live root handle to attach (view/signal/abort) before the run starts.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [src/runtime/personify/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L242)

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/personify/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L243)

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: [src/runtime/personify/types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L246)

Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
 on trace-derived findings instead of the dormant empty default.

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/personify/types.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L252)

Lifecycle stream sink, forwarded to `SupervisorOpts.hooks` so the root `Scope`'s
`agent.spawn`/`agent.child` events flow to an observer (e.g. the Intelligence SDK's
trace export). Absent ⇒ no stream (the run is silent, as today).

***

### PipelineStage

Defined in: [src/runtime/personify/wave-types.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L77)

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

Defined in: [src/runtime/personify/wave-types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L79)

Trace/journal label for this stage's spawned child.

#### Methods

##### feed()

> **feed**(`prior`, `ctx`, `rootTask`): `unknown`

Defined in: [src/runtime/personify/wave-types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L82)

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

> **collect**(`settled`): [`Outcome`](#outcome-1)\<`StepOut`\>

Defined in: [src/runtime/personify/wave-types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L85)

Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
 Fail loud (return a `blocked`) when the child produced nothing usable for the next stage.

###### Parameters

###### settled

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`StepOut`\>\>

###### Returns

[`Outcome`](#outcome-1)\<`StepOut`\>

***

### FanoutOptions

Defined in: [src/runtime/personify/wave-types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L106)

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

Defined in: [src/runtime/personify/wave-types.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L125)

Optional synthesis over the gathered child results: when present, the combinator spawns ONE
synthesis child whose task is built from the drained settlements, and its `done` output is
the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).

##### selectWinner?

> `optional` **selectWinner?**: [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L134)

Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
Receives the SAME `Iteration[]` the default selector reads (each child's output is its
`Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
…) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
synthesis child IS the selection); supplying both is a config error.

##### width?

> `optional` **width?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L145)

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

Defined in: [src/runtime/personify/wave-types.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L109)

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

Defined in: [src/runtime/personify/wave-types.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L111)

Per-item child label (defaults to `item:<index>` in the impl).

###### Parameters

###### item

`Item`

###### index

`number`

###### Returns

`string`

##### itemSpec()?

> `optional` **itemSpec**(`item`, `index`, `ctx`): [`AgentSpec`](#agentspec)

Defined in: [src/runtime/personify/wave-types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L118)

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

[`AgentSpec`](#agentspec)

***

### FanoutSynthesis

Defined in: [src/runtime/personify/wave-types.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L161)

How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 settlements into the synthesis child's task; `collect` reads its settled output into the
 deliverable `Outcome<D>`.

#### Type Parameters

##### D

`D`

#### Methods

##### synthesisTask()

> **synthesisTask**(`gathered`, `ctx`): `unknown`

Defined in: [src/runtime/personify/wave-types.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L162)

###### Parameters

###### gathered

readonly [`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`settled`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L163)

###### Parameters

###### settled

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### LoopUntilSpec

Defined in: [src/runtime/personify/wave-types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L182)

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

Defined in: [src/runtime/personify/wave-types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L184)

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

Defined in: [src/runtime/personify/wave-types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L186)

Fold one settled step into the accumulated state (the loop's running deliverable candidate).

###### Parameters

###### prior

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### settled

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### Returns

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

##### until()

> **until**(`state`, `findings`): [`Outcome`](#outcome-1)\<`D`\> \| `null`

Defined in: [src/runtime/personify/wave-types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L192)

The satisfiability gate: given the accumulated state + the round's trace findings, has the
goal been reached? Returns the terminal deliverable when satisfied, or `null` to keep going.
Reads `findings` (trace-derived), NOT a raw verdict score — the deployable-stop discipline.

###### Parameters

###### state

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### findings

readonly `AnalystFinding`[]

###### Returns

[`Outcome`](#outcome-1)\<`D`\> \| `null`

##### label()?

> `optional` **label**(`round`): `string`

Defined in: [src/runtime/personify/wave-types.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L194)

Per-round step label (defaults to `step:<round>` in the impl).

###### Parameters

###### round

`number`

###### Returns

`string`

***

### LoopUntilState

Defined in: [src/runtime/personify/wave-types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L199)

The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock).

#### Type Parameters

##### State

`State`

#### Properties

##### round

> `readonly` **round**: `number`

Defined in: [src/runtime/personify/wave-types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L200)

##### value

> `readonly` **value**: `State`

Defined in: [src/runtime/personify/wave-types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L201)

***

### PanelSpec

Defined in: [src/runtime/personify/wave-types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L220)

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

Defined in: [src/runtime/personify/wave-types.ts:224](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L224)

The M judge child specs: each is a persona-derived child (a narrower judge profile). The
 combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
 output reach another's task (write-only).

#### Methods

##### judgeTask()

> **judgeTask**(`artifact`, `judge`, `ctx`): `unknown`

Defined in: [src/runtime/personify/wave-types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L226)

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

> **merge**(`verdicts`, `artifact`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L232)

Write-only merge: fold the M settled judge verdicts into the panel's terminal `Outcome<D>`.
Pure over the drained settlements — it MUST NOT spawn, re-judge, or feed one verdict into
another. A panel that reached no quorum is a concrete blocker (fail loud, never a vacuous done).

###### Parameters

###### verdicts

readonly [`PanelVerdict`](#panelverdict)[]

###### artifact

`Artifact`

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### PanelJudge

Defined in: [src/runtime/personify/wave-types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L237)

One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 the judge's profile; this carries only the label + the optional weight the merge may read.

#### Properties

##### label

> `readonly` **label**: `string`

Defined in: [src/runtime/personify/wave-types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L238)

##### weight?

> `readonly` `optional` **weight?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L240)

Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl).

***

### PanelVerdict

Defined in: [src/runtime/personify/wave-types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L245)

One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 verdict (excluded from the merge `n`, like an infra-errored cell).

#### Properties

##### judge

> `readonly` **judge**: [`PanelJudge`](#paneljudge)

Defined in: [src/runtime/personify/wave-types.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L246)

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/personify/wave-types.ts:247](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L247)

##### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [src/runtime/personify/wave-types.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L249)

The judge child's raw output — what it was asked to assess, for a merge that quotes it.

##### down

> `readonly` **down**: `boolean`

Defined in: [src/runtime/personify/wave-types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L251)

True when the judge child went `down` (no usable verdict — kept out of the merge denominator).

***

### VerifySpec

Defined in: [src/runtime/personify/wave-types.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L268)

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

Defined in: [src/runtime/personify/wave-types.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L276)

Implement / verifier child labels (default `implement` / `verify` in the impl).

##### verifierLabel?

> `readonly` `optional` **verifierLabel?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L277)

#### Methods

##### implement()

> **implement**(`rootTask`, `ctx`): `unknown`

Defined in: [src/runtime/personify/wave-types.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L270)

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

Defined in: [src/runtime/personify/wave-types.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L272)

Build the verifier child's task from the implement child's settled candidate.

###### Parameters

###### candidate

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`Candidate`\>\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`candidate`, `verdict`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:274](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L274)

Project the gated (verifier-`valid`) candidate into the terminal deliverable.

###### Parameters

###### candidate

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`Candidate`\>\>

###### verdict

`DefaultVerdict`

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### WidenSpec

Defined in: [src/runtime/personify/wave-types.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L298)

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

Defined in: [src/runtime/personify/wave-types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L301)

The initial children to spawn before any widening — the seed lineages the gate widens from.
 One child task per seed; bounded by the conserved pool's fail-closed admission.

##### gate

> `readonly` **gate**: [`ScopeWidenGate`](#scopewidengate)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L308)

The progressive-widening gate. Consulted on EVERY settled child with the round's
trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.

#### Methods

##### seedTask()

> **seedTask**(`seed`, `index`, `ctx`): `unknown`

Defined in: [src/runtime/personify/wave-types.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L302)

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

Defined in: [src/runtime/personify/wave-types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L310)

Build the widened child's task from the lineage the gate chose to extend.

###### Parameters

###### toward

[`WidenLineage`](#widenlineage)\<`D`\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### synthesize()

> **synthesize**(`gathered`, `ctx`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L313)

Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
 single-sourced selector over the gathered children, never a re-judge).

###### Parameters

###### gathered

readonly [`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### ScopeWidenGate

Defined in: [src/runtime/personify/wave-types.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L322)

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

Defined in: [src/runtime/personify/wave-types.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L330)

When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
 so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`).

#### Methods

##### decide()

> **decide**(`settled`, `findings`, `budget`): [`WidenDecision`](#widendecision)\<`D`\>

Defined in: [src/runtime/personify/wave-types.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L323)

###### Parameters

###### settled

[`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### findings

readonly `AnalystFinding`[]

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

[`WidenDecision`](#widendecision)\<`D`\>

***

### WidenLineage

Defined in: [src/runtime/personify/wave-types.ts:341](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L341)

A lineage the gate may widen toward — the settled child that looked promising + the findings
 that justified it (the trace-derived provenance the firewall requires).

#### Type Parameters

##### D

`D`

#### Properties

##### settled

> `readonly` **settled**: `object`

Defined in: [src/runtime/personify/wave-types.ts:342](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L342)

###### kind

> **kind**: `"done"`

###### handle

> **handle**: `Handle`\<[`Outcome`](#outcome-1)\<`D`\>\>

###### out

> **out**: [`Outcome`](#outcome-1)

###### outRef

> **outRef**: `string`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](#spend)

###### seq

> **seq**: `number`

##### findings

> `readonly` **findings**: readonly `AnalystFinding`[]

Defined in: [src/runtime/personify/wave-types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L343)

***

### ScopeAnalyst

Defined in: [src/runtime/personify/wave-types.ts:370](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L370)

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

Defined in: [src/runtime/personify/wave-types.ts:377](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L377)

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

Defined in: [src/runtime/personify/wave-types.ts:381](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L381)

Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far.

#### Type Parameters

##### D

`D`

#### Properties

##### task

> `readonly` **task**: `unknown`

Defined in: [src/runtime/personify/wave-types.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L383)

Opaque root-task framing (whatever the combinator was invoked with).

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

Defined in: [src/runtime/personify/wave-types.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L385)

The children this combinator has drained off `scope.next()`, in cursor order.

##### nodeId

> `readonly` **nodeId**: `string`

Defined in: [src/runtime/personify/wave-types.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L387)

This combinator's scope id (the trace-correlation root for the analyst).

***

### SteerContext

Defined in: [src/runtime/personify/wave-types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L398)

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

Defined in: [src/runtime/personify/wave-types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L399)

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

Defined in: [src/runtime/personify/wave-types.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L400)

##### lastValidScore?

> `readonly` `optional` **lastValidScore?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:403](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L403)

Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
 off this re-introduces selector=judge. Marked so a reviewer catches a misuse.

***

### CorpusRecord

Defined in: [src/runtime/personify/wave-types.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L426)

One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
relevant, high-confidence subset.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

Defined in: [src/runtime/personify/wave-types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L427)

##### id

> `readonly` **id**: `string`

Defined in: [src/runtime/personify/wave-types.ts:429](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L429)

Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups.

##### runId

> `readonly` **runId**: `string`

Defined in: [src/runtime/personify/wave-types.ts:431](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L431)

The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace.

##### producedAt

> `readonly` **producedAt**: `string`

Defined in: [src/runtime/personify/wave-types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L432)

##### area

> `readonly` **area**: `string`

Defined in: [src/runtime/personify/wave-types.ts:434](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L434)

Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`).

##### claim

> `readonly` **claim**: `string`

Defined in: [src/runtime/personify/wave-types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L436)

The accreted fact — the instruction-shaped statement the next run reads back.

##### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L438)

Optional supporting detail the renderer may include under the claim.

##### tags

> `readonly` **tags**: readonly `string`[]

Defined in: [src/runtime/personify/wave-types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L440)

Free-form tags for `query` filtering (domain, persona, surface).

##### confidence

> `readonly` **confidence**: `number`

Defined in: [src/runtime/personify/wave-types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L442)

0..1 — the producing run's confidence in this fact (the render threshold reads it).

##### evidence?

> `readonly` `optional` **evidence?**: readonly `object`[]

Defined in: [src/runtime/personify/wave-types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L444)

Optional provenance back into the run that learned it (a finding id / outRef / span).

***

### CorpusFilter

Defined in: [src/runtime/personify/wave-types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L448)

A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain.

#### Properties

##### area?

> `readonly` `optional` **area?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L449)

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Defined in: [src/runtime/personify/wave-types.ts:451](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L451)

Match records carrying ALL of these tags.

##### minConfidence?

> `readonly` `optional` **minConfidence?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:453](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L453)

Minimum confidence a record must clear to be returned (the render gate).

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L455)

Only records from this run (rare — usually a cross-run read).

##### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L457)

Cap the result count (most-confident first in the impl).

***

### Corpus

Defined in: [src/runtime/personify/wave-types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L470)

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

Defined in: [src/runtime/personify/wave-types.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L473)

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Defined in: [src/runtime/personify/wave-types.ts:476](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L476)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

***

### RenderCorpusToInstructionsOptions

Defined in: [src/runtime/personify/wave-types.ts:490](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L490)

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

Defined in: [src/runtime/personify/wave-types.ts:491](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L491)

##### filter

> `readonly` **filter**: [`CorpusFilter`](#corpusfilter)

Defined in: [src/runtime/personify/wave-types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L492)

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: [src/runtime/personify/wave-types.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L494)

The profile to project the facts into. The result is a fresh profile — the input is unchanged.

##### target?

> `readonly` `optional` **target?**: `"resources"` \| `"prompt"`

Defined in: [src/runtime/personify/wave-types.ts:497](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L497)

Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
 the single-blob `resources.instructions` string.

##### maxLines?

> `readonly` `optional` **maxLines?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:499](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L499)

Optional cap on rendered lines (most-confident first), independent of the query `limit`.

***

### TrajectoryNode

Defined in: [src/runtime/personify/wave-types.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L518)

One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
`Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [src/runtime/personify/wave-types.ts:519](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L519)

##### parent?

> `readonly` `optional` **parent?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L520)

##### children

> `readonly` **children**: readonly `string`[]

Defined in: [src/runtime/personify/wave-types.ts:521](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L521)

##### label

> `readonly` **label**: `string`

Defined in: [src/runtime/personify/wave-types.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L522)

##### runtime

> `readonly` **runtime**: `string`

Defined in: [src/runtime/personify/wave-types.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L523)

##### status

> `readonly` **status**: `"failed"` \| `"cancelled"` \| `"pending"` \| `"done"`

Defined in: [src/runtime/personify/wave-types.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L525)

Terminal status the journal recorded for this node.

##### ownSpend

> `readonly` **ownSpend**: [`Spend`](#spend)

Defined in: [src/runtime/personify/wave-types.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L527)

This node's OWN conserved spend (from its `settled` event).

##### rolledUpSpend

> `readonly` **rolledUpSpend**: [`Spend`](#spend)

Defined in: [src/runtime/personify/wave-types.ts:530](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L530)

This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
 "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis).

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/personify/wave-types.ts:532](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L532)

The node's verdict, when its settlement carried one (observability — NOT a steer input).

##### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [src/runtime/personify/wave-types.ts:534](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L534)

The rehydrated output artifact, when `withOutputs` was requested + the blob resolved.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [src/runtime/personify/wave-types.ts:535](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L535)

***

### TrajectoryReport

Defined in: [src/runtime/personify/wave-types.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L540)

The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: [src/runtime/personify/wave-types.ts:541](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L541)

##### nodes

> `readonly` **nodes**: readonly [`TrajectoryNode`](#trajectorynode)[]

Defined in: [src/runtime/personify/wave-types.ts:543](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L543)

Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges).

##### total

> `readonly` **total**: [`Spend`](#spend)

Defined in: [src/runtime/personify/wave-types.ts:545](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L545)

The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms).

##### statusCounts

> `readonly` **statusCounts**: `Readonly`\<`Record`\<[`TrajectoryNode`](#trajectorynode)\[`"status"`\], `number`\>\>

Defined in: [src/runtime/personify/wave-types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L547)

Count of nodes by terminal status — a quick "how did the tree end" readout.

***

### TrajectoryReportOptions

Defined in: [src/runtime/personify/wave-types.ts:557](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L557)

`trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
impl lives in `trajectory.ts`.

#### Properties

##### withOutputs?

> `readonly` `optional` **withOutputs?**: `boolean`

Defined in: [src/runtime/personify/wave-types.ts:559](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L559)

Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report).

***

### EqualKArm

Defined in: [src/runtime/personify/wave-types.ts:578](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L578)

One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
(not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
iteration count.

#### Properties

##### label

> `readonly` **label**: `string`

Defined in: [src/runtime/personify/wave-types.ts:579](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L579)

##### report

> `readonly` **report**: [`TrajectoryReport`](#trajectoryreport-3)

Defined in: [src/runtime/personify/wave-types.ts:580](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L580)

***

### EqualKVerdict

Defined in: [src/runtime/personify/wave-types.ts:589](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L589)

The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
NOT comparable at equal compute — a confound to report, not a result to publish.

#### Properties

##### withinTolerance

> `readonly` **withinTolerance**: `boolean`

Defined in: [src/runtime/personify/wave-types.ts:590](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L590)

##### arms

> `readonly` **arms**: readonly `object`[]

Defined in: [src/runtime/personify/wave-types.ts:592](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L592)

Per-arm conserved cost (the basis: tokens total + usd).

##### spread

> `readonly` **spread**: `object`

Defined in: [src/runtime/personify/wave-types.ts:599](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L599)

The realized spread on each channel (max − min across arms), for the report.

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

##### tolerance

> `readonly` **tolerance**: `number`

Defined in: [src/runtime/personify/wave-types.ts:601](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L601)

The fractional tolerance the check used (spread / median ≤ tolerance per channel).

***

### EqualKOnCostOptions

Defined in: [src/runtime/personify/wave-types.ts:611](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L611)

`equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
(tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
impl lives in `trajectory.ts`. Pure over the reports — no I/O.

#### Properties

##### tolerance?

> `readonly` `optional` **tolerance?**: `number`

Defined in: [src/runtime/personify/wave-types.ts:614](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L614)

Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
 the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim.

***

### PromotionGateOptions

Defined in: [src/runtime/promotion-gate.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L13)

#### Properties

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [src/runtime/promotion-gate.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L15)

The HOLDOUT report — must carry per-task cells for both strategy names.

##### incumbent

> **incumbent**: `string`

Defined in: [src/runtime/promotion-gate.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L17)

The incumbent champion's strategy name.

##### candidate

> **candidate**: `string`

Defined in: [src/runtime/promotion-gate.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L19)

The challenger's strategy name.

##### mode?

> `optional` **mode?**: `"superiority"` \| `"non-inferiority"`

Defined in: [src/runtime/promotion-gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L24)

'superiority' (default): the candidate must score significantly BETTER.
 'non-inferiority': the candidate must prove its score is not worse than the
 incumbent by more than `scoreTolerance` AND its cost savings are significant —
 the gate for "same quality, cheaper" claims.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [src/runtime/promotion-gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L26)

non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### deltaThreshold?

> `optional` **deltaThreshold?**: `number`

Defined in: [src/runtime/promotion-gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L28)

The CI lower bound on the paired lift must EXCEED this (score scale). Default 0.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [src/runtime/promotion-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L31)

Minimum paired tasks before significance can be claimed. Default 6 — below that
 the bootstrap CI is too wide to separate a real lift from the per-task noise.

##### statistic?

> `optional` **statistic?**: `"mean"` \| `"median"`

Defined in: [src/runtime/promotion-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L33)

Bootstrap statistic over the paired deltas. Default 'mean'.

##### seed?

> `optional` **seed?**: `number`

Defined in: [src/runtime/promotion-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L35)

Fixed by the substrate by default — the same report always yields the same verdict.

##### resamples?

> `optional` **resamples?**: `number`

Defined in: [src/runtime/promotion-gate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L36)

***

### PromotionVerdict

Defined in: [src/runtime/promotion-gate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L39)

#### Properties

##### promoted

> **promoted**: `boolean`

Defined in: [src/runtime/promotion-gate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L40)

##### reason

> **reason**: `"identical-champion"` \| `"few-tasks"` \| `"no-margin"` \| `"significant"` \| `"non-inferior-and-cheaper"` \| `"non-inferiority-unproven"` \| `"not-cheaper"`

Defined in: [src/runtime/promotion-gate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L41)

##### mode

> **mode**: `"superiority"` \| `"non-inferiority"`

Defined in: [src/runtime/promotion-gate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L49)

##### n

> **n**: `number`

Defined in: [src/runtime/promotion-gate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L51)

Paired tasks that carried both strategies' cells.

##### lift

> **lift**: `object`

Defined in: [src/runtime/promotion-gate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L53)

Paired (candidate − incumbent) lift across the holdout tasks.

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

Defined in: [src/runtime/promotion-gate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L56)

non-inferiority mode: paired (incumbent − candidate) cost SAVINGS per task (usd) —
 positive means the candidate is cheaper; significant iff the CI low clears zero.

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

Defined in: [src/runtime/promotion-gate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L60)

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

### UsageSink

Defined in: [src/runtime/report-usage.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L24)

The slice of an agent-eval campaign `DispatchContext.cost` this needs.

#### Methods

##### observe()

> **observe**(`amountUsd`, `source`): `void`

Defined in: [src/runtime/report-usage.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L25)

###### Parameters

###### amountUsd

`number`

###### source

`string`

###### Returns

`void`

##### observeTokens()

> **observeTokens**(`usage`): `void`

Defined in: [src/runtime/report-usage.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L26)

###### Parameters

###### usage

[`LoopTokenUsage`](#looptokenusage)

###### Returns

`void`

***

### ResolveSandboxClientOptions

Defined in: [src/runtime/resolve-sandbox-client.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L31)

#### Properties

##### backend

> **backend**: `"router"` \| `"sandbox"` \| `"bridge"` \| `"local"`

Defined in: [src/runtime/resolve-sandbox-client.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L33)

The execution transport for the driven loop.

##### sandboxClient?

> `optional` **sandboxClient?**: [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/resolve-sandbox-client.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L35)

`sandbox` backend: the caller's real Sandbox-backed client. Required for that backend.

##### bridge?

> `optional` **bridge?**: `object`

Defined in: [src/runtime/resolve-sandbox-client.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L37)

`bridge` backend: local cli-bridge transport. `bearer` + `model` required.

###### url?

> `optional` **url?**: `string`

cli-bridge base URL. Defaults to `http://127.0.0.1:3355`.

###### bearer

> **bearer**: `string`

###### model

> **model**: `string`

Bridge model id, doubling as the harness selector (e.g. `claude-code/sonnet`).

###### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-turn deadline (ms).

##### router?

> `optional` **router?**: `object`

Defined in: [src/runtime/resolve-sandbox-client.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L47)

`router` backend: router chat-completion transport. All three fields required.

###### baseUrl

> **baseUrl**: `string`

###### key

> **key**: `string`

###### model

> **model**: `string`

##### local?

> `optional` **local?**: [`LocalSandboxClientOptions`](#localsandboxclientoptions)

Defined in: [src/runtime/resolve-sandbox-client.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L54)

`local` backend: same-host pseudo-box — the router brain drives a tool loop
 with the profile's stdio MCP servers spawned as local children.

***

### RouterConfig

Defined in: [src/runtime/router-client.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L16)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [src/runtime/router-client.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L17)

##### routerKey

> **routerKey**: `string`

Defined in: [src/runtime/router-client.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L18)

##### model

> **model**: `string`

Defined in: [src/runtime/router-client.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L19)

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: [src/runtime/router-client.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L27)

Optional completion transport. When set, `routerChatWithUsage` / `routerChatWithTools` call it
with the OpenAI-shape request body and use the parsed `/chat/completions` JSON it returns,
INSTEAD of `fetch(routerBaseUrl + '/chat/completions')`. When absent the fetch path runs
unchanged — the live router stays the default. The injection seam an offline benchmark uses to
drive the worker with no network: a deterministic in-process responder satisfies it, no server.

###### Parameters

###### body

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`unknown`\>

***

### RouterChatResult

Defined in: [src/runtime/router-client.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L30)

#### Properties

##### content

> **content**: `string`

Defined in: [src/runtime/router-client.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L32)

The final answer, with any inline `<think>...</think>` block stripped into `reasoning`.

##### reasoning?

> `optional` **reasoning?**: `string`

Defined in: [src/runtime/router-client.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L41)

Thinking-model reasoning, when the provider surfaced it — either as a separate
`reasoning`/`reasoning_content` message field (OpenRouter style) or inlined into
`content` as a `<think>` block (Groq style). Undefined for non-thinking models.
Downstream parsers that match single-token answers must read `content`, which is
clean either way; before this split, Groq-style inlining made the same model look
broken on one provider and fine on another.

##### usage?

> `optional` **usage?**: `object`

Defined in: [src/runtime/router-client.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L43)

REAL usage, or undefined when the provider reported none.

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [src/runtime/router-client.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L45)

Derived from usage via `estimateCost` when the model is priced; else undefined.

***

### RouterToolCall

Defined in: [src/runtime/router-client.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L167)

A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest).

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime/router-client.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L168)

##### name

> **name**: `string`

Defined in: [src/runtime/router-client.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L169)

##### arguments

> **arguments**: `string`

Defined in: [src/runtime/router-client.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L171)

Raw JSON arguments string as emitted by the model.

***

### RouterChatToolsResult

Defined in: [src/runtime/router-client.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L174)

#### Properties

##### content

> **content**: `string` \| `null`

Defined in: [src/runtime/router-client.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L175)

##### toolCalls

> **toolCalls**: [`RouterToolCall`](#routertoolcall)[]

Defined in: [src/runtime/router-client.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L176)

##### usage?

> `optional` **usage?**: `object`

Defined in: [src/runtime/router-client.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L177)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [src/runtime/router-client.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L178)

***

### ToolSpec

Defined in: [src/runtime/router-client.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L254)

#### Properties

##### type

> **type**: `"function"`

Defined in: [src/runtime/router-client.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L255)

##### function

> **function**: `object`

Defined in: [src/runtime/router-client.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L256)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `unknown`

***

### RouterToolLoopResult

Defined in: [src/runtime/router-client.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L259)

#### Properties

##### final

> **final**: `string`

Defined in: [src/runtime/router-client.ts:261](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L261)

The model's final assistant text (the turn where it stopped calling tools, or the budget turn).

##### turns

> **turns**: `number`

Defined in: [src/runtime/router-client.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L263)

Inference turns spent (≤ maxTurns) — the equal-budget unit vs random@k.

##### toolCalls

> **toolCalls**: `number`

Defined in: [src/runtime/router-client.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L264)

##### toolTrace

> **toolTrace**: `object`[]

Defined in: [src/runtime/router-client.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L267)

The behavior trace: each tool call + its result, in order. What a trace-analyst
 steerer reads (behavior, never the verdict) to diagnose + redirect the next shot.

###### name

> **name**: `string`

###### args

> **args**: `string`

###### result

> **result**: `string`

##### usage

> **usage**: `object`

Defined in: [src/runtime/router-client.ts:268](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L268)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### messages

> **messages**: `Record`\<`string`, `unknown`\>[]

Defined in: [src/runtime/router-client.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L271)

The full conversation after the loop (seed + every assistant/tool turn). Lets a caller
 CARRY the messages into the next shot (depth continuation) and read the trajectory.

***

### BenchmarkConfig

Defined in: [src/runtime/run-benchmark.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L32)

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/run-benchmark.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L34)

The task domain (5 hooks).

##### tasks

> **tasks**: [`AgenticTask`](#agentictask)[]

Defined in: [src/runtime/run-benchmark.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L36)

The tasks to score across.

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

Defined in: [src/runtime/run-benchmark.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L38)

The worker: model + router + (optional) the critic's instruction (the steerer knob).

##### strategies?

> `optional` **strategies?**: [`Strategy`](#strategy-3)[]

Defined in: [src/runtime/run-benchmark.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L41)

Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
 Default: [sample, refine].

##### budget?

> `optional` **budget?**: `number`

Defined in: [src/runtime/run-benchmark.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L43)

Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [src/runtime/run-benchmark.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L45)

Tasks scored in parallel. Default 3.

##### onTask?

> `optional` **onTask?**: (`row`, `done`, `total`) => `void`

Defined in: [src/runtime/run-benchmark.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L48)

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

Defined in: [src/runtime/run-benchmark.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L51)

Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
 here live (the watchdog/route-auditor seam, passed through to `runAgentic`).

***

### BenchmarkLift

Defined in: [src/runtime/run-benchmark.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L54)

#### Properties

##### mean

> **mean**: `number`

Defined in: [src/runtime/run-benchmark.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L56)

Mean of paired deltas (refine − sample).

##### low

> **low**: `number`

Defined in: [src/runtime/run-benchmark.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L57)

##### high

> **high**: `number`

Defined in: [src/runtime/run-benchmark.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L58)

##### n

> **n**: `number`

Defined in: [src/runtime/run-benchmark.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L59)

***

### BenchmarkCell

Defined in: [src/runtime/run-benchmark.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L63)

One strategy's outcome on one task — the per-task cell an optimizer consumes.

#### Properties

##### score

> **score**: `number`

Defined in: [src/runtime/run-benchmark.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L64)

##### resolved

> **resolved**: `boolean`

Defined in: [src/runtime/run-benchmark.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L65)

##### progression

> **progression**: `number`[]

Defined in: [src/runtime/run-benchmark.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L67)

The progress curve (refine: score per shot; sample: best-so-far per rollout).

##### usd

> **usd**: `number`

Defined in: [src/runtime/run-benchmark.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L68)

##### ms

> **ms**: `number`

Defined in: [src/runtime/run-benchmark.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L69)

##### tokens

> **tokens**: `object`

Defined in: [src/runtime/run-benchmark.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L70)

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### BenchmarkTaskRow

Defined in: [src/runtime/run-benchmark.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L73)

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [src/runtime/run-benchmark.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L74)

##### cells?

> `optional` **cells?**: `Record`\<`string`, [`BenchmarkCell`](#benchmarkcell)\>

Defined in: [src/runtime/run-benchmark.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L76)

Per-strategy cells; absent when the task errored before completing all strategies.

##### errors?

> `optional` **errors?**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/run-benchmark.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L80)

Per-strategy failures on this task: the strategy competed, threw, and scored an
 honest zero — it loses, it does not poison the row. The message is kept so a later
 generation's author can see WHY a candidate died.

##### error?

> `optional` **error?**: `string`

Defined in: [src/runtime/run-benchmark.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L82)

Why the task was excluded (infra/setup failure) — never silently dropped.

***

### BenchmarkStrategySummary

Defined in: [src/runtime/run-benchmark.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L85)

#### Properties

##### score

> **score**: `number`

Defined in: [src/runtime/run-benchmark.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L87)

Mean verifier score (0..1).

##### resolved

> **resolved**: `number`

Defined in: [src/runtime/run-benchmark.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L89)

Fraction of tasks fully resolved.

##### usd

> **usd**: `number`

Defined in: [src/runtime/run-benchmark.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L91)

Mean cost vector per task.

##### ms

> **ms**: `number`

Defined in: [src/runtime/run-benchmark.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L92)

***

### BenchmarkReport

Defined in: [src/runtime/run-benchmark.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L96)

Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines.

#### Properties

##### n

> **n**: `number`

Defined in: [src/runtime/run-benchmark.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L97)

##### excluded

> **excluded**: `number`

Defined in: [src/runtime/run-benchmark.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L98)

##### perStrategy

> **perStrategy**: `Record`\<`string`, [`BenchmarkStrategySummary`](#benchmarkstrategysummary)\>

Defined in: [src/runtime/run-benchmark.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L100)

Per-strategy means (keyed by strategy.name).

##### perTask

> **perTask**: [`BenchmarkTaskRow`](#benchmarktaskrow)[]

Defined in: [src/runtime/run-benchmark.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L103)

The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
 strategy-author, an operator) consumes. Includes errored tasks with the reason.

##### pareto

> **pareto**: `string`[]

Defined in: [src/runtime/run-benchmark.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L106)

The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
 a strategy that ties on score at half the cost WINS and a scalar would hide it.

##### refineVsSample?

> `optional` **refineVsSample?**: [`BenchmarkLift`](#benchmarklift)

Defined in: [src/runtime/run-benchmark.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L108)

The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample.

***

### SandboxCapabilities

Defined in: [src/runtime/sandbox-capabilities.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L27)

**`Experimental`**

What the loop kernel is allowed to know about a sandbox backend: a single
capability bit, never the backend's identity. `canFork` gates the
checkpoint+fork fanout path; everything else (session continuation) is a
universal SDK feature that needs no probe.

#### Properties

##### canFork

> **canFork**: `boolean`

Defined in: [src/runtime/sandbox-capabilities.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L33)

**`Experimental`**

True only when `client.criuStatus()` returned `{ available: true }`. When
false, a fork-enabled fanout degrades to independent fresh boxes — same
result, no shared context prefix.

***

### CriuCapableClient

Defined in: [src/runtime/sandbox-capabilities.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L74)

**`Experimental`**

Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
does not require `criuStatus`; this widens it optionally so the probe can be
read without importing sandbox-backend specifics.

#### Properties

##### criuStatus?

> `optional` **criuStatus?**: () => `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [src/runtime/sandbox-capabilities.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L75)

**`Experimental`**

###### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

***

### SandboxToolPartState

Defined in: [src/runtime/sandbox-events.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L147)

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

Defined in: [src/runtime/sandbox-events.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L150)

**`Experimental`**

Last seen status per tool call id. A terminal status is sticky — later
 frames on a settled call project to nothing.

##### seq

> **seq**: `number`

Defined in: [src/runtime/sandbox-events.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L152)

**`Experimental`**

Sequence for synthesized call ids when an event carries none.

***

### SandboxLineageHandle

Defined in: [src/runtime/sandbox-lineage.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L125)

**`Experimental`**

A live box plus the session that threads its iterations together. Handed back
by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).

#### Properties

##### box

> **box**: `SandboxInstance`

Defined in: [src/runtime/sandbox-lineage.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L127)

**`Experimental`**

The owned, running sandbox this handle drives.

##### sessionId

> **sessionId**: `string`

Defined in: [src/runtime/sandbox-lineage.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L134)

**`Experimental`**

Stable session id threaded through this box's `streamPrompt` calls. Minted
by the lineage on `start`; reused on `continue` so the server continues the
same conversation. A forked handle starts a fresh session on its new box —
the shared context comes from the checkpoint, not a shared session id.

***

### SandboxLineage

Defined in: [src/runtime/sandbox-lineage.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L143)

**`Experimental`**

Owns box + session handles for one loop run and offers the three
capability-gated lifecycle moves. Construct via `createSandboxLineage`.

#### Methods

##### start()

> **start**(`spec`, `prompt`, `signal`, `promptOptions?`): `Promise`\<\{ `handle`: [`SandboxLineageHandle`](#sandboxlineagehandle); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

Defined in: [src/runtime/sandbox-lineage.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L148)

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

Defined in: [src/runtime/sandbox-lineage.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L161)

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

Defined in: [src/runtime/sandbox-lineage.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L178)

**`Experimental`**

Branch `count` children from `parent`. When the platform can fork, each
child inherits `parent`'s checkpoint — and therefore the parent's IMAGE and
PROFILE: under a real fork `specs[i]` does NOT re-select a per-branch
profile (the SDK forks the running box, it can't swap the image). `specs[i]`
picks the per-branch profile ONLY on the degraded fresh-box path (no CRIU).
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

Defined in: [src/runtime/sandbox-lineage.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L191)

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

Defined in: [src/runtime/sandbox-lineage.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L193)

**`Experimental`**

Destroy every box this lineage owns. Best-effort, bounded, parallel.

###### Returns

`Promise`\<`void`\>

***

### CheckpointCapableBox

Defined in: [src/runtime/sandbox-lineage.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L397)

**`Experimental`**

Loop-side widening of the box's optional checkpoint method. The
`SandboxClient`/`SandboxInstance` surface the kernel relies on does not
require checkpointing; this reads it optionally so the lineage can probe-gate
without importing sandbox-backend specifics.

#### Properties

##### checkpoint?

> `optional` **checkpoint?**: (`options?`) => `Promise`\<\{ `checkpointId`: `string`; \}\>

Defined in: [src/runtime/sandbox-lineage.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L398)

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

### ForkCapableBox

Defined in: [src/runtime/sandbox-lineage.ts:404](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L404)

**`Experimental`**

Loop-side widening of the box's optional fork method.

#### Properties

##### fork?

> `optional` **fork?**: (`checkpointId`, `options?`) => `Promise`\<`SandboxInstance`\>

Defined in: [src/runtime/sandbox-lineage.ts:405](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L405)

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

Defined in: [src/runtime/sandbox-lineage.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L415)

**`Experimental`**

Loop-side widening of the box's optional session accessor. The real
`SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
so `continue` can assert session liveness without requiring it of the test
fakes. `status()` resolves `null` when the id is unknown to the sandbox.

#### Properties

##### session?

> `optional` **session?**: (`id`) => `object`

Defined in: [src/runtime/sandbox-lineage.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L416)

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

Defined in: [src/runtime/sandbox-run.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L62)

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

Defined in: [src/runtime/sandbox-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L63)

**`Experimental`**

##### events

> **events**: `SandboxEvent`[]

Defined in: [src/runtime/sandbox-run.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L64)

**`Experimental`**

##### readError?

> `optional` **readError?**: `string`

Defined in: [src/runtime/sandbox-run.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L65)

**`Experimental`**

***

### SandboxRun

Defined in: [src/runtime/sandbox-run.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L94)

**`Experimental`**

A live run over ONE persistent artifact (box + session). Close it
 when done — `close()` tears the box down.

#### Type Parameters

##### Out

`Out`

#### Properties

##### box

> `readonly` **box**: `SandboxInstance`

Defined in: [src/runtime/sandbox-run.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L95)

**`Experimental`**

##### sessionId

> `readonly` **sessionId**: `string`

Defined in: [src/runtime/sandbox-run.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L96)

**`Experimental`**

#### Methods

##### start()

> **start**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

Defined in: [src/runtime/sandbox-run.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L98)

**`Experimental`**

First turn over the fresh box (mints the session). Throws if already started.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### resume()

> **resume**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

Defined in: [src/runtime/sandbox-run.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L100)

**`Experimental`**

Continue THE SAME session over THE SAME artifact — a resumed turn/rollout.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/runtime/sandbox-run.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L101)

**`Experimental`**

###### Returns

`Promise`\<`void`\>

***

### OpenSandboxRunBeforeStartContext

Defined in: [src/runtime/sandbox-run.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L116)

Context available after the box/session exists and before the first prompt is
drained. Intended for benchmark-owned workspace setup such as cloning a repo
into a fixed path.

#### Properties

##### box

> `readonly` **box**: `SandboxInstance`

Defined in: [src/runtime/sandbox-run.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L117)

##### sessionId

> `readonly` **sessionId**: `string`

Defined in: [src/runtime/sandbox-run.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L118)

##### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/runtime/sandbox-run.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L119)

***

### OpenSandboxRunOptions

Defined in: [src/runtime/sandbox-run.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L123)

**`Experimental`**

#### Properties

##### agentRun

> **agentRun**: [`AgentRunSpec`](#agentrunspec)\<`string`\>

Defined in: [src/runtime/sandbox-run.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L125)

**`Experimental`**

Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness.

##### signal

> **signal**: `AbortSignal`

Defined in: [src/runtime/sandbox-run.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L126)

**`Experimental`**

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/sandbox-run.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L128)

**`Experimental`**

Optional execution-scoped observers. Hook failures never fail the run.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/runtime/sandbox-run.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L130)

**`Experimental`**

Stable run id for trace joins. Defaults to a short runtime-minted id.

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [src/runtime/sandbox-run.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L132)

**`Experimental`**

Optional benchmark/scenario id carried into emitted hook events.

##### promptOptions?

> `optional` **promptOptions?**: [`OpenSandboxRunPromptOptions`](#opensandboxrunpromptoptions)

Defined in: [src/runtime/sandbox-run.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L135)

**`Experimental`**

Per-prompt sandbox SDK options forwarded to both `start()` and `resume()`.
 The runtime still owns the session id and abort signal for each turn.

##### beforeStart?

> `optional` **beforeStart?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/sandbox-run.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L139)

**`Experimental`**

Optional pre-start workspace setup. Runs after `lineage.start()` creates the
box/session and before the first prompt stream is consumed. A thrown error
fails the turn before the agent spends tokens.

###### Parameters

###### ctx

[`OpenSandboxRunBeforeStartContext`](#opensandboxrunbeforestartcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### now?

> `optional` **now?**: () => `number`

Defined in: [src/runtime/sandbox-run.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L141)

**`Experimental`**

Test seam for deterministic hook timestamps. Defaults to `Date.now`.

###### Returns

`number`

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [src/runtime/sandbox-run.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L143)

**`Experimental`**

Bounds box-creation bursts inside lineage fanout. Default from lineage.

##### readRetryDelayMs?

> `optional` **readRetryDelayMs?**: `number`

Defined in: [src/runtime/sandbox-run.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L146)

**`Experimental`**

Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
 retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests).

***

### StdioMcpServerSpec

Defined in: [src/runtime/stdio-mcp-client.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L72)

#### Properties

##### command

> **command**: `string`

Defined in: [src/runtime/stdio-mcp-client.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L74)

Command that starts the MCP server (stdio transport).

##### args?

> `optional` **args?**: `string`[]

Defined in: [src/runtime/stdio-mcp-client.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L75)

##### cwd?

> `optional` **cwd?**: `string`

Defined in: [src/runtime/stdio-mcp-client.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L77)

Working directory the server starts in (a built candidate's worktree, typically).

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/stdio-mcp-client.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L80)

Declared public env for the server process. Only a minimal non-sensitive
subset of the parent env is inherited.

##### protectedEnv?

> `optional` **protectedEnv?**: `Record`\<`string`, `string`\>

Defined in: [src/runtime/stdio-mcp-client.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L83)

Sensitive env for the server process. These values override `env` and are
redacted from child-supplied errors, tool metadata, and tool results.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/runtime/stdio-mcp-client.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L85)

Handshake AND per-request timeout (ms). Default 30s.

***

### McpToolDescriptor

Defined in: [src/runtime/stdio-mcp-client.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L92)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/stdio-mcp-client.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L93)

##### description?

> `optional` **description?**: `string`

Defined in: [src/runtime/stdio-mcp-client.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L94)

##### inputSchema?

> `optional` **inputSchema?**: `unknown`

Defined in: [src/runtime/stdio-mcp-client.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L95)

***

### StdioMcpConnection

Defined in: [src/runtime/stdio-mcp-client.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L98)

#### Properties

##### tools

> `readonly` **tools**: readonly [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: [src/runtime/stdio-mcp-client.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L100)

The tools the server exposed at connect time (`tools/list`).

#### Methods

##### callTool()

> **callTool**(`name`, `args`): `Promise`\<`string`\>

Defined in: [src/runtime/stdio-mcp-client.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L104)

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

Defined in: [src/runtime/stdio-mcp-client.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L106)

Kill the server child. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### MaterializeLocalMcpOptions

Defined in: [src/runtime/stdio-mcp-client.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L293)

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/runtime/stdio-mcp-client.ts:295](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L295)

Handshake / per-request timeout per server (ms). Default 30s.

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: [src/runtime/stdio-mcp-client.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L297)

Cap on a tool result's text fed back to the worker. Default 2000 chars.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Defined in: [src/runtime/stdio-mcp-client.ts:303](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L303)

Resolves a server's DECLARED secrets (`metadata.secretEnv`: env var name →
 provider key name) at spawn time. The resolved values reach ONLY the child
 process env — never the profile, the logs, or an error message. Fail-closed:
 a server declaring secrets without a provider (or with a missing key)
 throws instead of booting keyless.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Defined in: [src/runtime/stdio-mcp-client.ts:308](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L308)

Required trust decision for profiles that declare local MCP processes.
Omit to refuse all profile-controlled host execution. Passing
`allowLocalMcp: true` is only safe for an author-controlled profile: the
process receives this Runtime's filesystem and network privileges.

***

### LocalMcpMaterialization

Defined in: [src/runtime/stdio-mcp-client.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L312)

The live same-host materialization of a profile's `mcp` surface.

#### Properties

##### tools

> **tools**: [`AgenticTool`](#agentictool)[]

Defined in: [src/runtime/stdio-mcp-client.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L314)

Worker-facing tool specs: namespaced `<server>__<tool>`, provider-safe schemas.

#### Methods

##### owns()

> **owns**(`name`): `boolean`

Defined in: [src/runtime/stdio-mcp-client.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L316)

Whether `name` is one of this materialization's namespaced tools.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### call()

> **call**(`name`, `args`): `Promise`\<`string`\>

Defined in: [src/runtime/stdio-mcp-client.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L318)

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

Defined in: [src/runtime/stdio-mcp-client.ts:320](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L320)

Kill every spawned server. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### NaiveDriverOptions

Defined in: [src/runtime/steering-drivers.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L82)

Options for [naiveDriver](#naivedriver).

#### Type Parameters

##### Task

`Task`

#### Properties

##### continuation

> **continuation**: `string`

Defined in: [src/runtime/steering-drivers.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L89)

The fixed continuation issued every round after shot 0. The same string is
sent whether the prior shot passed inspection or not — the naive driver
reads no part of the verdict. Domain text is the caller's; the substrate
supplies none.

##### applyContinuation

> **applyContinuation**: [`ApplyContinuation`](#applycontinuation)\<`Task`\>

Defined in: [src/runtime/steering-drivers.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L91)

Folds `continuation` into the caller's Task shape for the next shot.

##### maxIterations

> **maxIterations**: `number`

Defined in: [src/runtime/steering-drivers.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L93)

Hard shot cap. The loop stops refining once history reaches this length.

##### name?

> `optional` **name?**: `string`

Defined in: [src/runtime/steering-drivers.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L95)

Trace-event identifier. Default `'naive'`.

***

### DumbDriverOptions

Defined in: [src/runtime/steering-drivers.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L136)

Options for [dumbDriver](#dumbdriver).

#### Type Parameters

##### Task

`Task`

#### Properties

##### onPass

> **onPass**: `string`

Defined in: [src/runtime/steering-drivers.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L143)

Continuation issued when the prior shot's verdict is valid. In a
stop-on-pass loop this is rarely reached (a valid shot ends the loop), but
it is required so the driver is total over the pass/fail bit; pass a
confirmation/keep-going string.

##### onFail

> **onFail**: `string`

Defined in: [src/runtime/steering-drivers.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L145)

Continuation issued when the prior shot's verdict is NOT valid.

##### applyContinuation

> **applyContinuation**: [`ApplyContinuation`](#applycontinuation)\<`Task`\>

Defined in: [src/runtime/steering-drivers.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L147)

Folds the chosen continuation into the caller's Task shape.

##### maxIterations

> **maxIterations**: `number`

Defined in: [src/runtime/steering-drivers.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L149)

Hard shot cap. The loop stops refining once history reaches this length.

##### name?

> `optional` **name?**: `string`

Defined in: [src/runtime/steering-drivers.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L151)

Trace-event identifier. Default `'dumb'`.

***

### AuthorStrategyOptions

Defined in: [src/runtime/strategy-author.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L78)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [src/runtime/strategy-author.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L80)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/strategy-author.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L81)

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: [src/runtime/strategy-author.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L86)

A NAMED fallback author tried once when the primary call fails or returns no code
 block (thinking models time out at the edge on long authoring prompts, or return
 empty content without `maxTokens`). Opt-in — absent means the primary's failure
 propagates.

##### contract?

> `optional` **contract?**: `string`

Defined in: [src/runtime/strategy-author.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L90)

The contract text shown to the author. Default `strategyAuthorContract`. The
 meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
 variant on the same frozen holdout as any strategy.

##### environmentName

> **environmentName**: `string`

Defined in: [src/runtime/strategy-author.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L92)

The environment the losses came from (orientation only — never the verifiers).

##### lossesJson

> **lossesJson**: `string`

Defined in: [src/runtime/strategy-author.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L94)

The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient.

##### budget

> **budget**: `number`

Defined in: [src/runtime/strategy-author.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L96)

The budget the strategy must respect (shots/width).

##### outDir

> **outDir**: `string`

Defined in: [src/runtime/strategy-author.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L98)

Where the authored module file is written (created if missing).

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/strategy-author.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L99)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [src/runtime/strategy-author.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L101)

Completion cap — required by thinking-model authors that stream reasoning first.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/strategy-author.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L102)

***

### AuthoredStrategy

Defined in: [src/runtime/strategy-author.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L138)

#### Properties

##### strategy

> **strategy**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy-author.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L139)

##### file

> **file**: `string`

Defined in: [src/runtime/strategy-author.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L140)

##### code

> **code**: `string`

Defined in: [src/runtime/strategy-author.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L141)

***

### EvolutionAuthor

Defined in: [src/runtime/strategy-evolution.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L46)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [src/runtime/strategy-evolution.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L48)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L49)

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L50)

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L51)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L52)

***

### StrategyEvolutionConfig

Defined in: [src/runtime/strategy-evolution.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L57)

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/strategy-evolution.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L58)

##### tasks

> **tasks**: (`offset`, `n`) => `Promise`\<[`AgenticTask`](#agentictask)[]\>

Defined in: [src/runtime/strategy-evolution.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L62)

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

Defined in: [src/runtime/strategy-evolution.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L63)

##### holdoutN

> **holdoutN**: `number`

Defined in: [src/runtime/strategy-evolution.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L64)

##### holdoutOffset?

> `optional` **holdoutOffset?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L66)

Extra offset past the train slice for the holdout draw (rotate across runs).

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

Defined in: [src/runtime/strategy-evolution.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L67)

##### author

> **author**: [`EvolutionAuthor`](#evolutionauthor)

Defined in: [src/runtime/strategy-evolution.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L68)

##### budget?

> `optional` **budget?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L70)

Rollouts (sample) / shots (refine) per strategy per task. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L71)

##### generations?

> `optional` **generations?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L73)

Author→tournament rounds after gen0. Default 2.

##### populationSize?

> `optional` **populationSize?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L75)

Authored candidates per generation. Default 2.

##### baselines?

> `optional` **baselines?**: [`Strategy`](#strategy-3)[]

Defined in: [src/runtime/strategy-evolution.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L77)

The gen0 field. Default [sample, refine, sampleThenRefine].

##### objective?

> `optional` **objective?**: `"score"` \| `"cost"`

Defined in: [src/runtime/strategy-evolution.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L83)

What "better" means for PROMOTION. 'score' (default): the candidate must beat the
 incumbent's score (superiority gate). 'cost': the candidate must prove score
 NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
 savings — the "same quality, cheaper" objective. The author is told the objective
 and sees per-task spend either way.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L85)

Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### champion?

> `optional` **champion?**: [`ChampionPolicy`](#championpolicy)

Defined in: [src/runtime/strategy-evolution.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L87)

Search-side champion selection. Default 'costAware'.

##### championEpsilon?

> `optional` **championEpsilon?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L89)

Score band treated as a tie under 'costAware'. Default 0.01.

##### outDir

> **outDir**: `string`

Defined in: [src/runtime/strategy-evolution.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L91)

Where authored modules are written.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L93)

Promotion-gate evidence floor (paired holdout tasks).

##### band?

> `optional` **band?**: `object`

Defined in: [src/runtime/strategy-evolution.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L102)

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

Defined in: [src/runtime/strategy-evolution.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L111)

What the author learns from a tournament. 'exact' (default) = scores + progressions
 per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
 per generation reaches the author from the evaluation data).

##### reproducerCheck?

> `optional` **reproducerCheck?**: `object`

Defined in: [src/runtime/strategy-evolution.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L118)

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

Defined in: [src/runtime/strategy-evolution.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L128)

Endurance: write the run state after every completed phase; with `resume`, a
 restart skips completed phases (authored modules re-imported from their files).
 Worst case after a mid-run death is re-paying ONE phase, never the run.

###### path

> **path**: `string`

###### resume?

> `optional` **resume?**: `boolean`

##### onPhase?

> `optional` **onPhase?**: (`phase`) => `Promise`\<`void`\>

Defined in: [src/runtime/strategy-evolution.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L135)

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

Defined in: [src/runtime/strategy-evolution.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L136)

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

Defined in: [src/runtime/strategy-evolution.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L137)

***

### ChampionPick

Defined in: [src/runtime/strategy-evolution.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L152)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/strategy-evolution.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L153)

##### score

> **score**: `number`

Defined in: [src/runtime/strategy-evolution.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L154)

##### usd

> **usd**: `number`

Defined in: [src/runtime/strategy-evolution.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L155)

***

### EvolutionCandidate

Defined in: [src/runtime/strategy-evolution.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L158)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/strategy-evolution.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L159)

##### file?

> `optional` **file?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L160)

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L161)

##### codeChars?

> `optional` **codeChars?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L162)

##### error?

> `optional` **error?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L164)

Present when this author attempt failed (recorded, never silent).

***

### EvolutionGeneration

Defined in: [src/runtime/strategy-evolution.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L167)

#### Properties

##### generation

> **generation**: `number`

Defined in: [src/runtime/strategy-evolution.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L168)

##### candidates

> **candidates**: [`EvolutionCandidate`](#evolutioncandidate)[]

Defined in: [src/runtime/strategy-evolution.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L169)

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [src/runtime/strategy-evolution.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L170)

##### champion

> **champion**: [`ChampionPick`](#championpick)

Defined in: [src/runtime/strategy-evolution.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L171)

***

### EvolutionArchiveNode

Defined in: [src/runtime/strategy-evolution.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L174)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/strategy-evolution.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L175)

##### source

> **source**: `"baseline"` \| `"authored"`

Defined in: [src/runtime/strategy-evolution.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L176)

##### generation

> **generation**: `number`

Defined in: [src/runtime/strategy-evolution.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L177)

##### parent?

> `optional` **parent?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L179)

The champion whose tournament losses this candidate was authored from.

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: [src/runtime/strategy-evolution.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L180)

##### file?

> `optional` **file?**: `string`

Defined in: [src/runtime/strategy-evolution.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L181)

##### score

> **score**: `number`

Defined in: [src/runtime/strategy-evolution.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L184)

Latest measured tournament result — 0 until the node's first tournament settles
 (an authored node is created before its generation's benchmark runs).

##### usd

> **usd**: `number`

Defined in: [src/runtime/strategy-evolution.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L185)

***

### EvolutionBandInfo

Defined in: [src/runtime/strategy-evolution.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L204)

#### Properties

##### screened

> **screened**: `number`

Defined in: [src/runtime/strategy-evolution.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L206)

Tasks screened by the reference on the holdout pool.

##### inBand

> **inBand**: `number`

Defined in: [src/runtime/strategy-evolution.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L208)

Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN.

##### refScores

> **refScores**: `object`[]

Defined in: [src/runtime/strategy-evolution.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L210)

Reference scores per screened task (the screening record).

###### taskId

> **taskId**: `string`

###### score

> **score**: `number`

***

### EvolutionReport

Defined in: [src/runtime/strategy-evolution.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L213)

#### Properties

##### gen0

> **gen0**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [src/runtime/strategy-evolution.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L214)

##### gen0Champion

> **gen0Champion**: [`ChampionPick`](#championpick)

Defined in: [src/runtime/strategy-evolution.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L215)

##### generations

> **generations**: [`EvolutionGeneration`](#evolutiongeneration)[]

Defined in: [src/runtime/strategy-evolution.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L216)

##### archive

> **archive**: [`EvolutionArchiveNode`](#evolutionarchivenode)[]

Defined in: [src/runtime/strategy-evolution.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L217)

##### finalChampion

> **finalChampion**: [`ChampionPick`](#championpick)

Defined in: [src/runtime/strategy-evolution.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L218)

##### holdout

> **holdout**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [src/runtime/strategy-evolution.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L219)

##### verdict

> **verdict**: [`PromotionVerdict`](#promotionverdict)

Defined in: [src/runtime/strategy-evolution.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L220)

##### band?

> `optional` **band?**: [`EvolutionBandInfo`](#evolutionbandinfo)

Defined in: [src/runtime/strategy-evolution.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L223)

Present when band screening ran — the verdict's estimand is then "paired lift on
 headroom tasks" (band membership fixed by the reference screen, pre-registered).

##### reproduction?

> `optional` **reproduction?**: `ReproductionCheck`

Defined in: [src/runtime/strategy-evolution.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L225)

Present when reproducerCheck ran (final champion was authored).

##### trajectory

> **trajectory**: `object`[]

Defined in: [src/runtime/strategy-evolution.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L230)

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

Defined in: [src/runtime/strategy.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L48)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [src/runtime/strategy.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L49)

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/runtime/strategy.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L50)

##### userPrompt

> `readonly` **userPrompt**: `string`

Defined in: [src/runtime/strategy.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L51)

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `unknown`\>

Defined in: [src/runtime/strategy.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L53)

Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it.

***

### ArtifactHandle

Defined in: [src/runtime/strategy.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L56)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [src/runtime/strategy.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L57)

##### surface

> `readonly` **surface**: `string`

Defined in: [src/runtime/strategy.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L58)

##### ctx?

> `readonly` `optional` **ctx?**: `unknown`

Defined in: [src/runtime/strategy.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L60)

Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id).

***

### AgenticTool

Defined in: [src/runtime/strategy.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L63)

#### Properties

##### type

> `readonly` **type**: `"function"`

Defined in: [src/runtime/strategy.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L64)

##### function

> `readonly` **function**: `object`

Defined in: [src/runtime/strategy.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L65)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

***

### SurfaceScore

Defined in: [src/runtime/strategy.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L68)

#### Properties

##### passes

> **passes**: `number`

Defined in: [src/runtime/strategy.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L69)

##### total

> **total**: `number`

Defined in: [src/runtime/strategy.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L70)

##### errored

> **errored**: `number`

Defined in: [src/runtime/strategy.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L72)

Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable.

***

### AgenticSurface

Defined in: [src/runtime/strategy.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L76)

A stateful, checkable environment an agent operates over with tools. Open behind one interface.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/runtime/strategy.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L77)

#### Methods

##### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](#artifacthandle)\>

Defined in: [src/runtime/strategy.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L78)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<[`ArtifactHandle`](#artifacthandle)\>

##### tools()

> **tools**(`task`, `handle`): `Promise`\<[`AgenticTool`](#agentictool)[]\>

Defined in: [src/runtime/strategy.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L79)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`AgenticTool`](#agentictool)[]\>

##### call()

> **call**(`handle`, `name`, `args`): `Promise`\<`string`\>

Defined in: [src/runtime/strategy.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L80)

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

Defined in: [src/runtime/strategy.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L81)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`SurfaceScore`](#surfacescore)\>

##### close()

> **close**(`handle`): `Promise`\<`void`\>

Defined in: [src/runtime/strategy.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L82)

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

***

### AgenticOptions

Defined in: [src/runtime/strategy.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L85)

#### Extended by

- [`RunAgenticOptions`](#runagenticoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [src/runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

##### routerKey

> **routerKey**: `string`

Defined in: [src/runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

##### model

> **model**: `string`

Defined in: [src/runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: [src/runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

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

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/strategy.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L95)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [src/runtime/strategy.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L98)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [src/runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

Turns the agent may take within ONE shot before the driver intervenes.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [src/runtime/strategy.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L103)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [src/runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [src/runtime/strategy.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L110)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [src/runtime/strategy.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L112)

Tags written onto learned facts (and used by the caller's priming query).

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

Defined in: [src/runtime/strategy.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L115)

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

***

### CorpusReadbackOptions

Defined in: [src/runtime/strategy.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L118)

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [src/runtime/strategy.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L120)

Minimum confidence for a fact to be injected. Default 0.7.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [src/runtime/strategy.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L122)

Extra tags a fact must carry, in addition to `corpusTags`.

##### maxFacts?

> `optional` **maxFacts?**: `number`

Defined in: [src/runtime/strategy.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L124)

Max facts injected per shot. Default 3.

##### includeOperatorFacts?

> `optional` **includeOperatorFacts?**: `boolean`

Defined in: [src/runtime/strategy.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L126)

Default false: only facts tagged `audience:agent` are injected into the worker.

***

### AgenticRunResult

Defined in: [src/runtime/strategy.ts:608](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L608)

#### Properties

##### mode

> **mode**: `string`

Defined in: [src/runtime/strategy.ts:610](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L610)

The strategy name (built-in 'depth'/'breadth' or a custom strategy's name).

##### score

> **score**: `number`

Defined in: [src/runtime/strategy.ts:611](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L611)

##### resolved

> **resolved**: `boolean`

Defined in: [src/runtime/strategy.ts:612](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L612)

##### completions

> **completions**: `number`

Defined in: [src/runtime/strategy.ts:613](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L613)

##### progression

> **progression**: `number`[]

Defined in: [src/runtime/strategy.ts:615](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L615)

DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout.

##### shots

> **shots**: `number`

Defined in: [src/runtime/strategy.ts:616](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L616)

##### usd

> **usd**: `number`

Defined in: [src/runtime/strategy.ts:619](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L619)

The cost vector, stamped by `runAgentic` from the Supervisor's conserved pool: real
 router tokens, priced usd (0 when the model is unpriced — never fabricated), wall ms.

##### ms

> **ms**: `number`

Defined in: [src/runtime/strategy.ts:620](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L620)

##### tokens

> **tokens**: `object`

Defined in: [src/runtime/strategy.ts:621](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L621)

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### Strategy

Defined in: [src/runtime/strategy.ts:758](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L758)

A Strategy is HOW you spend the compute budget to beat the Environment's check — it
builds the driver `Agent` the Supervisor runs. This is the OPEN extension point: a dev
authors their own by implementing `driver()` to return an Agent whose `act()` spawns
shots/analysts via `scope.spawn` / `scope.next` / `scope.send`. The two built-ins are
the reference implementations to copy:
  sample — K INDEPENDENT attempts, keep the best-verifying (best-of-N / resample).
  refine — attempt → observe() reads the trace → steer the next → repeat (iterate).
(A multi-agent "team" is just a Strategy whose driver spawns several different agents.)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/runtime/strategy.ts:759](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L759)

#### Methods

##### driver()

> **driver**(`surface`, `task`, `opts`, `budget`): [`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [src/runtime/strategy.ts:760](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L760)

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

[`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### ShotPersona

Defined in: [src/runtime/strategy.ts:790](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L790)

A role for one shot — multi-agent loops (researcher + engineer, a panel of k
 researchers) give each shot its own system prompt and optionally its own model.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [src/runtime/strategy.ts:793](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L793)

Replaces the task's systemPrompt for a FRESH shot; on a carried conversation it is
 injected as a hand-off message (the transcript's earlier roles stay intact).

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/strategy.ts:795](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L795)

Per-shot model override (e.g. a stronger model for the engineer shot).

***

### ShotSpec

Defined in: [src/runtime/strategy.ts:798](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L798)

#### Properties

##### handle?

> `optional` **handle?**: [`ArtifactHandle`](#artifacthandle)

Defined in: [src/runtime/strategy.ts:800](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L800)

present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart).

##### messages?

> `optional` **messages?**: `Msg`[]

Defined in: [src/runtime/strategy.ts:801](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L801)

##### steer?

> `optional` **steer?**: `string`

Defined in: [src/runtime/strategy.ts:802](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L802)

##### persona?

> `optional` **persona?**: [`ShotPersona`](#shotpersona)

Defined in: [src/runtime/strategy.ts:803](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L803)

##### tools?

> `optional` **tools?**: `string`[]

Defined in: [src/runtime/strategy.ts:806](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L806)

Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
 the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all.

***

### StrategyResult

Defined in: [src/runtime/strategy.ts:808](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L808)

#### Extended by

- [`StructuralRolloutResult`](#structuralrolloutresult)

#### Properties

##### score

> **score**: `number`

Defined in: [src/runtime/strategy.ts:809](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L809)

##### resolved

> **resolved**: `boolean`

Defined in: [src/runtime/strategy.ts:810](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L810)

##### completions

> **completions**: `number`

Defined in: [src/runtime/strategy.ts:811](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L811)

##### progression

> **progression**: `number`[]

Defined in: [src/runtime/strategy.ts:812](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L812)

##### shots

> **shots**: `number`

Defined in: [src/runtime/strategy.ts:813](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L813)

***

### StrategyCtx

Defined in: [src/runtime/strategy.ts:825](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L825)

What a strategy body composes with: the artifact lifecycle, the budget, and the two steps.

#### Properties

##### surface

> `readonly` **surface**: `StrategyArtifacts`

Defined in: [src/runtime/strategy.ts:827](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L827)

Open/close artifacts the body manages itself (e.g. one persistent handle for depth).

##### task

> `readonly` **task**: [`AgenticTask`](#agentictask)

Defined in: [src/runtime/strategy.ts:828](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L828)

##### opts

> `readonly` **opts**: [`AgenticOptions`](#agenticoptions)

Defined in: [src/runtime/strategy.ts:829](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L829)

##### budget

> `readonly` **budget**: `number`

Defined in: [src/runtime/strategy.ts:830](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L830)

##### scope

> `readonly` **scope**: [`Scope`](#scope-1)\<[`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [src/runtime/strategy.ts:831](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L831)

#### Methods

##### shot()

> **shot**(`spec?`): `Promise`\<`ShotResult` \| `null`\>

Defined in: [src/runtime/strategy.ts:833](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L833)

Run ONE worker shot; its harness-scored result, or null if it went down.

###### Parameters

###### spec?

[`ShotSpec`](#shotspec)

###### Returns

`Promise`\<`ShotResult` \| `null`\>

##### critique()

> **critique**(`messages`): `Promise`\<`string` \| `null`\>

Defined in: [src/runtime/strategy.ts:835](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L835)

The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down.

###### Parameters

###### messages

`Msg`[]

###### Returns

`Promise`\<`string` \| `null`\>

##### consult()

> **consult**(`messages`, `instruction`): `Promise`\<`string` \| `null`\>

Defined in: [src/runtime/strategy.ts:840](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L840)

The RAW analyst channel: the firewalled critic answers `instruction` over the
 trajectory verbatim — no findings extraction, so verdict-shaped formats
 (CONTINUE/STOP decisions, calibrated predictions) survive. Same firewall:
 trajectory in, never scores. Null when the analyst went down.

###### Parameters

###### messages

`Msg`[]

###### instruction

`string`

###### Returns

`Promise`\<`string` \| `null`\>

##### listTools()

> **listTools**(`handle`): `Promise`\<`object`[]\>

Defined in: [src/runtime/strategy.ts:844](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L844)

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

Defined in: [src/runtime/strategy.ts:1073](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1073)

#### Extends

- [`AgenticOptions`](#agenticoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [src/runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerBaseUrl`](#routerbaseurl-1)

##### routerKey

> **routerKey**: `string`

Defined in: [src/runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerKey`](#routerkey-1)

##### model

> **model**: `string`

Defined in: [src/runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`model`](#model-7)

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: [src/runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

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

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/strategy.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L95)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`temperature`](#temperature-3)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [src/runtime/strategy.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L98)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`maxTokens`](#maxtokens-2)

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [src/runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

Turns the agent may take within ONE shot before the driver intervenes.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`innerTurns`](#innerturns)

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [src/runtime/strategy.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L103)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`analystInstruction`](#analystinstruction-2)

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [src/runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`analystModel`](#analystmodel)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [src/runtime/strategy.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L110)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpus`](#corpus-4)

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [src/runtime/strategy.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L112)

Tags written onto learned facts (and used by the caller's priming query).

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpusTags`](#corpustags)

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

Defined in: [src/runtime/strategy.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L115)

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpusReadback`](#corpusreadback)

##### surface

> **surface**: [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/strategy.ts:1074](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1074)

##### task

> **task**: [`AgenticTask`](#agentictask)

Defined in: [src/runtime/strategy.ts:1075](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1075)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/strategy.ts:1078](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1078)

Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
 The seam online watchdogs/route-auditors subscribe to.

##### strategy?

> `optional` **strategy?**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:1080](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1080)

A Strategy (the open way) — author/pass your own. Overrides `mode` when present.

##### mode?

> `optional` **mode?**: `"depth"` \| `"breadth"`

Defined in: [src/runtime/strategy.ts:1082](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1082)

Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'.

##### budget

> **budget**: `number`

Defined in: [src/runtime/strategy.ts:1084](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1084)

budget: refine→max shots; sample→rollout width.

##### rootBudget?

> `optional` **rootBudget?**: [`Budget`](#budget-12)

Defined in: [src/runtime/strategy.ts:1085](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1085)

***

### StreamAgentTurnOptions

Defined in: [src/runtime/stream-agent-turn.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L141)

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/stream-agent-turn.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L143)

**`Experimental`**

Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: [src/runtime/stream-agent-turn.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L149)

**`Experimental`**

Wall-clock deadline for the whole turn in ms. An expired deadline aborts
the backend and terminates the stream with `final.status: 'failed'`
(a blown deadline is a turn failure, not a caller cancellation).

##### preserveToolParts?

> `optional` **preserveToolParts?**: `boolean`

Defined in: [src/runtime/stream-agent-turn.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L159)

**`Experimental`**

Opt-in tool-part projection for box-kind backends (`box`, `box-task`,
`executor`): sandbox tool parts additionally surface in-stream as
`tool_call` / `tool_result` events (`mapSandboxToolEvent`), so a consumer
rendering tool activity needs no bespoke sandbox-event parser. Default
off — the stream vocabulary existing consumers see is unchanged. No-op
for the `chat` kind (its backend emits `RuntimeStreamEvent`s directly,
tool events included when the backend produces them).

##### onRawEvent?

> `optional` **onRawEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/stream-agent-turn.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L168)

**`Experimental`**

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

Defined in: [src/runtime/stream-agent-turn.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L179)

**`Experimental`**

Metered usage of one turn, summed over every cost-bearing event the backend
emitted. `input`/`output` are token counts (0 when the backend reported
none — the honest sum, never a fabricated estimate). `costUsd`/`model` are
present only when the backend actually reported them.

#### Properties

##### input

> **input**: `number`

Defined in: [src/runtime/stream-agent-turn.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L180)

**`Experimental`**

##### output

> **output**: `number`

Defined in: [src/runtime/stream-agent-turn.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L181)

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [src/runtime/stream-agent-turn.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L182)

**`Experimental`**

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/stream-agent-turn.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L183)

**`Experimental`**

***

### CollectedAgentTurn

Defined in: [src/runtime/stream-agent-turn.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L193)

**`Experimental`**

A drained turn: the terminal summary plus every event the stream yielded.
`status`/`error` mirror the terminal `final` event so a failed or aborted
turn stays inspectable without re-scanning `events`.

#### Properties

##### finalText

> **finalText**: `string`

Defined in: [src/runtime/stream-agent-turn.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L194)

**`Experimental`**

##### usage

> **usage**: [`AgentTurnUsage`](#agentturnusage)

Defined in: [src/runtime/stream-agent-turn.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L195)

**`Experimental`**

##### events

> **events**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: [src/runtime/stream-agent-turn.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L196)

**`Experimental`**

##### status

> **status**: [`AgentTaskStatus`](index.md#agenttaskstatus)

Defined in: [src/runtime/stream-agent-turn.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L197)

**`Experimental`**

##### error?

> `optional` **error?**: [`BackendErrorDetail`](index.md#backenderrordetail)

Defined in: [src/runtime/stream-agent-turn.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L198)

**`Experimental`**

***

### StructuralRolloutPolicy

Defined in: [src/runtime/structural-rollout.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L45)

The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/
 TESTGEN/DIVERSE/TEMPERATURE). Defaults are the measured sweet spot: repair value
 concentrates at low k (~+12pp at k=1, +1–3pp at k=5), so `k=5, repairRounds=2` is the
 full recipe and `k=1, repairRounds=2` the low-compute preset.

#### Properties

##### k

> **k**: `number`

Defined in: [src/runtime/structural-rollout.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L47)

Independent samples per task (selection breadth).

##### repairRounds

> **repairRounds**: `number`

Defined in: [src/runtime/structural-rollout.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L49)

Repair shots after selection, each steered by the checks' failure output.

##### testgen

> **testgen**: `number`

Defined in: [src/runtime/structural-rollout.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L51)

Model-authored visible checks requested per task; 0 disables authoring.

##### diverse?

> `optional` **diverse?**: `boolean`

Defined in: [src/runtime/structural-rollout.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L54)

Per-slot strategy-lens prefixes on the k samples (attacks the all-k-fail bucket).
 Measured as a paired null (+0.6pp) — kept as an optional knob, off by default.

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [src/runtime/structural-rollout.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L56)

Sampling temperature for every shot of this strategy; omitted ⇒ the worker default.

***

### VisibleCheck

Defined in: [src/runtime/structural-rollout.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L87)

One task-visible executable check (e.g. a single-line Python assert).

#### Properties

##### code

> **code**: `string`

Defined in: [src/runtime/structural-rollout.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L88)

##### kind

> **kind**: `"authored"` \| `"official"`

Defined in: [src/runtime/structural-rollout.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L91)

'official' = shown in the task itself (docstring example, shown assert);
 'authored' = the model's own guess. Official outranks authored in selection.

***

### CheckSourceCtx

Defined in: [src/runtime/structural-rollout.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L97)

What a CheckSource composes with. `consult` is the strategy family's raw analyst
 channel (metered by the conserved pool, offline-injectable via `opts.complete`) —
 check authoring goes through it rather than a bespoke model client.

#### Properties

##### count

> **count**: `number`

Defined in: [src/runtime/structural-rollout.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L99)

Authored-check budget for this task (`policy.testgen`).

##### entrySymbol?

> `optional` **entrySymbol?**: `string`

Defined in: [src/runtime/structural-rollout.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L102)

The symbol authored checks must reference; undefined ⇒ authoring is skipped
 (no guesses beats guesses pinned to nothing).

#### Methods

##### consult()

> **consult**(`instruction`): `Promise`\<`string` \| `null`\>

Defined in: [src/runtime/structural-rollout.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L105)

One metered LLM call: instruction in, reply text out, null when the channel went
 down. The task's visible prompt is included by the channel itself.

###### Parameters

###### instruction

`string`

###### Returns

`Promise`\<`string` \| `null`\>

***

### CheckSource

Defined in: [src/runtime/structural-rollout.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L111)

Produces the task's visible checks. MUST derive them from agent-visible information
 only, before any candidate exists — the strategy freezes the returned set for every
 sample and repair round of the task.

#### Methods

##### generate()

> **generate**(`task`, `ctx`): `Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

Defined in: [src/runtime/structural-rollout.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L112)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### ctx

[`CheckSourceCtx`](#checksourcectx)

###### Returns

`Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

***

### CheckOutcome

Defined in: [src/runtime/structural-rollout.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L205)

How one candidate fared against the frozen visible checks, split by check kind.

#### Properties

##### passedOfficial

> **passedOfficial**: `number`

Defined in: [src/runtime/structural-rollout.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L206)

##### totalOfficial

> **totalOfficial**: `number`

Defined in: [src/runtime/structural-rollout.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L207)

##### passedAuthored

> **passedAuthored**: `number`

Defined in: [src/runtime/structural-rollout.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L208)

##### totalAuthored

> **totalAuthored**: `number`

Defined in: [src/runtime/structural-rollout.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L209)

##### failureOutput

> **failureOutput**: `string`

Defined in: [src/runtime/structural-rollout.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L211)

The checks' failure report — the ONLY feedback the repair loop may see.

##### crashed?

> `optional` **crashed?**: `boolean`

Defined in: [src/runtime/structural-rollout.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L214)

True when the candidate crashed before any check could run — ranks below a
 candidate that ran and failed everything.

***

### CheckExecChannel

Defined in: [src/runtime/structural-rollout.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L219)

Minimal exec channel the default runner needs. `SandboxInstance` (and therefore
 `ValidationCtx.box`) satisfies it structurally.

#### Methods

##### exec()

> **exec**(`command`, `options?`): `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

Defined in: [src/runtime/structural-rollout.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L220)

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

Defined in: [src/runtime/structural-rollout.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L226)

#### Properties

##### task

> **task**: [`AgenticTask`](#agentictask)

Defined in: [src/runtime/structural-rollout.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L227)

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Defined in: [src/runtime/structural-rollout.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L229)

Live exec channel for this run (`ValidationCtx.box` / a sandbox instance).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/structural-rollout.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L230)

***

### CheckRunner

Defined in: [src/runtime/structural-rollout.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L235)

Executes the frozen checks against one candidate. Implementations MUST fail loud
 (throw) when they cannot execute — a silent zero poisons selection.

#### Methods

##### run()

> **run**(`candidate`, `checks`, `ctx`): `Promise`\<[`CheckOutcome`](#checkoutcome)\>

Defined in: [src/runtime/structural-rollout.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L236)

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

Defined in: [src/runtime/structural-rollout.ts:489](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L489)

The body's deliverable — a `StrategyResult` plus selection provenance. The extra
 fields ride through `defineStrategy`'s deliverable spread onto `AgenticRunResult`
 (score/resolved stay harness-verified, exactly as for every authored strategy).

#### Extends

- [`StrategyResult`](#strategyresult)

#### Properties

##### score

> **score**: `number`

Defined in: [src/runtime/strategy.ts:809](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L809)

###### Inherited from

[`StrategyResult`](#strategyresult).[`score`](#score-9)

##### resolved

> **resolved**: `boolean`

Defined in: [src/runtime/strategy.ts:810](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L810)

###### Inherited from

[`StrategyResult`](#strategyresult).[`resolved`](#resolved-4)

##### completions

> **completions**: `number`

Defined in: [src/runtime/strategy.ts:811](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L811)

###### Inherited from

[`StrategyResult`](#strategyresult).[`completions`](#completions-1)

##### progression

> **progression**: `number`[]

Defined in: [src/runtime/strategy.ts:812](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L812)

###### Inherited from

[`StrategyResult`](#strategyresult).[`progression`](#progression-2)

##### shots

> **shots**: `number`

Defined in: [src/runtime/strategy.ts:813](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L813)

###### Inherited from

[`StrategyResult`](#strategyresult).[`shots`](#shots-3)

##### selection

> **selection**: [`SelectionReceipt`](#selectionreceipt)[]

Defined in: [src/runtime/structural-rollout.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L492)

One receipt per scored candidate (k samples, then repairs), `SelectionReceipt`
 shaped like the kernel's (`types.ts`), selector 'driver'.

##### repairStop

> **repairStop**: [`RepairStop`](#repairstop)

Defined in: [src/runtime/structural-rollout.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L493)

##### officialChecks

> **officialChecks**: `number`

Defined in: [src/runtime/structural-rollout.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L494)

##### authoredChecks

> **authoredChecks**: `number`

Defined in: [src/runtime/structural-rollout.ts:495](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L495)

***

### StructuralRolloutConfig

Defined in: [src/runtime/structural-rollout.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L498)

#### Properties

##### policy?

> `optional` **policy?**: `Partial`\<[`StructuralRolloutPolicy`](#structuralrolloutpolicy)\>

Defined in: [src/runtime/structural-rollout.ts:500](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L500)

Knobs; missing fields take the measured defaults (k=5, repairRounds=2, testgen=6).

##### checkSource?

> `optional` **checkSource?**: [`CheckSource`](#checksource)

Defined in: [src/runtime/structural-rollout.ts:503](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L503)

Where the visible checks come from. Default: official checks from
 `task.meta.visibleChecks` composed with `modelAuthoredChecks()`.

##### checkRunner?

> `optional` **checkRunner?**: [`CheckRunner`](#checkrunner)

Defined in: [src/runtime/structural-rollout.ts:506](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L506)

How candidates are measured. Default `sandboxCheckRunner()` — it needs an exec
 channel (bind one to the runner, or pass `box` here) and fails loud without one.

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Defined in: [src/runtime/structural-rollout.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L510)

Exec channel threaded into every check run of this strategy (a sandbox instance /
 `ValidationCtx.box`). The strategy seam itself carries no sandbox, so the caller
 who owns one supplies it here or binds it into the runner.

##### extractCandidate?

> `optional` **extractCandidate?**: (`messages`) => `string`

Defined in: [src/runtime/structural-rollout.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L512)

Candidate extraction from a shot's conversation. Default `defaultExtractCandidate`.

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`string`

***

### SurfaceWorkerOut

Defined in: [src/runtime/supervise-surface.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L34)

What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is
 the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit fraction; `failing`
 carries the tests this worker left red (so the analyst can target them).

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

Defined in: [src/runtime/supervise-surface.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L35)

##### score

> `readonly` **score**: `number`

Defined in: [src/runtime/supervise-surface.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L36)

##### shots

> `readonly` **shots**: `number`

Defined in: [src/runtime/supervise-surface.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L37)

##### summary

> `readonly` **summary**: `string`

Defined in: [src/runtime/supervise-surface.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L38)

##### failing?

> `readonly` `optional` **failing?**: readonly `string`[]

Defined in: [src/runtime/supervise-surface.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L39)

***

### SurfaceWorkerConfig

Defined in: [src/runtime/supervise-surface.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L102)

How a worker runs the surface task (its router substrate + per-attempt bounds).

#### Properties

##### routerBaseUrl

> `readonly` **routerBaseUrl**: `string`

Defined in: [src/runtime/supervise-surface.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L103)

##### routerKey

> `readonly` **routerKey**: `string`

Defined in: [src/runtime/supervise-surface.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L104)

##### model

> `readonly` **model**: `string`

Defined in: [src/runtime/supervise-surface.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L105)

##### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/runtime/supervise-surface.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L106)

##### innerTurns?

> `readonly` `optional` **innerTurns?**: `number`

Defined in: [src/runtime/supervise-surface.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L107)

##### budget?

> `readonly` `optional` **budget?**: `number`

Defined in: [src/runtime/supervise-surface.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L109)

Refine-shot budget for ONE worker attempt (max steered shots). Default 1.

***

### SuperviseSurfaceOptions

Defined in: [src/runtime/supervise-surface.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L168)

#### Properties

##### surface

> `readonly` **surface**: [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/supervise-surface.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L170)

The graded surface workers solve (open/tools/call/score/close).

##### worker

> `readonly` **worker**: [`SurfaceWorkerConfig`](#surfaceworkerconfig)

Defined in: [src/runtime/supervise-surface.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L172)

Where/how each worker runs the surface task.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise-surface.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L175)

The conserved compute pool for the whole supervised run. Default: sized off the worker's inner-loop
 bounds for a handful of worker spawns — raise it to let the driver try more.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [src/runtime/supervise-surface.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L178)

The driver brain's router substrate (its own inference). Default: the worker's router + model — the
 driver and workers share one router unless you separate them (e.g. a stronger driver model).

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry) \| `null`

Defined in: [src/runtime/supervise-surface.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L182)

The self-improvement lens fed to the driver on each settled worker. Default `failuresAnalyst()`
 (target the still-failing tests). Pass a custom registry to change it, or `null` to turn the
 within-run self-improvement OFF (the driver sees raw settled outputs).

##### strategy?

> `readonly` `optional` **strategy?**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/supervise-surface.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L184)

The strategy each worker runs over the surface. Default `refine` (iterate-with-feedback).

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [src/runtime/supervise-surface.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L187)

Max workers live at once. Default 1 (serial — required when workers share a persistent artifact, so
 they continue each other instead of racing the file).

***

### SuperviseSurfaceResult

Defined in: [src/runtime/supervise-surface.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L191)

The deployable outcome of a supervised surface run.

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

Defined in: [src/runtime/supervise-surface.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L192)

##### score

> `readonly` **score**: `number`

Defined in: [src/runtime/supervise-surface.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L193)

##### usd

> `readonly` **usd**: `number`

Defined in: [src/runtime/supervise-surface.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L194)

##### tokensIn

> `readonly` **tokensIn**: `number`

Defined in: [src/runtime/supervise-surface.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L195)

##### tokensOut

> `readonly` **tokensOut**: `number`

Defined in: [src/runtime/supervise-surface.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L196)

##### ms

> `readonly` **ms**: `number`

Defined in: [src/runtime/supervise-surface.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L197)

##### completions

> `readonly` **completions**: `number`

Defined in: [src/runtime/supervise-surface.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L199)

Total conserved-pool iterations = the driver + worker LLM rounds the run actually spent.

***

### AuthoredProfile

Defined in: [src/runtime/supervise/authoring.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L25)

What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`).

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/supervise/authoring.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L26)

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [src/runtime/supervise/authoring.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L28)

The rich, task-specific instructions the supervisor wrote for THIS worker.

##### model?

> `optional` **model?**: `string`

Defined in: [src/runtime/supervise/authoring.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L30)

The model the supervisor chose for this sub-task (falls back to the run default).

***

### ProfileRichnessThresholds

Defined in: [src/runtime/supervise/authoring.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L132)

Thresholds below which a system prompt is treated as a thin stub. Tunable per call.

#### Properties

##### minSystemPromptChars

> `readonly` **minSystemPromptChars**: `number`

Defined in: [src/runtime/supervise/authoring.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L134)

A prompt shorter than this many characters is thin (default 600).

##### minSystemPromptLines

> `readonly` **minSystemPromptLines**: `number`

Defined in: [src/runtime/supervise/authoring.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L136)

A prompt with fewer than this many non-blank lines is thin (default 6).

***

### ProfileRichness

Defined in: [src/runtime/supervise/authoring.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L146)

Per-field verdict on one authored profile — the raw material the bench renders + scores.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/runtime/supervise/authoring.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L147)

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [src/runtime/supervise/authoring.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L150)

The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
 convention, or a bare-string prompt — whichever the author used).

##### systemPromptChars

> `readonly` **systemPromptChars**: `number`

Defined in: [src/runtime/supervise/authoring.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L151)

##### systemPromptLines

> `readonly` **systemPromptLines**: `number`

Defined in: [src/runtime/supervise/authoring.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L152)

##### sentenceCount

> `readonly` **sentenceCount**: `number`

Defined in: [src/runtime/supervise/authoring.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L153)

##### hasDescription

> `readonly` **hasDescription**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L154)

##### hasTools

> `readonly` **hasTools**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L155)

##### hasSkills

> `readonly` **hasSkills**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L156)

##### hasMcp

> `readonly` **hasMcp**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L157)

##### hasSubagents

> `readonly` **hasSubagents**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L158)

##### richness

> `readonly` **richness**: `number`

Defined in: [src/runtime/supervise/authoring.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L160)

0..1 — fraction of richness signals present (prompt-depth + the four levers).

##### thin

> `readonly` **thin**: `boolean`

Defined in: [src/runtime/supervise/authoring.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L162)

True when the supervisor authored a stub instead of a real profile.

##### reasons

> `readonly` **reasons**: `string`[]

Defined in: [src/runtime/supervise/authoring.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L164)

The specific reasons it is thin (empty when rich) — used in the finding's action.

***

### ReservationTicket

Defined in: [src/runtime/supervise/budget.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L30)

Opaque, single-use reservation handle returned by `reserve` and consumed by
 `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup.

#### Properties

##### id

> `readonly` **id**: `number`

Defined in: [src/runtime/supervise/budget.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L31)

##### reserved

> `readonly` **reserved**: `object`

Defined in: [src/runtime/supervise/budget.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L32)

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

###### iterations

> `readonly` **iterations**: `number`

***

### BudgetPool

Defined in: [src/runtime/supervise/budget.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L52)

#### Methods

##### reserve()

> **reserve**(`b`): \{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

Defined in: [src/runtime/supervise/budget.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L58)

Atomically reserve a child's full ceiling from the free balance. Fails closed
({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
caller inspects `ok` before `ticket`.

###### Parameters

###### b

[`Budget`](#budget-12)

###### Returns

\{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

##### reconcile()

> **reconcile**(`ticket`, `spent`): `void`

Defined in: [src/runtime/supervise/budget.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L66)

Release a reservation: commit the actual `spent`, refund the unspent remainder
to the free pool. Throws on an unknown or already-reconciled ticket (fail loud —
a double refund would silently break conservation).

###### Parameters

###### ticket

[`ReservationTicket`](#reservationticket)

###### spent

[`Spend`](#spend)

###### Returns

`void`

##### spendFrom()

> **spendFrom**(`events`): `Promise`\<[`Spend`](#spend)\>

Defined in: [src/runtime/supervise/budget.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L70)

Fold a normalized `UsageEvent` stream (or array) into a `Spend`. Tokens via
 `addTokenUsage`, usd on its own channel, iterations from `'iteration'` events.
 `ms` is left zero — wall-clock duration is the caller's to record, not the pool's.

###### Parameters

###### events

`AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| [`UsageEvent`](#usageevent)[]

###### Returns

`Promise`\<[`Spend`](#spend)\>

##### readout()

> **readout**(): [`BudgetReadout`](#budgetreadout)

Defined in: [src/runtime/supervise/budget.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L72)

The current readout, reflecting all outstanding reservations.

###### Returns

[`BudgetReadout`](#budgetreadout)

##### observe()

> **observe**(`spend`): `void`

Defined in: [src/runtime/supervise/budget.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L83)

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

[`Spend`](#spend)

###### Returns

`void`

##### assertNoOpenTickets()

> **assertNoOpenTickets**(): `void`

Defined in: [src/runtime/supervise/budget.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L87)

Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
 supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
 reservation would silently break `total ≡ free + reserved + committed`).

###### Returns

`void`

***

### DeliverableSpec

Defined in: [src/runtime/supervise/completion-gate.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L32)

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

Defined in: [src/runtime/supervise/completion-gate.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L34)

The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`.

###### Parameters

###### out

`Out`

###### Returns

`boolean` \| `Promise`\<`boolean`\>

##### describe?

> `optional` **describe?**: `string`

Defined in: [src/runtime/supervise/completion-gate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L36)

What the spawn was supposed to produce — surfaced in traces/reports.

***

### DriverAgentOptions

Defined in: [src/runtime/supervise/coordination-driver.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L47)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [src/runtime/supervise/coordination-driver.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L48)

##### brain

> `readonly` **brain**: [`ToolLoopChat`](#toolloopchat)

Defined in: [src/runtime/supervise/coordination-driver.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L52)

The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
 (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
 production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/supervise/coordination-driver.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L54)

Shared blob store — `observe_agent` reads settled outputs through it.

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: [src/runtime/supervise/coordination-driver.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L56)

Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/coordination-driver.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L58)

Per-child budget reserved from the conserved pool on each spawn.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [src/runtime/supervise/coordination-driver.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L61)

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: [src/runtime/supervise/coordination-driver.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L64)

The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
 Unset → no analyst feed (status quo: the driver gets settled outputs, no findings).

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [src/runtime/supervise/coordination-driver.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L68)

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
 `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
 loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`.

##### systemPrompt

> `readonly` **systemPrompt**: `string` \| ((`task`) => `string`)

Defined in: [src/runtime/supervise/coordination-driver.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L71)

The driver's stance — a string, or built from the task (the worker-driver prompt /
 the generator). INJECTED so the prompt is a pluggable, optimizable role.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [src/runtime/supervise/coordination-driver.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L76)

WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
 not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
 Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
 `executeExtraTool`. Unset → coordination-only (the prior behavior).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [src/runtime/supervise/coordination-driver.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L83)

Runs an `extraTools` call. Returns a string result, or null/undefined to signal "not handled"
 so the call falls through to the coordination dispatch. Required iff `extraTools` is set.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [src/runtime/supervise/coordination-driver.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L91)

Max driver turns before the loop force-finalizes on the best settled child. Default 16.
 `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
 an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
 anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [src/runtime/supervise/coordination-driver.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L94)

Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
 deterministic in tests. Defaults to `Date.now`.

###### Returns

`number`

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: [src/runtime/supervise/coordination-driver.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L103)

Give the driver brain a chapter-lifecycle on its OWN context window. The LLM-brain front doors
 lose to a dumb-Ralph respawn because the brain re-bills its whole coordination transcript every
 turn — the same context overflow a single steered agent suffers, one level up. With this set,
 once the brain's running conversation exceeds `thresholdTokens` it distills the accumulated
 history to a compact progress note and continues fresh: the supervisor analog of respawning
 against external tracking state, except the live `Scope` roster IS the durable state. Default
 off (no behavior change). `distill` defaults to a self-summary authored by the brain combined
 with the factual settled-worker roster; override to supply your own.

***

### CoordinationMcpHandle

Defined in: [src/runtime/supervise/coordination-mcp.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L34)

#### Properties

##### url

> `readonly` **url**: `string`

Defined in: [src/runtime/supervise/coordination-mcp.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L36)

The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`.

##### port

> `readonly` **port**: `number`

Defined in: [src/runtime/supervise/coordination-mcp.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L37)

##### drainResolved

> **drainResolved**: () => `Promise`\<`number`\>

Defined in: [src/runtime/supervise/coordination-mcp.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L42)

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

> **history**: () => readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](#coordinationevent)\>[]

Defined in: [src/runtime/supervise/coordination-mcp.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L45)

The full ordered bus-event log — observability audit + replay trail.

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](#coordinationevent)\>[]

##### stats

> **stats**: () => [`BusStats`](#busstats)

Defined in: [src/runtime/supervise/coordination-mcp.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L47)

Bus throughput counters for live dashboards.

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](#busstats)

##### raiseFinding

> **raiseFinding**: (`finding`) => `Promise`\<`void`\>

Defined in: [src/runtime/supervise/coordination-mcp.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L49)

Raise a `finding` on the bus from an online detector watching a worker's live pipe.

Raise a `finding` on the bus from outside the settle hook — the seam an ONLINE detector
 (mid-run, on the worker pipe) uses to tell the driver "this worker is looping/erroring" the
 moment it happens, instead of only at settle. Queued for `await_event` + pass-through.

###### Parameters

###### finding

`AnalystFindingEvent`

###### Returns

`Promise`\<`void`\>

#### Methods

##### settled()

> **settled**(): readonly `object`[]

Defined in: [src/runtime/supervise/coordination-mcp.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L39)

The coordination tools' settled-worker ledger (for the driver's finalize).

###### Returns

readonly `object`[]

##### isStopped()

> **isStopped**(): `boolean`

Defined in: [src/runtime/supervise/coordination-mcp.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L43)

###### Returns

`boolean`

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: [src/runtime/supervise/coordination-mcp.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L50)

###### Returns

`Promise`\<`void`\>

***

### DelegateOptions

Defined in: [src/runtime/supervise/delegate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L39)

Inputs to [delegate](#delegate). The intent is the first positional arg; everything here is optional
 with sensible defaults, so the common call is `delegate(intent, { backend, router })`.

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`Out`\>

Defined in: [src/runtime/supervise/delegate.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L43)

The completion oracle (settled ⟺ delivered) the authored workers settle against. Strongly
 recommended — without it the supervisor trusts a worker's self-report. For a code intent,
 `patchDelivered()` is the canonical example; for a free-form answer, a content check.

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

Defined in: [src/runtime/supervise/delegate.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L47)

WHERE the authored workers run — the worker-execution backend (`router-tools` / `sandbox` /
 `cli-worktree` / …). The supervisor authors the worker PROFILE; this is the substrate it runs
 on. Provide this OR `makeWorkerAgent`-style wiring through `supervise()` is unavailable.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/delegate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L49)

The conserved compute pool for the whole delegation. Defaults to [defaultDelegateBudget](#defaultdelegatebudget).

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/runtime/supervise/delegate.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L52)

The model the supervisor BRAIN runs on (the router model). The brain must tool-call
 (`spawn_agent` / `await_event`), so a delegator model, not a hidden-reasoning model.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [src/runtime/supervise/delegate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L56)

The supervisor brain's router substrate. REQUIRED for the default router-brained supervisor
 (the brain is resolved from this), unless a test injects `brain` directly. `model` overrides
 `router.model`. (Design delta vs the bare `supervise()` profile: the brain needs a router.)

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: [src/runtime/supervise/delegate.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L58)

Inject the supervisor brain directly (tests / advanced) instead of resolving it from `router`.

##### supervisor?

> `readonly` `optional` **supervisor?**: `Partial`\<`Pick`\<[`SupervisorProfile`](#supervisorprofile), `"name"` \| `"systemPrompt"`\>\>

Defined in: [src/runtime/supervise/delegate.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L61)

Override the default authoring-supervisor profile (name / extra system-prompt stance). The
 default already carries the authoring skill; override only to add a goal or rename.

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Defined in: [src/runtime/supervise/delegate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L63)

Restrict the run to this subset of models (forwarded to `supervise()`).

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/runtime/supervise/delegate.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L64)

***

### WatchTraceOptions

Defined in: [src/runtime/supervise/detector-monitor.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L23)

#### Properties

##### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

Defined in: [src/runtime/supervise/detector-monitor.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L25)

The detectors to run online. Defaults to a stuck-loop + error-streak panel.

##### onSignal?

> `readonly` `optional` **onSignal?**: (`signal`, `span`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/supervise/detector-monitor.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L27)

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

Defined in: [src/runtime/supervise/dispatch.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L48)

One unit of queued work: the agent to run, its task, and the spawn options (budget + label).
 `nextUnit` mints these lazily so a queue can be generated, re-ordered, or grown while the
 dispatcher runs.

#### Type Parameters

##### Out

`Out`

#### Properties

##### agent

> `readonly` **agent**: [`Agent`](#agent-1)\<`unknown`, `Out`\>

Defined in: [src/runtime/supervise/dispatch.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L49)

##### task

> `readonly` **task**: `unknown`

Defined in: [src/runtime/supervise/dispatch.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L50)

##### opts

> `readonly` **opts**: [`SpawnOpts`](#spawnopts)

Defined in: [src/runtime/supervise/dispatch.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L51)

***

### RollingDispatchOptions

Defined in: [src/runtime/supervise/dispatch.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L59)

#### Type Parameters

##### Out

`Out`

#### Properties

##### width

> `readonly` **width**: `number`

Defined in: [src/runtime/supervise/dispatch.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L66)

How many children to hold in flight. Must be a positive integer. This is a SIMULTANEITY fence
only — the conserved pool still bounds total work, and a `width` larger than the pool can
afford simply hits `not-admitted` sooner. Derive it with `effectiveConcurrency` when the host
also runs a fleet-level box governor.

#### Methods

##### nextUnit()

> **nextUnit**(): [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

Defined in: [src/runtime/supervise/dispatch.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L72)

Produce the next unit of work, or `undefined` when the queue is dry. Called only when a slot
is free, so a caller may compute the next unit from what has already settled (the point of a
refilling dispatcher: the queue is allowed to react). Never called after a stop.

###### Returns

[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

##### onSettled()?

> `optional` **onSettled**(`settled`): `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/supervise/dispatch.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L77)

Called once per settlement, in cursor order, BEFORE the freed slot is refilled — so an
`onSettled` that appends to the caller's queue is visible to the very next `nextUnit`.

###### Parameters

###### settled

[`Settled`](#settled-3)\<`Out`\>

###### Returns

`void` \| `Promise`\<`void`\>

##### shouldStop()?

> `optional` **shouldStop**(): `boolean`

Defined in: [src/runtime/supervise/dispatch.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L82)

Consulted before each admission. `true` stops admitting; the already-live children are still
drained to completion (no orphan, no lost settlement). Use it for a progress/plateau rule.

###### Returns

`boolean`

***

### DispatchReport

Defined in: [src/runtime/supervise/dispatch.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L85)

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](#settled-3)\<`Out`\>[]

Defined in: [src/runtime/supervise/dispatch.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L87)

Every settlement, in the order `scope.next()` yielded them.

##### admitted

> `readonly` **admitted**: `number`

Defined in: [src/runtime/supervise/dispatch.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L89)

How many children this dispatcher admitted.

##### rejected

> `readonly` **rejected**: readonly `string`[]

Defined in: [src/runtime/supervise/dispatch.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L91)

Admission rejections, in order — `label: reason`. Non-empty ⇒ the pool or depth fenced.

##### stopReason

> `readonly` **stopReason**: [`DispatchStopReason`](#dispatchstopreason)

Defined in: [src/runtime/supervise/dispatch.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L92)

##### peakLive

> `readonly` **peakLive**: `number`

Defined in: [src/runtime/supervise/dispatch.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L95)

The highest simultaneous live count actually reached — the number to compare against
 `width` when asking "did the slots really stay full?"

***

### ConcurrencyCaps

Defined in: [src/runtime/supervise/dispatch.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L188)

The caps a host can set on simultaneous work. See the ledger in this module's header for what
 each one actually bounds.

#### Properties

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [src/runtime/supervise/dispatch.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L190)

Supervisor level: max spawned-but-unsettled workers.

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

Defined in: [src/runtime/supervise/dispatch.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L193)

Fleet level: max live sandboxes/boxes across the host process (a `ComputeGovernor`-style
 cap). Applies to the worker layer, so it participates in the minimum.

***

### BusEvent

Defined in: [src/runtime/supervise/event-bus.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L27)

Every bus event is a discriminated union member keyed by `type`.

#### Properties

##### type

> `readonly` **type**: `string`

Defined in: [src/runtime/supervise/event-bus.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L28)

***

### BusRecord

Defined in: [src/runtime/supervise/event-bus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L33)

A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms).

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Properties

##### seq

> `readonly` **seq**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L34)

##### at

> `readonly` **at**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L35)

##### priority

> `readonly` **priority**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L36)

##### event

> `readonly` **event**: `E`

Defined in: [src/runtime/supervise/event-bus.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L37)

***

### PublishOptions

Defined in: [src/runtime/supervise/event-bus.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L40)

#### Properties

##### priority?

> `readonly` `optional` **priority?**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L43)

Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
 this so it bumps to the front of the driver's inbox.

##### queue?

> `readonly` `optional` **queue?**: `boolean`

Defined in: [src/runtime/supervise/event-bus.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L47)

Whether the event enters the pull queue (default true). Set `false` for record-only events —
 the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
 `subscribe` observers, but the parent must never `pull` its own outbound message back.

***

### BusStats

Defined in: [src/runtime/supervise/event-bus.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L50)

#### Properties

##### published

> `readonly` **published**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L51)

##### pulled

> `readonly` **pulled**: `number`

Defined in: [src/runtime/supervise/event-bus.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L52)

##### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [src/runtime/supervise/event-bus.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L54)

Count published per event `type`.

***

### EventBus

Defined in: [src/runtime/supervise/event-bus.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L57)

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Methods

##### publish()

> **publish**(`event`, `opts?`): `Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

Defined in: [src/runtime/supervise/event-bus.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L60)

Stamp + queue the event, then deliver the stamped record to every subscriber in order.
 Returns the stamped record.

###### Parameters

###### event

`E`

###### opts?

[`PublishOptions`](#publishoptions)

###### Returns

`Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

##### pull()

> **pull**(`kinds?`): `E` \| `undefined`

Defined in: [src/runtime/supervise/event-bus.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L63)

Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
 ties broken FIFO by `seq`; `undefined` when nothing matches.

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`E` \| `undefined`

##### subscribe()

> **subscribe**(`handler`): () => `void`

Defined in: [src/runtime/supervise/event-bus.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L66)

Register a pass-through handler; it receives the stamped record of every event published after
 registration. Returns an unsubscribe fn.

###### Parameters

###### handler

(`record`) => `void` \| `Promise`\<`void`\>

###### Returns

() => `void`

##### pending()

> **pending**(`kinds?`): `number`

Defined in: [src/runtime/supervise/event-bus.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L68)

Count of queued, not-yet-pulled events (filtered by `kinds` when given).

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`number`

##### history()

> **history**(): readonly [`BusRecord`](#busrecord)\<`E`\>[]

Defined in: [src/runtime/supervise/event-bus.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L70)

The full ordered log of every event ever published (the audit/replay trail).

###### Returns

readonly [`BusRecord`](#busrecord)\<`E`\>[]

##### stats()

> **stats**(): [`BusStats`](#busstats)

Defined in: [src/runtime/supervise/event-bus.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L72)

Throughput counters for observability dashboards.

###### Returns

[`BusStats`](#busstats)

***

### InboxMessage

Defined in: [src/runtime/supervise/inbox.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L19)

**`Experimental`**

The worker-side receive end of the down-leg: a per-worker inbox an executor exposes as
`Executor.deliver`. The driver's `steer_agent` / `answer_question` land here,
and the worker's agent loop drains them at two points (Drew's two delivery modes):

  - QUEUED (default): the message accumulates and is FLUSHED at the next step boundary — folded
    into the conversation before the next think. A worker is also forced to flush BEFORE it may
    settle, so it can never finish while a steer/answer it never read is still pending.
  - FORCEFUL (`interrupt: true`): trips `freshInterrupt()`'s signal so the loop can abort its
    in-flight turn immediately, then re-plan with the message folded in — breaking the worker out
    of a wrong path mid-task instead of waiting for it to finish the step.

`deliver` never throws — a malformed message is ignored, per the `Executor.deliver` contract.

#### Properties

##### kind

> `readonly` **kind**: `"steer"` \| `"answer"`

Defined in: [src/runtime/supervise/inbox.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L20)

**`Experimental`**

##### text

> `readonly` **text**: `string`

Defined in: [src/runtime/supervise/inbox.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L21)

**`Experimental`**

##### interrupt

> `readonly` **interrupt**: `boolean`

Defined in: [src/runtime/supervise/inbox.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L23)

**`Experimental`**

Forceful messages abort the in-flight turn; queued ones wait for the boundary flush.

##### questionId?

> `readonly` `optional` **questionId?**: `string`

Defined in: [src/runtime/supervise/inbox.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L25)

**`Experimental`**

Present for an `answer` — the question id it resolves.

***

### Inbox

Defined in: [src/runtime/supervise/inbox.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L28)

#### Methods

##### deliver()

> **deliver**(`msg`): `void`

Defined in: [src/runtime/supervise/inbox.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L30)

The `Executor.deliver` implementation — accept a raw down-message from `Scope.send`.

###### Parameters

###### msg

`unknown`

###### Returns

`void`

##### drain()

> **drain**(): [`InboxMessage`](#inboxmessage)[]

Defined in: [src/runtime/supervise/inbox.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L32)

Remove and return all pending messages (the flush).

###### Returns

[`InboxMessage`](#inboxmessage)[]

##### pending()

> **pending**(): `number`

Defined in: [src/runtime/supervise/inbox.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L33)

###### Returns

`number`

##### freshInterrupt()

> **freshInterrupt**(): `AbortSignal`

Defined in: [src/runtime/supervise/inbox.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L36)

Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
 this into the signal it passes to its inference call, then re-plans when it fires.

###### Returns

`AbortSignal`

##### fold()

> **fold**(`messages`): `string`

Defined in: [src/runtime/supervise/inbox.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L38)

Render drained messages as ONE operator turn to fold into the worker's conversation.

###### Parameters

###### messages

readonly [`InboxMessage`](#inboxmessage)[]

###### Returns

`string`

***

### PatchDeliverableOptions

Defined in: [src/runtime/supervise/patch-deliverable.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L28)

**`Experimental`**

#### Extends

- `CoderCheckConstraints`

#### Extended by

- [`WorktreeFanoutOptions`](#worktreefanoutoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [src/runtime/supervise/patch-checks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L39)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

`CoderCheckConstraints.maxDiffLines`

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [src/runtime/supervise/patch-checks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L41)

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

`CoderCheckConstraints.forbiddenPaths`

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [src/runtime/supervise/patch-deliverable.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L35)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

***

### InMemoryRunContextOptions

Defined in: [src/runtime/supervise/run-context.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L38)

Options for a supervised run context.

#### Properties

##### withDriver?

> `readonly` `optional` **withDriver?**: `boolean`

Defined in: [src/runtime/supervise/run-context.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L45)

Wrap the executor registry with `withDriverExecutor` so a spawned child marked
`role: 'driver'` resolves to the recursive driver-executor (agents driving agents
over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
leaf workers. Default `false`.

***

### InMemoryRunContext

Defined in: [src/runtime/supervise/run-context.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L52)

The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.

#### Properties

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Defined in: [src/runtime/supervise/run-context.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L53)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/supervise/run-context.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L54)

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](#executorregistry)

Defined in: [src/runtime/supervise/run-context.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L55)

##### resume?

> `readonly` `optional` **resume?**: `boolean`

Defined in: [src/runtime/supervise/run-context.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L61)

Present (and `true`) only on a DURABLE context (`createFileRunContext`), so spreading the
context into `SupervisorOpts` also opts the run into resume-first. An in-memory context
leaves it undefined: there is never a prior tree to resume, and the default stays fresh-run.

***

### ProviderSeam

Defined in: [src/runtime/supervise/runtime.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L201)

Generic environment provider executor config. External packages implement
 `AgentEnvironmentProvider`; this built-in wrapper lets `createExecutor`
 consume them as backend data while preserving the existing usage channel.

#### Extends

- [`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions)

#### Properties

##### defaults?

> `optional` **defaults?**: `Partial`\<`CreateAgentEnvironmentInput`\>

Defined in: [src/runtime/environment-provider.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L269)

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`defaults`](runtime/environment-provider.md#defaults-1)

##### runtime?

> `optional` **runtime?**: [`Runtime`](#runtime-3)

Defined in: [src/runtime/environment-provider.ts:270](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L270)

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`runtime`](runtime/environment-provider.md#runtime)

##### destroyOnSettle?

> `optional` **destroyOnSettle?**: `boolean`

Defined in: [src/runtime/environment-provider.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L271)

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`destroyOnSettle`](runtime/environment-provider.md#destroyonsettle)

##### requireTerminalEvent?

> `optional` **requireTerminalEvent?**: `boolean`

Defined in: [src/runtime/environment-provider.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L272)

**`Experimental`**

###### Inherited from

[`ProviderExecutorOptions`](runtime/environment-provider.md#providerexecutoroptions).[`requireTerminalEvent`](runtime/environment-provider.md#requireterminalevent-1)

##### taskToTurn?

> `optional` **taskToTurn?**: (`task`, `specProfile`) => `AgentTurnInput`

Defined in: [src/runtime/environment-provider.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/environment-provider.ts#L273)

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

Defined in: [src/runtime/supervise/runtime.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L202)

##### registry?

> `optional` **registry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: [src/runtime/supervise/runtime.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L203)

***

### SuperviseOptions

Defined in: [src/runtime/supervise/supervise.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L53)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/supervise.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L55)

The conserved compute pool for the whole run.

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

Defined in: [src/runtime/supervise/supervise.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L57)

WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Defined in: [src/runtime/supervise/supervise.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L61)

The completion oracle for backend-derived workers (settled ⟺ delivered). Strongly recommended:
 without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
 failure mode of a static orchestrator.

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: [src/runtime/supervise/supervise.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L63)

Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [src/runtime/supervise/supervise.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L65)

The supervisor's router substrate (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: [src/runtime/supervise/supervise.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L67)

Inject the supervisor brain directly (tests / advanced).

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: [src/runtime/supervise/supervise.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L69)

Run a sandboxed-harness supervisor (`harness` set).

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [src/runtime/supervise/supervise.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L73)

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`harness` null).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [src/runtime/supervise/supervise.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L79)

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/supervise.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L84)

Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [src/runtime/supervise/supervise.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L88)

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight. The conserved pool bounds TOTAL work; this bounds SIMULTANEOUS work (live boxes/
 sandboxes a real fleet runs at once). Omit/`<= 0` = no cap (the pool stays the only fence).

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: [src/runtime/supervise/supervise.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L91)

Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
 (the driver receives settled worker outputs, no analyst findings).

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [src/runtime/supervise/supervise.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L96)

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
 the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
 threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
 Omit/empty = status quo (no analyst feed). Requires `analysts`.

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/supervise/supervise.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L98)

Worker output store. Defaults to in-memory.

##### runDir?

> `readonly` `optional` **runDir?**: `string`

Defined in: [src/runtime/supervise/supervise.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L109)

Make the run DURABLE and RESUMABLE: journal + result blobs are file-backed under this
directory (`createFileRunContext`), and the supervisor reads the prior tree first. Re-running
`supervise()` with the same `runDir` AND the same `runId` resumes — the children that already
settled come back on `Scope.resume` instead of being re-executed. Unset = in-memory, fresh
every call (the default every existing caller gets).

`runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
resumable run per directory but collides across concurrent runs sharing one `runDir`.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

Defined in: [src/runtime/supervise/supervise.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L112)

Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
 with `blobs` — a journal whose result payloads live in a different store cannot replay.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [src/runtime/supervise/supervise.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L113)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [src/runtime/supervise/supervise.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L114)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: [src/runtime/supervise/supervise.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L120)

Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only): once
 its coordination transcript exceeds `thresholdTokens` it distills to a compact progress note and
 continues, instead of re-billing the whole transcript every turn (the cost that makes the LLM-brain
 front door lose to a dumb-Ralph respawn). The live `Scope` roster is the durable state across
 chapters. Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [src/runtime/supervise/supervise.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L121)

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [src/runtime/supervise/supervise.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L122)

###### Returns

`number`

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Defined in: [src/runtime/supervise/supervise.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L126)

Restrict the run to this subset of models. When set, every configured model — the
 supervisor router model, the profile's model, and the backend's model — must be a member,
 or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.

***

### SupervisorProfile

Defined in: [src/runtime/supervise/supervisor-agent.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L48)

The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain.
 `harness` is the backend-as-data discriminant; `systemPrompt` is the standing instruction.

#### Properties

##### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/runtime/supervise/supervisor-agent.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L49)

##### harness?

> `readonly` `optional` **harness?**: `string` \| `null`

Defined in: [src/runtime/supervise/supervisor-agent.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L51)

null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain.

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: [src/runtime/supervise/supervisor-agent.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L53)

The router model when the brain is router-driven (falls back to the deps router config).

##### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [src/runtime/supervise/supervisor-agent.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L55)

The standing instructions ("you delegate, you do not solve").

***

### SupervisorAgentDeps

Defined in: [src/runtime/supervise/supervisor-agent.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L69)

#### Properties

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/supervise/supervisor-agent.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L70)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: [src/runtime/supervise/supervisor-agent.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L72)

Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/supervisor-agent.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L74)

Per-child budget reserved from the conserved pool on each spawn.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: [src/runtime/supervise/supervisor-agent.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L78)

Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
 this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
 boxes/sandboxes, not total work). Omit/`<= 0` = no cap.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [src/runtime/supervise/supervisor-agent.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L80)

Router substrate for a router-brained supervisor (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: [src/runtime/supervise/supervisor-agent.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L82)

Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile.

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: [src/runtime/supervise/supervisor-agent.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L84)

Required for a sandboxed-harness supervisor (`harness` set): runs the harness as the driver.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [src/runtime/supervise/supervisor-agent.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L87)

WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
 only delegate when it needs parallelism. Pair with `executeExtraTool`.

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [src/runtime/supervise/supervisor-agent.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L93)

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: [src/runtime/supervise/supervisor-agent.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L98)

Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`.

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: [src/runtime/supervise/supervisor-agent.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L101)

Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
 (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`.

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [src/runtime/supervise/supervisor-agent.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L102)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: [src/runtime/supervise/supervisor-agent.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L106)

Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only) — it
 distills its coordination transcript to a compact progress note once it exceeds the threshold,
 instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`.

***

### TraceSource

Defined in: [src/runtime/supervise/trace-source.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L38)

#### Methods

##### onSpan()

> **onSpan**(`handler`): () => `void`

Defined in: [src/runtime/supervise/trace-source.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L41)

Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
 only exposes its trace at the end registers nothing and returns a no-op.

###### Parameters

###### handler

(`span`) => `void`

###### Returns

() => `void`

##### collect()

> **collect**(): `Promise`\<`ToolSpan`[]\>

Defined in: [src/runtime/supervise/trace-source.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L43)

The full set of tool spans for the run (SETTLE / batch). Always available.

###### Returns

`Promise`\<`ToolSpan`[]\>

***

### SessionTraceBox

Defined in: [src/runtime/supervise/trace-source.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L279)

The minimal box surface this needs: list a session's messages (incl. mid-turn partials).

#### Methods

##### messages()

> **messages**(`opts`): `Promise`\<readonly `SessionMessageLike`[]\>

Defined in: [src/runtime/supervise/trace-source.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L280)

###### Parameters

###### opts

###### sessionId

`string`

###### Returns

`Promise`\<readonly `SessionMessageLike`[]\>

***

### TrajectoryAnalysis

Defined in: [src/runtime/supervise/trajectory-recorder.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L16)

#### Properties

##### trajectory

> `readonly` **trajectory**: `Trajectory`

Defined in: [src/runtime/supervise/trajectory-recorder.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L19)

Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
 duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations.

##### stuckLoop

> `readonly` **stuckLoop**: `StuckLoopReport`

Defined in: [src/runtime/supervise/trajectory-recorder.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L22)

Full-run repeated-call view (total occurrences + window) — allows one intervening call so it
catches a loop the online consecutive detector interleaves past.

##### toolWaste

> `readonly` **toolWaste**: `ToolWasteReport`

Defined in: [src/runtime/supervise/trajectory-recorder.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L24)

Wasted-vs-total tool-call ratio for the run.

***

### Agent

Defined in: [src/runtime/supervise/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L50)

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

Defined in: [src/runtime/supervise/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L51)

#### Methods

##### act()

> **act**(`task`, `scope`): `Promise`\<`Out`\>

Defined in: [src/runtime/supervise/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L52)

###### Parameters

###### task

`Task`

###### scope

[`Scope`](#scope-1)\<`Out`\>

###### Returns

`Promise`\<`Out`\>

***

### Executor

Defined in: [src/runtime/supervise/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L71)

The leaf runtime — ONE open interface, not a closed union. `execute` returns a
`Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
streaming ones; a streaming executor reports incremental normalized usage as it runs
(the budget pool reconciles against it) and exposes its terminal artifact via
`resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
meters every runtime identically.

Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
Router/HTTP inference call, no box), sandbox (COMPOSES `runLoop` as a leaf, forwarding
PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
(Halo/RLM subprocess; `budgetExempt`, excluded from equal-k by construction). A user's
own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.

#### Type Parameters

##### Out

`Out`

#### Properties

##### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-3)

Defined in: [src/runtime/supervise/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L73)

Stable runtime tag for traces + the equal-k exemption check.

##### budgetExempt?

> `readonly` `optional` **budgetExempt?**: `boolean`

Defined in: [src/runtime/supervise/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L79)

When true, this executor's spend is NOT metered against the conserved pool and its
iterations are excluded from the equal-k assertion (a `cli` subprocess without
token accounting). Fail-loud everywhere else: a metered executor MUST report usage.

#### Methods

##### execute()

> **execute**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](#executorresult)\<`Out`\>\>

Defined in: [src/runtime/supervise/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L85)

One-shot → resolves a `ExecutorResult`; streaming → yields incremental `UsageEvent`s and
the terminal artifact is read from `resultArtifact()` after the stream drains.
`signal` is the spawn-scoped abort (chains the acquire lifecycle for sandbox).

###### Parameters

###### task

`unknown`

###### signal

`AbortSignal`

###### Returns

`AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](#executorresult)\<`Out`\>\>

##### deliver()?

> `optional` **deliver**(`msg`): `void`

Defined in: [src/runtime/supervise/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L96)

Optional inbox: receive an out-of-band message from the driver mid-run (the `send`/`steer_agent`
verb). A streaming executor drains pending messages between turns and folds them into the next
step (a steer / interrupt / resume). A one-shot executor that can't be steered mid-flight omits
this; `Scope.send` then returns `false` for it. Never throws — a malformed message is the
executor's to ignore.

###### Parameters

###### msg

`unknown`

###### Returns

`void`

##### teardown()

> **teardown**(`grace`): `Promise`\<\{ `destroyed`: `boolean`; \}\>

Defined in: [src/runtime/supervise/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L101)

Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
(`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).

###### Parameters

###### grace

`number` \| `"brutalKill"` \| `"infinity"`

###### Returns

`Promise`\<\{ `destroyed`: `boolean`; \}\>

##### resultArtifact()

> **resultArtifact**(): `object`

Defined in: [src/runtime/supervise/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L106)

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

##### metered()?

> `optional` **metered**(): [`Spend`](#spend) \| `undefined`

Defined in: [src/runtime/supervise/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L115)

A driver-executor's OWN-inference subtree total (rolled up from its nested tree's `metered`
events) — the parent scope journals it as a `metered` event for this node on settle, on BOTH
the done AND the down/crash paths, so a crashed sub-driver's partial inference still re-homes
(the pool already debited it via `observe`; the journal must match). NOT reconciled, so it never
trips the reservation clamp. Read on settle, valid after `execute` resolves OR throws. Leaf
executors omit it (returns `undefined`).

###### Returns

[`Spend`](#spend) \| `undefined`

***

### ExecutorResult

Defined in: [src/runtime/supervise/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L119)

Terminal artifact of a one-shot `Executor.execute`.

#### Type Parameters

##### Out

`Out`

#### Properties

##### outRef

> **outRef**: `string`

Defined in: [src/runtime/supervise/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L120)

##### out

> **out**: `Out`

Defined in: [src/runtime/supervise/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L121)

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/supervise/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L122)

##### spent

> **spent**: [`Spend`](#spend)

Defined in: [src/runtime/supervise/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L123)

***

### AgentSpec

Defined in: [src/runtime/supervise/types.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L153)

`AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the
sandbox SDK's `BackendConfig`, not the portable profile. So an agent is mapped to its
executor through this MINIMAL wrapper, never by fabricating a field onto `AgentProfile`.

Resolution (in `runtime.ts`):
 - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 - `harness === null`        → router/inline: a direct Router call, no box.
 - `harness` is a `BackendType` → sandbox: compose `runLoop` against `profile` on that backend.
Fail loud on an unresolvable spec (no executor and an unknown harness).

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: [src/runtime/supervise/types.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L154)

##### harness

> `readonly` **harness**: `BackendType` \| `null`

Defined in: [src/runtime/supervise/types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L156)

`null` selects router/inline; a `BackendType` selects the sandboxed harness.

##### executor?

> `readonly` `optional` **executor?**: [`Executor`](#executor)\<`unknown`\>

Defined in: [src/runtime/supervise/types.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L158)

Bring-your-own executor: when set, overrides harness-based resolution entirely.

***

### ExecutorContext

Defined in: [src/runtime/supervise/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L171)

Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 (sandbox client for the sandbox executor, router config for router/inline) without
 the factory reaching into module globals.

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [src/runtime/supervise/types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L172)

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/runtime/supervise/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L174)

Opaque seams the registry threads through; a built-in narrows what it needs.

***

### ExecutorRegistry

Defined in: [src/runtime/supervise/types.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L183)

The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default
registry resolves the three built-ins AND accepts a BYO `executor`/factory; callers
register more runtimes by name. NOT a closed switch — registration is the extension
point, mirroring the open `Executor` interface.

#### Methods

##### register()

> **register**\<`Out`\>(`runtime`, `factory`): `void`

Defined in: [src/runtime/supervise/types.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L185)

Register a factory for a named runtime. Throws on a duplicate name (fail loud).

###### Type Parameters

###### Out

`Out`

###### Parameters

###### runtime

[`Runtime`](#runtime-3)

###### factory

[`ExecutorFactory`](#executorfactory)\<`Out`\>

###### Returns

`void`

##### resolve()

> **resolve**\<`Out`\>(`spec`): \{ `succeeded`: `true`; `value`: [`ExecutorFactory`](#executorfactory)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

Defined in: [src/runtime/supervise/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L192)

Resolve a spec to a factory. Precedence: a BYO `spec.executor` → a trivial factory
returning it; else `harness === null` → the `'router'` factory; else a registered
factory for the harness-derived runtime. Returns a typed outcome — the caller
inspects `succeeded` before `value` (no silent fallback).

###### Type Parameters

###### Out

`Out`

###### Parameters

###### spec

[`AgentSpec`](#agentspec)

###### Returns

\{ `succeeded`: `true`; `value`: [`ExecutorFactory`](#executorfactory)\<`Out`\>; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

***

### Budget

Defined in: [src/runtime/supervise/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L200)

A budget envelope on a spawn or the root. All ceilings; the pool reserves against them.

#### Properties

##### maxIterations

> `readonly` **maxIterations**: `number`

Defined in: [src/runtime/supervise/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L201)

##### maxTokens

> `readonly` **maxTokens**: `number`

Defined in: [src/runtime/supervise/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L202)

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

Defined in: [src/runtime/supervise/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L203)

##### deadlineMs?

> `readonly` `optional` **deadlineMs?**: `number`

Defined in: [src/runtime/supervise/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L204)

***

### Spend

Defined in: [src/runtime/supervise/types.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L209)

Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 are separate channels (never folded).

#### Properties

##### iterations

> **iterations**: `number`

Defined in: [src/runtime/supervise/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L210)

##### tokens

> **tokens**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [src/runtime/supervise/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L211)

##### usdKnown?

> `optional` **usdKnown?**: `boolean`

Defined in: [src/runtime/supervise/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L214)

Dollar accounting is known unless explicitly false. A false value must not be treated as $0
 when enforcing a dollar-denominated comparison or limit.

##### usd

> **usd**: `number`

Defined in: [src/runtime/supervise/types.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L215)

##### ms

> **ms**: `number`

Defined in: [src/runtime/supervise/types.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L216)

***

### SpawnOpts

Defined in: [src/runtime/supervise/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L231)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L232)

##### label

> `readonly` **label**: `string`

Defined in: [src/runtime/supervise/types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L233)

##### restart?

> `readonly` `optional` **restart?**: `Restart`

Defined in: [src/runtime/supervise/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L234)

##### shutdown?

> `readonly` `optional` **shutdown?**: `number` \| `"brutalKill"` \| `"infinity"`

Defined in: [src/runtime/supervise/types.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L236)

Teardown grace handed to the executor when this node is reaped.

***

### Scope

Defined in: [src/runtime/supervise/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L287)

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

Defined in: [src/runtime/supervise/types.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L321)

This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
 is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
 it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
 scope carries its own signal, chained off its driver child's abort.

##### resume?

> `readonly` `optional` **resume?**: [`ResumedWork`](#resumedwork)\<`Out`\>

Defined in: [src/runtime/supervise/types.ts:343](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L343)

Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
first; when a non-empty tree exists it rehydrates the already-settled children (via
`replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
maxima, so any NEW spawn appends without colliding with a journaled event.

##### view

> `readonly` **view**: [`TreeView`](#treeview)

Defined in: [src/runtime/supervise/types.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L345)

The live tree — reads the in-memory nursery, not the journal.

##### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [src/runtime/supervise/types.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L347)

Conserved-pool readouts (post-reservation).

#### Methods

##### spawn()

> **spawn**\<`C`\>(`agent`, `task`, `opts`): \{ `ok`: `true`; `handle`: `Handle`\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

Defined in: [src/runtime/supervise/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L293)

Spawn a child. Reserves `opts.budget` from the conserved pool atomically; refunds the
unspent remainder on settle. Returns a typed outcome — fail-closed on an exhausted
pool or an exceeded depth ceiling (the caller inspects `ok` before `handle`).

###### Type Parameters

###### C

`C`

###### Parameters

###### agent

[`Agent`](#agent-1)\<`unknown`, `C`\>

###### task

`unknown`

###### opts

[`SpawnOpts`](#spawnopts)

###### Returns

\{ `ok`: `true`; `handle`: `Handle`\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

##### next()

> **next**(): `Promise`\<[`Settled`](#settled-3)\<`Out`\> \| `null`\>

Defined in: [src/runtime/supervise/types.ts:300](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L300)

ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
 `null` when the live set is empty.

###### Returns

`Promise`\<[`Settled`](#settled-3)\<`Out`\> \| `null`\>

##### nextResolved()

> **nextResolved**(): `Promise`\<[`Settled`](#settled-3)\<`Out`\> \| `null`\>

Defined in: [src/runtime/supervise/types.ts:307](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L307)

Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
when none is ready — never awaits a live child. The driver's post-loop drain reads this so
a child that settled while the driver was busy (or after it stopped pulling) still reaches
the finalize ledger instead of being silently lost.

###### Returns

`Promise`\<[`Settled`](#settled-3)\<`Out`\> \| `null`\>

##### send()

> **send**(`nodeId`, `msg`): `boolean`

Defined in: [src/runtime/supervise/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L316)

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

##### meter()

> **meter**(`spend`, `detail?`): `Promise`\<`void`\>

Defined in: [src/runtime/supervise/types.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L333)

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

### ResumedWork

Defined in: [src/runtime/supervise/types.ts:362](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L362)

The committed work a resumed run inherits from its journal. `settled` is the replayed
`Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
is the tree as `materializeTreeView` folded it at the recorded cursor position. A
resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](#settled-3)\<`Out`\>[]

Defined in: [src/runtime/supervise/types.ts:363](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L363)

##### view

> `readonly` **view**: [`TreeView`](#treeview)

Defined in: [src/runtime/supervise/types.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L364)

***

### TreeView

Defined in: [src/runtime/supervise/types.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L383)

The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: [src/runtime/supervise/types.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L384)

##### nodes

> `readonly` **nodes**: readonly `NodeSnapshot`[]

Defined in: [src/runtime/supervise/types.ts:385](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L385)

##### inFlight

> `readonly` **inFlight**: `number`

Defined in: [src/runtime/supervise/types.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L387)

Count of nodes in `running` or `acquiring` — the "what's in flow?" answer.

***

### SpawnJournal

Defined in: [src/runtime/supervise/types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L438)

The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
`loadTree` returns events for inspection and completed-settlement replay, not live process
recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

Defined in: [src/runtime/supervise/types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L439)

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [src/runtime/supervise/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L440)

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

Defined in: [src/runtime/supervise/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L441)

###### Parameters

###### root

`string`

###### ev

[`SpawnEvent`](#spawnevent)

###### Returns

`Promise`\<`void`\>

***

### ResultBlobStore

Defined in: [src/runtime/supervise/types.ts:447](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L447)

Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 invariant. Split from the journal so the journal stays small (decisions) and the
 payloads (evidence) live where a viewer/replayer rehydrates them.

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [src/runtime/supervise/types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L448)

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: [src/runtime/supervise/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L449)

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

***

### Supervisor

Defined in: [src/runtime/supervise/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L459)

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

Defined in: [src/runtime/supervise/types.ts:460](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L460)

###### Parameters

###### root

[`Agent`](#agent-1)\<`Task`, `Out`\>

###### task

`Task`

###### opts

[`SupervisorOpts`](#supervisoropts)

###### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

##### attach()

> **attach**(`h`): `void`

Defined in: [src/runtime/supervise/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L461)

###### Parameters

###### h

`RootHandle`\<`Out`\>

###### Returns

`void`

***

### SupervisorOpts

Defined in: [src/runtime/supervise/types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L464)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/types.ts:466](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L466)

The root conserved-pool ceiling (tokens + usd + iterations + deadline).

##### runId

> `readonly` **runId**: `string`

Defined in: [src/runtime/supervise/types.ts:468](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L468)

Trace-correlation root + the journal/blob root key.

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Defined in: [src/runtime/supervise/types.ts:470](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L470)

Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [src/runtime/supervise/types.ts:472](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L472)

Result payload store backing `outRef` rehydration.

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](#executorregistry)

Defined in: [src/runtime/supervise/types.ts:474](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L474)

Executor resolution — the open registry mapping `AgentSpec` → `Executor`.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [src/runtime/supervise/types.ts:476](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L476)

Runtime recursion-depth ceiling (paired with the conserved pool per R3).

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [src/runtime/supervise/types.ts:481](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L481)

OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
trips the supervisor to `no-winner` rather than restarting forever.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [src/runtime/supervise/types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L482)

##### resume?

> `readonly` `optional` **resume?**: `boolean`

Defined in: [src/runtime/supervise/types.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L493)

Opt into RESUME-FIRST: read any prior journal tree for this `runId` BEFORE beginning a fresh
one, and when a non-empty tree exists rehydrate its committed work onto `Scope.resume`
(`replaySpawnTree` + `materializeTreeView`) instead of starting over. Requires a journal +
blob store that OUTLIVE the process (`createFileRunContext(dir)`); against the in-memory
stores there is never a prior tree, so it is a no-op.

Default `false` — a run always begins a fresh tree, which is the behavior every existing
consumer has. Resume is a durability contract the caller opts into, never a silent default.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [src/runtime/supervise/types.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L494)

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/supervise/types.ts:495](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L495)

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/supervise/types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L498)

Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
 same `agent.spawn`/`agent.child` stream `runLoop` feeds — one observable recursive tree.

***

### WidenGate

Defined in: [src/runtime/supervise/types.ts:554](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L554)

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

Defined in: [src/runtime/supervise/types.ts:559](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L559)

When true, widening may read `verdict` directly (collides with the steer firewall —
 must be explicitly argued per cell, never defaulted on).

#### Methods

##### shouldWiden()

> **shouldWiden**(`settled`, `budget`): `boolean`

Defined in: [src/runtime/supervise/types.ts:556](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L556)

Default impl returns false for every settlement (flat — never widens).

###### Parameters

###### settled

[`Settled`](#settled-3)\<`Out`\>

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

`boolean`

***

### WorktreeCliExecutorOptions

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L45)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L47)

**`Experimental`**

Absolute path to the git checkout the worktree is cut from.

##### profile

> **profile**: `AgentProfile`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L55)

**`Experimental`**

The supervisor-authored prompt/model plus materializable structural resources.
`model.default` selects the one-shot model; `small`, `provider`, and `metadata` remain hints.
Resource failures are fatal regardless of `resources.failOnError`.
Tools, permissions, connections, confidential execution, modes, and extensions fail closed.
Harness-specific nested controls that the pinned materializer cannot preserve also fail closed.

##### harness

> **harness**: [`LocalHarness`](mcp.md#localharness)

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L57)

**`Experimental`**

Local CLI for this leaf. This explicit choice overrides `profile.harness`.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L59)

**`Experimental`**

The per-task instruction handed to the harness (composed under the system prompt).

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L61)

**`Experimental`**

Unique id for the worktree path + branch. Defaults to a fresh UUID.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L63)

**`Experimental`**

Override the base ref the worktree is cut from (default `HEAD`).

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L65)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default).

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L68)

**`Experimental`**

Run Codex with an ephemeral session, isolated config/instructions, network disabled, and
 JSONL usage capture. Requires `harness: 'codex'`; metered by default.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L71)

**`Experimental`**

Absolute host paths denied to reproducible Codex (for benchmark answer copies, credentials,
 or other task-specific ambient state).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L76)

**`Experimental`**

Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L78)

**`Experimental`**

Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`).

##### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L80)

**`Experimental`**

Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min.

##### checkOutputCap?

> `optional` **checkOutputCap?**: `number`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L82)

**`Experimental`**

Cap on each check's captured output. Default 16k.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L84)

**`Experimental`**

Test seam — inject a git runner so unit tests drive the worktree helpers without git.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L86)

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

> `optional` **runCommand?**: `WorktreeCheckRunner`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L89)

**`Experimental`**

Test seam — inject the verification-command runner so unit tests script test/typecheck
 outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree.

##### budgetExempt?

> `optional` **budgetExempt?**: `boolean`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L95)

**`Experimental`**

Exclude this leaf's spend from accounting. Defaults to `true` for ordinary CLI runs and
`false` for `codexReproducible`, which captures real token usage. A metered custom runner must
likewise return `LocalHarnessResult.usage`.

***

### AuthoredHarness

Defined in: [src/runtime/supervise/worktree-fanout.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L31)

**`Experimental`**

One authored harness profile in a worktree fanout: the §1.5 profile + which local
 harness CLI drives it. The supervisor authors `profile` per sub-task; `harness` chooses the leaf.

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L33)

**`Experimental`**

A short label for the worktree branch + trace node.

##### profile

> **profile**: `AgentProfile`

Defined in: [src/runtime/supervise/worktree-fanout.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L35)

**`Experimental`**

The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5).

##### harness

> **harness**: `"opencode"` \| `"codex"` \| `"claude"`

Defined in: [src/runtime/supervise/worktree-fanout.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L37)

**`Experimental`**

Which local harness CLI drives this leaf.

##### runId?

> `optional` **runId?**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L39)

**`Experimental`**

Per-harness model/runId/baseRef overrides flow through the profile + these.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L40)

**`Experimental`**

***

### WorktreeFanoutOptions

Defined in: [src/runtime/supervise/worktree-fanout.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L44)

**`Experimental`**

#### Extends

- [`PatchDeliverableOptions`](#patchdeliverableoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [src/runtime/supervise/patch-checks.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L39)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`maxDiffLines`](#maxdifflines)

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [src/runtime/supervise/patch-checks.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L41)

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`forbiddenPaths`](#forbiddenpaths)

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [src/runtime/supervise/patch-deliverable.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L35)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`require`](#require)

##### repoRoot

> **repoRoot**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L46)

**`Experimental`**

Absolute path to the git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L48)

**`Experimental`**

The per-task instruction handed to every harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](#authoredharness)[]

Defined in: [src/runtime/supervise/worktree-fanout.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L50)

**`Experimental`**

The authored harness profiles — one fanout item (and one worktree-CLI leaf) each.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`WorktreeHarnessResult`\>

Defined in: [src/runtime/supervise/worktree-fanout.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L56)

**`Experimental`**

The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
`DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L58)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [src/runtime/supervise/worktree-fanout.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L60)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [src/runtime/supervise/worktree-fanout.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L62)

**`Experimental`**

Wall-clock cap per harness subprocess (ms).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](#winnerstrategy)

Defined in: [src/runtime/supervise/worktree-fanout.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L64)

**`Experimental`**

Winner-selection strategy. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [src/runtime/supervise/worktree-fanout.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L67)

**`Experimental`**

Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
 whole fanout runs offline). Production callers leave these unset.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [src/runtime/supervise/worktree-fanout.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L68)

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

Defined in: [src/runtime/supervise/worktree-fanout.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L69)

**`Experimental`**

***

### ToolLoopCompaction

Defined in: [src/runtime/tool-loop.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L50)

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

Defined in: [src/runtime/tool-loop.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L52)

Compact once the estimated token count of the conversation exceeds this.

##### distill

> `readonly` **distill**: (`messages`) => `string` \| `Promise`\<`string`\>

Defined in: [src/runtime/tool-loop.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L55)

Distill the conversation into a compact progress note that REPLACES the middle. Receives the
 full conversation (so it can summarize everything done so far); returns the digest string.

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`string` \| `Promise`\<`string`\>

##### preserveHead?

> `readonly` `optional` **preserveHead?**: `number`

Defined in: [src/runtime/tool-loop.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L57)

Leading messages preserved verbatim (system + the original task). Default 2.

##### estimateTokens?

> `readonly` `optional` **estimateTokens?**: (`messages`) => `number`

Defined in: [src/runtime/tool-loop.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L59)

Token estimator over the conversation. Default ≈ chars/4 (incl. tool-call arguments).

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`number`

##### onCompact?

> `readonly` `optional` **onCompact?**: (`info`) => `void`

Defined in: [src/runtime/tool-loop.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L61)

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

Defined in: [src/runtime/types.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L33)

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

Defined in: [src/runtime/types.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L35)

**`Experimental`**

Iteration index this output came from (0-based).

##### box?

> `optional` **box?**: `SandboxInstance`

Defined in: [src/runtime/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L41)

**`Experimental`**

Live sandbox for this iteration. Validators that need execution-grounded
evidence can inspect files or run commands here instead of forcing callers
to bypass the loop kernel with raw Sandbox SDK orchestration.

##### signal

> **signal**: `AbortSignal`

Defined in: [src/runtime/types.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L43)

**`Experimental`**

Cooperative cancellation channel.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: [src/runtime/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L49)

**`Experimental`**

Optional trace emitter. When set, validator implementations that make
LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.

***

### Validator

Defined in: [src/runtime/types.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L53)

**`Experimental`**

#### Type Parameters

##### Output

`Output`

##### Verdict

`Verdict` = `DefaultVerdict`

#### Methods

##### validate()

> **validate**(`output`, `ctx`): `Promise`\<`Verdict`\>

Defined in: [src/runtime/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L54)

**`Experimental`**

###### Parameters

###### output

`Output`

###### ctx

[`ValidationCtx`](#validationctx)

###### Returns

`Promise`\<`Verdict`\>

***

### AgentRunSpec

Defined in: [src/runtime/types.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L68)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L70)

**`Experimental`**

Sandbox SDK profile — what kind of agent runs the task.

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

Defined in: [src/runtime/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L72)

**`Experimental`**

Task → prompt formatter. Pure and deterministic.

###### Parameters

###### task

`Task`

###### Returns

`string`

##### prepareBox?

> `optional` **prepareBox?**: (`box`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/types.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L86)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L94)

**`Experimental`**

Per-spec stable name. Surfaced in trace events and the default winner
selector tiebreak. Falls back to `profile.name ?? 'agent'`.

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [src/runtime/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L100)

**`Experimental`**

Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
the kernel's defaults. `backend.profile` is set to `profile` by the
kernel and cannot be overridden here — use `profile` itself for that.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

***

### OutputAdapter

Defined in: [src/runtime/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L114)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L115)

**`Experimental`**

###### Parameters

###### events

`SandboxEvent`[]

###### Returns

`Output`

***

### LoopTokenUsage

Defined in: [src/runtime/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L120)

LLM token usage. Structurally maps into agent-eval's paid-call receipt so a
campaign dispatch settles real usage instead of appearing as a stub.

#### Properties

##### input

> **input**: `number`

Defined in: [src/runtime/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L121)

##### output

> **output**: `number`

Defined in: [src/runtime/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L122)

***

### MountManifestEntry

Defined in: [src/runtime/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L136)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L138)

**`Experimental`**

Destination path inside the box where the resource was placed.

##### sha256

> **sha256**: `string`

Defined in: [src/runtime/types.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L141)

**`Experimental`**

Hex SHA-256 of the mounted bytes. The caller computes it from the bytes
 it wrote — the kernel does not hash box contents.

##### bytes

> **bytes**: `number`

Defined in: [src/runtime/types.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L143)

**`Experimental`**

Size of the mounted resource in bytes.

##### source

> **source**: `string`

Defined in: [src/runtime/types.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L146)

**`Experimental`**

Free-form origin of the resource (e.g. a repo ref, a corpus id, a local
 path, a URL). Provenance only — the kernel attaches no meaning to it.

***

### SelectionReceipt

Defined in: [src/runtime/types.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L158)

**`Experimental`**

A record of one candidate-selection decision: which iteration the selector
picked (or rejected) and why. Pure audit trail of the SELECTOR role — it
carries the selector's identity, the candidate's score, and an optional
human-readable reason, with no domain semantics. The kernel emits one receipt
per scored candidate at finalize so a run answers "why did THIS one win?".

#### Properties

##### candidateIndex

> **candidateIndex**: `number`

Defined in: [src/runtime/types.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L160)

**`Experimental`**

Iteration index this receipt is about.

##### selected

> **selected**: `boolean`

Defined in: [src/runtime/types.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L162)

**`Experimental`**

True for the iteration the selector chose as winner; false otherwise.

##### score?

> `optional` **score?**: `number`

Defined in: [src/runtime/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L164)

**`Experimental`**

The candidate's verdict score, when it has one.

##### reason?

> `optional` **reason?**: `string`

Defined in: [src/runtime/types.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L166)

**`Experimental`**

Why this candidate was (or was not) selected, when the selector states it.

##### selector

> **selector**: `"default"` \| `"driver"` \| `"caller"`

Defined in: [src/runtime/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L170)

**`Experimental`**

Identity of the selector that produced this receipt — `'caller'` (an
 explicit `selectWinner`), `'driver'` (a driver-authored winner), or
 `'default'` (the kernel's best-valid-score argmax).

***

### RunProvenance

Defined in: [src/runtime/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L182)

**`Experimental`**

Domain-free run provenance: a manifest of what was mounted into the run's
boxes and the receipts for how the winner was selected. Surfaced on
`LoopResult` purely for run auditability — nothing in the kernel branches on
it. Empty arrays when the caller recorded no mounts and there was no
candidate to select.

#### Properties

##### mounts

> **mounts**: [`MountManifestEntry`](#mountmanifestentry)[]

Defined in: [src/runtime/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L184)

**`Experimental`**

Every resource recorded via `prepareBox`'s `recordMount`, in record order.

##### selectionReceipts

> **selectionReceipts**: [`SelectionReceipt`](#selectionreceipt)[]

Defined in: [src/runtime/types.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L186)

**`Experimental`**

One receipt per scored candidate at finalize, in iteration order.

***

### Iteration

Defined in: [src/runtime/types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L199)

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### index

> **index**: `number`

Defined in: [src/runtime/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L201)

**`Experimental`**

0-based iteration index assigned by the kernel.

##### task

> **task**: `Task`

Defined in: [src/runtime/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L202)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [src/runtime/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L204)

**`Experimental`**

Stable name of the `AgentRunSpec` that produced this iteration.

##### output?

> `optional` **output?**: `Output`

Defined in: [src/runtime/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L205)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/types.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L206)

**`Experimental`**

##### error?

> `optional` **error?**: `Error`

Defined in: [src/runtime/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L207)

**`Experimental`**

##### events

> **events**: `SandboxEvent`[]

Defined in: [src/runtime/types.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L209)

**`Experimental`**

Raw sandbox event stream collected for this iteration.

##### startedAt

> **startedAt**: `number`

Defined in: [src/runtime/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L210)

**`Experimental`**

##### endedAt

> **endedAt**: `number`

Defined in: [src/runtime/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L211)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [src/runtime/types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L212)

**`Experimental`**

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [src/runtime/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L214)

**`Experimental`**

Summed LLM token usage across every `llm_call` event in this iteration.

***

### Driver

Defined in: [src/runtime/types.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L218)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L222)

**`Experimental`**

Stable identifier surfaced in trace events. Default `'driver'`.

#### Methods

##### plan()

> **plan**(`task`, `history`): `Promise`\<`Task`[]\>

Defined in: [src/runtime/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L227)

**`Experimental`**

Tasks to issue this iteration. `[task]` → refine; N copies → fanout;
`[]` → no more work this round (kernel proceeds to `decide`).

###### Parameters

###### task

`Task`

###### history

readonly [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

`Promise`\<`Task`[]\>

##### decide()

> **decide**(`history`): `Decision` \| `Promise`\<`Decision`\>

Defined in: [src/runtime/types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L234)

**`Experimental`**

Inspect history and return the next state. The kernel terminates the
loop when `decide` returns a value listed in `isTerminalDecision`
(`'stop' | 'pick-winner' | 'fail' | 'done'`), when `maxIterations`
is hit, or when the abort signal fires.

###### Parameters

###### history

readonly [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

`Decision` \| `Promise`\<`Decision`\>

##### describePlan()?

> `optional` **describePlan**(): [`LoopPlanDescription`](#loopplandescription) \| `undefined`

Defined in: [src/runtime/types.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L244)

**`Experimental`**

Optional: describe the move `plan()` just produced, for trace emission.
The kernel calls this immediately after `plan()` and emits the result in
the `loop.plan` event so a topology viewer can render the agent's chosen
move + rationale (not just the inferred fan-width). Drivers whose topology
is a pure function of count (refine/fanout-vote) omit it — the kernel
infers `moveKind` from the planned-task count. A driver that authors its
own topology returns its chosen move's kind + rationale here.

###### Returns

[`LoopPlanDescription`](#loopplandescription) \| `undefined`

##### selectWinner()?

> `optional` **selectWinner**(`history`): [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

Defined in: [src/runtime/types.ts:254](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L254)

**`Experimental`**

Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
kernel consults this at finalize ONLY when the caller did not pass an explicit
`selectWinner` to runLoop. Return the driver-declared winner (e.g. from a
`select` topology move) or `undefined` to fall through to the default
(best-valid-score, earliest index). This is the SELECTOR role made
agent-authorable — the planner runs the selection, not the kernel.

###### Parameters

###### history

readonly [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

[`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

***

### LoopPlanDescription

Defined in: [src/runtime/types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L260)

**`Experimental`**

Driver-supplied description of the just-planned move.

#### Properties

##### kind

> **kind**: `string`

Defined in: [src/runtime/types.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L262)

**`Experimental`**

Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: [src/runtime/types.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L264)

**`Experimental`**

Why the driver chose this move (the agent's rationale), when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [src/runtime/types.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L271)

**`Experimental`**

Iteration index this round branches FROM, when the driver declares it.
Overrides the kernel's inferred branch point — lets a planner that
branches off a specific (non-winner) iteration emit faithful edge lineage.
Omit to keep the inferred (best-valid / latest) branch point.

***

### LoopWinner

Defined in: [src/runtime/types.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L275)

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### task

> **task**: `Task`

Defined in: [src/runtime/types.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L276)

**`Experimental`**

##### output

> **output**: `Output`

Defined in: [src/runtime/types.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L277)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/types.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L278)

**`Experimental`**

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [src/runtime/types.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L279)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [src/runtime/types.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L280)

**`Experimental`**

***

### LoopResult

Defined in: [src/runtime/types.ts:284](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L284)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L285)

**`Experimental`**

##### iterations

> **iterations**: [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

Defined in: [src/runtime/types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L286)

**`Experimental`**

##### winner?

> `optional` **winner?**: [`LoopWinner`](#loopwinner)\<`Task`, `Output`\>

Defined in: [src/runtime/types.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L287)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [src/runtime/types.ts:288](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L288)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [src/runtime/types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L290)

**`Experimental`**

Sum of every iteration's `costUsd`.

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [src/runtime/types.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L293)

**`Experimental`**

Sum of every iteration's token usage. `loopDispatch` commits it through
 the campaign's paid-call receipt.

##### provenance

> **provenance**: [`RunProvenance`](#runprovenance)

Defined in: [src/runtime/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L297)

**`Experimental`**

Domain-free run provenance for auditability: the mount manifest recorded
 during `prepareBox` and the selection receipts for how the winner was
 chosen. Always present; empty arrays when nothing was recorded.

***

### SandboxClient

Defined in: [src/runtime/types.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L313)

**`Experimental`**

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

> **create**(`options?`): `Promise`\<`SandboxInstance`\>

Defined in: [src/runtime/types.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L314)

**`Experimental`**

###### Parameters

###### options?

`CreateSandboxOptions`

###### Returns

`Promise`\<`SandboxInstance`\>

##### describePlacement()?

> `optional` **describePlacement**(`box`): [`LoopSandboxPlacement`](#loopsandboxplacement)

Defined in: [src/runtime/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L315)

**`Experimental`**

###### Parameters

###### box

`SandboxInstance`

###### Returns

[`LoopSandboxPlacement`](#loopsandboxplacement)

##### criuStatus()?

> `optional` **criuStatus**(): `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [src/runtime/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L326)

**`Experimental`**

Optional CRIU capability probe. When present and it resolves
`{ available: true }`, the loop's `lineage.fork` seam may checkpoint+fork a
parent box so a fanout's branches inherit a shared context prefix; absent or
`false`, the fanout degrades to independent fresh boxes. The kernel reads
this ONLY through the capability probe — it never branches on backend kind.
The raw `Sandbox` SDK class satisfies it; the loop's test fakes omit it
(⇒ `canFork = false`).

###### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

***

### LoopLineageOptions

Defined in: [src/runtime/types.ts:350](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L350)

**`Experimental`**

Opt-in box-lineage controls for `runLoop`. Default OFF — with both flags
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
iterations across all rounds. Size `forkFanout` runs accordingly (CRIU forks
are copy-on-write, but each is still a live box until loop end).

#### Properties

##### sessionContinuity?

> `optional` **sessionContinuity?**: `boolean`

Defined in: [src/runtime/types.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L365)

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

Defined in: [src/runtime/types.ts:380](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L380)

**`Experimental`**

When true AND the platform reports CRIU fork support, a fanout round (N
planned tasks) descending from a prior round FORKS the parent iteration's
checkpoint so all N branches inherit a shared context prefix. Without fork
support it degrades to N independent fresh boxes (same result, no prefix).
Round 0 always starts fresh. NEVER set this for a `random@k` control arm —
forking would couple the independent samples.

A real fork inherits the parent's IMAGE/PROFILE: per-branch `AgentRunSpec`
profiles are honored only on the degraded fresh-box path, so a
heterogeneous-profile fanout silently homogenizes to the parent's profile
when fork is available. Use this for same-profile branching; for
different-per-branch profiles use the unforked fanout path.

##### streaming?

> `optional` **streaming?**: `"sse"` \| `"poll"`

Defined in: [src/runtime/types.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L392)

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

Defined in: [src/runtime/types.ts:396](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L396)

**`Experimental`**

#### Extended by

- [`InProcessExecutorDescribePlacement`](mcp.md#inprocessexecutordescribeplacement)

#### Properties

##### kind

> **kind**: `"sibling"` \| `"fleet"`

Defined in: [src/runtime/types.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L397)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [src/runtime/types.ts:398](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L398)

**`Experimental`**

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [src/runtime/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L399)

**`Experimental`**

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [src/runtime/types.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L400)

**`Experimental`**

***

### LoopTraceEmitter

Defined in: [src/runtime/types.ts:404](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L404)

**`Experimental`**

#### Methods

##### emit()

> **emit**(`event`): `void` \| `Promise`\<`void`\>

Defined in: [src/runtime/types.ts:405](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L405)

**`Experimental`**

###### Parameters

###### event

[`LoopTraceEvent`](#looptraceevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### LoopStartedPayload

Defined in: [src/runtime/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L440)

**`Experimental`**

#### Properties

##### driver

> **driver**: `string`

Defined in: [src/runtime/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L441)

**`Experimental`**

##### agentRunNames

> **agentRunNames**: `string`[]

Defined in: [src/runtime/types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L442)

**`Experimental`**

##### maxIterations

> **maxIterations**: `number`

Defined in: [src/runtime/types.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L443)

**`Experimental`**

##### maxConcurrency

> **maxConcurrency**: `number`

Defined in: [src/runtime/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L444)

**`Experimental`**

***

### LoopPlanPayload

Defined in: [src/runtime/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L455)

**`Experimental`**

Emitted once per `plan()` round, immediately after the driver plans. Carries
the topology move so a viewer renders WHAT the agent decided + WHY, not just
the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).

#### Properties

##### roundIndex

> **roundIndex**: `number`

Defined in: [src/runtime/types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L457)

**`Experimental`**

0-based plan round (one per `plan()` call).

##### plannedCount

> **plannedCount**: `number`

Defined in: [src/runtime/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L459)

**`Experimental`**

Tasks the driver issued this round.

##### moveKind

> **moveKind**: `string`

Defined in: [src/runtime/types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L461)

**`Experimental`**

Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: [src/runtime/types.ts:463](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L463)

**`Experimental`**

Driver rationale for the move, when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [src/runtime/types.ts:469](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L469)

**`Experimental`**

Iteration index this round branched FROM (the edge source). `undefined`
for round 0 (root). Kernel-inferred branch point — the best-valid (else
latest) iteration so far — unless a driver later declares it explicitly.

##### childIndices

> **childIndices**: `number`[]

Defined in: [src/runtime/types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L471)

**`Experimental`**

Iteration indices this round dispatched (the edge targets).

***

### LoopIterationStartedPayload

Defined in: [src/runtime/types.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L475)

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [src/runtime/types.ts:476](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L476)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [src/runtime/types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L477)

**`Experimental`**

##### taskHash

> **taskHash**: `string`

Defined in: [src/runtime/types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L478)

**`Experimental`**

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [src/runtime/types.ts:480](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L480)

**`Experimental`**

Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [src/runtime/types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L482)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationDispatchPayload

Defined in: [src/runtime/types.ts:493](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L493)

**`Experimental`**

Where the iteration's worker was placed. `sibling` = a fresh sandbox the
kernel created via `sandboxClient.create`. `fleet` = an existing machine in
a shared-workspace fleet — workers see the caller's filesystem and any diff
they write lands on it directly.

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [src/runtime/types.ts:494](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L494)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [src/runtime/types.ts:495](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L495)

**`Experimental`**

##### placement

> **placement**: `"sibling"` \| `"fleet"`

Defined in: [src/runtime/types.ts:496](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L496)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [src/runtime/types.ts:498](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L498)

**`Experimental`**

Set on every placement. Lets analyst loops correlate per-iteration logs.

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [src/runtime/types.ts:500](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L500)

**`Experimental`**

Set only when `placement === 'fleet'`.

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [src/runtime/types.ts:502](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L502)

**`Experimental`**

Set only when `placement === 'fleet'`.

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [src/runtime/types.ts:504](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L504)

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [src/runtime/types.ts:506](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L506)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationEndedPayload

Defined in: [src/runtime/types.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L510)

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [src/runtime/types.ts:511](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L511)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [src/runtime/types.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L512)

**`Experimental`**

##### outputHash?

> `optional` **outputHash?**: `string`

Defined in: [src/runtime/types.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L513)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [src/runtime/types.ts:514](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L514)

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: [src/runtime/types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L515)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [src/runtime/types.ts:516](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L516)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [src/runtime/types.ts:517](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L517)

**`Experimental`**

##### tokenUsage?

> `optional` **tokenUsage?**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [src/runtime/types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L520)

**`Experimental`**

Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
 branch span. Omitted when no `llm_call` events carried token counts.

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [src/runtime/types.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L522)

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [src/runtime/types.ts:524](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L524)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

##### outputPreview?

> `optional` **outputPreview?**: `string`

Defined in: [src/runtime/types.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L527)

**`Experimental`**

Truncated string preview of the parsed output — for a viewer's drawer.
 Bounded to ~280 chars; never the full payload.

***

### LoopDecisionPayload

Defined in: [src/runtime/types.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L531)

**`Experimental`**

#### Properties

##### decision

> **decision**: `string`

Defined in: [src/runtime/types.ts:532](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L532)

**`Experimental`**

##### historyLength

> **historyLength**: `number`

Defined in: [src/runtime/types.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L533)

**`Experimental`**

***

### LoopEndedPayload

Defined in: [src/runtime/types.ts:537](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L537)

**`Experimental`**

#### Properties

##### winnerIterationIndex?

> `optional` **winnerIterationIndex?**: `number`

Defined in: [src/runtime/types.ts:538](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L538)

**`Experimental`**

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [src/runtime/types.ts:539](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L539)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [src/runtime/types.ts:540](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L540)

**`Experimental`**

##### iterations

> **iterations**: `number`

Defined in: [src/runtime/types.ts:541](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L541)

**`Experimental`**

***

### LoopTeardownFailedPayload

Defined in: [src/runtime/types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L547)

**`Experimental`**

Emitted when a box's `delete()` throws or times out during teardown — the
 loop swallows the failure (platform reaps on expiry) but surfaces it here so
 a real leak (e.g. mid-loop auth expiry) is observable.

#### Properties

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [src/runtime/types.ts:548](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L548)

**`Experimental`**

##### reason

> **reason**: `string`

Defined in: [src/runtime/types.ts:550](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L550)

**`Experimental`**

`'timeout'` or the delete error message.

***

### ExecCtx

Defined in: [src/runtime/types.ts:558](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L558)

**`Experimental`**

Execution context for `runLoop`: the sandbox client the kernel creates boxes through, plus optional runtime hooks.

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/types.ts:560](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L560)

**`Experimental`**

Sandbox SDK client — the kernel calls `.create()` per iteration.

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/types.ts:562](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L562)

**`Experimental`**

Optional runtime hooks. Execution-scoped; never part of `AgentProfile`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: [src/runtime/types.ts:564](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L564)

**`Experimental`**

Optional trace emitter. When set, the kernel emits `loop.*` events.

##### onSandboxEvent?

> `optional` **onSandboxEvent?**: (`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>

Defined in: [src/runtime/types.ts:582](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L582)

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

Defined in: [src/runtime/types.ts:591](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L591)

**`Experimental`**

Optional production-run handle. When set, every synthesized `llm_call`
the kernel infers from a sandbox event stream is forwarded via
`runHandle.observe` so per-run cost aggregates pick up loop spend.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [src/runtime/types.ts:593](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L593)

**`Experimental`**

Cooperative cancellation signal.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [src/runtime/types.ts:599](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L599)

**`Experimental`**

Trace id for OTEL correlation. When set alongside `traceEmitter`, the
exporter uses this as the parent trace for all emitted spans. Typically
inherited from TRACE_ID env var in MCP subprocess mode.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [src/runtime/types.ts:604](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L604)

**`Experimental`**

Parent span id for OTEL correlation. Loop events become children of
this span. Typically inherited from PARENT_SPAN_ID env var.

***

### VerifierEnvironmentOptions

Defined in: [src/runtime/verifier-environment.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L34)

#### Properties

##### name

> **name**: `string`

Defined in: [src/runtime/verifier-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L35)

##### extraTools?

> `optional` **extraTools?**: [`AgenticTool`](#agentictool)[]

Defined in: [src/runtime/verifier-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L39)

Extra domain tools (read-only helpers: calculator, retrieval, style lookup).

#### Methods

##### check()

> **check**(`task`, `answer`): [`SurfaceScore`](#surfacescore) \| `Promise`\<[`SurfaceScore`](#surfacescore)\>

Defined in: [src/runtime/verifier-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L37)

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

Defined in: [src/runtime/verifier-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L41)

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

Defined in: [src/runtime/waterfall.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L11)

#### Properties

##### id

> **id**: `string`

Defined in: [src/runtime/waterfall.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L12)

##### label

> **label**: `string`

Defined in: [src/runtime/waterfall.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L14)

The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name.

##### runId

> **runId**: `string`

Defined in: [src/runtime/waterfall.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L15)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [src/runtime/waterfall.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L16)

##### startMs

> **startMs**: `number`

Defined in: [src/runtime/waterfall.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L17)

##### endMs?

> `optional` **endMs?**: `number`

Defined in: [src/runtime/waterfall.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L18)

##### status

> **status**: `"running"` \| `"done"` \| `"down"`

Defined in: [src/runtime/waterfall.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L19)

##### usd

> **usd**: `number`

Defined in: [src/runtime/waterfall.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L20)

##### tokens

> **tokens**: `object`

Defined in: [src/runtime/waterfall.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L21)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### score?

> `optional` **score?**: `number`

Defined in: [src/runtime/waterfall.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L22)

***

### WaterfallReport

Defined in: [src/runtime/waterfall.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L25)

#### Properties

##### spans

> **spans**: [`WaterfallSpan`](#waterfallspan)[]

Defined in: [src/runtime/waterfall.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L26)

##### totalMs

> **totalMs**: `number`

Defined in: [src/runtime/waterfall.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L28)

Wall-clock of the observed window (first spawn → last settle).

##### totalUsd

> **totalUsd**: `number`

Defined in: [src/runtime/waterfall.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L29)

##### totalTokens

> **totalTokens**: `object`

Defined in: [src/runtime/waterfall.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L30)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### byKind

> **byKind**: `Record`\<`string`, \{ `count`: `number`; `ms`: `number`; `usd`: `number`; `tokens`: \{ `input`: `number`; `output`: `number`; \}; \}\>

Defined in: [src/runtime/waterfall.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L32)

Rollup by label prefix (the part before ':') — shots vs analysts vs anything else.

***

### WaterfallCollector

Defined in: [src/runtime/waterfall.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L49)

#### Properties

##### hooks

> **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [src/runtime/waterfall.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L51)

Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks.

#### Methods

##### report()

> **report**(): [`WaterfallReport`](#waterfallreport)

Defined in: [src/runtime/waterfall.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L52)

###### Returns

[`WaterfallReport`](#waterfallreport)

##### render()

> **render**(`opts?`): `string`

Defined in: [src/runtime/waterfall.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L54)

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

Defined in: [src/runtime/waterfall.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L55)

###### Returns

`void`

***

### Workspace

Defined in: [src/runtime/workspace.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L11)

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: [src/runtime/workspace.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L12)

#### Methods

##### materialize()

> **materialize**(`dir`): `Promise`\<`void`\>

Defined in: [src/runtime/workspace.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L13)

###### Parameters

###### dir

`string`

###### Returns

`Promise`\<`void`\>

##### commit()

> **commit**(`dir`, `message`): `Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

Defined in: [src/runtime/workspace.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L14)

###### Parameters

###### dir

`string`

###### message

`string`

###### Returns

`Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

##### head()

> **head**(): `Promise`\<`string`\>

Defined in: [src/runtime/workspace.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L15)

###### Returns

`Promise`\<`string`\>

***

### GitWorkspaceOptions

Defined in: [src/runtime/workspace.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L40)

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: [src/runtime/workspace.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L41)

##### shell?

> `readonly` `optional` **shell?**: [`Shell`](#shell)

Defined in: [src/runtime/workspace.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L42)

##### branch?

> `readonly` `optional` **branch?**: `string`

Defined in: [src/runtime/workspace.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L43)

##### noHooks?

> `readonly` `optional` **noHooks?**: `boolean`

Defined in: [src/runtime/workspace.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L44)

***

### WorkspaceRun

Defined in: [src/runtime/workspace.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L137)

#### Type Parameters

##### T

`T`

#### Properties

##### valid

> `readonly` **valid**: `boolean`

Defined in: [src/runtime/workspace.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L138)

##### value

> `readonly` **value**: `T`

Defined in: [src/runtime/workspace.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L139)

##### commit?

> `readonly` `optional` **commit?**: [`WorkspaceCommit`](#workspacecommit)

Defined in: [src/runtime/workspace.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L141)

Present when a commit was attempted (valid, or `commitOnInvalid`).

## Type Aliases

### CoordinationEvent

> **CoordinationEvent** = \{ `type`: `"question"`; `question`: [`QuestionRecord`](mcp.md#questionrecord); \} \| \{ `type`: `"settled"`; `worker`: [`SettledWorker`](mcp.md#settledworker); \} \| \{ `type`: `"finding"`; `finding`: `AnalystFindingEvent`; \} \| \{ `type`: `"steer"`; `down`: `DownMessageEvent`; \} \| \{ `type`: `"answer"`; `down`: `DownMessageEvent`; `questionId`: `string`; \}

Defined in: [src/mcp/tools/coordination.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L87)

Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 the driver to `pull`. DOWN (parent→child): steer / answer — record-only (history + subscribers),
 routed to the child inbox. New kinds are additive.

***

### MakeWorkerAgent

> **MakeWorkerAgent** = (`profile`) => [`Agent`](#agent-1)\<`unknown`, `unknown`\>

Defined in: [src/mcp/tools/coordination.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L94)

#### Parameters

##### profile

`unknown`

#### Returns

[`Agent`](#agent-1)\<`unknown`, `unknown`\>

***

### InProcessOnPrompt

> **InProcessOnPrompt** = (`prompt`, `ctx`) => `SandboxEvent`[] \| `AsyncIterable`\<`SandboxEvent`\> \| `Promise`\<`SandboxEvent`[]\>

Defined in: [src/runtime/in-process-sandbox-client.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L70)

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

> **LoopOptionsForDispatch**\<`Task`, `Output`, `Decision`\> = `Omit`\<`RunLoopOptions`\<`Task`, `Output`, `Decision`\>, `"ctx"`\>

Defined in: [src/runtime/loop-dispatch.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L44)

runLoop options minus the `ctx` (loopDispatch builds the ctx).

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

***

### Outcome

> **Outcome**\<`D`\> = \{ `kind`: `"done"`; `deliverable`: `D`; \} \| \{ `kind`: `"blocked"`; `blockers`: `string`[]; \}

Defined in: [src/runtime/personify/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L55)

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

Defined in: [src/runtime/personify/types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L144)

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

> **LoopShape**\<`Task`, `D`\> = (`ctx`) => [`Agent`](#agent-1)\<`Task`, [`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [src/runtime/personify/types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L193)

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

[`Agent`](#agent-1)\<`Task`, [`Outcome`](#outcome-1)\<`D`\>\>

***

### RunPersonified

> **RunPersonified** = \<`Task`, `D`\>(`options`) => `Promise`\<[`SupervisedResult`](#supervisedresult)\<[`Outcome`](#outcome-1)\<`D`\>\>\>

Defined in: [src/runtime/personify/types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L256)

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

`Promise`\<[`SupervisedResult`](#supervisedresult)\<[`Outcome`](#outcome-1)\<`D`\>\>\>

***

### CombinatorShape

> **CombinatorShape**\<`Task`, `D`\> = [`LoopShape`](#loopshape)\<`Task`, `D`\>

Defined in: [src/runtime/personify/wave-types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L65)

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

Defined in: [src/runtime/personify/wave-types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L90)

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

> **FanoutWinnerSelector**\<`D`\> = (`iterations`) => \{ `output?`: [`Outcome`](#outcome-1)\<`D`\>; \} \| `undefined`

Defined in: [src/runtime/personify/wave-types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L150)

A winner-selection strategy: argmax/sort over the gathered child iterations (each output is the
 child's `Outcome<D>`), returning the chosen iteration or `undefined` when none qualifies.

#### Type Parameters

##### D

`D`

#### Parameters

##### iterations

[`Iteration`](#iteration-1)\<`unknown`, [`Outcome`](#outcome-1)\<`D`\>\>[]

#### Returns

\{ `output?`: [`Outcome`](#outcome-1)\<`D`\>; \} \| `undefined`

***

### WinnerStrategy

> **WinnerStrategy** = `"highest-score"` \| `"smallest-artifact"` \| `"first-valid"`

Defined in: [src/runtime/personify/wave-types.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L156)

Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid.

***

### Fanout

> **Fanout** = \<`Task`, `Item`, `D`\>(`items`, `opts`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

Defined in: [src/runtime/personify/wave-types.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L167)

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

Defined in: [src/runtime/personify/wave-types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L205)

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

Defined in: [src/runtime/personify/wave-types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L255)

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

Defined in: [src/runtime/personify/wave-types.ts:281](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L281)

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

Defined in: [src/runtime/personify/wave-types.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L335)

A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 always returns `{ kind: 'stop' }`.

#### Type Parameters

##### D

`D`

***

### Widen

> **Widen** = \<`Task`, `Seed`, `D`\>(`spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

Defined in: [src/runtime/personify/wave-types.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L347)

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

Defined in: [src/runtime/personify/wave-types.ts:352](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L352)

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

Defined in: [src/runtime/personify/wave-types.ts:413](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L413)

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

Defined in: [src/runtime/personify/wave-types.ts:504](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L504)

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

Defined in: [src/runtime/personify/wave-types.ts:563](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L563)

`trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs).

#### Parameters

##### journal

[`SpawnJournal`](#spawnjournal)

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### root

[`NodeId`](#nodeid-1)

##### options?

[`TrajectoryReportOptions`](#trajectoryreportoptions)

#### Returns

`Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

***

### EqualKOnCost

> **EqualKOnCost** = (`arms`, `options?`) => [`EqualKVerdict`](#equalkverdict)

Defined in: [src/runtime/personify/wave-types.ts:618](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L618)

`equalKOnCost(arms, opts)` — the cross-arm equal-compute check on conserved cost.

#### Parameters

##### arms

`ReadonlyArray`\<[`EqualKArm`](#equalkarm)\>

##### options?

[`EqualKOnCostOptions`](#equalkoncostoptions)

#### Returns

[`EqualKVerdict`](#equalkverdict)

***

### Environment

> **Environment** = [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/run-benchmark.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L30)

A checkable task domain — implement these 5 hooks and the suite does the rest. The
 same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it.

***

### Deliverable

> **Deliverable**\<`Out`\> = \{ `kind`: `"events"`; `fromEvents`: (`events`) => `Out`; \} \| \{ `kind`: `"artifact"`; `path`: `string`; `fromArtifact`: (`raw`, `events`) => `Out`; \}

Defined in: [src/runtime/sandbox-run.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L51)

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

Defined in: [src/runtime/sandbox-run.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L111)

**`Experimental`**

Prompt options forwarded to every sandbox prompt turn in this run. The
runtime owns `sessionId` and `signal` so callers cannot accidentally break
resume or cancellation semantics while still setting backend-level prompt
controls such as `timeoutMs`.

***

### SteeringDecision

> **SteeringDecision** = `"refine"` \| `"pick-winner"` \| `"fail"`

Defined in: [src/runtime/steering-drivers.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L55)

Terminal-or-continue decision shared by all three steering drivers. The
non-terminal `'refine'` keeps the loop running another shot; the terminal
`'pick-winner'`/`'fail'` stop it (`isTerminalDecision` in run-loop.ts treats
`'pick-winner'` and `'fail'` as terminal and any other string as a request
for another round). Identical to the reference refine driver's decision set.

***

### ApplyContinuation

> **ApplyContinuation**\<`Task`\> = (`task`, `continuation`) => `Task`

Defined in: [src/runtime/steering-drivers.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L64)

Fold a steering string into the caller's Task shape, producing the Task for
the next shot. The substrate never assumes how a Task carries its prompt, so
the caller supplies this — the same way it supplies `taskToPrompt`. The
original `task` is passed so the fold can preserve task-level fields (ids,
fixtures, feature names) and replace only the instruction.

#### Type Parameters

##### Task

`Task`

#### Parameters

##### task

`Task`

##### continuation

`string`

#### Returns

`Task`

***

### ChampionPolicy

> **ChampionPolicy** = `"score"` \| `"costAware"`

Defined in: [src/runtime/strategy-evolution.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L55)

***

### AgentTurnBackend

> **AgentTurnBackend** = \{ `kind`: `"box"`; `box`: `SandboxInstance`; `options?`: `Omit`\<`PromptOptions`, `"signal"`\>; `agentRunName?`: `string`; \} \| \{ `kind`: `"box-task"`; `box`: `SandboxInstance`; `options?`: `Omit`\<`TaskOptions`, `"signal"`\>; `agentRunName?`: `string`; \} \| \{ `kind`: `"executor"`; `factory`: [`ExecutorFactory`](#executorfactory)\<`unknown`\>; `agentRunName?`: `string`; \} \| \{ `kind`: `"chat"`; `backend`: [`AgentExecutionBackend`](index.md#agentexecutionbackend); \}

Defined in: [src/runtime/stream-agent-turn.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L82)

**`Experimental`**

The execution substrate one turn runs on — a closed discriminated union over
the three stream surfaces the runtime already owns.

#### Union Members

##### Type Literal

\{ `kind`: `"box"`; `box`: `SandboxInstance`; `options?`: `Omit`\<`PromptOptions`, `"signal"`\>; `agentRunName?`: `string`; \}

###### kind

> **kind**: `"box"`

A live sandbox box: the turn is one `box.streamPrompt(prompt)` call.

###### box

> **box**: `SandboxInstance`

###### options?

> `optional` **options?**: `Omit`\<`PromptOptions`, `"signal"`\>

Per-turn `PromptOptions` forwarded verbatim to `streamPrompt`
(`sessionId`, `turnId`, `model`, `backend` profile, `timeoutMs`, …).
The turn's derived abort signal (caller `signal` + `timeoutMs`
deadline) is always installed as `signal` — pass cancellation through
`StreamAgentTurnOptions`, not here.

###### agentRunName?

> `optional` **agentRunName?**: `string`

Model label stamped on cost-only `llm_call` events. Default `'agent'`.

***

##### Type Literal

\{ `kind`: `"box-task"`; `box`: `SandboxInstance`; `options?`: `Omit`\<`TaskOptions`, `"signal"`\>; `agentRunName?`: `string`; \}

###### kind

> **kind**: `"box-task"`

A live sandbox box in TASK mode: the turn is one
`box.streamTask(prompt)` call — the sandbox SDK's autonomous-task
verb. Unlike `streamPrompt` (one chat turn), the agent works until
the task completes or errors, session state is maintained for
continuity, and `options.maxTurns` bounds the agent's internal turns.
Event projection, usage folding, and the terminal `final` contract
are identical to the `box` kind.

###### box

> **box**: `SandboxInstance`

###### options?

> `optional` **options?**: `Omit`\<`TaskOptions`, `"signal"`\>

Per-task `TaskOptions` forwarded verbatim to `streamTask`
(`maxTurns` plus every `PromptOptions` field). The turn's derived
abort signal is always installed as `signal`.

###### agentRunName?

> `optional` **agentRunName?**: `string`

Model label stamped on cost-only `llm_call` events. Default `'agent'`.

***

##### Type Literal

\{ `kind`: `"executor"`; `factory`: [`ExecutorFactory`](#executorfactory)\<`unknown`\>; `agentRunName?`: `string`; \}

###### kind

> **kind**: `"executor"`

A one-shot `Executor` (cli-bridge / router / BYO): the factory is
instantiated fresh for the turn via `inlineSandboxClient`, run once on
the prompt, and torn down — the same per-spawn lifecycle the supervise
runtime gives it.

###### factory

> **factory**: [`ExecutorFactory`](#executorfactory)\<`unknown`\>

###### agentRunName?

> `optional` **agentRunName?**: `string`

Model label stamped on cost-only `llm_call` events. Default `'agent'`.

***

##### Type Literal

\{ `kind`: `"chat"`; `backend`: [`AgentExecutionBackend`](index.md#agentexecutionbackend); \}

###### kind

> **kind**: `"chat"`

An in-process `AgentExecutionBackend` (`resolveAgentBackend` output or
any custom backend): the turn is one `backend.stream()` call.

###### backend

> **backend**: [`AgentExecutionBackend`](index.md#agentexecutionbackend)

***

### RepairStop

> **RepairStop** = `"already-passing"` \| `"no-signal"` \| `"repaired-pass"` \| `"rounds-exhausted"` \| `"no-candidates"`

Defined in: [src/runtime/structural-rollout.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L479)

***

### BudgetReadout

> **BudgetReadout** = `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [src/runtime/supervise/budget.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L44)

Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver.

***

### DispatchStopReason

> **DispatchStopReason** = `"drained"` \| `"not-admitted"` \| `"stopped"` \| `"aborted"`

Defined in: [src/runtime/supervise/dispatch.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L57)

Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end);
 `not-admitted` = the conserved pool or the depth ceiling refused a spawn; `stopped` = the
 caller's `shouldStop` returned true; `aborted` = the scope's signal fired.

***

### RunContext

> **RunContext** = [`InMemoryRunContext`](#inmemoryruncontext)

Defined in: [src/runtime/supervise/run-context.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L66)

The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the
 historical name for the same shape.

***

### ExecutorConfig

> **ExecutorConfig** = `object` & `RouterSeam` \| `object` & `RouterToolsSeam` \| `object` & `BridgeSeam` \| `object` & `CliSeam` \| `object` & `CliWorktreeSeam` \| `object` & [`ProviderSeam`](#providerseam) \| `object` & `SandboxSeam`

Defined in: [src/runtime/supervise/runtime.ts:1540](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1540)

Config for [createExecutor](#createexecutor): the backend is DATA — the cost dial a profile,
an experiment config, or a replay journal can name — not an import choice. Each
variant carries its backend's seam (router/router-tools/bridge/cli/cli-worktree/sandbox).

***

### DriveHarness

> **DriveHarness** = (`args`) => `Promise`\<`void`\>

Defined in: [src/runtime/supervise/supervisor-agent.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L62)

How to run a sandboxed harness as the DRIVER, with the coordination verbs mounted — the substrate
 seam the caller supplies (mirrors `makeWorkerAgent` for spawned children). It runs `profile` on
 `task` in its backend (sandbox / cli-bridge) with `coordinationMcpUrl` mounted as an MCP server,
 so the harness calls spawn_agent / await_event / stop as native tools over the live scope.

#### Parameters

##### args

###### profile

[`SupervisorProfile`](#supervisorprofile)

###### task

`unknown`

###### scope

[`Scope`](#scope-1)\<`unknown`\>

###### coordinationMcpUrl

`string`

#### Returns

`Promise`\<`void`\>

***

### UsageEvent

> **UsageEvent** = \{ `kind`: `"tokens"`; `input`: `number`; `output`: `number`; \} \| \{ `kind`: `"cost"`; `usd`: `number`; \} \| \{ `kind`: `"iteration"`; \}

Defined in: [src/runtime/supervise/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L131)

Normalized usage event — the single channel every executor reports through, so the
conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
`{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).

***

### Runtime

> **Runtime** = `"router"` \| `"inline"` \| `"sandbox"` \| `"cli"` \| `string` & `object`

Defined in: [src/runtime/supervise/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L138)

The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
External executors can register additional runtime strings without widening this type.

***

### ExecutorFactory

> **ExecutorFactory**\<`Out`\> = (`spec`, `ctx`) => [`Executor`](#executor)\<`Out`\>

Defined in: [src/runtime/supervise/types.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L166)

Builds a fresh `Executor` for one spawn from the resolved spec. Per-spawn (not
shared) so each child owns its own box/abort/teardown lifecycle. A BYO factory lets a
user supply construction args without pre-instantiating.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### spec

[`AgentSpec`](#agentspec)

##### ctx

[`ExecutorContext`](#executorcontext)

#### Returns

[`Executor`](#executor)\<`Out`\>

***

### NodeId

> **NodeId** = `string`

Defined in: [src/runtime/supervise/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L229)

Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock.

***

### Settled

> **Settled**\<`Out`\> = \{ `kind`: `"done"`; `handle`: `Handle`\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `seq`: `number`; \} \| \{ `kind`: `"down"`; `handle`: `Handle`\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

Defined in: [src/runtime/supervise/types.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L259)

A settled child, delivered by `scope.next()`. `seq` is the monotonic cursor order
`next()` yielded this settlement (B2) — NOT wall-clock — and replay delivers strictly
in `seq` order. `outRef` rehydrates `out` from the `ResultBlobStore` on replay.

#### Type Parameters

##### Out

`Out`

#### Union Members

##### Type Literal

\{ `kind`: `"done"`; `handle`: `Handle`\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `seq`: `number`; \}

***

##### Type Literal

\{ `kind`: `"down"`; `handle`: `Handle`\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

###### kind

> **kind**: `"down"`

###### handle

> **handle**: `Handle`\<`Out`\>

###### reason

> **reason**: `string`

###### infra

> **infra**: `boolean`

True = infrastructure failure (excluded from merge `n` / equal-k), not a bad result.

###### restartCount

> **restartCount**: `number`

###### seq

> **seq**: `number`

***

### SpawnEvent

> **SpawnEvent** = \{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `budget`: [`Budget`](#budget-12); `runtime`: [`Runtime`](#runtime-3); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"settled"`; `id`: [`NodeId`](#nodeid-1); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `infra?`: `boolean`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: [`NodeId`](#nodeid-1); `reason`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"metered"`; `id`: [`NodeId`](#nodeid-1); `spend`: [`Spend`](#spend); `seq`: `number`; `at`: `string`; \}

Defined in: [src/runtime/supervise/types.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L394)

Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 timestamp for human inspection only (NOT a replay input).

#### Union Members

##### Type Literal

\{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `budget`: [`Budget`](#budget-12); `runtime`: [`Runtime`](#runtime-3); `seq`: `number`; `at`: `string`; \}

***

##### Type Literal

\{ `kind`: `"settled"`; `id`: [`NodeId`](#nodeid-1); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `infra?`: `boolean`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"settled"`

###### id

> **id**: [`NodeId`](#nodeid-1)

###### status

> **status**: `"done"` \| `"down"`

###### outRef?

> `optional` **outRef?**: `string`

Content-addressed result pointer; rehydrates `out` from `ResultBlobStore`.

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### spent

> **spent**: [`Spend`](#spend)

###### infra?

> `optional` **infra?**: `boolean`

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

##### Type Literal

\{ `kind`: `"cancelled"`; `id`: [`NodeId`](#nodeid-1); `reason`: `string`; `seq`: `number`; `at`: `string`; \}

***

##### Type Literal

\{ `kind`: `"metered"`; `id`: [`NodeId`](#nodeid-1); `spend`: [`Spend`](#spend); `seq`: `number`; `at`: `string`; \}

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

> **id**: [`NodeId`](#nodeid-1)

###### spend

> **spend**: [`Spend`](#spend)

###### seq

> **seq**: `number`

###### at

> **at**: `string`

***

### SupervisedResult

> **SupervisedResult**\<`Out`\> = \{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](#treeview); `spentTotal`: [`Spend`](#spend); `spentBreakdown?`: \{ `driverInference`: [`Spend`](#spend); `childWork`: [`Spend`](#spend); \}; \} \| \{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); \}

Defined in: [src/runtime/supervise/types.ts:502](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L502)

Typed terminal result (M2) — a no-winner is NEVER coerced to a best-effort output.

#### Type Parameters

##### Out

`Out`

#### Union Members

##### Type Literal

\{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](#treeview); `spentTotal`: [`Spend`](#spend); `spentBreakdown?`: \{ `driverInference`: [`Spend`](#spend); `childWork`: [`Spend`](#spend); \}; \}

###### kind

> **kind**: `"winner"`

###### out

> **out**: `Out`

###### outRef

> **outRef**: `string`

###### verdict?

> `optional` **verdict?**: `DefaultVerdict`

###### tree

> **tree**: [`TreeView`](#treeview)

###### spentTotal

> **spentTotal**: [`Spend`](#spend)

###### spentBreakdown?

> `optional` **spentBreakdown?**: `object`

Where `spentTotal` went: `driverInference` = the drivers' own chat turns (metered via
 `Scope.meter`); `childWork` = every spawned child's reconciled spend (the journal sum).
 `driverInference + childWork === spentTotal`. Present whenever any driver metered.

###### spentBreakdown.driverInference

> **driverInference**: [`Spend`](#spend)

###### spentBreakdown.childWork

> **childWork**: [`Spend`](#spend)

***

##### Type Literal

\{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](#spend); \}

###### kind

> **kind**: `"no-winner"`

###### reason

> **reason**: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`

###### tree

> **tree**: [`TreeView`](#treeview)

###### downCount

> **downCount**: `number`

###### spentTotal

> **spentTotal**: [`Spend`](#spend)

The conserved spend incurred before the run failed — real cost is paid even when no
 worker delivers, so the caller always learns what the delegation actually spent. Summed
 off the same journal the `winner` path reads.

***

### WorktreePatchArtifact

> **WorktreePatchArtifact** = `WorktreeHarnessResult`

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L42)

Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 diff + the harness's run record + the derived checks).

***

### ToolLoopChat

> **ToolLoopChat** = (`messages`, `tools`) => `Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`RouterToolCall`](#routertoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; \}; `costUsd?`: `number`; \}\>

Defined in: [src/runtime/tool-loop.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L17)

One inference turn over the running conversation + the tool specs → the model's text, any
 tool calls, and token usage. The seam every brain satisfies.

#### Parameters

##### messages

`ReadonlyArray`\<`Msg`\>

##### tools

`ReadonlyArray`\<[`ToolSpec`](#toolspec)\>

#### Returns

`Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`RouterToolCall`](#routertoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; \}; `costUsd?`: `number`; \}\>

***

### ToolLoopCompactionOptions

> **ToolLoopCompactionOptions** = `Omit`\<[`ToolLoopCompaction`](#toolloopcompaction), `"distill"`\> & `object`

Defined in: [src/runtime/tool-loop.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L66)

Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional
 because the supervisor has a default digest that combines a brain note with live worker state.

#### Type Declaration

##### distill?

> `readonly` `optional` **distill?**: [`ToolLoopCompaction`](#toolloopcompaction)\[`"distill"`\]

***

### MountRecorder

> **MountRecorder** = (`entry`) => `void`

Defined in: [src/runtime/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L196)

**`Experimental`**

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

Defined in: [src/runtime/types.ts:409](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L409)

**`Experimental`**

***

### Shell

> **Shell** = (`args`, `cwd?`) => `Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

Defined in: [src/runtime/workspace.ts:2](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L2)

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

Defined in: [src/runtime/workspace.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L7)

## Variables

### defaultAuditorInstruction

> `const` **defaultAuditorInstruction**: `string`

Defined in: [src/runtime/audit-intent.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L66)

Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories.

***

### mcpSecretEnvMetadataKey

> `const` **mcpSecretEnvMetadataKey**: `"secretEnv"` = `'secretEnv'`

Defined in: [src/runtime/key-provider.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L55)

The `AgentProfileMcpServer.metadata` key the declarative secret-env map
 rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
 are resolved at materialize time and never stored.

***

### defaultAnalystInstruction

> `const` **defaultAnalystInstruction**: `string`

Defined in: [src/runtime/observe.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L57)

The default observer instruction — exported so an optimizer can seed its population.

***

### assertTraceDerivedFindings

> `const` **assertTraceDerivedFindings**: [`AssertTraceDerivedFindings`](#asserttracederivedfindings-1)

Defined in: [src/runtime/personify/analyst.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L47)

***

### builtinShapes

> `const` **builtinShapes**: [`ShapeRegistry`](#shaperegistry)

Defined in: [src/runtime/personify/registry.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L50)

The default registry `runPersonified` resolves a shape name against. Empty by construction —
 a caller registers its own composed shapes; the engine ships no domain shape.

***

### strategyAuthorContract

> `const` **strategyAuthorContract**: "\nYou author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to\nspend a compute budget to beat a task's deployable check. You compose exactly two steps:\n\n  shot(spec?: \{ handle?, messages?, steer?, persona?, tools? \}): Promise\<ShotResult \| null\>\n    Runs ONE worker attempt (a bounded tool loop) over an artifact.\n    - omit handle  =\> the shot opens its OWN fresh artifact and closes it after (a sample).\n    - pass handle  =\> the shot CONTINUES that artifact (state accumulates across shots).\n    - messages     =\> the carried conversation (pass the previous ShotResult.messages to continue).\n    - steer        =\> a corrective instruction injected before the shot.\n    - persona      =\> \{ systemPrompt?, model? \} — give THIS shot its own role and/or model\n      (multi-agent strategies: a researcher shot then an engineer shot, a panel of k\n      personas over one budget). On a fresh shot the systemPrompt replaces the task's; on\n      a carried conversation it arrives as a hand-off message. Same conserved budget.\n    - tools        =\> string\[\] — restrict THIS shot to a subset of the task's tools by\n      name (focus an explore shot on read-only tools, an execute shot on write tools).\n      Restriction-only; unknown names make the shot fail. ALWAYS select from\n      await listTools(handle) — never hardcode. Omitted =\> the shot sees every tool.\n    ShotResult = \{ messages, score (0..1 on the task's check), passes, total, completions, toolErrors \}\n    Returns null if the attempt failed infra-wise.\n\n  critique(messages): Promise\<string \| null\>\n    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective\n    instruction (or null when it judges the work complete). Costs ~1 completion.\n\n  consult(messages, instruction): Promise\<string \| null\>\n    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the\n    trajectory verbatim (no reformatting) — use it when you need a specific reply format\n    (a decision, a prediction). Costs ~1 completion.\n\n  surface.open(task) / surface.close(handle)\n    Open a persistent artifact you manage yourself (remember to close in a finally).\n    close is idempotent — closing an already-closed handle is a safe no-op.\n\n  listTools(handle): Promise\<Array\<\{ name, description? \}\>\>\n    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a\n    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding\n    names from an example kills your shots on every task whose tools differ.\n\nRules:\n- ALWAYS await every shot/critique/surface call — a floating promise that rejects\n  crashes the whole benchmark run.\n- Stay within ~budget total shots; every shot/critique spends from a conserved pool.\n- For a FRESH attempt OMIT \`messages\` entirely (never pass \`\[\]\` — an empty array is a\n  fresh conversation too, but be explicit). To CONTINUE, pass the previous\n  ShotResult.messages unchanged.\n- Return \{ score, resolved, completions, progression, shots \} — score = the BEST checkpoint\n  you reached (keep-best, never final-state), progression = score after each shot.\n- The module must be EXACTLY this shape (no other imports, no commentary outside code):\n\nimport \{ defineStrategy \} from '@tangle-network/agent-runtime/loops'\nexport default defineStrategy('your-strategy-name', async (\{ surface, task, budget, shot, critique, listTools \}) =\> \{\n  // your composition (listTools comes from the destructured context — it is NOT a global)\n\})\n"

Defined in: [src/runtime/strategy-author.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L22)

The compressed consumable a skill carries: everything an author needs to emit a loop.

***

### sample

> `const` **sample**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:769](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L769)

Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample).

***

### refine

> `const` **refine**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:774](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L774)

Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage).

***

### adaptiveRefine

> `const` **adaptiveRefine**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:974](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L974)

A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 optimizations" path: a new technique, compact, with zero Supervisor ceremony.

***

### sampleThenRefine

> `const` **sampleThenRefine**: [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:1017](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1017)

The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 then refine the best-verifying line with the remaining budget. Sample's basin escape +
 refine's accumulation — the third built-in, authored from the public steps.

***

### defaultStructuralRolloutPolicy

> `const` **defaultStructuralRolloutPolicy**: [`StructuralRolloutPolicy`](#structuralrolloutpolicy)

Defined in: [src/runtime/structural-rollout.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L60)

The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks.

***

### defaultProfileRichnessThresholds

> `const` **defaultProfileRichnessThresholds**: [`ProfileRichnessThresholds`](#profilerichnessthresholds)

Defined in: [src/runtime/supervise/authoring.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L140)

Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt.

***

### defaultDelegateBudget

> `const` **defaultDelegateBudget**: [`Budget`](#budget-12)

Defined in: [src/runtime/supervise/delegate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L35)

The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
 A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
 bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`.

***

### cliWorktreeExecutor

> `const` **cliWorktreeExecutor**: [`ExecutorFactory`](#executorfactory)\<`unknown`\>

Defined in: [src/runtime/supervise/runtime.ts:1502](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1502)

The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
`AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.

## Functions

### contentAddress()

> **contentAddress**(`artifact`): `string`

Defined in: [src/durable/spawn-journal.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L49)

Mint the content-addressed `outRef` for a result artifact: `sha256:<hex>` over a
stable JSON encoding. Producers call this to derive the `outRef` they journal and
`put`; the FS/in-mem stores re-derive it on `put` to verify the supplied ref
matches (fail loud on a mismatch — a forged ref breaks the replay invariant).

Stable encoding: object keys are sorted recursively so two structurally-equal
artifacts hash identically regardless of key insertion order.

#### Parameters

##### artifact

`unknown`

#### Returns

`string`

***

### replaySpawnTree()

> **replaySpawnTree**(`journal`, `blobs`, `root`): `Promise`\<[`Settled`](#settled-3)\<`unknown`\>[]\>

Defined in: [src/durable/spawn-journal.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L302)

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

`Promise`\<[`Settled`](#settled-3)\<`unknown`\>[]\>

***

### materializeTreeView()

> **materializeTreeView**(`events`): [`TreeView`](#treeview)

Defined in: [src/durable/spawn-journal.ts:384](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L384)

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

### anytimeReport()

> **anytimeReport**(`spans`, `opts?`): [`AnytimeReport`](#anytimereport)

Defined in: [src/runtime/anytime.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L73)

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

Defined in: [src/runtime/anytime.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L164)

One row per (strategy, satisficing target): the shareable time-to-satisfactory table.

#### Parameters

##### report

[`AnytimeReport`](#anytimereport)

#### Returns

`string`

***

### auditIntent()

> **auditIntent**(`input`, `opts`): `Promise`\<[`IntentAudit`](#intentaudit)\>

Defined in: [src/runtime/audit-intent.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L110)

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

Defined in: [src/runtime/benchmark-report.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L158)

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

Defined in: [src/runtime/benchmark-report.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L293)

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

Defined in: [src/runtime/benchmark-report.ts:357](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L357)

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

Defined in: [src/runtime/benchmark-report.ts:400](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L400)

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

Defined in: [src/runtime/benchmark-report.ts:435](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L435)

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

Defined in: [src/runtime/benchmark-report.ts:506](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/benchmark-report.ts#L506)

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

Defined in: [src/runtime/completion.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L64)

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

Defined in: [src/runtime/completion.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L75)

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

Defined in: [src/runtime/completion.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L88)

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

Defined in: [src/runtime/completion.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L113)

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

Defined in: [src/runtime/define-leaderboard.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/define-leaderboard.ts#L305)

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

Defined in: [src/runtime/harvest-corpus.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L63)

Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel.

#### Parameters

##### opts

[`HarvestCorpusOptions`](#harvestcorpusoptions)

#### Returns

`Promise`\<[`HarvestReport`](#harvestreport)\>

***

### inProcessSandboxClient()

> **inProcessSandboxClient**(`options`): [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/in-process-sandbox-client.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/in-process-sandbox-client.ts#L116)

**`Experimental`**

Adapt a single `onPrompt(prompt, ctx)` callback into a `SandboxClient` for
`runLoop` / `openSandboxRun`. Returns a PROPERLY-TYPED `SandboxClient`: the
lone `SandboxInstance` cast (object literal → `declare class`) lives inside
this function, so call sites stay cast-free.

#### Parameters

##### options

[`InProcessSandboxClientOptions`](#inprocesssandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-3)

***

### inlineSandboxClient()

> **inlineSandboxClient**(`factory`): [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/inline-sandbox-client.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/inline-sandbox-client.ts#L44)

Adapt an `ExecutorFactory` into a `SandboxClient` for `runLoop`. The factory is
instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
run once on the prompt, emit the terminal result event, tear down.

#### Parameters

##### factory

[`ExecutorFactory`](#executorfactory)\<`unknown`\>

#### Returns

[`SandboxClient`](#sandboxclient-3)

***

### envKeyProvider()

> **envKeyProvider**(`env?`): [`KeyProvider`](#keyprovider)

Defined in: [src/runtime/key-provider.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L43)

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

Defined in: [src/runtime/key-provider.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L59)

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

Defined in: [src/runtime/key-provider.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/key-provider.ts#L87)

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

### localSandboxClient()

> **localSandboxClient**(`opts`): [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/local-sandbox-client.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/local-sandbox-client.ts#L52)

A same-host `SandboxClient` adapter with no process isolation. Local MCP is
refused unless the caller explicitly supplies a policy that allows it.

#### Parameters

##### opts

[`LocalSandboxClientOptions`](#localsandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-3)

***

### loopCampaignDispatch()

> **loopCampaignDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `DispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: [src/runtime/loop-dispatch.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L217)

Adapter for plain `runCampaign` scenarios. This is the runtime-side pair for
agent-eval fixture scenarios: load fixtures in `agent-eval/campaign`, build
the runtime loop here, and keep cost + token + trace reporting automatic.

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

Defined in: [src/runtime/loop-dispatch.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L240)

Adapter for `runProfileMatrix` (profile is an axis). Returns a
`ProfileDispatchFn` that runs `runLoop` per (profile, scenario) cell and
reports usage automatically.

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

Defined in: [src/runtime/mcp-environment.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L83)

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

Defined in: [src/runtime/mcp-environment.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L97)

Wrap any MCP server as an `Environment`: `tools/list` becomes `AgenticTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks.

#### Parameters

##### opts

[`McpEnvironmentOptions`](#mcpenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### observe()

> **observe**(`input`, `opts`): `Promise`\<[`Observation`](#observation)\>

Defined in: [src/runtime/observe.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L140)

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

Defined in: [src/runtime/observe.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L227)

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

Defined in: [src/runtime/personify/analyst.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L97)

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

[`Scope`](#scope-1)\<[`Outcome`](#outcome-1)\<`D`\>\>

##### options

[`CreateScopeAnalystOptions`](#createscopeanalystoptions)\<`D`\>

#### Returns

[`ScopeAnalyst`](#scopeanalyst)\<`D`\>

***

### registryScopeAnalyst()

> **registryScopeAnalyst**\<`D`\>(`registry`, `buildInputs`): [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: [src/runtime/personify/analyst.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L203)

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

Defined in: [src/runtime/personify/analyst.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L231)

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

readonly [`Settled`](#settled-3)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

#### Returns

[`SteerContext`](#steercontext)\<`D`\>

***

### selectValidWinner()

> **selectValidWinner**\<`D`\>(`opts?`): [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

Defined in: [src/runtime/personify/combinators.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L60)

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

Defined in: [src/runtime/personify/combinators.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L102)

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

Defined in: [src/runtime/personify/combinators.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L144)

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

Defined in: [src/runtime/personify/combinators.ts:259](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L259)

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

Defined in: [src/runtime/personify/combinators.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L311)

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

Defined in: [src/runtime/personify/combinators.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L371)

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

Defined in: [src/runtime/personify/combinators.ts:425](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L425)

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

Defined in: [src/runtime/personify/combinators.ts:488](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L488)

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

Defined in: [src/runtime/personify/corpus.ts:302](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L302)

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

Defined in: [src/runtime/personify/persona.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L57)

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

> **runPersonified**\<`Task`, `D`\>(`options`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<[`Outcome`](#outcome-1)\<`D`\>\>\>

Defined in: [src/runtime/personify/persona.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L132)

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

`Promise`\<[`SupervisedResult`](#supervisedresult)\<[`Outcome`](#outcome-1)\<`D`\>\>\>

***

### createShapeRegistry()

> **createShapeRegistry**(): [`ShapeRegistry`](#shaperegistry)

Defined in: [src/runtime/personify/registry.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L26)

Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.

#### Returns

[`ShapeRegistry`](#shaperegistry)

***

### registerShape()

> **registerShape**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [src/runtime/personify/registry.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L54)

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

Defined in: [src/runtime/personify/trajectory.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L53)

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

Defined in: [src/runtime/personify/trajectory.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L144)

Assert the arms are comparable at EQUAL conserved COST (tokens + usd), NOT raw iteration
count. Compares each arm's root-rolled-up `total` on the two conserved channels: an arm is
within-tolerance when the per-channel spread (max − min across arms) over the median is
`≤ tolerance`. Pure over the reports — no I/O. Fails loud on an empty arm list (nothing to
compare) so a vacuous "equal" is never returned.

#### Parameters

##### arms

readonly [`EqualKArm`](#equalkarm)[]

##### options?

[`EqualKOnCostOptions`](#equalkoncostoptions) = `{}`

#### Returns

[`EqualKVerdict`](#equalkverdict)

***

### promotionGate()

> **promotionGate**(`opts`): [`PromotionVerdict`](#promotionverdict)

Defined in: [src/runtime/promotion-gate.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L64)

Statistical promotion decision over a holdout benchmark: a seeded paired bootstrap (`heldoutSignificance`) whose CI lower bound must clear `deltaThreshold`.

#### Parameters

##### opts

[`PromotionGateOptions`](#promotiongateoptions)

#### Returns

[`PromotionVerdict`](#promotionverdict)

***

### reportLoopUsage()

> **reportLoopUsage**\<`Task`, `Output`, `Decision`\>(`cost`, `result`, `source?`): `void`

Defined in: [src/runtime/report-usage.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L34)

Forward a `LoopResult`'s aggregated cost + token usage into a campaign cost
meter so the backend-integrity guard sees real LLM activity. `source`
defaults to `'loop'`.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Parameters

##### cost

[`UsageSink`](#usagesink)

##### result

`Pick`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>, `"costUsd"` \| `"tokenUsage"`\>

##### source?

`string` = `'loop'`

#### Returns

`void`

***

### resolveSandboxClient()

> **resolveSandboxClient**(`opts`): [`SandboxClient`](#sandboxclient-3)

Defined in: [src/runtime/resolve-sandbox-client.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/resolve-sandbox-client.ts#L62)

Resolve a `SandboxClient` for the chosen backend. The generic, dep-light core
that `resolveBenchClient` builds on — reuse this instead of hand-rolling the
`createExecutor`/`inlineSandboxClient` branch in each product.

#### Parameters

##### opts

[`ResolveSandboxClientOptions`](#resolvesandboxclientoptions)

#### Returns

[`SandboxClient`](#sandboxclient-3)

***

### routerChatWithUsage()

> **routerChatWithUsage**(`cfg`, `messages`, `opts?`): `Promise`\<[`RouterChatResult`](#routerchatresult)\>

Defined in: [src/runtime/router-client.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L49)

One OpenAI-compatible chat completion through the Tangle router, returning text + REAL token usage (`undefined` when the provider omits it — never a fabricated 0).

#### Parameters

##### cfg

[`RouterConfig`](#routerconfig)

##### messages

`object`[]

##### opts?

###### temperature?

`number`

###### signal?

`AbortSignal`

###### maxTokens?

`number`

###### reasoningEffort?

`"none"` \| `"low"` \| `"medium"` \| `"high"`

Reasoning control for thinking models, forwarded as `reasoning_effort`.
'none' is the load-bearing value: binary/single-token decisions (routing,
gating) on a thinking model otherwise burn the whole token budget inside
the think block — on slow backends (CPU-local) that turns into a client
timeout, not just waste. Providers that ignore the field are handled by
the reasoning/content split in `parseChatResult`.

#### Returns

`Promise`\<[`RouterChatResult`](#routerchatresult)\>

***

### routerChatWithTools()

> **routerChatWithTools**(`cfg`, `messages`, `tools`, `opts?`): `Promise`\<[`RouterChatToolsResult`](#routerchattoolsresult)\>

Defined in: [src/runtime/router-client.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L187)

A router completion WITH tool-calling — the operator driver's LLM seam. Passes OpenAI-shape
`messages` (system/user/assistant-with-tool_calls/tool roles) + function `tools`, and returns the
assistant text plus the tool calls the model wants run. Same fail-loud + real-usage discipline as
`routerChatWithUsage`. `tool_choice: 'auto'` lets the model decide; the driver loops on the result.

#### Parameters

##### cfg

[`RouterConfig`](#routerconfig)

##### messages

readonly `Record`\<`string`, `unknown`\>[]

##### tools

readonly `object`[]

##### opts?

###### temperature?

`number`

###### signal?

`AbortSignal`

###### toolChoice?

`"auto"` \| `"none"` \| `"required"`

###### maxTokens?

`number`

#### Returns

`Promise`\<[`RouterChatToolsResult`](#routerchattoolsresult)\>

***

### routerToolLoop()

> **routerToolLoop**(`cfg`, `system`, `user`, `tools`, `execute`, `opts?`): `Promise`\<[`RouterToolLoopResult`](#routertoolloopresult)\>

Defined in: [src/runtime/router-client.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L285)

The tool-using router backend: a real agentic loop OVER the Tangle router (which
supports tool-calling), off-box — no sandbox. Each turn is one router completion
with `tools`; if the model emits tool_calls, `execute` runs them on the host and
their results are folded back as `tool` messages; the loop repeats until the
model answers without a tool call or the turn budget is hit. One turn = one
inference call, so `maxTurns` is the equal-compute unit against random@k.

This is the depth substrate for agentic gates (the worker ACTS, observes the real
result, and continues) that the chat-only `routerChatWithUsage` cannot express.

#### Parameters

##### cfg

[`RouterConfig`](#routerconfig)

##### system

`string`

##### user

`string`

##### tools

readonly [`ToolSpec`](#toolspec)[]

##### execute

(`name`, `args`) => `Promise`\<`string`\>

##### opts?

###### maxTurns?

`number`

###### temperature?

`number`

###### signal?

`AbortSignal`

###### maxTokens?

`number`

###### initialMessages?

readonly `Record`\<`string`, `unknown`\>[]

Seed the loop with an existing conversation (depth continuation) instead of
 `[system, user]`. When set, `system`/`user` are ignored. The array is copied.

#### Returns

`Promise`\<[`RouterToolLoopResult`](#routertoolloopresult)\>

***

### routerBrain()

> **routerBrain**(`cfg`, `opts?`): [`ToolLoopChat`](#toolloopchat)

Defined in: [src/runtime/router-client.ts:327](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L327)

The router as a supervisor BRAIN: the canonical `ToolLoopChat` seam backed by the router's
tool-calling. The driver's spawn/observe/steer/await/stop turns become real router tool-calls.
The turnkey production brain — tests script a mock `ToolLoopChat`; production passes
`routerBrain(cfg)`. No message translation: the loop already speaks the router's OpenAI shape.

#### Parameters

##### cfg

[`RouterConfig`](#routerconfig)

##### opts?

###### temperature?

`number`

#### Returns

[`ToolLoopChat`](#toolloopchat)

***

### runBenchmark()

> **runBenchmark**(`cfg`): `Promise`\<[`BenchmarkReport`](#benchmarkreport)\>

Defined in: [src/runtime/run-benchmark.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L133)

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

Defined in: [src/runtime/run-benchmark.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L232)

Pretty-print a report — the "free optimization" verdict, with the cost vector.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

#### Returns

`void`

***

### runLoop()

> **runLoop**\<`Task`, `Output`, `Decision`\>(`options`): `Promise`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>\>

Defined in: [src/runtime/run-loop.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L143)

**`Experimental`**

The round-synchronous loop kernel: each round `driver.plan()` fans N tasks to sandboxes (bounded concurrency), parses + validates each output, and folds results through `driver.decide`.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Parameters

##### options

`RunLoopOptions`\<`Task`, `Output`, `Decision`\>

#### Returns

`Promise`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>\>

***

### defaultSelectWinner()

> **defaultSelectWinner**\<`Task`, `Output`\>(`iterations`): [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

Defined in: [src/runtime/run-loop.ts:1131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L1131)

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

### acquireSandbox()

> **acquireSandbox**(`client`, `options`, `acquire?`): `Promise`\<`SandboxInstance`\>

Defined in: [src/runtime/sandbox-acquire.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-acquire.ts#L73)

**`Experimental`**

Cold-start-resilient sandbox acquisition: create by name, observe readiness from the sandbox's own status (not the create call), and re-attach after gateway timeouts.

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-3)

##### options

`CreateSandboxOptions`

##### acquire?

`AcquireOptions` = `{}`

#### Returns

`Promise`\<`SandboxInstance`\>

***

### probeSandboxCapabilities()

> **probeSandboxCapabilities**(`client`): `Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

Defined in: [src/runtime/sandbox-capabilities.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L46)

**`Experimental`**

Probe (and memoize per client) what the loop may rely on. A client without a
`criuStatus` method, or whose probe rejects, yields `canFork = false` — a
failed probe must never claim a capability the platform may not have. The
promise is cached so concurrent fanout branches share one round-trip.

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-3)

#### Returns

`Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

***

### extractLlmCallEvent()

> **extractLlmCallEvent**(`event`, `agentRunName`): RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

Defined in: [src/runtime/sandbox-events.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L32)

Extract a `RuntimeStreamEvent`-shaped `llm_call` from a sandbox event when
the event carries usage/cost data. Returns `undefined` for non-cost events
so the kernel can iterate the full stream without branching.

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

Defined in: [src/runtime/sandbox-events.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L91)

Sum the token usage + USD cost of a sandbox turn's events — the one honest way to meter an
`openSandboxRun` cell. Folds `extractLlmCallEvent` over the stream (which reads usage off EVERY backend
event shape), so a `runProfileMatrix` dispatch can report it to `ctx.cost`:

    receipt: (turn) => {
      const u = sumSandboxUsage(turn.events)
      return { model, inputTokens: u.input, outputTokens: u.output,
        ...(u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}) }
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

***

### createSandboxToolPartState()

> **createSandboxToolPartState**(): [`SandboxToolPartState`](#sandboxtoolpartstate)

Defined in: [src/runtime/sandbox-events.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L161)

**`Experimental`**

Fresh per-turn [SandboxToolPartState](#sandboxtoolpartstate) for [mapSandboxToolEvent](#mapsandboxtoolevent) — an
empty call-status map so each turn projects tool frames independently.

#### Returns

[`SandboxToolPartState`](#sandboxtoolpartstate)

***

### mapSandboxToolEvent()

> **mapSandboxToolEvent**(`event`, `state`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) & `object`[]

Defined in: [src/runtime/sandbox-events.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L192)

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

Defined in: [src/runtime/sandbox-events.ts:319](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L319)

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

### createSandboxLineage()

> **createSandboxLineage**(`client`, `capabilities`, `options?`): [`SandboxLineage`](#sandboxlineage)

Defined in: [src/runtime/sandbox-lineage.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L203)

**`Experimental`**

Build a lineage bound to one client + its probed capabilities. The
capabilities are passed in (not re-probed) so the kernel probes once per run
and the lineage stays a pure function of "what this platform can do".

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-3)

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

Defined in: [src/runtime/sandbox-run.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L156)

**`Experimental`**

Open a sandbox run. Harness-agnostic: the harness lives in
`options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
kimi-code all flow through this one entrypoint with identical env/auth wiring.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-3)

##### options

[`OpenSandboxRunOptions`](#opensandboxrunoptions)

##### deliverable

[`Deliverable`](#deliverable)\<`Out`\>

#### Returns

`Promise`\<[`SandboxRun`](#sandboxrun)\<`Out`\>\>

***

### connectStdioMcp()

> **connectStdioMcp**(`spec`): `Promise`\<[`StdioMcpConnection`](#stdiomcpconnection)\>

Defined in: [src/runtime/stdio-mcp-client.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L118)

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

Defined in: [src/runtime/stdio-mcp-client.ts:328](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stdio-mcp-client.ts#L328)

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

### naiveDriver()

> **naiveDriver**\<`Task`, `Output`\>(`options`): [`Driver`](#driver-1)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

Defined in: [src/runtime/steering-drivers.ts:109](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L109)

`naiveDriver` — the no-signal steering control.

`plan()` runs the initial `task` at shot 0, then issues the SAME fixed
`continuation` every subsequent round until a shot is valid or the cap is
hit. It reads NOTHING from `history[last].verdict` — not `.valid`, not
`.notes`, not `.scores`. It is the floor a coached loop must beat to earn its
coaching: any lift over naive that is not also present in `dumb` is
attributable to the pass/fail bit, and any lift of `refine` over `dumb` is
attributable to the grader's findings.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Parameters

##### options

[`NaiveDriverOptions`](#naivedriveroptions)\<`Task`\>

#### Returns

[`Driver`](#driver-1)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

***

### dumbDriver()

> **dumbDriver**\<`Task`, `Output`\>(`options`): [`Driver`](#driver-1)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

Defined in: [src/runtime/steering-drivers.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/steering-drivers.ts#L168)

`dumbDriver` — the pass/fail-only steering control.

`plan()` runs the initial `task` at shot 0, then reads ONLY
`history[last].verdict.valid` (the boolean) and issues `onPass` or `onFail`
accordingly. It MUST NOT read `.notes` or `.scores` — that boundary is the
leak-free firewall. A `verdict` with no `valid` set (or no verdict) is
treated as not-valid, so the driver is total and never throws on a
grader/transport gap.

The `dumb → refine` gap is the headline measurement: refine reads the
grader's `notes`, dumb reads only the pass/fail bit, so the difference is
exactly the value the findings add over a bare boolean.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Parameters

##### options

[`DumbDriverOptions`](#dumbdriveroptions)\<`Task`\>

#### Returns

[`Driver`](#driver-1)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

***

### assertStrategyContract()

> **assertStrategyContract**(`code`): `void`

Defined in: [src/runtime/strategy-author.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L115)

Static CONTRACT lint over an authored strategy module — the module-boundary
 enforcement of the harness's two measurement invariants:
   - author blindness: the only import allowed is the loops surface. A body that could
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

Defined in: [src/runtime/strategy-author.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L182)

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

Defined in: [src/runtime/strategy-evolution.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L237)

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

Defined in: [src/runtime/strategy-evolution.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L262)

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

Defined in: [src/runtime/strategy-evolution.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L285)

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

Defined in: [src/runtime/strategy-evolution.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L365)

Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice.

#### Parameters

##### cfg

[`StrategyEvolutionConfig`](#strategyevolutionconfig)

#### Returns

`Promise`\<[`EvolutionReport`](#evolutionreport)\>

***

### depthStrategy()

> **depthStrategy**(`surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [src/runtime/strategy.ts:630](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L630)

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

[`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### breadthStrategy()

> **breadthStrategy**(`_surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [src/runtime/strategy.ts:701](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L701)

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

[`Agent`](#agent-1)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### defineStrategy()

> **defineStrategy**(`name`, `run`): [`Strategy`](#strategy-3)

Defined in: [src/runtime/strategy.ts:848](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L848)

Author a Strategy from the composable steps — the open, compact way.

#### Parameters

##### name

`string`

##### run

(`ctx`) => `Promise`\<[`StrategyResult`](#strategyresult)\>

#### Returns

[`Strategy`](#strategy-3)

***

### runAgentic()

> **runAgentic**(`opts`): `Promise`\<[`AgenticRunResult`](#agenticrunresult)\>

Defined in: [src/runtime/strategy.ts:1089](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L1089)

Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope.

#### Parameters

##### opts

[`RunAgenticOptions`](#runagenticoptions)

#### Returns

`Promise`\<[`AgenticRunResult`](#agenticrunresult)\>

***

### streamAgentTurn()

> **streamAgentTurn**(`backend`, `prompt`, `opts?`): `AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

Defined in: [src/runtime/stream-agent-turn.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L225)

**`Experimental`**

Run ONE agent turn on any backend kind and stream its events. Yields the
`RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
event carrying the turn's text and usage (`metadata.tokenUsage`,
`metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
timeout alike. The generator never throws; failures surface in-band as
`backend_error` + `final` with a typed `error` detail.

#### Parameters

##### backend

[`AgentTurnBackend`](#agentturnbackend)

##### prompt

`string`

##### opts?

[`StreamAgentTurnOptions`](#streamagentturnoptions) = `{}`

#### Returns

`AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

***

### collectAgentTurn()

> **collectAgentTurn**(`stream`): `Promise`\<[`CollectedAgentTurn`](#collectedagentturn)\>

Defined in: [src/runtime/stream-agent-turn.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/stream-agent-turn.ts#L298)

**`Experimental`**

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

Defined in: [src/runtime/structural-rollout.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L125)

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

Defined in: [src/runtime/structural-rollout.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L149)

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

Defined in: [src/runtime/structural-rollout.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L167)

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

Defined in: [src/runtime/structural-rollout.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L181)

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

Defined in: [src/runtime/structural-rollout.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L194)

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

Defined in: [src/runtime/structural-rollout.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L279)

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

Defined in: [src/runtime/structural-rollout.ts:347](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L347)

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

Defined in: [src/runtime/structural-rollout.ts:360](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L360)

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

Defined in: [src/runtime/structural-rollout.ts:367](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L367)

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

Defined in: [src/runtime/structural-rollout.ts:382](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L382)

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

Defined in: [src/runtime/structural-rollout.ts:403](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L403)

The candidate a shot produced, read from its conversation: the LAST `submit_answer`
 tool-call argument (verifier environments submit the artifact explicitly), else the
 latest assistant reply's fenced code block — preferring a block containing a `def`,
 because repair replies echo the failure report in a bare fence BEFORE the fixed code
 (the rigs' extractRepairCode lesson) — else the latest non-empty assistant text.

#### Parameters

##### messages

readonly `Msg`[]

#### Returns

`string`

***

### structuralRollout()

> **structuralRollout**(`config?`): [`Strategy`](#strategy-3)

Defined in: [src/runtime/structural-rollout.ts:525](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/structural-rollout.ts#L525)

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

[`Strategy`](#strategy-3)

***

### failuresAnalyst()

> **failuresAnalyst**(): [`AnalystRegistry`](#analystregistry)

Defined in: [src/runtime/supervise-surface.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L76)

The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 cases. Swap `analysts` to change what the driver improves from — that's the one knob.

#### Returns

[`AnalystRegistry`](#analystregistry)

***

### superviseSurface()

> **superviseSurface**(`profile`, `task`, `opts`): `Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

Defined in: [src/runtime/supervise-surface.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise-surface.ts#L205)

Drive a team of agents (spawned + steered by `profile`) to solve a graded `AgenticSurface` task, and
 report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
 — there is no other entrypoint to learn.

#### Parameters

##### profile

[`SupervisorProfile`](#supervisorprofile)

##### task

[`AgenticTask`](#agentictask)

##### opts

[`SuperviseSurfaceOptions`](#supervisesurfaceoptions)

#### Returns

`Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

***

### asAuthoredProfile()

> **asAuthoredProfile**(`raw`): [`AuthoredProfile`](#authoredprofile) \| `null`

Defined in: [src/runtime/supervise/authoring.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L35)

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

Defined in: [src/runtime/supervise/authoring.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L47)

The supervisor SKILL — the how-to the supervisor reads (its system prompt). THE optimizable
 surface: editing this changes how the supervisor designs every agent it spawns.

#### Parameters

##### opts?

###### goal?

`string`

#### Returns

`string`

***

### authoredWorker()

> **authoredWorker**(`profile`, `opts`): [`Agent`](#agent-1)\<`unknown`, `unknown`\>

Defined in: [src/runtime/supervise/authoring.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L67)

Build a worker AGENT from a profile the supervisor authored: the authored `systemPrompt` +
 `model` shape the worker's one model call; the deliverable gates settlement (valid ⟺ delivered).

#### Parameters

##### profile

[`AuthoredProfile`](#authoredprofile)

##### opts

###### cfg

[`RouterConfig`](#routerconfig)

###### taskPrompt

`string`

###### deliverable

[`DeliverableSpec`](#deliverablespec)

###### temperature?

`number`

#### Returns

[`Agent`](#agent-1)\<`unknown`, `unknown`\>

***

### assessAuthoredProfile()

> **assessAuthoredProfile**(`profile`, `opts?`): [`ProfileRichness`](#profilerichness)

Defined in: [src/runtime/supervise/authoring.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L182)

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

Defined in: [src/runtime/supervise/authoring.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L245)

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

> **spendFromUsageEvents**(`events`): [`Spend`](#spend)

Defined in: [src/runtime/supervise/budget.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L93)

Fold a normalized `UsageEvent` array into a `Spend`. Tokens and usd are separate
 channels; iterations come from `'iteration'` events. Pure; `ms` stays zero (the
 pool does not read wall-clock).

#### Parameters

##### events

[`UsageEvent`](#usageevent)[]

#### Returns

[`Spend`](#spend)

***

### createBudgetPool()

> **createBudgetPool**(`root`, `now?`): [`BudgetPool`](#budgetpool)

Defined in: [src/runtime/supervise/budget.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L136)

Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
absolute deadline is fixed at construction (`now() + budget.deadlineMs`) so the
readout's `deadlineMs` is a stable wall-clock instant, not a shrinking remainder.

#### Parameters

##### root

[`Budget`](#budget-12)

##### now?

() => `number`

#### Returns

[`BudgetPool`](#budgetpool)

***

### gateOnDeliverable()

> **gateOnDeliverable**\<`Out`\>(`inner`, `deliverable`): [`Executor`](#executor)\<`Out`\>

Defined in: [src/runtime/supervise/completion-gate.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L45)

Wrap an `Executor` so its settlement `valid` reflects the deliverable check, not the
inner verdict. Handles both `execute` shapes (one-shot `Promise<ExecutorResult>` and
streaming `AsyncIterable<UsageEvent>` + `resultArtifact()`); the check runs once the inner
executor has produced its output. The inner `score` is preserved; only `valid` is gated.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### inner

[`Executor`](#executor)\<`Out`\>

##### deliverable

[`DeliverableSpec`](#deliverablespec)\<`Out`\>

#### Returns

[`Executor`](#executor)\<`Out`\>

***

### driverAgent()

> **driverAgent**(`opts`): [`Agent`](#agent-1)\<`unknown`, `unknown`\>

Defined in: [src/runtime/supervise/coordination-driver.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L166)

Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
`driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.

#### Parameters

##### opts

[`DriverAgentOptions`](#driveragentoptions)

#### Returns

[`Agent`](#agent-1)\<`unknown`, `unknown`\>

***

### finalizeBestDelivered()

> **finalizeBestDelivered**(`settled`, `blobs`): `Promise`\<`unknown`\>

Defined in: [src/runtime/supervise/coordination-driver.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L378)

Keep-best finalize under the completion-oracle: return the highest-scoring DELIVERED child's
 output (settled `done` AND `valid` — its deliverable check passed). Returns undefined when no
 child delivered — an honest "the driver produced nothing", never a high-scoring result that
 ran without passing its check (Foreman's 0/18 lesson). `valid` is the single delivery signal,
 matching `defaultSelectWinner`'s valid-first rule; the oracle just doesn't fall back to an
 unchecked best-effort.

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

Defined in: [src/runtime/supervise/coordination-mcp.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L55)

Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 opencode locally, same host); pass `host` to bind elsewhere when the harness is remote.

#### Parameters

##### opts

###### scope

[`Scope`](#scope-1)\<`unknown`\>

###### blobs

[`ResultBlobStore`](#resultblobstore)

###### makeWorkerAgent

[`MakeWorkerAgent`](#makeworkeragent)

###### perWorker

[`Budget`](#budget-12)

###### maxLiveWorkers?

`number`

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap.

###### awaitTimeoutMs?

`number`

Max wall-clock ms a single `await_event` may block before returning a re-pollable
 `{ pending, live }` snapshot instead of erroring on the client's request timeout. Omit =
 DEFAULT\_AWAIT\_EVENT\_TIMEOUT\_MS; `<= 0` = prior unbounded block (in-process only).

###### port?

`number`

###### host?

`string`

###### analysts?

[`AnalystRegistry`](#analystregistry)

Trace-analyst lenses the driver can run (`run_analyst`) or auto-fire on settle.

###### analyzeOnSettle?

readonly `string`[]

Analyst kinds to auto-run when a worker settles `done` — findings flow up the bus.

###### onEvent?

(`event`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every bus event (settled / question / finding).

###### questionPolicy?

[`QuestionPolicy`](mcp.md#questionpolicy)

#### Returns

`Promise`\<[`CoordinationMcpHandle`](#coordinationmcphandle)\>

***

### delegate()

> **delegate**\<`Out`\>(`intent`, `opts?`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

Defined in: [src/runtime/supervise/delegate.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/delegate.ts#L89)

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

##### opts?

[`DelegateOptions`](#delegateoptions)\<`Out`\> = `{}`

#### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

***

### defaultToolDetectors()

> **defaultToolDetectors**(): `StreamingDetector`[]

Defined in: [src/runtime/supervise/detector-monitor.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L38)

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

Defined in: [src/runtime/supervise/detector-monitor.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L44)

Subscribe to a `TraceSource` and run the streaming detectors over its live spans. Returns an
 unsubscribe. A defensive `argHash` failure (circular args) never throws out of the side-channel.

#### Parameters

##### source

[`TraceSource`](#tracesource)

##### opts?

[`WatchTraceOptions`](#watchtraceoptions) = `{}`

#### Returns

() => `void`

***

### rollingDispatch()

> **rollingDispatch**\<`Out`\>(`scope`, `opts`): `Promise`\<[`DispatchReport`](#dispatchreport)\<`Out`\>\>

Defined in: [src/runtime/supervise/dispatch.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L106)

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

[`Scope`](#scope-1)\<`Out`\>

##### opts

[`RollingDispatchOptions`](#rollingdispatchoptions)\<`Out`\>

#### Returns

`Promise`\<[`DispatchReport`](#dispatchreport)\<`Out`\>\>

***

### freeSlots()

> **freeSlots**(`liveCount`, `cap`): `number` \| `null`

Defined in: [src/runtime/supervise/dispatch.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L181)

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

Defined in: [src/runtime/supervise/dispatch.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L208)

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

Defined in: [src/runtime/supervise/dispatch.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/dispatch.ts#L218)

Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where
 the queue is known up front and only the refill behavior is wanted.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### units

readonly `object`[]

##### budget

[`Budget`](#budget-12)

#### Returns

() => [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`

***

### createEventBus()

> **createEventBus**\<`E`\>(`now?`): [`EventBus`](#eventbus)\<`E`\>

Defined in: [src/runtime/supervise/event-bus.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L76)

Create the child→parent coordination bus: one typed pipe for settled outputs, questions, and analyst findings, with a priority-ordered pull queue and a pass-through subscribe lane.

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Parameters

##### now?

() => `number`

#### Returns

[`EventBus`](#eventbus)\<`E`\>

***

### createInbox()

> **createInbox**(): [`Inbox`](#inbox)

Defined in: [src/runtime/supervise/inbox.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L57)

Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle.

#### Returns

[`Inbox`](#inbox)

***

### assertModelAllowed()

> **assertModelAllowed**(`model`, `allowed`): `void`

Defined in: [src/runtime/supervise/model-policy.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/model-policy.ts#L14)

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

### patchDelivered()

> **patchDelivered**(`options?`): [`DeliverableSpec`](#deliverablespec)\<`WorktreeHarnessResult`\>

Defined in: [src/runtime/supervise/patch-deliverable.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L45)

**`Experimental`**

Build the `DeliverableSpec<WorktreePatchArtifact>`: `check(artifact)` runs the shared mechanical
gate (`runCoderChecks`) over the captured patch + the worktree-derived pass signals and returns
whether the patch is DELIVERED (the `valid` conjunction).

#### Parameters

##### options?

[`PatchDeliverableOptions`](#patchdeliverableoptions) = `{}`

#### Returns

[`DeliverableSpec`](#deliverablespec)\<`WorktreeHarnessResult`\>

***

### createInMemoryRunContext()

> **createInMemoryRunContext**(`opts?`): [`InMemoryRunContext`](#inmemoryruncontext)

Defined in: [src/runtime/supervise/run-context.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L72)

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

Defined in: [src/runtime/supervise/run-context.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L94)

Build a DURABLE run context: the spawn journal and the result blobs are file-backed (fsynced
per append/write) under `dir`, and the context carries `resume: true` so spreading it into
`SupervisorOpts` makes the supervisor `loadTree`-first. A run that dies mid-flight therefore
resumes when it is re-run with the SAME `runId` and the SAME `dir`: the committed children come
back on `Scope.resume` (rehydrated by `replaySpawnTree`) instead of being re-executed.

Layout: `${dir}/spawn-journal.jsonl` (one JSONL record per event) and `${dir}/blobs/` (one
content-addressed JSON file per settled result). The directory is created on first write.

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

### createExecutor()

> **createExecutor**(`config`): [`ExecutorFactory`](#executorfactory)\<`unknown`\>

Defined in: [src/runtime/supervise/runtime.ts:1557](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1557)

The single built-in executor factory. Picks a leaf backend by data (`config.backend`),
injects the matching seam, and delegates to that backend's built-in implementation.
The `Executor` port stays OPEN: bring-your-own agents implement `Executor` directly
and never pass through here. Use this (or `createExecutorRegistry`) instead of a
per-vendor adapter or a closed `inline|sandbox|cli` switch — those bypass the
`UsageEvent` reporting channel.

#### Parameters

##### config

[`ExecutorConfig`](#executorconfig)

#### Returns

[`ExecutorFactory`](#executorfactory)\<`unknown`\>

***

### createExecutorRegistry()

> **createExecutorRegistry**(): [`ExecutorRegistry`](#executorregistry)

Defined in: [src/runtime/supervise/runtime.ts:1603](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1603)

The open resolver/registry. Pre-registers the three built-ins under their
runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
factory)` for any additional runtime — and a BYO `AgentSpec.executor` resolves
without touching the registry at all. NOT a closed switch; registration + BYO
ARE the extension points.

`resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executor` →
`harness === null` → the `'router'` factory; else a registered factory for the
harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.

#### Returns

[`ExecutorRegistry`](#executorregistry)

***

### createScope()

> **createScope**\<`Out`\>(`args`): [`Scope`](#scope-1)\<`Out`\>

Defined in: [src/runtime/supervise/scope.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L209)

Create the reactive `Scope` a driver's `Agent.act` runs inside: spawn children on an atomically reserved conserved budget, settle via the `next()` cursor, journal for replay.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### args

`ScopeArgs`

#### Returns

[`Scope`](#scope-1)\<`Out`\>

***

### settledToIteration()

> **settledToIteration**\<`Out`\>(`settled`): [`Iteration`](#iteration-1)\<`unknown`, `Out`\>

Defined in: [src/runtime/supervise/scope.ts:707](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L707)

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

[`Settled`](#settled-3)\<`Out`\>

#### Returns

[`Iteration`](#iteration-1)\<`unknown`, `Out`\>

***

### workerFromBackend()

> **workerFromBackend**(`backend`, `deliverable?`): [`MakeWorkerAgent`](#makeworkeragent)

Defined in: [src/runtime/supervise/supervise.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L33)

Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 deliver"). The ONE place a backend becomes a spawnable worker.

#### Parameters

##### backend

[`ExecutorConfig`](#executorconfig)

##### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

#### Returns

[`MakeWorkerAgent`](#makeworkeragent)

***

### supervise()

> **supervise**(`profile`, `task`, `opts`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

Defined in: [src/runtime/supervise/supervise.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L138)

One-call supervisor: build + run a supervisor from its profile with sensible defaults; the raw `supervisorAgent` + `createSupervisor().run` seams stay available for power use.

#### Parameters

##### profile

[`SupervisorProfile`](#supervisorprofile)

##### task

`unknown`

##### opts

[`SuperviseOptions`](#superviseoptions)

#### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

***

### supervisorAgent()

> **supervisorAgent**(`profile`, `deps`): [`Agent`](#agent-1)\<`unknown`, `unknown`\>

Defined in: [src/runtime/supervise/supervisor-agent.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L110)

Build a supervisor `Agent` from its profile: the brain resolves from `profile.harness` (backend-as-data), the same resolution rule as every worker.

#### Parameters

##### profile

[`SupervisorProfile`](#supervisorprofile)

##### deps

[`SupervisorAgentDeps`](#supervisoragentdeps)

#### Returns

[`Agent`](#agent-1)\<`unknown`, `unknown`\>

***

### createSupervisor()

> **createSupervisor**\<`Task`, `Out`\>(): [`Supervisor`](#supervisor-1)\<`Task`, `Out`\>

Defined in: [src/runtime/supervise/supervisor.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor.ts#L83)

#### Type Parameters

##### Task

`Task`

##### Out

`Out`

#### Returns

[`Supervisor`](#supervisor-1)\<`Task`, `Out`\>

***

### decodeToolPart()

> **decodeToolPart**(`part`, `harness?`): `ToolStepInput` \| `undefined`

Defined in: [src/runtime/supervise/trace-source.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L147)

Decode a part with a specific harness's adapter when known, else try every registered adapter
 (the composite — robust to mixed/unknown streams). Never throws.

#### Parameters

##### part

`unknown`

##### harness?

`string`

#### Returns

`ToolStepInput` \| `undefined`

***

### createPushTraceSource()

> **createPushTraceSource**(`opts?`): `object`

Defined in: [src/runtime/supervise/trace-source.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L172)

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

> **source**: [`TraceSource`](#tracesource)

##### record

> **record**: (`input`) => `ToolSpan`

###### Parameters

###### input

`ToolStepInput`

###### Returns

`ToolSpan`

***

### sandboxSessionTraceSource()

> **sandboxSessionTraceSource**(`box`, `sessionId`, `opts?`): [`TraceSource`](#tracesource)

Defined in: [src/runtime/supervise/trace-source.ts:287](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L287)

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

[`TraceSource`](#tracesource)

***

### analyzeTrace()

> **analyzeTrace**(`source`, `runId?`): `Promise`\<[`TrajectoryAnalysis`](#trajectoryanalysis)\>

Defined in: [src/runtime/supervise/trajectory-recorder.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L28)

Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`.

#### Parameters

##### source

[`TraceSource`](#tracesource)

##### runId?

`string` = `'worker'`

#### Returns

`Promise`\<[`TrajectoryAnalysis`](#trajectoryanalysis)\>

***

### createWorktreeCliExecutor()

> **createWorktreeCliExecutor**(`options`): [`Executor`](#executor)\<`WorktreeHarnessResult`\>

Defined in: [src/runtime/supervise/worktree-cli-executor.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L107)

**`Experimental`**

Build a worktree-CLI leaf `Executor`. Per-spawn (a fresh worktree + abort + teardown each), so a
fanout of N profiles = N parallel worktrees that never clobber each other.

Fail-loud: an empty `repoRoot`/`harness`/`taskPrompt` throws at construction. `resultArtifact()`
before `execute()` resolves throws.

#### Parameters

##### options

[`WorktreeCliExecutorOptions`](#worktreecliexecutoroptions)

#### Returns

[`Executor`](#executor)\<`WorktreeHarnessResult`\>

***

### worktreeFanout()

> **worktreeFanout**\<`Task`\>(`options`): [`CombinatorShape`](#combinatorshape)\<`Task`, `WorktreeHarnessResult`\>

Defined in: [src/runtime/supervise/worktree-fanout.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L79)

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

[`CombinatorShape`](#combinatorshape)\<`Task`, `WorktreeHarnessResult`\>

***

### createVerifierEnvironment()

> **createVerifierEnvironment**(`opts`): [`AgenticSurface`](#agenticsurface)

Defined in: [src/runtime/verifier-environment.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L68)

Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it.

#### Parameters

##### opts

[`VerifierEnvironmentOptions`](#verifierenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### createWaterfallCollector()

> **createWaterfallCollector**(): [`WaterfallCollector`](#waterfallcollector)

Defined in: [src/runtime/waterfall.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L59)

Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline.

#### Returns

[`WaterfallCollector`](#waterfallcollector)

***

### localShell()

> **localShell**(): [`Shell`](#shell)

Defined in: [src/runtime/workspace.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L19)

Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit).

#### Returns

[`Shell`](#shell)

***

### gitWorkspace()

> **gitWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: [src/runtime/workspace.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L48)

A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned.

#### Parameters

##### opts

[`GitWorkspaceOptions`](#gitworkspaceoptions)

#### Returns

[`Workspace`](#workspace)

***

### jjWorkspace()

> **jjWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: [src/runtime/workspace.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L92)

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

Defined in: [src/runtime/workspace.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L151)

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
