[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / index

# index

## Classes

### BackendTransportError

**`Stable`**

A backend transport call (HTTP, gRPC, sidecar IPC) failed with a non-success
status. Distinct from `JudgeError` (which is structural / unrecoverable)
because backend failures are sometimes retryable and consumers may want to
branch on the upstream status code.

#### Extends

- `AgentEvalError`

#### Constructors

##### Constructor

> **new BackendTransportError**(`backend`, `message`, `options?`): [`BackendTransportError`](#backendtransporterror)

###### Parameters

###### backend

`string`

###### message

`string`

###### options?

###### cause?

`unknown`

###### status?

`number`

###### upstreamCode?

`string`

###### remediation?

`Readonly`\<\{ `cause`: `"api_key_selected"` \| `"provider_unresolved"` \| `"subscription_unverified"` \| `"not_authenticated"`; `fix`: `string`; `harness`: `string`; `provider`: `string` \| `null`; \}\>

###### body?

`string`

###### providerDispatch?

`"not_started"`

###### Returns

[`BackendTransportError`](#backendtransporterror)

###### Overrides

`AgentEvalError.constructor`

#### Properties

##### backend

> `readonly` **backend**: `string`

##### status?

> `readonly` `optional` **status?**: `number`

##### providerDispatch?

> `readonly` `optional` **providerDispatch?**: `"not_started"`

Router-owned proof that a rejected request never reached a provider.

This is intentionally one-sided. An absent value, or any value this
package does not understand, remains unknown to Runtime.

##### upstreamCode?

> `readonly` `optional` **upstreamCode?**: `string`

The upstream's own error class when it names one (the bridge's `parse_error`,
`not_configured`, a provider's `invalid_request_error`). A class the upstream never
retries is a decision about the request, so a retry policy may read it where no
status arrived.

##### remediation?

> `readonly` `optional` **remediation?**: `Readonly`\<\{ `cause`: `"api_key_selected"` \| `"provider_unresolved"` \| `"subscription_unverified"` \| `"not_authenticated"`; `fix`: `string`; `harness`: `string`; `provider`: `string` \| `null`; \}\>

Validated producer remedy; absent when the upstream supplied no trusted structured remedy.

##### body?

> `readonly` `optional` **body?**: `string`

Truncated upstream response body (≤2 KiB) when available. Diagnostic
only — surfaces in `backend_error.error.body` and `final.error.body`
so operators can see "free_tier_limit", "invalid_api_key", etc. without
cracking the log line open.

***

### SearchEnvironmentFault

The environment, not the candidate, ended the attempt: a box that died, a platform that
refused the run, a quota. The attempt settles `errored` and retryable, and the kernel runs a
fresh attempt up to its `maxAttempts`. Throw anything else for the agent's own failure.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SearchEnvironmentFault**(`message`, `options?`): [`SearchEnvironmentFault`](#searchenvironmentfault)

###### Parameters

###### message

`string`

###### options?

###### cause?

`unknown`

###### Returns

[`SearchEnvironmentFault`](#searchenvironmentfault)

###### Overrides

`Error.constructor`

***

### InMemoryRuntimeSessionStore

**`Stable`**

In-memory `RuntimeSessionStore` for single-process use and tests.

#### Implements

- [`RuntimeSessionStore`](#runtimesessionstore)

#### Constructors

##### Constructor

> **new InMemoryRuntimeSessionStore**(): [`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

###### Returns

[`InMemoryRuntimeSessionStore`](#inmemoryruntimesessionstore)

#### Methods

##### get()

> **get**(`sessionId`): [`RuntimeSession`](#runtimesession) \| `undefined`

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeSession`](#runtimesession) \| `undefined`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`get`](#get-1)

##### put()

> **put**(`session`): `void`

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`put`](#put-1)

##### appendEvent()

> **appendEvent**(`sessionId`, `event`): `void`

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void`

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`appendEvent`](#appendevent-1)

##### listEvents()

> **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[]

###### Implementation of

[`RuntimeSessionStore`](#runtimesessionstore).[`listEvents`](#listevents-1)

## Interfaces

### CircuitBreakerConfig

Circuit-breaker tuning. `failuresToOpen` consecutive failures opens it; closed only after `cooldownMs`.

#### Properties

##### failuresToOpen

> **failuresToOpen**: `number`

##### cooldownMs

> **cooldownMs**: `number`

***

### BackendCallPolicy

#### Properties

##### perAttemptDeadlineMs?

> `optional` **perAttemptDeadlineMs?**: `number`

Per-attempt wall clock limit. Exceeding fires an AbortSignal and is treated as a retryable failure.

##### maxRetries?

> `optional` **maxRetries?**: `number`

Number of retries after the first attempt; total attempts = 1 + maxRetries. Default 0.

##### retryBackoffMs?

> `optional` **retryBackoffMs?**: [`RetryBackoff`](#retrybackoff)

Backoff between attempts. Default 250ms with jitter.

##### isRetryable?

> `optional` **isRetryable?**: [`RetryableErrorPredicate`](#retryableerrorpredicate)

Custom retry classifier. Defaults to retrying transport failures and retryable HTTP statuses.

##### circuitBreaker?

> `optional` **circuitBreaker?**: [`CircuitBreakerConfig`](#circuitbreakerconfig)

Circuit breaker that opens after N consecutive failures per participant.

***

### RunPersonaConversationOptions

#### Properties

##### worker

> **worker**: `AgentProfile`

The agent under test. Metered; its rendered prompt leads its turns.

##### persona

> **persona**: [`PersonaDriver`](#personadriver)

The simulated user driving the dialogue.

##### executorFor

> **executorFor**: (`profile`, `role`) => [`ExecutorFactory`](runtime.md#executorfactory-1)\<`unknown`\>

Resolve transport/executable ports for the exact profile. Runtime still materializes the
profile and owns every model call. Applied to the worker and a profile-driven persona.

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`ExecutorFactory`](runtime.md#executorfactory-1)\<`unknown`\>

##### maxTurns?

> `optional` **maxTurns?**: `number`

Speaker-turn cap. Default for a scripted persona = `2 * turns.length`
 (worker answers each user turn). REQUIRED for a `profile` persona.

##### seed?

> `optional` **seed?**: `string`

Kickoff message routed to the first speaker (the persona). Default 'Begin.'

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Content-based "until satisfied" halt, called after every turn. `maxTurns` is the
 hard ceiling; this is the early stop (the persona declares the goal met / unreachable).

##### signal?

> `optional` **signal?**: `AbortSignal`

##### workerName?

> `optional` **workerName?**: `string`

Worker participant / transcript speaker label. Default 'agent'.

***

### PersonaConversationResult

#### Properties

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

##### turns

> **turns**: `number`

##### halted

> **halted**: [`HaltReason`](#haltreason)

##### costUsd

> **costUsd**: `number`

Worker-only spend (the side under test).

##### tokensIn

> **tokensIn**: `number`

##### tokensOut

> **tokensOut**: `number`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

Absent means every worker call reported complete token usage.

##### costUsdKnown?

> `optional` **costUsdKnown?**: `false`

Absent means every worker call reported provider-billed cost, including a known zero.

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Worker-only external estimate, kept separate from observed provider-billed spend.

***

### RunPersonaConfig

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### executorFor

> **executorFor**: (`profile`, `role`) => [`ExecutorFactory`](runtime.md#executorfactory-1)\<`unknown`\>

Resolve transport/executable ports for each exact profile.

###### Parameters

###### profile

`AgentProfile`

###### role

`"worker"` \| `"persona"`

###### Returns

[`ExecutorFactory`](runtime.md#executorfactory-1)\<`unknown`\>

##### personaOf

> **personaOf**: (`scenario`) => [`PersonaDriver`](#personadriver)

The persona driving each scenario — a driver profile or scripted turns.

###### Parameters

###### scenario

`TScenario`

###### Returns

[`PersonaDriver`](#personadriver)

##### artifactOf

> **artifactOf**: (`transcript`, `scenario`) => `TArtifact`

Build the scored artifact from the finished transcript.

###### Parameters

###### transcript

[`ConversationTurn`](#conversationturn)[]

###### scenario

`TScenario`

###### Returns

`TArtifact`

##### maxTurns?

> `optional` **maxTurns?**: (`scenario`) => `number`

Speaker-turn cap (required when a persona is profile-driven).

###### Parameters

###### scenario

`TScenario`

###### Returns

`number`

##### seed?

> `optional` **seed?**: (`scenario`) => `string`

###### Parameters

###### scenario

`TScenario`

###### Returns

`string`

##### workerName?

> `optional` **workerName?**: `string`

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge` \| ((`worker`, `scenario`) => MaximumCharge \| undefined)

Provider- or executor-enforced maximum for the whole worker conversation.
Required before execution when the enclosing campaign is cost-capped.

***

### ConversationParticipant

**`Stable`**

#### Properties

##### name

> **name**: `string`

Stable name used as the speaker label in the transcript. Must be unique
within a `Conversation`.

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)

Backend that runs this participant's turn. Reuses the existing
`AgentExecutionBackend` contract from `runAgentTaskStream`, so an iterable,
sandbox, or profile-backed Runtime executor works through the same runner.

##### label?

> `optional` **label?**: `string`

Optional human label for traces / dashboards. Distinct from `name`, which
is the addressing key.

##### callPolicy?

> `optional` **callPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Optional per-participant override of the conversation's default
`callPolicy`. Use to tighten the deadline or raise the retry budget for
a participant known to be slow or flaky.

##### authSource?

> `optional` **authSource?**: [`AuthSource`](#authsource-1)

Who pays for THIS participant's outbound calls?

- `'forward-user'` (default) — propagate the caller's
  `X-Tangle-Forwarded-Authorization` so the downstream gateway bills the
  original user. Right for pass-through agents that aggregate/route
  without taking economic risk.
- `'agent-owned'` — DO NOT forward the user's auth; the participant's
  backend uses its own credentials (typically a sk-tan-AGENT or x402
  wallet baked into the backend at construction). Downstream charges
  land on the agent, not the user. Right for resold-bundle agents that
  take margin between their inbound price and their sub-agent costs.
- `(state) => AuthSource` — per-turn / per-condition decision, e.g. base
  sub-services are agent-owned but premium add-ons forward the user.

The agent's own credentials live on its caller-owned backend or
profile-bound Runtime executor; this field is purely about *whether to
also forward the user's identity downstream*.

***

### ConversationDriveState

**`Stable`**

#### Extended by

- [`HaltContext`](#haltcontext)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

##### turnIndex

> **turnIndex**: `number`

##### spentCreditsCents

> **spentCreditsCents**: `number`

***

### HaltContext

**`Stable`**

#### Extends

- [`ConversationDriveState`](#conversationdrivestate)

#### Properties

##### transcript

> **transcript**: readonly [`ConversationTurn`](#conversationturn)[]

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`transcript`](#transcript-1)

##### turnIndex

> **turnIndex**: `number`

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`turnIndex`](#turnindex)

##### spentCreditsCents

> **spentCreditsCents**: `number`

###### Inherited from

[`ConversationDriveState`](#conversationdrivestate).[`spentCreditsCents`](#spentcreditscents)

##### lastTurn

> **lastTurn**: [`ConversationTurn`](#conversationturn)

***

### HaltSignal

**`Stable`**

#### Properties

##### halted

> **halted**: `true`

##### reason

> **reason**: `string`

***

### ConversationPolicy

**`Stable`**

#### Properties

##### maxTurns

> **maxTurns**: `number`

Hard cap on speaker-turns. Each call into a participant's backend counts as 1.

##### maxCreditsCents?

> `optional` **maxCreditsCents?**: `number`

Hard cap on aggregate credit spend across all participants, in cents.
Computed by summing `llm_call.costUsd` from every participant's stream.
Unset (`undefined`) means no credit ceiling — the run is bounded only by
`maxTurns` and `haltOn`.

##### turnOrder?

> `optional` **turnOrder?**: [`TurnOrder`](#turnorder)

Speaker selection. Defaults to `'alternate'` for two-participant
conversations and `'round-robin'` for any other arity.

##### haltOn?

> `optional` **haltOn?**: [`HaltPredicate`](#haltpredicate)

Optional convergence / content-based halt. Called after every turn ends;
returning truthy stops the loop with `{ kind: 'predicate', ... }`.

##### defaultCallPolicy?

> `optional` **defaultCallPolicy?**: [`BackendCallPolicy`](#backendcallpolicy)

Default per-turn resilience policy applied to every participant call
(deadline, retries, circuit breaker). Individual participants may
override via `ConversationParticipant.callPolicy`.

***

### ConversationTurn

**`Stable`**

#### Properties

##### index

> **index**: `number`

##### speaker

> **speaker**: `string`

##### turnId

> **turnId**: `string`

Deterministic turn identifier — stable across retries of the same logical
turn so caching gateways and trace backends can dedupe. Shape:
`${runId}.t${index}.${speakerSlug}`.

##### sessionId?

> `optional` **sessionId?**: `string`

Backend session used for this turn. Present on turns recorded by session-aware runners.

##### text

> **text**: `string`

##### usage?

> `optional` **usage?**: `object`

Aggregated backend usage for this turn alone. Populated from any
`llm_call` stream events the backend emitted; `undefined` when the
backend reports no usage.

###### tokensIn?

> `optional` **tokensIn?**: `number`

###### tokensOut?

> `optional` **tokensOut?**: `number`

###### costUsd?

> `optional` **costUsd?**: `number`

###### latencyMs?

> `optional` **latencyMs?**: `number`

###### model?

> `optional` **model?**: `string`

##### attempts

> **attempts**: `number`

Number of attempts that ran before this turn committed. `1` is the
common case; higher means the call policy retried after transient
failures.

##### startedAt

> **startedAt**: `string`

##### endedAt

> **endedAt**: `string`

***

### Conversation

**`Stable`**

#### Properties

##### participants

> **participants**: readonly [`ConversationParticipant`](#conversationparticipant)[]

##### policy

> **policy**: [`ConversationPolicy`](#conversationpolicy)

***

### RunConversationOptions

**`Stable`**

#### Properties

##### seed

> **seed**: `string`

First message kicking off the conversation. Routes to the first speaker.

##### runId?

> `optional` **runId?**: `string`

Optional run identifier for cross-participant trace correlation and
deterministic turn ids. Auto-generated when omitted. A conversation is
in-process: durable multi-turn work belongs to Agent App's turn store or
to `supervise` with a run context.

##### signal?

> `optional` **signal?**: `AbortSignal`

Cancellation signal — aborts mid-stream and halts with `{ kind: 'abort' }`.

##### onEvent?

> `optional` **onEvent?**: (`event`) => `void` \| `Promise`\<`void`\>

Event sink for per-turn micro-events. Distinct from the result transcript:
the sink fires for every text-delta, every turn-start/end, and the
conversation-start/end markers. Used to drive SSE / dashboard updates
without waiting for the conversation to finish.

###### Parameters

###### event

[`ConversationStreamEvent`](#conversationstreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### sessionStore?

> `optional` **sessionStore?**: [`RuntimeSessionStore`](#runtimesessionstore)

Stores each participant's backend session. The runner keeps an in-memory
store for one invocation when omitted. Backends implementing `resume`
continue their provider session; other backends receive the full transcript.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Headers to forward verbatim to every participant backend call (gateway
propagation: `X-Tangle-Forwarded-Authorization`, run/turn correlation,
depth counter). Backends opt in by reading `propagatedHeaders` from
their `AgentBackendContext`; backends that ignore the field still work.

##### inboundDepth?

> `optional` **inboundDepth?**: `number`

Inbound depth at the point this driver was invoked. The runner
increments it on every outbound participant call; gateways refuse at
`DEFAULT_MAX_FORWARD_DEPTH`. Default 0 (origin caller).

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

Parent turn id when this conversation is *inside* another turn (i.e. the
driver is itself a participant via `createConversationBackend`). The
runner stamps each outbound call with this as `X-Tangle-Parent-TurnId`
so trace stitching survives nested orchestration.

***

### ConversationResult

**`Stable`**

#### Properties

##### runId

> **runId**: `string`

##### transcript

> **transcript**: [`ConversationTurn`](#conversationturn)[]

##### turns

> **turns**: `number`

##### spentCreditsCents

> **spentCreditsCents**: `number`

##### halted

> **halted**: [`HaltReason`](#haltreason)

##### durationMs

> **durationMs**: `number`

##### startedAt

> **startedAt**: `string`

##### endedAt

> **endedAt**: `string`

***

### VerifyResult

Outcome of verifying a candidate worktree.

`ok` answers "is this tree shippable". `keepGoing` answers "should the budget
stop here", and `score` ranks this tree against the other trees the same
candidate produced — three separate questions, so a verifier can pass a tree
and still spend the shots it was given.

`feedback` (compiler errors, failing test output, or the reason a passing
tree is being sent back) is fed into the next shot.

#### Properties

##### ok

> **ok**: `boolean`

##### feedback?

> `optional` **feedback?**: `string`

##### keepGoing?

> `optional` **keepGoing?**: `boolean`

Spend the remaining shots instead of returning this tree now.

Read only when `ok` is true: a failed verification already spends the next
shot. Omitted means the first passing tree ends the candidate.

##### score?

> `optional` **score?**: `number`

How good this tree is, for ranking it against the other passing trees of
this candidate. Higher wins; a tie keeps the LATER tree, which is the one
already on disk and the one the author refined last.

Only a passing tree is ranked — a tree that failed verification is never a
candidate, whatever it scored. Score every passing tree or none of them: a
scored tree cannot be ranked against an unscored one, and mixing the two
fails the run rather than guessing an order.

***

### AgenticGeneratorShotReceipt

#### Properties

##### generation

> `readonly` **generation**: `number` \| `null`

##### candidateIndex

> `readonly` **candidateIndex**: `number` \| `null`

##### shot

> `readonly` **shot**: `number`

One-based shot number within this candidate.

##### maxShots

> `readonly` **maxShots**: `number`

##### profileDigest

> `readonly` **profileDigest**: `string`

Exact profile identity admitted before the shot.

##### harness

> `readonly` **harness**: `"opencode"` \| `"claude-code"` \| `"kimi-code"` \| `"codex"` \| `"amp"` \| `"factory-droids"` \| `"pi"` \| `"prime"` \| `"hermes"` \| `"forge"` \| `"openclaw"` \| `"nanoclaw"` \| `"acp"` \| `"cursor"` \| `"cli-base"` \| `"gemini"`

##### provider

> `readonly` **provider**: `string`

##### model

> `readonly` **model**: `string`

##### reasoningEffort

> `readonly` **reasoningEffort**: `"medium"` \| `"none"` \| `"minimal"` \| `"low"` \| `"high"` \| `"xhigh"` \| `"ultracode"` \| `null`

##### promptSha256

> `readonly` **promptSha256**: `` `sha256:${string}` ``

##### startedAt

> `readonly` **startedAt**: `string`

##### completedAt

> `readonly` **completedAt**: `string`

##### durationMs

> `readonly` **durationMs**: `number`

##### status

> `readonly` **status**: [`AgentTaskStatus`](#agenttaskstatus) \| `null`

##### usage

> `readonly` **usage**: `Readonly`\<[`AgentTurnUsage`](runtime.md#agentturnusage)\> \| `null`

Runtime-normalized usage. Unknown token or dollar totals remain marked unknown.

##### transportAttempts

> `readonly` **transportAttempts**: `number` \| `null`

##### costCallId

> `readonly` **costCallId**: `string` \| `null`

Shared run-ledger call id for this exact shot.

##### costBasis

> `readonly` **costBasis**: `"unknown"` \| `"provider-reported"` \| `"estimated-pricing"`

Whether dollars came from the provider, the pricing table, or are unknown.

##### costUsd

> `readonly` **costUsd**: `number` \| `null`

##### costUsdKnown

> `readonly` **costUsdKnown**: `boolean`

True only for a provider-reported amount, never for a pricing estimate.

##### error

> `readonly` **error**: \{ `name`: `string`; `message`: `string`; \} \| `null`

***

### AgenticGeneratorOptions

#### Properties

##### profile

> **profile**: `AgentProfile`

Complete author identity. Harness, provider, model, prompt, tools, and resources all come from here.

##### executorForWorktree

> **executorForWorktree**: [`AgenticGeneratorExecutorForWorktree`](#agenticgeneratorexecutorforworktree)

Place the exact profile on compute that can edit this existing worktree.
A local coding CLI returns `{ backend:'cli-in-place', workspacePath: worktreePath }`; a Pi
author over cli-bridge returns `{ backend:'bridge', cwd: worktreePath, ...transport }`. Both
are checked against the supplied path before the first shot spends.

##### onShotCompleted?

> `optional` **onShotCompleted?**: (`receipt`, `execution`) => `void` \| `Promise`\<`void`\>

Awaited once for every attempted author shot, including execution failures.
The second argument is Runtime's exact terminal turn and event stream.
Throwing aborts the candidate so evidence persistence fails closed.

###### Parameters

###### receipt

[`AgenticGeneratorShotReceipt`](#agenticgeneratorshotreceipt)

###### execution

`Readonly`\<[`CollectedAgentTurn`](runtime.md#collectedagentturn)\> \| `null`

###### Returns

`void` \| `Promise`\<`void`\>

##### onShotDisposition?

> `optional` **onShotDisposition?**: (`receipt`, `disposition`) => `void` \| `Promise`\<`void`\>

Awaited after worktree inspection and before the shot is accepted,
 retried, or discarded. Throwing aborts the candidate.

###### Parameters

###### receipt

[`AgenticGeneratorShotReceipt`](#agenticgeneratorshotreceipt)

###### disposition

[`AgenticGeneratorShotDisposition`](#agenticgeneratorshotdisposition)

###### Returns

`void` \| `Promise`\<`void`\>

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge`

Optional hard upper bound passed to the run-wide CostLedger before each author shot.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline.

##### buildPrompt

> **buildPrompt**: (`args`) => `string`

Build the task prompt from proposal findings. Required: Runtime invents no authoring policy.

###### Parameters

###### args

###### findings

readonly `ProposalFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Verify the worktree after each dirtying shot. When set, a candidate that
 fails verification is NOT returned — the failure feeds the next shot
 (verify-in-session), up to `maxShots`; a candidate that never verifies is
 discarded (`applied:false`), never shipped. A verifier that returns
 `keepGoing` passes a tree AND spends the remaining shots, and the
 best-scoring tree is the one that ships. Omitted means the first dirty
 shot is the candidate. See `commandVerifier` and `VerifyResult`.

##### isDirty?

> `optional` **isDirty?**: (`worktreePath`) => `boolean`

Test seam — inject the worktree-dirty check (defaults to `git status`).

###### Parameters

###### worktreePath

`string`

###### Returns

`boolean`

***

### ImproveMethodContext

#### Properties

##### profile

> `readonly` **profile**: `object`

Validated baseline profile.

##### evaluationRef

> `readonly` **evaluationRef**: `` `sha256:${string}` ``

Runtime-derived identity for upstream optimizer resume state.

##### surface

> `readonly` **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Exact profile coordinate being optimized.

##### baselineSurface

> `readonly` **baselineSurface**: `MutableSurface`

Exact bytes supplied to the optimization method.

##### baselineValue

> `readonly` **baselineValue**: `unknown`

Structured value represented by `baselineSurface`, before serialization.

##### findings

> `readonly` **findings**: readonly `ProposalFinding`[]

Findings produced before this search, if any.

##### searchIdentity

> `readonly` **searchIdentity**: [`ImproveSearchIdentity`](#improvesearchidentity)

Identities the method's search ledger records.

***

### ImproveSearchIdentity

What a search ledger records about an improvement and cannot infer: what is
improved, the agent harness around the profile, the judges and the model.

#### Properties

##### subject

> `readonly` **subject**: `string`

What the search improves, for example `vb/coder`.

##### agent

> `readonly` **agent**: `SearchSourceRef`

`executionRef`: the agent callback, materializer, models, tools and closures.

##### judge

> `readonly` **judge**: `SearchSourceRef`

Digest of every judge's name, dimensions, declared version and code.

##### model

> `readonly` **model**: `SearchModelIdentity`

The profile's model hint; each cell records the model it resolved.

***

### ImproveCandidateValidationInput

Exact materialized profile presented for validation before any candidate run.

#### Extended by

- [`OfficialSensitiveCandidateInput`](#officialsensitivecandidateinput)

#### Properties

##### profile

> **profile**: `object`

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

##### candidateSurface

> **candidateSurface**: `MutableSurface`

##### value

> **value**: `unknown`

##### isBaseline

> **isBaseline**: `boolean`

***

### ImproveSearchMethod

Runtime's native search: a policy, an allocator and a proposer on Eval's
search kernel, with no Python bridge. Build it with `searchMethod`.

#### Properties

##### kind

> `readonly` **kind**: `"search"`

##### name

> `readonly` **name**: `string`

Recorded as the ledger's process name and the result's method.

##### policy

> `readonly` **policy**: `SearchPolicy`

##### allocation

> `readonly` **allocation**: `SearchAllocator`

##### proposer

> `readonly` **proposer**: `SurfaceProposer`\<`ProposalFinding`\>

##### maxExpansions

> `readonly` **maxExpansions**: `number`

Proposals the search may make.

##### childrenPerProposal

> `readonly` **childrenPerProposal**: `number`

Children one proposal asks for.

##### lanes

> `readonly` **lanes**: readonly [`SearchLane`](#searchlane)[]

Where cells run, with each lane's capacity and cost rule.

##### claimReserveUsd

> `readonly` **claimReserveUsd**: `number` \| `null`

Dollars held from the start for the claim's test cells; at least the
root and 3 finalists on every test task at the largest lane `cellUsd`.

##### deadline

> `readonly` **deadline**: `string` \| `null`

ISO time after which the search stops expanding and claims.

##### maxAttempts

> `readonly` **maxAttempts**: `number`

Attempts per cell for retryable environment errors.

***

### ImproveSkillsOptions

#### Properties

##### resourceName

> **resourceName**: `string`

`name` of one inline entry in `profile.resources.skills`.

***

### ImproveProfileComponents

Caller-owned mapping for optimizing several profile fields as one candidate.

#### Properties

##### encoding?

> `optional` **encoding?**: `"components"` \| `"json"`

Encode the map as JSON text for engines that cannot search named components. Default `'components'`.

#### Methods

##### read()

> **read**(`profile`): `Readonly`\<`Record`\<`string`, `string`\>\>

Extract the exact named text components optimized together.

###### Parameters

###### profile

\{ \}

###### Returns

`Readonly`\<`Record`\<`string`, `string`\>\>

##### apply()

> **apply**(`profile`, `components`): `object`

Apply a complete winning component map to a detached profile.

###### Parameters

###### profile

\{ \}

###### components

`Readonly`\<`Record`\<`string`, `string`\>\>

###### Returns

`object`

***

### ImproveCodeBaseOptions

#### Properties

##### repoRoot

> **repoRoot**: `string`

Repo root candidate worktrees fork from.

##### baseRef?

> `optional` **baseRef?**: `string`

Base ref candidates fork from. Default `main`.

##### worktreeDir?

> `optional` **worktreeDir?**: `string`

Directory worktrees are created under. Default `<repoRoot>/.worktrees`.

##### worktree?

> `optional` **worktree?**: `WorktreeAdapter`

Git-compatible adapter override, primarily for tests. Candidate advancement
still requires normal Git worktree and commit semantics.

##### profile

> **profile**: `AgentProfile`

Complete identity of the code author. No execution field may be filled from ambient defaults.

***

### ImproveRuntimeCodeGeneratorOptions

#### Properties

##### executorForWorktree

> **executorForWorktree**: [`AgenticGeneratorExecutorForWorktree`](#agenticgeneratorexecutorforworktree)

Place the exact author profile on compute that can edit the supplied worktree.

##### buildPrompt

> **buildPrompt**: (`args`) => `string`

Author the task from admitted findings. Required: Runtime invents no code-improvement prompt.

###### Parameters

###### args

###### findings

readonly `ProposalFinding`[]

###### Returns

`string`

##### verify?

> `optional` **verify?**: [`Verifier`](#verifier)

Verify a candidate worktree before it becomes a measurable surface; failures
feed the next shot (see `agenticGenerator.verify` / `commandVerifier`).

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Per-shot wall-clock timeout. Omit for no Runtime-imposed deadline.

##### maximumCharge?

> `optional` **maximumCharge?**: `MaximumCharge`

Optional provider-enforced maximum admitted by the run-wide cost ledger.

##### generator?

> `optional` **generator?**: `undefined`

***

### ImproveCustomCodeGeneratorOptions

#### Properties

##### generator

> **generator**: [`CandidateGenerator`](#candidategenerator)

Complete byte-producer replacement. Runtime still validates `profile` before creating worktrees.

##### executorForWorktree?

> `optional` **executorForWorktree?**: `undefined`

##### buildPrompt?

> `optional` **buildPrompt?**: `undefined`

##### verify?

> `optional` **verify?**: `undefined`

##### timeoutMs?

> `optional` **timeoutMs?**: `undefined`

##### maximumCharge?

> `optional` **maximumCharge?**: `undefined`

***

### ImprovementProfileCandidate

#### Properties

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

Surface searched by this run.

##### value

> **value**: `MutableSurface`

Exact winning value returned by agent-eval.

##### profile

> **profile**: `object`

Exact complete profile instance measured on the final cases.

***

### ImprovementCodeCandidate

#### Properties

##### surface

> **surface**: `"code"`

##### value

> **value**: `MutableSurface`

##### profile?

> `optional` **profile?**: `undefined`

***

### ImproveCost

Normalized spend reported for one Runtime improvement run.

#### Properties

##### totalCostUsd

> **totalCostUsd**: `number`

Dollars every settled call reported or priced.

##### accountingComplete

> **accountingComplete**: `boolean`

Every call's cost and usage is known.

##### incompleteReasons

> **incompleteReasons**: `string`[]

##### costBound?

> `optional` **costBound?**: `object`

A search's accounting when it is incomplete only because some calls' cost is
unknown under a maximum each declared before it ran, such as a call that
failed with no receipt. Each counts at that maximum, so the work cost at
most `totalMaximumUsd`. Absent when the accounting is complete or has any
other gap.

###### unknownCalls

> **unknownCalls**: `number`

###### unknownMaximumUsd

> **unknownMaximumUsd**: `number`

###### totalMaximumUsd

> **totalMaximumUsd**: `number`

***

### SearchPromotion

A search's claim as a `SuperviseRegistry.profiles` promotion: list it beside the
shipped profile, `{ profile: result.candidate.profile, promotion }`. The sealed
experiment names the root as control and every finalist the claim tested as a
treatment, by exact profile digest; the decision is Eval's paired decision the
claim made for the shipped finalist.

#### Properties

##### experiment

> `readonly` **experiment**: `SealedExperiment`

##### decision

> `readonly` **decision**: `PairedPromotionDecision`

***

### ImproveScenarioPartitions

Redacted task evidence retained for every optimizer-visible partition.

#### Properties

##### train

> **train**: readonly `CampaignScenarioIdentity`[]

##### selection

> **selection**: readonly `CampaignScenarioIdentity`[]

##### finalTest

> **finalTest**: readonly `CampaignScenarioIdentity`[]

##### optimizationReps

> **optimizationReps**: `number`

##### finalTestReps

> **finalTestReps**: `number`

***

### ImproveLineage

Optimizer ancestry sealed into downstream candidate experiments.

#### Extended by

- [`ImproveMethodLineage`](#improvemethodlineage)

#### Properties

##### invocationId

> **invocationId**: `string`

Unique Runtime invocation used to isolate this run's cost receipts.

##### runId

> **runId**: `string`

Upstream optimizer run when reported, otherwise this Runtime optimization invocation.

##### developmentSplitDigest

> **developmentSplitDigest**: `` `sha256:${string}` ``

Exact train-plus-selection scenario payloads exposed to candidate selection.

##### finalTestSplitDigest?

> `optional` **finalTestSplitDigest?**: `` `sha256:${string}` ``

Exact final-test scenario payloads measured after candidate selection.

##### scenarioPartitions?

> `optional` **scenarioPartitions?**: [`ImproveScenarioPartitions`](#improvescenariopartitions)

Redacted identities for all task partitions used by a method optimizer.

##### executionRef?

> `optional` **executionRef?**: `` `sha256:${string}` ``

Complete callback, materializer, model, tool, and closure identity for a profile run.

##### baselineProfileDigest?

> `optional` **baselineProfileDigest?**: `` `sha256:${string}` ``

`canonicalAgentProfileDigest` of the baseline profile for a profile run.

***

### ImproveMethodLineage

Method optimization always retains every identity needed to reject task reuse.

#### Extends

- [`ImproveLineage`](#improvelineage)

#### Properties

##### invocationId

> **invocationId**: `string`

Unique Runtime invocation used to isolate this run's cost receipts.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`invocationId`](#invocationid)

##### runId

> **runId**: `string`

Upstream optimizer run when reported, otherwise this Runtime optimization invocation.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`runId`](#runid-2)

##### developmentSplitDigest

> **developmentSplitDigest**: `` `sha256:${string}` ``

Exact train-plus-selection scenario payloads exposed to candidate selection.

###### Inherited from

[`ImproveLineage`](#improvelineage).[`developmentSplitDigest`](#developmentsplitdigest)

##### finalTestSplitDigest

> **finalTestSplitDigest**: `` `sha256:${string}` ``

Exact final-test scenario payloads measured after candidate selection.

###### Overrides

[`ImproveLineage`](#improvelineage).[`finalTestSplitDigest`](#finaltestsplitdigest)

##### scenarioPartitions

> **scenarioPartitions**: [`ImproveScenarioPartitions`](#improvescenariopartitions)

Redacted identities for all task partitions used by a method optimizer.

###### Overrides

[`ImproveLineage`](#improvelineage).[`scenarioPartitions`](#scenariopartitions)

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

Complete callback, materializer, model, tool, and closure identity for a profile run.

###### Overrides

[`ImproveLineage`](#improvelineage).[`executionRef`](#executionref)

##### baselineProfileDigest

> **baselineProfileDigest**: `` `sha256:${string}` ``

`canonicalAgentProfileDigest` of the baseline profile for a profile run.

###### Overrides

[`ImproveLineage`](#improvelineage).[`baselineProfileDigest`](#baselineprofiledigest)

***

### ImproveMethodResult

#### Extends

- `ImproveResultBase`\<[`ImprovementProfileCandidate`](#improvementprofilecandidate)\>

#### Properties

##### candidate

> **candidate**: [`ImprovementProfileCandidate`](#improvementprofilecandidate)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Full search and final-test spend.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`cost`](#cost-1)

##### durationMs

> **durationMs**: `number`

Full wall-clock duration.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`durationMs`](#durationms-3)

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Number of generations explored by Runtime's code path.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`generationsExplored`](#generationsexplored-1)

##### mode

> **mode**: `"method"`

##### method

> **method**: `string`

##### lineage

> **lineage**: [`ImproveMethodLineage`](#improvemethodlineage)

Optimizer ancestry used when sealing a candidate experiment.

###### Overrides

`ImproveResultBase.lineage`

##### provenance?

> `optional` **provenance?**: `OptimizationMethodProvenance`

External optimizer package and resumable run identity, when reported.

##### decision

> **decision**: `"ship"` \| `"hold"`

Final-test decision for this search result.

###### Overrides

`ImproveResultBase.decision`

##### lift

> **lift**: `number`

Final-test lift when one was measured.

###### Overrides

`ImproveResultBase.lift`

##### liftInterval

> **liftInterval**: `object`

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Overrides

`ImproveResultBase.liftInterval`

##### searchHistory

> **searchHistory**: `SearchHistoryReceipt` \| `null`

The optimizer's search ledger, closed and verified from its bytes: every
candidate it measured as a node, its parents as edges where the optimizer
reports them, and every evaluation as a cell. `officialGepa` and
`officialSkillOpt` always record one; `null` means the method recorded
none, so its lineage is unknown.

##### raw

> **raw**: `OptimizationMethodComparison`

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### ImproveSearchResult

#### Extends

- `ImproveResultBase`\<[`ImprovementProfileCandidate`](#improvementprofilecandidate)\>

#### Properties

##### candidate

> **candidate**: [`ImprovementProfileCandidate`](#improvementprofilecandidate)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Full search and final-test spend.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`cost`](#cost-1)

##### durationMs

> **durationMs**: `number`

Full wall-clock duration.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`durationMs`](#durationms-3)

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Number of generations explored by Runtime's code path.

###### Inherited from

[`ImproveSearchResult`](#improvesearchresult).[`generationsExplored`](#generationsexplored-1)

##### mode

> **mode**: `"search"`

##### method

> **method**: `string`

##### lineage

> **lineage**: [`ImproveMethodLineage`](#improvemethodlineage)

Optimizer ancestry used when sealing a candidate experiment.

###### Overrides

`ImproveResultBase.lineage`

##### decision

> **decision**: `"ship"` \| `"hold"`

`ship` only when the claim shipped, its verification re-derived it, the
cost accounting is complete or bounded within `costCeiling` (see
`ImproveCost.costBound`), and the test lower bound exceeds `minimumLift`.

###### Overrides

`ImproveResultBase.decision`

##### reason

> **reason**: `string`

Why: the claim's reason, or the Runtime rule that held a statistical ship.

##### claim

> **claim**: `SearchClaim`

The claim made once on the sealed test split.

##### claimVerification

> **claimVerification**: `SearchClaimVerification`

The claim re-derived from the closed ledger alone.

##### lift?

> `optional` **lift?**: `number`

The kept candidate's test delta against the baseline, when the claim tested it.

###### Overrides

`ImproveResultBase.lift`

##### liftInterval?

> `optional` **liftInterval?**: `object`

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Overrides

`ImproveResultBase.liftInterval`

##### searchHistory

> **searchHistory**: `SearchHistoryReceipt`

The search ledger, closed and verified from its bytes.

##### promotion?

> `optional` **promotion?**: [`SearchPromotion`](#searchpromotion)

Present exactly when `decision` is `ship`.

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### ImproveCodeResult

#### Extends

- `ImproveResultBase`\<[`ImprovementCodeCandidate`](#improvementcodecandidate)\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### candidate

> **candidate**: [`ImprovementCodeCandidate`](#improvementcodecandidate)

Frozen candidate only. Live state is changed through an approved activation.

###### Inherited from

`ImproveResultBase.candidate`

##### decision

> **decision**: `"ship"` \| `"hold"` \| `"need_more_work"` \| `"model_ceiling"` \| `"arch_ceiling"`

Final-test decision for this search result.

###### Inherited from

`ImproveResultBase.decision`

##### lift?

> `optional` **lift?**: `number`

Final-test lift when one was measured.

###### Inherited from

`ImproveResultBase.lift`

##### liftInterval?

> `optional` **liftInterval?**: `object`

Paired final-test confidence interval for method-based profile runs.

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Inherited from

`ImproveResultBase.liftInterval`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

Full search and final-test spend.

###### Inherited from

`ImproveResultBase.cost`

##### durationMs

> **durationMs**: `number`

Full wall-clock duration.

###### Inherited from

`ImproveResultBase.durationMs`

##### lineage

> **lineage**: [`ImproveLineage`](#improvelineage)

Optimizer ancestry used when sealing a candidate experiment.

###### Inherited from

`ImproveResultBase.lineage`

##### generationsExplored?

> `optional` **generationsExplored?**: `number`

Number of generations explored by Runtime's code path.

###### Inherited from

`ImproveResultBase.generationsExplored`

##### mode

> **mode**: `"code"`

##### raw

> **raw**: `SelfImproveProposerResult`\<`TScenario`, `TArtifact`\>

#### Methods

##### dispose()

> **dispose**(): `Promise`\<`void`\>

Release resources owned by this result. Idempotent; currently disposes
the returned code worktree and is a no-op for profile-only surfaces.

###### Returns

`Promise`\<`void`\>

###### Inherited from

`ImproveResultBase.dispose`

***

### CandidateGenerator

The byte-producing path that differs between the cheap
 reflective path and the full agentic path. A generator makes (uncommitted)
 changes inside `worktreePath`; the driver commits them via the worktree
 adapter's `finalize`.

#### Properties

##### kind

> **kind**: `string`

##### proposesWithoutFindings?

> `optional` **proposesWithoutFindings?**: `boolean`

Whether this generator can produce a candidate from an empty findings set
 because it draws its change signal from the repo and raw traces on disk.
 An agentic coder (`agenticGenerator`) sets this so it still runs the full
 `populationSize` when the distiller yielded nothing. A patch-applier
 (`reflectiveGenerator`) leaves it unset — with no findings there is no
 patch to draft, so the driver short-circuits rather than spin up worktrees
 for a guaranteed no-op. Default `false`.

#### Methods

##### generate()

> **generate**(`args`): `Promise`\<\{ `applied`: `boolean`; `summary`: `string`; `label?`: `string`; `rationale?`: `string`; \}\>

###### Parameters

###### args

###### worktreePath

`string`

The candidate worktree — a clean checkout of the current incumbent.

###### findings

readonly `ProposalFinding`[]

Search or production findings explicitly admitted for proposal use.

###### maxShots

`number`

DEPTH: max iterations the generator may take (agentic uses this; the
 reflective generator ignores it).

###### signal

`AbortSignal`

###### generation?

`number`

Generation coordinates supplied by Runtime's internal code candidate driver.

###### candidateIndex?

`number`

###### costLedger?

`CostLedgerHandle`

Shared run-wide paid-call account supplied by agent-eval 0.117+.

###### costPhase?

`string`

Receipt attribution phase supplied alongside `costLedger`.

###### Returns

`Promise`\<\{ `applied`: `boolean`; `summary`: `string`; `label?`: `string`; `rationale?`: `string`; \}\>

***

### OfficialOptimizerContextOptions

Runtime context appended to an official optimizer's own configuration.

#### Properties

##### background?

> `optional` **background?**: `string`

Context supplied to the optimizer before Runtime appends the profile surface and findings.

##### includeFindings?

> `optional` **includeFindings?**: `boolean`

Include current trace or analyst findings in the optimizer background. Default true.

##### maxFindingsChars?

> `optional` **maxFindingsChars?**: `number`

Reject oversized serialized findings before starting Python. Default 50,000 characters.

##### redact?

> `optional` **redact?**: `false` \| [`Redactor`](intelligence.md#redactor)

Redact caller-supplied context and descriptors before they leave Runtime.
The built-in redactor is the default. Pass `false` only for public data
that has already been reviewed.

##### authorizeSensitiveCandidate?

> `optional` **authorizeSensitiveCandidate?**: (`input`) => `boolean`

Authorize one exact candidate containing structurally sensitive fields.
The callback must return true for every accepted baseline and candidate.

###### Parameters

###### input

[`OfficialSensitiveCandidateInput`](#officialsensitivecandidateinput)

###### Returns

`boolean`

***

### OfficialSensitiveCandidateInput

Exact materialized profile presented for validation before any candidate run.

#### Extends

- [`ImproveCandidateValidationInput`](#improvecandidatevalidationinput)

#### Properties

##### profile

> **profile**: `object`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`profile`](#profile-2)

##### surface

> **surface**: [`ImproveProfileSurface`](#improveprofilesurface)

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`surface`](#surface-1)

##### candidateSurface

> **candidateSurface**: `MutableSurface`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`candidateSurface`](#candidatesurface)

##### value

> **value**: `unknown`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`value`](#value)

##### isBaseline

> **isBaseline**: `boolean`

###### Inherited from

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput).[`isBaseline`](#isbaseline)

##### sensitivePaths

> **sensitivePaths**: readonly `string`[]

***

### CreateProfileImprovementHarnessOptions

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> **profile**: `object`

Exact baseline profile. It is parsed, detached, and frozen at construction.

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

Immutable identity of the bound executor, models, tools, component mapping,
and every closure or external setting that can change measured behavior.

##### agent

> **agent**: [`ImproveProfileAgent`](#improveprofileagent)\<`TScenario`, `TArtifact`\>

Execute one exact materialized profile on one scenario.

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Optional validator shared by every run from this harness.

***

### ProfileImprovementHarness

A small, reusable front door over `improve(profile, options)`.

The harness freezes the baseline and binds execution identity once, which
removes the two easiest sources of accidental experiment drift when a
developer runs several methods, surfaces, or held-out suites against the
same agent. It does not replace or narrow `improve`; callers retain every
method option and may still use the lower-level API directly.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Properties

##### profile

> `readonly` **profile**: `object`

Detached immutable baseline actually used by every run.

##### profileDigest

> `readonly` **profileDigest**: `` `sha256:${string}` ``

Canonical digest of the bound baseline profile.

##### executionRef

> `readonly` **executionRef**: `` `sha256:${string}` ``

Exact execution identity bound at construction.

#### Methods

##### train()

> **train**(`options`): `Promise`\<[`ImproveTrainingResult`](#improvetrainingresult)\>

Train the bound profile with a separately pinned trainer and serving execution identity.

###### Parameters

###### options

[`ProfileImprovementHarnessTrainOptions`](#profileimprovementharnesstrainoptions)

###### Returns

`Promise`\<[`ImproveTrainingResult`](#improvetrainingresult)\>

##### run()

> **run**(`options`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

###### Parameters

###### options

[`ProfileImprovementHarnessRunOptions`](#profileimprovementharnessrunoptions)\<`TScenario`, `TArtifact`\>

###### Returns

`Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

***

### ReflectiveGeneratorOptions

#### Methods

##### createImprovementProposalSource()

> **createImprovementProposalSource**(`context`): [`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

Bind proposal reads and paid calls to this candidate's worktree and account.

###### Parameters

###### context

###### worktreePath

`string`

The candidate worktree — a clean checkout of the current incumbent.

###### findings

readonly `ProposalFinding`[]

Search or production findings explicitly admitted for proposal use.

###### maxShots

`number`

DEPTH: max iterations the generator may take (agentic uses this; the
 reflective generator ignores it).

###### signal

`AbortSignal`

###### generation?

`number`

Generation coordinates supplied by Runtime's internal code candidate driver.

###### candidateIndex?

`number`

###### costLedger?

`CostLedgerHandle`

Shared run-wide paid-call account supplied by agent-eval 0.117+.

###### costPhase?

`string`

Receipt attribution phase supplied alongside `costLedger`.

###### Returns

[`ImprovementProposalSource`](analyst-loop.md#improvementproposalsource)\<[`SurfaceImprovementEdit`](agent.md#surfaceimprovementedit)\>

***

### ReflectiveProposerReply

#### Properties

##### content

> `readonly` **content**: `string`

The model's visible reply.

##### usage

> `readonly` **usage**: \{ `inputTokens`: `number`; `outputTokens`: `number`; `reasoningTokens?`: `number`; `cachedTokens?`: `number`; \} \| `null`

Billed tokens as the provider reported them, or null when it reported none:
the call's cost is then unknown and counts at its declared maximum.

##### model?

> `readonly` `optional` **model?**: `string`

The model the provider says served the call. Default `model`.

***

### ReflectiveProposerParent

One parent, as `evidence` receives it.

#### Properties

##### nodeId

> `readonly` **nodeId**: `string` \| `null`

The parent's node; null for a proposal outside a search.

##### surface

> `readonly` **surface**: `MutableSurface`

##### trainCells

> `readonly` **trainCells**: readonly `SearchScoredCell`[]

The parent's scored train cells. Unscored cells are absent, never zero.

***

### ReflectiveProfileProposerOptions

#### Properties

##### kind?

> `readonly` `optional` **kind?**: `string`

Names the proposer in the search's identity and its receipts. Default
`reflective-profile`.

##### model

> `readonly` **model**: `string`

The model `chat` calls, recorded on its receipt.

##### chat

> `readonly` **chat**: [`ReflectiveProposerChat`](#reflectiveproposerchat)

##### pricing

> `readonly` **pricing**: `CustomTokenPricing`

Rates that price the call and its declared maximum.

##### maxOutputTokens?

> `readonly` `optional` **maxOutputTokens?**: `number`

Output tokens the call may bill. Default 16,000.

##### frame

> `readonly` **frame**: `string`

What the surface is and how it is measured, as the model should read it:
the agent, its task, the score, and what transfers to unseen tasks. Runtime
adds the method, the operator, the parents and the output contract.

##### evidence?

> `readonly` `optional` **evidence?**: (`parent`) => readonly `string`[] \| `Promise`\<readonly `string`[]\>

The caller's train-only evidence for one parent: for example each train
task, its expected answer, the parent's answer and its error. Return text
sections; Runtime places them under the parent. Never read selection or
test data here. Default: each scored train unit and its score.

###### Parameters

###### parent

[`ReflectiveProposerParent`](#reflectiveproposerparent)

###### Returns

readonly `string`[] \| `Promise`\<readonly `string`[]\>

##### maxSurfaceChars?

> `readonly` `optional` **maxSurfaceChars?**: `number`

The longest surface text the proposer returns, in characters; a longer
reply proposes nothing. Default 12,000.

***

### DecideSearchImprovementOptions

#### Properties

##### searchDir

> **searchDir**: `string`

The closed search's directory, `<runDir>/search/<searchId>`: its
`ledger.jsonl`, `blobs/` and, unless `costLedger` is given, `cost-ledger.jsonl`.

##### minimumLift?

> `optional` **minimumLift?**: `number`

The `minimumLift` the search ran with. Default 0, as in `improve()`.

##### costLedger?

> `optional` **costLedger?**: `CostLedgerHandle`

The cost ledger the search recorded into, when `improve()` was given one.

##### storage?

> `optional` **storage?**: `CampaignStorage`

***

### SearchImprovementDecision

#### Extends

- `SearchShipDecision`

#### Properties

##### decision

> **decision**: `"ship"` \| `"hold"`

###### Inherited from

`SearchShipDecision.decision`

##### reason

> **reason**: `string`

The claim's reason, the Runtime rule that held a statistical ship, and any
cost bound the decision relied on.

###### Inherited from

`SearchShipDecision.reason`

##### lift?

> `optional` **lift?**: `number`

The shipped finalist's test delta against the root, when the claim tested it.

###### Inherited from

`SearchShipDecision.lift`

##### liftInterval?

> `optional` **liftInterval?**: `object`

###### low

> **low**: `number`

###### high

> **high**: `number`

###### Inherited from

`SearchShipDecision.liftInterval`

##### promotion?

> `optional` **promotion?**: [`SearchPromotion`](#searchpromotion)

Present exactly when `decision` is `ship`: the sealed claim and Eval's
paired decision, ready for `SuperviseRegistry.profiles` beside the shipped
profile.

###### Inherited from

`SearchShipDecision.promotion`

##### searchId

> **searchId**: `string`

##### claim

> **claim**: `SearchClaim`

##### claimVerification

> **claimVerification**: `SearchClaimVerification`

##### cost

> **cost**: [`ImproveCost`](#improvecost)

##### baseline

> **baseline**: `AgentProfile`

The root's exact profile.

##### candidate

> **candidate**: `AgentProfile`

The profile the search keeps: the shipped finalist, else the claim's
selection, else the root.

***

### SearchLane

An execution lane: slots that share one cost rule, and the profiles they cannot run.

#### Extends

- `SearchLane`

#### Extended by

- [`SharedBoxSearchLane`](#sharedboxsearchlane)

#### Properties

##### name

> `readonly` **name**: `string`

###### Overrides

`KernelSearchLane.name`

##### kind

> `readonly` **kind**: [`SearchLaneKind`](#searchlanekind)

##### capacity

> `readonly` **capacity**: `number`

Cells the lane runs at once.

###### Overrides

`KernelSearchLane.capacity`

##### costCap

> `readonly` **costCap**: `"hard"` \| `"estimate"`

`hard`: the lane enforces `cellUsd` as each cell's maximum. `estimate`:
it cannot, and the kernel holds an estimate, recording any overshoot.

###### Overrides

`KernelSearchLane.costCap`

##### cellUsd

> `readonly` **cellUsd**: `number`

The enforced per-cell maximum of a hard lane; the prior estimate of an
estimate lane until it has settled enough cells to estimate its own.

###### Overrides

`KernelSearchLane.cellUsd`

#### Methods

##### refusal()

> **refusal**(`profile`): `string` \| `undefined`

Why this lane cannot run `profile`, or undefined when it can.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string` \| `undefined`

##### recoverReceipt()?

> `optional` **recoverReceipt**(`call`): `Promise`\<`CostReceiptInput` \| `null`\>

The receipt of a paid call that a process which ended made on this lane, asked of the
 provider by `call.callId`; null when the provider cannot say. Without it, such a call
 settles with an unknown cost.

###### Parameters

###### call

`PendingCostCallView`

###### Returns

`Promise`\<`CostReceiptInput` \| `null`\>

***

### SearchLaneOptions

Options every lane builder takes.

#### Properties

##### name?

> `optional` **name?**: `string`

##### recoverReceipt?

> `optional` **recoverReceipt?**: (`call`) => `Promise`\<`CostReceiptInput` \| `null`\>

The receipt of a paid call that a process which ended made on this lane, asked of the
 provider by `call.callId`; null when the provider cannot say. Without it, such a call
 settles with an unknown cost.

###### Parameters

###### call

`PendingCostCallView`

###### Returns

`Promise`\<`CostReceiptInput` \| `null`\>

***

### SharedBoxSearchLane

A lane of workers packed into shared Sandbox boxes. Close `placement` when the run settles.

#### Extends

- [`SearchLane`](#searchlane)

#### Properties

##### name

> `readonly` **name**: `string`

###### Inherited from

[`SearchLane`](#searchlane).[`name`](#name-2)

##### capacity

> `readonly` **capacity**: `number`

Cells the lane runs at once.

###### Inherited from

[`SearchLane`](#searchlane).[`capacity`](#capacity)

##### costCap

> `readonly` **costCap**: `"hard"` \| `"estimate"`

`hard`: the lane enforces `cellUsd` as each cell's maximum. `estimate`:
it cannot, and the kernel holds an estimate, recording any overshoot.

###### Inherited from

[`SearchLane`](#searchlane).[`costCap`](#costcap)

##### cellUsd

> `readonly` **cellUsd**: `number`

The enforced per-cell maximum of a hard lane; the prior estimate of an
estimate lane until it has settled enough cells to estimate its own.

###### Inherited from

[`SearchLane`](#searchlane).[`cellUsd`](#cellusd)

##### kind

> `readonly` **kind**: `"shared-box"`

###### Overrides

[`SearchLane`](#searchlane).[`kind`](#kind-3)

##### placement

> `readonly` **placement**: [`SharedBoxPlacement`](runtime.md#sharedboxplacement)

#### Methods

##### refusal()

> **refusal**(`profile`): `string` \| `undefined`

Why this lane cannot run `profile`, or undefined when it can.

###### Parameters

###### profile

`AgentProfile`

###### Returns

`string` \| `undefined`

###### Inherited from

[`SearchLane`](#searchlane).[`refusal`](#refusal)

##### recoverReceipt()?

> `optional` **recoverReceipt**(`call`): `Promise`\<`CostReceiptInput` \| `null`\>

The receipt of a paid call that a process which ended made on this lane, asked of the
 provider by `call.callId`; null when the provider cannot say. Without it, such a call
 settles with an unknown cost.

###### Parameters

###### call

`PendingCostCallView`

###### Returns

`Promise`\<`CostReceiptInput` \| `null`\>

###### Inherited from

[`SearchLane`](#searchlane).[`recoverReceipt`](#recoverreceipt)

***

### SearchCellContext

What the agent of one attempt knows about where and as what it runs.

#### Properties

##### searchId

> `readonly` **searchId**: `string`

##### cellId

> `readonly` **cellId**: `string`

##### nodeId

> `readonly` **nodeId**: `string`

##### taskId

> `readonly` **taskId**: `string`

##### split

> `readonly` **split**: `SearchSplit`

##### stage

> `readonly` **stage**: `SearchCellStage`

##### attempt

> `readonly` **attempt**: `number`

##### runId

> `readonly` **runId**: `string`

`cellId:attempt`. It is the same after a restart, so key remote work by it: a request sent
 again with the same run id must return the first execution's result, not start a second.

##### lane

> `readonly` **lane**: [`SearchLane`](#searchlane)

##### trace

> `readonly` **trace**: \{ `traceId`: `string`; `spanId`: `string`; \} \| `null`

The attempt's trace. Parent your own spans on `spanId`. Null when tracing is off.

***

### SearchMethodOptions

#### Properties

##### proposer

> **proposer**: `SurfaceProposer`\<`ProposalFinding`\>

Writes each child surface from the parents the policy chose. It reads the
train split only (`ProposeContext.train` and `summary`); `history` is empty.

##### maxExpansions

> **maxExpansions**: `number`

Proposals the search may make.

##### policy?

> `optional` **policy?**: `SearchPolicy`

Which node each proposal extends, and which node the search keeps.
Default `aide()`: drafts from the baseline, debugs a node whose cells
fail as defects, and otherwise improves a parent drawn by Thompson
sampling over each node's posterior, forking from the best node when a
lineage stalls. `beam({ width })` expands the top nodes in turn;
`incumbent()` is the hill climb, which needs `uniform()`.

##### allocation?

> `optional` **allocation?**: `SearchAllocator`

Where cells go. Default `asha()`: successive halving over one seeded
permutation of the selection units. Each node is screened on 6 selection
units and 2 train units, and the top third of each rung advances to twice
the units. `uniform()` runs every node on every train and selection task.
The allocator's `reps` are every split's repeats, the claim's included.

##### lanes

> **lanes**: readonly [`SearchLane`](#searchlane)[]

Where cells run: `sharedBoxLane`, `dedicatedLane`, `subscriptionLane`
or `routerLane`. Each cell goes to a lane that accepts the node's profile,
in proportion to capacity; a hard lane caps each cell's paid calls at its
`cellUsd`, and an estimate lane holds `cellUsd` until 20 of its cells
settle. The search runs at most the lanes' total capacity at once.

##### childrenPerProposal?

> `optional` **childrenPerProposal?**: `number`

Children one proposal asks for. Default 1.

##### claimReserveUsd?

> `optional` **claimReserveUsd?**: `number`

Dollars held for the claim from the start. Default: the root and 3
finalists on every test task at the largest lane `cellUsd` a cell.

##### deadline?

> `optional` **deadline?**: `string`

ISO time after which the search stops expanding and claims.

##### maxAttempts?

> `optional` **maxAttempts?**: `number`

Attempts per cell for retryable environment errors. Default 3.

##### name?

> `optional` **name?**: `string`

Recorded as the ledger's process name. Default `search`.

***

### ProfileTrainerRequest

#### Properties

##### version

> **version**: `1`

##### invocationId

> **invocationId**: `string`

##### datasetPath

> **datasetPath**: `string`

##### checkpointPath

> **checkpointPath**: `string`

##### parentProfilePath

> **parentProfilePath**: `string`

##### parentProfileDigest

> **parentProfileDigest**: `` `sha256:${string}` ``

##### parameters

> **parameters**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

***

### ProfileTrainer

Managed adapters use this same port: cancel the job on abort and download one exact checkpoint file.

#### Properties

##### identity

> **identity**: `Omit`\<`AgentTrainingReceipt`\[`"trainer"`\], `"parameters"`\>

#### Methods

##### execute()

> **execute**(`request`, `signal`): `Promise`\<[`TrainingBoundaryResult`](#trainingboundaryresult)\<`void`\>\>

###### Parameters

###### request

`Readonly`\<[`ProfileTrainerRequest`](#profiletrainerrequest)\>

###### signal

`AbortSignal`

###### Returns

`Promise`\<[`TrainingBoundaryResult`](#trainingboundaryresult)\<`void`\>\>

***

### CheckpointServingPort

#### Methods

##### serve()

> **serve**(`input`): `Promise`\<[`TrainingBoundaryResult`](#trainingboundaryresult)\<\{ `routerModelId`: `string`; `artifactDigest`: `` `sha256:${string}` ``; `evidenceDigest`: `` `sha256:${string}` ``; \}\>\>

Verify the immutable Router route independently of the trainer's output.

###### Parameters

###### input

###### artifactPath

`string`

###### artifactDigest

`` `sha256:${string}` ``

###### artifactBytes

`number`

###### routerModelId

`string`

###### signal

`AbortSignal`

###### Returns

`Promise`\<[`TrainingBoundaryResult`](#trainingboundaryresult)\<\{ `routerModelId`: `string`; `artifactDigest`: `` `sha256:${string}` ``; `evidenceDigest`: `` `sha256:${string}` ``; \}\>\>

***

### ImproveTrainingOptions

#### Properties

##### mode

> **mode**: `"training"`

##### trainer

> **trainer**: [`ProfileTrainer`](#profiletrainer)

##### dataset

> **dataset**: `object`

###### path

> **path**: `string`

###### digest

> **digest**: `` `sha256:${string}` ``

##### parameters

> **parameters**: `Record`\<`string`, `string` \| `number` \| `boolean` \| `null`\>

##### executionRef

> **executionRef**: `` `sha256:${string}` ``

Pins trainer, serving adapter and their private dependencies, just like the bound profile harness.

##### serving

> **serving**: [`CheckpointServingPort`](#checkpointservingport)

##### outputDirectory

> **outputDirectory**: `string`

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Optional overall deadline. Omit to rely on caller cancellation; long durations are supported.

##### maxCheckpointBytes

> **maxCheckpointBytes**: `number`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

***

### ControlledTrainingCommand

#### Properties

##### id

> **id**: `string`

##### executable

> **executable**: `object`

###### path

> **path**: `string`

###### digest

> **digest**: `` `sha256:${string}` ``

##### args

> **args**: `string`[]

##### inputs

> **inputs**: `object`[]

Script/config files used by the command, verified before and after execution.

###### path

> **path**: `string`

###### digest

> **digest**: `` `sha256:${string}` ``

##### environment

> **environment**: `Record`\<`string`, `string`\>

Explicit public environment only. Ambient credentials are never inherited.

##### maxOutputBytes

> **maxOutputBytes**: `number`

Total stdout + stderr byte budget. Output is drained, not retained in memory.

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

### CreateKnowledgeImprovementActivationExecutorOptions

#### Extends

- `Omit`\<`PromoteKnowledgeCandidateOptions`, `"root"` \| `"candidate"`\>

#### Properties

##### root

> **root**: `string`

##### identity

> **identity**: `string`

##### results

> **results**: [`AgentImprovementActivationResultStore`](#agentimprovementactivationresultstore)

***

### KnowledgeImprovementActivationExecutor

#### Properties

##### transition

> **transition**: [`AgentImprovementActivationTransition`](#agentimprovementactivationtransition)

##### reconcile

> **reconcile**: [`AgentImprovementActivationReconciliation`](#agentimprovementactivationreconciliation)

***

### RunKnowledgeImprovementJobOptions

#### Extends

- `Omit`\<`KnowledgeImprovementOptions`, `"updateKnowledge"`\>

#### Properties

##### budget

> **budget**: [`Budget`](runtime.md#budget-10)

##### readinessCheck?

> `optional` **readinessCheck?**: [`KnowledgeReadinessCheck`](#knowledgereadinesscheck)

##### backend?

> `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

##### makeWorkerAgent?

> `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

##### supervisorProfile

> **supervisorProfile**: `AgentProfile`

##### superviseOptions?

> `optional` **superviseOptions?**: `Partial`\<`Omit`\<[`SuperviseOptions`](runtime.md#superviseoptions), `"budget"` \| `"backend"` \| `"deliverable"` \| `"allowedModels"` \| `"makeWorkerAgent"`\>\>

##### allowedModels?

> `optional` **allowedModels?**: readonly `string`[]

##### runSupervised?

> `optional` **runSupervised?**: (`profile`, `task`, `opts`) => `Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

###### Parameters

###### profile

`AgentProfile`

###### task

`unknown`

###### opts

[`SuperviseOptions`](runtime.md#superviseoptions)

###### Returns

`Promise`\<[`SupervisedResult`](runtime.md#supervisedresult)\<`unknown`\>\>

##### candidateArtifacts?

> `optional` **candidateArtifacts?**: [`AgentCandidateOutputArtifactPort`](candidate-execution.md#agentcandidateoutputartifactport)

##### onMeasurement?

> `optional` **onMeasurement?**: (`measurement`) => `void` \| `Promise`\<`void`\>

###### Parameters

###### measurement

[`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

###### Returns

`void` \| `Promise`\<`void`\>

***

### KnowledgeImprovementJobMeasurement

#### Properties

##### startedAt

> **startedAt**: `string`

##### finishedAt

> **finishedAt**: `string`

##### durationMs

> **durationMs**: `number`

##### updateCalls

> **updateCalls**: `number`

##### updateDurationMs

> **updateDurationMs**: `number`

##### supervisedSpent

> **supervisedSpent**: `object`

###### iterations

> **iterations**: `number`

###### inputTokens

> **inputTokens**: `number`

###### outputTokens

> **outputTokens**: `number`

###### usdKnown

> **usdKnown**: `boolean`

###### usd

> **usd**: `number`

###### ms

> **ms**: `number`

***

### KnowledgeImprovementJobResult

#### Properties

##### improvement

> **improvement**: `KnowledgeImprovementResult`

##### knowledge?

> `optional` **knowledge?**: [`KnowledgeImprovementCandidatePair`](#knowledgeimprovementcandidatepair)

##### measurement

> **measurement**: [`KnowledgeImprovementJobMeasurement`](#knowledgeimprovementjobmeasurement)

##### blocked

> **blocked**: `boolean`

***

### KnowledgeImprovementCandidatePair

#### Properties

##### reference

> **reference**: `AgentCandidateKnowledgeRef`

##### stateScope?

> `optional` **stateScope?**: `AgentCandidateKnowledgeStateScope`

##### evaluation

> **evaluation**: `AgentCandidateCapturedArtifact`

##### baseline

> **baseline**: `AgentCandidateWorkspaceSnapshotEvidence`

##### candidate

> **candidate**: `AgentCandidateWorkspaceSnapshotEvidence`

***

### KnowledgeImprovementExperimentBundles

#### Properties

##### baseline

> **baseline**: `AgentCandidateBundle`

##### candidate

> **candidate**: `AgentCandidateBundle`

***

### KnowledgeReadinessCheckInput

#### Properties

##### root

> **root**: `string`

##### goal

> **goal**: `string`

##### readinessSpecs?

> `optional` **readinessSpecs?**: readonly `unknown`[]

##### readinessTaskId?

> `optional` **readinessTaskId?**: `string`

##### readiness?

> `optional` **readiness?**: `unknown`

***

### ModelInfo

A model entry as returned by the Tangle Router `/v1/models` endpoint.
Intentionally minimal — only the fields resolution + validation read.

#### Properties

##### id

> **id**: `string`

##### name?

> `optional` **name?**: `string`

##### description?

> `optional` **description?**: `string`

##### provider?

> `optional` **provider?**: `string`

Provider slug, when the router exposes it (`provider` or `_provider`).

##### \_provider?

> `optional` **\_provider?**: `string`

##### architecture?

> `optional` **architecture?**: `object`

###### modality?

> `optional` **modality?**: `string`

###### input\_modalities?

> `optional` **input\_modalities?**: `string`[]

###### output\_modalities?

> `optional` **output\_modalities?**: `string`[]

***

### RouterEnv

Env keys the router base URL is resolved from.

#### Properties

##### TANGLE\_ROUTER\_URL?

> `optional` **TANGLE\_ROUTER\_URL?**: `string`

##### TANGLE\_ROUTER\_BASE\_URL?

> `optional` **TANGLE\_ROUTER\_BASE\_URL?**: `string`

***

### ChatModelCandidate

#### Properties

##### source

> **source**: `string`

Stable label for telemetry — e.g. `request`, `workspace`, `env`.

##### model

> **model**: `string` \| `undefined`

***

### ResolvedChatModel

#### Properties

##### source

> **source**: `string`

##### model

> **model**: `string`

***

### OtelExportConfig

#### Properties

##### endpoint?

> `optional` **endpoint?**: `string`

OTLP endpoint. Reads OTEL_EXPORTER_OTLP_ENDPOINT env by default.

##### headers?

> `optional` **headers?**: `Record`\<`string`, `string`\>

OTLP headers. Reads OTEL_EXPORTER_OTLP_HEADERS env by default.

##### batchSize?

> `optional` **batchSize?**: `number`

Batch size before flush. Default 64.

##### flushIntervalMs?

> `optional` **flushIntervalMs?**: `number`

Flush interval ms. Default 5000.

##### maxQueueSize?

> `optional` **maxQueueSize?**: `number`

Most spans held at once, queued plus in flight. Default 2048, the OpenTelemetry batch
processor's own default. A span that arrives when the queue is full is dropped and counted in
[OtelExportStats.dropped](#dropped), so a stalled collector costs a bounded amount of memory.

##### timeoutMs?

> `optional` **timeoutMs?**: `number`

Milliseconds one POST may take before it is abandoned and its spans count as dropped. Default 10000.

##### resourceAttributes?

> `optional` **resourceAttributes?**: `Record`\<`string`, `string` \| `number` \| `boolean`\>

Resource attributes stamped on every export.

##### serviceName?

> `optional` **serviceName?**: `string`

Service name. Default 'agent-runtime'.

***

### OtelExporter

#### Methods

##### exportSpan()

> **exportSpan**(`span`): `void`

Export a span. Never throws: a sink that cannot take the span counts it as dropped.

###### Parameters

###### span

`OtlpSpan`

###### Returns

`void`

##### flush()

> **flush**(): `Promise`\<`void`\>

Deliver everything queued so far. Rejects when spans were dropped since the previous `flush`,
naming how many and the last error, because a caller that awaits delivery is owed the answer.

###### Returns

`Promise`\<`void`\>

##### shutdown()

> **shutdown**(): `Promise`\<`void`\>

Stop accepting spans and deliver what is queued. Never rejects.

###### Returns

`Promise`\<`void`\>

##### stats()

> **stats**(): [`OtelExportStats`](#otelexportstats)

What this sink has delivered and lost so far.

###### Returns

[`OtelExportStats`](#otelexportstats)

***

### OtelExportStats

Delivery accounting for one exporter. `written + dropped + pending` covers every span handed to
`exportSpan`, so a trace that arrives short can be told apart from a run that emitted less.

#### Properties

##### written

> **written**: `number`

Spans the sink confirmed: a 2xx collector response, or a completed file append.

##### dropped

> **dropped**: `number`

Spans lost: refused by the collector, failed in transit, over the queue bound, or unwritable.

##### pending

> **pending**: `number`

Spans accepted and not yet written or dropped.

##### lastError?

> `optional` **lastError?**: `string`

The most recent failure, when there has been one.

***

### TokenWork

#### Properties

##### model

> `readonly` **model**: `string`

##### inputTokens

> `readonly` **inputTokens**: `number`

The whole prompt, cache reads and writes included.

##### outputTokens

> `readonly` **outputTokens**: `number`

##### cacheReadTokens?

> `readonly` `optional` **cacheReadTokens?**: `number`

Prompt tokens served from the provider's cache, part of `inputTokens`.

##### cacheWriteTokens?

> `readonly` `optional` **cacheWriteTokens?**: `number`

Prompt tokens written to the provider's cache, part of `inputTokens`.

***

### RuntimeHookEvent

#### Type Parameters

##### Payload

`Payload` = `unknown`

#### Properties

##### id

> **id**: `string`

##### pursuitId?

> `optional` **pursuitId?**: `string`

Stable identity for the long-lived objective. One pursuit may contain many runs.

##### runId

> **runId**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### target

> **target**: [`RuntimeHookTarget`](#runtimehooktarget)

##### phase

> **phase**: [`RuntimeHookPhase`](#runtimehookphase)

##### timestamp

> **timestamp**: `number`

##### stepIndex?

> `optional` **stepIndex?**: `number`

##### parentId?

> `optional` **parentId?**: `string`

##### payload?

> `optional` **payload?**: `Payload`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeHookContext

#### Properties

##### signal?

> `optional` **signal?**: `AbortSignal`

***

### RuntimeHookErrorContext

#### Properties

##### hook

> **hook**: `"onEvent"` \| `"onDecisionPoint"`

##### eventId?

> `optional` **eventId?**: `string`

##### target?

> `optional` **target?**: [`RuntimeHookTarget`](#runtimehooktarget)

##### phase?

> `optional` **phase?**: [`RuntimeHookPhase`](#runtimehookphase)

##### decisionId?

> `optional` **decisionId?**: `string`

##### decisionKind?

> `optional` **decisionKind?**: [`RuntimeDecisionKind`](durable.md#runtimedecisionkind)

***

### RuntimeHooks

The observation seam attached to a running loop (never to the portable genome).
Implement the optional hooks to receive lifecycle events, semantic decision points,
and hook errors. Author with [defineRuntimeHooks](#defineruntimehooks) for inference, and attach N
observers at once with [composeRuntimeHooks](#composeruntimehooks) — there is ONE event stream, not a
callback-prop zoo.

#### Properties

##### onEvent?

> `optional` **onEvent?**: (`event`, `context`) => `void` \| `Promise`\<`void`\>

General before/after/event hook. Use this for telemetry, memory capture,
policy wrapping, child lifecycle observers, or product-specific extension
points.

###### Parameters

###### event

[`RuntimeHookEvent`](#runtimehookevent)

###### context

[`RuntimeHookContext`](#runtimehookcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onDecisionPoint?

> `optional` **onDecisionPoint?**: (`point`, `context`) => `void` \| `Promise`\<`void`\>

Semantic decision hook. Belief-state evaluation consumes this, but runtime
code should keep emitting ordinary lifecycle events as the base layer.

###### Parameters

###### point

[`RuntimeDecisionPoint`](durable.md#runtimedecisionpoint)

###### context

[`RuntimeHookContext`](#runtimehookcontext)

###### Returns

`void` \| `Promise`\<`void`\>

##### onHookError?

> `optional` **onHookError?**: (`error`, `context`) => `void` \| `Promise`\<`void`\>

###### Parameters

###### error

`Error`

###### context

[`RuntimeHookErrorContext`](#runtimehookerrorcontext)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunCost

**`Stable`**

#### Extends

- `RuntimeUsageTotals`

#### Properties

##### wallMs

> **wallMs**: `number`

Wall time from `startRuntimeRun()` to `complete()` (or `now()` if not yet completed).

##### tokensIn

> **tokensIn**: `number`

Observed input tokens across normalized per-call events.

###### Inherited from

`RuntimeUsageTotals.tokensIn`

##### tokensOut

> **tokensOut**: `number`

Observed output tokens across normalized per-call events.

###### Inherited from

`RuntimeUsageTotals.tokensOut`

##### costUsd

> **costUsd**: `number`

Observed dollar subtotal; incomplete when `usdKnown` is false.

###### Inherited from

`RuntimeUsageTotals.costUsd`

##### llmCalls

> **llmCalls**: `number`

Number of observed model calls, including unpriced or incompletely metered calls.

###### Inherited from

`RuntimeUsageTotals.llmCalls`

##### tokensKnown?

> `optional` **tokensKnown?**: `false`

False when any observed call has incomplete token usage.

###### Inherited from

`RuntimeUsageTotals.tokensKnown`

##### usdKnown?

> `optional` **usdKnown?**: `false`

False when any observed call lacks complete provider-billed cost.

###### Inherited from

`RuntimeUsageTotals.usdKnown`

##### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Sum of reported external estimates; never included in `costUsd` or proof of complete cost.

###### Inherited from

`RuntimeUsageTotals.estimatedCostUsd`

***

### RuntimeRunCompleteInput

**`Stable`**

#### Properties

##### status

> **status**: `"completed"` \| `"failed"` \| `"cancelled"`

##### resultSummary?

> `optional` **resultSummary?**: `string`

##### cost?

> `optional` **cost?**: `Partial`\<[`RuntimeRunCost`](#runtimeruncost)\>

Optional subtotal overrides. Existing incomplete-usage flags remain authoritative.

##### error?

> `optional` **error?**: `string`

Stable error message when `status === 'failed'`.

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Additional adapter-specific fields merged into the persisted row.

***

### RuntimeRunRow

**`Stable`**

#### Properties

##### id

> **id**: `string`

Stable runtime-side identifier. Adapters may translate to their own primary key.

##### workspaceId

> **workspaceId**: `string`

##### sessionId?

> `optional` **sessionId?**: `string`

##### agentId?

> `optional` **agentId?**: `string`

##### domain?

> `optional` **domain?**: `string`

##### taskId

> **taskId**: `string`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### status

> **status**: [`RuntimeRunStatus`](#runtimerunstatus)

##### resultSummary?

> `optional` **resultSummary?**: `string`

##### error?

> `optional` **error?**: `string`

##### cost

> **cost**: [`RuntimeRunCost`](#runtimeruncost)

##### startedAt

> **startedAt**: `string`

##### completedAt?

> `optional` **completedAt?**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeRunPersistenceAdapter

**`Stable`**

#### Methods

##### upsert()

> **upsert**(`row`): `void` \| `Promise`\<`void`\>

Called once when `handle.persist()` runs. Implementations write `row` to
their durable store (D1, postgres, KV) and return whatever the consumer
wants the caller to see (often the storage-side row id). Errors thrown
here propagate out of `persist()` so the caller can decide whether to
retry or log-and-continue.

###### Parameters

###### row

[`RuntimeRunRow`](#runtimerunrow)

###### Returns

`void` \| `Promise`\<`void`\>

***

### RuntimeRunOptions

**`Stable`**

#### Properties

##### workspaceId

> **workspaceId**: `string`

##### sessionId?

> `optional` **sessionId?**: `string`

##### agentId?

> `optional` **agentId?**: `string`

##### taskSpec

> **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### adapter?

> `optional` **adapter?**: [`RuntimeRunPersistenceAdapter`](#runtimerunpersistenceadapter)

Optional persistence adapter; if omitted, `persist()` is a no-op.

##### id?

> `optional` **id?**: `string`

Override the row id; default = `${taskSpec.id}:${random suffix}`.

##### now?

> `optional` **now?**: () => `number`

Override the clock; default = `Date.now()`. Useful for deterministic tests.

###### Returns

`number`

***

### RuntimeRunHandle

**`Stable`**

#### Properties

##### id

> `readonly` **id**: `string`

Stable id assigned at start.

##### workspaceId

> `readonly` **workspaceId**: `string`

##### sessionId

> `readonly` **sessionId**: `string` \| `undefined`

##### taskSpec

> `readonly` **taskSpec**: [`AgentTaskSpec`](#agenttaskspec)

##### status

> `readonly` **status**: [`RuntimeRunStatus`](#runtimerunstatus)

#### Methods

##### observe()

> **observe**(`event`): `void`

Observe a single `RuntimeStreamEvent`. The handle ignores non-cost events
(text deltas, tool calls) silently so consumers can pipe the whole stream
through `handle.observe`. `llm_call` events update the ledger.

###### Parameters

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void`

##### cost()

> **cost**(): [`RuntimeRunCost`](#runtimeruncost)

Snapshot of the current cost ledger. Safe to call at any time.

###### Returns

[`RuntimeRunCost`](#runtimeruncost)

##### complete()

> **complete**(`input`): `void`

Transition to a terminal state. Idempotent for the same status; throws
`RuntimeRunStateError` for a different terminal status (state machines
don't time-travel).

###### Parameters

###### input

[`RuntimeRunCompleteInput`](#runtimeruncompleteinput)

###### Returns

`void`

##### toRow()

> **toRow**(`metadata?`): [`RuntimeRunRow`](#runtimerunrow)

Build the current row without writing it. Useful for tests + dry runs.

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

[`RuntimeRunRow`](#runtimerunrow)

##### persist()

> **persist**(`metadata?`): `Promise`\<`void`\>

Persist the current row via the configured adapter. Must be called after
`complete()`. Idempotent for the same terminal state (the adapter sees
the same row on retry).

###### Parameters

###### metadata?

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`void`\>

***

### RuntimeTelemetryOptions

**`Stable`**

#### Properties

##### includeInputs?

> `optional` **includeInputs?**: `boolean`

Include raw task inputs. Off by default because task inputs often contain
customer facts, credentials, source text, or internal IDs.

##### includeRequirementDescriptions?

> `optional` **includeRequirementDescriptions?**: `boolean`

Include requirement descriptions. Secret requirements are always redacted.

##### includeEvidenceIds?

> `optional` **includeEvidenceIds?**: `boolean`

Include evidence IDs. Off by default; counts are safer for shared reports.

##### includeUserAnswers?

> `optional` **includeUserAnswers?**: `boolean`

Include user answers from question preflight. Off by default.

##### includeControlPayloads?

> `optional` **includeControlPayloads?**: `boolean`

Include action payloads and action results for control steps. Off by default.

##### includeMetadata?

> `optional` **includeMetadata?**: `boolean`

Include task metadata. Off by default because metadata may carry IDs or policy internals.

##### includeEvalDetails?

> `optional` **includeEvalDetails?**: `boolean`

Include eval detail/evidence strings. Off by default because validators may echo private input.

***

### SanitizedKnowledgeRequirement

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### description?

> `optional` **description?**: `string`

##### requiredFor

> **requiredFor**: `string`[]

##### category

> **category**: `KnowledgeRequirementCategory`

##### acquisitionMode

> **acquisitionMode**: `KnowledgeAcquisitionMode`

##### importance

> **importance**: `KnowledgeImportance`

##### freshness

> **freshness**: `KnowledgeFreshness`

##### sensitivity

> **sensitivity**: `KnowledgeSensitivity`

##### confidenceNeeded

> **confidenceNeeded**: `number`

##### currentConfidence

> **currentConfidence**: `number`

##### evidenceCount

> **evidenceCount**: `number`

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

##### fallbackPolicy

> **fallbackPolicy**: `KnowledgeFallbackPolicy`

***

### SanitizedKnowledgeReadinessReport

**`Stable`**

#### Properties

##### taskId

> **taskId**: `string`

##### readinessScore

> **readinessScore**: `number`

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

##### severity

> **severity**: `ControlSeverity`

##### reason

> **reason**: `string`

##### blockingMissingRequirements

> **blockingMissingRequirements**: [`SanitizedKnowledgeRequirement`](#sanitizedknowledgerequirement)[]

##### nonBlockingGaps

> **nonBlockingGaps**: [`SanitizedKnowledgeRequirement`](#sanitizedknowledgerequirement)[]

##### evidenceCount

> **evidenceCount**: `number`

##### evidenceIds?

> `optional` **evidenceIds?**: `string`[]

##### missingRequirementIds

> **missingRequirementIds**: `string`[]

***

### RuntimeEventCollector

**`Stable`**

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### onEvent

> **onEvent**: (`event`) => `void`

###### Parameters

###### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`void`

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

***

### RuntimeStreamEventSummary

**`Stable`**

#### Properties

##### eventCount

> **eventCount**: `number`

Total count of sanitized events collected.

##### eventCountsByType

> **eventCountsByType**: `Record`\<`string`, `number`\>

Count of events per `type`. Useful for log-line summaries.

##### firstSessionId?

> `optional` **firstSessionId?**: `string`

First session id observed in a `session_created` / `session_resumed` event, if any.

##### finalStatus?

> `optional` **finalStatus?**: [`AgentTaskStatus`](#agenttaskstatus)

Last `final` event's status, if a final event was observed.

##### finalReason?

> `optional` **finalReason?**: `string`

Last `final` event's reason, if a final event was observed.

##### finalText

> **finalText**: `string`

Concatenated `text_delta.text` across the stream, even when payloads are redacted.

***

### RuntimeStreamEventCollector

**`Stable`**

#### Properties

##### onEvent

> **onEvent**: [`RuntimeStreamEventSink`](#runtimestreameventsink)

##### events

> **events**: `Record`\<`string`, `unknown`\>[]

#### Methods

##### summary()

> **summary**(): [`RuntimeStreamEventSummary`](#runtimestreameventsummary)

Snapshot of a small streaming-flavored summary derived from collected events.

###### Returns

[`RuntimeStreamEventSummary`](#runtimestreameventsummary)

***

### ServerSentEventOptions

**`Stable`**

#### Properties

##### event?

> `optional` **event?**: `string`

##### id?

> `optional` **id?**: `string`

##### retry?

> `optional` **retry?**: `number`

***

### AgentTaskSpec

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### intent

> **intent**: `string`

##### domain?

> `optional` **domain?**: `string`

Domain is metadata, not an architectural boundary: tax, legal, gtm, creative, blueprint, redteam, etc.

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

##### requiredKnowledge?

> `optional` **requiredKnowledge?**: `KnowledgeRequirement`[]

##### budget?

> `optional` **budget?**: `Partial`\<`ControlBudget`\>

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### AgentKnowledgeProvider

**`Stable`**

#### Methods

##### buildReadiness()?

> `optional` **buildReadiness**(`task`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

###### Parameters

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

##### answerQuestions()?

> `optional` **answerQuestions**(`questions`, `task`): `Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

###### Parameters

###### questions

`UserQuestion`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`Record`\<`string`, `string`\> \| `Promise`\<`Record`\<`string`, `string`\>\>

##### executeAcquisitionPlans()?

> `optional` **executeAcquisitionPlans**(`plans`, `task`): `string`[] \| `Promise`\<`string`[]\>

###### Parameters

###### plans

`DataAcquisitionPlan`[]

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`string`[] \| `Promise`\<`string`[]\>

##### refreshReadiness()?

> `optional` **refreshReadiness**(`input`): `KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

###### Parameters

###### input

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### previous

`KnowledgeReadinessReport`

###### userAnswers

`Record`\<`string`, `string`\>

###### acquiredEvidenceIds

`string`[]

###### Returns

`KnowledgeReadinessReport` \| `Promise`\<`KnowledgeReadinessReport`\>

***

### AgentTaskContext

**`Stable`**

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### state

> **state**: `TState`

##### evals

> **evals**: `TEval`[]

##### history

> **history**: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

##### budget

> **budget**: `ControlBudget`

##### stepIndex

> **stepIndex**: `number`

##### wallMs

> **wallMs**: `number`

##### spentCostUsd

> **spentCostUsd**: `number`

##### remainingCostUsd?

> `optional` **remainingCostUsd?**: `number`

##### abortSignal

> **abortSignal**: `AbortSignal`

***

### AgentAdapter

**`Stable`**

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Methods

##### observe()

> **observe**(`ctx`): `TState` \| `Promise`\<`TState`\>

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

###### Returns

`TState` \| `Promise`\<`TState`\>

##### validate()

> **validate**(`ctx`): `TEval`[] \| `Promise`\<`TEval`[]\>

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### state

`TState`

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### abortSignal

`AbortSignal`

###### Returns

`TEval`[] \| `Promise`\<`TEval`[]\>

##### decide()

> **decide**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### act()

> **act**(`action`, `ctx`): `TActionResult` \| `Promise`\<`TActionResult`\>

###### Parameters

###### action

`TAction`

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`TActionResult` \| `Promise`\<`TActionResult`\>

##### shouldStop()?

> `optional` **shouldStop**(`ctx`): `Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

###### Parameters

###### ctx

[`AgentTaskContext`](#agenttaskcontext)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### Returns

`Promise`\<\{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}\> \| \{ `stop`: `boolean`; `pass`: `boolean`; `reason`: `string`; `score?`: `number`; \}

##### onKnowledgeBlocked()?

> `optional` **onKnowledgeBlocked**(`ctx`): `ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

###### Parameters

###### ctx

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### knowledge

`KnowledgeReadinessReport`

###### questions

`UserQuestion`[]

###### acquisitionPlans

`DataAcquisitionPlan`[]

###### Returns

`ControlDecision`\<`TAction`\> \| `Promise`\<`ControlDecision`\<`TAction`\>\>

##### getActionCostUsd()?

> `optional` **getActionCostUsd**(`ctx`): `number` \| `undefined`

###### Parameters

###### ctx

###### action

`TAction`

###### result

`TActionResult`

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### state

`TState`

###### evals

`TEval`[]

###### history

`ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>[]

###### Returns

`number` \| `undefined`

##### projectRunRecords()?

> `optional` **projectRunRecords**(`result`, `task`): `RunRecord`[]

###### Parameters

###### result

`ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

###### task

[`AgentTaskSpec`](#agenttaskspec)

###### Returns

`RunRecord`[]

***

### OpenAIChatTool

**`Stable`**

OpenAI Chat Completions tool descriptor. The shape mirrors the
`/v1/chat/completions` `tools[]` parameter so caller-owned compatible
transports can pass tool definitions without translation. A router can
proxy this shape to Anthropic
(translated server-side), DeepSeek, Groq, OpenAI, and Gemini — every model
that the eval surface targets.

Callers that build their tool list from MCP servers should run a one-shot
MCP `tools/list` at config time and project the result into this shape. The
runtime intentionally does NOT depend on `@modelcontextprotocol/sdk` —
keeping the backend transport thin lets domain repos own MCP plumbing.

#### Properties

##### type

> **type**: `"function"`

##### function

> **function**: `object`

###### name

> **name**: `string`

###### description?

> `optional` **description?**: `string`

###### parameters?

> `optional` **parameters?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSession

**`Stable`**

#### Properties

##### id

> **id**: `string`

##### backend

> **backend**: `string`

##### status

> **status**: `"completed"` \| `"failed"` \| `"aborted"` \| `"active"`

##### resumeToken?

> `optional` **resumeToken?**: `string`

##### createdAt

> **createdAt**: `string`

##### updatedAt

> **updatedAt**: `string`

##### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

***

### RuntimeSessionStore

**`Stable`**

#### Methods

##### get()

> **get**(`sessionId`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession) \| `undefined`\> \| `undefined`

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession) \| `undefined`\> \| `undefined`

##### put()

> **put**(`session`): `void` \| `Promise`\<`void`\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### Returns

`void` \| `Promise`\<`void`\>

##### appendEvent()?

> `optional` **appendEvent**(`sessionId`, `event`): `void` \| `Promise`\<`void`\>

###### Parameters

###### sessionId

`string`

###### event

[`RuntimeStreamEvent`](#runtimestreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### listEvents()?

> `optional` **listEvents**(`sessionId`): [`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

###### Parameters

###### sessionId

`string`

###### Returns

[`RuntimeStreamEvent`](#runtimestreamevent)[] \| `Promise`\<[`RuntimeStreamEvent`](#runtimestreamevent)[]\>

***

### AgentBackendInput

**`Stable`**

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### message?

> `optional` **message?**: `string`

##### messages?

> `optional` **messages?**: `object`[]

###### role

> **role**: `string`

###### content

> **content**: `string`

##### parts?

> `optional` **parts?**: `InputPart`[]

##### interactions?

> `optional` **interactions?**: `Readonly`\<`Record`\<`string`, `boolean` \| `undefined`\>\>

##### providerOptions?

> `optional` **providerOptions?**: `Record`\<`string`, `unknown`\>

##### inputs?

> `optional` **inputs?**: `Record`\<`string`, `unknown`\>

***

### AgentBackendContext

**`Stable`**

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### session

> **session**: [`RuntimeSession`](#runtimesession)

##### signal?

> `optional` **signal?**: `AbortSignal`

##### runId?

> `optional` **runId?**: `string`

Conversation/run identifier when this call is part of a multi-agent run.
Backends should stamp it into any trace/log emission so cross-participant
events correlate. Absent when the call is a stand-alone `runAgentTask`.

##### turnId?

> `optional` **turnId?**: `string`

Deterministic turn id for this single call. Stable across retries of the
same logical turn so a caching gateway / idempotent backend can dedupe.

##### parentTurnId?

> `optional` **parentTurnId?**: `string`

If this call is itself nested inside a higher-order conversation
(recursion via `createConversationBackend`), the enclosing turn's id.
Used for trace stitching across nested orchestration.

##### propagatedHeaders?

> `optional` **propagatedHeaders?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Headers to forward verbatim to any outbound HTTP the backend issues:
`X-Tangle-Forwarded-Authorization`, `X-Tangle-Forwarded-Depth`,
run/turn correlation. Backends that issue HTTP MUST merge these into
the outbound request; backends that don't issue HTTP may ignore them.

***

### AgentExecutionBackend

**`Stable`**

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### kind

> **kind**: `string`

#### Methods

##### start()?

> `optional` **start**(`input`, `context`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### Parameters

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\> & `object`

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

##### resume()?

> `optional` **resume**(`session`, `input`, `context`): [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### input

`TInput`

###### context

`Omit`\<[`AgentBackendContext`](#agentbackendcontext), `"session"`\>

###### Returns

[`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

##### stream()

> **stream**(`input`, `context`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

###### Parameters

###### input

`TInput`

###### context

[`AgentBackendContext`](#agentbackendcontext)

###### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

##### stop()?

> `optional` **stop**(`session`, `reason`): `void` \| `Promise`\<`void`\>

###### Parameters

###### session

[`RuntimeSession`](#runtimesession)

###### reason

`string`

###### Returns

`void` \| `Promise`\<`void`\>

***

### RunAgentTaskStreamOptions

**`Stable`**

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### backend

> **backend**: [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

##### input?

> `optional` **input?**: `Omit`\<`TInput`, `"task"`\>

##### knowledge?

> `optional` **knowledge?**: [`AgentKnowledgeProvider`](#agentknowledgeprovider)

##### sessionStore?

> `optional` **sessionStore?**: [`RuntimeSessionStore`](#runtimesessionstore)

##### sessionId?

> `optional` **sessionId?**: `string`

##### resume?

> `optional` **resume?**: `boolean`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### minimumReadinessScore?

> `optional` **minimumReadinessScore?**: `number`

***

### RunAgentTaskOptions

**`Stable`**

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### adapter

> **adapter**: [`AgentAdapter`](#agentadapter)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### knowledge?

> `optional` **knowledge?**: [`AgentKnowledgeProvider`](#agentknowledgeprovider)

##### onEvent?

> `optional` **onEvent?**: [`AgentRuntimeEventSink`](#agentruntimeeventsink)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### store?

> `optional` **store?**: `TraceStore`

##### signal?

> `optional` **signal?**: `AbortSignal`

##### scenarioId?

> `optional` **scenarioId?**: `string`

##### projectId?

> `optional` **projectId?**: `string`

##### variantId?

> `optional` **variantId?**: `string`

##### minimumReadinessScore?

> `optional` **minimumReadinessScore?**: `number`

***

### AgentTaskRunResult

**`Stable`**

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Properties

##### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

##### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

##### knowledge

> **knowledge**: `KnowledgeReadinessReport`

##### questions

> **questions**: `UserQuestion`[]

##### acquisitionPlans

> **acquisitionPlans**: `DataAcquisitionPlan`[]

##### userAnswers

> **userAnswers**: `Record`\<`string`, `string`\>

##### acquiredEvidenceIds

> **acquiredEvidenceIds**: `string`[]

##### control

> **control**: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>

##### runRecords

> **runRecords**: `RunRecord`[]

***

### KnowledgeReadinessDecision

**`Stable`**

#### Properties

##### passed

> **passed**: `boolean`

##### status

> **status**: `"blocked"` \| `"ready"` \| `"caveat"`

##### reason

> **reason**: `string`

##### readinessScore

> **readinessScore**: `number`

##### recommendedAction

> **recommendedAction**: `KnowledgeRecommendedAction`

##### severity

> **severity**: `ControlSeverity`

##### blockingGapIds

> **blockingGapIds**: `string`[]

##### nonBlockingGapIds

> **nonBlockingGapIds**: `string`[]

## Type Aliases

### RetryableErrorPredicate

> **RetryableErrorPredicate** = (`err`) => `boolean`

Pure judgment of whether an error is worth retrying. Defaults: TimeoutError, AbortError, fetch-level network errors.

#### Parameters

##### err

`unknown`

#### Returns

`boolean`

***

### RetryBackoff

> **RetryBackoff** = `number` \| ((`attempt`) => `number`)

Backoff between attempts. Constant ms, or `(attempt: 1-indexed) => ms`.

***

### PersonaDriver

> **PersonaDriver** = \{ `kind`: `"profile"`; `profile`: `AgentProfile`; \} \| \{ `kind`: `"scripted"`; `turns`: `string`[]; \}

A persona that drives the conversation: either a full driver `AgentProfile`
 (an LLM user-sim) or a deterministic script of user turns (the fast-path).

***

### AuthSource

> **AuthSource** = `"forward-user"` \| `"agent-owned"` \| ((`state`) => `"forward-user"` \| `"agent-owned"`)

**`Stable`**

***

### TurnOrder

> **TurnOrder** = `"alternate"` \| `"round-robin"` \| ((`state`) => `number`)

**`Stable`**

***

### HaltPredicate

> **HaltPredicate** = (`ctx`) => `boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

**`Stable`**

#### Parameters

##### ctx

[`HaltContext`](#haltcontext)

#### Returns

`boolean` \| [`HaltSignal`](#haltsignal) \| `Promise`\<`boolean` \| [`HaltSignal`](#haltsignal)\>

***

### HaltReason

> **HaltReason** = \{ `kind`: `"max_turns"`; `turns`: `number`; \} \| \{ `kind`: `"max_credits"`; `spentCents`: `number`; `capCents`: `number`; \} \| \{ `kind`: `"predicate"`; `reason`: `string`; \} \| \{ `kind`: `"abort"`; \} \| \{ `kind`: `"participant_error"`; `participant`: `string`; `message`: `string`; \}

**`Stable`**

***

### ConversationStreamEvent

> **ConversationStreamEvent** = \{ `type`: `"conversation_start"`; `runId`: `string`; `participants`: readonly `string`[]; `seed`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_start"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `timestamp`: `string`; \} \| \{ `type`: `"turn_text_delta"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"turn_retry"`; `runId`: `string`; `index`: `number`; `speaker`: `string`; `turnId`: `string`; `attempt`: `number`; `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"turn_end"`; `runId`: `string`; `turn`: [`ConversationTurn`](#conversationturn); `timestamp`: `string`; \} \| \{ `type`: `"conversation_end"`; `runId`: `string`; `result`: [`ConversationResult`](#conversationresult); `timestamp`: `string`; \}

**`Stable`**

***

### Verifier

> **Verifier** = (`worktreePath`, `signal?`) => `Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

Verifies the edited worktree. Sync or async; throws only on a setup fault
 (a candidate that fails verification returns `{ok:false}`, it does not
 throw).

#### Parameters

##### worktreePath

`string`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<[`VerifyResult`](#verifyresult)\> \| [`VerifyResult`](#verifyresult)

***

### AgenticGeneratorShotExecution

> **AgenticGeneratorShotExecution** = `Readonly`\<[`CollectedAgentTurn`](runtime.md#collectedagentturn)\>

Runtime's exact terminal turn plus its complete normalized event stream.

***

### AgenticGeneratorShotDisposition

> **AgenticGeneratorShotDisposition** = \{ `kind`: `"clean"`; `worktreePath`: `string`; \} \| \{ `kind`: `"rejected"`; `worktreePath`: `string`; `stage`: `"raw-trace-evidence"` \| `"verification"`; `feedback`: `string` \| `null`; \} \| \{ `kind`: `"kept"`; `worktreePath`: `string`; `score`: `number` \| `null`; `best`: `boolean`; `feedback`: `string` \| `null`; \} \| \{ `kind`: `"accepted"`; `worktreePath`: `string`; `verified`: `boolean`; `restoredFromShot`: `number` \| `null`; \} \| \{ `kind`: `"setup-error"`; `worktreePath`: `string`; `stage`: `"worktree-inspection"` \| `"raw-trace-evidence"` \| `"verification"`; `error`: \{ `name`: `string`; `message`: `string`; \}; \}

Worktree decision emitted before a completed shot is retried, accepted, or
 discarded. The callback runs while `worktreePath` is still available, so
 callers can persist the exact diff.

#### Union Members

##### Type Literal

\{ `kind`: `"clean"`; `worktreePath`: `string`; \}

***

##### Type Literal

\{ `kind`: `"rejected"`; `worktreePath`: `string`; `stage`: `"raw-trace-evidence"` \| `"verification"`; `feedback`: `string` \| `null`; \}

***

##### Type Literal

\{ `kind`: `"kept"`; `worktreePath`: `string`; `score`: `number` \| `null`; `best`: `boolean`; `feedback`: `string` \| `null`; \}

###### kind

> `readonly` **kind**: `"kept"`

The tree passed verification and the verifier asked for another shot,
 so it was snapshotted and the budget continues.

###### worktreePath

> `readonly` **worktreePath**: `string`

###### score

> `readonly` **score**: `number` \| `null`

The rank the verifier gave this tree, or null when it scored nothing.

###### best

> `readonly` **best**: `boolean`

Whether this tree is now the best one this candidate has produced.

###### feedback

> `readonly` **feedback**: `string` \| `null`

***

##### Type Literal

\{ `kind`: `"accepted"`; `worktreePath`: `string`; `verified`: `boolean`; `restoredFromShot`: `number` \| `null`; \}

###### kind

> `readonly` **kind**: `"accepted"`

###### worktreePath

> `readonly` **worktreePath**: `string`

###### verified

> `readonly` **verified**: `boolean`

###### restoredFromShot

> `readonly` **restoredFromShot**: `number` \| `null`

One-based shot whose tree was put back into the worktree because it
 outranked the tree on disk; null when the tree on disk is the one that
 ships. Non-null is the record that best-of-n moved bytes rather than
 only ranking them.

***

##### Type Literal

\{ `kind`: `"setup-error"`; `worktreePath`: `string`; `stage`: `"worktree-inspection"` \| `"raw-trace-evidence"` \| `"verification"`; `error`: \{ `name`: `string`; `message`: `string`; \}; \}

***

### AgenticGeneratorExecutorForWorktree

> **AgenticGeneratorExecutorForWorktree** = (`worktreePath`) => [`ExecutorConfig`](runtime.md#executorconfig)

#### Parameters

##### worktreePath

`string`

#### Returns

[`ExecutorConfig`](runtime.md#executorconfig)

***

### ImproveSurface

> **ImproveSurface** = `Exclude`\<`AgentImprovementSurface`, `"knowledge"`\>

The executable agent lever `improve` optimizes — every surface a proposal can name
(`AgentImprovementSurface`) except `knowledge`, which the corpus lane owns and `improve`
does not produce. Deriving it means every surface `improve` produces can also be reported, which
is the property that lets a result reach a review or a gate.

Profile fields remain portable AgentProfile coordinates; implementation and orchestration files
use the code surface so a winner can be sealed into an exact candidate. `rollout-policy` is the
inference-time structuralRollout dials (`profile.extensions['structural-rollout']`).

***

### ImproveProfileSurface

> **ImproveProfileSurface** = `Exclude`\<[`ImproveSurface`](#improvesurface), `"code"`\>

***

### ImproveMethodFactory

> **ImproveMethodFactory**\<`TScenario`, `TArtifact`\> = (`context`) => `OptimizationMethod`\<`TScenario`, `TArtifact`\>

Build a complete method after trace findings are available.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### context

[`ImproveMethodContext`](#improvemethodcontext)

#### Returns

`OptimizationMethod`\<`TScenario`, `TArtifact`\>

***

### ImproveMethodSource

> **ImproveMethodSource**\<`TScenario`, `TArtifact`\> = `OptimizationMethod`\<`TScenario`, `TArtifact`\> \| [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveProfileAgent

> **ImproveProfileAgent**\<`TScenario`, `TArtifact`\> = (`profile`, `scenario`, `ctx`) => `Promise`\<`TArtifact`\>

Runs one exact materialized profile on one scenario.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### profile

[`ReadonlyAgentProfile`](#readonlyagentprofile)

##### scenario

`TScenario`

##### ctx

`Parameters`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>\[`"dispatchWithSurface"`\]\>\[`2`\]

#### Returns

`Promise`\<`TArtifact`\>

***

### ImproveCandidateValidator

> **ImproveCandidateValidator** = (`input`) => `void`

Accept by returning void synchronously; reject by throwing. Async callbacks are refused.

#### Parameters

##### input

[`ImproveCandidateValidationInput`](#improvecandidatevalidationinput)

#### Returns

`void`

***

### ImproveOptimizationRunOptions

> **ImproveOptimizationRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`NonNullable`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>\[`"optimizationRunOptions"`\]\>, `"dispatchRef"`\>

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

***

### ImproveMethodOptions

> **ImproveMethodOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`CompareOptimizationMethodsOptions`\<`TScenario`, `TArtifact`\>, `"baselineSurface"` \| `"dispatchRef"` \| `"dispatchWithSurface"` \| `"methods"` \| `"optimizationConcurrency"` \| `"optimizationRunOptions"` \| `"searchHistoryPolicy"` \| `"searchHistoryVerification"`\> & `object`

Complete-method configuration for every non-code profile surface.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Type Declaration

##### surface?

> `optional` **surface?**: [`ImproveProfileSurface`](#improveprofilesurface)

Exact profile coordinate optimized by `method`. Default `'prompt'`.

##### executionRef

> **executionRef**: `Sha256Digest`

Immutable digest of `agent`, profile component mapping, models, tools, and
every closure or external setting that can change measured behavior.

##### method

> **method**: [`ImproveMethodSource`](#improvemethodsource)\<`TScenario`, `TArtifact`\>

A complete optimizer or a factory that can incorporate current findings.

##### agent

> **agent**: [`ImproveProfileAgent`](#improveprofileagent)\<`TScenario`, `TArtifact`\>

Runs the exact complete profile materialized from one candidate surface.

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Reject a materialized profile before it reaches the agent callback.

##### findings?

> `optional` **findings?**: `ReadonlyArray`\<`ProposalFinding`\>

Trace or analyst findings available to a method factory.

##### skills?

> `optional` **skills?**: [`ImproveSkillsOptions`](#improveskillsoptions)

Select the exact inline skill document for `surface: 'skills'`.

##### profileComponents?

> `optional` **profileComponents?**: [`ImproveProfileComponents`](#improveprofilecomponents)

Map a profile to named text components and apply the winning components.
Valid only with `surface: 'agent-profile'`.

##### optimizationRunOptions?

> `optional` **optimizationRunOptions?**: [`ImproveOptimizationRunOptions`](#improveoptimizationrunoptions)\<`TScenario`, `TArtifact`\>

Shared settings for method train and selection calls.

##### minimumLift?

> `optional` **minimumLift?**: `number`

Additional lift floor on Eval's deciding interval. Eval must also permit promotion. Default `0`.

##### subject?

> `optional` **subject?**: `string`

What the search improves, recorded as the ledger's subject, for example
`vb/coder`. Default: the profile's name, else `agent-profile`.

***

### ImproveSearchOptions

> **ImproveSearchOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\>, `"method"` \| `"claim"` \| `"confidence"` \| `"evidence"` \| `"finalEvidence"` \| `"resamples"` \| `"reps"` \| `"maxConcurrency"` \| `"optimizationRunOptions"` \| `"agent"`\> & `object`

Improve a profile with `searchMethod`. The search runs on all three splits:
it expands and ranks on train and selection, then claims once on the sealed
test split, and the claim decides. Runtime ships a statistical `ship` only
with complete cost accounting and a test lower bound above `minimumLift`.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Type Declaration

##### method

> **method**: [`ImproveSearchMethod`](#improvesearchmethod)

##### claim

> **claim**: `EvaluationClaim`

The claim the sealed test split decides. `independentUnit` names each
scenario's unit and `minimumEffect` is the improvement the power check
must resolve; both are required.

##### agent

> **agent**: [`ImproveSearchAgent`](#improvesearchagent)\<`TScenario`, `TArtifact`\>

Runs the exact node profile on one scenario. `ctx.search` names the attempt: its lane,
its run id (key remote work by it) and its trace. Throw `SearchEnvironmentFault` when the
environment, not the profile, ended the run; the kernel then runs a fresh attempt.

##### executionRunId?

> `optional` **executionRunId?**: (`artifact`) => `string` \| `null`

Nested execution tree a finished cell's artifact recorded, if it ran an AgentGraph.

###### Parameters

###### artifact

`TArtifact`

###### Returns

`string` \| `null`

##### recordCell?

> `optional` **recordCell?**: (`input`) => `RunRecord` \| `Promise`\<`RunRecord`\>

Build the authoritative RunRecord for a scored passed or failed cell after judging and cost reconciliation,
before the attempt is persisted or its `cell-settled` event is appended.
Eval binds the returned record to the same ledger event. A throw stops the
search; resume reuses the campaign's cached cell before trying again.

###### Parameters

###### input

###### cell

`CampaignCellResult`\<`TArtifact`\>

###### search

[`SearchCellContext`](#searchcellcontext)

###### result

`SearchCellResult`

###### Returns

`RunRecord` \| `Promise`\<`RunRecord`\>

##### workerSlots?

> `optional` **workerSlots?**: [`WorkerSlots`](durable.md#workerslots-2)

Bounds working cells across every search that shares this allocator.

##### budgetPool?

> `optional` **budgetPool?**: [`BudgetPool`](runtime.md#budgetpool)

Fleet dollars shared across searches: a cell on a hard lane holds its lane's `cellUsd`
here before it starts, and waits while open cells could return enough.

##### trace?

> `optional` **trace?**: [`SearchTraceOptions`](#searchtraceoptions)

Where cell spans go. Default: `<search dir>/spans.otlp.jsonl` on filesystem storage.

***

### SearchDispatchContext

> **SearchDispatchContext** = `DispatchContext` & `object`

A campaign dispatch context with the search attempt it runs.

#### Type Declaration

##### search

> `readonly` **search**: [`SearchCellContext`](#searchcellcontext)

***

### ImproveSearchAgent

> **ImproveSearchAgent**\<`TScenario`, `TArtifact`\> = (`profile`, `scenario`, `ctx`) => `Promise`\<`TArtifact`\>

The agent of a native search: the exact node profile on one scenario.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### profile

[`ReadonlyAgentProfile`](#readonlyagentprofile)

##### scenario

`TScenario`

##### ctx

[`SearchDispatchContext`](#searchdispatchcontext)

#### Returns

`Promise`\<`TArtifact`\>

***

### ImproveCodeRunOptions

> **ImproveCodeRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SelfImproveOptions`\<`TScenario`, `TArtifact`\>, `"analyzeGeneration"` \| `"baselineSurface"` \| `"budget"` \| `"findings"` \| `"gate"` \| `"llm"` \| `"method"` \| `"mutationPrimitives"` \| `"proposer"` \| `"proposerTarget"` \| `"selectionScenarios"`\> & `object`

Runtime-owned code search in isolated git worktrees.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Type Declaration

##### surface

> **surface**: `"code"`

##### budget?

> `optional` **budget?**: `Omit`\<`SelfImproveBudget`, `"selectionFraction"`\>

Local code-search budget. Method-only selection controls do not apply.

##### findings?

> `optional` **findings?**: `ReadonlyArray`\<`ProposalFinding`\>

Findings supplied to Runtime's code candidate driver.

##### gate?

> `optional` **gate?**: `"holdout"` \| `"none"`

Gate mode. `'holdout'` (default) runs the held-out promotion gate;
`'none'` is a baseline-only run (`budget.generations = 0`).

##### analyzeGeneration?

> `optional` **analyzeGeneration?**: `SelfImproveOptions`\<`TScenario`, `TArtifact`\>\[`"analyzeGeneration"`\] \| `null`

Per-generation findings producer for Runtime's code search.
Pass your own producer to replace the code-trace distiller; pass `null`
to keep the static findings for every generation.

##### rawTraceContext?

> `optional` **rawTraceContext?**: `boolean`

Feed code candidates paths to prior raw traces instead of a failure digest.
Defaults to true for durable runs and false for in-memory runs.

##### code

> **code**: [`ImproveCodeOptions`](#improvecodeoptions)

Isolated repository and candidate generator settings.

##### promotionGate?

> `optional` **promotionGate?**: `SelfImproveOptions`\<`TScenario`, `TArtifact`\>\[`"gate"`\]

Custom held-back-exam decision. The string `gate` above controls whether
the exam runs; this callback controls how its evidence decides promotion.

***

### ImproveCodeOptions

> **ImproveCodeOptions** = [`ImproveCodeBaseOptions`](#improvecodebaseoptions) & ([`ImproveRuntimeCodeGeneratorOptions`](#improveruntimecodegeneratoroptions) \| [`ImproveCustomCodeGeneratorOptions`](#improvecustomcodegeneratoroptions))

***

### OfficialGepaOptions

> **OfficialGepaOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`GepaOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"` \| `"searchLedger"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Official GEPA configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### OfficialSkillOptOptions

> **OfficialSkillOptOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<`SkillOptOptimizationMethodConfig`\<`TScenario`, `TArtifact`\>, `"background"` \| `"evaluationId"` \| `"searchLedger"`\> & [`OfficialOptimizerContextOptions`](#officialoptimizercontextoptions)

Official SkillOpt configuration plus bounded Runtime findings context.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

***

### ProfileImprovementHarnessTrainOptions

> **ProfileImprovementHarnessTrainOptions** = `Omit`\<[`ImproveTrainingOptions`](#improvetrainingoptions), `"mode"`\>

***

### ProfileImprovementHarnessRunOptions

> **ProfileImprovementHarnessRunOptions**\<`TScenario`, `TArtifact`\> = `Omit`\<[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\>, `"executionRef"` \| `"agent"` \| `"validateCandidate"`\> & `object`

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Type Declaration

##### validateCandidate?

> `optional` **validateCandidate?**: [`ImproveCandidateValidator`](#improvecandidatevalidator)

Override the harness-level validator for this run.

***

### DeepReadonly

> **DeepReadonly**\<`T`\> = `T` *extends* (...`args`) => `unknown` ? `T` : `T` *extends* readonly infer TItem[] ? readonly [`DeepReadonly`](#deepreadonly)\<`TItem`\>[] : `T` *extends* `object` ? `{ readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }` : `T`

#### Type Parameters

##### T

`T`

***

### ReadonlyAgentProfile

> **ReadonlyAgentProfile** = [`DeepReadonly`](#deepreadonly)\<`AgentProfile`\>

Complete immutable profile value used during measured execution.

***

### ReflectiveProposerChat

> **ReflectiveProposerChat** = (`request`) => `Promise`\<[`ReflectiveProposerReply`](#reflectiveproposerreply)\>

One chat completion, made by the caller's client.

#### Parameters

##### request

###### messages

`ReadonlyArray`\<\{ `role`: `"system"` \| `"user"`; `content`: `string`; \}\>

###### maxOutputTokens

`number`

###### callId

`string`

Forward it as the provider's idempotency key, so a retried request is not billed twice.

###### signal

`AbortSignal`

#### Returns

`Promise`\<[`ReflectiveProposerReply`](#reflectiveproposerreply)\>

***

### SearchLaneKind

> **SearchLaneKind** = `"shared-box"` \| `"dedicated"` \| `"subscription"` \| `"router"`

What a lane's slots are.

***

### SearchTraceOptions

> **SearchTraceOptions** = `"off"` \| \{ `otlp`: [`OtelExportConfig`](#otelexportconfig); \}

Where a search's cell spans go. Default: one OpenInference file per search when storage is
 the filesystem. `otlp` gives each attempt its own exporter, so its counts are exact.

***

### TrainingBoundaryResult

> **TrainingBoundaryResult**\<`T`\> = \{ `succeeded`: `true`; `value`: `T`; \} \| \{ `succeeded`: `false`; `reason`: `string`; \}

#### Type Parameters

##### T

`T`

***

### ImproveTrainingResult

> **ImproveTrainingResult** = \{ `mode`: `"training"`; `succeeded`: `true`; `profile`: [`ReadonlyAgentProfile`](#readonlyagentprofile); `profileDigest`: `Sha256Digest`; `receipt`: `AgentTrainingReceipt`; `artifactPath`: `string`; `receiptPath`: `string`; `profilePath`: `string`; \} \| \{ `mode`: `"training"`; `succeeded`: `false`; `stage`: `"admission"` \| `"dataset"` \| `"training"` \| `"checkpoint"` \| `"serving"` \| `"profile"` \| `"persistence"`; `reason`: `string`; `outputDirectory?`: `string`; `servingMayExist`: `boolean`; `trainingMayExist`: `boolean`; `cleanupError?`: `string`; \}

#### Union Members

##### Type Literal

\{ `mode`: `"training"`; `succeeded`: `true`; `profile`: [`ReadonlyAgentProfile`](#readonlyagentprofile); `profileDigest`: `Sha256Digest`; `receipt`: `AgentTrainingReceipt`; `artifactPath`: `string`; `receiptPath`: `string`; `profilePath`: `string`; \}

***

##### Type Literal

\{ `mode`: `"training"`; `succeeded`: `false`; `stage`: `"admission"` \| `"dataset"` \| `"training"` \| `"checkpoint"` \| `"serving"` \| `"profile"` \| `"persistence"`; `reason`: `string`; `outputDirectory?`: `string`; `servingMayExist`: `boolean`; `trainingMayExist`: `boolean`; `cleanupError?`: `string`; \}

###### mode

> **mode**: `"training"`

###### succeeded

> **succeeded**: `false`

###### stage

> **stage**: `"admission"` \| `"dataset"` \| `"training"` \| `"checkpoint"` \| `"serving"` \| `"profile"` \| `"persistence"`

###### reason

> **reason**: `string`

###### outputDirectory?

> `optional` **outputDirectory?**: `string`

Partial artifacts are retained for diagnosis; they are not a runnable profile.

###### servingMayExist

> **servingMayExist**: `boolean`

A serving request began; an interrupted adapter may still own a deployment.

###### trainingMayExist

> **trainingMayExist**: `boolean`

A timed-out managed adapter may still own a remote training job.

###### cleanupError?

> `optional` **cleanupError?**: `string`

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

[`AgentImprovementActivationTransitionInput`](intelligence.md#agentimprovementactivationtransitioninput)

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

[`AgentImprovementActivationTransitionInput`](intelligence.md#agentimprovementactivationtransitioninput)

#### Returns

`Promise`\<`unknown` \| `undefined`\>

***

### KnowledgeReadinessCheckResult

> **KnowledgeReadinessCheckResult** = `boolean` \| \{ `ready`: `boolean`; `summary?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; \}

***

### KnowledgeReadinessCheck

> **KnowledgeReadinessCheck** = (`input`) => `Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

#### Parameters

##### input

[`KnowledgeReadinessCheckInput`](#knowledgereadinesscheckinput)

#### Returns

`Promise`\<[`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)\> \| [`KnowledgeReadinessCheckResult`](#knowledgereadinesscheckresult)

***

### DelegatedLoopRunner

> **DelegatedLoopRunner**\<`T`\> = (`signal`) => `Promise`\<`T`\>

**`Experimental`**

A pre-configured loop for one mode. Returns the mode's raw
 output; the dispatcher wraps it in a `DelegatedLoopResult`.

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### signal

`AbortSignal`

#### Returns

`Promise`\<`T`\>

***

### ChatModelValidation

> **ChatModelValidation** = \{ `succeeded`: `true`; `value`: `string`; \} \| \{ `succeeded`: `false`; `error`: `string`; \}

***

### OtelSpan

> **OtelSpan** = `OtlpSpan`

One OTLP/JSON span: agent-trace-contract's wire type.

***

### OtelAttribute

> **OtelAttribute** = `OtlpKeyValue`

***

### RuntimeHookPhase

> **RuntimeHookPhase** = `"before"` \| `"after"` \| `"error"` \| `"event"`

**`Experimental`**

Runtime hook contracts. Hooks are execution-scoped observers, not part of an
`AgentProfile`: profiles stay portable agent recipes; hooks attach to the
loop or product harness that is running the profile.

A `pursuitId` is deliberately orthogonal to `runId`: a pursuit can span many
resumed/retried/forked runs while every event remains attributable to the
durable objective that caused it. The observer plane is outside the agent
environment and must never be required for agent correctness.

***

### RuntimeHookTarget

> **RuntimeHookTarget** = `"agent.run"` \| `"agent.turn"` \| `"agent.tool_call"` \| `"agent.spawn"` \| `"agent.child"` \| `"agent.plan"` \| `"agent.decision"` \| `string` & `object`

***

### RuntimeRunStatus

> **RuntimeRunStatus** = `"running"` \| `"completed"` \| `"failed"` \| `"cancelled"`

**`Stable`**

***

### RuntimeFailureOwner

> **RuntimeFailureOwner** = [`RuntimeFailureCause`](#runtimefailurecause)\[`"owner"`\]

**`Stable`**

Who must act before the same work can succeed.

- `provider`: the execution provider holds the answer — reconcile the admitted execution, or
  repair the reader or provider that broke its contract.
- `platform`: infrastructure or an upstream model service failed or is out of capacity.
- `runtime`: Runtime could not reconstruct work it owns.
- `work`: the agent's own work failed.
- `caller`: the request, its credential, its budget, its deadline, or its cancellation decided
  the outcome.
- `unknown`: nothing structural attributes the failure.

***

### RuntimeFailureCode

> **RuntimeFailureCode** = [`RuntimeFailureCause`](#runtimefailurecause)\[`"code"`\]

**`Stable`**

Stable failure codes. A consumer branches on these, never on `cause` text.

***

### RuntimeFailureCause

> **RuntimeFailureCause** = `Readonly`\<\{ `code`: `"unknown"` \| `"aborted"` \| `"budget-exhausted"` \| `"provider-contract"` \| `"request-rejected"` \| `"transport"` \| `"nested-recovery"` \| `"deadline-exceeded"` \| `"credential-refused"` \| `"upstream-unavailable"` \| `"retained-unobservable"` \| `"platform"` \| `"work-failed"`; `owner`: `"provider"` \| `"unknown"` \| `"platform"` \| `"runtime"` \| `"work"` \| `"caller"`; `cause`: `string`; `providerCode?`: `string`; `remediation?`: `Readonly`\<\{ `cause`: `"api_key_selected"` \| `"provider_unresolved"` \| `"subscription_unverified"` \| `"not_authenticated"`; `fix`: `string`; `harness`: `string`; `provider`: `string` \| `null`; \}\>; \}\>

**`Stable`**

A terminal failure as values, carried on final and settled events beside their existing
`reason` and `error` fields.

`code` and `owner` are read from the failure's structure — its class, machine code, HTTP status
and cause chain, the caller's signal and deadline, or the settlement's typed fields — never from
message text. `cause` is the redacted, bounded cause chain for people; it is not a contract.

***

### RuntimeStreamEventSink

> **RuntimeStreamEventSink** = (`event`) => `void`

**`Stable`**

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

#### Returns

`void`

***

### AgentTaskStatus

> **AgentTaskStatus** = `"completed"` \| `"blocked"` \| `"failed"` \| `"aborted"`

**`Stable`**

***

### AgentRuntimeEvent

> **AgentRuntimeEvent**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; \} \| \{ `type`: `"control_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; \} \| \{ `type`: `"control_step"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `step`: `ControlStep`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"control_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `control`: `ControlRunResult`\<`TState`, `TAction`, `TActionResult`, `TEval`\>; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; \}

**`Stable`**

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

***

### AgentRuntimeEventSink

> **AgentRuntimeEventSink**\<`TState`, `TAction`, `TActionResult`, `TEval`\> = (`event`) => `Promise`\<`void`\> \| `void`

**`Stable`**

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### event

[`AgentRuntimeEvent`](#agentruntimeevent)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<`void`\> \| `void`

***

### OpenAIChatToolChoice

> **OpenAIChatToolChoice** = `"auto"` \| `"none"` \| `"required"` \| \{ `type`: `"function"`; `function`: \{ `name`: `string`; \}; \}

**`Stable`**

`tool_choice` parameter for OpenAI-compat chat. Same shape as the OpenAI
spec: `'auto'` (default — model decides), `'none'` (disable tool calling
for this turn), `'required'` (force a tool call), or a specific function
pin `{ type: 'function', function: { name } }`.

***

### OpenAIChatResponseFormat

> **OpenAIChatResponseFormat** = \{ `type`: `"text"`; \} \| \{ `type`: `"json_object"`; \} \| \{ `type`: `"json_schema"`; `json_schema`: `Record`\<`string`, `unknown`\>; \}

**`Stable`**

`response_format` parameter for OpenAI-compatible chat endpoints. Use
`json_object` when the caller needs syntactically valid JSON, or
`json_schema` when the upstream provider supports schema-constrained JSON.

***

### RuntimeCanonicalStreamEvent

> **RuntimeCanonicalStreamEvent** = `StreamEvent` & `object`

Agent Interface events that do not belong to Runtime's task vocabulary.

#### Type Declaration

##### task?

> `optional` **task?**: [`AgentTaskSpec`](#agenttaskspec)

##### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

##### timestamp?

> `optional` **timestamp?**: `string`

***

### RuntimeStreamEvent

> **RuntimeStreamEvent** = [`RuntimeCanonicalStreamEvent`](#runtimecanonicalstreamevent) \| \{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \} \| \{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: [`KnowledgeReadinessDecision`](#knowledgereadinessdecision); `timestamp`: `string`; \} \| \{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \} \| \{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \} \| \{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \} \| \{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \} \| \{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \} \| \{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp`: `string`; \} \| \{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \} \| \{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `model`: `string`; `tools?`: readonly `string`[]; `tokensIn?`: `number`; `tokensOut?`: `number`; `tokensKnown?`: `false`; `tokensUnknownReason?`: `string`; `costUsd?`: `number`; `usdKnown?`: `false`; `estimatedCostUsd?`: `number`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \} \| \{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \} \| \{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](runtime.md#backenderrordetail); `failure?`: [`RuntimeFailureCause`](#runtimefailurecause); `timestamp`: `string`; \} \| \{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \} \| \{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](runtime.md#backenderrordetail); `failure?`: [`RuntimeFailureCause`](#runtimefailurecause); `timestamp`: `string`; \}

**`Stable`**

#### Union Members

[`RuntimeCanonicalStreamEvent`](#runtimecanonicalstreamevent)

***

##### Type Literal

\{ `type`: `"task_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"readiness_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `knowledge`: `KnowledgeReadinessReport`; `decision`: [`KnowledgeReadinessDecision`](#knowledgereadinessdecision); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"questions_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"questions_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `questions`: `UserQuestion`[]; `userAnswers`: `Record`\<`string`, `string`\>; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"acquisition_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"acquisition_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `acquisitionPlans`: `DataAcquisitionPlan`[]; `acquiredEvidenceIds`: `string`[]; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"session_created"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"session_resumed"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_start"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp`: `string`; \}

###### type

> **type**: `"backend_start"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session

> **session**: [`RuntimeSession`](#runtimesession)

###### backend

> **backend**: `string`

###### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

Canonical execution identity and materialization evidence for this turn, when Runtime
 owns the selected executor. Generic metadata keeps the event vocabulary open while the
 values use Runtime's existing identity/materialization receipt shapes.

###### timestamp

> **timestamp**: `string`

***

##### Type Literal

\{ `type`: `"text_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"reasoning_delta"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `text`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `args?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"tool_result"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `toolName`: `string`; `toolCallId?`: `string`; `result?`: `unknown`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"llm_call"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `model`: `string`; `tools?`: readonly `string`[]; `tokensIn?`: `number`; `tokensOut?`: `number`; `tokensKnown?`: `false`; `tokensUnknownReason?`: `string`; `costUsd?`: `number`; `usdKnown?`: `false`; `estimatedCostUsd?`: `number`; `promptCache?`: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>; `latencyMs?`: `number`; `finishReason?`: `string`; `timestamp?`: `string`; \}

###### type

> **type**: `"llm_call"`

###### task?

> `optional` **task?**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

###### model

> **model**: `string`

###### tools?

> `optional` **tools?**: readonly `string`[]

The tool names offered to the model this turn, when the caller knows its own offered
 set (e.g. the in-process tool loop's `ToolSpec[]`). Exported as the OTel GenAI
 `gen_ai.tool.definitions` attribute — a contract gate reads this to tell "the model was
 offered no tools" from "the offered set was never recorded", the same distinction
 Claude Code's own `init` record gives a stream-json capture. Absent when the producer
 does not know its own offered set (e.g. a sandboxed CLI harness, whose tool list is the
 harness's own and belongs to its own transcript reader instead).

###### tokensIn?

> `optional` **tokensIn?**: `number`

###### tokensOut?

> `optional` **tokensOut?**: `number`

###### tokensKnown?

> `optional` **tokensKnown?**: `false`

False when the numeric token subtotal is incomplete or absent.

###### tokensUnknownReason?

> `optional` **tokensUnknownReason?**: `string`

Why `tokensKnown` is false when a harness receipt was present but unreadable.

###### costUsd?

> `optional` **costUsd?**: `number`

###### usdKnown?

> `optional` **usdKnown?**: `false`

False when `costUsd` is only an observed floor, estimate, or absent.

###### estimatedCostUsd?

> `optional` **estimatedCostUsd?**: `number`

Separately-labelled local/catalog estimate; never billed spend.

###### promptCache?

> `optional` **promptCache?**: `Readonly`\<`Record`\<`string`, `number` \| `string`\>\>

Provider-reported prompt-cache fields; absent fields remain unknown.

###### latencyMs?

> `optional` **latencyMs?**: `number`

###### finishReason?

> `optional` **finishReason?**: `string`

###### timestamp?

> `optional` **timestamp?**: `string`

***

##### Type Literal

\{ `type`: `"artifact"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `artifactId`: `string`; `name?`: `string`; `mimeType?`: `string`; `uri?`: `string`; `content?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"proposal_created"`; `task?`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `proposalId`: `string`; `title`: `string`; `status?`: `"pending"` \| `"approved"` \| `"rejected"`; `content?`: `string`; `timestamp?`: `string`; \}

***

##### Type Literal

\{ `type`: `"backend_error"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `message`: `string`; `recoverable`: `boolean`; `error?`: [`BackendErrorDetail`](runtime.md#backenderrordetail); `failure?`: [`RuntimeFailureCause`](#runtimefailurecause); `timestamp`: `string`; \}

###### type

> **type**: `"backend_error"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

###### backend

> **backend**: `string`

###### message

> **message**: `string`

###### recoverable

> **recoverable**: `boolean`

###### error?

> `optional` **error?**: [`BackendErrorDetail`](runtime.md#backenderrordetail)

Typed transport diagnostic. Present when the upstream returned a
non-success HTTP status or every retry attempt threw. Consumers MUST
surface this onto their `RunRecord.error` — silently treating a
`backend_error` as "no output" hides credit exhaustion, auth failure,
and upstream outages from operators.
 - `kind: 'transport'` — HTTP / network failure with optional `status`
   + truncated response `body`.
 - `kind: 'backend'` — the backend's `stream()` generator threw for a
   reason that isn't a recognized transport failure.

###### failure?

> `optional` **failure?**: [`RuntimeFailureCause`](#runtimefailurecause)

The same failure as values: branch on `code` and `owner`, never on `message`.

###### timestamp

> **timestamp**: `string`

***

##### Type Literal

\{ `type`: `"backend_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session`: [`RuntimeSession`](#runtimesession); `backend`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"task_end"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `timestamp`: `string`; \}

***

##### Type Literal

\{ `type`: `"final"`; `task`: [`AgentTaskSpec`](#agenttaskspec); `session?`: [`RuntimeSession`](#runtimesession); `status`: [`AgentTaskStatus`](#agenttaskstatus); `reason`: `string`; `text?`: `string`; `metadata?`: `Record`\<`string`, `unknown`\>; `error?`: [`BackendErrorDetail`](runtime.md#backenderrordetail); `failure?`: [`RuntimeFailureCause`](#runtimefailurecause); `timestamp`: `string`; \}

###### type

> **type**: `"final"`

###### task

> **task**: [`AgentTaskSpec`](#agenttaskspec)

###### session?

> `optional` **session?**: [`RuntimeSession`](#runtimesession)

###### status

> **status**: [`AgentTaskStatus`](#agenttaskstatus)

###### reason

> **reason**: `string`

###### text?

> `optional` **text?**: `string`

###### metadata?

> `optional` **metadata?**: `Record`\<`string`, `unknown`\>

###### error?

> `optional` **error?**: [`BackendErrorDetail`](runtime.md#backenderrordetail)

Typed terminal-error diagnostic. Mirrors the `backend_error.error`
shape so a consumer that only listens for `final` still receives a
loud, structured failure when the backend never produced output. Only
set when `status !== 'completed'`. Consumers building a `RunRecord`
MUST map this to `RunRecord.error` rather than recording silent
`error: null` with empty `finalText`.

###### failure?

> `optional` **failure?**: [`RuntimeFailureCause`](#runtimefailurecause)

The terminal failure as values — a stable `code`, the `owner` who must act, and redacted
`cause` text. `runAgentTaskStream` and `streamAgentTurn` set it on every failed or aborted
final, including a failure the Sandbox reported without throwing; consumers branch on it
instead of matching `reason` or `error.message` text.

###### timestamp

> **timestamp**: `string`

## Variables

### optimizerMethod

> `const` **optimizerMethod**: `string`

The shared method block every build/author prompt embeds. Domain framing
(what a tool/MCP/codebase-edit deliverable looks like) wraps around it; this
is the process itself.

***

### DEFAULT\_ROUTER\_BASE\_URL

> `const` **DEFAULT\_ROUTER\_BASE\_URL**: `"https://router.tangle.tools"` = `'https://router.tangle.tools'`

Default Tangle Router base URL used when no env override is set.

***

### ROUTER\_PRICE\_SOURCE

> `const` **ROUTER\_PRICE\_SOURCE**: `object`

The Router catalog file and commit these prices were copied from.

#### Type Declaration

##### repository

> `readonly` **repository**: `"tangle-network/tangle-router"` = `'tangle-network/tangle-router'`

##### path

> `readonly` **path**: `"pricing/researched-provider-prices.json"` = `'pricing/researched-provider-prices.json'`

##### commit

> `readonly` **commit**: `"e3445f270eba5234a2f7e85dda1a88743c20f322"` = `'e3445f270eba5234a2f7e85dda1a88743c20f322'`

***

### isolatedCheckBoxEvidenceSchema

> `const` **isolatedCheckBoxEvidenceSchema**: `ZodType`\<[`IsolatedCheckBoxEvidence`](runtime.md#isolatedcheckboxevidence)\>

Decode the existing execution contract without widening or reinterpreting its evidence.

***

### isolatedCheckResultSchema

> `const` **isolatedCheckResultSchema**: `ZodType`\<[`IsolatedCheckResult`](runtime.md#isolatedcheckresult)\>

Execution evidence, not a verdict about task correctness or permission to execute again.

## Functions

### createIterableBackend()

> **createIterableBackend**\<`TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

**`Stable`**

Wrap any custom async-iterable stream into a typed `AgentExecutionBackend`.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### kind

`string`

###### start?

(`input`, `context`) => [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### resume?

(`session`, `input`, `context`) => [`RuntimeSession`](#runtimesession) \| `Promise`\<[`RuntimeSession`](#runtimesession)\>

###### stream

(`input`, `context`) => `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

###### stop?

(`session`, `reason`) => `void` \| `Promise`\<`void`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### createSandboxPromptBackend()

> **createSandboxPromptBackend**\<`TBox`, `TInput`\>(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

**`Stable`**

Build an `AgentExecutionBackend` backed by a sandbox/sidecar `streamPrompt` call.

#### Type Parameters

##### TBox

`TBox`

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

###### kind?

`string`

###### getBox

(`input`, `context`) => `TBox` \| `Promise`\<`TBox`\>

###### streamPrompt

(`box`, `message`, `context`) => `AsyncIterable`\<`unknown`\>

###### mapEvent?

(`event`, `context`) => [`RuntimeStreamEvent`](#runtimestreamevent) \| `undefined`

###### getSessionId?

(`box`, `input`) => `string` \| `undefined`

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)\<`TInput`\>

***

### createConversationBackend()

> **createConversationBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

Adapt a multi-participant conversation into the standard execution backend contract.

#### Parameters

##### options

###### conversation

[`Conversation`](#conversation)

###### kind?

`string`

Optional backend kind label. Defaults to `'conversation'`.

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

***

### runConversation()

> **runConversation**(`conversation`, `options`): `Promise`\<[`ConversationResult`](#conversationresult)\>

Run a conversation to completion and return its terminal result.

#### Parameters

##### conversation

[`Conversation`](#conversation)

##### options

[`RunConversationOptions`](#runconversationoptions)

#### Returns

`Promise`\<[`ConversationResult`](#conversationresult)\>

***

### runConversationStream()

> **runConversationStream**(`conversation`, `options`): `AsyncIterable`\<[`ConversationStreamEvent`](#conversationstreamevent)\>

Streaming conversation orchestrator: drives N participants in turn through their own backends, enforcing `maxTurns` / `maxCreditsCents` / `haltOn`, yielding per-event stream markers.

#### Parameters

##### conversation

[`Conversation`](#conversation)

##### options

[`RunConversationOptions`](#runconversationoptions)

#### Returns

`AsyncIterable`\<[`ConversationStreamEvent`](#conversationstreamevent)\>

***

### runPersonaConversation()

> **runPersonaConversation**(`opts`): `Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

Run one worker profile against one persona as a multi-round conversation.
The persona leads (participant 0): it speaks, the worker answers, repeat,
until `maxTurns`. Returns the persistent transcript + worker-only usage.

#### Parameters

##### opts

[`RunPersonaConversationOptions`](#runpersonaconversationoptions)

#### Returns

`Promise`\<[`PersonaConversationResult`](#personaconversationresult)\>

***

### runPersonaDispatch()

> **runPersonaDispatch**\<`TScenario`, `TArtifact`\>(`config`): `ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

Wrap [runPersonaConversation](#runpersonaconversation) as a `ProfileDispatchFn` for
`runProfileMatrix`: the profile axis is the worker-under-test, the scenario
axis is the persona, and the runner is the cell. Meters the worker through
`ctx.cost` so the matrix's backend-integrity guard sees real usage.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### config

[`RunPersonaConfig`](#runpersonaconfig)\<`TScenario`, `TArtifact`\>

#### Returns

`ProfileDispatchFn`\<`TScenario`, `TArtifact`\>

***

### agenticGenerator()

> **agenticGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Full-agentic `CandidateGenerator`: run an exact profiled author inside the existing candidate worktree.

#### Parameters

##### opts

[`AgenticGeneratorOptions`](#agenticgeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### commandVerifier()

> **commandVerifier**(`command`, `args?`, `timeoutMs?`): [`Verifier`](#verifier)

A `Verifier` that runs a command in the worktree: exit 0 ⇒ ok, any other
 exit ⇒ failed with stdout+stderr as feedback. The common case — verify by
 `tsc --noEmit`, `pnpm build`, or a test command. A timeout is treated as a
 FAILED candidate (a change that hangs the build is a bad change); a missing
 binary or spawn fault throws (a setup bug, not a failed candidate — no
 silent fallback).

#### Parameters

##### command

`string`

##### args?

`string`[] = `[]`

##### timeoutMs?

`number` = `300_000`

#### Returns

[`Verifier`](#verifier)

***

### improve()

#### Call Signature

> **improve**(`profile`, `opts`): `Promise`\<[`ImproveTrainingResult`](#improvetrainingresult)\>

Train and serve a checkpoint without implying that it improved held-out quality.

##### Parameters

###### profile

\{ \}

###### opts

[`ImproveTrainingOptions`](#improvetrainingoptions)

##### Returns

`Promise`\<[`ImproveTrainingResult`](#improvetrainingresult)\>

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `opts`): `Promise`\<[`ImproveSearchResult`](#improvesearchresult)\>

Search one exact profile surface with Runtime's native search
(`method: searchMethod(...)`): the kernel expands, allocates and claims on
the sealed test split, and the claim decides.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

###### TArtifact

`TArtifact`

##### Parameters

###### profile

\{ \}

###### opts

[`ImproveSearchOptions`](#improvesearchoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveSearchResult`](#improvesearchresult)\>

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `opts`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

Optimize one exact profile surface with a complete method.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

###### TArtifact

`TArtifact`

##### Parameters

###### profile

\{ \}

###### opts

[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveMethodResult`](#improvemethodresult)\>

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`profile`, `opts`): `Promise`\<[`ImproveMethodResult`](#improvemethodresult) \| [`ImproveSearchResult`](#improvesearchresult)\>

Optimize one exact profile surface with a complete method or a search.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

###### TArtifact

`TArtifact`

##### Parameters

###### profile

\{ \}

###### opts

[`ImproveMethodOptions`](#improvemethodoptions)\<`TScenario`, `TArtifact`\> \| [`ImproveSearchOptions`](#improvesearchoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveMethodResult`](#improvemethodresult) \| [`ImproveSearchResult`](#improvesearchresult)\>

#### Call Signature

> **improve**\<`TScenario`, `TArtifact`\>(`opts`): `Promise`\<[`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>\>

Optimize repository code through Runtime's isolated worktree path.

##### Type Parameters

###### TScenario

`TScenario` *extends* `Scenario`

###### TArtifact

`TArtifact`

##### Parameters

###### opts

[`ImproveCodeRunOptions`](#improvecoderunoptions)\<`TScenario`, `TArtifact`\>

##### Returns

`Promise`\<[`ImproveCodeResult`](#improvecoderesult)\<`TScenario`, `TArtifact`\>\>

***

### officialGepa()

> **officialGepa**\<`TScenario`, `TArtifact`\>(`options`): [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

Build a complete method backed by GEPA's official Optimize Anything API.

The recipe is passed through unchanged. Use `engine`, `sequential`,
`adaptive-sequential`, `best-of`, `vote`, or `omni` explicitly.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

#### Parameters

##### options

[`OfficialGepaOptions`](#officialgepaoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

***

### officialSkillOpt()

> **officialSkillOpt**\<`TScenario`, `TArtifact`\>(`options`): [`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

Build a complete method backed by Microsoft's official SkillOpt trainer.

#### Type Parameters

##### TScenario

`TScenario` *extends* `object`

##### TArtifact

`TArtifact` = `unknown`

#### Parameters

##### options

[`OfficialSkillOptOptions`](#officialskilloptoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ImproveMethodFactory`](#improvemethodfactory)\<`TScenario`, `TArtifact`\>

***

### createProfileImprovementHarness()

> **createProfileImprovementHarness**\<`TScenario`, `TArtifact`\>(`options`): [`ProfileImprovementHarness`](#profileimprovementharness)\<`TScenario`, `TArtifact`\>

Bind one exact profile and executor into a repeatable self-improvement
harness. The returned `run` method remains generic over every existing
profile surface, optimization method, split, gate, and budget option.

#### Type Parameters

##### TScenario

`TScenario` *extends* `Scenario`

##### TArtifact

`TArtifact`

#### Parameters

##### options

[`CreateProfileImprovementHarnessOptions`](#createprofileimprovementharnessoptions)\<`TScenario`, `TArtifact`\>

#### Returns

[`ProfileImprovementHarness`](#profileimprovementharness)\<`TScenario`, `TArtifact`\>

***

### reflectiveGenerator()

> **reflectiveGenerator**(`opts`): [`CandidateGenerator`](#candidategenerator)

Cheap no-sandbox `CandidateGenerator` (the `shots=1` setting): draft surface edits via the improvement adapter and apply them as one coherent candidate.

#### Parameters

##### opts

[`ReflectiveGeneratorOptions`](#reflectivegeneratoroptions)

#### Returns

[`CandidateGenerator`](#candidategenerator)

***

### reflectiveProfileProposer()

> **reflectiveProfileProposer**(`options`): `SurfaceProposer`\<`ProposalFinding`\>

Build the maintained reflective proposer for a profile text surface.

#### Parameters

##### options

[`ReflectiveProfileProposerOptions`](#reflectiveprofileproposeroptions)

#### Returns

`SurfaceProposer`\<`ProposalFinding`\>

***

### decideSearchImprovement()

> **decideSearchImprovement**(`options`): `Promise`\<[`SearchImprovementDecision`](#searchimprovementdecision)\>

Decide a closed search from its directory, under the current ship rule, with
no model call: the claim verified from the ledger, the cost from its cost
ledger, and the promotion when it ships. Use it to cite a finished search as
a registry promotion, or to re-decide one that an earlier rule held.

#### Parameters

##### options

[`DecideSearchImprovementOptions`](#decidesearchimprovementoptions)

#### Returns

`Promise`\<[`SearchImprovementDecision`](#searchimprovementdecision)\>

***

### sharedBoxLane()

> **sharedBoxLane**(`options`): [`SharedBoxSearchLane`](#sharedboxsearchlane)

Cells as workers packed into shared Sandbox boxes, `workersPerBox` to a box.

Capacity is `boxes × workersPerBox`. The workers of one box share its router key, which caps
no single worker, so the lane holds an estimate (`cellUsd` is the prior until 20 cells settle).
A profile the placement refuses (a repository writer, a replaced system prompt, MCP servers,
hooks, subagents, tool grants) needs another lane. The agent reaches the box through
`lane.placement.providerFor({ nodeId: ctx.search.runId })`, which names the attempt to the
router on every call.

#### Parameters

##### options

[`SharedBoxPlacementOptions`](runtime.md#sharedboxplacementoptions) & [`SearchLaneOptions`](#searchlaneoptions) & `object`

#### Returns

[`SharedBoxSearchLane`](#sharedboxsearchlane)

***

### dedicatedLane()

> **dedicatedLane**(`options`): [`SearchLane`](#searchlane)

Cells that each run in their own environment, `capacity` at once. The lane cannot bound a
cell's dollars, so it holds an estimate: `cellUsd` until 20 cells settle, then 1.5 × the p99
of its settled cells.

#### Parameters

##### options

[`SearchLaneOptions`](#searchlaneoptions) & `object`

#### Returns

[`SearchLane`](#searchlane)

***

### subscriptionLane()

> **subscriptionLane**(`options`): [`SearchLane`](#searchlane)

Cells on subscription seats, one cell a seat. A seat charges no dollar per call, so its own
work costs $0 and reports no tokens. `cellUsd` bounds the cell's priced calls, such as its
judges; every one of them must declare a maximum, and the lane refuses a call past it.

#### Parameters

##### options

[`SearchLaneOptions`](#searchlaneoptions) & `object`

#### Returns

[`SearchLane`](#searchlane)

***

### routerLane()

> **routerLane**(`options`): [`SearchLane`](#searchlane)

Cells whose model calls are priced router calls, `capacity` at once. Every paid call of a
cell must declare its maximum charge, and the lane refuses a call that would take the cell
past `cellUsd`, so `cellUsd` is each cell's hard maximum.

#### Parameters

##### options

[`SearchLaneOptions`](#searchlaneoptions) & `object`

#### Returns

[`SearchLane`](#searchlane)

***

### searchMethod()

> **searchMethod**(`options`): [`ImproveSearchMethod`](#improvesearchmethod)

Build Runtime's native search for `improve(profile, { method })`.

#### Parameters

##### options

[`SearchMethodOptions`](#searchmethodoptions)

#### Returns

[`ImproveSearchMethod`](#improvesearchmethod)

***

### createCommandProfileTrainer()

> **createCommandProfileTrainer**(`input`): [`ProfileTrainer`](#profiletrainer)

Execute one pinned command without a shell, in the runtime-owned job directory. POSIX only.

#### Parameters

##### input

[`ControlledTrainingCommand`](#controlledtrainingcommand)

#### Returns

[`ProfileTrainer`](#profiletrainer)

***

### createKnowledgeImprovementActivationExecutor()

> **createKnowledgeImprovementActivationExecutor**(`options`): [`KnowledgeImprovementActivationExecutor`](#knowledgeimprovementactivationexecutor)

Apply or restore one local knowledge candidate through the shared activation contract.

#### Parameters

##### options

[`CreateKnowledgeImprovementActivationExecutorOptions`](#createknowledgeimprovementactivationexecutoroptions)

#### Returns

[`KnowledgeImprovementActivationExecutor`](#knowledgeimprovementactivationexecutor)

***

### runKnowledgeImprovementJob()

> **runKnowledgeImprovementJob**(`options`): `Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

Produce a frozen KB candidate while leaving live knowledge content unchanged.

#### Parameters

##### options

[`RunKnowledgeImprovementJobOptions`](#runknowledgeimprovementjoboptions)

#### Returns

`Promise`\<[`KnowledgeImprovementJobResult`](#knowledgeimprovementjobresult)\>

***

### buildKnowledgeImprovementExperimentBundles()

> **buildKnowledgeImprovementExperimentBundles**(`bundle`, `knowledge`): [`KnowledgeImprovementExperimentBundles`](#knowledgeimprovementexperimentbundles)

Attach both frozen knowledge inputs to one otherwise-identical bundle pair.

#### Parameters

##### bundle

`AgentCandidateBundle`

##### knowledge

[`KnowledgeImprovementCandidatePair`](#knowledgeimprovementcandidatepair)

#### Returns

[`KnowledgeImprovementExperimentBundles`](#knowledgeimprovementexperimentbundles)

***

### auditLoopRunner()

> **auditLoopRunner**\<`TProposal`, `TEdit`\>(`options`): [`DelegatedLoopRunner`](#delegatedlooprunner)\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

**`Experimental`**

`audit` mode — analyst loop over captured trace/run data.

#### Type Parameters

##### TProposal

`TProposal` = `unknown`

##### TEdit

`TEdit` = `unknown`

#### Parameters

##### options

[`RunAnalystLoopOpts`](analyst-loop.md#runanalystloopopts)

#### Returns

[`DelegatedLoopRunner`](#delegatedlooprunner)\<[`RunAnalystLoopResult`](analyst-loop.md#runanalystloopresult)\<`TProposal`, `TEdit`\>\>

***

### resolveRouterBaseUrl()

> **resolveRouterBaseUrl**(`env?`): `string`

Resolve the router base URL from env, normalised — no trailing `/v1` or `/`.

#### Parameters

##### env?

[`RouterEnv`](#routerenv) = `{}`

#### Returns

`string`

***

### getModels()

> **getModels**(`routerBaseUrl?`): `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Fetch the model catalog from the router's `/v1/models`. Throws on a non-2xx
response — callers decide whether to fail open (empty catalog) or closed.

#### Parameters

##### routerBaseUrl?

`string` = `DEFAULT_ROUTER_BASE_URL`

#### Returns

`Promise`\<[`ModelInfo`](#modelinfo)[]\>

***

### cleanModelId()

> **cleanModelId**(`value`): `string` \| `undefined`

Trim a candidate model id; `undefined` for non-strings and blanks.

#### Parameters

##### value

`unknown`

#### Returns

`string` \| `undefined`

***

### resolveChatModel()

> **resolveChatModel**(`candidates`, `fallback`): [`ResolvedChatModel`](#resolvedchatmodel)

Resolve a chat model by precedence: the first candidate carrying a
non-blank model wins, else `fallback`. The caller owns the precedence
order, so each product keeps its own policy (request → workspace → env,
etc.) while the first-non-blank logic and the telemetry shape stay shared.

#### Parameters

##### candidates

[`ChatModelCandidate`](#chatmodelcandidate)[]

##### fallback

[`ResolvedChatModel`](#resolvedchatmodel)

#### Returns

[`ResolvedChatModel`](#resolvedchatmodel)

***

### validateChatModelId()

> **validateChatModelId**(`modelId`, `options?`): `Promise`\<[`ChatModelValidation`](#chatmodelvalidation)\>

Validate a caller-supplied chat-model id. Rejects non-strings, malformed
ids, and ids absent from both the caller's `allowlist` and the live router
catalog. Fails closed: when the catalog cannot be fetched, an unverifiable
id is rejected rather than admitted — a bad model never reaches the agent.

#### Parameters

##### modelId

`unknown`

##### options?

###### allowlist?

`string`[]

Known-good ids that skip the catalog round trip — e.g. the product's
default model plus any env-configured ids.

###### routerBaseUrl?

`string`

###### loadModels?

(`routerBaseUrl`) => `Promise`\<[`ModelInfo`](#modelinfo)[]\>

Injectable catalog loader — overridden in tests.

#### Returns

`Promise`\<[`ChatModelValidation`](#chatmodelvalidation)\>

***

### createOtelExporter()

> **createOtelExporter**(`config?`): [`OtelExporter`](#otelexporter) \| `undefined`

Create an OTLP/HTTP exporter. Returns undefined when no endpoint is configured.

One batch is in flight at a time; spans that arrive meanwhile wait in a queue bounded by
`maxQueueSize`. Every span ends in exactly one of `written` or `dropped`: a non-2xx response, a
network error, a timeout, an OTLP `partialSuccess.rejectedSpans` count and a full queue each count
as drops and set `lastError`. Nothing here throws into the caller's run; `flush()` reports the
loss, the same rule `createOpenInferenceFileExporter` follows.

#### Parameters

##### config?

[`OtelExportConfig`](#otelexportconfig)

#### Returns

[`OtelExporter`](#otelexporter) \| `undefined`

***

### loopEventToOtelSpan()

> **loopEventToOtelSpan**(`event`, `traceId`, `parentSpanId?`): `OtlpSpan`

Convert a LoopTraceEvent into an OtelSpan for export.

#### Parameters

##### event

###### kind

`string`

###### runId

`string`

###### timestamp

`number`

###### payload

`object`

##### traceId

`string`

##### parentSpanId?

`string`

#### Returns

`OtlpSpan`

***

### buildLoopOtelSpans()

> **buildLoopOtelSpans**(`events`, `traceId`, `rootParentSpanId?`, `redact?`): `OtlpSpan`[]

Build a nested, real-duration OTLP span tree for ONE loop run from its full
ordered `LoopTraceEvent` stream. Unlike `loopEventToOtelSpan` (one flat,
zero-duration span per event), this reconstructs the topology hierarchy a
GenAI trace viewer renders natively:

  loop (invoke_workflow)
    └─ loop.round[k] (invoke_workflow)   ← tangle.loop.move.{kind,width,rationale}
         ├─ loop.iteration[i] (invoke_agent)  ← gen_ai.agent.name + usage + verdict + placement
         └─ …

Attributes follow the current GenAI semconv (`gen_ai.*`) where they apply and
a namespaced `tangle.loop.*` / `tangle.cost.usd` extension for topology /
verdict / placement / cost (not yet standardized). Pure: feed it a buffered
per-runId event array (e.g. flushed on `loop.ended`) and export the result.

#### Parameters

##### events

readonly `object`[]

##### traceId

`string`

##### rootParentSpanId?

`string`

##### redact?

(`value`) => `unknown`

#### Returns

`OtlpSpan`[]

***

### priceTokens()

> **priceTokens**(`work`): `number` \| `undefined`

What the Router would charge for this work at the model's base rates, or undefined when it
prices no such model or a count is not a non-negative number. Cache reads and writes bill at
their own rates when the Router lists them. A per-request tier (some models charge more past a
prompt size) is not applied: a run total does not keep each request's prompt size.

#### Parameters

##### work

[`TokenWork`](#tokenwork)

#### Returns

`number` \| `undefined`

***

### decideKnowledgeReadiness()

> **decideKnowledgeReadiness**(`report`, `options?`): [`KnowledgeReadinessDecision`](#knowledgereadinessdecision)

**`Stable`**

Map a `KnowledgeReadinessReport` to a three-state branch (`ready` / `blocked` / `caveat`) the runtime, route handlers, and UI shells all switch on.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

###### minimumScore?

`number`

#### Returns

[`KnowledgeReadinessDecision`](#knowledgereadinessdecision)

***

### runAgentTask()

> **runAgentTask**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`options`): `Promise`\<[`AgentTaskRunResult`](#agenttaskrunresult)\<`TState`, `TAction`, `TActionResult`, `TEval`\>\>

**`Stable`**

Single-shot task lifecycle for adapter-driven tasks: readiness-gated, emits the runtime lifecycle event vocabulary, session-store pluggable.

#### Type Parameters

##### TState

`TState`

##### TAction

`TAction`

##### TActionResult

`TActionResult`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### options

[`RunAgentTaskOptions`](#runagenttaskoptions)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

#### Returns

`Promise`\<[`AgentTaskRunResult`](#agenttaskrunresult)\<`TState`, `TAction`, `TActionResult`, `TEval`\>\>

***

### runAgentTaskStream()

> **runAgentTaskStream**\<`TInput`\>(`options`): `AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

**`Stable`**

Streaming task lifecycle: delegates execution to an `AgentExecutionBackend` (model API, sandbox, or custom iterable) and yields lifecycle events as they happen.

#### Type Parameters

##### TInput

`TInput` *extends* [`AgentBackendInput`](#agentbackendinput) = [`AgentBackendInput`](#agentbackendinput)

#### Parameters

##### options

[`RunAgentTaskStreamOptions`](#runagenttaskstreamoptions)\<`TInput`\>

#### Returns

`AsyncIterable`\<[`RuntimeStreamEvent`](#runtimestreamevent)\>

***

### defineRuntimeHooks()

> **defineRuntimeHooks**(`hooks`): [`RuntimeHooks`](#runtimehooks)

Identity helper that types a [RuntimeHooks](#runtimehooks) literal so the fields are inferred.

#### Parameters

##### hooks

[`RuntimeHooks`](#runtimehooks)

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### composeRuntimeHooks()

> **composeRuntimeHooks**(...`entries`): [`RuntimeHooks`](#runtimehooks)

Merge several [RuntimeHooks](#runtimehooks) into one. Falsy entries are dropped (so you can
pass `flag && hooks`), and every observer's `onEvent`/`onDecisionPoint` fires for each
event. Use this to attach N observers to a loop instead of a second event bus.

#### Parameters

##### entries

...(`false` \| [`RuntimeHooks`](#runtimehooks) \| `null` \| `undefined`)[]

#### Returns

[`RuntimeHooks`](#runtimehooks)

***

### startRuntimeRun()

> **startRuntimeRun**(`options`): [`RuntimeRunHandle`](#runtimerunhandle)

**`Stable`**

Construct a runtime-run handle. The returned handle is mutable across its
lifetime; consumers should not share it across requests.

#### Parameters

##### options

[`RuntimeRunOptions`](#runtimerunoptions)

#### Returns

[`RuntimeRunHandle`](#runtimerunhandle)

***

### createProfileExecutionBackend()

> **createProfileExecutionBackend**(`options`): [`AgentExecutionBackend`](#agentexecutionbackend)

**`Stable`**

Bind one exact profile and Runtime executor to the stable `AgentExecutionBackend` contract used
by `runAgentTaskStream` and conversations.

Runtime still owns the model call through `streamAgentTurn`.
The adapter only translates the two stream protocols and carries the caller's request headers
into `ExecutorContext` so an HTTP executor can preserve authorization, recursion depth, and
trace identity.

#### Parameters

##### options

###### profile

`AgentProfile`

###### executor

[`ExecutorFactory`](runtime.md#executorfactory-1)\<`unknown`\>

#### Returns

[`AgentExecutionBackend`](#agentexecutionbackend)

***

### sanitizeKnowledgeReadinessReport()

> **sanitizeKnowledgeReadinessReport**(`report`, `options?`): [`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

**`Stable`**

Strip PII and large blobs from a `KnowledgeReadinessReport` for safe telemetry emission.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`SanitizedKnowledgeReadinessReport`](#sanitizedknowledgereadinessreport)

***

### createRuntimeEventCollector()

> **createRuntimeEventCollector**\<`TState`, `TAction`, `TActionResult`, `TEval`\>(`options?`): [`RuntimeEventCollector`](#runtimeeventcollector)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

**`Stable`**

Build an in-memory collector that sanitizes and accumulates `AgentRuntimeEvent`s for inspection.

#### Type Parameters

##### TState

`TState` = `unknown`

##### TAction

`TAction` = `unknown`

##### TActionResult

`TActionResult` = `unknown`

##### TEval

`TEval` *extends* `ControlEvalResult` = `ControlEvalResult`

#### Parameters

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`RuntimeEventCollector`](#runtimeeventcollector)\<`TState`, `TAction`, `TActionResult`, `TEval`\>

***

### createRuntimeStreamEventCollector()

> **createRuntimeStreamEventCollector**(`options?`): [`RuntimeStreamEventCollector`](#runtimestreameventcollector)

**`Stable`**

Streaming-event counterpart of `createRuntimeEventCollector`. Pass each
event yielded by `runAgentTaskStream` through `onEvent` and read the
sanitized copies off `events`; the same `RuntimeTelemetryOptions` redaction
flags apply. Kept distinct from `createRuntimeEventCollector` because the
stream and non-stream event shapes overlap on `type` literals — dispatching
on `type` alone would misroute events.

#### Parameters

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) = `{}`

#### Returns

[`RuntimeStreamEventCollector`](#runtimestreameventcollector)

***

### readinessServerSentEvent()

> **readinessServerSentEvent**(`report`, `options?`): `string`

**`Stable`**

Serialize a `KnowledgeReadinessReport` as a Server-Sent Event string.

#### Parameters

##### report

`KnowledgeReadinessReport`

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & [`ServerSentEventOptions`](#serversenteventoptions) = `{}`

#### Returns

`string`

***

### runtimeStreamServerSentEvent()

> **runtimeStreamServerSentEvent**(`event`, `options?`): `string`

**`Stable`**

Serialize a `RuntimeStreamEvent` as a Server-Sent Event string.

#### Parameters

##### event

[`RuntimeStreamEvent`](#runtimestreamevent)

##### options?

[`RuntimeTelemetryOptions`](#runtimetelemetryoptions) & [`ServerSentEventOptions`](#serversenteventoptions) = `{}`

#### Returns

`string`
