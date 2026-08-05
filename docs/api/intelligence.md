[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / intelligence

# intelligence

**`Stable`**

Tangle Intelligence SDK — trace capture plus reviewable improvement.

The client keeps live-agent trace delivery best-effort. The separate
improvement-cycle exports analyze completed traces, run a signed baseline
versus candidate experiment, bind review to its result, and activate only
the exact measured candidate.

  1. OBSERVE — wrap a generic agent and export one trace span per call to
     Tangle Intelligence, swallowing every export failure so a live agent
     never fails because Intelligence is down.
  2. MODE 0 / OFF — at `effort: 'off'`, run the agent as PURE PASSTHROUGH
     (zero intelligence spawns) with best-effort telemetry still on. The
     exported trace tags usage by class `{ inferenceUsd, intelligenceUsd }`,
     and at OFF `intelligenceUsd` is provably `0` — the mechanism that proves
     an OFF customer paid inference-only.

## Classes

### CapabilityNotAdmittedError

A binding kind whose resolver case is typed but not yet admitted (rag-index,
memory-store, wasm, a2a). Thrown by the resolver — NEVER faked into a working
surface. The TYPE arms exist so the union is closed against the spec; the
resolver grows them later behind their lifecycle + admission gate.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new CapabilityNotAdmittedError**(`kind`, `capabilityId`, `reason`): [`CapabilityNotAdmittedError`](#capabilitynotadmittederror)

###### Parameters

###### kind

`"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

###### capabilityId

`string`

###### reason

`string`

###### Returns

[`CapabilityNotAdmittedError`](#capabilitynotadmittederror)

###### Overrides

`Error.constructor`

#### Properties

##### kind

> `readonly` **kind**: `"inline"` \| `"file"` \| `"http"` \| `"sandbox-code"` \| `"mcp-stdio"` \| `"mcp-remote"` \| `"process-on-infra"` \| `"rag-index"` \| `"memory-store"` \| `"wasm"` \| `"a2a"`

##### capabilityId

> `readonly` **capabilityId**: `string`

***

### AgentCandidateExperimentCellExecutionError

A failed baseline or candidate cell with its complete Runtime failure result.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentCandidateExperimentCellExecutionError**(`finalization`): [`AgentCandidateExperimentCellExecutionError`](#agentcandidateexperimentcellexecutionerror)

###### Parameters

###### finalization

###### succeeded

`false`

###### reason

`string`

###### partial

\{ `executionId`: `string`; `bundleDigest`: `` `sha256:${string}` ``; `executionPlanDigest`: `` `sha256:${string}` ``; `materializationReceiptDigest`: `` `sha256:${string}` ``; `termination?`: `AgentCandidateTermination`; \}

###### partial.executionId

`string`

###### partial.bundleDigest

`` `sha256:${string}` ``

###### partial.executionPlanDigest

`` `sha256:${string}` ``

###### partial.materializationReceiptDigest

`` `sha256:${string}` ``

###### partial.termination?

`AgentCandidateTermination`

###### usage

`AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

###### Returns

[`AgentCandidateExperimentCellExecutionError`](#agentcandidateexperimentcellexecutionerror)

###### Overrides

`Error.constructor`

#### Properties

##### finalization

> `readonly` **finalization**: `object`

###### succeeded

> **succeeded**: `false`

###### reason

> **reason**: `string`

###### partial

> **partial**: `object`

###### partial.executionId

> **executionId**: `string`

###### partial.bundleDigest

> **bundleDigest**: `` `sha256:${string}` ``

###### partial.executionPlanDigest

> **executionPlanDigest**: `` `sha256:${string}` ``

###### partial.materializationReceiptDigest

> **materializationReceiptDigest**: `` `sha256:${string}` ``

###### partial.termination?

> `optional` **termination?**: `AgentCandidateTermination`

###### usage

> **usage**: `AgentCandidateFixedSpend` \| `null`

Independent evaluator-gateway usage, even when execution or trace capture failed.

## Interfaces

### CreateAgentImprovementActivationResultOptions

#### Properties

##### completedAt

> **completedAt**: `string`

##### outcome

> **outcome**: `AgentImprovementActivationOutcome`

***

### AgentImprovementActivationTargetPlan

#### Extends

- `AgentImprovementActivationTarget`

#### Properties

##### desiredDigest

> **desiredDigest**: `` `sha256:${string}` ``

##### desiredInput

> **desiredInput**: `unknown`

Exact measured input the product must apply to reach `desiredDigest`.
Transition surfaces such as code and knowledge are applied operations, so
their resulting state digest is not the digest of this input document.

***

### AgentProfileImprovementActivationTargetPlan

#### Extends

- `AgentImprovementActivationTarget`

#### Properties

##### desiredDigest

> **desiredDigest**: `` `sha256:${string}` ``

##### desiredInput

> **desiredInput**: [`AgentProfileImprovementActivationOperation`](#agentprofileimprovementactivationoperation)

***

### SealedCandidateActivationTransitionInput

#### Properties

##### kind

> **kind**: `"sealed-candidate"`

##### activation

> **activation**: `AgentImprovementActivation`

##### candidateBundle

> **candidateBundle**: `AgentCandidateBundle`

##### bundle

> **bundle**: `AgentCandidateBundle`

##### targets

> **targets**: \[[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `...AgentImprovementActivationTargetPlan[]`\]

##### attemptedAt

> **attemptedAt**: `string`

##### expired

> **expired**: `boolean`

***

### ProfileImprovementActivationTransitionInput

A measured profile change without raw profile bytes.
The product owns the private state lookup and atomic write.

#### Properties

##### kind

> **kind**: `"profile-improvement"`

##### activation

> **activation**: `AgentImprovementActivation`

##### experiment

> **experiment**: `AgentProfileImprovementExperiment`

##### sourceStateDigest

> **sourceStateDigest**: `` `sha256:${string}` ``

##### desiredStateDigest

> **desiredStateDigest**: `` `sha256:${string}` ``

##### operation

> **operation**: [`AgentProfileImprovementActivationOperation`](#agentprofileimprovementactivationoperation)

##### targets

> **targets**: \[[`AgentProfileImprovementActivationTargetPlan`](#agentprofileimprovementactivationtargetplan), `...AgentProfileImprovementActivationTargetPlan[]`\]

##### attemptedAt

> **attemptedAt**: `string`

##### expired

> **expired**: `boolean`

***

### AgentImprovementActivationResultStore

#### Methods

##### load()

> **load**(`idempotencyKey`): `Promise`\<`unknown`\>

###### Parameters

###### idempotencyKey

`` `sha256:${string}` ``

###### Returns

`Promise`\<`unknown`\>

##### putIfAbsent()

> **putIfAbsent**(`result`): `Promise`\<`unknown`\>

###### Parameters

###### result

`AgentImprovementActivationResult`

###### Returns

`Promise`\<`unknown`\>

***

### ExecuteAgentImprovementActivationInput

#### Properties

##### proposal

> **proposal**: `AgentImprovementProposal`

##### review

> **review**: `AgentImprovementReview`

##### activation

> **activation**: `AgentImprovementActivation`

***

### ExecuteAgentImprovementActivationOptions

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](#agentimprovementactivationtransition)

##### reconcile?

> `optional` **reconcile?**: [`AgentImprovementActivationReconciliation`](#agentimprovementactivationreconciliation)

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### CredentialRef

A named secret a binding requires — declared, never carried.

#### Properties

##### key

> **key**: `string`

***

### HostSpec

The host a `process-on-infra` binding provisions before its inner binding.
Reuses `createExecutor`'s backend-as-data vocabulary — no new runtime invented.
`image` is the sandbox image tag; `warm`/`idleTtlMs`/`costTag` meter standing
cost; `ports` are the inner server's listen ports the host must expose.

#### Properties

##### backend

> **backend**: `"router"` \| `"sandbox"` \| `"cli"`

##### image?

> `optional` **image?**: `string`

##### ports?

> `optional` **ports?**: `number`[]

##### warm?

> `optional` **warm?**: `boolean`

##### idleTtlMs?

> `optional` **idleTtlMs?**: `number`

##### costTag?

> `optional` **costTag?**: `string`

***

### CertProvenance

The certify lane's held-out lift travelling WITH delivery. The shipped
`CertifiedArtifact` envelope minus its content (which moves into the binding
arm): `version`/`contentHash`/`lift` are stamped by the promote step, never
the author.

`sourcePath` is the artifact's ORIGINAL path (including `null`). It is the
byte-stable fold sort key — the resolver folds context artifacts in
`composeCertifiedPrompt` order, which sorts by `path ?? ''`, so a `null` path
is load-bearing and MUST round-trip exactly. It is distinct from a context
`iface.name` (display only): collapsing the two flips the fold order for a
mix of null-path and non-null-path artifacts.

#### Properties

##### contentHash

> **contentHash**: `string`

##### version

> **version**: `number` \| `null`

##### lift

> **lift**: `string` \| `null`

##### promotedAt

> **promotedAt**: `string`

##### sourcePath

> **sourcePath**: `string` \| `null`

***

### CertifiedCapability

One certified unit of agent power.

#### Properties

##### id

> **id**: `string`

##### iface

> **iface**: [`CapabilityInterface`](#capabilityinterface)

##### binding

> **binding**: [`DeliveryBinding`](#deliverybinding)

##### auth

> **auth**: [`CapabilityAuth`](#capabilityauth)

##### provenance

> **provenance**: [`CertProvenance`](#certprovenance)

***

### CapabilityManifest

The strict generalization of `CertifiedProfile`. `promptSurface` is kept
during the migration window (the shipped pull lane still emits it); new
capabilities live in `capabilities`.

#### Properties

##### target

> **target**: `string`

##### generatedAt

> **generatedAt**: `string`

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

##### capabilities

> **capabilities**: [`CertifiedCapability`](#certifiedcapability)[]

***

### ResolvedRetrieval

One retrieval handle. The agent never learns vector vs graph vs index.

#### Properties

##### name

> **name**: `string`

#### Methods

##### retrieve()

> **retrieve**(`query`, `k?`): `Promise`\<`object`[]\>

###### Parameters

###### query

`string`

###### k?

`number`

###### Returns

`Promise`\<`object`[]\>

***

### ResolvedHook

One resolved hook — event + the command/matcher the seam folds into
 `AgentProfile.hooks`.

#### Properties

##### event

> **event**: `string`

##### command

> **command**: `string`

##### matcher?

> `optional` **matcher?**: `string`

***

### ResolvedSubagent

One resolved subagent — folded into `AgentProfile.subagents`.

#### Properties

##### name

> **name**: `string`

##### description?

> `optional` **description?**: `string`

##### prompt?

> `optional` **prompt?**: `string`

***

### ResolvedSurface

What `composeCertifiedProfile` produces. Every binding fans into the same
slots, consumed identically by the in-process seam (`RouterToolsSeam.{tools,
executeToolCall}` + folded prompt) and the sandbox seam (`AgentProfile`).
`dispose()` tears provisioned hosts down in REVERSE dependency order.

#### Properties

##### tools

> **tools**: [`ToolSpec`](runtime.md#toolspec)[]

Host-side tool defs → `RouterToolsSeam.tools` / agent-app `extraTools`.

##### mcpConnections

> **mcpConnections**: `Record`\<`string`, `AgentProfileMcpServer`\>

Sandbox-side tool delivery → `AgentProfile.mcp` / in-proc `createMcpEnvironment`.

##### promptAdditions

> **promptAdditions**: `string`[]

Prompt-context additions, byte-stable-ordered → folded system prompt.

##### files

> **files**: `object`[]

Workspace files → `AgentProfile.resources.files`.

###### path

> **path**: `string`

###### content

> **content**: `string`

###### executable?

> `optional` **executable?**: `boolean`

##### retrieval

> **retrieval**: [`ResolvedRetrieval`](#resolvedretrieval)[]

Uniform retrieval handles.

##### hooks

> **hooks**: [`ResolvedHook`](#resolvedhook)[]

Hooks → `AgentProfile.hooks`.

##### subagents

> **subagents**: [`ResolvedSubagent`](#resolvedsubagent)[]

Subagents → `AgentProfile.subagents`.

##### systemPrompt

> **systemPrompt**: `string`

The folded system prompt — base + the byte-stable prompt additions, exactly
 as `composeCertifiedPrompt` renders the inline/context capabilities.

#### Methods

##### execute()

> **execute**(`name`, `args`, `task`): `Promise`\<`string`\>

Host-side dispatch for a resolved tool. Throws when `name` is unknown so a
 mis-dispatch is loud, never a silent empty string.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Tear down provisioned hosts (reverse dependency order).

###### Returns

`Promise`\<`void`\>

***

### CertifiedArtifact

A promoted, certified artifact (one entry in the composed profile).

#### Properties

##### path

> **path**: `string` \| `null`

##### content

> **content**: `string`

##### contentHash

> **contentHash**: `string`

##### version

> **version**: `number` \| `null`

##### lift

> **lift**: `string` \| `null`

Held-out gate lift attached at certification, e.g. "+3.1pp" — never a
 within-run claim. `null` when the promotion carried no lift record.

##### promotedAt

> **promotedAt**: `string`

***

### CertifiedPromptSurface

The active promoted prompt surface for a target.

#### Properties

##### surface

> **surface**: `string`

##### surfaceHash

> **surfaceHash**: `string`

##### version

> **version**: `number` \| `null`

##### lift

> **lift**: `string` \| `null`

***

### DiffProvenance

The held-out provenance the plane's certify step stamps on a promoted diff.
 `lift` is the held-out gate lift (e.g. "+3.1pp"), never a within-run claim.

#### Properties

##### version

> **version**: `number` \| `null`

##### lift

> **lift**: `string` \| `null`

##### contentHash

> **contentHash**: `string`

##### promotedAt

> **promotedAt**: `string`

***

### ProposedProfileDiff

A gate-certified profile diff the plane has already promoted, plus the
held-out provenance it carries. This is the previously-DROPPED typed diff the
composed endpoint returns; `withIntelligence` deserializes it and surfaces it
as a PROPOSAL — a human, or the gated local `improve()` loop, turns a proposal
into a shipped profile. It is NEVER auto-applied at runtime.

#### Properties

##### diff

> **diff**: `AgentProfileDiff`

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

***

### CertifiedCapabilitySummary

The composed endpoint's per-capability summary — the narrow shape on the
 wire (id + surface + path/content + provenance). Distinct from the richer
 `CertifiedCapability` the capability resolver lowers a manifest into.

#### Properties

##### id

> **id**: `string`

##### iface

> **iface**: `object`

###### surface

> **surface**: `string`

##### binding

> **binding**: `object`

###### path

> **path**: `string` \| `null`

###### content

> **content**: `string`

##### provenance

> **provenance**: [`DiffProvenance`](#diffprovenance)

***

### CertifiedProfile

The composed certified profile — exactly the shape the plane's
 `GET /v1/profiles/:target/composed` returns.

#### Properties

##### target

> **target**: `string`

##### generatedAt

> **generatedAt**: `string`

##### promptSurface

> **promptSurface**: [`CertifiedPromptSurface`](#certifiedpromptsurface) \| `null`

##### artifacts

> **artifacts**: `Record`\<`string`, [`CertifiedArtifact`](#certifiedartifact)[]\>

##### agentProfileDiffs

> **agentProfileDiffs**: [`ProposedProfileDiff`](#proposedprofilediff)[]

The typed profile diffs the plane has promoted, each with held-out
 provenance. Surfaced as proposals; never auto-applied. Empty when none.

##### capabilities

> **capabilities**: [`CertifiedCapabilitySummary`](#certifiedcapabilitysummary)[]

The composed capability summaries the plane returns. Empty when none.

##### agentProfile

> **agentProfile**: `AgentProfile` \| `null`

The composed profile the promoted diffs fold to, for inspection. `null`
 when no diffs are promoted.

***

### PullCertifiedOptions

#### Extended by

- [`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Properties

##### target

> **target**: `string`

The agent target certified artifacts are promoted under.

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Abort the request after this many ms. Default 10000.

***

### SubmitAgentImprovementProposalOptions

Submit a completed measured proposal for product-side review.

#### Properties

##### proposal

> **proposal**: `AgentImprovementProposal`

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
`https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Abort the request after this many ms. Default 10000.

***

### CertifiedPromptSource

A cached, self-refreshing source of a target's certified prompt additions —
 the prompt-only delivery lane for callers that assemble their OWN system
 prompt (product chat routes) rather than wrapping an agent fn. Same
 fail-closed semantics as [pullCertified](#pullcertified): pulls at most every
 `refreshMs`, coalesces concurrent pulls, keeps the last-known profile on a
 failed/404 pull, never throws, never blocks past the pull timeout.

#### Methods

##### compose()

> **compose**(`base`): `Promise`\<`string`\>

Refresh (window-respecting) then fold the certified additions into a
 base system prompt. Returns `base` unchanged when nothing is promoted.

###### Parameters

###### base

`string`

###### Returns

`Promise`\<`string`\>

##### current()

> **current**(): [`CertifiedProfile`](#certifiedprofile) \| `null`

The certified profile currently in effect (`null` = none pulled yet).

###### Returns

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### refresh()

> **refresh**(): `Promise`\<`void`\>

Pull now if the refresh window has elapsed; coalesced and fail-closed.

###### Returns

`Promise`\<`void`\>

***

### CertifiedPromptSourceOptions

Options for [createCertifiedPromptSource](#createcertifiedpromptsource) — the pull coordinates plus
 the refresh cadence.

#### Extends

- [`PullCertifiedOptions`](#pullcertifiedoptions)

#### Properties

##### target

> **target**: `string`

The agent target certified artifacts are promoted under.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`target`](#target-2)

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`apiKey`](#apikey)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`baseUrl`](#baseurl)

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`fetchImpl`](#fetchimpl)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Abort the request after this many ms. Default 10000.

###### Inherited from

[`PullCertifiedOptions`](#pullcertifiedoptions).[`timeoutMs`](#timeoutms)

##### refreshMs?

> `optional` **refreshMs?**: `number`

Min interval between certified-profile pulls. Default 5m.

***

### EffortSettings

The flat, resolved settings a tier compiles to. Every field is individually
overridable through `resolveEffort`. Pure data — read by the wrapper, never
self-executing.

#### Properties

##### analysts

> **analysts**: `boolean`

Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst.

##### corpus

> **corpus**: [`CorpusAccess`](#corpusaccess)

Cross-run corpus access this tier permits.

##### fanout

> **fanout**: `number`

Parallel candidate width. `1` ⇒ single-shot, no breadth.

##### loops

> **loops**: `boolean`

Whether multi-step improvement loops (refine / fanout-vote) may run.

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
means uncapped (the spend lands on the Pareto receipt). Base-stream
inference is billed on its own channel and is never constrained here.

***

### EffortOverridesCompiled

The run-config overrides an `EffortSettings` compiles to — the bridge between the
pure effort policy and the orchestration entrypoints (`runPersonified` / the
improvement cycle). This is ONLY data: it never constructs an analyst or runs a
loop. The caller reads these flags to decide WHAT to pass:

 - `withAnalyst: false` ⇒ DO NOT construct/pass a `ScopeAnalyst` to `runPersonified`
   (the dormant empty-findings path runs; the base agent still works). This is the
   PRODUCT fail-closed at `off`/`eco` — "don't construct the analyst" — distinct from
   the EXPERIMENT fail-closed inside `createScopeAnalyst` ("hard abort"), which stays
   untouched. Degrade, never throw.
 - `fanout` ⇒ the `ShapeBudget.fanout` width to pass (`1` at `off`, the tier's breadth
   otherwise). Overrides the personify default fanout.
 - `withLoops: false` ⇒ the improvement cycle is a no-op for this run (no refine /
   fanout-vote multi-step loop spawns).
 - `intelligenceBudgetUsd` ⇒ the intelligence-class spend ceiling carried through for
   the billing clamp (passed verbatim; `0` refuses every intelligence spawn).

#### Properties

##### withAnalyst

> **withAnalyst**: `boolean`

Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent).

##### fanout

> **fanout**: `number`

`ShapeBudget.fanout` width to pass to `runPersonified`.

##### withLoops

> **withLoops**: `boolean`

Run the multi-step improvement cycle, or no-op it for this run?

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped.

***

### CreateExactProcessCandidateExperimentExecutorOptions

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

##### resources

> **resources**: `AgentExactProcessResources`

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

##### traceStore

> **traceStore**: `TraceStore`

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

***

### CreateProtectedExactProcessCandidateExperimentExecutorOptions

Builds the standard exact-process executor with model access that is scoped,
metered, and settled by the caller's grant service.

#### Extends

- `Omit`\<[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions), `"ports"`\>

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provider`](#provider)

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerRegistry`](#providerregistry)

##### resources

> **resources**: `AgentExactProcessResources`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resources`](#resources)

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerOptions`](#provideroptions)

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provisionTimeoutMs`](#provisiontimeoutms)

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`recoveryRetentionMs`](#recoveryretentionms)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`grader`](#grader)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`outputArtifacts`](#outputartifacts)

##### traceStore

> **traceStore**: `TraceStore`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`traceStore`](#tracestore)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`claimStore`](#claimstore)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`cleanupTimeoutMs`](#cleanuptimeoutms)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resultTimeoutMs`](#resulttimeoutms)

##### hostPorts

> **hostPorts**: [`AgentCandidateExecutionHostPorts`](#agentcandidateexecutionhostports)

##### model

> **model**: [`CreateProtectedAgentCandidateModelPortOptions`](index.md#createprotectedagentcandidatemodelportoptions)

***

### ExactProcessCandidateExperimentExecution

#### Extends

- `CandidateExperimentExecutionInput`

#### Properties

##### executionId

> **executionId**: `string`

##### attempt?

> `optional` **attempt?**: `number`

##### executionRoots

> **executionRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

***

### ExactProcessCandidateExperimentExecutor

#### Extended by

- [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Runtime's expired-attempt path reuses this port only to stop and dispose.

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### ProtectedExactProcessCandidateExperimentExecutor

Exact-process executor plus the ports required for durable recovery.

#### Extends

- [`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Runtime's expired-attempt path reuses this port only to stop and dispose.

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`executor`](#executor)

##### recoveryPorts

> `readonly` **recoveryPorts**: `Pick`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"` \| `"memory"`\>

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`execute`](#execute-1)

***

### AgentCandidateExperimentCellPlacement

#### Extended by

- [`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Properties

##### executionId

> **executionId**: `string`

##### attempt?

> `optional` **attempt?**: `number`

##### executionRoots

> **executionRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

***

### RunAgentCandidateExperimentOptions

#### Extends

- `Omit`\<`CompareCandidateExperimentOptions`, `"experiment"` \| `"measurements"` \| `"measurement"` \| `"preparation"`\>

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

##### placeCell

> **placeCell**: (`input`) => [`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

##### preparation?

> `optional` **preparation?**: `object`

Work before this call. Omit when this function is only measuring a sealed experiment.

##### costLedger?

> `optional` **costLedger?**: `CostLedgerHandle`

Shared account when preparation and held-out work have one customer budget.

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### RunAgentCandidateExperimentResult

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

##### evaluation

> **evaluation**: `AgentImprovementMeasuredComparison`

***

### ExecuteAgentCandidateExperimentCellOptions

#### Extends

- `CandidateExperimentExecutionInput`.[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)

#### Properties

##### executionId

> **executionId**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionId`](#executionid-1)

##### attempt?

> `optional` **attempt?**: `number`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`attempt`](#attempt-1)

##### executionRoots

> **executionRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionRoots`](#executionroots-1)

##### stagingRoots

> **stagingRoots**: `object`

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`stagingRoots`](#stagingroots-1)

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`ports`](#ports-2)

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`preparation`](#preparation-1)

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`execution`](#execution)

***

### VerifyCandidateExecutionEvidenceOptions

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

##### arm

> **arm**: `"candidate"` \| `"baseline"`

##### benchmarkCell

> **benchmarkCell**: `AgentCandidateBenchmarkCellRef`

##### seed

> **seed**: `number`

##### attempt?

> `optional` **attempt?**: `number`

##### resolvedResources?

> `optional` **resolvedResources?**: `ReadonlyMap`\<`` `sha256:${string}` ``, `string`\>

***

### CreateAgentImprovementProposalOptions

#### Properties

##### runId

> **runId**: `string`

##### findings

> **findings**: readonly `ProposalFinding`[]

##### evaluation

> **evaluation**: `AgentImprovementEvaluation`

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### ReviewAgentImprovementInput

#### Properties

##### decision

> **decision**: `AgentImprovementReviewDecision`

##### reviewedBy

> **reviewedBy**: `string`

##### reason

> **reason**: `string`

##### feedback?

> `optional` **feedback?**: `string`

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### CreateAgentImprovementActivationOptions

#### Properties

##### intent

> **intent**: `AgentImprovementActivationIntent`

##### targets

> **targets**: \[[`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity), `...AgentImprovementActivationTargetIdentity[]`\]

Runtime derives each exact source digest; callers identify only the records to change.

##### fundingOwner

> **fundingOwner**: `string`

##### authorizedBy

> **authorizedBy**: `string`

##### expiresAt

> **expiresAt**: `string`

##### executionRef?

> `optional` **executionRef?**: `AgentProfileImprovementExecutionRef`

Required only when an activation targets the complete `agent-profile` surface.

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### ProposeAgentImprovementOptions

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### runId

> **runId**: `string`

##### profile

> **profile**: `AgentProfile`

##### analysis

> **analysis**: [`AgentImprovementAnalysisOptions`](#agentimprovementanalysisoptions)

##### improvement

> **improvement**: `Omit`\<[`ImproveMethodOptions`](index.md#improvemethodoptions)\<`TScenario`, `TArtifact`\>, `"findings"`\> & `object` \| `Omit`\<[`ImproveCodeRunOptions`](index.md#improvecoderunoptions)\<`TScenario`, `TArtifact`\>, `"findings"`\> & `object`

##### buildExperiment

> **buildExperiment**: (`input`) => [`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial) \| `Promise`\<[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial)\>

###### Parameters

###### input

###### analysis

[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

###### improvement

[`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

###### Returns

[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial) \| `Promise`\<[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial)\>

##### placeCell

> **placeCell**: (`input`) => [`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### candidate?

> `optional` **candidate?**: `object`

##### metadata?

> `optional` **metadata?**: `object`

###### Index Signature

\[`key`: `string`\]: `AgentCandidateJsonValue`

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### ProposeAgentImprovementResult

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### analysis

> **analysis**: [`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

##### improvement

> **improvement**: [`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

##### experiment

> **experiment**: `AgentCandidateExperiment`

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

##### proposal

> **proposal**: `AgentImprovementProposal`

***

### AgentProfileImprovementBenchmark

Product-owned task material that Runtime freezes before either profile state runs.

#### Properties

##### tasks

> **tasks**: \[`AgentProfileImprovementTaskMaterial`, `...AgentProfileImprovementTaskMaterial[]`\]

##### reps

> **reps**: `number`

##### seeds

> **seeds**: \[`number`, `...number[]`\]

##### policy

> **policy**: `AgentCandidateEvaluationPolicy`

***

### AgentProfileImprovementExecutor

One product execution adapter shared by optimizer search and exact profile
measurement. `executionRef` must identify both operations and their closure.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### executionRef

> **executionRef**: `AgentProfileImprovementExecutionRef`

##### optimize

> **optimize**: [`ImproveProfileAgent`](index.md#improveprofileagent)\<`TScenario`, `TArtifact`\>

#### Methods

##### measure()

> **measure**(`input`): `Promise`\<`AgentProfileImprovementRunReceipt`\>

###### Parameters

###### input

`AgentProfileImprovementExperimentExecutionInput` & `object`

###### Returns

`Promise`\<`AgentProfileImprovementRunReceipt`\>

***

### ProposeAgentProfileImprovementOptions

Complete profile-improvement path for a product-owned source.
Runtime owns analysis, search ancestry, profile diffs, experiment sealing,
paired evaluation, and the reviewable proposal. The product keeps its
profile bytes, task executor, billing, trace capture, and persistence.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### runId

> **runId**: `string`

##### source

> **source**: `object`

##### profile

> **profile**: `AgentProfile`

##### stateDigest

> **stateDigest**: [`AgentImprovementProfileStateDigest`](#agentimprovementprofilestatedigest)

##### analysis

> **analysis**: [`AgentImprovementAnalysisOptions`](#agentimprovementanalysisoptions)

##### improvement

> **improvement**: [`AgentProfileImprovementMethodOptions`](#agentprofileimprovementmethodoptions)\<`TScenario`, `TArtifact`\>

##### benchmark

> **benchmark**: [`AgentProfileImprovementBenchmark`](#agentprofileimprovementbenchmark)

##### executor

> **executor**: [`AgentProfileImprovementExecutor`](#agentprofileimprovementexecutor)\<`TScenario`, `TArtifact`\>

##### budgetUsd

> **budgetUsd**: `number`

One customer-approved maximum for analysis, optimization, and measurement.

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### candidate?

> `optional` **candidate?**: `object`

##### metadata?

> `optional` **metadata?**: `object`

###### Index Signature

\[`key`: `string`\]: `AgentCandidateJsonValue`

##### now?

> `optional` **now?**: () => `Date`

###### Returns

`Date`

***

### ProposeAgentProfileImprovementResult

#### Properties

##### analysis

> **analysis**: [`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

##### improvement

> **improvement**: [`ImproveMethodResult`](index.md#improvemethodresult)

##### experiment

> **experiment**: `AgentProfileImprovementExperiment`

##### measurements

> **measurements**: `AgentProfileImprovementMeasurement`[]

##### proposal

> **proposal**: `AgentImprovementProposal`

***

### AgentImprovementTargetProfileDiffOptions

#### Properties

##### id

> **id**: `string`

##### source?

> `optional` **source?**: `object`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### UsageSplit

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

#### Properties

##### inferenceUsd

> **inferenceUsd**: `number`

Base-stream (model) spend in USD.

##### intelligenceUsd

> **intelligenceUsd**: `number`

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.

***

### RunRecord

The typed record `withIntelligence` sends per call — serialized through the
shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
redacted on export; the per-class `usage` split carries the billing proof;
`loopEvents`, when present, export as the nested loop→round→iteration span
tree under the same `traceId`.

#### Properties

##### runId

> **runId**: `string`

##### traceId

> **traceId**: `string`

##### project

> **project**: `string`

##### target

> **target**: `string`

##### input

> **input**: `unknown`

##### output

> **output**: `unknown`

##### outcome

> **outcome**: `object`

###### success?

> `optional` **success?**: `boolean`

###### score?

> `optional` **score?**: `number`

###### usage

> **usage**: [`UsageSplit`](#usagesplit)

##### model?

> `optional` **model?**: `string`

##### provider?

> `optional` **provider?**: `string`

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

##### profile?

> `optional` **profile?**: `AgentProfile`

##### sessionId?

> `optional` **sessionId?**: `string`

##### harness?

> `optional` **harness?**: `string`

##### repository?

> `optional` **repository?**: `string`

##### commitSha?

> `optional` **commitSha?**: `string`

##### timing?

> `optional` **timing?**: `object`

###### startedAt

> **startedAt**: `number`

###### completedAt

> **completedAt**: `number`

###### durationMs

> **durationMs**: `number`

##### tokens?

> `optional` **tokens?**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

###### cachedInput?

> `optional` **cachedInput?**: `number`

###### reasoning?

> `optional` **reasoning?**: `number`

##### error?

> `optional` **error?**: `object`

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

Exact proposal → review → execution → receipt linkage for candidate runs.

***

### RunReport

What an agent reports (via `applied.record`) to enrich the [RunRecord](#runrecord)
sent for its call. All optional — an un-recorded run still sends input/output
with an inference-only zero usage split. `costUsd` without a split is treated
as pure inference (the base stream).

#### Properties

##### success?

> `optional` **success?**: `boolean`

##### score?

> `optional` **score?**: `number`

##### usage?

> `optional` **usage?**: `Partial`\<[`UsageSplit`](#usagesplit)\>

##### costUsd?

> `optional` **costUsd?**: `number`

##### model?

> `optional` **model?**: `string`

##### provider?

> `optional` **provider?**: `string`

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

##### profile?

> `optional` **profile?**: `AgentProfile`

##### sessionId?

> `optional` **sessionId?**: `string`

##### harness?

> `optional` **harness?**: `string`

##### commitSha?

> `optional` **commitSha?**: `string`

##### tokens?

> `optional` **tokens?**: `object`

###### input

> **input**: `number`

###### output

> **output**: `number`

###### cachedInput?

> `optional` **cachedInput?**: `number`

###### reasoning?

> `optional` **reasoning?**: `number`

##### error?

> `optional` **error?**: `object`

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

***

### RepoConfig

Repo coordinates a product may declare for the (later) Gated-PR mode. The
 Observe slice only records their PRESENCE for `doctor()`; it never touches
 the repo.

#### Properties

##### owner

> **owner**: `string`

##### name

> **name**: `string`

##### baseBranch

> **baseBranch**: `string`

***

### IntelligenceConfig

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

#### Extended by

- [`IntelligenceHookConfig`](#intelligencehookconfig)

#### Properties

##### project

> **project**: `string`

Stable project id — the tenant dimension every trace is tagged with.

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Effort tier (default `'standard'`) plus optional per-field overrides.

##### baseUrl?

> `optional` **baseUrl?**: `string`

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

##### surfaces?

> `optional` **surfaces?**: `string`[]

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

##### checks?

> `optional` **checks?**: `string`[]

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Repo access a later PR mode would need. Recorded for `doctor()` only.

##### profile?

> `optional` **profile?**: `AgentProfile`

Full canonical profile used for this agent. Exported redacted with a stable hash.

##### commitSha?

> `optional` **commitSha?**: `string`

Commit that produced the running agent, when known.

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

***

### TraceMeta

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

#### Properties

##### input?

> `optional` **input?**: `unknown`

The run's input — exported through the redactor.

##### runId?

> `optional` **runId?**: `string`

Stable run id. Defaults to a fresh id.

##### traceId?

> `optional` **traceId?**: `string`

32-hex trace id. Defaults to a fresh id.

##### model?

> `optional` **model?**: `string`

Model id, when known — stamped on the span.

##### provider?

> `optional` **provider?**: `string`

Provider name, when known — stamped on the span.

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Arbitrary extra labels (string/number/boolean) stamped on the span.

***

### TraceHandle

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

#### Methods

##### recordOutput()

> **recordOutput**(`output`): `void`

Capture the run's output. Exported through the redactor.

###### Parameters

###### output

`unknown`

###### Returns

`void`

##### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Capture the run's outcome. `usage` defaults to inference-only
(`intelligenceUsd: 0`) — the OFF baseline; an intelligence-enabled run
fills `intelligenceUsd` itself. `costUsd`, when given without a split, is
treated as pure inference.

###### Parameters

###### outcome

###### success?

`boolean`

###### score?

`number`

###### costUsd?

`number`

###### usage?

`Partial`\<[`UsageSplit`](#usagesplit)\>

###### Returns

`void`

***

### RecordTraceMeta

Metadata for [IntelligenceClient.recordTrace](#recordtrace).

#### Properties

##### traceId?

> `optional` **traceId?**: `string`

32-hex trace id to anchor every span to. Defaults to a fresh id.

##### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.

***

### TraceOutcome

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

#### Properties

##### runId

> **runId**: `string`

##### traceId

> **traceId**: `string`

##### project

> **project**: `string`

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

The resolved effort settings this run executed under.

##### intelligenceOff

> **intelligenceOff**: `boolean`

True when this run ran as pure passthrough (the OFF floor).

##### success?

> `optional` **success?**: `boolean`

##### score?

> `optional` **score?**: `number`

##### usage

> **usage**: [`UsageSplit`](#usagesplit)

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.

***

### IntelligenceClient

The Observe-mode Intelligence client.

#### Properties

##### project

> `readonly` **project**: `string`

The resolved project id.

##### effort

> `readonly` **effort**: [`EffortSettings`](#effortsettings)

The resolved effort settings.

#### Methods

##### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Run `fn` under a trace, export one span best-effort, and return whatever
`fn` returns. Telemetry-export failures are swallowed; an error THROWN by
`fn` propagates to the caller (the agent's own failures are not masked).

###### Type Parameters

###### T

`T`

###### Parameters

###### meta

[`TraceMeta`](#tracemeta)

###### fn

(`trace`) => `Promise`\<`T`\>

###### Returns

`Promise`\<`T`\>

##### recordTrace()

> **recordTrace**(`events`, `meta?`): `string`

Export a run's full loop topology — the ordered `LoopTraceEvent` stream a
`runAgentRounds`/`Supervisor` run emits — as a nested OTLP span tree (loop → round →
iteration) into ONE trace. Reuses the shipped `buildLoopOtelSpans` builder
(NO second span builder), so the topology a viewer renders matches the
kernel's. `traceId` defaults to a fresh id; `rootParentSpanId` parents the
loop root under an enclosing span (e.g. a `traceRun` span) when given.
Best-effort: export failures are swallowed. Returns the resolved `traceId`.

###### Parameters

###### events

readonly [`LoopTraceEvent`](runtime.md#looptraceevent)[]

###### meta?

[`RecordTraceMeta`](#recordtracemeta)

###### Returns

`string`

##### exportRunRecord()

> **exportRunRecord**(`record`): `string`

Send one typed [RunRecord](#runrecord) — the run's flat span (input/output/outcome/
usage/model/provider, redacted) plus, when `loopEvents` are present, the
nested loop topology under the same `traceId`. Reuses the shipped
`flatOtelSpan` + `buildLoopOtelSpans` builders (no second builder).
Best-effort: export failures are swallowed. Returns the record's `traceId`.

###### Parameters

###### record

[`RunRecord`](#runrecord)

###### Returns

`string`

##### freshRunId()

> **freshRunId**(): `string`

Mint a fresh run id (`run-<hex>`).

###### Returns

`string`

##### freshTraceId()

> **freshTraceId**(): `string`

Mint a fresh 32-hex trace id.

###### Returns

`string`

##### doctor()

> **doctor**(): [`DoctorReport`](#doctorreport)

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

###### Returns

[`DoctorReport`](#doctorreport)

##### flush()

> **flush**(): `Promise`\<`void`\>

Flush any pending export spans. Best-effort; resolves even if export fails.

###### Returns

`Promise`\<`void`\>

***

### ModeReadiness

One mode's readiness verdict.

#### Properties

##### ready

> **ready**: `boolean`

##### missing

> **missing**: `string`[]

Inputs this mode still needs, when not ready. Empty when ready.

***

### DoctorReport

The `doctor()` readiness report — Mode-readiness without any network call.

#### Properties

##### project

> **project**: `string`

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

##### exportConfigured

> **exportConfigured**: `boolean`

True when an OTLP endpoint is configured (export will actually ship).

##### modes

> **modes**: `object`

###### observe

> **observe**: [`ModeReadiness`](#modereadiness)

###### recommend

> **recommend**: [`ModeReadiness`](#modereadiness)

###### pr

> **pr**: [`ModeReadiness`](#modereadiness)

***

### OptimizationActivationReceipt

#### Properties

##### kind

> **kind**: `"optimization-activation-receipt"`

##### method

> **method**: `string`

##### source

> **source**: `OptimizationPackageSource`

##### bridge?

> `optional` **bridge?**: `OptimizationPackageSource`

##### modules?

> `optional` **modules?**: `OptimizationModuleSource`[]

##### python?

> `optional` **python?**: `OptimizationPythonRuntime`

##### models?

> `optional` **models?**: `object`

###### candidate?

> `optional` **candidate?**: `AgentProfileModelHints`

###### optimizer?

> `optional` **optimizer?**: `string`

##### usage

> **usage**: `object`

###### optimizerEvaluations

> **optimizerEvaluations**: `number`

###### optimizerTokens?

> `optional` **optimizerTokens?**: `OptimizationTokenUsage`

##### cost

> **cost**: `object`

###### optimization

> **optimization**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### finalTest

> **finalTest**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### total

> **total**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

##### invocation

> **invocation**: `object`

###### runtimeInvocationId

> **runtimeInvocationId**: `string`

###### optimizerRunId

> **optimizerRunId**: `string`

###### compatibleOptimizerRunId?

> `optional` **compatibleOptimizerRunId?**: `string`

###### resumed

> **resumed**: `boolean`

###### artifactDir

> **artifactDir**: `string`

##### developmentDataDigest

> **developmentDataDigest**: `` `sha256:${string}` ``

##### finalTestDataDigest

> **finalTestDataDigest**: `` `sha256:${string}` ``

##### scenarioPartitions

> **scenarioPartitions**: [`ImproveScenarioPartitions`](index.md#improvescenariopartitions)

##### digest

> **digest**: `` `sha256:${string}` ``

***

### OptimizationReceiptCost

#### Properties

##### totalUsd

> **totalUsd**: `number`

##### accountingComplete

> **accountingComplete**: `boolean`

##### incompleteReasons

> **incompleteReasons**: `string`[]

***

### AgentImprovementProfileReplacement

#### Properties

##### identity

> **identity**: `string`

##### profile

> **profile**: `AgentProfile`

***

### AgentImprovementProfileStateDigestInput

#### Properties

##### identity

> **identity**: `string`

##### profile

> **profile**: `AgentProfile`

***

### AgentImprovementProfileStateResolverInput

#### Properties

##### identity

> **identity**: `string`

##### stateDigest

> **stateDigest**: `` `sha256:${string}` ``

***

### ProvisionedHost

A live, provisioned host the resolver tore up for a `process-on-infra` arm.
 `teardown()` runs at `dispose()` in reverse provisioning order.

#### Properties

##### mcpConnection?

> `optional` **mcpConnection?**: `AgentProfileMcpServer`

Lower the inner binding's mcp connection now that the host is up; the URL/
 command points at the host. Absent when the host serves a non-mcp inner.

#### Methods

##### teardown()

> **teardown**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

***

### ResolveCtx

Per-call, per-tenant context the resolver reads. Everything that touches the
network, a secret, or an infra provisioner is INJECTED so the manifest carries
no live secret and the substrate-free caller wires only what it can host.

#### Properties

##### tenant?

> `optional` **tenant?**: `string`

Stable tenant id — namespaces billing + teardown (`tenant#target`).

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

fetch impl for http tools. Defaults to global fetch; absent ⇒ http tools fail loud.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### resolveSecret?

> `optional` **resolveSecret?**: (`auth`, `tenant`) => `Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

Resolve a declared credential to a live secret for THIS tenant. Returns a
typed outcome — inspect `succeeded` before `value`. Absent ⇒ a binding that
declares non-`none` auth fails loud (never a request with no credential).

###### Parameters

###### auth

[`CapabilityAuth`](#capabilityauth)

###### tenant

`string` \| `undefined`

###### Returns

`Promise`\<\{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}\>

##### runSandboxCode?

> `optional` **runSandboxCode?**: (`code`, `entry`, `args`, `task`) => `Promise`\<`string`\>

Run a `sandbox-code` body per call. Injected by the host that owns a sandbox
client (the spine does not import the sandbox executor). Absent ⇒
`sandbox-code` bindings fail loud.

###### Parameters

###### code

[`ContentRef`](#contentref)

###### entry

`string`

###### args

`Record`\<`string`, `unknown`\>

###### task

`unknown`

###### Returns

`Promise`\<`string`\>

##### provisionHost?

> `optional` **provisionHost?**: (`host`, `inner`, `costTag`) => `Promise`\<[`ProvisionedHost`](#provisionedhost)\>

Provision a host for a `process-on-infra` binding, then serve the inner
binding inside it. Injected by the host that owns `createExecutor`. Absent ⇒
`process-on-infra` bindings fail loud. The provider resolves the inner
binding INSIDE the host and returns the connection + a teardown.

###### Parameters

###### host

[`HostSpec`](#hostspec)

###### inner

[`DeliveryBinding`](#deliverybinding)

###### costTag

`string`

###### Returns

`Promise`\<[`ProvisionedHost`](#provisionedhost)\>

##### probeLiveToolNames?

> `optional` **probeLiveToolNames?**: (`capabilityId`) => `Promise`\<`string`[]\>

Drift probe: return the LIVE tool names a resolved surface exposes for a
given capability id (a `tools/list` over an mcp connection, the agent's
actual registered tool names for a host tool). When present, the post-resolve
drift check drops any tool/mcp whose live names diverge from the certified
interface — the only callable surfaces are gate-blessed ones. Absent ⇒ the
check enforces only the host-side executor↔spec parity (no live probe).

###### Parameters

###### capabilityId

`string`

###### Returns

`Promise`\<`string`[]\>

##### onDrop?

> `optional` **onDrop?**: (`capabilityId`, `error`) => `void`

Observe a DROPPED capability — a per-capability resolve failure that is
fail-closed (the capability is omitted, never half-wired). The drop is the
contract; this surfaces the diagnostic so it is never silently erased. NOT
called for [CapabilityNotAdmittedError](#capabilitynotadmittederror) (that rethrows — a manifest
carrying an un-admitted binding kind is a hard error, not a soft drop).

###### Parameters

###### capabilityId

`string`

###### error

`Error`

###### Returns

`void`

***

### AppliedIntelligence

What the hook hands the agent each run. Additive over the prompt-only
 delivery: `composePrompt` folds the certified prompt surface (as before);
 `proposals`/`applyProfile` surface the promoted profile DIFFS — never
 auto-applied; `record` enriches the [RunRecord](#runrecord) that is sent.

#### Properties

##### runId

> **runId**: `string`

Stable ids shared by the run span and every nested runtime/loop span.

##### traceId

> **traceId**: `string`

##### certified

> **certified**: [`CertifiedProfile`](#certifiedprofile) \| `null`

The certified profile in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

##### proposals

> **proposals**: [`ProposedProfileDiff`](#proposedprofilediff)[]

The promoted, gate-certified profile diffs — surfaced for a human or the
 gated `improve()` loop. NEVER auto-applied by this hook. Empty when none.

#### Methods

##### composePrompt()

> **composePrompt**(`base`): `string`

Fold the certified prompt surface into a base system prompt (the promoted
 prompt). The consumer opts in by calling it.

###### Parameters

###### base

`string`

###### Returns

`string`

##### applyProfile()

> **applyProfile**(`base`): `AgentProfile`

Fold every proposal into `base` via `applyAgentProfileDiff`, in promotion
 order, and return the result. The caller invokes this EXPLICITLY (it is the
 human/gated apply step) — the hook never calls it on the run path.

###### Parameters

###### base

`AgentProfile`

###### Returns

`AgentProfile`

##### record()

> **record**(`report`): `void`

Enrich the [RunRecord](#runrecord) sent for this call — outcome, usage split,
 model/provider, and the loop event stream. Optional; an un-recorded run
 still sends input/output with an inference-only zero usage split.

###### Parameters

###### report

[`RunReport`](#runreport)

###### Returns

`void`

***

### IntelligenceHookConfig

`withIntelligence` config = the Observe config plus the pull target, refresh
 cadence, and a proposals callback. One base URL (`baseUrl` /
 `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths.

#### Extends

- [`IntelligenceConfig`](#intelligenceconfig)

#### Properties

##### project

> **project**: `string`

Stable project id — the tenant dimension every trace is tagged with.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`project`](#project-1)

##### apiKey?

> `optional` **apiKey?**: `string`

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`apiKey`](#apikey-3)

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Effort tier (default `'standard'`) plus optional per-field overrides.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`effort`](#effort)

##### baseUrl?

> `optional` **baseUrl?**: `string`

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/profiles/:target/composed`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`baseUrl`](#baseurl-3)

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`redact`](#redact)

##### surfaces?

> `optional` **surfaces?**: `string`[]

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`surfaces`](#surfaces)

##### checks?

> `optional` **checks?**: `string`[]

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`checks`](#checks)

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Repo access a later PR mode would need. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`repo`](#repo)

##### profile?

> `optional` **profile?**: `AgentProfile`

Full canonical profile used for this agent. Exported redacted with a stable hash.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`profile`](#profile-4)

##### commitSha?

> `optional` **commitSha?**: `string`

Commit that produced the running agent, when known.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`commitSha`](#commitsha-2)

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`runtimeTelemetry`](#runtimetelemetry)

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`payloadAttributes`](#payloadattributes)

##### target?

> `optional` **target?**: `string`

Pull target. Defaults to `project`.

##### refreshMs?

> `optional` **refreshMs?**: `number`

Min interval between certified-profile pulls. Default 5m.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

fetch impl for the pull (tests). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### onProposals?

> `optional` **onProposals?**: (`proposals`) => `void`

Notified when a refresh delivers a NEW set of promoted proposals (by
 provenance content hash). Surfaces diffs without auto-applying them.

###### Parameters

###### proposals

[`ProposedProfileDiff`](#proposedprofilediff)[]

###### Returns

`void`

## Type Aliases

### AgentProfileImprovementActivationOperation

> **AgentProfileImprovementActivationOperation** = \{ `kind`: `"apply-change"`; `changes`: `AgentProfileImprovementChange`; \} \| \{ `kind`: `"restore-state"`; \}

#### Union Members

##### Type Literal

\{ `kind`: `"apply-change"`; `changes`: `AgentProfileImprovementChange`; \}

***

##### Type Literal

\{ `kind`: `"restore-state"`; \}

###### kind

> **kind**: `"restore-state"`

The product must load its own saved state at `desiredStateDigest`.

***

### AgentImprovementActivationTransitionInput

> **AgentImprovementActivationTransitionInput** = [`SealedCandidateActivationTransitionInput`](#sealedcandidateactivationtransitioninput) \| [`ProfileImprovementActivationTransitionInput`](#profileimprovementactivationtransitioninput)

***

### AgentImprovementActivationTransition

> **AgentImprovementActivationTransition** = (`input`) => `Promise`\<`unknown`\>

Product-owned or Runtime-composed transition.

Implementations resolve a stored result for `activation.digest`, compare
every target, and make the write durably idempotent. Co-located targets store
the all-or-none write with its result. Other targets throw when result
storage fails so a retry can reconcile it. Runtime never invokes this write
function after authorization expires.

#### Parameters

##### input

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown`\>

***

### AgentImprovementActivationReconciliation

> **AgentImprovementActivationReconciliation** = (`input`) => `Promise`\<`unknown` \| `undefined`\>

Target-read-only check for a prior exact write.
It may persist recovered result metadata, but must not change an activation target.
Return undefined only when no target write can have committed.

#### Parameters

##### input

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown` \| `undefined`\>

***

### JsonSchema

> **JsonSchema** = `Record`\<`string`, `unknown`\>

A JSON Schema object describing a tool's parameters. Kept structural — the
 resolver forwards it verbatim into a `ToolSpec` / MCP `tools/list` check.

***

### CapabilityInterface

> **CapabilityInterface** = \{ `surface`: `"tool"`; `name`: `string`; `description?`: `string`; `parameters`: [`JsonSchema`](#jsonschema); `returns?`: [`JsonSchema`](#jsonschema); \} \| \{ `surface`: `"mcp"`; `serverName`: `string`; `toolset?`: `string`[]; \} \| \{ `surface`: `"context"`; `kind`: `"prompt-surface"` \| `"skill"` \| `"instructions"`; `name`: `string`; \} \| \{ `surface`: `"retrieval"`; `name`: `string`; `description?`: `string`; `topK?`: `number`; \} \| \{ `surface`: `"hook"`; `event`: `string`; `matcher?`: `string`; \} \| \{ `surface`: `"subagent"`; `name`: `string`; `description?`: `string`; \}

What the agent consumes. CLOSED — a new runtime kind NEVER extends this. Each
arm maps slot-for-slot onto `AgentProfile` + the host `RouterToolsSeam`.

***

### CapabilitySurface

> **CapabilitySurface** = [`CapabilityInterface`](#capabilityinterface)\[`"surface"`\]

Every interface surface tag — the closed set the resolver fans into slots.

***

### ContentRef

> **ContentRef** = \{ `kind`: `"inline"`; `content`: `string`; \} \| \{ `kind`: `"github"`; `repository?`: `string`; `path`: `string`; `ref?`: `string`; \} \| \{ `kind`: `"blob"`; `uri`: `string`; `sha256`: `string`; `bytes?`: `number`; \}

Where a capability's bytes live. A leaked manifest carries no live secret and
no inlined blob: `github`/`blob` are pointers resolved at provision time.

***

### CapabilityAuth

> **CapabilityAuth** = \{ `mode`: `"none"`; \} \| \{ `mode`: `"tangle-key"`; \} \| \{ `mode`: `"hub-connection"`; `providerId`: `string`; `scopes?`: `string`[]; \} \| \{ `mode`: `"secret-ref"`; `key`: `string`; \}

How a binding authenticates at resolve time. Declared as a REQUIREMENT in the
manifest; the live secret is resolved per-tenant by the resolver context,
never inlined here.

***

### DeliveryBinding

> **DeliveryBinding** = \{ `kind`: `"inline"`; `content`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"file"`; `path`: `string`; `content`: [`ContentRef`](#contentref); `executable?`: `boolean`; \} \| \{ `kind`: `"http"`; `url`: `string`; `method?`: `string`; `auth?`: [`CapabilityAuth`](#capabilityauth); \} \| \{ `kind`: `"sandbox-code"`; `entry`: `string`; `code`: [`ContentRef`](#contentref); `runtime?`: `string`; `harness?`: `string`; \} \| \{ `kind`: `"mcp-stdio"`; `command`: `string`; `args?`: `string`[]; `env?`: `Record`\<`string`, `string`\>; `cwd?`: `string`; \} \| \{ `kind`: `"mcp-remote"`; `url`: `string`; `transport`: `"http"` \| `"sse"`; `headers?`: `Record`\<`string`, `string`\>; \} \| \{ `kind`: `"process-on-infra"`; `host`: [`HostSpec`](#hostspec); `inner`: [`DeliveryBinding`](#deliverybinding); \} \| \{ `kind`: `"rag-index"`; `index`: [`ContentRef`](#contentref); `embedModel`: `string`; `topK?`: `number`; \} \| \{ `kind`: `"memory-store"`; `provision`: `"sqlite"` \| `"neo4j"` \| `"vector"`; `seed?`: [`ContentRef`](#contentref); \} \| \{ `kind`: `"wasm"`; `module`: [`ContentRef`](#contentref); `exports`: `string`[]; \} \| \{ `kind`: `"a2a"`; `endpoint`: `string`; `card`: [`ContentRef`](#contentref); `auth?`: [`CapabilityAuth`](#capabilityauth); \}

How a capability is backed. OPEN tagged union — THE extension point. All arms
are typed even when the resolver does not yet admit them; an un-admitted arm
throws [CapabilityNotAdmittedError](#capabilitynotadmittederror) at resolve, never silently no-ops.

***

### DeliveryBindingKind

> **DeliveryBindingKind** = [`DeliveryBinding`](#deliverybinding)\[`"kind"`\]

Every binding kind — the open set the resolver dispatches over.

***

### PullOutcome

> **PullOutcome** = \{ `succeeded`: `true`; `value`: [`CertifiedProfile`](#certifiedprofile); \} \| \{ `succeeded`: `false`; `error`: `string`; `status?`: `number`; \}

Typed outcome for the pull — inspect `succeeded` before `value`. A 404
 (nothing promoted yet) is a normal, non-error `succeeded: false`.

***

### AgentImprovementProposalSubmissionState

> **AgentImprovementProposalSubmissionState** = `"not-sent"` \| `"rejected"` \| `"unconfirmed"`

What Runtime knows about a failed proposal submission.
`not-sent` means no request began, `rejected` means Intelligence returned a
definitive 4xx response, and `unconfirmed` means the caller may safely retry
the same immutable proposal.

***

### SubmitAgentImprovementProposalOutcome

> **SubmitAgentImprovementProposalOutcome** = \{ `succeeded`: `true`; `value`: `AgentImprovementProposal`; `status`: `number`; \} \| \{ `succeeded`: `false`; `submission`: [`AgentImprovementProposalSubmissionState`](#agentimprovementproposalsubmissionstate); `error`: `string`; `status?`: `number`; `code?`: `string`; \}

Typed result for proposal submission. A successful result contains the
exact immutable proposal Intelligence recorded.

***

### EffortTier

> **EffortTier** = `"off"` \| `"eco"` \| `"standard"` \| `"thorough"` \| `"max"`

The named effort tiers, lowest to highest. `'off'` is the honest floor
 below `'eco'`: intelligence fully off, telemetry still best-effort.

***

### CorpusAccess

> **CorpusAccess** = `"off"` \| `"read"` \| `"read-write"`

Corpus access an intelligence tier permits. `'off'` reads and writes
 nothing; `'read'` consults the cross-run corpus without contributing;
 `'read-write'` both consults and accumulates.

***

### EffortOverrides

> **EffortOverrides** = `Partial`\<[`EffortSettings`](#effortsettings)\>

Per-field overrides applied on top of a tier preset. Any subset of the
 resolved settings; each provided field wins over the preset.

***

### AgentCandidateExecutionHostPorts

> **AgentCandidateExecutionHostPorts** = `Omit`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"`\>

Product-owned candidate ports other than protected model access.

***

### AgentImprovementAnalysisOptions

> **AgentImprovementAnalysisOptions** = `Omit`\<[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts), `"runId"` \| `"inputs"` \| `"improvementProposalSource"` \| `"knowledgeProposalSource"` \| `"onEvent"` \| `"log"` \| `"costLedger"` \| `"costPhase"` \| `"signal"`\> & `object`

#### Type Declaration

##### inputs

> **inputs**: `Omit`\<[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts)\[`"inputs"`\], `"judgeInput"`\> & `object`

###### Type Declaration

###### judgeInput?

> `optional` **judgeInput?**: `never`

***

### AgentImprovementExperimentMaterial

> **AgentImprovementExperimentMaterial** = `Omit`\<`AgentCandidateExperimentMaterial`, `"candidateLineage"`\>

Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest.

***

### AgentProfileImprovementMethodOptions

> **AgentProfileImprovementMethodOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<[`ImproveMethodOptions`](index.md#improvemethodoptions)\<`TScenario`, `TArtifact`\>, `"agent"` \| `"executionRef"` \| `"findings"` \| `"surface"`\> & `object`

The portable profile changes that the measured-profile contract permits.

#### Type Declaration

##### surface?

> `optional` **surface?**: [`AgentProfileMeasuredSurface`](#agentprofilemeasuredsurface)

##### findings?

> `optional` **findings?**: readonly `ProposalFinding`[]

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### AgentImprovementProfileSurface

> **AgentImprovementProfileSurface** = *typeof* [`AGENT_IMPROVEMENT_PROFILE_SURFACES`](#agent_improvement_profile_surfaces)\[`number`\]

***

### AgentProfileMeasuredSurface

> **AgentProfileMeasuredSurface** = *typeof* [`AGENT_PROFILE_MEASURED_SURFACES`](#agent_profile_measured_surfaces)\[`number`\]

***

### AgentImprovementActivationTargetIdentity

> **AgentImprovementActivationTargetIdentity** = `Pick`\<`AgentImprovementActivationTarget`, `"surface"` \| `"identity"`\>

***

### UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.

***

### AgentImprovementProfileActivationTarget

> **AgentImprovementProfileActivationTarget** = `Omit`\<[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `"surface"`\> & `object`

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileTargetState

> **AgentImprovementProfileTargetState** = `Omit`\<`AgentImprovementActivationTargetState`, `"surface"`\> & `object`

#### Type Declaration

##### surface

> **surface**: [`AgentProfileMeasuredSurface`](#agentprofilemeasuredsurface)

***

### AgentImprovementProfileTargetTransition

> **AgentImprovementProfileTargetTransition** = `Omit`\<`AgentImprovementActivationTargetTransition`, `"surface"`\> & `object`

#### Type Declaration

##### surface

> **surface**: [`AgentProfileMeasuredSurface`](#agentprofilemeasuredsurface)

***

### AgentImprovementProfileStateDigest

> **AgentImprovementProfileStateDigest** = (`input`) => `Sha256Digest`

Product-defined hash of the complete profile state that actually runs.

#### Parameters

##### input

[`AgentImprovementProfileStateDigestInput`](#agentimprovementprofilestatedigestinput)

#### Returns

`Sha256Digest`

***

### AgentImprovementProfileStateResolver

> **AgentImprovementProfileStateResolver** = (`input`) => `AgentProfile` \| `undefined`

Product-owned retained-state lookup used only for an explicit restore.

#### Parameters

##### input

[`AgentImprovementProfileStateResolverInput`](#agentimprovementprofilestateresolverinput)

#### Returns

`AgentProfile` \| `undefined`

***

### AgentImprovementProfileActivationInput

> **AgentImprovementProfileActivationInput** = \{ `currentByIdentity`: `ReadonlyMap`\<`string`, `AgentProfile`\>; `targets`: readonly \[[`AgentImprovementProfileActivationTarget`](#agentimprovementprofileactivationtarget), `...AgentImprovementProfileActivationTarget[]`\]; \} \| \{ `currentByIdentity`: `ReadonlyMap`\<`string`, `AgentProfile`\>; `profileTransition`: [`ProfileImprovementActivationTransitionInput`](#profileimprovementactivationtransitioninput); `stateDigest`: [`AgentImprovementProfileStateDigest`](#agentimprovementprofilestatedigest); `resolveState?`: [`AgentImprovementProfileStateResolver`](#agentimprovementprofilestateresolver); \}

***

### AgentImprovementProfileActivationPreparation

> **AgentImprovementProfileActivationPreparation** = \{ `status`: `"missing"`; `identities`: readonly `string`[]; \} \| \{ `status`: `"unavailable"`; `code`: `"PROFILE_STATE_UNAVAILABLE"`; `identities`: readonly `string`[]; `requiredStateDigest`: `Sha256Digest`; \} \| \{ `status`: `"already-applied"` \| `"conflict"`; `targets`: \[[`AgentImprovementProfileTargetState`](#agentimprovementprofiletargetstate), `...AgentImprovementProfileTargetState[]`\]; \} \| \{ `status`: `"apply"`; `replacements`: \[[`AgentImprovementProfileReplacement`](#agentimprovementprofilereplacement), `...AgentImprovementProfileReplacement[]`\]; `targets`: \[[`AgentImprovementProfileTargetTransition`](#agentimprovementprofiletargettransition), `...AgentImprovementProfileTargetTransition[]`\]; \}

***

### IntelligenceAgent

> **IntelligenceAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

An agent wrapped by [withIntelligence](#withintelligence): receives the input plus the
 intelligence delivered for this run.

#### Type Parameters

##### I

`I`

##### O

`O`

#### Parameters

##### input

`I`

##### applied

[`AppliedIntelligence`](#appliedintelligence)

#### Returns

`Promise`\<`O`\>

***

### IntelligenceWrapped

> **IntelligenceWrapped**\<`I`, `O`\> = (`input`) => `Promise`\<`O`\> & `object`

The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 `refresh()` and a `proposals()` accessor for the currently-promoted diffs.

#### Type Declaration

##### refresh()

> **refresh**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### proposals()

> **proposals**(): [`ProposedProfileDiff`](#proposedprofilediff)[]

###### Returns

[`ProposedProfileDiff`](#proposedprofilediff)[]

##### flush()

> **flush**(): `Promise`\<`void`\>

Flush buffered trace spans before a short-lived process exits.

###### Returns

`Promise`\<`void`\>

#### Type Parameters

##### I

`I`

##### O

`O`

***

### Redactor

> **Redactor** = (`value`) => `unknown`

A redactor maps an arbitrary trace value to a safe-to-export value. Pure;
 must not throw on cyclic input (the default tolerates cycles).

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

## Variables

### defaultEffortTier

> `const` **defaultEffortTier**: [`EffortTier`](#efforttier) = `'standard'`

The default tier when a client declares no effort. `'standard'` turns
 intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 `'thorough'`/`'max'`.

***

### exactProcessCandidateExperimentExecutionSupport

> `const` **exactProcessCandidateExperimentExecutionSupport**: `Readonly`\<\{ `outcomes`: readonly \[`"output"`\]; `outputMediaTypes`: readonly \[`"text/*"`, `"application/json"`, `"*+json"`\]; `code`: readonly \[`"disabled"`\]; `memory`: readonly \[`"disabled"`\]; `knowledge`: `true`; `profile`: `Readonly`\<\{ `mcpTransports`: readonly \[`"stdio"`\]; `remoteMcp`: `false`; `tools`: `false`; `permissions`: `false`; `modes`: `false`; `confidential`: `false`; \}\>; `isolation`: `Readonly`\<\{ `freshEnvironment`: `true`; `exactProcess`: `true`; `egress`: readonly \[`"blocked"`, `"strict"`\]; \}\>; \}\>

Candidate surfaces implemented by the neutral exact-process executor.

***

### AGENT\_IMPROVEMENT\_PROFILE\_SURFACES

> `const` **AGENT\_IMPROVEMENT\_PROFILE\_SURFACES**: readonly \[`"prompt"`, `"skills"`, `"tools"`, `"mcp"`, `"hooks"`, `"subagents"`\]

Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements.

***

### AGENT\_PROFILE\_MEASURED\_SURFACES

> `const` **AGENT\_PROFILE\_MEASURED\_SURFACES**: readonly \[`"prompt"`, `"skills"`, `"tools"`, `"mcp"`, `"hooks"`, `"subagents"`, `"agent-profile"`\]

Profile changes eligible for the product-owned measured comparison path.
The six directly deliverable profile surfaces retain their granular labels;
any residual profile axis also adds the complete `agent-profile` surface.

## Functions

### parseCandidateProfileMaterialization()

> **parseCandidateProfileMaterialization**(`input`, `expectedProfilePlanDigest?`): `AgentCandidateProfileActivation`

Parse and check every native file hash plus both canonical document digests.

#### Parameters

##### input

`unknown`

##### expectedProfilePlanDigest?

`` `sha256:${string}` ``

#### Returns

`AgentCandidateProfileActivation`

***

### createAgentImprovementActivationResult()

> **createAgentImprovementActivationResult**(`transition`, `options`): `AgentImprovementActivationResult`

Create the exact result a product stores in the same transaction as its target write.

#### Parameters

##### transition

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

##### options

[`CreateAgentImprovementActivationResultOptions`](#createagentimprovementactivationresultoptions)

#### Returns

`AgentImprovementActivationResult`

***

### verifyAgentImprovementActivationResult()

> **verifyAgentImprovementActivationResult**(`input`): `AgentImprovementActivationResult`

Recompute one historical activation result against the exact measured proposal and authority.
The result records that attempt; it is not a query of the target's current state.

#### Parameters

##### input

###### proposal

`unknown`

###### review

`unknown`

###### activation

`unknown`

###### result

`unknown`

#### Returns

`AgentImprovementActivationResult`

***

### executeAgentImprovementActivation()

> **executeAgentImprovementActivation**(`input`, `options`): `Promise`\<`AgentImprovementActivationResult`\>

Validate and execute one product-owned activation transition.

#### Parameters

##### input

[`ExecuteAgentImprovementActivationInput`](#executeagentimprovementactivationinput)

##### options

[`ExecuteAgentImprovementActivationOptions`](#executeagentimprovementactivationoptions)

#### Returns

`Promise`\<`AgentImprovementActivationResult`\>

***

### manifestFromProfile()

> **manifestFromProfile**(`profile`): [`CapabilityManifest`](#capabilitymanifest)

Lower the EXISTING plane wire (`CertifiedProfile`) into a `CapabilityManifest`.
`prompt-surface`/`skill` artifacts → `context`/inline capabilities (the
shipped fold, generalized); any other artifact type → best-effort binding
inference. `promptSurface` is carried through so
the resolver folds it first, exactly as `composeCertifiedPrompt` does today.
This delivers the spine against today's wire before the plane changes.

#### Parameters

##### profile

[`CertifiedProfile`](#certifiedprofile)

#### Returns

[`CapabilityManifest`](#capabilitymanifest)

***

### resolveIntelligenceBaseUrl()

> **resolveIntelligenceBaseUrl**(`baseUrl`): `string`

Resolve the ONE Intelligence base URL — the single knob both the send and
 receive paths derive from. Env fallback: `TANGLE_INTELLIGENCE_URL`.

#### Parameters

##### baseUrl

`string` \| `undefined`

#### Returns

`string`

***

### normalizeCertifiedProfile()

> **normalizeCertifiedProfile**(`raw`): [`CertifiedProfile`](#certifiedprofile)

Deserialize the composed-endpoint response into a `CertifiedProfile`. The
previously-dropped `agentProfileDiffs`/`capabilities`/`agentProfile` are read
here so they round-trip to the consumer; a plane that has not yet promoted any
diffs simply yields empty arrays / a null profile (fail-closed, never a crash).

#### Parameters

##### raw

`unknown`

#### Returns

[`CertifiedProfile`](#certifiedprofile)

***

### pullCertified()

> **pullCertified**(`opts`): `Promise`\<[`PullOutcome`](#pulloutcome)\>

Pull the certified composed profile for a target. Fail-closed: a network
error or a non-2xx returns a typed `succeeded: false` (never throws), so a
caller can run on its base surface when Intelligence is unreachable. A 404 is
the normal "nothing promoted yet" signal, carried as `status: 404`.

#### Parameters

##### opts

[`PullCertifiedOptions`](#pullcertifiedoptions)

#### Returns

`Promise`\<[`PullOutcome`](#pulloutcome)\>

***

### submitAgentImprovementProposal()

> **submitAgentImprovementProposal**(`opts`): `Promise`\<[`SubmitAgentImprovementProposalOutcome`](#submitagentimprovementproposaloutcome)\>

Submit a completed Runtime proposal to Intelligence for product-side review.
This never runs an experiment, approves a proposal, or applies a candidate.
A 4xx response is a confirmed `rejected` request. Network failures, timeouts,
5xx responses, and invalid success responses are `unconfirmed`, so callers
can retry the same digest because Intelligence stores proposals idempotently.

#### Parameters

##### opts

[`SubmitAgentImprovementProposalOptions`](#submitagentimprovementproposaloptions)

#### Returns

`Promise`\<[`SubmitAgentImprovementProposalOutcome`](#submitagentimprovementproposaloutcome)\>

***

### composeCertifiedPrompt()

> **composeCertifiedPrompt**(`base`, `certified`): `string`

Fold the certified prompt surface (and any certified prompt-folding artifacts:
`prompt-surface` / `skill` / `instructions`) into a base system prompt under a
marked section, so the deployed agent prompt == base + the gate-certified
additions. Order is stable (prompt surface first, then artifact buckets in
`promptFoldTypes` order, then by path within a bucket) so the same profile
renders byte-identically each call. Returns `base` unchanged when there is no
usable certified content. Reads only the prompt-folding slice of a profile.

#### Parameters

##### base

`string`

##### certified

`Pick`\<[`CertifiedProfile`](#certifiedprofile), `"promptSurface"` \| `"artifacts"`\> \| `null`

#### Returns

`string`

***

### createCertifiedPromptSource()

> **createCertifiedPromptSource**(`opts`): [`CertifiedPromptSource`](#certifiedpromptsource)

Create the cached certified-prompt source — the ONE module-scope-cache +
coalesced-refresh + keep-last-known implementation. Product wiring uses this
rather than hand-rolling the same lines around `pullCertified`. The
`withIntelligence` hook rides this same source for its prompt delivery.

#### Parameters

##### opts

[`CertifiedPromptSourceOptions`](#certifiedpromptsourceoptions)

#### Returns

[`CertifiedPromptSource`](#certifiedpromptsource)

***

### resolveEffort()

> **resolveEffort**(`tier`, `overrides?`): [`EffortSettings`](#effortsettings)

Compile a named tier (plus optional per-field overrides) into the flat
`EffortSettings` the wrapper reads. Pure: same inputs → same object, no I/O,
no execution. Fails loud on an unknown tier rather than silently defaulting —
a typo'd tier must not quietly grant or deny intelligence.

Invariant preserved for the billing floor: `resolveEffort('off')` always
yields `intelligenceBudgetUsd: 0` with every intelligence knob off UNLESS the
caller explicitly overrides a field — overriding off is an opt-in the caller
owns, not a default the composer leaks.

#### Parameters

##### tier

[`EffortTier`](#efforttier)

##### overrides?

`Partial`\<[`EffortSettings`](#effortsettings)\>

#### Returns

[`EffortSettings`](#effortsettings)

***

### isIntelligenceOff()

> **isIntelligenceOff**(`settings`): `boolean`

True when these settings admit NO intelligence spawn — the passthrough
predicate the wrapper branches on. Every intelligence axis must be off:
analysts disabled, corpus off, no breadth, no loops, and a zero intelligence
budget. A caller who overrides any one of these back on is no longer at the
OFF floor and the wrapper treats them as an intelligence-enabled run.

#### Parameters

##### settings

[`EffortSettings`](#effortsettings)

#### Returns

`boolean`

***

### compileEffort()

> **compileEffort**(`settings`): [`EffortOverridesCompiled`](#effortoverridescompiled)

Compile resolved `EffortSettings` into the orchestration overrides above. Pure: same
input → same object, no I/O, no execution, no construction. It is the single place that
maps the effort axes onto the run-config knobs, so no `if (effort)` leaks into the
supervise kernel — the kernel stays effort-blind, the caller reads these flags once.

`off`/`eco` (`analysts: false`) compile to `withAnalyst: false` ⇒ the caller omits the
analyst and the run degrades to the dormant base agent rather than throwing. `fanout: 1`
(no breadth) at `off`; `withLoops: false` no-ops the improvement cycle. `standard`+
compile to `withAnalyst: true`, the tier's `fanout`, and `withLoops: true`.

#### Parameters

##### settings

[`EffortSettings`](#effortsettings)

#### Returns

[`EffortOverridesCompiled`](#effortoverridescompiled)

***

### createExactProcessCandidateExperimentExecutor()

> **createExactProcessCandidateExperimentExecutor**(`options`): [`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

Execute one signed experiment cell through any declared exact-process provider.

#### Parameters

##### options

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

***

### createProtectedExactProcessCandidateExperimentExecutor()

> **createProtectedExactProcessCandidateExperimentExecutor**(`options`): [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

Compose host-owned execution ports with protected model access for one exact-process run.

#### Parameters

##### options

[`CreateProtectedExactProcessCandidateExperimentExecutorOptions`](#createprotectedexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

***

### runAgentCandidateExperiment()

> **runAgentCandidateExperiment**(`options`): `Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

Execute both arms of one immutable experiment and derive its paired result.

#### Parameters

##### options

[`RunAgentCandidateExperimentOptions`](#runagentcandidateexperimentoptions)

#### Returns

`Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

***

### executeAgentCandidateExperimentCell()

> **executeAgentCandidateExperimentCell**(`options`): `Promise`\<`CandidateExecutionEvidence`\>

Execute one exact arm, task, repetition, seed, and attempt through Runtime.

#### Parameters

##### options

[`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### createAgentImprovementMeasuredComparison()

> **createAgentImprovementMeasuredComparison**(`options`): `AgentImprovementMeasuredComparison`

Delegate all statistics and promotion checks to agent-eval's receipt-based comparison.

#### Parameters

##### options

`CompareCandidateExperimentOptions`

#### Returns

`AgentImprovementMeasuredComparison`

***

### proposeAgentProfileImprovement()

> **proposeAgentProfileImprovement**\<`TScenario`, `TArtifact`\>(`options`): `Promise`\<[`ProposeAgentProfileImprovementResult`](#proposeagentprofileimprovementresult)\>

Analyze a product-owned profile, search one profile surface, then run the
exact baseline and candidate through the product executor before proposing.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`ProposeAgentProfileImprovementOptions`](#proposeagentprofileimprovementoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ProposeAgentProfileImprovementResult`](#proposeagentprofileimprovementresult)\>

***

### proposeAgentImprovement()

> **proposeAgentImprovement**\<`TScenario`, `TArtifact`\>(`options`): `Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

Analyze, search, then remeasure the resulting exact candidate before proposing it.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`ProposeAgentImprovementOptions`](#proposeagentimprovementoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

***

### createAgentImprovementProposal()

> **createAgentImprovementProposal**(`options`): `AgentImprovementProposal`

Create the reviewable record only from a complete, recomputable experiment result.

#### Parameters

##### options

[`CreateAgentImprovementProposalOptions`](#createagentimprovementproposaloptions)

#### Returns

`AgentImprovementProposal`

***

### reviewAgentImprovementProposal()

> **reviewAgentImprovementProposal**(`inputProposal`, `input`): `AgentImprovementReview`

Persist a human or tenant-policy decision bound to one exact proposal.

#### Parameters

##### inputProposal

`AgentImprovementProposal`

##### input

[`ReviewAgentImprovementInput`](#reviewagentimprovementinput)

#### Returns

`AgentImprovementReview`

***

### createAgentImprovementActivation()

> **createAgentImprovementActivation**(`inputProposal`, `inputReview`, `options`): `AgentImprovementActivation`

Authorize product-owned writes only after the exact candidate was measured and approved.

#### Parameters

##### inputProposal

`AgentImprovementProposal`

##### inputReview

`AgentImprovementReview`

##### options

[`CreateAgentImprovementActivationOptions`](#createagentimprovementactivationoptions)

#### Returns

`AgentImprovementActivation`

***

### verifyAgentImprovementProposal()

> **verifyAgentImprovementProposal**(`input`): `AgentImprovementProposal`

Validate a proposal and recompute every binding to its measured experiment.

#### Parameters

##### input

`unknown`

#### Returns

`AgentImprovementProposal`

***

### verifyAgentImprovementReview()

> **verifyAgentImprovementReview**(`input`): `AgentImprovementReview`

Validate the canonical identity and wire shape of an improvement review.

#### Parameters

##### input

`unknown`

#### Returns

`AgentImprovementReview`

***

### verifyAgentImprovementActivation()

> **verifyAgentImprovementActivation**(`input`): `AgentImprovementActivation`

Validate activation authority against the exact proposal, review, experiment, and base state.

#### Parameters

##### input

###### proposal

`unknown`

###### review

`unknown`

###### activation

`unknown`

#### Returns

`AgentImprovementActivation`

***

### verifyCandidateExecutionEvidence()

> **verifyCandidateExecutionEvidence**(`input`, `options`): `CandidateExecutionEvidence`

Recheck one Runtime receipt against its exact signed experiment cell.

#### Parameters

##### input

`unknown`

##### options

[`VerifyCandidateExecutionEvidenceOptions`](#verifycandidateexecutionevidenceoptions)

#### Returns

`CandidateExecutionEvidence`

***

### buildAgentImprovementActivationTargets()

> **buildAgentImprovementActivationTargets**(`surfaces`, `experiment`, `intent`, `identities`): \[`AgentImprovementActivationTarget`, `...AgentImprovementActivationTarget[]`\]

Bind caller-owned target identities to the exact source state Runtime measured.

#### Parameters

##### surfaces

readonly `AgentImprovementSurface`[]

##### experiment

`AgentProfileImprovementExperiment` \| `AgentCandidateExperiment`

##### intent

`AgentImprovementActivationIntent`

##### identities

readonly [`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity)[]

#### Returns

\[`AgentImprovementActivationTarget`, `...AgentImprovementActivationTarget[]`\]

***

### isAgentImprovementProfileSurface()

> **isAgentImprovementProfileSurface**(`surface`): surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills"

Return whether a measured surface can be delivered through an agent profile.

#### Parameters

##### surface

`AgentImprovementSurface`

#### Returns

surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills"

***

### isAgentProfileMeasuredSurface()

> **isAgentProfileMeasuredSurface**(`surface`): surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills" \| "agent-profile"

Return whether a surface is eligible for shared profile measurement.

#### Parameters

##### surface

`string`

#### Returns

surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills" \| "agent-profile"

***

### agentImprovementProfileSurfaceInput()

> **agentImprovementProfileSurfaceInput**(`profile`, `surface`): `unknown`

Return the canonical current-state input for one profile-deliverable improvement target.
Missing slots become `null`; tools and subagents include both their direct and resource slots.
Unrelated profile fields are excluded. The result matches `agentImprovementTargetInput` for the
same profile inside a candidate bundle.

#### Parameters

##### profile

`AgentProfile`

##### surface

`"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"tools"` \| `"skills"`

#### Returns

`unknown`

***

### agentImprovementProfileSurfaceDigest()

> **agentImprovementProfileSurfaceDigest**(`profile`, `surface`): `` `sha256:${string}` ``

Return the `Sha256Digest` of one profile surface using Runtime's canonical candidate digest.

#### Parameters

##### profile

`AgentProfile`

##### surface

`"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"tools"` \| `"skills"`

#### Returns

`` `sha256:${string}` ``

***

### agentImprovementTargetProfileDiffs()

> **agentImprovementTargetProfileDiffs**(`target`, `options`): \[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

Replace one measured profile surface exactly, including array-valued resources.
Apply the returned diffs in order: a diff applies its set before its removal,
so exact replacement requires a reset record followed by a set record.

#### Parameters

##### target

###### surface

`"mcp"` \| `"subagents"` \| `"hooks"` \| `"prompt"` \| `"tools"` \| `"skills"`

###### desiredInput

`unknown`

##### options

[`AgentImprovementTargetProfileDiffOptions`](#agentimprovementtargetprofilediffoptions)

#### Returns

\[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

***

### agentImprovementProfileDiffs()

> **agentImprovementProfileDiffs**(`baselineInput`, `candidateInput`, `options`): \[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

Derive the ordered profile patch that changes one executable profile into
another, then prove the patch preserves the complete candidate state.

#### Parameters

##### baselineInput

`AgentProfile`

##### candidateInput

`AgentProfile`

##### options

[`AgentImprovementTargetProfileDiffOptions`](#agentimprovementtargetprofilediffoptions)

#### Returns

\[`AgentProfileDiff`, `...AgentProfileDiff[]`\]

***

### createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](#intelligenceclient)

Create an Observe-mode Intelligence client. Resolves effort, the base URL, and
the redactor up front; the exporter is built lazily and is `undefined` when no
`apiKey` is present (send becomes a no-op — the ingest requires a tenant key,
and best-effort export must never spam an unauthenticated plane).

#### Parameters

##### config

[`IntelligenceConfig`](#intelligenceconfig)

#### Returns

[`IntelligenceClient`](#intelligenceclient)

***

### createOptimizationActivationReceipt()

> **createOptimizationActivationReceipt**(`improvement`): [`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

Build a detached receipt only for methods backed by an identified external optimizer.

#### Parameters

##### improvement

[`ImproveMethodResult`](index.md#improvemethodresult)

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### optimizationActivationReceiptFromMetadata()

> **optimizationActivationReceiptFromMetadata**(`metadata`): [`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

Read and verify the optimizer evidence carried by a measured proposal.

#### Parameters

##### metadata

\{\[`key`: `string`\]: `AgentCandidateJsonValue`; \} \| `undefined`

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### prepareAgentImprovementProfileActivation()

> **prepareAgentImprovementProfileActivation**(`input`): [`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

Compare product-owned profiles with an exact measured transition and prepare
all-or-none replacements. The product owns locking, persistence, and retained
state; Runtime owns the profile diff semantics and digest checks.

#### Parameters

##### input

[`AgentImprovementProfileActivationInput`](#agentimprovementprofileactivationinput)

#### Returns

[`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

***

### composeCertifiedProfile()

> **composeCertifiedProfile**(`base`, `manifest`, `ctx?`): `Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

Compose a certified profile into a uniform `ResolvedSurface`. Additive over
`composeCertifiedPrompt`: the inline/context fold is delegated to
`composeCertifiedPrompt` so the byte-stable ordering (prompt surface first,
then type alphabetic, then path locale-compare) is reused EXACTLY — the
prompt-only path is a strict subset of this.

Fail-closed: a `null` manifest returns the base surface only.

#### Parameters

##### base

###### systemPrompt

`string`

##### manifest

[`CapabilityManifest`](#capabilitymanifest) \| `null`

##### ctx?

[`ResolveCtx`](#resolvectx) = `{}`

#### Returns

`Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

***

### composeCertifiedProfileFromWire()

> **composeCertifiedProfileFromWire**(`base`, `profile`, `ctx?`): `Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

Lower a plane `CertifiedProfile` straight into a `ResolvedSurface` via
 `manifestFromProfile` — the convenience the shipped pull lane calls when it
 already holds a `CertifiedProfile` (today's wire) rather than a manifest.

#### Parameters

##### base

###### systemPrompt

`string`

##### profile

[`CertifiedProfile`](#certifiedprofile) \| `null`

##### ctx?

[`ResolveCtx`](#resolvectx) = `{}`

#### Returns

`Promise`\<[`ResolvedSurface`](#resolvedsurface)\>

***

### withIntelligence()

> **withIntelligence**\<`I`, `O`\>(`agent`, `config`): [`IntelligenceWrapped`](#intelligencewrapped)\<`I`, `O`\>

Wrap an agent so it (a) RECEIVES the tenant's certified profile — the prompt
surface to fold and the promoted profile diffs as proposals — and (b) SENDS a
typed [RunRecord](#runrecord) per call to the plane. The pull is cached and refreshed
at most every `refreshMs`; a failed pull is fail-closed (the agent runs on its
base surface, never breaks because Intelligence is unreachable). The send is
best-effort — an export failure never fails the agent's turn — while an error
thrown by the agent itself propagates unchanged.

#### Type Parameters

##### I

`I`

##### O

`O`

#### Parameters

##### agent

[`IntelligenceAgent`](#intelligenceagent)\<`I`, `O`\>

##### config

[`IntelligenceHookConfig`](#intelligencehookconfig)

#### Returns

[`IntelligenceWrapped`](#intelligencewrapped)\<`I`, `O`\>

***

### defaultRedactor()

> **defaultRedactor**(`value`): `unknown`

The built-in redactor. Walks objects and arrays; replaces values under
secret-bearing keys wholesale; scrubs in-value patterns from every string.
Cycle-safe (a seen-set short-circuits self-referential payloads to
`'[circular]'`), depth-bounded, and total — never throws on customer input.

#### Parameters

##### value

`unknown`

#### Returns

`unknown`

***

### resolveRedactor()

> **resolveRedactor**(`redact`): [`Redactor`](#redactor)

Resolve the redactor a client uses. A caller-supplied hook handles
domain-specific values first, then the built-in scrubber still removes
common credentials and email addresses. Returning `false` is the explicit
opt-out for already-reviewed public values.

#### Parameters

##### redact

`false` \| [`Redactor`](#redactor) \| `undefined`

#### Returns

[`Redactor`](#redactor)
