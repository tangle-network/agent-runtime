[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / runtime

# runtime

## Classes

### InMemoryResultBlobStore

Defined in: [durable/spawn-journal.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L69)

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

Defined in: [durable/spawn-journal.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L72)

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`put`](#put-1)

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: [durable/spawn-journal.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L77)

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

###### Implementation of

[`ResultBlobStore`](#resultblobstore).[`get`](#get-1)

***

### InMemorySpawnJournal

Defined in: [durable/spawn-journal.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L139)

In-memory `SpawnJournal`. Appends are observed-committed only; the impl enforces
the corruption guards a durable replay rests on:
 - an event before `beginTree` is a corrupted tree (fail loud),
 - a duplicate `seq` within a tree is a corrupted cursor (fail loud) — two
   settlements cannot share the cursor position replay orders by.

#### Implements

- `SpawnJournal`

#### Constructors

##### Constructor

> **new InMemorySpawnJournal**(): [`InMemorySpawnJournal`](#inmemoryspawnjournal)

###### Returns

[`InMemorySpawnJournal`](#inmemoryspawnjournal)

#### Methods

##### loadTree()

> **loadTree**(`root`): `Promise`\<`SpawnEvent`[] \| `undefined`\>

Defined in: [durable/spawn-journal.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L142)

###### Parameters

###### root

`string`

###### Returns

`Promise`\<`SpawnEvent`[] \| `undefined`\>

###### Implementation of

`SpawnJournal.loadTree`

##### beginTree()

> **beginTree**(`root`, `at`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L148)

###### Parameters

###### root

`string`

###### at

`string`

###### Returns

`Promise`\<`void`\>

###### Implementation of

`SpawnJournal.beginTree`

##### appendEvent()

> **appendEvent**(`root`, `ev`): `Promise`\<`void`\>

Defined in: [durable/spawn-journal.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L161)

###### Parameters

###### root

`string`

###### ev

`SpawnEvent`

###### Returns

`Promise`\<`void`\>

###### Implementation of

`SpawnJournal.appendEvent`

***

### InMemoryCorpus

Defined in: [runtime/personify/corpus.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L161)

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

Defined in: [runtime/personify/corpus.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L164)

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

Defined in: [runtime/personify/corpus.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L186)

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

Defined in: [runtime/personify/corpus.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L202)

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

Defined in: [runtime/personify/corpus.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L203)

###### Parameters

###### path

`string`

###### Returns

[`FileCorpus`](#filecorpus)

#### Methods

##### append()

> **append**(`record`): `Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Defined in: [runtime/personify/corpus.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L205)

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

Defined in: [runtime/personify/corpus.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L233)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

###### Implementation of

[`Corpus`](#corpus-2).[`query`](#query-2)

## Interfaces

### WorktreeCommandResult

Defined in: [mcp/worktree-harness.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L39)

Outcome of one verification command run in the worktree (test or typecheck).

#### Properties

##### command

> **command**: `string`

Defined in: [mcp/worktree-harness.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L41)

The shell command line that was run.

##### passed

> **passed**: `boolean`

Defined in: [mcp/worktree-harness.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L43)

Did the command exit 0? The PASS signal a deliverable gate / coder output reads.

##### exitCode

> **exitCode**: `number` \| `null`

Defined in: [mcp/worktree-harness.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L45)

OS exit code, or `null` when killed before exit.

##### output

> **output**: `string`

Defined in: [mcp/worktree-harness.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/worktree-harness.ts#L47)

Combined stdout+stderr (capped) — surfaced in traces for diagnosis.

***

### AnytimeTaskCurve

Defined in: [runtime/anytime.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L25)

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [runtime/anytime.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L26)

##### strategy

> **strategy**: `string`

Defined in: [runtime/anytime.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L27)

##### points

> **points**: `object`[]

Defined in: [runtime/anytime.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L30)

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

Defined in: [runtime/anytime.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L33)

Per satisficing target (keyed by the target value as a string): the first point
 where best ≥ target, or null when never reached within budget.

***

### AnytimeStrategySummary

Defined in: [runtime/anytime.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L36)

#### Properties

##### strategy

> **strategy**: `string`

Defined in: [runtime/anytime.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L37)

##### target

> **target**: `number`

Defined in: [runtime/anytime.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L39)

The satisficing target this row summarizes.

##### tasks

> **tasks**: `number`

Defined in: [runtime/anytime.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L40)

##### reachedTarget

> **reachedTarget**: `number`

Defined in: [runtime/anytime.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L41)

##### medianTttMs

> **medianTttMs**: `number` \| `null`

Defined in: [runtime/anytime.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L43)

Median time-to-target over the tasks that reached it (null when none did).

##### medianShotsToTarget

> **medianShotsToTarget**: `number` \| `null`

Defined in: [runtime/anytime.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L44)

##### ertMs

> **ertMs**: `number` \| `null`

Defined in: [runtime/anytime.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L46)

COCO ERT: Σ all task wall-time (incl. failures) / #successes. Null when 0 succeed.

##### erUsd

> **erUsd**: `number` \| `null`

Defined in: [runtime/anytime.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L48)

Same construction over dollars: Σ all spend / #successes.

##### curveByShot

> **curveByShot**: `number`[]

Defined in: [runtime/anytime.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L50)

Mean best-so-far score by shot index (the anytime curve, averaged over tasks).

##### auc

> **auc**: `number`

Defined in: [runtime/anytime.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L52)

Area under the per-shot anytime curve, normalized to [0,1].

***

### AnytimeReport

Defined in: [runtime/anytime.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L55)

#### Properties

##### targets

> **targets**: `number`[]

Defined in: [runtime/anytime.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L56)

##### perTask

> **perTask**: [`AnytimeTaskCurve`](#anytimetaskcurve)[]

Defined in: [runtime/anytime.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L57)

##### perStrategy

> **perStrategy**: [`AnytimeStrategySummary`](#anytimestrategysummary)[]

Defined in: [runtime/anytime.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L59)

One summary per (strategy, target) pair — the COCO-style multi-target view.

***

### AuditIntentInput

Defined in: [runtime/audit-intent.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L29)

#### Properties

##### declaredIntent

> **declaredIntent**: `string`

Defined in: [runtime/audit-intent.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L31)

The declared intent: the task text / acceptance criteria the agent was given.

##### trace

> **trace**: readonly `unknown`[]

Defined in: [runtime/audit-intent.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L33)

The trajectory so far — tool calls + results + assistant turns (any event shapes).

##### userIntent?

> `optional` **userIntent?**: `string`

Defined in: [runtime/audit-intent.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L35)

The principal's actual intent when it differs from the literal task (the contract).

##### metaIntent?

> `optional` **metaIntent?**: `string`

Defined in: [runtime/audit-intent.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L38)

The loop-level purpose (meta-intent): what the WHOLE run is for — lets the auditor
 flag locally-sensible work that serves the wrong larger objective.

##### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/audit-intent.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L39)

***

### AuditIntentOptions

Defined in: [runtime/audit-intent.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L42)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [runtime/audit-intent.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L43)

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/audit-intent.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L44)

##### auditorInstruction?

> `optional` **auditorInstruction?**: `string`

Defined in: [runtime/audit-intent.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L46)

Override the auditor instruction (optimizable like any analyst prompt).

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [runtime/audit-intent.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L48)

Cap trace lines fed to the auditor. Default 80.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/audit-intent.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L49)

***

### IntentAudit

Defined in: [runtime/audit-intent.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L52)

#### Properties

##### revealedIntent

> **revealedIntent**: `string`

Defined in: [runtime/audit-intent.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L54)

What the agent's actions reveal it is actually optimizing — one sentence.

##### verdict

> **verdict**: `"aligned"` \| `"drifting"` \| `"diverged"`

Defined in: [runtime/audit-intent.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L55)

##### evidence

> **evidence**: `string`

Defined in: [runtime/audit-intent.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L57)

Trajectory-grounded evidence for the verdict (specific calls/patterns).

##### recommendation

> **recommendation**: `"abort"` \| `"continue"` \| `"steer"`

Defined in: [runtime/audit-intent.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L59)

The single recommended intervention.

##### steer?

> `optional` **steer?**: `string`

Defined in: [runtime/audit-intent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L61)

When recommendation is 'steer': the corrective instruction to inject.

##### confidence

> **confidence**: `number`

Defined in: [runtime/audit-intent.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L62)

***

### CompletionEvidence

Defined in: [runtime/completion.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L29)

Trace-derived evidence for a completion claim — an artifact (output) or a verifier metric,
 never the judge's own verdict. Mirrors the steer-firewall's provenance discipline.

#### Properties

##### kind

> **kind**: `"artifact"` \| `"metric"`

Defined in: [runtime/completion.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L30)

##### uri

> **uri**: `string`

Defined in: [runtime/completion.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L31)

***

### CompletionVerdict

Defined in: [runtime/completion.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L35)

The "is it done?" verdict an analyst returns to the parent.

#### Properties

##### done

> **done**: `boolean`

Defined in: [runtime/completion.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L36)

##### determinism

> **determinism**: `"deterministic"` \| `"probabilistic"`

Defined in: [runtime/completion.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L38)

How verifiable the claim is — sets whether the driver trusts it or validates it.

##### reasons?

> `optional` **reasons?**: `string`

Defined in: [runtime/completion.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L40)

Why the analyst believes it is (or isn't) done — what the driver validates.

##### confidence?

> `optional` **confidence?**: `number`

Defined in: [runtime/completion.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L42)

0..1, for probabilistic verdicts; the driver's validation threshold reads this.

##### evidence?

> `optional` **evidence?**: readonly [`CompletionEvidence`](#completionevidence)[]

Defined in: [runtime/completion.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L43)

***

### CompletionAnalyst

Defined in: [runtime/completion.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L48)

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

Defined in: [runtime/completion.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L49)

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

Defined in: [runtime/completion.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L57)

When a verdict authorizes the driver to END. Deterministic → trust (ground truth);
 probabilistic → validate by confidence threshold (the driver's check).

#### Properties

##### minConfidence?

> `optional` **minConfidence?**: `number`

Defined in: [runtime/completion.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L59)

Minimum confidence a PROBABILISTIC verdict must clear to end. Default 0.8.

***

### HarvestCorpusOptions

Defined in: [runtime/harvest-corpus.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L28)

#### Properties

##### runs

> **runs**: `AsyncIterable`\<[`ObserveInput`](#observeinput), `any`, `any`\> \| `Iterable`\<[`ObserveInput`](#observeinput), `any`, `any`\>

Defined in: [runtime/harvest-corpus.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L30)

The completed runs to analyze — map your store's rows to `ObserveInput`.

##### chat

> **chat**: `ChatClient`

Defined in: [runtime/harvest-corpus.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L32)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/harvest-corpus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L33)

##### corpus

> **corpus**: [`Corpus`](#corpus-2)

Defined in: [runtime/harvest-corpus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L35)

The durable corpus the facts accrete into.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [runtime/harvest-corpus.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L37)

Tags written onto learned facts (the product/domain key the read side queries by).

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/harvest-corpus.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L39)

Override the analyst instruction (the GEPA-tunable knob).

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/harvest-corpus.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L41)

Runs analyzed in parallel. Default 4.

##### maxRuns?

> `optional` **maxRuns?**: `number`

Defined in: [runtime/harvest-corpus.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L43)

Hard cap on runs consumed from the stream (a cost guard for unbounded stores).

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/harvest-corpus.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L44)

***

### HarvestFailure

Defined in: [runtime/harvest-corpus.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L47)

#### Properties

##### runId

> **runId**: `string`

Defined in: [runtime/harvest-corpus.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L48)

##### error

> **error**: `string`

Defined in: [runtime/harvest-corpus.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L49)

***

### HarvestReport

Defined in: [runtime/harvest-corpus.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L52)

#### Properties

##### runsObserved

> **runsObserved**: `number`

Defined in: [runtime/harvest-corpus.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L53)

##### findings

> **findings**: `number`

Defined in: [runtime/harvest-corpus.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L55)

Total findings the analyst produced (including ones already known).

##### learned

> **learned**: `number`

Defined in: [runtime/harvest-corpus.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L57)

NEW facts actually appended (idempotent dedup excludes re-learned ones).

##### failures

> **failures**: [`HarvestFailure`](#harvestfailure)[]

Defined in: [runtime/harvest-corpus.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L59)

Per-run analysis failures — reported, never silently dropped.

***

### LoopDispatchOptions

Defined in: [runtime/loop-dispatch.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L49)

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

> **sandboxClient**: [`SandboxClient`](#sandboxclient-1)

Defined in: [runtime/loop-dispatch.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L57)

Sandbox client used for every cell's `runLoop`. Supplied once.

##### toLoopOptions

> **toLoopOptions**: (`scenario`, `profile`) => [`LoopOptionsForDispatch`](#loopoptionsfordispatch)\<`Task`, `Output`, `Decision`\>

Defined in: [runtime/loop-dispatch.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L60)

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

Defined in: [runtime/loop-dispatch.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L68)

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

Defined in: [runtime/loop-dispatch.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L71)

Forward `loop.*` trace events into the campaign's scoped trace so loop
 spans correlate with the cell. Default true.

##### costSource?

> `optional` **costSource?**: `string`

Defined in: [runtime/loop-dispatch.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L73)

Cost-meter source label for the loop's spend. Default `'loop'`.

***

### McpEndpoint

Defined in: [runtime/mcp-environment.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L25)

Where a handle's MCP server lives; headers carry per-artifact scoping.

#### Properties

##### url

> **url**: `string`

Defined in: [runtime/mcp-environment.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L26)

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

Defined in: [runtime/mcp-environment.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L27)

***

### McpEnvironmentOptions

Defined in: [runtime/mcp-environment.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L30)

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/mcp-environment.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L31)

##### maxResultChars?

> `optional` **maxResultChars?**: `number`

Defined in: [runtime/mcp-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L41)

Cap on a tool result's text fed back to the worker. Default 1500 chars.

#### Methods

##### open()

> **open**(`task`): `Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

Defined in: [runtime/mcp-environment.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L33)

Create/seed the per-task artifact; return its handle + the MCP endpoint scoped to it.

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<\{ `handle`: [`ArtifactHandle`](#artifacthandle); `endpoint`: [`McpEndpoint`](#mcpendpoint); \}\>

##### score()

> **score**(`task`, `handle`): `Promise`\<[`SurfaceScore`](#surfacescore)\>

Defined in: [runtime/mcp-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L35)

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

Defined in: [runtime/mcp-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L37)

Teardown (delete the seeded artifact). Optional — omit for stateless servers.

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

##### selectTools()?

> `optional` **selectTools**(`task`, `all`): [`AgenticTool`](#agentictool)[]

Defined in: [runtime/mcp-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L39)

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

Defined in: [runtime/observe.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L23)

#### Properties

##### task

> **task**: `string`

Defined in: [runtime/observe.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L25)

What the worker was asked to do.

##### output

> **output**: `string`

Defined in: [runtime/observe.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L27)

What it produced (its final answer / artifact summary).

##### trace

> **trace**: readonly `unknown`[]

Defined in: [runtime/observe.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L29)

The worker's trace — any event array (sandbox events, tool-call records).

##### outcome?

> `optional` **outcome?**: `"failed"` \| `"passed"` \| `"unknown"`

Defined in: [runtime/observe.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L32)

Terminal status only (passed/failed/unknown) — NOT a judge score; the
 observer never reads the verdict, it reads behavior.

##### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/observe.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L34)

Provenance back to the run.

***

### ObserveOptions

Defined in: [runtime/observe.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L37)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [runtime/observe.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L39)

The model-call seam (agent-eval `createChatClient`: router / cli-bridge / …).

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/observe.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L40)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [runtime/observe.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L42)

When set, learned facts are appended (idempotent) for the next run to read.

##### tags?

> `optional` **tags?**: readonly `string`[]

Defined in: [runtime/observe.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L44)

Tags written onto learned facts + used by the next run's corpus query.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/observe.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L45)

##### maxTraceLines?

> `optional` **maxTraceLines?**: `number`

Defined in: [runtime/observe.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L47)

Cap the trace lines fed to the observer (keeps the call cheap). Default 80.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/observe.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L53)

Override the analyst's system instruction — the prompt that turns a trace into
 findings + recommended_actions. The analyst IS the steerer, so this is the knob a
 prompt optimizer (GEPA) tunes. Omitted ⇒ the default observer instruction. The
 firewall (trace-only, never the verdict) is structural (input has no score), so a
 custom instruction cannot break it.

***

### Observation

Defined in: [runtime/observe.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L64)

#### Properties

##### findings

> **findings**: `AnalystFinding`[]

Defined in: [runtime/observe.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L65)

##### learned

> **learned**: [`CorpusRecord`](#corpusrecord)[]

Defined in: [runtime/observe.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L67)

Facts persisted to the corpus (empty when no corpus was supplied).

##### report

> **report**: `string`

Defined in: [runtime/observe.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L69)

Operator-facing markdown: what the observer noticed + what to change.

***

### CreateScopeAnalystOptions

Defined in: [runtime/personify/analyst.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L68)

The analyst run an `Agent<unknown, AnalystFinding[]>` performs over the children settled so far.
The combinator supplies the analyst's task projection (how to frame the drained settlements as
the analyst's input) — the analyst's `act` reads the trace and returns its raw findings; the
firewall is enforced afterwards by `createScopeAnalyst`, not by the analyst itself.

#### Type Parameters

##### D

`D`

#### Properties

##### analyst

> `readonly` **analyst**: [`Agent`](#agent)\<`unknown`, readonly `AnalystFinding`[]\>

Defined in: [runtime/personify/analyst.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L72)

The analyst agent the combinator spawns over the trace. `harness` is the persona's choice
 (`null` for an inline router analyst, a `BackendType` for a sandboxed one). Its `act` returns
 the RAW findings; this module asserts the firewall on them before returning.

##### budget

> `readonly` **budget**: [`Budget`](#budget-9)

Defined in: [runtime/personify/analyst.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L78)

The conserved budget reserved for one analyst spawn. The pool reserves against it and fails
 closed; an analyst that cannot be admitted is a fail-loud abort, never silent empty findings.

##### label?

> `readonly` `optional` **label?**: `string`

Defined in: [runtime/personify/analyst.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L80)

Trace/journal label for the spawned analyst child. Default `'analyst'`.

#### Methods

##### buildTask()

> **buildTask**(`input`): `unknown`

Defined in: [runtime/personify/analyst.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L75)

Build the analyst agent's task from the analyze input (the root-task framing + the children
 drained so far). Pure projection — the analyst interprets it, this never reads it.

###### Parameters

###### input

[`ScopeAnalyzeInput`](#scopeanalyzeinput)\<`D`\>

###### Returns

`unknown`

***

### RegistryAnalyzeProjection

Defined in: [runtime/personify/analyst.ts:183](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L183)

Project a `ScopeAnalyzeInput` into the `AnalystRegistry.run` arguments. The registry runs over a
`runId` + `AnalystRunInputs` (a trace store / run record / artifact dir), NOT in-memory scope
settlements — so the CALLER owns the projection from the combinator's drained children to the
registry's inputs (e.g. the trace store the run already wrote). This adapter never invents that
bridge; it only runs the projected inputs and firewalls the merged findings.

#### Properties

##### runId

> `readonly` **runId**: `string`

Defined in: [runtime/personify/analyst.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L184)

##### inputs

> `readonly` **inputs**: `AnalystRunInputs`

Defined in: [runtime/personify/analyst.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L185)

##### opts?

> `readonly` `optional` **opts?**: `object`

Defined in: [runtime/personify/analyst.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L187)

Optional `run` opts (e.g. `priorFindings`) forwarded verbatim to the registry.

###### Index Signature

\[`k`: `string`\]: `unknown`

###### priorFindings?

> `optional` **priorFindings?**: readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

***

### Persona

Defined in: [runtime/personify/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L70)

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

Defined in: [runtime/personify/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L72)

Stable persona name — used as the trace/journal label root, never as content.

##### root

> `readonly` **root**: [`AgentSpec`](#agentspec)

Defined in: [runtime/personify/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L78)

The root agent's executor mapping (profile + harness + optional BYO executor). The
shape's root `Agent` carries THIS as its `executorSpec`; child specs the shape spawns
are derived from / resolved against the same persona registry (see `ShapeContext`).

##### directive

> `readonly` **directive**: `string`

Defined in: [runtime/personify/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L80)

The goal framing handed to the shape — the "what to achieve", not "how".

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

Defined in: [runtime/personify/types.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L83)

Who the loop is acting as — the opaque persona context blob the shape may inject into
 child tasks. Opaque to the framework; only the persona's profiles/prompts interpret it.

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

Defined in: [runtime/personify/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L91)

The executor seams (router endpoint+key, sandbox client, cli bin) the built-in runtimes
read off `ExecutorContext.seams`, OR a fully pre-configured registry. The supervisor
threads an EMPTY seam bag to the root scope, so a persona that uses built-in metered
runtimes MUST supply a registry whose factories close over their seams (or BYO executors
on each `AgentSpec`). Carried here so `runPersonified` can build `SupervisorOpts.executors`.

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L96)

Forward-compatible extension bag — a later world-model / memory / tool-budget field is an
additive key here, never a breaking change to the `Persona` shape. Opaque to the engine.

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [runtime/personify/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L99)

Phantom: binds the persona to its deliverable type so `runPersonified` infers `D` from
 the persona and the chosen shape must agree. Type-only — never present at runtime.

***

### PersonaContext

Defined in: [runtime/personify/types.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L104)

The persona context blob — who the loop is acting as. Open by intent: a persona names its
 own role/audience/constraints; the framework treats it as opaque content.

#### Indexable

> \[`key`: `string`\]: `unknown`

Open content bag — persona-specific fields a shape's child tasks may carry.

#### Properties

##### role

> `readonly` **role**: `string`

Defined in: [runtime/personify/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L106)

The role the loop embodies ("senior staff engineer", "equity research analyst", …).

##### notes?

> `readonly` `optional` **notes?**: `string`

Defined in: [runtime/personify/types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L108)

Optional freeform framing the persona's prompts/profiles consume.

***

### PersonaExecutors

Defined in: [runtime/personify/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L118)

How a persona supplies executor resolution. Either a pre-built registry (factories already
closed over their seams) OR the raw seam bag the engine uses to construct a registry +
thread the seams onto each spawn. Exactly one is required — fail loud if neither is set.

#### Properties

##### registry?

> `readonly` `optional` **registry?**: `ExecutorRegistry`

Defined in: [runtime/personify/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L120)

A registry whose factories already capture their seams. Highest precedence.

##### seams?

> `readonly` `optional` **seams?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L122)

Raw seams to thread onto built-in runtimes (`router`/`sandbox`/`cli` keys).

***

### DefinePersonaInput

Defined in: [runtime/personify/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L129)

The minimal input to build a `Persona`. Mirrors `Persona` but lets the builder default
 the executors-supplied invariant check and freeze the record.

#### Type Parameters

##### D

`D` = `unknown`

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [runtime/personify/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L130)

##### root

> `readonly` **root**: [`AgentSpec`](#agentspec)

Defined in: [runtime/personify/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L131)

##### directive

> `readonly` **directive**: `string`

Defined in: [runtime/personify/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L132)

##### context

> `readonly` **context**: [`PersonaContext`](#personacontext-1)

Defined in: [runtime/personify/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L133)

##### executors

> `readonly` **executors**: [`PersonaExecutors`](#personaexecutors-1)

Defined in: [runtime/personify/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L134)

##### extensions?

> `readonly` `optional` **extensions?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/personify/types.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L135)

##### \_\_deliverable?

> `readonly` `optional` **\_\_deliverable?**: `D`

Defined in: [runtime/personify/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L138)

Phantom: pins the input's deliverable type so `definePersona<D>` returns a `Persona<D>`
 the caller's shape must agree with. Type-only — never supplied at a call site.

***

### ShapeBudget

Defined in: [runtime/personify/types.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L153)

Budget knobs a shape reads to size its fanout/children WITHOUT owning the conserved pool.
The root budget lives on `SupervisorOpts.budget`; the shape only needs the per-child
sizing hints + the fanout width it is allowed to open. All ceilings — the pool reserves
against them and fails closed, so an over-eager shape can never overspend.

#### Properties

##### perChild

> `readonly` **perChild**: [`Budget`](#budget-9)

Defined in: [runtime/personify/types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L155)

Per-child spawn budget the shape reserves for each leaf/sub-loop it opens.

##### fanout

> `readonly` **fanout**: `number`

Defined in: [runtime/personify/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L157)

Max children a fanout step may open in one round (the shape's structural width).

***

### ShapeContext

Defined in: [runtime/personify/types.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L167)

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

Defined in: [runtime/personify/types.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L168)

##### budget

> `readonly` **budget**: [`ShapeBudget`](#shapebudget)

Defined in: [runtime/personify/types.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L169)

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: [runtime/personify/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L182)

The scope analyst (selector≠judge firewall) the combinator steers from. Absent ⇒ the
 dormant default (empty findings → gates read deliverables/state only).

#### Methods

##### spawnChild()

> **spawnChild**(`name`, `spec`): [`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [runtime/personify/types.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L176)

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

[`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`D`\>\>

##### childSpec()

> **childSpec**(`profile`, `harness?`): [`AgentSpec`](#agentspec)

Defined in: [runtime/personify/types.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L179)

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

Defined in: [runtime/personify/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L201)

The open shape registry — the extension point that makes a new loop-shape ONE file + one
`registerShape` call with zero edits elsewhere. `resolve` returns a typed outcome (inspect
`succeeded` before `value`); `register` fails loud on a duplicate name.

#### Methods

##### register()

> **register**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [runtime/personify/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L202)

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

Defined in: [runtime/personify/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L203)

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

Defined in: [runtime/personify/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L207)

The registered shape names — for diagnostics + a fail-loud "unknown shape" message.

###### Returns

`string`[]

***

### RunPersonifiedOptions

Defined in: [runtime/personify/types.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L222)

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

Defined in: [runtime/personify/types.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L223)

##### shape

> `readonly` **shape**: `string` \| [`LoopShape`](#loopshape)\<`Task`, `D`\>

Defined in: [runtime/personify/types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L225)

A resolved shape factory OR a registered shape name.

##### task

> `readonly` **task**: `Task`

Defined in: [runtime/personify/types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L226)

##### budget

> `readonly` **budget**: [`Budget`](#budget-9)

Defined in: [runtime/personify/types.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L227)

##### shapeBudget?

> `readonly` `optional` **shapeBudget?**: `Partial`\<[`ShapeBudget`](#shapebudget)\>

Defined in: [runtime/personify/types.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L229)

Per-child sizing + fanout width handed to the shape. Defaults derive from `budget`.

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [runtime/personify/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L231)

Trace/journal root key. Defaults to the persona name + a run discriminator in the engine.

##### journal?

> `readonly` `optional` **journal?**: `SpawnJournal`

Defined in: [runtime/personify/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L232)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/personify/types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L233)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/personify/types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L235)

Runtime recursion-depth ceiling, paired with the conserved pool.

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [runtime/personify/types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L237)

OTP intensity breaker bounds, forwarded to the supervisor verbatim.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [runtime/personify/types.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L238)

##### handle?

> `readonly` `optional` **handle?**: `RootHandle`\<[`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [runtime/personify/types.ts:240](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L240)

A live root handle to attach (view/signal/abort) before the run starts.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/personify/types.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L241)

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [runtime/personify/types.ts:242](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L242)

##### analyst?

> `readonly` `optional` **analyst?**: [`ScopeAnalyst`](#scopeanalyst)\<`D`\>

Defined in: [runtime/personify/types.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L245)

Optional scope analyst threaded into the shape's ShapeContext so loopUntil/widen steer
 on trace-derived findings instead of the dormant empty default.

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/personify/types.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L251)

Lifecycle stream sink, forwarded to `SupervisorOpts.hooks` so the root `Scope`'s
`agent.spawn`/`agent.child` events flow to an observer (e.g. the Intelligence SDK's
trace export). Absent ⇒ no stream (the run is silent, as today).

***

### PipelineStage

Defined in: [runtime/personify/wave-types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L76)

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

Defined in: [runtime/personify/wave-types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L78)

Trace/journal label for this stage's spawned child.

#### Methods

##### feed()

> **feed**(`prior`, `ctx`, `rootTask`): `unknown`

Defined in: [runtime/personify/wave-types.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L81)

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

Defined in: [runtime/personify/wave-types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L84)

Read this stage's settled child output into the typed `StepOut` the next stage feeds on.
 Fail loud (return a `blocked`) when the child produced nothing usable for the next stage.

###### Parameters

###### settled

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`StepOut`\>\>

###### Returns

[`Outcome`](#outcome-1)\<`StepOut`\>

***

### FanoutOptions

Defined in: [runtime/personify/wave-types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L105)

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

Defined in: [runtime/personify/wave-types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L124)

Optional synthesis over the gathered child results: when present, the combinator spawns ONE
synthesis child whose task is built from the drained settlements, and its `done` output is
the deliverable. When absent, the deliverable is the best-valid child via `defaultSelectWinner`.
The synthesis child is a SEPARATE keystone agent (not a re-rank behind the driver).

##### selectWinner?

> `optional` **selectWinner?**: [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L133)

Winner-selection strategy among the gathered `done` children when there is no `synthesize`.
Receives the SAME `Iteration[]` the default selector reads (each child's output is its
`Outcome<D>`), so a strategy is a thin re-sort (smallest-diff, highest-readiness, first-valid
…) over the candidates — NEVER a re-rank behind a judge. Default = `defaultSelectWinner`
semantics (best-valid-score, ties→earliest). Mutually exclusive with `synthesize` (a
synthesis child IS the selection); supplying both is a config error.

#### Methods

##### itemTask()

> **itemTask**(`item`, `index`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L108)

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

Defined in: [runtime/personify/wave-types.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L110)

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

Defined in: [runtime/personify/wave-types.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L117)

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

Defined in: [runtime/personify/wave-types.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L149)

How a fanout's synthesis child is built + read. `synthesisTask` projects the drained child
 settlements into the synthesis child's task; `collect` reads its settled output into the
 deliverable `Outcome<D>`.

#### Type Parameters

##### D

`D`

#### Methods

##### synthesisTask()

> **synthesisTask**(`gathered`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L150)

###### Parameters

###### gathered

readonly [`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`settled`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L151)

###### Parameters

###### settled

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### LoopUntilSpec

Defined in: [runtime/personify/wave-types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L170)

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

Defined in: [runtime/personify/wave-types.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L172)

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

Defined in: [runtime/personify/wave-types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L174)

Fold one settled step into the accumulated state (the loop's running deliverable candidate).

###### Parameters

###### prior

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

###### settled

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### Returns

[`LoopUntilState`](#loopuntilstate-2)\<`State`\>

##### until()

> **until**(`state`, `findings`): [`Outcome`](#outcome-1)\<`D`\> \| `null`

Defined in: [runtime/personify/wave-types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L180)

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

Defined in: [runtime/personify/wave-types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L182)

Per-round step label (defaults to `step:<round>` in the impl).

###### Parameters

###### round

`number`

###### Returns

`string`

***

### LoopUntilState

Defined in: [runtime/personify/wave-types.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L187)

The accumulated state `loopUntil` threads across rounds — the running candidate + the round
 index, so `step`/`fold`/`until` are pure functions of it (replay-safe, no wall-clock).

#### Type Parameters

##### State

`State`

#### Properties

##### round

> `readonly` **round**: `number`

Defined in: [runtime/personify/wave-types.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L188)

##### value

> `readonly` **value**: `State`

Defined in: [runtime/personify/wave-types.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L189)

***

### PanelSpec

Defined in: [runtime/personify/wave-types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L208)

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

Defined in: [runtime/personify/wave-types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L212)

The M judge child specs: each is a persona-derived child (a narrower judge profile). The
 combinator spawns one child per entry over the SAME `artifact` and never lets one judge's
 output reach another's task (write-only).

#### Methods

##### judgeTask()

> **judgeTask**(`artifact`, `judge`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L214)

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

Defined in: [runtime/personify/wave-types.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L220)

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

Defined in: [runtime/personify/wave-types.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L225)

One judge in a panel — a labeled persona-derived judge child. Content (the rubric) lives in
 the judge's profile; this carries only the label + the optional weight the merge may read.

#### Properties

##### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L226)

##### weight?

> `readonly` `optional` **weight?**: `number`

Defined in: [runtime/personify/wave-types.ts:228](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L228)

Optional merge weight (a write-only hint the `merge` fold may use; default-equal in the impl).

***

### PanelVerdict

Defined in: [runtime/personify/wave-types.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L233)

One judge child's settled verdict, surfaced to the write-only `merge`. `down` judges carry no
 verdict (excluded from the merge `n`, like an infra-errored cell).

#### Properties

##### judge

> `readonly` **judge**: [`PanelJudge`](#paneljudge)

Defined in: [runtime/personify/wave-types.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L234)

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/personify/wave-types.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L235)

##### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [runtime/personify/wave-types.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L237)

The judge child's raw output — what it was asked to assess, for a merge that quotes it.

##### down

> `readonly` **down**: `boolean`

Defined in: [runtime/personify/wave-types.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L239)

True when the judge child went `down` (no usable verdict — kept out of the merge denominator).

***

### VerifySpec

Defined in: [runtime/personify/wave-types.ts:256](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L256)

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

Defined in: [runtime/personify/wave-types.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L264)

Implement / verifier child labels (default `implement` / `verify` in the impl).

##### verifierLabel?

> `readonly` `optional` **verifierLabel?**: `string`

Defined in: [runtime/personify/wave-types.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L265)

#### Methods

##### implement()

> **implement**(`rootTask`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L258)

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

Defined in: [runtime/personify/wave-types.ts:260](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L260)

Build the verifier child's task from the implement child's settled candidate.

###### Parameters

###### candidate

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`Candidate`\>\>

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

`unknown`

##### collect()

> **collect**(`candidate`, `verdict`): [`Outcome`](#outcome-1)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L262)

Project the gated (verifier-`valid`) candidate into the terminal deliverable.

###### Parameters

###### candidate

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`Candidate`\>\>

###### verdict

`DefaultVerdict`

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### WidenSpec

Defined in: [runtime/personify/wave-types.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L286)

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

Defined in: [runtime/personify/wave-types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L289)

The initial children to spawn before any widening — the seed lineages the gate widens from.
 One child task per seed; bounded by the conserved pool's fail-closed admission.

##### gate

> `readonly` **gate**: [`ScopeWidenGate`](#scopewidengate)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L296)

The progressive-widening gate. Consulted on EVERY settled child with the round's
trace-derived `findings`; returns a widen decision (spawn one more toward a lineage) or a
stop. DEFAULTS to flat via `flatWidenGate` — never widens, so the firewall stays dormant.

#### Methods

##### seedTask()

> **seedTask**(`seed`, `index`, `ctx`): `unknown`

Defined in: [runtime/personify/wave-types.ts:290](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L290)

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

Defined in: [runtime/personify/wave-types.ts:298](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L298)

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

Defined in: [runtime/personify/wave-types.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L301)

Synthesize the terminal deliverable from every settled lineage (selector≠judge: the
 single-sourced selector over the gathered children, never a re-judge).

###### Parameters

###### gathered

readonly [`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

###### ctx

[`ShapeContext`](#shapecontext)\<`D`\>

###### Returns

[`Outcome`](#outcome-1)\<`D`\>

***

### ScopeWidenGate

Defined in: [runtime/personify/wave-types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L310)

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

Defined in: [runtime/personify/wave-types.ts:318](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L318)

When true, `decide` may read `settled.verdict` directly — collides with the steer firewall,
 so it must be argued per cell, never defaulted on (mirrors the keystone `WidenGate`).

#### Methods

##### decide()

> **decide**(`settled`, `findings`, `budget`): [`WidenDecision`](#widendecision)\<`D`\>

Defined in: [runtime/personify/wave-types.ts:311](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L311)

###### Parameters

###### settled

[`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>

###### findings

readonly `AnalystFinding`[]

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

[`WidenDecision`](#widendecision)\<`D`\>

***

### WidenLineage

Defined in: [runtime/personify/wave-types.ts:329](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L329)

A lineage the gate may widen toward — the settled child that looked promising + the findings
 that justified it (the trace-derived provenance the firewall requires).

#### Type Parameters

##### D

`D`

#### Properties

##### settled

> `readonly` **settled**: `object`

Defined in: [runtime/personify/wave-types.ts:330](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L330)

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

Defined in: [runtime/personify/wave-types.ts:331](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L331)

***

### ScopeAnalyst

Defined in: [runtime/personify/wave-types.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L358)

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

Defined in: [runtime/personify/wave-types.ts:365](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L365)

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

Defined in: [runtime/personify/wave-types.ts:369](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L369)

Input to a `ScopeAnalyst.analyze` — the root task framing + the children settled so far.

#### Type Parameters

##### D

`D`

#### Properties

##### task

> `readonly` **task**: `unknown`

Defined in: [runtime/personify/wave-types.ts:371](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L371)

Opaque root-task framing (whatever the combinator was invoked with).

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

Defined in: [runtime/personify/wave-types.ts:373](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L373)

The children this combinator has drained off `scope.next()`, in cursor order.

##### nodeId

> `readonly` **nodeId**: `string`

Defined in: [runtime/personify/wave-types.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L375)

This combinator's scope id (the trace-correlation root for the analyst).

***

### SteerContext

Defined in: [runtime/personify/wave-types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L386)

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

Defined in: [runtime/personify/wave-types.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L387)

##### settledSoFar

> `readonly` **settledSoFar**: readonly [`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

Defined in: [runtime/personify/wave-types.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L388)

##### lastValidScore?

> `readonly` `optional` **lastValidScore?**: `number`

Defined in: [runtime/personify/wave-types.ts:391](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L391)

Observability-only: the best valid score seen so far. Rendering/trace use ONLY — steering
 off this re-introduces selector=judge. Marked so a reviewer catches a misuse.

***

### CorpusRecord

Defined in: [runtime/personify/wave-types.ts:414](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L414)

One accreted fact in the cross-run corpus — the learning-flywheel's durable unit. DISTINCT from
a `SpawnEvent` (a per-run decision record): a `CorpusRecord` is a fact a run LEARNED that a
FUTURE run should read back (the world-model for story 5). It is content the next persona reads,
not a replay input. Tagged + scored so `query`/`renderCorpusToInstructions` can project the
relevant, high-confidence subset.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `"1.0.0"`

Defined in: [runtime/personify/wave-types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L415)

##### id

> `readonly` **id**: `string`

Defined in: [runtime/personify/wave-types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L417)

Stable id over identity-defining fields (claim + tags) so a re-learned fact dedups.

##### runId

> `readonly` **runId**: `string`

Defined in: [runtime/personify/wave-types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L419)

The run that produced this fact (the journal `runId`/`root`) — provenance back to the trace.

##### producedAt

> `readonly` **producedAt**: `string`

Defined in: [runtime/personify/wave-types.ts:420](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L420)

##### area

> `readonly` **area**: `string`

Defined in: [runtime/personify/wave-types.ts:422](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L422)

Coarse classification the query/render filters on (free-form, mirrors `AnalystFinding.area`).

##### claim

> `readonly` **claim**: `string`

Defined in: [runtime/personify/wave-types.ts:424](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L424)

The accreted fact — the instruction-shaped statement the next run reads back.

##### rationale?

> `readonly` `optional` **rationale?**: `string`

Defined in: [runtime/personify/wave-types.ts:426](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L426)

Optional supporting detail the renderer may include under the claim.

##### tags

> `readonly` **tags**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L428)

Free-form tags for `query` filtering (domain, persona, surface).

##### confidence

> `readonly` **confidence**: `number`

Defined in: [runtime/personify/wave-types.ts:430](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L430)

0..1 — the producing run's confidence in this fact (the render threshold reads it).

##### evidence?

> `readonly` `optional` **evidence?**: readonly `object`[]

Defined in: [runtime/personify/wave-types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L432)

Optional provenance back into the run that learned it (a finding id / outRef / span).

***

### CorpusFilter

Defined in: [runtime/personify/wave-types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L436)

A corpus query filter — every field is an AND-narrowing; an omitted field does not constrain.

#### Properties

##### area?

> `readonly` `optional` **area?**: `string`

Defined in: [runtime/personify/wave-types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L437)

##### tags?

> `readonly` `optional` **tags?**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L439)

Match records carrying ALL of these tags.

##### minConfidence?

> `readonly` `optional` **minConfidence?**: `number`

Defined in: [runtime/personify/wave-types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L441)

Minimum confidence a record must clear to be returned (the render gate).

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [runtime/personify/wave-types.ts:443](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L443)

Only records from this run (rare — usually a cross-run read).

##### limit?

> `readonly` `optional` **limit?**: `number`

Defined in: [runtime/personify/wave-types.ts:445](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L445)

Cap the result count (most-confident first in the impl).

***

### Corpus

Defined in: [runtime/personify/wave-types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L458)

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

Defined in: [runtime/personify/wave-types.ts:461](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L461)

Append one accreted fact. Idempotent on an identical record; returns a typed outcome —
 inspect `succeeded` before treating it as durable (no silent write-through on conflict).

###### Parameters

###### record

[`CorpusRecord`](#corpusrecord)

###### Returns

`Promise`\<\{ `succeeded`: `true`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### query()

> **query**(`filter`): `Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

Defined in: [runtime/personify/wave-types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L464)

Query accreted facts by filter — most-confident first. Returns the matching records (an
 empty array when none match is a valid result, NOT an error).

###### Parameters

###### filter

[`CorpusFilter`](#corpusfilter)

###### Returns

`Promise`\<readonly [`CorpusRecord`](#corpusrecord)[]\>

***

### RenderCorpusToInstructionsOptions

Defined in: [runtime/personify/wave-types.ts:478](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L478)

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

Defined in: [runtime/personify/wave-types.ts:479](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L479)

##### filter

> `readonly` **filter**: [`CorpusFilter`](#corpusfilter)

Defined in: [runtime/personify/wave-types.ts:480](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L480)

##### profile

> `readonly` **profile**: `AgentProfile`

Defined in: [runtime/personify/wave-types.ts:482](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L482)

The profile to project the facts into. The result is a fresh profile — the input is unchanged.

##### target?

> `readonly` `optional` **target?**: `"prompt"` \| `"resources"`

Defined in: [runtime/personify/wave-types.ts:485](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L485)

Where the rendered facts land: appended to `prompt.instructions[]` (default) or folded into
 the single-blob `resources.instructions` string.

##### maxLines?

> `readonly` `optional` **maxLines?**: `number`

Defined in: [runtime/personify/wave-types.ts:487](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L487)

Optional cap on rendered lines (most-confident first), independent of the query `limit`.

***

### TrajectoryNode

Defined in: [runtime/personify/wave-types.ts:506](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L506)

One node in the reconstructed trajectory tree — a driver OR a leaf, with its OWN spend and the
spend ROLLED UP over its subtree. Reconstructed from the `SpawnJournal` (structure + per-node
`Spend`) + the `ResultBlobStore` (the `out` artifact, rehydrated by `outRef`). The realized tree
shape: `parent`/`children` are the actual spawn edges the run took, not a planned topology.

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [runtime/personify/wave-types.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L507)

##### parent?

> `readonly` `optional` **parent?**: `string`

Defined in: [runtime/personify/wave-types.ts:508](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L508)

##### children

> `readonly` **children**: readonly `string`[]

Defined in: [runtime/personify/wave-types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L509)

##### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L510)

##### runtime

> `readonly` **runtime**: `string`

Defined in: [runtime/personify/wave-types.ts:511](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L511)

##### status

> `readonly` **status**: `"failed"` \| `"cancelled"` \| `"pending"` \| `"done"`

Defined in: [runtime/personify/wave-types.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L513)

Terminal status the journal recorded for this node.

##### ownSpend

> `readonly` **ownSpend**: [`Spend`](#spend)

Defined in: [runtime/personify/wave-types.ts:515](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L515)

This node's OWN conserved spend (from its `settled` event).

##### rolledUpSpend

> `readonly` **rolledUpSpend**: [`Spend`](#spend)

Defined in: [runtime/personify/wave-types.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L518)

This node's spend PLUS every descendant's — the rolled-up subtree cost. The cost a parent
 "really" consumed inclusive of its children's fanout (the equal-k-on-cost basis).

##### verdict?

> `readonly` `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/personify/wave-types.ts:520](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L520)

The node's verdict, when its settlement carried one (observability — NOT a steer input).

##### output?

> `readonly` `optional` **output?**: `unknown`

Defined in: [runtime/personify/wave-types.ts:522](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L522)

The rehydrated output artifact, when `withOutputs` was requested + the blob resolved.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

Defined in: [runtime/personify/wave-types.ts:523](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L523)

***

### TrajectoryReport

Defined in: [runtime/personify/wave-types.ts:528](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L528)

The whole reconstructed trajectory — the realized tree + its root-rolled-up total. The
 per-node + rolled-up `Spend` is the evidence both the trace viewer and `equalKOnCost` read.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: [runtime/personify/wave-types.ts:529](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L529)

##### nodes

> `readonly` **nodes**: readonly [`TrajectoryNode`](#trajectorynode)[]

Defined in: [runtime/personify/wave-types.ts:531](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L531)

Every node, in cursor/spawn order — the realized tree (`parent`/`children` are the real edges).

##### total

> `readonly` **total**: [`Spend`](#spend)

Defined in: [runtime/personify/wave-types.ts:533](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L533)

The root's rolled-up spend — the whole run's conserved total (tokens + usd + iterations + ms).

##### statusCounts

> `readonly` **statusCounts**: `Readonly`\<`Record`\<[`TrajectoryNode`](#trajectorynode)\[`"status"`\], `number`\>\>

Defined in: [runtime/personify/wave-types.ts:535](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L535)

Count of nodes by terminal status — a quick "how did the tree end" readout.

***

### TrajectoryReportOptions

Defined in: [runtime/personify/wave-types.ts:545](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L545)

`trajectoryReport(journal, blobs, root, { withOutputs? })` — reconstruct the whole tree with
per-node + rolled-up `Spend`. Reads the journal for structure + spend and (when `withOutputs`)
the blob store for each `done` node's artifact. Fail loud on a tree that was never journaled or
a `done` node whose blob the store cannot rehydrate (a silent gap would mis-cost the tree). The
impl lives in `trajectory.ts`.

#### Properties

##### withOutputs?

> `readonly` `optional` **withOutputs?**: `boolean`

Defined in: [runtime/personify/wave-types.ts:547](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L547)

Rehydrate each `done` node's `output` from the blob store. Off by default (cost-only report).

***

### EqualKArm

Defined in: [runtime/personify/wave-types.ts:566](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L566)

One arm of an equal-k comparison — a labeled trajectory (a `TrajectoryReport` is one arm's whole
run). The arm's conserved COST is `report.total` (tokens + usd), which the sandbox executor
already reports INCLUSIVE of a leaf's internal sub-agent fanout — so comparing arms on this cost
(not raw `iterations`) closes the leaf-fanout confound: a treatment arm whose leaf fanned out
internally is charged for that fanout in `total.tokens`/`total.usd`, not hidden behind one
iteration count.

#### Properties

##### label

> `readonly` **label**: `string`

Defined in: [runtime/personify/wave-types.ts:567](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L567)

##### report

> `readonly` **report**: [`TrajectoryReport`](#trajectoryreport-3)

Defined in: [runtime/personify/wave-types.ts:568](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L568)

***

### EqualKVerdict

Defined in: [runtime/personify/wave-types.ts:577](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L577)

The equal-k-on-cost verdict: whether every arm spent within `tolerance` of the others on the
CONSERVED cost channels (tokens + usd), so a downstream metric comparison is "at equal k". Per-
arm cost is surfaced so a caller can see HOW close. `withinTolerance: false` means the arms are
NOT comparable at equal compute — a confound to report, not a result to publish.

#### Properties

##### withinTolerance

> `readonly` **withinTolerance**: `boolean`

Defined in: [runtime/personify/wave-types.ts:578](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L578)

##### arms

> `readonly` **arms**: readonly `object`[]

Defined in: [runtime/personify/wave-types.ts:580](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L580)

Per-arm conserved cost (the basis: tokens total + usd).

##### spread

> `readonly` **spread**: `object`

Defined in: [runtime/personify/wave-types.ts:587](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L587)

The realized spread on each channel (max − min across arms), for the report.

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

##### tolerance

> `readonly` **tolerance**: `number`

Defined in: [runtime/personify/wave-types.ts:589](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L589)

The fractional tolerance the check used (spread / median ≤ tolerance per channel).

***

### EqualKOnCostOptions

Defined in: [runtime/personify/wave-types.ts:599](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L599)

`equalKOnCost(arms, { tolerance? })` — assert arms are comparable at EQUAL conserved COST
(tokens + usd), NOT raw iteration count. The conserved-pool guarantees `Σk` equal by
construction WITHIN one supervised run; this checks it ACROSS arms (separate runs) where the
pool cannot, so a cross-arm gate comparison can prove equal compute before claiming a win. The
impl lives in `trajectory.ts`. Pure over the reports — no I/O.

#### Properties

##### tolerance?

> `readonly` `optional` **tolerance?**: `number`

Defined in: [runtime/personify/wave-types.ts:602](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L602)

Max fractional spread (spread/median) per channel for arms to count as equal-k. Default in
 the impl (e.g. 0.05). A tighter tolerance = a stricter equal-compute claim.

***

### PromotionGateOptions

Defined in: [runtime/promotion-gate.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L13)

#### Properties

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [runtime/promotion-gate.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L15)

The HOLDOUT report — must carry per-task cells for both strategy names.

##### incumbent

> **incumbent**: `string`

Defined in: [runtime/promotion-gate.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L17)

The incumbent champion's strategy name.

##### candidate

> **candidate**: `string`

Defined in: [runtime/promotion-gate.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L19)

The challenger's strategy name.

##### mode?

> `optional` **mode?**: `"superiority"` \| `"non-inferiority"`

Defined in: [runtime/promotion-gate.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L24)

'superiority' (default): the candidate must score significantly BETTER.
 'non-inferiority': the candidate must prove its score is not worse than the
 incumbent by more than `scoreTolerance` AND its cost savings are significant —
 the gate for "same quality, cheaper" claims.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [runtime/promotion-gate.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L26)

non-inferiority: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### deltaThreshold?

> `optional` **deltaThreshold?**: `number`

Defined in: [runtime/promotion-gate.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L28)

The CI lower bound on the paired lift must EXCEED this (score scale). Default 0.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [runtime/promotion-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L31)

Minimum paired tasks before significance can be claimed. Default 6 — below that
 the bootstrap CI is too wide to separate a real lift from the per-task noise.

##### statistic?

> `optional` **statistic?**: `"mean"` \| `"median"`

Defined in: [runtime/promotion-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L33)

Bootstrap statistic over the paired deltas. Default 'mean'.

##### seed?

> `optional` **seed?**: `number`

Defined in: [runtime/promotion-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L35)

Fixed by the substrate by default — the same report always yields the same verdict.

##### resamples?

> `optional` **resamples?**: `number`

Defined in: [runtime/promotion-gate.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L36)

***

### PromotionVerdict

Defined in: [runtime/promotion-gate.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L39)

#### Properties

##### promoted

> **promoted**: `boolean`

Defined in: [runtime/promotion-gate.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L40)

##### reason

> **reason**: `"identical-champion"` \| `"few-tasks"` \| `"no-margin"` \| `"significant"` \| `"non-inferior-and-cheaper"` \| `"non-inferiority-unproven"` \| `"not-cheaper"`

Defined in: [runtime/promotion-gate.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L41)

##### mode

> **mode**: `"superiority"` \| `"non-inferiority"`

Defined in: [runtime/promotion-gate.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L49)

##### n

> **n**: `number`

Defined in: [runtime/promotion-gate.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L51)

Paired tasks that carried both strategies' cells.

##### lift

> **lift**: `object`

Defined in: [runtime/promotion-gate.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L53)

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

Defined in: [runtime/promotion-gate.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L56)

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

Defined in: [runtime/promotion-gate.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L60)

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

Defined in: [runtime/report-usage.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L24)

The slice of an agent-eval campaign `DispatchContext.cost` this needs.

#### Methods

##### observe()

> **observe**(`amountUsd`, `source`): `void`

Defined in: [runtime/report-usage.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L25)

###### Parameters

###### amountUsd

`number`

###### source

`string`

###### Returns

`void`

##### observeTokens()

> **observeTokens**(`usage`): `void`

Defined in: [runtime/report-usage.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L26)

###### Parameters

###### usage

[`LoopTokenUsage`](#looptokenusage)

###### Returns

`void`

***

### RouterConfig

Defined in: [runtime/router-client.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L16)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/router-client.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L17)

##### routerKey

> **routerKey**: `string`

Defined in: [runtime/router-client.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L18)

##### model

> **model**: `string`

Defined in: [runtime/router-client.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L19)

***

### RouterChatResult

Defined in: [runtime/router-client.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L22)

#### Properties

##### content

> **content**: `string`

Defined in: [runtime/router-client.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L23)

##### usage?

> `optional` **usage?**: `object`

Defined in: [runtime/router-client.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L25)

REAL usage, or undefined when the provider reported none.

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [runtime/router-client.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L27)

Derived from usage via `estimateCost` when the model is priced; else undefined.

***

### RouterToolCall

Defined in: [runtime/router-client.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L97)

A tool-call the model emitted (provider-neutral; mirrors the runtime's ToolCallRequest).

#### Properties

##### id

> **id**: `string`

Defined in: [runtime/router-client.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L98)

##### name

> **name**: `string`

Defined in: [runtime/router-client.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L99)

##### arguments

> **arguments**: `string`

Defined in: [runtime/router-client.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L101)

Raw JSON arguments string as emitted by the model.

***

### RouterChatToolsResult

Defined in: [runtime/router-client.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L104)

#### Properties

##### content

> **content**: `string` \| `null`

Defined in: [runtime/router-client.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L105)

##### toolCalls

> **toolCalls**: [`RouterToolCall`](#routertoolcall)[]

Defined in: [runtime/router-client.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L106)

##### usage?

> `optional` **usage?**: `object`

Defined in: [runtime/router-client.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L107)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: [runtime/router-client.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L108)

***

### ToolSpec

Defined in: [runtime/router-client.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L177)

#### Properties

##### type

> **type**: `"function"`

Defined in: [runtime/router-client.ts:178](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L178)

##### function

> **function**: `object`

Defined in: [runtime/router-client.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L179)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `unknown`

***

### RouterToolLoopResult

Defined in: [runtime/router-client.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L182)

#### Properties

##### final

> **final**: `string`

Defined in: [runtime/router-client.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L184)

The model's final assistant text (the turn where it stopped calling tools, or the budget turn).

##### turns

> **turns**: `number`

Defined in: [runtime/router-client.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L186)

Inference turns spent (≤ maxTurns) — the equal-budget unit vs random@k.

##### toolCalls

> **toolCalls**: `number`

Defined in: [runtime/router-client.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L187)

##### toolTrace

> **toolTrace**: `object`[]

Defined in: [runtime/router-client.ts:190](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L190)

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

Defined in: [runtime/router-client.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L191)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### messages

> **messages**: `Record`\<`string`, `unknown`\>[]

Defined in: [runtime/router-client.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L194)

The full conversation after the loop (seed + every assistant/tool turn). Lets a caller
 CARRY the messages into the next shot (depth continuation) and read the trajectory.

***

### BenchmarkConfig

Defined in: [runtime/run-benchmark.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L32)

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

Defined in: [runtime/run-benchmark.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L34)

The task domain (5 hooks).

##### tasks

> **tasks**: [`AgenticTask`](#agentictask)[]

Defined in: [runtime/run-benchmark.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L36)

The tasks to score across.

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

Defined in: [runtime/run-benchmark.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L38)

The worker: model + router + (optional) the critic's instruction (the steerer knob).

##### strategies?

> `optional` **strategies?**: [`Strategy`](#strategy-3)[]

Defined in: [runtime/run-benchmark.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L41)

Which strategies to compare. Pass the built-ins (`refine`, `sample`) or your own.
 Default: [sample, refine].

##### budget?

> `optional` **budget?**: `number`

Defined in: [runtime/run-benchmark.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L43)

Shots (refine) / width (sample) — the equal compute budget per strategy. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/run-benchmark.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L45)

Tasks scored in parallel. Default 3.

##### onTask?

> `optional` **onTask?**: (`row`, `done`, `total`) => `void`

Defined in: [runtime/run-benchmark.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L48)

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

Defined in: [runtime/run-benchmark.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L51)

Lifecycle observability — every spawn/settle of every cell's shots/analysts streams
 here live (the watchdog/route-auditor seam, passed through to `runAgentic`).

***

### BenchmarkLift

Defined in: [runtime/run-benchmark.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L54)

#### Properties

##### mean

> **mean**: `number`

Defined in: [runtime/run-benchmark.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L56)

Mean of paired deltas (refine − sample).

##### low

> **low**: `number`

Defined in: [runtime/run-benchmark.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L57)

##### high

> **high**: `number`

Defined in: [runtime/run-benchmark.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L58)

##### n

> **n**: `number`

Defined in: [runtime/run-benchmark.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L59)

***

### BenchmarkCell

Defined in: [runtime/run-benchmark.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L63)

One strategy's outcome on one task — the per-task cell an optimizer consumes.

#### Properties

##### score

> **score**: `number`

Defined in: [runtime/run-benchmark.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L64)

##### resolved

> **resolved**: `boolean`

Defined in: [runtime/run-benchmark.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L65)

##### progression

> **progression**: `number`[]

Defined in: [runtime/run-benchmark.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L67)

The progress curve (refine: score per shot; sample: best-so-far per rollout).

##### usd

> **usd**: `number`

Defined in: [runtime/run-benchmark.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L68)

##### ms

> **ms**: `number`

Defined in: [runtime/run-benchmark.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L69)

##### tokens

> **tokens**: `object`

Defined in: [runtime/run-benchmark.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L70)

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### BenchmarkTaskRow

Defined in: [runtime/run-benchmark.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L73)

#### Properties

##### taskId

> **taskId**: `string`

Defined in: [runtime/run-benchmark.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L74)

##### cells?

> `optional` **cells?**: `Record`\<`string`, [`BenchmarkCell`](#benchmarkcell)\>

Defined in: [runtime/run-benchmark.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L76)

Per-strategy cells; absent when the task errored before completing all strategies.

##### errors?

> `optional` **errors?**: `Record`\<`string`, `string`\>

Defined in: [runtime/run-benchmark.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L80)

Per-strategy failures on this task: the strategy competed, threw, and scored an
 honest zero — it loses, it does not poison the row. The message is kept so a later
 generation's author can see WHY a candidate died.

##### error?

> `optional` **error?**: `string`

Defined in: [runtime/run-benchmark.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L82)

Why the task was excluded (infra/setup failure) — never silently dropped.

***

### BenchmarkStrategySummary

Defined in: [runtime/run-benchmark.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L85)

#### Properties

##### score

> **score**: `number`

Defined in: [runtime/run-benchmark.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L87)

Mean verifier score (0..1).

##### resolved

> **resolved**: `number`

Defined in: [runtime/run-benchmark.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L89)

Fraction of tasks fully resolved.

##### usd

> **usd**: `number`

Defined in: [runtime/run-benchmark.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L91)

Mean cost vector per task.

##### ms

> **ms**: `number`

Defined in: [runtime/run-benchmark.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L92)

***

### BenchmarkReport

Defined in: [runtime/run-benchmark.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L95)

#### Properties

##### n

> **n**: `number`

Defined in: [runtime/run-benchmark.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L96)

##### excluded

> **excluded**: `number`

Defined in: [runtime/run-benchmark.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L97)

##### perStrategy

> **perStrategy**: `Record`\<`string`, [`BenchmarkStrategySummary`](#benchmarkstrategysummary)\>

Defined in: [runtime/run-benchmark.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L99)

Per-strategy means (keyed by strategy.name).

##### perTask

> **perTask**: [`BenchmarkTaskRow`](#benchmarktaskrow)[]

Defined in: [runtime/run-benchmark.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L102)

The full per-task × per-strategy table — the LOSSES an optimizer (GEPA, a
 strategy-author, an operator) consumes. Includes errored tasks with the reason.

##### pareto

> **pareto**: `string`[]

Defined in: [runtime/run-benchmark.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L105)

The non-dominated strategies on (score ↑, $/task ↓) — collapse-last, per the canon:
 a strategy that ties on score at half the cost WINS and a scalar would hide it.

##### refineVsSample?

> `optional` **refineVsSample?**: [`BenchmarkLift`](#benchmarklift)

Defined in: [runtime/run-benchmark.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L107)

The headline when both `refine` and `sample` ran: paired-bootstrap lift of refine over sample.

***

### SandboxCapabilities

Defined in: [runtime/sandbox-capabilities.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L26)

**`Experimental`**

What the loop kernel is allowed to know about a sandbox backend: a single
capability bit, never the backend's identity. `canFork` gates the
checkpoint+fork fanout path; everything else (session continuation) is a
universal SDK feature that needs no probe.

#### Properties

##### canFork

> **canFork**: `boolean`

Defined in: [runtime/sandbox-capabilities.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L32)

**`Experimental`**

True only when `client.criuStatus()` returned `{ available: true }`. When
false, a fork-enabled fanout degrades to independent fresh boxes — same
result, no shared context prefix.

***

### CriuCapableClient

Defined in: [runtime/sandbox-capabilities.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L73)

**`Experimental`**

Narrowed view of the optional CRIU probe. The loop-side `SandboxClient`
does not require `criuStatus`; this widens it optionally so the probe can be
read without importing sandbox-backend specifics.

#### Properties

##### criuStatus?

> `optional` **criuStatus?**: () => `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [runtime/sandbox-capabilities.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L74)

**`Experimental`**

###### Returns

`Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

***

### SandboxLineageHandle

Defined in: [runtime/sandbox-lineage.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L113)

**`Experimental`**

A live box plus the session that threads its iterations together. Handed back
by `start`/`fork`, passed into `continue`/`fork` to descend from. Opaque to
the kernel beyond `box` (for placement/teardown) and `sessionId` (trace).

#### Properties

##### box

> **box**: `SandboxInstance`

Defined in: [runtime/sandbox-lineage.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L115)

**`Experimental`**

The owned, running sandbox this handle drives.

##### sessionId

> **sessionId**: `string`

Defined in: [runtime/sandbox-lineage.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L122)

**`Experimental`**

Stable session id threaded through this box's `streamPrompt` calls. Minted
by the lineage on `start`; reused on `continue` so the server continues the
same conversation. A forked handle starts a fresh session on its new box —
the shared context comes from the checkpoint, not a shared session id.

***

### SandboxLineage

Defined in: [runtime/sandbox-lineage.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L131)

**`Experimental`**

Owns box + session handles for one loop run and offers the three
capability-gated lifecycle moves. Construct via `createSandboxLineage`.

#### Methods

##### start()

> **start**(`spec`, `prompt`, `signal`): `Promise`\<\{ `handle`: [`SandboxLineageHandle`](#sandboxlineagehandle); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

Defined in: [runtime/sandbox-lineage.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L136)

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

###### Returns

`Promise`\<\{ `handle`: [`SandboxLineageHandle`](#sandboxlineagehandle); `events`: `AsyncIterable`\<`SandboxEvent`\>; \}\>

##### continue()

> **continue**(`handle`, `prompt`, `signal`): `Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

Defined in: [runtime/sandbox-lineage.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L148)

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

###### Returns

`Promise`\<`AsyncIterable`\<`SandboxEvent`, `any`, `any`\>\>

##### fork()

> **fork**(`parent`, `prompts`, `specs`, `signal`): `Promise`\<`object`[]\>

Defined in: [runtime/sandbox-lineage.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L164)

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

Defined in: [runtime/sandbox-lineage.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L177)

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

Defined in: [runtime/sandbox-lineage.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L179)

**`Experimental`**

Destroy every box this lineage owns. Best-effort, bounded, parallel.

###### Returns

`Promise`\<`void`\>

***

### CheckpointCapableBox

Defined in: [runtime/sandbox-lineage.ts:375](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L375)

**`Experimental`**

Loop-side widening of the box's optional checkpoint method. The
`SandboxClient`/`SandboxInstance` surface the kernel relies on does not
require checkpointing; this reads it optionally so the lineage can probe-gate
without importing sandbox-backend specifics.

#### Properties

##### checkpoint?

> `optional` **checkpoint?**: (`options?`) => `Promise`\<\{ `checkpointId`: `string`; \}\>

Defined in: [runtime/sandbox-lineage.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L376)

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

Defined in: [runtime/sandbox-lineage.ts:382](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L382)

**`Experimental`**

Loop-side widening of the box's optional fork method.

#### Properties

##### fork?

> `optional` **fork?**: (`checkpointId`, `options?`) => `Promise`\<`SandboxInstance`\>

Defined in: [runtime/sandbox-lineage.ts:383](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L383)

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

Defined in: [runtime/sandbox-lineage.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L393)

**`Experimental`**

Loop-side widening of the box's optional session accessor. The real
`SandboxInstance` exposes `session(id).status()`; the loop reads it optionally
so `continue` can assert session liveness without requiring it of the test
fakes. `status()` resolves `null` when the id is unknown to the sandbox.

#### Properties

##### session?

> `optional` **session?**: (`id`) => `object`

Defined in: [runtime/sandbox-lineage.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L394)

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

Defined in: [runtime/sandbox-run.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L60)

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

Defined in: [runtime/sandbox-run.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L61)

**`Experimental`**

##### events

> **events**: `SandboxEvent`[]

Defined in: [runtime/sandbox-run.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L62)

**`Experimental`**

##### readError?

> `optional` **readError?**: `string`

Defined in: [runtime/sandbox-run.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L63)

**`Experimental`**

***

### SandboxRun

Defined in: [runtime/sandbox-run.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L68)

**`Experimental`**

A live run over ONE persistent artifact (box + session). Close it
 when done — `close()` tears the box down.

#### Type Parameters

##### Out

`Out`

#### Properties

##### box

> `readonly` **box**: `SandboxInstance`

Defined in: [runtime/sandbox-run.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L69)

**`Experimental`**

##### sessionId

> `readonly` **sessionId**: `string`

Defined in: [runtime/sandbox-run.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L70)

**`Experimental`**

#### Methods

##### start()

> **start**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L72)

**`Experimental`**

First turn over the fresh box (mints the session). Throws if already started.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### resume()

> **resume**(`prompt`): `Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L74)

**`Experimental`**

Continue THE SAME session over THE SAME artifact — a resumed turn/rollout.

###### Parameters

###### prompt

`string`

###### Returns

`Promise`\<[`TurnResult`](#turnresult)\<`Out`\>\>

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: [runtime/sandbox-run.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L75)

**`Experimental`**

###### Returns

`Promise`\<`void`\>

***

### OpenSandboxRunOptions

Defined in: [runtime/sandbox-run.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L79)

**`Experimental`**

#### Properties

##### agentRun

> **agentRun**: [`AgentRunSpec`](#agentrunspec)\<`string`\>

Defined in: [runtime/sandbox-run.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L81)

**`Experimental`**

Profile + sandbox env/overrides. `sandboxOverrides.backend.type` is the harness.

##### signal

> **signal**: `AbortSignal`

Defined in: [runtime/sandbox-run.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L82)

**`Experimental`**

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/sandbox-run.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L84)

**`Experimental`**

Optional execution-scoped observers. Hook failures never fail the run.

##### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/sandbox-run.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L86)

**`Experimental`**

Stable run id for trace joins. Defaults to a short runtime-minted id.

##### scenarioId?

> `optional` **scenarioId?**: `string`

Defined in: [runtime/sandbox-run.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L88)

**`Experimental`**

Optional benchmark/scenario id carried into emitted hook events.

##### now?

> `optional` **now?**: () => `number`

Defined in: [runtime/sandbox-run.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L90)

**`Experimental`**

Test seam for deterministic hook timestamps. Defaults to `Date.now`.

###### Returns

`number`

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: [runtime/sandbox-run.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L92)

**`Experimental`**

Bounds box-creation bursts inside lineage fanout. Default from lineage.

##### readRetryDelayMs?

> `optional` **readRetryDelayMs?**: `number`

Defined in: [runtime/sandbox-run.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L95)

**`Experimental`**

Base backoff (ms) for retrying a transient artifact `fs.read` failure; the i-th
 retry waits `readRetryDelayMs * i`. Default 1000. Set 0 to disable the wait (tests).

***

### AuthorStrategyOptions

Defined in: [runtime/strategy-author.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L77)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [runtime/strategy-author.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L79)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/strategy-author.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L80)

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: [runtime/strategy-author.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L85)

A NAMED fallback author tried once when the primary call fails or returns no code
 block (thinking models time out at the edge on long authoring prompts, or return
 empty content without `maxTokens`). Opt-in — absent means the primary's failure
 propagates.

##### contract?

> `optional` **contract?**: `string`

Defined in: [runtime/strategy-author.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L89)

The contract text shown to the author. Default `strategyAuthorContract`. The
 meta-optimization coordinate: a GEPA/skill loop can evolve this text and gate each
 variant on the same frozen holdout as any strategy.

##### environmentName

> **environmentName**: `string`

Defined in: [runtime/strategy-author.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L91)

The environment the losses came from (orientation only — never the verifiers).

##### lossesJson

> **lossesJson**: `string`

Defined in: [runtime/strategy-author.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L93)

The per-task losses table (e.g. JSON.stringify(report.perTask)) — the gradient.

##### budget

> **budget**: `number`

Defined in: [runtime/strategy-author.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L95)

The budget the strategy must respect (shots/width).

##### outDir

> **outDir**: `string`

Defined in: [runtime/strategy-author.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L97)

Where the authored module file is written (created if missing).

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy-author.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L98)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy-author.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L100)

Completion cap — required by thinking-model authors that stream reasoning first.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/strategy-author.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L101)

***

### AuthoredStrategy

Defined in: [runtime/strategy-author.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L137)

#### Properties

##### strategy

> **strategy**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy-author.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L138)

##### file

> **file**: `string`

Defined in: [runtime/strategy-author.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L139)

##### code

> **code**: `string`

Defined in: [runtime/strategy-author.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L140)

***

### EvolutionAuthor

Defined in: [runtime/strategy-evolution.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L46)

#### Properties

##### chat

> **chat**: `ChatClient`

Defined in: [runtime/strategy-evolution.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L48)

The model-call seam (agent-eval `createChatClient`).

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/strategy-evolution.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L49)

##### fallbackModel?

> `optional` **fallbackModel?**: `string`

Defined in: [runtime/strategy-evolution.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L50)

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy-evolution.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L51)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy-evolution.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L52)

***

### StrategyEvolutionConfig

Defined in: [runtime/strategy-evolution.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L57)

#### Properties

##### environment

> **environment**: [`AgenticSurface`](#agenticsurface)

Defined in: [runtime/strategy-evolution.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L58)

##### tasks

> **tasks**: (`offset`, `n`) => `Promise`\<[`AgenticTask`](#agentictask)[]\>

Defined in: [runtime/strategy-evolution.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L62)

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

Defined in: [runtime/strategy-evolution.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L63)

##### holdoutN

> **holdoutN**: `number`

Defined in: [runtime/strategy-evolution.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L64)

##### holdoutOffset?

> `optional` **holdoutOffset?**: `number`

Defined in: [runtime/strategy-evolution.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L66)

Extra offset past the train slice for the holdout draw (rotate across runs).

##### worker

> **worker**: [`AgenticOptions`](#agenticoptions)

Defined in: [runtime/strategy-evolution.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L67)

##### author

> **author**: [`EvolutionAuthor`](#evolutionauthor)

Defined in: [runtime/strategy-evolution.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L68)

##### budget?

> `optional` **budget?**: `number`

Defined in: [runtime/strategy-evolution.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L70)

Rollouts (sample) / shots (refine) per strategy per task. Default 3.

##### concurrency?

> `optional` **concurrency?**: `number`

Defined in: [runtime/strategy-evolution.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L71)

##### generations?

> `optional` **generations?**: `number`

Defined in: [runtime/strategy-evolution.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L73)

Author→tournament rounds after gen0. Default 2.

##### populationSize?

> `optional` **populationSize?**: `number`

Defined in: [runtime/strategy-evolution.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L75)

Authored candidates per generation. Default 2.

##### baselines?

> `optional` **baselines?**: [`Strategy`](#strategy-3)[]

Defined in: [runtime/strategy-evolution.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L77)

The gen0 field. Default [sample, refine, sampleThenRefine].

##### objective?

> `optional` **objective?**: `"score"` \| `"cost"`

Defined in: [runtime/strategy-evolution.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L83)

What "better" means for PROMOTION. 'score' (default): the candidate must beat the
 incumbent's score (superiority gate). 'cost': the candidate must prove score
 NON-INFERIORITY (not worse by more than `scoreTolerance`) plus significant cost
 savings — the "same quality, cheaper" objective. The author is told the objective
 and sees per-task spend either way.

##### scoreTolerance?

> `optional` **scoreTolerance?**: `number`

Defined in: [runtime/strategy-evolution.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L85)

Cost objective: the score CI lower bound must clear −scoreTolerance. Default 0.05.

##### champion?

> `optional` **champion?**: [`ChampionPolicy`](#championpolicy)

Defined in: [runtime/strategy-evolution.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L87)

Search-side champion selection. Default 'costAware'.

##### championEpsilon?

> `optional` **championEpsilon?**: `number`

Defined in: [runtime/strategy-evolution.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L89)

Score band treated as a tie under 'costAware'. Default 0.01.

##### outDir

> **outDir**: `string`

Defined in: [runtime/strategy-evolution.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L91)

Where authored modules are written.

##### minPairedTasks?

> `optional` **minPairedTasks?**: `number`

Defined in: [runtime/strategy-evolution.ts:93](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L93)

Promotion-gate evidence floor (paired holdout tasks).

##### band?

> `optional` **band?**: `object`

Defined in: [runtime/strategy-evolution.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L102)

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

Defined in: [runtime/strategy-evolution.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L111)

What the author learns from a tournament. 'exact' (default) = scores + progressions
 per task; 'binary' = pass/fail only — the leakage-bounded channel (one bit per cell
 per generation reaches the author from the evaluation data).

##### reproducerCheck?

> `optional` **reproducerCheck?**: `object`

Defined in: [runtime/strategy-evolution.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L118)

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

Defined in: [runtime/strategy-evolution.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L128)

Endurance: write the run state after every completed phase; with `resume`, a
 restart skips completed phases (authored modules re-imported from their files).
 Worst case after a mid-run death is re-paying ONE phase, never the run.

###### path

> **path**: `string`

###### resume?

> `optional` **resume?**: `boolean`

##### onPhase?

> `optional` **onPhase?**: (`phase`) => `Promise`\<`void`\>

Defined in: [runtime/strategy-evolution.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L135)

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

Defined in: [runtime/strategy-evolution.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L136)

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

Defined in: [runtime/strategy-evolution.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L137)

***

### ChampionPick

Defined in: [runtime/strategy-evolution.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L152)

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/strategy-evolution.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L153)

##### score

> **score**: `number`

Defined in: [runtime/strategy-evolution.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L154)

##### usd

> **usd**: `number`

Defined in: [runtime/strategy-evolution.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L155)

***

### EvolutionCandidate

Defined in: [runtime/strategy-evolution.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L158)

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/strategy-evolution.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L159)

##### file?

> `optional` **file?**: `string`

Defined in: [runtime/strategy-evolution.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L160)

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: [runtime/strategy-evolution.ts:161](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L161)

##### codeChars?

> `optional` **codeChars?**: `number`

Defined in: [runtime/strategy-evolution.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L162)

##### error?

> `optional` **error?**: `string`

Defined in: [runtime/strategy-evolution.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L164)

Present when this author attempt failed (recorded, never silent).

***

### EvolutionGeneration

Defined in: [runtime/strategy-evolution.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L167)

#### Properties

##### generation

> **generation**: `number`

Defined in: [runtime/strategy-evolution.ts:168](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L168)

##### candidates

> **candidates**: [`EvolutionCandidate`](#evolutioncandidate)[]

Defined in: [runtime/strategy-evolution.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L169)

##### report

> **report**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [runtime/strategy-evolution.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L170)

##### champion

> **champion**: [`ChampionPick`](#championpick)

Defined in: [runtime/strategy-evolution.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L171)

***

### EvolutionArchiveNode

Defined in: [runtime/strategy-evolution.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L174)

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/strategy-evolution.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L175)

##### source

> **source**: `"baseline"` \| `"authored"`

Defined in: [runtime/strategy-evolution.ts:176](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L176)

##### generation

> **generation**: `number`

Defined in: [runtime/strategy-evolution.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L177)

##### parent?

> `optional` **parent?**: `string`

Defined in: [runtime/strategy-evolution.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L179)

The champion whose tournament losses this candidate was authored from.

##### gzipBits?

> `optional` **gzipBits?**: `number`

Defined in: [runtime/strategy-evolution.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L180)

##### file?

> `optional` **file?**: `string`

Defined in: [runtime/strategy-evolution.ts:181](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L181)

##### score

> **score**: `number`

Defined in: [runtime/strategy-evolution.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L184)

Latest measured tournament result — 0 until the node's first tournament settles
 (an authored node is created before its generation's benchmark runs).

##### usd

> **usd**: `number`

Defined in: [runtime/strategy-evolution.ts:185](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L185)

***

### EvolutionBandInfo

Defined in: [runtime/strategy-evolution.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L204)

#### Properties

##### screened

> **screened**: `number`

Defined in: [runtime/strategy-evolution.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L206)

Tasks screened by the reference on the holdout pool.

##### inBand

> **inBand**: `number`

Defined in: [runtime/strategy-evolution.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L208)

Tasks kept (reference score ≤ maxRefScore) before truncating to holdoutN.

##### refScores

> **refScores**: `object`[]

Defined in: [runtime/strategy-evolution.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L210)

Reference scores per screened task (the screening record).

###### taskId

> **taskId**: `string`

###### score

> **score**: `number`

***

### EvolutionReport

Defined in: [runtime/strategy-evolution.ts:213](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L213)

#### Properties

##### gen0

> **gen0**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [runtime/strategy-evolution.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L214)

##### gen0Champion

> **gen0Champion**: [`ChampionPick`](#championpick)

Defined in: [runtime/strategy-evolution.ts:215](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L215)

##### generations

> **generations**: [`EvolutionGeneration`](#evolutiongeneration)[]

Defined in: [runtime/strategy-evolution.ts:216](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L216)

##### archive

> **archive**: [`EvolutionArchiveNode`](#evolutionarchivenode)[]

Defined in: [runtime/strategy-evolution.ts:217](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L217)

##### finalChampion

> **finalChampion**: [`ChampionPick`](#championpick)

Defined in: [runtime/strategy-evolution.ts:218](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L218)

##### holdout

> **holdout**: [`BenchmarkReport`](#benchmarkreport)

Defined in: [runtime/strategy-evolution.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L219)

##### verdict

> **verdict**: [`PromotionVerdict`](#promotionverdict)

Defined in: [runtime/strategy-evolution.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L220)

##### band?

> `optional` **band?**: [`EvolutionBandInfo`](#evolutionbandinfo)

Defined in: [runtime/strategy-evolution.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L223)

Present when band screening ran — the verdict's estimand is then "paired lift on
 headroom tasks" (band membership fixed by the reference screen, pre-registered).

##### reproduction?

> `optional` **reproduction?**: `ReproductionCheck`

Defined in: [runtime/strategy-evolution.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L225)

Present when reproducerCheck ran (final champion was authored).

##### trajectory

> **trajectory**: `object`[]

Defined in: [runtime/strategy-evolution.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L230)

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

Defined in: [runtime/strategy.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L48)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [runtime/strategy.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L49)

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [runtime/strategy.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L50)

##### userPrompt

> `readonly` **userPrompt**: `string`

Defined in: [runtime/strategy.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L51)

##### meta?

> `readonly` `optional` **meta?**: `Record`\<`string`, `unknown`\>

Defined in: [runtime/strategy.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L53)

Opaque domain payload the surface reads (EOPS: servers/verifiers/tools). Drivers never read it.

***

### ArtifactHandle

Defined in: [runtime/strategy.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L56)

#### Properties

##### id

> `readonly` **id**: `string`

Defined in: [runtime/strategy.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L57)

##### surface

> `readonly` **surface**: `string`

Defined in: [runtime/strategy.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L58)

##### ctx?

> `readonly` `optional` **ctx?**: `unknown`

Defined in: [runtime/strategy.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L60)

Opaque per-artifact context the surface stashes (EOPS: the seeded gym server + db id).

***

### AgenticTool

Defined in: [runtime/strategy.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L63)

#### Properties

##### type

> `readonly` **type**: `"function"`

Defined in: [runtime/strategy.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L64)

##### function

> `readonly` **function**: `object`

Defined in: [runtime/strategy.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L65)

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters

> **parameters**: `Record`\<`string`, `unknown`\>

***

### SurfaceScore

Defined in: [runtime/strategy.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L68)

#### Properties

##### passes

> **passes**: `number`

Defined in: [runtime/strategy.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L69)

##### total

> **total**: `number`

Defined in: [runtime/strategy.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L70)

##### errored

> **errored**: `number`

Defined in: [runtime/strategy.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L72)

Checks excluded as malformed (data defect, not the agent). `total === 0` ⇒ unscoreable.

***

### AgenticSurface

Defined in: [runtime/strategy.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L76)

A stateful, checkable environment an agent operates over with tools. Open behind one interface.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [runtime/strategy.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L77)

#### Methods

##### open()

> **open**(`task`): `Promise`\<[`ArtifactHandle`](#artifacthandle)\>

Defined in: [runtime/strategy.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L78)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### Returns

`Promise`\<[`ArtifactHandle`](#artifacthandle)\>

##### tools()

> **tools**(`task`, `handle`): `Promise`\<[`AgenticTool`](#agentictool)[]\>

Defined in: [runtime/strategy.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L79)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`AgenticTool`](#agentictool)[]\>

##### call()

> **call**(`handle`, `name`, `args`): `Promise`\<`string`\>

Defined in: [runtime/strategy.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L80)

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

Defined in: [runtime/strategy.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L81)

###### Parameters

###### task

[`AgenticTask`](#agentictask)

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<[`SurfaceScore`](#surfacescore)\>

##### close()

> **close**(`handle`): `Promise`\<`void`\>

Defined in: [runtime/strategy.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L82)

###### Parameters

###### handle

[`ArtifactHandle`](#artifacthandle)

###### Returns

`Promise`\<`void`\>

***

### AgenticOptions

Defined in: [runtime/strategy.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L85)

#### Extended by

- [`RunAgenticOptions`](#runagenticoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

##### routerKey

> **routerKey**: `string`

Defined in: [runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

##### model

> **model**: `string`

Defined in: [runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L89)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L92)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

Turns the agent may take within ONE shot before the driver intervenes.

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/strategy.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L97)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [runtime/strategy.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L104)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Priming (the read side) is the caller's move —
 query the corpus and fold facts into the task's systemPrompt before runAgentic.

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

Tags written onto learned facts (and used by the caller's priming query).

***

### AgenticRunResult

Defined in: [runtime/strategy.ts:505](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L505)

#### Properties

##### mode

> **mode**: `string`

Defined in: [runtime/strategy.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L507)

The strategy name (built-in 'depth'/'breadth' or a custom strategy's name).

##### score

> **score**: `number`

Defined in: [runtime/strategy.ts:508](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L508)

##### resolved

> **resolved**: `boolean`

Defined in: [runtime/strategy.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L509)

##### completions

> **completions**: `number`

Defined in: [runtime/strategy.ts:510](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L510)

##### progression

> **progression**: `number`[]

Defined in: [runtime/strategy.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L512)

DEPTH: score after each shot — the progress-over-rounds curve. BREADTH: best-so-far per rollout.

##### shots

> **shots**: `number`

Defined in: [runtime/strategy.ts:513](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L513)

##### usd

> **usd**: `number`

Defined in: [runtime/strategy.ts:516](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L516)

The cost vector, stamped by `runAgentic` from the Supervisor's conserved pool: real
 router tokens, priced usd (0 when the model is unpriced — never fabricated), wall ms.

##### ms

> **ms**: `number`

Defined in: [runtime/strategy.ts:517](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L517)

##### tokens

> **tokens**: `object`

Defined in: [runtime/strategy.ts:518](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L518)

###### input

> **input**: `number`

###### output

> **output**: `number`

***

### Strategy

Defined in: [runtime/strategy.ts:652](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L652)

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

Defined in: [runtime/strategy.ts:653](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L653)

#### Methods

##### driver()

> **driver**(`surface`, `task`, `opts`, `budget`): [`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:654](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L654)

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

[`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### ShotPersona

Defined in: [runtime/strategy.ts:682](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L682)

A role for one shot — multi-agent loops (researcher + engineer, a panel of k
 researchers) give each shot its own system prompt and optionally its own model.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: [runtime/strategy.ts:685](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L685)

Replaces the task's systemPrompt for a FRESH shot; on a carried conversation it is
 injected as a hand-off message (the transcript's earlier roles stay intact).

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/strategy.ts:687](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L687)

Per-shot model override (e.g. a stronger model for the engineer shot).

***

### ShotSpec

Defined in: [runtime/strategy.ts:690](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L690)

#### Properties

##### handle?

> `optional` **handle?**: [`ArtifactHandle`](#artifacthandle)

Defined in: [runtime/strategy.ts:692](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L692)

present ⇒ continue this artifact (depth); absent ⇒ the shot opens a fresh one (sample/restart).

##### messages?

> `optional` **messages?**: `Msg`[]

Defined in: [runtime/strategy.ts:693](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L693)

##### steer?

> `optional` **steer?**: `string`

Defined in: [runtime/strategy.ts:694](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L694)

##### persona?

> `optional` **persona?**: [`ShotPersona`](#shotpersona)

Defined in: [runtime/strategy.ts:695](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L695)

##### tools?

> `optional` **tools?**: `string`[]

Defined in: [runtime/strategy.ts:698](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L698)

Restrict THIS shot to a subset of the domain's tools (by name) — focus a shot on
 the relevant capabilities. Restriction-only; unknown names throw. Omitted ⇒ all.

***

### StrategyResult

Defined in: [runtime/strategy.ts:700](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L700)

#### Properties

##### score

> **score**: `number`

Defined in: [runtime/strategy.ts:701](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L701)

##### resolved

> **resolved**: `boolean`

Defined in: [runtime/strategy.ts:702](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L702)

##### completions

> **completions**: `number`

Defined in: [runtime/strategy.ts:703](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L703)

##### progression

> **progression**: `number`[]

Defined in: [runtime/strategy.ts:704](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L704)

##### shots

> **shots**: `number`

Defined in: [runtime/strategy.ts:705](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L705)

***

### StrategyCtx

Defined in: [runtime/strategy.ts:717](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L717)

What a strategy body composes with: the artifact lifecycle, the budget, and the two steps.

#### Properties

##### surface

> `readonly` **surface**: `StrategyArtifacts`

Defined in: [runtime/strategy.ts:719](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L719)

Open/close artifacts the body manages itself (e.g. one persistent handle for depth).

##### task

> `readonly` **task**: [`AgenticTask`](#agentictask)

Defined in: [runtime/strategy.ts:720](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L720)

##### opts

> `readonly` **opts**: [`AgenticOptions`](#agenticoptions)

Defined in: [runtime/strategy.ts:721](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L721)

##### budget

> `readonly` **budget**: `number`

Defined in: [runtime/strategy.ts:722](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L722)

##### scope

> `readonly` **scope**: [`Scope`](#scope-1)\<[`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:723](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L723)

#### Methods

##### shot()

> **shot**(`spec?`): `Promise`\<`ShotResult` \| `null`\>

Defined in: [runtime/strategy.ts:725](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L725)

Run ONE worker shot; its harness-scored result, or null if it went down.

###### Parameters

###### spec?

[`ShotSpec`](#shotspec)

###### Returns

`Promise`\<`ShotResult` \| `null`\>

##### critique()

> **critique**(`messages`): `Promise`\<`string` \| `null`\>

Defined in: [runtime/strategy.ts:727](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L727)

The firewalled critic reads the trajectory → a steer string, or null on COMPLETE/down.

###### Parameters

###### messages

`Msg`[]

###### Returns

`Promise`\<`string` \| `null`\>

##### consult()

> **consult**(`messages`, `instruction`): `Promise`\<`string` \| `null`\>

Defined in: [runtime/strategy.ts:732](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L732)

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

Defined in: [runtime/strategy.ts:736](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L736)

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

Defined in: [runtime/strategy.ts:965](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L965)

#### Extends

- [`AgenticOptions`](#agenticoptions)

#### Properties

##### routerBaseUrl

> **routerBaseUrl**: `string`

Defined in: [runtime/strategy.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L86)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerBaseUrl`](#routerbaseurl-1)

##### routerKey

> **routerKey**: `string`

Defined in: [runtime/strategy.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L87)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`routerKey`](#routerkey-1)

##### model

> **model**: `string`

Defined in: [runtime/strategy.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L88)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`model`](#model-6)

##### temperature?

> `optional` **temperature?**: `number`

Defined in: [runtime/strategy.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L89)

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`temperature`](#temperature-2)

##### maxTokens?

> `optional` **maxTokens?**: `number`

Defined in: [runtime/strategy.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L92)

Completion cap per worker turn — REQUIRED for thinking models (they burn unbounded
 budgets on reasoning and return empty content without it). Omitted ⇒ provider default.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`maxTokens`](#maxtokens-2)

##### innerTurns?

> `optional` **innerTurns?**: `number`

Defined in: [runtime/strategy.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L94)

Turns the agent may take within ONE shot before the driver intervenes.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`innerTurns`](#innerturns)

##### analystInstruction?

> `optional` **analystInstruction?**: `string`

Defined in: [runtime/strategy.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L97)

The depth STEERER's analyst instruction (observe()'s system prompt). The knob a
 prompt optimizer (GEPA) tunes — the analyst IS the steerer. Omitted ⇒ the default.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`analystInstruction`](#analystinstruction-2)

##### analystModel?

> `optional` **analystModel?**: `string`

Defined in: [runtime/strategy.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L100)

The critic's model — lets the analyst be a stronger (or cheaper) model than the
 worker. Omitted ⇒ the worker's `model`.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`analystModel`](#analystmodel)

##### corpus?

> `optional` **corpus?**: [`Corpus`](#corpus-2)

Defined in: [runtime/strategy.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L104)

Across-run learning: when set, the analyst's observe() pass appends trace-derived
 facts here (the flywheel write side). Priming (the read side) is the caller's move —
 query the corpus and fold facts into the task's systemPrompt before runAgentic.

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpus`](#corpus-4)

##### corpusTags?

> `optional` **corpusTags?**: `string`[]

Defined in: [runtime/strategy.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L106)

Tags written onto learned facts (and used by the caller's priming query).

###### Inherited from

[`AgenticOptions`](#agenticoptions).[`corpusTags`](#corpustags)

##### surface

> **surface**: [`AgenticSurface`](#agenticsurface)

Defined in: [runtime/strategy.ts:966](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L966)

##### task

> **task**: [`AgenticTask`](#agentictask)

Defined in: [runtime/strategy.ts:967](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L967)

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/strategy.ts:970](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L970)

Lifecycle observability — every spawn/settle (shots, analysts) streams here live.
 The seam online watchdogs/route-auditors subscribe to.

##### strategy?

> `optional` **strategy?**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:972](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L972)

A Strategy (the open way) — author/pass your own. Overrides `mode` when present.

##### mode?

> `optional` **mode?**: `"depth"` \| `"breadth"`

Defined in: [runtime/strategy.ts:974](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L974)

Built-in shorthand: 'depth'→refine, 'breadth'→sample. Default 'depth'.

##### budget

> **budget**: `number`

Defined in: [runtime/strategy.ts:976](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L976)

budget: refine→max shots; sample→rollout width.

##### rootBudget?

> `optional` **rootBudget?**: [`Budget`](#budget-9)

Defined in: [runtime/strategy.ts:977](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L977)

***

### AuthoredProfile

Defined in: [runtime/supervise/authoring.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L24)

What the supervisor AUTHORS per sub-task — a worker recipe (a partial `AgentProfile`).

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/supervise/authoring.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L25)

##### systemPrompt

> **systemPrompt**: `string`

Defined in: [runtime/supervise/authoring.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L27)

The rich, task-specific instructions the supervisor wrote for THIS worker.

##### model?

> `optional` **model?**: `string`

Defined in: [runtime/supervise/authoring.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L29)

The model the supervisor chose for this sub-task (falls back to the run default).

***

### ProfileRichnessThresholds

Defined in: [runtime/supervise/authoring.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L131)

Thresholds below which a system prompt is treated as a thin stub. Tunable per call.

#### Properties

##### minSystemPromptChars

> `readonly` **minSystemPromptChars**: `number`

Defined in: [runtime/supervise/authoring.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L133)

A prompt shorter than this many characters is thin (default 600).

##### minSystemPromptLines

> `readonly` **minSystemPromptLines**: `number`

Defined in: [runtime/supervise/authoring.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L135)

A prompt with fewer than this many non-blank lines is thin (default 6).

***

### ProfileRichness

Defined in: [runtime/supervise/authoring.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L144)

Per-field verdict on one authored profile — the raw material the bench renders + scores.

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [runtime/supervise/authoring.ts:145](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L145)

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: [runtime/supervise/authoring.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L148)

The resolved system prompt (canonical `prompt.systemPrompt`, the sandbox `prompt.system`
 convention, or a bare-string prompt — whichever the author used).

##### systemPromptChars

> `readonly` **systemPromptChars**: `number`

Defined in: [runtime/supervise/authoring.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L149)

##### systemPromptLines

> `readonly` **systemPromptLines**: `number`

Defined in: [runtime/supervise/authoring.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L150)

##### sentenceCount

> `readonly` **sentenceCount**: `number`

Defined in: [runtime/supervise/authoring.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L151)

##### hasDescription

> `readonly` **hasDescription**: `boolean`

Defined in: [runtime/supervise/authoring.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L152)

##### hasTools

> `readonly` **hasTools**: `boolean`

Defined in: [runtime/supervise/authoring.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L153)

##### hasSkills

> `readonly` **hasSkills**: `boolean`

Defined in: [runtime/supervise/authoring.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L154)

##### hasMcp

> `readonly` **hasMcp**: `boolean`

Defined in: [runtime/supervise/authoring.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L155)

##### hasSubagents

> `readonly` **hasSubagents**: `boolean`

Defined in: [runtime/supervise/authoring.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L156)

##### richness

> `readonly` **richness**: `number`

Defined in: [runtime/supervise/authoring.ts:158](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L158)

0..1 — fraction of richness signals present (prompt-depth + the four levers).

##### thin

> `readonly` **thin**: `boolean`

Defined in: [runtime/supervise/authoring.ts:160](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L160)

True when the supervisor authored a stub instead of a real profile.

##### reasons

> `readonly` **reasons**: `string`[]

Defined in: [runtime/supervise/authoring.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L162)

The specific reasons it is thin (empty when rich) — used in the finding's action.

***

### ReservationTicket

Defined in: [runtime/supervise/budget.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L29)

Opaque, single-use reservation handle returned by `reserve` and consumed by
 `reconcile`. Carries the reserved ceilings so reconciliation needs no lookup.

#### Properties

##### id

> `readonly` **id**: `number`

Defined in: [runtime/supervise/budget.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L30)

##### reserved

> `readonly` **reserved**: `object`

Defined in: [runtime/supervise/budget.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L31)

###### tokens

> `readonly` **tokens**: `number`

###### usd

> `readonly` **usd**: `number`

###### iterations

> `readonly` **iterations**: `number`

***

### BudgetPool

Defined in: [runtime/supervise/budget.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L51)

#### Methods

##### reserve()

> **reserve**(`b`): \{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

Defined in: [runtime/supervise/budget.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L57)

Atomically reserve a child's full ceiling from the free balance. Fails closed
({ ok: false }) when the pool can't cover tokens, usd, or iterations — the
caller inspects `ok` before `ticket`.

###### Parameters

###### b

[`Budget`](#budget-9)

###### Returns

\{ `ok`: `true`; `ticket`: [`ReservationTicket`](#reservationticket); \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"`; \}

##### reconcile()

> **reconcile**(`ticket`, `spent`): `void`

Defined in: [runtime/supervise/budget.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L65)

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

Defined in: [runtime/supervise/budget.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L69)

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

Defined in: [runtime/supervise/budget.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L71)

The current readout, reflecting all outstanding reservations.

###### Returns

[`BudgetReadout`](#budgetreadout)

##### observe()

> **observe**(`spend`): `void`

Defined in: [runtime/supervise/budget.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L82)

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

Defined in: [runtime/supervise/budget.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L86)

Fail loud if any reservation is still open — the conserved-pool leak detector. Called at the
 supervisor's join barrier: once every child has settled, no ticket may remain (a leaked
 reservation would silently break `total ≡ free + reserved + committed`).

###### Returns

`void`

***

### DeliverableSpec

Defined in: [runtime/supervise/completion-gate.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L31)

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

Defined in: [runtime/supervise/completion-gate.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L33)

The deployable check that decides DELIVERED. `settled.valid ⟺ this resolves true`.

###### Parameters

###### out

`Out`

###### Returns

`boolean` \| `Promise`\<`boolean`\>

##### describe?

> `optional` **describe?**: `string`

Defined in: [runtime/supervise/completion-gate.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L35)

What the spawn was supposed to produce — surfaced in traces/reports.

***

### DriverAgentOptions

Defined in: [runtime/supervise/coordination-driver.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L39)

#### Properties

##### name

> `readonly` **name**: `string`

Defined in: [runtime/supervise/coordination-driver.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L40)

##### brain

> `readonly` **brain**: [`ToolLoopChat`](#toolloopchat)

Defined in: [runtime/supervise/coordination-driver.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L44)

The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
 (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
 production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/supervise/coordination-driver.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L46)

Shared blob store — `observe_agent` reads settled outputs through it.

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](mcp.md#makeworkeragent)

Defined in: [runtime/supervise/coordination-driver.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L48)

Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-9)

Defined in: [runtime/supervise/coordination-driver.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L50)

Per-child budget reserved from the conserved pool on each spawn.

##### systemPrompt

> `readonly` **systemPrompt**: `string` \| ((`task`) => `string`)

Defined in: [runtime/supervise/coordination-driver.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L53)

The driver's stance — a string, or built from the task (the worker-driver prompt /
 the generator). INJECTED so the prompt is a pluggable, optimizable role.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [runtime/supervise/coordination-driver.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L58)

WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
 not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
 Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
 `executeExtraTool`. Unset → coordination-only (the prior behavior).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [runtime/supervise/coordination-driver.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L65)

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

Defined in: [runtime/supervise/coordination-driver.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L73)

Max driver turns before the loop force-finalizes on the best settled child. Default 16.
 `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
 an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
 anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool.

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/supervise/coordination-driver.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L76)

Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
 deterministic in tests. Defaults to `Date.now`.

###### Returns

`number`

***

### CoordinationMcpHandle

Defined in: [runtime/supervise/coordination-mcp.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L33)

#### Properties

##### url

> `readonly` **url**: `string`

Defined in: [runtime/supervise/coordination-mcp.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L35)

The URL an in-box harness mounts as `mcp.mcpServers.coordination.url`.

##### port

> `readonly` **port**: `number`

Defined in: [runtime/supervise/coordination-mcp.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L36)

##### history

> **history**: () => readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](#coordinationevent)\>[]

Defined in: [runtime/supervise/coordination-mcp.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L41)

The full ordered bus-event log — observability audit + replay trail.

The full ordered log of every bus event — UP (settled / question / finding) and DOWN
 (steer / answer) — the observability audit + replay trail. Each record carries seq,
 timestamp, and priority.

###### Returns

readonly [`BusRecord`](#busrecord)\<[`CoordinationEvent`](#coordinationevent)\>[]

##### stats

> **stats**: () => [`BusStats`](#busstats)

Defined in: [runtime/supervise/coordination-mcp.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L43)

Bus throughput counters for live dashboards.

Bus throughput counters (published / pulled / by-kind) for live dashboards.

###### Returns

[`BusStats`](#busstats)

##### raiseFinding

> **raiseFinding**: (`finding`) => `Promise`\<`void`\>

Defined in: [runtime/supervise/coordination-mcp.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L45)

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

Defined in: [runtime/supervise/coordination-mcp.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L38)

The coordination tools' settled-worker ledger (for the driver's finalize).

###### Returns

readonly `object`[]

##### isStopped()

> **isStopped**(): `boolean`

Defined in: [runtime/supervise/coordination-mcp.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L39)

###### Returns

`boolean`

##### close()

> **close**(): `Promise`\<`void`\>

Defined in: [runtime/supervise/coordination-mcp.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L46)

###### Returns

`Promise`\<`void`\>

***

### WatchTraceOptions

Defined in: [runtime/supervise/detector-monitor.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L22)

#### Properties

##### detectors?

> `readonly` `optional` **detectors?**: readonly `StreamingDetector`[]

Defined in: [runtime/supervise/detector-monitor.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L24)

The detectors to run online. Defaults to a stuck-loop + error-streak panel.

##### onSignal?

> `readonly` `optional` **onSignal?**: (`signal`, `span`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime/supervise/detector-monitor.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L26)

Fired for each signal a detector raises — the seam that raises a `finding` on the bus.

###### Parameters

###### signal

`DetectorSignal`

###### span

`ToolSpan`

###### Returns

`void` \| `Promise`\<`void`\>

***

### BusEvent

Defined in: [runtime/supervise/event-bus.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L26)

Every bus event is a discriminated union member keyed by `type`.

#### Properties

##### type

> `readonly` **type**: `string`

Defined in: [runtime/supervise/event-bus.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L27)

***

### BusRecord

Defined in: [runtime/supervise/event-bus.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L32)

A published event stamped for ordering and observability. `seq` is the monotonic publish index;
 `priority` drives pull order (higher = bumped ahead); `at` is the wall-clock publish time (ms).

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Properties

##### seq

> `readonly` **seq**: `number`

Defined in: [runtime/supervise/event-bus.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L33)

##### at

> `readonly` **at**: `number`

Defined in: [runtime/supervise/event-bus.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L34)

##### priority

> `readonly` **priority**: `number`

Defined in: [runtime/supervise/event-bus.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L35)

##### event

> `readonly` **event**: `E`

Defined in: [runtime/supervise/event-bus.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L36)

***

### PublishOptions

Defined in: [runtime/supervise/event-bus.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L39)

#### Properties

##### priority?

> `readonly` `optional` **priority?**: `number`

Defined in: [runtime/supervise/event-bus.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L42)

Higher = pulled ahead of lower-priority queued events (default 0). A blocking question sets
 this so it bumps to the front of the driver's inbox.

##### queue?

> `readonly` `optional` **queue?**: `boolean`

Defined in: [runtime/supervise/event-bus.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L46)

Whether the event enters the pull queue (default true). Set `false` for record-only events —
 the parent→child down-leg (steer / answer / resume): they belong in `history()` and reach
 `subscribe` observers, but the parent must never `pull` its own outbound message back.

***

### BusStats

Defined in: [runtime/supervise/event-bus.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L49)

#### Properties

##### published

> `readonly` **published**: `number`

Defined in: [runtime/supervise/event-bus.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L50)

##### pulled

> `readonly` **pulled**: `number`

Defined in: [runtime/supervise/event-bus.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L51)

##### byKind

> `readonly` **byKind**: `Readonly`\<`Record`\<`string`, `number`\>\>

Defined in: [runtime/supervise/event-bus.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L53)

Count published per event `type`.

***

### EventBus

Defined in: [runtime/supervise/event-bus.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L56)

#### Type Parameters

##### E

`E` *extends* [`BusEvent`](#busevent)

#### Methods

##### publish()

> **publish**(`event`, `opts?`): `Promise`\<[`BusRecord`](#busrecord)\<`E`\>\>

Defined in: [runtime/supervise/event-bus.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L59)

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

Defined in: [runtime/supervise/event-bus.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L62)

Remove and return the highest-priority QUEUED event whose type is in `kinds` (any if omitted),
 ties broken FIFO by `seq`; `undefined` when nothing matches.

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`E` \| `undefined`

##### subscribe()

> **subscribe**(`handler`): () => `void`

Defined in: [runtime/supervise/event-bus.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L65)

Register a pass-through handler; it receives the stamped record of every event published after
 registration. Returns an unsubscribe fn.

###### Parameters

###### handler

(`record`) => `void` \| `Promise`\<`void`\>

###### Returns

() => `void`

##### pending()

> **pending**(`kinds?`): `number`

Defined in: [runtime/supervise/event-bus.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L67)

Count of queued, not-yet-pulled events (filtered by `kinds` when given).

###### Parameters

###### kinds?

readonly `E`\[`"type"`\][]

###### Returns

`number`

##### history()

> **history**(): readonly [`BusRecord`](#busrecord)\<`E`\>[]

Defined in: [runtime/supervise/event-bus.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L69)

The full ordered log of every event ever published (the audit/replay trail).

###### Returns

readonly [`BusRecord`](#busrecord)\<`E`\>[]

##### stats()

> **stats**(): [`BusStats`](#busstats)

Defined in: [runtime/supervise/event-bus.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L71)

Throughput counters for observability dashboards.

###### Returns

[`BusStats`](#busstats)

***

### InboxMessage

Defined in: [runtime/supervise/inbox.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L18)

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

Defined in: [runtime/supervise/inbox.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L19)

**`Experimental`**

##### text

> `readonly` **text**: `string`

Defined in: [runtime/supervise/inbox.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L20)

**`Experimental`**

##### interrupt

> `readonly` **interrupt**: `boolean`

Defined in: [runtime/supervise/inbox.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L22)

**`Experimental`**

Forceful messages abort the in-flight turn; queued ones wait for the boundary flush.

##### questionId?

> `readonly` `optional` **questionId?**: `string`

Defined in: [runtime/supervise/inbox.ts:24](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L24)

**`Experimental`**

Present for an `answer` — the question id it resolves.

***

### Inbox

Defined in: [runtime/supervise/inbox.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L27)

#### Methods

##### deliver()

> **deliver**(`msg`): `void`

Defined in: [runtime/supervise/inbox.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L29)

The `Executor.deliver` implementation — accept a raw down-message from `Scope.send`.

###### Parameters

###### msg

`unknown`

###### Returns

`void`

##### drain()

> **drain**(): [`InboxMessage`](#inboxmessage)[]

Defined in: [runtime/supervise/inbox.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L31)

Remove and return all pending messages (the flush).

###### Returns

[`InboxMessage`](#inboxmessage)[]

##### pending()

> **pending**(): `number`

Defined in: [runtime/supervise/inbox.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L32)

###### Returns

`number`

##### freshInterrupt()

> **freshInterrupt**(): `AbortSignal`

Defined in: [runtime/supervise/inbox.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L35)

Open a fresh per-turn interrupt signal; a later forceful `deliver` aborts it. The loop links
 this into the signal it passes to its inference call, then re-plans when it fires.

###### Returns

`AbortSignal`

##### fold()

> **fold**(`messages`): `string`

Defined in: [runtime/supervise/inbox.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L37)

Render drained messages as ONE operator turn to fold into the worker's conversation.

###### Parameters

###### messages

readonly [`InboxMessage`](#inboxmessage)[]

###### Returns

`string`

***

### PatchDeliverableOptions

Defined in: [runtime/supervise/patch-deliverable.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L27)

**`Experimental`**

#### Extends

- `CoderCheckConstraints`

#### Extended by

- [`WorktreeFanoutOptions`](#worktreefanoutoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [runtime/supervise/patch-checks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L38)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

`CoderCheckConstraints.maxDiffLines`

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [runtime/supervise/patch-checks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L40)

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

`CoderCheckConstraints.forbiddenPaths`

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [runtime/supervise/patch-deliverable.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L34)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

***

### InMemoryRunContextOptions

Defined in: [runtime/supervise/run-context.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L32)

Options for the in-memory run context.

#### Properties

##### withDriver?

> `readonly` `optional` **withDriver?**: `boolean`

Defined in: [runtime/supervise/run-context.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L39)

Wrap the executor registry with `withDriverExecutor` so a spawned child marked
`role: 'driver'` resolves to the recursive driver-executor (agents driving agents
over a nested `Scope` on the same conserved pool). Leave `false` for a flat tree of
leaf workers. Default `false`.

***

### InMemoryRunContext

Defined in: [runtime/supervise/run-context.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L46)

The bundle of stores a supervised run needs, shaped to spread into `SupervisorOpts`.
The fields are exactly `SupervisorOpts`' `journal` / `blobs` / `executors`.

#### Properties

##### journal

> `readonly` **journal**: `SpawnJournal`

Defined in: [runtime/supervise/run-context.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L47)

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/supervise/run-context.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L48)

##### executors

> `readonly` **executors**: `ExecutorRegistry`

Defined in: [runtime/supervise/run-context.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L49)

***

### SuperviseOptions

Defined in: [runtime/supervise/supervise.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L46)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-9)

Defined in: [runtime/supervise/supervise.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L48)

The conserved compute pool for the whole run.

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](#executorconfig)

Defined in: [runtime/supervise/supervise.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L50)

WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`unknown`\>

Defined in: [runtime/supervise/supervise.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L54)

The completion oracle for backend-derived workers (settled ⟺ delivered). Strongly recommended:
 without it the supervisor trusts a worker's self-report — exactly the "ran but didn't deliver"
 failure mode of a static orchestrator.

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](mcp.md#makeworkeragent)

Defined in: [runtime/supervise/supervise.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L56)

Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [runtime/supervise/supervise.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L58)

The supervisor's router substrate (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: [runtime/supervise/supervise.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L60)

Inject the supervisor brain directly (tests / advanced).

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: [runtime/supervise/supervise.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L62)

Run a sandboxed-harness supervisor (`harness` set).

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [runtime/supervise/supervise.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L66)

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`harness` null).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [runtime/supervise/supervise.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L72)

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](#budget-9)

Defined in: [runtime/supervise/supervise.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L77)

Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens.

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/supervise/supervise.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L79)

Worker output store. Defaults to in-memory.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/supervise/supervise.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L80)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [runtime/supervise/supervise.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L81)

##### runId?

> `readonly` `optional` **runId?**: `string`

Defined in: [runtime/supervise/supervise.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L82)

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/supervise/supervise.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L83)

###### Returns

`number`

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Defined in: [runtime/supervise/supervise.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L87)

Restrict the run to this subset of models. When set, every configured model — the
 supervisor router model, the profile's model, and the backend's model — must be a member,
 or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.

***

### SupervisorProfile

Defined in: [runtime/supervise/supervisor-agent.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L26)

The supervisor's profile — the subset of an `AgentProfile` that selects + shapes its brain.
 `harness` is the backend-as-data discriminant; `systemPrompt` is the standing instruction.

#### Properties

##### name?

> `readonly` `optional` **name?**: `string`

Defined in: [runtime/supervise/supervisor-agent.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L27)

##### harness?

> `readonly` `optional` **harness?**: `string` \| `null`

Defined in: [runtime/supervise/supervisor-agent.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L29)

null/undefined → router brain (in-process tool-loop); a coding-CLI harness → sandboxed brain.

##### model?

> `readonly` `optional` **model?**: `string`

Defined in: [runtime/supervise/supervisor-agent.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L31)

The router model when the brain is router-driven (falls back to the deps router config).

##### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [runtime/supervise/supervisor-agent.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L33)

The standing instructions ("you delegate, you do not solve").

***

### SupervisorAgentDeps

Defined in: [runtime/supervise/supervisor-agent.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L47)

#### Properties

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/supervise/supervisor-agent.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L48)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](mcp.md#makeworkeragent)

Defined in: [runtime/supervise/supervisor-agent.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L50)

Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms).

##### perWorker

> `readonly` **perWorker**: [`Budget`](#budget-9)

Defined in: [runtime/supervise/supervisor-agent.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L52)

Per-child budget reserved from the conserved pool on each spawn.

##### router?

> `readonly` `optional` **router?**: [`RouterConfig`](#routerconfig)

Defined in: [runtime/supervise/supervisor-agent.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L54)

Router substrate for a router-brained supervisor (`harness` null). The profile's model wins.

##### brain?

> `readonly` `optional` **brain?**: [`ToolLoopChat`](#toolloopchat)

Defined in: [runtime/supervise/supervisor-agent.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L56)

Inject the brain directly (tests / advanced) instead of resolving `routerBrain` from the profile.

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](#driveharness-1)

Defined in: [runtime/supervise/supervisor-agent.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L58)

Required for a sandboxed-harness supervisor (`harness` set): runs the harness as the driver.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

Defined in: [runtime/supervise/supervisor-agent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L61)

WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
 only delegate when it needs parallelism. Pair with `executeExtraTool`.

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Defined in: [runtime/supervise/supervisor-agent.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L67)

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Defined in: [runtime/supervise/supervisor-agent.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L71)

***

### TraceSource

Defined in: [runtime/supervise/trace-source.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L37)

#### Methods

##### onSpan()

> **onSpan**(`handler`): () => `void`

Defined in: [runtime/supervise/trace-source.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L40)

Subscribe to tool spans as they are produced (ONLINE). Returns an unsubscribe. A source that
 only exposes its trace at the end registers nothing and returns a no-op.

###### Parameters

###### handler

(`span`) => `void`

###### Returns

() => `void`

##### collect()

> **collect**(): `Promise`\<`ToolSpan`[]\>

Defined in: [runtime/supervise/trace-source.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L42)

The full set of tool spans for the run (SETTLE / batch). Always available.

###### Returns

`Promise`\<`ToolSpan`[]\>

***

### SessionTraceBox

Defined in: [runtime/supervise/trace-source.ts:278](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L278)

The minimal box surface this needs: list a session's messages (incl. mid-turn partials).

#### Methods

##### messages()

> **messages**(`opts`): `Promise`\<readonly `SessionMessageLike`[]\>

Defined in: [runtime/supervise/trace-source.ts:279](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L279)

###### Parameters

###### opts

###### sessionId

`string`

###### Returns

`Promise`\<readonly `SessionMessageLike`[]\>

***

### TrajectoryAnalysis

Defined in: [runtime/supervise/trajectory-recorder.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L15)

#### Properties

##### trajectory

> `readonly` **trajectory**: `Trajectory`

Defined in: [runtime/supervise/trajectory-recorder.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L18)

Structured run summary (tool-call count, step order). Steps carry a single timestamp, so per-span
 duration is 0; loop/waste detection keys on call PATTERNS + cross-span windows, not durations.

##### stuckLoop

> `readonly` **stuckLoop**: `StuckLoopReport`

Defined in: [runtime/supervise/trajectory-recorder.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L21)

Full-run repeated-call view (total occurrences + window) — catches a loop the online consecutive
 detector interleaves past.

##### toolWaste

> `readonly` **toolWaste**: `ToolWasteReport`

Defined in: [runtime/supervise/trajectory-recorder.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L23)

Wasted-vs-total tool-call ratio for the run.

***

### Agent

Defined in: [runtime/supervise/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L49)

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

Defined in: [runtime/supervise/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L50)

#### Methods

##### act()

> **act**(`task`, `scope`): `Promise`\<`Out`\>

Defined in: [runtime/supervise/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L51)

###### Parameters

###### task

`Task`

###### scope

[`Scope`](#scope-1)\<`Out`\>

###### Returns

`Promise`\<`Out`\>

***

### Executor

Defined in: [runtime/supervise/types.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L70)

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

> `readonly` **runtime**: `Runtime`

Defined in: [runtime/supervise/types.ts:72](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L72)

Stable runtime tag for traces + the equal-k exemption check.

##### budgetExempt?

> `readonly` `optional` **budgetExempt?**: `boolean`

Defined in: [runtime/supervise/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L78)

When true, this executor's spend is NOT metered against the conserved pool and its
iterations are excluded from the equal-k assertion (a `cli` subprocess without
token accounting). Fail-loud everywhere else: a metered executor MUST report usage.

#### Methods

##### execute()

> **execute**(`task`, `signal`): `AsyncIterable`\<[`UsageEvent`](#usageevent), `any`, `any`\> \| `Promise`\<[`ExecutorResult`](#executorresult)\<`Out`\>\>

Defined in: [runtime/supervise/types.ts:84](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L84)

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

Defined in: [runtime/supervise/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L95)

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

Defined in: [runtime/supervise/types.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L100)

Tear the executor's resources down. `grace` mirrors the OTP shutdown spec
(`'brutalKill'` = immediate, a number = ms grace, `'infinity'` = await clean exit).

###### Parameters

###### grace

`number` \| `"brutalKill"` \| `"infinity"`

###### Returns

`Promise`\<\{ `destroyed`: `boolean`; \}\>

##### resultArtifact()

> **resultArtifact**(): `object`

Defined in: [runtime/supervise/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L105)

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

Defined in: [runtime/supervise/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L114)

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

Defined in: [runtime/supervise/types.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L118)

Terminal artifact of a one-shot `Executor.execute`.

#### Type Parameters

##### Out

`Out`

#### Properties

##### outRef

> **outRef**: `string`

Defined in: [runtime/supervise/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L119)

##### out

> **out**: `Out`

Defined in: [runtime/supervise/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L120)

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/supervise/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L121)

##### spent

> **spent**: [`Spend`](#spend)

Defined in: [runtime/supervise/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L122)

***

### AgentSpec

Defined in: [runtime/supervise/types.ts:152](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L152)

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

Defined in: [runtime/supervise/types.ts:153](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L153)

##### harness

> `readonly` **harness**: `BackendType` \| `null`

Defined in: [runtime/supervise/types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L155)

`null` selects router/inline; a `BackendType` selects the sandboxed harness.

##### executor?

> `readonly` `optional` **executor?**: [`Executor`](#executor)\<`unknown`\>

Defined in: [runtime/supervise/types.ts:157](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L157)

Bring-your-own executor: when set, overrides harness-based resolution entirely.

***

### ExecutorContext

Defined in: [runtime/supervise/types.ts:170](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L170)

Construction context handed to a `ExecutorFactory` — the seams a built-in needs
 (sandbox client for the sandbox executor, router config for router/inline) without
 the factory reaching into module globals.

#### Properties

##### signal

> `readonly` **signal**: `AbortSignal`

Defined in: [runtime/supervise/types.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L171)

##### seams

> `readonly` **seams**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [runtime/supervise/types.ts:173](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L173)

Opaque seams the registry threads through; a built-in narrows what it needs.

***

### Budget

Defined in: [runtime/supervise/types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L199)

A budget envelope on a spawn or the root. All ceilings; the pool reserves against them.

#### Properties

##### maxIterations

> `readonly` **maxIterations**: `number`

Defined in: [runtime/supervise/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L200)

##### maxTokens

> `readonly` **maxTokens**: `number`

Defined in: [runtime/supervise/types.ts:201](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L201)

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

Defined in: [runtime/supervise/types.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L202)

##### deadlineMs?

> `readonly` `optional` **deadlineMs?**: `number`

Defined in: [runtime/supervise/types.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L203)

***

### Spend

Defined in: [runtime/supervise/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L208)

Conserved spend, reconciled from the normalized `UsageEvent` stream. Tokens and usd
 are separate channels (never folded).

#### Properties

##### iterations

> **iterations**: `number`

Defined in: [runtime/supervise/types.ts:209](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L209)

##### tokens

> **tokens**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [runtime/supervise/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L210)

##### usd

> **usd**: `number`

Defined in: [runtime/supervise/types.ts:211](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L211)

##### ms

> **ms**: `number`

Defined in: [runtime/supervise/types.ts:212](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L212)

***

### Scope

Defined in: [runtime/supervise/types.ts:283](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L283)

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

Defined in: [runtime/supervise/types.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L310)

This scope's abort signal — aborted when the run is cancelled, a breaker trips, the pool
 is exhausted, or a parent scope cascades. A long-running driver `act` over this scope reads
 it to break promptly (the conserved pool + driver-stop are the other bounds). A nested
 scope carries its own signal, chained off its driver child's abort.

##### view

> `readonly` **view**: [`TreeView`](#treeview)

Defined in: [runtime/supervise/types.ts:324](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L324)

The live tree — reads the in-memory nursery, not the journal.

##### budget

> `readonly` **budget**: `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [runtime/supervise/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L326)

Conserved-pool readouts (post-reservation).

#### Methods

##### spawn()

> **spawn**\<`C`\>(`agent`, `task`, `opts`): \{ `ok`: `true`; `handle`: `Handle`\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

Defined in: [runtime/supervise/types.ts:289](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L289)

Spawn a child. Reserves `opts.budget` from the conserved pool atomically; refunds the
unspent remainder on settle. Returns a typed outcome — fail-closed on an exhausted
pool or an exceeded depth ceiling (the caller inspects `ok` before `handle`).

###### Type Parameters

###### C

`C`

###### Parameters

###### agent

[`Agent`](#agent)\<`unknown`, `C`\>

###### task

`unknown`

###### opts

`SpawnOpts`

###### Returns

\{ `ok`: `true`; `handle`: `Handle`\<`C`\>; \} \| \{ `ok`: `false`; `reason`: `"budget-exhausted"` \| `"depth-exceeded"`; \}

##### next()

> **next**(): `Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

Defined in: [runtime/supervise/types.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L296)

ray.wait n=1 over this scope's in-memory live set; resolves as each child settles;
 `null` when the live set is empty.

###### Returns

`Promise`\<[`Settled`](#settled-2)\<`Out`\> \| `null`\>

##### send()

> **send**(`nodeId`, `msg`): `boolean`

Defined in: [runtime/supervise/types.ts:305](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L305)

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

Defined in: [runtime/supervise/types.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L322)

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

### TreeView

Defined in: [runtime/supervise/types.ts:351](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L351)

The live tree — what `scope.view` / `RootHandle.view()` materialize for a viewer.

#### Properties

##### root

> `readonly` **root**: `string`

Defined in: [runtime/supervise/types.ts:352](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L352)

##### nodes

> `readonly` **nodes**: readonly `NodeSnapshot`[]

Defined in: [runtime/supervise/types.ts:353](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L353)

##### inFlight

> `readonly` **inFlight**: `number`

Defined in: [runtime/supervise/types.ts:355](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L355)

Count of nodes in `running` or `acquiring` — the "what's in flow?" answer.

***

### ResultBlobStore

Defined in: [runtime/supervise/types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L415)

Content-addressed result blobs (the `outRef` → artifact map) backing the replay
 invariant. Split from the journal so the journal stays small (decisions) and the
 payloads (evidence) live where a viewer/replayer rehydrates them.

#### Methods

##### put()

> **put**(`outRef`, `artifact`): `Promise`\<`void`\>

Defined in: [runtime/supervise/types.ts:416](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L416)

###### Parameters

###### outRef

`string`

###### artifact

`unknown`

###### Returns

`Promise`\<`void`\>

##### get()

> **get**(`outRef`): `Promise`\<`unknown`\>

Defined in: [runtime/supervise/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L417)

###### Parameters

###### outRef

`string`

###### Returns

`Promise`\<`unknown`\>

***

### Supervisor

Defined in: [runtime/supervise/types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L427)

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

Defined in: [runtime/supervise/types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L428)

###### Parameters

###### root

[`Agent`](#agent)\<`Task`, `Out`\>

###### task

`Task`

###### opts

[`SupervisorOpts`](#supervisoropts)

###### Returns

`Promise`\<[`SupervisedResult`](#supervisedresult)\<`Out`\>\>

##### attach()

> **attach**(`h`): `void`

Defined in: [runtime/supervise/types.ts:429](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L429)

###### Parameters

###### h

`RootHandle`\<`Out`\>

###### Returns

`void`

***

### SupervisorOpts

Defined in: [runtime/supervise/types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L432)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](#budget-9)

Defined in: [runtime/supervise/types.ts:434](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L434)

The root conserved-pool ceiling (tokens + usd + iterations + deadline).

##### runId

> `readonly` **runId**: `string`

Defined in: [runtime/supervise/types.ts:436](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L436)

Trace-correlation root + the journal/blob root key.

##### journal

> `readonly` **journal**: `SpawnJournal`

Defined in: [runtime/supervise/types.ts:438](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L438)

Event source — defaults to the in-memory journal in the impl; pass JSONL/FS for durability.

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](#resultblobstore)

Defined in: [runtime/supervise/types.ts:440](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L440)

Result payload store backing `outRef` rehydration.

##### executors

> `readonly` **executors**: `ExecutorRegistry`

Defined in: [runtime/supervise/types.ts:442](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L442)

Executor resolution — the open registry mapping `AgentSpec` → `Executor`.

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

Defined in: [runtime/supervise/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L444)

Runtime recursion-depth ceiling (paired with the conserved pool per R3).

##### maxRestarts?

> `readonly` `optional` **maxRestarts?**: `number`

Defined in: [runtime/supervise/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L449)

OTP intensity breaker: more than `maxRestarts` child restarts within `withinMs`
trips the supervisor to `no-winner` rather than restarting forever.

##### withinMs?

> `readonly` `optional` **withinMs?**: `number`

Defined in: [runtime/supervise/types.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L450)

##### now?

> `readonly` `optional` **now?**: () => `number`

Defined in: [runtime/supervise/types.ts:451](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L451)

###### Returns

`number`

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [runtime/supervise/types.ts:452](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L452)

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/supervise/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L455)

Lifecycle stream sink, threaded into the root `Scope` so every `spawn`/settle emits on the
 same `agent.spawn`/`agent.child` stream `runLoop` feeds — one observable recursive tree.

***

### WidenGate

Defined in: [runtime/supervise/types.ts:507](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L507)

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

Defined in: [runtime/supervise/types.ts:512](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L512)

When true, widening may read `verdict` directly (collides with the steer firewall —
 must be explicitly argued per cell, never defaulted on).

#### Methods

##### shouldWiden()

> **shouldWiden**(`settled`, `budget`): `boolean`

Defined in: [runtime/supervise/types.ts:509](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L509)

Default impl returns false for every settlement (flat — never widens).

###### Parameters

###### settled

[`Settled`](#settled-2)\<`Out`\>

###### budget

`Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

###### Returns

`boolean`

***

### WorktreeCliExecutorOptions

Defined in: [runtime/supervise/worktree-cli-executor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L43)

**`Experimental`**

#### Properties

##### repoRoot

> **repoRoot**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L45)

**`Experimental`**

Absolute path to the git checkout the worktree is cut from.

##### profile

> **profile**: `AgentProfile`

Defined in: [runtime/supervise/worktree-cli-executor.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L47)

**`Experimental`**

The SUPERVISOR-AUTHORED profile (the §1.5 payload: systemPrompt + model).

##### harness

> **harness**: [`LocalHarness`](mcp.md#localharness)

Defined in: [runtime/supervise/worktree-cli-executor.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L49)

**`Experimental`**

Which local harness CLI drives this leaf (`claude` | `codex` | `opencode`).

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L51)

**`Experimental`**

The per-task instruction handed to the harness (composed under the system prompt).

##### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L53)

**`Experimental`**

Unique id for the worktree path + branch. Defaults to a fresh UUID.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L55)

**`Experimental`**

Override the base ref the worktree is cut from (default `HEAD`).

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-cli-executor.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L57)

**`Experimental`**

Wall-clock cap per harness subprocess (ms). Default 5 min (the `runLocalHarness` default).

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L62)

**`Experimental`**

Shell command run in the live worktree to derive the tests-PASS signal (e.g. `pnpm test`).
Its exit code becomes `artifact.checks.tests.passed`. Omit to skip (no signal derived).

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [runtime/supervise/worktree-cli-executor.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L64)

**`Experimental`**

Shell command run in the live worktree to derive the typecheck-PASS signal (e.g. `pnpm typecheck`).

##### checkTimeoutMs?

> `optional` **checkTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-cli-executor.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L66)

**`Experimental`**

Wall-clock cap per verification command (ms). Default = `harnessTimeoutMs` or 5 min.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [runtime/supervise/worktree-cli-executor.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L68)

**`Experimental`**

Test seam — inject a git runner so unit tests drive the worktree helpers without git.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [runtime/supervise/worktree-cli-executor.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L70)

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

Defined in: [runtime/supervise/worktree-cli-executor.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L73)

**`Experimental`**

Test seam — inject the verification-command runner so unit tests script test/typecheck
 outcomes without spawning a real shell. Defaults to a `/bin/sh -c` spawn in the worktree.

***

### AuthoredHarness

Defined in: [runtime/supervise/worktree-fanout.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L30)

**`Experimental`**

One authored harness profile in a worktree fanout: the §1.5 profile + which local
 harness CLI drives it. The supervisor authors `profile` per sub-task; `harness` chooses the leaf.

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L32)

**`Experimental`**

A short label for the worktree branch + trace node.

##### profile

> **profile**: `AgentProfile`

Defined in: [runtime/supervise/worktree-fanout.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L34)

**`Experimental`**

The supervisor-authored `AgentProfile` (systemPrompt + model reach the harness via §1.5).

##### harness

> **harness**: `"claude"` \| `"codex"` \| `"opencode"`

Defined in: [runtime/supervise/worktree-fanout.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L36)

**`Experimental`**

Which local harness CLI drives this leaf.

##### runId?

> `optional` **runId?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L38)

**`Experimental`**

Per-harness model/runId/baseRef overrides flow through the profile + these.

##### baseRef?

> `optional` **baseRef?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L39)

**`Experimental`**

***

### WorktreeFanoutOptions

Defined in: [runtime/supervise/worktree-fanout.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L43)

**`Experimental`**

#### Extends

- [`PatchDeliverableOptions`](#patchdeliverableoptions)

#### Properties

##### maxDiffLines?

> `optional` **maxDiffLines?**: `number`

Defined in: [runtime/supervise/patch-checks.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L38)

**`Experimental`**

Default 400. Hard cap; gate fails when exceeded.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`maxDiffLines`](#maxdifflines)

##### forbiddenPaths?

> `optional` **forbiddenPaths?**: `string`[]

Defined in: [runtime/supervise/patch-checks.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-checks.ts#L40)

**`Experimental`**

Literal path prefixes the patch must not touch.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`forbiddenPaths`](#forbiddenpaths)

##### require?

> `optional` **require?**: readonly (`"tests"` \| `"typecheck"`)[]

Defined in: [runtime/supervise/patch-deliverable.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L34)

**`Experimental`**

Which verification signals the gate REQUIRES to be present-and-passing. A required signal
that the artifact never derived (the command was not configured on the executor) fails the
gate closed. Unlisted signals default to passed-when-absent (the executor simply didn't run
that command). Default `[]` — gate on no-op / secret / forbidden / diff-size only.

###### Inherited from

[`PatchDeliverableOptions`](#patchdeliverableoptions).[`require`](#require)

##### repoRoot

> **repoRoot**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L45)

**`Experimental`**

Absolute path to the git checkout each worktree is cut from.

##### taskPrompt

> **taskPrompt**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L47)

**`Experimental`**

The per-task instruction handed to every harness (composed under each profile's systemPrompt).

##### harnesses

> **harnesses**: readonly [`AuthoredHarness`](#authoredharness)[]

Defined in: [runtime/supervise/worktree-fanout.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L49)

**`Experimental`**

The authored harness profiles — one fanout item (and one worktree-CLI leaf) each.

##### deliverable?

> `optional` **deliverable?**: [`DeliverableSpec`](#deliverablespec)\<`WorktreeHarnessResult`\>

Defined in: [runtime/supervise/worktree-fanout.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L55)

**`Experimental`**

The completion check each leaf is gated on. Defaults to `patchDelivered(opts)` (the mechanical
no-op/secret/forbidden/diff-size + required test/typecheck gate). Pass any
`DeliverableSpec<WorktreePatchArtifact>` to customize "is it delivered" as DATA.

##### testCmd?

> `optional` **testCmd?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L57)

**`Experimental`**

Shell command run in each worktree to derive the tests-PASS signal.

##### typecheckCmd?

> `optional` **typecheckCmd?**: `string`

Defined in: [runtime/supervise/worktree-fanout.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L59)

**`Experimental`**

Shell command run in each worktree to derive the typecheck-PASS signal.

##### harnessTimeoutMs?

> `optional` **harnessTimeoutMs?**: `number`

Defined in: [runtime/supervise/worktree-fanout.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L61)

**`Experimental`**

Wall-clock cap per harness subprocess (ms).

##### winnerStrategy?

> `optional` **winnerStrategy?**: [`WinnerStrategy`](#winnerstrategy)

Defined in: [runtime/supervise/worktree-fanout.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L63)

**`Experimental`**

Winner-selection strategy. Default `highest-score`.

##### runGit?

> `optional` **runGit?**: [`GitRunner`](mcp.md#gitrunner)

Defined in: [runtime/supervise/worktree-fanout.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L66)

**`Experimental`**

Test seams forwarded to every worktree-CLI leaf (inject git/harness/command runners so the
 whole fanout runs offline). Production callers leave these unset.

##### runHarness?

> `optional` **runHarness?**: (`options`) => `Promise`\<[`LocalHarnessResult`](mcp.md#localharnessresult)\>

Defined in: [runtime/supervise/worktree-fanout.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L67)

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

Defined in: [runtime/supervise/worktree-fanout.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L68)

**`Experimental`**

***

### ValidationCtx

Defined in: [runtime/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L32)

**`Experimental`**

#### Properties

##### iteration

> **iteration**: `number`

Defined in: [runtime/types.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L34)

**`Experimental`**

Iteration index this output came from (0-based).

##### box?

> `optional` **box?**: `SandboxInstance`

Defined in: [runtime/types.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L40)

**`Experimental`**

Live sandbox for this iteration. Validators that need execution-grounded
evidence can inspect files or run commands here instead of forcing callers
to bypass the loop kernel with raw Sandbox SDK orchestration.

##### signal

> **signal**: `AbortSignal`

Defined in: [runtime/types.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L42)

**`Experimental`**

Cooperative cancellation channel.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: [runtime/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L48)

**`Experimental`**

Optional trace emitter. When set, validator implementations that make
LLM calls (e.g. an LLM-judge reviewer) emit spans into it.
The kernel passes `ctx.traceEmitter` from `ExecCtx` when available.

***

### Validator

Defined in: [runtime/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L52)

**`Experimental`**

#### Type Parameters

##### Output

`Output`

##### Verdict

`Verdict` = `DefaultVerdict`

#### Methods

##### validate()

> **validate**(`output`, `ctx`): `Promise`\<`Verdict`\>

Defined in: [runtime/types.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L53)

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

Defined in: [runtime/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L67)

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

Defined in: [runtime/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L69)

**`Experimental`**

Sandbox SDK profile — what kind of agent runs the task.

##### taskToPrompt

> **taskToPrompt**: (`task`) => `string`

Defined in: [runtime/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L71)

**`Experimental`**

Task → prompt formatter. Pure and deterministic.

###### Parameters

###### task

`Task`

###### Returns

`string`

##### prepareBox?

> `optional` **prepareBox?**: (`box`, `ctx`) => `void` \| `Promise`\<`void`\>

Defined in: [runtime/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L80)

**`Experimental`**

Optional pre-prompt sandbox provisioner. Runs after the sandbox is acquired
and before the first prompt is streamed into that box. Use this for
domain-agnostic setup such as repo snapshots, benchmark fixtures, policy
files, or seed datasets. The hook is part of the runtime surface so loop
consumers do not hand-roll Sandbox SDK orchestration just to prepare a
workspace before the agent sees it.

###### Parameters

###### box

`SandboxInstance`

###### ctx

###### signal

`AbortSignal`

###### Returns

`void` \| `Promise`\<`void`\>

##### name?

> `optional` **name?**: `string`

Defined in: [runtime/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L85)

**`Experimental`**

Per-spec stable name. Surfaced in trace events and the default winner
selector tiebreak. Falls back to `profile.name ?? 'agent'`.

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [runtime/types.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L91)

**`Experimental`**

Optional sandbox-SDK `CreateSandboxOptions` overrides merged on top of
the kernel's defaults. `backend.profile` is set to `profile` by the
kernel and cannot be overridden here — use `profile` itself for that.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

***

### OutputAdapter

Defined in: [runtime/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L105)

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

Defined in: [runtime/types.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L106)

**`Experimental`**

###### Parameters

###### events

`SandboxEvent`[]

###### Returns

`Output`

***

### LoopTokenUsage

Defined in: [runtime/types.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L113)

LLM token usage. Structurally matches agent-eval's `RunTokenUsage` /
 `CampaignTokenUsage` ({ input, output }) so a loop result maps straight
 onto `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch — without
 which the backend-integrity guard reads the run as a stub.

#### Properties

##### input

> **input**: `number`

Defined in: [runtime/types.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L114)

##### output

> **output**: `number`

Defined in: [runtime/types.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L115)

***

### Iteration

Defined in: [runtime/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L119)

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### index

> **index**: `number`

Defined in: [runtime/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L121)

**`Experimental`**

0-based iteration index assigned by the kernel.

##### task

> **task**: `Task`

Defined in: [runtime/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L122)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L124)

**`Experimental`**

Stable name of the `AgentRunSpec` that produced this iteration.

##### output?

> `optional` **output?**: `Output`

Defined in: [runtime/types.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L125)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/types.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L126)

**`Experimental`**

##### error?

> `optional` **error?**: `Error`

Defined in: [runtime/types.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L127)

**`Experimental`**

##### events

> **events**: `SandboxEvent`[]

Defined in: [runtime/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L129)

**`Experimental`**

Raw sandbox event stream collected for this iteration.

##### startedAt

> **startedAt**: `number`

Defined in: [runtime/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L130)

**`Experimental`**

##### endedAt

> **endedAt**: `number`

Defined in: [runtime/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L131)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L132)

**`Experimental`**

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [runtime/types.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L134)

**`Experimental`**

Summed LLM token usage across every `llm_call` event in this iteration.

***

### Driver

Defined in: [runtime/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L138)

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

Defined in: [runtime/types.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L142)

**`Experimental`**

Stable identifier surfaced in trace events. Default `'driver'`.

#### Methods

##### plan()

> **plan**(`task`, `history`): `Promise`\<`Task`[]\>

Defined in: [runtime/types.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L147)

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

Defined in: [runtime/types.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L154)

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

Defined in: [runtime/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L164)

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

Defined in: [runtime/types.ts:174](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L174)

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

Defined in: [runtime/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L180)

**`Experimental`**

Driver-supplied description of the just-planned move.

#### Properties

##### kind

> **kind**: `string`

Defined in: [runtime/types.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L182)

**`Experimental`**

Topology move this round — e.g. `'refine' | 'fanout' | 'verify' | 'stop'`.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: [runtime/types.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L184)

**`Experimental`**

Why the driver chose this move (the agent's rationale), when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L191)

**`Experimental`**

Iteration index this round branches FROM, when the driver declares it.
Overrides the kernel's inferred branch point — lets a planner that
branches off a specific (non-winner) iteration emit faithful edge lineage.
Omit to keep the inferred (best-valid / latest) branch point.

***

### LoopWinner

Defined in: [runtime/types.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L195)

**`Experimental`**

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Properties

##### task

> **task**: `Task`

Defined in: [runtime/types.ts:196](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L196)

**`Experimental`**

##### output

> **output**: `Output`

Defined in: [runtime/types.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L197)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/types.ts:198](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L198)

**`Experimental`**

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:199](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L199)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L200)

**`Experimental`**

***

### LoopResult

Defined in: [runtime/types.ts:204](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L204)

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

Defined in: [runtime/types.ts:205](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L205)

**`Experimental`**

##### iterations

> **iterations**: [`Iteration`](#iteration-1)\<`Task`, `Output`\>[]

Defined in: [runtime/types.ts:206](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L206)

**`Experimental`**

##### winner?

> `optional` **winner?**: [`LoopWinner`](#loopwinner)\<`Task`, `Output`\>

Defined in: [runtime/types.ts:207](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L207)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [runtime/types.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L208)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L210)

**`Experimental`**

Sum of every iteration's `costUsd`.

##### tokenUsage

> **tokenUsage**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [runtime/types.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L214)

**`Experimental`**

Sum of every iteration's token usage. Forward to
 `ctx.cost.observeTokens` in a `runProfileMatrix` dispatch so the
 integrity guard sees real LLM activity.

***

### SandboxClient

Defined in: [runtime/types.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L230)

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

Defined in: [runtime/types.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L231)

**`Experimental`**

###### Parameters

###### options?

`CreateSandboxOptions`

###### Returns

`Promise`\<`SandboxInstance`\>

##### describePlacement()?

> `optional` **describePlacement**(`box`): [`LoopSandboxPlacement`](#loopsandboxplacement)

Defined in: [runtime/types.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L232)

**`Experimental`**

###### Parameters

###### box

`SandboxInstance`

###### Returns

[`LoopSandboxPlacement`](#loopsandboxplacement)

##### criuStatus()?

> `optional` **criuStatus**(): `Promise`\<\{ `available`: `boolean`; `criuVersion?`: `string`; `reason?`: `string`; \}\>

Defined in: [runtime/types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L243)

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

Defined in: [runtime/types.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L267)

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

Defined in: [runtime/types.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L282)

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

Defined in: [runtime/types.ts:297](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L297)

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

Defined in: [runtime/types.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L309)

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

Defined in: [runtime/types.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L313)

**`Experimental`**

#### Extended by

- [`InProcessExecutorDescribePlacement`](mcp.md#inprocessexecutordescribeplacement)

#### Properties

##### kind

> **kind**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:314](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L314)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:315](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L315)

**`Experimental`**

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:316](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L316)

**`Experimental`**

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:317](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L317)

**`Experimental`**

***

### LoopTraceEmitter

Defined in: [runtime/types.ts:321](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L321)

**`Experimental`**

#### Methods

##### emit()

> **emit**(`event`): `void` \| `Promise`\<`void`\>

Defined in: [runtime/types.ts:322](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L322)

**`Experimental`**

###### Parameters

###### event

[`LoopTraceEvent`](#looptraceevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### LoopStartedPayload

Defined in: [runtime/types.ts:357](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L357)

**`Experimental`**

#### Properties

##### driver

> **driver**: `string`

Defined in: [runtime/types.ts:358](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L358)

**`Experimental`**

##### agentRunNames

> **agentRunNames**: `string`[]

Defined in: [runtime/types.ts:359](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L359)

**`Experimental`**

##### maxIterations

> **maxIterations**: `number`

Defined in: [runtime/types.ts:360](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L360)

**`Experimental`**

##### maxConcurrency

> **maxConcurrency**: `number`

Defined in: [runtime/types.ts:361](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L361)

**`Experimental`**

***

### LoopPlanPayload

Defined in: [runtime/types.ts:372](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L372)

**`Experimental`**

Emitted once per `plan()` round, immediately after the driver plans. Carries
the topology move so a viewer renders WHAT the agent decided + WHY, not just
the inferred fan-width. `moveKind` is the driver's `describePlan().kind` when
provided, else inferred from `plannedCount` (0→stop, 1→refine, N→fanout).

#### Properties

##### roundIndex

> **roundIndex**: `number`

Defined in: [runtime/types.ts:374](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L374)

**`Experimental`**

0-based plan round (one per `plan()` call).

##### plannedCount

> **plannedCount**: `number`

Defined in: [runtime/types.ts:376](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L376)

**`Experimental`**

Tasks the driver issued this round.

##### moveKind

> **moveKind**: `string`

Defined in: [runtime/types.ts:378](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L378)

**`Experimental`**

Topology move — `'refine' | 'fanout' | 'verify' | 'stop'` etc.

##### rationale?

> `optional` **rationale?**: `string`

Defined in: [runtime/types.ts:380](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L380)

**`Experimental`**

Driver rationale for the move, when available.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:386](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L386)

**`Experimental`**

Iteration index this round branched FROM (the edge source). `undefined`
for round 0 (root). Kernel-inferred branch point — the best-valid (else
latest) iteration so far — unless a driver later declares it explicitly.

##### childIndices

> **childIndices**: `number`[]

Defined in: [runtime/types.ts:388](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L388)

**`Experimental`**

Iteration indices this round dispatched (the edge targets).

***

### LoopIterationStartedPayload

Defined in: [runtime/types.ts:392](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L392)

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:393](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L393)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:394](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L394)

**`Experimental`**

##### taskHash

> **taskHash**: `string`

Defined in: [runtime/types.ts:395](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L395)

**`Experimental`**

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:397](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L397)

**`Experimental`**

Plan round (== `LoopPlanPayload.roundIndex`) this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:399](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L399)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationDispatchPayload

Defined in: [runtime/types.ts:410](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L410)

**`Experimental`**

Where the iteration's worker was placed. `sibling` = a fresh sandbox the
kernel created via `sandboxClient.create`. `fleet` = an existing machine in
a shared-workspace fleet — workers see the caller's filesystem and any diff
they write lands on it directly.

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:411](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L411)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:412](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L412)

**`Experimental`**

##### placement

> **placement**: `"sibling"` \| `"fleet"`

Defined in: [runtime/types.ts:413](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L413)

**`Experimental`**

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:415](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L415)

**`Experimental`**

Set on every placement. Lets analyst loops correlate per-iteration logs.

##### fleetId?

> `optional` **fleetId?**: `string`

Defined in: [runtime/types.ts:417](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L417)

**`Experimental`**

Set only when `placement === 'fleet'`.

##### machineId?

> `optional` **machineId?**: `string`

Defined in: [runtime/types.ts:419](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L419)

**`Experimental`**

Set only when `placement === 'fleet'`.

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:421](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L421)

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:423](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L423)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

***

### LoopIterationEndedPayload

Defined in: [runtime/types.ts:427](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L427)

**`Experimental`**

#### Properties

##### iterationIndex

> **iterationIndex**: `number`

Defined in: [runtime/types.ts:428](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L428)

**`Experimental`**

##### agentRunName

> **agentRunName**: `string`

Defined in: [runtime/types.ts:429](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L429)

**`Experimental`**

##### outputHash?

> `optional` **outputHash?**: `string`

Defined in: [runtime/types.ts:430](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L430)

**`Experimental`**

##### verdict?

> `optional` **verdict?**: `DefaultVerdict`

Defined in: [runtime/types.ts:431](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L431)

**`Experimental`**

##### error?

> `optional` **error?**: `string`

Defined in: [runtime/types.ts:432](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L432)

**`Experimental`**

##### costUsd

> **costUsd**: `number`

Defined in: [runtime/types.ts:433](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L433)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [runtime/types.ts:434](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L434)

**`Experimental`**

##### tokenUsage?

> `optional` **tokenUsage?**: [`LoopTokenUsage`](#looptokenusage)

Defined in: [runtime/types.ts:437](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L437)

**`Experimental`**

Summed LLM token usage for this iteration — maps to gen_ai.usage.* on the
 branch span. Omitted when no `llm_call` events carried token counts.

##### groupId?

> `optional` **groupId?**: `number`

Defined in: [runtime/types.ts:439](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L439)

**`Experimental`**

Plan round this iteration belongs to.

##### parentIndex?

> `optional` **parentIndex?**: `number`

Defined in: [runtime/types.ts:441](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L441)

**`Experimental`**

Iteration this one was planned from; `undefined` ⇒ root.

##### outputPreview?

> `optional` **outputPreview?**: `string`

Defined in: [runtime/types.ts:444](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L444)

**`Experimental`**

Truncated string preview of the parsed output — for a viewer's drawer.
 Bounded to ~280 chars; never the full payload.

***

### LoopDecisionPayload

Defined in: [runtime/types.ts:448](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L448)

**`Experimental`**

#### Properties

##### decision

> **decision**: `string`

Defined in: [runtime/types.ts:449](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L449)

**`Experimental`**

##### historyLength

> **historyLength**: `number`

Defined in: [runtime/types.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L450)

**`Experimental`**

***

### LoopEndedPayload

Defined in: [runtime/types.ts:454](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L454)

**`Experimental`**

#### Properties

##### winnerIterationIndex?

> `optional` **winnerIterationIndex?**: `number`

Defined in: [runtime/types.ts:455](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L455)

**`Experimental`**

##### totalCostUsd

> **totalCostUsd**: `number`

Defined in: [runtime/types.ts:456](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L456)

**`Experimental`**

##### durationMs

> **durationMs**: `number`

Defined in: [runtime/types.ts:457](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L457)

**`Experimental`**

##### iterations

> **iterations**: `number`

Defined in: [runtime/types.ts:458](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L458)

**`Experimental`**

***

### LoopTeardownFailedPayload

Defined in: [runtime/types.ts:464](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L464)

**`Experimental`**

Emitted when a box's `delete()` throws or times out during teardown — the
 loop swallows the failure (platform reaps on expiry) but surfaces it here so
 a real leak (e.g. mid-loop auth expiry) is observable.

#### Properties

##### sandboxId?

> `optional` **sandboxId?**: `string`

Defined in: [runtime/types.ts:465](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L465)

**`Experimental`**

##### reason

> **reason**: `string`

Defined in: [runtime/types.ts:467](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L467)

**`Experimental`**

`'timeout'` or the delete error message.

***

### ExecCtx

Defined in: [runtime/types.ts:471](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L471)

**`Experimental`**

#### Properties

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](#sandboxclient-1)

Defined in: [runtime/types.ts:473](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L473)

**`Experimental`**

Sandbox SDK client — the kernel calls `.create()` per iteration.

##### hooks?

> `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/types.ts:475](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L475)

**`Experimental`**

Optional runtime hooks. Execution-scoped; never part of `AgentProfile`.

##### traceEmitter?

> `optional` **traceEmitter?**: [`LoopTraceEmitter`](#looptraceemitter)

Defined in: [runtime/types.ts:477](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L477)

**`Experimental`**

Optional trace emitter. When set, the kernel emits `loop.*` events.

##### runHandle?

> `optional` **runHandle?**: [`RuntimeRunHandle`](index.md#runtimerunhandle)

Defined in: [runtime/types.ts:483](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L483)

**`Experimental`**

Optional production-run handle. When set, every synthesized `llm_call`
the kernel infers from a sandbox event stream is forwarded via
`runHandle.observe` so per-run cost aggregates pick up loop spend.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [runtime/types.ts:485](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L485)

**`Experimental`**

Cooperative cancellation signal.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: [runtime/types.ts:491](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L491)

**`Experimental`**

Trace id for OTEL correlation. When set alongside `traceEmitter`, the
exporter uses this as the parent trace for all emitted spans. Typically
inherited from TRACE_ID env var in MCP subprocess mode.

##### parentSpanId?

> `optional` **parentSpanId?**: `string`

Defined in: [runtime/types.ts:496](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L496)

**`Experimental`**

Parent span id for OTEL correlation. Loop events become children of
this span. Typically inherited from PARENT_SPAN_ID env var.

***

### VerifierEnvironmentOptions

Defined in: [runtime/verifier-environment.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L34)

#### Properties

##### name

> **name**: `string`

Defined in: [runtime/verifier-environment.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L35)

##### extraTools?

> `optional` **extraTools?**: [`AgenticTool`](#agentictool)[]

Defined in: [runtime/verifier-environment.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L39)

Extra domain tools (read-only helpers: calculator, retrieval, style lookup).

#### Methods

##### check()

> **check**(`task`, `answer`): [`SurfaceScore`](#surfacescore) \| `Promise`\<[`SurfaceScore`](#surfacescore)\>

Defined in: [runtime/verifier-environment.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L37)

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

Defined in: [runtime/verifier-environment.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L41)

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

Defined in: [runtime/waterfall.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L11)

#### Properties

##### id

> **id**: `string`

Defined in: [runtime/waterfall.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L12)

##### label

> **label**: `string`

Defined in: [runtime/waterfall.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L14)

The spawn label (`shot:0`, `analyst:1`, a nested agent's label) — the row name.

##### runId

> **runId**: `string`

Defined in: [runtime/waterfall.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L15)

##### parentId?

> `optional` **parentId?**: `string`

Defined in: [runtime/waterfall.ts:16](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L16)

##### startMs

> **startMs**: `number`

Defined in: [runtime/waterfall.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L17)

##### endMs?

> `optional` **endMs?**: `number`

Defined in: [runtime/waterfall.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L18)

##### status

> **status**: `"running"` \| `"done"` \| `"down"`

Defined in: [runtime/waterfall.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L19)

##### usd

> **usd**: `number`

Defined in: [runtime/waterfall.ts:20](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L20)

##### tokens

> **tokens**: `object`

Defined in: [runtime/waterfall.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L21)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### score?

> `optional` **score?**: `number`

Defined in: [runtime/waterfall.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L22)

***

### WaterfallReport

Defined in: [runtime/waterfall.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L25)

#### Properties

##### spans

> **spans**: [`WaterfallSpan`](#waterfallspan)[]

Defined in: [runtime/waterfall.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L26)

##### totalMs

> **totalMs**: `number`

Defined in: [runtime/waterfall.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L28)

Wall-clock of the observed window (first spawn → last settle).

##### totalUsd

> **totalUsd**: `number`

Defined in: [runtime/waterfall.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L29)

##### totalTokens

> **totalTokens**: `object`

Defined in: [runtime/waterfall.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L30)

###### input

> **input**: `number`

###### output

> **output**: `number`

##### byKind

> **byKind**: `Record`\<`string`, \{ `count`: `number`; `ms`: `number`; `usd`: `number`; `tokens`: \{ `input`: `number`; `output`: `number`; \}; \}\>

Defined in: [runtime/waterfall.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L32)

Rollup by label prefix (the part before ':') — shots vs analysts vs anything else.

***

### WaterfallCollector

Defined in: [runtime/waterfall.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L49)

#### Properties

##### hooks

> **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

Defined in: [runtime/waterfall.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L51)

Attach these to RunAgenticOptions.hooks / BenchmarkConfig.hooks.

#### Methods

##### report()

> **report**(): [`WaterfallReport`](#waterfallreport)

Defined in: [runtime/waterfall.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L52)

###### Returns

[`WaterfallReport`](#waterfallreport)

##### render()

> **render**(`opts?`): `string`

Defined in: [runtime/waterfall.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L54)

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

Defined in: [runtime/waterfall.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L55)

###### Returns

`void`

***

### Workspace

Defined in: [runtime/workspace.ts:11](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L11)

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: [runtime/workspace.ts:12](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L12)

#### Methods

##### materialize()

> **materialize**(`dir`): `Promise`\<`void`\>

Defined in: [runtime/workspace.ts:13](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L13)

###### Parameters

###### dir

`string`

###### Returns

`Promise`\<`void`\>

##### commit()

> **commit**(`dir`, `message`): `Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

Defined in: [runtime/workspace.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L14)

###### Parameters

###### dir

`string`

###### message

`string`

###### Returns

`Promise`\<[`WorkspaceCommit`](#workspacecommit)\>

##### head()

> **head**(): `Promise`\<`string`\>

Defined in: [runtime/workspace.ts:15](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L15)

###### Returns

`Promise`\<`string`\>

***

### GitWorkspaceOptions

Defined in: [runtime/workspace.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L39)

#### Properties

##### ref

> `readonly` **ref**: `string`

Defined in: [runtime/workspace.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L40)

##### shell?

> `readonly` `optional` **shell?**: [`Shell`](#shell)

Defined in: [runtime/workspace.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L41)

##### branch?

> `readonly` `optional` **branch?**: `string`

Defined in: [runtime/workspace.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L42)

##### noHooks?

> `readonly` `optional` **noHooks?**: `boolean`

Defined in: [runtime/workspace.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L43)

***

### WorkspaceRun

Defined in: [runtime/workspace.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L135)

#### Type Parameters

##### T

`T`

#### Properties

##### valid

> `readonly` **valid**: `boolean`

Defined in: [runtime/workspace.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L136)

##### value

> `readonly` **value**: `T`

Defined in: [runtime/workspace.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L137)

##### commit?

> `readonly` `optional` **commit?**: [`WorkspaceCommit`](#workspacecommit)

Defined in: [runtime/workspace.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L139)

Present when a commit was attempted (valid, or `commitOnInvalid`).

## Type Aliases

### CoordinationEvent

> **CoordinationEvent** = \{ `type`: `"question"`; `question`: [`QuestionRecord`](mcp.md#questionrecord); \} \| \{ `type`: `"settled"`; `worker`: [`SettledWorker`](mcp.md#settledworker); \} \| \{ `type`: `"finding"`; `finding`: `AnalystFindingEvent`; \} \| \{ `type`: `"steer"`; `down`: `DownMessageEvent`; \} \| \{ `type`: `"answer"`; `down`: `DownMessageEvent`; `questionId`: `string`; \}

Defined in: [mcp/tools/coordination.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/mcp/tools/coordination.ts#L85)

Every message on the one typed pipe. UP (child→parent): question / settled / finding — queued for
 the driver to `pull`. DOWN (parent→child): steer / answer — record-only (history + subscribers),
 routed to the child inbox. New kinds are additive.

***

### LoopOptionsForDispatch

> **LoopOptionsForDispatch**\<`Task`, `Output`, `Decision`\> = `Omit`\<`RunLoopOptions`\<`Task`, `Output`, `Decision`\>, `"ctx"`\>

Defined in: [runtime/loop-dispatch.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L44)

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

Defined in: [runtime/personify/types.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L54)

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

Defined in: [runtime/personify/types.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L143)

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

> **LoopShape**\<`Task`, `D`\> = (`ctx`) => [`Agent`](#agent)\<`Task`, [`Outcome`](#outcome-1)\<`D`\>\>

Defined in: [runtime/personify/types.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L192)

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

[`Agent`](#agent)\<`Task`, [`Outcome`](#outcome-1)\<`D`\>\>

***

### RunPersonified

> **RunPersonified** = \<`Task`, `D`\>(`options`) => `Promise`\<[`SupervisedResult`](#supervisedresult)\<[`Outcome`](#outcome-1)\<`D`\>\>\>

Defined in: [runtime/personify/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/types.ts#L255)

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

Defined in: [runtime/personify/wave-types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L64)

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

Defined in: [runtime/personify/wave-types.ts:89](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L89)

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

Defined in: [runtime/personify/wave-types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L138)

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

Defined in: [runtime/personify/wave-types.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L144)

Built-in valid-only winner strategies for `selectValidWinner` (selector≠judge): best gated-valid
 score, the smallest delivered artifact (via a `sizeOf` extractor), or the earliest valid.

***

### Fanout

> **Fanout** = \<`Task`, `Item`, `D`\>(`items`, `opts`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:155](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L155)

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

Defined in: [runtime/personify/wave-types.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L193)

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

Defined in: [runtime/personify/wave-types.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L243)

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

Defined in: [runtime/personify/wave-types.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L269)

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

Defined in: [runtime/personify/wave-types.ts:323](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L323)

A widening decision: extend one lineage by one child, or stop widening. `flatWidenGate`
 always returns `{ kind: 'stop' }`.

#### Type Parameters

##### D

`D`

***

### Widen

> **Widen** = \<`Task`, `Seed`, `D`\>(`spec`) => [`CombinatorShape`](#combinatorshape)\<`Task`, `D`\>

Defined in: [runtime/personify/wave-types.ts:335](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L335)

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

Defined in: [runtime/personify/wave-types.ts:340](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L340)

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

Defined in: [runtime/personify/wave-types.ts:401](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L401)

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

Defined in: [runtime/personify/wave-types.ts:492](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L492)

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

Defined in: [runtime/personify/wave-types.ts:551](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L551)

`trajectoryReport(...)` — the tree+cost reconstructor. Async (reads journal + optionally blobs).

#### Parameters

##### journal

`SpawnJournal`

##### blobs

[`ResultBlobStore`](#resultblobstore)

##### root

`NodeId`

##### options?

[`TrajectoryReportOptions`](#trajectoryreportoptions)

#### Returns

`Promise`\<[`TrajectoryReport`](#trajectoryreport-3)\>

***

### EqualKOnCost

> **EqualKOnCost** = (`arms`, `options?`) => [`EqualKVerdict`](#equalkverdict)

Defined in: [runtime/personify/wave-types.ts:606](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/wave-types.ts#L606)

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

Defined in: [runtime/run-benchmark.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L30)

A checkable task domain — implement these 5 hooks and the suite does the rest. The
 same seam as `AgenticSurface`; `Environment` is the RL/gym-standard name for it.

***

### Deliverable

> **Deliverable**\<`Out`\> = \{ `kind`: `"events"`; `fromEvents`: (`events`) => `Out`; \} \| \{ `kind`: `"artifact"`; `path`: `string`; `fromArtifact`: (`raw`, `events`) => `Out`; \}

Defined in: [runtime/sandbox-run.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L50)

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

### ChampionPolicy

> **ChampionPolicy** = `"score"` \| `"costAware"`

Defined in: [runtime/strategy-evolution.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L55)

***

### BudgetReadout

> **BudgetReadout** = `Readonly`\<\{ `tokensLeft`: `number`; `usdLeft`: `number`; `usdCapped`: `boolean`; `deadlineMs`: `number`; `reservedTokens`: `number`; \}\>

Defined in: [runtime/supervise/budget.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L43)

Post-reservation pool readout — the shape `Scope.budget` exposes. `tokensLeft`,
 `usdLeft`, and `reservedTokens` reflect committed-but-unsettled reservations;
 `deadlineMs` is the ABSOLUTE wall-clock deadline (0 when the root set none).
 `usdCapped` distinguishes a real `usdLeft <= 0` exhaustion from an uncapped pool (which always
 reads `usdLeft: 0`) — the in-loop guard needs it to bound a usd-capped driver.

***

### ExecutorConfig

> **ExecutorConfig** = `object` & `RouterSeam` \| `object` & `RouterToolsSeam` \| `object` & `BridgeSeam` \| `object` & `CliSeam` \| `object` & `CliWorktreeSeam` \| `object` & `SandboxSeam`

Defined in: [runtime/supervise/runtime.ts:1138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1138)

Config for [createExecutor](#createexecutor): the backend is DATA — the cost dial a profile,
an experiment config, or a replay journal can name — not an import choice. Each
variant carries its backend's seam (router/router-tools/bridge/cli/cli-worktree/sandbox).

***

### DriveHarness

> **DriveHarness** = (`args`) => `Promise`\<`void`\>

Defined in: [runtime/supervise/supervisor-agent.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L40)

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

Defined in: [runtime/supervise/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L130)

Normalized usage event — the single channel every executor reports through, so the
conserved pool meters all runtimes identically. `tokens` carries `LoopTokenUsage`'s
`{ input, output }`; `usd` is a SEPARATE channel (never folded into tokens).

***

### Settled

> **Settled**\<`Out`\> = \{ `kind`: `"done"`; `handle`: `Handle`\<`Out`\>; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `spent`: [`Spend`](#spend); `seq`: `number`; \} \| \{ `kind`: `"down"`; `handle`: `Handle`\<`Out`\>; `reason`: `string`; `infra`: `boolean`; `restartCount`: `number`; `seq`: `number`; \}

Defined in: [runtime/supervise/types.ts:255](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L255)

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

### SupervisedResult

> **SupervisedResult**\<`Out`\> = \{ `kind`: `"winner"`; `out`: `Out`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](#treeview); `spentTotal`: [`Spend`](#spend); `spentBreakdown?`: \{ `driverInference`: [`Spend`](#spend); `childWork`: [`Spend`](#spend); \}; \} \| \{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; \}

Defined in: [runtime/supervise/types.ts:459](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/types.ts#L459)

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

\{ `kind`: `"no-winner"`; `reason`: `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"`; `tree`: [`TreeView`](#treeview); `downCount`: `number`; \}

***

### WorktreePatchArtifact

> **WorktreePatchArtifact** = `WorktreeHarnessResult`

Defined in: [runtime/supervise/worktree-cli-executor.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L40)

Terminal artifact of one worktree-CLI run — the canonical worktree-harness result (the captured
 diff + the harness's run record + the derived checks).

***

### ToolLoopChat

> **ToolLoopChat** = (`messages`, `tools`) => `Promise`\<\{ `content?`: `string` \| `null`; `toolCalls`: [`RouterToolCall`](#routertoolcall)[]; `usage?`: \{ `input`: `number`; `output`: `number`; \}; `costUsd?`: `number`; \}\>

Defined in: [runtime/tool-loop.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/tool-loop.ts#L17)

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

### LoopTraceEvent

> **LoopTraceEvent** = \{ `kind`: `"loop.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopStartedPayload`](#loopstartedpayload); \} \| \{ `kind`: `"loop.plan"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopPlanPayload`](#loopplanpayload); \} \| \{ `kind`: `"loop.iteration.started"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationStartedPayload`](#loopiterationstartedpayload); \} \| \{ `kind`: `"loop.iteration.dispatch"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationDispatchPayload`](#loopiterationdispatchpayload); \} \| \{ `kind`: `"loop.iteration.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopIterationEndedPayload`](#loopiterationendedpayload); \} \| \{ `kind`: `"loop.decision"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopDecisionPayload`](#loopdecisionpayload); \} \| \{ `kind`: `"loop.ended"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopEndedPayload`](#loopendedpayload); \} \| \{ `kind`: `"loop.teardown.failed"`; `runId`: `string`; `timestamp`: `number`; `payload`: [`LoopTeardownFailedPayload`](#loopteardownfailedpayload); \}

Defined in: [runtime/types.ts:326](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/types.ts#L326)

**`Experimental`**

***

### Shell

> **Shell** = (`args`, `cwd?`) => `Promise`\<\{ `stdout`: `string`; `stderr`: `string`; `code`: `number`; \}\>

Defined in: [runtime/workspace.ts:2](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L2)

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

Defined in: [runtime/workspace.ts:7](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L7)

## Variables

### defaultAuditorInstruction

> `const` **defaultAuditorInstruction**: `string`

Defined in: [runtime/audit-intent.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L65)

***

### defaultAnalystInstruction

> `const` **defaultAnalystInstruction**: `string`

Defined in: [runtime/observe.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L57)

The default observer instruction — exported so an optimizer can seed its population.

***

### assertTraceDerivedFindings

> `const` **assertTraceDerivedFindings**: [`AssertTraceDerivedFindings`](#asserttracederivedfindings-1)

Defined in: [runtime/personify/analyst.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L46)

***

### builtinShapes

> `const` **builtinShapes**: [`ShapeRegistry`](#shaperegistry)

Defined in: [runtime/personify/registry.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L49)

The default registry `runPersonified` resolves a shape name against. Empty by construction —
 a caller registers its own composed shapes; the engine ships no domain shape.

***

### strategyAuthorContract

> `const` **strategyAuthorContract**: "\nYou author an OPTIMIZATION STRATEGY for an agentic loop system. A strategy decides how to\nspend a compute budget to beat a task's deployable check. You compose exactly two steps:\n\n  shot(spec?: \{ handle?, messages?, steer?, persona?, tools? \}): Promise\<ShotResult \| null\>\n    Runs ONE worker attempt (a bounded tool loop) over an artifact.\n    - omit handle  =\> the shot opens its OWN fresh artifact and closes it after (a sample).\n    - pass handle  =\> the shot CONTINUES that artifact (state accumulates across shots).\n    - messages     =\> the carried conversation (pass the previous ShotResult.messages to continue).\n    - steer        =\> a corrective instruction injected before the shot.\n    - persona      =\> \{ systemPrompt?, model? \} — give THIS shot its own role and/or model\n      (multi-agent strategies: a researcher shot then an engineer shot, a panel of k\n      personas over one budget). On a fresh shot the systemPrompt replaces the task's; on\n      a carried conversation it arrives as a hand-off message. Same conserved budget.\n    - tools        =\> string\[\] — restrict THIS shot to a subset of the task's tools by\n      name (focus an explore shot on read-only tools, an execute shot on write tools).\n      Restriction-only; unknown names make the shot fail. ALWAYS select from\n      await listTools(handle) — never hardcode. Omitted =\> the shot sees every tool.\n    ShotResult = \{ messages, score (0..1 on the task's check), passes, total, completions, toolErrors \}\n    Returns null if the attempt failed infra-wise.\n\n  critique(messages): Promise\<string \| null\>\n    A firewalled trace-analyst reads the attempt's trajectory and returns ONE corrective\n    instruction (or null when it judges the work complete). Costs ~1 completion.\n\n  consult(messages, instruction): Promise\<string \| null\>\n    The RAW analyst channel: the same firewalled critic answers YOUR instruction over the\n    trajectory verbatim (no reformatting) — use it when you need a specific reply format\n    (a decision, a prediction). Costs ~1 completion.\n\n  surface.open(task) / surface.close(handle)\n    Open a persistent artifact you manage yourself (remember to close in a finally).\n    close is idempotent — closing an already-closed handle is a safe no-op.\n\n  listTools(handle): Promise\<Array\<\{ name, description? \}\>\>\n    The tools THIS task actually offers. TOOL SETS VARY PER TASK — if you restrict a\n    shot with \`tools\`, you MUST pick names from await listTools(handle); hardcoding\n    names from an example kills your shots on every task whose tools differ.\n\nRules:\n- ALWAYS await every shot/critique/surface call — a floating promise that rejects\n  crashes the whole benchmark run.\n- Stay within ~budget total shots; every shot/critique spends from a conserved pool.\n- For a FRESH attempt OMIT \`messages\` entirely (never pass \`\[\]\` — an empty array is a\n  fresh conversation too, but be explicit). To CONTINUE, pass the previous\n  ShotResult.messages unchanged.\n- Return \{ score, resolved, completions, progression, shots \} — score = the BEST checkpoint\n  you reached (keep-best, never final-state), progression = score after each shot.\n- The module must be EXACTLY this shape (no other imports, no commentary outside code):\n\nimport \{ defineStrategy \} from '@tangle-network/agent-runtime/loops'\nexport default defineStrategy('your-strategy-name', async (\{ surface, task, budget, shot, critique, listTools \}) =\> \{\n  // your composition (listTools comes from the destructured context — it is NOT a global)\n\})\n"

Defined in: [runtime/strategy-author.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L21)

The compressed consumable a skill carries: everything an author needs to emit a loop.

***

### sample

> `const` **sample**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:662](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L662)

***

### refine

> `const` **refine**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:666](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L666)

***

### adaptiveRefine

> `const` **adaptiveRefine**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:866](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L866)

A NEW strategy, authored from the steps (~20 lines): refine, but when a steered shot
 fails to improve the score it ABANDONS that line and restarts fresh (branch-when-stuck)
 — the widen/MCTS idea the depth-stuck failure motivated. Scored keep-best (the best
 checkpoint across all lines), the deployable metric. This is the "experts build BETTER
 optimizations" path: a new technique, compact, with zero Supervisor ceremony.

***

### sampleThenRefine

> `const` **sampleThenRefine**: [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:909](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L909)

The explore-then-exploit MIX: spend ⌈budget/2⌉ on independent samples (kept open),
 then refine the best-verifying line with the remaining budget. Sample's basin escape +
 refine's accumulation — the third built-in, authored from the public steps.

***

### defaultProfileRichnessThresholds

> `const` **defaultProfileRichnessThresholds**: [`ProfileRichnessThresholds`](#profilerichnessthresholds)

Defined in: [runtime/supervise/authoring.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L138)

***

### cliWorktreeExecutor

> `const` **cliWorktreeExecutor**: `ExecutorFactory`\<`unknown`\>

Defined in: [runtime/supervise/runtime.ts:1113](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1113)

The leaf `createWorktreeCliExecutor` as a backend-as-data factory: a supervisor-authored
`AgentProfile` driving claude / codex / opencode on its own worktree. `budgetExempt` like
the other CLI leaves; the authored systemPrompt + model reach the harness via §1.5.

## Functions

### contentAddress()

> **contentAddress**(`artifact`): `string`

Defined in: [durable/spawn-journal.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/durable/spawn-journal.ts#L48)

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

### anytimeReport()

> **anytimeReport**(`spans`, `opts?`): [`AnytimeReport`](#anytimereport)

Defined in: [runtime/anytime.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L73)

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

Defined in: [runtime/anytime.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/anytime.ts#L164)

One row per (strategy, satisficing target): the shareable time-to-satisfactory table.

#### Parameters

##### report

[`AnytimeReport`](#anytimereport)

#### Returns

`string`

***

### auditIntent()

> **auditIntent**(`input`, `opts`): `Promise`\<[`IntentAudit`](#intentaudit)\>

Defined in: [runtime/audit-intent.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/audit-intent.ts#L108)

#### Parameters

##### input

[`AuditIntentInput`](#auditintentinput)

##### opts

[`AuditIntentOptions`](#auditintentoptions)

#### Returns

`Promise`\<[`IntentAudit`](#intentaudit)\>

***

### completionAuthorizes()

> **completionAuthorizes**(`v`, `policy?`): `boolean`

Defined in: [runtime/completion.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L62)

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

Defined in: [runtime/completion.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L73)

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

Defined in: [runtime/completion.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L86)

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

Defined in: [runtime/completion.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/completion.ts#L111)

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

### harvestCorpus()

> **harvestCorpus**(`opts`): `Promise`\<[`HarvestReport`](#harvestreport)\>

Defined in: [runtime/harvest-corpus.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/harvest-corpus.ts#L62)

#### Parameters

##### opts

[`HarvestCorpusOptions`](#harvestcorpusoptions)

#### Returns

`Promise`\<[`HarvestReport`](#harvestreport)\>

***

### inlineSandboxClient()

> **inlineSandboxClient**(`factory`): [`SandboxClient`](#sandboxclient-1)

Defined in: [runtime/inline-sandbox-client.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/inline-sandbox-client.ts#L44)

Adapt an `ExecutorFactory` into a `SandboxClient` for `runLoop`. The factory is
instantiated fresh per `streamPrompt` (mirrors the per-spawn executor lifecycle):
run once on the prompt, emit the terminal result event, tear down.

#### Parameters

##### factory

`ExecutorFactory`\<`unknown`\>

#### Returns

[`SandboxClient`](#sandboxclient-1)

***

### loopDispatch()

> **loopDispatch**\<`Task`, `Output`, `Decision`, `TScenario`, `TArtifact`\>(`opts`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Defined in: [runtime/loop-dispatch.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/loop-dispatch.ts#L114)

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

### createMcpEnvironment()

> **createMcpEnvironment**(`opts`): [`AgenticSurface`](#agenticsurface)

Defined in: [runtime/mcp-environment.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/mcp-environment.ts#L94)

#### Parameters

##### opts

[`McpEnvironmentOptions`](#mcpenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### observe()

> **observe**(`input`, `opts`): `Promise`\<[`Observation`](#observation)\>

Defined in: [runtime/observe.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L139)

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

Defined in: [runtime/observe.ts:226](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/observe.ts#L226)

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

Defined in: [runtime/personify/analyst.ts:96](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L96)

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

Defined in: [runtime/personify/analyst.ts:202](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L202)

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

Defined in: [runtime/personify/analyst.ts:230](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/analyst.ts#L230)

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

readonly [`Settled`](#settled-2)\<[`Outcome`](#outcome-1)\<`D`\>\>[]

#### Returns

[`SteerContext`](#steercontext)\<`D`\>

***

### selectValidWinner()

> **selectValidWinner**\<`D`\>(`opts?`): [`FanoutWinnerSelector`](#fanoutwinnerselector)\<`D`\>

Defined in: [runtime/personify/combinators.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L58)

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

Defined in: [runtime/personify/combinators.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L100)

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

Defined in: [runtime/personify/combinators.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L138)

`fanout(items, opts)` — spawn one child per item in a single round (bounded by the conserved
pool's fail-closed admission), drain via `scope.next()`, then either synthesize over the
gathered settlements (one SEPARATE synthesis child) or return the best-valid child via the
single-sourced selector. A round that admitted zero children, or whose synthesis child could
not be admitted, is a concrete blocker.

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

Defined in: [runtime/personify/combinators.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L221)

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

Defined in: [runtime/personify/combinators.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L273)

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

Defined in: [runtime/personify/combinators.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L333)

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

Defined in: [runtime/personify/combinators.ts:387](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L387)

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

Defined in: [runtime/personify/combinators.ts:450](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/combinators.ts#L450)

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

Defined in: [runtime/personify/corpus.ts:301](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/corpus.ts#L301)

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

Defined in: [runtime/personify/persona.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L56)

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

Defined in: [runtime/personify/persona.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/persona.ts#L131)

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

Defined in: [runtime/personify/registry.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L25)

Build a fresh open `ShapeRegistry`. A factory is stored type-erased and re-cast on resolve — the
caller asserts the `<Task, D>` it expects, exactly as the executor registry stores its factories.

#### Returns

[`ShapeRegistry`](#shaperegistry)

***

### registerShape()

> **registerShape**\<`Task`, `D`\>(`name`, `factory`): `void`

Defined in: [runtime/personify/registry.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/registry.ts#L53)

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

Defined in: [runtime/personify/trajectory.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L52)

Reconstruct the whole spawn tree for `root` with per-node + rolled-up `Spend`. Reads the
journal for structure + spend and, when `withOutputs`, the blob store for each `done`
node's artifact. Fail loud on a tree that was never journaled, a settle/cancel for an
un-spawned node (a corrupted log), or — under `withOutputs` — a `done` node whose blob the
store cannot rehydrate (a silent gap would mis-cost or mis-evidence the tree).

#### Parameters

##### journal

`SpawnJournal`

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

Defined in: [runtime/personify/trajectory.ts:143](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/personify/trajectory.ts#L143)

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

Defined in: [runtime/promotion-gate.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/promotion-gate.ts#L63)

#### Parameters

##### opts

[`PromotionGateOptions`](#promotiongateoptions)

#### Returns

[`PromotionVerdict`](#promotionverdict)

***

### reportLoopUsage()

> **reportLoopUsage**\<`Task`, `Output`, `Decision`\>(`cost`, `result`, `source?`): `void`

Defined in: [runtime/report-usage.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/report-usage.ts#L34)

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

Defined in: [runtime/router-client.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L30)

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

#### Returns

`Promise`\<[`RouterChatResult`](#routerchatresult)\>

***

### routerChatWithTools()

> **routerChatWithTools**(`cfg`, `messages`, `tools`, `opts?`): `Promise`\<[`RouterChatToolsResult`](#routerchattoolsresult)\>

Defined in: [runtime/router-client.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L117)

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

Defined in: [runtime/router-client.ts:208](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L208)

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

Defined in: [runtime/router-client.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/router-client.ts#L250)

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

Defined in: [runtime/run-benchmark.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L132)

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

Defined in: [runtime/run-benchmark.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-benchmark.ts#L231)

Pretty-print a report — the "free optimization" verdict, with the cost vector.

#### Parameters

##### report

[`BenchmarkReport`](#benchmarkreport)

#### Returns

`void`

***

### runLoop()

> **runLoop**\<`Task`, `Output`, `Decision`\>(`options`): `Promise`\<[`LoopResult`](#loopresult)\<`Task`, `Output`, `Decision`\>\>

Defined in: [runtime/run-loop.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L135)

**`Experimental`**

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

Defined in: [runtime/run-loop.ts:983](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/run-loop.ts#L983)

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

Defined in: [runtime/sandbox-acquire.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-acquire.ts#L68)

**`Experimental`**

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-1)

##### options

`CreateSandboxOptions`

##### acquire?

`AcquireOptions` = `{}`

#### Returns

`Promise`\<`SandboxInstance`\>

***

### probeSandboxCapabilities()

> **probeSandboxCapabilities**(`client`): `Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

Defined in: [runtime/sandbox-capabilities.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-capabilities.ts#L45)

**`Experimental`**

Probe (and memoize per client) what the loop may rely on. A client without a
`criuStatus` method, or whose probe rejects, yields `canFork = false` — a
failed probe must never claim a capability the platform may not have. The
promise is cached so concurrent fanout branches share one round-trip.

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-1)

#### Returns

`Promise`\<[`SandboxCapabilities`](#sandboxcapabilities)\>

***

### extractLlmCallEvent()

> **extractLlmCallEvent**(`event`, `agentRunName`): RuntimeStreamEvent & \{ type: "llm\_call"; \} \| `undefined`

Defined in: [runtime/sandbox-events.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L32)

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

### mapSandboxEvent()

> **mapSandboxEvent**(`event`, `opts?`): [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: [runtime/sandbox-events.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-events.ts#L123)

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

Defined in: [runtime/sandbox-lineage.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-lineage.ts#L189)

**`Experimental`**

Build a lineage bound to one client + its probed capabilities. The
capabilities are passed in (not re-probed) so the kernel probes once per run
and the lineage stays a pure function of "what this platform can do".

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-1)

##### capabilities

[`SandboxCapabilities`](#sandboxcapabilities)

##### options?

###### maxConcurrency?

`number`

###### streaming?

`"sse"` \| `"poll"`

#### Returns

[`SandboxLineage`](#sandboxlineage)

***

### openSandboxRun()

> **openSandboxRun**\<`Out`\>(`client`, `options`, `deliverable`): `Promise`\<[`SandboxRun`](#sandboxrun)\<`Out`\>\>

Defined in: [runtime/sandbox-run.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/sandbox-run.ts#L104)

**`Experimental`**

Open a sandbox run. Harness-agnostic: the harness lives in
`options.agentRun.sandboxOverrides.backend.type`, so opencode/codex/claude-code/
kimi-code all flow through this one entrypoint with identical env/auth wiring.

#### Type Parameters

##### Out

`Out`

#### Parameters

##### client

[`SandboxClient`](#sandboxclient-1)

##### options

[`OpenSandboxRunOptions`](#opensandboxrunoptions)

##### deliverable

[`Deliverable`](#deliverable)\<`Out`\>

#### Returns

`Promise`\<[`SandboxRun`](#sandboxrun)\<`Out`\>\>

***

### assertStrategyContract()

> **assertStrategyContract**(`code`): `void`

Defined in: [runtime/strategy-author.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L114)

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

Defined in: [runtime/strategy-author.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-author.ts#L179)

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

Defined in: [runtime/strategy-evolution.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L237)

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

Defined in: [runtime/strategy-evolution.ts:262](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L262)

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

Defined in: [runtime/strategy-evolution.ts:285](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L285)

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

Defined in: [runtime/strategy-evolution.ts:364](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy-evolution.ts#L364)

#### Parameters

##### cfg

[`StrategyEvolutionConfig`](#strategyevolutionconfig)

#### Returns

`Promise`\<[`EvolutionReport`](#evolutionreport)\>

***

### depthStrategy()

> **depthStrategy**(`surface`, `task`, `opts`, `cfg`): [`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:527](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L527)

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

[`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### breadthStrategy()

> **breadthStrategy**(`_surface`, `task`, `opts`, `cfg`): [`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

Defined in: [runtime/strategy.ts:595](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L595)

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

[`Agent`](#agent)\<`unknown`, [`Outcome`](#outcome-1)\<`unknown`\>\>

***

### defineStrategy()

> **defineStrategy**(`name`, `run`): [`Strategy`](#strategy-3)

Defined in: [runtime/strategy.ts:740](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L740)

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

Defined in: [runtime/strategy.ts:981](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/strategy.ts#L981)

Run a Strategy through the keystone Supervisor — `Agent.act` over a conserved-budget Scope.

#### Parameters

##### opts

[`RunAgenticOptions`](#runagenticoptions)

#### Returns

`Promise`\<[`AgenticRunResult`](#agenticrunresult)\>

***

### asAuthoredProfile()

> **asAuthoredProfile**(`raw`): [`AuthoredProfile`](#authoredprofile) \| `null`

Defined in: [runtime/supervise/authoring.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L34)

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

Defined in: [runtime/supervise/authoring.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L46)

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

> **authoredWorker**(`profile`, `opts`): [`Agent`](#agent)\<`unknown`, `unknown`\>

Defined in: [runtime/supervise/authoring.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L66)

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

[`Agent`](#agent)\<`unknown`, `unknown`\>

***

### assessAuthoredProfile()

> **assessAuthoredProfile**(`profile`, `opts?`): [`ProfileRichness`](#profilerichness)

Defined in: [runtime/supervise/authoring.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L180)

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

Defined in: [runtime/supervise/authoring.ts:243](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/authoring.ts#L243)

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

Defined in: [runtime/supervise/budget.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L92)

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

Defined in: [runtime/supervise/budget.ts:135](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/budget.ts#L135)

Create a conserved reservation pool from a root `Budget`. `now()` is injected so the
deadline readout is deterministic; defaults to `Date.now` for non-test callers. The
absolute deadline is fixed at construction (`now() + budget.deadlineMs`) so the
readout's `deadlineMs` is a stable wall-clock instant, not a shrinking remainder.

#### Parameters

##### root

[`Budget`](#budget-9)

##### now?

() => `number`

#### Returns

[`BudgetPool`](#budgetpool)

***

### gateOnDeliverable()

> **gateOnDeliverable**\<`Out`\>(`inner`, `deliverable`): [`Executor`](#executor)\<`Out`\>

Defined in: [runtime/supervise/completion-gate.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/completion-gate.ts#L44)

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

> **driverAgent**(`opts`): [`Agent`](#agent)\<`unknown`, `unknown`\>

Defined in: [runtime/supervise/coordination-driver.ts:110](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L110)

Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
`driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.

#### Parameters

##### opts

[`DriverAgentOptions`](#driveragentoptions)

#### Returns

[`Agent`](#agent)\<`unknown`, `unknown`\>

***

### finalizeBestDelivered()

> **finalizeBestDelivered**(`settled`, `blobs`): `Promise`\<`unknown`\>

Defined in: [runtime/supervise/coordination-driver.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-driver.ts#L263)

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

Defined in: [runtime/supervise/coordination-mcp.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/coordination-mcp.ts#L51)

Stand up the coordination MCP over a live scope. The HOST address is `127.0.0.1` (the bridge runs
 opencode locally, same host); pass `host` to bind elsewhere when the harness is remote.

#### Parameters

##### opts

###### scope

[`Scope`](#scope-1)\<`unknown`\>

###### blobs

[`ResultBlobStore`](#resultblobstore)

###### makeWorkerAgent

[`MakeWorkerAgent`](mcp.md#makeworkeragent)

###### perWorker

[`Budget`](#budget-9)

###### port?

`number`

###### host?

`string`

###### analysts?

[`AnalystRegistry`](mcp.md#analystregistry)

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

### defaultToolDetectors()

> **defaultToolDetectors**(): `StreamingDetector`[]

Defined in: [runtime/supervise/detector-monitor.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L37)

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

Defined in: [runtime/supervise/detector-monitor.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/detector-monitor.ts#L43)

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

### createEventBus()

> **createEventBus**\<`E`\>(`now?`): [`EventBus`](#eventbus)\<`E`\>

Defined in: [runtime/supervise/event-bus.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/event-bus.ts#L74)

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

Defined in: [runtime/supervise/inbox.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/inbox.ts#L55)

#### Returns

[`Inbox`](#inbox)

***

### assertModelAllowed()

> **assertModelAllowed**(`model`, `allowed`): `void`

Defined in: [runtime/supervise/model-policy.ts:14](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/model-policy.ts#L14)

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

Defined in: [runtime/supervise/patch-deliverable.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/patch-deliverable.ts#L44)

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

Defined in: [runtime/supervise/run-context.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/run-context.ts#L56)

Build a fresh in-memory run context. Every call returns NEW stores (no shared global
state between runs), so two runs never cross-contaminate their journals/blobs.

#### Parameters

##### opts?

[`InMemoryRunContextOptions`](#inmemoryruncontextoptions) = `{}`

#### Returns

[`InMemoryRunContext`](#inmemoryruncontext)

***

### createExecutor()

> **createExecutor**(`config`): `ExecutorFactory`\<`unknown`\>

Defined in: [runtime/supervise/runtime.ts:1154](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1154)

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

`ExecutorFactory`\<`unknown`\>

***

### createExecutorRegistry()

> **createExecutorRegistry**(): `ExecutorRegistry`

Defined in: [runtime/supervise/runtime.ts:1192](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/runtime.ts#L1192)

The open resolver/registry. Pre-registers the three built-ins under their
runtime tags (`'router'`, `'sandbox'`, `'cli'`) and accepts `register(name,
factory)` for any additional runtime — and a BYO `AgentSpec.executor` resolves
without touching the registry at all. NOT a closed switch; registration + BYO
ARE the extension points.

`resolve` precedence (frozen in `ExecutorRegistry`): a BYO `spec.executor` →
`harness === null` → the `'router'` factory; else a registered factory for the
harness-derived runtime (`'sandbox'` for any `BackendType`); else fail loud.

#### Returns

`ExecutorRegistry`

***

### createScope()

> **createScope**\<`Out`\>(`args`): [`Scope`](#scope-1)\<`Out`\>

Defined in: [runtime/supervise/scope.ts:188](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L188)

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

Defined in: [runtime/supervise/scope.ts:648](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/scope.ts#L648)

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

### workerFromBackend()

> **workerFromBackend**(`backend`, `deliverable?`): [`MakeWorkerAgent`](mcp.md#makeworkeragent)

Defined in: [runtime/supervise/supervise.ts:26](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L26)

Build the worker seam from a backend (WHERE workers run) + an optional completion oracle (the
 deliverable check that makes "settled ⟺ delivered" true — the guard against "ran but didn't
 deliver"). The ONE place a backend becomes a spawnable worker.

#### Parameters

##### backend

[`ExecutorConfig`](#executorconfig)

##### deliverable?

[`DeliverableSpec`](#deliverablespec)\<`unknown`\>

#### Returns

[`MakeWorkerAgent`](mcp.md#makeworkeragent)

***

### supervise()

> **supervise**(`profile`, `task`, `opts`): `Promise`\<[`SupervisedResult`](#supervisedresult)\<`unknown`\>\>

Defined in: [runtime/supervise/supervise.ts:98](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervise.ts#L98)

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

> **supervisorAgent**(`profile`, `deps`): [`Agent`](#agent)\<`unknown`, `unknown`\>

Defined in: [runtime/supervise/supervisor-agent.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor-agent.ts#L74)

#### Parameters

##### profile

[`SupervisorProfile`](#supervisorprofile)

##### deps

[`SupervisorAgentDeps`](#supervisoragentdeps)

#### Returns

[`Agent`](#agent)\<`unknown`, `unknown`\>

***

### createSupervisor()

> **createSupervisor**\<`Task`, `Out`\>(): [`Supervisor`](#supervisor)\<`Task`, `Out`\>

Defined in: [runtime/supervise/supervisor.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/supervisor.ts#L64)

#### Type Parameters

##### Task

`Task`

##### Out

`Out`

#### Returns

[`Supervisor`](#supervisor)\<`Task`, `Out`\>

***

### decodeToolPart()

> **decodeToolPart**(`part`, `harness?`): `ToolStepInput` \| `undefined`

Defined in: [runtime/supervise/trace-source.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L146)

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

Defined in: [runtime/supervise/trace-source.ts:171](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L171)

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

Defined in: [runtime/supervise/trace-source.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trace-source.ts#L286)

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

Defined in: [runtime/supervise/trajectory-recorder.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/trajectory-recorder.ts#L27)

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

Defined in: [runtime/supervise/worktree-cli-executor.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-cli-executor.ts#L85)

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

Defined in: [runtime/supervise/worktree-fanout.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/supervise/worktree-fanout.ts#L78)

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

Defined in: [runtime/verifier-environment.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/verifier-environment.ts#L67)

#### Parameters

##### opts

[`VerifierEnvironmentOptions`](#verifierenvironmentoptions)

#### Returns

[`AgenticSurface`](#agenticsurface)

***

### createWaterfallCollector()

> **createWaterfallCollector**(): [`WaterfallCollector`](#waterfallcollector)

Defined in: [runtime/waterfall.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/waterfall.ts#L58)

#### Returns

[`WaterfallCollector`](#waterfallcollector)

***

### localShell()

> **localShell**(): [`Shell`](#shell)

Defined in: [runtime/workspace.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L18)

#### Returns

[`Shell`](#shell)

***

### gitWorkspace()

> **gitWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: [runtime/workspace.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L46)

#### Parameters

##### opts

[`GitWorkspaceOptions`](#gitworkspaceoptions)

#### Returns

[`Workspace`](#workspace)

***

### jjWorkspace()

> **jjWorkspace**(`opts`): [`Workspace`](#workspace)

Defined in: [runtime/workspace.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L90)

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

Defined in: [runtime/workspace.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/runtime/workspace.ts#L149)

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
