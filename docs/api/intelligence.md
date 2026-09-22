[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / intelligence

# intelligence

## Classes

### AgentCandidateExperimentCellExecutionError

Defined in: src/intelligence/improvement-cycle.ts:141

A failed baseline or candidate cell with its complete Runtime failure result.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new AgentCandidateExperimentCellExecutionError**(`finalization`): [`AgentCandidateExperimentCellExecutionError`](#agentcandidateexperimentcellexecutionerror)

Defined in: src/intelligence/improvement-cycle.ts:144

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

Defined in: src/intelligence/improvement-cycle.ts:142

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

Defined in: src/intelligence/activation.ts:29

#### Properties

##### completedAt

> **completedAt**: `string`

Defined in: src/intelligence/activation.ts:30

##### outcome

> **outcome**: `AgentImprovementActivationOutcome`

Defined in: src/intelligence/activation.ts:31

***

### AgentImprovementActivationTargetPlan

Defined in: src/intelligence/activation.ts:34

#### Extends

- `AgentImprovementActivationTarget`

#### Properties

##### desiredDigest

> **desiredDigest**: `` `sha256:${string}` ``

Defined in: src/intelligence/activation.ts:35

##### desiredInput

> **desiredInput**: `unknown`

Defined in: src/intelligence/activation.ts:41

Exact measured input the product must apply to reach `desiredDigest`.
Transition surfaces such as code and knowledge are applied operations, so
their resulting state digest is not the digest of this input document.

***

### AgentImprovementActivationTransitionInput

Defined in: src/intelligence/activation.ts:44

#### Properties

##### activation

> **activation**: `AgentImprovementActivation`

Defined in: src/intelligence/activation.ts:45

##### candidateBundle

> **candidateBundle**: `AgentCandidateBundle`

Defined in: src/intelligence/activation.ts:46

##### bundle

> **bundle**: `AgentCandidateBundle`

Defined in: src/intelligence/activation.ts:47

##### targets

> **targets**: \[[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `...AgentImprovementActivationTargetPlan[]`\]

Defined in: src/intelligence/activation.ts:48

##### attemptedAt

> **attemptedAt**: `string`

Defined in: src/intelligence/activation.ts:49

##### expired

> **expired**: `boolean`

Defined in: src/intelligence/activation.ts:50

***

### AgentImprovementActivationResultStore

Defined in: src/intelligence/activation.ts:53

#### Methods

##### load()

> **load**(`idempotencyKey`): `Promise`\<`unknown`\>

Defined in: src/intelligence/activation.ts:54

###### Parameters

###### idempotencyKey

`` `sha256:${string}` ``

###### Returns

`Promise`\<`unknown`\>

##### putIfAbsent()

> **putIfAbsent**(`result`): `Promise`\<`unknown`\>

Defined in: src/intelligence/activation.ts:55

###### Parameters

###### result

`AgentImprovementActivationResult`

###### Returns

`Promise`\<`unknown`\>

***

### ExecuteAgentImprovementActivationInput

Defined in: src/intelligence/activation.ts:80

#### Properties

##### proposal

> **proposal**: [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: src/intelligence/activation.ts:81

##### review

> **review**: `AgentImprovementReview`

Defined in: src/intelligence/activation.ts:82

##### activation

> **activation**: `AgentImprovementActivation`

Defined in: src/intelligence/activation.ts:83

***

### ExecuteAgentImprovementActivationOptions

Defined in: src/intelligence/activation.ts:86

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](#agentimprovementactivationtransition)

Defined in: src/intelligence/activation.ts:87

##### reconcile?

> `optional` **reconcile?**: [`AgentImprovementActivationReconciliation`](#agentimprovementactivationreconciliation)

Defined in: src/intelligence/activation.ts:88

##### now?

> `optional` **now?**: () => `Date`

Defined in: src/intelligence/activation.ts:89

###### Returns

`Date`

***

### IntelligenceEndpointPolicy

Defined in: src/intelligence/delivery.ts:41

#### Extended by

- [`PullCertifiedContextOptions`](#pullcertifiedcontextoptions)
- [`SubmitAgentImprovementProposalOptions`](#submitagentimprovementproposaloptions)

#### Properties

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/delivery.ts:47

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin. A custom `baseUrl` is rejected unless its origin is
listed here.

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/delivery.ts:49

Permit explicit loopback HTTP endpoints for local development and tests.

***

### PullCertifiedContextOptions

Defined in: src/intelligence/delivery.ts:52

#### Extends

- [`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy)

#### Extended by

- [`CertifiedContextSourceOptions`](#certifiedcontextsourceoptions)

#### Properties

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/delivery.ts:47

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin. A custom `baseUrl` is rejected unless its origin is
listed here.

###### Inherited from

[`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy).[`trustedBaseOrigins`](#trustedbaseorigins)

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/delivery.ts:49

Permit explicit loopback HTTP endpoints for local development and tests.

###### Inherited from

[`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy).[`allowInsecureLoopback`](#allowinsecureloopback)

##### tenantId

> **tenantId**: `string`

Defined in: src/intelligence/delivery.ts:54

Authenticated tenant expected in the signed response.

##### target

> **target**: `string`

Defined in: src/intelligence/delivery.ts:56

Agent target the certified context is promoted under.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: src/intelligence/delivery.ts:58

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: src/intelligence/delivery.ts:61

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/intelligence/delivery.ts:63

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

Defined in: src/intelligence/delivery.ts:65

Abort the request after this many ms. Default 10000.

##### now?

> `optional` **now?**: () => `number`

Defined in: src/intelligence/delivery.ts:67

Current time source for expiry checks. Defaults to `Date.now`.

###### Returns

`number`

***

### SubmitAgentImprovementProposalOptions

Defined in: src/intelligence/delivery.ts:77

Submit a completed measured proposal for product-side review.

#### Extends

- [`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy)

#### Properties

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/delivery.ts:47

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin. A custom `baseUrl` is rejected unless its origin is
listed here.

###### Inherited from

[`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy).[`trustedBaseOrigins`](#trustedbaseorigins)

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/delivery.ts:49

Permit explicit loopback HTTP endpoints for local development and tests.

###### Inherited from

[`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy).[`allowInsecureLoopback`](#allowinsecureloopback)

##### proposal

> **proposal**: [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: src/intelligence/delivery.ts:78

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: src/intelligence/delivery.ts:80

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: src/intelligence/delivery.ts:83

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
`https://intelligence.tangle.tools`.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/intelligence/delivery.ts:85

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

Defined in: src/intelligence/delivery.ts:87

Abort the request after this many ms. Default 10000.

***

### ComposedCertifiedContext

Defined in: src/intelligence/delivery.ts:538

#### Properties

##### systemPrompt

> `readonly` **systemPrompt**: `string`

Defined in: src/intelligence/delivery.ts:539

##### promptAdditions

> `readonly` **promptAdditions**: readonly `string`[]

Defined in: src/intelligence/delivery.ts:540

##### files

> `readonly` **files**: readonly `Readonly`\<\{ `path`: `string`; `content`: `string`; \}\>[]

Defined in: src/intelligence/delivery.ts:541

***

### CertifiedContextSource

Defined in: src/intelligence/delivery.ts:574

A cached, self-refreshing source of one certified context bundle.

#### Methods

##### compose()

> **compose**(`base`): `Promise`\<`string`\>

Defined in: src/intelligence/delivery.ts:577

Refresh (window-respecting) then fold the certified additions into a
 base system prompt. Returns `base` unchanged when context is unavailable.

###### Parameters

###### base

`string`

###### Returns

`Promise`\<`string`\>

##### current()

> **current**(): `CertifiedContext` \| `null`

Defined in: src/intelligence/delivery.ts:579

The immutable certified context currently in effect.

###### Returns

`CertifiedContext` \| `null`

##### refresh()

> **refresh**(): `Promise`\<`void`\>

Defined in: src/intelligence/delivery.ts:581

Pull now if the refresh window has elapsed; coalesced and fail-closed.

###### Returns

`Promise`\<`void`\>

***

### CertifiedContextCheckpointKey

Defined in: src/intelligence/delivery.ts:584

#### Extended by

- [`CertifiedContextCheckpoint`](#certifiedcontextcheckpoint)

#### Properties

##### tenantId

> `readonly` **tenantId**: `string`

Defined in: src/intelligence/delivery.ts:585

##### target

> `readonly` **target**: `string`

Defined in: src/intelligence/delivery.ts:586

***

### CertifiedContextCheckpoint

Defined in: src/intelligence/delivery.ts:590

Durable rollback state for one tenant and target. It contains no delivered content.

#### Extends

- [`CertifiedContextCheckpointKey`](#certifiedcontextcheckpointkey)

#### Properties

##### tenantId

> `readonly` **tenantId**: `string`

Defined in: src/intelligence/delivery.ts:585

###### Inherited from

[`CertifiedContextCheckpointKey`](#certifiedcontextcheckpointkey).[`tenantId`](#tenantid-1)

##### target

> `readonly` **target**: `string`

Defined in: src/intelligence/delivery.ts:586

###### Inherited from

[`CertifiedContextCheckpointKey`](#certifiedcontextcheckpointkey).[`target`](#target-1)

##### revision

> `readonly` **revision**: `string`

Defined in: src/intelligence/delivery.ts:591

##### contentHash

> `readonly` **contentHash**: `` `sha256:${string}` ``

Defined in: src/intelligence/delivery.ts:592

##### state

> `readonly` **state**: `"active"` \| `"revoked"`

Defined in: src/intelligence/delivery.ts:593

***

### CertifiedContextCheckpointStore

Defined in: src/intelligence/delivery.ts:601

Caller-owned durable storage for certified-context rollback protection.
`save` must atomically retain the highest revision and reject rollback or an
equal-revision content/state conflict when multiple sources write concurrently.

#### Methods

##### load()

> **load**(`key`): `Promise`\<[`CertifiedContextCheckpoint`](#certifiedcontextcheckpoint) \| `null`\>

Defined in: src/intelligence/delivery.ts:602

###### Parameters

###### key

[`CertifiedContextCheckpointKey`](#certifiedcontextcheckpointkey)

###### Returns

`Promise`\<[`CertifiedContextCheckpoint`](#certifiedcontextcheckpoint) \| `null`\>

##### save()

> **save**(`checkpoint`): `Promise`\<`void`\>

Defined in: src/intelligence/delivery.ts:603

###### Parameters

###### checkpoint

[`CertifiedContextCheckpoint`](#certifiedcontextcheckpoint)

###### Returns

`Promise`\<`void`\>

***

### CertifiedContextSourceOptions

Defined in: src/intelligence/delivery.ts:608

Options for [createCertifiedContextSource](#createcertifiedcontextsource) plus
 the refresh cadence.

#### Extends

- [`PullCertifiedContextOptions`](#pullcertifiedcontextoptions)

#### Properties

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/delivery.ts:47

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin. A custom `baseUrl` is rejected unless its origin is
listed here.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`trustedBaseOrigins`](#trustedbaseorigins-1)

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/delivery.ts:49

Permit explicit loopback HTTP endpoints for local development and tests.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`allowInsecureLoopback`](#allowinsecureloopback-1)

##### tenantId

> **tenantId**: `string`

Defined in: src/intelligence/delivery.ts:54

Authenticated tenant expected in the signed response.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`tenantId`](#tenantid)

##### target

> **target**: `string`

Defined in: src/intelligence/delivery.ts:56

Agent target the certified context is promoted under.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`target`](#target)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: src/intelligence/delivery.ts:58

Bearer key. Defaults to `process.env.TANGLE_API_KEY`.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`apiKey`](#apikey)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: src/intelligence/delivery.ts:61

Plane base URL. Defaults to `process.env.TANGLE_INTELLIGENCE_URL` then
 `https://intelligence.tangle.tools`.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`baseUrl`](#baseurl)

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/intelligence/delivery.ts:63

fetch impl (tests / non-global-fetch runtimes). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`fetchImpl`](#fetchimpl)

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: src/intelligence/delivery.ts:65

Abort the request after this many ms. Default 10000.

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`timeoutMs`](#timeoutms)

##### now?

> `optional` **now?**: () => `number`

Defined in: src/intelligence/delivery.ts:67

Current time source for expiry checks. Defaults to `Date.now`.

###### Returns

`number`

###### Inherited from

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions).[`now`](#now-1)

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: src/intelligence/delivery.ts:610

Min interval between certified-context pulls. Default 5m.

##### checkpointStore?

> `optional` **checkpointStore?**: [`CertifiedContextCheckpointStore`](#certifiedcontextcheckpointstore)

Defined in: src/intelligence/delivery.ts:615

Persist the highest accepted revision across source recreation and process
restarts. Without a store, rollback protection lasts for this source only.

##### onReject?

> `optional` **onReject?**: (`error`) => `void`

Defined in: src/intelligence/delivery.ts:617

Observe rollback, conflicting revision, or incompatible endpoint responses.

###### Parameters

###### error

`Error`

###### Returns

`void`

***

### EffortSettings

Defined in: src/intelligence/effort.ts:32

The flat, resolved settings a tier compiles to. Every field is individually
overridable through `resolveEffort`. Pure data — read by the wrapper, never
self-executing.

#### Properties

##### analysts

> **analysts**: `boolean`

Defined in: src/intelligence/effort.ts:34

Whether trace-derived analyst diagnosis may spawn. `false` ⇒ no analyst.

##### corpus

> **corpus**: [`CorpusAccess`](#corpusaccess)

Defined in: src/intelligence/effort.ts:36

Cross-run corpus access this tier permits.

##### fanout

> **fanout**: `number`

Defined in: src/intelligence/effort.ts:38

Parallel candidate width. `1` ⇒ single-shot, no breadth.

##### loops

> **loops**: `boolean`

Defined in: src/intelligence/effort.ts:40

Whether multi-step improvement loops (refine / fanout-vote) may run.

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: src/intelligence/effort.ts:47

Ceiling, in USD, for INTELLIGENCE-class spawns only (analysts, corpus,
loops) — NOT base inference. `0` refuses every intelligence spawn; `null`
means uncapped (the spend lands on the Pareto receipt). Base-stream
inference is billed on its own channel and is never constrained here.

***

### EffortOverridesCompiled

Defined in: src/intelligence/effort.ts:157

The run-config overrides an `EffortSettings` compiles to — the bridge between the
pure effort policy and the orchestration entrypoints (`runPersonaShape` / the
improvement cycle). This is ONLY data: it never constructs an analyst or runs a
loop. The caller reads these flags to decide WHAT to pass:

 - `withAnalyst: false` ⇒ DO NOT construct/pass a `ScopeAnalyst` to `runPersonaShape`
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

Defined in: src/intelligence/effort.ts:159

Construct + pass a `ScopeAnalyst`? `false` ⇒ omit it (degrade to the base agent).

##### fanout

> **fanout**: `number`

Defined in: src/intelligence/effort.ts:161

`ShapeBudget.fanout` width to pass to `runPersonaShape`.

##### withLoops

> **withLoops**: `boolean`

Defined in: src/intelligence/effort.ts:163

Run the multi-step improvement cycle, or no-op it for this run?

##### intelligenceBudgetUsd

> **intelligenceBudgetUsd**: `number` \| `null`

Defined in: src/intelligence/effort.ts:165

Intelligence-class spend ceiling. `0` refuses every intelligence spawn; `null` uncapped.

***

### CreateExactProcessCandidateExperimentExecutorOptions

Defined in: src/intelligence/exact-process-candidate.ts:45

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

Defined in: src/intelligence/exact-process-candidate.ts:46

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: src/intelligence/exact-process-candidate.ts:47

##### resources

> **resources**: `AgentExactProcessResources`

Defined in: src/intelligence/exact-process-candidate.ts:48

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

Defined in: src/intelligence/exact-process-candidate.ts:49

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:50

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:51

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: src/intelligence/exact-process-candidate.ts:52

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

Defined in: src/intelligence/exact-process-candidate.ts:53

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

Defined in: src/intelligence/exact-process-candidate.ts:54

##### traceStore

> **traceStore**: `TraceStore`

Defined in: src/intelligence/exact-process-candidate.ts:55

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

Defined in: src/intelligence/exact-process-candidate.ts:56

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:57

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:58

***

### CreateProtectedExactProcessCandidateExperimentExecutorOptions

Defined in: src/intelligence/exact-process-candidate.ts:68

Builds the standard exact-process executor with model access that is scoped,
metered, and settled by the caller's grant service.

#### Extends

- `Omit`\<[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions), `"ports"`\>

#### Properties

##### provider

> **provider**: [`AgentEnvironmentProviderRef`](runtime/environment-provider.md#agentenvironmentproviderref)

Defined in: src/intelligence/exact-process-candidate.ts:46

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provider`](#provider)

##### providerRegistry?

> `optional` **providerRegistry?**: [`AgentEnvironmentProviderRegistry`](runtime/environment-provider.md#agentenvironmentproviderregistry)

Defined in: src/intelligence/exact-process-candidate.ts:47

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerRegistry`](#providerregistry)

##### resources

> **resources**: `AgentExactProcessResources`

Defined in: src/intelligence/exact-process-candidate.ts:48

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resources`](#resources)

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

Defined in: src/intelligence/exact-process-candidate.ts:49

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`providerOptions`](#provideroptions)

##### provisionTimeoutMs?

> `optional` **provisionTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:50

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`provisionTimeoutMs`](#provisiontimeoutms)

##### recoveryRetentionMs?

> `optional` **recoveryRetentionMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:51

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`recoveryRetentionMs`](#recoveryretentionms)

##### grader

> **grader**: [`AgentCandidateBenchmarkGraderPort`](index.md#agentcandidatebenchmarkgraderport)

Defined in: src/intelligence/exact-process-candidate.ts:53

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`grader`](#grader)

##### outputArtifacts

> **outputArtifacts**: [`AgentCandidateOutputArtifactPort`](index.md#agentcandidateoutputartifactport)

Defined in: src/intelligence/exact-process-candidate.ts:54

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`outputArtifacts`](#outputartifacts)

##### traceStore

> **traceStore**: `TraceStore`

Defined in: src/intelligence/exact-process-candidate.ts:55

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`traceStore`](#tracestore)

##### claimStore

> **claimStore**: [`AgentCandidateExecutionClaimStore`](index.md#agentcandidateexecutionclaimstore)

Defined in: src/intelligence/exact-process-candidate.ts:56

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`claimStore`](#claimstore)

##### cleanupTimeoutMs?

> `optional` **cleanupTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:57

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`cleanupTimeoutMs`](#cleanuptimeoutms)

##### resultTimeoutMs?

> `optional` **resultTimeoutMs?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:58

###### Inherited from

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions).[`resultTimeoutMs`](#resulttimeoutms)

##### hostPorts

> **hostPorts**: [`AgentCandidateExecutionHostPorts`](#agentcandidateexecutionhostports)

Defined in: src/intelligence/exact-process-candidate.ts:70

##### model

> **model**: [`CreateProtectedAgentCandidateModelPortOptions`](index.md#createprotectedagentcandidatemodelportoptions)

Defined in: src/intelligence/exact-process-candidate.ts:71

***

### ExactProcessCandidateExperimentExecution

Defined in: src/intelligence/exact-process-candidate.ts:74

#### Extends

- `CandidateExperimentExecutionInput`

#### Properties

##### executionId

> **executionId**: `string`

Defined in: src/intelligence/exact-process-candidate.ts:76

##### attempt?

> `optional` **attempt?**: `number`

Defined in: src/intelligence/exact-process-candidate.ts:77

##### executionRoots

> **executionRoots**: `object`

Defined in: src/intelligence/exact-process-candidate.ts:78

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: src/intelligence/exact-process-candidate.ts:79

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: src/intelligence/exact-process-candidate.ts:80

***

### ExactProcessCandidateExperimentExecutor

Defined in: src/intelligence/exact-process-candidate.ts:83

#### Extended by

- [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Defined in: src/intelligence/exact-process-candidate.ts:85

Runtime's expired-attempt path reuses this port only to stop and dispose.

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: src/intelligence/exact-process-candidate.ts:86

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### ProtectedExactProcessCandidateExperimentExecutor

Defined in: src/intelligence/exact-process-candidate.ts:90

Exact-process executor plus the ports required for durable recovery.

#### Extends

- [`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

#### Properties

##### executor

> `readonly` **executor**: [`AgentCandidateExecutorPort`](index.md#agentcandidateexecutorport)

Defined in: src/intelligence/exact-process-candidate.ts:85

Runtime's expired-attempt path reuses this port only to stop and dispose.

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`executor`](#executor)

##### recoveryPorts

> `readonly` **recoveryPorts**: `Pick`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"` \| `"memory"`\>

Defined in: src/intelligence/exact-process-candidate.ts:92

#### Methods

##### execute()

> **execute**(`input`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: src/intelligence/exact-process-candidate.ts:86

###### Parameters

###### input

[`ExactProcessCandidateExperimentExecution`](#exactprocesscandidateexperimentexecution)

###### Returns

`Promise`\<`CandidateExecutionEvidence`\>

###### Inherited from

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor).[`execute`](#execute)

***

### AgentCandidateExperimentCellPlacement

Defined in: src/intelligence/improvement-cycle.ts:101

#### Extended by

- [`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: src/intelligence/improvement-cycle.ts:102

##### attempt?

> `optional` **attempt?**: `number`

Defined in: src/intelligence/improvement-cycle.ts:103

##### executionRoots

> **executionRoots**: `object`

Defined in: src/intelligence/improvement-cycle.ts:104

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

##### stagingRoots

> **stagingRoots**: `object`

Defined in: src/intelligence/improvement-cycle.ts:105

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### profileRoot

> **profileRoot**: `string`

##### ports

> **ports**: [`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports)

Defined in: src/intelligence/improvement-cycle.ts:106

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: src/intelligence/improvement-cycle.ts:107

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

Defined in: src/intelligence/improvement-cycle.ts:108

***

### RunAgentCandidateExperimentOptions

Defined in: src/intelligence/improvement-cycle.ts:111

#### Extends

- `Omit`\<`CompareCandidateExperimentOptions`, `"experiment"` \| `"measurements"`\>

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: src/intelligence/improvement-cycle.ts:113

##### placeCell

> **placeCell**: (`input`) => [`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

Defined in: src/intelligence/improvement-cycle.ts:114

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: src/intelligence/improvement-cycle.ts:117

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/intelligence/improvement-cycle.ts:118

***

### RunAgentCandidateExperimentResult

Defined in: src/intelligence/improvement-cycle.ts:121

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: src/intelligence/improvement-cycle.ts:122

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

Defined in: src/intelligence/improvement-cycle.ts:123

##### evaluation

> **evaluation**: `AgentImprovementMeasuredComparison`

Defined in: src/intelligence/improvement-cycle.ts:124

***

### ExecuteAgentCandidateExperimentCellOptions

Defined in: src/intelligence/improvement-cycle.ts:127

#### Extends

- `CandidateExperimentExecutionInput`.[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)

#### Properties

##### executionId

> **executionId**: `string`

Defined in: src/intelligence/improvement-cycle.ts:102

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionId`](#executionid-1)

##### attempt?

> `optional` **attempt?**: `number`

Defined in: src/intelligence/improvement-cycle.ts:103

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`attempt`](#attempt-1)

##### executionRoots

> **executionRoots**: `object`

Defined in: src/intelligence/improvement-cycle.ts:104

###### taskRoot

> **taskRoot**: `string`

###### candidateRoot?

> `optional` **candidateRoot?**: `string`

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`executionRoots`](#executionroots-1)

##### stagingRoots

> **stagingRoots**: `object`

Defined in: src/intelligence/improvement-cycle.ts:105

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

Defined in: src/intelligence/improvement-cycle.ts:106

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`ports`](#ports-1)

##### preparation?

> `optional` **preparation?**: [`PrepareAgentCandidateExecutionOptions`](index.md#prepareagentcandidateexecutionoptions)

Defined in: src/intelligence/improvement-cycle.ts:107

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`preparation`](#preparation-1)

##### execution

> **execution**: [`ExecutePreparedAgentCandidateOptions`](index.md#executepreparedagentcandidateoptions)

Defined in: src/intelligence/improvement-cycle.ts:108

###### Inherited from

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement).[`execution`](#execution)

***

### VerifyCandidateExecutionEvidenceOptions

Defined in: src/intelligence/improvement-cycle.ts:131

#### Properties

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: src/intelligence/improvement-cycle.ts:132

##### arm

> **arm**: `"candidate"` \| `"baseline"`

Defined in: src/intelligence/improvement-cycle.ts:133

##### benchmarkCell

> **benchmarkCell**: `AgentCandidateBenchmarkCellRef`

Defined in: src/intelligence/improvement-cycle.ts:134

##### seed

> **seed**: `number`

Defined in: src/intelligence/improvement-cycle.ts:135

##### attempt?

> `optional` **attempt?**: `number`

Defined in: src/intelligence/improvement-cycle.ts:136

##### resolvedResources?

> `optional` **resolvedResources?**: `ReadonlyMap`\<`` `sha256:${string}` ``, `string`\>

Defined in: src/intelligence/improvement-cycle.ts:137

***

### CreateAgentImprovementProposalOptions

Defined in: src/intelligence/improvement-cycle.ts:151

#### Properties

##### runId

> **runId**: `string`

Defined in: src/intelligence/improvement-cycle.ts:152

##### findings

> **findings**: readonly `AnalystFinding`[]

Defined in: src/intelligence/improvement-cycle.ts:153

##### evaluation

> **evaluation**: `AgentImprovementMeasuredComparison`

Defined in: src/intelligence/improvement-cycle.ts:154

##### now?

> `optional` **now?**: () => `Date`

Defined in: src/intelligence/improvement-cycle.ts:155

###### Returns

`Date`

***

### ReviewAgentImprovementInput

Defined in: src/intelligence/improvement-cycle.ts:160

#### Properties

##### decision

> **decision**: `AgentImprovementReviewDecision`

Defined in: src/intelligence/improvement-cycle.ts:161

##### reviewedBy

> **reviewedBy**: `string`

Defined in: src/intelligence/improvement-cycle.ts:162

##### reason

> **reason**: `string`

Defined in: src/intelligence/improvement-cycle.ts:163

##### feedback?

> `optional` **feedback?**: `string`

Defined in: src/intelligence/improvement-cycle.ts:164

##### now?

> `optional` **now?**: () => `Date`

Defined in: src/intelligence/improvement-cycle.ts:165

###### Returns

`Date`

***

### CreateAgentImprovementActivationOptions

Defined in: src/intelligence/improvement-cycle.ts:168

#### Properties

##### intent

> **intent**: `AgentImprovementActivationIntent`

Defined in: src/intelligence/improvement-cycle.ts:169

##### targets

> **targets**: \[[`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity), `...AgentImprovementActivationTargetIdentity[]`\]

Defined in: src/intelligence/improvement-cycle.ts:171

Runtime derives each exact source digest; callers identify only the records to change.

##### fundingOwner

> **fundingOwner**: `string`

Defined in: src/intelligence/improvement-cycle.ts:172

##### authorizedBy

> **authorizedBy**: `string`

Defined in: src/intelligence/improvement-cycle.ts:173

##### expiresAt

> **expiresAt**: `string`

Defined in: src/intelligence/improvement-cycle.ts:174

##### now?

> `optional` **now?**: () => `Date`

Defined in: src/intelligence/improvement-cycle.ts:175

###### Returns

`Date`

***

### ProposeAgentImprovementOptions

Defined in: src/intelligence/improvement-cycle.ts:178

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### runId

> **runId**: `string`

Defined in: src/intelligence/improvement-cycle.ts:179

##### profile

> **profile**: `AgentProfile`

Defined in: src/intelligence/improvement-cycle.ts:180

##### analysis

> **analysis**: `Omit`\<[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts), `"runId"` \| `"improvementProposalSource"`\>

Defined in: src/intelligence/improvement-cycle.ts:181

##### improvement

> **improvement**: [`ImproveOptions`](index.md#improveoptions)\<`TScenario`, `TArtifact`\>

Defined in: src/intelligence/improvement-cycle.ts:182

##### buildExperiment

> **buildExperiment**: (`input`) => [`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial) \| `Promise`\<[`AgentImprovementExperimentMaterial`](#agentimprovementexperimentmaterial)\>

Defined in: src/intelligence/improvement-cycle.ts:183

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

Defined in: src/intelligence/improvement-cycle.ts:187

###### Parameters

###### input

`CandidateExperimentExecutionInput`

###### Returns

[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement) \| `Promise`\<[`AgentCandidateExperimentCellPlacement`](#agentcandidateexperimentcellplacement)\>

##### maxConcurrency?

> `optional` **maxConcurrency?**: `number`

Defined in: src/intelligence/improvement-cycle.ts:188

##### signal?

> `optional` **signal?**: `AbortSignal`

Defined in: src/intelligence/improvement-cycle.ts:189

##### candidate?

> `optional` **candidate?**: `object`

Defined in: src/intelligence/improvement-cycle.ts:190

##### metadata?

> `optional` **metadata?**: `object`

Defined in: src/intelligence/improvement-cycle.ts:191

###### Index Signature

\[`key`: `string`\]: `AgentCandidateJsonValue`

##### now?

> `optional` **now?**: () => `Date`

Defined in: src/intelligence/improvement-cycle.ts:192

###### Returns

`Date`

***

### ProposeAgentImprovementResult

Defined in: src/intelligence/improvement-cycle.ts:201

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### analysis

> **analysis**: [`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)

Defined in: src/intelligence/improvement-cycle.ts:202

##### improvement

> **improvement**: [`ImproveResult`](index.md#improveresult)\<`TScenario`, `TArtifact`\>

Defined in: src/intelligence/improvement-cycle.ts:203

##### experiment

> **experiment**: `AgentCandidateExperiment`

Defined in: src/intelligence/improvement-cycle.ts:204

##### measurements

> **measurements**: `AgentCandidateExperimentMeasurement`[]

Defined in: src/intelligence/improvement-cycle.ts:205

##### proposal

> **proposal**: [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: src/intelligence/improvement-cycle.ts:206

***

### AgentImprovementTargetProfileDiffOptions

Defined in: src/intelligence/improvement-surfaces.ts:48

#### Properties

##### id

> **id**: `string`

Defined in: src/intelligence/improvement-surfaces.ts:49

##### source?

> `optional` **source?**: `object`

Defined in: src/intelligence/improvement-surfaces.ts:50

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Defined in: src/intelligence/improvement-surfaces.ts:51

***

### UsageSplit

Defined in: src/intelligence/index.ts:204

The per-class cost split carried by every trace and outcome. `off` ⇒
`intelligenceUsd: 0` by construction — there is no intelligence spawn to
bill. This is a classification on the trace, NOT a budget-pool split.

#### Properties

##### inferenceUsd

> **inferenceUsd**: `number`

Defined in: src/intelligence/index.ts:206

Base-stream (model) spend in USD.

##### intelligenceUsd

> **intelligenceUsd**: `number`

Defined in: src/intelligence/index.ts:208

Intelligence-spawn spend in USD. Provably `0` at the OFF tier.

***

### RunRecord

Defined in: src/intelligence/index.ts:218

The typed record `withIntelligence` sends per call — serialized through the
shipped OTLP builders to the plane's `/v1/otlp` ingest. `input`/`output` are
redacted on export; the per-class `usage` split carries the billing proof;
`loopEvents`, when present, export as the nested loop→round→iteration span
tree under the same `traceId`.

#### Properties

##### runId

> **runId**: `string`

Defined in: src/intelligence/index.ts:219

##### traceId

> **traceId**: `string`

Defined in: src/intelligence/index.ts:220

##### project

> **project**: `string`

Defined in: src/intelligence/index.ts:221

##### target

> **target**: `string`

Defined in: src/intelligence/index.ts:222

##### input

> **input**: `unknown`

Defined in: src/intelligence/index.ts:223

##### output

> **output**: `unknown`

Defined in: src/intelligence/index.ts:224

##### outcome

> **outcome**: `object`

Defined in: src/intelligence/index.ts:225

###### success?

> `optional` **success?**: `boolean`

###### score?

> `optional` **score?**: `number`

###### usage

> **usage**: [`UsageSplit`](#usagesplit)

##### model?

> `optional` **model?**: `string`

Defined in: src/intelligence/index.ts:230

##### provider?

> `optional` **provider?**: `string`

Defined in: src/intelligence/index.ts:231

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: src/intelligence/index.ts:232

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: src/intelligence/index.ts:233

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: src/intelligence/index.ts:234

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: src/intelligence/index.ts:235

##### harness?

> `optional` **harness?**: `string`

Defined in: src/intelligence/index.ts:236

##### repository?

> `optional` **repository?**: `string`

Defined in: src/intelligence/index.ts:237

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: src/intelligence/index.ts:238

##### timing?

> `optional` **timing?**: `object`

Defined in: src/intelligence/index.ts:239

###### startedAt

> **startedAt**: `number`

###### completedAt

> **completedAt**: `number`

###### durationMs

> **durationMs**: `number`

##### tokens?

> `optional` **tokens?**: `object`

Defined in: src/intelligence/index.ts:240

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

Defined in: src/intelligence/index.ts:246

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

Defined in: src/intelligence/index.ts:248

Exact proposal → review → execution → receipt linkage for candidate runs.

***

### RunReport

Defined in: src/intelligence/index.ts:257

What an agent reports (via `applied.record`) to enrich the [RunRecord](#runrecord)
sent for its call. All optional — an un-recorded run still sends input/output
with an inference-only zero usage split. `costUsd` without a split is treated
as pure inference (the base stream).

#### Properties

##### success?

> `optional` **success?**: `boolean`

Defined in: src/intelligence/index.ts:258

##### score?

> `optional` **score?**: `number`

Defined in: src/intelligence/index.ts:259

##### usage?

> `optional` **usage?**: `Partial`\<[`UsageSplit`](#usagesplit)\>

Defined in: src/intelligence/index.ts:260

##### costUsd?

> `optional` **costUsd?**: `number`

Defined in: src/intelligence/index.ts:261

##### model?

> `optional` **model?**: `string`

Defined in: src/intelligence/index.ts:262

##### provider?

> `optional` **provider?**: `string`

Defined in: src/intelligence/index.ts:263

##### loopEvents?

> `optional` **loopEvents?**: [`LoopTraceEvent`](runtime.md#looptraceevent)[]

Defined in: src/intelligence/index.ts:264

##### runtimeEvents?

> `optional` **runtimeEvents?**: [`RuntimeStreamEvent`](index.md#runtimestreamevent)[]

Defined in: src/intelligence/index.ts:265

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: src/intelligence/index.ts:266

##### sessionId?

> `optional` **sessionId?**: `string`

Defined in: src/intelligence/index.ts:267

##### harness?

> `optional` **harness?**: `string`

Defined in: src/intelligence/index.ts:268

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: src/intelligence/index.ts:269

##### tokens?

> `optional` **tokens?**: `object`

Defined in: src/intelligence/index.ts:270

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

Defined in: src/intelligence/index.ts:271

###### name

> **name**: `string`

###### message

> **message**: `string`

###### code?

> `optional` **code?**: `string`

##### candidateExecution?

> `optional` **candidateExecution?**: `CandidateExecutionEvidence`

Defined in: src/intelligence/index.ts:272

***

### RepoConfig

Defined in: src/intelligence/index.ts:278

Repo coordinates a product may declare for the (later) Gated-PR mode. The
 Observe slice only records their PRESENCE for `doctor()`; it never touches
 the repo.

#### Properties

##### owner

> **owner**: `string`

Defined in: src/intelligence/index.ts:279

##### name

> **name**: `string`

Defined in: src/intelligence/index.ts:280

##### baseBranch

> **baseBranch**: `string`

Defined in: src/intelligence/index.ts:281

***

### IntelligenceConfig

Defined in: src/intelligence/index.ts:303

Client configuration. `project` + `apiKey` are the Observe minimum; the
 rest tune effort, endpoint, redaction, and (for `doctor()` readiness)
 declare the surfaces/checks/repo a later PR mode would need.

#### Extended by

- [`IntelligenceHookConfig`](#intelligencehookconfig)

#### Properties

##### project

> **project**: `string`

Defined in: src/intelligence/index.ts:305

Stable project id — the tenant dimension every trace is tagged with.

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: src/intelligence/index.ts:307

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: src/intelligence/index.ts:309

Effort tier (default `'standard'`) plus optional per-field overrides.

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: src/intelligence/index.ts:317

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/contexts/:target/certified`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/index.ts:322

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin.

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/index.ts:324

Permit loopback HTTP when running a local Intelligence service.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: src/intelligence/index.ts:330

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: src/intelligence/index.ts:332

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

##### checks?

> `optional` **checks?**: `string`[]

Defined in: src/intelligence/index.ts:334

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: src/intelligence/index.ts:336

Repo access a later PR mode would need. Recorded for `doctor()` only.

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: src/intelligence/index.ts:338

Full canonical profile used for this agent. Exported redacted with a stable hash.

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: src/intelligence/index.ts:340

Commit that produced the running agent, when known.

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: src/intelligence/index.ts:342

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

##### telemetryExport?

> `optional` **telemetryExport?**: [`IntelligenceTelemetryExportOptions`](#intelligencetelemetryexportoptions)

Defined in: src/intelligence/index.ts:344

OTLP queue limits, retry timing, request deadline, and drop observer.

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: src/intelligence/index.ts:351

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

***

### TraceMeta

Defined in: src/intelligence/index.ts:355

Metadata describing one traced run. `runId`/`traceId` default to fresh ids.

#### Properties

##### input?

> `optional` **input?**: `unknown`

Defined in: src/intelligence/index.ts:357

The run's input — exported through the redactor.

##### runId?

> `optional` **runId?**: `string`

Defined in: src/intelligence/index.ts:359

Stable run id. Defaults to a fresh id.

##### traceId?

> `optional` **traceId?**: `string`

Defined in: src/intelligence/index.ts:361

32-hex trace id. Defaults to a fresh id.

##### model?

> `optional` **model?**: `string`

Defined in: src/intelligence/index.ts:363

Model id, when known — stamped on the span.

##### provider?

> `optional` **provider?**: `string`

Defined in: src/intelligence/index.ts:365

Provider name, when known — stamped on the span.

##### labels?

> `optional` **labels?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Defined in: src/intelligence/index.ts:367

Arbitrary extra labels (string/number/boolean) stamped on the span.

***

### TraceHandle

Defined in: src/intelligence/index.ts:376

The trace handle a `traceRun` body records into. `recordOutput` captures the
agent's result (redacted on export); `recordOutcome` captures the scored
outcome + the `{ inferenceUsd, intelligenceUsd }` split. Both are optional —
an un-recorded run still exports a span with whatever was set.

#### Methods

##### recordOutput()

> **recordOutput**(`output`): `void`

Defined in: src/intelligence/index.ts:378

Capture the run's output. Exported through the redactor.

###### Parameters

###### output

`unknown`

###### Returns

`void`

##### recordOutcome()

> **recordOutcome**(`outcome`): `void`

Defined in: src/intelligence/index.ts:385

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

Defined in: src/intelligence/index.ts:394

Metadata for [IntelligenceClient.recordTrace](#recordtrace).

#### Properties

##### traceId?

> `optional` **traceId?**: `string`

Defined in: src/intelligence/index.ts:396

32-hex trace id to anchor every span to. Defaults to a fresh id.

##### rootParentSpanId?

> `optional` **rootParentSpanId?**: `string`

Defined in: src/intelligence/index.ts:399

Span id of an enclosing span the loop root should parent under (e.g. a
 `traceRun` span). Omitted ⇒ the loop root is the trace root.

***

### TraceOutcome

Defined in: src/intelligence/index.ts:404

The resolved outcome of one traced run, surfaced on the export span and
 available to the caller for downstream billing assertions.

#### Properties

##### runId

> **runId**: `string`

Defined in: src/intelligence/index.ts:405

##### traceId

> **traceId**: `string`

Defined in: src/intelligence/index.ts:406

##### project

> **project**: `string`

Defined in: src/intelligence/index.ts:407

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: src/intelligence/index.ts:409

The resolved effort settings this run executed under.

##### intelligenceOff

> **intelligenceOff**: `boolean`

Defined in: src/intelligence/index.ts:411

True when this run ran as pure passthrough (the OFF floor).

##### success?

> `optional` **success?**: `boolean`

Defined in: src/intelligence/index.ts:412

##### score?

> `optional` **score?**: `number`

Defined in: src/intelligence/index.ts:413

##### usage

> **usage**: [`UsageSplit`](#usagesplit)

Defined in: src/intelligence/index.ts:415

Per-class billing split. `intelligenceUsd` is `0` at the OFF tier.

***

### IntelligenceClient

Defined in: src/intelligence/index.ts:419

The Observe-mode Intelligence client.

#### Properties

##### project

> `readonly` **project**: `string`

Defined in: src/intelligence/index.ts:421

The resolved project id.

##### effort

> `readonly` **effort**: [`EffortSettings`](#effortsettings)

Defined in: src/intelligence/index.ts:423

The resolved effort settings.

#### Methods

##### traceRun()

> **traceRun**\<`T`\>(`meta`, `fn`): `Promise`\<`T`\>

Defined in: src/intelligence/index.ts:429

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

Defined in: src/intelligence/index.ts:439

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

Defined in: src/intelligence/index.ts:447

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

Defined in: src/intelligence/index.ts:449

Mint a fresh run id (`run-<hex>`).

###### Returns

`string`

##### freshTraceId()

> **freshTraceId**(): `string`

Defined in: src/intelligence/index.ts:451

Mint a fresh 32-hex trace id.

###### Returns

`string`

##### doctor()

> **doctor**(): [`DoctorReport`](#doctorreport)

Defined in: src/intelligence/index.ts:457

Network-free readiness report: which adoption modes are reachable given
this config. Observe is always reachable; Recommend needs outcomes; PR
needs checks + surfaces + repo.

###### Returns

[`DoctorReport`](#doctorreport)

##### flush()

> **flush**(): `Promise`\<[`OtelFlushResult`](index.md#otelflushresult)\>

Defined in: src/intelligence/index.ts:459

Flush pending spans and report confirmed, undelivered, and dropped totals.

###### Returns

`Promise`\<[`OtelFlushResult`](index.md#otelflushresult)\>

***

### ModeReadiness

Defined in: src/intelligence/index.ts:463

One mode's readiness verdict.

#### Properties

##### ready

> **ready**: `boolean`

Defined in: src/intelligence/index.ts:464

##### missing

> **missing**: `string`[]

Defined in: src/intelligence/index.ts:466

Inputs this mode still needs, when not ready. Empty when ready.

***

### DoctorReport

Defined in: src/intelligence/index.ts:470

The `doctor()` readiness report — Mode-readiness without any network call.

#### Properties

##### project

> **project**: `string`

Defined in: src/intelligence/index.ts:471

##### effort

> **effort**: [`EffortSettings`](#effortsettings)

Defined in: src/intelligence/index.ts:472

##### exportConfigured

> **exportConfigured**: `boolean`

Defined in: src/intelligence/index.ts:474

True when an OTLP endpoint is configured (export will actually ship).

##### modes

> **modes**: `object`

Defined in: src/intelligence/index.ts:475

###### observe

> **observe**: [`ModeReadiness`](#modereadiness)

###### recommend

> **recommend**: [`ModeReadiness`](#modereadiness)

###### pr

> **pr**: [`ModeReadiness`](#modereadiness)

***

### OptimizationActivationReceipt

Defined in: src/intelligence/optimization-receipt.ts:24

#### Properties

##### kind

> **kind**: `"optimization-activation-receipt"`

Defined in: src/intelligence/optimization-receipt.ts:25

##### method

> **method**: `string`

Defined in: src/intelligence/optimization-receipt.ts:26

##### source

> **source**: `OptimizationPackageSource`

Defined in: src/intelligence/optimization-receipt.ts:27

##### bridge?

> `optional` **bridge?**: `OptimizationPackageSource`

Defined in: src/intelligence/optimization-receipt.ts:28

##### modules?

> `optional` **modules?**: `OptimizationModuleSource`[]

Defined in: src/intelligence/optimization-receipt.ts:29

##### python?

> `optional` **python?**: `OptimizationPythonRuntime`

Defined in: src/intelligence/optimization-receipt.ts:30

##### models?

> `optional` **models?**: `object`

Defined in: src/intelligence/optimization-receipt.ts:31

###### candidate?

> `optional` **candidate?**: `AgentProfileModelHints`

###### optimizer?

> `optional` **optimizer?**: `string`

##### usage

> **usage**: `object`

Defined in: src/intelligence/optimization-receipt.ts:35

###### optimizerEvaluations

> **optimizerEvaluations**: `number`

###### optimizerTokens?

> `optional` **optimizerTokens?**: `OptimizationTokenUsage`

##### cost

> **cost**: `object`

Defined in: src/intelligence/optimization-receipt.ts:39

###### optimization

> **optimization**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### finalTest

> **finalTest**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

###### total

> **total**: [`OptimizationReceiptCost`](#optimizationreceiptcost)

##### invocation

> **invocation**: `object`

Defined in: src/intelligence/optimization-receipt.ts:44

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

Defined in: src/intelligence/optimization-receipt.ts:51

##### digest

> **digest**: `` `sha256:${string}` ``

Defined in: src/intelligence/optimization-receipt.ts:52

***

### OptimizationReceiptCost

Defined in: src/intelligence/optimization-receipt.ts:55

#### Properties

##### totalUsd

> **totalUsd**: `number`

Defined in: src/intelligence/optimization-receipt.ts:56

##### accountingComplete

> **accountingComplete**: `boolean`

Defined in: src/intelligence/optimization-receipt.ts:57

##### incompleteReasons

> **incompleteReasons**: `string`[]

Defined in: src/intelligence/optimization-receipt.ts:58

***

### AgentImprovementProfileReplacement

Defined in: src/intelligence/profile-activation.ts:37

#### Properties

##### identity

> **identity**: `string`

Defined in: src/intelligence/profile-activation.ts:38

##### profile

> **profile**: `AgentProfile`

Defined in: src/intelligence/profile-activation.ts:39

***

### AppliedIntelligence

Defined in: src/intelligence/with-intelligence.ts:43

What the hook hands the agent each run. `composePrompt` folds certified
context and `record` enriches the [RunRecord](#runrecord) that is sent.

#### Properties

##### runId

> **runId**: `string`

Defined in: src/intelligence/with-intelligence.ts:45

Stable ids shared by the run span and every nested runtime/loop span.

##### traceId

> **traceId**: `string`

Defined in: src/intelligence/with-intelligence.ts:46

##### certifiedContext

> **certifiedContext**: `CertifiedContext` \| `null`

Defined in: src/intelligence/with-intelligence.ts:49

The certified context in effect (null when none promoted / pull failed —
 fail-closed: the agent runs on its base surface).

#### Methods

##### composePrompt()

> **composePrompt**(`base`): `string`

Defined in: src/intelligence/with-intelligence.ts:52

Fold the certified prompt surface into a base system prompt (the promoted
 prompt). The consumer opts in by calling it.

###### Parameters

###### base

`string`

###### Returns

`string`

##### record()

> **record**(`report`): `void`

Defined in: src/intelligence/with-intelligence.ts:56

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

Defined in: src/intelligence/with-intelligence.ts:66

`withIntelligence` config = the Observe config plus tenant, pull target,
 refresh cadence, and a certified-context callback. One base URL (`baseUrl` /
 `TANGLE_INTELLIGENCE_URL`) drives both the send and receive paths.

#### Extends

- [`IntelligenceConfig`](#intelligenceconfig)

#### Properties

##### project

> **project**: `string`

Defined in: src/intelligence/index.ts:305

Stable project id — the tenant dimension every trace is tagged with.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`project`](#project-1)

##### apiKey?

> `optional` **apiKey?**: `string`

Defined in: src/intelligence/index.ts:307

Bearer key for the Intelligence ingest. Reads `TANGLE_API_KEY` when omitted.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`apiKey`](#apikey-3)

##### effort?

> `optional` **effort?**: [`EffortTier`](#efforttier) \| \{ `tier`: [`EffortTier`](#efforttier); `overrides?`: `Partial`\<[`EffortSettings`](#effortsettings)\>; \}

Defined in: src/intelligence/index.ts:309

Effort tier (default `'standard'`) plus optional per-field overrides.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`effort`](#effort)

##### baseUrl?

> `optional` **baseUrl?**: `string`

Defined in: src/intelligence/index.ts:317

The ONE Tangle Intelligence base URL — both the send (OTLP `/v1/otlp`) and
receive (`/v1/contexts/:target/certified`) paths derive from it. Reads
`TANGLE_INTELLIGENCE_URL` when omitted, else `https://intelligence.tangle.tools`.
Send is best-effort and only ships when an `apiKey` is present (the tenant
key the ingest requires); absent a key, export is a no-op.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`baseUrl`](#baseurl-3)

##### trustedBaseOrigins?

> `optional` **trustedBaseOrigins?**: readonly `string`[]

Defined in: src/intelligence/index.ts:322

Exact HTTPS origins trusted in addition to the default Tangle
Intelligence origin.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`trustedBaseOrigins`](#trustedbaseorigins-4)

##### allowInsecureLoopback?

> `optional` **allowInsecureLoopback?**: `boolean`

Defined in: src/intelligence/index.ts:324

Permit loopback HTTP when running a local Intelligence service.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`allowInsecureLoopback`](#allowinsecureloopback-4)

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](#redactor)

Defined in: src/intelligence/index.ts:330

Redaction hook run over every exported input/output. A function replaces
the default scrubber; `false` opts out entirely (raw fidelity, caller has
sanitized upstream); omitted ⇒ the built-in `defaultRedactor`.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`redact`](#redact)

##### surfaces?

> `optional` **surfaces?**: `string`[]

Defined in: src/intelligence/index.ts:332

Mutable surfaces a later PR mode would edit. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`surfaces`](#surfaces)

##### checks?

> `optional` **checks?**: `string`[]

Defined in: src/intelligence/index.ts:334

Verification checks a later PR mode would gate on. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`checks`](#checks)

##### repo?

> `optional` **repo?**: [`RepoConfig`](#repoconfig)

Defined in: src/intelligence/index.ts:336

Repo access a later PR mode would need. Recorded for `doctor()` only.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`repo`](#repo)

##### profile?

> `optional` **profile?**: `AgentProfile`

Defined in: src/intelligence/index.ts:338

Full canonical profile used for this agent. Exported redacted with a stable hash.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`profile`](#profile-3)

##### commitSha?

> `optional` **commitSha?**: `string`

Defined in: src/intelligence/index.ts:340

Commit that produced the running agent, when known.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`commitSha`](#commitsha-2)

##### runtimeTelemetry?

> `optional` **runtimeTelemetry?**: [`RuntimeTelemetryOptions`](index.md#runtimetelemetryoptions)

Defined in: src/intelligence/index.ts:342

Runtime-event payload policy. Tool inputs/results remain off unless explicitly enabled.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`runtimeTelemetry`](#runtimetelemetry)

##### telemetryExport?

> `optional` **telemetryExport?**: [`IntelligenceTelemetryExportOptions`](#intelligencetelemetryexportoptions)

Defined in: src/intelligence/index.ts:344

OTLP queue limits, retry timing, request deadline, and drop observer.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`telemetryExport`](#telemetryexport)

##### payloadAttributes?

> `optional` **payloadAttributes?**: `"metadata"` \| `"full"`

Defined in: src/intelligence/index.ts:351

Payloads are metadata-only by default: the run span carries a stable hash
and UTF-8 byte count, but not the redacted content. Set `full` only when
the configured OTLP destination is approved to receive complete redacted
inputs, outputs, and profiles.

###### Inherited from

[`IntelligenceConfig`](#intelligenceconfig).[`payloadAttributes`](#payloadattributes)

##### tenantId

> **tenantId**: `string`

Defined in: src/intelligence/with-intelligence.ts:68

Authenticated tenant expected in every context response.

##### target?

> `optional` **target?**: `string`

Defined in: src/intelligence/with-intelligence.ts:70

Pull target. Defaults to `project`.

##### refreshMs?

> `optional` **refreshMs?**: `number`

Defined in: src/intelligence/with-intelligence.ts:72

Min interval between certified-context pulls. Default 5m.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Defined in: src/intelligence/with-intelligence.ts:74

Per-pull timeout in ms (fail-closed on a hung plane). Default 10000.

##### fetchImpl?

> `optional` **fetchImpl?**: (`input`, `init?`) => `Promise`\<`Response`\>

Defined in: src/intelligence/with-intelligence.ts:76

fetch impl for the pull (tests). Defaults to global fetch.

###### Parameters

###### input

`string` \| `URL` \| `Request`

###### init?

`RequestInit`

###### Returns

`Promise`\<`Response`\>

##### now?

> `optional` **now?**: () => `number`

Defined in: src/intelligence/with-intelligence.ts:78

Current time source for certified-context expiry checks. Defaults to `Date.now`.

###### Returns

`number`

##### checkpointStore?

> `optional` **checkpointStore?**: [`CertifiedContextCheckpointStore`](#certifiedcontextcheckpointstore)

Defined in: src/intelligence/with-intelligence.ts:80

Persist accepted context revisions across process restarts.

##### onCertifiedContextReject?

> `optional` **onCertifiedContextReject?**: (`error`) => `void`

Defined in: src/intelligence/with-intelligence.ts:82

Observe rejected checkpoints, rollbacks, conflicts, and incompatible endpoints.

###### Parameters

###### error

`Error`

###### Returns

`void`

##### onCertifiedContext?

> `optional` **onCertifiedContext?**: (`context`) => `void`

Defined in: src/intelligence/with-intelligence.ts:84

Notified when the exact certified context changes or is revoked.

###### Parameters

###### context

`CertifiedContext` \| `null`

###### Returns

`void`

## Type Aliases

### AgentImprovementActivationTransition

> **AgentImprovementActivationTransition** = (`input`) => `Promise`\<`unknown`\>

Defined in: src/intelligence/activation.ts:67

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

Defined in: src/intelligence/activation.ts:76

Target-read-only check for a prior exact write.
It may persist recovered result metadata, but must not change an activation target.
Return undefined only when no target write can have committed.

#### Parameters

##### input

[`AgentImprovementActivationTransitionInput`](#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown` \| `undefined`\>

***

### PullCertifiedContextOutcome

> **PullCertifiedContextOutcome** = \{ `succeeded`: `true`; `value`: `CertifiedContext`; \} \| \{ `succeeded`: `false`; `error`: `string`; `status?`: `number`; \}

Defined in: src/intelligence/delivery.ts:37

Typed outcome for the pull. Inspect `succeeded` before reading `value`.

***

### AgentImprovementProposalSubmissionState

> **AgentImprovementProposalSubmissionState** = `"not-sent"` \| `"rejected"` \| `"unconfirmed"`

Defined in: src/intelligence/delivery.ts:74

What Runtime knows about a failed proposal submission.
`not-sent` means no request began, `rejected` means Intelligence returned a
definitive 4xx response, and `unconfirmed` means the caller may safely retry
the same immutable proposal.

***

### SubmitAgentImprovementProposalOutcome

> **SubmitAgentImprovementProposalOutcome** = \{ `succeeded`: `true`; `value`: [`AgentImprovementProposal`](#agentimprovementproposal); `status`: `number`; \} \| \{ `succeeded`: `false`; `submission`: [`AgentImprovementProposalSubmissionState`](#agentimprovementproposalsubmissionstate); `error`: `string`; `status?`: `number`; `code?`: `string`; \}

Defined in: src/intelligence/delivery.ts:92

Typed result for proposal submission. A successful result contains the
exact immutable proposal Intelligence recorded.

***

### EffortTier

> **EffortTier** = `"off"` \| `"eco"` \| `"standard"` \| `"thorough"` \| `"max"`

Defined in: src/intelligence/effort.ts:20

The named effort tiers, lowest to highest. `'off'` is the honest floor
 below `'eco'`: intelligence fully off, telemetry still best-effort.

***

### CorpusAccess

> **CorpusAccess** = `"off"` \| `"read"` \| `"read-write"`

Defined in: src/intelligence/effort.ts:25

Corpus access an intelligence tier permits. `'off'` reads and writes
 nothing; `'read'` consults the cross-run corpus without contributing;
 `'read-write'` both consults and accumulates.

***

### EffortOverrides

> **EffortOverrides** = `Partial`\<[`EffortSettings`](#effortsettings)\>

Defined in: src/intelligence/effort.ts:52

Per-field overrides applied on top of a tier preset. Any subset of the
 resolved settings; each provided field wins over the preset.

***

### AgentCandidateExecutionHostPorts

> **AgentCandidateExecutionHostPorts** = `Omit`\<[`AgentCandidateExecutionPorts`](index.md#agentcandidateexecutionports), `"models"`\>

Defined in: src/intelligence/exact-process-candidate.ts:62

Product-owned candidate ports other than protected model access.

***

### AgentImprovementProposal

> **AgentImprovementProposal** = `Omit`\<`InterfaceAgentImprovementProposal`, `"evaluation"`\> & `object`

Defined in: src/intelligence/improvement-cycle.ts:97

A Runtime proposal backed by an exact candidate-bundle experiment.

#### Type Declaration

##### evaluation

> **evaluation**: `AgentImprovementMeasuredComparison`

***

### AgentImprovementExperimentMaterial

> **AgentImprovementExperimentMaterial** = `Omit`\<`AgentCandidateExperimentMaterial`, `"candidateLineage"`\>

Defined in: src/intelligence/improvement-cycle.ts:196

Product-supplied experiment material. Runtime supplies optimizer ancestry and the final digest.

***

### AgentImprovementProfileSurface

> **AgentImprovementProfileSurface** = *typeof* [`AGENT_IMPROVEMENT_PROFILE_SURFACES`](#agent_improvement_profile_surfaces)\[`number`\]

Defined in: src/intelligence/improvement-surfaces.ts:46

***

### AgentImprovementActivationTargetIdentity

> **AgentImprovementActivationTargetIdentity** = `Pick`\<`AgentImprovementActivationTarget`, `"surface"` \| `"identity"`\>

Defined in: src/intelligence/improvement-surfaces.ts:54

***

### UsageClass

> **UsageClass** = `"inference"` \| `"intelligence"`

Defined in: src/intelligence/index.ts:197

Usage class for billing. Base-stream tokens bill `'inference'`; every
 intelligence spawn (analyst, corpus, loop) bills `'intelligence'`. The
 billing line falls on the spawn line.

***

### IntelligenceTelemetryExportOptions

> **IntelligenceTelemetryExportOptions** = `Pick`\<[`OtelExportConfig`](index.md#otelexportconfig), `"batchSize"` \| `"flushIntervalMs"` \| `"maxQueueSize"` \| `"retryInitialDelayMs"` \| `"retryMaxDelayMs"` \| `"requestTimeoutMs"` \| `"maxResponseBytes"` \| `"onDrop"`\>

Defined in: src/intelligence/index.ts:285

Queue, retry, deadline, and drop controls for Intelligence trace export.

***

### IntelligenceFlushResult

> **IntelligenceFlushResult** = [`OtelFlushResult`](index.md#otelflushresult)

Defined in: src/intelligence/index.ts:297

***

### AgentImprovementProfileActivationTarget

> **AgentImprovementProfileActivationTarget** = `Omit`\<[`AgentImprovementActivationTargetPlan`](#agentimprovementactivationtargetplan), `"surface"`\> & `object`

Defined in: src/intelligence/profile-activation.ts:20

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileTargetState

> **AgentImprovementProfileTargetState** = `Omit`\<`AgentImprovementActivationTargetState`, `"surface"`\> & `object`

Defined in: src/intelligence/profile-activation.ts:27

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileTargetTransition

> **AgentImprovementProfileTargetTransition** = `Omit`\<`AgentImprovementActivationTargetTransition`, `"surface"`\> & `object`

Defined in: src/intelligence/profile-activation.ts:32

#### Type Declaration

##### surface

> **surface**: [`AgentImprovementProfileSurface`](#agentimprovementprofilesurface)

***

### AgentImprovementProfileActivationPreparation

> **AgentImprovementProfileActivationPreparation** = \{ `status`: `"missing"`; `identities`: readonly `string`[]; \} \| \{ `status`: `"already-applied"` \| `"conflict"`; `targets`: \[[`AgentImprovementProfileTargetState`](#agentimprovementprofiletargetstate), `...AgentImprovementProfileTargetState[]`\]; \} \| \{ `status`: `"apply"`; `replacements`: \[[`AgentImprovementProfileReplacement`](#agentimprovementprofilereplacement), `...AgentImprovementProfileReplacement[]`\]; `targets`: \[[`AgentImprovementProfileTargetTransition`](#agentimprovementprofiletargettransition), `...AgentImprovementProfileTargetTransition[]`\]; \}

Defined in: src/intelligence/profile-activation.ts:42

***

### IntelligenceAgent

> **IntelligenceAgent**\<`I`, `O`\> = (`input`, `applied`) => `Promise`\<`O`\>

Defined in: src/intelligence/with-intelligence.ts:61

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

Defined in: src/intelligence/with-intelligence.ts:89

The wrapped agent — same `(input) => Promise<output>` shape, plus a manual
 `refresh()` and certified-context accessor.

#### Type Declaration

##### refresh()

> **refresh**(): `Promise`\<`void`\>

###### Returns

`Promise`\<`void`\>

##### currentCertifiedContext()

> **currentCertifiedContext**(): `CertifiedContext` \| `null`

###### Returns

`CertifiedContext` \| `null`

##### flush()

> **flush**(): `Promise`\<[`OtelFlushResult`](index.md#otelflushresult)\>

Flush buffered trace spans before a short-lived process exits.

###### Returns

`Promise`\<[`OtelFlushResult`](index.md#otelflushresult)\>

#### Type Parameters

##### I

`I`

##### O

`O`

***

### Redactor

> **Redactor** = (`value`) => `unknown`

Defined in: src/redact.ts:17

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

Defined in: src/intelligence/effort.ts:95

The default tier when a client declares no effort. `'standard'` turns
 intelligence on with sensible knobs; opt down to `'off'`/`'eco'` or up to
 `'thorough'`/`'max'`.

***

### exactProcessCandidateExperimentExecutionSupport

> `const` **exactProcessCandidateExperimentExecutionSupport**: `Readonly`\<\{ `outcomes`: readonly \[`"output"`\]; `outputMediaTypes`: readonly \[`"text/*"`, `"application/json"`, `"*+json"`\]; `code`: readonly \[`"disabled"`\]; `memory`: readonly \[`"disabled"`\]; `knowledge`: `true`; `profile`: `Readonly`\<\{ `mcpTransports`: readonly \[`"stdio"`\]; `remoteMcp`: `false`; `tools`: `false`; `permissions`: `false`; `modes`: `false`; `confidential`: `false`; \}\>; `isolation`: `Readonly`\<\{ `freshEnvironment`: `true`; `exactProcess`: `true`; `egress`: readonly \[`"blocked"`, `"strict"`\]; \}\>; \}\>

Defined in: src/intelligence/exact-process-candidate.ts:31

Candidate surfaces implemented by the neutral exact-process executor.

***

### AGENT\_IMPROVEMENT\_PROFILE\_SURFACES

> `const` **AGENT\_IMPROVEMENT\_PROFILE\_SURFACES**: readonly \[`"prompt"`, `"skills"`, `"tools"`, `"mcp"`, `"hooks"`, `"subagents"`\]

Defined in: src/intelligence/improvement-surfaces.ts:37

Agent improvement surfaces delivered as exact `AgentProfileDiff` replacements.

## Functions

### parseCandidateProfileMaterialization()

> **parseCandidateProfileMaterialization**(`input`, `expectedProfilePlanDigest?`): `AgentCandidateProfileActivation`

Defined in: src/candidate-execution/profile.ts:79

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

Defined in: src/intelligence/activation.ts:93

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

Defined in: src/intelligence/activation.ts:124

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

Defined in: src/intelligence/activation.ts:142

Validate and execute one product-owned activation transition.

#### Parameters

##### input

[`ExecuteAgentImprovementActivationInput`](#executeagentimprovementactivationinput)

##### options

[`ExecuteAgentImprovementActivationOptions`](#executeagentimprovementactivationoptions)

#### Returns

`Promise`\<`AgentImprovementActivationResult`\>

***

### resolveIntelligenceBaseUrl()

> **resolveIntelligenceBaseUrl**(`baseUrl`, `policy?`): `string`

Defined in: src/intelligence/delivery.ts:149

Resolve the Intelligence base URL used by both send and receive paths.

#### Parameters

##### baseUrl

`string` \| `undefined`

##### policy?

[`IntelligenceEndpointPolicy`](#intelligenceendpointpolicy) = `{}`

#### Returns

`string`

***

### pullCertifiedContext()

> **pullCertifiedContext**(`opts`): `Promise`\<[`PullCertifiedContextOutcome`](#pullcertifiedcontextoutcome)\>

Defined in: src/intelligence/delivery.ts:314

Pull certified context for a target. Fail-closed: a network
error or a non-2xx returns a typed `succeeded: false` (never throws), so a
caller can run on its base surface when Intelligence is unreachable. A
conforming endpoint always returns a revisioned active or revoked response.

#### Parameters

##### opts

[`PullCertifiedContextOptions`](#pullcertifiedcontextoptions)

#### Returns

`Promise`\<[`PullCertifiedContextOutcome`](#pullcertifiedcontextoutcome)\>

***

### submitAgentImprovementProposal()

> **submitAgentImprovementProposal**(`opts`): `Promise`\<[`SubmitAgentImprovementProposalOutcome`](#submitagentimprovementproposaloutcome)\>

Defined in: src/intelligence/delivery.ts:395

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

### composeCertifiedContext()

> **composeCertifiedContext**(`base`, `certified`, `now?`): [`ComposedCertifiedContext`](#composedcertifiedcontext)

Defined in: src/intelligence/delivery.ts:545

Materialize current certified context without creating executable behavior.

#### Parameters

##### base

###### systemPrompt

`string`

##### certified

`CertifiedContext` \| `null`

##### now?

() => `number`

#### Returns

[`ComposedCertifiedContext`](#composedcertifiedcontext)

***

### createCertifiedContextSource()

> **createCertifiedContextSource**(`opts`): [`CertifiedContextSource`](#certifiedcontextsource)

Defined in: src/intelligence/delivery.ts:674

Create one coalesced cache that keeps the last valid context response.

#### Parameters

##### opts

[`CertifiedContextSourceOptions`](#certifiedcontextsourceoptions)

#### Returns

[`CertifiedContextSource`](#certifiedcontextsource)

***

### resolveEffort()

> **resolveEffort**(`tier`, `overrides?`): [`EffortSettings`](#effortsettings)

Defined in: src/intelligence/effort.ts:108

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

Defined in: src/intelligence/effort.ts:129

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

Defined in: src/intelligence/effort.ts:179

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

Defined in: src/intelligence/exact-process-candidate.ts:96

Execute one signed experiment cell through any declared exact-process provider.

#### Parameters

##### options

[`CreateExactProcessCandidateExperimentExecutorOptions`](#createexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ExactProcessCandidateExperimentExecutor`](#exactprocesscandidateexperimentexecutor)

***

### createProtectedExactProcessCandidateExperimentExecutor()

> **createProtectedExactProcessCandidateExperimentExecutor**(`options`): [`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

Defined in: src/intelligence/exact-process-candidate.ts:143

Compose host-owned execution ports with protected model access for one exact-process run.

#### Parameters

##### options

[`CreateProtectedExactProcessCandidateExperimentExecutorOptions`](#createprotectedexactprocesscandidateexperimentexecutoroptions)

#### Returns

[`ProtectedExactProcessCandidateExperimentExecutor`](#protectedexactprocesscandidateexperimentexecutor)

***

### runAgentCandidateExperiment()

> **runAgentCandidateExperiment**(`options`): `Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

Defined in: src/intelligence/improvement-cycle.ts:243

Execute both arms of one immutable experiment and derive its paired result.

#### Parameters

##### options

[`RunAgentCandidateExperimentOptions`](#runagentcandidateexperimentoptions)

#### Returns

`Promise`\<[`RunAgentCandidateExperimentResult`](#runagentcandidateexperimentresult)\>

***

### executeAgentCandidateExperimentCell()

> **executeAgentCandidateExperimentCell**(`options`): `Promise`\<`CandidateExecutionEvidence`\>

Defined in: src/intelligence/improvement-cycle.ts:274

Execute one exact arm, task, repetition, seed, and attempt through Runtime.

#### Parameters

##### options

[`ExecuteAgentCandidateExperimentCellOptions`](#executeagentcandidateexperimentcelloptions)

#### Returns

`Promise`\<`CandidateExecutionEvidence`\>

***

### createAgentImprovementMeasuredComparison()

> **createAgentImprovementMeasuredComparison**(`options`): `AgentImprovementMeasuredComparison`

Defined in: src/intelligence/improvement-cycle.ts:330

Delegate all statistics and promotion checks to agent-eval's receipt-based comparison.

#### Parameters

##### options

`CompareCandidateExperimentOptions`

#### Returns

`AgentImprovementMeasuredComparison`

***

### proposeAgentImprovement()

> **proposeAgentImprovement**\<`TScenario`, `TArtifact`\>(`options`): `Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

Defined in: src/intelligence/improvement-cycle.ts:337

Analyze, search, then remeasure the resulting exact candidate before proposing it.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario$1`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`ProposeAgentImprovementOptions`](#proposeagentimprovementoptions)\<`TScenario`, `TArtifact`\>

#### Returns

`Promise`\<[`ProposeAgentImprovementResult`](#proposeagentimprovementresult)\<`TScenario`, `TArtifact`\>\>

***

### createAgentImprovementProposal()

> **createAgentImprovementProposal**(`options`): [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: src/intelligence/improvement-cycle.ts:442

Create the reviewable record only from a complete, recomputable experiment result.

#### Parameters

##### options

[`CreateAgentImprovementProposalOptions`](#createagentimprovementproposaloptions)

#### Returns

[`AgentImprovementProposal`](#agentimprovementproposal)

***

### reviewAgentImprovementProposal()

> **reviewAgentImprovementProposal**(`inputProposal`, `input`): `AgentImprovementReview`

Defined in: src/intelligence/improvement-cycle.ts:476

Persist a human or tenant-policy decision bound to one exact proposal.

#### Parameters

##### inputProposal

[`AgentImprovementProposal`](#agentimprovementproposal)

##### input

[`ReviewAgentImprovementInput`](#reviewagentimprovementinput)

#### Returns

`AgentImprovementReview`

***

### createAgentImprovementActivation()

> **createAgentImprovementActivation**(`inputProposal`, `inputReview`, `options`): `AgentImprovementActivation`

Defined in: src/intelligence/improvement-cycle.ts:504

Authorize product-owned writes only after the exact candidate was measured and approved.

#### Parameters

##### inputProposal

[`AgentImprovementProposal`](#agentimprovementproposal)

##### inputReview

`AgentImprovementReview`

##### options

[`CreateAgentImprovementActivationOptions`](#createagentimprovementactivationoptions)

#### Returns

`AgentImprovementActivation`

***

### verifyAgentImprovementProposal()

> **verifyAgentImprovementProposal**(`input`): [`AgentImprovementProposal`](#agentimprovementproposal)

Defined in: src/intelligence/improvement-cycle.ts:546

Validate a proposal and recompute every binding to its measured experiment.

#### Parameters

##### input

`unknown`

#### Returns

[`AgentImprovementProposal`](#agentimprovementproposal)

***

### verifyAgentImprovementReview()

> **verifyAgentImprovementReview**(`input`): `AgentImprovementReview`

Defined in: src/intelligence/improvement-cycle.ts:580

Validate the canonical identity and wire shape of an improvement review.

#### Parameters

##### input

`unknown`

#### Returns

`AgentImprovementReview`

***

### verifyAgentImprovementActivation()

> **verifyAgentImprovementActivation**(`input`): `AgentImprovementActivation`

Defined in: src/intelligence/improvement-cycle.ts:588

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

Defined in: src/intelligence/improvement-cycle.ts:622

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

Defined in: src/intelligence/improvement-surfaces.ts:102

Bind caller-owned target identities to the exact source state Runtime measured.

#### Parameters

##### surfaces

readonly `AgentImprovementSurface`[]

##### experiment

`AgentCandidateExperiment`

##### intent

`AgentImprovementActivationIntent`

##### identities

readonly [`AgentImprovementActivationTargetIdentity`](#agentimprovementactivationtargetidentity)[]

#### Returns

\[`AgentImprovementActivationTarget`, `...AgentImprovementActivationTarget[]`\]

***

### isAgentImprovementProfileSurface()

> **isAgentImprovementProfileSurface**(`surface`): surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills"

Defined in: src/intelligence/improvement-surfaces.ts:138

Return whether a measured surface can be delivered through an agent profile.

#### Parameters

##### surface

`AgentImprovementSurface`

#### Returns

surface is "mcp" \| "subagents" \| "hooks" \| "prompt" \| "tools" \| "skills"

***

### agentImprovementProfileSurfaceInput()

> **agentImprovementProfileSurfaceInput**(`profile`, `surface`): `unknown`

Defined in: src/intelligence/improvement-surfaces.ts:150

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

Defined in: src/intelligence/improvement-surfaces.ts:188

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

Defined in: src/intelligence/improvement-surfaces.ts:200

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

### createIntelligenceClient()

> **createIntelligenceClient**(`config`): [`IntelligenceClient`](#intelligenceclient)

Defined in: src/intelligence/index.ts:541

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

Defined in: src/intelligence/optimization-receipt.ts:64

Build a detached receipt only for methods backed by an identified external optimizer.

#### Parameters

##### improvement

[`ImproveMethodResult`](index.md#improvemethodresult)

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### optimizationActivationReceiptFromMetadata()

> **optimizationActivationReceiptFromMetadata**(`metadata`): [`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

Defined in: src/intelligence/optimization-receipt.ts:130

Read and verify the optimizer evidence carried by a measured proposal.

#### Parameters

##### metadata

\{\[`key`: `string`\]: `AgentCandidateJsonValue`; \} \| `undefined`

#### Returns

[`OptimizationActivationReceipt`](#optimizationactivationreceipt) \| `undefined`

***

### prepareAgentImprovementProfileActivation()

> **prepareAgentImprovementProfileActivation**(`input`): [`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

Defined in: src/intelligence/profile-activation.ts:67

Compare product-owned profiles with an exact measured transition and prepare
the all-or-none replacements. The caller owns locking, persistence, and the
durable activation receipt; this function owns profile semantics only.
Profiles stay in product-owned stores, so this returns replacements instead
of owning the transition callbacks used by Runtime-owned knowledge stores.

#### Parameters

##### input

###### currentByIdentity

`ReadonlyMap`\<`string`, `AgentProfile`\>

###### targets

readonly \[[`AgentImprovementProfileActivationTarget`](#agentimprovementprofileactivationtarget), [`AgentImprovementProfileActivationTarget`](#agentimprovementprofileactivationtarget)\]

#### Returns

[`AgentImprovementProfileActivationPreparation`](#agentimprovementprofileactivationpreparation)

***

### withIntelligence()

> **withIntelligence**\<`I`, `O`\>(`agent`, `config`): [`IntelligenceWrapped`](#intelligencewrapped)\<`I`, `O`\>

Defined in: src/intelligence/with-intelligence.ts:159

Wrap an agent so it (a) RECEIVES the tenant's certified context — the prompt
context to fold — and (b) SENDS a
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

Defined in: src/redact.ts:61

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

Defined in: src/redact.ts:113

Resolve the redactor a client uses. A caller-supplied hook handles
domain-specific values first, then the built-in scrubber still removes
common credentials and email addresses. Returning `false` is the explicit
opt-out for already-reviewed public values.

#### Parameters

##### redact

`false` \| [`Redactor`](#redactor) \| `undefined`

#### Returns

[`Redactor`](#redactor)

## References

### OtelDropEvent

Re-exports [OtelDropEvent](index.md#oteldropevent)
