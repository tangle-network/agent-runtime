[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Classes

### AgentManifestError

Thrown when `defineAgent` finds a required surface missing on disk.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentManifestError**(`message`, `agentId`, `issues?`): [`AgentManifestError`](#agentmanifesterror)

###### Parameters

###### message

`string`

###### agentId

`string`

###### issues?

readonly `unknown`[] = `[]`

###### Returns

[`AgentManifestError`](#agentmanifesterror)

###### Overrides

`Error.constructor`

#### Properties

##### agentId

> `readonly` **agentId**: `string`

##### issues

> `readonly` **issues**: readonly `unknown`[] = `[]`

## Interfaces

### AgentManifest

The full agent manifest. Each agent ships ONE of these.

Generics:
  `TPersona` — the agent's persona shape (loaded from
    `surfaces.personas`). Defaults to `unknown` so the substrate's
    persona discovery (`loadPersonas`) can accept anything; per-agent
    code re-narrows when it matters.
  `TRunOutput` — the shape `runtime.act` returns. Used by the rubric
    scorers and emitted into the trace.

#### Type Parameters

##### TPersona

`TPersona` = `unknown`

##### TRunOutput

`TRunOutput` = `unknown`

#### Properties

##### id

> **id**: `string`

Stable identifier — used as `projectId` in traces, as the analyst
loop's `runId` prefix, and as the namespace under which findings
are persisted. MUST match the agent's repo name to keep
cross-repo telemetry joinable.

##### repoRoot

> **repoRoot**: `string`

Filesystem root the substrate resolves surface paths against.
Typically `process.cwd()` or a fixed absolute path. Use an
absolute path when the agent's tests may run from subdirectories
(vitest sometimes shifts cwd).

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Map of mutable surfaces the self-improvement loop can edit. See
`AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
`knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
`outputSchema`.

Every required path is validated at `defineAgent` time. Missing
paths throw with the full list of offenders.

##### rubric

> **rubric**: [`AgentRubric`](#agentrubric)\<`TRunOutput`\>

Rubric the substrate uses to score each run. Dimensions × weights
× judges. The substrate computes the weighted composite and
stamps it into the RunRecord.

##### runtime

> **runtime**: [`AgentRuntime`](#agentruntime)\<`TPersona`, `TRunOutput`\>

Runtime adapter — how the substrate INVOKES the agent against a
persona. The `act` function takes a persona + a context (with the
tracer the substrate threads through for span emission) and
returns the run output the rubric will score.

The agent's existing production runtime goes in here; the
substrate is intentionally thin around it.

##### personas

> **personas**: () => `Promise`\<readonly `TPersona`[]\>

Persona discovery — the substrate loads personas via this function
at eval start. Can read from `surfaces.personas`, an API, or be
hardcoded. The substrate calls it once per `runAgentEval` call;
persona ordering is preserved.

###### Returns

`Promise`\<readonly `TPersona`[]\>

##### analystKinds

> **analystKinds**: readonly `TraceAnalystKindSpec`[]

Analyst kinds the substrate runs against each persona's trace.
Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
authors can prune (e.g. skip `knowledge-poisoning` when there's no
knowledge base) or extend (custom domain kinds).

Empty array disables the loop — useful for `pnpm eval --no-analyst`.

##### analyst

> **analyst**: [`AnalystConfig`](#analystconfig)

Analyst LLM configuration. The substrate uses these for all four
kinds (override per-kind via `analystKinds` if needed).

***

### AgentRubric

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Type Parameters

##### TRunOutput

`TRunOutput`

#### Properties

##### dimensions

> **dimensions**: readonly [`RubricDimension`](#rubricdimension)\<`TRunOutput`\>[]

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

##### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](#judgeconfig)\<`TRunOutput`\>[]

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.

***

### RubricDimension

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Type Parameters

##### TRunOutput

`TRunOutput`

#### Properties

##### id

> **id**: `string`

Unique identifier — appears in finding subjects (`rubric:<id>`).

##### weight

> **weight**: `number`

0..1 — weight in the composite.

##### score

> **score**: (`input`) => `number`

Deterministic scorer: given the persona + run output, returns a
0..1 score. The substrate sums weight × score across dimensions
for the deterministic composite; judges supplement subjective dims.

###### Parameters

###### input

###### persona

`unknown`

###### output

`TRunOutput`

###### Returns

`number`

##### label?

> `optional` **label?**: `string`

Optional human-readable label for reports.

***

### JudgeConfig

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Type Parameters

##### TRunOutput

`TRunOutput`

#### Properties

##### id

> **id**: `string`

Judge identifier — appears in trace spans + manifest.

##### model

> **model**: `string`

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

##### dimensions

> **dimensions**: readonly `string`[]

Dimensions this judge scores.

##### anchors?

> `optional` **anchors?**: readonly `object`[]

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).

***

### AgentRuntime

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### act

> **act**: (`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Invoke the agent against one persona. Returns BOTH:
  - `events`: an `AsyncIterable<RuntimeStreamEvent>` the chat-centric
    product consumes verbatim (SSE / WebSocket / inline render).
    **Streaming is mandatory — never collapse this to a single Promise.**
    The agent's existing `runChatTurn` (or equivalent async generator)
    plugs in here directly.
  - `output`: a `Promise<TRunOutput>` resolved AFTER the event stream
    drains. The eval substrate awaits this for rubric scoring; chat
    products usually ignore it (they already rendered incrementally).

Implementation contract:
  1. `act` MUST return immediately (synchronous construction of the
     `events` iterator + the `output` promise).
  2. Iterating `events` drives the underlying LLM/tool calls — the
     caller chooses when to consume.
  3. `output` resolves only after the iterator yields its terminal
     event (typically `task_end`); see `collectAgentRun` helper.

`ctx.emitter` is the substrate-threaded `TraceEmitter` — runtimes
SHOULD record LLM/tool spans through it for capture integrity.
`ctx.deadlineMs` is wall-clock; the runtime SHOULD honour for graceful
cancel. `ctx.signal` is the standard abort signal.

###### Parameters

###### persona

`TPersona`

###### ctx

[`AgentRunContext`](#agentruncontext)

###### Returns

[`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

***

### AgentRunInvocation

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Type Parameters

##### TRunOutput

`TRunOutput`

#### Properties

##### events

> **events**: `AsyncIterable`\<[`RuntimeStreamEvent`](index.md#runtimestreamevent)\>

Live stream of typed runtime events. Consumed by chat UX directly.

##### output

> **output**: `Promise`\<`TRunOutput`\>

Final structured output the rubric scores. Resolves after `events` drains.

***

### AgentRunContext

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Substrate-managed trace emitter.

##### runId

> **runId**: `string`

Stable run id for this persona × variant cell.

##### variantId?

> `optional` **variantId?**: `string`

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

##### signal?

> `optional` **signal?**: `AbortSignal`

Optional abort signal.

***

### AnalystConfig

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### model

> **model**: `string`

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

##### budgetUsd?

> `optional` **budgetUsd?**: `number`

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

##### backend?

> `optional` **backend?**: `object`

Backend hint for the AxAIService factory — same shape every kind uses.

###### name?

> `optional` **name?**: `"router"` \| `"openai"`

###### apiKey?

> `optional` **apiKey?**: `string`

###### baseUrl?

> `optional` **baseUrl?**: `string`

***

### SurfaceImprovementEdit

#### Properties

##### id

> **id**: `string`

Stable id derived from the source finding so re-proposals are idempotent.

##### sourceFindingId

> **sourceFindingId**: `string`

The finding that produced this edit — for revert + audit trail.

##### subject

> **subject**: `FindingSubject`

Parsed subject; included so the apply step doesn't re-parse.

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

Resolved on-disk target.

##### baseSha256

> **baseSha256**: `string`

SHA-256 of the current file content the patch was drafted against.

##### patch

> **patch**: `string`

Unified-diff patch the LLM drafted (relative to `target.absolutePath`).

##### summary

> **summary**: `string`

One-line summary the operator sees in the report / PR title.

##### rationale

> **rationale**: `string`

Multi-line rationale for the PR body — finding context + LLM reasoning.

##### confidence

> **confidence**: `number`

Carry-forward from the finding so the apply gate can check the threshold.

##### severity

> **severity**: `AnalystSeverity`

Carry-forward severity for prioritization.

***

### CreateSurfaceImprovementProposerOptions

#### Properties

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

##### repoRoot

> **repoRoot**: `string`

##### draftPatch

> **draftPatch**: (`input`) => `Promise`\<[`DraftPatchOutput`](#draftpatchoutput)\>

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

When the resolved target doesn't exist, allow the substrate to
CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
true for those kinds, false for `system-prompt` / `rubric` / etc.
(named sections that don't exist are a contract violation, not a
scaffolding opportunity).

***

### DraftPatchInput

#### Properties

##### finding

> **finding**: `AnalystFinding`

##### subject

> **subject**: `FindingSubject`

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

##### currentContent

> **currentContent**: `string`

Current file content (empty string when `intent === 'create-new'`).

***

### DraftPatchOutput

#### Properties

##### patch

> **patch**: `string`

Unified diff against the current file content. Empty string skips this finding.

##### summary

> **summary**: `string`

One-line summary for the operator.

##### rationale

> **rationale**: `string`

Multi-line rationale for the PR body.

***

### ProfileMaterializationContract

Declares which AgentProfile axes a concrete run path really carries.

#### Properties

##### name

> **name**: `string`

Human-readable run path, e.g. `createSandboxAct` or `prompt-only-message`.

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Profile axes this run path actually carries into execution.

***

### ProfileMaterializationIssue

One changed AgentProfile axis that would be dropped by a run path.

#### Properties

##### contract

> **contract**: `string`

##### axis

> **axis**: [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)

##### reason

> **reason**: `"unsupported-axis"`

##### supportedAxes

> **supportedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

***

### DefineProfileMaterializationContractOptions

Input for declaring a run path's profile-axis support.

#### Properties

##### name

> **name**: `string`

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

***

### ValidateProfileMaterializationOptions

Input for checking a candidate diff against a run path.

#### Extended by

- [`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

***

### AssertProfileMaterializationOptions

Input for throwing on dropped profile axes.

#### Extends

- [`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`contract`](#contract-1)

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`changedAxes`](#changedaxes)

##### context?

> `optional` **context?**: `string`

Extra label included in the thrown error, usually the caller or run id.

***

### SandboxActComposeOverrides

Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Replace the base profile's system prompt (e.g. a workspace-augmented prompt).

##### extraFiles?

> `optional` **extraFiles?**: `AgentProfileFileMount`[]

Extra file mounts layered after the base profile's `resources.files`.

##### name?

> `optional` **name?**: `string`

Override the profile `name`. Defaults to the base profile's name.

##### tools?

> `optional` **tools?**: `Record`\<`string`, `boolean`\>

Box built-in tool ON/OFF flags merged over the base profile's `tools` (overlay wins per key).

##### mcpConnections?

> `optional` **mcpConnections?**: `Record`\<`string`, `AgentProfileMcpServer`\>

MCP connections merged over the base profile's `mcp` (overlay wins per key).

***

### CreateSandboxActOptions

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### baseProfile

> **baseProfile**: `AgentProfile`

Canonical agent profile — the same one the prod chat turn uses.

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-5)

Sandbox client used to boot the per-run sandbox.

##### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Persona → prompt. Pure; the eval cell's input.

###### Parameters

###### persona

`TPersona`

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<`TRunOutput`\>

Sandbox event stream → typed output the rubric scores.

##### compose?

> `optional` **compose?**: (`persona`) => [`SandboxActComposeOverrides`](#sandboxactcomposeoverrides)

Per-persona profile overrides (workspace-augmented system prompt, extra
file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.

###### Parameters

###### persona

`TPersona`

###### Returns

[`SandboxActComposeOverrides`](#sandboxactcomposeoverrides)

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Sandbox-SDK overrides forwarded to `createSandboxForSpec`.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

##### requiredProfileAxes?

> `optional` **requiredProfileAxes?**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Optional changed axes the caller expects this path to carry.

##### name?

> `optional` **name?**: `string`

Stable run name surfaced in mapped `llm_call` events.

##### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Override the `SandboxEvent → RuntimeStreamEvent` mapper.

###### Parameters

###### event

`SandboxEvent`

###### opts

###### agentRunName?

`string`

###### Returns

[`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

***

### AgentSurfaces

Surface declarations. Every path is repo-relative (or absolute) at
`defineAgent` time. At resolution time, paths are joined against the
agent's `repoRoot`.

`systemPrompt`, `tools`, `personas` are DIRECTORIES; the loop appends
`<section>.md`, `<tool>/README.md`, `<persona-id>.yaml` etc.
`rubric`, `outputSchema` are SINGLE FILES; the loop edits them in
place.

`knowledge` is the agent-knowledge root (typically `.agent-knowledge`);
`applyKnowledgeWriteBlocks` writes pages relative to it.

Optional surfaces (`scaffolding`, `memory`, `rag`, `outputSchema`)
can be omitted — the loop will reject findings targeting them with a
clear log message instead of fabricating a path.

#### Properties

##### systemPrompt

> **systemPrompt**: `string`

Directory containing one markdown file per system-prompt section.

##### tools

> **tools**: `string`

Directory containing one subdir per tool (`<tool>/README.md`).

##### rubric

> **rubric**: `string`

Single file (TypeScript module) defining the rubric weights + dimensions.

##### knowledge

> **knowledge**: `string`

Knowledge-base root; typically `.agent-knowledge`.

##### personas

> **personas**: `string`

Directory containing one YAML/JSON file per persona.

##### scaffolding?

> `optional` **scaffolding?**: `string`

Optional: directory containing scaffolding rules (precondition checks, retry policies).

##### memory?

> `optional` **memory?**: `string`

Optional: memory store path (JSONL / SQLite / DB).

##### rag?

> `optional` **rag?**: `string`

Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`).

##### outputSchema?

> `optional` **outputSchema?**: `string`

Optional: single file defining the output schema (Zod / JSON Schema).

##### skills?

> `optional` **skills?**: `string`

Optional: directory containing Agent Skill packages.

##### mcp?

> `optional` **mcp?**: `string`

Optional: directory containing MCP server/tool configuration.

##### hooks?

> `optional` **hooks?**: `string`

Optional: directory containing hook definitions.

##### subagents?

> `optional` **subagents?**: `string`

Optional: directory containing subagent definitions.

##### workflows?

> `optional` **workflows?**: `string`

Optional: directory containing orchestration/workflow policies.

##### rolloutPolicy?

> `optional` **rolloutPolicy?**: `string`

Optional: single file containing rollout-policy settings.

##### agentProfile?

> `optional` **agentProfile?**: `string`

Optional: single canonical AgentProfile file.

##### code?

> `optional` **code?**: `string`

Optional: source root for code findings.

***

### ResolvedSurface

#### Properties

##### absolutePath

> **absolutePath**: `string`

Absolute filesystem path the operator can `cat` / `vim`.

##### repoRelativePath

> **repoRelativePath**: `string`

Repo-relative path for PR descriptions, diffs, audit logs.

##### exists

> **exists**: `boolean`

Whether the path currently exists on disk.

##### intent

> **intent**: `"edit-existing"` \| `"create-new"`

The substrate's intent: edit an existing file or create a new one.

***

### SurfaceValidationIssue

Validate that every declared surface exists on disk under `repoRoot`.

Returns an array of `SurfaceValidationIssue` — empty when all required
surfaces resolve. `defineAgent` throws with the issues rendered, so
a misconfigured manifest fails at startup (not at the first finding
the loop produces 20 minutes later).

#### Properties

##### surface

> **surface**: keyof [`AgentSurfaces`](#agentsurfaces)

##### path

> **path**: `string`

##### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

## Type Aliases

### KnownAgentProfileMaterializationAxis

> **KnownAgentProfileMaterializationAxis** = *typeof* [`AGENT_PROFILE_MATERIALIZATION_AXES`](#agent_profile_materialization_axes)\[`number`\]

***

### AgentProfileMaterializationAxis

> **AgentProfileMaterializationAxis** = [`KnownAgentProfileMaterializationAxis`](#knownagentprofilematerializationaxis) \| `` `custom:${string}` ``

AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions.

***

### CanonicalAgentProfileMaterializationAxis

> **CanonicalAgentProfileMaterializationAxis** = [`KnownAgentProfileMaterializationAxis`](#knownagentprofilematerializationaxis)

Canonical AgentProfile axes used when checking one complete profile.

## Variables

### AGENT\_PROFILE\_MATERIALIZATION\_AXES

> `const` **AGENT\_PROFILE\_MATERIALIZATION\_AXES**: readonly \[`"identity"`, `"name"`, `"description"`, `"version"`, `"tags"`, `"model"`, `"modelDefault"`, `"modelSmall"`, `"modelProvider"`, `"modelReasoningEffort"`, `"modelMetadata"`, `"harness"`, `"prompt"`, `"systemPrompt"`, `"instructions"`, `"resources"`, `"files"`, `"resourceInstructions"`, `"skills"`, `"resourceTools"`, `"resourceAgents"`, `"commands"`, `"resourceFailOnError"`, `"tools"`, `"permissions"`, `"mcp"`, `"mcpConnections"`, `"connections"`, `"subagents"`, `"hooks"`, `"modes"`, `"confidential"`, `"metadata"`, `"extensions"`\]

Known AgentProfile axes a run path may or may not carry into execution.

***

### fullProfileMaterialization

> `const` **fullProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for a run path that executes every canonical AgentProfile axis.

***

### promptModelProfileMaterialization

> `const` **promptModelProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for an intentionally limited prompt-and-model execution path.
Identity, harness, and metadata are control fields consumed for naming, placement,
authorization, and durable attribution; they are carried without adding worker behavior.
Every behavioral axis other than prompt and model remains unsupported.

***

### worktreeCliProfileMaterialization

> `const` **worktreeCliProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for a local coding CLI in an isolated git worktree.
The shared workspace materializer carries native tools, permissions, MCP, hooks, subagents,
modes, and file-backed resources when the selected CLI supports their exact values. Runtime
placement concerns (hub connections and confidential execution), provider-native extensions,
unused model hints, and `resources.failOnError` are deliberately absent so they fail before a
worktree or executor is created rather than being mistaken for an effective candidate change.

***

### controlProfileMaterialization

> `const` **controlProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for a raw process path that carries only control/identity fields.

***

### promptControlProfileMaterialization

> `const` **promptControlProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for an injected inference function whose surrounding driver still
applies the profile prompt, name, placement, and metadata, but not model selection.

***

### sandboxActProfileMaterialization

> `const` **sandboxActProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for `createSandboxAct`, which forwards the full AgentProfile.

***

### promptOnlyProfileMaterialization

> `const` **promptOnlyProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for a run path that only injects prompt text.

***

### promptResourceProfileMaterialization

> `const` **promptResourceProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Materialization contract for a run path that injects prompt text plus inline resources.

## Functions

### unimplementedAgentRun()

> **unimplementedAgentRun**\<`TRunOutput`\>(`reason?`): [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Stub for agents whose `runtime.act` is not yet wired to the substrate's
eval path. Preserves the streaming contract (empty event stream + a
rejected `output` promise that tells the caller exactly what to fix).

Per-vertical manifests usually start with this stub and replace it with
the agent's real streaming runtime (`runChatTurn` or equivalent) once
the eval path consumes the manifest end-to-end.

#### Type Parameters

##### TRunOutput

`TRunOutput` = `unknown`

#### Parameters

##### reason?

`string` = `'AgentRuntime.act is not yet wired for this manifest'`

#### Returns

[`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

***

### collectAgentRun()

> **collectAgentRun**\<`TRunOutput`\>(`invocation`): `Promise`\<\{ `events`: readonly [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]; `output`: `TRunOutput`; \}\>

Drain `act`'s `events` into an array AND await its `output`. Useful for
eval / outcome-measurement code paths that don't care about live
rendering. The events array is preserved so the substrate can inspect
tool calls / readiness / questions retrospectively.

IMPORTANT: chat-centric UX MUST NOT call this — it defeats streaming
(no incremental render). Use `for await (const ev of invocation.events)`
directly in the chat surface.

#### Type Parameters

##### TRunOutput

`TRunOutput`

#### Parameters

##### invocation

[`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

#### Returns

`Promise`\<\{ `events`: readonly [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]; `output`: `TRunOutput`; \}\>

***

### defineAgent()

> **defineAgent**\<`TPersona`, `TRunOutput`\>(`manifest`): [`AgentManifest`](#agentmanifest)\<`TPersona`, `TRunOutput`\>

Construct a validated agent manifest. Throws `AgentManifestError`
if any required surface is missing on disk.

Generics: pass your persona / output types if you want narrowed
`runtime.act` signatures:
  `defineAgent<TaxPersona, TaxRunOutput>({ ... })`

Most callers don't need the generics — the substrate operates on
`unknown` payloads internally and the manifest's `score` /
`runtime.act` see the typed shapes via TypeScript inference at
the call site.

#### Type Parameters

##### TPersona

`TPersona` = `unknown`

##### TRunOutput

`TRunOutput` = `unknown`

#### Parameters

##### manifest

[`AgentManifest`](#agentmanifest)\<`TPersona`, `TRunOutput`\>

#### Returns

[`AgentManifest`](#agentmanifest)\<`TPersona`, `TRunOutput`\>

***

### createSurfaceImprovementProposer()

> **createSurfaceImprovementProposer**(`opts`): [`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

Resolve each finding to a real surface and draft a detached patch candidate.

#### Parameters

##### opts

[`CreateSurfaceImprovementProposerOptions`](#createsurfaceimprovementproposeroptions)

#### Returns

[`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### defineProfileMaterializationContract()

> **defineProfileMaterializationContract**(`options`): [`ProfileMaterializationContract`](#profilematerializationcontract)

Define the profile axes a concrete run path actually carries into execution.

#### Parameters

##### options

[`DefineProfileMaterializationContractOptions`](#defineprofilematerializationcontractoptions)

#### Returns

[`ProfileMaterializationContract`](#profilematerializationcontract)

***

### profileMaterializationAxes()

> **profileMaterializationAxes**(`profile`): readonly (`"metadata"` \| `"resources"` \| `"name"` \| `"tools"` \| `"model"` \| `"mcp"` \| `"connections"` \| `"subagents"` \| `"hooks"` \| `"modes"` \| `"extensions"` \| `"description"` \| `"version"` \| `"tags"` \| `"prompt"` \| `"harness"` \| `"permissions"` \| `"confidential"` \| `"systemPrompt"` \| `"instructions"` \| `"skills"` \| `"identity"` \| `"modelDefault"` \| `"modelSmall"` \| `"modelProvider"` \| `"modelReasoningEffort"` \| `"modelMetadata"` \| `"files"` \| `"resourceInstructions"` \| `"resourceTools"` \| `"resourceAgents"` \| `"commands"` \| `"resourceFailOnError"` \| `"mcpConnections"`)[]

Return the exact canonical axes a complete profile actually requests. Compound prompt, model,
identity, and resource objects are split so a path cannot claim an entire object while silently
dropping one of its fields.
Empty strings, arrays, and nested records do not claim support; explicit
scalar values such as `false` and `0` remain meaningful requests.

#### Parameters

##### profile

`AgentProfile`

#### Returns

readonly (`"metadata"` \| `"resources"` \| `"name"` \| `"tools"` \| `"model"` \| `"mcp"` \| `"connections"` \| `"subagents"` \| `"hooks"` \| `"modes"` \| `"extensions"` \| `"description"` \| `"version"` \| `"tags"` \| `"prompt"` \| `"harness"` \| `"permissions"` \| `"confidential"` \| `"systemPrompt"` \| `"instructions"` \| `"skills"` \| `"identity"` \| `"modelDefault"` \| `"modelSmall"` \| `"modelProvider"` \| `"modelReasoningEffort"` \| `"modelMetadata"` \| `"files"` \| `"resourceInstructions"` \| `"resourceTools"` \| `"resourceAgents"` \| `"commands"` \| `"resourceFailOnError"` \| `"mcpConnections"`)[]

***

### validateProfileMaterialization()

> **validateProfileMaterialization**(`options`): readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

Return every changed profile axis that the selected run path would drop.

#### Parameters

##### options

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Returns

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

***

### assertProfileMaterialization()

> **assertProfileMaterialization**(`options`): `void`

Throw when a candidate changes axes the selected run path cannot carry.

#### Parameters

##### options

[`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Returns

`void`

***

### renderProfileMaterializationIssues()

> **renderProfileMaterializationIssues**(`issues`, `context?`): `string`

Format profile-axis drop issues into a concise operator-facing error.

#### Parameters

##### issues

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

##### context?

`string`

#### Returns

`string`

***

### createSandboxAct()

> **createSandboxAct**\<`TPersona`, `TRunOutput`\>(`options`): (`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Build an `AgentRuntime.act` implementation backed by a single prod-profile
sandbox run. The returned function honours the `act` contract: it returns
synchronously with a live `events` iterator and an `output` promise that
resolves only after the iterator drains.

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Parameters

##### options

[`CreateSandboxActOptions`](#createsandboxactoptions)\<`TPersona`, `TRunOutput`\>

#### Returns

(`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

***

### resolveSubjectPath()

> **resolveSubjectPath**(`subject`, `surfaces`, `repoRoot`): [`ResolvedSurface`](#resolvedsurface) \| `null`

Resolve a parsed `FindingSubject` to the file path the substrate
should edit (or create) on disk.

Returns `null` when:
  - the subject targets a surface the agent didn't declare
    (e.g. `rag:*` when `surfaces.rag` is undefined), OR
  - the subject is a `cluster` (failure-mode emits these as evidence,
    not actionable mutations — they don't route to a file).

Returns a `ResolvedSurface` with `intent: 'create-new'` when the
subject names a path that doesn't yet exist (e.g. a new wiki page).
The caller chooses whether to honour the create — for tightly-managed
surfaces like `systemPrompt` it's usually a contract violation
(the analyst named a section that doesn't exist); for `knowledge`
it's the whole point.

#### Parameters

##### subject

`FindingSubject`

##### surfaces

[`AgentSurfaces`](#agentsurfaces)

##### repoRoot

`string`

#### Returns

[`ResolvedSurface`](#resolvedsurface) \| `null`

***

### validateSurfaces()

> **validateSurfaces**(`surfaces`, `repoRoot`): readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

Validate an `AgentSurfaces` map on disk — missing paths fail loud at `defineAgent` time instead of silently skipping self-improvement edits.

#### Parameters

##### surfaces

[`AgentSurfaces`](#agentsurfaces)

##### repoRoot

`string`

#### Returns

readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

***

### renderSurfaceIssues()

> **renderSurfaceIssues**(`issues`, `repoRoot`): `string`

Format a list of surface validation issues into a human-readable error string.

#### Parameters

##### issues

readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

##### repoRoot

`string`

#### Returns

`string`
