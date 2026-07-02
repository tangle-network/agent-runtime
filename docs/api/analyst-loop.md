[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / analyst-loop

# analyst-loop

## Interfaces

### KnowledgeAdapter

Defined in: [analyst-loop/types.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L25)

Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge.

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\>\>

Defined in: [analyst-loop/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L32)

Convert a findings batch into proposals. Returns the partitioned
result so the loop can report (and optionally fail on) malformed
findings. Implementations SHOULD honour the convention "non-
knowledge subjects return null and are counted in `skipped`."

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\>\>

##### apply()?

> `optional` **apply**(`proposals`): `Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [analyst-loop/types.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L41)

Optional auto-apply. The loop calls this only when
`autoApply.knowledge` is true AND the proposal's source-finding
confidence ≥ `autoApply.knowledgeConfidenceThreshold`. Anything
below the threshold is returned in the report but never written.

###### Parameters

###### proposals

readonly `TProposal`[]

###### Returns

`Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

***

### KnowledgeProposalBatch

Defined in: [analyst-loop/types.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L44)

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

Defined in: [analyst-loop/types.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L45)

##### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L46)

##### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L47)

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### ImprovementAdapter

Defined in: [analyst-loop/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L51)

Improvement-side bridge — proposes / applies prompt + tool + scaffolding edits.

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

Defined in: [analyst-loop/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L52)

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

##### apply()?

> `optional` **apply**(`edits`): `Promise`\<\{ `applied`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [analyst-loop/types.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L55)

###### Parameters

###### edits

readonly `TEdit`[]

###### Returns

`Promise`\<\{ `applied`: `string`[]; `warnings`: `string`[]; \}\>

***

### ImprovementEditBatch

Defined in: [analyst-loop/types.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L58)

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

Defined in: [analyst-loop/types.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L59)

##### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L60)

##### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L61)

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### AutoApplyPolicy

Defined in: [analyst-loop/types.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L65)

Tunable safety rails for auto-apply.

#### Properties

##### knowledge?

> `optional` **knowledge?**: `boolean`

Defined in: [analyst-loop/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L67)

When true AND `knowledgeAdapter.apply` exists, write knowledge proposals.

##### knowledgeConfidenceThreshold?

> `optional` **knowledgeConfidenceThreshold?**: `number`

Defined in: [analyst-loop/types.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L69)

Minimum source-finding confidence required to auto-apply a knowledge proposal.

##### improvement?

> `optional` **improvement?**: `boolean`

Defined in: [analyst-loop/types.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L71)

When true AND `improvementAdapter.apply` exists, apply improvement edits.

##### improvementConfidenceThreshold?

> `optional` **improvementConfidenceThreshold?**: `number`

Defined in: [analyst-loop/types.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L73)

Minimum source-finding confidence required to auto-apply an improvement edit.

***

### RunAnalystLoopOpts

Defined in: [analyst-loop/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L76)

#### Properties

##### runId

> **runId**: `string`

Defined in: [analyst-loop/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L78)

The run id of the work being analysed.

##### registry

> **registry**: [`AnalystRegistryLike`](#analystregistrylike)

Defined in: [analyst-loop/types.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L80)

The registry — pre-populated with the analyst kinds the consumer wants.

##### inputs

> **inputs**: `AnalystRunInputs`

Defined in: [analyst-loop/types.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L82)

Inputs forwarded to `registry.run` — typically `{ traceStore }`.

##### findingsStore

> **findingsStore**: [`FindingsStoreLike`](#findingsstorelike) \| `null`

Defined in: [analyst-loop/types.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L88)

Findings ledger. The loop appends the new run + diffs against the
baseline run before running adapters. Pass `null` to skip
persistence (useful for one-shot analyses).

##### baselineRunId?

> `optional` **baselineRunId?**: `string` \| `null`

Defined in: [analyst-loop/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L95)

Prior run id whose findings the loop reads + provides to analysts
as `priorFindings` AND diffs against. When omitted, the loop picks
the most recent run in the store (excluding `runId` itself); pass
`null` to explicitly start with an empty baseline.

##### priorFindingsStrategy?

> `optional` **priorFindingsStrategy?**: `"none"` \| `"per-kind"` \| `"wildcard"`

Defined in: [analyst-loop/types.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L97)

Strategy for forwarding prior findings into `ctx.priorFindings`.

##### knowledgeAdapter?

> `optional` **knowledgeAdapter?**: [`KnowledgeAdapter`](#knowledgeadapter)\<`unknown`\>

Defined in: [analyst-loop/types.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L99)

Knowledge-side bridge — usually `agent-knowledge`'s `proposeFromFindings`.

##### improvementAdapter?

> `optional` **improvementAdapter?**: [`ImprovementAdapter`](#improvementadapter)\<`unknown`\>

Defined in: [analyst-loop/types.ts:101](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L101)

Improvement-side bridge — usually a consumer-specific prompt/tool diff producer.

##### autoApply?

> `optional` **autoApply?**: [`AutoApplyPolicy`](#autoapplypolicy)

Defined in: [analyst-loop/types.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L103)

Auto-apply rails. Default off; review-then-apply is the safer default.

##### log?

> `optional` **log?**: (`msg`, `fields?`) => `void`

Defined in: [analyst-loop/types.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L105)

Optional logger. Defaults to `console.log` for `[analyst-loop]` lines.

###### Parameters

###### msg

`string`

###### fields?

`Record`\<`string`, `unknown`\>

###### Returns

`void`

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Defined in: [analyst-loop/types.ts:116](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L116)

Event sink for live progress. Called for every phase of the loop:
baseline resolution, registry events forwarded from `runStream`,
ledger persistence, diff, knowledge / improvement proposals +
apply outcomes, and the terminal `loop-completed`. Awaited so
slow sinks (SSE write, JSONL append) apply backpressure.

The callback MUST NOT throw — exceptions propagate and abort the
loop. Catch + swallow internally if your sink is unreliable.

###### Parameters

###### event

[`AnalystLoopEvent`](#analystloopevent)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RunAnalystLoopResult

Defined in: [analyst-loop/types.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L119)

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Properties

##### runId

> **runId**: `string`

Defined in: [analyst-loop/types.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L120)

##### baselineRunId

> **baselineRunId**: `string` \| `null`

Defined in: [analyst-loop/types.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L121)

##### analystResult

> **analystResult**: `AnalystRunResult`

Defined in: [analyst-loop/types.ts:122](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L122)

##### diff

> **diff**: `FindingsDiff` \| `null`

Defined in: [analyst-loop/types.ts:123](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L123)

##### knowledge

> **knowledge**: [`KnowledgeReport`](#knowledgereport)\<`TProposal`\> \| `null`

Defined in: [analyst-loop/types.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L124)

##### improvement

> **improvement**: [`ImprovementReport`](#improvementreport)\<`TEdit`\> \| `null`

Defined in: [analyst-loop/types.ts:125](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L125)

***

### KnowledgeReport

Defined in: [analyst-loop/types.ts:128](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L128)

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

Defined in: [analyst-loop/types.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L129)

##### applied

> **applied**: `string`[]

Defined in: [analyst-loop/types.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L130)

##### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L131)

##### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L132)

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

##### withheld\_for\_review

> **withheld\_for\_review**: `number`

Defined in: [analyst-loop/types.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L133)

***

### ImprovementReport

Defined in: [analyst-loop/types.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L136)

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

Defined in: [analyst-loop/types.ts:137](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L137)

##### applied

> **applied**: `string`[]

Defined in: [analyst-loop/types.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L138)

##### skipped

> **skipped**: `number`

Defined in: [analyst-loop/types.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L139)

##### errors

> **errors**: `object`[]

Defined in: [analyst-loop/types.ts:140](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L140)

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

##### withheld\_for\_review

> **withheld\_for\_review**: `number`

Defined in: [analyst-loop/types.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L141)

***

### AnalystRegistryLike

Defined in: [analyst-loop/types.ts:149](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L149)

Narrowed shape we accept for `AnalystRegistry` so the orchestrator
remains testable without instantiating the real class. The real
class satisfies this trivially.

#### Extended by

- [`AnalystRegistryStreamingLike`](#analystregistrystreaminglike)

#### Methods

##### list()

> **list**(): readonly `object`[]

Defined in: [analyst-loop/types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L150)

###### Returns

readonly `object`[]

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

Defined in: [analyst-loop/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L151)

###### Parameters

###### runId

`string`

###### inputs

`AnalystRunInputs`

###### opts?

###### priorFindings?

readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

###### Returns

`Promise`\<`AnalystRunResult`\>

***

### FindingsStoreLike

Defined in: [analyst-loop/types.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L162)

Narrowed shape we accept for `FindingsStore`.

#### Methods

##### loadAll()

> **loadAll**(): readonly `AnalystFinding` & `object`[]

Defined in: [analyst-loop/types.ts:163](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L163)

###### Returns

readonly `AnalystFinding` & `object`[]

##### loadRun()

> **loadRun**(`runId`): readonly `AnalystFinding` & `object`[]

Defined in: [analyst-loop/types.ts:164](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L164)

###### Parameters

###### runId

`string`

###### Returns

readonly `AnalystFinding` & `object`[]

##### append()

> **append**(`runId`, `findings`): `Promise`\<`void`\>

Defined in: [analyst-loop/types.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L165)

###### Parameters

###### runId

`string`

###### findings

readonly `AnalystFinding`[]

###### Returns

`Promise`\<`void`\>

***

### AnalystRegistryStreamingLike

Defined in: [analyst-loop/types.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L179)

Narrow the `AnalystRegistryLike` further when we need streaming: the
loop checks if the registry exposes `runStream` and uses it when
present, falling back to `run()` otherwise. This keeps the type
surface backwards-compatible — older registry shims that only
implement `run` still work; they just don't forward per-analyst
events.

#### Extends

- [`AnalystRegistryLike`](#analystregistrylike)

#### Methods

##### list()

> **list**(): readonly `object`[]

Defined in: [analyst-loop/types.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L150)

###### Returns

readonly `object`[]

###### Inherited from

[`AnalystRegistryLike`](#analystregistrylike).[`list`](#list)

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

Defined in: [analyst-loop/types.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L151)

###### Parameters

###### runId

`string`

###### inputs

`AnalystRunInputs`

###### opts?

###### priorFindings?

readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

###### Returns

`Promise`\<`AnalystRunResult`\>

###### Inherited from

[`AnalystRegistryLike`](#analystregistrylike).[`run`](#run)

##### runStream()?

> `optional` **runStream**(`runId`, `inputs`, `opts?`): `AsyncIterable`\<`AnalystRunEvent`\>

Defined in: [analyst-loop/types.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L180)

###### Parameters

###### runId

`string`

###### inputs

`AnalystRunInputs`

###### opts?

###### priorFindings?

readonly `AnalystFinding`[] \| `Record`\<`string`, readonly `AnalystFinding`[]\>

###### Returns

`AsyncIterable`\<`AnalystRunEvent`\>

## Type Aliases

### AnalystLoopEvent

> **AnalystLoopEvent** = \{ `type`: `"baseline-resolved"`; `runId`: `string`; `baselineRunId`: `string` \| `null`; `priorFindingCount`: `number`; \} \| \{ `type`: `"analyst"`; `runId`: `string`; `event`: `AnalystRunEvent`; \} \| \{ `type`: `"findings-persisted"`; `runId`: `string`; `count`: `number`; \} \| \{ `type`: `"diff-computed"`; `runId`: `string`; `baselineRunId`: `string`; `appeared`: `number`; `disappeared`: `number`; `persisted`: `number`; `changed`: `number`; \} \| \{ `type`: `"knowledge-proposed"`; `runId`: `string`; `proposalCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"knowledge-applied"`; `runId`: `string`; `writtenCount`: `number`; `withheldForReview`: `number`; \} \| \{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"improvement-applied"`; `runId`: `string`; `appliedCount`: `number`; `withheldForReview`: `number`; \} \| \{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}

Defined in: [analyst-loop/types.ts:200](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/types.ts#L200)

Events emitted by `runAnalystLoop` via `opts.onEvent`. UIs and
JSONL tail-sinks consume this stream. The loop awaits each
callback so a slow sink applies backpressure to the loop's phases
(e.g. an SSE write that takes 200ms delays the next phase by
200ms — the loop never out-paces its observer).

Forwards registry events verbatim via `analyst` so consumers don't
have to wire two streams.

#### Union Members

##### Type Literal

\{ `type`: `"baseline-resolved"`; `runId`: `string`; `baselineRunId`: `string` \| `null`; `priorFindingCount`: `number`; \}

***

##### Type Literal

\{ `type`: `"analyst"`; `runId`: `string`; `event`: `AnalystRunEvent`; \}

###### type

> **type**: `"analyst"`

###### runId

> **runId**: `string`

###### event

> **event**: `AnalystRunEvent`

Forwarded verbatim from `AnalystRegistry.runStream`.

***

##### Type Literal

\{ `type`: `"findings-persisted"`; `runId`: `string`; `count`: `number`; \}

***

##### Type Literal

\{ `type`: `"diff-computed"`; `runId`: `string`; `baselineRunId`: `string`; `appeared`: `number`; `disappeared`: `number`; `persisted`: `number`; `changed`: `number`; \}

***

##### Type Literal

\{ `type`: `"knowledge-proposed"`; `runId`: `string`; `proposalCount`: `number`; `skipped`: `number`; `errors`: `number`; \}

***

##### Type Literal

\{ `type`: `"knowledge-applied"`; `runId`: `string`; `writtenCount`: `number`; `withheldForReview`: `number`; \}

***

##### Type Literal

\{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \}

***

##### Type Literal

\{ `type`: `"improvement-applied"`; `runId`: `string`; `appliedCount`: `number`; `withheldForReview`: `number`; \}

***

##### Type Literal

\{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}

## Functions

### iterationsToTraceStore()

> **iterationsToTraceStore**\<`Task`, `Output`\>(`iterations`, `budgets?`): `TraceAnalysisStore`

Defined in: [analyst-loop/iterations-to-trace-store.ts:214](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/iterations-to-trace-store.ts#L214)

Build an in-memory `TraceAnalysisStore` over a loop round's iterations. Fail-loud on an
empty round — there is nothing for an analyst to read, and a silent empty store would
mask a broken capture path.

#### Type Parameters

##### Task

`Task`

##### Output

`Output`

#### Parameters

##### iterations

readonly [`Iteration`](runtime.md#iteration-1)\<`Task`, `Output`\>[]

##### budgets?

`TraceAnalystByteBudgets` = `DEFAULT_TRACE_ANALYST_BUDGETS`

#### Returns

`TraceAnalysisStore`

***

### runAnalystLoop()

> **runAnalystLoop**\<`TProposal`, `TEdit`\>(`opts`): `Promise`\<[`RunAnalystLoopResult`](#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

Defined in: [analyst-loop/run-analyst-loop.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/analyst-loop/run-analyst-loop.ts#L32)

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Parameters

##### opts

[`RunAnalystLoopOpts`](#runanalystloopopts)

#### Returns

`Promise`\<[`RunAnalystLoopResult`](#runanalystloopresult)\<`TProposal`, `TEdit`\>\>
