[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / runtime

# runtime

## Classes

### InMemoryResultBlobStore

Defined in: src/durable/spawn-journal.ts:71

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

Defined in: src/durable/spawn-journal.ts:74

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

Defined in: src/durable/spawn-journal.ts:79

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### FileResultBlobStore

Defined in: src/durable/spawn-journal.ts:89

FS `ResultBlobStore`. One JSON file per artifact under `dir`, named by a
filesystem-safe encoding of the `outRef` (`sha256:<hex>` → `sha256-<hex>.json`).
`put` fsyncs so a crash between writes never loses an acknowledged blob.

#### Implements

- [`ResultBlobStore`](#resultblobstore)

#### Constructors

##### Constructor

> **new FileResultBlobStore**(`dir`): [`FileResultBlobStore`](#fileresultblobstore)

Defined in: src/durable/spawn-journal.ts:90

###### Parameters

###### dir

`string`

###### Returns

[`FileResultBlobStore`](#fileresultblobstore)

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: src/durable/spawn-journal.ts:92

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

Defined in: src/durable/spawn-journal.ts:105

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-3)

***

### InMemorySpawnJournal

Defined in: src/durable/spawn-journal.ts:141

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

Defined in: src/durable/spawn-journal.ts:144

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: src/durable/spawn-journal.ts:150

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

Defined in: src/durable/spawn-journal.ts:163

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

Defined in: src/durable/spawn-journal.ts:180

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

Defined in: src/durable/spawn-journal.ts:181

###### Parameters

###### path

`string`

###### Returns

[`FileSpawnJournal`](#filespawnjournal)

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

Defined in: src/durable/spawn-journal.ts:183

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

###### Implementation of

[`SpawnJournal`](#spawnjournal).[`loadTree`](#loadtree-2)

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: src/durable/spawn-journal.ts:213

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

Defined in: src/durable/spawn-journal.ts:226

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

### EnvironmentRunAbortError

Defined in: src/runtime/environment-run.ts:33

Abort error that retains events observed before cancellation.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new EnvironmentRunAbortError**(`events`, `readError?`): [`EnvironmentRunAbortError`](#environmentrunaborterror)

Defined in: src/runtime/environment-run.ts:38

###### Parameters

###### events

`AgentEnvironmentEvent`[]

###### readError?

`string`

###### Returns

[`EnvironmentRunAbortError`](#environmentrunaborterror)

###### Overrides

`Error.constructor`

#### Properties

##### name

> `readonly` **name**: `"AbortError"` = `'AbortError'`

Defined in: src/runtime/environment-run.ts:34

###### Overrides

`Error.name`

##### events

> `readonly` **events**: `AgentEnvironmentEvent`[]

Defined in: src/runtime/environment-run.ts:35

##### readError?

> `readonly` `optional` **readError?**: `string`

Defined in: src/runtime/environment-run.ts:36

***

### InMemoryCorpus

Defined in: src/runtime/personify/corpus.ts:162

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

Defined in: src/runtime/personify/corpus.ts:165

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

Defined in: src/runtime/personify/corpus.ts:187

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

Defined in: src/runtime/personify/corpus.ts:203

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

Defined in: src/runtime/personify/corpus.ts:204

###### Parameters

###### path

`string`

###### Returns

[`FileCorpus`](#filecorpus)

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: src/runtime/personify/corpus.ts:206

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

Defined in: src/runtime/personify/corpus.ts:234

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

### McpSpawnFault

Defined in: src/runtime/stdio-mcp-client.ts:90

A missing start binary / spawn fault: a SETUP bug, never a failed candidate.
 Graders (the serve verifier) must rethrow this instead of scoring it.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new McpSpawnFault**(`message?`): [`McpSpawnFault`](#mcpspawnfault)

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1080

###### Parameters

###### message?

`string`

###### Returns

[`McpSpawnFault`](#mcpspawnfault)

###### Inherited from

`Error.constructor`

##### Constructor

> **new McpSpawnFault**(`message?`, `options?`): [`McpSpawnFault`](#mcpspawnfault)

Defined in: node\_modules/.pnpm/typescript@6.0.3/node\_modules/typescript/lib/lib.es5.d.ts:1080

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

Defined in: src/mcp/tools/coordination.ts:70

#### Properties

##### kinds

> `readonly` **kinds**: readonly `object`[]

Defined in: src/mcp/tools/coordination.ts:71

##### run

> `readonly` **run**: (`kindId`, `trace`) => `Promise`\<`unknown`\>

Defined in: src/mcp/tools/coordination.ts:72

###### Parameters

###### kindId

`string`

###### trace

`unknown`

###### Returns

`Promise`\<`unknown`\>

***

### WorktreeCommandResult

Defined in: src/mcp/worktree-harness.ts:46

Outcome of one verification command run in the worktree (test or typecheck).

#### Properties

##### command

> **command**: `string`

Defined in: src/mcp/worktree-harness.ts:48

The shell command line that was run.

##### passed

> **passed**: `boolean`

Defined in: src/mcp/worktree-harness.ts:50

Did the command exit 0? The PASS signal a deliverable gate / coder output reads.

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: src/mcp/worktree-harness.ts:52

OS exit code, or `null` when killed before exit.

##### output

> **output**: `string`

Defined in: src/mcp/worktree-harness.ts:54

Combined stdout+stderr (capped) — surfaced in traces for diagnosis.

***

### WorktreeProfileMaterializationReceipt

Defined in: src/mcp/worktree-harness.ts:58

Proof of the profile inputs delivered before the worker process started.

#### Properties

##### workspacePlanDigest

> **workspacePlanDigest**: `string`

Defined in: src/mcp/worktree-harness.ts:60

Digest of the exact materializer plan: files, modes, environment, flags, and unsupported rows.

##### writtenPaths

> **writtenPaths**: `string`[]

Defined in: src/mcp/worktree-harness.ts:62

Repository-relative profile input files written into the worker worktree.

##### unsupported

> **unsupported**: `Unsupported`[]

Defined in: src/mcp/worktree-harness.ts:64

Must be empty on a successful run because this path fails closed.

##### environmentNames

> **environmentNames**: `string`[]

Defined in: src/mcp/worktree-harness.ts:66

Environment variable names added to the worker process. Values remain out of telemetry.

##### flags

> **flags**: `string`[]

Defined in: src/mcp/worktree-harness.ts:68

Exact additional CLI arguments emitted by the materializer.

##### resourceInstructions

> **resourceInstructions**: `object`

Defined in: src/mcp/worktree-harness.ts:70

`resources.instructions` bypasses native project files so reproducible Codex cannot drop it.

###### delivery

> **delivery**: `"none"` \| `"invocation-prompt"`

###### sha256

> **sha256**: `string` \| `null`

###### byteLength

> **byteLength**: `number`

***

### AnytimeTaskCurve

Defined in: src/runtime/anytime.ts:25

#### Properties

##### taskId

> **taskId**: `string`

Defined in: src/runtime/anytime.ts:26

##### strategy

> **strategy**: `string`

Defined in: src/runtime/anytime.ts:27

##### points

> **points**: `object`[]

Defined in: src/runtime/anytime.ts:30

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

Defined in: src/runtime/anytime.ts:33

Per satisficing target (keyed by the target value as a string): the first point
 where best ≥ target, or null when never reached within budget.

***

### AnytimeStrategySummary

Defined in: src/runtime/anytime.ts:36

#### Properties

##### strategy

> **strategy**: `string`

Defined in: src/runtime/anytime.ts:37

##### target

> **target**: `number`

Defined in: src/runtime/anytime.ts:39

The satisficing target this row summarizes.

##### tasks

> **tasks**: `number`

Defined in: src/runtime/anytime.ts:40

##### reachedTarget

> **reachedTarget**: `number`

Defined in: src/runtime/anytime.ts:41

##### medianTttMs

> **medianTttMs**: `number` \| `null`

Defined in: src/runtime/anytime.ts:43

Median time-to-target over the tasks that reached it (null when none did).

##### medianShotsToTarget

> **medianShotsToTarget**: `number` \| `null`

Defined in: src/runtime/anytime.ts:44

##### ertMs

> **ertMs**: `number` \| `null`

Defined in: src/runtime/anytime.ts:46

COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed.

##### erUsd

> **erUsd**: `number` \| `null`

Defined in: src/runtime/anytime.ts:48

Same construction over dollars: Σ all spend / #successes.

##### curveByShot

> **curveByShot**: `number`[]

Defined in: src/runtime/anytime.ts:50

Mean best-so-far score by shot index (the anytime curve, averaged over tasks).

##### auc

> **auc**: `number`

Defined in: src/runtime/anytime.ts:52

Area under the per-shot anytime curve, normalized to [0,1].

***

### AnytimeReport

Defined in: src/runtime/anytime.ts:55

#### Properties

##### targets

> **targets**: `number`[]

Defined in: src/runtime/anytime.ts:56

##### perTask

> **perTask**: [`AnytimeTaskCurve`](#anytimetaskcurve)[]

Defined in: src/runtime/anytime.ts:57

##### perStrategy

> **perStrategy**: [`AnytimeStrategySummary`](#anytimestrategysummary)[]

Defined in: src/runtime/anytime.ts:59

One summary per (strategy, target) pair — the COCO-style multi-target view.

***

### AuditIntentInput

Defined in: src/runtime/audit-intent.ts:29

#### Properties

##### declaredIntent

> **declaredIntent**: `string`

Defined in: src/runtime/audit-intent.ts:31

The declared intent: the task text / acceptance criteria the agent was given.

##### trace

> **trace**: readonly `unknown`[]

Defined in: src/runtime/audit-intent.ts:33

The trajectory so far — tool calls + results + assistant turns (any event shapes).

##### userIntent?

> `optional` **userIntent?**: `string`

Defined in: src/runtime/audit-intent.ts:35

The principal's actual intent when it differs from the literal task (the contract).

##### metaIntent?

> `optional` **metaIntent?**: `string`

Defined in: src/runtime/audit-intent.ts:38

The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
 flag locally-sensible work that serves the wrong larger objective.

##### runId?

> `optional` **runId?**: `string`

Defined in: src/runtime/audit-intent.ts:39

***

### AuditIntentOptions

Defined in: src/runtime/audit-intent.ts:42

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: src/runtime/audit-intent.ts:43

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/audit-intent.ts:44

##### auditorInstruction?

> `optional` **auditorInstruction?**: `string`

Defined in: src/runtime/audit-intent.ts:46

Override the auditor instruction (optimizable like any analyst prompt).

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: src/runtime/audit-intent.ts:48

Cap trace lines fed to the auditor. Default 80.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/audit-intent.ts:49

***

### IntentAudit

Defined in: src/runtime/audit-intent.ts:52

#### Properties

##### revealedIntent

> **revealedIntent**: `string`

Defined in: src/runtime/audit-intent.ts:54

What the agent's actions reveal it is actually optimizing — one sentence.

##### verdict

> **verdict**: `"aligned"` \| `"drifting"` \| `"diverged"`

Defined in: src/runtime/audit-intent.ts:55

##### evidence

> **evidence**: `string`

Defined in: src/runtime/audit-intent.ts:57

Trajectory-grounded evidence for the verdict (specific calls/patterns).

##### recommendation

> **recommendation**: `"abort"` \| `"continue"` \| `"steer"`

Defined in: src/runtime/audit-intent.ts:59

The single recommended intervention.

##### steer?

> `optional` **steer?**: `string`

Defined in: src/runtime/audit-intent.ts:61

When recommendation is 'steer': the corrective instruction to inject.

##### confidence

> **confidence**: `number`

Defined in: src/runtime/audit-intent.ts:62

***

### LeaderboardOptions

Defined in: src/runtime/benchmark-report.ts:39

#### Properties

##### title?

> `readonly` `optional` **title?**: `string`

Defined in: src/runtime/benchmark-report.ts:40

##### scoreOf?

> `readonly` `optional` **scoreOf?**: `ScoreOf`

Defined in: src/runtime/benchmark-report.ts:41

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: `ProfileKeyOf`

Defined in: src/runtime/benchmark-report.ts:42

##### groupOf?

> `readonly` `optional` **groupOf?**: `GroupOf`

Defined in: src/runtime/benchmark-report.ts:43

##### axisScoresOf?

> `readonly` `optional` **axisScoresOf?**: `AxisScoresOf`

Defined in: src/runtime/benchmark-report.ts:44

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

Defined in: src/runtime/benchmark-report.ts:46

Display label for a profile key. Defaults to the record's harness and model.

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/benchmark-report.ts:48

Commit SHA / dataset / dates surfaced in the provenance block.

##### stats?

> `readonly` `optional` **stats?**: `boolean`

Defined in: src/runtime/benchmark-report.ts:51

Compute per-row confidence intervals (bootstrap on score, Wilson on pass rate). Needs a
 `scenarioId` on every record (reps are collapsed per scenario for the honest n). Default off.

##### passThreshold?

> `readonly` `optional` **passThreshold?**: `number`

Defined in: src/runtime/benchmark-report.ts:54

A score ≥ this counts as a "pass" for the pass-rate proportion + its Wilson CI. Default 0.999
 (fully solved). Lower it (e.g. 0.6) for a partial-credit domain.

***

### Interval

Defined in: src/runtime/benchmark-report.ts:58

A 95%-by-default confidence interval.

#### Properties

##### lower

> `readonly` **lower**: `number`

Defined in: src/runtime/benchmark-report.ts:59

##### upper

> `readonly` **upper**: `number`

Defined in: src/runtime/benchmark-report.ts:60

***

### LeaderboardRow

Defined in: src/runtime/benchmark-report.ts:64

One leaderboard row for one canonical profile and one data split.

#### Properties

##### profileKey

> `readonly` **profileKey**: `string`

Defined in: src/runtime/benchmark-report.ts:65

##### splitTag

> `readonly` **splitTag**: `RunSplitTag`

Defined in: src/runtime/benchmark-report.ts:66

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/benchmark-report.ts:67

##### model

> `readonly` **model**: `string`

Defined in: src/runtime/benchmark-report.ts:68

##### runCount

> `readonly` **runCount**: `number`

Defined in: src/runtime/benchmark-report.ts:69

##### scenarioCount

> `readonly` **scenarioCount**: `number`

Defined in: src/runtime/benchmark-report.ts:70

##### meanScore

> `readonly` **meanScore**: `number`

Defined in: src/runtime/benchmark-report.ts:71

##### solveRate

> `readonly` **solveRate**: `number`

Defined in: src/runtime/benchmark-report.ts:73

Fraction of scenario means scoring at least `passThreshold`.

##### perAxis

> `readonly` **perAxis**: `Record`\<`string`, `number`\>

Defined in: src/runtime/benchmark-report.ts:75

Axis to scenario-weighted mean score.

##### observedCostUsd

> `readonly` **observedCostUsd**: `number`

Defined in: src/runtime/benchmark-report.ts:76

##### estimatedCostUsd

> `readonly` **estimatedCostUsd**: `number`

Defined in: src/runtime/benchmark-report.ts:77

##### uncapturedCostRunCount

> `readonly` **uncapturedCostRunCount**: `number`

Defined in: src/runtime/benchmark-report.ts:78

##### tokensIn

> `readonly` **tokensIn**: `number`

Defined in: src/runtime/benchmark-report.ts:79

##### tokensOut

> `readonly` **tokensOut**: `number`

Defined in: src/runtime/benchmark-report.ts:80

##### latencyP50Ms

> `readonly` **latencyP50Ms**: `number`

Defined in: src/runtime/benchmark-report.ts:81

##### latencyP90Ms

> `readonly` **latencyP90Ms**: `number`

Defined in: src/runtime/benchmark-report.ts:82

##### scoreCi?

> `readonly` `optional` **scoreCi?**: [`Interval`](#interval)

Defined in: src/runtime/benchmark-report.ts:85

Bootstrap CI on the mean score — present only when `opts.stats` is set. Computed over
 per-scenario means (reps collapsed first), so identical reps can't fake a narrow interval.

##### passCi?

> `readonly` `optional` **passCi?**: [`Interval`](#interval)

Defined in: src/runtime/benchmark-report.ts:87

Wilson CI on the pass rate — present only when `opts.stats` is set.

***

### Leaderboard

Defined in: src/runtime/benchmark-report.ts:90

#### Properties

##### title

> `readonly` **title**: `string`

Defined in: src/runtime/benchmark-report.ts:91

##### axes

> `readonly` **axes**: readonly `string`[]

Defined in: src/runtime/benchmark-report.ts:93

Column order — scenario groups (default) or dimension keys (`axisScoresOf`).

##### profiles

> `readonly` **profiles**: readonly [`LeaderboardRow`](#leaderboardrow)[]

Defined in: src/runtime/benchmark-report.ts:95

Rows ranked by `meanScore` descending, then label.

##### meta

> `readonly` **meta**: `Record`\<`string`, `string`\>

Defined in: src/runtime/benchmark-report.ts:96

##### provenance

> `readonly` **provenance**: `object`

Defined in: src/runtime/benchmark-report.ts:98

Counts and cost coverage for the complete report input.

###### runCount

> `readonly` **runCount**: `number`

###### scenarioCount

> `readonly` **scenarioCount**: `number`

###### profiles

> `readonly` **profiles**: `number`

###### axes

> `readonly` **axes**: `number`

###### models

> `readonly` **models**: readonly `string`[]

###### splits

> `readonly` **splits**: readonly `RunSplitTag`[]

###### observedCostUsd

> `readonly` **observedCostUsd**: `number`

###### estimatedCostUsd

> `readonly` **estimatedCostUsd**: `number`

###### uncapturedCostRunCount

> `readonly` **uncapturedCostRunCount**: `number`

***

### PairwiseVerdict

Defined in: src/runtime/benchmark-report.ts:383

One profile pair compared on the scenarios they BOTH ran — the "who actually beat whom" verdict.

#### Properties

##### splitTag

> `readonly` **splitTag**: `RunSplitTag`

Defined in: src/runtime/benchmark-report.ts:384

##### a

> `readonly` **a**: `string`

Defined in: src/runtime/benchmark-report.ts:385

##### b

> `readonly` **b**: `string`

Defined in: src/runtime/benchmark-report.ts:386

##### pairs

> `readonly` **pairs**: `number`

Defined in: src/runtime/benchmark-report.ts:388

Paired unit count (shared scenarios). The significance is suppressed below `minPairs`.

##### delta

> `readonly` **delta**: `number`

Defined in: src/runtime/benchmark-report.ts:390

Median paired delta (b − a) and its bootstrap CI.

##### ciLow

> `readonly` **ciLow**: `number`

Defined in: src/runtime/benchmark-report.ts:391

##### ciHigh

> `readonly` **ciHigh**: `number`

Defined in: src/runtime/benchmark-report.ts:392

##### p

> `readonly` **p**: `number`

Defined in: src/runtime/benchmark-report.ts:394

Paired-test p-value (before correction).

##### significant

> `readonly` **significant**: `boolean`

Defined in: src/runtime/benchmark-report.ts:396

BH-significant across ALL pairs AND above the `minPairs` power floor.

***

### PairwiseOptions

Defined in: src/runtime/benchmark-report.ts:399

#### Properties

##### scoreOf?

> `readonly` `optional` **scoreOf?**: `ScoreOf`

Defined in: src/runtime/benchmark-report.ts:400

##### profileKeyOf?

> `readonly` `optional` **profileKeyOf?**: `ProfileKeyOf`

Defined in: src/runtime/benchmark-report.ts:401

##### labelOf?

> `readonly` `optional` **labelOf?**: (`profileKey`) => `string`

Defined in: src/runtime/benchmark-report.ts:402

###### Parameters

###### profileKey

`string`

###### Returns

`string`

##### fdr?

> `readonly` `optional` **fdr?**: `number`

Defined in: src/runtime/benchmark-report.ts:404

False-discovery rate for the Benjamini–Hochberg correction. Default 0.05.

##### minPairs?

> `readonly` `optional` **minPairs?**: `number`

Defined in: src/runtime/benchmark-report.ts:407

Below this many shared scenarios a paired test can't defensibly separate two profiles, so the
 `significant` tag is suppressed regardless of p (small-n mirage protection). Default 12.

***

### CompletionEvidence

Defined in: src/runtime/completion.ts:30

Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 never the judge's own verdict. Mirrors the steer-firewall's provenance discipline.

#### Properties

##### kind

> **kind**: `"artifact"` \| `"metric"`

Defined in: src/runtime/completion.ts:31

##### uri

> **uri**: `string`

Defined in: src/runtime/completion.ts:32

***

### CompletionVerdict

Defined in: src/runtime/completion.ts:36

The "is it done?" verdict an analyst returns to the parent.

#### Properties

##### done

> **done**: `boolean`

Defined in: src/runtime/completion.ts:37

##### determinism

> **determinism**: `"deterministic"` \| `"probabilistic"`

Defined in: src/runtime/completion.ts:39

How verifiable the claim is — sets whether the driver trusts it or validates it.

##### reasons?

> `optional` **reasons?**: `string`

Defined in: src/runtime/completion.ts:41

Why the analyst believes it is (or isn't) done — what the driver validates.

##### confidence?

> `optional` **confidence?**: `number`

Defined in: src/runtime/completion.ts:43

0..1, for probabilistic verdicts; the driver's validation threshold reads this.

##### evidence?

> `optional` **evidence?**: readonly [`CompletionEvidence`](#completionevidence)[]

Defined in: src/runtime/completion.ts:44

***

### CompletionAnalyst

Defined in: src/runtime/completion.ts:49

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

Defined in: src/runtime/completion.ts:50

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

Defined in: src/runtime/completion.ts:58

When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 probabilistic → validate by confidence threshold (the driver's check).

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: src/runtime/completion.ts:60

Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8.

***

### LeaderboardScore

Defined in: src/runtime/define-leaderboard.ts:66

Structured per-case verdict a `score` function may return (a bare number is
 shorthand for `{ composite }`). `composite` is the [0,1] leaderboard score;
 `dimensions` are recorded as extra judge dimensions.

#### Properties

##### composite

> **composite**: `number`

Defined in: src/runtime/define-leaderboard.ts:67

##### dimensions?

> `optional` **dimensions?**: `Record`\<`string`, `number`\>

Defined in: src/runtime/define-leaderboard.ts:68

##### notes?

> `optional` **notes?**: `string`

Defined in: src/runtime/define-leaderboard.ts:69

***

### LeaderboardScenario

Defined in: src/runtime/define-leaderboard.ts:74

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

Defined in: src/runtime/define-leaderboard.ts:75

***

### LeaderboardFlagSpec

Defined in: src/runtime/define-leaderboard.ts:80

One extra CLI flag a spec declares. Parsed by `run()` as `--<name> <value>`
 and surfaced to every hook via `ctx.args`.

#### Properties

##### default?

> `optional` **default?**: `string`

Defined in: src/runtime/define-leaderboard.ts:81

##### description

> **description**: `string`

Defined in: src/runtime/define-leaderboard.ts:82

***

### LeaderboardRunContext

Defined in: src/runtime/define-leaderboard.ts:86

Resolved run configuration handed to `setup` / `teardown` / `export`.

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/define-leaderboard.ts:87

##### provider

> **provider**: `string`

Defined in: src/runtime/define-leaderboard.ts:89

Environment provider name selected by `--provider`.

##### runDir

> **runDir**: `string`

Defined in: src/runtime/define-leaderboard.ts:90

##### exportDir

> **exportDir**: `string`

Defined in: src/runtime/define-leaderboard.ts:91

##### args

> **args**: `Record`\<`string`, `string` \| `undefined`\>

Defined in: src/runtime/define-leaderboard.ts:93

Every parsed flag (standard + `spec.flags`), by name without `--`.

##### harnesses

> **harnesses**: readonly `HarnessType`[]

Defined in: src/runtime/define-leaderboard.ts:94

##### models

> **models**: readonly `string`[]

Defined in: src/runtime/define-leaderboard.ts:96

Snapshot-stamped model ids (`name@snapshot`) — the eval identity models.

##### caseIds

> **caseIds**: readonly `string`[]

Defined in: src/runtime/define-leaderboard.ts:97

##### shots

> **shots**: `number`

Defined in: src/runtime/define-leaderboard.ts:98

##### reps

> **reps**: `number`

Defined in: src/runtime/define-leaderboard.ts:99

***

### LeaderboardBenchTask

Defined in: src/runtime/define-leaderboard.ts:104

Structurally `BenchTask` (bench registry shape) — declared locally so this
 module adds no dependency on a benchmark package.

#### Properties

##### id

> **id**: `string`

Defined in: src/runtime/define-leaderboard.ts:105

##### prompt

> **prompt**: `string`

Defined in: src/runtime/define-leaderboard.ts:106

##### split?

> `optional` **split?**: `string`

Defined in: src/runtime/define-leaderboard.ts:107

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: src/runtime/define-leaderboard.ts:108

***

### LeaderboardBenchScore

Defined in: src/runtime/define-leaderboard.ts:112

Structurally `BenchScore` (bench registry shape).

#### Properties

##### resolved

> **resolved**: `boolean`

Defined in: src/runtime/define-leaderboard.ts:113

##### score

> **score**: `number`

Defined in: src/runtime/define-leaderboard.ts:114

##### detail?

> `optional` **detail?**: `string`

Defined in: src/runtime/define-leaderboard.ts:115

***

### LeaderboardBenchmarkAdapter

Defined in: src/runtime/define-leaderboard.ts:122

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

Defined in: src/runtime/define-leaderboard.ts:123

#### Methods

##### preflight()

> **preflight**(): `Promise`\<`void`\>

Defined in: src/runtime/define-leaderboard.ts:124

###### Returns

`Promise`\<`void`\>

##### loadTasks()

> **loadTasks**(`opts?`): `Promise`\<[`LeaderboardBenchTask`](#leaderboardbenchtask)[]\>

Defined in: src/runtime/define-leaderboard.ts:125

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

Defined in: src/runtime/define-leaderboard.ts:130

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### artifact

`TArtifact`

###### Returns

`Promise`\<[`LeaderboardBenchScore`](#leaderboardbenchscore)\>

##### goldArtifact()

> **goldArtifact**(`task`): `Promise`\<`string` \| `undefined`\>

Defined in: src/runtime/define-leaderboard.ts:131

###### Parameters

###### task

[`LeaderboardBenchTask`](#leaderboardbenchtask)

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### LeaderboardIterationInfo

Defined in: src/runtime/define-leaderboard.ts:137

Per-shot outcome context passed as `onCellEvents`'s third argument — how a
 thrown shot (which never reaches `parseOutput`) stays visible through the
 facade instead of surfacing only as an empty zero-token cell.

#### Properties

##### index

> **index**: `number`

Defined in: src/runtime/define-leaderboard.ts:139

0-based shot index within the cell.

##### error?

> `optional` **error?**: `string`

Defined in: src/runtime/define-leaderboard.ts:141

The shot's thrown error message, when the shot failed before scoring.

##### verdict?

> `optional` **verdict?**: `object`

Defined in: src/runtime/define-leaderboard.ts:143

The shot's validator verdict, when the shot reached scoring.

###### score?

> `optional` **score?**: `number`

***

### LeaderboardSpec

Defined in: src/runtime/define-leaderboard.ts:152

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

Defined in: src/runtime/define-leaderboard.ts:154

Leaderboard name — the scenario `kind`, default profile name, and report title.

##### cases

> **cases**: `TCase`[]

Defined in: src/runtime/define-leaderboard.ts:156

The case corpus. Every case needs a stable string id (see `caseId`).

##### caseId?

> `optional` **caseId?**: (`c`) => `string`

Defined in: src/runtime/define-leaderboard.ts:159

Stable id extractor. Default: the case's own `id` property (fail-loud
 when absent or not a string).

###### Parameters

###### c

`TCase`

###### Returns

`string`

##### prompt

> **prompt**: (`c`) => `string` \| `Promise`\<`string`\>

Defined in: src/runtime/define-leaderboard.ts:162

The per-case task prompt. May be async (e.g. built by shelling out to a
 reference implementation); resolved ONCE per case before dispatch.

###### Parameters

###### c

`TCase`

###### Returns

`string` \| `Promise`\<`string`\>

##### score

> **score**: (`output`, `c`) => `number` \| [`LeaderboardScore`](#leaderboardscore)

Defined in: src/runtime/define-leaderboard.ts:166

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

Defined in: src/runtime/define-leaderboard.ts:170

Harness × model axes for `expandProfileAxes`. Defaults: the canonical
 `CODING_HARNESSES` × the base profile's `model.default`. `--harnesses` /
 `--models` override per run.

###### harnesses?

> `optional` **harnesses?**: readonly `HarnessType`[]

###### models?

> `optional` **models?**: readonly `string`[]

##### baseProfile?

> `optional` **baseProfile?**: `AgentProfile`

Defined in: src/runtime/define-leaderboard.ts:173

Base profile the axes expand over (prompt/tools/skills held fixed).
 Default: a minimal `{ name, model: { default: <first model> } }`.

##### providers?

> `optional` **providers?**: `Record`\<`string`, (() => `AgentEnvironmentProvider`) \| `undefined`\>

Defined in: src/runtime/define-leaderboard.ts:180

Provider registry: `--provider <name>` picks the official
`AgentEnvironmentProvider` used by every cell. `cli-bridge` is available by
default and reads `CLI_BRIDGE_URL` plus `BRIDGE_BEARER` or
`CLI_BRIDGE_BEARER`. Product providers extend or replace that default.

##### flags?

> `optional` **flags?**: `Record`\<`string`, [`LeaderboardFlagSpec`](#leaderboardflagspec)\>

Defined in: src/runtime/define-leaderboard.ts:182

Extra `--flag value` CLI args `run()` parses and surfaces via `ctx.args`.

##### setup?

> `optional` **setup?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/define-leaderboard.ts:184

Runs once before the matrix (fetch fixtures, warm caches).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### teardown?

> `optional` **teardown?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/define-leaderboard.ts:186

Runs once after the matrix, even on failure (reap boxes, close handles).

###### Parameters

###### ctx

[`LeaderboardRunContext`](#leaderboardruncontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onCellEvents?

> `optional` **onCellEvents?**: (`events`, `c`, `iteration?`) => `void`

Defined in: src/runtime/define-leaderboard.ts:192

Per-cell event tap: the raw provider events of every shot, with the case.
 the seam for domain metric capture (search counts, citations) without a
 substrate change. Fires once per shot after the cell's loop settles, in
 shot order, including thrown shots (whose events may be partial or empty);
 the third argument carries the shot's index + error/verdict outcome.

###### Parameters

###### events

readonly `AgentEnvironmentEvent`[]

###### c

`TCase`

###### iteration?

[`LeaderboardIterationInfo`](#leaderboarditerationinfo)

###### Returns

`void`

##### parseOutput?

> `optional` **parseOutput?**: (`events`, `c`) => `TArtifact`

Defined in: src/runtime/define-leaderboard.ts:202

Output decode override: raw events to the scored artifact. Default:
 `collectEnvironmentResponseText` (final answer text; empty string when the
 stream carried none, which then scores 0). The default only
 produces `string`, so a spec with a structured `TArtifact` MUST supply
 this (or a LEVEL-2 `dispatch`).

###### Parameters

###### events

readonly `AgentEnvironmentEvent`[]

###### c

`TCase`

###### Returns

`TArtifact`

##### resolveModel?

> `optional` **resolveModel?**: (`events`) => `string` \| `undefined`

Defined in: src/runtime/define-leaderboard.ts:212

Resolve the model the provider actually served from a shot's raw events.
Required for HARNESS_NATIVE_MODEL-snapped cells (a vendor-locked harness ×
an out-of-family model expands to the `default` sentinel): the RunRecord
must pin a real snapshot-bearing model id, which only the dispatch,
reading the provider's usage and terminal events, can know. When this returns
a value the default dispatch records it on the paid-call receipt;
in-family cells (concrete declared model) never need it.

###### Parameters

###### events

readonly `AgentEnvironmentEvent`[]

###### Returns

`string` \| `undefined`

##### export?

> `optional` **export?**: (`result`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/define-leaderboard.ts:215

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

Defined in: src/runtime/define-leaderboard.ts:221

LEVEL 2 — full dispatch replacement (in-process products bring their own).
 The default is `loopDispatch` + `naiveDriver` over the resolved provider.

##### judges?

> `optional` **judges?**: `JudgeConfig`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>[]

Defined in: src/runtime/define-leaderboard.ts:223

LEVEL 2 — full judge replacement. Default: `score` wrapped as one judge.

##### shots?

> `optional` **shots?**: `number`

Defined in: src/runtime/define-leaderboard.ts:225

Naive-retry shot cap per cell (`--shots`). Default 1.

##### reps?

> `optional` **reps?**: `number`

Defined in: src/runtime/define-leaderboard.ts:227

Replicates per cell (`--reps`). Default 1.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`profile`, `scenario`) => MaximumCharge \| undefined)

Defined in: src/runtime/define-leaderboard.ts:230

Provider- or executor-enforced maximum for one cell dispatch. Required
before execution when `matrix.costCeiling` is configured.

##### matrix?

> `optional` **matrix?**: `Partial`\<`RunProfileMatrixOptions`\<[`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>, `TArtifact`\>\>

Defined in: src/runtime/define-leaderboard.ts:236

Passthrough overrides spread onto the final `runProfileMatrix` call
 (e.g. `maxConcurrency`, `costCeiling`, `integrity`, `storage`) — spread
 LAST, so anything the facade wired can be overridden.

***

### DefinedLeaderboard

Defined in: src/runtime/define-leaderboard.ts:239

#### Type Parameters

##### TCase

`TCase`

##### TArtifact

`TArtifact` = `string`

#### Methods

##### run()

> **run**(`argv?`): `Promise`\<`RunProfileMatrixResult`\<`TArtifact`, [`LeaderboardScenario`](#leaderboardscenario)\<`TCase`\>\>\>

Defined in: src/runtime/define-leaderboard.ts:253

Parse flags, run the matrix, export, and return the raw result.

Standard flags: `--provider <name>` (default `cli-bridge`), `--harnesses a,b`,
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

Defined in: src/runtime/define-leaderboard.ts:255

The same domain surface in the structural `BenchmarkAdapter` shape.

###### Returns

[`LeaderboardBenchmarkAdapter`](#leaderboardbenchmarkadapter)\<`TArtifact`\>

***

### EnvironmentToolPartState

Defined in: src/runtime/environment-events.ts:247

**`Experimental`**

Cross-event state for [mapEnvironmentToolEvent](#mapenvironmenttoolevent). Providers emit a
tool invocation as MANY `message.part.updated` frames on the same call id
(pending → running → completed), so faithful projection needs per-call
status memory: one `tool_call` on first sighting, at most one `tool_result`
on the terminal transition, nothing on intermediate re-frames. Create one
state per turn via [createEnvironmentToolPartState](#createenvironmenttoolpartstate).

#### Properties

##### statusByCall

> **statusByCall**: `Map`\<`string`, `string`\>

Defined in: src/runtime/environment-events.ts:250

**`Experimental`**

Last seen status per tool call id. A terminal status is sticky — later
 frames on a settled call project to nothing.

##### seq

> **seq**: `number`

Defined in: src/runtime/environment-events.ts:252

**`Experimental`**

Sequence for synthesized call ids when an event carries none.

***

### EnvironmentLineageHandle

Defined in: src/runtime/environment-lineage.ts:68

#### Properties

##### environment

> **environment**: `AgentEnvironment`

Defined in: src/runtime/environment-lineage.ts:69

##### sessionId

> **sessionId**: `string`

Defined in: src/runtime/environment-lineage.ts:70

***

### EnvironmentLineage

Defined in: src/runtime/environment-lineage.ts:73

#### Methods

##### adopt()

> **adopt**(`environment`, `sessionId`): [`EnvironmentLineageHandle`](#environmentlineagehandle)

Defined in: src/runtime/environment-lineage.ts:74

###### Parameters

###### environment

`AgentEnvironment`

###### sessionId

`string`

###### Returns

[`EnvironmentLineageHandle`](#environmentlineagehandle)

##### start()

> **start**(`spec`, `prompt`, `signal`, `options?`): `Promise`\<\{ `handle`: [`EnvironmentLineageHandle`](#environmentlineagehandle); `events`: `AsyncIterable`\<`AgentEnvironmentEvent`\>; \}\>

Defined in: src/runtime/environment-lineage.ts:75

###### Parameters

###### spec

[`AgentRunSpec`](#agentrunspec)\<`unknown`\>

###### prompt

`string`

###### signal

`AbortSignal`

###### options?

`TurnOptions`

###### Returns

`Promise`\<\{ `handle`: [`EnvironmentLineageHandle`](#environmentlineagehandle); `events`: `AsyncIterable`\<`AgentEnvironmentEvent`\>; \}\>

##### continue()

> **continue**(`handle`, `prompt`, `signal`, `options?`): `Promise`\<`AsyncIterable`\<`AgentEnvironmentEvent`, `any`, `any`\>\>

Defined in: src/runtime/environment-lineage.ts:84

###### Parameters

###### handle

[`EnvironmentLineageHandle`](#environmentlineagehandle)

###### prompt

`string`

###### signal

`AbortSignal`

###### options?

`TurnOptions`

###### Returns

`Promise`\<`AsyncIterable`\<`AgentEnvironmentEvent`, `any`, `any`\>\>

##### fork()

> **fork**(`parent`, `prompts`, `specs`, `signal`): `Promise`\<`object`[]\>

Defined in: src/runtime/environment-lineage.ts:90

###### Parameters

###### parent

[`EnvironmentLineageHandle`](#environmentlineagehandle)

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

Defined in: src/runtime/environment-lineage.ts:101

###### Parameters

###### keep

`Iterable`\<[`EnvironmentLineageHandle`](#environmentlineagehandle)\>

###### Returns

`Promise`\<`void`\>

##### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: src/runtime/environment-lineage.ts:102

###### Returns

`Promise`\<`void`\>

***

### EnvironmentTurnResult

Defined in: src/runtime/environment-run.ts:27

Result of one turn in a persistent environment.

#### Type Parameters

##### Output

`Output`

#### Properties

##### output

> **output**: `Output`

Defined in: src/runtime/environment-run.ts:28

##### events

> **events**: `AgentEnvironmentEvent`[]

Defined in: src/runtime/environment-run.ts:29

***

### EnvironmentRun

Defined in: src/runtime/environment-run.ts:46

A persistent agent environment and its resumable session.

#### Type Parameters

##### Output

`Output`

#### Properties

##### environment

> `readonly` **environment**: `AgentEnvironment`

Defined in: src/runtime/environment-run.ts:47

##### sessionId

> `readonly` **sessionId**: `string`

Defined in: src/runtime/environment-run.ts:48

#### Methods

##### turn()

> **turn**(`prompt`, `options?`): `Promise`\<[`EnvironmentTurnResult`](#environmentturnresult)\<`Output`\>\>

Defined in: src/runtime/environment-run.ts:49

###### Parameters

###### prompt

`string`

###### options?

[`EnvironmentTurnOptions`](#environmentturnoptions)

###### Returns

`Promise`\<[`EnvironmentTurnResult`](#environmentturnresult)\<`Output`\>\>

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: src/runtime/environment-run.ts:50

###### Returns

`Promise`\<`void`\>

***

### OpenEnvironmentRunBeforeStartContext

Defined in: src/runtime/environment-run.ts:56

#### Properties

##### environment

> `readonly` **environment**: `AgentEnvironment`

Defined in: src/runtime/environment-run.ts:57

##### sessionId

> `readonly` **sessionId**: `string`

Defined in: src/runtime/environment-run.ts:58

##### signal

> `readonly` **signal**: `AbortSignal`

Defined in: src/runtime/environment-run.ts:59

***

### OpenEnvironmentRunOptions

Defined in: src/runtime/environment-run.ts:62

#### Type Parameters

##### Output

`Output`

#### Properties

##### provider

> **provider**: `AgentEnvironmentProvider`

Defined in: src/runtime/environment-run.ts:63

##### agentRun

> **agentRun**: [`AgentRunSpec`](#agentrunspec)\<`string`\>

Defined in: src/runtime/environment-run.ts:64

##### deliverable

> **deliverable**: [`EnvironmentDeliverable`](#environmentdeliverable)\<`Output`\>

Defined in: src/runtime/environment-run.ts:65

##### signal

> **signal**: `AbortSignal`

Defined in: src/runtime/environment-run.ts:66

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: src/runtime/environment-run.ts:67

##### runId?

> `optional` **runId?**: `string`

Defined in: src/runtime/environment-run.ts:68

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: src/runtime/environment-run.ts:69

##### resumeFrom?

> `optional` **resumeFrom?**: `object`

Defined in: src/runtime/environment-run.ts:71

Reattach to a provider environment and session created by an earlier process.

###### environmentId

> **environmentId**: `string`

###### sessionId

> **sessionId**: `string`

##### turn?

> `optional` **turn?**: `ProviderTurnOptions`

Defined in: src/runtime/environment-run.ts:75

##### beforeStart?

> `optional` **beforeStart?**: (`ctx`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/environment-run.ts:76

###### Parameters

###### ctx

[`OpenEnvironmentRunBeforeStartContext`](#openenvironmentrunbeforestartcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onEnvironmentEvent?

> `optional` **onEnvironmentEvent?**: (`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>

Defined in: src/runtime/environment-run.ts:77

###### Parameters

###### event

`AgentEnvironmentEvent`

###### meta

###### turnIndex

`number`

###### turnKind

`"resume"` \| `"start"`

###### agentRunName

`string`

###### Returns

`void` \| `PromiseLike`\<`void`\>

##### now?

> `optional` **now?**: () => `number`

Defined in: src/runtime/environment-run.ts:85

###### Returns

`number`

##### readAttempts?

> `optional` **readAttempts?**: `number`

Defined in: src/runtime/environment-run.ts:86

##### readRetryDelayMs?

> `optional` **readRetryDelayMs?**: `number`

Defined in: src/runtime/environment-run.ts:87

***

### HarvestCorpusOptions

Defined in: src/runtime/harvest-corpus.ts:28

#### Properties

##### runs

> **runs**: `AsyncIterable`\<[`ObserveInput`](#observeinput), `any`, `any`\> \| `Iterable`\<[`ObserveInput`](#observeinput), `any`, `any`\>

Defined in: src/runtime/harvest-corpus.ts:30

The completed runs to analyze — map your store's rows to `ObserveInput`.

##### chat

> **chat**: `ChatClient`

Defined in: src/runtime/harvest-corpus.ts:32

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/harvest-corpus.ts:33

##### corpus

> **corpus**: [`Corpus`](#corpus-2)

Defined in: src/runtime/harvest-corpus.ts:35

The durable corpus the facts accrete into.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: src/runtime/harvest-corpus.ts:37

Tags written onto learned facts (the product/domain key the read side queries by).

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: src/runtime/harvest-corpus.ts:39

Override the analyst instruction (the GEPA-tunable knob).

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: src/runtime/harvest-corpus.ts:41

Runs analyzed in parallel. Default 4.

##### maxRuns?

> `optional` **maxRuns?**: `number`

Defined in: src/runtime/harvest-corpus.ts:43

Hard cap on runs consumed from the stream (a cost guard for unbounded stores).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/harvest-corpus.ts:44

***

### HarvestFailure

Defined in: src/runtime/harvest-corpus.ts:47

#### Properties

##### runId

> **runId**: `string`

Defined in: src/runtime/harvest-corpus.ts:48

##### error

> **error**: `string`

Defined in: src/runtime/harvest-corpus.ts:49

***

### HarvestReport

Defined in: src/runtime/harvest-corpus.ts:52

#### Properties

##### runsObserved

> **runsObserved**: `number`

Defined in: src/runtime/harvest-corpus.ts:53

##### findings

> **findings**: `number`

Defined in: src/runtime/harvest-corpus.ts:55

Total findings the analyst produced (including ones already known).

##### learned

> **learned**: `number`

Defined in: src/runtime/harvest-corpus.ts:57

NEW facts actually appended (idempotent dedup excludes re-learned ones).

##### failures

> **failures**: [`HarvestFailure`](#harvestfailure)[]

Defined in: src/runtime/harvest-corpus.ts:59

Per-run analysis failures — reported, never silently dropped.

***

### InProcessTurnContext

Defined in: src/runtime/in-process-environment-provider.ts:25

Context passed to an in-process turn callback.

#### Properties

##### round

> **round**: `number`

Defined in: src/runtime/in-process-environment-provider.ts:27

Zero-based turn index within one environment.

##### workdir?

> `optional` **workdir?**: `string`

Defined in: src/runtime/in-process-environment-provider.ts:29

Temporary workspace path when `workspacePrefix` is configured.

##### signal

> **signal**: `AbortSignal`

Defined in: src/runtime/in-process-environment-provider.ts:31

Combined environment and turn cancellation signal.

##### input

> **input**: `Readonly`\<`AgentTurnInput`\>

Defined in: src/runtime/in-process-environment-provider.ts:33

Full portable turn input.

##### profile

> **profile**: `Readonly`\<`AgentProfile`\>

Defined in: src/runtime/in-process-environment-provider.ts:35

Validated inline profile used to create the environment.

***

### InProcessEnvironmentProviderOptions

Defined in: src/runtime/in-process-environment-provider.ts:48

#### Properties

##### onTurn

> **onTurn**: [`InProcessOnTurn`](#inprocessonturn)

Defined in: src/runtime/in-process-environment-provider.ts:49

##### workspacePrefix?

> `optional` **workspacePrefix?**: `string`

Defined in: src/runtime/in-process-environment-provider.ts:51

Create one temporary workspace per environment with this prefix.

##### id?

> `optional` **id?**: `string` \| ((`sequence`) => `string`)

Defined in: src/runtime/in-process-environment-provider.ts:53

Override generated environment ids.

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/in-process-environment-provider.ts:55

Provider name reported by environments. Default `in-process`.

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

Defined in: src/runtime/in-process-environment-provider.ts:57

Additional inline-profile validation for test-specific constraints.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

***

### InlineEnvironmentProviderOptions

Defined in: src/runtime/inline-environment-provider.ts:15

#### Properties

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/inline-environment-provider.ts:17

Provider name reported by environments. Default `inline`.

##### capabilities?

> `optional` **capabilities?**: `AgentEnvironmentCapabilities`

Defined in: src/runtime/inline-environment-provider.ts:19

Override the default capabilities when the executor supports less.

##### validateProfile?

> `optional` **validateProfile?**: (`profile`) => `AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

Defined in: src/runtime/inline-environment-provider.ts:21

Validate profiles before an executor is created.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`AgentProfileValidationResult` \| `Promise`\<`AgentProfileValidationResult`\>

***

### KeyProvider

Defined in: src/runtime/key-provider.ts:36

Resolve named secrets. The ONE seam every secret store adapts to.

#### Methods

##### get()

> **get**(`name`): `Promise`\<`string` \| `undefined`\>

Defined in: src/runtime/key-provider.ts:38

The value for `name`, or `undefined` when this provider does not hold it.

###### Parameters

###### name

`string`

###### Returns

`Promise`\<`string` \| `undefined`\>

***

### LocalEnvironmentProviderOptions

Defined in: src/runtime/local-environment-provider.ts:25

#### Properties

##### router

> **router**: `object`

Defined in: src/runtime/local-environment-provider.ts:27

Router model used by the same-host tool loop.

###### baseUrl

> **baseUrl**: `string`

###### key

> **key**: `string`

###### model

> **model**: `string`

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: src/runtime/local-environment-provider.ts:29

Tool-loop turns per request. Default 8.

##### temperature?

> `optional` **temperature?**: `number`

Defined in: src/runtime/local-environment-provider.ts:31

Router sampling temperature.

##### trustedProfile?

> `optional` **trustedProfile?**: `AgentProfile`

Defined in: src/runtime/local-environment-provider.ts:33

Fixed profile whose exact bytes may receive local-process trust.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Defined in: src/runtime/local-environment-provider.ts:35

Resolves profile-declared MCP secrets when child processes start.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Defined in: src/runtime/local-environment-provider.ts:37

Local-process policy for the exact `trustedProfile` bytes.

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/local-environment-provider.ts:39

Provider name reported by environments. Default `local`.

***

### LoopDispatchOptions

Defined in: src/runtime/loop-dispatch.ts:34

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

##### environmentProvider

> **environmentProvider**: `AgentEnvironmentProvider`

Defined in: src/runtime/loop-dispatch.ts:42

Environment provider used for every cell's `runAgentRounds`.

##### toLoopOptions

> **toLoopOptions**: (`scenario`, `profile`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Defined in: src/runtime/loop-dispatch.ts:45

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

Defined in: src/runtime/loop-dispatch.ts:53

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

Defined in: src/runtime/loop-dispatch.ts:56

Forward `loop.*` trace events into the campaign's scoped trace so loop
 spans correlate with the cell. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Defined in: src/runtime/loop-dispatch.ts:58

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`, `profile`) => MaximumCharge \| undefined)

Defined in: src/runtime/loop-dispatch.ts:61

Provider- or executor-enforced maximum for this whole cell dispatch.
Required by agent-eval before execution when the campaign is cost-capped.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`, `profile`) => `string` \| `undefined`

Defined in: src/runtime/loop-dispatch.ts:65

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

Defined in: src/runtime/loop-dispatch.ts:171

Options for adapting plain agent-eval campaign scenarios into runtime `runAgentRounds` cells.

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

##### environmentProvider

> **environmentProvider**: `AgentEnvironmentProvider`

Defined in: src/runtime/loop-dispatch.ts:179

Environment provider used for every campaign cell's `runAgentRounds`.

##### toLoopOptions

> **toLoopOptions**: (`scenario`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Defined in: src/runtime/loop-dispatch.ts:181

Build the per-cell runAgentRounds options from the campaign scenario.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

##### toArtifact?

> `optional` **toArtifact?**: (`result`) => `TArtifact`

Defined in: src/runtime/loop-dispatch.ts:183

Map the finished loop to the artifact the campaign judges score.

###### Parameters

###### result

[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>

###### Returns

`TArtifact`

##### forwardTrace?

> `optional` **forwardTrace?**: `boolean`

Defined in: src/runtime/loop-dispatch.ts:185

Forward `loop.*` trace events into the campaign's scoped trace. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Defined in: src/runtime/loop-dispatch.ts:187

Cost-meter source label for the loop's spend. Default `'loop'`.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`scenario`) => MaximumCharge \| undefined)

Defined in: src/runtime/loop-dispatch.ts:189

Provider- or executor-enforced maximum for this whole cell dispatch.

##### resolveCostModel?

> `optional` **resolveCostModel?**: (`result`, `scenario`) => `string` \| `undefined`

Defined in: src/runtime/loop-dispatch.ts:191

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

Defined in: src/runtime/mcp-environment.ts:25

Where a handle's MCP server lives; headers carry per-artifact scoping.

#### Properties

##### url

> **url**: `string`

Defined in: src/runtime/mcp-environment.ts:26

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/mcp-environment.ts:27

***

### McpEnvironmentOptions

Defined in: src/runtime/mcp-environment.ts:30

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/mcp-environment.ts:31

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: src/runtime/mcp-environment.ts:41

Cap on a tool result's text fed back to the worker. Default 1500 chars.

#### Methods

##### open()

> **open**(`task`): `Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

Defined in: src/runtime/mcp-environment.ts:33

Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it.

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### Returns

`Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

##### score()

> **score**(`task`, `handle`): `Promise`\<[`EnvironmentScore`](#environmentscore)\>

Defined in: src/runtime/mcp-environment.ts:35

The deployable check over the artifact's current state.

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`EnvironmentScore`](#environmentscore)\>

##### close()?

> `optional` **close**(`handle`): `Promise`\<`void`\>

Defined in: src/runtime/mcp-environment.ts:37

Teardown (delete the seeded artifact). Optional — omit for stateless servers.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

##### selectTools()?

> `optional` **selectTools**(`task`, `all`): [`EnvironmentTool`](#environmenttool)[]

Defined in: src/runtime/mcp-environment.ts:39

Restrict/order the server's tools per task (e.g. the task's selected_tools). Default: all.

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### all

[`EnvironmentTool`](#environmenttool)[]

###### Returns

[`EnvironmentTool`](#environmenttool)[]

***

### ObserveInput

Defined in: src/runtime/observe.ts:20

#### Properties

##### task

> **task**: `string`

Defined in: src/runtime/observe.ts:22

What the worker was asked to do.

##### output

> **output**: `string`

Defined in: src/runtime/observe.ts:24

What it produced (its final answer / artifact summary).

##### trace

> **trace**: readonly `unknown`[]

Defined in: src/runtime/observe.ts:26

The worker's trace — any event array (sandbox events, tool-call records).

##### outcome?

> `optional` **outcome?**: `"failed"` \| `"unknown"` \| `"passed"`

Defined in: src/runtime/observe.ts:29

Terminal status only (passed/failed/unknown) — NOT a judge score; the
 observer never reads the verdict, it reads behavior.

##### runId?

> `optional` **runId?**: `string`

Defined in: src/runtime/observe.ts:31

Provenance back to the run.

***

### ObserveOptions

Defined in: src/runtime/observe.ts:34

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: src/runtime/observe.ts:36

The model-call seam (agent-eval `createChatClient`: router / cli-bridge / …).

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/observe.ts:37

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: src/runtime/observe.ts:39

When set, learned facts are appended (idempotent) for the next run to read.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: src/runtime/observe.ts:41

Tags written onto learned facts + used by the next run's corpus query.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/observe.ts:42

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: src/runtime/observe.ts:44

Cap the trace lines fed to the observer (keeps the call cheap). Default 80.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: src/runtime/observe.ts:50

Override the analyst's system instruction — the prompt that turns a trace into
 findings + recommended_actions. The analyst IS the steerer, so this is the knob a
 prompt optimizer (GEPA) tunes. Omitted ⇒ the default observer instruction. The
 firewall (trace-only, never the verdict) is structural (input has no score), so a
 custom instruction cannot break it.

***

### Observation

Defined in: src/runtime/observe.ts:61

#### Properties

##### findings

> **findings**: `AnalystFinding`[]

Defined in: src/runtime/observe.ts:62

##### learned

> **learned**: [`CorpusRecord`](#corpusrecord)[]

Defined in: src/runtime/observe.ts:64

Facts persisted to the corpus (empty when no corpus was supplied).

##### report

> **report**: `string`

Defined in: src/runtime/observe.ts:66

Operator-facing markdown: what the observer noticed + what to change.

***

### CreateScopeAnalystOptions

Defined in: src/runtime/personify/analyst.ts:69

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

Defined in: src/runtime/personify/analyst.ts:73

The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
 (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
 the RAW findings; this module asserts the firewall on them before returning.

##### budget

> `readonly` **budget**: [`Budget`](#budget-10)

Defined in: src/runtime/personify/analyst.ts:79

The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
 closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings.

##### label?

> `readonly` `optional` **label?**: `string`

Defined in: src/runtime/personify/analyst.ts:81

Trace/journal label for the spawned analyst child. Default `'analyst'`.

#### Methods

##### buildTask()

> **buildTask**(`input`): `unknown`

Defined in: src/runtime/personify/analyst.ts:76

Build the analyst agent's task from the analyze input (the root-task framing + the children
 drained so far). Pure projection — the analyst interprets it, this never reads it.

###### Parameters

###### input

[`ScopeAnalyzeInput`](#scopeanalyzeinput)\<`D`\>

###### Returns

`unknown`

***

### RegistryAnalyzeProjection

Defined in: src/runtime/personify/analyst.ts:184

Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
`runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
settlements — so the CALLER owns the projection from the combinator's drained children to the
registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
bridge; it only runs the projected inputs and firewalls the merged findings.

#### Properties

##### runId

> `readonly` **runId**: `string`

Defined in: src/runtime/personify/analyst.ts:185

##### inputs

> `readonly` **inputs**: `AnalystRunInputs`

Defined in: src/runtime/personify/analyst.ts:186

##### opts?

> `readonly` `optional` **opts?**: `object`

Defined in: src/runtime/personify/analyst.ts:188

Optional `run` opts (e.g. `priorFindings`) forwarded verbatim to the registry.

###### Index Signature

\[`k`: `string`\]: `unknown`

###### priorFindings?

> `optional` **priorFindings?**: readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

***

### ScopeAnalyst

Defined in: src/runtime/personify/wave-types.ts:370

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

Defined in: src/runtime/personify/wave-types.ts:377

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

Defined in: src/runtime/personify/wave-types.ts:381

Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far.

#### Type Parameters

##### D

`D`

#### Properties

##### task

> `readonly` **task**: `unknown`

Defined in: src/runtime/personify/wave-types.ts:383

Opaque root-task framing (whatever the combinator was invoked with).

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-2)\<`Outcome`\<`D`\>\>[]

Defined in: src/runtime/personify/wave-types.ts:385

The children this combinator has drained off `scope.next()`, in cursor order.

##### nodeId

> `readonly` **nodeId**: `string`

Defined in: src/runtime/personify/wave-types.ts:387

This combinator's scope id (the trace-correlation root for the analyst).

***

### SteerContext

Defined in: src/runtime/personify/wave-types.ts:398

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

Defined in: src/runtime/personify/wave-types.ts:399

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-2)\<`Outcome`\<`D`\>\>[]

Defined in: src/runtime/personify/wave-types.ts:400

##### lastValidScore?

> `readonly` `optional` **lastValidScore?**: `number`

Defined in: src/runtime/personify/wave-types.ts:403

Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
 off this re-introduces selector=judge. Marked so a reviewer catches a misuse.

***

### CorpusRecord

Defined in: src/runtime/personify/wave-types.ts:426

One retained fact in the cross-run corpus. Distinct from
a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
relevant, high-confidence subset.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

Defined in: src/runtime/personify/wave-types.ts:427

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/personify/wave-types.ts:429

Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups.

##### runId

> `readonly` **runId**: `string`

Defined in: src/runtime/personify/wave-types.ts:431

The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace.

##### producedAt

> `readonly` **producedAt**: `string`

Defined in: src/runtime/personify/wave-types.ts:432

##### area

> `readonly` **area**: `string`

Defined in: src/runtime/personify/wave-types.ts:434

Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`).

##### claim

> `readonly` **claim**: `string`

Defined in: src/runtime/personify/wave-types.ts:436

The accreted fact — the instruction-shaped statement the next run reads back.

##### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: src/runtime/personify/wave-types.ts:438

Optional supporting detail the renderer may include under the claim.

##### tags

> `readonly` **tags**: readonly `string`[]

Defined in: src/runtime/personify/wave-types.ts:440

Free-form tags for `query` filtering (domain, persona, surface).

##### confidence

> `readonly` **confidence**: `number`

Defined in: src/runtime/personify/wave-types.ts:442

0..1 — the producing run's confidence in this fact (the render threshold reads it).

##### evidence?

> `readonly` `optional` **evidence?**: readonly `object`[]

Defined in: src/runtime/personify/wave-types.ts:444

Optional provenance back into the run that learned it (a finding id / outRef / span).

***

### CorpusFilter

Defined in: src/runtime/personify/wave-types.ts:448

A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain.

#### Properties

##### area?

> `readonly` `optional` **area?**: `string`

Defined in: src/runtime/personify/wave-types.ts:449

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Defined in: src/runtime/personify/wave-types.ts:451

Match records carrying ALL of these tags.

##### minConfidence?

> `readonly` `optional` **minConfidence?**: `number`

Defined in: src/runtime/personify/wave-types.ts:453

Minimum confidence a record must clear to be returned (the render gate).

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: src/runtime/personify/wave-types.ts:455

Only records from this run (rare — usually a cross-run read).

##### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: src/runtime/personify/wave-types.ts:457

Cap the result count (most-confident first in the impl).

***

### Corpus

Defined in: src/runtime/personify/wave-types.ts:470

The durable cross-run corpus. Distinct from `SpawnJournal`
(per-run decisions, replay) and `ResultBlobStore` (per-run payloads): `Corpus` holds accreted
FACTS across runs that the next run reads back. `InMemoryCorpus` + `FileCorpus` (JSONL) impls
live in `corpus.ts` and MAY share a storage spine with the JSONL journal, but the INTERFACE is
separate so a consumer never confuses a replay record with a learned fact.

Fail-loud, typed-outcome boundary: `append` is idempotent on an identical record (same `id` +
`claim`); a conflicting re-append under the same `id` is a typed error, never a silent overwrite.

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: src/runtime/personify/wave-types.ts:473

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Defined in: src/runtime/personify/wave-types.ts:476

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

***

### RenderCorpusToInstructionsOptions

Defined in: src/runtime/personify/wave-types.ts:490

Project retained corpus facts into an `AgentProfile`.
Reads the corpus through `filter`, renders matching facts into instruction lines,
and returns a NEW profile with them merged into `prompt.instructions` (the append-line seam) so
the next run's persona reads the accreted world-model. Pure projection over the queried records;
never mutates the input profile (returns a fresh one). The impl lives in `corpus.ts`.

`resources.instructions` is `string | AgentProfileResourceRef`; `prompt.instructions` is
`string[]`. The render targets `prompt.instructions` (additive lines) by default; a caller that
wants the single-blob `resources.instructions` form passes `target: 'resources'`.

#### Properties

##### corpus

> `readonly` **corpus**: [`Corpus`](#corpus-2)

Defined in: src/runtime/personify/wave-types.ts:491

##### filter

> `readonly` **filter**: [`CorpusFilter`](#corpusfilter)

Defined in: src/runtime/personify/wave-types.ts:492

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: src/runtime/personify/wave-types.ts:494

The profile to project the facts into. The result is a fresh profile — the input is unchanged.

##### target?

> `readonly` `optional` **target?**: `"resources"` \| `"prompt"`

Defined in: src/runtime/personify/wave-types.ts:497

Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
 the single-blob `resources.instructions` string.

##### maxLines?

> `readonly` `optional` **maxLines?**: `number`

Defined in: src/runtime/personify/wave-types.ts:499

Optional cap on rendered lines (most-confident first), independent of the query `limit`.

***

### TrajectoryNode

Defined in: src/runtime/personify/wave-types.ts:518

One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
`Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/personify/wave-types.ts:519

##### parent?

> `readonly` `optional` **parent?**: `string`

Defined in: src/runtime/personify/wave-types.ts:520

##### children

> `readonly` **children**: readonly `string`[]

Defined in: src/runtime/personify/wave-types.ts:521

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/personify/wave-types.ts:522

##### runtime

> `readonly` **runtime**: `string`

Defined in: src/runtime/personify/wave-types.ts:523

##### status

> `readonly` **status**: `"failed"` \| `"cancelled"` \| `"pending"` \| `"done"` \| `"waiting"`

Defined in: src/runtime/personify/wave-types.ts:526

Terminal status the journal recorded for this node. `'waiting'` is a wait-state node that was
 armed and never woken — the journal's record of a run that died mid-wait.

##### ownSpend

> `readonly` **ownSpend**: [`Spend`](#spend)

Defined in: src/runtime/personify/wave-types.ts:528

This node's OWN conserved spend (from its `settled` event).

##### rolledUpSpend

> `readonly` **rolledUpSpend**: [`Spend`](#spend)

Defined in: src/runtime/personify/wave-types.ts:531

This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
 "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis).

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: src/runtime/personify/wave-types.ts:533

The node's verdict, when its settlement carried one (observability — NOT a steer input).

##### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: src/runtime/personify/wave-types.ts:535

The rehydrated output artifact, when `withOutputs` was requested + the blob resolved.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: src/runtime/personify/wave-types.ts:536

***

### TrajectoryReport

Defined in: src/runtime/personify/wave-types.ts:541

The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: src/runtime/personify/wave-types.ts:542

##### nodes

> `readonly` **nodes**: readonly [`TrajectoryNode`](#trajectorynode)[]

Defined in: src/runtime/personify/wave-types.ts:544

Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges).

##### total

> `readonly` **total**: [`Spend`](#spend)

Defined in: src/runtime/personify/wave-types.ts:546

The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms).

##### statusCounts

> `readonly` **statusCounts**: `Readonly`\<`Record`\<[`TrajectoryNode`](#trajectorynode)\[`"status"`\], `number`\>\>

Defined in: src/runtime/personify/wave-types.ts:548

Count of nodes by terminal status — a quick "how did the tree end" readout.

***

### TrajectoryReportOptions

Defined in: src/runtime/personify/wave-types.ts:558

`trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
impl lives in `trajectory.ts`.

#### Properties

##### withOutputs?

> `readonly` `optional` **withOutputs?**: `boolean`

Defined in: src/runtime/personify/wave-types.ts:560

Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report).

***

### EqualKArm

Defined in: src/runtime/personify/wave-types.ts:579

One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
(not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
iteration count.

#### Properties

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/personify/wave-types.ts:580

##### report

> `readonly` **report**: [`TrajectoryReport`](#trajectoryreport-3)

Defined in: src/runtime/personify/wave-types.ts:581

***

### EqualKVerdict

Defined in: src/runtime/personify/wave-types.ts:590

The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
NOT comparable at equal compute — a confound to report, not a result to publish.

#### Properties

##### withinTolerance

> `readonly` **withinTolerance**: `boolean`

Defined in: src/runtime/personify/wave-types.ts:591

##### arms

> `readonly` **arms**: readonly `object`[]

Defined in: src/runtime/personify/wave-types.ts:593

Per-arm conserved cost (the basis: tokens total + usd).

##### spread

> `readonly` **spread**: `object`

Defined in: src/runtime/personify/wave-types.ts:600

The realized spread on each channel (max − min across arms), for the report.

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

##### tolerance

> `readonly` **tolerance**: `number`

Defined in: src/runtime/personify/wave-types.ts:602

The fractional tolerance the check used (spread / median ≤ tolerance per channel).

***

### EqualKOnCostOptions

Defined in: src/runtime/personify/wave-types.ts:612

`equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
(tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
impl lives in `trajectory.ts`. Pure over the reports — no I/O.

#### Properties

##### tolerance?

> `readonly` `optional` **tolerance?**: `number`

Defined in: src/runtime/personify/wave-types.ts:615

Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
 the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim.

***

### PromotionGateOptions

Defined in: src/runtime/promotion-gate.ts:13

#### Properties

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: src/runtime/promotion-gate.ts:15

The HOLDOUT report — must carry per-task cells for both strategy names.

##### incumbent

> **incumbent**: `string`

Defined in: src/runtime/promotion-gate.ts:17

The incumbent champion's strategy name.

##### candidate

> **candidate**: `string`

Defined in: src/runtime/promotion-gate.ts:19

The challenger's strategy name.

##### mode?

> `optional` **mode?**: `"superiority"` \| `"non-inferiority"`

Defined in: src/runtime/promotion-gate.ts:24

'superiority' (default): the candidate must score significantly BETTER.
 'non-inferiority': the candidate must prove its score is not worse than the
 incumbent by more than `scoreTolerance` AND its cost savings are significant —
 the gate for "same quality, cheaper" claims.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: src/runtime/promotion-gate.ts:26

non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### deltaThreshold?

> `optional` **deltaThreshold?**: `number`

Defined in: src/runtime/promotion-gate.ts:28

The CI lower bound on the paired lift must EXCEED this (score scale). Default 0.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: src/runtime/promotion-gate.ts:31

Minimum paired tasks before significance can be claimed. Default 6 — below that
 the bootstrap CI is too wide to separate a real lift from the per-task noise.

##### statistic?

> `optional` **statistic?**: `"mean"` \| `"median"`

Defined in: src/runtime/promotion-gate.ts:33

Bootstrap statistic over the paired deltas. Default 'mean'.

##### seed?

> `optional` **seed?**: `number`

Defined in: src/runtime/promotion-gate.ts:35

Fixed by the substrate by default — the same report always yields the same verdict.

##### resamples?

> `optional` **resamples?**: `number`

Defined in: src/runtime/promotion-gate.ts:36

***

### PromotionVerdict

Defined in: src/runtime/promotion-gate.ts:39

#### Properties

##### promoted

> **promoted**: `boolean`

Defined in: src/runtime/promotion-gate.ts:40

##### reason

> **reason**: `"identical-champion"` \| `"few-tasks"` \| `"no-margin"` \| `"significant"` \| `"non-inferior-and-cheaper"` \| `"non-inferiority-unproven"` \| `"not-cheaper"`

Defined in: src/runtime/promotion-gate.ts:41

##### mode

> **mode**: `"superiority"` \| `"non-inferiority"`

Defined in: src/runtime/promotion-gate.ts:49

##### n

> **n**: `number`

Defined in: src/runtime/promotion-gate.ts:51

Paired tasks that carried both strategies' cells.

##### lift

> **lift**: `object`

Defined in: src/runtime/promotion-gate.ts:53

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

Defined in: src/runtime/promotion-gate.ts:56

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

Defined in: src/runtime/promotion-gate.ts:60

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

Defined in: src/runtime/report-usage.ts:24

The slice of an agent-eval campaign `DispatchContext.cost` this needs.

#### Methods

##### observe()

> **observe**(`amountUsd`, `source`): `void`

Defined in: src/runtime/report-usage.ts:25

###### Parameters

###### amountUsd

`number`

###### source

`string`

###### Returns

`void`

##### observeTokens()

> **observeTokens**(`usage`): `void`

Defined in: src/runtime/report-usage.ts:26

###### Parameters

###### usage

[`LoopTokenUsage`](#looptokenusage)

###### Returns

`void`

***

### RouterConfig

Defined in: src/runtime/router-client.ts:16

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: src/runtime/router-client.ts:17

##### routerKey

> **routerKey**: `string`

Defined in: src/runtime/router-client.ts:18

##### model

> **model**: `string`

Defined in: src/runtime/router-client.ts:19

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: src/runtime/router-client.ts:27

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

Defined in: src/runtime/router-client.ts:30

#### Properties

##### content

> **content**: `string`

Defined in: src/runtime/router-client.ts:32

The final answer, with any inline `<think>...</think>` block stripped into `reasoning`.

##### reasoning?

> `optional` **reasoning?**: `string`

Defined in: src/runtime/router-client.ts:41

Thinking-model reasoning, when the provider surfaced it — either as a separate
`reasoning`/`reasoning_content` message field (OpenRouter style) or inlined into
`content` as a `<think>` block (Groq style). Undefined for non-thinking models.
Downstream parsers that match single-token answers must read `content`, which is
clean either way; before this split, Groq-style inlining made the same model look
broken on one provider and fine on another.

##### usage?

> `optional` **usage?**: `object`

Defined in: src/runtime/router-client.ts:43

REAL usage, or undefined when the provider reported none.

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: src/runtime/router-client.ts:45

Derived from usage via `estimateCost` when the model is priced; else undefined.

***

### RouterToolCall

Defined in: src/runtime/router-client.ts:167

A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest).

#### Properties

##### id

> **id**: `string`

Defined in: src/runtime/router-client.ts:168

##### name

> **name**: `string`

Defined in: src/runtime/router-client.ts:169

##### arguments

> **arguments**: `string`

Defined in: src/runtime/router-client.ts:171

Raw JSON arguments string as emitted by the model.

***

### RouterChatToolsResult

Defined in: src/runtime/router-client.ts:174

#### Properties

##### content

> **content**: `string` \| `null`

Defined in: src/runtime/router-client.ts:175

##### toolCalls

> **toolCalls**: [`RouterToolCall`](#routertoolcall)[]

Defined in: src/runtime/router-client.ts:176

##### usage?

> `optional` **usage?**: `object`

Defined in: src/runtime/router-client.ts:177

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: src/runtime/router-client.ts:178

***

### ToolSpec

Defined in: src/runtime/router-client.ts:254

#### Properties

##### type

> **type**: `"function"`

Defined in: src/runtime/router-client.ts:255

##### function

> **function**: `object`

Defined in: src/runtime/router-client.ts:256

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `unknown`

***

### RouterToolLoopResult

Defined in: src/runtime/router-client.ts:259

#### Properties

##### final

> **final**: `string`

Defined in: src/runtime/router-client.ts:261

The model's final assistant text (the turn where it stopped calling tools, or the budget turn).

##### turns

> **turns**: `number`

Defined in: src/runtime/router-client.ts:263

Inference turns spent (≤ maxTurns) — the equal-budget unit vs random@k.

##### toolCalls

> **toolCalls**: `number`

Defined in: src/runtime/router-client.ts:264

##### toolTrace

> **toolTrace**: `object`[]

Defined in: src/runtime/router-client.ts:267

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

Defined in: src/runtime/router-client.ts:268

###### input

> **input**: `number`

###### output

> **output**: `number`

##### messages

> **messages**: `Record`\<`string`, `unknown`\>[]

Defined in: src/runtime/router-client.ts:271

The full conversation after the loop (seed + every assistant/tool turn). Lets a caller
 CARRY the messages into the next shot (depth continuation) and read the trajectory.

***

### RouterEnvironmentProviderOptions

Defined in: src/runtime/router-environment-provider.ts:6

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: src/runtime/router-environment-provider.ts:7

##### routerKey

> **routerKey**: `string`

Defined in: src/runtime/router-environment-provider.ts:8

##### model

> **model**: `string`

Defined in: src/runtime/router-environment-provider.ts:9

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/router-environment-provider.ts:10

##### tools?

> `optional` **tools?**: readonly [`ToolSpec`](#toolspec)[]

Defined in: src/runtime/router-environment-provider.ts:11

##### executeToolCall?

> `optional` **executeToolCall?**: (`name`, `args`, `task`) => `Promise`\<`string`\>

Defined in: src/runtime/router-environment-provider.ts:12

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### onToolStep?

> `optional` **onToolStep?**: (`step`) => `void`

Defined in: src/runtime/router-environment-provider.ts:13

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

##### maxTurns?

> `optional` **maxTurns?**: `number`

Defined in: src/runtime/router-environment-provider.ts:14

***

### BenchmarkConfig

Defined in: src/runtime/run-benchmark.ts:33

#### Properties

##### environment

> **environment**: [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/run-benchmark.ts:35

The task domain (5 hooks).

##### tasks

> **tasks**: [`EnvironmentTask`](#environmenttask)[]

Defined in: src/runtime/run-benchmark.ts:37

The tasks to score across.

##### worker

> **worker**: [`StrategyWorkerOptions`](#strategyworkeroptions)

Defined in: src/runtime/run-benchmark.ts:39

The worker: model + router + (optional) the critic's instruction (the steerer knob).

##### strategies?

> `optional` **strategies?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>[]

Defined in: src/runtime/run-benchmark.ts:42

Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
 Default: [sample, refine].

##### budget?

> `optional` **budget?**: `number`

Defined in: src/runtime/run-benchmark.ts:44

Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: src/runtime/run-benchmark.ts:46

Tasks scored in parallel. Default 3.

##### onTask?

> `optional` **onTask?**: (`row`, `done`, `total`) => `void`

Defined in: src/runtime/run-benchmark.ts:49

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

Defined in: src/runtime/run-benchmark.ts:52

Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
 here live (the watchdog/route-auditor seam, passed through to `runStrategy`).

##### modelPreflight?

> `optional` **modelPreflight?**: `false` \| ((`model`, `worker`, `signal`) => `Promise`\<`void`\>)

Defined in: src/runtime/run-benchmark.ts:60

Model availability check before tasks start.

By default, live router workers send one one-token request per unique worker and analyst
model. Injected `worker.complete` transports skip the check. Pass `false` to disable it or a
callback to check each unique model through a custom transport.

##### modelPreflightTimeoutMs?

> `optional` **modelPreflightTimeoutMs?**: `number`

Defined in: src/runtime/run-benchmark.ts:68

Maximum time for each model availability check. Default 30 seconds.

***

### BenchmarkLift

Defined in: src/runtime/run-benchmark.ts:71

#### Properties

##### mean

> **mean**: `number`

Defined in: src/runtime/run-benchmark.ts:73

Mean of paired deltas (refine − sample).

##### low

> **low**: `number`

Defined in: src/runtime/run-benchmark.ts:74

##### high

> **high**: `number`

Defined in: src/runtime/run-benchmark.ts:75

##### n

> **n**: `number`

Defined in: src/runtime/run-benchmark.ts:76

***

### BenchmarkCell

Defined in: src/runtime/run-benchmark.ts:80

One strategy's outcome on one task — the per-task cell an optimizer consumes.

#### Properties

##### score

> **score**: `number`

Defined in: src/runtime/run-benchmark.ts:81

##### resolved

> **resolved**: `boolean`

Defined in: src/runtime/run-benchmark.ts:82

##### progression

> **progression**: `number`[]

Defined in: src/runtime/run-benchmark.ts:84

The progress curve (refine: score per shot; sample: best-so-far per rollout).

##### usd

> **usd**: `number`

Defined in: src/runtime/run-benchmark.ts:85

##### ms

> **ms**: `number`

Defined in: src/runtime/run-benchmark.ts:86

##### tokens

> **tokens**: `object`

Defined in: src/runtime/run-benchmark.ts:87

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### BenchmarkTaskRow

Defined in: src/runtime/run-benchmark.ts:90

#### Properties

##### taskId

> **taskId**: `string`

Defined in: src/runtime/run-benchmark.ts:91

##### cells?

> `optional` **cells?**: `Record`\<`string`, [`BenchmarkCell`](#benchmarkcell)\>

Defined in: src/runtime/run-benchmark.ts:93

Per-strategy cells; absent when the task errored before completing all strategies.

##### errors?

> `optional` **errors?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/run-benchmark.ts:97

Per-strategy failures on this task: the strategy competed, threw, and scored an
 honest zero — it loses, it does not poison the row. The message is kept so a later
 generation's author can see WHY a candidate died.

##### error?

> `optional` **error?**: `string`

Defined in: src/runtime/run-benchmark.ts:99

Why the task was excluded (infra/setup failure) — never silently dropped.

***

### BenchmarkStrategySummary

Defined in: src/runtime/run-benchmark.ts:102

#### Properties

##### score

> **score**: `number`

Defined in: src/runtime/run-benchmark.ts:104

Mean verifier score (0..1).

##### resolved

> **resolved**: `number`

Defined in: src/runtime/run-benchmark.ts:106

Fraction of tasks fully resolved.

##### usd

> **usd**: `number`

Defined in: src/runtime/run-benchmark.ts:108

Mean cost vector per task.

##### ms

> **ms**: `number`

Defined in: src/runtime/run-benchmark.ts:109

***

### BenchmarkReport

Defined in: src/runtime/run-benchmark.ts:113

Benchmark output: per-strategy means plus the full per-task × per-strategy losses table an optimizer mines.

#### Properties

##### n

> **n**: `number`

Defined in: src/runtime/run-benchmark.ts:114

##### excluded

> **excluded**: `number`

Defined in: src/runtime/run-benchmark.ts:115

##### perStrategy

> **perStrategy**: `Record`\<`string`, [`BenchmarkStrategySummary`](#benchmarkstrategysummary)\>

Defined in: src/runtime/run-benchmark.ts:117

Per-strategy means (keyed by strategy.name).

##### perTask

> **perTask**: [`BenchmarkTaskRow`](#benchmarktaskrow)[]

Defined in: src/runtime/run-benchmark.ts:120

The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
 strategy-author, an operator) consumes. Includes errored tasks with the reason.

##### pareto

> **pareto**: `string`[]

Defined in: src/runtime/run-benchmark.ts:123

The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
 a strategy that ties on score at half the cost WINS and a scalar would hide it.

##### refineVsSample?

> `optional` **refineVsSample?**: [`BenchmarkLift`](#benchmarklift)

Defined in: src/runtime/run-benchmark.ts:125

The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample.

***

### RunAgentRoundsOptions

Defined in: src/runtime/run-loop.ts:71

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

#### Properties

##### driver

> **driver**: [`Driver`](#driver-2)\<`Task`, `Output`, `Decision`\>

Defined in: src/runtime/run-loop.ts:72

**`Experimental`**

##### agentRun?

> `optional` **agentRun?**: [`AgentRunSpec`](#agentrunspec)\<`Task`\>

Defined in: src/runtime/run-loop.ts:77

**`Experimental`**

Single agent spec — every iteration uses this profile. Mutually
exclusive with `agentRuns`.

##### agentRuns?

> `optional` **agentRuns?**: [`AgentRunSpec`](#agentrunspec)\<`Task`\>[]

Defined in: src/runtime/run-loop.ts:83

**`Experimental`**

Multiple specs for heterogeneous fanout. The kernel round-robins
through them when the driver plans N tasks. Mutually exclusive with
`agentRun`.

##### output

> **output**: [`OutputAdapter`](#outputadapter)\<`Output`\>

Defined in: src/runtime/run-loop.ts:84

**`Experimental`**

##### validator?

> `optional` **validator?**: [`Validator`](#validator-1)\<`Output`, `DefaultVerdict`\>

Defined in: src/runtime/run-loop.ts:85

**`Experimental`**

##### task

> **task**: `Task`

Defined in: src/runtime/run-loop.ts:86

**`Experimental`**

##### ctx

> **ctx**: [`ExecCtx`](#execctx)

Defined in: src/runtime/run-loop.ts:87

**`Experimental`**

##### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: src/runtime/run-loop.ts:89

**`Experimental`**

Default 10. Hard cap on total iterations across all `plan()` rounds.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: src/runtime/run-loop.ts:91

**`Experimental`**

Default 4. In-flight worker cap within a single `plan()` batch.

##### runId?

> `optional` **runId?**: `string`

Defined in: src/runtime/run-loop.ts:96

**`Experimental`**

Pre-allocated id for trace correlation. Default = `loop-${random}`.
Surfaces as `runId` on every emitted `LoopTraceEvent`.

##### now?

> `optional` **now?**: () => `number`

Defined in: src/runtime/run-loop.ts:101

**`Experimental`**

Clock override; default `Date.now`. Deterministic tests pass a
monotonic counter to stabilize iteration timing fields.

###### Returns

`number`

##### selectWinner?

> `optional` **selectWinner?**: (`iterations`) => [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

Defined in: src/runtime/run-loop.ts:106

**`Experimental`**

Override the default winner selector (highest-valid-score, ties broken
by earliest iteration).

###### Parameters

###### iterations

[`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

###### Returns

[`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

##### onWorkerEnvironment?

> `optional` **onWorkerEnvironment?**: (`environment`) => `void`

Defined in: src/runtime/run-loop.ts:108

**`Experimental`**

Keep completed workers alive for a driver that runs in their environment.

###### Parameters

###### environment

`AgentEnvironment` \| `undefined`

###### Returns

`void`

##### lineage?

> `optional` **lineage?**: [`LoopLineageOptions`](#looplineageoptions)

Defined in: src/runtime/run-loop.ts:117

**`Experimental`**

Opt-in environment lineage. With `sessionContinuity`, a refine round
continues the parent session; with `forkFanout` on (and a
fork-capable platform), a fanout round forks the parent's checkpoint so the
branches share a context prefix. The lineage owns every environment it
creates and destroys them at loop end.

***

### StdioMcpServerSpec

Defined in: src/runtime/stdio-mcp-client.ts:72

#### Properties

##### command

> **command**: `string`

Defined in: src/runtime/stdio-mcp-client.ts:74

Command that starts the MCP server (stdio transport).

##### args?

> `optional` **args?**: `string`[]

Defined in: src/runtime/stdio-mcp-client.ts:75

##### cwd?

> `optional` **cwd?**: `string`

Defined in: src/runtime/stdio-mcp-client.ts:77

Working directory the server starts in (a built candidate's worktree, typically).

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/stdio-mcp-client.ts:80

Declared public env for the server process. Only a minimal non-sensitive
subset of the parent env is inherited.

##### protectedEnv?

> `optional` **protectedEnv?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/stdio-mcp-client.ts:83

Sensitive env for the server process. These values override `env` and are
redacted from child-supplied errors, tool metadata, and tool results.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: src/runtime/stdio-mcp-client.ts:85

Handshake AND per-request timeout (ms). Default 30s.

***

### McpToolDescriptor

Defined in: src/runtime/stdio-mcp-client.ts:92

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/stdio-mcp-client.ts:93

##### description?

> `optional` **description?**: `string`

Defined in: src/runtime/stdio-mcp-client.ts:94

##### inputSchema?

> `optional` **inputSchema?**: `unknown`

Defined in: src/runtime/stdio-mcp-client.ts:95

***

### StdioMcpConnection

Defined in: src/runtime/stdio-mcp-client.ts:98

#### Properties

##### tools

> `readonly` **tools**: readonly [`McpToolDescriptor`](#mcptooldescriptor)[]

Defined in: src/runtime/stdio-mcp-client.ts:100

The tools the server exposed at connect time (`tools/list`).

#### Methods

##### callTool()

> **callTool**(`name`, `args`): `Promise`\<`string`\>

Defined in: src/runtime/stdio-mcp-client.ts:104

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

Defined in: src/runtime/stdio-mcp-client.ts:106

Kill the server child. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### MaterializeLocalMcpOptions

Defined in: src/runtime/stdio-mcp-client.ts:293

#### Properties

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: src/runtime/stdio-mcp-client.ts:295

Handshake / per-request timeout per server (ms). Default 30s.

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: src/runtime/stdio-mcp-client.ts:297

Cap on a tool result's text fed back to the worker. Default 2000 chars.

##### keys?

> `optional` **keys?**: [`KeyProvider`](#keyprovider)

Defined in: src/runtime/stdio-mcp-client.ts:303

Resolves a server's DECLARED secrets (`metadata.secretEnv`: env var name →
 provider key name) at spawn time. The resolved values reach ONLY the child
 process env — never the profile, the logs, or an error message. Fail-closed:
 a server declaring secrets without a provider (or with a missing key)
 throws instead of booting keyless.

##### profileSecurityPolicy?

> `optional` **profileSecurityPolicy?**: `AgentProfileSecurityPolicy`

Defined in: src/runtime/stdio-mcp-client.ts:308

Required trust decision for profiles that declare local MCP processes.
Omit to refuse all profile-controlled host execution. Passing
`allowLocalMcp: true` is only safe for an author-controlled profile: the
process receives this Runtime's filesystem and network privileges.

***

### LocalMcpMaterialization

Defined in: src/runtime/stdio-mcp-client.ts:312

The live same-host materialization of a profile's `mcp` surface.

#### Properties

##### tools

> **tools**: [`EnvironmentTool`](#environmenttool)[]

Defined in: src/runtime/stdio-mcp-client.ts:314

Worker-facing tool specs: namespaced `<server>__<tool>`, provider-safe schemas.

#### Methods

##### owns()

> **owns**(`name`): `boolean`

Defined in: src/runtime/stdio-mcp-client.ts:316

Whether `name` is one of this materialization's namespaced tools.

###### Parameters

###### name

`string`

###### Returns

`boolean`

##### call()

> **call**(`name`, `args`): `Promise`\<`string`\>

Defined in: src/runtime/stdio-mcp-client.ts:318

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

Defined in: src/runtime/stdio-mcp-client.ts:320

Kill every spawned server. Idempotent.

###### Returns

`Promise`\<`void`\>

***

### NaiveDriverOptions

Defined in: src/runtime/steering-drivers.ts:82

Options for [naiveDriver](#naivedriver).

#### Type Parameters

##### Task

`Task`

#### Properties

##### continuation

> **continuation**: `string`

Defined in: src/runtime/steering-drivers.ts:89

The fixed continuation issued every round after shot 0. The same string is
sent whether the prior shot passed inspection or not — the naive driver
reads no part of the verdict. Domain text is the caller's; the substrate
supplies none.

##### applyContinuation

> **applyContinuation**: [`ApplyContinuation`](#applycontinuation)\<`Task`\>

Defined in: src/runtime/steering-drivers.ts:91

Folds `continuation` into the caller's Task shape for the next shot.

##### maxIterations

> **maxIterations**: `number`

Defined in: src/runtime/steering-drivers.ts:93

Hard shot cap. The loop stops refining once history reaches this length.

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/steering-drivers.ts:95

Trace-event identifier. Default `'naive'`.

***

### DumbDriverOptions

Defined in: src/runtime/steering-drivers.ts:136

Options for [dumbDriver](#dumbdriver).

#### Type Parameters

##### Task

`Task`

#### Properties

##### onPass

> **onPass**: `string`

Defined in: src/runtime/steering-drivers.ts:143

Continuation issued when the prior shot's verdict is valid. In a
stop-on-pass loop this is rarely reached (a valid shot ends the loop), but
it is required so the driver is total over the pass/fail bit; pass a
confirmation/keep-going string.

##### onFail

> **onFail**: `string`

Defined in: src/runtime/steering-drivers.ts:145

Continuation issued when the prior shot's verdict is NOT valid.

##### applyContinuation

> **applyContinuation**: [`ApplyContinuation`](#applycontinuation)\<`Task`\>

Defined in: src/runtime/steering-drivers.ts:147

Folds the chosen continuation into the caller's Task shape.

##### maxIterations

> **maxIterations**: `number`

Defined in: src/runtime/steering-drivers.ts:149

Hard shot cap. The loop stops refining once history reaches this length.

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/steering-drivers.ts:151

Trace-event identifier. Default `'dumb'`.

***

### AuthorStrategyOptions

Defined in: src/runtime/strategy-author.ts:78

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: src/runtime/strategy-author.ts:80

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/strategy-author.ts:81

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: src/runtime/strategy-author.ts:86

A NAMED fallback author tried once when the primary call fails or returns no code
 block (thinking models time out at the edge on long authoring prompts, or return
 empty content without `maxTokens`). Opt-in — absent means the primary's failure
 propagates.

##### contract?

> `optional` **contract?**: `string`

Defined in: src/runtime/strategy-author.ts:90

The contract text shown to the author. Default `strategyAuthorContract`. The
 meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
 variant on the same frozen holdout as any strategy.

##### environmentName

> **environmentName**: `string`

Defined in: src/runtime/strategy-author.ts:92

The environment the losses came from (orientation only — never the verifiers).

##### lossesJson

> **lossesJson**: `string`

Defined in: src/runtime/strategy-author.ts:94

The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient.

##### budget

> **budget**: `number`

Defined in: src/runtime/strategy-author.ts:96

The budget the strategy must respect (shots/width).

##### outDir

> **outDir**: `string`

Defined in: src/runtime/strategy-author.ts:98

Where the authored module file is written (created if missing).

##### temperature?

> `optional` **temperature?**: `number`

Defined in: src/runtime/strategy-author.ts:99

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: src/runtime/strategy-author.ts:101

Completion cap — required by thinking-model authors that stream reasoning first.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/strategy-author.ts:102

***

### AuthoredStrategy

Defined in: src/runtime/strategy-author.ts:138

#### Properties

##### strategy

> **strategy**: [`Strategy`](#strategy-3)

Defined in: src/runtime/strategy-author.ts:139

##### file

> **file**: `string`

Defined in: src/runtime/strategy-author.ts:140

##### code

> **code**: `string`

Defined in: src/runtime/strategy-author.ts:141

***

### EvolutionAuthor

Defined in: src/runtime/strategy-evolution.ts:47

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: src/runtime/strategy-evolution.ts:49

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/strategy-evolution.ts:50

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: src/runtime/strategy-evolution.ts:51

##### temperature?

> `optional` **temperature?**: `number`

Defined in: src/runtime/strategy-evolution.ts:52

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: src/runtime/strategy-evolution.ts:53

***

### StrategyEvolutionConfig

Defined in: src/runtime/strategy-evolution.ts:58

#### Properties

##### environment

> **environment**: [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/strategy-evolution.ts:59

##### tasks

> **tasks**: (`offset`, `n`) => `Promise`\<[`EnvironmentTask`](#environmenttask)[]\>

Defined in: src/runtime/strategy-evolution.ts:63

Task supply by DISJOINT slice: `(offset, n)` must return n tasks unique to that
 offset range. Train draws [0, trainN); the holdout draws [trainN + holdoutOffset,
 …) — tasks the search never touched.

###### Parameters

###### offset

`number`

###### n

`number`

###### Returns

`Promise`\<[`EnvironmentTask`](#environmenttask)[]\>

##### trainN

> **trainN**: `number`

Defined in: src/runtime/strategy-evolution.ts:64

##### holdoutN

> **holdoutN**: `number`

Defined in: src/runtime/strategy-evolution.ts:65

##### holdoutOffset?

> `optional` **holdoutOffset?**: `number`

Defined in: src/runtime/strategy-evolution.ts:67

Extra offset past the train slice for the holdout draw (rotate across runs).

##### worker

> **worker**: [`StrategyWorkerOptions`](#strategyworkeroptions)

Defined in: src/runtime/strategy-evolution.ts:68

##### modelPreflight?

> `optional` **modelPreflight?**: `false` \| ((`model`, `worker`, `signal`) => `Promise`\<`void`\>)

Defined in: src/runtime/strategy-evolution.ts:75

Model availability check before the first benchmark phase.

A successful check is reused for the remaining phases in this evolution run.
See `BenchmarkConfig.modelPreflight`.

##### modelPreflightTimeoutMs?

> `optional` **modelPreflightTimeoutMs?**: `number`

Defined in: src/runtime/strategy-evolution.ts:77

Maximum time for each model availability check. Default 30 seconds.

##### author

> **author**: [`EvolutionAuthor`](#evolutionauthor)

Defined in: src/runtime/strategy-evolution.ts:78

##### budget?

> `optional` **budget?**: `number`

Defined in: src/runtime/strategy-evolution.ts:80

Rollouts (sample) / shots (refine) per strategy per task. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: src/runtime/strategy-evolution.ts:81

##### generations?

> `optional` **generations?**: `number`

Defined in: src/runtime/strategy-evolution.ts:83

Author→tournament rounds after gen0. Default 2.

##### populationSize?

> `optional` **populationSize?**: `number`

Defined in: src/runtime/strategy-evolution.ts:85

Authored candidates per generation. Default 2.

##### baselines?

> `optional` **baselines?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>[]

Defined in: src/runtime/strategy-evolution.ts:87

The gen0 field. Default [sample, refine, sampleThenRefine].

##### objective?

> `optional` **objective?**: `"score"` \| `"cost"`

Defined in: src/runtime/strategy-evolution.ts:93

What "better" means for PROMOTION. 'score' (default): the candidate must beat the
 incumbent's score (superiority gate). 'cost': the candidate must prove score
 NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
 savings — the "same quality, cheaper" objective. The author is told the objective
 and sees per-task spend either way.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: src/runtime/strategy-evolution.ts:95

Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### champion?

> `optional` **champion?**: [`ChampionPolicy`](#championpolicy)

Defined in: src/runtime/strategy-evolution.ts:97

Search-side champion selection. Default 'costAware'.

##### championEpsilon?

> `optional` **championEpsilon?**: `number`

Defined in: src/runtime/strategy-evolution.ts:99

Score band treated as a tie under 'costAware'. Default 0.01.

##### outDir

> **outDir**: `string`

Defined in: src/runtime/strategy-evolution.ts:101

Where authored modules are written.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: src/runtime/strategy-evolution.ts:103

Promotion-gate evidence floor (paired holdout tasks).

##### band?

> `optional` **band?**: `object`

Defined in: src/runtime/strategy-evolution.ts:112

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

Defined in: src/runtime/strategy-evolution.ts:121

What the author learns from a tournament. 'exact' (default) = scores + progressions
 per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
 per generation reaches the author from the evaluation data).

##### reproducerCheck?

> `optional` **reproducerCheck?**: `object`

Defined in: src/runtime/strategy-evolution.ts:128

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

Defined in: src/runtime/strategy-evolution.ts:138

Endurance: write the run state after every completed phase; with `resume`, a
 restart skips completed phases (authored modules re-imported from their files).
 Worst case after a mid-run death is re-paying ONE phase, never the run.

###### path

> **path**: `string`

###### resume?

> `optional` **resume?**: `boolean`

##### onPhase?

> `optional` **onPhase?**: (`phase`) => `Promise`\<`void`\>

Defined in: src/runtime/strategy-evolution.ts:145

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

Defined in: src/runtime/strategy-evolution.ts:146

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

Defined in: src/runtime/strategy-evolution.ts:147

***

### ChampionPick

Defined in: src/runtime/strategy-evolution.ts:162

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/strategy-evolution.ts:163

##### score

> **score**: `number`

Defined in: src/runtime/strategy-evolution.ts:164

##### usd

> **usd**: `number`

Defined in: src/runtime/strategy-evolution.ts:165

***

### EvolutionCandidate

Defined in: src/runtime/strategy-evolution.ts:168

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/strategy-evolution.ts:169

##### file?

> `optional` **file?**: `string`

Defined in: src/runtime/strategy-evolution.ts:170

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: src/runtime/strategy-evolution.ts:171

##### codeChars?

> `optional` **codeChars?**: `number`

Defined in: src/runtime/strategy-evolution.ts:172

##### error?

> `optional` **error?**: `string`

Defined in: src/runtime/strategy-evolution.ts:174

Present when this author attempt failed (recorded, never silent).

***

### EvolutionGeneration

Defined in: src/runtime/strategy-evolution.ts:177

#### Properties

##### generation

> **generation**: `number`

Defined in: src/runtime/strategy-evolution.ts:178

##### candidates

> **candidates**: [`EvolutionCandidate`](#evolutioncandidate)[]

Defined in: src/runtime/strategy-evolution.ts:179

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: src/runtime/strategy-evolution.ts:180

##### champion

> **champion**: [`ChampionPick`](#championpick)

Defined in: src/runtime/strategy-evolution.ts:181

***

### EvolutionArchiveNode

Defined in: src/runtime/strategy-evolution.ts:184

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/strategy-evolution.ts:185

##### source

> **source**: `"baseline"` \| `"authored"`

Defined in: src/runtime/strategy-evolution.ts:186

##### generation

> **generation**: `number`

Defined in: src/runtime/strategy-evolution.ts:187

##### parent?

> `optional` **parent?**: `string`

Defined in: src/runtime/strategy-evolution.ts:189

The champion whose tournament losses this candidate was authored from.

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: src/runtime/strategy-evolution.ts:190

##### file?

> `optional` **file?**: `string`

Defined in: src/runtime/strategy-evolution.ts:191

##### score

> **score**: `number`

Defined in: src/runtime/strategy-evolution.ts:194

Latest measured tournament result — 0 until the node's first tournament settles
 (an authored node is created before its generation's benchmark runs).

##### usd

> **usd**: `number`

Defined in: src/runtime/strategy-evolution.ts:195

***

### EvolutionBandInfo

Defined in: src/runtime/strategy-evolution.ts:214

#### Properties

##### screened

> **screened**: `number`

Defined in: src/runtime/strategy-evolution.ts:216

Tasks screened by the reference on the holdout pool.

##### inBand

> **inBand**: `number`

Defined in: src/runtime/strategy-evolution.ts:218

Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN.

##### refScores

> **refScores**: `object`[]

Defined in: src/runtime/strategy-evolution.ts:220

Reference scores per screened task (the screening record).

###### taskId

> **taskId**: `string`

###### score

> **score**: `number`

***

### EvolutionReport

Defined in: src/runtime/strategy-evolution.ts:223

#### Properties

##### gen0

> **gen0**: [`BenchmarkReport`](#benchmarkreport)

Defined in: src/runtime/strategy-evolution.ts:224

##### gen0Champion

> **gen0Champion**: [`ChampionPick`](#championpick)

Defined in: src/runtime/strategy-evolution.ts:225

##### generations

> **generations**: [`EvolutionGeneration`](#evolutiongeneration)[]

Defined in: src/runtime/strategy-evolution.ts:226

##### archive

> **archive**: [`EvolutionArchiveNode`](#evolutionarchivenode)[]

Defined in: src/runtime/strategy-evolution.ts:227

##### finalChampion

> **finalChampion**: [`ChampionPick`](#championpick)

Defined in: src/runtime/strategy-evolution.ts:228

##### holdout

> **holdout**: [`BenchmarkReport`](#benchmarkreport)

Defined in: src/runtime/strategy-evolution.ts:229

##### verdict

> **verdict**: [`PromotionVerdict`](#promotionverdict)

Defined in: src/runtime/strategy-evolution.ts:230

##### band?

> `optional` **band?**: [`EvolutionBandInfo`](#evolutionbandinfo)

Defined in: src/runtime/strategy-evolution.ts:233

Present when band screening ran — the verdict's estimand is then "paired lift on
 headroom tasks" (band membership fixed by the reference screen, pre-registered).

##### reproduction?

> `optional` **reproduction?**: `ReproductionCheck`

Defined in: src/runtime/strategy-evolution.ts:235

Present when reproducerCheck ran (final champion was authored).

##### trajectory

> **trajectory**: `object`[]

Defined in: src/runtime/strategy-evolution.ts:240

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

### EnvironmentTask

Defined in: src/runtime/strategy.ts:47

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/strategy.ts:48

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: src/runtime/strategy.ts:49

##### userPrompt

> `readonly` **userPrompt**: `string`

Defined in: src/runtime/strategy.ts:50

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `unknown`\>

Defined in: src/runtime/strategy.ts:52

Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it.

***

### ArtifactHandle

Defined in: src/runtime/strategy.ts:55

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/strategy.ts:56

##### surface

> `readonly` **surface**: `string`

Defined in: src/runtime/strategy.ts:57

##### ctx?

> `readonly` `optional` **ctx?**: `unknown`

Defined in: src/runtime/strategy.ts:59

Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id).

***

### EnvironmentTool

Defined in: src/runtime/strategy.ts:62

#### Properties

##### type

> `readonly` **type**: `"function"`

Defined in: src/runtime/strategy.ts:63

##### function

> `readonly` **function**: `object`

Defined in: src/runtime/strategy.ts:64

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

***

### EnvironmentScore

Defined in: src/runtime/strategy.ts:67

#### Properties

##### passes

> **passes**: `number`

Defined in: src/runtime/strategy.ts:68

##### total

> **total**: `number`

Defined in: src/runtime/strategy.ts:69

##### errored

> **errored**: `number`

Defined in: src/runtime/strategy.ts:71

Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable.

***

### TaskEnvironment

Defined in: src/runtime/strategy.ts:75

A stateful, checkable environment an agent operates over with tools. Open behind one interface.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: src/runtime/strategy.ts:76

#### Methods

##### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](#artifacthandle)\>

Defined in: src/runtime/strategy.ts:77

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### Returns

`Promise`\<[`ArtifactHandle`](#artifacthandle)\>

##### tools()

> **tools**(`task`, `handle`): `Promise`\<[`EnvironmentTool`](#environmenttool)[]\>

Defined in: src/runtime/strategy.ts:78

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`EnvironmentTool`](#environmenttool)[]\>

##### call()

> **call**(`handle`, `name`, `args`): `Promise`\<`string`\>

Defined in: src/runtime/strategy.ts:79

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

> **score**(`task`, `handle`): `Promise`\<[`EnvironmentScore`](#environmentscore)\>

Defined in: src/runtime/strategy.ts:80

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`EnvironmentScore`](#environmentscore)\>

##### close()

> **close**(`handle`): `Promise`\<`void`\>

Defined in: src/runtime/strategy.ts:81

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

***

### StrategyWorkerOptions

Defined in: src/runtime/strategy.ts:84

#### Extended by

- [`RunStrategyOptions`](#runstrategyoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: src/runtime/strategy.ts:85

##### routerKey

> **routerKey**: `string`

Defined in: src/runtime/strategy.ts:86

##### model

> **model**: `string`

Defined in: src/runtime/strategy.ts:87

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: src/runtime/strategy.ts:93

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

Defined in: src/runtime/strategy.ts:94

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: src/runtime/strategy.ts:97

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: src/runtime/strategy.ts:99

Turns the agent may take within ONE shot before the driver intervenes.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: src/runtime/strategy.ts:102

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: src/runtime/strategy.ts:105

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: src/runtime/strategy.ts:109

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: src/runtime/strategy.ts:111

Tags written onto learned facts (and used by the caller's priming query).

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

Defined in: src/runtime/strategy.ts:114

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

***

### CorpusReadbackOptions

Defined in: src/runtime/strategy.ts:117

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: src/runtime/strategy.ts:119

Minimum confidence for a fact to be injected. Default 0.7.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: src/runtime/strategy.ts:121

Extra tags a fact must carry, in addition to `corpusTags`.

##### maxFacts?

> `optional` **maxFacts?**: `number`

Defined in: src/runtime/strategy.ts:123

Max facts injected per shot. Default 3.

##### includeOperatorFacts?

> `optional` **includeOperatorFacts?**: `boolean`

Defined in: src/runtime/strategy.ts:125

Default false: only facts tagged `audience:agent` are injected into the worker.

***

### StrategyRunResult

Defined in: src/runtime/strategy.ts:607

#### Properties

##### mode

> **mode**: `string`

Defined in: src/runtime/strategy.ts:609

The strategy name (built-in 'depth'/'breadth' or a custom strategy's name).

##### score

> **score**: `number`

Defined in: src/runtime/strategy.ts:610

##### resolved

> **resolved**: `boolean`

Defined in: src/runtime/strategy.ts:611

##### completions

> **completions**: `number`

Defined in: src/runtime/strategy.ts:612

##### progression

> **progression**: `number`[]

Defined in: src/runtime/strategy.ts:614

DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout.

##### shots

> **shots**: `number`

Defined in: src/runtime/strategy.ts:615

##### usd

> **usd**: `number`

Defined in: src/runtime/strategy.ts:618

The cost vector, stamped by `runStrategy` from the Supervisor's conserved pool: real
 router tokens, priced usd (0 when the model is unpriced — never fabricated), wall ms.

##### ms

> **ms**: `number`

Defined in: src/runtime/strategy.ts:619

##### tokens

> **tokens**: `object`

Defined in: src/runtime/strategy.ts:620

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### Strategy

Defined in: src/runtime/strategy.ts:759

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: src/runtime/strategy.ts:760

#### Methods

##### driver()

> **driver**(`surface`, `task`, `opts`, `budget`): [`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

Defined in: src/runtime/strategy.ts:763

###### Parameters

###### surface

[`TaskEnvironment`](#taskenvironment)

###### task

[`EnvironmentTask`](#environmenttask)

###### opts

[`StrategyWorkerOptions`](#strategyworkeroptions)

###### budget

`number`

###### Returns

[`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

***

### ShotPersona

Defined in: src/runtime/strategy.ts:793

A role for one shot — multi-agent loops (researcher + engineer, a panel of k
 researchers) give each shot its own system prompt and optionally its own model.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: src/runtime/strategy.ts:796

Replaces the task's systemPrompt for a FRESH shot; on a carried conversation it is
 injected as a hand-off message (the transcript's earlier roles stay intact).

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/strategy.ts:798

Per-shot model override (e.g. a stronger model for the engineer shot).

***

### ShotSpec

Defined in: src/runtime/strategy.ts:801

#### Properties

##### handle?

> `optional` **handle?**: [`ArtifactHandle`](#artifacthandle)

Defined in: src/runtime/strategy.ts:803

present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart).

##### messages?

> `optional` **messages?**: `Msg`[]

Defined in: src/runtime/strategy.ts:804

##### steer?

> `optional` **steer?**: `string`

Defined in: src/runtime/strategy.ts:805

##### persona?

> `optional` **persona?**: [`ShotPersona`](#shotpersona)

Defined in: src/runtime/strategy.ts:806

##### tools?

> `optional` **tools?**: `string`[]

Defined in: src/runtime/strategy.ts:809

Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
 the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all.

***

### StrategyResult

Defined in: src/runtime/strategy.ts:811

#### Extended by

- [`StructuralRolloutResult`](#structuralrolloutresult)

#### Properties

##### score

> **score**: `number`

Defined in: src/runtime/strategy.ts:812

##### resolved

> **resolved**: `boolean`

Defined in: src/runtime/strategy.ts:813

##### completions

> **completions**: `number`

Defined in: src/runtime/strategy.ts:814

##### progression

> **progression**: `number`[]

Defined in: src/runtime/strategy.ts:815

##### shots

> **shots**: `number`

Defined in: src/runtime/strategy.ts:816

***

### StrategyCtx

Defined in: src/runtime/strategy.ts:828

What a strategy body composes with: the artifact lifecycle, the budget, and the two steps.

#### Properties

##### surface

> `readonly` **surface**: `StrategyArtifacts`

Defined in: src/runtime/strategy.ts:830

Open/close artifacts the body manages itself (e.g. one persistent handle for depth).

##### task

> `readonly` **task**: [`EnvironmentTask`](#environmenttask)

Defined in: src/runtime/strategy.ts:831

##### opts

> `readonly` **opts**: [`StrategyWorkerOptions`](#strategyworkeroptions)

Defined in: src/runtime/strategy.ts:832

##### budget

> `readonly` **budget**: `number`

Defined in: src/runtime/strategy.ts:833

##### scope

> `readonly` **scope**: [`Scope`](#scope-1)\<`Outcome`\<`unknown`\>\>

Defined in: src/runtime/strategy.ts:834

#### Methods

##### shot()

> **shot**(`spec?`): `Promise`\<`ShotResult` \| `null`\>

Defined in: src/runtime/strategy.ts:836

Run ONE worker shot; its harness-scored result, or null if it went down.

###### Parameters

###### spec?

[`ShotSpec`](#shotspec)

###### Returns

`Promise`\<`ShotResult` \| `null`\>

##### critique()

> **critique**(`messages`): `Promise`\<`string` \| `null`\>

Defined in: src/runtime/strategy.ts:838

The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down.

###### Parameters

###### messages

`Msg`[]

###### Returns

`Promise`\<`string` \| `null`\>

##### consult()

> **consult**(`messages`, `instruction`): `Promise`\<`string` \| `null`\>

Defined in: src/runtime/strategy.ts:843

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

Defined in: src/runtime/strategy.ts:847

The tools THIS artifact's task actually offers (names + descriptions only — never
 the implementations). Tool sets vary per task on heterogeneous domains; a strategy
 that restricts shots MUST select from this list, never from hardcoded names.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`object`[]\>

***

### RunStrategyOptions

Defined in: src/runtime/strategy.ts:1076

#### Extends

- [`StrategyWorkerOptions`](#strategyworkeroptions)

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: src/runtime/strategy.ts:85

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`routerBaseUrl`](#routerbaseurl-2)

##### routerKey

> **routerKey**: `string`

Defined in: src/runtime/strategy.ts:86

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`routerKey`](#routerkey-2)

##### model

> **model**: `string`

Defined in: src/runtime/strategy.ts:87

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`model`](#model-8)

##### complete?

> `optional` **complete?**: (`body`) => `Promise`\<`unknown`\>

Defined in: src/runtime/strategy.ts:93

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

[`StrategyWorkerOptions`](#strategyworkeroptions).[`complete`](#complete-1)

##### temperature?

> `optional` **temperature?**: `number`

Defined in: src/runtime/strategy.ts:94

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`temperature`](#temperature-3)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: src/runtime/strategy.ts:97

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`maxTokens`](#maxtokens-2)

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: src/runtime/strategy.ts:99

Turns the agent may take within ONE shot before the driver intervenes.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`innerTurns`](#innerturns)

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: src/runtime/strategy.ts:102

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`analystInstruction`](#analystinstruction-2)

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: src/runtime/strategy.ts:105

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`analystModel`](#analystmodel)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: src/runtime/strategy.ts:109

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Read-back is opt-in via `corpusReadback`
 because unconditional priming can pollute context on some domains.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`corpus`](#corpus-4)

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: src/runtime/strategy.ts:111

Tags written onto learned facts (and used by the caller's priming query).

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`corpusTags`](#corpustags)

##### corpusReadback?

> `optional` **corpusReadback?**: [`CorpusReadbackOptions`](#corpusreadbackoptions)

Defined in: src/runtime/strategy.ts:114

In-context learning: when set, query `corpus` before each depth shot and inject
 the top trace-derived facts as guidance for the active run. No corpus means no read-back.

###### Inherited from

[`StrategyWorkerOptions`](#strategyworkeroptions).[`corpusReadback`](#corpusreadback)

##### surface

> **surface**: [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/strategy.ts:1078

##### task

> **task**: [`EnvironmentTask`](#environmenttask)

Defined in: src/runtime/strategy.ts:1079

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: src/runtime/strategy.ts:1082

Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
 The seam online watchdogs/route-auditors subscribe to.

##### strategy?

> `optional` **strategy?**: [`Strategy`](#strategy-3)\<`Result`\>

Defined in: src/runtime/strategy.ts:1084

A Strategy (the open way) — author/pass your own. Overrides `mode` when present.

##### mode?

> `optional` **mode?**: `"depth"` \| `"breadth"`

Defined in: src/runtime/strategy.ts:1086

Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'.

##### budget

> **budget**: `number`

Defined in: src/runtime/strategy.ts:1088

budget: refine→max shots; sample→rollout width.

##### rootBudget?

> `optional` **rootBudget?**: [`Budget`](#budget-10)

Defined in: src/runtime/strategy.ts:1089

***

### StreamAgentTurnOptions

Defined in: src/runtime/stream-agent-turn.ts:69

**`Experimental`**

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/stream-agent-turn.ts:71

**`Experimental`**

Caller-initiated cancellation. Terminates the stream with `final.status: 'aborted'`.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: src/runtime/stream-agent-turn.ts:77

**`Experimental`**

Wall-clock deadline for the whole turn in ms. An expired deadline aborts
the turn and terminates the stream with `final.status: 'failed'`
(a blown deadline is a turn failure, not a caller cancellation).

##### preserveToolParts?

> `optional` **preserveToolParts?**: `boolean`

Defined in: src/runtime/stream-agent-turn.ts:82

**`Experimental`**

Project provider tool parts as `tool_call` and `tool_result` events.
Default false.

##### onRawEvent?

> `optional` **onRawEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/stream-agent-turn.ts:86

**`Experimental`**

Called and awaited for every provider event before projection.

###### Parameters

###### event

`AgentEnvironmentEvent`

###### Returns

`void` \| `Promise`\<`void`\>

***

### AgentTurnUsage

Defined in: src/runtime/stream-agent-turn.ts:97

**`Experimental`**

Metered usage of one turn, summed over every cost-bearing provider event.
`input`/`output` are token counts (0 when the provider reported
none — the honest sum, never a fabricated estimate). `costUsd`/`model` are
present only when the backend actually reported them.

#### Properties

##### input

> **input**: `number`

Defined in: src/runtime/stream-agent-turn.ts:98

**`Experimental`**

##### output

> **output**: `number`

Defined in: src/runtime/stream-agent-turn.ts:99

**`Experimental`**

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: src/runtime/stream-agent-turn.ts:100

**`Experimental`**

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/stream-agent-turn.ts:101

**`Experimental`**

***

### CollectedAgentTurn

Defined in: src/runtime/stream-agent-turn.ts:111

**`Experimental`**

A drained turn: the terminal summary plus every event the stream yielded.
`status`/`error` mirror the terminal `final` event so a failed or aborted
turn stays inspectable without re-scanning `events`.

#### Properties

##### finalText

> **finalText**: `string`

Defined in: src/runtime/stream-agent-turn.ts:112

**`Experimental`**

##### usage

> **usage**: [`AgentTurnUsage`](#agentturnusage)

Defined in: src/runtime/stream-agent-turn.ts:113

**`Experimental`**

##### events

> **events**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: src/runtime/stream-agent-turn.ts:114

**`Experimental`**

##### status

> **status**: [`AgentTaskStatus`](index.md#agenttaskstatus)

Defined in: src/runtime/stream-agent-turn.ts:115

**`Experimental`**

##### error?

> `optional` **error?**: [`AgentTurnError`](index.md#agentturnerror)

Defined in: src/runtime/stream-agent-turn.ts:116

**`Experimental`**

***

### StructuralRolloutPolicy

Defined in: src/runtime/structural-rollout.ts:42

The rollout's compute recipe — promoted from the proven rigs' env vars (K/REPAIRS/
 TESTGEN/DIVERSE/TEMPERATURE). Defaults are the measured sweet spot: repair value
 concentrates at low k (~+12pp at k=1, +1–3pp at k=5), so `k=5, repairRounds=2` is the
 full recipe and `k=1, repairRounds=2` the low-compute preset.

#### Properties

##### k

> **k**: `number`

Defined in: src/runtime/structural-rollout.ts:44

Independent samples per task (selection breadth).

##### repairRounds

> **repairRounds**: `number`

Defined in: src/runtime/structural-rollout.ts:46

Repair shots after selection, each steered by the checks' failure output.

##### testgen

> **testgen**: `number`

Defined in: src/runtime/structural-rollout.ts:48

Model-authored visible checks requested per task; 0 disables authoring.

##### diverse?

> `optional` **diverse?**: `boolean`

Defined in: src/runtime/structural-rollout.ts:51

Per-slot strategy-lens prefixes on the k samples (attacks the all-k-fail bucket).
 Measured as a paired null (+0.6pp) — kept as an optional knob, off by default.

##### temperature?

> `optional` **temperature?**: `number`

Defined in: src/runtime/structural-rollout.ts:53

Sampling temperature for every shot of this strategy; omitted ⇒ the worker default.

***

### VisibleCheck

Defined in: src/runtime/structural-rollout.ts:84

One task-visible executable check (e.g. a single-line Python assert).

#### Properties

##### code

> **code**: `string`

Defined in: src/runtime/structural-rollout.ts:85

##### kind

> **kind**: `"authored"` \| `"official"`

Defined in: src/runtime/structural-rollout.ts:88

'official' = shown in the task itself (docstring example, shown assert);
 'authored' = the model's own guess. Official outranks authored in selection.

***

### CheckSourceCtx

Defined in: src/runtime/structural-rollout.ts:94

What a CheckSource composes with. `consult` is the strategy family's raw analyst
 channel (metered by the conserved pool, offline-injectable via `opts.complete`) —
 check authoring goes through it rather than a bespoke model client.

#### Properties

##### count

> **count**: `number`

Defined in: src/runtime/structural-rollout.ts:96

Authored-check budget for this task (`policy.testgen`).

##### entrySymbol?

> `optional` **entrySymbol?**: `string`

Defined in: src/runtime/structural-rollout.ts:99

The symbol authored checks must reference; undefined ⇒ authoring is skipped
 (no guesses beats guesses pinned to nothing).

#### Methods

##### consult()

> **consult**(`instruction`): `Promise`\<`string` \| `null`\>

Defined in: src/runtime/structural-rollout.ts:102

One metered LLM call: instruction in, reply text out, null when the channel went
 down. The task's visible prompt is included by the channel itself.

###### Parameters

###### instruction

`string`

###### Returns

`Promise`\<`string` \| `null`\>

***

### CheckSource

Defined in: src/runtime/structural-rollout.ts:108

Produces the task's visible checks. MUST derive them from agent-visible information
 only, before any candidate exists — the strategy freezes the returned set for every
 sample and repair round of the task.

#### Methods

##### generate()

> **generate**(`task`, `ctx`): `Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

Defined in: src/runtime/structural-rollout.ts:109

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### ctx

[`CheckSourceCtx`](#checksourcectx)

###### Returns

`Promise`\<[`VisibleCheck`](#visiblecheck)[]\>

***

### CheckOutcome

Defined in: src/runtime/structural-rollout.ts:202

How one candidate fared against the frozen visible checks, split by check kind.

#### Properties

##### passedOfficial

> **passedOfficial**: `number`

Defined in: src/runtime/structural-rollout.ts:203

##### totalOfficial

> **totalOfficial**: `number`

Defined in: src/runtime/structural-rollout.ts:204

##### passedAuthored

> **passedAuthored**: `number`

Defined in: src/runtime/structural-rollout.ts:205

##### totalAuthored

> **totalAuthored**: `number`

Defined in: src/runtime/structural-rollout.ts:206

##### failureOutput

> **failureOutput**: `string`

Defined in: src/runtime/structural-rollout.ts:208

The checks' failure report — the ONLY feedback the repair loop may see.

##### crashed?

> `optional` **crashed?**: `boolean`

Defined in: src/runtime/structural-rollout.ts:211

True when the candidate crashed before any check could run — ranks below a
 candidate that ran and failed everything.

***

### CheckExecChannel

Defined in: src/runtime/structural-rollout.ts:216

Minimal exec channel the default runner needs. `SandboxInstance` (and therefore
 `ValidationCtx.box`) satisfies it structurally.

#### Methods

##### exec()

> **exec**(`command`, `options?`): `Promise`\<\{ `exitCode`: `number`; `stdout`: `string`; `stderr`: `string`; \}\>

Defined in: src/runtime/structural-rollout.ts:217

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

Defined in: src/runtime/structural-rollout.ts:223

#### Properties

##### task

> **task**: [`EnvironmentTask`](#environmenttask)

Defined in: src/runtime/structural-rollout.ts:224

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Defined in: src/runtime/structural-rollout.ts:226

Live exec channel for this run (`ValidationCtx.box` / a sandbox instance).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/structural-rollout.ts:227

***

### CheckRunner

Defined in: src/runtime/structural-rollout.ts:232

Executes the frozen checks against one candidate. Implementations MUST fail loud
 (throw) when they cannot execute — a silent zero poisons selection.

#### Methods

##### run()

> **run**(`candidate`, `checks`, `ctx`): `Promise`\<[`CheckOutcome`](#checkoutcome)\>

Defined in: src/runtime/structural-rollout.ts:233

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

Defined in: src/runtime/structural-rollout.ts:486

The body's deliverable — a `StrategyResult` plus selection provenance. The extra
 fields ride through `defineStrategy`'s deliverable spread onto `StrategyRunResult`
 (score/resolved stay harness-verified, exactly as for every authored strategy).

#### Extends

- [`StrategyResult`](#strategyresult-1)

#### Properties

##### score

> **score**: `number`

Defined in: src/runtime/strategy.ts:812

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`score`](#score-9)

##### resolved

> **resolved**: `boolean`

Defined in: src/runtime/strategy.ts:813

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`resolved`](#resolved-4)

##### completions

> **completions**: `number`

Defined in: src/runtime/strategy.ts:814

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`completions`](#completions-1)

##### progression

> **progression**: `number`[]

Defined in: src/runtime/strategy.ts:815

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`progression`](#progression-2)

##### shots

> **shots**: `number`

Defined in: src/runtime/strategy.ts:816

###### Inherited from

[`StrategyResult`](#strategyresult-1).[`shots`](#shots-3)

##### artifact

> **artifact**: `string` \| `null`

Defined in: src/runtime/structural-rollout.ts:488

Exact selected candidate text passed to the visible checks, or null when no shot ran.

##### selection

> **selection**: [`SelectionReceipt`](#selectionreceipt)[]

Defined in: src/runtime/structural-rollout.ts:491

One receipt per scored candidate (k samples, then repairs), `SelectionReceipt`
 shaped like the kernel's (`types.ts`), selector 'driver'.

##### repairStop

> **repairStop**: [`RepairStop`](#repairstop)

Defined in: src/runtime/structural-rollout.ts:492

##### officialChecks

> **officialChecks**: `number`

Defined in: src/runtime/structural-rollout.ts:493

##### authoredChecks

> **authoredChecks**: `number`

Defined in: src/runtime/structural-rollout.ts:494

***

### StructuralRolloutConfig

Defined in: src/runtime/structural-rollout.ts:497

#### Properties

##### policy?

> `optional` **policy?**: `Partial`\<[`StructuralRolloutPolicy`](#structuralrolloutpolicy)\>

Defined in: src/runtime/structural-rollout.ts:499

Knobs; missing fields take the measured defaults (k=5, repairRounds=2, testgen=6).

##### checkSource?

> `optional` **checkSource?**: [`CheckSource`](#checksource)

Defined in: src/runtime/structural-rollout.ts:502

Where the visible checks come from. Default: official checks from
 `task.meta.visibleChecks` composed with `modelAuthoredChecks()`.

##### checkRunner?

> `optional` **checkRunner?**: [`CheckRunner`](#checkrunner)

Defined in: src/runtime/structural-rollout.ts:505

How candidates are measured. Default `sandboxCheckRunner()` — it needs an exec
 channel (bind one to the runner, or pass `box` here) and fails loud without one.

##### box?

> `optional` **box?**: [`CheckExecChannel`](#checkexecchannel)

Defined in: src/runtime/structural-rollout.ts:509

Exec channel threaded into every check run of this strategy (a sandbox instance /
 `ValidationCtx.box`). The strategy seam itself carries no sandbox, so the caller
 who owns one supplies it here or binds it into the runner.

##### extractCandidate?

> `optional` **extractCandidate?**: (`messages`) => `string`

Defined in: src/runtime/structural-rollout.ts:511

Candidate extraction from a shot's conversation. Default `defaultExtractCandidate`.

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`string`

***

### SurfaceWorkerOut

Defined in: src/runtime/supervise-surface.ts:34

What a surface worker settles with — the surface verdict the driver + deliverable read. `resolved` is
 the surface check's pass/fail (settled ⟺ resolved); `score` is the partial-credit fraction; `failing`
 carries the tests this worker left red (so the analyst can target them).

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

Defined in: src/runtime/supervise-surface.ts:35

##### score

> `readonly` **score**: `number`

Defined in: src/runtime/supervise-surface.ts:36

##### shots

> `readonly` **shots**: `number`

Defined in: src/runtime/supervise-surface.ts:37

##### summary

> `readonly` **summary**: `string`

Defined in: src/runtime/supervise-surface.ts:38

##### failing?

> `readonly` `optional` **failing?**: readonly `string`[]

Defined in: src/runtime/supervise-surface.ts:39

***

### SurfaceWorkerConfig

Defined in: src/runtime/supervise-surface.ts:102

How a worker runs the surface task (its router substrate + per-attempt bounds).

#### Properties

##### routerBaseUrl

> `readonly` **routerBaseUrl**: `string`

Defined in: src/runtime/supervise-surface.ts:103

##### routerKey

> `readonly` **routerKey**: `string`

Defined in: src/runtime/supervise-surface.ts:104

##### model

> `readonly` **model**: `string`

Defined in: src/runtime/supervise-surface.ts:105

##### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: src/runtime/supervise-surface.ts:106

##### innerTurns?

> `readonly` `optional` **innerTurns?**: `number`

Defined in: src/runtime/supervise-surface.ts:107

##### budget?

> `readonly` `optional` **budget?**: `number`

Defined in: src/runtime/supervise-surface.ts:109

Refine-shot budget for ONE worker attempt (max steered shots). Default 1.

***

### SuperviseSurfaceOptions

Defined in: src/runtime/supervise-surface.ts:168

#### Properties

##### surface

> `readonly` **surface**: [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/supervise-surface.ts:170

The graded surface workers solve (open/tools/call/score/close).

##### worker

> `readonly` **worker**: [`SurfaceWorkerConfig`](#surfaceworkerconfig)

Defined in: src/runtime/supervise-surface.ts:172

Where/how each worker runs the surface task.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise-surface.ts:175

The conserved compute pool for the whole supervised run. Default: sized off the worker's inner-loop
 bounds for a handful of worker spawns — raise it to let the driver try more.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: src/runtime/supervise-surface.ts:178

The driver brain's router substrate (its own inference). Default: the worker's router + model — the
 driver and workers share one router unless you separate them (e.g. a stronger driver model).

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry) \| `null`

Defined in: src/runtime/supervise-surface.ts:182

The self-improvement lens fed to the driver on each settled worker. Default `failuresAnalyst()`
 (target the still-failing tests). Pass a custom registry to change it, or `null` to turn the
 within-run self-improvement OFF (the driver sees raw settled outputs).

##### strategy?

> `readonly` `optional` **strategy?**: [`Strategy`](#strategy-3)\<[`StrategyResult`](#strategyresult-1)\>

Defined in: src/runtime/supervise-surface.ts:184

The strategy each worker runs over the surface. Default `refine` (iterate-with-feedback).

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: src/runtime/supervise-surface.ts:187

Max workers live at once. Default 1 (serial — required when workers share a persistent artifact, so
 they continue each other instead of racing the file).

***

### SuperviseSurfaceResult

Defined in: src/runtime/supervise-surface.ts:191

The deployable outcome of a supervised surface run.

#### Properties

##### resolved

> `readonly` **resolved**: `boolean`

Defined in: src/runtime/supervise-surface.ts:192

##### score

> `readonly` **score**: `number`

Defined in: src/runtime/supervise-surface.ts:193

##### usd

> `readonly` **usd**: `number`

Defined in: src/runtime/supervise-surface.ts:194

##### tokensIn

> `readonly` **tokensIn**: `number`

Defined in: src/runtime/supervise-surface.ts:195

##### tokensOut

> `readonly` **tokensOut**: `number`

Defined in: src/runtime/supervise-surface.ts:196

##### ms

> `readonly` **ms**: `number`

Defined in: src/runtime/supervise-surface.ts:197

##### completions

> `readonly` **completions**: `number`

Defined in: src/runtime/supervise-surface.ts:199

Total conserved-pool iterations = the driver + worker LLM rounds the run actually spent.

***

### AuthoredProfile

Defined in: src/runtime/supervise/authoring.ts:25

What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`).

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/supervise/authoring.ts:26

##### systemPrompt

> **systemPrompt**: `string`

Defined in: src/runtime/supervise/authoring.ts:28

The rich, task-specific instructions the supervisor wrote for THIS worker.

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/supervise/authoring.ts:30

The model the supervisor chose for this sub-task (falls back to the run default).

***

### ProfileRichnessThresholds

Defined in: src/runtime/supervise/authoring.ts:132

Thresholds below which a system prompt is treated as a thin stub. Tunable per call.

#### Properties

##### minSystemPromptChars

> `readonly` **minSystemPromptChars**: `number`

Defined in: src/runtime/supervise/authoring.ts:134

A prompt shorter than this many characters is thin (default 600).

##### minSystemPromptLines

> `readonly` **minSystemPromptLines**: `number`

Defined in: src/runtime/supervise/authoring.ts:136

A prompt with fewer than this many non-blank lines is thin (default 6).

***

### ProfileRichness

Defined in: src/runtime/supervise/authoring.ts:146

Per-field verdict on one authored profile — the raw material the bench renders + scores.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: src/runtime/supervise/authoring.ts:147

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: src/runtime/supervise/authoring.ts:150

The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
 convention, or a bare-string prompt — whichever the author used).

##### systemPromptChars

> `readonly` **systemPromptChars**: `number`

Defined in: src/runtime/supervise/authoring.ts:151

##### systemPromptLines

> `readonly` **systemPromptLines**: `number`

Defined in: src/runtime/supervise/authoring.ts:152

##### sentenceCount

> `readonly` **sentenceCount**: `number`

Defined in: src/runtime/supervise/authoring.ts:153

##### hasDescription

> `readonly` **hasDescription**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:154

##### hasTools

> `readonly` **hasTools**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:155

##### hasSkills

> `readonly` **hasSkills**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:156

##### hasMcp

> `readonly` **hasMcp**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:157

##### hasSubagents

> `readonly` **hasSubagents**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:158

##### richness

> `readonly` **richness**: `number`

Defined in: src/runtime/supervise/authoring.ts:160

0..1 — fraction of richness signals present (prompt-depth + the four levers).

##### thin

> `readonly` **thin**: `boolean`

Defined in: src/runtime/supervise/authoring.ts:162

True when the supervisor authored a stub instead of a real profile.

##### reasons

> `readonly` **reasons**: `string`[]

Defined in: src/runtime/supervise/authoring.ts:164

The specific reasons it is thin (empty when rich) — used in the finding's action.

***

### ReservationTicket

Defined in: src/runtime/supervise/budget.ts:30

Opaque, single-use reservation handle returned by `reserve` and consumed by
 `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup.

#### Properties

##### id

> `readonly` **id**: `number`

Defined in: src/runtime/supervise/budget.ts:31

##### reserved

> `readonly` **reserved**: `object`

Defined in: src/runtime/supervise/budget.ts:32

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

###### iterations

> `readonly` **iterations**: `number`

***

### BudgetPool

Defined in: src/runtime/supervise/budget.ts:52

#### Methods

##### reserve()

> **reserve**(`b`): \{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

Defined in: src/runtime/supervise/budget.ts:58

Atomically reserve a child's full ceiling from the free balance. Fails closed
({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
caller inspects `ok` before `ticket`.

###### Parameters

###### b

[`Budget`](#budget-10)

###### Returns

\{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

##### reconcile()

> **reconcile**(`ticket`, `spent`): `void`

Defined in: src/runtime/supervise/budget.ts:66

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

Defined in: src/runtime/supervise/budget.ts:70

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

Defined in: src/runtime/supervise/budget.ts:72

The current readout, reflecting all outstanding reservations.

###### Returns

[`BudgetReadout`](#budgetreadout)

##### observe()

> **observe**(`spend`): `void`

Defined in: src/runtime/supervise/budget.ts:83

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

Defined in: src/runtime/supervise/budget.ts:87

Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
 supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
 reservation would silently break `total ≡ free + reserved + committed`).

###### Returns

`void`

***

### DeliverableSpec

Defined in: src/runtime/supervise/completion-gate.ts:32

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

Defined in: src/runtime/supervise/completion-gate.ts:34

The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`.

###### Parameters

###### out

`Out`

###### Returns

`boolean` \| `Promise`\<`boolean`\>

##### describe?

> `optional` **describe?**: `string`

Defined in: src/runtime/supervise/completion-gate.ts:36

What the spawn was supposed to produce — surfaced in traces/reports.

***

### DriverAgentOptions

Defined in: src/runtime/supervise/coordination-driver.ts:54

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: src/runtime/supervise/coordination-driver.ts:55

##### brain

> `readonly` **brain**: [`ToolLoopChat`](#toolloopchat)

Defined in: src/runtime/supervise/coordination-driver.ts:59

The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
 (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
 production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: src/runtime/supervise/coordination-driver.ts:61

Shared blob store — `observe_agent` reads settled outputs through it.

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: src/runtime/supervise/coordination-driver.ts:63

Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/coordination-driver.ts:65

Per-child budget reserved from the conserved pool on each spawn.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: src/runtime/supervise/coordination-driver.ts:68

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: src/runtime/supervise/coordination-driver.ts:71

The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
 Unset → no analyst feed (status quo: the driver gets settled outputs, no findings).

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: src/runtime/supervise/coordination-driver.ts:75

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
 `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
 loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: `WorkerWatchOptions`

Defined in: src/runtime/supervise/coordination-driver.ts:79

Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
 moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
 Omit = no online watching.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Defined in: src/runtime/supervise/coordination-driver.ts:82

Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
 killed). Omit = the runtime default.

##### systemPrompt

> `readonly` **systemPrompt**: `string` \| ((`task`) => `string`)

Defined in: src/runtime/supervise/coordination-driver.ts:85

The driver's stance — a string, or built from the task (the worker-driver prompt /
 the generator). INJECTED so the prompt is a pluggable, optimizable role.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: src/runtime/supervise/coordination-driver.ts:90

WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
 not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
 Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
 `executeExtraTool`. Unset → coordination-only (the prior behavior).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: src/runtime/supervise/coordination-driver.ts:97

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

Defined in: src/runtime/supervise/coordination-driver.ts:105

Max driver turns before the loop force-finalizes on the best settled child. Default 16.
 `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
 an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
 anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: src/runtime/supervise/coordination-driver.ts:108

Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
 deterministic in tests. Defaults to `Date.now`.

###### Returns

`number`

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/coordination-driver.ts:123

PROGRESS-derived stop (mechanic D). Today a run ends on a ceiling — iterations, tokens,
dollars, deadline, turn cap — which answers "may it continue?" and never "is it still getting
anywhere?". A stop rule reads the run's own progress (best-so-far over settled work, time
since the last settle, the live worker feed) and ends a run that has stopped learning BEFORE
it exhausts a budget.

Composes with, and can never override, the hard guards: `poolStarved` / `deadlinePassed` /
abort / the driver's own stop are evaluated first, so a rule can only ADD a stop.

THRESHOLDS are the caller's judgment, not this module's — build the rule with
`plateau({window, minDelta})` / `noProgressFor({...})` / `allWorkersStalled({...})` from
`supervise/stop-rules`. Omit ⇒ ceilings only (unchanged behavior).

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

Defined in: src/runtime/supervise/coordination-driver.ts:126

Called once with the rule's reason when a `stopRule` ends the run — so a caller can record
 WHY a run stopped early instead of inferring it from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: src/runtime/supervise/coordination-driver.ts:135

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

Defined in: src/runtime/supervise/coordination-mcp.ts:35

#### Properties

##### url

> `readonly` **url**: `string`

Defined in: src/runtime/supervise/coordination-mcp.ts:37

The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`.

##### port

> `readonly` **port**: `number`

Defined in: src/runtime/supervise/coordination-mcp.ts:38

##### drainResolved

> **drainResolved**: () => `Promise`\<`number`\>

Defined in: src/runtime/supervise/coordination-mcp.ts:43

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

Defined in: src/runtime/supervise/coordination-mcp.ts:46

The full ordered bus-event log — observability audit + replay trail.

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](#coordinationevent)\>[]

##### stats

> **stats**: () => [`BusStats`](#busstats)

Defined in: src/runtime/supervise/coordination-mcp.ts:48

Bus throughput counters for live dashboards.

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](#busstats)

##### raiseFinding

> **raiseFinding**: (`finding`) => `Promise`\<`void`\>

Defined in: src/runtime/supervise/coordination-mcp.ts:50

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

Defined in: src/runtime/supervise/coordination-mcp.ts:40

The coordination tools' settled-worker ledger (for the driver's finalize).

###### Returns

readonly `object`[]

##### isStopped()

> **isStopped**(): `boolean`

Defined in: src/runtime/supervise/coordination-mcp.ts:44

###### Returns

`boolean`

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: src/runtime/supervise/coordination-mcp.ts:51

###### Returns

`Promise`\<`void`\>

***

### DelegateOptions

Defined in: src/runtime/supervise/delegate.ts:38

Inputs to [delegate](#delegate).

#### Type Parameters

##### Out

`Out` = `unknown`

#### Properties

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`Out`\>

Defined in: src/runtime/supervise/delegate.ts:42

The completion oracle (settled ⟺ delivered) the authored workers settle against. Strongly
 recommended — without it the supervisor trusts a worker's self-report. For a code intent,
 `patchDelivered()` is the canonical example; for a free-form answer, a content check.

##### worker

> `readonly` **worker**: [`EnvironmentWorkerOptions`](#environmentworkeroptions)

Defined in: src/runtime/supervise/delegate.ts:44

Environment provider and creation options used by authored workers.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/delegate.ts:46

The conserved compute pool for the whole delegation. Defaults to [defaultDelegateBudget](#defaultdelegatebudget).

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: src/runtime/supervise/delegate.ts:49

The model the supervisor BRAIN runs on (the router model). The brain must tool-call
 (`spawn_agent` / `await_event`), so a delegator model, not a hidden-reasoning model.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: src/runtime/supervise/delegate.ts:53

The supervisor brain's router substrate. REQUIRED for the default router-brained supervisor
 (the brain is resolved from this), unless a test injects `brain` directly. `model` overrides
 `router.model`. (Design delta vs the bare `supervise()` profile: the brain needs a router.)

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: src/runtime/supervise/delegate.ts:55

Inject the supervisor brain directly (tests / advanced) instead of resolving it from `router`.

##### supervisor?

> `readonly` `optional` **supervisor?**: `Partial`\<`Pick`\<[`SupervisorProfile`](#supervisorprofile), `"name"` \| `"systemPrompt"`\>\>

Defined in: src/runtime/supervise/delegate.ts:58

Override the default authoring-supervisor profile (name / extra system-prompt stance). The
 default already carries the authoring skill; override only to add a goal or rename.

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Defined in: src/runtime/supervise/delegate.ts:60

Restrict the run to this subset of models (forwarded to `supervise()`).

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: src/runtime/supervise/delegate.ts:61

***

### WatchTraceOptions

Defined in: src/runtime/supervise/detector-monitor.ts:23

#### Properties

##### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

Defined in: src/runtime/supervise/detector-monitor.ts:25

The detectors to run online. Defaults to a stuck-loop + error-streak panel.

##### onSignal?

> `readonly` `optional` **onSignal?**: (`signal`, `span`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/supervise/detector-monitor.ts:27

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

Defined in: src/runtime/supervise/dispatch.ts:56

One unit of queued work: the agent to run, its task, and the spawn options (budget + label).
 `nextUnit` mints these lazily so a queue can be generated, re-ordered, or grown while the
 dispatcher runs.

#### Type Parameters

##### Out

`Out`

#### Properties

##### agent

> `readonly` **agent**: [`Agent`](#agent-1)\<`unknown`, `Out`\>

Defined in: src/runtime/supervise/dispatch.ts:57

##### task

> `readonly` **task**: `unknown`

Defined in: src/runtime/supervise/dispatch.ts:58

##### opts

> `readonly` **opts**: [`SpawnOpts`](#spawnopts)

Defined in: src/runtime/supervise/dispatch.ts:59

***

### RollingDispatchOptions

Defined in: src/runtime/supervise/dispatch.ts:67

#### Type Parameters

##### Out

`Out`

#### Properties

##### width

> `readonly` **width**: `number`

Defined in: src/runtime/supervise/dispatch.ts:74

How many children to hold in flight. Must be a positive integer. This is a SIMULTANEITY fence
only — the conserved pool still bounds total work, and a `width` larger than the pool can
afford simply hits `not-admitted` sooner. Derive it with `effectiveConcurrency` when the host
also runs a fleet-level box governor.

#### Methods

##### nextUnit()

> **nextUnit**(): [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

Defined in: src/runtime/supervise/dispatch.ts:80

Produce the next unit of work, or `undefined` when the queue is dry. Called only when a slot
is free, so a caller may compute the next unit from what has already settled (the point of a
refilling dispatcher: the queue is allowed to react). Never called after a stop.

###### Returns

[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `Promise`\<[`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`\> \| `undefined`

##### onSettled()?

> `optional` **onSettled**(`settled`): `void` \| `Promise`\<`void`\>

Defined in: src/runtime/supervise/dispatch.ts:85

Called once per settlement, in cursor order, BEFORE the freed slot is refilled — so an
`onSettled` that appends to the caller's queue is visible to the very next `nextUnit`.

###### Parameters

###### settled

[`Settled`](#settled-2)\<`Out`\>

###### Returns

`void` \| `Promise`\<`void`\>

##### shouldStop()?

> `optional` **shouldStop**(): `boolean`

Defined in: src/runtime/supervise/dispatch.ts:90

Consulted before each admission. `true` stops admitting; the already-live children are still
drained to completion (no orphan, no lost settlement). Use it for a progress/plateau rule.

###### Returns

`boolean`

***

### DispatchReport

Defined in: src/runtime/supervise/dispatch.ts:93

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](#settled-2)\<`Out`\>[]

Defined in: src/runtime/supervise/dispatch.ts:95

Every settlement, in the order `scope.next()` yielded them.

##### admitted

> `readonly` **admitted**: `number`

Defined in: src/runtime/supervise/dispatch.ts:97

How many children this dispatcher admitted.

##### rejected

> `readonly` **rejected**: readonly `string`[]

Defined in: src/runtime/supervise/dispatch.ts:99

Admission rejections, in order — `label: reason`. Non-empty ⇒ the pool or depth fenced.

##### stopReason

> `readonly` **stopReason**: [`DispatchStopReason`](#dispatchstopreason)

Defined in: src/runtime/supervise/dispatch.ts:100

##### peakLive

> `readonly` **peakLive**: `number`

Defined in: src/runtime/supervise/dispatch.ts:103

The highest simultaneous live count actually reached — the number to compare against
 `width` when asking "did the slots really stay full?"

***

### ConcurrencyCaps

Defined in: src/runtime/supervise/dispatch.ts:196

The caps a host can set on simultaneous work. See the ledger in this module's header for what
 each one actually bounds.

#### Properties

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: src/runtime/supervise/dispatch.ts:198

Supervisor level: max spawned-but-unsettled workers.

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

Defined in: src/runtime/supervise/dispatch.ts:201

Fleet level: max live sandboxes/boxes across the host process (a `ComputeGovernor`-style
 cap). Applies to the worker layer, so it participates in the minimum.

***

### EnvironmentSteeringOptions

Defined in: src/runtime/supervise/environment-session.ts:37

#### Properties

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: src/runtime/supervise/environment-session.ts:39

Turn zero plus folded steering turns. Default 24.

##### activityWindow?

> `readonly` `optional` **activityWindow?**: `number`

Defined in: src/runtime/supervise/environment-session.ts:41

Recent tool and turn notes exposed by `progress()`. Default 12.

##### turnTimeoutMs?

> `readonly` `optional` **turnTimeoutMs?**: `number`

Defined in: src/runtime/supervise/environment-session.ts:43

Abort an individual turn after this many milliseconds.

##### turn?

> `readonly` `optional` **turn?**: `TurnOptions`

Defined in: src/runtime/supervise/environment-session.ts:45

Provider-neutral fields forwarded on every turn.

***

### SteerableEnvironmentSession

Defined in: src/runtime/supervise/environment-session.ts:48

#### Methods

##### stream()

> **stream**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](#usageevent)\>

Defined in: src/runtime/supervise/environment-session.ts:49

###### Parameters

###### task

`unknown`

###### signal

`AbortSignal`

###### Returns

`AsyncIterable`\<[`UsageEvent`](#usageevent)\>

##### progress()

> **progress**(): [`ExecutorProgress`](#executorprogress)

Defined in: src/runtime/supervise/environment-session.ts:50

###### Returns

[`ExecutorProgress`](#executorprogress)

##### traceSource()

> **traceSource**(): [`TraceSource`](#tracesource-1)

Defined in: src/runtime/supervise/environment-session.ts:51

###### Returns

[`TraceSource`](#tracesource-1)

##### artifact()

> **artifact**(): \{ `outRef`: `string`; `out`: `unknown`; `spent`: [`Spend`](#spend); \} \| `undefined`

Defined in: src/runtime/supervise/environment-session.ts:52

###### Returns

\{ `outRef`: `string`; `out`: `unknown`; `spent`: [`Spend`](#spend); \} \| `undefined`

##### teardown()

> **teardown**(): `Promise`\<`void`\>

Defined in: src/runtime/supervise/environment-session.ts:53

###### Returns

`Promise`\<`void`\>

***

### SteerableEnvironmentArgs

Defined in: src/runtime/supervise/environment-session.ts:56

#### Properties

##### controller

> `readonly` **controller**: `AbortController`

Defined in: src/runtime/supervise/environment-session.ts:57

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: src/runtime/supervise/environment-session.ts:58

##### backend?

> `readonly` `optional` **backend?**: `string`

Defined in: src/runtime/supervise/environment-session.ts:59

##### provider

> `readonly` **provider**: `AgentEnvironmentProvider`

Defined in: src/runtime/supervise/environment-session.ts:60

##### environment?

> `readonly` `optional` **environment?**: `Omit`\<`CreateAgentEnvironmentInput`, `"profile"` \| `"signal"`\>

Defined in: src/runtime/supervise/environment-session.ts:61

##### inbox

> `readonly` **inbox**: [`Inbox`](#inbox-1)

Defined in: src/runtime/supervise/environment-session.ts:62

##### taskToPrompt

> `readonly` **taskToPrompt**: (`task`) => `string`

Defined in: src/runtime/supervise/environment-session.ts:63

###### Parameters

###### task

`unknown`

###### Returns

`string`

##### options?

> `readonly` `optional` **options?**: [`EnvironmentSteeringOptions`](#environmentsteeringoptions)

Defined in: src/runtime/supervise/environment-session.ts:64

##### loopCtx?

> `readonly` `optional` **loopCtx?**: `Partial`\<`Omit`\<[`ExecCtx`](#execctx), `"signal"` \| `"environmentProvider"`\>\>

Defined in: src/runtime/supervise/environment-session.ts:65

##### contentRef

> `readonly` **contentRef**: (`prefix`, `value`) => `string`

Defined in: src/runtime/supervise/environment-session.ts:66

###### Parameters

###### prefix

`string`

###### value

`unknown`

###### Returns

`string`

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: src/runtime/supervise/environment-session.ts:67

###### Returns

`number`

***

### BusEvent

Defined in: src/runtime/supervise/event-bus.ts:27

Every bus event is a discriminated union member keyed by `type`.

#### Properties

##### type

> `readonly` **type**: `string`

Defined in: src/runtime/supervise/event-bus.ts:28

***

### BusRecord

Defined in: src/runtime/supervise/event-bus.ts:33

A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms).

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Properties

##### seq

> `readonly` **seq**: `number`

Defined in: src/runtime/supervise/event-bus.ts:34

##### at

> `readonly` **at**: `number`

Defined in: src/runtime/supervise/event-bus.ts:35

##### priority

> `readonly` **priority**: `number`

Defined in: src/runtime/supervise/event-bus.ts:36

##### event

> `readonly` **event**: `E`

Defined in: src/runtime/supervise/event-bus.ts:37

***

### PublishOptions

Defined in: src/runtime/supervise/event-bus.ts:40

#### Properties

##### priority?

> `readonly` `optional` **priority?**: `number`

Defined in: src/runtime/supervise/event-bus.ts:43

Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
 this so it bumps to the front of the driver's inbox.

##### queue?

> `readonly` `optional` **queue?**: `boolean`

Defined in: src/runtime/supervise/event-bus.ts:47

Whether the event enters the pull queue (default true). Set `false` for record-only events —
 the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
 `subscribe` observers, but the parent must never `pull` its own outbound message back.

***

### BusStats

Defined in: src/runtime/supervise/event-bus.ts:50

#### Properties

##### published

> `readonly` **published**: `number`

Defined in: src/runtime/supervise/event-bus.ts:51

##### pulled

> `readonly` **pulled**: `number`

Defined in: src/runtime/supervise/event-bus.ts:52

##### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: src/runtime/supervise/event-bus.ts:54

Count published per event `type`.

***

### EventBus

Defined in: src/runtime/supervise/event-bus.ts:57

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Methods

##### publish()

> **publish**(`event`, `opts?`): `Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

Defined in: src/runtime/supervise/event-bus.ts:60

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

Defined in: src/runtime/supervise/event-bus.ts:63

Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
 ties broken FIFO by `seq`; `undefined` when nothing matches.

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`E` \| `undefined`

##### subscribe()

> **subscribe**(`handler`): () => `void`

Defined in: src/runtime/supervise/event-bus.ts:66

Register a pass-through handler; it receives the stamped record of every event published after
 registration. Returns an unsubscribe fn.

###### Parameters

###### handler

(`record`) => `void` \| `Promise`\<`void`\>

###### Returns

() => `void`

##### pending()

> **pending**(`kinds?`): `number`

Defined in: src/runtime/supervise/event-bus.ts:68

Count of queued, not-yet-pulled events (filtered by `kinds` when given).

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`number`

##### history()

> **history**(): readonly [`BusRecord`](#busrecord)\<`E`\>[]

Defined in: src/runtime/supervise/event-bus.ts:70

The full ordered log of every event ever published (the audit/replay trail).

###### Returns

readonly [`BusRecord`](#busrecord)\<`E`\>[]

##### stats()

> **stats**(): [`BusStats`](#busstats)

Defined in: src/runtime/supervise/event-bus.ts:72

Throughput counters for observability dashboards.

###### Returns

[`BusStats`](#busstats)

***

### InboxMessage

Defined in: src/runtime/supervise/inbox.ts:19

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

Defined in: src/runtime/supervise/inbox.ts:20

**`Experimental`**

##### text

> `readonly` **text**: `string`

Defined in: src/runtime/supervise/inbox.ts:21

**`Experimental`**

##### interrupt

> `readonly` **interrupt**: `boolean`

Defined in: src/runtime/supervise/inbox.ts:23

**`Experimental`**

Forceful messages abort the in-flight turn; queued ones wait for the boundary flush.

##### questionId?

> `readonly` `optional` **questionId?**: `string`

Defined in: src/runtime/supervise/inbox.ts:25

**`Experimental`**

Present for an `answer` — the question id it resolves.

***

### Inbox

Defined in: src/runtime/supervise/inbox.ts:28

#### Methods

##### deliver()

> **deliver**(`msg`): `void`

Defined in: src/runtime/supervise/inbox.ts:30

The `Executor.deliver` implementation — accept a raw down-message from `Scope.send`.

###### Parameters

###### msg

`unknown`

###### Returns

`void`

##### drain()

> **drain**(): [`InboxMessage`](#inboxmessage)[]

Defined in: src/runtime/supervise/inbox.ts:32

Remove and return all pending messages (the flush).

###### Returns

[`InboxMessage`](#inboxmessage)[]

##### pending()

> **pending**(): `number`

Defined in: src/runtime/supervise/inbox.ts:33

###### Returns

`number`

##### freshInterrupt()

> **freshInterrupt**(): `AbortSignal`

Defined in: src/runtime/supervise/inbox.ts:36

Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
 this into the signal it passes to its inference call, then re-plans when it fires.

###### Returns

`AbortSignal`

##### fold()

> **fold**(`messages`): `string`

Defined in: src/runtime/supervise/inbox.ts:38

Render drained messages as ONE operator turn to fold into the worker's conversation.

###### Parameters

###### messages

readonly [`InboxMessage`](#inboxmessage)[]

###### Returns

`string`

***

### PatchDeliverableOptions

Defined in: src/runtime/supervise/patch-deliverable.ts:28

**`Experimental`**

#### Extends

- `CoderCheckConstraints`

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: src/runtime/supervise/patch-checks.ts:39

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

`CoderCheckConstraints.maxDiffLines`

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: src/runtime/supervise/patch-checks.ts:41

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

`CoderCheckConstraints.forbiddenPaths`

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: src/runtime/supervise/patch-deliverable.ts:35

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

***

### PiSeam

Defined in: src/runtime/supervise/pi-executor.ts:55

How to launch pi in its out-of-process RPC mode, and how long to wait on it.

#### Properties

##### bin?

> `optional` **bin?**: `string`

Defined in: src/runtime/supervise/pi-executor.ts:57

The pi executable (default `'pi'`). Anything on PATH or an absolute path.

##### args?

> `optional` **args?**: readonly `string`[]

Defined in: src/runtime/supervise/pi-executor.ts:59

Extra args appended after `--mode rpc`. `--provider` / `--model` are added from `model`.

##### model?

> `optional` **model?**: `string`

Defined in: src/runtime/supervise/pi-executor.ts:61

`provider/model` or just `model` — split on the first `/` into pi's two flags.

##### cwd?

> `optional` **cwd?**: `string`

Defined in: src/runtime/supervise/pi-executor.ts:62

##### env?

> `optional` **env?**: `Record`\<`string`, `string`\>

Defined in: src/runtime/supervise/pi-executor.ts:63

##### turnTimeoutMs?

> `optional` **turnTimeoutMs?**: `number`

Defined in: src/runtime/supervise/pi-executor.ts:65

Wall-clock ceiling for one `prompt` (the wait for `agent_end`). Omit = no timeout.

##### activityWindow?

> `optional` **activityWindow?**: `number`

Defined in: src/runtime/supervise/pi-executor.ts:67

Newest-last activity window `progress()` reports. Default 12.

***

### ActivityNote

Defined in: src/runtime/supervise/progress.ts:35

The most recent activity the executor can name — one tool call, one turn, or a free-form note.
 `label` is the tool/file/turn name; `detail` is a short, already-truncated descriptor (a path,
 a command head) that a driver can read without pulling the whole transcript.

#### Properties

##### at

> `readonly` **at**: `number`

Defined in: src/runtime/supervise/progress.ts:36

##### kind

> `readonly` **kind**: `"turn"` \| `"tool"` \| `"note"`

Defined in: src/runtime/supervise/progress.ts:37

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/supervise/progress.ts:38

##### status?

> `readonly` `optional` **status?**: `"error"` \| `"ok"`

Defined in: src/runtime/supervise/progress.ts:39

##### detail?

> `readonly` `optional` **detail?**: `string`

Defined in: src/runtime/supervise/progress.ts:40

***

### ExecutorProgress

Defined in: src/runtime/supervise/progress.ts:45

What an executor OPTIONALLY adds to the scope-derived progress (`Executor.progress()`). Every
 field is optional: an executor that knows only its own turn count reports only that.

#### Properties

##### turns?

> `readonly` `optional` **turns?**: `number`

Defined in: src/runtime/supervise/progress.ts:47

The executor's own turn/step count when it is more meaningful than metered iterations.

##### pendingMessages?

> `readonly` `optional` **pendingMessages?**: `number`

Defined in: src/runtime/supervise/progress.ts:49

Steers/answers delivered but not yet folded into the worker's conversation.

##### recentActivity?

> `readonly` `optional` **recentActivity?**: readonly [`ActivityNote`](#activitynote)[]

Defined in: src/runtime/supervise/progress.ts:51

Newest-last window of what the worker has been doing.

##### note?

> `readonly` `optional` **note?**: `string`

Defined in: src/runtime/supervise/progress.ts:53

A one-line human-readable state ("turn 3, running tests").

***

### WorkerProgress

Defined in: src/runtime/supervise/progress.ts:57

The full live view of one worker, as `observe_agent` returns it mid-flight.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/supervise/progress.ts:58

##### status

> `readonly` **status**: `NodeStatus`

Defined in: src/runtime/supervise/progress.ts:59

##### live

> `readonly` **live**: `boolean`

Defined in: src/runtime/supervise/progress.ts:61

True while the node is neither done, failed, nor cancelled — i.e. a steer could still land.

##### steerable

> `readonly` **steerable**: `boolean`

Defined in: src/runtime/supervise/progress.ts:64

True when this worker's executor exposes an inbox (`Executor.deliver`) — i.e. `steer_agent`
 can actually reach it. False means a steer would be recorded and dropped.

##### startedAt

> `readonly` **startedAt**: `number`

Defined in: src/runtime/supervise/progress.ts:65

##### lastActivityAt

> `readonly` **lastActivityAt**: `number`

Defined in: src/runtime/supervise/progress.ts:67

Epoch ms of the last metered usage event or executor-reported activity.

##### idleMs

> `readonly` **idleMs**: `number`

Defined in: src/runtime/supervise/progress.ts:68

##### stalled

> `readonly` **stalled**: `boolean`

Defined in: src/runtime/supervise/progress.ts:69

##### stallAfterMs

> `readonly` **stallAfterMs**: `number`

Defined in: src/runtime/supervise/progress.ts:70

##### turns

> `readonly` **turns**: `number`

Defined in: src/runtime/supervise/progress.ts:72

Metered iterations so far (the executor's own count when it reports one).

##### tokens

> `readonly` **tokens**: `object`

Defined in: src/runtime/supervise/progress.ts:73

###### input

> `readonly` **input**: `number`

###### output

> `readonly` **output**: `number`

##### usd

> `readonly` **usd**: `number`

Defined in: src/runtime/supervise/progress.ts:74

##### pendingMessages

> `readonly` **pendingMessages**: `number`

Defined in: src/runtime/supervise/progress.ts:76

Steers delivered but not yet read by the worker.

##### recentActivity

> `readonly` **recentActivity**: readonly [`ActivityNote`](#activitynote)[]

Defined in: src/runtime/supervise/progress.ts:78

Newest-last window of tool/turn activity; empty when the executor exposes none.

##### note?

> `readonly` `optional` **note?**: `string`

Defined in: src/runtime/supervise/progress.ts:79

***

### ActivityLog

Defined in: src/runtime/supervise/progress.ts:83

A bounded newest-last ring of `ActivityNote`s an executor keeps to answer `progress()`.

#### Methods

##### push()

> **push**(`note`): `void`

Defined in: src/runtime/supervise/progress.ts:84

###### Parameters

###### note

[`ActivityNote`](#activitynote)

###### Returns

`void`

##### read()

> **read**(): readonly [`ActivityNote`](#activitynote)[]

Defined in: src/runtime/supervise/progress.ts:86

Newest-last, at most `limit` entries.

###### Returns

readonly [`ActivityNote`](#activitynote)[]

##### last()

> **last**(): [`ActivityNote`](#activitynote) \| `undefined`

Defined in: src/runtime/supervise/progress.ts:87

###### Returns

[`ActivityNote`](#activitynote) \| `undefined`

##### size()

> **size**(): `number`

Defined in: src/runtime/supervise/progress.ts:88

###### Returns

`number`

***

### ScopeProgressInput

Defined in: src/runtime/supervise/progress.ts:107

The scope-side facts about a child, independent of whether its executor cooperates.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/supervise/progress.ts:108

##### status

> `readonly` **status**: `NodeStatus`

Defined in: src/runtime/supervise/progress.ts:109

##### steerable

> `readonly` **steerable**: `boolean`

Defined in: src/runtime/supervise/progress.ts:110

##### startedAt

> `readonly` **startedAt**: `number`

Defined in: src/runtime/supervise/progress.ts:111

##### lastActivityAt

> `readonly` **lastActivityAt**: `number`

Defined in: src/runtime/supervise/progress.ts:112

##### turns

> `readonly` **turns**: `number`

Defined in: src/runtime/supervise/progress.ts:113

##### tokens

> `readonly` **tokens**: `object`

Defined in: src/runtime/supervise/progress.ts:114

###### input

> `readonly` **input**: `number`

###### output

> `readonly` **output**: `number`

##### usd

> `readonly` **usd**: `number`

Defined in: src/runtime/supervise/progress.ts:115

***

### InMemoryRunContextOptions

Defined in: src/runtime/supervise/run-context.ts:38

Options for a supervised run context.

#### Properties

##### withDriver?

> `readonly` `optional` **withDriver?**: `boolean`

Defined in: src/runtime/supervise/run-context.ts:45

Wrap the executor registry with `withDriverExecutor` so a spawned child marked
`role: 'driver'` resolves to the recursive driver-executor (agents driving agents
over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
leaf workers. Default `false`.

***

### InMemoryRunContext

Defined in: src/runtime/supervise/run-context.ts:52

The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.

#### Properties

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Defined in: src/runtime/supervise/run-context.ts:53

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: src/runtime/supervise/run-context.ts:54

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](#executorregistry)

Defined in: src/runtime/supervise/run-context.ts:55

##### resume?

> `readonly` `optional` **resume?**: `boolean`

Defined in: src/runtime/supervise/run-context.ts:61

Present (and `true`) only on a DURABLE context (`createFileRunContext`), so spreading the
context into `SupervisorOpts` also opts the run into resume-first. An in-memory context
leaves it undefined: there is never a prior tree to resume, and the default stays fresh-run.

***

### EnvironmentWorkerOptions

Defined in: src/runtime/supervise/runtime.ts:124

Provider-backed worker configuration used by supervision and delegation.

#### Properties

##### provider

> **provider**: `string` \| `AgentEnvironmentProvider`

Defined in: src/runtime/supervise/runtime.ts:125

##### registry?

> `optional` **registry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: src/runtime/supervise/runtime.ts:126

##### environment?

> `optional` **environment?**: `Omit`\<`CreateAgentEnvironmentInput`, `"profile"` \| `"signal"`\>

Defined in: src/runtime/supervise/runtime.ts:128

Provider-neutral creation fields, including the provider's agent backend.

##### loopCtx?

> `optional` **loopCtx?**: `Partial`\<`Omit`\<[`ExecCtx`](#execctx), `"signal"` \| `"environmentProvider"`\>\>

Defined in: src/runtime/supervise/runtime.ts:130

Forwarded into the composed `runAgentRounds` context.

##### lineage?

> `optional` **lineage?**: [`LoopLineageOptions`](#looplineageoptions)

Defined in: src/runtime/supervise/runtime.ts:131

##### maxIterations?

> `optional` **maxIterations?**: `number`

Defined in: src/runtime/supervise/runtime.ts:133

Leaf iteration cap. Default 1.

##### steering?

> `optional` **steering?**: [`EnvironmentSteeringOptions`](#environmentsteeringoptions)

Defined in: src/runtime/supervise/runtime.ts:135

Multi-turn steering over one provider session.

##### runtime?

> `optional` **runtime?**: [`Runtime`](#runtime-3)

Defined in: src/runtime/supervise/runtime.ts:137

Runtime label. Defaults to the provider name.

***

### EnvironmentWorkerResult

Defined in: src/runtime/supervise/runtime.ts:141

Output returned by a provider-backed supervised worker.

#### Properties

##### content

> **content**: `string`

Defined in: src/runtime/supervise/runtime.ts:142

##### events?

> `optional` **events?**: readonly `AgentEnvironmentEvent`[]

Defined in: src/runtime/supervise/runtime.ts:143

##### turns?

> `optional` **turns?**: `number`

Defined in: src/runtime/supervise/runtime.ts:144

##### toolCalls?

> `optional` **toolCalls?**: readonly `string`[]

Defined in: src/runtime/supervise/runtime.ts:145

***

### ProgressSample

Defined in: src/runtime/supervise/stop-rules.ts:47

One settled unit of work, reduced to what a stop rule reads. `objective` is the run's own
 quality signal (a verdict score, a test pass-rate, a judge rating); `undefined` = this
 settlement produced no measurable objective (it failed, or nothing scored it).

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/supervise/stop-rules.ts:48

##### at

> `readonly` **at**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:50

Epoch ms the settlement was observed.

##### objective?

> `readonly` `optional` **objective?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:51

##### delivered

> `readonly` **delivered**: `boolean`

Defined in: src/runtime/supervise/stop-rules.ts:54

True when the settlement passed its deliverable check — a scored-but-undelivered result is
 not progress.

***

### ProgressView

Defined in: src/runtime/supervise/stop-rules.ts:58

The read-model a `StopRule` decides from — the run's progress, not its budget.

#### Properties

##### now

> `readonly` **now**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:59

##### settles

> `readonly` **settles**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:61

Settlements observed so far, in the order they landed.

##### delivered

> `readonly` **delivered**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:63

Of those, how many passed their deliverable check.

##### curve

> `readonly` **curve**: readonly `number`[]

Defined in: src/runtime/supervise/stop-rules.ts:65

Best-so-far objective after each settlement (`anytime.bestSoFar`).

##### best

> `readonly` **best**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:67

The current best objective; `0` when nothing has scored.

##### auc

> `readonly` **auc**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:69

Mean of the best-so-far curve — how EARLY the run climbed (`anytime.areaUnderCurve`).

##### lastSettleAt

> `readonly` **lastSettleAt**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:71

Epoch ms of the most recent settlement; `0` when none has landed.

##### lastImprovementAt

> `readonly` **lastImprovementAt**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:73

Epoch ms of the most recent improvement in best-so-far; `0` when none.

##### settlesSinceImprovement

> `readonly` **settlesSinceImprovement**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:75

Settlements since the last improvement — `0` right after one improves.

##### workers

> `readonly` **workers**: readonly [`WorkerProgress`](#workerprogress)[]

Defined in: src/runtime/supervise/stop-rules.ts:78

Live read of every non-terminal worker (the `Scope.progress` feed). Empty when the caller
 supplied no scope.

##### inFlight

> `readonly` **inFlight**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:80

Nodes running or acquiring.

##### waiting

> `readonly` **waiting**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:83

Armed wait-state nodes — deliberately separate from `inFlight`: a tree whose only remaining
 nodes are waits is NOT stalled, it is waiting on the world.

***

### ProgressTracker

Defined in: src/runtime/supervise/stop-rules.ts:101

Accumulates settlements and materializes a `ProgressView`. Idempotent by settlement id, so a
 caller may re-push its whole roster every turn (the driver does exactly that) without
 double-counting or moving a recorded timestamp.

#### Methods

##### record()

> **record**(`sample`): `boolean`

Defined in: src/runtime/supervise/stop-rules.ts:104

Record a settlement. A second call with the same `id` is ignored. Returns true when it was
 new.

###### Parameters

###### sample

[`ProgressSample`](#progresssample)

###### Returns

`boolean`

##### view()

> **view**(`scope?`, `opts?`): [`ProgressView`](#progressview)

Defined in: src/runtime/supervise/stop-rules.ts:106

Materialize the view. Pass the live `Scope` to include the worker feed and tree shape.

###### Parameters

###### scope?

[`Scope`](#scope-1)\<`unknown`\>

###### opts?

###### stallAfterMs?

`number`

###### Returns

[`ProgressView`](#progressview)

##### evaluate()

> **evaluate**(`rule`, `scope?`, `opts?`): [`StopDecision`](#stopdecision)

Defined in: src/runtime/supervise/stop-rules.ts:108

Evaluate a rule against the current view.

###### Parameters

###### rule

[`StopRule`](#stoprule-1)

###### scope?

[`Scope`](#scope-1)\<`unknown`\>

###### opts?

###### stallAfterMs?

`number`

###### Returns

[`StopDecision`](#stopdecision)

##### samples()

> **samples**(): readonly [`ProgressSample`](#progresssample)[]

Defined in: src/runtime/supervise/stop-rules.ts:114

The samples recorded so far, in order.

###### Returns

readonly [`ProgressSample`](#progresssample)[]

***

### ProgressTrackerOptions

Defined in: src/runtime/supervise/stop-rules.ts:117

#### Properties

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: src/runtime/supervise/stop-rules.ts:119

Clock for `view().now`. Defaults to `Date.now`.

###### Returns

`number`

##### requireDelivered?

> `readonly` `optional` **requireDelivered?**: `boolean`

Defined in: src/runtime/supervise/stop-rules.ts:123

Treat a settlement that did NOT pass its deliverable check as having no objective. Default
 true — "scored 0.9 but never delivered" is not progress, and counting it as progress is the
 exact way a plateau rule gets talked out of firing.

##### minImprovement?

> `readonly` `optional` **minImprovement?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:126

How much the best-so-far must rise for a settlement to count as an IMPROVEMENT. Default 0
 (any strict rise counts). Raise it to ignore score noise.

***

### NoProgressForOptions

Defined in: src/runtime/supervise/stop-rules.ts:225

#### Properties

##### ms?

> `readonly` `optional` **ms?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:227

Stop when this many ms have passed since the last SETTLEMENT. Omit to not bound on time.

##### settles?

> `readonly` `optional` **settles?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:230

Stop when this many settlements have landed with no improvement in best-so-far. Omit to not
 bound on settles.

##### minSettles?

> `readonly` `optional` **minSettles?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:233

Never stop before this many settlements have landed — the warm-up that stops a rule from
 firing on an empty run. Default 1.

***

### PlateauOptions

Defined in: src/runtime/supervise/stop-rules.ts:275

#### Properties

##### window

> `readonly` **window**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:278

How many trailing settlements to judge. The rule fires when the whole window failed to lift
 the best-so-far by more than `minDelta`.

##### minDelta

> `readonly` **minDelta**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:281

The rise that counts as an improvement — the domain's noise floor. `0` means any strict rise
 counts.

##### minSettles?

> `readonly` `optional` **minSettles?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:284

Never fire before this many settlements. Defaults to `window` (so the first decision is made
 on a full window, not on a partial one).

***

### AllWorkersStalledOptions

Defined in: src/runtime/supervise/stop-rules.ts:316

#### Properties

##### minWorkers?

> `readonly` `optional` **minWorkers?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:319

Require at least this many live workers before the rule can fire — one stalled worker in a
 one-worker tree is a weaker signal than a whole fleet going quiet. Default 1.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Defined in: src/runtime/supervise/stop-rules.ts:322

Idle time that counts as stalled, passed through to the live progress read. Omit = the
 runtime default (`DEFAULT_STALL_AFTER_MS`).

***

### SuperviseOptions

Defined in: src/runtime/supervise/supervise.ts:65

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/supervise.ts:67

The conserved compute pool for the whole run.

##### worker?

> `readonly` `optional` **worker?**: [`EnvironmentWorkerOptions`](#environmentworkeroptions)

Defined in: src/runtime/supervise/supervise.ts:69

Environment provider and creation options used by spawned workers.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Defined in: src/runtime/supervise/supervise.ts:73

The completion check for provider-backed workers. Strongly recommended:
 without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
 failure mode of a static orchestrator.

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: src/runtime/supervise/supervise.ts:75

Override worker construction for tests or custom executors.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: src/runtime/supervise/supervise.ts:77

Router connection for an in-process supervisor (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: src/runtime/supervise/supervise.ts:79

Inject the supervisor brain directly (tests / advanced).

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: src/runtime/supervise/supervise.ts:81

Run the supervisor through a coding-harness driver.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: src/runtime/supervise/supervise.ts:85

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`harness` null).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: src/runtime/supervise/supervise.ts:91

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/supervise.ts:96

Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: src/runtime/supervise/supervise.ts:99

Hard cap on simultaneously live workers. The conserved pool bounds total
 work; this bounds concurrently active provider environments.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](#analystregistry)

Defined in: src/runtime/supervise/supervise.ts:102

Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
 (the driver receives settled worker outputs, no analyst findings).

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: src/runtime/supervise/supervise.ts:107

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
 the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
 threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
 Omit/empty = status quo (no analyst feed). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: `WorkerWatchOptions`

Defined in: src/runtime/supervise/supervise.ts:117

Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
is the correction. Requires a worker implementation that exposes a trace source; the
steerable provider worker and the pi wrapper do, while other runtimes are not watched.

Omit = off (status quo — no online watching, no extra events).

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Defined in: src/runtime/supervise/supervise.ts:120

Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
 at observation time — nothing is killed or retried. Omit = the runtime default.

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Defined in: src/runtime/supervise/supervise.ts:122

Worker output store. Defaults to in-memory.

##### runDir?

> `readonly` `optional` **runDir?**: `string`

Defined in: src/runtime/supervise/supervise.ts:140

Make the run DURABLE: journal + result blobs are file-backed under this directory
(`createFileRunContext`), fsynced per write, and the supervisor reads the prior tree first.
Re-running with the same `runDir` AND the same `runId` resumes — the children that already
settled are replayed onto `Scope.resume` with their real outputs, and the scope's counters
continue past the journaled maxima. Unset = in-memory, fresh every call.

What that does and does not buy you, precisely: the run's history survives the process and is
replayable, and a resumed run never corrupts the tree. It does NOT by itself make the built-in
supervisor brain skip committed work — `supervisorAgent`'s driver does not read
`Scope.resume`, so out of the box a resumed run re-spawns children it already paid for. Only a
root `Agent.act` that reads `scope.resume.settled` (as the durable-resume test's root does)
turns durability into work-skipping. Wiring that into the default brain is separate work.

`runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
resumable run per directory but collides across concurrent runs sharing one `runDir`.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](#spawnjournal)

Defined in: src/runtime/supervise/supervise.ts:143

Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
 with `blobs` — a journal whose result payloads live in a different store cannot replay.

##### probes?

> `readonly` `optional` **probes?**: [`WaitProbeRegistry`](#waitproberegistry)

Defined in: src/runtime/supervise/supervise.ts:147

Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
 wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
 refused `unknown-probe` and `timer` waits still work.

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/supervise.ts:158

PROGRESS-derived stop rule (router-brained supervisor). Ends a run that has stopped LEARNING
before it exhausts a ceiling — the answer to "a run should end because it is done or stuck,
not because it ran out". It composes with the budget guards and can never override one.

Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
`noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
only (unchanged behavior).

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

Defined in: src/runtime/supervise/supervise.ts:161

One-shot notification of WHY a `stopRule` ended the run — so a caller records the reason
 instead of inferring an early stop from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: src/runtime/supervise/supervise.ts:162

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: src/runtime/supervise/supervise.ts:163

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: src/runtime/supervise/supervise.ts:169

Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only): once
 its coordination transcript exceeds `thresholdTokens` it distills to a compact progress note and
 continues, instead of re-billing the whole transcript every turn (the cost that makes the LLM-brain
 front door lose to a dumb-Ralph respawn). The live `Scope` roster is the durable state across
 chapters. Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: src/runtime/supervise/supervise.ts:170

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: src/runtime/supervise/supervise.ts:171

###### Returns

`number`

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Defined in: src/runtime/supervise/supervise.ts:175

Restrict the run to this subset of models. When set, every configured model — the
 supervisor router model, the profile's model, and the worker's model must be a member,
 or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.

***

### SupervisorProfile

Defined in: src/runtime/supervise/supervisor-agent.ts:52

The subset of an `AgentProfile` that selects and shapes the supervisor brain.

#### Properties

##### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/runtime/supervise/supervisor-agent.ts:53

##### harness?

> `readonly` `optional` **harness?**: `string` \| `null`

Defined in: src/runtime/supervise/supervisor-agent.ts:55

null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain.

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: src/runtime/supervise/supervisor-agent.ts:57

The router model when the brain is router-driven (falls back to the deps router config).

##### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: src/runtime/supervise/supervisor-agent.ts:59

The standing instructions ("you delegate, you do not solve").

***

### SupervisorAgentDeps

Defined in: src/runtime/supervise/supervisor-agent.ts:73

#### Properties

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: src/runtime/supervise/supervisor-agent.ts:74

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](#makeworkeragent)

Defined in: src/runtime/supervise/supervisor-agent.ts:76

Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/supervisor-agent.ts:78

Per-child budget reserved from the conserved pool on each spawn.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Defined in: src/runtime/supervise/supervisor-agent.ts:82

Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
 this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
 boxes/sandboxes, not total work). Omit/`<= 0` = no cap.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: src/runtime/supervise/supervisor-agent.ts:84

Router substrate for a router-brained supervisor (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: src/runtime/supervise/supervisor-agent.ts:86

Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile.

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: src/runtime/supervise/supervisor-agent.ts:88

Required for a sandboxed-harness supervisor (`harness` set): runs the harness as the driver.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: src/runtime/supervise/supervisor-agent.ts:91

WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
 only delegate when it needs parallelism. Pair with `executeExtraTool`.

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: src/runtime/supervise/supervisor-agent.ts:97

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

Defined in: src/runtime/supervise/supervisor-agent.ts:102

Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`.

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly `string`[]

Defined in: src/runtime/supervise/supervisor-agent.ts:105

Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
 (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: `WorkerWatchOptions`

Defined in: src/runtime/supervise/supervisor-agent.ts:108

Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
 learns a worker is looping mid-run instead of at settle. Omit = no online watching.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Defined in: src/runtime/supervise/supervisor-agent.ts:110

Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default.

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/supervisor-agent.ts:115

PROGRESS-derived stop rule (router arm). Ends a run that has stopped learning BEFORE it
 exhausts a ceiling; it can never keep a run alive past one. Build it with `plateau` /
 `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
 caller's judgment. Omit = ceilings only.

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

Defined in: src/runtime/supervise/supervisor-agent.ts:117

One-shot notification of WHY a `stopRule` ended the run.

###### Parameters

###### reason

`string`

###### Returns

`void`

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: src/runtime/supervise/supervisor-agent.ts:118

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](#toolloopcompactionoptions)

Defined in: src/runtime/supervise/supervisor-agent.ts:122

Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only) — it
 distills its coordination transcript to a compact progress note once it exceeds the threshold,
 instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`.

***

### TraceSource

Defined in: src/runtime/supervise/trace-source.ts:38

#### Methods

##### onSpan()

> **onSpan**(`handler`): () => `void`

Defined in: src/runtime/supervise/trace-source.ts:41

Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
 only exposes its trace at the end registers nothing and returns a no-op.

###### Parameters

###### handler

(`span`) => `void`

###### Returns

() => `void`

##### collect()

> **collect**(): `Promise`\<`ToolSpan`[]\>

Defined in: src/runtime/supervise/trace-source.ts:43

The full set of tool spans for the run (SETTLE / batch). Always available.

###### Returns

`Promise`\<`ToolSpan`[]\>

***

### SessionTraceBox

Defined in: src/runtime/supervise/trace-source.ts:279

The minimal box surface this needs: list a session's messages (incl. mid-turn partials).

#### Methods

##### messages()

> **messages**(`opts`): `Promise`\<readonly `SessionMessageLike`[]\>

Defined in: src/runtime/supervise/trace-source.ts:280

###### Parameters

###### opts

###### sessionId

`string`

###### Returns

`Promise`\<readonly `SessionMessageLike`[]\>

***

### TrajectoryAnalysis

Defined in: src/runtime/supervise/trajectory-recorder.ts:16

#### Properties

##### trajectory

> `readonly` **trajectory**: `Trajectory`

Defined in: src/runtime/supervise/trajectory-recorder.ts:19

Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
 duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations.

##### stuckLoop

> `readonly` **stuckLoop**: `StuckLoopReport`

Defined in: src/runtime/supervise/trajectory-recorder.ts:22

Full-run repeated-call view (total occurrences + window) — allows one intervening call so it
catches a loop the online consecutive detector interleaves past.

##### toolWaste

> `readonly` **toolWaste**: `ToolWasteReport`

Defined in: src/runtime/supervise/trajectory-recorder.ts:24

Wasted-vs-total tool-call ratio for the run.

***

### Agent

Defined in: src/runtime/supervise/types.ts:68

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

Defined in: src/runtime/supervise/types.ts:69

#### Methods

##### act()

> **act**(`task`, `scope`): `Promise`\<`Out`\>

Defined in: src/runtime/supervise/types.ts:70

###### Parameters

###### task

`Task`

###### scope

[`Scope`](#scope-1)\<`Out`\>

###### Returns

`Promise`\<`Out`\>

***

### Executor

Defined in: src/runtime/supervise/types.ts:89

The leaf runtime — ONE open interface, not a closed union. `execute` returns a
`Promise<ExecutorResult>` for one-shot executors OR an `AsyncIterable<UsageEvent>` for
streaming ones; a streaming executor reports incremental normalized usage as it runs
(the budget pool reconciles against it) and exposes its terminal artifact via
`resultArtifact()`. Both shapes normalize usage to `UsageEvent` so the conserved pool
meters every runtime identically.

Built-in implementations (in `runtime.ts`, NOT variants here): router/inline (a direct
Router/HTTP inference call, no box), sandbox (COMPOSES `runAgentRounds` as a leaf, forwarding
PR #150's optional `lineage` passthrough — does NOT reinvent checkpoint/fork), cli
(Halo/RLM subprocess; `budgetExempt`, excluded from equal-k by construction). A user's
own agent (mastra/agno/raw HTTP/anything) is first-class by implementing this interface.

#### Type Parameters

##### Out

`Out`

#### Properties

##### runtime

> `readonly` **runtime**: [`Runtime`](#runtime-3)

Defined in: src/runtime/supervise/types.ts:91

Stable runtime tag for traces + the equal-k exemption check.

##### budgetExempt?

> `readonly` `optional` **budgetExempt?**: `boolean`

Defined in: src/runtime/supervise/types.ts:97

When true, this executor's spend is NOT metered against the conserved pool and its
iterations are excluded from the equal-k assertion (a `cli` subprocess without
token accounting). Fail-loud everywhere else: a metered executor MUST report usage.

#### Methods

##### execute()

> **execute**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](#executorresult)\<`Out`\>\>

Defined in: src/runtime/supervise/types.ts:103

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

Defined in: src/runtime/supervise/types.ts:114

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

##### progress()?

> `optional` **progress**(): [`ExecutorProgress`](#executorprogress) \| `undefined`

Defined in: src/runtime/supervise/types.ts:127

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

[`ExecutorProgress`](#executorprogress) \| `undefined`

##### traceSource()?

> `optional` **traceSource**(): [`TraceSource`](#tracesource-1) \| `undefined`

Defined in: src/runtime/supervise/types.ts:135

Optional live tool-call trace for the ONLINE detectors (`watchTrace`). An executor that
can see its worker's tool calls exposes them here, so a supervisor can run the streaming
repeated-action / error-streak panel over a RUNNING worker and raise a `finding` the
moment it loops, instead of discovering it at settle. Omitted = no online detection for
this runtime (the settle-time analyzers still work).

###### Returns

[`TraceSource`](#tracesource-1) \| `undefined`

##### teardown()

> **teardown**(`grace`): `Promise`\<\{ `destroyed`: `boolean`; \}\>

Defined in: src/runtime/supervise/types.ts:140

Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
(`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).

###### Parameters

###### grace

`number` \| `"brutalKill"` \| `"infinity"`

###### Returns

`Promise`\<\{ `destroyed`: `boolean`; \}\>

##### resultArtifact()

> **resultArtifact**(): `object`

Defined in: src/runtime/supervise/types.ts:145

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

Defined in: src/runtime/supervise/types.ts:154

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

Defined in: src/runtime/supervise/types.ts:158

Terminal artifact of a one-shot `Executor.execute`.

#### Type Parameters

##### Out

`Out`

#### Properties

##### outRef

> **outRef**: `string`

Defined in: src/runtime/supervise/types.ts:159

##### out

> **out**: `Out`

Defined in: src/runtime/supervise/types.ts:160

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: src/runtime/supervise/types.ts:161

##### spent

> **spent**: [`Spend`](#spend)

Defined in: src/runtime/supervise/types.ts:162

***

### AgentSpec

Defined in: src/runtime/supervise/types.ts:192

`AgentProfile` does NOT carry a `harness`/backend field — `harness` lives on the
sandbox SDK's `BackendConfig`, not the portable profile. So an agent is mapped to its
executor through this MINIMAL wrapper, never by fabricating a field onto `AgentProfile`.

Resolution (in `runtime.ts`):
 - `executor` present        → BYO: use it verbatim (a user's own `Executor`).
 - `harness === null`        → router/inline: a direct Router call, no box.
 - `harness` is a `BackendType` → sandbox: compose `runAgentRounds` against `profile` on that backend.
Fail loud on an unresolvable spec (no executor and an unknown harness).

#### Properties

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: src/runtime/supervise/types.ts:193

##### harness

> `readonly` **harness**: `HarnessType` \| `null`

Defined in: src/runtime/supervise/types.ts:195

`null` selects router/inline; a `BackendType` selects the sandboxed harness.

##### executor?

> `readonly` `optional` **executor?**: [`Executor`](#executor)\<`unknown`\>

Defined in: src/runtime/supervise/types.ts:197

Bring-your-own executor: when set, overrides harness-based resolution entirely.

***

### ExecutorContext

Defined in: src/runtime/supervise/types.ts:210

Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 (sandbox client for the sandbox executor, router config for router/inline) without
 the factory reaching into module globals.

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

Defined in: src/runtime/supervise/types.ts:211

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: src/runtime/supervise/types.ts:213

Opaque seams the registry threads through; a built-in narrows what it needs.

***

### ExecutorRegistry

Defined in: src/runtime/supervise/types.ts:222

The OPEN resolver: maps an `AgentSpec` to a `ExecutorFactory`. The default
registry resolves the three built-ins AND accepts a BYO `executor`/factory; callers
register more runtimes by name. NOT a closed switch — registration is the extension
point, mirroring the open `Executor` interface.

#### Methods

##### register()

> **register**\<`Out`\>(`runtime`, `factory`): `void`

Defined in: src/runtime/supervise/types.ts:224

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

Defined in: src/runtime/supervise/types.ts:231

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

Defined in: src/runtime/supervise/types.ts:239

A budget envelope on a spawn or the root. All ceilings; the pool reserves against them.

#### Properties

##### maxIterations

> `readonly` **maxIterations**: `number`

Defined in: src/runtime/supervise/types.ts:240

##### maxTokens

> `readonly` **maxTokens**: `number`

Defined in: src/runtime/supervise/types.ts:241

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

Defined in: src/runtime/supervise/types.ts:242

##### deadlineMs?

> `readonly` `optional` **deadlineMs?**: `number`

Defined in: src/runtime/supervise/types.ts:243

***

### Spend

Defined in: src/runtime/supervise/types.ts:248

Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 are separate channels (never folded).

#### Properties

##### iterations

> **iterations**: `number`

Defined in: src/runtime/supervise/types.ts:249

##### tokens

> **tokens**: [`LoopTokenUsage`](#looptokenusage)

Defined in: src/runtime/supervise/types.ts:250

##### usdKnown?

> `optional` **usdKnown?**: `boolean`

Defined in: src/runtime/supervise/types.ts:253

Dollar accounting is known unless explicitly false. A false value must not be treated as $0
 when enforcing a dollar-denominated comparison or limit.

##### usd

> **usd**: `number`

Defined in: src/runtime/supervise/types.ts:254

##### ms

> **ms**: `number`

Defined in: src/runtime/supervise/types.ts:255

***

### SpawnOpts

Defined in: src/runtime/supervise/types.ts:280

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/types.ts:281

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/supervise/types.ts:282

##### restart?

> `readonly` `optional` **restart?**: `Restart`

Defined in: src/runtime/supervise/types.ts:283

##### shutdown?

> `readonly` `optional` **shutdown?**: `number` \| `"brutalKill"` \| `"infinity"`

Defined in: src/runtime/supervise/types.ts:285

Teardown grace handed to the executor when this node is reaped.

***

### Scope

Defined in: src/runtime/supervise/types.ts:335

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

Defined in: src/runtime/supervise/types.ts:409

This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
 is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
 it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
 scope carries its own signal, chained off its driver child's abort.

##### resume?

> `readonly` `optional` **resume?**: [`ResumedWork`](#resumedwork)\<`Out`\>

Defined in: src/runtime/supervise/types.ts:431

Prior committed work, present ONLY on a resumed run (`undefined` on a fresh run, which is
every run that did not pass `SupervisorOpts.resume`). The supervisor `loadTree`s the journal
first; when a non-empty tree exists it rehydrates the already-settled children (via
`replaySpawnTree`) and hands them here so a resume-aware `act` re-uses them instead of
re-spawning committed work. A resume-blind driver simply ignores it and re-spawns — correct
but redundant. The scope's spawn ordinal + cursor seq are already advanced past the recorded
maxima, so any NEW spawn appends without colliding with a journaled event.

##### view

> `readonly` **view**: [`TreeView`](#treeview)

Defined in: src/runtime/supervise/types.ts:433

The live tree — reads the in-memory nursery, not the journal.

##### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: src/runtime/supervise/types.ts:435

Conserved-pool readouts (post-reservation).

#### Methods

##### spawn()

> **spawn**\<`C`\>(`agent`, `task`, `opts`): \{ `ok`: `true`; `handle`: `Handle`\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

Defined in: src/runtime/supervise/types.ts:341

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

> **next**(): `Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

Defined in: src/runtime/supervise/types.ts:348

ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
 `null` when the live set is empty.

###### Returns

`Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

##### nextResolved()

> **nextResolved**(): `Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

Defined in: src/runtime/supervise/types.ts:355

Non-blocking twin of `next()`: deliver an ALREADY-settled, undelivered child, or `null`
when none is ready — never awaits a live child. The driver's post-loop drain reads this so
a child that settled while the driver was busy (or after it stopped pulling) still reaches
the finalize ledger instead of being silently lost.

###### Returns

`Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

##### send()

> **send**(`nodeId`, `msg`): `boolean`

Defined in: src/runtime/supervise/types.ts:364

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

> **wait**(`spec`, `opts`): \{ `ok`: `true`; `handle`: `Handle`\<[`WaitOutcome`](#waitoutcome)\>; \} \| \{ `ok`: `false`; `reason`: [`WaitRejection`](#waitrejection); \}

Defined in: src/runtime/supervise/types.ts:384

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

[`WaitSpec`](#waitspec)

###### opts

`WaitOpts`

###### Returns

\{ `ok`: `true`; `handle`: `Handle`\<[`WaitOutcome`](#waitoutcome)\>; \} \| \{ `ok`: `false`; `reason`: [`WaitRejection`](#waitrejection); \}

##### progress()

> **progress**(`nodeId`, `opts?`): [`WorkerProgress`](#workerprogress) \| `undefined`

Defined in: src/runtime/supervise/types.ts:398

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

[`WorkerProgress`](#workerprogress) \| `undefined`

##### traceSource()

> **traceSource**(`nodeId`): [`TraceSource`](#tracesource-1) \| `undefined`

Defined in: src/runtime/supervise/types.ts:404

The live tool-call trace of one child when its executor exposes one (`Executor.traceSource`),
 for running the online detector panel over a RUNNING worker. `undefined` otherwise.

###### Parameters

###### nodeId

`string`

###### Returns

[`TraceSource`](#tracesource-1) \| `undefined`

##### meter()

> **meter**(`spend`, `detail?`): `Promise`\<`void`\>

Defined in: src/runtime/supervise/types.ts:421

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

Defined in: src/runtime/supervise/types.ts:450

The committed work a resumed run inherits from its journal. `settled` is the replayed
`Settled[]` (cursor-ordered, rehydrated from the blob store by `replaySpawnTree`); `view`
is the tree as `materializeTreeView` folded it at the recorded cursor position. A
resume-aware `act` reads `scope.resume?.settled` to pick up where the crashed run left off.

#### Type Parameters

##### Out

`Out`

#### Properties

##### settled

> `readonly` **settled**: readonly [`Settled`](#settled-2)\<`Out`\>[]

Defined in: src/runtime/supervise/types.ts:451

##### view

> `readonly` **view**: [`TreeView`](#treeview)

Defined in: src/runtime/supervise/types.ts:452

##### waits

> `readonly` **waits**: readonly [`PendingWait`](#pendingwait)[]

Defined in: src/runtime/supervise/types.ts:459

Wait-state nodes the journal shows as ARMED but never woken — the run died mid-wait. Each
carries the ORIGINAL arm instant and absolute deadline, so re-arming the same `label` through
`Scope.wait` resumes the countdown instead of restarting it. Empty on a fresh run and on a
resumed run that was not waiting.

***

### TreeView

Defined in: src/runtime/supervise/types.ts:478

The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: src/runtime/supervise/types.ts:479

##### nodes

> `readonly` **nodes**: readonly `NodeSnapshot`[]

Defined in: src/runtime/supervise/types.ts:480

##### inFlight

> `readonly` **inFlight**: `number`

Defined in: src/runtime/supervise/types.ts:482

Count of nodes in `running` or `acquiring` — the "what's in flow?" answer.

##### waiting

> `readonly` **waiting**: `number`

Defined in: src/runtime/supervise/types.ts:486

Count of nodes in `waiting` — armed wait-states. Deliberately NOT folded into `inFlight`:
 a wait burns no executor and no budget, so counting it as flow would misreport both idle
 capacity and how much work is actually running.

***

### SpawnJournal

Defined in: src/runtime/supervise/types.ts:563

The spawn-tree event source (mirrors `ConversationJournal`'s begin/append/load shape).
`loadTree` returns events for inspection and completed-settlement replay, not live process
recovery; `appendEvent` runs only AFTER the event is observed-committed (never speculative).

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

Defined in: src/runtime/supervise/types.ts:564

###### Parameters

###### root

`string`

###### Returns

`Promise`\<[`SpawnEvent`](#spawnevent)[] \| `undefined`\>

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: src/runtime/supervise/types.ts:565

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

Defined in: src/runtime/supervise/types.ts:566

###### Parameters

###### root

`string`

###### ev

[`SpawnEvent`](#spawnevent)

###### Returns

`Promise`\<`void`\>

***

### ResultBlobStore

Defined in: src/runtime/supervise/types.ts:572

Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 invariant. Split from the journal so the journal stays small (decisions) and the
 payloads (evidence) live where a viewer/replayer rehydrates them.

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: src/runtime/supervise/types.ts:573

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: src/runtime/supervise/types.ts:574

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

***

### Supervisor

Defined in: src/runtime/supervise/types.ts:584

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

Defined in: src/runtime/supervise/types.ts:585

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

Defined in: src/runtime/supervise/types.ts:586

###### Parameters

###### h

`RootHandle`\<`Out`\>

###### Returns

`void`

***

### SupervisorOpts

Defined in: src/runtime/supervise/types.ts:589

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/types.ts:591

The root conserved-pool ceiling (tokens + usd + iterations + deadline).

##### runId

> `readonly` **runId**: `string`

Defined in: src/runtime/supervise/types.ts:593

Trace-correlation root + the journal/blob root key.

##### journal

> `readonly` **journal**: [`SpawnJournal`](#spawnjournal)

Defined in: src/runtime/supervise/types.ts:595

Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: src/runtime/supervise/types.ts:597

Result payload store backing `outRef` rehydration.

##### executors

> `readonly` **executors**: [`ExecutorRegistry`](#executorregistry)

Defined in: src/runtime/supervise/types.ts:599

Executor resolution — the open registry mapping `AgentSpec` → `Executor`.

##### probes?

> `readonly` `optional` **probes?**: [`WaitProbeRegistry`](#waitproberegistry)

Defined in: src/runtime/supervise/types.ts:603

Predicate resolution for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so
 the wait can be journaled and re-armed by a later process; this is what the name resolves
 against. Unset ⇒ `poll` waits are refused (`unknown-probe`); `timer` waits are unaffected.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: src/runtime/supervise/types.ts:605

Runtime recursion-depth ceiling (paired with the conserved pool per R3).

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: src/runtime/supervise/types.ts:610

OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
trips the supervisor to `no-winner` rather than restarting forever.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: src/runtime/supervise/types.ts:611

##### resume?

> `readonly` `optional` **resume?**: `boolean`

Defined in: src/runtime/supervise/types.ts:622

Opt into RESUME-FIRST: read any prior journal tree for this `runId` BEFORE beginning a fresh
one, and when a non-empty tree exists rehydrate its committed work onto `Scope.resume`
(`replaySpawnTree` + `materializeTreeView`) instead of starting over. Requires a journal +
blob store that OUTLIVE the process (`createFileRunContext(dir)`); against the in-memory
stores there is never a prior tree, so it is a no-op.

Default `false` — a run always begins a fresh tree, which is the behavior every existing
consumer has. Resume is a durability contract the caller opts into, never a silent default.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: src/runtime/supervise/types.ts:623

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/supervise/types.ts:624

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: src/runtime/supervise/types.ts:627

Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
 same `agent.spawn`/`agent.child` stream `runAgentRounds` feeds — one observable recursive tree.

***

### WidenGate

Defined in: src/runtime/supervise/types.ts:683

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

Defined in: src/runtime/supervise/types.ts:688

When true, widening may read `verdict` directly (collides with the steer firewall —
 must be explicitly argued per cell, never defaulted on).

#### Methods

##### shouldWiden()

> **shouldWiden**(`settled`, `budget`): `boolean`

Defined in: src/runtime/supervise/types.ts:685

Default impl returns false for every settlement (flat — never widens).

###### Parameters

###### settled

[`Settled`](#settled-2)\<`Out`\>

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

`boolean`

***

### WaitProbeRegistry

Defined in: src/runtime/supervise/wait.ts:110

Resolves a `poll` spec's `probe` name to its predicate. Threaded through `SupervisorOpts` so
 the SAME registry a fresh run used is what a resumed run re-resolves against.

#### Methods

##### resolve()

> **resolve**(`name`): [`WaitProbe`](#waitprobe) \| `undefined`

Defined in: src/runtime/supervise/wait.ts:111

###### Parameters

###### name

`string`

###### Returns

[`WaitProbe`](#waitprobe) \| `undefined`

***

### WaitOutcome

Defined in: src/runtime/supervise/wait.ts:124

The `out` a settled wait node delivers through `Scope.next()`. `settled` is the outcome the
 caller branches on: `'fired'` = the timer reached its instant or the predicate flipped;
 `'timeout'` = a bounded poll gave up. A timeout is a first-class ANSWER, not a failure — a
 wait only settles `down` when it is cancelled or aborted.

#### Properties

##### waitOutcome

> `readonly` **waitOutcome**: `true`

Defined in: src/runtime/supervise/wait.ts:126

Tag for `isWaitOutcome` — a wait outcome arrives on the same cursor as worker outputs.

##### kind

> `readonly` **kind**: `"poll"` \| `"timer"`

Defined in: src/runtime/supervise/wait.ts:127

##### settled

> `readonly` **settled**: `"timeout"` \| `"fired"`

Defined in: src/runtime/supervise/wait.ts:128

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/supervise/wait.ts:129

##### untilMs?

> `readonly` `optional` **untilMs?**: `number`

Defined in: src/runtime/supervise/wait.ts:132

The absolute instant this wait was armed for (timer `untilMs` / poll `timeoutAtMs`); absent
 for an unbounded poll.

##### armedAt

> `readonly` **armedAt**: `number`

Defined in: src/runtime/supervise/wait.ts:135

Epoch ms the wait was FIRST armed — preserved across a resume, so `wokenAt - armedAt` is
 the true end-to-end wait even when it spanned several processes.

##### wokenAt

> `readonly` **wokenAt**: `number`

Defined in: src/runtime/supervise/wait.ts:136

##### polls

> `readonly` **polls**: `number`

Defined in: src/runtime/supervise/wait.ts:138

Predicate checks performed in the process that settled it (a resume restarts this count).

##### probeErrors

> `readonly` **probeErrors**: `number`

Defined in: src/runtime/supervise/wait.ts:140

Probe checks that threw (counted, not fatal).

##### resumed

> `readonly` **resumed**: `boolean`

Defined in: src/runtime/supervise/wait.ts:142

True when a later process re-armed this wait from the journal instead of creating it.

***

### PendingWait

Defined in: src/runtime/supervise/wait.ts:156

A wait recorded in the journal that never woke — what a resumed run re-arms.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: src/runtime/supervise/wait.ts:157

##### label

> `readonly` **label**: `string`

Defined in: src/runtime/supervise/wait.ts:158

##### spec

> `readonly` **spec**: [`WaitSpec`](#waitspec)

Defined in: src/runtime/supervise/wait.ts:159

##### armedAt

> `readonly` **armedAt**: `number`

Defined in: src/runtime/supervise/wait.ts:161

The ORIGINAL arm instant. A re-armed wait keeps it, so its deadline never slides.

##### ordinal

> `readonly` **ordinal**: `number`

Defined in: src/runtime/supervise/wait.ts:163

The wait ordinal in its parent scope, so a resumed scope continues past it.

***

### WorktreeCliExecutorOptions

Defined in: src/runtime/supervise/worktree-cli-executor.ts:45

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:47

**`Experimental`**

Absolute path to the git checkout the worktree is cut from.

##### profile

> **profile**: `AgentProfile`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:55

**`Experimental`**

The supervisor-authored prompt/model plus materializable structural resources.
`model.default` selects the one-shot model; `small`, `provider`, and `metadata` remain hints.
Resource failures are fatal regardless of `resources.failOnError`.
Tools, permissions, connections, confidential execution, modes, and extensions fail closed.
Harness-specific nested controls that the pinned materializer cannot preserve also fail closed.

##### harness

> **harness**: `"claude-code"` \| `"codex"` \| `"opencode"`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:57

**`Experimental`**

Local CLI for this leaf. This explicit choice overrides `profile.harness`.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:59

**`Experimental`**

The per-task instruction handed to the harness (composed under the system prompt).

##### runId?

> `optional` **runId?**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:61

**`Experimental`**

Unique id for the worktree path + branch. Defaults to a fresh UUID.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:63

**`Experimental`**

Override the base ref the worktree is cut from (default `HEAD`).

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:65

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default).

##### codexReproducible?

> `optional` **codexReproducible?**: `boolean`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:68

**`Experimental`**

Run Codex with an ephemeral session, isolated config/instructions, network disabled, and
 JSONL usage capture. Requires `harness: 'codex'`; metered by default.

##### codexReadDeniedPaths?

> `optional` **codexReadDeniedPaths?**: readonly `string`[]

Defined in: src/runtime/supervise/worktree-cli-executor.ts:71

**`Experimental`**

Absolute host paths denied to reproducible Codex (for benchmark answer copies, credentials,
 or other task-specific ambient state).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:76

**`Experimental`**

Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:78

**`Experimental`**

Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`).

##### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:80

**`Experimental`**

Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min.

##### checkOutputCap?

> `optional` **checkOutputCap?**: `number`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:82

**`Experimental`**

Cap on each check's captured output. Default 16k.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: src/runtime/supervise/worktree-cli-executor.ts:84

**`Experimental`**

Test seam — inject a git runner so unit tests drive the worktree helpers without git.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: src/runtime/supervise/worktree-cli-executor.ts:86

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

Defined in: src/runtime/supervise/worktree-cli-executor.ts:89

**`Experimental`**

Test seam — inject the verification-command runner so unit tests script test/typecheck
 outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree.

##### budgetExempt?

> `optional` **budgetExempt?**: `boolean`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:95

**`Experimental`**

Exclude this leaf's spend from accounting. Defaults to `true` for ordinary CLI runs and
`false` for `codexReproducible`, which captures real token usage. A metered custom runner must
likewise return `LocalHarnessResult.usage`.

***

### ToolLoopCompaction

Defined in: src/runtime/tool-loop.ts:50

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

Defined in: src/runtime/tool-loop.ts:52

Compact once the estimated token count of the conversation exceeds this.

##### distill

> `readonly` **distill**: (`messages`) => `string` \| `Promise`\<`string`\>

Defined in: src/runtime/tool-loop.ts:55

Distill the conversation into a compact progress note that REPLACES the middle. Receives the
 full conversation (so it can summarize everything done so far); returns the digest string.

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`string` \| `Promise`\<`string`\>

##### preserveHead?

> `readonly` `optional` **preserveHead?**: `number`

Defined in: src/runtime/tool-loop.ts:57

Leading messages preserved verbatim (system + the original task). Default 2.

##### estimateTokens?

> `readonly` `optional` **estimateTokens?**: (`messages`) => `number`

Defined in: src/runtime/tool-loop.ts:59

Token estimator over the conversation. Default ≈ chars/4 (incl. tool-call arguments).

###### Parameters

###### messages

readonly `Msg`[]

###### Returns

`number`

##### onCompact?

> `readonly` `optional` **onCompact?**: (`info`) => `void`

Defined in: src/runtime/tool-loop.ts:61

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

Defined in: src/runtime/types.ts:35

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

Defined in: src/runtime/types.ts:37

**`Experimental`**

Iteration index this output came from (0-based).

##### environment?

> `optional` **environment?**: `AgentEnvironment`

Defined in: src/runtime/types.ts:39

**`Experimental`**

Live environment for validators that inspect files or run commands.

##### signal

> **signal**: `AbortSignal`

Defined in: src/runtime/types.ts:41

**`Experimental`**

Cooperative cancellation channel.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: src/runtime/types.ts:47

**`Experimental`**

Optional trace emitter. When set, validator implementations that make
LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.

***

### Validator

Defined in: src/runtime/types.ts:51

**`Experimental`**

#### Type Parameters

##### Output

`Output`

##### Verdict

`Verdict` = `DefaultVerdict`

#### Methods

##### validate()

> **validate**(`output`, `ctx`): `Promise`\<`Verdict`\>

Defined in: src/runtime/types.ts:52

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

Defined in: src/runtime/types.ts:64

**`Experimental`**

Provider-neutral agent run specification.

The runtime uses `profile` to create an environment per iteration, formats
`task` into a prompt via `taskToPrompt`, and passes `environment` fields
directly to the selected AgentEnvironmentProvider.

#### Type Parameters

##### Task

`Task`

#### Properties

##### profile

> **profile**: `AgentProfile`

Defined in: src/runtime/types.ts:66

**`Experimental`**

Sandbox SDK profile — what kind of agent runs the task.

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

Defined in: src/runtime/types.ts:68

**`Experimental`**

Task → prompt formatter. Pure and deterministic.

###### Parameters

###### task

`Task`

###### Returns

`string`

##### prepareEnvironment?

> `optional` **prepareEnvironment?**: (`environment`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: src/runtime/types.ts:70

**`Experimental`**

Optional setup after creation and before the first agent turn.

###### Parameters

###### environment

`AgentEnvironment`

###### ctx

###### signal

`AbortSignal`

###### recordMount

[`MountRecorder`](#mountrecorder)

###### Returns

`void` \| `Promise`\<`void`\>

##### name?

> `optional` **name?**: `string`

Defined in: src/runtime/types.ts:78

**`Experimental`**

Per-spec stable name. Surfaced in trace events and the default winner
selector tiebreak. Falls back to `profile.name ?? 'agent'`.

##### environment?

> `optional` **environment?**: `Omit`\<`CreateAgentEnvironmentInput`, `"profile"` \| `"signal"`\>

Defined in: src/runtime/types.ts:80

**`Experimental`**

Provider-neutral creation fields. `profile` and `signal` are runtime-owned.

***

### OutputAdapter

Defined in: src/runtime/types.ts:92

**`Experimental`**

Stream of provider-neutral environment events to typed output.

Adapters are pure functions over the already-collected event array; they
do not receive the live AsyncIterable so they can be replayed against
persisted streams during tests / replays.

#### Type Parameters

##### Output

`Output`

#### Methods

##### parse()

> **parse**(`events`): `Output`

Defined in: src/runtime/types.ts:93

**`Experimental`**

###### Parameters

###### events

`AgentEnvironmentEvent`[]

###### Returns

`Output`

***

### LoopTokenUsage

Defined in: src/runtime/types.ts:98

LLM token usage. Structurally maps into agent-eval's paid-call receipt so a
campaign dispatch settles real usage instead of appearing as a stub.

#### Properties

##### input

> **input**: `number`

Defined in: src/runtime/types.ts:99

##### output

> **output**: `number`

Defined in: src/runtime/types.ts:100

***

### MountManifestEntry

Defined in: src/runtime/types.ts:114

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

Defined in: src/runtime/types.ts:116

**`Experimental`**

Destination path inside the box where the resource was placed.

##### sha256

> **sha256**: `string`

Defined in: src/runtime/types.ts:119

**`Experimental`**

Hex SHA-256 of the mounted bytes. The caller computes it from the bytes
 it wrote — the kernel does not hash box contents.

##### bytes

> **bytes**: `number`

Defined in: src/runtime/types.ts:121

**`Experimental`**

Size of the mounted resource in bytes.

##### source

> **source**: `string`

Defined in: src/runtime/types.ts:124

**`Experimental`**

Free-form origin of the resource (e.g. a repo ref, a corpus id, a local
 path, a URL). Provenance only — the kernel attaches no meaning to it.

***

### SelectionReceipt

Defined in: src/runtime/types.ts:136

**`Experimental`**

A record of one candidate-selection decision: which iteration the selector
picked (or rejected) and why. Pure audit trail of the SELECTOR role — it
carries the selector's identity, the candidate's score, and an optional
human-readable reason, with no domain semantics. The kernel emits one receipt
per scored candidate at finalize so a run answers "why did THIS one win?".

#### Properties

##### candidateIndex

> **candidateIndex**: `number`

Defined in: src/runtime/types.ts:138

**`Experimental`**

Iteration index this receipt is about.

##### selected

> **selected**: `boolean`

Defined in: src/runtime/types.ts:140

**`Experimental`**

True for the iteration the selector chose as winner; false otherwise.

##### score?

> `optional` **score?**: `number`

Defined in: src/runtime/types.ts:142

**`Experimental`**

The candidate's verdict score, when it has one.

##### reason?

> `optional` **reason?**: `string`

Defined in: src/runtime/types.ts:144

**`Experimental`**

Why this candidate was (or was not) selected, when the selector states it.

##### selector

> **selector**: `"default"` \| `"driver"` \| `"caller"`

Defined in: src/runtime/types.ts:148

**`Experimental`**

Identity of the selector that produced this receipt — `'caller'` (an
 explicit `selectWinner`), `'driver'` (a driver-authored winner), or
 `'default'` (the kernel's best-valid-score argmax).

***

### RunProvenance

Defined in: src/runtime/types.ts:160

**`Experimental`**

Domain-free run provenance: a manifest of what was mounted into the run's
boxes and the receipts for how the winner was selected. Surfaced on
`LoopResult` purely for run auditability — nothing in the kernel branches on
it. Empty arrays when the caller recorded no mounts and there was no
candidate to select.

#### Properties

##### mounts

> **mounts**: [`MountManifestEntry`](#mountmanifestentry)[]

Defined in: src/runtime/types.ts:162

**`Experimental`**

Every resource recorded via `prepareBox`'s `recordMount`, in record order.

##### selectionReceipts

> **selectionReceipts**: [`SelectionReceipt`](#selectionreceipt)[]

Defined in: src/runtime/types.ts:164

**`Experimental`**

One receipt per scored candidate at finalize, in iteration order.

***

### Iteration

Defined in: src/runtime/types.ts:177

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### index

> **index**: `number`

Defined in: src/runtime/types.ts:179

**`Experimental`**

0-based iteration index assigned by the kernel.

##### task

> **task**: `Task`

Defined in: src/runtime/types.ts:180

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: src/runtime/types.ts:182

**`Experimental`**

Stable name of the `AgentRunSpec` that produced this iteration.

##### output?

> `optional` **output?**: `Output`

Defined in: src/runtime/types.ts:183

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: src/runtime/types.ts:184

**`Experimental`**

##### error?

> `optional` **error?**: `Error`

Defined in: src/runtime/types.ts:185

**`Experimental`**

##### events

> **events**: `AgentEnvironmentEvent`[]

Defined in: src/runtime/types.ts:187

**`Experimental`**

Raw provider event stream collected for this iteration.

##### startedAt

> **startedAt**: `number`

Defined in: src/runtime/types.ts:188

**`Experimental`**

##### endedAt

> **endedAt**: `number`

Defined in: src/runtime/types.ts:189

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: src/runtime/types.ts:190

**`Experimental`**

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: src/runtime/types.ts:192

**`Experimental`**

Summed LLM token usage across every `llm_call` event in this iteration.

***

### Driver

Defined in: src/runtime/types.ts:196

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

Defined in: src/runtime/types.ts:200

**`Experimental`**

Stable identifier surfaced in trace events. Default `'driver'`.

#### Methods

##### plan()

> **plan**(`task`, `history`): `Promise`\<`Task`[]\>

Defined in: src/runtime/types.ts:205

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

Defined in: src/runtime/types.ts:212

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

Defined in: src/runtime/types.ts:222

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

Defined in: src/runtime/types.ts:232

**`Experimental`**

Optional: the driver AUTHORS the winner instead of the kernel's argmax. The
kernel consults this at finalize ONLY when the caller did not pass an explicit
`selectWinner` to runAgentRounds. Return the driver-declared winner (e.g. from a
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

Defined in: src/runtime/types.ts:238

**`Experimental`**

Driver-supplied description of the just-planned move.

#### Properties

##### kind

> **kind**: `string`

Defined in: src/runtime/types.ts:240

**`Experimental`**

Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: src/runtime/types.ts:242

**`Experimental`**

Why the driver chose this move (the agent's rationale), when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: src/runtime/types.ts:249

**`Experimental`**

Iteration index this round branches FROM, when the driver declares it.
Overrides the kernel's inferred branch point — lets a planner that
branches off a specific (non-winner) iteration emit faithful edge lineage.
Omit to keep the inferred (best-valid / latest) branch point.

***

### LoopWinner

Defined in: src/runtime/types.ts:253

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### task

> **task**: `Task`

Defined in: src/runtime/types.ts:254

**`Experimental`**

##### output

> **output**: `Output`

Defined in: src/runtime/types.ts:255

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: src/runtime/types.ts:256

**`Experimental`**

##### iterationIndex

> **iterationIndex**: `number`

Defined in: src/runtime/types.ts:257

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: src/runtime/types.ts:258

**`Experimental`**

***

### LoopResult

Defined in: src/runtime/types.ts:262

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

Defined in: src/runtime/types.ts:263

**`Experimental`**

##### iterations

> **iterations**: [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

Defined in: src/runtime/types.ts:264

**`Experimental`**

##### winner?

> `optional` **winner?**: [`LoopWinner`](#loopwinner)\<`Task`, `Output`\>

Defined in: src/runtime/types.ts:265

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: src/runtime/types.ts:266

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: src/runtime/types.ts:268

**`Experimental`**

Sum of every iteration's `costUsd`.

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: src/runtime/types.ts:271

**`Experimental`**

Sum of every iteration's token usage. `loopDispatch` commits it through
 the campaign's paid-call receipt.

##### provenance

> **provenance**: [`RunProvenance`](#runprovenance)

Defined in: src/runtime/types.ts:275

**`Experimental`**

Domain-free run provenance for auditability: the mount manifest recorded
 during `prepareBox` and the selection receipts for how the winner was
 chosen. Always present; empty arrays when nothing was recorded.

***

### LoopLineageOptions

Defined in: src/runtime/types.ts:299

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
iterations across all rounds. Size `forkFanout` runs accordingly (CRIU forks
are copy-on-write, but each is still a live box until loop end).

#### Properties

##### sessionContinuity?

> `optional` **sessionContinuity?**: `boolean`

Defined in: src/runtime/types.ts:314

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

Defined in: src/runtime/types.ts:329

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

Defined in: src/runtime/types.ts:341

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

### LoopTraceEmitter

Defined in: src/runtime/types.ts:346

**`Experimental`**

#### Methods

##### emit()

> **emit**(`event`): `void` \| `Promise`\<`void`\>

Defined in: src/runtime/types.ts:347

**`Experimental`**

###### Parameters

###### event

[`LoopTraceEvent`](#looptraceevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### LoopStartedPayload

Defined in: src/runtime/types.ts:382

**`Experimental`**

#### Properties

##### driver

> **driver**: `string`

Defined in: src/runtime/types.ts:383

**`Experimental`**

##### agentRunNames

> **agentRunNames**: `string`[]

Defined in: src/runtime/types.ts:384

**`Experimental`**

##### maxIterations

> **maxIterations**: `number`

Defined in: src/runtime/types.ts:385

**`Experimental`**

##### maxConcurrency

> **maxConcurrency**: `number`

Defined in: src/runtime/types.ts:386

**`Experimental`**

***

### LoopPlanPayload

Defined in: src/runtime/types.ts:397

**`Experimental`**

Emitted once per `plan()` round, immediately after the driver plans. Carries
the topology move so a viewer renders WHAT the agent decided + WHY, not just
the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).

#### Properties

##### roundIndex

> **roundIndex**: `number`

Defined in: src/runtime/types.ts:399

**`Experimental`**

0-based plan round (one per `plan()` call).

##### plannedCount

> **plannedCount**: `number`

Defined in: src/runtime/types.ts:401

**`Experimental`**

Tasks the driver issued this round.

##### moveKind

> **moveKind**: `string`

Defined in: src/runtime/types.ts:403

**`Experimental`**

Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: src/runtime/types.ts:405

**`Experimental`**

Driver rationale for the move, when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: src/runtime/types.ts:411

**`Experimental`**

Iteration index this round branched FROM (the edge source). `undefined`
for round 0 (root). Kernel-inferred branch point — the best-valid (else
latest) iteration so far — unless a driver later declares it explicitly.

##### childIndices

> **childIndices**: `number`[]

Defined in: src/runtime/types.ts:413

**`Experimental`**

Iteration indices this round dispatched (the edge targets).

***

### LoopIterationStartedPayload

Defined in: src/runtime/types.ts:417

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: src/runtime/types.ts:418

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: src/runtime/types.ts:419

**`Experimental`**

##### taskHash

> **taskHash**: `string`

Defined in: src/runtime/types.ts:420

**`Experimental`**

##### groupId?

> `optional` **groupId?**: `number`

Defined in: src/runtime/types.ts:422

**`Experimental`**

Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: src/runtime/types.ts:424

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationDispatchPayload

Defined in: src/runtime/types.ts:435

**`Experimental`**

Where the iteration's worker was placed. `sibling` means a fresh isolated
environment. `fleet` means an existing machine in a shared workspace.
Fleet workers see the caller's filesystem and any diff
they write lands on it directly.

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: src/runtime/types.ts:436

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: src/runtime/types.ts:437

**`Experimental`**

##### placement

> **placement**: `"provider"` \| `"sandbox"` \| `"local"` \| `"fleet"`

Defined in: src/runtime/types.ts:438

**`Experimental`**

##### environmentId

> **environmentId**: `string`

Defined in: src/runtime/types.ts:440

**`Experimental`**

Set on every placement. Lets analysis correlate per-iteration logs.

##### provider

> **provider**: `string`

Defined in: src/runtime/types.ts:441

**`Experimental`**

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: src/runtime/types.ts:442

**`Experimental`**

##### machineId?

> `optional` **machineId?**: `string`

Defined in: src/runtime/types.ts:443

**`Experimental`**

##### region?

> `optional` **region?**: `string`

Defined in: src/runtime/types.ts:444

**`Experimental`**

##### providerMetadata?

> `optional` **providerMetadata?**: `Record`\<`string`, `unknown`\>

Defined in: src/runtime/types.ts:445

**`Experimental`**

##### groupId?

> `optional` **groupId?**: `number`

Defined in: src/runtime/types.ts:447

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: src/runtime/types.ts:449

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationEndedPayload

Defined in: src/runtime/types.ts:453

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: src/runtime/types.ts:454

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: src/runtime/types.ts:455

**`Experimental`**

##### outputHash?

> `optional` **outputHash?**: `string`

Defined in: src/runtime/types.ts:456

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: src/runtime/types.ts:457

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: src/runtime/types.ts:458

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: src/runtime/types.ts:459

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: src/runtime/types.ts:460

**`Experimental`**

##### tokenUsage?

> `optional` **tokenUsage?**: [`LoopTokenUsage`](#looptokenusage)

Defined in: src/runtime/types.ts:463

**`Experimental`**

Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
 branch span. Omitted when no `llm_call` events carried token counts.

##### groupId?

> `optional` **groupId?**: `number`

Defined in: src/runtime/types.ts:465

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: src/runtime/types.ts:467

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

##### outputPreview?

> `optional` **outputPreview?**: `string`

Defined in: src/runtime/types.ts:470

**`Experimental`**

Truncated string preview of the parsed output — for a viewer's drawer.
 Bounded to ~280 chars; never the full payload.

***

### LoopDecisionPayload

Defined in: src/runtime/types.ts:474

**`Experimental`**

#### Properties

##### decision

> **decision**: `string`

Defined in: src/runtime/types.ts:475

**`Experimental`**

##### historyLength

> **historyLength**: `number`

Defined in: src/runtime/types.ts:476

**`Experimental`**

***

### LoopEndedPayload

Defined in: src/runtime/types.ts:480

**`Experimental`**

#### Properties

##### winnerIterationIndex?

> `optional` **winnerIterationIndex?**: `number`

Defined in: src/runtime/types.ts:481

**`Experimental`**

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: src/runtime/types.ts:482

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: src/runtime/types.ts:483

**`Experimental`**

##### iterations

> **iterations**: `number`

Defined in: src/runtime/types.ts:484

**`Experimental`**

***

### LoopTeardownFailedPayload

Defined in: src/runtime/types.ts:490

**`Experimental`**

Emitted when a box's `delete()` throws or times out during teardown — the
 loop swallows the failure (platform reaps on expiry) but surfaces it here so
 a real leak (e.g. mid-loop auth expiry) is observable.

#### Properties

##### environmentId?

> `optional` **environmentId?**: `string`

Defined in: src/runtime/types.ts:491

**`Experimental`**

##### reason

> **reason**: `string`

Defined in: src/runtime/types.ts:493

**`Experimental`**

`'timeout'` or the delete error message.

***

### ExecCtx

Defined in: src/runtime/types.ts:501

**`Experimental`**

Execution context for `runAgentRounds`.

#### Properties

##### environmentProvider

> **environmentProvider**: `AgentEnvironmentProvider`

Defined in: src/runtime/types.ts:503

**`Experimental`**

Provider used to create every agent environment in this run.

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: src/runtime/types.ts:505

**`Experimental`**

Optional runtime hooks. Execution-scoped; never part of `AgentProfile`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: src/runtime/types.ts:507

**`Experimental`**

Optional trace emitter. When set, the kernel emits `loop.*` events.

##### onEnvironmentEvent?

> `optional` **onEnvironmentEvent?**: (`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>

Defined in: src/runtime/types.ts:525

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

`AgentEnvironmentEvent`

###### meta

###### iterationIndex

`number`

###### agentRunName

`string`

###### Returns

`void` \| `PromiseLike`\<`void`\>

##### runHandle?

> `optional` **runHandle?**: [`RuntimeRunHandle`](index.md#runtimerunhandle)

Defined in: src/runtime/types.ts:534

**`Experimental`**

Optional production-run handle. When set, every synthesized `llm_call`
the kernel infers from a sandbox event stream is forwarded via
`runHandle.observe` so per-run cost aggregates pick up loop spend.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/runtime/types.ts:536

**`Experimental`**

Cooperative cancellation signal.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: src/runtime/types.ts:542

**`Experimental`**

Trace id for OTEL correlation. When set alongside `traceEmitter`, the
exporter uses this as the parent trace for all emitted spans. Typically
inherited from TRACE_ID env var in MCP subprocess mode.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: src/runtime/types.ts:547

**`Experimental`**

Parent span id for OTEL correlation. Loop events become children of
this span. Typically inherited from PARENT_SPAN_ID env var.

***

### VerifierEnvironmentOptions

Defined in: src/runtime/verifier-environment.ts:34

#### Properties

##### name

> **name**: `string`

Defined in: src/runtime/verifier-environment.ts:35

##### extraTools?

> `optional` **extraTools?**: [`EnvironmentTool`](#environmenttool)[]

Defined in: src/runtime/verifier-environment.ts:39

Extra domain tools (read-only helpers: calculator, retrieval, style lookup).

#### Methods

##### check()

> **check**(`task`, `answer`): [`EnvironmentScore`](#environmentscore) \| `Promise`\<[`EnvironmentScore`](#environmentscore)\>

Defined in: src/runtime/verifier-environment.ts:37

The deployable check over a submitted answer. Graded via passes/total.

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### answer

`string`

###### Returns

[`EnvironmentScore`](#environmentscore) \| `Promise`\<[`EnvironmentScore`](#environmentscore)\>

##### callExtra()?

> `optional` **callExtra**(`task`, `name`, `args`): `string` \| `Promise`\<`string`\>

Defined in: src/runtime/verifier-environment.ts:41

Executes the extra tools. Required when `extraTools` is set.

###### Parameters

###### task

[`EnvironmentTask`](#environmenttask)

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`string` \| `Promise`\<`string`\>

***

### WaterfallSpan

Defined in: src/runtime/waterfall.ts:11

#### Properties

##### id

> **id**: `string`

Defined in: src/runtime/waterfall.ts:12

##### label

> **label**: `string`

Defined in: src/runtime/waterfall.ts:14

The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name.

##### runId

> **runId**: `string`

Defined in: src/runtime/waterfall.ts:15

##### parentId?

> `optional` **parentId?**: `string`

Defined in: src/runtime/waterfall.ts:16

##### startMs

> **startMs**: `number`

Defined in: src/runtime/waterfall.ts:17

##### endMs?

> `optional` **endMs?**: `number`

Defined in: src/runtime/waterfall.ts:18

##### status

> **status**: `"running"` \| `"done"` \| `"down"`

Defined in: src/runtime/waterfall.ts:19

##### usd

> **usd**: `number`

Defined in: src/runtime/waterfall.ts:20

##### tokens

> **tokens**: `object`

Defined in: src/runtime/waterfall.ts:21

###### input

> **input**: `number`

###### output

> **output**: `number`

##### score?

> `optional` **score?**: `number`

Defined in: src/runtime/waterfall.ts:22

***

### WaterfallReport

Defined in: src/runtime/waterfall.ts:25

#### Properties

##### spans

> **spans**: [`WaterfallSpan`](#waterfallspan)[]

Defined in: src/runtime/waterfall.ts:26

##### totalMs

> **totalMs**: `number`

Defined in: src/runtime/waterfall.ts:28

Wall-clock of the observed window (first spawn → last settle).

##### totalUsd

> **totalUsd**: `number`

Defined in: src/runtime/waterfall.ts:29

##### totalTokens

> **totalTokens**: `object`

Defined in: src/runtime/waterfall.ts:30

###### input

> **input**: `number`

###### output

> **output**: `number`

##### byKind

> **byKind**: `Record`\<`string`, \{ `count`: `number`; `ms`: `number`; `usd`: `number`; `tokens`: \{ `input`: `number`; `output`: `number`; \}; \}\>

Defined in: src/runtime/waterfall.ts:32

Rollup by label prefix (the part before ':') — shots vs analysts vs anything else.

***

### WaterfallCollector

Defined in: src/runtime/waterfall.ts:49

#### Properties

##### hooks

> **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: src/runtime/waterfall.ts:51

Attach these to RunStrategyOptions.hooks / BenchmarkConfig.hooks.

#### Methods

##### report()

> **report**(): [`WaterfallReport`](#waterfallreport)

Defined in: src/runtime/waterfall.ts:52

###### Returns

[`WaterfallReport`](#waterfallreport)

##### render()

> **render**(`opts?`): `string`

Defined in: src/runtime/waterfall.ts:54

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

Defined in: src/runtime/waterfall.ts:55

###### Returns

`void`

***

### Workspace

Defined in: src/runtime/workspace.ts:11

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: src/runtime/workspace.ts:12

#### Methods

##### materialize()

> **materialize**(`dir`): `Promise`\<`void`\>

Defined in: src/runtime/workspace.ts:13

###### Parameters

###### dir

`string`

###### Returns

`Promise`\<`void`\>

##### commit()

> **commit**(`dir`, `message`): `Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

Defined in: src/runtime/workspace.ts:14

###### Parameters

###### dir

`string`

###### message

`string`

###### Returns

`Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

##### head()

> **head**(): `Promise`\<`string`\>

Defined in: src/runtime/workspace.ts:15

###### Returns

`Promise`\<`string`\>

***

### GitWorkspaceOptions

Defined in: src/runtime/workspace.ts:40

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: src/runtime/workspace.ts:41

##### shell?

> `readonly` `optional` **shell?**: [`Shell`](#shell)

Defined in: src/runtime/workspace.ts:42

##### branch?

> `readonly` `optional` **branch?**: `string`

Defined in: src/runtime/workspace.ts:43

##### noHooks?

> `readonly` `optional` **noHooks?**: `boolean`

Defined in: src/runtime/workspace.ts:44

***

### WorkspaceRun

Defined in: src/runtime/workspace.ts:137

#### Type Parameters

##### T

`T`

#### Properties

##### valid

> `readonly` **valid**: `boolean`

Defined in: src/runtime/workspace.ts:138

##### value

> `readonly` **value**: `T`

Defined in: src/runtime/workspace.ts:139

##### commit?

> `readonly` `optional` **commit?**: [`WorkspaceCommit`](#workspacecommit)

Defined in: src/runtime/workspace.ts:141

Present when a commit was attempted (valid, or `commitOnInvalid`).

## Type Aliases

### CoordinationEvent

> **CoordinationEvent** = \{ `type`: `"question"`; `question`: [`QuestionRecord`](mcp.md#questionrecord); \} \| \{ `type`: `"settled"`; `worker`: [`SettledWorker`](mcp.md#settledworker); \} \| \{ `type`: `"finding"`; `finding`: `AnalystFindingEvent`; \} \| \{ `type`: `"steer"`; `down`: `DownMessageEvent`; \} \| \{ `type`: `"answer"`; `down`: `DownMessageEvent`; `questionId`: `string`; \}

Defined in: src/mcp/tools/coordination.ts:93

Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 the driver to `pull`. DOWN (parent→child): steer / answer — record-only (history + subscribers),
 routed to the child inbox. New kinds are additive.

***

### MakeWorkerAgent

> **MakeWorkerAgent** = (`profile`) => [`Agent`](#agent-1)\<`unknown`, `unknown`\>

Defined in: src/mcp/tools/coordination.ts:100

#### Parameters

##### profile

`unknown`

#### Returns

[`Agent`](#agent-1)\<`unknown`, `unknown`\>

***

### EnvironmentDeliverable

> **EnvironmentDeliverable**\<`Output`\> = \{ `kind`: `"events"`; `fromEvents`: (`events`) => `Output`; \} \| \{ `kind`: `"artifact"`; `path`: `string`; `fromArtifact`: (`content`, `events`) => `Output`; \}

Defined in: src/runtime/environment-run.ts:15

Convert a completed turn into the caller's typed result.

#### Type Parameters

##### Output

`Output`

***

### EnvironmentTurnOptions

> **EnvironmentTurnOptions** = `Omit`\<`AgentTurnInput`, `"prompt"` \| `"parts"` \| `"sessionId"`\>

Defined in: src/runtime/environment-run.ts:53

***

### InProcessTurnEvents

> **InProcessTurnEvents** = readonly `AgentEnvironmentEvent`[] \| `AsyncIterable`\<`AgentEnvironmentEvent`\>

Defined in: src/runtime/in-process-environment-provider.ts:38

***

### InProcessOnTurn

> **InProcessOnTurn** = (`prompt`, `context`) => [`InProcessTurnEvents`](#inprocessturnevents) \| `Promise`\<[`InProcessTurnEvents`](#inprocessturnevents)\>

Defined in: src/runtime/in-process-environment-provider.ts:43

Produces one environment event stream without network access.

#### Parameters

##### prompt

`string`

##### context

[`InProcessTurnContext`](#inprocessturncontext)

#### Returns

[`InProcessTurnEvents`](#inprocessturnevents) \| `Promise`\<[`InProcessTurnEvents`](#inprocessturnevents)\>

***

### LoopOptionsForDispatch

> **LoopOptionsForDispatch**\<`Task`, `Output`, `Decision`\> = `Omit`\<[`RunAgentRoundsOptions`](#runagentroundsoptions)\<`Task`, `Output`, `Decision`\>, `"ctx"`\>

Defined in: src/runtime/loop-dispatch.ts:29

runAgentRounds options minus the `ctx` (loopDispatch builds the ctx).

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

##### Decision

`Decision`

***

### AssertTraceDerivedFindings

> **AssertTraceDerivedFindings** = (`findings`) => `void`

Defined in: src/runtime/personify/wave-types.ts:413

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

Defined in: src/runtime/personify/wave-types.ts:504

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

Defined in: src/runtime/personify/wave-types.ts:564

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

Defined in: src/runtime/personify/wave-types.ts:619

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

> **Environment** = [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/run-benchmark.ts:31

A checkable task domain — implement these 5 hooks and the suite does the rest. The
 same seam as `TaskEnvironment`; `Environment` is the RL/gym-standard name for it.

***

### SteeringDecision

> **SteeringDecision** = `"refine"` \| `"pick-winner"` \| `"fail"`

Defined in: src/runtime/steering-drivers.ts:55

Terminal-or-continue decision shared by all three steering drivers. The
non-terminal `'refine'` keeps the loop running another shot; the terminal
`'pick-winner'`/`'fail'` stop it (`isTerminalDecision` in run-loop.ts treats
`'pick-winner'` and `'fail'` as terminal and any other string as a request
for another round). Identical to the reference refine driver's decision set.

***

### ApplyContinuation

> **ApplyContinuation**\<`Task`\> = (`task`, `continuation`) => `Task`

Defined in: src/runtime/steering-drivers.ts:64

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

Defined in: src/runtime/strategy-evolution.ts:56

***

### AgentTurnTarget

> **AgentTurnTarget** = \{ `kind`: `"environment"`; `environment`: `AgentEnvironment`; `turn?`: `EnvironmentTurnOptions`; `agentRunName?`: `string`; \} \| \{ `kind`: `"provider"`; `provider`: `AgentEnvironmentProvider`; `profile`: `AgentProfile`; `environment?`: `EnvironmentCreateOptions`; `prepareEnvironment?`: [`AgentRunSpec`](#agentrunspec)\<`unknown`\>\[`"prepareEnvironment"`\]; `turn?`: `EnvironmentTurnOptions`; `agentRunName?`: `string`; \}

Defined in: src/runtime/stream-agent-turn.ts:43

**`Experimental`**

The execution target for one turn.

#### Union Members

##### Type Literal

\{ `kind`: `"environment"`; `environment`: `AgentEnvironment`; `turn?`: `EnvironmentTurnOptions`; `agentRunName?`: `string`; \}

###### kind

> **kind**: `"environment"`

A caller-owned environment. It is not destroyed after the turn.

###### environment

> **environment**: `AgentEnvironment`

###### turn?

> `optional` **turn?**: `EnvironmentTurnOptions`

Provider-neutral fields forwarded with the turn.

###### agentRunName?

> `optional` **agentRunName?**: `string`

Label stamped on usage events that do not report a model.

***

##### Type Literal

\{ `kind`: `"provider"`; `provider`: `AgentEnvironmentProvider`; `profile`: `AgentProfile`; `environment?`: `EnvironmentCreateOptions`; `prepareEnvironment?`: [`AgentRunSpec`](#agentrunspec)\<`unknown`\>\[`"prepareEnvironment"`\]; `turn?`: `EnvironmentTurnOptions`; `agentRunName?`: `string`; \}

###### kind

> **kind**: `"provider"`

Create, prepare, and own one environment for this turn.

###### provider

> **provider**: `AgentEnvironmentProvider`

###### profile

> **profile**: `AgentProfile`

###### environment?

> `optional` **environment?**: `EnvironmentCreateOptions`

Provider-neutral fields forwarded at environment creation.

###### prepareEnvironment?

> `optional` **prepareEnvironment?**: [`AgentRunSpec`](#agentrunspec)\<`unknown`\>\[`"prepareEnvironment"`\]

Optional setup after creation and before streaming.

###### turn?

> `optional` **turn?**: `EnvironmentTurnOptions`

Provider-neutral fields forwarded with the turn.

###### agentRunName?

> `optional` **agentRunName?**: `string`

Label stamped on usage events that do not report a model.

***

### RepairStop

> **RepairStop** = `"already-passing"` \| `"no-signal"` \| `"repaired-pass"` \| `"rounds-exhausted"` \| `"no-candidates"`

Defined in: src/runtime/structural-rollout.ts:476

***

### BudgetReadout

> **BudgetReadout** = `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: src/runtime/supervise/budget.ts:44

Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver.

***

### DispatchStopReason

> **DispatchStopReason** = `"drained"` \| `"not-admitted"` \| `"stopped"` \| `"aborted"`

Defined in: src/runtime/supervise/dispatch.ts:65

Why the dispatcher stopped admitting work. `drained` = the queue ran dry (the ordinary end);
 `not-admitted` = the conserved pool or the depth ceiling refused a spawn; `stopped` = the
 caller's `shouldStop` returned true; `aborted` = the scope's signal fired.

***

### RunContext

> **RunContext** = [`InMemoryRunContext`](#inmemoryruncontext)

Defined in: src/runtime/supervise/run-context.ts:66

The stores a supervised run needs, in-memory or file-backed. `InMemoryRunContext` is the
 historical name for the same shape.

***

### StopDecision

> **StopDecision** = \{ `stop`: `false`; \} \| \{ `stop`: `true`; `reason`: `string`; \}

Defined in: src/runtime/supervise/stop-rules.ts:88

A stop rule's answer. `reason` is required when stopping — a run that ends must be able to say
 why in the result, and an unexplained early stop is indistinguishable from a bug.

***

### StopRule

> **StopRule** = (`view`) => [`StopDecision`](#stopdecision)

Defined in: src/runtime/supervise/stop-rules.ts:94

Evaluated from the progress feed, never from the budget. Pure and synchronous: it is called on
 the driver's hot path, once per turn.

#### Parameters

##### view

[`ProgressView`](#progressview)

#### Returns

[`StopDecision`](#stopdecision)

***

### DriveHarness

> **DriveHarness** = (`args`) => `Promise`\<`void`\>

Defined in: src/runtime/supervise/supervisor-agent.ts:66

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

Defined in: src/runtime/supervise/types.ts:170

Normalized usage event — the single channel every executor reports through, so the
conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
`{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).

***

### Runtime

> **Runtime** = `"router"` \| `"inline"` \| `"sandbox"` \| `"cli"` \| `string` & `object`

Defined in: src/runtime/supervise/types.ts:177

The runtime tag of a `Executor` impl. Open by intent: custom runtimes use their own string name.
External executors can register additional runtime strings without widening this type.

***

### ExecutorFactory

> **ExecutorFactory**\<`Out`\> = (`spec`, `ctx`) => [`Executor`](#executor)\<`Out`\>

Defined in: src/runtime/supervise/types.ts:205

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

Defined in: src/runtime/supervise/types.ts:278

Deterministic node id — `${parent}:s${seq}` from the cursor order, never wall-clock.

***

### Settled

> **Settled**\<`Out`\> = \{ `kind`: `"done"`; `handle`: `Handle`\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `seq`: `number`; \} \| \{ `kind`: `"down"`; `handle`: `Handle`\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

Defined in: src/runtime/supervise/types.ts:307

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

> **SpawnEvent** = \{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `budget`: [`Budget`](#budget-10); `runtime`: [`Runtime`](#runtime-3); `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"settled"`; `id`: [`NodeId`](#nodeid-1); `status`: `"done"` \| `"down"`; `outRef?`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `infra?`: `boolean`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: [`NodeId`](#nodeid-1); `reason`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"waiting"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `spec`: [`WaitSpec`](#waitspec); `armedAt`: `number`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"woken"`; `id`: [`NodeId`](#nodeid-1); `by`: `"fired"` \| `"timeout"` \| `"cancelled"`; `outRef?`: `string`; `seq`: `number`; `at`: `string`; \} \| \{ `kind`: `"metered"`; `id`: [`NodeId`](#nodeid-1); `spend`: [`Spend`](#spend); `seq`: `number`; `at`: `string`; \}

Defined in: src/runtime/supervise/types.ts:493

Journaled spawn-tree events (B1/B2). `seq` is the cursor order; `at` is an ISO
 timestamp for human inspection only (NOT a replay input).

#### Union Members

##### Type Literal

\{ `kind`: `"spawned"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `budget`: [`Budget`](#budget-10); `runtime`: [`Runtime`](#runtime-3); `seq`: `number`; `at`: `string`; \}

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

\{ `kind`: `"waiting"`; `id`: [`NodeId`](#nodeid-1); `parent?`: [`NodeId`](#nodeid-1); `label`: `string`; `spec`: [`WaitSpec`](#waitspec); `armedAt`: `number`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"waiting"`

A wait-state node was ARMED. Lives in the SPAWN-ORDINAL namespace (`seq` is the wait
 ordinal within its parent scope), exactly like `spawned` — it creates a node, it does not
 settle one. It carries the whole `spec` and the original `armedAt` so a brand-new process
 re-arms the identical wait with the identical ABSOLUTE deadline.

###### id

> **id**: [`NodeId`](#nodeid-1)

###### parent?

> `optional` **parent?**: [`NodeId`](#nodeid-1)

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

\{ `kind`: `"woken"`; `id`: [`NodeId`](#nodeid-1); `by`: `"fired"` \| `"timeout"` \| `"cancelled"`; `outRef?`: `string`; `seq`: `number`; `at`: `string`; \}

###### kind

> **kind**: `"woken"`

A wait-state node SETTLED — the cursor-namespace twin of `settled`, kept distinct so a
 reader can tell zero-cost waiting apart from paid work without inspecting payloads. A
 wait carries no `spent` (it is free by construction, not by measurement); `outRef`
 rehydrates its `WaitOutcome`, absent when the wait was cancelled.

###### id

> **id**: [`NodeId`](#nodeid-1)

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

Defined in: src/runtime/supervise/types.ts:631

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

### WaitSpec

> **WaitSpec** = \{ `kind`: `"timer"`; `untilMs`: `number`; \} \| \{ `kind`: `"poll"`; `probe`: `string`; `intervalMs`: `number`; `timeoutAtMs?`: `number`; `args?`: `Record`\<`string`, `unknown`\>; \}

Defined in: src/runtime/supervise/wait.ts:50

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

Defined in: src/runtime/supervise/wait.ts:103

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

Defined in: src/runtime/supervise/wait.ts:167

Reject reasons for `Scope.wait`, mirroring `Scope.spawn`'s fail-closed admission shape.

***

### WorktreePatchArtifact

> **WorktreePatchArtifact** = `WorktreeHarnessResult`

Defined in: src/runtime/supervise/worktree-cli-executor.ts:42

Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 diff + the harness's run record + the derived checks).

***

### ToolLoopChat

> **ToolLoopChat** = (`messages`, `tools`) => `Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`RouterToolCall`](#routertoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; \}; `costUsd?`: `number`; \}\>

Defined in: src/runtime/tool-loop.ts:17

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

Defined in: src/runtime/tool-loop.ts:66

Public supervisor-facing compaction config: same knobs as the primitive, but `distill` is optional
 because the supervisor has a default digest that combines a brain note with live worker state.

#### Type Declaration

##### distill?

> `readonly` `optional` **distill?**: [`ToolLoopCompaction`](#toolloopcompaction)\[`"distill"`\]

***

### MountRecorder

> **MountRecorder** = (`entry`) => `void`

Defined in: src/runtime/types.ts:174

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

Defined in: src/runtime/types.ts:351

**`Experimental`**

***

### Shell

> **Shell** = (`args`, `cwd?`) => `Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

Defined in: src/runtime/workspace.ts:2

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

Defined in: src/runtime/workspace.ts:7

## Variables

### defaultAuditorInstruction

> `const` **defaultAuditorInstruction**: `string`

Defined in: src/runtime/audit-intent.ts:66

Default system instruction for intent-auditor agents: diagnose diverged/drifting trajectories.

***

### mcpSecretEnvMetadataKey

> `const` **mcpSecretEnvMetadataKey**: `"secretEnv"` = `'secretEnv'`

Defined in: src/runtime/key-provider.ts:55

The `AgentProfileMcpServer.metadata` key the declarative secret-env map
 rides under: `{ ENV_VAR_NAME: 'PROVIDER_KEY_NAME' }`. Names only — values
 are resolved at materialize time and never stored.

***

### defaultAnalystInstruction

> `const` **defaultAnalystInstruction**: `string`

Defined in: src/runtime/observe.ts:54

The default observer instruction — exported so an optimizer can seed its population.

***

### assertTraceDerivedFindings

> `const` **assertTraceDerivedFindings**: [`AssertTraceDerivedFindings`](#asserttracederivedfindings-1)

Defined in: src/runtime/personify/analyst.ts:47

***

### strategyAuthorContract

> `const` **strategyAuthorContract**: "\nYou author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to\nspend a compute budget to beat a task's deployable check. You compose exactly two steps:\n\n  shot(spec?: \{ handle?, messages?, steer?, persona?, tools? \}): Promise\<ShotResult \| null\>\n    Runs ONE worker attempt (a bounded tool loop) over an artifact.\n    - omit handle  =\> the shot opens its OWN fresh artifact and closes it after (a sample).\n    - pass handle  =\> the shot CONTINUES that artifact (state accumulates across shots).\n    - messages     =\> the carried conversation (pass the previous ShotResult.messages to continue).\n    - steer        =\> a corrective instruction injected before the shot.\n    - persona      =\> \{ systemPrompt?, model? \} — give THIS shot its own role and/or model\n      (multi-agent strategies: a researcher shot then an engineer shot, a panel of k\n      personas over one budget). On a fresh shot the systemPrompt replaces the task's; on\n      a carried conversation it arrives as a hand-off message. Same conserved budget.\n    - tools        =\> string\[\] — restrict THIS shot to a subset of the task's tools by\n      name (focus an explore shot on read-only tools, an execute shot on write tools).\n      Restriction-only; unknown names make the shot fail. ALWAYS select from\n      await listTools(handle) — never hardcode. Omitted =\> the shot sees every tool.\n    ShotResult = \{ messages, score (0..1 on the task's check), passes, total, completions, toolErrors \}\n    Returns null if the attempt failed infra-wise.\n\n  critique(messages): Promise\<string \| null\>\n    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective\n    instruction (or null when it judges the work complete). Costs ~1 completion.\n\n  consult(messages, instruction): Promise\<string \| null\>\n    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the\n    trajectory verbatim (no reformatting) — use it when you need a specific reply format\n    (a decision, a prediction). Costs ~1 completion.\n\n  surface.open(task) / surface.close(handle)\n    Open a persistent artifact you manage yourself (remember to close in a finally).\n    close is idempotent — closing an already-closed handle is a safe no-op.\n\n  listTools(handle): Promise\<Array\<\{ name, description? \}\>\>\n    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a\n    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding\n    names from an example kills your shots on every task whose tools differ.\n\nRules:\n- ALWAYS await every shot/critique/surface call — a floating promise that rejects\n  crashes the whole benchmark run.\n- Stay within ~budget total shots; every shot/critique spends from a conserved pool.\n- For a FRESH attempt OMIT \`messages\` entirely (never pass \`\[\]\` — an empty array is a\n  fresh conversation too, but be explicit). To CONTINUE, pass the previous\n  ShotResult.messages unchanged.\n- Return \{ score, resolved, completions, progression, shots \} — score = the BEST checkpoint\n  you reached (keep-best, never final-state), progression = score after each shot.\n- The module must be EXACTLY this shape (no other imports, no commentary outside code):\n\nimport \{ defineStrategy \} from '@tangle-network/agent-runtime/loops'\nexport default defineStrategy('your-strategy-name', async (\{ surface, task, budget, shot, critique, listTools \}) =\> \{\n  // your composition (listTools comes from the destructured context — it is NOT a global)\n\})\n"

Defined in: src/runtime/strategy-author.ts:22

The compressed consumable a skill carries: everything an author needs to emit a loop.

***

### sample

> `const` **sample**: [`Strategy`](#strategy-3)

Defined in: src/runtime/strategy.ts:772

Built-in `Strategy`: K independent attempts, keep the best-verifying (best-of-N / resample).

***

### refine

> `const` **refine**: [`Strategy`](#strategy-3)

Defined in: src/runtime/strategy.ts:777

Built-in `Strategy`: attempt → `observe()` reads the trace → steer the next attempt → repeat (deepen one lineage).

***

### adaptiveRefine

> `const` **adaptiveRefine**: [`Strategy`](#strategy-3)\<\{ `score`: `number`; `resolved`: `boolean`; `completions`: `number`; `progression`: `number`[]; `shots`: `number`; \}\>

Defined in: src/runtime/strategy.ts:977

A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 optimizations" path: a new technique, compact, with zero Supervisor ceremony.

***

### sampleThenRefine

> `const` **sampleThenRefine**: [`Strategy`](#strategy-3)\<\{ `score`: `number`; `resolved`: `boolean`; `completions`: `number`; `progression`: `number`[]; `shots`: `number`; \}\>

Defined in: src/runtime/strategy.ts:1020

The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 then refine the best-verifying line with the remaining budget. Sample's basin escape +
 refine's accumulation — the third built-in, authored from the public steps.

***

### defaultStructuralRolloutPolicy

> `const` **defaultStructuralRolloutPolicy**: [`StructuralRolloutPolicy`](#structuralrolloutpolicy)

Defined in: src/runtime/structural-rollout.ts:57

The measured default recipe: 5 samples, 2 guarded repair rounds, 6 authored checks.

***

### defaultProfileRichnessThresholds

> `const` **defaultProfileRichnessThresholds**: [`ProfileRichnessThresholds`](#profilerichnessthresholds)

Defined in: src/runtime/supervise/authoring.ts:140

Default thresholds for `ProfileRichnessThresholds` — 600 chars / 6 lines minimum system prompt.

***

### defaultDelegateBudget

> `const` **defaultDelegateBudget**: [`Budget`](#budget-10)

Defined in: src/runtime/supervise/delegate.ts:35

The conserved pool a `delegate()` call applies when the caller does not pass its own `budget`.
 A modest token ceiling + a small iteration ceiling — generous enough for a few-worker decompose,
 bounded enough that an unsupervised intent cannot run away. Callers override via `opts.budget`.

***

### DEFAULT\_ENVIRONMENT\_STEERING\_MAX\_TURNS

> `const` **DEFAULT\_ENVIRONMENT\_STEERING\_MAX\_TURNS**: `24` = `24`

Defined in: src/runtime/supervise/environment-session.ts:33

***

### PI\_RUNTIME

> `const` **PI\_RUNTIME**: [`Runtime`](#runtime-3) = `'pi'`

Defined in: src/runtime/supervise/pi-executor.ts:49

The runtime name `piExecutor` registers under.

***

### piSeamKey

> `const` **piSeamKey**: `"pi"` = `'pi'`

Defined in: src/runtime/supervise/pi-executor.ts:52

Seam key the registry threads a `PiSeam` through (`ExecutorContext.seams['pi']`).

***

### piExecutor

> `const` **piExecutor**: [`ExecutorFactory`](#executorfactory)\<`unknown`\>

Defined in: src/runtime/supervise/pi-executor.ts:82

Build the `Executor` for one pi worker. Registered as runtime `'pi'`.

***

### DEFAULT\_STALL\_AFTER\_MS

> `const` **DEFAULT\_STALL\_AFTER\_MS**: `180000` = `180_000`

Defined in: src/runtime/supervise/progress.ts:30

How long a worker may produce no metered activity before a `progress()` read calls it stalled.
 Deliberately generous: a coding harness routinely spends minutes inside one tool call, and a
 false stall that provokes a steer is worse than a late one.

## Functions

### contentAddress()

> **contentAddress**(`artifact`): `string`

Defined in: src/durable/spawn-journal.ts:50

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

> **replaySpawnTree**(`journal`, `blobs`, `root`): `Promise`\<[`Settled`](#settled-2)\<`unknown`\>[]\>

Defined in: src/durable/spawn-journal.ts:311

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

`Promise`\<[`Settled`](#settled-2)\<`unknown`\>[]\>

***

### materializeTreeView()

> **materializeTreeView**(`events`): [`TreeView`](#treeview)

Defined in: src/durable/spawn-journal.ts:424

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

Defined in: src/durable/spawn-journal.ts:502

The waits a journaled tree shows as ARMED but never woken — what a resumed run re-arms with the
ORIGINAL absolute deadline. Reading it from the journal (rather than from any live state) is
what makes "SIGKILL a waiting tree, a new process keeps waiting to the same instant" true.

#### Parameters

##### events

[`SpawnEvent`](#spawnevent)[]

#### Returns

[`PendingWait`](#pendingwait)[]

***

### bestSoFar()

> **bestSoFar**(`values`): `number`[]

Defined in: src/runtime/anytime.ts:72

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

Defined in: src/runtime/anytime.ts:84

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

Defined in: src/runtime/anytime.ts:97

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

Defined in: src/runtime/anytime.ts:116

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

Defined in: src/runtime/anytime.ts:207

One row per (strategy, satisficing target): the shareable time-to-satisfactory table.

#### Parameters

##### report

[`AnytimeReport`](#anytimereport)

#### Returns

`string`

***

### auditIntent()

> **auditIntent**(`input`, `opts`): `Promise`\<[`IntentAudit`](#intentaudit)\>

Defined in: src/runtime/audit-intent.ts:110

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

Defined in: src/runtime/benchmark-report.ts:215

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

Defined in: src/runtime/benchmark-report.ts:413

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

Defined in: src/runtime/benchmark-report.ts:491

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

Defined in: src/runtime/benchmark-report.ts:535

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

Defined in: src/runtime/benchmark-report.ts:570

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

Defined in: src/runtime/benchmark-report.ts:641

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

Defined in: src/runtime/completion.ts:64

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

Defined in: src/runtime/completion.ts:75

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

Defined in: src/runtime/completion.ts:88

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

Defined in: src/runtime/completion.ts:113

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

Defined in: src/runtime/define-leaderboard.ts:325

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

### createEnvironmentForSpec()

> **createEnvironmentForSpec**\<`Task`\>(`provider`, `spec`, `signal`, `recordMount?`): `Promise`\<`AgentEnvironment`\>

Defined in: src/runtime/environment-create.ts:10

Create and prepare one provider-neutral agent environment.

#### Type Parameters

##### Task

`Task`

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### spec

[`AgentRunSpec`](#agentrunspec)\<`Task`\>

##### signal

`AbortSignal`

##### recordMount?

[`MountRecorder`](#mountrecorder)

#### Returns

`Promise`\<`AgentEnvironment`\>

***

### notifyAgentEnvironmentEventObserver()

> **notifyAgentEnvironmentEventObserver**\<`Meta`\>(`event`, `observer`, `meta`): `void`

Defined in: src/runtime/environment-events.ts:22

Forward a provider event to an optional observer without letting observer
behavior affect the run. The observer receives a defensive copy, synchronous
throws are swallowed, and returned promises are deliberately not awaited.

#### Type Parameters

##### Meta

`Meta`

#### Parameters

##### event

`AgentEnvironmentEvent`

##### observer

((`event`, `meta`) => `void` \| `PromiseLike`\<`void`\>) \| `undefined`

##### meta

`Meta`

#### Returns

`void`

***

### extractLlmCallEvent()

> **extractLlmCallEvent**(`event`, `agentRunName`): RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

Defined in: src/runtime/environment-events.ts:82

Extract a `RuntimeStreamEvent`-shaped `llm_call` from a provider event when
the event carries usage/cost data. Returns `undefined` for non-cost events
so the kernel can iterate the full stream without branching.

Canonical cost-carrying types observed in the wild:
  - `llm_call` — `data: { model, tokensIn, tokensOut, costUsd, ... }`
  - `message.completed` / `result` — `data: { usage: { inputTokens,
     outputTokens, totalCostUsd? } }`
  - `cost.usage` / `usage` — same shape under a dedicated type

`AgentEnvironmentEvent.usage` is an additive amount for that event, never a
running total. Numeric coercion is strict: `Number.isFinite` gates every
accumulator write so a sentinel `NaN` from a misbehaving backend cannot
poison the ledger.

#### Parameters

##### event

`AgentEnvironmentEvent`

##### agentRunName

`string`

#### Returns

RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

***

### sumEnvironmentUsage()

> **sumEnvironmentUsage**(`events`, `agentRunName?`): `object`

Defined in: src/runtime/environment-events.ts:152

Sum the token usage + USD cost of a provider turn's events — the one honest way to meter an
environment run. Folds `extractLlmCallEvent` over the stream (which reads usage off every backend
event shape), so a `runProfileMatrix` dispatch can report it to `ctx.cost`:

    receipt: (turn) => {
      const u = sumEnvironmentUsage(turn.events)
      return { model, inputTokens: u.input, outputTokens: u.output,
        ...(u.costUsd > 0 ? { actualCostUsd: u.costUsd } : {}) }
    }

Without this a cell reads `{tokens:0, cost:0}` and the backend-integrity guard correctly aborts the
matrix as a stub. `agentRunName` is the fallback model label for cost-only events (default `'agent'`).

#### Parameters

##### events

readonly `AgentEnvironmentEvent`[]

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

### extractEnvironmentFinalText()

> **extractEnvironmentFinalText**(`event`): `string` \| `undefined`

Defined in: src/runtime/environment-events.ts:170

Read final text from a terminal provider event when the provider reports it.

#### Parameters

##### event

`AgentEnvironmentEvent`

#### Returns

`string` \| `undefined`

***

### extractEnvironmentTurnText()

> **extractEnvironmentTurnText**(`events`): `string`

Defined in: src/runtime/environment-events.ts:195

Resolve one provider turn to text, preferring its terminal result over deltas.

#### Parameters

##### events

readonly `AgentEnvironmentEvent`[]

#### Returns

`string`

***

### createEnvironmentToolPartState()

> **createEnvironmentToolPartState**(): [`EnvironmentToolPartState`](#environmenttoolpartstate)

Defined in: src/runtime/environment-events.ts:261

**`Experimental`**

Fresh per-turn [EnvironmentToolPartState](#environmenttoolpartstate) for [mapEnvironmentToolEvent](#mapenvironmenttoolevent) — an
empty call-status map so each turn projects tool frames independently.

#### Returns

[`EnvironmentToolPartState`](#environmenttoolpartstate)

***

### mapEnvironmentToolEvent()

> **mapEnvironmentToolEvent**(`event`, `state`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) & `object`[]

Defined in: src/runtime/environment-events.ts:292

**`Experimental`**

Project one `AgentEnvironmentEvent` onto the `tool_call` / `tool_result` variants of
`RuntimeStreamEvent` — the tool-part projection `mapAgentEnvironmentEvent`
deliberately does NOT perform. Opt-in and additive: `mapAgentEnvironmentEvent`'s
default vocabulary (text/reasoning deltas + `llm_call`) is unchanged;
consumers that need the tool surface (chat UIs rendering tool activity)
compose this projector alongside it — `streamAgentTurn` does exactly that
under its `preserveToolParts` option.

Handled shapes (observed on the opencode / claude-code provider backends):
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

`AgentEnvironmentEvent`

##### state

[`EnvironmentToolPartState`](#environmenttoolpartstate)

#### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) & `object`[]

***

### mapAgentEnvironmentEvent()

> **mapAgentEnvironmentEvent**(`event`, `opts?`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: src/runtime/environment-events.ts:419

Project one `AgentEnvironmentEvent` onto the `RuntimeStreamEvent` chat-UX vocabulary,
for runtimes that bridge a provider stream into the
`AgentRuntime.act` streaming contract. Returns `undefined` for events that
have no faithful projection — the raw stream is preserved separately for the
`OutputAdapter`, so an unmapped event never loses data.

Mapped (the task-optional incremental variants — no synthesized task
lifecycle, no guessed tool-part shapes):
  - `message.part.updated` text part → `text_delta`
  - `message.part.updated` reasoning/thinking part → `reasoning_delta`
  - cost-bearing events → `llm_call` (shared with the ledger extractor)

Tool parts are deliberately NOT mapped here (unchanged default) — compose
[mapEnvironmentToolEvent](#mapenvironmenttoolevent) alongside when a consumer needs them.

The opencode backend emits incremental text as
`{ type: 'message.part.updated', data: { part: { type, text }, delta } }`;
`delta` is the increment, `part.text` the running accumulation.

#### Parameters

##### event

`AgentEnvironmentEvent`

##### opts?

###### agentRunName?

`string`

#### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

***

### turnEvents()

> **turnEvents**(`streaming`, `environment`, `prompt`, `sessionId`, `signal`, `options?`): `AsyncIterable`\<`AgentEnvironmentEvent`\>

Defined in: src/runtime/environment-lineage.ts:55

Stream one environment turn through SSE or polling.

#### Parameters

##### streaming

`"sse"` \| `"poll"`

##### environment

`AgentEnvironment`

##### prompt

`string`

##### sessionId

`string`

##### signal

`AbortSignal`

##### options?

`TurnOptions`

#### Returns

`AsyncIterable`\<`AgentEnvironmentEvent`\>

***

### createEnvironmentLineage()

> **createEnvironmentLineage**(`provider`, `capabilities`, `options?`): [`EnvironmentLineage`](#environmentlineage)

Defined in: src/runtime/environment-lineage.ts:106

Create, fork, resume, and prune related agent environments.

#### Parameters

##### provider

`AgentEnvironmentProvider`

##### capabilities

`AgentEnvironmentCapabilities`

##### options?

###### maxConcurrency?

`number`

###### streaming?

`"sse"` \| `"poll"`

###### recordMount?

[`MountRecorder`](#mountrecorder)

#### Returns

[`EnvironmentLineage`](#environmentlineage)

***

### openEnvironmentRun()

> **openEnvironmentRun**\<`Output`\>(`options`): `Promise`\<[`EnvironmentRun`](#environmentrun)\<`Output`\>\>

Defined in: src/runtime/environment-run.ts:94

Open one persistent environment, run its first turn, and resume the same
provider session on later turns.

#### Type Parameters

##### Output

`Output`

#### Parameters

##### options

[`OpenEnvironmentRunOptions`](#openenvironmentrunoptions)\<`Output`\>

#### Returns

`Promise`\<[`EnvironmentRun`](#environmentrun)\<`Output`\>\>

***

### harvestCorpus()

> **harvestCorpus**(`opts`): `Promise`\<[`HarvestReport`](#harvestreport)\>

Defined in: src/runtime/harvest-corpus.ts:63

Batch the firewalled `observe()` analyst over completed runs and accrete the trace-derived facts into the durable corpus — the production-traces→corpus write side of the flywheel.

#### Parameters

##### opts

[`HarvestCorpusOptions`](#harvestcorpusoptions)

#### Returns

`Promise`\<[`HarvestReport`](#harvestreport)\>

***

### inProcessEnvironmentProvider()

> **inProcessEnvironmentProvider**(`options`): `AgentEnvironmentProvider`

Defined in: src/runtime/in-process-environment-provider.ts:69

Create a deterministic provider backed by one callback.

Each environment owns its turn counter and optional temporary workspace.
Named profiles fail because this provider has no profile catalog.
Callbacks and commands run on the current host without isolation.

#### Parameters

##### options

[`InProcessEnvironmentProviderOptions`](#inprocessenvironmentprovideroptions)

#### Returns

`AgentEnvironmentProvider`

***

### inlineEnvironmentProvider()

> **inlineEnvironmentProvider**(`factory`, `options?`): `AgentEnvironmentProvider`

Defined in: src/runtime/inline-environment-provider.ts:31

Adapt an executor factory into an environment provider.

One executor is created per turn and always torn down after it settles.

#### Parameters

##### factory

[`ExecutorFactory`](#executorfactory)\<`unknown`\>

##### options?

[`InlineEnvironmentProviderOptions`](#inlineenvironmentprovideroptions) = `{}`

#### Returns

`AgentEnvironmentProvider`

***

### envKeyProvider()

> **envKeyProvider**(`env?`): [`KeyProvider`](#keyprovider)

Defined in: src/runtime/key-provider.ts:43

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

Defined in: src/runtime/key-provider.ts:59

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

Defined in: src/runtime/key-provider.ts:87

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

### localEnvironmentProvider()

> **localEnvironmentProvider**(`options`): `AgentEnvironmentProvider`

Defined in: src/runtime/local-environment-provider.ts:48

Run trusted stdio MCP tools and a router model on the current host.

This provider offers no process isolation. A policy that permits local MCP
requires an exact constructor-time profile; different profile bytes fail.

#### Parameters

##### options

[`LocalEnvironmentProviderOptions`](#localenvironmentprovideroptions)

#### Returns

`AgentEnvironmentProvider`

***

### loopCampaignDispatch()

> **loopCampaignDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `DispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: src/runtime/loop-dispatch.ts:202

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

Defined in: src/runtime/loop-dispatch.ts:225

Adapter for `runProfileMatrix` (profile is an axis). Returns a
`ProfileDispatchFn` that runs `runAgentRounds` per (profile, scenario) cell and
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

Defined in: src/runtime/mcp-environment.ts:83

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

> **createMcpEnvironment**(`opts`): [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/mcp-environment.ts:97

Wrap any MCP server as an `Environment`: `tools/list` becomes `EnvironmentTool[]` with provider-safe schemas; the domain supplies only the artifact lifecycle hooks.

#### Parameters

##### opts

[`McpEnvironmentOptions`](#mcpenvironmentoptions)

#### Returns

[`TaskEnvironment`](#taskenvironment)

***

### observe()

> **observe**(`input`, `opts`): `Promise`\<[`Observation`](#observation)\>

Defined in: src/runtime/observe.ts:137

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

Defined in: src/runtime/observe.ts:224

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

Defined in: src/runtime/personify/analyst.ts:97

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

[`Scope`](#scope-1)\<`Outcome`\<`D`\>\>

##### options

[`CreateScopeAnalystOptions`](#createscopeanalystoptions)\<`D`\>

#### Returns

[`ScopeAnalyst`](#scopeanalyst)\<`D`\>

***

### registryScopeAnalyst()

> **registryScopeAnalyst**\<`D`\>(`registry`, `buildInputs`): [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: src/runtime/personify/analyst.ts:203

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

Defined in: src/runtime/personify/analyst.ts:231

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

readonly [`Settled`](#settled-2)\<`Outcome`\<`D`\>\>[]

#### Returns

[`SteerContext`](#steercontext)\<`D`\>

***

### renderCorpusToInstructions()

> **renderCorpusToInstructions**(`opts`): `Promise`\<`AgentProfile`\>

Defined in: src/runtime/personify/corpus.ts:302

Queries the corpus through `filter`, renders the matching facts
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

### trajectoryReport()

> **trajectoryReport**(`journal`, `blobs`, `root`, `options?`): `Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

Defined in: src/runtime/personify/trajectory.ts:53

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

Defined in: src/runtime/personify/trajectory.ts:154

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

Defined in: src/runtime/promotion-gate.ts:64

Statistical promotion decision over a holdout benchmark: a seeded paired bootstrap (`heldoutSignificance`) whose CI lower bound must clear `deltaThreshold`.

#### Parameters

##### opts

[`PromotionGateOptions`](#promotiongateoptions)

#### Returns

[`PromotionVerdict`](#promotionverdict)

***

### reportLoopUsage()

> **reportLoopUsage**\<`Task`, `Output`, `Decision`\>(`cost`, `result`, `source?`): `void`

Defined in: src/runtime/report-usage.ts:34

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

### routerChatWithUsage()

> **routerChatWithUsage**(`cfg`, `messages`, `opts?`): `Promise`\<[`RouterChatResult`](#routerchatresult)\>

Defined in: src/runtime/router-client.ts:49

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

Defined in: src/runtime/router-client.ts:187

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

`"none"` \| `"auto"` \| `"required"`

###### maxTokens?

`number`

#### Returns

`Promise`\<[`RouterChatToolsResult`](#routerchattoolsresult)\>

***

### routerToolLoop()

> **routerToolLoop**(`cfg`, `system`, `user`, `tools`, `execute`, `opts?`): `Promise`\<[`RouterToolLoopResult`](#routertoolloopresult)\>

Defined in: src/runtime/router-client.ts:285

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

Defined in: src/runtime/router-client.ts:327

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

### routerEnvironmentProvider()

> **routerEnvironmentProvider**(`options`): `AgentEnvironmentProvider`

Defined in: src/runtime/router-environment-provider.ts:18

Run profiles through an OpenAI-compatible router on the current process.

#### Parameters

##### options

[`RouterEnvironmentProviderOptions`](#routerenvironmentprovideroptions)

#### Returns

`AgentEnvironmentProvider`

***

### runBenchmark()

> **runBenchmark**(`cfg`): `Promise`\<[`BenchmarkReport`](#benchmarkreport)\>

Defined in: src/runtime/run-benchmark.ts:212

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

Defined in: src/runtime/run-benchmark.ts:313

Pretty-print a report — the "free optimization" verdict, with the cost vector.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

#### Returns

`void`

***

### runAgentRounds()

> **runAgentRounds**\<`Task`, `Output`, `Decision`\>(`options`): `Promise`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>\>

Defined in: src/runtime/run-loop.ts:133

**`Experimental`**

The round-synchronous MULTI-AGENT kernel: each round `driver.plan()` fans N tasks
out to N environments (bounded concurrency), parses + validates each output, and folds
the round's results through `driver.decide` — fanout → validate → vote/select →
refine, repeated until the driver says stop. One call spans many agent sessions.

Not to be confused with `runToolLoop` / `streamToolLoop` (package root entry): those
run ONE chat turn against ONE model, dispatching the tool calls that turn emits and
folding the results back in until the model stops calling tools. No environments, no
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

`Promise`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>\>

***

### defaultSelectWinner()

> **defaultSelectWinner**\<`Task`, `Output`\>(`iterations`): [`LoopWinner`](#loopwinner)\<`Task`, `Output`\> \| `undefined`

Defined in: src/runtime/run-loop.ts:1038

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

### connectStdioMcp()

> **connectStdioMcp**(`spec`): `Promise`\<[`StdioMcpConnection`](#stdiomcpconnection)\>

Defined in: src/runtime/stdio-mcp-client.ts:118

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

Defined in: src/runtime/stdio-mcp-client.ts:328

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

> **naiveDriver**\<`Task`, `Output`\>(`options`): [`Driver`](#driver-2)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

Defined in: src/runtime/steering-drivers.ts:109

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

[`Driver`](#driver-2)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

***

### dumbDriver()

> **dumbDriver**\<`Task`, `Output`\>(`options`): [`Driver`](#driver-2)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

Defined in: src/runtime/steering-drivers.ts:168

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

[`Driver`](#driver-2)\<`Task`, `Output`, [`SteeringDecision`](#steeringdecision)\>

***

### assertStrategyContract()

> **assertStrategyContract**(`code`): `void`

Defined in: src/runtime/strategy-author.ts:115

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

Defined in: src/runtime/strategy-author.ts:182

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

Defined in: src/runtime/strategy-evolution.ts:247

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

Defined in: src/runtime/strategy-evolution.ts:272

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

Defined in: src/runtime/strategy-evolution.ts:295

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

Defined in: src/runtime/strategy-evolution.ts:375

Multi-generation strategy search: author candidates from tournament losses, play them against the incumbent at equal budget, promote via `promotionGate` on an untouched holdout slice.

#### Parameters

##### cfg

[`StrategyEvolutionConfig`](#strategyevolutionconfig)

#### Returns

`Promise`\<[`EvolutionReport`](#evolutionreport)\>

***

### depthStrategy()

> **depthStrategy**(`surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

Defined in: src/runtime/strategy.ts:629

DEPTH: one persistent artifact, carried across analyst-steered shots.

#### Parameters

##### surface

[`TaskEnvironment`](#taskenvironment)

##### task

[`EnvironmentTask`](#environmenttask)

##### opts

[`StrategyWorkerOptions`](#strategyworkeroptions)

##### cfg

###### maxShots

`number`

#### Returns

[`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

***

### breadthStrategy()

> **breadthStrategy**(`_surface`, `task`, `opts`, `cfg`): [`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

Defined in: src/runtime/strategy.ts:700

BREADTH: K independent rollouts (each own artifact), verifier picks the best.

#### Parameters

##### \_surface

[`TaskEnvironment`](#taskenvironment)

##### task

[`EnvironmentTask`](#environmenttask)

##### opts

[`StrategyWorkerOptions`](#strategyworkeroptions)

##### cfg

###### width

`number`

#### Returns

[`Agent`](#agent-1)\<`unknown`, `Outcome`\<`unknown`\>\>

***

### defineStrategy()

> **defineStrategy**\<`Result`\>(`name`, `run`): [`Strategy`](#strategy-3)\<`Result`\>

Defined in: src/runtime/strategy.ts:851

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

### runStrategy()

> **runStrategy**\<`Result`\>(`opts`): `Promise`\<[`StrategyRunResult`](#strategyrunresult) & `Result`\>

Defined in: src/runtime/strategy.ts:1093

Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope.

#### Type Parameters

##### Result

`Result` *extends* [`StrategyResult`](#strategyresult-1) = [`StrategyResult`](#strategyresult-1)

#### Parameters

##### opts

[`RunStrategyOptions`](#runstrategyoptions)\<`Result`\>

#### Returns

`Promise`\<[`StrategyRunResult`](#strategyrunresult) & `Result`\>

***

### streamAgentTurn()

> **streamAgentTurn**(`target`, `prompt`, `opts?`): `AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

Defined in: src/runtime/stream-agent-turn.ts:141

**`Experimental`**

Run one agent turn and stream its events. Yields the
`RuntimeStreamEvent` vocabulary incrementally and always ends with a `final`
event carrying the turn's text and usage (`metadata.tokenUsage`,
`metadata.costUsd?`, `metadata.model?`) — on success, failure, abort, and
timeout alike. The generator never throws; failures surface in-band as
`turn_error` followed by `final`.

#### Parameters

##### target

[`AgentTurnTarget`](#agentturntarget)

##### prompt

`string`

##### opts?

[`StreamAgentTurnOptions`](#streamagentturnoptions) = `{}`

#### Returns

`AsyncGenerator`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

***

### collectAgentTurn()

> **collectAgentTurn**(`stream`): `Promise`\<[`CollectedAgentTurn`](#collectedagentturn)\>

Defined in: src/runtime/stream-agent-turn.ts:205

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

Defined in: src/runtime/structural-rollout.ts:122

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

Defined in: src/runtime/structural-rollout.ts:146

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

Defined in: src/runtime/structural-rollout.ts:164

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

Defined in: src/runtime/structural-rollout.ts:178

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

Defined in: src/runtime/structural-rollout.ts:191

The symbol authored checks are pinned to: `task.meta.entryPoint` when the surface
 provides it, else the LAST `def name(` in the visible prompt (a code-completion stub
 lists helpers first, the entry stub last). Undefined ⇒ authoring is skipped.

#### Parameters

##### task

[`EnvironmentTask`](#environmenttask)

#### Returns

`string` \| `undefined`

***

### sandboxCheckRunner()

> **sandboxCheckRunner**(`options?`): [`CheckRunner`](#checkrunner)

Defined in: src/runtime/structural-rollout.ts:276

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

Defined in: src/runtime/structural-rollout.ts:344

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

Defined in: src/runtime/structural-rollout.ts:357

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

Defined in: src/runtime/structural-rollout.ts:364

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

Defined in: src/runtime/structural-rollout.ts:379

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

Defined in: src/runtime/structural-rollout.ts:400

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

> **structuralRollout**(`config?`): [`Strategy`](#strategy-3)\<[`StructuralRolloutResult`](#structuralrolloutresult)\>

Defined in: src/runtime/structural-rollout.ts:524

Build the structuralRollout `Strategy`: k shots → score each by the frozen visible
checks (official above authored, crash lowest) → argmax with first-index tie-break →
up to `repairRounds` repair shots steered by the failure output, keep-best under the
official-check guard. Authored via `defineStrategy`, so the deliverable score stays
harness-verified and every shot is metered by the conserved pool.

Budget note: `runStrategy`'s `budget` sizes the pool — pass at least
`k + repairRounds + 1` so the samples, repairs, and the check-author consult all admit.

#### Parameters

##### config?

[`StructuralRolloutConfig`](#structuralrolloutconfig) = `{}`

#### Returns

[`Strategy`](#strategy-3)\<[`StructuralRolloutResult`](#structuralrolloutresult)\>

***

### failuresAnalyst()

> **failuresAnalyst**(): [`AnalystRegistry`](#analystregistry)

Defined in: src/runtime/supervise-surface.ts:76

The default self-improvement LENS — authored content, not a code path. On each settled worker it hands
 the driver the still-FAILING tests (not just a score), so the next spawn targets the persistently-hard
 cases. Swap `analysts` to change what the driver improves from — that's the one knob.

#### Returns

[`AnalystRegistry`](#analystregistry)

***

### superviseSurface()

> **superviseSurface**(`profile`, `task`, `opts`): `Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

Defined in: src/runtime/supervise-surface.ts:205

Drive a team of agents (spawned + steered by `profile`) to solve a graded `TaskEnvironment` task, and
 report the deployable outcome + the full conserved spend. This is `supervise()` configured for surfaces
 — there is no other entrypoint to learn.

#### Parameters

##### profile

[`SupervisorProfile`](#supervisorprofile)

##### task

[`EnvironmentTask`](#environmenttask)

##### opts

[`SuperviseSurfaceOptions`](#supervisesurfaceoptions)

#### Returns

`Promise`\<[`SuperviseSurfaceResult`](#supervisesurfaceresult)\>

***

### asAuthoredProfile()

> **asAuthoredProfile**(`raw`): [`AuthoredProfile`](#authoredprofile) \| `null`

Defined in: src/runtime/supervise/authoring.ts:35

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

Defined in: src/runtime/supervise/authoring.ts:47

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

Defined in: src/runtime/supervise/authoring.ts:67

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

Defined in: src/runtime/supervise/authoring.ts:182

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

Defined in: src/runtime/supervise/authoring.ts:245

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

Defined in: src/runtime/supervise/budget.ts:93

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

Defined in: src/runtime/supervise/budget.ts:136

Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
absolute deadline is fixed at construction (`now() + budget.deadlineMs`) so the
readout's `deadlineMs` is a stable wall-clock instant, not a shrinking remainder.

#### Parameters

##### root

[`Budget`](#budget-10)

##### now?

() => `number`

#### Returns

[`BudgetPool`](#budgetpool)

***

### gateOnDeliverable()

> **gateOnDeliverable**\<`Out`\>(`inner`, `deliverable`): [`Executor`](#executor)\<`Out`\>

Defined in: src/runtime/supervise/completion-gate.ts:45

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

Defined in: src/runtime/supervise/coordination-driver.ts:229

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

Defined in: src/runtime/supervise/coordination-driver.ts:471

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

Defined in: src/runtime/supervise/coordination-mcp.ts:56

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

[`Budget`](#budget-10)

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

###### watchWorkers?

`WorkerWatchOptions`

Run the ONLINE detector panel over each worker's live tool trace (raises `finding` events).

###### stallAfterMs?

`number`

Idle time after which `observe_agent` reports a worker as stalled.

###### onEvent?

(`event`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every bus event (settled / question / finding).

###### questionPolicy?

[`QuestionPolicy`](mcp.md#questionpolicy)

#### Returns

`Promise`\<[`CoordinationMcpHandle`](#coordinationmcphandle)\>

***

### delegate()

> **delegate**\<`Out`\>(`intent`, `opts`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

Defined in: src/runtime/supervise/delegate.ts:86

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

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

***

### defaultToolDetectors()

> **defaultToolDetectors**(): `StreamingDetector`[]

Defined in: src/runtime/supervise/detector-monitor.ts:38

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

Defined in: src/runtime/supervise/detector-monitor.ts:44

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

Defined in: src/runtime/supervise/dispatch.ts:114

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

Defined in: src/runtime/supervise/dispatch.ts:189

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

Defined in: src/runtime/supervise/dispatch.ts:217

The ONE honest effective limit on simultaneous workers: the minimum of the caps that actually
bound the worker layer. Ignores unset/non-positive caps; returns `undefined` when no cap applies
(uncapped — the conserved pool remains the only fence).

Deliberately does not include `EnvironmentLineage` fork concurrency. It
limits environments inside one leaf's fork wave, not supervisor workers.
Including it would report a four-worker limit for what is
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

Defined in: src/runtime/supervise/dispatch.ts:227

Convenience: a `DispatchUnit` factory over a fixed array of tasks, for the common case where
 the queue is known up front and only the refill behavior is wanted.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### units

readonly `object`[]

##### budget

[`Budget`](#budget-10)

#### Returns

() => [`DispatchUnit`](#dispatchunit)\<`Out`\> \| `undefined`

***

### createSteerableEnvironmentSession()

> **createSteerableEnvironmentSession**(`args`): [`SteerableEnvironmentSession`](#steerableenvironmentsession)

Defined in: src/runtime/supervise/environment-session.ts:71

One steerable environment worker. The session starts when `stream()` is drained.

#### Parameters

##### args

[`SteerableEnvironmentArgs`](#steerableenvironmentargs)

#### Returns

[`SteerableEnvironmentSession`](#steerableenvironmentsession)

***

### assertSteerableEnvironmentProvider()

> **assertSteerableEnvironmentProvider**(`provider`): `void`

Defined in: src/runtime/supervise/environment-session.ts:339

Assert that supervision received a provider capable of creating environments.

#### Parameters

##### provider

`AgentEnvironmentProvider` \| `undefined`

#### Returns

`void`

***

### createEventBus()

> **createEventBus**\<`E`\>(`now?`): [`EventBus`](#eventbus)\<`E`\>

Defined in: src/runtime/supervise/event-bus.ts:76

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

> **createInbox**(): [`Inbox`](#inbox-1)

Defined in: src/runtime/supervise/inbox.ts:57

Create the worker-side inbox for the down-leg: the driver's `steer_agent` / `answer_question` messages queue here and the worker's loop drains them at step boundaries and before settle.

#### Returns

[`Inbox`](#inbox-1)

***

### assertModelAllowed()

> **assertModelAllowed**(`model`, `allowed`): `void`

Defined in: src/runtime/supervise/model-policy.ts:14

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

Defined in: src/runtime/supervise/patch-deliverable.ts:45

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

### createActivityLog()

> **createActivityLog**(`limit?`): [`ActivityLog`](#activitylog)

Defined in: src/runtime/supervise/progress.ts:92

Create a bounded activity ring. `limit` caps memory for a worker that runs thousands of tools.

#### Parameters

##### limit?

`number` = `12`

#### Returns

[`ActivityLog`](#activitylog)

***

### readWorkerProgress()

> **readWorkerProgress**(`scope`, `executor`, `now`, `stallAfterMs?`): [`WorkerProgress`](#workerprogress)

Defined in: src/runtime/supervise/progress.ts:120

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

### createInMemoryRunContext()

> **createInMemoryRunContext**(`opts?`): [`InMemoryRunContext`](#inmemoryruncontext)

Defined in: src/runtime/supervise/run-context.ts:72

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

Defined in: src/runtime/supervise/run-context.ts:94

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

### createScope()

> **createScope**\<`Out`\>(`args`): [`Scope`](#scope-1)\<`Out`\>

Defined in: src/runtime/supervise/scope.ts:251

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

Defined in: src/runtime/supervise/scope.ts:1028

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

[`Settled`](#settled-2)\<`Out`\>

#### Returns

[`Iteration`](#iteration-1)\<`unknown`, `Out`\>

***

### createProgressTracker()

> **createProgressTracker**(`opts?`): [`ProgressTracker`](#progresstracker)

Defined in: src/runtime/supervise/stop-rules.ts:131

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

Defined in: src/runtime/supervise/stop-rules.ts:208

Build a `ProgressSample` from a scope settlement. The objective is the verdict score and
 `delivered` is the verdict's `valid` — the SAME single delivery signal `finalizeBestDelivered`
 and `defaultSelectWinner` use, so "progress" and "winner" cannot disagree.

#### Parameters

##### settled

[`Settled`](#settled-2)\<`unknown`\>

##### at

`number`

#### Returns

[`ProgressSample`](#progresssample)

***

### noProgressFor()

> **noProgressFor**(`opts`): [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/stop-rules.ts:243

"Nothing new has happened." Fires when the run has produced no new settled work for `ms`, or no
IMPROVEMENT over the last `settles` settlements.

A tree whose only remaining nodes are armed WAITS is exempt from the time bound: a run waiting
on CI is not a run that stopped making progress, and killing it there would defeat mechanic C.

#### Parameters

##### opts

[`NoProgressForOptions`](#noprogressforoptions)

#### Returns

[`StopRule`](#stoprule-1)

***

### plateau()

> **plateau**(`opts`): [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/stop-rules.ts:295

"The objective has stopped climbing." Fires when the best-so-far curve has risen by no more than
`minDelta` across the last `window` settlements.

Built on `anytime.plateauLength` — the same plateau math the post-run anytime report uses, so a
rule that stops a run and a report that grades the decision cannot disagree about whether the
run was flat.

#### Parameters

##### opts

[`PlateauOptions`](#plateauoptions)

#### Returns

[`StopRule`](#stoprule-1)

***

### allWorkersStalled()

> **allWorkersStalled**(`opts?`): [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/stop-rules.ts:332

"Everyone is stuck." Fires when every live worker reads `stalled` — no metered activity for
longer than the stall threshold — and none of the tree is merely waiting.

`stalled` is a derived read at observation time, never a background watchdog; this rule only
reads it. A tree with armed waits never fires: waiting is not stalling.

#### Parameters

##### opts?

[`AllWorkersStalledOptions`](#allworkersstalledoptions) = `{}`

#### Returns

[`StopRule`](#stoprule-1)

***

### anyOf()

> **anyOf**(...`rules`): [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/stop-rules.ts:347

Stop when ANY rule stops — the ordinary composition (each rule is a separate reason to end).

#### Parameters

##### rules

...readonly [`StopRule`](#stoprule-1)[]

#### Returns

[`StopRule`](#stoprule-1)

***

### allOf()

> **allOf**(...`rules`): [`StopRule`](#stoprule-1)

Defined in: src/runtime/supervise/stop-rules.ts:358

Stop only when EVERY rule stops — for a conservative gate that needs corroboration.

#### Parameters

##### rules

...readonly [`StopRule`](#stoprule-1)[]

#### Returns

[`StopRule`](#stoprule-1)

***

### workerFromEnvironment()

> **workerFromEnvironment**(`options`, `deliverable?`): [`MakeWorkerAgent`](#makeworkeragent)

Defined in: src/runtime/supervise/supervise.ts:35

Build workers from the environment provider used for each spawned profile.

#### Parameters

##### options

[`EnvironmentWorkerOptions`](#environmentworkeroptions)

##### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

#### Returns

[`MakeWorkerAgent`](#makeworkeragent)

***

### workerFromExecutor()

> **workerFromExecutor**(`create`, `deliverable?`): [`MakeWorkerAgent`](#makeworkeragent)

Defined in: src/runtime/supervise/supervise.ts:47

Build workers from a custom executor factory.

#### Parameters

##### create

(`profile`, `context`) => [`Executor`](#executor)\<`unknown`\>

##### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

#### Returns

[`MakeWorkerAgent`](#makeworkeragent)

***

### supervise()

> **supervise**(`profile`, `task`, `opts`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

Defined in: src/runtime/supervise/supervise.ts:187

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

Defined in: src/runtime/supervise/supervisor-agent.ts:126

Build a supervisor `Agent` from its profile.

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

Defined in: src/runtime/supervise/supervisor.ts:90

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

Defined in: src/runtime/supervise/trace-source.ts:147

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

Defined in: src/runtime/supervise/trace-source.ts:172

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

`ToolStepInput`

###### Returns

`ToolSpan`

***

### sandboxSessionTraceSource()

> **sandboxSessionTraceSource**(`box`, `sessionId`, `opts?`): [`TraceSource`](#tracesource-1)

Defined in: src/runtime/supervise/trace-source.ts:287

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

Defined in: src/runtime/supervise/trajectory-recorder.ts:28

Collect the source's spans and run the agent-eval batch analyzers over them under one `runId`.

#### Parameters

##### source

[`TraceSource`](#tracesource-1)

##### runId?

`string` = `'worker'`

#### Returns

`Promise`\<[`TrajectoryAnalysis`](#trajectoryanalysis)\>

***

### timerAt()

> **timerAt**(`ms`, `now`): [`WaitSpec`](#waitspec)

Defined in: src/runtime/supervise/wait.ts:74

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

Defined in: src/runtime/supervise/wait.ts:79

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

Defined in: src/runtime/supervise/wait.ts:115

Registry over a plain name→predicate record.

#### Parameters

##### entries

`Record`\<`string`, [`WaitProbe`](#waitprobe)\>

#### Returns

[`WaitProbeRegistry`](#waitproberegistry)

***

### isWaitOutcome()

> **isWaitOutcome**(`value`): `value is WaitOutcome`

Defined in: src/runtime/supervise/wait.ts:147

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

Defined in: src/runtime/supervise/wait.ts:170

The absolute instant a spec is bounded by, or `undefined` for an unbounded poll.

#### Parameters

##### spec

[`WaitSpec`](#waitspec)

#### Returns

`number` \| `undefined`

***

### validateWaitSpec()

> **validateWaitSpec**(`spec`): `string` \| `null`

Defined in: src/runtime/supervise/wait.ts:175

Structural validation, independent of the run. Returns null when the spec is usable.

#### Parameters

##### spec

[`WaitSpec`](#waitspec)

#### Returns

`string` \| `null`

***

### createWorktreeCliExecutor()

> **createWorktreeCliExecutor**(`options`): [`Executor`](#executor)\<`WorktreeHarnessResult`\>

Defined in: src/runtime/supervise/worktree-cli-executor.ts:107

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

### createVerifierEnvironment()

> **createVerifierEnvironment**(`opts`): [`TaskEnvironment`](#taskenvironment)

Defined in: src/runtime/verifier-environment.ts:68

Any checkable task as an `Environment`, no tool surface required: the artifact is the worker's answer and the domain is one deployable `check` over it.

#### Parameters

##### opts

[`VerifierEnvironmentOptions`](#verifierenvironmentoptions)

#### Returns

[`TaskEnvironment`](#taskenvironment)

***

### createWaterfallCollector()

> **createWaterfallCollector**(): [`WaterfallCollector`](#waterfallcollector)

Defined in: src/runtime/waterfall.ts:59

Build a `WaterfallCollector` that records agent spans and renders them as an ASCII timeline.

#### Returns

[`WaterfallCollector`](#waterfallcollector)

***

### localShell()

> **localShell**(): [`Shell`](#shell)

Defined in: src/runtime/workspace.ts:19

Host-process `Shell`: run a command via `execFile`, resolving `{ stdout, stderr, code }` (never throws on non-zero exit).

#### Returns

[`Shell`](#shell)

***

### gitWorkspace()

> **gitWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: src/runtime/workspace.ts:48

A `Workspace` over a git checkout: materialize an isolated worktree at `ref`, commit produced changes (conflict-aware), and read `head` — hooks disabled, identity pinned.

#### Parameters

##### opts

[`GitWorkspaceOptions`](#gitworkspaceoptions)

#### Returns

[`Workspace`](#workspace)

***

### jjWorkspace()

> **jjWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: src/runtime/workspace.ts:92

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

Defined in: src/runtime/workspace.ts:151

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

### resolveAgentEnvironmentProvider

Re-exports [resolveAgentEnvironmentProvider](runtime/environment-provider.md#resolveagentenvironmentprovider)
