[**@tangle-network/agent-runtime**](../README.md)

***

[@tangle-network/agent-runtime](../README.md) / runtime/graph

# runtime/graph

## Interfaces

### CompiledEdge

`@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.

Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
fold and kill-anywhere replay), #982 (the `runGraph` preset).

#### Properties

##### id

> `readonly` **id**: `string`

##### spec

> `readonly` **spec**: [`EngineGraphEdge`](#enginegraphedge)

##### fromPort

> `readonly` **fromPort**: `string`

##### toPort

> `readonly` **toPort**: `string`

***

### CompiledNode

`@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.

Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
fold and kill-anywhere replay), #982 (the `runGraph` preset).

#### Properties

##### id

> `readonly` **id**: `string`

##### kind

> `readonly` **kind**: [`NodeKind`](#nodekind)

##### config

> `readonly` **config**: `unknown`

##### join

> `readonly` **join**: `"all"` \| `"any"` \| `"any_failed"` \| `"all_done"`

##### maxVisits

> `readonly` **maxVisits**: `number`

##### oracle

> `readonly` **oracle**: `boolean`

##### pure

> `readonly` **pure**: `boolean`

##### terminal

> `readonly` **terminal**: `boolean`

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](../runtime.md#deliverablespec)\<`unknown`\>

The check this node must pass to count DELIVERED; resolved per #973.

##### inbound

> `readonly` **inbound**: readonly [`CompiledEdge`](#compilededge)[]

##### outbound

> `readonly` **outbound**: readonly [`CompiledEdge`](#compilededge)[]

##### spec

> `readonly` **spec**: [`EngineGraphNode`](#enginegraphnode)

***

### CompiledGraph

`@tangle-network/agent-runtime/graph` — the runtime-native multi-agent graph engine.

Design record: agent-runtime#966 (the map) and its closed tickets. Build sequence: #979 (this
contract + registry + the four core kinds), #980 (scheduler over typed ports), #981 (journal
fold and kill-anywhere replay), #982 (the `runGraph` preset).

#### Properties

##### nodes

> `readonly` **nodes**: `ReadonlyMap`\<`string`, [`CompiledNode`](#compilednode)\>

##### edges

> `readonly` **edges**: readonly [`CompiledEdge`](#compilededge)[]

##### entries

> `readonly` **entries**: readonly `string`[]

##### terminals

> `readonly` **terminals**: readonly `string`[]

##### root

> `readonly` **root**: `string`

##### maxNodeVisits

> `readonly` **maxNodeVisits**: `number`

***

### ConditionLeaf

#### Properties

##### path

> `readonly` **path**: `string`

Dotted path with `[N]` indexing into the guard context, e.g. `out.findings[0].severity`.

##### op

> `readonly` **op**: `"in"` \| `"eq"` \| `"neq"` \| `"gt"` \| `"gte"` \| `"lt"` \| `"lte"` \| `"contains"` \| `"exists"` \| `"truthy"`

##### value?

> `readonly` `optional` **value?**: `unknown`

***

### EngineGraphNode

#### Properties

##### id

> `readonly` **id**: `string`

##### kind

> `readonly` **kind**: `string`

`<id>/v<n>` into the engine's kind registry.

##### config?

> `readonly` `optional` **config?**: `unknown`

This node's config, validated by its kind's `validateConfig` at compile.

##### flags?

> `readonly` `optional` **flags?**: [`NodeFlags`](#nodeflags)

Per-node flags — properties of the node, never of its kind (agent-runtime#970).

##### ports?

> `readonly` `optional` **ports?**: `object`

Node-level port declarations, merged OVER the kind's. A kind whose surface depends on its
 config (a script) declares ports here; a typed kind's declared ports stay authoritative.

###### inputs?

> `readonly` `optional` **inputs?**: readonly [`PortSpec`](#portspec)[]

###### outputs?

> `readonly` `optional` **outputs?**: readonly [`PortSpec`](#portspec)[]

##### join?

> `readonly` `optional` **join?**: `"all"` \| `"any"` \| `"any_failed"` \| `"all_done"`

Which inbound gating-edge outcomes release this node. Default `all`.

##### maxVisits?

> `readonly` `optional` **maxVisits?**: `number`

Entered more than this many times fails the run `cycle-budget-exceeded`.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](../runtime.md#deliverablespec)\<`unknown`\>

This node's completion check; a terminal without one (or a kind/graph default) refuses.

##### terminal?

> `readonly` `optional` **terminal?**: `boolean`

Force-mark a terminal. Absent, a node with no outbound gating edge is terminal.

##### profile?

> `readonly` `optional` **profile?**: `Readonly`\<`Partial`\<`AgentProfile`\>\>

Profile fields merged over the engine-authored `{ name: id }` for this node's spawns.

##### budget?

> `readonly` `optional` **budget?**: [`Budget`](../index.md#budget-4)

Per-instance reservation for this node's spawns; falls back to the run's `perNode`.

***

### EngineGraphEdge

#### Properties

##### id?

> `readonly` `optional` **id?**: `string`

Stable id for the ledger; defaults to `<from>-><to>#<ordinal>`.

##### kind

> `readonly` **kind**: [`GraphEdgeKind`](#graphedgekind)

##### from

> `readonly` **from**: `object`

###### node

> `readonly` **node**: `string`

###### port?

> `readonly` `optional` **port?**: `string`

##### to

> `readonly` **to**: `object`

###### node

> `readonly` **node**: `string`

###### port?

> `readonly` `optional` **port?**: `string`

##### guard?

> `readonly` `optional` **guard?**: [`Condition`](#condition)

Evaluated over the source's settle context; absent = satisfied by completion.

##### projection?

> `readonly` `optional` **projection?**: [`Projection`](#projection-1)

`data` edges only: ONE pure reshape of the admitted payload.

##### maxTraversals?

> `readonly` `optional` **maxTraversals?**: `number`

Refuses the traversal past this many firings (ledgered `unpropagated`).

##### directive?

> `readonly` `optional` **directive?**: [`PromptHandle`](../runtime.md#prompthandle)

`delegates`/`analyzes`: the versioned directive appended to the target's task.

***

### EngineGraphSpec

#### Properties

##### nodes

> `readonly` **nodes**: readonly [`EngineGraphNode`](#enginegraphnode)[]

##### edges

> `readonly` **edges**: readonly [`EngineGraphEdge`](#enginegraphedge)[]

##### root?

> `readonly` `optional` **root?**: `string`

Root node for the graph-level completion check. Defaults to the single entry node.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](../runtime.md#deliverablespec)\<`unknown`\>

Becomes the ROOT node's completion check when the root declares none (#973).

##### maxNodeVisits?

> `readonly` `optional` **maxNodeVisits?**: `number`

***

### GraphEngineOptions

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

[`Registered`](#registered).[`id`](#id-6)

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

[`RegistryHandle`](#registryhandle).[`id`](#id-5)

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

***

### GraphNodeSettle

One node settlement as the graph result reports it.

#### Properties

##### node

> `readonly` **node**: `string`

##### visit

> `readonly` **visit**: `number`

##### status

> `readonly` **status**: `"done"` \| `"down"`

##### valid?

> `readonly` `optional` **valid?**: `boolean`

The node's completion check verdict; `undefined` when the node declares no check.

##### out?

> `readonly` `optional` **out?**: `unknown`

##### outRef?

> `readonly` `optional` **outRef?**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

***

### GraphEdgeTraversal

One ledgered edge firing (or refusal) — the run's observable data flow.

#### Properties

##### edge

> `readonly` **edge**: `string`

##### kind

> `readonly` **kind**: `"data"` \| `"delegates"` \| `"analyzes"`

##### from

> `readonly` **from**: `string`

##### to

> `readonly` **to**: `string`

##### traversal

> `readonly` **traversal**: `number`

##### outcome

> `readonly` **outcome**: `"delivered"` \| `"empty"` \| `"unpropagated"`

##### directive?

> `readonly` `optional` **directive?**: `string`

##### port?

> `readonly` `optional` **port?**: `string`

##### reason?

> `readonly` `optional` **reason?**: `string`

***

### GraphRunOptions

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](../index.md#budget-4)

The run's conserved pool.

##### perNode?

> `readonly` `optional` **perNode?**: [`Budget`](../index.md#budget-4)

Default per-instance reservation for nodes that declare no `budget` of their own.
 Required when any such node exists — the engine invents no split.

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](../runtime.md#spawnjournal)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](../runtime.md#resultblobstore)

##### prompts?

> `readonly` `optional` **prompts?**: [`PromptRegistry`](../runtime.md#promptregistry)

Resolves `delegates`/`analyzes` directives; required when any edge carries one.

##### finalizer?

> `readonly` `optional` **finalizer?**: [`SupervisorFinalizer`](../index.md#supervisorfinalizer) \| `"bestDelivered"` \| `"collectDelivered"`

How terminal settles reduce to `out`. Default `bestDelivered`.

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

##### runId?

> `readonly` `optional` **runId?**: `string`

## Type Aliases

### ConditionOp

> **ConditionOp** = *typeof* [`CONDITION_OPS`](#condition_ops)\[`number`\]

***

### Condition

> **Condition** = [`ConditionLeaf`](#conditionleaf) \| \{ `all`: `ReadonlyArray`\<[`Condition`](#condition)\>; \} \| \{ `any`: `ReadonlyArray`\<[`Condition`](#condition)\>; \} \| \{ `not`: [`Condition`](#condition); \}

***

### JoinRule

> **JoinRule** = *typeof* [`JOIN_RULES`](#join_rules)\[`number`\]

***

### GraphEdgeKind

> **GraphEdgeKind** = `"delegates"` \| `"analyzes"` \| `"data"`

***

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

***

### Projection

> **Projection** = \{ `path`: `string`; \} \| \{ `pick`: `ReadonlyArray`\<`string`\>; \} \| \{ `map`: `string`; \} \| \{ `filter`: [`Condition`](#condition); \} \| \{ `first`: `true`; \} \| \{ `last`: `true`; \} \| \{ `count`: `true`; \}

***

### GraphRunReason

> **GraphRunReason** = `"all-children-down"` \| `"budget-exhausted"` \| `"aborted"` \| `"driver-failed"` \| `"cycle-budget-exceeded"` \| `"unreachable-terminal"`

***

### GraphRunResult

> **GraphRunResult** = \{ `kind`: `"winner"`; `out`: `unknown`; `terminals`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `settles`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `ledger`: `ReadonlyArray`\<[`GraphEdgeTraversal`](#graphedgetraversal)\>; \} \| \{ `kind`: `"no-winner"`; `reason`: [`GraphRunReason`](#graphrunreason); `error?`: \{ `name`: `string`; `message`: `string`; \}; `terminals`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `settles`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `ledger`: `ReadonlyArray`\<[`GraphEdgeTraversal`](#graphedgetraversal)\>; `unreachable`: `ReadonlyArray`\<`string`\>; \}

#### Union Members

##### Type Literal

\{ `kind`: `"winner"`; `out`: `unknown`; `terminals`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `settles`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `ledger`: `ReadonlyArray`\<[`GraphEdgeTraversal`](#graphedgetraversal)\>; \}

***

##### Type Literal

\{ `kind`: `"no-winner"`; `reason`: [`GraphRunReason`](#graphrunreason); `error?`: \{ `name`: `string`; `message`: `string`; \}; `terminals`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `settles`: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>; `ledger`: `ReadonlyArray`\<[`GraphEdgeTraversal`](#graphedgetraversal)\>; `unreachable`: `ReadonlyArray`\<`string`\>; \}

###### kind

> `readonly` **kind**: `"no-winner"`

###### reason

> `readonly` **reason**: [`GraphRunReason`](#graphrunreason)

###### error?

> `readonly` `optional` **error?**: `object`

###### error.name

> `readonly` **name**: `string`

###### error.message

> `readonly` **message**: `string`

###### terminals

> `readonly` **terminals**: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>

###### settles

> `readonly` **settles**: `ReadonlyArray`\<[`GraphNodeSettle`](#graphnodesettle)\>

###### ledger

> `readonly` **ledger**: `ReadonlyArray`\<[`GraphEdgeTraversal`](#graphedgetraversal)\>

###### unreachable

> `readonly` **unreachable**: `ReadonlyArray`\<`string`\>

Nodes provably stuck when the run ended: every upstream settled, no release possible.

## Variables

### CONDITION\_OPS

> `const` **CONDITION\_OPS**: readonly \[`"eq"`, `"neq"`, `"gt"`, `"gte"`, `"lt"`, `"lte"`, `"in"`, `"contains"`, `"exists"`, `"truthy"`\]

The leaf comparison operators; `exists`/`truthy` are unary, the rest compare against `value`.

***

### JOIN\_RULES

> `const` **JOIN\_RULES**: readonly \[`"all"`, `"any"`, `"any_failed"`, `"all_done"`\]

Which gating-edge outcomes release a node (adopted from ADC, agent-runtime#968).

***

### DEFAULT\_MAX\_NODE\_VISITS

> `const` **DEFAULT\_MAX\_NODE\_VISITS**: `25` = `25`

ADC-compatible visit backstop: nothing may be ENTERED more than this many times.

***

### MAX\_MAX\_NODE\_VISITS

> `const` **MAX\_MAX\_NODE\_VISITS**: `100` = `100`

The hard ceiling an author's `maxVisits`/`maxNodeVisits` override may reach.

## Functions

### schemaAccepts()

> **schemaAccepts**(`source`, `target`, `depth?`): `boolean`

Bounded structural acceptance: does a value of `source`'s shape fit `target`? Schemas with no
`type` accept anything; object targets require their `required` properties to be present and
accepted when the source declares properties. Depth-bounded — this is a compile-time tripwire,
not a full JSON Schema validator.

#### Parameters

##### source

[`JsonSchema`](#jsonschema)

##### target

[`JsonSchema`](#jsonschema)

##### depth?

`number` = `0`

#### Returns

`boolean`

***

### compileGraph()

> **compileGraph**(`engine`, `spec`, `context?`): [`CompiledGraph`](#compiledgraph)

Lower an authored graph against an engine's kind registry into the schedulable form, refusing
every structural defect before any spend.

#### Parameters

##### engine

[`GraphEngine`](#graphengine)

##### spec

[`EngineGraphSpec`](#enginegraphspec)

##### context?

`string` = `'compileGraph'`

#### Returns

[`CompiledGraph`](#compiledgraph)

***

### validateCondition()

> **validateCondition**(`raw`, `context`): [`Condition`](#condition)

Validate shape, bounds, and per-leaf path/operator rules; returns the input for chaining.

#### Parameters

##### raw

`unknown`

##### context

`string`

#### Returns

[`Condition`](#condition)

***

### evaluateCondition()

> **evaluateCondition**(`condition`, `context`): `boolean`

Walk a validated condition over a context to a boolean. Never throws on data shape.

#### Parameters

##### condition

[`Condition`](#condition)

##### context

`unknown`

#### Returns

`boolean`

***

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

### validateProjection()

> **validateProjection**(`raw`, `context`): [`Projection`](#projection-1)

Validate a projection: exactly one known operator, its argument well-formed.

#### Parameters

##### raw

`unknown`

##### context

`string`

#### Returns

[`Projection`](#projection-1)

***

### applyProjection()

> **applyProjection**(`value`, `projection`, `context`): `unknown`

Apply a validated projection to an admitted payload. Collection operators over a non-array
refuse by name — a shape the author did not expect is a graph defect, not an empty result.

#### Parameters

##### value

`unknown`

##### projection

[`Projection`](#projection-1)

##### context

`string`

#### Returns

`unknown`

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

***

### admitPayload()

> **admitPayload**(`value`): `unknown`

Admission for every value crossing an edge (#971): JSON round-trip, `undefined` stripped, a
 non-representable value becomes a RECORD of that fact — a degraded record beats a vanished
 edge.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### runEngineGraph()

> **runEngineGraph**(`engine`, `spec`, `task`, `options`): `Promise`\<[`GraphRunResult`](#graphrunresult)\>

Run a graph: host every node instance on one kernel `Scope`, resolve joins over guarded edges,
enforce the traversal and visit caps, and reduce the terminal settlements through the finalizer.

#### Parameters

##### engine

[`GraphEngine`](#graphengine)

##### spec

[`CompiledGraph`](#compiledgraph) \| [`EngineGraphSpec`](#enginegraphspec)

##### task

`string`

##### options

[`GraphRunOptions`](#graphrunoptions)

#### Returns

`Promise`\<[`GraphRunResult`](#graphrunresult)\>
