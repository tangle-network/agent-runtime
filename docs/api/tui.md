[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / tui

# tui

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

#### Properties

##### root

> `readonly` **root**: `string`

##### generatedAt

> `readonly` **generatedAt**: `number`

##### supervisors

> `readonly` **supervisors**: [`SupervisorView`](#supervisorview)[]

***

### SupervisorBase

#### Extended by

- [`SupervisorView`](#supervisorview)

#### Properties

##### id

> `readonly` **id**: `string`

##### status

> `readonly` **status**: `string`

##### task

> `readonly` **task**: `string`

##### workspaceDir

> `readonly` **workspaceDir**: `string`

##### budget

> `readonly` **budget**: `number`

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

##### verdict?

> `readonly` `optional` **verdict?**: `string`

##### progress?

> `readonly` `optional` **progress?**: `string`

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

***

### SupervisorView

#### Extends

- [`SupervisorBase`](#supervisorbase)

#### Properties

##### id

> `readonly` **id**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`id`](#id)

##### status

> `readonly` **status**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`status`](#status)

##### task

> `readonly` **task**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`task`](#task)

##### workspaceDir

> `readonly` **workspaceDir**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`workspaceDir`](#workspacedir)

##### budget

> `readonly` **budget**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`budget`](#budget)

##### verifyCmd?

> `readonly` `optional` **verifyCmd?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`verifyCmd`](#verifycmd)

##### workerModel?

> `readonly` `optional` **workerModel?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`workerModel`](#workermodel)

##### driverModel?

> `readonly` `optional` **driverModel?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`driverModel`](#drivermodel)

##### verdict?

> `readonly` `optional` **verdict?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`verdict`](#verdict)

##### progress?

> `readonly` `optional` **progress?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`progress`](#progress)

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`startedAt`](#startedat)

##### completedAt?

> `readonly` `optional` **completedAt?**: `string`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`completedAt`](#completedat)

##### maxSandboxes?

> `readonly` `optional` **maxSandboxes?**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxSandboxes`](#maxsandboxes)

##### maxLifetimeSeconds?

> `readonly` `optional` **maxLifetimeSeconds?**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxLifetimeSeconds`](#maxlifetimeseconds)

##### idleTimeoutSeconds?

> `readonly` `optional` **idleTimeoutSeconds?**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`idleTimeoutSeconds`](#idletimeoutseconds)

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxUsd`](#maxusd)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

###### Inherited from

[`SupervisorBase`](#supervisorbase).[`maxDepth`](#maxdepth)

##### stateDir

> `readonly` **stateDir**: `string`

##### resultSpentUsd?

> `readonly` `optional` **resultSpentUsd?**: `number`

##### resultSpentTokens?

> `readonly` `optional` **resultSpentTokens?**: `number`

##### workers

> `readonly` **workers**: [`WorkerView`](#workerview)[]

##### progressTail

> `readonly` **progressTail**: `string`[]

##### journalTail

> `readonly` **journalTail**: [`TopJournalEvent`](#topjournalevent)[]

##### driverSpend

> `readonly` **driverSpend**: [`SpendStats`](#spendstats)

##### totals

> `readonly` **totals**: [`SupervisorTotals`](#supervisortotals)

***

### WorkerView

#### Properties

##### id

> `readonly` **id**: `string`

##### label

> `readonly` **label**: `string`

##### cwd?

> `readonly` `optional` **cwd?**: `string`

##### eventFile?

> `readonly` `optional` **eventFile?**: `string`

##### parent?

> `readonly` `optional` **parent?**: `string`

##### runtime?

> `readonly` `optional` **runtime?**: `string`

##### status

> `readonly` **status**: `"done"` \| `"down"` \| `"running"` \| `"cancelled"`

##### verdict?

> `readonly` `optional` **verdict?**: `string`

##### infra?

> `readonly` `optional` **infra?**: `boolean`

##### startedAt?

> `readonly` `optional` **startedAt?**: `string`

##### endedAt?

> `readonly` `optional` **endedAt?**: `string`

##### latencyMs

> `readonly` **latencyMs**: `number`

##### budget?

> `readonly` `optional` **budget?**: [`BudgetStats`](#budgetstats)

##### spend

> `readonly` **spend**: [`SpendStats`](#spendstats)

##### metered

> `readonly` **metered**: [`SpendStats`](#spendstats)

##### liveTail

> `readonly` **liveTail**: `string`[]

##### outRef?

> `readonly` `optional` **outRef?**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

***

### SupervisorTotals

#### Properties

##### workers

> `readonly` **workers**: `number`

##### running

> `readonly` **running**: `number`

##### done

> `readonly` **done**: `number`

##### down

> `readonly` **down**: `number`

##### cancelled

> `readonly` **cancelled**: `number`

##### inFlight

> `readonly` **inFlight**: `number`

##### settled

> `readonly` **settled**: `number`

##### tokensInput

> `readonly` **tokensInput**: `number`

##### tokensOutput

> `readonly` **tokensOutput**: `number`

##### tokensTotal

> `readonly` **tokensTotal**: `number`

##### usd

> `readonly` **usd**: `number`

##### latencyMs

> `readonly` **latencyMs**: `number`

##### workerLatency

> `readonly` **workerLatency**: [`Distribution`](#distribution)

***

### Distribution

#### Properties

##### n

> `readonly` **n**: `number`

##### min

> `readonly` **min**: `number`

##### median

> `readonly` **median**: `number`

##### p90

> `readonly` **p90**: `number`

##### max

> `readonly` **max**: `number`

***

### BudgetStats

#### Properties

##### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

##### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

##### maxUsd?

> `readonly` `optional` **maxUsd?**: `number`

***

### SpendStats

#### Properties

##### iterations

> `readonly` **iterations**: `number`

##### tokensInput

> `readonly` **tokensInput**: `number`

##### tokensOutput

> `readonly` **tokensOutput**: `number`

##### usd

> `readonly` **usd**: `number`

##### ms

> `readonly` **ms**: `number`

***

### RenderOptions

#### Properties

##### width?

> `readonly` `optional` **width?**: `number`

##### height?

> `readonly` `optional` **height?**: `number`

##### color?

> `readonly` `optional` **color?**: `boolean`

##### selectedSupervisorId?

> `readonly` `optional` **selectedSupervisorId?**: `string`

##### selectedWorkerId?

> `readonly` `optional` **selectedWorkerId?**: `string`

##### focus?

> `readonly` `optional` **focus?**: `"supervisors"` \| `"workers"`

##### mode?

> `readonly` `optional` **mode?**: `"log"` \| `"overview"` \| `"detail"`

##### notice?

> `readonly` `optional` **notice?**: `string`

##### steerInput?

> `readonly` `optional` **steerInput?**: `object`

###### active

> `readonly` **active**: `boolean`

###### value

> `readonly` **value**: `string`

###### workerLabel?

> `readonly` `optional` **workerLabel?**: `string`

***

### RenderTarget

#### Properties

##### row

> `readonly` **row**: `number`

##### kind

> `readonly` **kind**: `"worker"` \| `"supervisor"`

##### id

> `readonly` **id**: `string`

##### supervisorId?

> `readonly` `optional` **supervisorId?**: `string`

***

### RenderedTopFrame

#### Properties

##### frame

> `readonly` **frame**: `string`

##### targets

> `readonly` **targets**: [`RenderTarget`](#rendertarget)[]

## Type Aliases

### TopJournalEvent

> **TopJournalEvent** = \{ `kind`: `"spawned"`; `id`: `string`; `parent?`: `string`; `label?`: `string`; `budget?`: `unknown`; `runtime?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"settled"`; `id`: `string`; `status?`: `string`; `outRef?`: `string`; `verdict?`: `unknown`; `spent?`: `unknown`; `infra?`: `boolean`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"cancelled"`; `id`: `string`; `reason?`: `string`; `seq?`: `number`; `at?`: `string`; \} \| \{ `kind`: `"metered"`; `id`: `string`; `spend?`: `unknown`; `seq?`: `number`; `at?`: `string`; \}

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
