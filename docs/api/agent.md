[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Interfaces

### AgentRunContext

Defined in: src/agent/environment-act.ts:40

Provider-backed evaluation and repository-improvement utilities.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Defined in: src/agent/environment-act.ts:41

##### runId

> **runId**: `string`

Defined in: src/agent/environment-act.ts:42

##### variantId?

> `optional` **variantId?**: `string`

Defined in: src/agent/environment-act.ts:43

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: src/agent/environment-act.ts:44

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/agent/environment-act.ts:45

***

### AgentRunInvocation

Defined in: src/agent/environment-act.ts:48

Provider-backed evaluation and repository-improvement utilities.

#### Type Parameters

##### Output

`Output`

#### Properties

##### events

> **events**: `AsyncIterable`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

Defined in: src/agent/environment-act.ts:49

##### output

> **output**: `Promise`\<`Output`\>

Defined in: src/agent/environment-act.ts:50

***

### EnvironmentActComposeOverrides

Defined in: src/agent/environment-act.ts:64

Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: src/agent/environment-act.ts:66

Replace the base profile's system prompt (e.g. a workspace-augmented prompt).

##### extraFiles?

> `optional` **extraFiles?**: `AgentProfileFileMount`[]

Defined in: src/agent/environment-act.ts:68

Extra file mounts layered after the base profile's `resources.files`.

##### name?

> `optional` **name?**: `string`

Defined in: src/agent/environment-act.ts:70

Override the profile `name`. Defaults to the base profile's name.

##### tools?

> `optional` **tools?**: `Record`\<`string`, `boolean`\>

Defined in: src/agent/environment-act.ts:72

Provider built-in tool flags merged over the base profile's `tools` (overlay wins per key).

##### mcpConnections?

> `optional` **mcpConnections?**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: src/agent/environment-act.ts:74

MCP connections merged over the base profile's `mcp` (overlay wins per key).

***

### CreateEnvironmentActOptions

Defined in: src/agent/environment-act.ts:77

Provider-backed evaluation and repository-improvement utilities.

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### baseProfile

> **baseProfile**: `AgentProfile`

Defined in: src/agent/environment-act.ts:79

Canonical agent profile — the same one the prod chat turn uses.

##### environmentProvider

> **environmentProvider**: `AgentEnvironmentProvider`

Defined in: src/agent/environment-act.ts:81

Provider used to create one isolated environment per invocation.

##### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Defined in: src/agent/environment-act.ts:83

Persona → prompt. Pure; the eval cell's input.

###### Parameters

###### persona

`TPersona`

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<`TRunOutput`\>

Defined in: src/agent/environment-act.ts:85

Raw environment event stream → typed output the rubric scores.

##### compose?

> `optional` **compose?**: (`persona`) => [`EnvironmentActComposeOverrides`](#environmentactcomposeoverrides)

Defined in: src/agent/environment-act.ts:90

Per-persona profile overrides (workspace-augmented system prompt, extra
file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.

###### Parameters

###### persona

`TPersona`

###### Returns

[`EnvironmentActComposeOverrides`](#environmentactcomposeoverrides)

##### environment?

> `optional` **environment?**: `Omit`\<`CreateAgentEnvironmentInput`, `"profile"` \| `"signal"`\>

Defined in: src/agent/environment-act.ts:92

Provider-neutral fields forwarded to environment creation.

##### streaming?

> `optional` **streaming?**: `"sse"` \| `"poll"`

Defined in: src/agent/environment-act.ts:94

Live streaming by default; polling requires provider detach support.

##### requiredProfileAxes?

> `optional` **requiredProfileAxes?**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/environment-act.ts:96

Optional changed axes the caller expects this path to carry.

##### name?

> `optional` **name?**: `string`

Defined in: src/agent/environment-act.ts:98

Stable run name surfaced in mapped `llm_call` events.

##### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: src/agent/environment-act.ts:100

Override the environment-event → runtime-event mapper.

###### Parameters

###### event

`AgentEnvironmentEvent`

###### opts

###### agentRunName?

`string`

###### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

***

### SurfaceImprovementEdit

Defined in: src/agent/improvement-adapter.ts:35

#### Properties

##### id

> **id**: `string`

Defined in: src/agent/improvement-adapter.ts:37

Stable id derived from the source finding so re-proposals are idempotent.

##### sourceFindingId

> **sourceFindingId**: `string`

Defined in: src/agent/improvement-adapter.ts:39

The finding that produced this edit — for revert + audit trail.

##### subject

> **subject**: `FindingSubject`

Defined in: src/agent/improvement-adapter.ts:41

Parsed subject; included so the apply step doesn't re-parse.

##### target

> **target**: [`ResolvedImprovementPath`](#resolvedimprovementpath)

Defined in: src/agent/improvement-adapter.ts:43

Resolved on-disk target.

##### baseSha256

> **baseSha256**: `string`

Defined in: src/agent/improvement-adapter.ts:45

SHA-256 of the current file content the patch was drafted against.

##### patch

> **patch**: `string`

Defined in: src/agent/improvement-adapter.ts:47

Unified-diff patch the LLM drafted (relative to `target.absolutePath`).

##### summary

> **summary**: `string`

Defined in: src/agent/improvement-adapter.ts:49

One-line summary the operator sees in the report / PR title.

##### rationale

> **rationale**: `string`

Defined in: src/agent/improvement-adapter.ts:51

Multi-line rationale for the PR body — finding context + LLM reasoning.

##### confidence

> **confidence**: `number`

Defined in: src/agent/improvement-adapter.ts:53

Carry-forward from the finding so the apply gate can check the threshold.

##### severity

> **severity**: `AnalystSeverity`

Defined in: src/agent/improvement-adapter.ts:55

Carry-forward severity for prioritization.

***

### CreateSurfaceImprovementProposerOptions

Defined in: src/agent/improvement-adapter.ts:58

#### Properties

##### paths

> **paths**: [`AgentImprovementPaths`](#agentimprovementpaths)

Defined in: src/agent/improvement-adapter.ts:59

##### repoRoot

> **repoRoot**: `string`

Defined in: src/agent/improvement-adapter.ts:60

##### draftPatch

> **draftPatch**: (`input`) => `Promise`\<[`DraftPatchOutput`](#draftpatchoutput)\>

Defined in: src/agent/improvement-adapter.ts:69

LLM-draft callback. Given a finding + current file content + the
resolved target, returns a unified-diff patch + summary + rationale.

Required — the substrate doesn't ship a hardcoded prompt; the agent
author picks the model (Haiku for cheap routine drafts, Sonnet for
substantive prompt rewrites, etc.) via this callback.

###### Parameters

###### input

[`DraftPatchInput`](#draftpatchinput)

###### Returns

`Promise`\<[`DraftPatchOutput`](#draftpatchoutput)\>

##### allowCreateForKinds?

> `optional` **allowCreateForKinds?**: readonly (`"code"` \| `"mcp"` \| `"memory"` \| `"agent-profile"` \| `"rollout-policy"` \| `"knowledge.wiki"` \| `"knowledge.claim"` \| `"knowledge.raw"` \| `"knowledge.stale"` \| `"system-prompt"` \| `"skill"` \| `"tool-doc"` \| `"new-tool"` \| `"hook"` \| `"subagent"` \| `"workflow"` \| `"rag"` \| `"scaffolding"` \| `"output-schema"` \| `"websearch.outdated"` \| `"prior-run-summary"` \| `"cluster"`)[]

Defined in: src/agent/improvement-adapter.ts:77

When the resolved target doesn't exist, allow the substrate to
CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
true for those kinds, false for `system-prompt` / `rubric` / etc.
(named sections that don't exist are a contract violation, not a
scaffolding opportunity).

***

### DraftPatchInput

Defined in: src/agent/improvement-adapter.ts:80

#### Properties

##### finding

> **finding**: `AnalystFinding`

Defined in: src/agent/improvement-adapter.ts:81

##### subject

> **subject**: `FindingSubject`

Defined in: src/agent/improvement-adapter.ts:82

##### target

> **target**: [`ResolvedImprovementPath`](#resolvedimprovementpath)

Defined in: src/agent/improvement-adapter.ts:83

##### currentContent

> **currentContent**: `string`

Defined in: src/agent/improvement-adapter.ts:85

Current file content (empty string when `intent === 'create-new'`).

***

### DraftPatchOutput

Defined in: src/agent/improvement-adapter.ts:88

#### Properties

##### patch

> **patch**: `string`

Defined in: src/agent/improvement-adapter.ts:90

Unified diff against the current file content. Empty string skips this finding.

##### summary

> **summary**: `string`

Defined in: src/agent/improvement-adapter.ts:92

One-line summary for the operator.

##### rationale

> **rationale**: `string`

Defined in: src/agent/improvement-adapter.ts:94

Multi-line rationale for the PR body.

***

### AgentImprovementPaths

Defined in: src/agent/improvement-paths.ts:12

Repository paths an improvement job may edit.

Paths are resolved against `repoRoot` unless absolute. Every field is
optional. Applications declare only paths they own, and findings aimed at
undeclared paths are rejected.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: src/agent/improvement-paths.ts:14

Directory containing one markdown file per system-prompt section.

##### tools?

> `optional` **tools?**: `string`

Defined in: src/agent/improvement-paths.ts:16

Directory containing one subdirectory per tool.

##### knowledge?

> `optional` **knowledge?**: `string`

Defined in: src/agent/improvement-paths.ts:18

Knowledge-base root, typically `.agent-knowledge`.

##### scaffolding?

> `optional` **scaffolding?**: `string`

Defined in: src/agent/improvement-paths.ts:20

Directory containing precondition, retry, and control policies.

##### memory?

> `optional` **memory?**: `string`

Defined in: src/agent/improvement-paths.ts:22

Directory containing mutable memory records.

##### rag?

> `optional` **rag?**: `string`

Defined in: src/agent/improvement-paths.ts:24

Directory containing retrieval corpora.

##### outputSchema?

> `optional` **outputSchema?**: `string`

Defined in: src/agent/improvement-paths.ts:26

Single file defining the output schema.

##### skills?

> `optional` **skills?**: `string`

Defined in: src/agent/improvement-paths.ts:28

Directory containing Agent Skill packages.

##### mcp?

> `optional` **mcp?**: `string`

Defined in: src/agent/improvement-paths.ts:30

Directory containing MCP server and tool configuration.

##### hooks?

> `optional` **hooks?**: `string`

Defined in: src/agent/improvement-paths.ts:32

Directory containing hook definitions.

##### subagents?

> `optional` **subagents?**: `string`

Defined in: src/agent/improvement-paths.ts:34

Directory containing subagent definitions.

##### workflows?

> `optional` **workflows?**: `string`

Defined in: src/agent/improvement-paths.ts:36

Directory containing orchestration policies.

##### rolloutPolicy?

> `optional` **rolloutPolicy?**: `string`

Defined in: src/agent/improvement-paths.ts:38

Single file containing rollout-policy settings.

##### agentProfile?

> `optional` **agentProfile?**: `string`

Defined in: src/agent/improvement-paths.ts:40

Single canonical AgentProfile file.

##### code?

> `optional` **code?**: `string`

Defined in: src/agent/improvement-paths.ts:42

Source root for code findings.

***

### ResolvedImprovementPath

Defined in: src/agent/improvement-paths.ts:45

#### Properties

##### absolutePath

> **absolutePath**: `string`

Defined in: src/agent/improvement-paths.ts:47

Absolute filesystem path.

##### declaredPath

> **declaredPath**: `string`

Defined in: src/agent/improvement-paths.ts:49

Path produced from the declared root and finding subject.

##### exists

> **exists**: `boolean`

Defined in: src/agent/improvement-paths.ts:51

Whether the path currently exists.

##### intent

> **intent**: `"edit-existing"` \| `"create-new"`

Defined in: src/agent/improvement-paths.ts:53

Whether the caller should edit an existing file or create a new one.

***

### ImprovementPathIssue

Defined in: src/agent/improvement-paths.ts:215

#### Properties

##### pathKind

> **pathKind**: keyof [`AgentImprovementPaths`](#agentimprovementpaths)

Defined in: src/agent/improvement-paths.ts:216

##### path

> **path**: `string`

Defined in: src/agent/improvement-paths.ts:217

##### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

Defined in: src/agent/improvement-paths.ts:218

***

### ProfileMaterializationContract

Defined in: src/agent/profile-materialization.ts:40

Declares which AgentProfile axes a concrete run path really carries.

#### Properties

##### name

> **name**: `string`

Defined in: src/agent/profile-materialization.ts:42

Human-readable run path, e.g. `createEnvironmentAct` or `prompt-only-message`.

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/profile-materialization.ts:44

Profile axes this run path actually carries into execution.

***

### ProfileMaterializationIssue

Defined in: src/agent/profile-materialization.ts:48

One changed AgentProfile axis that would be dropped by a run path.

#### Properties

##### contract

> **contract**: `string`

Defined in: src/agent/profile-materialization.ts:49

##### axis

> **axis**: [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)

Defined in: src/agent/profile-materialization.ts:50

##### reason

> **reason**: `"unsupported-axis"`

Defined in: src/agent/profile-materialization.ts:51

##### supportedAxes

> **supportedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/profile-materialization.ts:52

***

### DefineProfileMaterializationContractOptions

Defined in: src/agent/profile-materialization.ts:56

Input for declaring a run path's profile-axis support.

#### Properties

##### name

> **name**: `string`

Defined in: src/agent/profile-materialization.ts:57

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/profile-materialization.ts:58

***

### ValidateProfileMaterializationOptions

Defined in: src/agent/profile-materialization.ts:62

Input for checking a candidate diff against a run path.

#### Extended by

- [`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:63

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/profile-materialization.ts:64

***

### AssertProfileMaterializationOptions

Defined in: src/agent/profile-materialization.ts:68

Input for throwing on dropped profile axes.

#### Extends

- [`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:63

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`contract`](#contract-1)

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/profile-materialization.ts:64

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`changedAxes`](#changedaxes)

##### context?

> `optional` **context?**: `string`

Defined in: src/agent/profile-materialization.ts:70

Extra label included in the thrown error, usually the caller or run id.

## Type Aliases

### KnownAgentProfileMaterializationAxis

> **KnownAgentProfileMaterializationAxis** = *typeof* [`AGENT_PROFILE_MATERIALIZATION_AXES`](#agent_profile_materialization_axes)\[`number`\]

Defined in: src/agent/profile-materialization.ts:31

***

### AgentProfileMaterializationAxis

> **AgentProfileMaterializationAxis** = [`KnownAgentProfileMaterializationAxis`](#knownagentprofilematerializationaxis) \| `` `custom:${string}` ``

Defined in: src/agent/profile-materialization.ts:35

AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions.

## Variables

### environmentActProfileMaterialization

> `const` **environmentActProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/environment-act.ts:35

Profile fields consumed by `createEnvironmentAct`.

***

### AGENT\_PROFILE\_MATERIALIZATION\_AXES

> `const` **AGENT\_PROFILE\_MATERIALIZATION\_AXES**: readonly \[`"identity"`, `"name"`, `"model"`, `"prompt"`, `"systemPrompt"`, `"instructions"`, `"resources"`, `"files"`, `"resourceInstructions"`, `"skills"`, `"resourceTools"`, `"resourceAgents"`, `"commands"`, `"tools"`, `"permissions"`, `"mcp"`, `"mcpConnections"`, `"connections"`, `"subagents"`, `"hooks"`, `"modes"`, `"confidential"`, `"metadata"`, `"extensions"`\]

Defined in: src/agent/profile-materialization.ts:4

Known AgentProfile axes a run path may or may not carry into execution.

***

### promptOnlyProfileMaterialization

> `const` **promptOnlyProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:91

Materialization contract for a run path that only injects prompt text.

***

### promptResourceProfileMaterialization

> `const` **promptResourceProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:97

Materialization contract for a run path that injects prompt text plus inline resources.

## Functions

### collectAgentRun()

> **collectAgentRun**\<`Output`\>(`invocation`): `Promise`\<\{ `events`: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]; `output`: `Output`; \}\>

Defined in: src/agent/environment-act.ts:54

Collect a streamed agent run and its final output.

#### Type Parameters

##### Output

`Output`

#### Parameters

##### invocation

[`AgentRunInvocation`](#agentruninvocation)\<`Output`\>

#### Returns

`Promise`\<\{ `events`: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]; `output`: `Output`; \}\>

***

### createEnvironmentAct()

> **createEnvironmentAct**\<`TPersona`, `TRunOutput`\>(`options`): (`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Defined in: src/agent/environment-act.ts:112

Build an evaluation callback backed by one production-profile environment
run. The returned function returns
synchronously with a live `events` iterator and an `output` promise that
resolves only after the iterator drains.

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Parameters

##### options

[`CreateEnvironmentActOptions`](#createenvironmentactoptions)\<`TPersona`, `TRunOutput`\>

#### Returns

(`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

***

### createSurfaceImprovementProposer()

> **createSurfaceImprovementProposer**(`opts`): [`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

Defined in: src/agent/improvement-adapter.ts:107

Resolve each finding to a real surface and draft a detached patch candidate.

#### Parameters

##### opts

[`CreateSurfaceImprovementProposerOptions`](#createsurfaceimprovementproposeroptions)

#### Returns

[`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### resolveSubjectPath()

> **resolveSubjectPath**(`subject`, `paths`, `repoRoot`): [`ResolvedImprovementPath`](#resolvedimprovementpath) \| `null`

Defined in: src/agent/improvement-paths.ts:57

Resolve a parsed finding subject to one declared repository path.

#### Parameters

##### subject

`FindingSubject`

##### paths

[`AgentImprovementPaths`](#agentimprovementpaths)

##### repoRoot

`string`

#### Returns

[`ResolvedImprovementPath`](#resolvedimprovementpath) \| `null`

***

### validateImprovementPaths()

> **validateImprovementPaths**(`paths`, `repoRoot`): readonly [`ImprovementPathIssue`](#improvementpathissue)[]

Defined in: src/agent/improvement-paths.ts:243

Validate every path the application explicitly declared.

#### Parameters

##### paths

[`AgentImprovementPaths`](#agentimprovementpaths)

##### repoRoot

`string`

#### Returns

readonly [`ImprovementPathIssue`](#improvementpathissue)[]

***

### renderImprovementPathIssues()

> **renderImprovementPathIssues**(`issues`, `repoRoot`): `string`

Defined in: src/agent/improvement-paths.ts:269

Format improvement-path errors for logs and command output.

#### Parameters

##### issues

readonly [`ImprovementPathIssue`](#improvementpathissue)[]

##### repoRoot

`string`

#### Returns

`string`

***

### defineProfileMaterializationContract()

> **defineProfileMaterializationContract**(`options`): [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:103

Define the profile axes a concrete run path actually carries into execution.

#### Parameters

##### options

[`DefineProfileMaterializationContractOptions`](#defineprofilematerializationcontractoptions)

#### Returns

[`ProfileMaterializationContract`](#profilematerializationcontract)

***

### validateProfileMaterialization()

> **validateProfileMaterialization**(`options`): readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

Defined in: src/agent/profile-materialization.ts:117

Return every changed profile axis that the selected run path would drop.

#### Parameters

##### options

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Returns

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

***

### assertProfileMaterialization()

> **assertProfileMaterialization**(`options`): `void`

Defined in: src/agent/profile-materialization.ts:138

Throw when a candidate changes axes the selected run path cannot carry.

#### Parameters

##### options

[`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Returns

`void`

***

### renderProfileMaterializationIssues()

> **renderProfileMaterializationIssues**(`issues`, `context?`): `string`

Defined in: src/agent/profile-materialization.ts:145

Format profile-axis drop issues into a concise operator-facing error.

#### Parameters

##### issues

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

##### context?

`string`

#### Returns

`string`
