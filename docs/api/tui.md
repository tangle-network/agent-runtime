[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / tui

# tui

**`Experimental`**

`@tangle-network/agent-runtime/tui` — the terminal view over live supervisor runs.

Read-only snapshots over Runtime's workspace layout or an explicit durable run directory.
Workspace reads remain synchronous; the `runDir` overload asynchronously verifies observer
history and attaches its canonical pursuit projection, including unknown accounting.

```ts
import { loadTopSnapshot } from '@tangle-network/agent-runtime/tui'

const workspace = loadTopSnapshot(process.cwd())
const durable = await loadTopSnapshot(process.cwd(), { runDir: './runs/current' })
```

The runnable form is the `agent-runtime-top` bin: `agent-runtime-top <root> [--once] [--no-color]`.
Its `--web --root <run-dir> --assets <renderer-dist>` mode serves the same facts over HTTP/SSE.
Workers and supervisors expose optional epoch `lastActivityAt` and full-stream
`medianEventGapMs` from actual recorded events. Metadata, heartbeats and file times do not count.

## Interfaces

### TopInspection

**`Experimental`**

#### Properties

##### coverage

> `readonly` **coverage**: `object`

**`Experimental`**

###### status

> `readonly` **status**: `"complete"` \| `"partial"` \| `"missing"`

###### source

> `readonly` **source**: `string`

###### reason?

> `readonly` `optional` **reason?**: `string`

###### code?

> `readonly` `optional` **code?**: `"source-mismatch"` \| `"source-unbound"`

###### ref?

> `readonly` `optional` **ref?**: `string`

##### rows?

> `readonly` `optional` **rows?**: readonly ([`TopTranscriptRow`](#toptranscriptrow) & `object`)[]

**`Experimental`**

##### context?

> `readonly` `optional` **context?**: readonly [`TopTranscriptRow`](#toptranscriptrow)[]

**`Experimental`**

##### files?

> `readonly` `optional` **files?**: `object`

**`Experimental`**

###### scope

> `readonly` **scope**: `"workspace"` \| `"none"`

###### complete

> `readonly` **complete**: `boolean`

###### reason?

> `readonly` `optional` **reason?**: `string`

###### entries

> `readonly` **entries**: readonly ([`FileIdentity`](#fileidentity) & `object`)[]

##### file?

> `readonly` `optional` **file?**: [`FileIdentity`](#fileidentity) & `object`

**`Experimental`**

###### Type Declaration

###### path

> `readonly` **path**: `string`

###### content

> `readonly` **content**: `string`

###### before?

> `readonly` `optional` **before?**: [`FileIdentity`](#fileidentity) & `object`

###### Type Declaration

###### content

> `readonly` **content**: `string`

###### source

> `readonly` **source**: [`BaselineAuthority`](#baselineauthority)

***

### TopTranscriptRow

**`Experimental`**

#### Properties

##### at

> **at**: `string`

**`Experimental`**

##### event

> **event**: `object`

**`Experimental`**

###### kind

> **kind**: `string`

###### text?

> `optional` **text?**: `string`

###### provenance?

> `optional` **provenance?**: `string`

###### source?

> `optional` **source?**: `string`

###### actor?

> `optional` **actor?**: `string`

###### toolCallId?

> `optional` **toolCallId?**: `string`

###### toolName?

> `optional` **toolName?**: `string`

###### args?

> `optional` **args?**: `unknown`

###### result?

> `optional` **result?**: `unknown`

***

### TopAgentRowsFrame

**`Experimental`**

#### Properties

##### generation

> `readonly` **generation**: `number`

**`Experimental`**

##### events

> `readonly` **events**: readonly ([`TopTranscriptRow`](#toptranscriptrow) & `object`)[]

**`Experimental`**

##### lastSeq

> `readonly` **lastSeq**: `number`

**`Experimental`**

##### alive

> `readonly` **alive**: `boolean`

**`Experimental`**

##### window

> `readonly` **window**: `"verified-native"` \| `"recorded-tail"`

**`Experimental`**

##### coverage?

> `readonly` `optional` **coverage?**: `object`

**`Experimental`**

###### status

> `readonly` **status**: `"complete"` \| `"partial"` \| `"missing"`

###### source

> `readonly` **source**: `string`

###### reason?

> `readonly` `optional` **reason?**: `string`

###### code?

> `readonly` `optional` **code?**: `"source-mismatch"` \| `"source-unbound"`

###### ref?

> `readonly` `optional` **ref?**: `string`

***

### RecordedActivity

**`Experimental`**

Actual recorded event time and cadence; absence means no event evidence, never file mtime.

#### Properties

##### lastActivityAt?

> `readonly` `optional` **lastActivityAt?**: `number`

**`Experimental`**

##### medianEventGapMs?

> `readonly` `optional` **medianEventGapMs?**: `number`

**`Experimental`**

***

### RecordedEvents

**`Experimental`**

#### Properties

##### file

> `readonly` **file**: `string`

**`Experimental`**

##### lines

> `readonly` **lines**: `string`[]

**`Experimental`**

##### activity

> `readonly` **activity**: [`RecordedActivity`](#recordedactivity)

**`Experimental`**

##### firstActivityAt?

> `readonly` `optional` **firstActivityAt?**: `number`

**`Experimental`**

***

### HarnessRowsSession

**`Experimental`**

The normalized subset consumed here; native decoding stays with harness-sessions.

#### Properties

##### nativeSessionId

> `readonly` **nativeSessionId**: `string`

**`Experimental`**

##### messages

> `readonly` **messages**: readonly `object`[]

**`Experimental`**

##### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

**`Experimental`**

***

### TopSnapshot

**`Experimental`**

#### Properties

##### root

> `readonly` **root**: `string`

**`Experimental`**

##### generatedAt

> `readonly` **generatedAt**: `number`

**`Experimental`**

##### supervisors

> `readonly` **supervisors**: [`SupervisorView`](#supervisorview)[]

**`Experimental`**

##### pursuit?

> `readonly` `optional` **pursuit?**: [`PursuitProjection`](durable.md#pursuitprojection)

**`Experimental`**

Canonical facts, including unknown accounting and requested/observed identities.

##### completeness

> `readonly` **completeness**: [`TopSnapshotCompleteness`](#topsnapshotcompleteness)

**`Experimental`**

`partial` when at least one discovered source could not be read completely.

##### diagnostics

> `readonly` **diagnostics**: readonly [`TopSnapshotDiagnostic`](#topsnapshotdiagnostic)[]

**`Experimental`**

One bounded entry per skipped or partially read source; empty when complete.

##### discovered

> `readonly` **discovered**: `number`

**`Experimental`**

Run directories found under the runs roots, readable or not.

##### loaded

> `readonly` **loaded**: `number`

**`Experimental`**

Run directories projected into a valid supervisor view.

***

### TopSnapshotDiagnostic

**`Experimental`**

One skipped or partially read snapshot source. `path` is relative to the run directory and
never carries file contents, so a diagnostic is safe to show or log without leaking run data.

#### Properties

##### source

> `readonly` **source**: [`TopSnapshotDiagnosticSource`](#topsnapshotdiagnosticsource)

**`Experimental`**

##### path

> `readonly` **path**: `string`

**`Experimental`**

##### reason

> `readonly` **reason**: [`TopSnapshotDiagnosticReason`](#topsnapshotdiagnosticreason)

**`Experimental`**

##### runId?

> `readonly` `optional` **runId?**: `string`

**`Experimental`**

***

### SupervisorView

**`Experimental`**

#### Extends

- `SupervisorBase`

#### Properties

##### reason?

> `readonly` `optional` **reason?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.reason`

##### id

> `readonly` **id**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.id`

##### status

> `readonly` **status**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.status`

##### task

> `readonly` **task**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.task`

##### workspaceDir

> `readonly` **workspaceDir**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.workspaceDir`

##### budget

> `readonly` **budget**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.budget`

##### budgetKnown?

> `readonly` `optional` **budgetKnown?**: `boolean`

**`Experimental`**

###### Inherited from

`SupervisorBase.budgetKnown`

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.verifyCmd`

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.workerModel`

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.driverModel`

##### verdict?

> `readonly` `optional` **verdict?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.verdict`

##### progress?

> `readonly` `optional` **progress?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.progress`

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.startedAt`

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.completedAt`

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxSandboxes`

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxLifetimeSeconds`

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.idleTimeoutSeconds`

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxUsd`

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxDepth`

##### stateDir

> `readonly` **stateDir**: `string`

**`Experimental`**

##### outcome?

> `readonly` `optional` **outcome?**: \{ `kind`: `"winner"`; \} \| \{ `kind`: `"failed"` \| `"no-winner"`; `reason`: `string`; \}

**`Experimental`**

##### lastRoute?

> `readonly` `optional` **lastRoute?**: \{ `kind`: `"stopped"`; `code?`: `string`; `at`: `string`; `workerId`: `string`; `reason`: `string`; `edge?`: `string`; \} \| \{ `kind`: `"unrouted"`; `reason`: `"unrouted"` \| `"target-live"`; `node`: `string`; `workerId`: `string`; `detail`: `string`; `result?`: `unknown`; \}

**`Experimental`**

###### Union Members

###### Type Literal

\{ `kind`: `"stopped"`; `code?`: `string`; `at`: `string`; `workerId`: `string`; `reason`: `string`; `edge?`: `string`; \}

###### kind

> `readonly` **kind**: `"stopped"`

###### code?

> `readonly` `optional` **code?**: `string`

###### at

> `readonly` **at**: `string`

###### workerId

> `readonly` **workerId**: `string`

###### reason

> `readonly` **reason**: `string`

###### edge?

> `readonly` `optional` **edge?**: `string`

The stop edge or `gate:<id>`, or absent when a down or unusable settle or the deadline
 ended the flow.

***

###### Type Literal

\{ `kind`: `"unrouted"`; `reason`: `"unrouted"` \| `"target-live"`; `node`: `string`; `workerId`: `string`; `detail`: `string`; `result?`: `unknown`; \}

##### lastActivityAt?

> `readonly` `optional` **lastActivityAt?**: `number`

**`Experimental`**

Epoch milliseconds of actual recorded executor activity, independent of tail truncation.

##### medianEventGapMs?

> `readonly` `optional` **medianEventGapMs?**: `number`

**`Experimental`**

Median gap between all recorded activity instants, including real zero gaps.

##### resultSpentUsd?

> `readonly` `optional` **resultSpentUsd?**: `number`

**`Experimental`**

##### resultSpentTokens?

> `readonly` `optional` **resultSpentTokens?**: `number`

**`Experimental`**

##### workers

> `readonly` **workers**: [`WorkerView`](#workerview)[]

**`Experimental`**

##### progressTail

> `readonly` **progressTail**: `string`[]

**`Experimental`**

##### journalTail

> `readonly` **journalTail**: [`TopJournalEvent`](#topjournalevent)[]

**`Experimental`**

##### driverSpend

> `readonly` **driverSpend**: [`SpendStats`](#spendstats)

**`Experimental`**

##### totals

> `readonly` **totals**: [`SupervisorTotals`](#supervisortotals)

**`Experimental`**

***

### WorkerView

**`Experimental`**

#### Properties

##### harnessTranscript?

> `readonly` `optional` **harnessTranscript?**: [`HarnessTranscriptEvidence`](runtime.md#harnesstranscriptevidence)

**`Experimental`**

##### identity?

> `readonly` `optional` **identity?**: [`NodeExecutionIdentity`](runtime.md#nodeexecutionidentity)

**`Experimental`**

##### materialization?

> `readonly` `optional` **materialization?**: [`ProfileMaterializationReceipt`](runtime.md#profilematerializationreceipt)

**`Experimental`**

##### executionBindings?

> `readonly` `optional` **executionBindings?**: readonly [`ExecutionBindingReceipt`](runtime.md#executionbindingreceipt)[]

**`Experimental`**

##### id

> `readonly` **id**: `string`

**`Experimental`**

##### label

> `readonly` **label**: `string`

**`Experimental`**

##### eventFile?

> `readonly` `optional` **eventFile?**: `string`

**`Experimental`**

##### parent?

> `readonly` `optional` **parent?**: `string`

**`Experimental`**

##### runtime?

> `readonly` `optional` **runtime?**: `string`

**`Experimental`**

##### status

> `readonly` **status**: `"cancelled"` \| `"done"` \| `"running"` \| `"down"`

**`Experimental`**

##### verdict?

> `readonly` `optional` **verdict?**: `string`

**`Experimental`**

##### infra?

> `readonly` `optional` **infra?**: `boolean`

**`Experimental`**

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

**`Experimental`**

##### endedAt?

> `readonly` `optional` **endedAt?**: `string`

**`Experimental`**

##### latencyMs

> `readonly` **latencyMs**: `number`

**`Experimental`**

##### budget?

> `readonly` `optional` **budget?**: `Partial`\<`Pick`\<[`Budget`](runtime.md#budget-10), `"maxIterations"` \| `"maxTokens"` \| `"maxUsd"`\>\>

**`Experimental`**

##### spend

> `readonly` **spend**: [`SpendStats`](#spendstats)

**`Experimental`**

##### metered

> `readonly` **metered**: [`SpendStats`](#spendstats)

**`Experimental`**

##### liveTail

> `readonly` **liveTail**: `string`[]

**`Experimental`**

##### lastActivityAt?

> `readonly` `optional` **lastActivityAt?**: `number`

**`Experimental`**

Epoch milliseconds of actual recorded executor activity, independent of tail truncation.

##### medianEventGapMs?

> `readonly` `optional` **medianEventGapMs?**: `number`

**`Experimental`**

Median gap between all recorded activity instants, including real zero gaps.

##### outRef?

> `readonly` `optional` **outRef?**: `string`

**`Experimental`**

##### transcript?

> `readonly` `optional` **transcript?**: `object`

**`Experimental`**

The conversation the executor retained at settlement, when it retained one.

###### ref

> `readonly` **ref**: `string`

###### harness

> `readonly` **harness**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

**`Experimental`**

***

### SupervisorTotals

**`Experimental`**

#### Extends

- `Pick`\<[`SpendStats`](#spendstats), `"tokensInput"` \| `"tokensOutput"` \| `"usd"` \| `"usdKnown"` \| `"tokensKnown"`\>

#### Properties

##### tokensKnown?

> `readonly` `optional` **tokensKnown?**: `boolean`

**`Experimental`**

Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
 an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
 not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
 turn whose provider reported no usage is recorded with this flag rather than omitted, because
 omitting it makes the turn look free.

###### Inherited from

[`Spend`](runtime.md#spend-1).[`tokensKnown`](runtime.md#tokensknown-3)

##### usdKnown?

> `readonly` `optional` **usdKnown?**: `boolean`

**`Experimental`**

Dollar accounting is known unless explicitly false. A false value must not be treated as $0
 when enforcing a dollar-denominated comparison or limit.

###### Inherited from

[`Spend`](runtime.md#spend-1).[`usdKnown`](runtime.md#usdknown-4)

##### usd

> `readonly` **usd**: `number`

**`Experimental`**

###### Inherited from

[`Spend`](runtime.md#spend-1).[`usd`](runtime.md#usd-6)

##### workers

> `readonly` **workers**: `number`

**`Experimental`**

##### running

> `readonly` **running**: `number`

**`Experimental`**

##### done

> `readonly` **done**: `number`

**`Experimental`**

##### down

> `readonly` **down**: `number`

**`Experimental`**

##### cancelled

> `readonly` **cancelled**: `number`

**`Experimental`**

##### inFlight

> `readonly` **inFlight**: `number`

**`Experimental`**

##### settled

> `readonly` **settled**: `number`

**`Experimental`**

##### tokensTotal

> `readonly` **tokensTotal**: `number`

**`Experimental`**

##### latencyMs

> `readonly` **latencyMs**: `number`

**`Experimental`**

##### workerLatency

> `readonly` **workerLatency**: [`Distribution`](#distribution)

**`Experimental`**

##### tokensInput

> `readonly` **tokensInput**: `number`

**`Experimental`**

###### Inherited from

[`SpendStats`](#spendstats).[`tokensInput`](#tokensinput-1)

##### tokensOutput

> `readonly` **tokensOutput**: `number`

**`Experimental`**

###### Inherited from

[`SpendStats`](#spendstats).[`tokensOutput`](#tokensoutput-1)

***

### Distribution

**`Experimental`**

#### Properties

##### n

> `readonly` **n**: `number`

**`Experimental`**

##### min

> `readonly` **min**: `number`

**`Experimental`**

##### median

> `readonly` **median**: `number`

**`Experimental`**

##### p90

> `readonly` **p90**: `number`

**`Experimental`**

##### max

> `readonly` **max**: `number`

**`Experimental`**

***

### SpendStats

**`Experimental`**

#### Extends

- `Readonly`\<`Pick`\<[`Spend`](runtime.md#spend-1), `"iterations"` \| `"usd"` \| `"ms"` \| `"usdKnown"` \| `"tokensKnown"`\>\>

#### Properties

##### iterations

> `readonly` **iterations**: `number`

**`Experimental`**

###### Inherited from

[`Spend`](runtime.md#spend-1).[`iterations`](runtime.md#iterations-1)

##### tokensKnown?

> `readonly` `optional` **tokensKnown?**: `boolean`

**`Experimental`**

Token accounting is known unless explicitly false. A false value marks work that HAPPENED with
 an unreported token count: `tokens` then carries the known subtotal (often `{0,0}`) and must
 not be read as the measured total. The twin of `usdKnown` on the token channel — an inference
 turn whose provider reported no usage is recorded with this flag rather than omitted, because
 omitting it makes the turn look free.

###### Inherited from

[`Spend`](runtime.md#spend-1).[`tokensKnown`](runtime.md#tokensknown-3)

##### usdKnown?

> `readonly` `optional` **usdKnown?**: `boolean`

**`Experimental`**

Dollar accounting is known unless explicitly false. A false value must not be treated as $0
 when enforcing a dollar-denominated comparison or limit.

###### Inherited from

[`Spend`](runtime.md#spend-1).[`usdKnown`](runtime.md#usdknown-4)

##### usd

> `readonly` **usd**: `number`

**`Experimental`**

###### Inherited from

[`Spend`](runtime.md#spend-1).[`usd`](runtime.md#usd-6)

##### ms

> `readonly` **ms**: `number`

**`Experimental`**

###### Inherited from

[`Spend`](runtime.md#spend-1).[`ms`](runtime.md#ms-3)

##### tokensInput

> `readonly` **tokensInput**: `number`

**`Experimental`**

##### tokensOutput

> `readonly` **tokensOutput**: `number`

**`Experimental`**

***

### TopSupervisorState

**`Experimental`**

#### Extends

- `SupervisorBase`

#### Properties

##### reason?

> `readonly` `optional` **reason?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.reason`

##### id

> `readonly` **id**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.id`

##### status

> `readonly` **status**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.status`

##### task

> `readonly` **task**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.task`

##### workspaceDir

> `readonly` **workspaceDir**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.workspaceDir`

##### budget

> `readonly` **budget**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.budget`

##### budgetKnown?

> `readonly` `optional` **budgetKnown?**: `boolean`

**`Experimental`**

###### Inherited from

`SupervisorBase.budgetKnown`

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.verifyCmd`

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.workerModel`

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.driverModel`

##### verdict?

> `readonly` `optional` **verdict?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.verdict`

##### progress?

> `readonly` `optional` **progress?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.progress`

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.startedAt`

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

**`Experimental`**

###### Inherited from

`SupervisorBase.completedAt`

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxSandboxes`

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxLifetimeSeconds`

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.idleTimeoutSeconds`

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxUsd`

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

**`Experimental`**

###### Inherited from

`SupervisorBase.maxDepth`

##### result?

> `readonly` `optional` **result?**: `object`

**`Experimental`**

###### spentUsd?

> `readonly` `optional` **spentUsd?**: `number`

###### spentTokens?

> `readonly` `optional` **spentTokens?**: `number`

***

### TopSnapshotFrame

**`Experimental`**

A reconnect always receives current truth; deltas replace changed roots atomically.

#### Properties

##### sequence

> `readonly` **sequence**: `number`

**`Experimental`**

##### observedAt

> `readonly` **observedAt**: `number`

**`Experimental`**

##### reset

> `readonly` **reset**: `boolean`

**`Experimental`**

##### snapshots

> `readonly` **snapshots**: readonly [`TopSnapshot`](#topsnapshot)[]

**`Experimental`**

***

### TopWebOptions

**`Experimental`**

#### Properties

##### roots

> `readonly` **roots**: readonly `string`[]

**`Experimental`**

##### assets?

> `readonly` `optional` **assets?**: `string`

**`Experimental`**

Defaults to the installed agent-record browser asset export.

##### host?

> `readonly` `optional` **host?**: `string`

**`Experimental`**

##### port?

> `readonly` `optional` **port?**: `number`

**`Experimental`**

##### source?

> `readonly` `optional` **source?**: [`TopInspectionSource`](#topinspectionsource)

**`Experimental`**

Product-owned verified conversation reads; no execution or credential access.

##### readSessions?

> `readonly` `optional` **readSessions?**: [`TopSessionReader`](#topsessionreader)

**`Experimental`**

Canonical native decoding for ordinary Runtime transcript receipts.

## Type Aliases

### BaselineAuthority

> **BaselineAuthority** = `object`

**`Experimental`**

#### Properties

##### kind

> `readonly` **kind**: `"retained-workspace"` \| `"git-object"` \| `"git-diff"`

##### ref

> `readonly` **ref**: `string`

***

### FileIdentity

> **FileIdentity** = `object`

**`Experimental`**

#### Properties

##### sha256

> `readonly` **sha256**: `string`

##### byteLength

> `readonly` **byteLength**: `number`

***

### TopSessionReader

> **TopSessionReader** = (`artifact`, `signal?`) => `Promise`\<readonly [`HarnessRowsSession`](#harnessrowssession)[]\>

**`Experimental`**

#### Parameters

##### artifact

[`HarnessTranscriptArtifact`](runtime.md#harnesstranscriptartifact)

##### signal?

`AbortSignal`

#### Returns

`Promise`\<readonly [`HarnessRowsSession`](#harnessrowssession)[]\>

***

### TopAgentMetadata

> **TopAgentMetadata** = `Omit`\<[`TopInspection`](#topinspection), `"rows"` \| `"context"`\> & `object`

**`Experimental`**

#### Type Declaration

##### context

> `readonly` **context**: readonly [`TopTranscriptRow`](#toptranscriptrow)[]

***

### TopAgentStreamFrame

> **TopAgentStreamFrame** = \{ `event`: `"reset"`; `data`: \{ `generation`: `number`; \}; \} \| \{ `event`: `"rows"`; `data`: [`TopAgentRowsFrame`](#topagentrowsframe); \}

**`Experimental`**

Both HTTP transports share conversation selection, stable identity, sequence and batching.

***

### HarnessRowsGap

> **HarnessRowsGap** = `object`

**`Experimental`**

#### Properties

##### sessionId

> `readonly` **sessionId**: `string`

##### recordId

> `readonly` **recordId**: `string`

##### reason

> `readonly` **reason**: `string`

***

### HarnessSessionRow

> **HarnessSessionRow** = [`TopTranscriptRow`](#toptranscriptrow) & `object`

**`Experimental`**

#### Type Declaration

##### id

> `readonly` **id**: `string`

##### sessionId

> `readonly` **sessionId**: `string`

##### part

> `readonly` **part**: `number`

***

### TopSnapshotCompleteness

> **TopSnapshotCompleteness** = `"complete"` \| `"partial"`

**`Experimental`**

***

### TopSnapshotDiagnosticSource

> **TopSnapshotDiagnosticSource** = `"observer-journal"` \| `"supervisor-state"` \| `"journal"` \| `"progress"` \| `"worker-tail"`

**`Experimental`**

***

### TopSnapshotDiagnosticReason

> **TopSnapshotDiagnosticReason** = `"unreadable"` \| `"partial-json"` \| `"invalid-state"` \| `"missing"`

**`Experimental`**

***

### BudgetStats

> **BudgetStats** = `Partial`\<`Pick`\<[`Budget`](runtime.md#budget-10), `"maxIterations"` \| `"maxTokens"` \| `"maxUsd"`\>\>

**`Experimental`**

***

### TopJournalEvent

> **TopJournalEvent** = `object` & (\{ `kind`: `"spawned"`; `identity?`: [`NodeExecutionIdentity`](runtime.md#nodeexecutionidentity); `parent?`: `string`; `label?`: `string`; `budget?`: `unknown`; `runtime?`: `string`; \} \| \{ `kind`: `"settled"`; `harnessTranscript?`: [`HarnessTranscriptEvidence`](runtime.md#harnesstranscriptevidence); `status?`: `string`; `outRef?`: `string`; `verdict?`: `unknown`; `spent?`: `unknown`; `infra?`: `boolean`; \} \| \{ `kind`: `"cancelled"`; `spent?`: `unknown`; `reason?`: `string`; \} \| \{ `kind`: `"metered"`; `spend?`: `unknown`; `accountingOnly?`: `boolean`; \} \| \{ `kind`: `"materialized"`; `receipt`: [`ProfileMaterializationReceipt`](runtime.md#profilematerializationreceipt); \} \| \{ `kind`: `"seat-materialized"`; `receipt`: [`ProfileMaterializationReceipt`](runtime.md#profilematerializationreceipt); \} \| \{ `kind`: `"execution-bound"`; `binding`: [`ExecutionBindingReceipt`](runtime.md#executionbindingreceipt); \} \| \{ `kind`: `"progress"`; `spend?`: `unknown`; \})

**`Experimental`**

#### Type Declaration

##### id

> `readonly` **id**: `string`

##### seq?

> `readonly` `optional` **seq?**: `number`

##### at?

> `readonly` `optional` **at?**: `string`

***

### TopInspectionSource

> **TopInspectionSource** = (`request`) => `Promise`\<[`TopInspection`](#topinspection)\>

**`Experimental`**

#### Parameters

##### request

###### root

`string`

###### runId

`string`

###### workerId

`string`

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`TopInspection`](#topinspection)\>

## Variables

### TOP\_SNAPSHOT\_RECONCILE\_MS

> `const` **TOP\_SNAPSHOT\_RECONCILE\_MS**: `500` = `500`

**`Experimental`**

Interval for reconciling missed filesystem notifications in the live viewer.

## Functions

### loadTopSnapshot()

#### Call Signature

> **loadTopSnapshot**(`rootDir`, `now?`): [`TopSnapshot`](#topsnapshot)

**`Experimental`**

Read a point-in-time view without writing to the run. Missing or partial sources report
bounded diagnostics, and live event readers cache append offsets. `now` controls elapsed time.

##### Parameters

###### rootDir

`string`

###### now?

`number`

##### Returns

[`TopSnapshot`](#topsnapshot)

#### Call Signature

> **loadTopSnapshot**(`rootDir`, `options`): `Promise`\<[`TopSnapshot`](#topsnapshot)\>

**`Experimental`**

Read a point-in-time view without writing to the run. Missing or partial sources report
bounded diagnostics, and live event readers cache append offsets. `now` controls elapsed time.

##### Parameters

###### rootDir

`string`

###### options

###### runDir

`string`

###### now?

`number`

###### format?

`"journal"` \| `"workflow"`

##### Returns

`Promise`\<[`TopSnapshot`](#topsnapshot)\>

***

### projectTopSnapshot()

> **projectTopSnapshot**(`root`, `now`, `supervisors`, `diagnostics?`, `discovered?`, `pursuit?`): [`TopSnapshot`](#topsnapshot)

**`Experimental`**

Combine supervisor projections and source diagnostics into one snapshot.

#### Parameters

##### root

`string`

##### now

`number`

##### supervisors

[`SupervisorView`](#supervisorview)[]

##### diagnostics?

[`TopSnapshotDiagnostic`](#topsnapshotdiagnostic)[] = `[]`

##### discovered?

`number` = `1`

##### pursuit?

[`PursuitProjection`](durable.md#pursuitprojection)

#### Returns

[`TopSnapshot`](#topsnapshot)

***

### projectTopSupervisor()

> **projectTopSupervisor**(`state`, `stateDir`, `events`, `progressTail`, `now`, `workerEventTails?`, `accounting?`): [`SupervisorView`](#supervisorview)

**`Experimental`**

Project committed lifecycle and spend evidence into one supervisor view.

#### Parameters

##### state

[`TopSupervisorState`](#topsupervisorstate)

##### stateDir

`string`

##### events

readonly [`TopJournalEvent`](#topjournalevent)[]

##### progressTail

readonly `string`[]

##### now

`number`

##### workerEventTails?

`Map`\<`string`, [`RecordedEvents`](#recordedevents)\> = `...`

##### accounting?

[`PursuitRunProjection`](durable.md#pursuitrunprojection)

#### Returns

[`SupervisorView`](#supervisorview)

***

### isTopJournalEvent()

> **isTopJournalEvent**\<`T`\>(`value`): `value is T & TopJournalEvent`

**`Experimental`**

Validate supported journal lifecycle and accounting event shapes.

#### Type Parameters

##### T

`T`

#### Parameters

##### value

`T`

#### Returns

`value is T & TopJournalEvent`

***

### readTopAgentHistory()

> **readTopAgentHistory**(`worker`, `blobs?`, `node?`): `Promise`\<[`TopTranscriptRow`](#toptranscriptrow)[]\>

**`Experimental`**

Task, result and progress use the same projection for file-backed and SQL-backed runs.

#### Parameters

##### worker

[`WorkerView`](#workerview)

##### blobs?

`Pick`\<[`ResultBlobStore`](runtime.md#resultblobstore), `"get"`\>

##### node?

[`PursuitNodeProjection`](durable.md#pursuitnodeprojection)

#### Returns

`Promise`\<[`TopTranscriptRow`](#toptranscriptrow)[]\>

***

### readTopAgentInspection()

> **readTopAgentInspection**(`__namedParameters`): `Promise`\<[`TopInspection`](#topinspection)\>

**`Experimental`**

Resolve ordinary Runtime transcript evidence, never a product-specific capture registry.

#### Parameters

##### \_\_namedParameters

###### worker

[`WorkerView`](#workerview)

###### runId

`string`

###### blobs

`Pick`\<[`ResultBlobStore`](runtime.md#resultblobstore), `"get"`\>

###### readSessions

[`TopSessionReader`](#topsessionreader)

###### artifacts?

[`AgentCandidateArtifactPort`](candidate-execution.md#agentcandidateartifactport)

###### signal?

`AbortSignal`

#### Returns

`Promise`\<[`TopInspection`](#topinspection)\>

***

### topAgentWorker()

> **topAgentWorker**(`run`, `workerId`): [`WorkerView`](#workerview) \| `undefined`

**`Experimental`**

One selected-agent mapping for filesystem and API transports; no execution or I/O.

#### Parameters

##### run

[`SupervisorView`](#supervisorview)

##### workerId

`string`

#### Returns

[`WorkerView`](#workerview) \| `undefined`

***

### topAgentMetadata()

> **topAgentMetadata**(`inspection`, `recorded`): [`TopAgentMetadata`](#topagentmetadata)

**`Experimental`**

Metadata keeps full recorded context while the conversation can show compact attribution.

#### Parameters

##### inspection

[`TopInspection`](#topinspection) \| `undefined`

##### recorded

readonly [`TopTranscriptRow`](#toptranscriptrow)[]

#### Returns

[`TopAgentMetadata`](#topagentmetadata)

***

### createTopAgentStream()

> **createTopAgentStream**(`generation`): `object`

**`Experimental`**

Project selected conversation rows into ordered reset and row frames.

#### Parameters

##### generation

`number`

#### Returns

`object`

##### reset

> **reset**: `object`

###### reset.generation

> **generation**: `number`

##### frame()

> **frame**(`__namedParameters`): readonly [`TopAgentStreamFrame`](#topagentstreamframe)[]

###### Parameters

###### \_\_namedParameters

###### recorded

readonly [`TopTranscriptRow`](#toptranscriptrow)[]

###### inspection?

[`TopInspection`](#topinspection)

###### alive

`boolean`

###### includeContext?

`boolean`

###### Returns

readonly [`TopAgentStreamFrame`](#topagentstreamframe)[]

***

### harnessSessionRows()

> **harnessSessionRows**(`sessions`): `object`

**`Experimental`**

One ordered projection for every strict native reader, with explicit unrenderable evidence.

#### Parameters

##### sessions

readonly [`HarnessRowsSession`](#harnessrowssession)[]

#### Returns

`object`

##### rows

> **rows**: [`HarnessSessionRow`](#harnesssessionrow)[]

##### gaps

> **gaps**: [`HarnessRowsGap`](#harnessrowsgap)[]

***

### serveTopWeb()

> **serveTopWeb**(`options`): `Promise`\<\{ `url`: `string`; `close`: () => `Promise`\<`void`\>; \}\>

**`Experimental`**

Read-only web transport over the same snapshots as the terminal. No execution or writes.

#### Parameters

##### options

[`TopWebOptions`](#topweboptions)

#### Returns

`Promise`\<\{ `url`: `string`; `close`: () => `Promise`\<`void`\>; \}\>

## References

### provisionSupervisor

Re-exports [provisionSupervisor](runtime.md#provisionsupervisor)
