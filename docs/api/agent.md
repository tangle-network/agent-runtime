[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / agent

# agent

## Classes

### AgentManifestError

Defined in: [agent/define-agent.ts:309](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L309)

Thrown when `defineAgent` finds a required surface missing on disk.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentManifestError**(`message`, `agentId`, `issues?`): [`AgentManifestError`](#agentmanifesterror)

Defined in: [agent/define-agent.ts:310](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L310)

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

Defined in: [agent/define-agent.ts:312](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L312)

##### issues

> `readonly` **issues**: readonly `unknown`[] = `[]`

Defined in: [agent/define-agent.ts:313](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L313)

## Interfaces

### AgentManifest

Defined in: [agent/define-agent.ts:38](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L38)

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

Defined in: [agent/define-agent.ts:45](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L45)

Stable identifier — used as `projectId` in traces, as the analyst
loop's `runId` prefix, and as the namespace under which findings
are persisted. MUST match the agent's repo name to keep
cross-repo telemetry joinable.

##### repoRoot

> **repoRoot**: `string`

Defined in: [agent/define-agent.ts:53](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L53)

Filesystem root the substrate resolves surface paths against.
Typically `process.cwd()` or a fixed absolute path. Use an
absolute path when the agent's tests may run from subdirectories
(vitest sometimes shifts cwd).

##### surfaces

> **surfaces**: [`AgentSurfaces`](#agentsurfaces)

Defined in: [agent/define-agent.ts:64](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L64)

Map of mutable surfaces the self-improvement loop can edit. See
`AgentSurfaces` — required: `systemPrompt`, `tools`, `rubric`,
`knowledge`, `personas`. Optional: `scaffolding`, `memory`, `rag`,
`outputSchema`.

Every required path is validated at `defineAgent` time. Missing
paths throw with the full list of offenders.

##### rubric

> **rubric**: [`AgentRubric`](#agentrubric)\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:71](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L71)

Rubric the substrate uses to score each run. Dimensions × weights
× judges. The substrate computes the weighted composite and
stamps it into the RunRecord.

##### runtime

> **runtime**: [`AgentRuntime`](#agentruntime)\<`TPersona`, `TRunOutput`\>

Defined in: [agent/define-agent.ts:82](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L82)

Runtime adapter — how the substrate INVOKES the agent against a
persona. The `act` function takes a persona + a context (with the
tracer the substrate threads through for span emission) and
returns the run output the rubric will score.

The agent's existing production runtime goes in here; the
substrate is intentionally thin around it.

##### personas

> **personas**: () => `Promise`\<readonly `TPersona`[]\>

Defined in: [agent/define-agent.ts:90](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L90)

Persona discovery — the substrate loads personas via this function
at eval start. Can read from `surfaces.personas`, an API, or be
hardcoded. The substrate calls it once per `runAgentEval` call;
persona ordering is preserved.

###### Returns

`Promise`\<readonly `TPersona`[]\>

##### analystKinds

> **analystKinds**: readonly `TraceAnalystKindSpec`[]

Defined in: [agent/define-agent.ts:100](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L100)

Analyst kinds the substrate runs against each persona's trace.
Defaults to `DEFAULT_TRACE_ANALYST_KINDS` from agent-eval. Per-agent
authors can prune (e.g. skip `knowledge-poisoning` when there's no
knowledge base) or extend (custom domain kinds).

Empty array disables the loop — useful for `pnpm eval --no-analyst`.

##### analyst

> **analyst**: [`AnalystConfig`](#analystconfig)

Defined in: [agent/define-agent.ts:106](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L106)

Analyst LLM configuration. The substrate uses these for all four
kinds (override per-kind via `analystKinds` if needed).

##### autoApply?

> `optional` **autoApply?**: [`AutoApplyPolicy`](#autoapplypolicy)

Defined in: [agent/define-agent.ts:118](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L118)

Auto-apply policy. Knowledge / improvement edits land only when
`enabled === true` AND the source finding's confidence meets the
threshold. `mode` controls how applies happen: `'write'` mutates
files in-place; `'open-pr'` writes to a branch and opens a PR.

Default: knowledge auto-applies at confidence ≥0.85 in `'write'`
mode (wiki edits are git-reversible); improvement stays at
`enabled: false` until the agent author has measured precision.

##### lifecycles?

> `optional` **lifecycles?**: readonly [`SurfaceLifecycle`](#surfacelifecycle)[]

Defined in: [agent/define-agent.ts:134](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L134)

Declarative per-surface artifact-lifecycle config the closed loop reads.

Each entry names a profile surface (`skill` / `tool` / `prompt` / `mcp` /
`hook` / `subagent`) and supplies the `CandidateGenerator` that grows it +
the `PromotionGate` (the held-back exam) that decides promotion. `runLifecycle`
consumes these: it pools the generators, measures each candidate's marginal
lift on the held-back split, gates it, and stores the winners in an
`ArtifactRegistry` — then `composeProfile` folds the top-`k` active artifacts
back into this agent's profile.

Optional — agents that don't self-improve their profile omit it. An empty or
absent map means "no lifecycle"; the manifest is otherwise unchanged.

***

### SurfaceLifecycle

Defined in: [agent/define-agent.ts:142](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L142)

One profile surface's artifact-lifecycle wiring — the declarative config a
`defineAgent` manifest carries and `runLifecycle` reads. It is config, not
execution: it names the generator + gate; the loop runs them.

#### Properties

##### surface

> **surface**: [`ArtifactKind`](lifecycle.md#artifactkind)

Defined in: [agent/define-agent.ts:144](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L144)

The profile surface this lifecycle grows.

##### generator

> **generator**: [`CandidateGenerator`](lifecycle.md#candidategenerator)

Defined in: [agent/define-agent.ts:146](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L146)

Produces fresh candidate artifacts for `surface` from the agent's history.

##### gate

> **gate**: [`PromotionGate`](lifecycle.md#promotiongate)

Defined in: [agent/define-agent.ts:148](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L148)

The held-back exam that decides promotion of a measured candidate.

##### composeK?

> `optional` **composeK?**: `number`

Defined in: [agent/define-agent.ts:151](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L151)

Top-`k` budget for `composeProfile` when folding this surface's promoted
 artifacts back in. Omit to fold in every active artifact.

***

### AgentRubric

Defined in: [agent/define-agent.ts:154](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L154)

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

Defined in: [agent/define-agent.ts:156](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L156)

Dimensions composing the weighted score. Weights sum to 1.0 by convention.

##### judges?

> `optional` **judges?**: readonly [`JudgeConfig`](#judgeconfig)\<`TRunOutput`\>[]

Defined in: [agent/define-agent.ts:162](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L162)

Optional judges layered on top of deterministic dimensions. Each
judge returns a score per dimension; the substrate averages judges
(mean by default) for the LLM contribution.

***

### RubricDimension

Defined in: [agent/define-agent.ts:165](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L165)

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

Defined in: [agent/define-agent.ts:167](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L167)

Unique identifier — appears in finding subjects (`rubric:<id>`).

##### weight

> **weight**: `number`

Defined in: [agent/define-agent.ts:169](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L169)

0..1 — weight in the composite.

##### score

> **score**: (`input`) => `number`

Defined in: [agent/define-agent.ts:175](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L175)

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

Defined in: [agent/define-agent.ts:177](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L177)

Optional human-readable label for reports.

***

### JudgeConfig

Defined in: [agent/define-agent.ts:180](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L180)

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

Defined in: [agent/define-agent.ts:182](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L182)

Judge identifier — appears in trace spans + manifest.

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:184](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L184)

Model snapshot to invoke. Pin the snapshot (`claude-sonnet-4-6@2025-04-15`); the validator rejects bare aliases.

##### dimensions

> **dimensions**: readonly `string`[]

Defined in: [agent/define-agent.ts:186](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L186)

Dimensions this judge scores.

##### anchors?

> `optional` **anchors?**: readonly `object`[]

Defined in: [agent/define-agent.ts:192](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L192)

Optional rubric anchors — text examples the judge sees as a
few-shot prompt to calibrate. STRONGLY recommended for subjective
dimensions; required by the calibration gate (Pearson ≥0.7).

***

### AgentRuntime

Defined in: [agent/define-agent.ts:195](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L195)

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

Defined in: [agent/define-agent.ts:220](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L220)

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

Defined in: [agent/define-agent.ts:223](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L223)

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

Defined in: [agent/define-agent.ts:225](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L225)

Live stream of typed runtime events. Consumed by chat UX directly.

##### output

> **output**: `Promise`\<`TRunOutput`\>

Defined in: [agent/define-agent.ts:227](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L227)

Final structured output the rubric scores. Resolves after `events` drains.

***

### AgentRunContext

Defined in: [agent/define-agent.ts:267](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L267)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### emitter

> **emitter**: `TraceEmitter`

Defined in: [agent/define-agent.ts:269](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L269)

Substrate-managed trace emitter.

##### runId

> **runId**: `string`

Defined in: [agent/define-agent.ts:271](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L271)

Stable run id for this persona × variant cell.

##### variantId?

> `optional` **variantId?**: `string`

Defined in: [agent/define-agent.ts:273](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L273)

Variant the runtime is exercising (e.g. `'baseline'`, `'source-grounded'`).

##### deadlineMs?

> `optional` **deadlineMs?**: `number`

Defined in: [agent/define-agent.ts:275](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L275)

Wall-clock deadline (epoch ms). The runtime SHOULD honour for graceful cancel.

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: [agent/define-agent.ts:277](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L277)

Optional abort signal.

***

### AnalystConfig

Defined in: [agent/define-agent.ts:280](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L280)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### model

> **model**: `string`

Defined in: [agent/define-agent.ts:282](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L282)

Model the analyst kinds use. Override per-kind via `analystKinds[i].cost.models`.

##### budgetUsd?

> `optional` **budgetUsd?**: `number`

Defined in: [agent/define-agent.ts:284](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L284)

Optional total budget across all kinds for one run. Substrate enforces via `BudgetGuard`.

##### backend?

> `optional` **backend?**: `object`

Defined in: [agent/define-agent.ts:286](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L286)

Backend hint for the AxAIService factory — same shape every kind uses.

###### name?

> `optional` **name?**: `"router"` \| `"openai"`

###### apiKey?

> `optional` **apiKey?**: `string`

###### baseUrl?

> `optional` **baseUrl?**: `string`

***

### AutoApplyPolicy

Defined in: [agent/define-agent.ts:293](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L293)

`@tangle-network/agent-runtime/agent` — declarative agent manifest +
substrate-default adapters.

Every vertical agent (tax / legal / gtm / creative / N future
verticals) ships ONE `defineAgent({...})` call + a thin invocation
of `runAnalystLoop` wired through the substrate-default adapters.
No per-vertical glue. No fabricated paths. No theater.

#### Properties

##### knowledge?

> `optional` **knowledge?**: `object`

Defined in: [agent/define-agent.ts:294](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L294)

###### enabled

> **enabled**: `boolean`

###### confidenceThreshold?

> `optional` **confidenceThreshold?**: `number`

###### mode?

> `optional` **mode?**: `"write"` \| `"open-pr"`

##### improvement?

> `optional` **improvement?**: `object`

Defined in: [agent/define-agent.ts:299](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L299)

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

> `optional` **allowCreateForKinds?**: readonly (`"code"` \| `"mcp"` \| `"memory"` \| `"agent-profile"` \| `"skill"` \| `"hook"` \| `"subagent"` \| `"knowledge.wiki"` \| `"knowledge.claim"` \| `"knowledge.raw"` \| `"knowledge.stale"` \| `"system-prompt"` \| `"tool-doc"` \| `"new-tool"` \| `"workflow"` \| `"rollout-policy"` \| `"rag"` \| `"scaffolding"` \| `"output-schema"` \| `"websearch.outdated"` \| `"prior-run-summary"` \| `"cluster"`)[]

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

Defined in: [agent/define-agent.ts:239](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L239)

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

Defined in: [agent/define-agent.ts:258](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L258)

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

Defined in: [agent/define-agent.ts:333](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/define-agent.ts#L333)

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

Defined in: [agent/improvement-adapter.ts:130](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/improvement-adapter.ts#L130)

The substrate-default `ImprovementAdapter`: resolve each finding's subject to a real surface path, LLM-draft a unified-diff patch, then auto-apply or open a PR.

#### Parameters

##### opts

[`CreateSurfaceImprovementAdapterOpts`](#createsurfaceimprovementadapteropts)

#### Returns

[`ImprovementAdapter`](analyst-loop.md#improvementadapter)\<[`SurfaceImprovementEdit`](#surfaceimprovementedit)\>

***

### createSurfaceKnowledgeAdapter()

> **createSurfaceKnowledgeAdapter**\<`TProposal`\>(`opts`, `deps`): [`KnowledgeAdapter`](analyst-loop.md#knowledgeadapter)\<`TProposal`\>

Defined in: [agent/knowledge-adapter.ts:59](https://github.com/tangle-network/agent-runtime/blob/main/src/agent/knowledge-adapter.ts#L59)

Wire a surface-based `KnowledgeAdapter` that writes analyst proposals to agent surface files.

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
