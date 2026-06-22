[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / lifecycle

# lifecycle

## Classes

### ArtifactRegistry

Defined in: [lifecycle/registry.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L30)

A typed, in-memory registry of `ProfileArtifact`s with stable ids.

Ids are stable for the life of the registry: `register` assigns one (or honors
a caller-supplied id idempotently), and no later operation reassigns it.
Re-registering the same id REPLACES the artifact's mutable fields but preserves
the id, so a re-proposed candidate keeps its identity across generations.

#### Constructors

##### Constructor

> **new ArtifactRegistry**(): [`ArtifactRegistry`](#artifactregistry)

###### Returns

[`ArtifactRegistry`](#artifactregistry)

#### Accessors

##### size

###### Get Signature

> **get** **size**(): `number`

Defined in: [lifecycle/registry.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L124)

Number of registered artifacts (any status).

###### Returns

`number`

#### Methods

##### register()

> **register**\<`K`\>(`input`): [`ProfileArtifact`](#profileartifact)\<`K`\>

Defined in: [lifecycle/registry.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L40)

Register an artifact, returning the stored record (with its assigned id).
When `input.id` is set it is honored (idempotent re-registration replaces
the record under the same id); otherwise a stable id is minted as
`<kind>-<n>`. `status` defaults to `'candidate'`.

###### Type Parameters

###### K

`K` *extends* [`ArtifactKind`](#artifactkind)

###### Parameters

###### input

[`ArtifactInput`](#artifactinput)\<`K`\>

###### Returns

[`ProfileArtifact`](#profileartifact)\<`K`\>

##### get()

> **get**(`id`): [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\> \| `undefined`

Defined in: [lifecycle/registry.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L62)

Get an artifact by id, or `undefined` if it was never registered.

###### Parameters

###### id

`string`

###### Returns

[`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\> \| `undefined`

##### list()

> **list**(`query?`): [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

Defined in: [lifecycle/registry.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L70)

List artifacts, optionally filtered by `kind` and/or `status`. Returns a new
array in registration order; callers may safely sort/mutate the result.

###### Parameters

###### query?

[`ArtifactQuery`](#artifactquery) = `{}`

###### Returns

[`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

##### promote()

> **promote**(`id`): [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/registry.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L86)

Mark an artifact `promoted`. Fails loud on an unknown id — promoting a
non-existent artifact is a caller bug, not a no-op. Returns the updated
record. Idempotent: promoting an already-promoted artifact is a no-op
return.

###### Parameters

###### id

`string`

###### Returns

[`ProfileArtifact`](#profileartifact)

##### compose()

> **compose**(`base`, `ids?`): `AgentProfile`

Defined in: [lifecycle/registry.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L107)

Compose a set of registered artifacts onto a baseline profile. With no ids
given, composes every `promoted` artifact (the "ship the passing set"
default). With explicit ids, composes exactly those (in id order given),
failing loud on any unknown id. The applied order is the order passed (or
registration order for the promoted-default), and later artifacts win on key
conflicts — same semantics as `applyArtifacts`.

###### Parameters

###### base

`AgentProfile`

###### ids?

readonly `string`[]

###### Returns

`AgentProfile`

## Interfaces

### EvalResult

Defined in: [lifecycle/marginal-lift.ts:28](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L28)

The result of running an eval over ONE profile: a composite score and the cost
to obtain it. This mirrors the project's score/cost convention (`composite`
from `OutcomeMeasurement`, `costUsd` from `LoopResult`), so a caller can pass a
thin wrapper over `runLoop` / `runBenchmark` / `runAgentEval` directly.

#### Properties

##### composite

> **composite**: `number`

Defined in: [lifecycle/marginal-lift.ts:30](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L30)

Composite score in `[0, 1]` (higher is better) for the profile under test.

##### costUsd

> **costUsd**: `number`

Defined in: [lifecycle/marginal-lift.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L32)

USD cost to produce this result.

##### details?

> `optional` **details?**: `unknown`

Defined in: [lifecycle/marginal-lift.ts:34](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L34)

Optional opaque passthrough (per-task cells, the raw report, …).

***

### MeasureMarginalLiftOptions

Defined in: [lifecycle/marginal-lift.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L44)

#### Properties

##### baseline

> **baseline**: `AgentProfile`

Defined in: [lifecycle/marginal-lift.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L46)

The profile the artifact is measured ON TOP OF (the "without" arm).

##### candidate

> **candidate**: [`ProfileArtifact`](#profileartifact)

Defined in: [lifecycle/marginal-lift.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L48)

The single artifact whose marginal contribution we want.

##### evalRunner

> **evalRunner**: [`EvalRunner`](#evalrunner)

Defined in: [lifecycle/marginal-lift.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L50)

The eval that scores a profile. Run once per arm (twice total).

##### baselineResult?

> `optional` **baselineResult?**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L56)

A pre-computed baseline result, to skip the "without" run when the caller
already scored the baseline (e.g. measuring several candidates against the
same baseline). When set, the baseline arm is NOT re-run.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [lifecycle/marginal-lift.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L58)

Forwarded to both `evalRunner` invocations for cancellation.

***

### MarginalLift

Defined in: [lifecycle/marginal-lift.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L69)

The marginal lift of one artifact: the with/without ablation.

`scoreDelta = with.composite − without.composite`. A positive `scoreDelta` is
the evidence a gate needs to promote; a negative one is the signal to drop the
artifact. `costDelta` is the extra USD the artifact costs (often positive — a
new tool/MCP adds calls) and lets the gate weigh lift against spend.

#### Properties

##### artifactId

> **artifactId**: `string`

Defined in: [lifecycle/marginal-lift.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L71)

The artifact id this measurement is for (stable, from the registry).

##### withArtifact

> **withArtifact**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L73)

Eval of `applyArtifact(baseline, candidate)`.

##### withoutArtifact

> **withoutArtifact**: [`EvalResult`](#evalresult)

Defined in: [lifecycle/marginal-lift.ts:75](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L75)

Eval of `baseline` alone.

##### scoreDelta

> **scoreDelta**: `number`

Defined in: [lifecycle/marginal-lift.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L77)

`withArtifact.composite − withoutArtifact.composite`.

##### costDelta

> **costDelta**: `number`

Defined in: [lifecycle/marginal-lift.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L79)

`withArtifact.costUsd − withoutArtifact.costUsd`.

***

### ArtifactQuery

Defined in: [lifecycle/registry.ts:17](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L17)

Filter for `list`. Omit a field to leave that dimension unconstrained.

#### Properties

##### kind?

> `optional` **kind?**: [`ArtifactKind`](#artifactkind)

Defined in: [lifecycle/registry.ts:18](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L18)

##### status?

> `optional` **status?**: [`ArtifactStatus`](#artifactstatus)

Defined in: [lifecycle/registry.ts:19](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L19)

***

### ArtifactPayloads

Defined in: [lifecycle/types.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L46)

The payload for each `ArtifactKind`. The shapes are the SAME types the
`AgentProfile` field carries, so applying an artifact is a structural merge
onto the profile — never a bespoke per-kind transform.

  - `prompt`   — an instruction line appended to `profile.prompt.instructions`.
  - `skill`    — a `SKILL.md`-style resource ref added to `profile.resources.skills`.
  - `tool`     — a tool grant: `{ enabled }` set under `profile.tools[name]`.
  - `mcp`      — one MCP server added under `profile.mcp[name]`.
  - `hook`     — one or more hook commands added under `profile.hooks[event]`.
  - `subagent` — one subagent profile added under `profile.subagents[name]`.

#### Properties

##### prompt

> **prompt**: `object`

Defined in: [lifecycle/types.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L47)

###### instruction

> **instruction**: `string`

##### skill

> **skill**: `object`

Defined in: [lifecycle/types.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L48)

###### resource

> **resource**: `AgentProfileResourceRef`

##### tool

> **tool**: `object`

Defined in: [lifecycle/types.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L49)

###### enabled

> **enabled**: `boolean`

##### mcp

> **mcp**: `object`

Defined in: [lifecycle/types.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L50)

###### server

> **server**: `AgentProfileMcpServer`

##### hook

> **hook**: `object`

Defined in: [lifecycle/types.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L51)

###### event

> **event**: `string`

###### commands

> **commands**: `AgentProfileHookCommand`[]

##### subagent

> **subagent**: `object`

Defined in: [lifecycle/types.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L52)

###### profile

> **profile**: `AgentSubagentProfile`

***

### ProfileArtifact

Defined in: [lifecycle/types.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L64)

A discrete, individually-promotable piece of an agent profile.

`kind` selects the profile lever; `payload` is the kind-specific value; `key`
is the profile-field key the payload lands under (the tool name, the MCP server
name, the subagent name — unused for `prompt`, which appends). `id` is stable:
once registered, it never changes, so a marginal-lift measurement, a promotion
decision, and a ship record all reference the same artifact.

#### Type Parameters

##### K

`K` *extends* [`ArtifactKind`](#artifactkind) = [`ArtifactKind`](#artifactkind)

#### Properties

##### id

> **id**: `string`

Defined in: [lifecycle/types.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L66)

Stable id. Assigned by the registry at register time; never reassigned.

##### kind

> **kind**: `K`

Defined in: [lifecycle/types.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L67)

##### key?

> `optional` **key?**: `string`

Defined in: [lifecycle/types.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L74)

The profile-field key this artifact lands under (e.g. the tool name, the MCP
server name, the subagent name, the hook event). Optional for `prompt`
(instructions append, they have no key). Defaults to `id` when applying a
keyed artifact without an explicit key.

##### name

> **name**: `string`

Defined in: [lifecycle/types.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L76)

Human-facing label for review surfaces.

##### description?

> `optional` **description?**: `string`

Defined in: [lifecycle/types.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L78)

Optional one-line description of what this artifact does.

##### payload

> **payload**: [`ArtifactPayloads`](#artifactpayloads)\[`K`\]

Defined in: [lifecycle/types.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L79)

##### status

> **status**: [`ArtifactStatus`](#artifactstatus)

Defined in: [lifecycle/types.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L85)

Lifecycle status. Phase 1 tracks only `candidate` (registered, not yet
promoted) and `promoted` (passed whatever gate the caller ran). The
registry never auto-promotes; promotion is an explicit `promote(id)` call.

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: [lifecycle/types.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L87)

Free-form metadata (provenance, generation id, the measured lift, …).

## Type Aliases

### EvalRunner

> **EvalRunner** = (`profile`, `signal?`) => `Promise`\<[`EvalResult`](#evalresult)\>

Defined in: [lifecycle/marginal-lift.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L42)

Scores a profile. The caller wires this to whatever eval they run — a
`runLoop` rollout, a `runBenchmark` campaign, a `runAgentEval` cohort — and
returns the composite + cost. `signal` is forwarded for cancellation.

#### Parameters

##### profile

`AgentProfile`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`EvalResult`](#evalresult)\>

***

### ArtifactKind

> **ArtifactKind** = `"skill"` \| `"tool"` \| `"mcp"` \| `"hook"` \| `"subagent"` \| `"prompt"`

Defined in: [lifecycle/types.ts:32](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L32)

The profile levers an artifact can target. One-to-one with the §1.5 profile
surface (`prompt + skills + tools + mcp + hooks + subagents`). Each kind maps to
exactly one field of `AgentProfile`, so an artifact can be applied onto a
baseline profile deterministically (see `applyArtifact`).

***

### ArtifactStatus

> **ArtifactStatus** = `"candidate"` \| `"promoted"`

Defined in: [lifecycle/types.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L90)

***

### ArtifactInput

> **ArtifactInput**\<`K`\> = `Omit`\<[`ProfileArtifact`](#profileartifact)\<`K`\>, `"id"` \| `"status"`\> & `object`

Defined in: [lifecycle/types.ts:95](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/types.ts#L95)

The input to `register` — everything on `ProfileArtifact` except the
 registry-owned `id` and `status`. An explicit `id` may be supplied for
 deterministic/idempotent registration; otherwise the registry assigns one.

#### Type Declaration

##### id?

> `optional` **id?**: `string`

##### status?

> `optional` **status?**: [`ArtifactStatus`](#artifactstatus)

#### Type Parameters

##### K

`K` *extends* [`ArtifactKind`](#artifactkind) = [`ArtifactKind`](#artifactkind)

## Functions

### applyArtifact()

> **applyArtifact**(`base`, `artifact`): `AgentProfile`

Defined in: [lifecycle/apply.ts:22](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/apply.ts#L22)

Return a new profile with `artifact` merged onto `base`. Keyed kinds
(`tool`/`mcp`/`hook`/`subagent`) land under `artifact.key` (falling back to
`artifact.id`). `prompt` appends an instruction line; `skill` appends a
resource ref. Existing keys are overwritten by the artifact (the artifact is
the candidate being measured/promoted, so it wins on conflict).

#### Parameters

##### base

`AgentProfile`

##### artifact

[`ProfileArtifact`](#profileartifact)

#### Returns

`AgentProfile`

***

### applyArtifacts()

> **applyArtifacts**(`base`, `artifacts`): `AgentProfile`

Defined in: [lifecycle/apply.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/apply.ts#L61)

Apply many artifacts left-to-right; later artifacts win on key conflicts.

#### Parameters

##### base

`AgentProfile`

##### artifacts

readonly [`ProfileArtifact`](#profileartifact)\<[`ArtifactKind`](#artifactkind)\>[]

#### Returns

`AgentProfile`

***

### measureMarginalLift()

> **measureMarginalLift**(`opts`): `Promise`\<[`MarginalLift`](#marginallift)\>

Defined in: [lifecycle/marginal-lift.ts:99](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/marginal-lift.ts#L99)

Run the with/without ablation for `candidate` over `baseline` and return its
marginal score/cost contribution.

The "without" arm scores the baseline profile unchanged; the "with" arm scores
`applyArtifact(baseline, candidate)`. Both use the same `evalRunner`, so the
delta isolates the artifact's effect (eval method held constant). The baseline
arm is skipped when `baselineResult` is supplied.

#### Parameters

##### opts

[`MeasureMarginalLiftOptions`](#measuremarginalliftoptions)

#### Returns

`Promise`\<[`MarginalLift`](#marginallift)\>

#### Example

```ts
const lift = await measureMarginalLift({
    baseline,
    candidate: registry.get(id)!,
    evalRunner: (profile) => scoreProfileOnCohort(profile),
  })
  if (lift.scoreDelta > 0) registry.promote(lift.artifactId)
```

***

### createArtifactRegistry()

> **createArtifactRegistry**(): [`ArtifactRegistry`](#artifactregistry)

Defined in: [lifecycle/registry.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/lifecycle/registry.ts#L139)

Construct an empty `ArtifactRegistry`.

#### Returns

[`ArtifactRegistry`](#artifactregistry)
