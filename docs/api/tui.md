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

### TopAppOptions

**`Experimental`**

How the app was invoked. Defaults read `process.argv` / `process.cwd()`.

#### Properties

##### argv?

> `readonly` `optional` **argv?**: readonly `string`[]

**`Experimental`**

##### cwd?

> `readonly` `optional` **cwd?**: `string`

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

***

### SupervisorBase

**`Experimental`**

#### Extended by

- [`SupervisorView`](#supervisorview)

#### Properties

##### id

> `readonly` **id**: `string`

**`Experimental`**

##### status

> `readonly` **status**: `string`

**`Experimental`**

##### task

> `readonly` **task**: `string`

**`Experimental`**

##### workspaceDir

> `readonly` **workspaceDir**: `string`

**`Experimental`**

##### budget

> `readonly` **budget**: `number`

**`Experimental`**

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

**`Experimental`**

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

**`Experimental`**

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

**`Experimental`**

##### verdict?

> `readonly` `optional` **verdict?**: `string`

**`Experimental`**

##### progress?

> `readonly` `optional` **progress?**: `string`

**`Experimental`**

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

**`Experimental`**

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

**`Experimental`**

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

**`Experimental`**

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

**`Experimental`**

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

**`Experimental`**

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

**`Experimental`**

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

**`Experimental`**

***

### SupervisorView

**`Experimental`**

#### Extends

- [`SupervisorBase`](#supervisorbase)

#### Properties

##### id

> `readonly` **id**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`id`](#id)

##### status

> `readonly` **status**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`status`](#status)

##### task

> `readonly` **task**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`task`](#task)

##### workspaceDir

> `readonly` **workspaceDir**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`workspaceDir`](#workspacedir)

##### budget

> `readonly` **budget**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`budget`](#budget)

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`verifyCmd`](#verifycmd)

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`workerModel`](#workermodel)

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`driverModel`](#drivermodel)

##### verdict?

> `readonly` `optional` **verdict?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`verdict`](#verdict)

##### progress?

> `readonly` `optional` **progress?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`progress`](#progress)

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`startedAt`](#startedat)

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`completedAt`](#completedat)

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxSandboxes`](#maxsandboxes)

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxLifetimeSeconds`](#maxlifetimeseconds)

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`idleTimeoutSeconds`](#idletimeoutseconds)

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxUsd`](#maxusd)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

**`Experimental`**

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxDepth`](#maxdepth)

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

##### cwd?

> `readonly` `optional` **cwd?**: `string`

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

> `readonly` **status**: `"running"` \| `"done"` \| `"down"` \| `"cancelled"`

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

***

### RenderOptions

**`Experimental`**

#### Properties

##### width?

> `readonly` `optional` **width?**: `number`

**`Experimental`**

##### height?

> `readonly` `optional` **height?**: `number`

**`Experimental`**

##### color?

> `readonly` `optional` **color?**: `boolean`

**`Experimental`**

##### selectedSupervisorId?

> `readonly` `optional` **selectedSupervisorId?**: `string`

**`Experimental`**

##### selectedWorkerId?

> `readonly` `optional` **selectedWorkerId?**: `string`

**`Experimental`**

##### focus?

> `readonly` `optional` **focus?**: `"supervisors"` \| `"workers"`

**`Experimental`**

##### mode?

> `readonly` `optional` **mode?**: `"log"` \| `"overview"` \| `"detail"`

**`Experimental`**

##### notice?

> `readonly` `optional` **notice?**: `string`

**`Experimental`**

##### steerInput?

> `readonly` `optional` **steerInput?**: `object`

**`Experimental`**

###### active

> `readonly` **active**: `boolean`

###### value

> `readonly` **value**: `string`

###### workerLabel?

> `readonly` `optional` **workerLabel?**: `string`

***

### RenderTarget

**`Experimental`**

#### Properties

##### row

> `readonly` **row**: `number`

**`Experimental`**

##### kind

> `readonly` **kind**: `"worker"` \| `"supervisor"`

**`Experimental`**

##### id

> `readonly` **id**: `string`

**`Experimental`**

##### supervisorId?

> `readonly` `optional` **supervisorId?**: `string`

**`Experimental`**

***

### RenderedTopFrame

**`Experimental`**

#### Properties

##### frame

> `readonly` **frame**: `string`

**`Experimental`**

##### targets

> `readonly` **targets**: [`RenderTarget`](#rendertarget)[]

**`Experimental`**

## Type Aliases

### TopJournalEvent

> **TopJournalEvent** = \{ `kind`: `"spawned"`; `id`: `string`; `parent?`: `string`; `label?`: `string`; `budget?`: `unknown`; `runtime?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"settled"`; `id`: `string`; `status?`: `string`; `outRef?`: `string`; `verdict?`: `unknown`; `spent?`: `unknown`; `infra?`: `boolean`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: `string`; `reason?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"metered"`; `id`: `string`; `spend?`: `unknown`; `seq?`: `number`; `at?`: `string`; \}

**`Experimental`**

## Functions

### renderTopOnce()

> **renderTopOnce**(`options?`): `string`

**`Experimental`**

Render exactly one frame and return it. This is the non-interactive path — `--once`, a pipe, a
test — so it never touches raw mode, the alternate screen, or `process.exit`.

#### Parameters

##### options?

[`TopAppOptions`](#topappoptions) = `{}`

#### Returns

`string`

***

### runTopApp()

> **runTopApp**(`options?`): `void`

**`Experimental`**

Run the TUI. With a TTY on both ends and no `--once` this takes over the terminal until `q`;
otherwise it writes a single frame to stdout and returns.

#### Parameters

##### options?

[`TopAppOptions`](#topappoptions) = `{}`

#### Returns

`void`

***

### loadTopSnapshot()

> **loadTopSnapshot**(`rootDir`, `now?`): [`TopSnapshot`](#topsnapshot)

**`Experimental`**

Read every supervisor run under one workspace into a single point-in-time snapshot.

Pure with respect to the process: it only reads, and every unreadable or half-written file is
skipped rather than thrown on — an operator view must survive a writer mid-append. `now` is
injectable so elapsed time is deterministic under test.

#### Parameters

##### rootDir

`string`

##### now?

`number` = `...`

#### Returns

[`TopSnapshot`](#topsnapshot)

***

### renderTopFrame()

> **renderTopFrame**(`snapshot`, `options?`): `string`

**`Experimental`**

Render one snapshot to an ANSI frame. Use this when nothing needs to be clickable.

#### Parameters

##### snapshot

[`TopSnapshot`](#topsnapshot)

##### options?

[`RenderOptions`](#renderoptions) = `{}`

#### Returns

`string`

***

### renderTopFrameWithLayout()

> **renderTopFrameWithLayout**(`snapshot`, `options?`): [`RenderedTopFrame`](#renderedtopframe)

**`Experimental`**

Render one snapshot, returning the frame together with the row→entity map a mouse click resolves
against. The layout is the only thing that knows which row is which run or worker, so emitting it
alongside the text is what keeps click handling out of the renderer.

#### Parameters

##### snapshot

[`TopSnapshot`](#topsnapshot)

##### options?

[`RenderOptions`](#renderoptions) = `{}`

#### Returns

[`RenderedTopFrame`](#renderedtopframe)
