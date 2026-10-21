[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / placement

# placement

## Classes

### PlacementRefusedError

No tier can meet every declared requirement. Raised before any spend.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new PlacementRefusedError**(`reason`): [`PlacementRefusedError`](#placementrefusederror)

###### Parameters

###### reason

`string`

###### Returns

[`PlacementRefusedError`](#placementrefusederror)

###### Overrides

`Error.constructor`

#### Properties

##### reason

> `readonly` **reason**: `string`

## Interfaces

### PlacementRecord

What was chosen, under which policy, why, and why each other tier was refused.

#### Properties

##### chosen

> **chosen**: [`ExecutionTier`](#executiontier)

##### policy

> **policy**: `"agent-placement/3"`

##### reason

> **reason**: `string`

##### coveredAxes

> **coveredAxes**: [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

The profile's declared materialization axes the chosen tier carries. A tier that
cannot carry a declared axis is rejected, so on a fresh decision this is every
declared axis; an authored or resumed record makes no coverage decision and is empty.

##### rejected

> **rejected**: `object`[]

###### placement

> **placement**: [`ExecutionTier`](#executiontier)

###### reason

> **reason**: `string`

***

### PlacementRequirements

The declared requirements of the work, beside its profile. Field names follow
Platform's `agent.run` action, the first consumer; an app's chat turn usually
declares none of them.

#### Properties

##### harness?

> `optional` **harness?**: `string`

A pinned harness. Always runs in the sandbox.

##### model?

> `optional` **model?**: `string`

A model other than the profile's own needs the sandbox to choose between them.

##### source?

> `optional` **source?**: `unknown`

##### skills?

> `optional` **skills?**: `unknown`

Skill ids resolved into a box. Profile skills are `profile.resources.skills`.

##### env?

> `optional` **env?**: `unknown`

##### image?

> `optional` **image?**: `unknown`

##### size?

> `optional` **size?**: `unknown`

##### resources?

> `optional` **resources?**: `unknown`

##### fromSnapshot?

> `optional` **fromSnapshot?**: `unknown`

##### fromSandboxId?

> `optional` **fromSandboxId?**: `unknown`

##### resume?

> `optional` **resume?**: `unknown`

##### maxRounds?

> `optional` **maxRounds?**: `number`

##### ask?

> `optional` **ask?**: `boolean`

##### connections?

> `optional` **connections?**: readonly `string`[]

Hub connections: tools the loop holds.

##### objects?

> `optional` **objects?**: `unknown`

Owner-object grants: tools only the loop holds.

##### http?

> `optional` **http?**: `unknown`

Public HTTPS reads: a tool only the loop holds.

##### tools?

> `optional` **tools?**: readonly `string`[]

Tools the caller binds into the loop itself, such as an app's product tools.

***

### PlacementContext

Which tiers this deployment has wired.

#### Properties

##### interactive

> **interactive**: `boolean`

##### inferenceAvailable

> **inferenceAvailable**: `boolean`

##### loopAvailable

> **loopAvailable**: `boolean`

##### loopUnavailableReason?

> `optional` **loopUnavailableReason?**: `string`

Why the loop cannot take this work, when it cannot.

***

### PlaceExecutionInput

#### Properties

##### requirements?

> `optional` **requirements?**: [`PlacementRequirements`](#placementrequirements)

##### profile?

> `optional` **profile?**: `object` \| `AgentProfile`

The RESOLVED profile: a named profile is read before the decision.

##### context

> **context**: [`PlacementContext`](#placementcontext)

##### vacuousAxes?

> `optional` **vacuousAxes?**: readonly `"permissions"`[]

Axes whose deny-only value counts as covered on `inference` and `loop`.
`permissions` qualifies when every rule is `deny`: a tier without native tools
already denies them. Deny-only `tools` are covered without opting in.

##### inlineSkills?

> `optional` **inlineSkills?**: `boolean`

The caller inlines the profile's skill content into the loop's context, so
`resources.skills` (with a strict `resources.failOnError`) and the native `skill`
tool and permission that load them count as covered on `loop`. Off by default:
the skills then keep the work in the sandbox.

## Type Aliases

### KnownAgentProfileMaterializationAxis

> **KnownAgentProfileMaterializationAxis** = `CanonicalAgentProfileMaterializationAxis`

***

### AgentProfileMaterializationAxis

> **AgentProfileMaterializationAxis** = [`KnownAgentProfileMaterializationAxis`](#knownagentprofilematerializationaxis) \| `` `custom:${string}` ``

AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions.

***

### ExecutionTier

> **ExecutionTier** = `"inference"` \| `"loop"` \| `"sandbox"`

Where one unit of agent work runs, cheapest first.

***

### VacuousAxis

> **VacuousAxis** = `"permissions"`

Profile axes a tier may count as covered when their declared value grants nothing.

## Variables

### PLACEMENT\_POLICY

> `const` **PLACEMENT\_POLICY**: `"agent-placement/3"` = `'agent-placement/3'`

The policy version every [PlacementRecord](#placementrecord) carries.

***

### loopTierProfileMaterialization

> `const` **loopTierProfileMaterialization**: [`ProfileMaterializationContract`](agent.md#profilematerializationcontract)

The profile axes `inference` and `loop` carry: identity, prompt, model controls and
metadata. No harness, native tools, files, MCP, subagents, hooks or modes.

## Functions

### placeExecution()

> **placeExecution**(`input`): [`PlacementRecord`](#placementrecord)

Choose where work runs: the cheapest tier every declared requirement allows.
Throws [PlacementRefusedError](#placementrefusederror) when no tier can meet every requirement.

#### Parameters

##### input

[`PlaceExecutionInput`](#placeexecutioninput)

#### Returns

[`PlacementRecord`](#placementrecord)
