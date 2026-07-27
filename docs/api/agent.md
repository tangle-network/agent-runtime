[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Classes

### AgentManifestError

Defined in: src/agent/define-agent.ts:248

Thrown when `defineAgent` finds a required surface missing on disk.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentManifestError**(`message`, `agentId`, `issues?`): [`AgentManifestError`](#agentmanifesterror)

Defined in: src/agent/define-agent.ts:249

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

Defined in: src/agent/define-agent.ts:251

##### issues

> `readonly` **issues**: readonly `unknown`[] = `[]`

Defined in: src/agent/define-agent.ts:252

## Interfaces

### AgentManifest

Defined in: src/agent/define-agent.ts:35

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

Defined in: src/agent/define-agent.ts:42

Stable identifier — used as `projectId` in traces, as the analyst
loop's `runId` prefix, and as the namespace under which findings
are persisted. MUST match the agent's repo name to keep
cross-repo telemetry joinable.

##### repoRoot

> **repoRoot**: `string`

Defined in: src/agent/define-agent.ts:50

Filesystem root the substrate resolves surface paths against.
Typically `process.cwd()` or a fixed absolute path. Use an
absolute path when the agent's tests may run from subdirectories
(vitest sometimes shifts cwd).

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Defined in: src/agent/define-agent.ts:61

Map of mutable surfaces the self-improvement loop can edit. See
`AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
`knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
`outputSchema`.

Every required path is validated at `defineAgent` time. Missing
paths throw with the full list of offenders.

##### rubric

> **rubric**: [`AgentRubric`](#agentrubric)\<`TRunOutput`\>

Defined in: src/agent/define-agent.ts:68

Rubric the substrate uses to score each run. Dimensions × weights
× judges. The substrate computes the weighted composite and
stamps it into the RunRecord.

##### runtime

> **runtime**: [`AgentRuntime`](#agentruntime)\<`TPersona`, `TRunOutput`\>

Defined in: src/agent/define-agent.ts:79

Runtime adapter — how the substrate INVOKES the agent against a
persona. The `act` function takes a persona + a context (with the
tracer the substrate threads through for span emission) and
returns the run output the rubric will score.

The agent's existing production runtime goes in here; the
substrate is intentionally thin around it.

##### personas

> **personas**: () => `Promise`\<readonly `TPersona`[]\>

Defined in: src/agent/define-agent.ts:87

Persona discovery — the substrate loads personas via this function
at eval start. Can read from `surfaces.personas`, an API, or be
hardcoded. The substrate calls it once per `runAgentEval` call;
persona ordering is preserved.

###### Returns

`Promise`\<readonly `TPersona`[]\>

##### analystKinds

> **analystKinds**: readonly `TraceAnalystKindSpec`[]

Defined in: src/agent/define-agent.ts:97

Analyst kinds the substrate runs against each persona's trace.
Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
authors can prune (e.g. skip `knowledge-poisoning` when there's no
knowledge base) or extend (custom domain kinds).

Empty array disables the loop — useful for `pnpm eval --no-analyst`.

##### analyst

> **analyst**: [`AnalystConfig`](#analystconfig)

Defined in: src/agent/define-agent.ts:103

Analyst LLM configuration. The substrate uses these for all four
kinds (override per-kind via `analystKinds` if needed).

***

### AgentRubric

Defined in: src/agent/define-agent.ts:106

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

Defined in: src/agent/define-agent.ts:108

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

##### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](#judgeconfig)\<`TRunOutput`\>[]

Defined in: src/agent/define-agent.ts:114

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.

***

### RubricDimension

Defined in: src/agent/define-agent.ts:117

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

Defined in: src/agent/define-agent.ts:119

Unique identifier — appears in finding subjects (`rubric:<id>`).

##### weight

> **weight**: `number`

Defined in: src/agent/define-agent.ts:121

0..1 — weight in the composite.

##### score

> **score**: (`input`) => `number`

Defined in: src/agent/define-agent.ts:127

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

Defined in: src/agent/define-agent.ts:129

Optional human-readable label for reports.

***

### JudgeConfig

Defined in: src/agent/define-agent.ts:132

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

Defined in: src/agent/define-agent.ts:134

Judge identifier — appears in trace spans + manifest.

##### model

> **model**: `string`

Defined in: src/agent/define-agent.ts:136

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

##### dimensions

> **dimensions**: readonly `string`[]

Defined in: src/agent/define-agent.ts:138

Dimensions this judge scores.

##### anchors?

> `optional` **anchors?**: readonly `object`[]

Defined in: src/agent/define-agent.ts:144

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).

***

### AgentRuntime

Defined in: src/agent/define-agent.ts:147

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

Defined in: src/agent/define-agent.ts:172

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

Defined in: src/agent/define-agent.ts:175

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

Defined in: src/agent/define-agent.ts:177

Live stream of typed runtime events. Consumed by chat UX directly.

##### output

> **output**: `Promise`\<`TRunOutput`\>

Defined in: src/agent/define-agent.ts:179

Final structured output the rubric scores. Resolves after `events` drains.

***

### AgentRunContext

Defined in: src/agent/define-agent.ts:219

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Defined in: src/agent/define-agent.ts:221

Substrate-managed trace emitter.

##### runId

> **runId**: `string`

Defined in: src/agent/define-agent.ts:223

Stable run id for this persona × variant cell.

##### variantId?

> `optional` **variantId?**: `string`

Defined in: src/agent/define-agent.ts:225

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: src/agent/define-agent.ts:227

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/agent/define-agent.ts:229

Optional abort signal.

***

### AnalystConfig

Defined in: src/agent/define-agent.ts:232

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### model

> **model**: `string`

Defined in: src/agent/define-agent.ts:234

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

##### budgetUsd?

> `optional` **budgetUsd?**: `number`

Defined in: src/agent/define-agent.ts:236

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

##### backend?

> `optional` **backend?**: `object`

Defined in: src/agent/define-agent.ts:238

Backend hint for the AxAIService factory — same shape every kind uses.

###### name?

> `optional` **name?**: `"router"` \| `"openai"`

###### apiKey?

> `optional` **apiKey?**: `string`

###### baseUrl?

> `optional` **baseUrl?**: `string`

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

> **target**: [`ResolvedSurface`](#resolvedsurface)

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

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

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

> **target**: [`ResolvedSurface`](#resolvedsurface)

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

### ProfileMaterializationContract

Defined in: src/agent/profile-materialization.ts:40

Declares which AgentProfile axes a concrete run path really carries.

#### Properties

##### name

> **name**: `string`

Defined in: src/agent/profile-materialization.ts:42

Human-readable run path, e.g. `createSandboxAct` or `prompt-only-message`.

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

***

### SandboxActComposeOverrides

Defined in: src/agent/sandbox-act.ts:39

Per-persona profile-merge slots applied over the base profile (§1.5: the caller authors the
 per-persona profile). Each slot overlays the base; an absent slot leaves the base untouched.

#### Properties

##### systemPrompt?

> `optional` **systemPrompt?**: `string`

Defined in: src/agent/sandbox-act.ts:41

Replace the base profile's system prompt (e.g. a workspace-augmented prompt).

##### extraFiles?

> `optional` **extraFiles?**: `AgentProfileFileMount`[]

Defined in: src/agent/sandbox-act.ts:43

Extra file mounts layered after the base profile's `resources.files`.

##### name?

> `optional` **name?**: `string`

Defined in: src/agent/sandbox-act.ts:45

Override the profile `name`. Defaults to the base profile's name.

##### tools?

> `optional` **tools?**: `Record`\<`string`, `boolean`\>

Defined in: src/agent/sandbox-act.ts:47

Box built-in tool ON/OFF flags merged over the base profile's `tools` (overlay wins per key).

##### mcpConnections?

> `optional` **mcpConnections?**: `Record`\<`string`, `AgentProfileMcpServer`\>

Defined in: src/agent/sandbox-act.ts:49

MCP connections merged over the base profile's `mcp` (overlay wins per key).

***

### CreateSandboxActOptions

Defined in: src/agent/sandbox-act.ts:52

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### baseProfile

> **baseProfile**: `AgentProfile`

Defined in: src/agent/sandbox-act.ts:54

Canonical agent profile — the same one the prod chat turn uses.

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-5)

Defined in: src/agent/sandbox-act.ts:56

Sandbox client used to boot the per-run sandbox.

##### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Defined in: src/agent/sandbox-act.ts:58

Persona → prompt. Pure; the eval cell's input.

###### Parameters

###### persona

`TPersona`

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<`TRunOutput`\>

Defined in: src/agent/sandbox-act.ts:60

Sandbox event stream → typed output the rubric scores.

##### compose?

> `optional` **compose?**: (`persona`) => [`SandboxActComposeOverrides`](#sandboxactcomposeoverrides)

Defined in: src/agent/sandbox-act.ts:65

Per-persona profile overrides (workspace-augmented system prompt, extra
file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.

###### Parameters

###### persona

`TPersona`

###### Returns

[`SandboxActComposeOverrides`](#sandboxactcomposeoverrides)

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: src/agent/sandbox-act.ts:67

Sandbox-SDK overrides forwarded to `createSandboxForSpec`.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

##### requiredProfileAxes?

> `optional` **requiredProfileAxes?**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: src/agent/sandbox-act.ts:69

Optional changed axes the caller expects this path to carry.

##### name?

> `optional` **name?**: `string`

Defined in: src/agent/sandbox-act.ts:71

Stable run name surfaced in mapped `llm_call` events.

##### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: src/agent/sandbox-act.ts:73

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

Defined in: src/agent/surfaces.ts:37

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

Defined in: src/agent/surfaces.ts:39

Directory containing one markdown file per system-prompt section.

##### tools

> **tools**: `string`

Defined in: src/agent/surfaces.ts:41

Directory containing one subdir per tool (`<tool>/README.md`).

##### rubric

> **rubric**: `string`

Defined in: src/agent/surfaces.ts:43

Single file (TypeScript module) defining the rubric weights + dimensions.

##### knowledge

> **knowledge**: `string`

Defined in: src/agent/surfaces.ts:45

Knowledge-base root; typically `.agent-knowledge`.

##### personas

> **personas**: `string`

Defined in: src/agent/surfaces.ts:47

Directory containing one YAML/JSON file per persona.

##### scaffolding?

> `optional` **scaffolding?**: `string`

Defined in: src/agent/surfaces.ts:49

Optional: directory containing scaffolding rules (precondition checks, retry policies).

##### memory?

> `optional` **memory?**: `string`

Defined in: src/agent/surfaces.ts:51

Optional: memory store path (JSONL / SQLite / DB).

##### rag?

> `optional` **rag?**: `string`

Defined in: src/agent/surfaces.ts:53

Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`).

##### outputSchema?

> `optional` **outputSchema?**: `string`

Defined in: src/agent/surfaces.ts:55

Optional: single file defining the output schema (Zod / JSON Schema).

##### skills?

> `optional` **skills?**: `string`

Defined in: src/agent/surfaces.ts:57

Optional: directory containing Agent Skill packages.

##### mcp?

> `optional` **mcp?**: `string`

Defined in: src/agent/surfaces.ts:59

Optional: directory containing MCP server/tool configuration.

##### hooks?

> `optional` **hooks?**: `string`

Defined in: src/agent/surfaces.ts:61

Optional: directory containing hook definitions.

##### subagents?

> `optional` **subagents?**: `string`

Defined in: src/agent/surfaces.ts:63

Optional: directory containing subagent definitions.

##### workflows?

> `optional` **workflows?**: `string`

Defined in: src/agent/surfaces.ts:65

Optional: directory containing orchestration/workflow policies.

##### rolloutPolicy?

> `optional` **rolloutPolicy?**: `string`

Defined in: src/agent/surfaces.ts:67

Optional: single file containing rollout-policy settings.

##### agentProfile?

> `optional` **agentProfile?**: `string`

Defined in: src/agent/surfaces.ts:69

Optional: single canonical AgentProfile file.

##### code?

> `optional` **code?**: `string`

Defined in: src/agent/surfaces.ts:71

Optional: source root for code findings.

***

### ResolvedSurface

Defined in: src/agent/surfaces.ts:74

#### Properties

##### absolutePath

> **absolutePath**: `string`

Defined in: src/agent/surfaces.ts:76

Absolute filesystem path the operator can `cat` / `vim`.

##### repoRelativePath

> **repoRelativePath**: `string`

Defined in: src/agent/surfaces.ts:78

Repo-relative path for PR descriptions, diffs, audit logs.

##### exists

> **exists**: `boolean`

Defined in: src/agent/surfaces.ts:80

Whether the path currently exists on disk.

##### intent

> **intent**: `"edit-existing"` \| `"create-new"`

Defined in: src/agent/surfaces.ts:82

The substrate's intent: edit an existing file or create a new one.

***

### SurfaceValidationIssue

Defined in: src/agent/surfaces.ts:264

Validate that every declared surface exists on disk under `repoRoot`.

Returns an array of `SurfaceValidationIssue` — empty when all required
surfaces resolve. `defineAgent` throws with the issues rendered, so
a misconfigured manifest fails at startup (not at the first finding
the loop produces 20 minutes later).

#### Properties

##### surface

> **surface**: keyof [`AgentSurfaces`](#agentsurfaces)

Defined in: src/agent/surfaces.ts:265

##### path

> **path**: `string`

Defined in: src/agent/surfaces.ts:266

##### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

Defined in: src/agent/surfaces.ts:267

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

### AGENT\_PROFILE\_MATERIALIZATION\_AXES

> `const` **AGENT\_PROFILE\_MATERIALIZATION\_AXES**: readonly \[`"identity"`, `"name"`, `"model"`, `"prompt"`, `"systemPrompt"`, `"instructions"`, `"resources"`, `"files"`, `"resourceInstructions"`, `"skills"`, `"resourceTools"`, `"resourceAgents"`, `"commands"`, `"tools"`, `"permissions"`, `"mcp"`, `"mcpConnections"`, `"connections"`, `"subagents"`, `"hooks"`, `"modes"`, `"confidential"`, `"metadata"`, `"extensions"`\]

Defined in: src/agent/profile-materialization.ts:4

Known AgentProfile axes a run path may or may not carry into execution.

***

### sandboxActProfileMaterialization

> `const` **sandboxActProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:91

Materialization contract for `createSandboxAct`, which forwards the full AgentProfile.

***

### promptOnlyProfileMaterialization

> `const` **promptOnlyProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:112

Materialization contract for a run path that only injects prompt text.

***

### promptResourceProfileMaterialization

> `const` **promptResourceProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:118

Materialization contract for a run path that injects prompt text plus inline resources.

## Functions

### unimplementedAgentRun()

> **unimplementedAgentRun**\<`TRunOutput`\>(`reason?`): [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Defined in: src/agent/define-agent.ts:191

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

Defined in: src/agent/define-agent.ts:210

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

Defined in: src/agent/define-agent.ts:272

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

Defined in: src/agent/improvement-adapter.ts:107

Resolve each finding to a real surface and draft a detached patch candidate.

#### Parameters

##### opts

[`CreateSurfaceImprovementProposerOptions`](#createsurfaceimprovementproposeroptions)

#### Returns

[`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### defineProfileMaterializationContract()

> **defineProfileMaterializationContract**(`options`): [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: src/agent/profile-materialization.ts:124

Define the profile axes a concrete run path actually carries into execution.

#### Parameters

##### options

[`DefineProfileMaterializationContractOptions`](#defineprofilematerializationcontractoptions)

#### Returns

[`ProfileMaterializationContract`](#profilematerializationcontract)

***

### validateProfileMaterialization()

> **validateProfileMaterialization**(`options`): readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

Defined in: src/agent/profile-materialization.ts:138

Return every changed profile axis that the selected run path would drop.

#### Parameters

##### options

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Returns

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

***

### assertProfileMaterialization()

> **assertProfileMaterialization**(`options`): `void`

Defined in: src/agent/profile-materialization.ts:159

Throw when a candidate changes axes the selected run path cannot carry.

#### Parameters

##### options

[`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Returns

`void`

***

### renderProfileMaterializationIssues()

> **renderProfileMaterializationIssues**(`issues`, `context?`): `string`

Defined in: src/agent/profile-materialization.ts:166

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

Defined in: src/agent/sandbox-act.ts:85

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

Defined in: src/agent/surfaces.ts:102

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

Defined in: src/agent/surfaces.ts:271

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

Defined in: src/agent/surfaces.ts:345

Format a list of surface validation issues into a human-readable error string.

#### Parameters

##### issues

readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

##### repoRoot

`string`

#### Returns

`string`
