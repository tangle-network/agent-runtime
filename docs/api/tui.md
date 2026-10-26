[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / tui

# tui

**`Experimental`**

`@tangle-network/agent-runtime/tui` — the terminal view over live supervisor runs.

A read-only renderer plus two write-back controls, over the same `<root>/.agent/supervisor/<id>`
layout `../runtime/supervise/run-layout` defines. It ships here rather than as its own package
because the runtime is what WRITES the state it renders: a separately-versioned viewer would
drift from the layout it reads, which is the exact failure a client and server versioning
independently produces.

Zero third-party dependencies — raw ANSI and `node:readline` keypresses, nothing else.

```ts
import { loadTopSnapshot, renderTopFrame } from '@tangle-network/agent-runtime/tui'

process.stdout.write(renderTopFrame(loadTopSnapshot(process.cwd()), { width: 132 }))
```

The runnable form is the `agent-runtime-top` bin: `agent-runtime-top <root> [--once] [--no-color]`.

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

Run directories whose state.json parsed into a valid supervisor view.

***

### TopSnapshotDiagnostic

**`Experimental`**

One skipped or partially read snapshot source. `path` is relative to the run directory and
never carries file contents, so a diagnostic is safe to show or log without leaking run data.

#### Properties

##### source

> `readonly` **source**: [`TopSnapshotDiagnosticSource`](#topsnapshotdiagnosticsource)

**`Experimental`**

##### runId?

> `readonly` `optional` **runId?**: `string`

**`Experimental`**

##### path

> `readonly` **path**: `string`

**`Experimental`**

##### reason

> `readonly` **reason**: [`TopSnapshotDiagnosticReason`](#topsnapshotdiagnosticreason)

**`Experimental`**

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

> `readonly` `optional` **budget?**: [`BudgetStats`](#budgetstats)

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

##### outRef?

> `readonly` `optional` **outRef?**: `string`

**`Experimental`**

##### reason?

> `readonly` `optional` **reason?**: `string`

**`Experimental`**

***

### SupervisorTotals

**`Experimental`**

#### Properties

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

##### tokensInput

> `readonly` **tokensInput**: `number`

**`Experimental`**

##### tokensOutput

> `readonly` **tokensOutput**: `number`

**`Experimental`**

##### tokensTotal

> `readonly` **tokensTotal**: `number`

**`Experimental`**

##### usd

> `readonly` **usd**: `number`

**`Experimental`**

##### latencyMs

> `readonly` **latencyMs**: `number`

**`Experimental`**

##### workerLatency

> `readonly` **workerLatency**: [`Distribution`](#distribution)

**`Experimental`**

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

### BudgetStats

**`Experimental`**

#### Properties

##### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

**`Experimental`**

##### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

**`Experimental`**

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

**`Experimental`**

***

### SpendStats

**`Experimental`**

#### Properties

##### iterations

> `readonly` **iterations**: `number`

**`Experimental`**

##### tokensInput

> `readonly` **tokensInput**: `number`

**`Experimental`**

##### tokensOutput

> `readonly` **tokensOutput**: `number`

**`Experimental`**

##### usd

> `readonly` **usd**: `number`

**`Experimental`**

##### ms

> `readonly` **ms**: `number`

**`Experimental`**

## Type Aliases

### TopSnapshotCompleteness

> **TopSnapshotCompleteness** = `"complete"` \| `"partial"`

**`Experimental`**

***

### TopSnapshotDiagnosticSource

> **TopSnapshotDiagnosticSource** = `"supervisor-state"` \| `"journal"` \| `"progress"` \| `"worker-tail"`

**`Experimental`**

***

### TopSnapshotDiagnosticReason

> **TopSnapshotDiagnosticReason** = `"unreadable"` \| `"partial-json"` \| `"invalid-state"` \| `"missing"`

**`Experimental`**

***

### TopJournalEvent

> **TopJournalEvent** = \{ `kind`: `"spawned"`; `id`: `string`; `parent?`: `string`; `label?`: `string`; `budget?`: `unknown`; `runtime?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"settled"`; `id`: `string`; `status?`: `string`; `outRef?`: `string`; `verdict?`: `unknown`; `spent?`: `unknown`; `infra?`: `boolean`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"cancelled"`; `spent?`: `unknown`; `id`: `string`; `reason?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"metered"`; `id`: `string`; `spend?`: `unknown`; `accountingOnly?`: `boolean`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"progress"`; `id`: `string`; `spend?`: `unknown`; `seq?`: `number`; `at?`: `string`; \}

**`Experimental`**

## Functions

### loadTopSnapshot()

> **loadTopSnapshot**(`rootDir`, `now?`): [`TopSnapshot`](#topsnapshot)

**`Experimental`**

Read every supervisor run under one workspace into a single point-in-time snapshot.

Pure with respect to the process: it only reads, and it never throws for a writer mid-append.
An unreadable or half-written source is still skipped — an operator view must survive a live
writer — but every skip is reported as one bounded `TopSnapshotDiagnostic`, so a client can
tell a removed run from a partial read. `now` is injectable so elapsed time is deterministic
under test.

#### Parameters

##### rootDir

`string`

##### now?

`number` = `...`

#### Returns

[`TopSnapshot`](#topsnapshot)

## References

### provisionSupervisor

Re-exports [provisionSupervisor](runtime.md#provisionsupervisor)
