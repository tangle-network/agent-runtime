[**@tangle-network/agent-runtime**](README.md)

***

[@tangle-network/agent-runtime](README.md) / testing

# testing

## Interfaces

### DriverAgentOptions

#### Properties

##### name

> `readonly` **name**: `string`

##### brain

> `readonly` **brain**: [`ToolLoopChat`](runtime.md#toolloopchat)

The driver-LLM seam — ONE inference turn over the conversation + the coordination tool specs
 (the canonical `ToolLoopChat`): a scripted mock offline, the router's tool-calling in
 production, or a sandboxed harness. The same seam every tool-loop uses; no bespoke shape.

##### expectedModel?

> `readonly` `optional` **expectedModel?**: `string`

Profile-declared model for a production Router brain. When set, every turn must report this
exact provider-observed model before its output is accepted. Omitted by scripted test brains.

##### onProviderModel?

> `readonly` `optional` **onProviderModel?**: (`model`) => `void`

Runtime-owned observation sink for the provider identity of each settled driver turn.

###### Parameters

###### model

`string` \| `undefined`

###### Returns

`void`

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

Shared blob store — `observe_agent` reads settled outputs through it.

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Resolve a spawned `profile` to a worker LEAF or a driver child (the recursion seam).

##### authorizeDownMessage?

> `readonly` `optional` **authorizeDownMessage?**: [`AuthorizeDownMessage`](runtime.md#authorizedownmessage)

##### perWorker

> `readonly` **perWorker**: [`Budget`](index.md#budget-4)

Per-child budget reserved from the conserved pool on each spawn.

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Independent completion check for work the driver performs itself. When present, the driver
 receives `submit_result`; the first passing submission ends the loop and becomes the output.

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on simultaneously-LIVE workers — `spawn_agent` fails closed once this many are in
 flight (a concurrency fence on top of the conserved-pool fence). Omit/`<= 0` = no cap.

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry)

The analyst lenses available to the driver. Required for `analyzeOnSettle` (and `run_analyst`).
 Unset → no analyst feed (status quo: the driver gets settled outputs, no findings).

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](runtime.md#analyzeonsettleroute))[]

Analyst kind ids run AUTOMATICALLY when a worker settles `done` — each result re-enters as a
 `finding` the driver pulls and composes its next steer from. The UP-leg of the self-improving
 loop. Omit/empty = no auto-analysis (status quo). Requires `analysts`.

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](runtime.md#workerwatchoptions)

Run the ONLINE detector panel over each worker's LIVE tool trace and raise a `finding` the
 moment it loops/error-storms — mid-run evidence to steer on, not a settle-time post-mortem.
 Omit = no online watching.

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time after which `observe_agent` reports a worker as stalled (a derived read; nothing is
 killed). Omit = the runtime default.

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](runtime.md#continuitymode)\>\>

Default continuity per worker PROFILE NAME — `'resume'` makes spawns of that name re-attach
 to the node's latest settled worker (see
 `CoordinationToolsOptions.continuityByProfile`); `spawn_agent`'s per-call `continuity`
 argument overrides. Omit = every spawn fresh (status quo).

##### preflightSpawn?

> `readonly` `optional` **preflightSpawn?**: [`SpawnPreflight`](runtime.md#spawnpreflight)

OPT-IN async gate run before every spawn mints an assignment or reserves budget. See
 `CoordinationToolsOptions.preflightSpawn`.

##### systemPrompt

> `readonly` **systemPrompt**: `string` \| ((`task`) => `string`)

The driver's stance — a string, or built from the task (the worker-driver prompt /
 the generator). INJECTED so the prompt is a pluggable, optimizable role.

##### nodeTools?

> `readonly` `optional` **nodeTools?**: readonly [`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

Product-selected tools already bound to this exact supervisor node. The same descriptors are
 served over MCP for external supervisors; this arm projects them into router ToolSpecs.

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the driver may call DIRECTLY (alongside the coordination verbs) — so the driver is
 not a pure manager but a full agent that can ACT (do simple work itself) OR SPAWN (delegate).
 Each is a router tool spec; their names must not collide with the coordination verbs. Pair with
 `executeExtraTool`. Unset → coordination-only (the prior behavior).

##### executeExtraTool?

> `readonly` `optional` **executeExtraTool?**: (`name`, `args`) => `Promise`\<`string` \| `null` \| `undefined`\>

Runs an `extraTools` call. Returns a string result, or null/undefined to signal "not handled"
 so the call falls through to the coordination dispatch. Required iff `extraTools` is set.

###### Parameters

###### name

`string`

###### args

`Record`\<`string`, `unknown`\>

###### Returns

`Promise`\<`string` \| `null` \| `undefined`\>

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Max driver turns before the loop force-finalizes on the best settled child. Default 16.
 `0` lifts the turn-COUNT cap: the loop is bounded instead by the conserved budget pool,
 an absolute deadline, the driver's own stop, and abort (checked in-loop). A finite
 anti-runaway tripwire still guards a degenerate driver that loops on a no-spawn tool.

##### now?

> `readonly` `optional` **now?**: () => `number`

Injected clock for the in-loop absolute-deadline guard — keeps the deadline check
 deterministic in tests. Defaults to `Date.now`.

###### Returns

`number`

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](runtime.md#stoprule-1)

PROGRESS-derived stop (mechanic D). Today a run ends on a ceiling — iterations, tokens,
dollars, deadline, turn cap — which answers "may it continue?" and never "is it still getting
anywhere?". A stop rule reads the run's own progress (best-so-far over settled work, time
since the last settle, the live worker feed) and ends a run that has stopped learning BEFORE
it exhausts a budget.

Composes with, and can never override, the hard guards: `poolStarved` / `deadlinePassed` /
abort / the driver's own stop are evaluated first, so a rule can only ADD a stop.

THRESHOLDS are the caller's judgment, not this module's — build the rule with
`plateau({window, minDelta})` / `noProgressFor({...})` / `allWorkersStalled({...})` from
`supervise/stop-rules`. Omit ⇒ ceilings only (unchanged behavior).

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

Called once with the rule's reason when a `stopRule` ends the run — so a caller can record
 WHY a run stopped early instead of inferring it from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](runtime.md#toolloopcompactionoptions)

Give the driver brain a chapter-lifecycle on its OWN context window. The LLM-brain front doors
 lose to a dumb-Ralph respawn because the brain re-bills its whole coordination transcript every
 turn — the same context overflow a single steered agent suffers, one level up. With this set,
 once the brain's running conversation exceeds `thresholdTokens` it distills the accumulated
 history to a compact progress note and continues fresh: the supervisor analog of respawning
 against external tracking state, except the live `Scope` roster IS the durable state. Default
 off (no behavior change). `distill` defaults to a self-summary authored by the brain combined
 with the factual settled-worker roster; override to supply your own.

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`, `record`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every coordination bus event: settled/question/finding,
 pre-delivery instruction receipts, and steer/answer delivery outcomes. A durable caller uses
 this to append the coordination log. Omit = no observer.

###### Parameters

###### event

[`CoordinationEvent`](index.md#coordinationevent)

###### record

[`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

##### replaySettlements?

> `readonly` `optional` **replaySettlements?**: `boolean`

Re-publish resume-time settlements through the awaited observer before the first brain turn.

##### priorCoordination?

> `readonly` `optional` **priorCoordination?**: [`PriorCoordination`](runtime.md#priorcoordination)

Questions, findings, and authorized continuation receipts loaded from a prior process.
 Questions seed the ledger (`list_questions`, blocking-stop policy); all three feed the resume
 brief. Continuation receipts are evidence only and are never auto-delivered. Omit = fresh.

##### finalizer?

> `readonly` `optional` **finalizer?**: [`SupervisorFinalizer`](index.md#supervisorfinalizer)

How the settled-worker ledger becomes the run's output. Default `bestDelivered` — the single
 highest-scoring DELIVERED child (the exact keep-best every existing caller had). Runs under
 the delivered-only invariant (`runFinalizer`): whatever the finalizer, an undelivered or
 invalid child's output stays unreachable.

##### inbox?

> `readonly` `optional` **inbox?**: [`Inbox`](runtime.md#inbox)

Optional shared manager inbox used by a wrapper that must accept messages before async node
setup finishes. Ordinary callers omit it and the driver owns a fresh inbox.

##### controlDir?

> `readonly` `optional` **controlDir?**: `string`

The durable run directory (`SuperviseOptions.runDir` / the `run-layout` event dir) this driver
ACKNOWLEDGES worker-scoped cancel requests from. Each turn the driver reads the layout's
cancellation inbox once, applies any request naming one of ITS OWN workers through that
worker's existing per-child abort (cascading to the worker's subtree and no sibling), and
writes the durable [WorkerCancellation](runtime.md#workercancellation) acknowledgement: `cancel_requested` when the
abort is issued, `cancelled` only when the worker reaches a terminal `down` on the settle
path, `not_live` when the worker is already gone — a missing worker never reads as success.
Which requests this driver OWNS is set by [controlScope](#controlscope). Omit = no acknowledger
(in-memory runs keep in-process control via handles).

##### onCoordinationTools?

> `readonly` `optional` **onCoordinationTools?**: (`tools`) => `void`

Called with this driver's coordination tool descriptors once they exist and before the brain
 loop starts — the seam a node tool uses to call the same verbs in code
 (`SupervisorToolInvocationContext.verbs`).

###### Parameters

###### tools

readonly [`McpToolDescriptor`](mcp.md#mcptooldescriptor)[]

###### Returns

`void`

##### controlScope?

> `readonly` `optional` **controlScope?**: `"run"` \| `"subtree"`

##### abortRun?

> `readonly` `optional` **abortRun?**: (`reason`) => `void`

Abort the WHOLE run — the seam a run-scoped cancel request (`cancelRun`) is applied through.
Wired by `supervise()` to the run's ONE cascade controller (the attached root control), so a
run cancel takes the same path a caller's `RootHandle.abort` takes; there is no second
controller and no poller. Read only by the `'run'`-scoped manager with a `controlDir`; omit
and a run-scoped request stays unanswered.

###### Parameters

###### reason

`string`

###### Returns

`void`

***

### RunGraphTestOptions

`RunGraphOptions` with the brain REQUIRED — the shape the `/testing` entry's
 `runGraphWithTestBrain` keeps accepting now that `brain` is a production option.

#### Extends

- [`RunGraphOptions`](runtime.md#rungraphoptions)

#### Properties

##### backend?

> `readonly` `optional` **backend?**: [`ExecutorConfig`](runtime.md#executorconfig)

WHERE worker nodes run — the executor backend. Provide this OR `makeLeafAgent`. Forwarded to
 `supervise()`, which derives every authorized LEAF from it; a node declared `role: 'driver'`
 becomes a nested supervisor instead, whose own leaves are derived the same way.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`backend`](runtime.md#backend-3)

##### driverBackend?

> `readonly` `optional` **driverBackend?**: [`ExecutorConfig`](runtime.md#executorconfig)

WHERE the ROOT node's harness brain runs — forwarded to `supervise()` verbatim (see
 `SuperviseOptions.driverBackend`). Needed when the root node's profile declares an external
 harness (`codex`, `claude-code`, `opencode`): that root is driven by the harness, not by the
 router brain, and automatic execution supports a local `bridge`. Unlike `supervise()`, this
 does NOT default to `backend`: a graph's `backend` places WORKER nodes, so the root driver
 is selected only by this field. Omit = no harness driver, which is correct for a root whose
 `profile.harness` is omitted or `cli-base` (that root runs on the router brain).

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`driverBackend`](runtime.md#driverbackend)

##### makeLeafAgent?

> `readonly` `optional` **makeLeafAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Leaf-execution override (offline tests / advanced). `runGraph` still owns node pinning,
 directive delivery, and the edge ledger AROUND this seam — only the leaf `act` is yours.
 Slots INSIDE the kernel's authorized path (`SuperviseOptions.makeLeafAgent`), so a node
 declared `role: 'driver'` still becomes a nested supervisor even under an offline leaf.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`makeLeafAgent`](runtime.md#makeleafagent)

##### hooks?

> `readonly` `optional` **hooks?**: [`RuntimeHooks`](index.md#runtimehooks)

Caller-side runtime hooks (telemetry, policy, product extensions). Composed AFTER the
 graph's own spawn-binding hook on the SAME event stream — the graph never swallows the
 seam supervise() exposes.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`hooks`](runtime.md#hooks-5)

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry)

The analyst lens registry `analyzes` edges resolve against. ENVIRONMENT — needed only for
 lens analysts; an analyzes edge naming a graph NODE as its analyst needs no registry.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`analysts`](runtime.md#analysts-1)

##### registry?

> `readonly` `optional` **registry?**: [`PromptRegistry`](runtime.md#promptregistry)

Directive registry. Default: the seeded kernel registry (`kernelPromptRegistry()`).

 NOT `SuperviseOptions.registry`, which is the `SuperviseRegistry` name→value table for
 code-valued options. The two share a name and nothing else, and this one wins here — see
 `GRAPH_REFUSED_SUPERVISE_OPTIONS`.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`registry`](runtime.md#registry-1)

##### journal?

> `readonly` `optional` **journal?**: [`SpawnJournal`](runtime.md#spawnjournal)

The run journal the edge ledger and every spawn/settle ride. Default: in-memory.

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`journal`](runtime.md#journal-1)

##### blobs?

> `readonly` `optional` **blobs?**: [`ResultBlobStore`](runtime.md#resultblobstore)

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`blobs`](runtime.md#blobs-1)

##### runId?

> `readonly` `optional` **runId?**: `string`

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`runId`](runtime.md#runid-13)

##### authorizeMessage?

> `readonly` `optional` **authorizeMessage?**: (`input`) => [`AuthorizedDownMessage`](runtime.md#authorizeddownmessage)

Product authority over every steer/answer instruction (the filter seam). `runGraph` observes
 what it CHANGES: a narrowed instruction ledgers its steer traversal as `stripped`.

###### Parameters

###### input

[`DownMessageAuthorizationInput`](runtime.md#downmessageauthorizationinput) & `object`

###### Returns

[`AuthorizedDownMessage`](runtime.md#authorizeddownmessage)

###### Inherited from

[`RunGraphOptions`](runtime.md#rungraphoptions).[`authorizeMessage`](runtime.md#authorizemessage)

##### brain

> `readonly` **brain**: [`ToolLoopChat`](runtime.md#toolloopchat)

The ROOT driver's inference seam — a caller-owned `ToolLoopChat` that makes every root
 model call. Use it when the root's decisions must be caller-owned orchestration (a
 deterministic conversation driver, a persona loop with its own LLM calls) rather than a
 router-derived model call. The graph machinery around the seam is unchanged: node pinning,
 directive delivery, the edge ledger, and the journal twin all run the same shipped path,
 and the root profile keeps prompt control (`prompt-control-execution` materialization —
 `systemPrompt`/`instructions` still apply). What moves to the caller with the brain:
 model selection and provider-identity validation (`expectedModel` cannot be enforced on a
 call the runtime did not place) and per-turn usage reporting (a brain that reports no
 usage meters nothing into the pool). Omit = the router brain derived from the root
 profile — the unchanged default. Mutually exclusive with `driverBackend`, and refused
 when the root profile declares an external harness (that root is driven BY the harness).

###### Overrides

[`RunGraphOptions`](runtime.md#rungraphoptions).[`brain`](runtime.md#brain)

##### rootHandle?

> `readonly` `optional` **rootHandle?**: [`RootHandle`](runtime.md#roothandle-2)\<`unknown`\>

Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
attaches it before execution and detaches it after the join barrier.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`rootHandle`](runtime.md#roothandle-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`execution`](runtime.md#execution-2)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDeliverable`](runtime.md#resolvedeliverable-1)

##### coordination?

> `readonly` `optional` **coordination?**: [`CoordinationBinding`](runtime.md#coordinationbinding)

Where the coordination MCP binds when the supervisor is harness-driven. Omit = an ephemeral
 port on `127.0.0.1`, which an off-host root cannot reach. A non-loopback host is refused
 unless `allowUnauthenticatedRemote` acknowledges that the verbs are unauthenticated.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`coordination`](runtime.md#coordination-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`peerMail`](runtime.md#peermail-1)

##### profileSecurity?

> `readonly` `optional` **profileSecurity?**: `AgentProfileSecurityPolicy`

Security policy applied to every manager-authored child profile before budget reservation.
 The default blocks local and remote MCP, hooks, and connection grants. Pass an explicit
 allowlist to grant remote MCP hosts or other author-controlled capabilities.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`profileSecurity`](runtime.md#profilesecurity-1)

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

###### analyst?

`string`

Present (as the analyst id) only when the runtime's analyst-on-settle hook initiated this
 spawn — authored by the runtime, never accepted from a driver's tool arguments. A node-pinning
 authority reads it to admit the analyst node it would refuse as a driver-authored spawn.

###### continuity?

[`ContinuityMode`](runtime.md#continuitymode)

The EFFECTIVE continuity of this spawn, resolved by the coordination layer.

###### Returns

[`AuthorizedSpawn`](runtime.md#authorizedspawn)

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`authorizeSpawn`](runtime.md#authorizespawn-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`isDriverProfile`](runtime.md#isdriverprofile-1)

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](runtime.md#routertransportconfig)

The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
 model wins.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`router`](runtime.md#router-5)

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](runtime.md#driveharness-2)

Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
 caller-owned override for a local bridge.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarness`](runtime.md#driveharness-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`driverRetry`](runtime.md#driverretry-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`onDriverAttempt`](runtime.md#ondriverattempt-1)

##### childSettleGraceMs?

> `readonly` `optional` **childSettleGraceMs?**: `number`

How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
cascades the abort into them. A root that died did not make its children unhealthy: a child
mid-unit holds work already paid for, and an immediate cascade discards everything it has not
yet written. Bounded by the run's own deadline. Omit/`0` = immediate teardown.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`childSettleGraceMs`](runtime.md#childsettlegracems-1)

##### resolveDriveHarness?

> `readonly` `optional` **resolveDriveHarness?**: [`ResolveDriveHarness`](runtime.md#resolvedriveharness-2)

Resolve one custom external-harness session per trusted manager identity. Use this instead of
`driveHarness` when recursive managers must be independently steerable.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDriveHarness`](runtime.md#resolvedriveharness-1)

##### driveHarnessMaterialization?

> `readonly` `optional` **driveHarnessMaterialization?**: [`ProfileMaterializationContract`](agent.md#profilematerializationcontract)

Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
AgentProfile axes that path really applies. Built-in bridge driving supplies its own
full-profile contract.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarnessMaterialization`](runtime.md#driveharnessmaterialization-1)

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](runtime.md#resolvesupervisortools-2)

Resolve product-owned tools from the exact trusted manager context. The same descriptors and
handlers are bound to router and external-harness managers; resolution happens once per node.
Each handler receives that manager scope's live cancellation signal in its trusted invocation
context, including recursive parent and root cascades, plus `context.verbs` — that manager's
own coordination verbs, callable in code so a product tool can COMPOSE its children (fan out,
chain, join, retry) in one tool call instead of one model turn per verb. Every verb crosses
the same authorizeSpawn / security / allowedModels gate, pool reservation, `maxLiveWorkers`
cap, journal, and bus the MCP verb crosses, at every depth and on both arms.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveSupervisorTools`](runtime.md#resolvesupervisortools-1)

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the supervisor may call DIRECTLY — so a recursive atom can ACT (do simple work
 itself) OR SPAWN (delegate when it needs parallelism), not be a pure manager. Pair with
 `executeExtraTool`. Router arm only (`profile.harness` omitted or `cli-base`).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`extraTools`](runtime.md#extratools-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`executeExtraTool`](runtime.md#executeextratool-1)

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

##### runDir?

> `readonly` `optional` **runDir?**: `string`

Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
root profile/task identity and declared budget match. The original absolute deadline and prior
measured spend are restored before new admission. The built-in driver is resume-aware: children
that already settled, including their exact execution identities, are replayed onto
`Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
(`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
waits re-arm on their original deadlines, and the coordination log loads prior questions,
findings, and instruction receipts. The router arm receives all three in its resume brief; the
external arm seeds prior questions while findings and receipts remain in the durable log.
Instruction receipts are evidence and are never delivered automatically to a replacement
worker. The final result spans both processes' work. Unset = in-memory, fresh every call.

The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
the built-in executors cannot re-attach to a dead process's executions. Each such assignment
resumes as explicitly lost/in-doubt, its full declared reservation is charged conservatively,
and its token/dollar telemetry remains unknown. A retry is admitted only from safely remaining
capacity, so restart cannot mint a fresh budget or slide the original absolute deadline.

`runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
resumable run per directory but collides across concurrent runs sharing one `runDir`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`runDir`](runtime.md#rundir-2)

##### probes?

> `readonly` `optional` **probes?**: `string` \| [`WaitProbeRegistry`](runtime.md#waitproberegistry)

Predicate registry for `poll` wait-states (`Scope.wait`). A `poll` names its predicate so the
 wait survives a restart; this is what the name resolves against. Unset ⇒ `poll` waits are
 refused `unknown-probe` and `timer` waits still work. A `string` names an entry in
 `registry.probes`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`probes`](runtime.md#probes-3)

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](runtime.md#stoprule-1)

PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped LEARNING before it
exhausts a ceiling — the answer to "a run should end because it is done or stuck, not because
it ran out". It composes with the budget guards and can never override one.

The evaluation boundary differs by arm because the loop does: a router-brained supervisor is
evaluated before each of its own inference turns; a harness-brained supervisor is evaluated on
each worker settle, and a stop aborts its stop signal so the harness ends at its next turn
boundary. Both arms fold the same settled ledger through the same evaluator.

Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
`noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
only (unchanged behavior).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`stopRule`](runtime.md#stoprule-2)

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
 reason instead of inferring an early stop from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`onProgressStop`](runtime.md#onprogressstop-1)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxDepth`](runtime.md#maxdepth-3)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
 driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
 stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
 boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
 pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
 arm's default cap, and no turn cap on the harness arm.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxTurns`](runtime.md#maxturns-2)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](runtime.md#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
 a harness owns its own context window and its own compaction, so this is refused for a
 harness-brained supervisor rather than silently ignored): once its coordination transcript
 exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
 re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
 to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
 Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`compaction`](runtime.md#compaction-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`finalizer`](runtime.md#finalizer-1)

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

### SuperviseTestOptions

Test-only one-call shape, exported only through the package's explicit `/testing` entry.

#### Extends

- [`SuperviseOptions`](runtime.md#superviseoptions)

#### Properties

##### budget

> `readonly` **budget**: [`Budget`](index.md#budget-4)

The conserved compute pool for the whole run.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`budget`](runtime.md#budget-15)

##### rootHandle?

> `readonly` `optional` **rootHandle?**: [`RootHandle`](runtime.md#roothandle-2)\<`unknown`\>

Caller-created live handle for observing, steering, or cancelling this root manager. Runtime
attaches it before execution and detaches it after the join barrier.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`rootHandle`](runtime.md#roothandle-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`execution`](runtime.md#execution-2)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDeliverable`](runtime.md#resolvedeliverable-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`coordination`](runtime.md#coordination-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`peerMail`](runtime.md#peermail-1)

##### makeWorkerAgent?

> `readonly` `optional` **makeWorkerAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Override the worker seam directly (tests / advanced) instead of deriving it from `backend`.
 This is caller-owned execution: profile security, spawn authorization, and recursive-driver
 selection below apply only to the backend-derived worker path. `authorizeMessage` still
 governs continuations sent through Runtime's coordination tools.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`makeWorkerAgent`](runtime.md#makeworkeragent-1)

##### makeLeafAgent?

> `readonly` `optional` **makeLeafAgent?**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Override ONLY how an authorized LEAF executes, keeping the whole backend-derived path —
 profile security, spawn authorization, recursive-driver selection, nested supervisors — in
 force. Unlike `makeWorkerAgent`, which replaces that path, this slots inside it: the kernel
 authorizes and classifies every spawn, and a child that is NOT a driver runs through this
 factory instead of `backend`. A child that IS a driver still becomes a nested supervisor, whose
 own leaves use this same factory. Composes with `authorizeSpawn`; `backend` is then optional.
 This is the seam an offline test or a pinning layer (an agent graph) should use.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`makeLeafAgent`](runtime.md#makeleafagent-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`profileSecurity`](runtime.md#profilesecurity-1)

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

###### analyst?

`string`

Present (as the analyst id) only when the runtime's analyst-on-settle hook initiated this
 spawn — authored by the runtime, never accepted from a driver's tool arguments. A node-pinning
 authority reads it to admit the analyst node it would refuse as a driver-authored spawn.

###### continuity?

[`ContinuityMode`](runtime.md#continuitymode)

The EFFECTIVE continuity of this spawn, resolved by the coordination layer.

###### Returns

[`AuthorizedSpawn`](runtime.md#authorizedspawn)

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`authorizeSpawn`](runtime.md#authorizespawn-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`isDriverProfile`](runtime.md#isdriverprofile-1)

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](runtime.md#routertransportconfig)

The supervisor's router substrate (`profile.harness` omitted or `cli-base`). The profile's
 model wins.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`router`](runtime.md#router-5)

##### rootDriverFromBackend?

> `readonly` `optional` **rootDriverFromBackend?**: `boolean`

When `driverBackend` is absent, whether an external-harness ROOT may default to running on
 `backend` (where workers run). `true` (default) keeps the convenience every direct caller has.
 A layer that gives `backend` a narrower meaning — `runGraph`, where it places WORKER nodes only
 — sets `false`, so an external root without an explicit `driverBackend` is refused before any
 compute rather than silently driven from the worker placement.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`rootDriverFromBackend`](runtime.md#rootdriverfrombackend)

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](runtime.md#driveharness-2)

Run an external-harness supervisor explicitly. Required for a remote sandbox; optional as a
 caller-owned override for a local bridge.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarness`](runtime.md#driveharness-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`driverRetry`](runtime.md#driverretry-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`onDriverAttempt`](runtime.md#ondriverattempt-1)

##### childSettleGraceMs?

> `readonly` `optional` **childSettleGraceMs?**: `number`

How long live children may keep running after the ROOT DRIVER FAILED, before the join barrier
cascades the abort into them. A root that died did not make its children unhealthy: a child
mid-unit holds work already paid for, and an immediate cascade discards everything it has not
yet written. Bounded by the run's own deadline. Omit/`0` = immediate teardown.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`childSettleGraceMs`](runtime.md#childsettlegracems-1)

##### resolveDriveHarness?

> `readonly` `optional` **resolveDriveHarness?**: [`ResolveDriveHarness`](runtime.md#resolvedriveharness-2)

Resolve one custom external-harness session per trusted manager identity. Use this instead of
`driveHarness` when recursive managers must be independently steerable.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveDriveHarness`](runtime.md#resolvedriveharness-1)

##### driveHarnessMaterialization?

> `readonly` `optional` **driveHarnessMaterialization?**: [`ProfileMaterializationContract`](agent.md#profilematerializationcontract)

Required with a custom `driveHarness` or `resolveDriveHarness`: declares which complete
AgentProfile axes that path really applies. Built-in bridge driving supplies its own
full-profile contract.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`driveHarnessMaterialization`](runtime.md#driveharnessmaterialization-1)

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](runtime.md#resolvesupervisortools-2)

Resolve product-owned tools from the exact trusted manager context. The same descriptors and
handlers are bound to router and external-harness managers; resolution happens once per node.
Each handler receives that manager scope's live cancellation signal in its trusted invocation
context, including recursive parent and root cascades, plus `context.verbs` — that manager's
own coordination verbs, callable in code so a product tool can COMPOSE its children (fan out,
chain, join, retry) in one tool call instead of one model turn per verb. Every verb crosses
the same authorizeSpawn / security / allowedModels gate, pool reservation, `maxLiveWorkers`
cap, journal, and bus the MCP verb crosses, at every depth and on both arms.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`resolveSupervisorTools`](runtime.md#resolvesupervisortools-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`extraTools`](runtime.md#extratools-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`executeExtraTool`](runtime.md#executeextratool-1)

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

##### runDir?

> `readonly` `optional` **runDir?**: `string`

Make the run DURABLE: journal + result blobs + the coordination side-log are file-backed under
this directory (`createFileRunContext`), fsynced per write, and the supervisor reads the prior
tree first. Re-running with the same `runDir` AND the same `runId` resumes only when the exact
root profile/task identity and declared budget match. The original absolute deadline and prior
measured spend are restored before new admission. The built-in driver is resume-aware: children
that already settled, including their exact execution identities, are replayed onto
`Scope.resume` (and into the driver's settled ledger + its first context), keyed assignments
(`spawn_agent`'s `key`) resolve to their committed results instead of re-running, pending
waits re-arm on their original deadlines, and the coordination log loads prior questions,
findings, and instruction receipts. The router arm receives all three in its resume brief; the
external arm seeds prior questions while findings and receipts remain in the durable log.
Instruction receipts are evidence and are never delivered automatically to a replacement
worker. The final result spans both processes' work. Unset = in-memory, fresh every call.

The boundary that remains: work that was IN FLIGHT when the process died is not recovered —
the built-in executors cannot re-attach to a dead process's executions. Each such assignment
resumes as explicitly lost/in-doubt, its full declared reservation is charged conservatively,
and its token/dollar telemetry remains unknown. A retry is admitted only from safely remaining
capacity, so restart cannot mint a fresh budget or slide the original absolute deadline.

`runId` matters here: it defaults to the constant `'supervise'`, which is fine for a single
resumable run per directory but collides across concurrent runs sharing one `runDir`.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`runDir`](runtime.md#rundir-2)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`probes`](runtime.md#probes-3)

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](runtime.md#stoprule-1)

PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped LEARNING before it
exhausts a ceiling — the answer to "a run should end because it is done or stuck, not because
it ran out". It composes with the budget guards and can never override one.

The evaluation boundary differs by arm because the loop does: a router-brained supervisor is
evaluated before each of its own inference turns; a harness-brained supervisor is evaluated on
each worker settle, and a stop aborts its stop signal so the harness ends at its next turn
boundary. Both arms fold the same settled ledger through the same evaluator.

Build it from `supervise/stop-rules`: `plateau({window, minDelta})`,
`noProgressFor({ms, settles})`, `allWorkersStalled({...})`, combined with `anyOf`/`allOf`. The
thresholds are policy and stay with you; the enforcement lives in the runtime. Omit = ceilings
only (unchanged behavior).

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`stopRule`](runtime.md#stoprule-2)

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run (BOTH arms) — so a caller records the
 reason instead of inferring an early stop from an unexhausted budget.

###### Parameters

###### reason

`string`

###### Returns

`void`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`onProgressStop`](runtime.md#onprogressstop-1)

##### maxDepth?

> `readonly` `optional` **maxDepth?**: `number`

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxDepth`](runtime.md#maxdepth-3)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Turn cap for the supervisor's OWN loop (BOTH arms). Router arm: inference turns of the
 driver's tool loop. Harness arm: turns the harness reports, counted off its `iteration`
 stream — reaching the cap aborts the stop signal, so the harness ends at its next turn
 boundary rather than mid-request. `0` lifts the cap on both arms and leaves the conserved
 pool, the deadline, and abort as the bounds; a negative value is refused. Omit = the router
 arm's default cap, and no turn cap on the harness arm.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`maxTurns`](runtime.md#maxturns-2)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](runtime.md#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY —
 a harness owns its own context window and its own compaction, so this is refused for a
 harness-brained supervisor rather than silently ignored): once its coordination transcript
 exceeds `thresholdTokens` it distills to a compact progress note and continues, instead of
 re-billing the whole transcript every turn (the cost that makes the LLM-brain front door lose
 to a dumb-Ralph respawn). The live `Scope` roster is the durable state across chapters.
 Default off. `distill` defaults to a brain self-summary + the settled-worker roster.

###### Inherited from

[`SuperviseOptions`](runtime.md#superviseoptions).[`compaction`](runtime.md#compaction-1)

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

[`SuperviseOptions`](runtime.md#superviseoptions).[`finalizer`](runtime.md#finalizer-1)

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

##### brain

> `readonly` **brain**: [`ToolLoopChat`](runtime.md#toolloopchat)

***

### SupervisorAgentTestDeps

Test-only dependency shape. It is exported only through the package's explicit `/testing`
entry; production supervisor surfaces cannot replace profile-derived model execution.

#### Extends

- [`SupervisorAgentDeps`](runtime.md#supervisoragentdeps)

#### Properties

##### blobs

> `readonly` **blobs**: [`ResultBlobStore`](runtime.md#resultblobstore)

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`blobs`](runtime.md#blobs-5)

##### makeWorkerAgent

> `readonly` **makeWorkerAgent**: [`MakeWorkerAgent`](runtime.md#makeworkeragent)

Resolve a spawned worker `profile` to a leaf agent — the recursion seam (same for both arms).

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`makeWorkerAgent`](runtime.md#makeworkeragent-2)

##### authorizeDownMessage?

> `readonly` `optional` **authorizeDownMessage?**: [`AuthorizeDownMessage`](runtime.md#authorizedownmessage)

Product authorization for every down-leg continuation to a child.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`authorizeDownMessage`](runtime.md#authorizedownmessage-1)

##### perWorker

> `readonly` **perWorker**: [`Budget`](index.md#budget-4)

Per-child budget reserved from the conserved pool on each spawn.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`perWorker`](runtime.md#perworker-2)

##### onProviderModel?

> `readonly` `optional` **onProviderModel?**: (`model`) => `void`

Runtime-owned sink for provider identity observed by this manager's own turns.

###### Parameters

###### model

`string` \| `undefined`

###### Returns

`void`

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`onProviderModel`](runtime.md#onprovidermodel)

##### deliverable?

> `readonly` `optional` **deliverable?**: [`DeliverableSpec`](runtime.md#deliverablespec)\<`unknown`\>

Independent completion check for direct driver work (`submit_result`).

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`deliverable`](runtime.md#deliverable-5)

##### maxLiveWorkers?

> `readonly` `optional` **maxLiveWorkers?**: `number`

Hard cap on simultaneously-LIVE workers across both arms — `spawn_agent` fails closed once
 this many are in flight (a concurrency fence on top of the conserved-pool fence; bounds live
 boxes/sandboxes, not total work). Omit/`<= 0` = no cap.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`maxLiveWorkers`](runtime.md#maxliveworkers-5)

##### router?

> `readonly` `optional` **router?**: [`RouterTransportConfig`](runtime.md#routertransportconfig)

Router substrate for a router-brained supervisor (`harness` omitted or `cli-base`). The
 profile's model wins.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`router`](runtime.md#router-6)

##### driveHarness?

> `readonly` `optional` **driveHarness?**: [`DriveHarness`](runtime.md#driveharness-2)

Required to run an external-harness supervisor: runs the harness as the driver.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`driveHarness`](runtime.md#driveharness-4)

##### driverRetry?

> `readonly` `optional` **driverRetry?**: [`DriverRetryPolicy`](runtime.md#driverretrypolicy)

How hard a transiently-failed EXTERNAL driver is re-entered before the run ends
 `driver-failed` (#741). Retries reuse the same scope, coordination server, and live children;
 the bridge backend reattaches the harness session by its durable execution id. Omit = retry
 under the defaults; `{ enabled: false }` = the historical first-failure-ends-the-run behavior.
 The router arm is unaffected: its transport already retries.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`driverRetry`](runtime.md#driverretry-2)

##### onDriverAttempt?

> `readonly` `optional` **onDriverAttempt?**: (`record`) => `void` \| `Promise`\<`void`\>

Per-attempt record for the external driver — how an operator sees "failed after N attempts"
 instead of one backend's last words.

###### Parameters

###### record

[`DriverAttemptRecord`](runtime.md#driverattemptrecord)

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`onDriverAttempt`](runtime.md#ondriverattempt-2)

##### nodeContext?

> `readonly` `optional` **nodeContext?**: [`SupervisorNodeContextSeed`](runtime.md#supervisornodecontextseed)

Trusted identity for this manager. Required with node-scoped tools or observation.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`nodeContext`](runtime.md#nodecontext)

##### resolveSupervisorTools?

> `readonly` `optional` **resolveSupervisorTools?**: [`ResolveSupervisorTools`](runtime.md#resolvesupervisortools-2)

Resolve product-owned tools for this exact manager. Static `extraTools` remain a router-only
 compatibility seam and deliberately receive no new recursive authority.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`resolveSupervisorTools`](runtime.md#resolvesupervisortools-3)

##### observeNodeEvent?

> `readonly` `optional` **observeNodeEvent?**: [`ObserveSupervisorNodeEvent`](runtime.md#observesupervisornodeevent)

Awaited product observation, enriched with this manager's actual live node context.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`observeNodeEvent`](runtime.md#observenodeevent)

##### replaySettlements?

> `readonly` `optional` **replaySettlements?**: `boolean`

Replay resume-time settlements through `observeNodeEvent` before the manager starts.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`replaySettlements`](runtime.md#replaysettlements)

##### extraTools?

> `readonly` `optional` **extraTools?**: readonly `object`[]

WORK tools the supervisor may call DIRECTLY (router arm) — so it can do simple work ITSELF and
 only delegate when it needs parallelism. Pair with `executeExtraTool`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`extraTools`](runtime.md#extratools-2)

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

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`executeExtraTool`](runtime.md#executeextratool-2)

##### analysts?

> `readonly` `optional` **analysts?**: [`AnalystRegistry`](index.md#analystregistry)

Analyst lenses available to the driver (both arms). Required for `analyzeOnSettle`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`analysts`](runtime.md#analysts-4)

##### analyzeOnSettle?

> `readonly` `optional` **analyzeOnSettle?**: readonly (`string` \| [`AnalyzeOnSettleRoute`](runtime.md#analyzeonsettleroute))[]

Analyst kinds run on each worker-settle → a `finding` the driver composes its next steer from
 (the self-improving UP-leg). Unset/empty = status quo (no analyst feed). Requires `analysts`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`analyzeOnSettle`](runtime.md#analyzeonsettle-1)

##### watchWorkers?

> `readonly` `optional` **watchWorkers?**: [`WorkerWatchOptions`](runtime.md#workerwatchoptions)

Run the ONLINE detector panel over each worker's LIVE tool trace (both arms) so the driver
 learns a worker is looping mid-run instead of at settle. Omit = no online watching.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`watchWorkers`](runtime.md#watchworkers-2)

##### stallAfterMs?

> `readonly` `optional` **stallAfterMs?**: `number`

Idle time after which `observe_agent` reports a worker as stalled. Omit = runtime default.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`stallAfterMs`](runtime.md#stallafterms-4)

##### continuityByProfile?

> `readonly` `optional` **continuityByProfile?**: `Readonly`\<`Record`\<`string`, [`ContinuityMode`](runtime.md#continuitymode)\>\>

Default continuity per worker PROFILE NAME (both arms) — `'resume'` re-attaches spawns of
 that name to the node's latest settled worker; `spawn_agent`'s per-call `continuity`
 overrides. Omit = every spawn fresh (status quo).

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`continuityByProfile`](runtime.md#continuitybyprofile-1)

##### stopRule?

> `readonly` `optional` **stopRule?**: [`StopRule`](runtime.md#stoprule-1)

PROGRESS-derived stop rule (BOTH arms). Ends a run that has stopped learning BEFORE it
 exhausts a ceiling; it can never keep a run alive past one. Router arm: evaluated before each
 driver inference turn. External arm: evaluated on each worker settle, and a stop aborts
 `stopSignal` so the harness ends at its next turn boundary. Build it with `plateau` /
 `noProgressFor` / `allWorkersStalled` from `supervise/stop-rules` — the thresholds are the
 caller's judgment. Omit = ceilings only.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`stopRule`](runtime.md#stoprule-3)

##### onProgressStop?

> `readonly` `optional` **onProgressStop?**: (`reason`) => `void`

One-shot notification of WHY a `stopRule` ended the run (BOTH arms).

###### Parameters

###### reason

`string`

###### Returns

`void`

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`onProgressStop`](runtime.md#onprogressstop-2)

##### maxTurns?

> `readonly` `optional` **maxTurns?**: `number`

Turn cap for the supervisor's own loop. Router arm: driver inference turns (see
 `DriverAgentOptions.maxTurns`). External arm: the cap belongs to the harness loop, so
 `supervise()` applies it in the drive seam it builds and this field is not read here.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`maxTurns`](runtime.md#maxturns-3)

##### compaction?

> `readonly` `optional` **compaction?**: [`ToolLoopCompactionOptions`](runtime.md#toolloopcompactionoptions)

Give the supervisor brain a chapter-lifecycle on its OWN context window (ROUTER ARM ONLY; a
 harness-brained supervisor is refused at construction rather than silently ignoring it) — it
 distills its coordination transcript to a compact progress note once it exceeds the threshold,
 instead of re-billing the whole thing every turn. See `DriverAgentOptions.compaction`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`compaction`](runtime.md#compaction-2)

##### onEvent?

> `readonly` `optional` **onEvent?**: (`event`, `record`) => `void` \| `Promise`\<`void`\>

Pass-through subscriber for every coordination bus event (both arms) — the seam a durable
 caller hooks its coordination log onto.

###### Parameters

###### event

[`CoordinationEvent`](index.md#coordinationevent)

###### record

[`BusRecord`](runtime.md#busrecord)\<[`CoordinationEvent`](index.md#coordinationevent)\>

###### Returns

`void` \| `Promise`\<`void`\>

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`onEvent`](runtime.md#onevent)

##### priorCoordination?

> `readonly` `optional` **priorCoordination?**: [`PriorCoordination`](runtime.md#priorcoordination)

Questions, findings, and authorized continuation receipts loaded from a prior process.
 Router arm: questions seed the ledger and all evidence enters the resume brief. External arm:
 questions seed the ledger; receipts remain durable evidence and are never auto-delivered.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`priorCoordination`](runtime.md#priorcoordination-1)

##### loadPriorCoordination?

> `readonly` `optional` **loadPriorCoordination?**: () => `Promise`\<[`PriorCoordination`](runtime.md#priorcoordination)\>

Deferred owner-scoped replay for a recursive supervisor. Its stable owner is known while the
parent authorizes the child, but loading remains asynchronous; Runtime calls this before the
nested brain can publish or act on coordination state.

###### Returns

`Promise`\<[`PriorCoordination`](runtime.md#priorcoordination)\>

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`loadPriorCoordination`](runtime.md#loadpriorcoordination)

##### finalizer?

> `readonly` `optional` **finalizer?**: [`SupervisorFinalizer`](index.md#supervisorfinalizer)

How the settled ledger becomes the run's output (both arms). Default `bestDelivered` — the
 exact keep-best every existing caller had. Always runs under the delivered-only invariant.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`finalizer`](runtime.md#finalizer-2)

##### coordination?

> `readonly` `optional` **coordination?**: [`CoordinationBinding`](runtime.md#coordinationbinding)

Where the coordination MCP binds (external arm). Omit = an ephemeral loopback port, which is
 unreachable from an off-host harness. A non-loopback host fails closed — see
 [assertCoordinationBinding](runtime.md#assertcoordinationbinding).

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`coordination`](runtime.md#coordination-2)

##### preflightSpawn?

> `readonly` `optional` **preflightSpawn?**: [`SpawnPreflight`](runtime.md#spawnpreflight)

OPT-IN async gate run before every spawn mints an assignment or reserves budget — the one
 pre-journal point that may ask the backend a question (does this bridge route the child's
 wire id; is it already at admission capacity). `supervise` derives one automatically for a
 bridge backend; see `CoordinationToolsOptions.preflightSpawn`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`preflightSpawn`](runtime.md#preflightspawn)

##### peerMail?

> `readonly` `optional` **peerMail?**: `boolean` \| \{ `limits?`: `Partial`\<[`PeerMailLimits`](runtime.md#peermaillimits)\>; \}

OPT-IN peer mail (external arm): serve the sibling `send_mail` / `read_mail` post office
 beside the coordination MCP and mint each spawn a capability URL on
 `WorkerSpawnContext.peerMailUrl`. A router-brained supervisor is refused: it serves no
 listener, so there is no post office a worker could reach.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`peerMail`](runtime.md#peermail-2)

##### controlDir?

> `readonly` `optional` **controlDir?**: `string`

The durable run directory this manager acknowledges worker-scoped cancel requests from
 (router arm only — the in-process turn loop is the acknowledger). See
 `DriverAgentOptions.controlDir`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`controlDir`](runtime.md#controldir)

##### controlScope?

> `readonly` `optional` **controlScope?**: `"run"` \| `"subtree"`

Which cancel requests this manager's acknowledger owns: `'run'` (default; the tree root —
 its own direct-child node ids plus label/profile-name references) or `'subtree'` (a nested
 manager — exact direct-child node ids only). Exactly one manager owns any request, so two
 acknowledgers can never apply one operation. See `DriverAgentOptions.controlScope`.

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`controlScope`](runtime.md#controlscope)

##### abortRun?

> `readonly` `optional` **abortRun?**: (`reason`) => `void`

Abort the whole run — the seam a run-scoped cancel request is applied through (router arm,
 `'run'` scope only). See `DriverAgentOptions.abortRun`.

###### Parameters

###### reason

`string`

###### Returns

`void`

###### Inherited from

[`SupervisorAgentDeps`](runtime.md#supervisoragentdeps).[`abortRun`](runtime.md#abortrun)

##### brain

> `readonly` **brain**: [`ToolLoopChat`](runtime.md#toolloopchat)

***

### AgentProfileImprovementFixture

Complete private state for exercising profile activation and restore in consumer tests.

#### Properties

##### proposal

> **proposal**: [`AgentProfileImprovementProposalFixture`](#agentprofileimprovementproposalfixture)

##### baselineProfile

> **baselineProfile**: `AgentProfile`

##### candidateProfile

> **candidateProfile**: `AgentProfile`

##### recommendedSize

> **recommendedSize**: `"nano"` \| `"small"` \| `"medium"` \| `"large"`

## Type Aliases

### AgentProfileImprovementProposalFixture

> **AgentProfileImprovementProposalFixture** = `Omit`\<`AgentImprovementProposal`, `"evaluation"`\> & `object`

A proposal produced by Runtime's opaque profile-improvement path.

#### Type Declaration

##### evaluation

> **evaluation**: `AgentProfileImprovementMeasuredComparison`

## Functions

### driverAgent()

> **driverAgent**(`opts`): [`Agent`](runtime.md#agent-2)\<`unknown`, `unknown`\>

Build the intelligent recursive driver. Its `act` is the LLM tool-loop; spawn it as a
`driverChild` (`driver-executor.ts`) to run it inside a nested scope, recursively.

#### Parameters

##### opts

[`DriverAgentOptions`](#driveragentoptions)

#### Returns

[`Agent`](runtime.md#agent-2)\<`unknown`, `unknown`\>

***

### runGraphWithTestBrain()

> **runGraphWithTestBrain**(`graph`, `opts`): `Promise`\<[`GraphResult`](runtime.md#graphresult)\<`unknown`\>\>

Alias for graph tests written before `RunGraphOptions.brain` was production. The production
 entry accepts the same shape; this wrapper only keeps the `/testing` import path working.

#### Parameters

##### graph

[`AgentGraph`](runtime.md#agentgraph)

##### opts

[`RunGraphTestOptions`](#rungraphtestoptions)

#### Returns

`Promise`\<[`GraphResult`](runtime.md#graphresult)\<`unknown`\>\>

***

### superviseWithTestBrain()

> **superviseWithTestBrain**(`profile`, `task`, `opts`): `Promise`\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>

Deterministic scripted-brain path for tests. Not exported from Runtime's main entry.

#### Parameters

##### profile

`AgentProfile`

##### task

`unknown`

##### opts

[`SuperviseTestOptions`](#supervisetestoptions)

#### Returns

`Promise`\<\{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"budget-exhausted"` \| `"all-children-down"` \| `"aborted"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error?`: `undefined`; \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"no-winner"`; `reason`: `"driver-failed"`; `tree`: [`TreeView`](runtime.md#treeview); `downCount`: `number`; `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `error`: [`NoWinnerError`](runtime.md#nowinnererror); \} \| \{ `rootProviderModel`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `kind`: `"winner"`; `out`: `unknown`; `outRef`: `string`; `verdict?`: `DefaultVerdict`; `tree`: [`TreeView`](runtime.md#treeview); `spentTotal`: [`Spend`](index.md#spend); `providerModel?`: [`ProviderModelExecutionEvidence`](index.md#providermodelexecutionevidence); `teardownUnconfirmed?`: readonly [`UnconfirmedTeardown`](runtime.md#unconfirmedteardown)[]; `spendGaps?`: readonly [`SpendGap`](index.md#spendgap)[]; `spentBreakdown?`: \{ `driverInference`: [`Spend`](index.md#spend); `childWork`: [`Spend`](index.md#spend); \}; \}\>

***

### supervisorAgentWithTestBrain()

> **supervisorAgentWithTestBrain**(`profile`, `deps`): [`Agent`](runtime.md#agent-2)\<`unknown`, `unknown`\>

Scripted-brain construction for deterministic tests. Not exported from Runtime's main entry.

#### Parameters

##### profile

`AgentProfile`

##### deps

[`SupervisorAgentTestDeps`](#supervisoragenttestdeps)

#### Returns

[`Agent`](runtime.md#agent-2)\<`unknown`, `unknown`\>

***

### loadAgentImprovementProposalFixture()

> **loadAgentImprovementProposalFixture**(): `AgentImprovementProposal`

Load an isolated, production-validated Runtime proposal for consumer tests.

#### Returns

`AgentImprovementProposal`

***

### loadAgentProfileImprovementFixture()

> **loadAgentProfileImprovementFixture**(): [`AgentProfileImprovementFixture`](#agentprofileimprovementfixture)

Load an isolated profile proposal and its private activation state for consumer tests.

#### Returns

[`AgentProfileImprovementFixture`](#agentprofileimprovementfixture)

## References

### ToolLoopCallContext

Re-exports [ToolLoopCallContext](runtime.md#toolloopcallcontext)

***

### ToolLoopChat

Re-exports [ToolLoopChat](runtime.md#toolloopchat)
