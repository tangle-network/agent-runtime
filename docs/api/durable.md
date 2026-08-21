[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / durable

# durable

## Classes

### FileObserverJournal

Durable, append-only third-person history for one concrete Runtime execution.
It consumes Runtime's existing hook stream and does not participate in execution
decisions. A broken observer therefore cannot change what an agent is allowed to do.

The write discipline deliberately matches `FileSpawnJournal`: serialized appends,
torn-tail recovery, short-write handling, and fsync before acknowledgement. One
execution owns one journal file; higher-level pursuit aggregation joins isolated
journals by `pursuitId` instead of making independent processes share a write head.

#### Implements

- [`ObserverJournal`](#observerjournal)

#### Constructors

##### Constructor

> **new FileObserverJournal**(`path`, `pursuitId`): [`FileObserverJournal`](#fileobserverjournal)

###### Parameters

###### path

`string`

###### pursuitId

`string`

###### Returns

[`FileObserverJournal`](#fileobserverjournal)

#### Properties

##### path

> `readonly` **path**: `string`

##### pursuitId

> `readonly` **pursuitId**: `string`

#### Methods

##### hooks()

> **hooks**(): [`RuntimeHooks`](index.md#runtimehooks)

###### Returns

[`RuntimeHooks`](index.md#runtimehooks)

###### Implementation of

[`ObserverJournal`](#observerjournal).[`hooks`](#hooks-1)

##### appendEvent()

> **appendEvent**(`event`): `Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Parameters

###### event

[`RuntimeHookEvent`](index.md#runtimehookevent)

###### Returns

`Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Implementation of

[`ObserverJournal`](#observerjournal).[`appendEvent`](#appendevent)

##### appendDecision()

> **appendDecision**(`point`): `Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Parameters

###### point

[`RuntimeDecisionPoint`](index.md#runtimedecisionpoint)

###### Returns

`Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Implementation of

[`ObserverJournal`](#observerjournal).[`appendDecision`](#appenddecision)

##### read()

> **read**(): `Promise`\<readonly [`ObserverRecord`](#observerrecord)[]\>

###### Returns

`Promise`\<readonly [`ObserverRecord`](#observerrecord)[]\>

###### Implementation of

[`ObserverJournal`](#observerjournal).[`read`](#read)

***

### SupervisePursuitError

A failed Runtime execution whose complete third-person projection was retained.

#### Extends

- `Error`

#### Constructors

##### Constructor

> **new SupervisePursuitError**(`cause`, `pursuit`, `observerPath`): [`SupervisePursuitError`](#supervisepursuiterror)

###### Parameters

###### cause

`unknown`

###### pursuit

[`PursuitProjection`](#pursuitprojection)

###### observerPath

`string`

###### Returns

[`SupervisePursuitError`](#supervisepursuiterror)

###### Overrides

`Error.constructor`

#### Properties

##### pursuit

> `readonly` **pursuit**: [`PursuitProjection`](#pursuitprojection)

##### observerPath

> `readonly` **observerPath**: `string`

## Interfaces

### ChatStreamEvent

The NDJSON line protocol every product chat client already speaks.

#### Properties

##### type

> **type**: `string`

##### data?

> `optional` **data?**: `Record`\<`string`, `unknown`\>

***

### ChatTurnIdentity

Identity of a chat turn. `tenantId` is the workspace id for workspace-
 scoped products and the user id for session-scoped products.

#### Properties

##### tenantId

> **tenantId**: `string`

##### sessionId

> **sessionId**: `string`

Thread / session id.

##### userId

> **userId**: `string`

##### turnIndex

> **turnIndex**: `number`

Monotonic 0-based turn index within the session.

***

### ChatTurnProducer

The live side of a turn returned by the product's `produce` hook.

#### Type Parameters

##### TEvent

`TEvent` *extends* [`ChatStreamEvent`](#chatstreamevent) = [`ChatStreamEvent`](#chatstreamevent)

#### Properties

##### stream

> **stream**: `AsyncGenerator`\<`TEvent`, `void`, `unknown`\>

The turn's event stream. Forwarded verbatim to the caller.

#### Methods

##### finalText()

> **finalText**(): `string`

The turn's final assistant text. Read once, after `stream` drains.

###### Returns

`string`

***

### ChatTurnHooks

Product callbacks invoked while one chat turn runs.

#### Methods

##### produce()

> **produce**(): [`ChatTurnProducer`](#chatturnproducer)

Build the backend stream. The engine forwards events verbatim and
 reads `finalText()` once the stream drains.

###### Returns

[`ChatTurnProducer`](#chatturnproducer)

##### persistAssistantMessage()

> **persistAssistantMessage**(`input`): `Promise`\<`void`\>

Persist the assistant message to the product's own store. Called
 once, after drain, with the assembled (transform-applied) text.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onTurnComplete()?

> `optional` **onTurnComplete**(`input`): `Promise`\<`void`\>

Optional post-processing for proposals, citations, or credit metering.
 Errors are logged without failing a turn that already streamed.

###### Parameters

###### input

###### identity

[`ChatTurnIdentity`](#chatturnidentity)

###### finalText

`string`

###### Returns

`Promise`\<`void`\>

##### onEvent()?

> `optional` **onEvent**(`event`): `void` \| `Promise`\<`void`\>

Optional per-event side channel, such as a Durable Object broadcast.
 Runs for every emitted event, including the lifecycle envelope.
 Errors are logged without breaking the chat stream.

###### Parameters

###### event

[`ChatStreamEvent`](#chatstreamevent)

###### Returns

`void` \| `Promise`\<`void`\>

##### transformFinalText()?

> `optional` **transformFinalText**(`text`): `string` \| `Promise`\<`string`\>

Optional pre-persist transform of the final text (e.g. PII
 redaction). Affects only what is persisted; the live stream is
 never altered.

###### Parameters

###### text

`string`

###### Returns

`string` \| `Promise`\<`string`\>

##### traceFlush()?

> `optional` **traceFlush**(): `Promise`\<`void`\>

Optional trace flush. Handed to `waitUntil` so the worker stays alive
 until export completes.

###### Returns

`Promise`\<`void`\>

***

### RunChatTurnInput

Inputs for one streamed product chat turn.

#### Properties

##### identity

> **identity**: [`ChatTurnIdentity`](#chatturnidentity)

##### hooks

> **hooks**: [`ChatTurnHooks`](#chatturnhooks)

##### waitUntil?

> `optional` **waitUntil?**: (`p`) => `void`

Worker liveness hook. When omitted, trace flush is awaited inline
 before the stream closes.

###### Parameters

###### p

`Promise`\<`unknown`\>

###### Returns

`void`

##### log?

> `optional` **log?**: (`message`, `meta?`) => `void`

Structured logger for swallowed hook errors. Defaults to
 `console.error` so failures surface without product wiring.

###### Parameters

###### message

`string`

###### meta?

`Record`\<`string`, `unknown`\>

###### Returns

`void`

***

### ChatTurnResult

HTTP response values returned for one chat turn.

#### Properties

##### body

> **body**: `ReadableStream`\<`Uint8Array`\<`ArrayBufferLike`\>\>

NDJSON body to return as the platform `Response` body.

##### contentType

> **contentType**: `"application/x-ndjson"`

Content type for the response.

***

### ObserverRecord

One immutable record in the observer plane. `sequence` is journal order, not
execution order; causal/runtime order remains available on the underlying event.
`previousDigest` + `digest` make deletion, reordering, or mutation detectable.

#### Properties

##### schemaVersion

> `readonly` **schemaVersion**: `1`

##### pursuitId

> `readonly` **pursuitId**: `string`

##### sequence

> `readonly` **sequence**: `number`

##### kind

> `readonly` **kind**: [`ObserverRecordKind`](#observerrecordkind)

##### observedAt

> `readonly` **observedAt**: `number`

##### previousDigest?

> `readonly` `optional` **previousDigest?**: `string`

##### event?

> `readonly` `optional` **event?**: [`RuntimeHookEvent`](index.md#runtimehookevent)\<`unknown`\>

##### decision?

> `readonly` `optional` **decision?**: [`RuntimeDecisionPoint`](index.md#runtimedecisionpoint)

##### digest

> `readonly` **digest**: `string`

***

### ObserverJournal

#### Methods

##### appendEvent()

> **appendEvent**(`event`): `Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Parameters

###### event

[`RuntimeHookEvent`](index.md#runtimehookevent)

###### Returns

`Promise`\<[`ObserverRecord`](#observerrecord)\>

##### appendDecision()

> **appendDecision**(`point`): `Promise`\<[`ObserverRecord`](#observerrecord)\>

###### Parameters

###### point

[`RuntimeDecisionPoint`](index.md#runtimedecisionpoint)

###### Returns

`Promise`\<[`ObserverRecord`](#observerrecord)\>

##### read()

> **read**(): `Promise`\<readonly [`ObserverRecord`](#observerrecord)[]\>

###### Returns

`Promise`\<readonly [`ObserverRecord`](#observerrecord)[]\>

##### hooks()

> **hooks**(): [`RuntimeHooks`](index.md#runtimehooks)

###### Returns

[`RuntimeHooks`](index.md#runtimehooks)

***

### PursuitRunProjection

#### Properties

##### runId

> `readonly` **runId**: `string`

##### status

> `readonly` **status**: [`PursuitRunStatus`](#pursuitrunstatus)

##### settledAt?

> `readonly` `optional` **settledAt?**: `number`

##### error?

> `readonly` `optional` **error?**: `string`

##### firstSequence

> `readonly` **firstSequence**: `number`

##### lastSequence

> `readonly` **lastSequence**: `number`

##### firstObservedAt

> `readonly` **firstObservedAt**: `number`

##### lastObservedAt

> `readonly` **lastObservedAt**: `number`

##### eventCount

> `readonly` **eventCount**: `number`

##### decisionCount

> `readonly` **decisionCount**: `number`

##### targets

> `readonly` **targets**: `Readonly`\<`Record`\<`string`, `number`\>\>

##### decisions

> `readonly` **decisions**: `Readonly`\<`Record`\<`string`, `number`\>\>

***

### PursuitNodeProjection

#### Properties

##### id

> `readonly` **id**: `string`

##### parentId?

> `readonly` `optional` **parentId?**: `string`

##### runId

> `readonly` **runId**: `string`

Node ids are scoped to this concrete Runtime tree; `(runId,id)` is identity.

##### label?

> `readonly` `optional` **label?**: `string`

##### runtime?

> `readonly` `optional` **runtime?**: `string`

##### depth?

> `readonly` `optional` **depth?**: `number`

##### assignmentId?

> `readonly` `optional` **assignmentId?**: `string`

##### identity?

> `readonly` `optional` **identity?**: `unknown`

##### budget?

> `readonly` `optional` **budget?**: `unknown`

##### status

> `readonly` **status**: [`PursuitNodeStatus`](#pursuitnodestatus)

##### settledAt?

> `readonly` `optional` **settledAt?**: `number`

##### spent?

> `readonly` `optional` **spent?**: `unknown`

##### outRef?

> `readonly` `optional` **outRef?**: `string`

##### score?

> `readonly` `optional` **score?**: `number`

##### valid?

> `readonly` `optional` **valid?**: `boolean`

##### reason?

> `readonly` `optional` **reason?**: `string`

##### infra?

> `readonly` `optional` **infra?**: `boolean`

##### wait?

> `readonly` `optional` **wait?**: `unknown`

##### firstSequence

> `readonly` **firstSequence**: `number`

##### lastSequence

> `readonly` **lastSequence**: `number`

##### firstObservedAt

> `readonly` **firstObservedAt**: `number`

##### lastObservedAt

> `readonly` **lastObservedAt**: `number`

##### eventCount

> `readonly` **eventCount**: `number`

***

### PursuitProjection

#### Properties

##### pursuitId

> `readonly` **pursuitId**: `string`

##### sequence

> `readonly` **sequence**: `number`

Number of records in this concrete execution journal.

##### chainTip

> `readonly` **chainTip**: `string`

Digest-chain tip for this concrete execution journal.

##### firstObservedAt

> `readonly` **firstObservedAt**: `number`

##### lastObservedAt

> `readonly` **lastObservedAt**: `number`

##### runs

> `readonly` **runs**: readonly [`PursuitRunProjection`](#pursuitrunprojection)[]

##### nodes

> `readonly` **nodes**: readonly [`PursuitNodeProjection`](#pursuitnodeprojection)[]

##### eventCount

> `readonly` **eventCount**: `number`

##### decisionCount

> `readonly` **decisionCount**: `number`

***

### SupervisePursuitOptions

#### Extends

- [`SuperviseOptions`](runtime.md#superviseoptions)

#### Properties

##### pursuitId

> `readonly` **pursuitId**: `string`

Stable objective identity spanning concrete Runtime runs.

##### runDir

> `readonly` **runDir**: `string`

One concrete Runtime execution owns one durable directory and observer journal.
A pursuit spanning several runs reuses `pursuitId` across distinct `runDir`s;
Intelligence joins those isolated projections without a shared write head.

###### Overrides

[`SuperviseOptions`](runtime.md#superviseoptions).[`runDir`](runtime.md#rundir-1)

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The conserved compute pool for the whole run.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`budget`](runtime.md#budget-15)

##### rootHandle?

> `readonly` `optional` **rootHandle?**: [`RootHandle`](runtime.md#roothandle-1)\<`unknown`\>

Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
attaches it before execution and detaches it after the join barrier.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`rootHandle`](runtime.md#roothandle)

##### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Caller-owned cancellation for the complete recursive run. Aborting it cascades through the
root scope and every live child, including acquisition and backend execution.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`signal`](runtime.md#signal-21)

##### execution?

> `readonly` `optional` **execution?**: [`AgentExecutionRef`](runtime.md#agentexecutionref)

Trusted candidate and pursuit attribution for the root. The runtime derives profile/task
digests itself from the exact detached values it executes.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`execution`](runtime.md#execution-1)

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

WHERE workers run — derives the worker seam. Provide this OR an explicit `makeWorkerAgent`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`backend`](runtime.md#backend-4)

##### deliverable?

> `readonly` `optional` **deliverable?**: `string` \| [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

The independent completion check for backend-derived workers and direct supervisor
 submissions. Strongly recommended: without it the supervisor cannot submit its own work and
 backend-derived workers fall back to their own validity signal. A `string` names an entry in
 `registry.deliverables`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`deliverable`](runtime.md#deliverable-4)

##### resolveDeliverable?

> `readonly` `optional` **resolveDeliverable?**: (`input`) => [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\> \| `undefined`

Resolve the completion check for one exact authorized backend-derived leaf. The callback runs
after spawn authorization and driver classification, receives a detached immutable context,
and may return `undefined` to use the run-wide `deliverable`. Driver profiles never call it.

###### Parameters

###### input

[`AuthorizedSpawnContext`](runtime.md#authorizedspawncontext)

###### Returns

[`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\> \| `undefined`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDeliverable`](runtime.md#resolvedeliverable)

##### registry?

> `readonly` `optional` **registry?**: [`SuperviseRegistry`](runtime.md#superviseregistry)

Name→value tables for the four code-valued options, so a recorded run configuration can name
 them instead of carrying closures. See [SuperviseRegistry](runtime.md#superviseregistry).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`registry`](runtime.md#registry-3)

##### coordination?

> `readonly` `optional` **coordination?**: [`CoordinationBinding`](runtime.md#coordinationbinding)

Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
 port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
 unless `allowUnauthenticatedRemote` acknowledges that the verbs are unauthenticated.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`coordination`](runtime.md#coordination)

##### peerMail?

> `readonly` `optional` **peerMail?**: `boolean` \| \{ `limits?`: `Partial`\<[`PeerMailLimits`](runtime.md#peermaillimits)\>; \}

OPT-IN peer mail for the run's workers: sibling-to-sibling `send_mail` / `read_mail`, bounded
 and audited (`CoordinationToolsOptions.peerMail`). The runtime mints one capability URL per
 spawn, serves the mail listener beside the coordination MCP, and hands each worker its
 endpoint on [WorkerSpawnContext.peerMailUrl](runtime.md#peermailurl). Mounting that URL into the worker is the
 `makeWorkerAgent` owner's job today: the runtime never writes it into a worker profile, since
 the fresh random URL would move the canonical profile digest, and bridge workers cannot mount
 it out of band until the bridge carries runtime attachments (#774). Requires a harness-brained
 supervisor; a router-brained supervisor is refused rather than silently unmailed.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`peerMail`](runtime.md#peermail)

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
 This is caller-owned execution: profile security, spawn authorization, and recursive-driver
 selection below apply only to the backend-derived worker path. `authorizeMessage` still
 governs continuations sent through Runtime's coordination tools.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`makeWorkerAgent`](runtime.md#makeworkeragent-2)

##### driverBackend?

> `readonly` `optional` **driverBackend?**: [`ExecutorConfig`](runtime.md#executorconfig)

Run harness-brained supervisors here. Automatic execution supports a local `bridge`; a remote
 sandbox requires an explicit `driveHarness` with a reachable coordination relay or tunnel.
 Defaults to `backend`; separate it when managers and workers use different services.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driverBackend`](runtime.md#driverbackend-1)

##### profileSecurity?

> `readonly` `optional` **profileSecurity?**: `AgentProfileSecurityPolicy`

Security policy applied to every manager-authored child profile before budget reservation.
 The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
 allowlist to grant remote MCP hosts or other author-controlled capabilities.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`profileSecurity`](runtime.md#profilesecurity)

##### authorizeSpawn?

> `readonly` `optional` **authorizeSpawn?**: (`input`) => [`AuthorizedSpawn`](runtime.md#authorizedspawn)

Product authority over one complete manager-authored spawn. The callback sees the detached,
 immutable profile, task, budget, label, and key together, so approving a profile cannot
 authorize a different task. Return the exact allowed profile (which may be narrowed) plus
 trusted candidate/pursuit attribution, or throw to refuse the whole spawn before reservation.

###### Parameters

###### input

###### profile

`AgentProfile`

###### parent

`AgentProfile`

###### parentIdentity

[`NodeExecutionIdentity`](runtime.md#nodeexecutionidentity)

Trusted identity of the manager authorizing this exact child.

###### parentNodeId

`string`

Concrete manager node; never accepted from model-authored tool arguments.

###### assignmentId

`string`

Stable manager-scoped assignment, including deterministic unkeyed siblings.

###### task

`unknown`

###### budget

[`Budget`](index.md#budget-4)

###### label

`string`

###### key?

`string`

###### depth

`number`

###### Returns

[`AuthorizedSpawn`](runtime.md#authorizedspawn)

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`authorizeSpawn`](runtime.md#authorizespawn)

##### authorizeMessage?

> `readonly` `optional` **authorizeMessage?**: (`input`) => [`AuthorizedDownMessage`](runtime.md#authorizeddownmessage)

Product authority over every continuation sent to a live child. When spawn authorization is
enabled, omitting this refuses steer/answer instructions instead of silently extending the
authorized task. The exact worker identity and detached bytes are recorded before delivery.

###### Parameters

###### input

[`DownMessageAuthorizationInput`](runtime.md#downmessageauthorizationinput) & `object`

###### Returns

[`AuthorizedDownMessage`](runtime.md#authorizeddownmessage)

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`authorizeMessage`](runtime.md#authorizemessage-1)

##### isDriverProfile?

> `readonly` `optional` **isDriverProfile?**: (`input`) => `boolean`

Decide whether an authorized child becomes another supervisor. By default only
 `metadata.role === 'driver'` does. Products receive the same frozen post-authorization
 context as `resolveDeliverable`, so trusted execution/assignment authority can override
 model-authored metadata without a side channel.

###### Parameters

###### input

[`AuthorizedSpawnContext`](runtime.md#authorizedspawncontext)

###### Returns

`boolean`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`isDriverProfile`](runtime.md#isdriverprofile)

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](runtime.md#routertransportconfig)

The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
 model wins.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`router`](runtime.md#router-5)

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](runtime.md#driveharness-1)

Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
 caller-owned override for a local bridge.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarness`](runtime.md#driveharness)

##### driverRetry?

> `readonly` `optional` **driverRetry?**: [`DriverRetryPolicy`](runtime.md#driverretrypolicy)

How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
`driver-failed`. A harness process SIGKILLed at a bridge timeout, a stream cut mid-turn, or an
upstream 5xx used to end a run of arbitrary length while its budget and deadline sat almost
untouched (#741). A retry re-enters the driver over the SAME scope, coordination server, and
live children; the bridge backend reattaches the harness session by its durable execution id.

Runtime's own refusals (a validation guard, an exhausted budget, an abort, a client-side
transport status) are never retried — they were decisions. Retries stop at the budget, the
deadline, an abort, or a run of attempts that changed nothing at all.

Omit = retry under the defaults. `{ enabled: false }` = the historical behavior where the first
driver failure ends the run. Applies to the root manager and every recursive manager under it.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driverRetry`](runtime.md#driverretry)

##### onDriverAttempt?

> `readonly` `optional` **onDriverAttempt?**: (`record`) => `void` \| `Promise`\<`void`\>

Per-attempt record for every external driver in the tree — what makes "failed after N
 attempts, last cause X" visible instead of one backend's last words.

###### Parameters

###### record

[`DriverAttemptRecord`](runtime.md#driverattemptrecord)

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`onDriverAttempt`](runtime.md#ondriverattempt)

##### childSettleGraceMs?

> `readonly` `optional` **childSettleGraceMs?**: `number`

How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
cascades the abort into them. A root that died did not make its children unhealthy: a child
mid-unit holds work already paid for, and an immediate cascade discards everything it has not
yet written. Bounded by the run's own deadline. Omit/`0` = immediate teardown.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`childSettleGraceMs`](runtime.md#childsettlegracems)

##### resolveDriveHarness?

> `readonly` `optional` **resolveDriveHarness?**: [`ResolveDriveHarness`](runtime.md#resolvedriveharness-1)

Resolve one custom external-harness session per trusted manager identity. Use this instead of
`driveHarness` when recursive managers must be independently steerable.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDriveHarness`](runtime.md#resolvedriveharness)

##### driveHarnessMaterialization?

> `readonly` `optional` **driveHarnessMaterialization?**: [`ProfileMaterializationContract`](agent.md#profilematerializationcontract)

Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
AgentProfile axes that path really applies. Built-in bridge driving supplies its own
full-profile contract.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarnessMaterialization`](runtime.md#driveharnessmaterialization)

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](runtime.md#resolvesupervisortools-1)

Resolve product-owned tools from the exact trusted manager context. The same descriptors and
handlers are bound to router and external-harness managers; resolution happens once per node.
Each handler receives that manager scope's live cancellation signal in its trusted invocation
context, including recursive parent and root cascades.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveSupervisorTools`](runtime.md#resolvesupervisortools)

##### onCoordinationEvent?

> `readonly` `optional` **onCoordinationEvent?**: (`context`, `eventId`, `record`) => `void` \| `Promise`\<`void`\>

Awaited product transaction hook for every coordination record. `eventId` is stable across a
lost acknowledgement and durable restart; the record is not pull-visible until this commits.

###### Parameters

###### context

[`SupervisorNodeContext`](runtime.md#supervisornodecontext)

###### eventId

`` `sha256:${string}` ``

###### record

[`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`onCoordinationEvent`](runtime.md#oncoordinationevent)

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`extraTools`](runtime.md#extratools)

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Runs an `extraTools` call; null/undefined falls through to the coordination dispatch.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`executeExtraTool`](runtime.md#executeextratool)

##### perWorker?

> `readonly` `optional` **perWorker?**: [`Budget`](index.md#budget-4)

Per-child budget reserved on each spawn. Defaults to a quarter of the pool's tokens.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`perWorker`](runtime.md#perworker-1)

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on simultaneously executing spawned workers across the WHOLE recursive tree. The
 root is excluded; nested drivers and leaves share one allocation, so recursion cannot multiply
 the cap. Omit/`<= 0` = no cap (the conserved pool stays the only bound).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxLiveWorkers`](runtime.md#maxliveworkers-4)

##### analysts?

> `readonly` `optional` **analysts?**: `string` \| [`AnalystRegistry`](index.md#analystregistry)

Analyst lenses available to the driver. Required for `analyzeOnSettle`. Unset → status quo
 (the driver receives settled worker outputs, no analyst findings). A `string` names an entry in
 `registry.analysts`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`analysts`](runtime.md#analysts-3)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](runtime.md#analyzeonsettleroute))[]

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each re-enters as a `finding`
 the driver pulls (`await_event`) and composes its next steer from. The self-improving UP-leg,
 threaded to the driver at this level (propagate to sub-drivers via a recursive `makeWorkerAgent`).
 Omit/empty = status quo (no analyst feed). Requires `analysts`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`analyzeOnSettle`](runtime.md#analyzeonsettle)

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](runtime.md#workerwatchoptions)

Watch every worker's LIVE tool trace with the online detector panel and raise a `finding` the
moment one loops or error-storms — so the supervisor learns it mid-run (via `await_event`)
instead of at settle. Pairs with a steerable worker: the finding is the evidence, `steer_agent`
is the correction. Requires a backend whose executor exposes a trace source (the steerable
sandbox worker and the pi wrapper do); other runtimes are simply not watched.

Omit = off (status quo — no online watching, no extra events).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`watchWorkers`](runtime.md#watchworkers-1)

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time after which `observe_agent` reports a running worker as `stalled`. A derived read
 at observation time — nothing is killed or retried. Omit = the runtime default.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`stallAfterMs`](runtime.md#stallafterms-3)

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](runtime.md#continuitymode)\>\>

Default continuity per worker PROFILE NAME: `'resume'` makes each spawn of that name after
 the first re-attach to the node's most recent SETTLED worker — a NEW live worker whose spawn
 context carries the prior worker's identity (`WorkerSpawnContext.resume`), which the executor
 seam re-attaches with. `spawn_agent`'s per-call `continuity` argument overrides in either
 direction; `runGraph` derives this from delegates-edge `continuity`. Omit = every spawn is
 `'fresh'` (status quo). See `CoordinationToolsOptions.continuityByProfile` for the
 refusal semantics (no-prior / while-live / with-key) and the process-local resume boundary.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`continuityByProfile`](runtime.md#continuitybyprofile)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](runtime.md#resultblobstore)

Worker output store. Defaults to in-memory.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`blobs`](runtime.md#blobs-4)

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](runtime.md#spawnjournal)

Override the spawn journal directly (advanced; `runDir` is the ordinary durable path). Pair
 with `blobs` — a journal whose result payloads live in a different store cannot replay.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`journal`](runtime.md#journal-4)

##### probes?

> `readonly` `optional` **probes?**: `string` \| [`WaitProbeRegistry`](runtime.md#waitproberegistry)

Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
 wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
 refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
 `registry.probes`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`probes`](runtime.md#probes-2)

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](runtime.md#stoprule)

PROGRESS-derived stop rule (router-brained supervisor). Ends a run that has stopped LEARNING
before it exhausts a ceiling — the answer to "a run should end because it is done or stuck,
not because it ran out". It composes with the budget guards and can never override one.

Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
`noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
only (unchanged behavior).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`stopRule`](runtime.md#stoprule-1)

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run — so a caller records the reason
 instead of inferring an early stop from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`onProgressStop`](runtime.md#onprogressstop)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxDepth`](runtime.md#maxdepth-2)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxTurns`](runtime.md#maxturns-2)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](runtime.md#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (router arm only): once
 its coordination transcript exceeds `thresholdTokens` it distills to a compact progress note and
 continues, instead of re-billing the whole transcript every turn (the cost that makes the LLM-brain
 front door lose to a dumb-Ralph respawn). The live `Scope` roster is the durable state across
 chapters. Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`compaction`](runtime.md#compaction)

##### runId?

> `readonly` `optional` **runId?**: `string`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`runId`](runtime.md#runid-17)

##### now?

> `readonly` `optional` **now?**: () => `number`

###### Returns

`number`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`now`](runtime.md#now-16)

##### allowedModels?

> `readonly` `optional` **allowedModels?**: readonly `string`[]

Restrict the run to this subset of models. When set, every configured model — the
 supervisor router model, the profile's model, and the backend's model — must be a member,
 or `supervise()` throws a `ConfigError` before any compute is spent. Unset = unrestricted.

 This is a MODEL-ID filter, not a route filter. The compared values are the bare ids a profile
 declares — `model.default`, `model.small`, `subagents[].model`, `modes[].model`. The composed
 wire id (`harness/provider/model`) is never built here and never compared, so an entry written
 in qualified form matches nothing, and a child that names an allowed id is admitted whatever
 harness and provider its own profile declares. Pin the route with `authorizeSpawn`: it reads
 the authored child profile and may refuse the spawn before any reservation.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`allowedModels`](runtime.md#allowedmodels-2)

##### finalizer?

> `readonly` `optional` **finalizer?**: `string` \| [`SupervisorFinalizer`](index.md#supervisorfinalizer)

How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
 highest-scoring DELIVERED child (the exact behavior every existing caller had). Alternatives:
 `collectDelivered` (every verified distinct output with provenance — a Pareto set / recorded
 disagreement) or a custom `SupervisorFinalizer`. Whatever the finalizer, it operates on
 structurally DELIVERED outputs only — an undelivered or invalid child stays ineligible. A
 `string` names an entry in `registry.finalizers`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`finalizer`](runtime.md#finalizer)

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Lifecycle observers for the whole recursive tree (`Scope` re-seeds them into every nested
 scope). Composed with the `otel` recorder below when both are set. Omit = no observers, which
 is the behavior every existing caller has.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`hooks`](runtime.md#hooks-8)

##### otel?

> `readonly` `optional` **otel?**: `Omit`\<[`SupervisorSpanOptions`](runtime.md#supervisorspanoptions), `"runId"` \| `"now"`\>

OPT-IN OTLP tracing: emit one span per supervised node (opened at spawn, closed at settle,
parented to its parent node's span) plus an `LLM` child span per metered driver turn, so the
tree is readable by any trace viewer instead of only by a journal parser. See `otel-spans.ts`.

Omit and the run emits nothing, allocates no recorder, and installs no hook — telemetry is
never a default. Present with no reachable endpoint (no `exportConfig.endpoint` and no
`OTEL_EXPORTER_OTLP_ENDPOINT`) is also a no-op. The spawn journal is untouched either way:
spans are telemetry, never the replay/resume record.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`otel`](runtime.md#otel-1)

***

### SupervisedPursuitResult

#### Type Parameters

##### Result

`Result`

#### Properties

##### result

> `readonly` **result**: `Result`

##### pursuit

> `readonly` **pursuit**: [`PursuitProjection`](#pursuitprojection)

##### observerPath

> `readonly` **observerPath**: `string`

***

### DurableCoordinationStreamIdentity

#### Properties

##### runId

> `readonly` **runId**: `string`

##### ownerIds

> `readonly` **ownerIds**: readonly `string`[]

Exact owner ids present in the side-log, sorted for deterministic display.

##### unscopedRecords

> `readonly` **unscopedRecords**: `number`

Records written before owner-scoped coordination identities were introduced.

##### recordCount

> `readonly` **recordCount**: `number`

***

### DurableSupervisionDiscovery

Identities discoverable from one `supervise({ runDir })` directory without
already knowing the root node or coordination run id stored inside it.

#### Properties

##### runDir

> `readonly` **runDir**: `string`

##### spawnJournalPath

> `readonly` **spawnJournalPath**: `string`

##### coordinationLogPath

> `readonly` **coordinationLogPath**: `string`

##### roots

> `readonly` **roots**: readonly `string`[]

##### coordinationStreams

> `readonly` **coordinationStreams**: readonly [`DurableCoordinationStreamIdentity`](#durablecoordinationstreamidentity)[]

## Type Aliases

### ObserverRecordKind

> **ObserverRecordKind** = `"event"` \| `"decision"`

***

### PursuitRunStatus

> **PursuitRunStatus** = `"running"` \| `"done"` \| `"failed"`

***

### PursuitNodeStatus

> **PursuitNodeStatus** = `"running"` \| `"done"` \| `"down"`

## Functions

### handleChatTurn()

> **handleChatTurn**(`input`): [`ChatTurnResult`](#chatturnresult)

Run one chat turn. Returns immediately with a `ReadableStream` body;
execution starts while the stream is constructed. Backend
failures surface as `error` + `session.run.failed` events.

#### Parameters

##### input

[`RunChatTurnInput`](#runchatturninput)

#### Returns

[`ChatTurnResult`](#chatturnresult)

***

### deriveExecutionId()

> **deriveExecutionId**(`input`): `string`

Derive a stable execution id from the run identity.
The same `(projectId, sessionId, turnIndex)` tuple yields the same id.

Use the result as both `PromptOptions.executionId` and
`PromptOptions.turnId` on the first dispatch.
The execution id addresses the server-side execution for reconnect and
replay; the turn id makes a repeated dispatch idempotent.
An execution id alone does not make a repeated POST idempotent.

Format is readable, not hashed: operators grepping orchestrator logs
for `gtm-agent:thread-abc:3` find the run without translating an
opaque id. Components are URL-encoded so delimiters inside caller ids
cannot collapse distinct tuples. The final id is limited to the
orchestrator replay route's 256-byte maximum. Execution ids are not a
secrecy boundary.

Wire integration:
  - Initial dispatch: pass the result as `executionId` and `turnId`.
  - Stream replay: pass it as `executionId` with `lastEventId`.

#### Parameters

##### input

###### projectId

`string`

###### sessionId

`string`

###### turnIndex

`number`

#### Returns

`string`

#### Throws

`TypeError` when either string id is blank.

#### Throws

`RangeError` when `turnIndex` is invalid or the result exceeds 256 bytes.

***

### verifyObserverRecords()

> **verifyObserverRecords**(`records`, `pursuitId?`): readonly [`ObserverRecord`](#observerrecord)[]

Verify identity, monotonic sequence, payload shape, and the complete digest chain.

#### Parameters

##### records

readonly [`ObserverRecord`](#observerrecord)[]

##### pursuitId?

`string`

#### Returns

readonly [`ObserverRecord`](#observerrecord)[]

***

### observerRecordDigest()

> **observerRecordDigest**(`record`): `string`

Compute the canonical SHA-256 digest for an unsigned observer record.

#### Parameters

##### record

`Omit`\<[`ObserverRecord`](#observerrecord), `"digest"`\>

#### Returns

`string`

***

### createFileObserverHooks()

> **createFileObserverHooks**(`path`, `pursuitId`): `object`

Build the canonical durable observer hook in one call.

#### Parameters

##### path

`string`

##### pursuitId

`string`

#### Returns

`object`

##### journal

> `readonly` **journal**: [`FileObserverJournal`](#fileobserverjournal)

##### hooks

> `readonly` **hooks**: [`RuntimeHooks`](index.md#runtimehooks)

***

### projectPursuit()

> **projectPursuit**(`records`): [`PursuitProjection`](#pursuitprojection)

Fold one append-only execution journal into a deterministic operator projection.

This is intentionally a READ model, not another state machine: it does not own
execution, cannot steer agents, and can be rebuilt from the journal at any time.
Projection verifies the complete hash chain first, so an operator view can never
silently render a mutated or reordered observer history as trustworthy state.

Topology comes only from Runtime's canonical `agent.spawn` facts. Terminal node
state comes only from `agent.child`; concrete run state comes only from the root
`agent.run` lifecycle emitted by `supervisePursuit`. Node identity is scoped to the
concrete Runtime run so independent trees may both contain `root:s0` without aliasing.

#### Parameters

##### records

readonly [`ObserverRecord`](#observerrecord)[]

#### Returns

[`PursuitProjection`](#pursuitprojection)

***

### supervisePursuit()

> **supervisePursuit**(`profile`, `task`, `opts`): `Promise`\<[`SupervisedPursuitResult`](#supervisedpursuitresult)\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>\>

One-call durable pursuit execution over the canonical `supervise()` kernel.

This is an adapter, not a second executor: it composes a durable third-person
observer into Runtime's existing recursive hook stream and then rebuilds the
operator projection after the same `supervise()` call settles. Agents never
receive the observer path or projection and their behavior does not depend on it.

Every concrete execution writes only inside its own `runDir`. Cross-run pursuit
aggregation is therefore lock-free at the observer layer: reuse `pursuitId` across
run directories and let Intelligence join the independently verified projections.

#### Parameters

##### profile

`AgentProfile`

##### task

`unknown`

##### opts

[`SupervisePursuitOptions`](#supervisepursuitoptions)

#### Returns

`Promise`\<[`SupervisedPursuitResult`](#supervisedpursuitresult)\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>\>

***

### discoverDurableSupervisionRun()

> **discoverDurableSupervisionRun**(`runDir`): `Promise`\<[`DurableSupervisionDiscovery`](#durablesupervisiondiscovery)\>

Discover the stable identities recorded by Runtime's durable supervision
files. This is the developer-facing first step before calling
`FileSpawnJournal.loadTree(root)`, `loadSpawnForest(journal, root)`, or
`FileCoordinationLog.load(runId, ownerId)`.

Missing files produce empty collections. A malformed committed JSONL record
still fails loud through the same parser used by the runtime; a torn final
append is ignored because it was never acknowledged as committed.

#### Parameters

##### runDir

`string`

#### Returns

`Promise`\<[`DurableSupervisionDiscovery`](#durablesupervisiondiscovery)\>
