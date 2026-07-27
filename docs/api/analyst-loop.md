[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / analyst-loop

# analyst-loop

## Interfaces

### KnowledgeProposalSource

Knowledge-side bridge — consumers wire `proposeFromFindings` from agent-knowledge.

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\> \| `Promise`\<[`KnowledgeProposalBatch`](#knowledgeproposalbatch)\<`TProposal`\>\>

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

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

##### skipped

> **skipped**: `number`

##### errors

> **errors**: `object`[]

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### ImprovementProposalSource

Agent-surface bridge — proposes prompt, skill, tool, and scaffolding edits.

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Methods

##### proposeFromFindings()

> **proposeFromFindings**(`findings`): [`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\> \| `Promise`\<[`ImprovementEditBatch`](#improvementeditbatch)\<`TEdit`\>\>

***

### ImprovementEditBatch

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

##### skipped

> **skipped**: `number`

##### errors

> **errors**: `object`[]

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### RunAnalystLoopOpts

#### Properties

##### runId

> **runId**: `string`

The run id of the work being analysed.

##### registry

> **registry**: [`AnalystRegistryLike`](#analystregistrylike)

The registry — pre-populated with the analyst kinds the consumer wants.

##### inputs

> **inputs**: `AnalystRunInputs`

Inputs forwarded to `registry.run` — typically `{ traceStore }`.

##### findingsStore

> **findingsStore**: [`FindingsStoreLike`](#findingsstorelike) \| `null`

Findings ledger. The loop appends the new run + diffs against the
baseline run before running adapters. Pass `null` to skip
persistence (useful for one-shot analyses).

##### baselineRunId?

> `optional` **baselineRunId?**: `string` \| `null`

Prior run id whose findings the loop reads + provides to analysts
as `priorFindings` AND diffs against. When omitted, the loop picks
the most recent run in the store (excluding `runId` itself); pass
`null` to explicitly start with an empty baseline.

##### priorFindingsStrategy?

> `optional` **priorFindingsStrategy?**: `"none"` \| `"per-kind"` \| `"wildcard"`

Strategy for forwarding prior findings into `ctx.priorFindings`.

##### knowledgeProposalSource?

> `optional` **knowledgeProposalSource?**: [`KnowledgeProposalSource`](#knowledgeproposalsource)\<`unknown`\>

Knowledge-side bridge — usually `agent-knowledge`'s `proposeFromFindings`.

##### improvementProposalSource?

> `optional` **improvementProposalSource?**: [`ImprovementProposalSource`](#improvementproposalsource)\<`unknown`\>

Agent-surface bridge — usually a prompt, skill, or tool diff producer.

##### log?

> `optional` **log?**: (`msg`, `fields?`) => `void`

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

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Properties

##### runId

> **runId**: `string`

##### baselineRunId

> **baselineRunId**: `string` \| `null`

##### analystResult

> **analystResult**: `AnalystRunResult`

##### diff

> **diff**: `FindingsDiff` \| `null`

##### knowledge

> **knowledge**: [`KnowledgeReport`](#knowledgereport)\<`TProposal`\> \| `null`

##### improvement

> **improvement**: [`ImprovementReport`](#improvementreport)\<`TEdit`\> \| `null`

***

### KnowledgeReport

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

#### Properties

##### proposals

> **proposals**: `TProposal`[]

##### skipped

> **skipped**: `number`

##### errors

> **errors**: `object`[]

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### ImprovementReport

#### Type Parameters

##### TEdit

`TEdit` = `unknown`

#### Properties

##### edits

> **edits**: `TEdit`[]

##### skipped

> **skipped**: `number`

##### errors

> **errors**: `object`[]

###### findingId

> **findingId**: `string`

###### subject

> **subject**: `string`

###### message

> **message**: `string`

***

### AnalystRegistryLike

Narrowed shape we accept for `AnalystRegistry` so the orchestrator
remains testable without instantiating the real class. The real
class satisfies this trivially.

#### Extended by

- [`AnalystRegistryStreamingLike`](#analystregistrystreaminglike)

#### Methods

##### list()

> **list**(): readonly `object`[]

###### Returns

readonly `object`[]

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

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

Narrowed shape we accept for `FindingsStore`.

#### Methods

##### loadAll()

> **loadAll**(): readonly `AnalystFinding` & `object`[]

###### Returns

readonly `AnalystFinding` & `object`[]

##### loadRun()

> **loadRun**(`runId`): readonly `AnalystFinding` & `object`[]

###### Parameters

###### runId

`string`

###### Returns

readonly `AnalystFinding` & `object`[]

##### append()

> **append**(`runId`, `findings`): `Promise`\<`void`\>

###### Parameters

###### runId

`string`

###### findings

readonly `AnalystFinding`[]

###### Returns

`Promise`\<`void`\>

***

### AnalystRegistryStreamingLike

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

###### Returns

readonly `object`[]

###### Inherited from

[`AnalystRegistryLike`](#analystregistrylike).[`list`](#list)

##### run()

> **run**(`runId`, `inputs`, `opts?`): `Promise`\<`AnalystRunResult`\>

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

Analyze a run and apply accepted knowledge and agent-surface proposals.

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
