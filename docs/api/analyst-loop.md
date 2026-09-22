[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / analyst-loop

# analyst-loop

## Interfaces

### KnowledgeProposalSource

Defined in: src/analyst-loop/types.ts:24

Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge.

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\>\>

Defined in: src/analyst-loop/types.ts:31

Convert a findings batch into proposals. Returns the partitioned
result so the loop can report malformed
findings. Implementations SHOULD honour the convention "non-
knowledge subjects return null and are counted in `skipped`."

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\>\>

***

### KnowledgeProposalBatch

Defined in: src/analyst-loop/types.ts:36

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

Defined in: src/analyst-loop/types.ts:37

##### skipped

> **skipped**: `number`

Defined in: src/analyst-loop/types.ts:38

##### errors

> **errors**: `object`[]

Defined in: src/analyst-loop/types.ts:39

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### ImprovementProposalSource

Defined in: src/analyst-loop/types.ts:43

Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits.

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

Defined in: src/analyst-loop/types.ts:44

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

***

### ImprovementEditBatch

Defined in: src/analyst-loop/types.ts:49

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

Defined in: src/analyst-loop/types.ts:50

##### skipped

> **skipped**: `number`

Defined in: src/analyst-loop/types.ts:51

##### errors

> **errors**: `object`[]

Defined in: src/analyst-loop/types.ts:52

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### RunAnalystLoopOpts

Defined in: src/analyst-loop/types.ts:55

#### Properties

##### runId

> **runId**: `string`

Defined in: src/analyst-loop/types.ts:57

The run id of the work being analysed.

##### registry

> **registry**: [`AnalystRegistryLike`](#analystregistrylike)

Defined in: src/analyst-loop/types.ts:59

The registry — pre-populated with the analyst kinds the consumer wants.

##### inputs

> **inputs**: `AnalystRunInputs`

Defined in: src/analyst-loop/types.ts:61

Inputs forwarded to `registry.run` — typically `{ traceStore }`.

##### findingsStore

> **findingsStore**: [`FindingsStoreLike`](#findingsstorelike) \| `null`

Defined in: src/analyst-loop/types.ts:67

Findings ledger. The loop appends the new run + diffs against the
baseline run before running adapters. Pass `null` to skip
persistence (useful for one-shot analyses).

##### baselineRunId?

> `optional` **baselineRunId?**: `string` \| `null`

Defined in: src/analyst-loop/types.ts:74

Prior run id whose findings the loop reads + provides to analysts
as `priorFindings` AND diffs against. When omitted, the loop picks
the most recent run in the store (excluding `runId` itself); pass
`null` to explicitly start with an empty baseline.

##### priorFindingsStrategy?

> `optional` **priorFindingsStrategy?**: `"none"` \| `"per-kind"` \| `"wildcard"`

Defined in: src/analyst-loop/types.ts:76

Strategy for forwarding prior findings into `ctx.priorFindings`.

##### knowledgeProposalSource?

> `optional` **knowledgeProposalSource?**: [`KnowledgeProposalSource`](#knowledgeproposalsource)\<`unknown`\>

Defined in: src/analyst-loop/types.ts:78

Knowledge-side bridge — usually `agent-knowledge`'s `proposeFromFindings`.

##### improvementProposalSource?

> `optional` **improvementProposalSource?**: [`ImprovementProposalSource`](#improvementproposalsource)\<`unknown`\>

Defined in: src/analyst-loop/types.ts:80

Agent-surface bridge — usually a prompt, skill, or tool diff producer.

##### log?

> `optional` **log?**: (`msg`, `fields?`) => `void`

Defined in: src/analyst-loop/types.ts:82

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

Defined in: src/analyst-loop/types.ts:93

Event sink for live progress. Called for every phase of the loop:
baseline resolution, registry events forwarded from `runStream`,
ledger persistence, diff, knowledge / improvement proposals, and
the terminal `loop-completed`. Awaited so
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

Defined in: src/analyst-loop/types.ts:96

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Properties

##### runId

> **runId**: `string`

Defined in: src/analyst-loop/types.ts:97

##### baselineRunId

> **baselineRunId**: `string` \| `null`

Defined in: src/analyst-loop/types.ts:98

##### analystResult

> **analystResult**: `AnalystRunResult`

Defined in: src/analyst-loop/types.ts:99

##### diff

> **diff**: `FindingsDiff` \| `null`

Defined in: src/analyst-loop/types.ts:100

##### knowledge

> **knowledge**: [`KnowledgeReport`](#knowledgereport)\<`TProposal`\> \| `null`

Defined in: src/analyst-loop/types.ts:101

##### improvement

> **improvement**: [`ImprovementReport`](#improvementreport)\<`TEdit`\> \| `null`

Defined in: src/analyst-loop/types.ts:102

***

### KnowledgeReport

Defined in: src/analyst-loop/types.ts:105

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

Defined in: src/analyst-loop/types.ts:106

##### skipped

> **skipped**: `number`

Defined in: src/analyst-loop/types.ts:107

##### errors

> **errors**: `object`[]

Defined in: src/analyst-loop/types.ts:108

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### ImprovementReport

Defined in: src/analyst-loop/types.ts:111

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

Defined in: src/analyst-loop/types.ts:112

##### skipped

> **skipped**: `number`

Defined in: src/analyst-loop/types.ts:113

##### errors

> **errors**: `object`[]

Defined in: src/analyst-loop/types.ts:114

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### AnalystRegistryLike

Defined in: src/analyst-loop/types.ts:122

Narrowed shape we accept for `AnalystRegistry` so the orchestrator
remains testable without instantiating the real class. The real
class satisfies this trivially.

#### Extended by

- [`AnalystRegistryStreamingLike`](#analystregistrystreaminglike)

#### Methods

##### list()

> **list**(): readonly `object`[]

Defined in: src/analyst-loop/types.ts:123

###### Returns

readonly `object`[]

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

Defined in: src/analyst-loop/types.ts:124

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

Defined in: src/analyst-loop/types.ts:135

Narrowed shape we accept for `FindingsStore`.

#### Methods

##### loadAll()

> **loadAll**(): readonly `AnalystFinding` & `object`[]

Defined in: src/analyst-loop/types.ts:136

###### Returns

readonly `AnalystFinding` & `object`[]

##### loadRun()

> **loadRun**(`runId`): readonly `AnalystFinding` & `object`[]

Defined in: src/analyst-loop/types.ts:137

###### Parameters

###### runId

`string`

###### Returns

readonly `AnalystFinding` & `object`[]

##### append()

> **append**(`runId`, `findings`): `Promise`\<`void`\>

Defined in: src/analyst-loop/types.ts:138

###### Parameters

###### runId

`string`

###### findings

readonly `AnalystFinding`[]

###### Returns

`Promise`\<`void`\>

***

### AnalystRegistryStreamingLike

Defined in: src/analyst-loop/types.ts:152

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

Defined in: src/analyst-loop/types.ts:123

###### Returns

readonly `object`[]

###### Inherited from

[`AnalystRegistryLike`](#analystregistrylike).[`list`](#list)

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

Defined in: src/analyst-loop/types.ts:124

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

Defined in: src/analyst-loop/types.ts:153

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

> **AnalystLoopEvent** = \{ `type`: `"baseline-resolved"`; `runId`: `string`; `baselineRunId`: `string` \| `null`; `priorFindingCount`: `number`; \} \| \{ `type`: `"analyst"`; `runId`: `string`; `event`: `AnalystRunEvent`; \} \| \{ `type`: `"findings-persisted"`; `runId`: `string`; `count`: `number`; \} \| \{ `type`: `"diff-computed"`; `runId`: `string`; `baselineRunId`: `string`; `appeared`: `number`; `disappeared`: `number`; `persisted`: `number`; `changed`: `number`; \} \| \{ `type`: `"knowledge-proposed"`; `runId`: `string`; `proposalCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \} \| \{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}

Defined in: src/analyst-loop/types.ts:173

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

\{ `type`: `"improvement-proposed"`; `runId`: `string`; `editCount`: `number`; `skipped`: `number`; `errors`: `number`; \}

***

##### Type Literal

\{ `type`: `"loop-completed"`; `runId`: `string`; `durationMs`: `number`; \}

## Functions

### iterationsToTraceStore()

> **iterationsToTraceStore**\<`Task`, `Output`\>(`iterations`, `budgets?`): `TraceAnalysisStore`

Defined in: src/analyst-loop/iterations-to-trace-store.ts:214

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

Defined in: src/analyst-loop/run-analyst-loop.ts:29

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
