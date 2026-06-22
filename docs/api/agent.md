[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Classes

### AgentManifestError

Defined in: [agent/define-agent.ts:272](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L272)

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentManifestError**(`message`, `agentId`, `issues?`): [`AgentManifestError`](#agentmanifesterror)

Defined in: [agent/define-agent.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L273)

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

Defined in: [agent/define-agent.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L275)

##### issues

> `readonly` **issues**: readonly `unknown`[] = `[]`

Defined in: [agent/define-agent.ts:276](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L276)

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

##### autoApply?

> `optional` **autoApply?**: [`AutoApplyPolicy`](#autoapplypolicy)

Defined in: [agent/define-agent.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L115)

Auto-apply policy. Knowledge / improvement edits land only when
`enabled === true` AND the source finding's confidence meets the
threshold. `mode` controls how applies happen: `'write'` mutates
files in-place; `'open-pr'` writes to a branch and opens a PR.

Default: knowledge auto-applies at confidence ≥0.85 in `'write'`
mode (wiki edits are git-reversible); improvement stays at
`enabled: false` until the agent author has measured precision.

***

### AgentRubric

Defined in: [agent/define-agent.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L118)

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

Defined in: [agent/define-agent.ts:120](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L120)

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

##### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](#judgeconfig)\<`TRunOutput`\>[]

Defined in: [agent/define-agent.ts:126](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L126)

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.

***

### RubricDimension

Defined in: [agent/define-agent.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L129)

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

Defined in: [agent/define-agent.ts:131](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L131)

Unique identifier — appears in finding subjects (`rubric:<id>`).

##### weight

> **weight**: `number`

Defined in: [agent/define-agent.ts:133](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L133)

0..1 — weight in the composite.

##### score

> **score**: (`input`) => `number`

Defined in: [agent/define-agent.ts:139](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L139)

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

Defined in: [agent/define-agent.ts:141](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L141)

Optional human-readable label for reports.

***

### JudgeConfig

Defined in: [agent/define-agent.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L144)

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

Defined in: [agent/define-agent.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L146)

Judge identifier — appears in trace spans + manifest.

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L148)

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

##### dimensions

> **dimensions**: readonly `string`[]

Defined in: [agent/define-agent.ts:150](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L150)

Dimensions this judge scores.

##### anchors?

> `optional` **anchors?**: readonly `object`[]

Defined in: [agent/define-agent.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L156)

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).

***

### AgentRuntime

Defined in: [agent/define-agent.ts:159](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L159)

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

Defined in: [agent/define-agent.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L184)

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

Defined in: [agent/define-agent.ts:187](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L187)

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

Defined in: [agent/define-agent.ts:189](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L189)

Live stream of typed runtime events. Consumed by chat UX directly.

##### output

> **output**: `Promise`\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L191)

Final structured output the rubric scores. Resolves after `events` drains.

***

### AgentRunContext

Defined in: [agent/define-agent.ts:231](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L231)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Defined in: [agent/define-agent.ts:233](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L233)

Substrate-managed trace emitter.

##### runId

> **runId**: `string`

Defined in: [agent/define-agent.ts:235](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L235)

Stable run id for this persona × variant cell.

##### variantId?

> `optional` **variantId?**: `string`

Defined in: [agent/define-agent.ts:237](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L237)

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [agent/define-agent.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L239)

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [agent/define-agent.ts:241](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L241)

Optional abort signal.

***

### AnalystConfig

Defined in: [agent/define-agent.ts:244](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L244)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:246](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L246)

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

##### budgetUsd?

> `optional` **budgetUsd?**: `number`

Defined in: [agent/define-agent.ts:248](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L248)

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

##### backend?

> `optional` **backend?**: `object`

Defined in: [agent/define-agent.ts:250](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L250)

Backend hint for the AxAIService factory — same shape every kind uses.

###### name?

> `optional` **name?**: `"openai"` \| `"router"`

###### apiKey?

> `optional` **apiKey?**: `string`

###### baseUrl?

> `optional` **baseUrl?**: `string`

***

### AutoApplyPolicy

Defined in: [agent/define-agent.ts:257](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L257)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### knowledge?

> `optional` **knowledge?**: `object`

Defined in: [agent/define-agent.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L258)

###### enabled

> **enabled**: `boolean`

###### confidenceThreshold?

> `optional` **confidenceThreshold?**: `number`

###### mode?

> `optional` **mode?**: `"write"` \| `"open-pr"`

##### improvement?

> `optional` **improvement?**: `object`

Defined in: [agent/define-agent.ts:263](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L263)

###### enabled

> **enabled**: `boolean`

###### confidenceThreshold?

> `optional` **confidenceThreshold?**: `number`

###### mode?

> `optional` **mode?**: `"write"` \| `"open-pr"`

***

### SurfaceImprovementEdit

Defined in: [agent/improvement-adapter.ts:43](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L43)

#### Properties

##### id

> **id**: `string`

Defined in: [agent/improvement-adapter.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L45)

Stable id derived from the source finding so re-proposals are idempotent.

##### sourceFindingId

> **sourceFindingId**: `string`

Defined in: [agent/improvement-adapter.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L47)

The finding that produced this edit — for revert + audit trail.

##### subject

> **subject**: `FindingSubject`

Defined in: [agent/improvement-adapter.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L49)

Parsed subject; included so the apply step doesn't re-parse.

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

Defined in: [agent/improvement-adapter.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L51)

Resolved on-disk target.

##### baseSha256

> **baseSha256**: `string`

Defined in: [agent/improvement-adapter.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L53)

SHA-256 of the current file content the patch was drafted against.

##### patch

> **patch**: `string`

Defined in: [agent/improvement-adapter.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L55)

Unified-diff patch the LLM drafted (relative to `target.absolutePath`).

##### summary

> **summary**: `string`

Defined in: [agent/improvement-adapter.ts:57](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L57)

One-line summary the operator sees in the report / PR title.

##### rationale

> **rationale**: `string`

Defined in: [agent/improvement-adapter.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L59)

Multi-line rationale for the PR body — finding context + LLM reasoning.

##### confidence

> **confidence**: `number`

Defined in: [agent/improvement-adapter.ts:61](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L61)

Carry-forward from the finding so the apply gate can check the threshold.

##### severity

> **severity**: `AnalystSeverity`

Defined in: [agent/improvement-adapter.ts:63](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L63)

Carry-forward severity for prioritization.

***

### CreateSurfaceImprovementAdapterOpts

Defined in: [agent/improvement-adapter.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L66)

#### Properties

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/improvement-adapter.ts:67](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L67)

##### repoRoot

> **repoRoot**: `string`

Defined in: [agent/improvement-adapter.ts:68](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L68)

##### draftPatch

> **draftPatch**: (`input`) => `Promise`\<[`DraftPatchOutput`](#draftpatchoutput)\>

Defined in: [agent/improvement-adapter.ts:77](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L77)

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

##### mode?

> `optional` **mode?**: `"none"` \| `"write"` \| `"open-pr"`

Defined in: [agent/improvement-adapter.ts:88](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L88)

Apply mode:
  `write` — `git apply` in-place; operator reviews via `git diff`
  `open-pr` — branch + commit + push + `gh pr create`
  `none` — never apply; collect proposals for the report only

The `apply` method honours this even when the loop calls it; the
effective behaviour is also gated on the per-finding confidence
threshold via `runAnalystLoop`'s `autoApply` policy.

##### baseBranch?

> `optional` **baseBranch?**: `string`

Defined in: [agent/improvement-adapter.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L90)

When `mode === 'open-pr'`, the base branch new PRs target. Default: `main`.

##### ghRepo?

> `optional` **ghRepo?**: `string`

Defined in: [agent/improvement-adapter.ts:92](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L92)

Required for `mode === 'open-pr'` — the GH owner/repo (`tangle-network/tax-agent`).

##### allowCreateForKinds?

> `optional` **allowCreateForKinds?**: readonly (`"knowledge.wiki"` \| `"knowledge.claim"` \| `"knowledge.raw"` \| `"knowledge.stale"` \| `"system-prompt"` \| `"tool-doc"` \| `"new-tool"` \| `"rag"` \| `"memory"` \| `"scaffolding"` \| `"output-schema"` \| `"websearch.outdated"` \| `"prior-run-summary"` \| `"cluster"`)[]

Defined in: [agent/improvement-adapter.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L100)

When the resolved target doesn't exist, allow the substrate to
CREATE the file (for `knowledge.wiki`, `new-tool` subjects). Default
true for those kinds, false for `system-prompt` / `rubric` / etc.
(named sections that don't exist are a contract violation, not a
scaffolding opportunity).

***

### DraftPatchInput

Defined in: [agent/improvement-adapter.ts:103](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L103)

#### Properties

##### finding

> **finding**: `AnalystFinding`

Defined in: [agent/improvement-adapter.ts:104](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L104)

##### subject

> **subject**: `FindingSubject`

Defined in: [agent/improvement-adapter.ts:105](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L105)

##### target

> **target**: [`ResolvedSurface`](#resolvedsurface)

Defined in: [agent/improvement-adapter.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L106)

##### currentContent

> **currentContent**: `string`

Defined in: [agent/improvement-adapter.ts:108](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L108)

Current file content (empty string when `intent === 'create-new'`).

***

### DraftPatchOutput

Defined in: [agent/improvement-adapter.ts:111](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L111)

#### Properties

##### patch

> **patch**: `string`

Defined in: [agent/improvement-adapter.ts:113](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L113)

Unified diff against the current file content. Empty string skips this finding.

##### summary

> **summary**: `string`

Defined in: [agent/improvement-adapter.ts:115](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L115)

One-line summary for the operator.

##### rationale

> **rationale**: `string`

Defined in: [agent/improvement-adapter.ts:117](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L117)

Multi-line rationale for the PR body.

***

### CreateSurfaceKnowledgeAdapterOpts

Defined in: [agent/knowledge-adapter.ts:21](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L21)

#### Properties

##### knowledgeRoot

> **knowledgeRoot**: `string`

Defined in: [agent/knowledge-adapter.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L23)

`.agent-knowledge/` root (absolute path the substrate writes blocks against).

***

### KnowledgeAdapterDeps

Defined in: [agent/knowledge-adapter.ts:40](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L40)

Build the adapter. We accept the agent-knowledge functions as DI so
the substrate stays decoupled from a specific agent-knowledge
version — the agent author imports them in their manifest module
and hands them to the factory.

`proposeFromFindings(findings)` returns
  `{ proposals: KnowledgeProposal[]; skipped: number; errors: ... }`.

`applyKnowledgeWriteBlocks(root, content)` returns
  `{ written: string[]; warnings: string[] }`.

`lintKnowledgeIndex(index)` (optional) returns `KnowledgeLintFinding[]`.

#### Type Parameters

##### TProposal

`TProposal`

#### Properties

##### proposeFromFindings

> **proposeFromFindings**: (`findings`) => `object`

Defined in: [agent/knowledge-adapter.ts:41](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L41)

###### Parameters

###### findings

readonly `AnalystFinding`[]

###### Returns

`object`

###### proposals

> **proposals**: `TProposal`[]

###### skipped

> **skipped**: `number`

###### errors

> **errors**: `object`[]

##### applyKnowledgeWriteBlocks

> **applyKnowledgeWriteBlocks**: (`root`, `proposalText`) => `Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

Defined in: [agent/knowledge-adapter.ts:46](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L46)

###### Parameters

###### root

`string`

###### proposalText

`string`

###### Returns

`Promise`\<\{ `written`: `string`[]; `warnings`: `string`[]; \}\>

##### lintAfterApply?

> `optional` **lintAfterApply?**: (`root`) => `Promise`\<readonly `string`[]\>

Defined in: [agent/knowledge-adapter.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L55)

Optional post-apply lint hook. The substrate runs it after each
batch of writes; failures land in `warnings` (the apply is not
rolled back — lint signals drift to review, not block).

###### Parameters

###### root

`string`

###### Returns

`Promise`\<readonly `string`[]\>

***

### OutcomeMeasurement

Defined in: [agent/outcome.ts:23](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L23)

#### Properties

##### baselineComposite

> **baselineComposite**: `number`

Defined in: [agent/outcome.ts:25](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L25)

Baseline composite before applies — captured from the most-recent eval run.

##### afterComposite

> **afterComposite**: `number`

Defined in: [agent/outcome.ts:27](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L27)

Composite after re-running the cohort with applied edits.

##### delta

> **delta**: `number`

Defined in: [agent/outcome.ts:29](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L29)

`afterComposite - baselineComposite`. Positive = the loop improved the agent.

##### perPersona

> **perPersona**: readonly `object`[]

Defined in: [agent/outcome.ts:31](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L31)

Per-persona deltas for finer-grained review.

##### rolledBackPaths

> **rolledBackPaths**: readonly `string`[]

Defined in: [agent/outcome.ts:33](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L33)

When the substrate rolled back applies due to regression, the paths reverted.

***

### OutcomeMeasurementOpts

Defined in: [agent/outcome.ts:36](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L36)

#### Properties

##### baseline

> **baseline**: readonly `object`[]

Defined in: [agent/outcome.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L38)

Composite scores from the run that produced the findings.

##### reRunCohort

> **reRunCohort**: (`personaIds`) => `Promise`\<readonly `object`[]\>

Defined in: [agent/outcome.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L47)

Re-run callback — the substrate invokes this after applies. The
agent author provides their `runAgentEval`-equivalent so the
substrate can ask "score this persona slice now."

The callback SHOULD reuse the same cohort + judges + variant as
the baseline run; only the agent's mutable surfaces have changed.

###### Parameters

###### personaIds

readonly `string`[]

###### Returns

`Promise`\<readonly `object`[]\>

##### rollbackOnRegression?

> `optional` **rollbackOnRegression?**: `boolean`

Defined in: [agent/outcome.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L51)

When `true`, applied edits are reverted on negative delta. Default `false`.

##### revert?

> `optional` **revert?**: (`paths`) => `Promise`\<`void`\>

Defined in: [agent/outcome.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L53)

Callback to revert a list of paths (typically `git checkout HEAD --`).

###### Parameters

###### paths

readonly `string`[]

###### Returns

`Promise`\<`void`\>

***

### CreateSandboxActOptions

Defined in: [agent/sandbox-act.ts:47](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L47)

#### Type Parameters

##### TPersona

`TPersona`

##### TRunOutput

`TRunOutput`

#### Properties

##### baseProfile

> **baseProfile**: `AgentProfile`

Defined in: [agent/sandbox-act.ts:49](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L49)

Canonical agent profile — the same one the prod chat turn uses.

##### sandboxClient

> **sandboxClient**: [`SandboxClient`](runtime.md#sandboxclient-1)

Defined in: [agent/sandbox-act.ts:51](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L51)

Sandbox client used to boot the per-run sandbox.

##### buildPrompt

> **buildPrompt**: (`persona`) => `string`

Defined in: [agent/sandbox-act.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L53)

Persona → prompt. Pure; the eval cell's input.

###### Parameters

###### persona

`TPersona`

###### Returns

`string`

##### output

> **output**: [`OutputAdapter`](runtime.md#outputadapter)\<`TRunOutput`\>

Defined in: [agent/sandbox-act.ts:55](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L55)

Sandbox event stream → typed output the rubric scores.

##### compose?

> `optional` **compose?**: (`persona`) => `SandboxActComposeOverrides`

Defined in: [agent/sandbox-act.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L60)

Per-persona profile overrides (workspace-augmented system prompt, extra
file mounts, tool flags, MCP connections). Overlaid onto `baseProfile`.

###### Parameters

###### persona

`TPersona`

###### Returns

`SandboxActComposeOverrides`

##### sandboxOverrides?

> `optional` **sandboxOverrides?**: `Partial`\<`Omit`\<`CreateSandboxOptions`, `"backend"`\>\> & `object`

Defined in: [agent/sandbox-act.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L62)

Sandbox-SDK overrides forwarded to `createSandboxForSpec`.

###### Type Declaration

###### backend?

> `optional` **backend?**: `Omit`\<`BackendConfig`, `"profile"`\>

##### name?

> `optional` **name?**: `string`

Defined in: [agent/sandbox-act.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L64)

Stable run name surfaced in mapped `llm_call` events.

##### mapEvent?

> `optional` **mapEvent?**: (`event`, `opts`) => [`RuntimeStreamEvent`](index.md#runtimestreamevent) \| `undefined`

Defined in: [agent/sandbox-act.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L66)

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

***

### ResolvedSurface

Defined in: [agent/surfaces.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L58)

#### Properties

##### absolutePath

> **absolutePath**: `string`

Defined in: [agent/surfaces.ts:60](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L60)

Absolute filesystem path the operator can `cat` / `vim`.

##### repoRelativePath

> **repoRelativePath**: `string`

Defined in: [agent/surfaces.ts:62](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L62)

Repo-relative path for PR descriptions, diffs, audit logs.

##### exists

> **exists**: `boolean`

Defined in: [agent/surfaces.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L64)

Whether the path currently exists on disk.

##### intent

> **intent**: `"edit-existing"` \| `"create-new"`

Defined in: [agent/surfaces.ts:66](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L66)

The substrate's intent: edit an existing file or create a new one.

***

### SurfaceValidationIssue

Defined in: [agent/surfaces.ts:191](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L191)

Validate that every declared surface exists on disk under `repoRoot`.

Returns an array of `SurfaceValidationIssue` — empty when all required
surfaces resolve. `defineAgent` throws with the issues rendered, so
a misconfigured manifest fails at startup (not at the first finding
the loop produces 20 minutes later).

#### Properties

##### surface

> **surface**: keyof [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/surfaces.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L192)

##### path

> **path**: `string`

Defined in: [agent/surfaces.ts:193](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L193)

##### reason

> **reason**: `"missing"` \| `"not-directory"` \| `"not-file"`

Defined in: [agent/surfaces.ts:194](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L194)

## Functions

### unimplementedAgentRun()

> **unimplementedAgentRun**\<`TRunOutput`\>(`reason?`): [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:203](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L203)

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

Defined in: [agent/define-agent.ts:222](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L222)

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

Defined in: [agent/define-agent.ts:296](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L296)

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

### createSurfaceImprovementAdapter()

> **createSurfaceImprovementAdapter**(`opts`): [`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

Defined in: [agent/improvement-adapter.ts:129](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L129)

#### Parameters

##### opts

[`CreateSurfaceImprovementAdapterOpts`](#createsurfaceimprovementadapteropts)

#### Returns

[`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### createSurfaceKnowledgeAdapter()

> **createSurfaceKnowledgeAdapter**\<`TProposal`\>(`opts`, `deps`): [`KnowledgeAdapter`](analyst-loop.md#knowledgeadapter)\<`TProposal`\>

Defined in: [agent/knowledge-adapter.ts:58](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L58)

#### Type Parameters

##### TProposal

`TProposal`

#### Parameters

##### opts

[`CreateSurfaceKnowledgeAdapterOpts`](#createsurfaceknowledgeadapteropts)

##### deps

[`KnowledgeAdapterDeps`](#knowledgeadapterdeps)\<`TProposal`\>

#### Returns

[`KnowledgeAdapter`](analyst-loop.md#knowledgeadapter)\<`TProposal`\>

***

### measureOutcome()

> **measureOutcome**\<`TProposal`, `TEdit`\>(`result`, `opts`): `Promise`\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\> & `object`\>

Defined in: [agent/outcome.ts:65](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/outcome.ts#L65)

Run `runAnalystLoop` and stamp an `OutcomeMeasurement` onto the
result. The substrate calls this after each canonical eval; the
delta lands in `loop-report.json` for cross-run trend analysis.

The function returns the original `RunAnalystLoopResult` enriched
with `outcome` so callers stay backwards-compatible (the field is
optional on the type; missing means no measurement was wired).

#### Type Parameters

##### TProposal

`TProposal`

##### TEdit

`TEdit`

#### Parameters

##### result

[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>

##### opts

[`OutcomeMeasurementOpts`](#outcomemeasurementopts)

#### Returns

`Promise`\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\> & `object`\>

***

### createSandboxAct()

> **createSandboxAct**\<`TPersona`, `TRunOutput`\>(`options`): (`persona`, `ctx`) => [`AgentRunInvocation`](#agentruninvocation)\<`TRunOutput`\>

Defined in: [agent/sandbox-act.ts:78](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/sandbox-act.ts#L78)

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

Defined in: [agent/surfaces.ts:86](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L86)

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

Defined in: [agent/surfaces.ts:197](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L197)

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

Defined in: [agent/surfaces.ts:245](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/surfaces.ts#L245)

#### Parameters

##### issues

readonly [`SurfaceValidationIssue`](#surfacevalidationissue)[]

##### repoRoot

`string`

#### Returns

`string`
