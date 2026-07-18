[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Classes

### AgentManifestError

Defined in: [agent/define-agent.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L248)

Thrown when `defineAgent` finds a required surface missing on disk.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentManifestError**(`message`, `agentId`, `issues?`): [`AgentManifestError`](#agentmanifesterror)

Defined in: [agent/define-agent.ts:249](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L249)

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

Defined in: [agent/define-agent.ts:251](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L251)

##### issues

> `readonly` **issues**: readonly `unknown`[] = `[]`

Defined in: [agent/define-agent.ts:252](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L252)

## Interfaces

### AgentManifest

Defined in: [agent/define-agent.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L35)

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

Defined in: [agent/define-agent.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L42)

Stable identifier — used as `projectId` in traces, as the analyst
loop's `runId` prefix, and as the namespace under which findings
are persisted. MUST match the agent's repo name to keep
cross-repo telemetry joinable.

##### repoRoot

> **repoRoot**: `string`

Defined in: [agent/define-agent.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L50)

Filesystem root the substrate resolves surface paths against.
Typically `process.cwd()` or a fixed absolute path. Use an
absolute path when the agent's tests may run from subdirectories
(vitest sometimes shifts cwd).

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/define-agent.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L61)

Map of mutable surfaces the self-improvement loop can edit. See
`AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
`knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
`outputSchema`.

Every required path is validated at `defineAgent` time. Missing
paths throw with the full list of offenders.

##### rubric

> **rubric**: [`AgentRubric`](#agentrubric)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L68)

Rubric the substrate uses to score each run. Dimensions × weights
× judges. The substrate computes the weighted composite and
stamps it into the RunRecord.

##### runtime

> **runtime**: [`AgentRuntime`](#agentruntime)\<`TPersona`, `TRunOutput`\>

Defined in: [agent/define-agent.ts:79](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L79)

Runtime adapter — how the substrate INVOKES the agent against a
persona. The `act` function takes a persona + a context (with the
tracer the substrate threads through for span emission) and
returns the run output the rubric will score.

The agent's existing production runtime goes in here; the
substrate is intentionally thin around it.

##### personas

> **personas**: () => `Promise`\<readonly `TPersona`[]\>

Defined in: [agent/define-agent.ts:87](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L87)

Persona discovery — the substrate loads personas via this function
at eval start. Can read from `surfaces.personas`, an API, or be
hardcoded. The substrate calls it once per `runAgentEval` call;
persona ordering is preserved.

###### Returns

`Promise`\<readonly `TPersona`[]\>

##### analystKinds

> **analystKinds**: readonly `TraceAnalystKindSpec`[]

Defined in: [agent/define-agent.ts:97](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L97)

Analyst kinds the substrate runs against each persona's trace.
Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
authors can prune (e.g. skip `knowledge-poisoning` when there's no
knowledge base) or extend (custom domain kinds).

Empty array disables the loop — useful for `pnpm eval --no-analyst`.

##### analyst

> **analyst**: [`AnalystConfig`](#analystconfig)

Defined in: [agent/define-agent.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L103)

Analyst LLM configuration. The substrate uses these for all four
kinds (override per-kind via `analystKinds` if needed).

***

### AgentRubric

Defined in: [agent/define-agent.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L106)

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

Defined in: [agent/define-agent.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L108)

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

##### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](#judgeconfig)\<`TRunOutput`\>[]

Defined in: [agent/define-agent.ts:114](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L114)

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.

***

### RubricDimension

Defined in: [agent/define-agent.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L117)

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

Defined in: [agent/define-agent.ts:119](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L119)

Unique identifier — appears in finding subjects (`rubric:<id>`).

##### weight

> **weight**: `number`

Defined in: [agent/define-agent.ts:121](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L121)

0..1 — weight in the composite.

##### score

> **score**: (`input`) => `number`

Defined in: [agent/define-agent.ts:127](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L127)

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

Defined in: [agent/define-agent.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L129)

Optional human-readable label for reports.

***

### JudgeConfig

Defined in: [agent/define-agent.ts:132](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L132)

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

Defined in: [agent/define-agent.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L134)

Judge identifier — appears in trace spans + manifest.

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:136](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L136)

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

##### dimensions

> **dimensions**: readonly `string`[]

Defined in: [agent/define-agent.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L138)

Dimensions this judge scores.

##### anchors?

> `optional` **anchors?**: readonly `object`[]

Defined in: [agent/define-agent.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L144)

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).

***

### AgentRuntime

Defined in: [agent/define-agent.ts:147](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L147)

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

Defined in: [agent/define-agent.ts:172](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L172)

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

Defined in: [agent/define-agent.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L175)

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

Defined in: [agent/define-agent.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L177)

Live stream of typed runtime events. Consumed by chat UX directly.

##### output

> **output**: `Promise`\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:179](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L179)

Final structured output the rubric scores. Resolves after `events` drains.

***

### AgentRunContext

Defined in: [agent/define-agent.ts:219](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L219)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Defined in: [agent/define-agent.ts:221](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L221)

Substrate-managed trace emitter.

##### runId

> **runId**: `string`

Defined in: [agent/define-agent.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L223)

Stable run id for this persona × variant cell.

##### variantId?

> `optional` **variantId?**: `string`

Defined in: [agent/define-agent.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L225)

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [agent/define-agent.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L227)

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [agent/define-agent.ts:229](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L229)

Optional abort signal.

***

### AnalystConfig

Defined in: [agent/define-agent.ts:232](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L232)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:234](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L234)

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

##### budgetUsd?

> `optional` **budgetUsd?**: `number`

Defined in: [agent/define-agent.ts:236](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L236)

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

##### backend?

> `optional` **backend?**: `object`

Defined in: [agent/define-agent.ts:238](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L238)

Backend hint for the AxAIService factory — same shape every kind uses.

###### name?

> `optional` **name?**: `"router"` \| `"openai"`

###### apiKey?

> `optional` **apiKey?**: `string`

###### baseUrl?

> `optional` **baseUrl?**: `string`

***

### SurfaceImprovementEdit

Defined in: [agent/improvement-adapter.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L35)

#### Properties

##### id

> **id**: `string`

Defined in: [agent/improvement-adapter.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L37)

Stable id derived from the source finding so re-proposals are idempotent.

##### sourceFindingId

> **sourceFindingId**: `string`

Defined in: [agent/improvement-adapter.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L39)

The finding that produced this edit — for revert + audit trail.

##### subject

> **subject**: `FindingSubject`

Defined in: [agent/improvement-adapter.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L41)

Parsed subject; included so the apply step doesn't re-parse.

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

Defined in: [agent/improvement-adapter.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L43)

Resolved on-disk target.

##### baseSha256

> **baseSha256**: `string`

Defined in: [agent/improvement-adapter.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L45)

SHA-256 of the current file content the patch was drafted against.

##### patch

> **patch**: `string`

Defined in: [agent/improvement-adapter.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L47)

Unified-diff patch the LLM drafted (relative to `target.absolutePath`).

##### summary

> **summary**: `string`

Defined in: [agent/improvement-adapter.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L49)

One-line summary the operator sees in the report / PR title.

##### rationale

> **rationale**: `string`

Defined in: [agent/improvement-adapter.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L51)

Multi-line rationale for the PR body — finding context + LLM reasoning.

##### confidence

> **confidence**: `number`

Defined in: [agent/improvement-adapter.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L53)

Carry-forward from the finding so the apply gate can check the threshold.

##### severity

> **severity**: `AnalystSeverity`

Defined in: [agent/improvement-adapter.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L55)

Carry-forward severity for prioritization.

***

### CreateSurfaceImprovementProposerOptions

Defined in: [agent/improvement-adapter.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L58)

#### Properties

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/improvement-adapter.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L59)

##### repoRoot

> **repoRoot**: `string`

Defined in: [agent/improvement-adapter.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L60)

##### draftPatch

> **draftPatch**: (`input`) => `Promise`\<[`DraftPatchOutput`](#draftpatchoutput)\>

Defined in: [agent/improvement-adapter.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L69)

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

> `optional` **allowCreateForKinds?**: readonly (`"code"` \| `"mcp"` \| `"memory"` \| `"agent-profile"` \| `"knowledge.wiki"` \| `"knowledge.claim"` \| `"knowledge.raw"` \| `"knowledge.stale"` \| `"system-prompt"` \| `"skill"` \| `"tool-doc"` \| `"new-tool"` \| `"hook"` \| `"subagent"` \| `"workflow"` \| `"rollout-policy"` \| `"rag"` \| `"scaffolding"` \| `"output-schema"` \| `"websearch.outdated"` \| `"prior-run-summary"` \| `"cluster"`)[]

Defined in: [agent/improvement-adapter.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L77)

When the resolved target doesn't exist, allow the substrate to
CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
true for those kinds, false for `system-prompt` / `rubric` / etc.
(named sections that don't exist are a contract violation, not a
scaffolding opportunity).

***

### DraftPatchInput

Defined in: [agent/improvement-adapter.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L80)

#### Properties

##### finding

> **finding**: `AnalystFinding`

Defined in: [agent/improvement-adapter.ts:81](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L81)

##### subject

> **subject**: `FindingSubject`

Defined in: [agent/improvement-adapter.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L82)

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

Defined in: [agent/improvement-adapter.ts:83](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L83)

##### currentContent

> **currentContent**: `string`

Defined in: [agent/improvement-adapter.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L85)

Current file content (empty string when `intent === 'create-new'`).

***

### DraftPatchOutput

Defined in: [agent/improvement-adapter.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L88)

#### Properties

##### patch

> **patch**: `string`

Defined in: [agent/improvement-adapter.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L90)

Unified diff against the current file content. Empty string skips this finding.

##### summary

> **summary**: `string`

Defined in: [agent/improvement-adapter.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L92)

One-line summary for the operator.

##### rationale

> **rationale**: `string`

Defined in: [agent/improvement-adapter.ts:94](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L94)

Multi-line rationale for the PR body.

***

### ProfileMaterializationContract

Defined in: [agent/profile-materialization.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L40)

Declares which AgentProfile axes a concrete run path really carries.

#### Properties

##### name

> **name**: `string`

Defined in: [agent/profile-materialization.ts:42](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L42)

Human-readable run path, e.g. `createSandboxAct` or `prompt-only-message`.

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/profile-materialization.ts:44](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L44)

Profile axes this run path actually carries into execution.

***

### ProfileMaterializationIssue

Defined in: [agent/profile-materialization.ts:48](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L48)

One changed AgentProfile axis that would be dropped by a run path.

#### Properties

##### contract

> **contract**: `string`

Defined in: [agent/profile-materialization.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L49)

##### axis

> **axis**: [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)

Defined in: [agent/profile-materialization.ts:50](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L50)

##### reason

> **reason**: `"unsupported-axis"`

Defined in: [agent/profile-materialization.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L51)

##### supportedAxes

> **supportedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/profile-materialization.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L52)

***

### DefineProfileMaterializationContractOptions

Defined in: [agent/profile-materialization.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L56)

Input for declaring a run path's profile-axis support.

#### Properties

##### name

> **name**: `string`

Defined in: [agent/profile-materialization.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L57)

##### axes

> **axes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/profile-materialization.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L58)

***

### ValidateProfileMaterializationOptions

Defined in: [agent/profile-materialization.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L62)

Input for checking a candidate diff against a run path.

#### Extended by

- [`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L63)

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/profile-materialization.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L64)

***

### AssertProfileMaterializationOptions

Defined in: [agent/profile-materialization.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L68)

Input for throwing on dropped profile axes.

#### Extends

- [`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Properties

##### contract

> **contract**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L63)

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`contract`](#contract-1)

##### changedAxes

> **changedAxes**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/profile-materialization.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L64)

###### Inherited from

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions).[`changedAxes`](#changedaxes)

##### context?

> `optional` **context?**: `string`

Defined in: [agent/profile-materialization.ts:70](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L70)

Extra label included in the thrown error, usually the caller or run id.

***

### CreateSandboxActOptions

Defined in: [agent/sandbox-act.ts:52](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L52)

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### baseProfile

> **baseProfile**: `AgentProfile`

Defined in: [agent/sandbox-act.ts:54](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L54)

Canonical agent profile — the same one the prod chat turn uses.

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-3)

Defined in: [agent/sandbox-act.ts:56](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L56)

Sandbox client used to boot the per-run sandbox.

##### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Defined in: [agent/sandbox-act.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L58)

Persona → prompt. Pure; the eval cell's input.

###### Parameters

###### persona

`TPersona`

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<`TRunOutput`\>

Defined in: [agent/sandbox-act.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L60)

Sandbox event stream → typed output the rubric scores.

##### compose?

> `optional` **compose?**: (`persona`) => `SandboxActComposeOverrides`

Defined in: [agent/sandbox-act.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L65)

Per-persona profile overrides (workspace-augmented system prompt, extra
file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.

###### Parameters

###### persona

`TPersona`

###### Returns

`SandboxActComposeOverrides`

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [agent/sandbox-act.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L67)

Sandbox-SDK overrides forwarded to `createSandboxForSpec`.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

##### requiredProfileAxes?

> `optional` **requiredProfileAxes?**: readonly [`AgentProfileMaterializationAxis`](#agentprofilematerializationaxis)[]

Defined in: [agent/sandbox-act.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L69)

Optional changed axes the caller expects this path to carry.

##### name?

> `optional` **name?**: `string`

Defined in: [agent/sandbox-act.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L71)

Stable run name surfaced in mapped `llm_call` events.

##### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: [agent/sandbox-act.ts:73](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L73)

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

Defined in: [agent/surfaces.ts:37](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L37)

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

Defined in: [agent/surfaces.ts:39](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L39)

Directory containing one markdown file per system-prompt section.

##### tools

> **tools**: `string`

Defined in: [agent/surfaces.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L41)

Directory containing one subdir per tool (`<tool>/README.md`).

##### rubric

> **rubric**: `string`

Defined in: [agent/surfaces.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L43)

Single file (TypeScript module) defining the rubric weights + dimensions.

##### knowledge

> **knowledge**: `string`

Defined in: [agent/surfaces.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L45)

Knowledge-base root; typically `.agent-knowledge`.

##### personas

> **personas**: `string`

Defined in: [agent/surfaces.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L47)

Directory containing one YAML/JSON file per persona.

##### scaffolding?

> `optional` **scaffolding?**: `string`

Defined in: [agent/surfaces.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L49)

Optional: directory containing scaffolding rules (precondition checks, retry policies).

##### memory?

> `optional` **memory?**: `string`

Defined in: [agent/surfaces.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L51)

Optional: memory store path (JSONL / SQLite / DB).

##### rag?

> `optional` **rag?**: `string`

Defined in: [agent/surfaces.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L53)

Optional: directory containing RAG corpora (`<corpus>/<doc-id>.md`).

##### outputSchema?

> `optional` **outputSchema?**: `string`

Defined in: [agent/surfaces.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L55)

Optional: single file defining the output schema (Zod / JSON Schema).

##### skills?

> `optional` **skills?**: `string`

Defined in: [agent/surfaces.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L57)

Optional: directory containing Agent Skill packages.

##### mcp?

> `optional` **mcp?**: `string`

Defined in: [agent/surfaces.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L59)

Optional: directory containing MCP server/tool configuration.

##### hooks?

> `optional` **hooks?**: `string`

Defined in: [agent/surfaces.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L61)

Optional: directory containing hook definitions.

##### subagents?

> `optional` **subagents?**: `string`

Defined in: [agent/surfaces.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L63)

Optional: directory containing subagent definitions.

##### workflows?

> `optional` **workflows?**: `string`

Defined in: [agent/surfaces.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L65)

Optional: directory containing orchestration/workflow policies.

##### rolloutPolicy?

> `optional` **rolloutPolicy?**: `string`

Defined in: [agent/surfaces.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L67)

Optional: single file containing rollout-policy settings.

##### agentProfile?

> `optional` **agentProfile?**: `string`

Defined in: [agent/surfaces.ts:69](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L69)

Optional: single canonical AgentProfile file.

##### code?

> `optional` **code?**: `string`

Defined in: [agent/surfaces.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L71)

Optional: source root for code findings.

***

### ResolvedSurface

Defined in: [agent/surfaces.ts:74](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L74)

#### Properties

##### absolutePath

> **absolutePath**: `string`

Defined in: [agent/surfaces.ts:76](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L76)

Absolute filesystem path the operator can `cat` / `vim`.

##### repoRelativePath

> **repoRelativePath**: `string`

Defined in: [agent/surfaces.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L78)

Repo-relative path for PR descriptions, diffs, audit logs.

##### exists

> **exists**: `boolean`

Defined in: [agent/surfaces.ts:80](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L80)

Whether the path currently exists on disk.

##### intent

> **intent**: `"edit-existing"` \| `"create-new"`

Defined in: [agent/surfaces.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L82)

The substrate's intent: edit an existing file or create a new one.

***

### SurfaceValidationIssue

Defined in: [agent/surfaces.ts:264](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L264)

Validate that every declared surface exists on disk under `repoRoot`.

Returns an array of `SurfaceValidationIssue` — empty when all required
surfaces resolve. `defineAgent` throws with the issues rendered, so
a misconfigured manifest fails at startup (not at the first finding
the loop produces 20 minutes later).

#### Properties

##### surface

> **surface**: keyof [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/surfaces.ts:265](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L265)

##### path

> **path**: `string`

Defined in: [agent/surfaces.ts:266](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L266)

##### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

Defined in: [agent/surfaces.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L267)

## Type Aliases

### KnownAgentProfileMaterializationAxis

> **KnownAgentProfileMaterializationAxis** = *typeof* [`AGENT_PROFILE_MATERIALIZATION_AXES`](#agent_profile_materialization_axes)\[`number`\]

Defined in: [agent/profile-materialization.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L31)

***

### AgentProfileMaterializationAxis

> **AgentProfileMaterializationAxis** = [`KnownAgentProfileMaterializationAxis`](#knownagentprofilematerializationaxis) \| `` `custom:${string}` ``

Defined in: [agent/profile-materialization.ts:35](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L35)

AgentProfile axis name, with `custom:<name>` reserved for caller-owned extensions.

## Variables

### AGENT\_PROFILE\_MATERIALIZATION\_AXES

> `const` **AGENT\_PROFILE\_MATERIALIZATION\_AXES**: readonly \[`"identity"`, `"name"`, `"model"`, `"prompt"`, `"systemPrompt"`, `"instructions"`, `"resources"`, `"files"`, `"resourceInstructions"`, `"skills"`, `"resourceTools"`, `"resourceAgents"`, `"commands"`, `"tools"`, `"permissions"`, `"mcp"`, `"mcpConnections"`, `"connections"`, `"subagents"`, `"hooks"`, `"modes"`, `"confidential"`, `"metadata"`, `"extensions"`\]

Defined in: [agent/profile-materialization.ts:4](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L4)

Known AgentProfile axes a run path may or may not carry into execution.

***

### sandboxActProfileMaterialization

> `const` **sandboxActProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:91](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L91)

Materialization contract for `createSandboxAct`, which forwards the full AgentProfile.

***

### promptOnlyProfileMaterialization

> `const` **promptOnlyProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:112](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L112)

Materialization contract for a run path that only injects prompt text.

***

### promptResourceProfileMaterialization

> `const` **promptResourceProfileMaterialization**: [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L118)

Materialization contract for a run path that injects prompt text plus inline resources.

## Functions

### unimplementedAgentRun()

> **unimplementedAgentRun**\<`TRunOutput`\>(`reason?`): [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L191)

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

Defined in: [agent/define-agent.ts:210](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L210)

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

Defined in: [agent/define-agent.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L272)

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

Defined in: [agent/improvement-adapter.ts:107](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L107)

Resolve each finding to a real surface and draft a detached patch candidate.

#### Parameters

##### opts

[`CreateSurfaceImprovementProposerOptions`](#createsurfaceimprovementproposeroptions)

#### Returns

[`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### defineProfileMaterializationContract()

> **defineProfileMaterializationContract**(`options`): [`ProfileMaterializationContract`](#profilematerializationcontract)

Defined in: [agent/profile-materialization.ts:124](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L124)

Define the profile axes a concrete run path actually carries into execution.

#### Parameters

##### options

[`DefineProfileMaterializationContractOptions`](#defineprofilematerializationcontractoptions)

#### Returns

[`ProfileMaterializationContract`](#profilematerializationcontract)

***

### validateProfileMaterialization()

> **validateProfileMaterialization**(`options`): readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

Defined in: [agent/profile-materialization.ts:138](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L138)

Return every changed profile axis that the selected run path would drop.

#### Parameters

##### options

[`ValidateProfileMaterializationOptions`](#validateprofilematerializationoptions)

#### Returns

readonly [`ProfileMaterializationIssue`](#profilematerializationissue)[]

***

### assertProfileMaterialization()

> **assertProfileMaterialization**(`options`): `void`

Defined in: [agent/profile-materialization.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L159)

Throw when a candidate changes axes the selected run path cannot carry.

#### Parameters

##### options

[`AssertProfileMaterializationOptions`](#assertprofilematerializationoptions)

#### Returns

`void`

***

### renderProfileMaterializationIssues()

> **renderProfileMaterializationIssues**(`issues`, `context?`): `string`

Defined in: [agent/profile-materialization.ts:166](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/profile-materialization.ts#L166)

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

Defined in: [agent/sandbox-act.ts:85](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L85)

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

Defined in: [agent/surfaces.ts:102](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L102)

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

Defined in: [agent/surfaces.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L271)

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

Defined in: [agent/surfaces.ts:345](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L345)

Format a list of surface validation issues into a human-readable error string.

#### Parameters

##### issues

readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

##### repoRoot

`string`

#### Returns

`string`
