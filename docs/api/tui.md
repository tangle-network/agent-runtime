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

#### Extends

- `SourceDiagnostic`

#### Properties

##### runId?

> `readonly` `optional` **runId?**: `string`

**`Experimental`**

##### source

> `readonly` **source**: [`TopSnapshotDiagnosticSource`](#topsnapshotdiagnosticsource)

**`Experimental`**

###### Inherited from

`SourceDiagnostic.source`

##### path

> `readonly` **path**: `string`

**`Experimental`**

###### Inherited from

`SourceDiagnostic.path`

##### reason

> `readonly` **reason**: [`TopSnapshotDiagnosticReason`](#topsnapshotdiagnosticreason)

**`Experimental`**

###### Inherited from

`SourceDiagnostic.reason`

***

### SupervisorView

**`Experimental`**

#### Extends

- `SupervisorBase`

#### Properties

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

##### reason?

> `readonly` `optional` **reason?**: `string`

**`Experimental`**

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

## Type Aliases

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

> **TopJournalEvent** = `object` & (\{ `kind`: `"spawned"`; `parent?`: `string`; `label?`: `string`; `budget?`: `unknown`; `runtime?`: `string`; \} \| \{ `kind`: `"settled"`; `status?`: `string`; `outRef?`: `string`; `verdict?`: `unknown`; `spent?`: `unknown`; `infra?`: `boolean`; `reason?`: `string`; \} \| \{ `kind`: `"cancelled"`; `spent?`: `unknown`; `reason?`: `string`; \} \| \{ `kind`: `"metered"`; `spend?`: `unknown`; `accountingOnly?`: `boolean`; \} \| \{ `kind`: `"progress"`; `spend?`: `unknown`; \})

**`Experimental`**

#### Type Declaration

##### id

> `readonly` **id**: `string`

##### seq?

> `readonly` `optional` **seq?**: `number`

##### at?

> `readonly` `optional` **at?**: `string`

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
