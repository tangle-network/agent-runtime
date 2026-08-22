[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/graph

# runtime/graph

## Interfaces

### GraphEngineOptions

`@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.

Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
fold and kill-anywhere replay), #982 (the `runGraph` preset).

#### Properties

##### kinds?

> `readonly` `optional` **kinds?**: readonly [`NodeKind`](#nodekind)\<`unknown`, readonly `string`[]\>[]

Kinds to register beside the core set. A host adds its own here; nothing is global.

##### effects?

> `readonly` `optional` **effects?**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

The host's effect table, by name. A kind receives only the effects it declared.

##### coreKinds

> `readonly` **coreKinds**: readonly [`NodeKind`](#nodekind)\<`unknown`, readonly `string`[]\>[]

The core set. Injected so a test can substitute, and so the engine never imports a
 backend-specific factory at module load.

***

### GraphEngine

`@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.

Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
fold and kill-anywhere replay), #982 (the `runGraph` preset).

#### Properties

##### kinds

> `readonly` **kinds**: [`Registry`](#registry)\<[`NodeKind`](#nodekind)\<`unknown`, readonly `string`[]\>\>

##### effects

> `readonly` **effects**: `Readonly`\<`Record`\<[`EffectName`](#effectname), `unknown`\>\>

#### Methods

##### requiredEffects()

> **requiredEffects**(): `string`[]

Every effect name any registered kind declares — what a host must provide for this engine's
 whole kind set to be runnable. Listed, never discovered mid-run.

###### Returns

`string`[]

##### missingEffects()

> **missingEffects**(): `string`[]

The declared effects no host value covers. Empty means every registered kind is runnable.

###### Returns

`string`[]

***

### PortSpec

One declared port on a node. Ports are how a `data` edge binds one node's output to another's
input with a type the compiler can check structurally before any spend. A node has two implicit
output ports beside its declared ones: `out` (its result) and `trace` (its `WorkerTraceEvidence`
by `traceRef`); only an `analyzes` edge may bind `trace`.

#### Properties

##### name

> `readonly` **name**: `string`

##### schema

> `readonly` **schema**: [`JsonSchema`](#jsonschema)

##### description?

> `readonly` `optional` **description?**: `string`

***

### NodeKind

The validated declaration every kind provides. `Config` is the per-node config shape;
 `Effects` is the tuple of host capabilities it declares, so the context `run` receives is typed
 to exactly that tuple.

#### Extends

- [`Registered`](#registered)

#### Type Parameters

##### Config

`Config` = `unknown`

##### Effects

`Effects` *extends* `ReadonlyArray`\<[`EffectName`](#effectname)\> = `ReadonlyArray`\<[`EffectName`](#effectname)\>

#### Properties

##### id

> `readonly` **id**: `string`

Kind id, e.g. `agent`, `integration.invoke`. With `version`, forms the handle `<id>/v<n>`.

###### Overrides

[`Registered`](#registered).[`id`](#id-2)

##### version

> `readonly` **version**: `number`

###### Overrides

[`Registered`](#registered).[`version`](#version-2)

##### description

> `readonly` **description**: `string`

##### validateConfig

> `readonly` **validateConfig**: (`raw`, `context`) => `Config`

Validate and narrow one node's config. Throw `ValidationError` to refuse; the compiler
 surfaces the message with the node id prefixed.

###### Parameters

###### raw

`unknown`

###### context

`string`

###### Returns

`Config`

##### configSchema

> `readonly` **configSchema**: [`JsonSchema`](#jsonschema)

The portable form of `validateConfig`'s accepted shape, for manifests and hosts.

##### inputs

> `readonly` **inputs**: readonly [`PortSpec`](#portspec)[]

Declared input ports; a `data` edge may bind only these. Empty for a source node.

##### outputs

> `readonly` **outputs**: readonly [`PortSpec`](#portspec)[]

Declared output ports beside the implicit `out` and `trace`.

##### effects

> `readonly` **effects**: `Effects`

Host capabilities this kind reaches for, by name. The context is narrowed to exactly these.

##### onCrash

> `readonly` **onCrash**: [`OnCrash`](#oncrash)

##### budget

> `readonly` **budget**: [`BudgetMode`](#budgetmode)

##### run

> `readonly` **run**: (`args`) => [`Agent`](../runtime.md#agent-2)\<`unknown`, `unknown`\>

Build the agent for one node instance. The kernel spawns it under `Scope.spawn`, so it is
authorized, classified, journaled, pooled and gated like any child — the kind owns only what
the agent DOES. `profile` is the node's pinned profile (an `agent`/`supervisor` kind runs it;
a `script` kind may ignore it); `inputs` are the resolved, content-addressed port values;
`effects` is the narrowed host context; `spawn` is the kernel's per-spawn context when the
kind needs it (a supervisor kind threads it into `nodeContext`).

###### Parameters

###### args

###### config

`Config`

###### profile

`AgentProfile`

###### inputs

`Readonly`\<`Record`\<`string`, `unknown`\>\>

###### effects

[`EffectContext`](#effectcontext)\<`Effects`\>

###### spawn?

[`WorkerSpawnContext`](../runtime.md#workerspawncontext)

###### Returns

[`Agent`](../runtime.md#agent-2)\<`unknown`, `unknown`\>

***

### NodeFlags

Per-node flags a graph author sets; they are node properties, not kinds (agent-runtime#970).

#### Properties

##### oracle?

> `readonly` `optional` **oracle?**: `boolean`

An oracle — a judge, grader, auditor, trace analyst — may be bound only by an `analyzes`
 edge. The compiler refuses a `delegates` or `data` edge INTO an oracle: an edge to a grader
 leaks the rubric.

##### pure?

> `readonly` `optional` **pure?**: `boolean`

`script` only: pure over `(config, inputs)` ⇒ budget exempt, output restorable on replay,
 runs in-process. A pure script that settles with a different `outRef` for the same inputs
 has lied, and the first replay mismatch is an engine error.

***

### AgentKindConfig

#### Properties

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](../runtime.md#executorconfig)

Where this node's profile runs. Omit to inherit the engine's default backend.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](../runtime.md#deliverablespec)\<`unknown`\>

This node's completion check. Omit to inherit the graph's terminal check.

***

### SupervisorKindConfig

#### Properties

##### perWorker

> `readonly` **perWorker**: [`Budget`](../index.md#budget-4)

Per-child budget reserved from the pool on each spawn this supervisor makes.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

***

### ScriptKindConfig

#### Properties

##### body

> `readonly` **body**: [`ScriptBody`](#scriptbody)

##### pure?

> `readonly` `optional` **pure?**: `boolean`

`pure: true` is the promise that the output is a function of `(config, inputs)` alone: the
node is then budget-exempt, its output restorable on replay by content address, and it runs
in-process. A pure script that settles with a different `outRef` for the same inputs has
lied, and the first replay mismatch is an engine error.

##### spent?

> `readonly` `optional` **spent?**: [`Spend`](../index.md#spend)

For a metered script: what it spent. Omit on a pure script. A metered script that reports
 nothing is metered as NOTHING-KNOWN, never as free.

***

### RegistryHandle

A versioned name: what a graph writes and what a host registers.

#### Extended by

- [`Registered`](#registered)

#### Properties

##### id

> `readonly` **id**: `string`

##### version

> `readonly` **version**: `number`

***

### Registered

Anything a registry holds carries its own handle, so the table cannot drift from the entry.

#### Extends

- [`RegistryHandle`](#registryhandle)

#### Extended by

- [`NodeKind`](#nodekind)

#### Properties

##### id

> `readonly` **id**: `string`

###### Inherited from

[`RegistryHandle`](#registryhandle).[`id`](#id-1)

##### version

> `readonly` **version**: `number`

###### Inherited from

[`RegistryHandle`](#registryhandle).[`version`](#version-1)

***

### Registry

#### Type Parameters

##### T

`T` *extends* [`Registered`](#registered)

#### Methods

##### register()

> **register**(`entry`, `options?`): `void`

Add one entry. A second entry under the same handle is refused unless `replace` is set —
 silently shadowing a registered kind is how a key no caller could produce once survived.

###### Parameters

###### entry

`T`

###### options?

###### replace?

`boolean`

###### Returns

`void`

##### has()

> **has**(`handle`): `boolean`

###### Parameters

###### handle

[`RegistryHandle`](#registryhandle)

###### Returns

`boolean`

##### get()

> **get**(`handle`): `T` \| `undefined`

###### Parameters

###### handle

[`RegistryHandle`](#registryhandle)

###### Returns

`T` \| `undefined`

##### require()

> **require**(`handle`, `context?`): `T`

The entry, or a refusal that names the handle AND lists every registered handle — a miss
 must be diagnosable from its message alone.

###### Parameters

###### handle

[`RegistryHandle`](#registryhandle)

###### context?

`string`

###### Returns

`T`

##### names()

> **names**(): `string`[]

Every registered handle, sorted, as wire spellings. The thing the fourteen predecessors
 mostly could not do and four callers needed.

###### Returns

`string`[]

##### entries()

> **entries**(): `T`[]

Every entry, in `names()` order.

###### Returns

`T`[]

## Type Aliases

### JsonSchema

> **JsonSchema** = `Readonly`\<`Record`\<`string`, `unknown`\>\>

A JSON Schema document as the kernel already spells it: an opaque record, validated by the
 consumer's own validator, published verbatim.

***

### EffectName

> **EffectName** = `string`

What a kind declares it needs from the host. The engine never imports a host capability; it
knows only that a kind SAID it needs something under this name and the host PROVIDED something
under it. The context a kind receives is narrowed to exactly its declaration — an undeclared
effect is `undefined`, never a service locator.

***

### EffectContext

> **EffectContext**\<`Effects`\> = `Readonly`\<`{ [K in Effects[number]]: unknown }`\>

#### Type Parameters

##### Effects

`Effects` *extends* `ReadonlyArray`\<[`EffectName`](#effectname)\>

***

### OnCrash

> **OnCrash** = `"restart"` \| `"resume"`

What happens to a node that was IN FLIGHT when the process died. A settled node is never a
per-kind choice — it restores from its content-addressed `outRef` on replay. `'restart'` re-runs
from the journaled `inputRef`; `'resume'` is legal only for a kind whose executor can re-attach
to the live process (the bridge backend's session re-attachment is the existing instance).

***

### BudgetMode

> **BudgetMode** = `"metered"` \| `"exempt"`

Whether a kind's spend enters the conserved pool. `'metered'`: the executor reports `Spend` and
settling without one is an ENGINE ERROR — never "free". `'exempt'`: the whole reservation is
refunded on settle, keeping the node out of Σk by construction (the kernel's `budgetExempt`).

***

### ScriptBody

> **ScriptBody** = (`inputs`, `signal`) => `Promise`\<`unknown`\> \| `unknown`

The caller code a `script` node runs. Receives the resolved inputs; returns the output.

#### Parameters

##### inputs

`Readonly`\<`Record`\<`string`, `unknown`\>\>

##### signal

`AbortSignal`

#### Returns

`Promise`\<`unknown`\> \| `unknown`

## Functions

### createGraphEngine()

> **createGraphEngine**(`options`): [`GraphEngine`](#graphengine)

Build one engine: a kind registry seeded with the core kinds plus the host's, and the host's
effect values. Every kind is validated by name at construction, so a malformed host kind fails
here, never at its first node.

#### Parameters

##### options

[`GraphEngineOptions`](#graphengineoptions)

#### Returns

[`GraphEngine`](#graphengine)

***

### validateNodeKind()

> **validateNodeKind**(`kind`, `context?`): [`NodeKind`](#nodekind)

Validate a kind declaration at registration — so a malformed kind is refused by name once,
 not at the first node that uses it.

#### Parameters

##### kind

[`NodeKind`](#nodekind)

##### context?

`string` = `'registerNodeKind'`

#### Returns

[`NodeKind`](#nodekind)

***

### kindHandle()

> **kindHandle**(`kind`): [`RegistryHandle`](#registryhandle)

The handle a graph writes to name this kind.

#### Parameters

##### kind

`Pick`\<[`NodeKind`](#nodekind), `"id"` \| `"version"`\>

#### Returns

[`RegistryHandle`](#registryhandle)

***

### narrowEffects()

> **narrowEffects**\<`Effects`\>(`declared`, `provided`, `context`): [`EffectContext`](#effectcontext)\<`Effects`\>

Narrow a host's effect table to exactly what one kind declared. Anything the kind did not
declare is absent — `undefined` on read — so a kind cannot reach past its declaration, and the
engine can list a graph's required effects before spending a token.

#### Type Parameters

##### Effects

`Effects` *extends* readonly `string`[]

#### Parameters

##### declared

`Effects`

##### provided

`Readonly`\<`Record`\<`string`, `unknown`\>\>

##### context

`string`

#### Returns

[`EffectContext`](#effectcontext)\<`Effects`\>

***

### agentKind()

> **agentKind**(`defaults`): [`NodeKind`](#nodekind)\<[`AgentKindConfig`](#agentkindconfig)\>

One profile, one run: the kernel's leaf, exactly as `supervise()` derives it from `backend`.
The model cannot decide this — it is what gets run.

#### Parameters

##### defaults

###### backend?

[`ExecutorConfig`](../runtime.md#executorconfig)

###### deliverable?

[`DeliverableSpec`](../runtime.md#deliverablespec)\<`unknown`\>

#### Returns

[`NodeKind`](#nodekind)\<[`AgentKindConfig`](#agentkindconfig)\>

***

### supervisorKind()

> **supervisorKind**(`deps`): [`NodeKind`](#nodekind)\<[`SupervisorKindConfig`](#supervisorkindconfig)\>

The thing that DECIDES: a nested `supervisorAgent` with the coordination verbs. Its children
are its own tree — the graph sees one node in, one `Settled` out. A `subgraph` constrains what
it may spawn; without one it is free-form under `profileSecurity` and `allowedModels`.

#### Parameters

##### deps

###### blobs

[`ResultBlobStore`](../runtime.md#resultblobstore)

###### makeWorkerAgent

[`MakeWorkerAgent`](../runtime.md#makeworkeragent)

###### router?

[`RouterTransportConfig`](../runtime.md#routertransportconfig)

###### driveHarness?

[`DriveHarness`](../runtime.md#driveharness-2)

#### Returns

[`NodeKind`](#nodekind)\<[`SupervisorKindConfig`](#supervisorkindconfig)\>

***

### scriptKind()

> **scriptKind**(): [`NodeKind`](#nodekind)\<[`ScriptKindConfig`](#scriptkindconfig)\>

Caller code as a node. The one kind with no kernel primitive behind it: the kernel has no
"data→data with no execution" concept (agent-runtime#970 fact-finding), so this is new. It is
still a leaf `Agent` carrying an `Executor`, so the journal, the gate and the pool treat it like
any other node.

#### Returns

[`NodeKind`](#nodekind)\<[`ScriptKindConfig`](#scriptkindconfig)\>

***

### subgraphKind()

> **subgraphKind**(): [`NodeKind`](#nodekind)\<\{ `graph`: `unknown`; \}\>

A node carrying its own graph: the constraint on what a supervisor may spawn at depth>1. Its
executor is a nested engine run; that needs the scheduler (#980), so until then this kind is
registered and REFUSES at run time by name rather than being absent — a graph that names it
compiles, and the refusal says exactly what is missing.

#### Returns

[`NodeKind`](#nodekind)\<\{ `graph`: `unknown`; \}\>

***

### formatRegistryHandle()

> **formatRegistryHandle**(`handle`): `string`

`<id>/v<n>` — the only spelling a handle has on the wire, in a journal, or in an error.

#### Parameters

##### handle

[`RegistryHandle`](#registryhandle)

#### Returns

`string`

***

### parseRegistryHandle()

> **parseRegistryHandle**(`text`, `context`): [`RegistryHandle`](#registryhandle)

Parse the wire spelling back. Refuses anything that is not exactly `<id>/v<n>`.

#### Parameters

##### text

`string`

##### context

`string`

#### Returns

[`RegistryHandle`](#registryhandle)

***

### createRegistry()

> **createRegistry**\<`T`\>(`label`, `seed?`): [`Registry`](#registry)\<`T`\>

Create a registry. Per-instance by construction: two engines in one process may hold
different kind sets, a test is hermetic, and a run can print its own table. There is
deliberately no module-level singleton — `builtinShapes` was the one mutable global in the
kernel and it had zero tests.

#### Type Parameters

##### T

`T` *extends* [`Registered`](#registered)

#### Parameters

##### label

`string`

##### seed?

`Iterable`\<`T`\> = `[]`

#### Returns

[`Registry`](#registry)\<`T`\>
