# Changelog

## 0.134.2

- Make the supervised token charge additive: `input - cacheRead + output`, which equals `freshInput + cacheWrite + output` under a complete cache split. A spend that folded a classified turn together with an unclassified one previously fell back to the rolled-up prompt total for the whole aggregate, so one unreported turn re-charged every cached prefix beside it.
- Credit no cache read whose reported classes do not fit inside the prompt total they partition, at the record AND in the fold: `addTokenUsage` no longer accumulates the classes of a turn that overflowed its own `input`, because the accumulator's larger total would otherwise absorb the overflow and charge the aggregate less than its records. The charge is never below the output tokens, and a zero prompt total charges no prompt tokens.
- The token channel trusts a reported cache read the same way it trusts a reported `input`. It is an accounting unit, not a trust boundary against a provider that misreports its own usage.
- Accept a `Spend` whose cache classes cover only part of `input` when it carries `cacheBreakdownKnown: false`. Requiring an exact partition there rejected the shape aggregation produces, and a resumed pool restored from such a record failed at construction. Classes that EXCEED `input` are still refused, and a spend claiming a complete split must still partition `input` exactly.
- `equalKOnCost` now rates a rolled-up arm at what the pool charged it, including trees where one node reported no cache split.

## 0.134.1

- Preserve a cli-bridge root's known profile materialization when Runtime exhausts the token budget after the bridge emits its terminal receipt.
- An accepted `submit_result` winner and the original budget diagnostic now survive together.
- Consumers that read failed-run trees must keep using a known materialization receipt when the result is `budget-exhausted`; they must not replace it with `unknown`.

## 0.134.0

- BEHAVIOR CHANGE: the supervised token budget now charges each token once, when it first enters the context — `freshInput + cacheWrite + output`. It previously charged the rolled-up prompt total, which counts a cached prefix again on every turn that reads it.
- Your existing `maxTokens` numbers are unchanged, but the unit they measure is not. On a 299-run fleet cache was 98.2% of the counted prompt total, so a run that died at about 1.8% of its declared budget now gets the budget it declared.
- Migration: a caller who lowered `maxTokens` to compensate for the old inflation will get much longer runs. Re-derive that ceiling from newly-presented tokens before the next campaign.
- `BudgetReadout` and `Scope.budget` gain `cacheBreakdownKnown`. It reads false once the pool charged a spend whose cache split it could not read; `tokensLeft` is then an upper bound on newly-presented work, not a measurement. A provider that reports no split still spends against the cap, exactly as an unreported token count does.
- `equalKOnCost` compares arms on the same charged unit, so two arms doing identical new work no longer read as unequal compute because their cache hit rates differed.
- The token cap no longer bounds the cost of cache reads. Dollars are bounded only by `maxUsd`, which is optional and unset on nearly every run today — budget it explicitly when cost matters.

## 0.133.8

- Stop an external supervisor's active harness after `submit_result` accepts a result or `stop` declares completion.
- Custom `DriveHarness` implementations should honor the new `stopSignal` so they stop provider work after completion.

## 0.133.7

- Preserve cli-bridge profile materialization receipts when a terminal provider error follows the receipt.
- Emit an explicit unknown dollar-usage event when a bridge turn has no trusted billed-cost receipt.
- Retry only an explicit `candidate_grant_draining` settlement response until the caller deadline.
- Consumers that require exact dollar settlement must treat `usdKnown: false` as unknown until a trusted provider or billing receipt is available.

## 0.133.6

- The direct protected model-grant port accepts an optional caller-declared `maxTotalTokens` cap across input and output tokens.
- Bind that cap into the exact reservation response and reject a final ledger that exceeds it or omits token usage.
- Signed execution plans in the Interface 0.47 cohort remain unchanged; only the direct protected model-grant port accepts this field.

## 0.133.3

- Preserve the provider-served model snapshot in official optimizer cost receipts so Eval can match the response, receipt, and execution evidence.

## 0.133.2

- Accept a routed response when its served-provider prefix differs from the profile's gateway prefix but its model name matches.
- Preserve the complete provider-qualified model and snapshot in execution evidence.
- Reject a different model name, a changed snapshot, or a missing snapshot when the profile pins one.

## 0.133.1

- Preserve provider-served model identity for every Runtime inference attempt, including paid executions that abort before terminal materialization.
- Keep provider identity separate from the planned materialization alias and replay it through settled tree records.
- Consumers that derive billing identity from supervised trees must use `providerModel` evidence and treat missing or conflicting attempts as unknown.

## 0.133.0

- Require an awaited `onAdmission` durability hook on `startRetainedRun`, called after environment creation and after dispatch, before the start promise resolves.
  Migration: every `startRetainedRun` caller must add `onAdmission` and persist each record before the hook returns.
- Mint deterministic dispatch identity from `(idempotencyKey, turnId)` when the caller omits `identity`, and verify after dispatch that the provider honored it; a mismatch fails with `RetainedRunDispatchBindingError` carrying the provider's returned reference.
- Add `recoverRetainedRun(...)`: from pre-dispatch admission coordinates it reports `recovered`, `not_found`, or `unverifiable`; `unverifiable` is never destroy-safe.
- Fail a start whose admission hook rejects with `RetainedRunAdmissionError` and keep the environment for recovery.
- Write the retained recovery keys into provider create metadata; the runtime keys overwrite same-named caller keys, and other caller keys stay preserved.

## 0.132.13

- Normalize official optimizer cost receipts to the requested profile model while preserving the provider-served identity in response evidence.

## 0.132.12

- Accept a provider-qualified served model when its base model and snapshot match the exact `AgentProfile` model.
- Use one model identity comparison for direct optimizer calls and recursive Eval dispatch.

## 0.132.11

- Consume Core 0.6.1, Eval 0.145.2, Interface 0.47.0, Knowledge 7.2.4, Profile Materialize 0.14.0, and Sandbox 0.21.1 as one compatible dependency set.
- Raise the Eval, Interface, and Sandbox peer ranges to the current shared release cohort.

## 0.132.10

- Send the request-scoped model gateway URL with its protected token on every bridge request and reconnect.
- Bind both protected credential digests to the durable bridge run identity.
- Reject token-only, changed-URL, and non-HTTPS protected routes without exposing secret values or private URL paths.

## 0.132.9

- Add `runProtectedAgentCandidateModelGrant(...)` for one bounded resolve, reserve, activate, execute, and settle lifecycle.
- Preserve callback and settlement failures together, and settle activated failures as `failed` or preparation failures as `preparation-failed`.

## 0.132.8

- Add request-scoped model credentials for loopback cli-bridge execution.
- Resolve the credential before each bridge POST and resend it after reconnect.
- Keep the credential value out of snapshots, artifacts, and errors.

## 0.132.7

- Make repeated finalization of the same root execution binding idempotent after a supported resume.
- Continue to reject a different binding for the same attempt as journal corruption.

## 0.132.6

- Settle moving model identities from provider receipts for external harness roots.
- Reject missing, bare, mixed, or mismatched root model evidence before Eval records a known receipt.

## 0.132.5

- Preserve the provider's served model and snapshot fingerprint in bridge execution receipts.
- Consume Agent Eval 0.145.0 and Agent Knowledge 7.2.3 as one compatible dependency set.

## 0.132.4

- Consume Agent Eval 0.144.13 and Agent Knowledge 7.2.2 as one compatible dependency set.

## 0.132.1

- Add `candidatePopulation` to `improve(...)` results so consumers can inspect every verified optimizer candidate, including its exact profile, Interface diffs, parent lineage, and selection score.
- Consume Agent Eval 0.144.12 and Agent Knowledge 7.2.1 as one compatible dependency set.

## 0.131.7

- Add `superviseDispatch(...)` so `agent-eval` profile matrices admit and record a recursive Runtime tree before it spends.
- Refuse a one-model Eval receipt when a supervised tree has mixed or unknown model identities.
- Preserve complete prompt cache read/write telemetry through bridge, supervisor, journal, and Eval cost receipts.
- Keep partial cache telemetry and missing token receipts explicit instead of treating them as zero.
- Consume Agent Eval 0.144.10 and Agent Knowledge 7.2.0.

## 0.131.6

- Consume Agent Eval 0.144.8 and Agent Knowledge 7.1.3 as one exact dependency set.

## 0.131.4

- Accept and preserve cli-bridge's positive applied completion-token cap in Runtime materialization evidence.
- Reject zero, negative, fractional, or non-numeric applied caps before the evidence enters the journal.

## 0.131.3

- Preserve cli-bridge inference transport and observation evidence in Runtime materialization receipts and journal digests.

## 0.131.2

- Forward each exact `AgentProfile` completion-token ceiling to every initial and resumed CLI bridge request.
- Record the ceiling in the planned execution evidence, while the conserved Runtime budget remains independent.

## 0.131.1

- Return scalar and array MCP tool results through text content, and reserve `structuredContent` for non-null JSON objects.
- Prove string and object responses over stdio with the official MCP SDK, and reject results that JSON cannot serialize.

## 0.131.0

- Consume agent-profile-materialize 0.13.1 and Sandbox 0.19.4 with Interface 0.46.1, Eval 0.144.6, and Knowledge 7.1.2.
- Bind candidate system-prompt launch controls through the native harness plan, including OpenCode's generated primary agent.
- Keep Codex and Gemini prompt delivery fail-closed, and preserve separate replacement and additive controls for Claude Code, Pi, and Prime.

## 0.130.0

### Stability contract + first graduation

[docs/STABILITY.md](./docs/STABILITY.md) defines what `@stable` / `@experimental` promise consumers, the graduation bar (substantive tests + a curated-doc section + at least one real consumer + a 30-day quiet API + a CHANGELOG graduation entry), and the demotion/removal policy. A symbol tag wins over its module tag; an untagged symbol in an untagged module is experimental by default. This entry is the initial graduation: each family below is promoted at its current post-0.129.0 exact-profile shape with the evidence that passed the bar, and the 30-day breaking-change clock applies to every `@stable` symbol from this release forward.

Promoted `@experimental` → `@stable` (per-symbol and module-level):

- `runAgentRounds` + the kernel contract (`Driver`, `Validator`, `OutputAdapter`, `Iteration`, `LoopResult`, `AgentRunSpec`, `SandboxClient`, `ExecCtx`, `LoopTraceEmitter`, `RunAgentRoundsOptions`, and the trace-event/provenance closure in `src/runtime/types.ts`) — tests: `tests/kernel/` (`run-loop-harden`, `loop-dispatch` + the kernel suite); doc: `docs/canonical-api.md`; consumers: `bench/src/research-shot.ts`, `bench/src/corpus.ts`.
- `supervise` / `Scope` / `Supervisor` (+ `createScope` / `createSupervisor` via their module tags) — tests: `tests/kernel/supervise.test.ts` (1,878 lines) + `coordination-driver` / `coordination-mcp`; docs: `docs/execution-model.md`, `docs/canonical-api.md`; consumers: `bench/src/gate.ts`, `examples/supervise`, `examples/supervisor-loop`.
- personify combinators `pipeline` / `fanout` / `loopUntil` / `panel` / `verify` / `widen` + `definePersona` / `runPersonified` — tests: `tests/kernel/personify.test.ts` (797 lines); doc: `docs/canonical-api.md`; consumers: `examples/graphs`, `bench/src/gate.ts`.
- the spawn journal family (`InMemorySpawnJournal`, `FileSpawnJournal`, `InMemoryResultBlobStore`, `FileResultBlobStore`, `replaySpawnTree`, the `SpawnForest*` views) — tests: `tests/runtime/spawn-journal-replay-identity.test.ts` + the kernel suite's journal assertions; doc: `docs/canonical-api.md`; consumers: `bench/src/gate.ts`, `examples/recursive-supervisor`.
- the `/mcp` delegation queue + stores + status tools (`DelegationTaskQueue`, the delegation store, the feedback store, `delegate`, `delegation_status`, `delegation_history`, `delegate_feedback`) — tests: `tests/mcp/` (`task-queue`, `task-queue-durable`, `delegation-store`, `delegation-status`, `delegation-history`, `delegate`, `delegate-feedback`); doc: `docs/agent-managed-compute/current-state.md`; consumers: the shipped `agent-runtime-mcp` server (`src/mcp/server.ts`) + `examples/supervisor-loop/run-supervisor-mcp.ts`.
- `/intelligence` (all six module-tagged modules: the barrel, `capability`, `delivery`, `effort`, `resolver`, `with-intelligence`) — tests: in-package (`capability` / `delivery` / `intelligence` / `with-intelligence`, ~1,969 lines); doc: `docs/intelligence-sdk.md`, whose status has been "shipped" since it landed; consumers: `examples/intelligence-recommend`, `examples/intelligence-webcode`, `examples/intelligence-drop-in`, `examples/self-improving-loop`.
- the improvement generators (`improve`, the agentic generator, the improvement driver, the raw-trace distiller, the reflective generator) — tests: `src/improvement/improve.test.ts` (919 lines) + the in-package suite; doc: `docs/canonical-api.md`; consumers: `bench/src/swe-bench-env.ts`, `examples/improve`.
- `streamAgentTurn` / `collectAgentTurn` + the turn types (`AgentTurnBackend`, `AgentTurnInput`, `AgentTurnUsage`, `CollectedAgentTurn`, `StreamAgentTurnOptions`) — tests: `src/runtime/stream-agent-turn.test.ts` (690 lines); doc: `docs/canonical-api.md`; consumers: `bench/src/router-turn.ts`, `bench/src/benchmarks/appworld.ts`, `examples/chat-handler`, `examples/runtime-run`.

Kept `@experimental`, each with the failing check:

- `Scope.resume` / `SupervisorOpts.resume` and `EventBus` / `createEventBus`: same-process replay only — live supervised-tree recovery after a coordinator restart and the durable cross-process mailbox are listed Not implemented in `docs/agent-managed-compute/README.md`.
- The detached/worktree delegation leaves (`src/mcp/delegates.ts`, `detached-coder`, `detached-turn`, the worktree harnesses, `local-harness`): the module doc records the unfinished `driveTurn`-over-a-detached-session resume path.
- The coordination MCP (`src/mcp/tools/coordination.ts`, `src/runtime/supervise/coordination-mcp.ts`): authenticated remote coordination is Not implemented.
- `LoopLineageOptions` / `RunAgentRoundsOptions.lineage` and the member-level extension points `Driver.selectWinner`, `SandboxClient.criuStatus`, `ExecCtx.onSandboxEvent`: opt-in surfaces whose platform contracts (session continuity, CRIU fork) are still being proven.

Newly tagged `@experimental` (previously untagged, unfinished):

- `src/agent/define-agent.ts` — manifests validate and load, but `runtime.act` is not wired end-to-end into the eval path (`unimplementedAgentRun` is the shipped default).
- `src/runtime/strategy-evolution.ts` — the multi-generation strategy search, a research surface.
- the `/candidate-execution` subpath barrel.
- the supervisor restart-recovery and event-bus durability members listed under "kept" above, now tagged explicitly at the symbol level.

Maturity now renders in the generated reference: `tsdoc.json` extends TypeDoc's base tag definitions, and each subpath barrel carries `@module`, so `docs/api/<subpath>.md` shows the module-level `Stable` / `Experimental` badge directly under the page title. Module-level tags previously rendered nowhere in `docs/api`.

## 0.129.0

- Require Agent Eval 0.144.4, Agent Interface 0.43.1, Agent Knowledge 7.0.11, and Sandbox 0.19.1 as one dependency set, and route the official-optimizer callback through Runtime's exact `AgentProfile` execution path.
- Reject model, provider, reasoning, prompt, tool, resource, harness, and generation-setting conflicts before transport; consumers must declare those fields in the profile.
- Require `defineLeaderboard` callers to supply an exact `baseProfile`; remove its `modelBackend` override so each matrix cell's profile remains the only model authority.
- Require generic coder, researcher, and supervised-knowledge paths to receive complete profiles; remove harness/model overlays and MCP environment alias ladders.
- Resolve Sandbox execution only from `AgentProfile.harness`; a backend type may confirm that choice but cannot replace it.
- Parse, detach, and deeply freeze a complete `AgentProfile` before Scope, registry, nested-driver, or personified execution can honor any built-in or caller-supplied executor.
- Require `driverChild(profile, ...)` and `worktreeLoopRunner({ rootProfile, ... })`; remove name-only driver and personified-root shortcuts.
- Remove the public `runLocalHarness` process shortcut; use `createWorktreeCliExecutor({ profile, ... })` directly or `createExecutor({ backend: 'cli-worktree', ... })` inside a supervised run so the CLI and model derive from one exact `AgentProfile`.
- Keep missing token usage and billed cost unknown, and report reasoning-token usage when the provider supplies it.

### Removed public execution shortcuts

- Remove `driverLoopGenerator`, `DriverLoopGeneratorOptions`, `buildDriverSystem`, and `researchDriverNote`; use `improve({ surface: 'code', code: { profile, executorForWorktree, buildPrompt } })` or `agenticGenerator` so every authoring call uses the exact declared profile through Runtime.
- Remove `AGENTIC_PROFILE_RESOURCE_ROOT`; profile resources now travel inside the exact `AgentProfile` and Runtime materializes them at execution.
- Remove `AgentBackendKind`, `ResolveAgentBackendOptions`, `resolveAgentBackend`, `createOpenAICompatibleBackend`, and `BackendRetryPolicy`; select a built-in transport with `ExecutorConfig` and `createExecutor(...)`, bind it to an exact profile with `createProfileExecutionBackend(...)` for `runAgentTaskStream` or conversation APIs, or pass both directly to `streamAgentTurn`.
- Move retry configuration into `AgentProfile.model.metadata.retry`, including attempt count, per-attempt timeout, retryable status codes, exponential-backoff bounds, and jitter, so deleting the parallel backend API does not delete caller control.
- Remove the public Router chat and tool-loop API (`RouterConfig`, `RouterChatResult`, `RouterChatToolsResult`, `RouterToolCall`, `RouterToolLoopResult`, `routerChatWithUsage`, `routerChatWithTools`, `streamRouterChatWithTools`, `routerToolLoop`, and `routerBrain`); use `createExecutor(...)` plus `streamAgentTurn` and `collectAgentTurn`, use `ToolLoopToolCall` for the provider-neutral tool-call record, use `profileChatClient` for Eval integrations, or use `supervise(...)` for a profiled supervisor.
- Replace `ShotPersona` with `ShotSpec.profile`, which carries a complete exact profile instead of a prompt/model-only override.
- Remove `canonicalizeAuthoredProfile`; inputs must already satisfy `agentProfileSchema`, with no flat legacy spelling that Runtime silently repairs.
- Remove `authoredWorker`; use `workerFromBackend(...)`, which admits each complete profile through the same executor path as every other supervised worker.
- Remove the public `chatCompletionsTransport` constructor; inject an offline completion function through `ChatTransportExecutorOptions.complete`, or use an exact profile with `createExecutor(...)` for real execution.
- Remove `createPrimeIntellectBackend`; use `primeIntellectExecutorConfig(context)` with `createExecutor(...)`, then execute an exact profile through `streamAgentTurn` or bind it with `createProfileExecutionBackend(...)` when an `AgentExecutionBackend` is required.
- Remove `uiAuditorProfile`, `createInProcessUiAuditClient`, and their browser/judge option types; author a normal `AgentProfile`, execute it through Runtime, and keep using `UiAuditTask`, `encodeAuditTaskEnvelope`, `formatAuditorPrompt`, `parseAuditorEvents`, and `createUiAuditorValidator` from `/profiles`.
- Remove the bundled UI-audit example and the Playwright peer dependency because browser placement belongs to the caller-owned execution environment, not a profile-specific Runtime client.
- Remove direct model injection from `SuperviseOptions`, `RunGraphOptions`, and `SupervisorAgentDeps`, and remove `driverAgent`, `DriverAgentOptions`, and `ToolLoopChat` from `/kernel`; production supervisor calls now derive model execution only from the exact root `AgentProfile`, while deterministic scripted calls live under the explicit `/testing` entrypoint.
- Bind every root Router turn to one Runtime-authored cancellation signal, call id, and correlation id; preserve provider-observed model, prompt-cache, retry-attempt, reasoning-token, and billed-cost evidence; meter a mismatched model response before refusing its output; and reuse one nonempty idempotency key across all physical retries of the logical call.

## 0.128.0

### chat-transport executor: workers on a bare chat-completions transport

A first-class `Executor` whose runtime is a plain OpenAI-compatible `/v1/chat/completions` transport — the worker IS a model conversation, not a sandboxed process (#721).
What every offline test faked through `AgentSpec.executor` is now a shipped, supported leaf: node pinning, conserved spend, settle/verdict, and the journal + edge ledger all apply to a chat worker.

New kernel exports (`src/runtime/supervise/chat-transport-executor.ts`):

- `chatTransportExecutor(options): Executor<string>` — one `execute` is one conversation SHOT: seed (fresh system prompt, or a resumed session's recorded history) + the task as the next user message, then completion → host tool calls → tool messages until the model answers without a tool call (or `maxTurnsPerShot`, default 200). Settles with the final assistant text as `out`. NON-streaming by design: the streaming `UsageEvent` channel cannot mark an unmetered turn (`tokens` has no `tokensKnown: false` twin — the documented limitation in `supervise/types`), while the one-shot `Spend` carries both honesty markers.
- Metering honesty: tokens from the transport's `usage` fields (`tokensKnown: false` when a turn omits them); dollars ONLY from the response's own cost fields (`usage.cost` / `usage.cost_usd` — `usdKnown: false` when absent). Never estimated from a local price table: this executor speaks to arbitrary endpoints whose models no local table can price.
- Fail-loud: transport failures (non-2xx, network faults, malformed completions) throw `ValidationError` — the scope's INFRA settle class — never a fake success. The turns that DID run are still recorded first, because resume-after-failure is a kernel-supported path.
- `ChatTransportTool` — the optional tool table: the OpenAI function spec the model sees plus the host-side `execute`; unknown tools and malformed arguments are fed back to the model as tool messages, never thrown.
- `chatCompletionsTransport({ url, bearer })` — the one buffered wire function (also the executor's default transport), exported so a paired harness can drive two arms through the SAME instance; `ChatTransportExecutorOptions.complete` injects a scripted transport for fully-offline runs (mirrors `RouterConfig.complete`).
- **Session continuity** — the executor is the resume consumer the kernel's `continuity: 'resume'` contract calls for: `createChatSessionStore()` keeps conversation histories keyed by settled worker id, `resume: WorkerResumeContext` continues `ofWorker`'s exact recorded message list (fails loud before any spend when the store has none — the same process-local resume boundary the kernel documents), and the finished conversation is recorded under `sessionKey` for the next resume.
- `chatWorkerSeam(options): MakeWorkerAgent` — the session-owning worker seam `workerFromBackend` refuses to be: profile model/prompt (including a graph's appended delegates directive) drive each spawn, `WorkerSpawnContext.resume` re-attaches through the seam's store keyed by kernel node ids, and an optional `deliverable` gates each settle through the existing `gateOnDeliverable` (settled ⟺ delivered).

New example + proof: `examples/graphs/user-sim-conversation.ts` — a CONVERSATION as a graph: a simulated user is a NODE (persona profile as the root), the product agent is a chat-transport worker, each dialogue turn is one ledgered `delegates` traversal with `continuity: 'resume'`, and the offline test (`tests/examples/user-sim-conversation.test.ts`) asserts the resumed message-history chain on the requests CAPTURED at the wire (turn k = turn k−1's whole message list + the prior assistant reply + the new user turn), the `fresh`/`resume`/`resume` ledger stamps, the executor-seam lineage, and the metered spend in the one conserved pool.

P1 parity live path fixed (the three audited #710 gaps, `examples/p1-parity`):

- Both arms' coders now share ONE substrate: the multishot arm's transport and the graph arm's `chatTransportExecutor` speak the same bare chat-completions endpoint with the same wire model, and the parity delegates edge declares `continuity: 'resume'` so the graph arm's shots continue one session exactly as `runMultishot`'s single transcript does. As previously wired the graph arm spawned a full cli-bridge harness worker against the multishot arm's bare chat calls — a substrate gap that invalidated any live parity number.
- The live graph arm now HAS a driver: the `'chat'` graph backend requires the reviewer brain's `RouterConfig` (previously the live arm shipped with neither `brain` nor `router` and could not run).
- No silent model fallback anywhere: the coder model rides its profile, the driver model is explicit per-arm substrate config (`MultishotArmBackend.driverModel` / `RouterConfig.model`), and the live entry requires `VB_CLI_BRIDGE_URL`, `VB_CLI_BRIDGE_BEARER`, `VB_PARITY_MODEL`, `VB_PARITY_ROUTER_URL`, `VB_PARITY_ROUTER_KEY`, `VB_PARITY_DRIVER_MODEL` — a missing variable fails loud; `'parity/unspecified'` is gone.

## 0.127.0

### Continuity is a first-class axis of delegates traversals

Fresh respawns, session RESUMES, and live steers are now all expressible as plain data, each a ledgered fact.

A `delegates` edge may declare `continuity: 'fresh' | 'resume'` — the default mode for that edge's spawn traversals (`'fresh'` is today's behavior; an edge without the field behaves byte-identically).
With `'resume'`, every spawn after the node's first re-attaches to the node's most recent SETTLED worker: the kernel spawns a NEW live worker bound to the SAME node whose spawn context carries `resume: { ofWorker, sequence }` (`WorkerSpawnContext.resume`, typed `WorkerResumeContext`), and the executor seam (`makeWorkerAgent`) owns the actual session re-attachment — e.g. mapping `ofWorker` to a backend session id.
The kernel keeps identity, ordering, ledger truth, and spend continuity: the resumed worker reserves from the same conserved pool, the ledger row's `workerId` is the NEW live worker, and the lineage rides the spawn context and the journal.
Traversal caps count resumes exactly like fresh spawns.

`spawn_agent` accepts a per-call `continuity` override that wins over the edge default in either direction, and resume fails closed with an actionable error at the tool:

- `resume-no-prior` — an explicit resume of a node with no settled prior worker (spawn it fresh first; the DECLARED edge default instead degrades to `'fresh'` on the node's first spawn).
- `resume-while-live` — a prior worker of the node is still live; steer is the live-worker channel, and the error says so.
- `resume-with-key` — a semantic key makes an assignment run-once; resume explicitly runs the node again.

`EdgeTraversal` and the journal `edge` event gain `continuity: 'fresh' | 'resume' | 'steer'` — spawn traversals stamp their effective mode, and every mid-run delivery into an already-live recipient (a driver steer leg, every analyzes delivery) stamps `'steer'` — zero ambiguity in the ledger about how each hop continued.
`validateGraph` refuses nonsense continuity values and analyzes edges carrying the field (analysts are spawned by the analyst machinery; every analyst run is a fresh session over settled evidence).

Threading: `SuperviseOptions` / `SupervisorAgentDeps` / `DriverAgentOptions` / `serveCoordinationMcp` / `CoordinationToolsOptions` gain `continuityByProfile?: Readonly<Record<string, ContinuityMode>>` (the per-profile-name default `runGraph` derives from delegates edges), and the kernel entry exports `ContinuityMode`, `WorkerResumeContext`, and `TraversalContinuity`.
Known limit, stated where it lives: resume lineage is PROCESS-LOCAL (the same boundary as the analyst-run marker) — workers settled by a prior process of a durable run are not resume targets. The built-in backend seam (`workerFromBackend`) cannot re-attach sessions and FAILS LOUD on a `'resume'` spawn rather than ledgering a resume that never happened; session-resuming `makeWorkerAgent` seams are the resume consumers. Resume after a FAILED prior worker is deliberately allowed — a crashed session may still be resumable, and the executor seam decides.

New example: `examples/graphs/shot-loop-resumed.ts` — the VB shot shape as data (reviewer root, coder node, `continuity: 'resume'`, `maxTraversals: 3`): shot 1 spawns `fresh`, shots 2–3 resume the prior settled session, proven offline in `tests/examples/graph-topologies.test.ts`.

### Python bridge install hints match the required Eval substrate

The documented `agent-eval-rpc` install commands — the `OfficialOptimizerUnavailableError` hint, the README's `officialGepa`/`officialSkillOpt` sections, and the bench GEPA seat hint — now pin `0.143.0`, the Python client published in lockstep with the `@tangle-network/agent-eval` range this package requires.
The previous hints pinned `0.131.0`/`0.133.0`, so following them installed a bridge older than the wire protocol the installed Eval package speaks.

## 0.126.0

### Runtime, Eval, and Knowledge use one truthful cost contract

- Runtime now requires `@tangle-network/agent-eval` `>=0.143.0 <0.144.0` and ships with `@tangle-network/agent-knowledge` `7.0.8`, so the installed stack records observed, estimated, and uncaptured campaign cost without a nested older Eval copy.
- Campaign caches written before Eval 0.143.0 without complete cost provenance stop default reuse.
  Callers may explicitly rerun only invalid cached cells or rerun the full campaign; Runtime does not guess that missing cost is zero.

### Steering policy is registry data; the loop-kernel steering-driver module is deleted

BREAKING. `src/runtime/steering-drivers.ts` is deleted, and with it the kernel exports `steeringDriver`, `naiveDriver`, `dumbDriver`, `SteeringDirectiveData`, `SteeringDecision`, `ApplyContinuation`, `NaiveDriverOptions`, and `DumbDriverOptions`.
The steering POLICY texts stay where the graph reads them — registry data (`delegates/naive-continuation`, `delegates/dumb-continuation-pass` / `-fail` in the kernel prompt registry) a `delegates` edge attaches as versioned directives — so the naive/dumb control policies remain optimizable data rows; only the loop-kernel interpreter function is gone.
`defineLeaderboard`'s per-cell retry — the module's one consumer — is now `naiveRetryDriver` in `define-leaderboard.ts` with identical observable behavior: the same `'naive'` trace name, the same plan/decide semantics (re-run the same case verbatim until a shot is `valid` or the shot cap; `pick-winner` on any valid shot, else `refine` under the cap, `fail` at it), and the same leak-free firewall (reads only `verdict.valid`, never `notes`/`scores`).

Callers to update: anything importing `steeringDriver` / `naiveDriver` / `dumbDriver` from the kernel entry writes the equivalent bare `Driver` literal at its call site (plan: re-issue the task with the continuation folded in until valid or cap; decide: `pick-winner` on any valid shot, else `refine` under the cap, `fail` at it), carrying its continuation texts as its own data or as prompt-registry entries.

### The analyst can be a tool-equipped agent, and graphs watch their workers

An `analyzes` edge may now name a graph NODE as its analyst (`analyst: '<node-id>'`).
On each matching settle, `runGraph` spawns that node's pinned profile as a real WORKER through the same spawn machinery every worker uses (`Scope.spawn` + the `makeWorkerAgent` seam): its task is the edge's registry directive plus the settled worker's tool-trace evidence, its spend reserves from the graph's one conserved budget, its node is journaled and traced like any worker, and its settle OUTPUT is the findings — published and routed per `to` exactly like registry-analyst findings, with the same ledger rows and canonicalization.
Oracle doctrine holds structurally: an analyst node with a delegates edge pointing at it is refused, the driver cannot spawn it (`spawn_agent` still rejects non-worker nodes), an id living in both the registry and the nodes is refused as ambiguous, and an analyzes edge OVER an analyst node is refused because it would silently never fire.

- `AnalyzeOnSettleRoute` gains `agent?: AgentProfile` — the coordination-layer form of the node analyst, usable by direct `supervise()` callers; lens routes still require the `analysts` registry, agent routes do not.
- `WorkerSpawnContext` gains `analyst?: string`, the runtime-authored marker a node-pinning `makeWorkerAgent` reads to admit an analyst run it would refuse as a driver-authored spawn.
- An analyst run's settlement never enters the settled-worker ledger or the finalizer and never re-fires the analyst hook, so an analyst cannot cascade onto itself; a refused analyst spawn publishes `{ analystSpawnRefused }` and a failed run `{ analystRunFailed }` as findings — observable, never silent.

`RunGraphOptions` gains `watchWorkers` (mirroring `SuperviseOptions.watchWorkers`): the online detector panel now runs under `runGraph` with no leaf-seam wiring, raising `finding` events on the coordination bus the moment a live worker loops or error-storms.
`examples/graphs/watchdog-steer.ts` now uses the passthrough, and the new `examples/graphs/analyst-agent-review.ts` shows a tool-equipped reviewer node analyzing an implementer.
The kernel entry additionally exports the `WorkerWatchOptions` type.

Known limit: durable-run resume does not yet compose with analyst-node graphs — an analyst spawned by a prior process settles as an ordinary worker on resume (documented at the in-flight map in `coordination.ts`).

## 0.123.0

### Current shared contracts and honest CLI accounting

- Runtime now develops and publishes against Agent Eval 0.142.2, Agent Interface 0.43.0, Agent Knowledge 7.0.7, the profile materializer 0.10.2, and Sandbox 0.17.2.
- Runtime requires Agent Interface 0.43.x so every package in this release set uses the same profile contract.
- Runtime passes the canonical Agent Interface profile directly through Sandbox now that both packages share the same contract.
- A CLI worker that reports no usage now leaves token and dollar cost unknown instead of recording a measured zero.
- The 0.122.0 agent-graph API, which reached `main` without a published tag, ships in this release.

## 0.122.0

### Agent graphs: loops as data, edges you can audit

`runGraph` (new, `src/runtime/supervise/graph.ts`) runs a typed agent graph — nodes are AgentProfiles, edges are `delegates`/`analyzes` data rows — by composing `supervise()`; there is no second scheduler.
Every traversal lands in an EDGE LEDGER (`delivered | stripped | empty | unpropagated`, with byte counts) on the result and as `edge` events in the run journal, so a directive that never reached its target is an artifact, not a mystery.
Node pinning means a driver cannot smuggle capabilities into a worker it did not define; termination is enforced by a conserved budget plus a mandatory deliverable; delegates caps fail loud via `GraphEdgeCapError` while analyzes caps stay observability-only.
Edge directives resolve through a new versioned prompt registry (`prompts/<surface>/v<n>`, immutable versions, no silent fallback), making every edge a prompt-optimization target.

Consumer-visible changes that pay for this version:

- New dependency `@tangle-network/agent-trace-contract` — `deriveHexId` is now the only trace-id derivation in OTLP export (replaces the internal `padTraceId`).
- Trace propagation reads W3C `TRACEPARENT` first and dual-writes the legacy `TRACE_ID`/`PARENT_SPAN_ID` pair during migration.
- `finding` coordination events are producer-canonicalized to finite RFC 8785 JSON (nested `undefined` stripped; a non-serializable payload becomes a record of that fact), so a digesting subscriber can never make an event vanish.

## 0.121.0

- `pnpm run check:version-bump` (new, in the `ci` job) fails any change that alters a consumer-visible package surface without raising that package's version. Compared: every field npm copies into the published manifest — `exports`, `files`, `bin`, `directories`, `engines`, `typesVersions`, `dependencies`, `peerDependencies`, install-lifecycle `scripts`, `private` — plus the `pnpm-workspace.yaml` catalog pins those resolve through. A `catalog:` specifier is compared by what it RESOLVES to, because a byte-identical `"catalog:"` hiding a moved version is exactly how 0.119.0 shipped its peer range twice. Packages are keyed by name, not path, so relocating one still compares against what that name already published.

### Runtime accepts the current Sandbox release

`@tangle-network/sandbox@0.16.0` was published after Runtime 0.120.0 with execution-bound session controls, but Runtime's peer range still ended below 0.16.0.
An installation that explicitly selected every latest package therefore failed with `ERESOLVE` before application code could run.

Runtime now requires Sandbox `>=0.16.0 <0.17.0`, and its development cohort tests against 0.16.0.
The narrow profile type adapter remains necessary because Sandbox 0.16.0 is compiled against Interface 0.38.0 while Runtime is compiled against Interface 0.40.0; the profile crosses that adapter unchanged as data.

## 0.120.0

### The runtime's own supervision journal is readable again

`src/durable/spawn-journal.ts` writes each supervision event wrapped in an envelope — `{kind:'event', root, event}`. Through agent-eval 0.140.0 `parseSupervisorTree` only understood the flat dialect, so it read `kind` as the literal string `event`, matched no tree event kind, and reported **zero spawns for every journal this package produces**. agent-eval 0.140.1 adds `readJournalRow`, which unwraps that envelope and tags the dialect `runtime-envelope`.

The fix therefore lives in agent-eval, but a consumer only receives it if this package's peer range admits it. The peer floor moves accordingly:

| Peer | 0.119.0 as published | 0.120.0 |
|---|---|---|
| `@tangle-network/agent-eval` | `>=0.139.2 <0.140.0` | `>=0.140.1 <0.141.0` |

`@tangle-network/agent-knowledge` moves `7.0.3` -> `7.0.4` in the same cohort because `scripts/verify-packed-cohort.mjs` asserts that knowledge's own agent-eval dependency EXACTLY equals the packed agent-eval version; `7.0.3` pins `0.139.2` and `7.0.4` pins `0.140.1`.

**Why this needed its own version.** The cohort move landed on main in #697 without a version bump, so main declared `0.119.0` — a version already on the registry carrying the OLD `>=0.139.2 <0.140.0` range. The publish workflow skips a version the registry already has, so re-tagging cannot correct it and the fix could not reach any consumer until this bump.

### Release checks no longer race the clock

- Three release checks no longer infer concurrency or process readiness from sub-second wall-clock sleeps; they wait for the event under test or allow their real container/process boundary to start.
- Candidate cleanup timeout coverage now advances a fake clock and observes the abort signal, while the Git-heavy knowledge activation checks use a process-boundary timeout that survives parallel CI load.

## 0.119.0

### No harness is special: eleven name branches become table rows

BREAKING. `LocalHarness` was a private three-member vocabulary (`'claude' | 'codex' | 'opencode'`) that spelled one harness differently from every other layer in the stack. It is now a narrowing of the shared `HarnessType`: **`'claude'` is renamed to `'claude-code'`**. `claude` remains the EXECUTABLE name and lives only in the harness table's `command` field.

Callers to update: `runLocalHarness({ harness })`, `harnessInvocation(harness, …)`, `runWorktreeHarness({ harness })`, `agenticGenerator({ harness })`, `createInProcessExecutor({ harnesses })`, `AuthoredHarness.harness`, and the `AGENT_RUNTIME_LOCAL_HARNESSES` env list. Anything that passed `'claude'` passes `'claude-code'`; `codex` and `opencode` are unchanged.

Deleting the alias removed `materializerHarness()` outright — a `LocalHarness` is now handed straight to the profile materializer with no translation.

**Reasoning effort now reaches claude-code and opencode.** `runWorktreeHarness` used to hard-REFUSE any profile carrying `model.reasoningEffort` unless the harness was codex, and `harnessInvocation` silently dropped it. Both read one capability table now:

- `claude-code` → `--effort <low|medium|high|xhigh|max>`; canonical `ultracode` is native `max`.
- `opencode` → `--variant <variant>`; canonical `ultracode` is `max`.
- `codex` → `-c model_reasoning_effort="…"`, unchanged.

A level a harness genuinely cannot express is still refused, and the refusal now lands in the pre-flight admission check (before any worktree exists) because the guard and the argv builder read the same rows. claude-code refuses `none` and `minimal` (its `--effort` has no such level); opencode refuses `none` (thinking-off is the absence of the flag).

**Permission bypass is a property of the workspace, not of one CLI.** `dangerouslySkipPermissions` was tested against `'claude'` in four places; three were caller-side duplication of the fourth, which dropped the flag for every other harness with no error. Each harness now declares its own bypass argv:

- `claude-code` → `--dangerously-skip-permissions` (unchanged).
- `codex` → `--sandbox workspace-write -c approval_policy="never"`. NEW: a codex worker in a disposable worktree previously had its bypass request silently dropped. It edits non-interactively now and **keeps its OS sandbox** — writes stay confined to the workspace. `--dangerously-bypass-approvals-and-sandbox` is deliberately NOT used: `codex exec` has no approval gate to stall on (`-a/--ask-for-approval` exists only on the top-level `codex`), so it would surrender the sandbox for nothing, and the sandbox is what keeps a worker's blast radius equal to its worktree.
- `opencode` → nothing; `opencode run` has no approval gate.
- Reproducible Codex is unchanged: its controlled config already pins `approval_policy="never"` with the sandbox intact, so the blanket bypass flag is suppressed rather than layered on top. Reproducible argv is byte-identical to 0.118.0.

**Other name branches replaced by rows, with no behaviour change:**

- `projectCandidateSystemPrompt`'s four-arm `switch (plan.harness)` and its conflicting-argument guard are now one `HARNESS_SYSTEM_PROMPTS` row per harness (executable + projection + conflict predicate). The guard's fail-OPEN default for an unlisted harness is gone: no row means the projection is refused.
- `harness === 'cli-base'` was re-derived at three call sites; it is now `harnessRunsAgent` / `agentHarness` in `src/runtime/harness-role.ts`.
- New exports on `@tangle-network/agent-runtime/mcp`: `DEFAULT_LOCAL_HARNESS`, `LOCAL_HARNESSES`, `localHarnessExecutable`, `harnessSupportsReasoningEffort`.

Deliberately KEPT: the `codexReproducible && harness !== 'codex'` guards (a codex-specific public option asserting caller self-consistency, not behaviour varying by name), and every `ExecutorConfig.backend` switch (a discriminated-union tag naming the materialization contract, not a harness name). Both now say so at the site.

## 0.118.0

Never published: the version bump landed on main but no tag was ever cut, so the registry went 0.117.0 -> 0.119.0. Everything below ships in 0.119.0.

### pi runs through the bridge, like every other harness

BREAKING. The bespoke pi executor is gone. cli-bridge already routes pi generically — `matches(m) => m === 'pi' || m.startsWith('pi/')` — so a second pi-only code path was duplication. A pi worker is now `createExecutor({ backend: 'bridge', bridgeUrl, bridgeBearer, model: 'pi/<provider>/<model>' })`, the same call every other harness uses.

Removed public exports: `piExecutor`, `PI_RUNTIME`, `piSeamKey`, `PiSeam`, `PiExecutorOutput`, `preparePiMcp`, `piMcpAdapterAvailable`, `buildPiMcpServers`, `PI_MCP_ADAPTER`, `PI_MCP_ADAPTER_ENV`, `PI_MCP_CONFIG_FLAG`, `PiMcpMount`, `PiMcpMountOptions`, `PiMcpPreparation`, `PiMcpReceipt`. The `{ backend: 'pi' }` arm of `ExecutorConfig` is removed, and the executor registry no longer pre-registers a `'pi'` runtime.

What the bridge path does BETTER, and the old executor dropped outright:

- `profile.model.reasoningEffort` is lowered to pi's `--thinking`.
- `profile.tools` is lowered to `--exclude-tools`.
- `profile.resources` (context / skills / commands / subagents / instructions) is materialized into the run directory.
- `profile.prompt.systemPrompt` is passed as a native `--system-prompt` file instead of being prepended to the task text.
- Consequently a pi backend is now held to `fullProfileMaterialization` in `workerFromBackend`, not the prompt-and-model-only contract. A profile that changes axes the old executor silently dropped is now honored rather than rejected.

What the bridge path does NOT do today, stated so no consumer is surprised:

- `Executor.progress()` and `Executor.traceSource()` are absent on `bridgeExecutor`. This is missing for every harness on the bridge, not only pi; tracked as #683.
- Mid-turn steering degrades. The bridge runs pi as `--print --mode json` with stdin closed, so a steer lands after the current run rather than at the next turn boundary, and an interrupt is a process-tree kill rather than pi's non-destructive injection.
- `PiSeam.args`, `PiSeam.env`, and a per-worker `bin` have no wire equivalent. A caller that pinned a specific pi binary or injected per-worker environment must configure it on the bridge server instead.
- `WORKER_TRACE_PROPAGATION` loses its `pi: true` row. The bridge has no environment channel to the worker, so a pi worker no longer inherits `TRACE_ID`/`PARENT_SPAN_ID` — honestly unpropagated rather than silently dropped, same as the other bridge-dispatched arms.
- MCP for pi is now the bridge's concern. agent-runtime no longer writes a `--mcp-config` file or checks for the `pi-mcp-adapter` extension.

Known consumers to migrate, none broken until they upgrade:

- `loops` — `src/pi-worker.ts` and `extensions/pi/loops.ts`. The largest migration: `pi-worker.ts` builds the executor directly, and steering is the part that changes behaviour rather than just call shape. Pinned at 0.111.0.
- `supervisor-lab` — `bench/deepswe/live.ts:193`. A single `backend: 'pi'` in a benchmark rig; a call-shape change. Pinned at 0.116.0.
- `agent-eval-runtime-run-reader` — two test files reference the pi backend.

## 0.117.0

- Run every supervisor, including the root, from one complete `AgentProfile`, preserve exact profile/task/candidate identity through recursive delegation, and reject execution paths that would silently drop profile fields.
- Expose node-scoped product tools, product authorization for exact spawns and continuations, awaited replay-safe coordination observation, structured worker traces, trace-derived failure guidance, and caller cancellation across the complete recursive run.
- Make durable run and assignment identity stable across restart while retaining exact materialization, accounting, delivery, and settlement evidence for each node.
- Add live root-manager steering, trusted post-authorization manager/leaf classification, per-assignment completion checks, a cold recursive forest reader, and public exact-profile candidate conversion helpers.

## 0.116.0

### A supervisor tree spans machines

- When span recording is on, a spawned worker's environment carries `TRACE_ID` and `PARENT_SPAN_ID` — the run's trace and the span of the node that spawned it — using the env-var convention `mcp/trace-propagation.ts` already ships and already reads. A worker on a remote sandbox emits spans that join its parent's trace, so one tree assembles across machines with no viewer change and no second propagation format.
- At depth the parent is the IMMEDIATE spawning driver's span, not the root's, so a deep tree nests correctly rather than flattening.
- A caller that sets its own `TRACE_ID`/`PARENT_SPAN_ID` wins; theirs is never overwritten.
- Off when recording is off: no stamping, no behavior change.
- `WORKER_TRACE_PROPAGATION` states which backend arms carry the context — `pi`, `cli`, and `sandbox` do; `router`, `router-tools`, `bridge`, `cli-worktree`, and `provider` have no environment channel to a worker and say so rather than dropping silently. It is `satisfies Record<ExecutorConfig['backend'], boolean>`, so a ninth arm cannot be added without classifying it.

## 0.115.1

### A failed reconcile no longer strands the child's reservation

- Every fail-loud path in `BudgetPool.reconcile` threw BEFORE `open.delete(ticket.id)`, so a child that overspent any channel left its whole reservation open — `assertNoOpenTickets` then failed the run at the join barrier, on the SUCCESS path. Reconcile now decides the violation, settles unconditionally in straight-line arithmetic that cannot throw, and raises last. The assertion is unchanged: it is what caught this.
- Over-spend paths now commit the ACTUAL spend and let `free` go honestly negative, keeping `total ≡ free + reserved + committed` exact, rather than stranding a reservation at its ceiling forever.
- A child that declares no `maxUsd` is no longer read as declaring a `$0` ceiling. `ReservationTicket.reserved.usdBudgeted` records whether a ceiling was actually declared; an undeclared child's real dollars are committed and debited from a capped root's balance — the same treatment `observe()` already gives driver inference — so the cap stays enforceable and admission still closes once it is crossed. The field is optional and reads as `true` when absent, so a hand-built ticket keeps the strict reading.
- `usdKnown`, `usdTainted`, and `tokensKnown` semantics are untouched, verified byte-identical against the previous release for every uncapped-root case.

## 0.115.0

### A supervisor tree is an OTLP trace

- `supervise({ otel })` records the whole recursion as OTLP spans: one span per node, opened at spawn and closed at settle, parented so arbitrary depth nests correctly, with driver inference as LLM child spans under whichever node metered it. Off unless `otel` is passed — a run that omits it allocates no recorder and is byte-identical to before.
- Built as a pure `RuntimeHooks` observer over events `scope.ts` already emits, through the existing `otel-export.ts`. No second exporter, no new event, no change to the journal or to `supervise`'s result. `makeNestedScopeSeam` already re-seeds hooks into nested scopes, so one observer sees the whole tree.
- The trace id derives deterministically from `runId`, so a RESUMED run rejoins its own trace instead of forking a new one; a caller may supply a 32-hex id to join an outer trace.
- Attributes reuse the vocabulary already in use (`openinference.span.kind`, `agent.name`, `inference.*`, `llm.token_count.*`), with supervisor-specific facts namespaced under `tangle.supervise.*`.
- **Unknown is never zero**: a spend carrying `tokensKnown: false` or `usdKnown: false` emits NO token or cost attribute and sets the corresponding `tangle.supervise.*_known` flag to false instead.
- Telemetry cannot fail the work: an exporter that throws, rejects, or is a hostile proxy leaves the run's result unchanged. A node still open at finish is closed as unsettled rather than dropped.
- `supervise` also gains a general `hooks` passthrough; it could not reach `SupervisorOpts.hooks` at all before.

### pi MCP tools register natively

- Servers written for pi carry `directTools: true`, registering their tools as native pi tools instead of leaving them behind the generic `mcp` tool. Without it an agent must connect to the server and describe each verb before calling one: a measured run spent 58 turns and 639,632 input tokens on that discovery before it could delegate once. The same fix is in cli-bridge's pi materializer, so both writers agree.

### Cached prompt tokens are priced as cached

- The router reports a `prompt_cache` block (`read_tokens`, `write_tokens`, `read_savings_usd`) that this client discarded, so a cached prefix was billed at full local price. `PromptCacheUsage` now carries it and the reported saving is subtracted from the local estimate rather than a discount being re-derived here. A supervisor re-sends a growing transcript every turn, so this is most of a long run's real cost.
- Absent cache reporting stays absent — an unreported cache is not a miss, and a miss is not a zero saving.

## 0.114.0

Two changes found by running a real recursive pursuit rather than by reading code: the supervisor's brain could not stream, and the `pi` backend silently discarded almost every profile dimension it was handed.

### The router-brained supervisor can stream

- `RouterConfig.stream` opts a supervisor turn into SSE. `streamRouterChatWithTools` accumulates `delta.content`, `delta.reasoning_content`, and index-keyed `delta.tool_calls`, then returns the same `RouterChatToolsResult` the buffered call does. The buffered path is unchanged and remains the default.
- Why it matters: every supervisor turn was one buffered POST that had to complete in full before a byte came back, which is what an origin idle-timeout kills. Six live runs died that way.
- Usage accounting is preserved across both transports through one shared metering helper. A stream that ends with no usage chunk sets `usageUnknown`, so a broken `include_usage` contract is distinguishable from a brain that never reports usage — never a silent free turn.
- `stream: true` together with the buffered `complete` seam throws rather than quietly taking the buffered path.

### A driver turn is always metered

- **BREAKING (behavior):** the `if (res.usage || res.costUsd !== undefined)` guard is gone, so every driver turn reaches `scope.meter`. A turn that reported nothing is metered as an UNKNOWN turn (`tokensKnown: false`, following the existing `usdKnown` precedent) instead of being skipped as free. Under a root budget declaring `maxUsd`, an unknown-cost turn now fails the run loudly rather than accruing zero — a scripted or mock brain that reports no usage under a dollar cap will newly surface `driver-failed`.
- `BudgetReadout.tokensKnown` and `Scope.budget.tokensKnown` are optional additions: present and `false` once a settled turn reported no tokens, meaning `tokensLeft` is a ceiling rather than a measurement.
- Known limitations, documented in place at `coordination-driver.ts` and `types.ts`: a turn that THROWS is still unmetered, the compaction distiller's catch swallows one turn's cost, and `UsageEvent` has no tokens-unknown variant so a streaming executor cannot yet report one.

### The `pi` backend materializes MCP

- A profile's `mcp` servers now reach pi. pi ships no MCP of its own: support comes from the `pi-mcp-adapter` extension, so the executor writes a canonical `{mcpServers}` config and passes it with `--mcp-config`, and injects the adapter into the resolved extension load list when a profile declares MCP without naming it. The injection is reported on `progress().derived`, which survives a failed run.
- Fail closed: a profile declaring MCP when the adapter is not installed throws before pi is spawned, naming the adapter and where it was sought. Previously the run started tool-less and scored zero for the wrong reason — observed live, where a root spent 545,095 tokens over 54 turns hunting for a `spawn_agent` verb it had never been given.
- One config file per worker execution, written to the OS temp directory and removed on both the settle and error paths. Deriving it from the seam's `cwd` would have made two concurrent workers collide on one file, and would have left scratch state inside the workspace the worker operates on.
- A profile with no MCP is unchanged: no file, no flag, no injected extension.

## 0.113.1

### A router-brained supervisor can raise its completion ceiling

- `RouterConfig` gains `maxTokens`, forwarded by `routerBrain` to the tool-calling completion. It was previously unreachable: `routerBrain` passed only `temperature` and `toolChoice`, and `SuperviseOptions.router` takes a `RouterConfig`, so no caller could set it.
- Why it matters: a reasoning model spends the ceiling on hidden thinking BEFORE emitting a visible token. Observed twice in a row on a live run — the model spent 8,188 tokens on hidden reasoning, hit the provider ceiling, and returned no content, so the supervisor failed with a truncation error it had no way to prevent. A thinking model was effectively unusable as a router-brained supervisor.
- The tool-calling path still sends no `max_tokens` when the config names none, leaving the provider's own default in charge; this adds a knob rather than changing a default.

## 0.113.0

### A refused spawn says which kind of refusal it is

- `budget-exhausted` no longer covers two opposite conditions. A dollar request against a root that declares no `maxUsd` is refused as **`usd-unbudgeted`**: unsatisfiable at any amount, cleared only by giving the ROOT a dollar ceiling. A genuinely depleted balance keeps `budget-exhausted`, which a smaller request may still fit.
- `spawn_agent` returns an actionable `hint` alongside `usd-unbudgeted`, telling the driver that retrying smaller will fail identically.
- Found live: a root agent tried to spawn one child, read `budget-exhausted`, correctly ruled out the concurrency fence from `freeSlots: 2`, walked its child's `maxUsd` down to $0.01, failed identically every time, and spent 68,546 tokens ($0.061) before stopping to ask its caller for help. The rule was right and the diagnosis was impossible.
- **BREAKING:** `SpawnRejection` gains `'usd-unbudgeted'`, so an exhaustive `switch` over it must handle the new member. A caller that branched on `'budget-exhausted'` to detect this case must branch on `'usd-unbudgeted'` instead. `ReservationRejection` is exported for the pool's own two-member result.

## 0.112.0

The supervisor's public contract closes six gaps found by running a real recursive pursuit against the published stack. Four of the changes below are BREAKING for a consumer on 0.111.x; each names the migration.

### The root accepts a canonical AgentProfile

- `SupervisorProfile.model` accepts `string | AgentProfileModelHints`, and `SupervisorProfile` accepts a canonical `prompt` block. A caller passing an `AgentProfile` previously had its `model` object forwarded verbatim into `RouterConfig.model` (a string), producing a request the provider rejects, and its `prompt.systemPrompt` silently ignored.
- New exported `resolveSupervisorProfile(profile)` normalizes the two spellings with one documented precedence: a string `model` is the id, an object `model` resolves to `default`, and `prompt.systemPrompt` outranks the top-level spelling. Hints that name no id are the documented "profile names no model" case — the router config's model applies — because `AgentProfileModelHints.default` is optional upstream.
- `prompt.instructions` and `resources.instructions` are appended to the active prompt rather than dropped. A profile naming only instructions keeps the arm's standing prompt and appends to it.
- Two system prompts that are both set and differ throw, rather than one silently winning.
- **BREAKING (type, read position):** `SupervisorProfile.model` is no longer `string`. Consumer code that reads it back — including from the `DriveHarness` argument — must narrow, or call `resolveSupervisorProfile(profile).modelId`.
- **BREAKING (new throw):** a caller that previously passed a canonical profile and had its extra fields ignored may now throw on two disagreeing prompts, or on a `github` instructions ref that cannot be materialized while building a supervisor synchronously.

### `DriveHarness` receives the resolved prompt

- The harness argument object gains `systemPrompt?: string`. The profile is handed through by identity and never spread with an injected top-level key, so a canonical profile stays valid under `agentProfileSchema`.

### Code-valued run options can be named

- `deliverable`, `finalizer`, `analysts`, and `probes` each additionally accept a `string` name resolved against a new `SuperviseOptions.registry`, whose four tables are resolver ports (`{ resolve(name) }`) matching `WaitProbeRegistry` — so a recorded run configuration names what it wants and the caller binds the implementation, and a table with a thousand entries constructs nothing it does not use.
- An unknown name and a name with no table both throw `ConfigError` naming the option and the requested name.
- **BREAKING (type, read position):** these four option types are widened with `| string`; a wrapper that reads a field back off `SuperviseOptions` must narrow.

### The coordination server fails closed on a remote bind

- `SuperviseOptions.coordination` carries `{ host?, port?, allowUnauthenticatedRemote? }`, and the rule is enforced inside `serveCoordinationMcp` itself, not only at the composition sites: the verbs mount `spawn_agent`/`steer_agent`/`stop` with no authentication, so a non-loopback bind lets anyone who reaches the port spend the run's budget. A non-loopback host now requires an explicit `allowUnauthenticatedRemote: true`.
- A coordination binding on a router-brained supervisor throws: that arm serves no MCP, so the binding would be silently ignored.
- **BREAKING (new throw on a public export):** `serveCoordinationMcp({ …, host: '0.0.0.0' })` bound and listened on 0.111.0; it now throws `ConfigError` unless the exposure is acknowledged.

### `spawn_agent` publishes the child-profile shape

- The tool's `profile` parameter carries a JSON Schema derived from the canonical `agentProfileSchema` with a description on every published field, instead of one line of prose. A spawning root is told what a child profile looks like.
- The schema is computed on first tool-definition access rather than at module load, and a renamed upstream field degrades the published shape instead of throwing at import — a tool description must never brick `import '@tangle-network/agent-runtime/kernel'`.
- The published object is deep-frozen: one memoized schema is shared by every coordination toolbox in the process.

### The driver's error survives

- BEHAVIORAL CHANGE — `SupervisedResult`'s no-winner result gains a fourth reason, `driver-failed`, and splits into a discriminated union. A run whose driver `act()` rejected with no child ever having gone down and no breaker/abort/budget cause previously returned `reason: 'all-children-down'` with `downCount: 0`; it now returns `reason: 'driver-failed'` carrying a required `error: NoWinnerError` (`{ name, message, stack? }`, with a non-`Error` rejection normalized to `{ name: 'NonError', message }`). Two consequences for consumers: an exhaustive `switch` over `reason` no longer compiles until it handles `'driver-failed'`, and any code that keyed off `all-children-down` to detect a failed driver must key off `driver-failed` instead. The `all-children-down`, `aborted`, and `budget-exhausted` arms are unchanged and declare `error?: never` — a driver rejection outranked by one of those lifecycle causes is not carried on the result. Precedence is unchanged otherwise: breaker, abort, budget exhaustion, and a real `down` child all still outrank `driver-failed`.
- Export `NoWinnerError` from the runtime entrypoint (`./runtime`, alongside `SupervisedResult`) so a consumer handling `reason: 'driver-failed'` names the shape instead of retyping `{ name; message; stack? }`.

### Configuration faults throw `ConfigError`

- **BREAKING:** the registry and coordination-binding guards throw `ConfigError`, matching `assertModelAllowed`, rather than `ValidationError`. A caller catching `ValidationError` for configuration faults should catch `ConfigError`.

## 0.111.0

- Publish the supervisor-run persistence contract (`<root>/.agent/supervisor/<id>` — the one dot-dir for agent-owned state; pre-rename runs under `.loops/…` stay readable via `legacySupervisorRunDir`) that `traces analyze --supervisor-run-dir` reads: run-dir and inbox paths, steer records, and tolerant NDJSON reads.
- Add `copyUntrackedIntoClone` and `withUntrackedArtifacts` so worker clones carry the source working tree's untracked build artifacts without ever committing them back to the shared ref.
- Add `composeWorkerEvidence`, `settledWorkerOut`, and `closingWorkerNote` — the bounded settle-evidence composers for the exported `CompletionEvidence` discipline.
- Repair the publish cohort checkouts to the versions the catalog already demands (Interface 0.40.0, Eval 0.139.2, Knowledge 7.0.3); the v0.110.0 tag failed release verification on the stale pins and never reached npm.

## 0.110.0

- Align Runtime with the current published stack: agent-eval 0.138.0, agent-interface 0.40.0, agent-knowledge 7.0.0; peer ranges widen to eval `>=0.138.0 <0.139.0` and interface `>=0.40.0 <0.41.0`.
- Adopt interface 0.40 `AgentProfileConfigValue` for MCP server `args`/`env`: `resolveMcpServerLaunch` resolves public values and env secret-refs through the KeyProvider fail-closed (with `bearer` formatting), refuses secret-refs in argv, and rejects an env var declared secret on both the env and legacy metadata channels.
- Candidate profile freeze/thaw preserves config values instead of unwrapping them to schema-invalid strings; certified intelligence bindings wrap through `defineAgentProfilePublicConfig`.
- Implement eval 0.138's `TraceAnalysisStore` contract on the iterations store: real `hasTrace`/`hasSpans`, byte-ceiling span continuation (`omitted_span_ids`/`has_more`), and `total_matches` removed from search results.
- Sandbox 0.15.2 remains typed against interface 0.36; profiles cross that boundary as data through one commented adapter pair (`profileAsSandboxProfile`), to be removed when sandbox releases against 0.40.

## 0.109.2

- Align Runtime with Eval 0.135.2 and Knowledge 6.1.11 so every improvement path uses the corrected paired promotion decisions.

## 0.109.1

- Move `runToolLoop` and `streamToolLoop` to the Worker-safe `@tangle-network/agent-runtime/tool-loop` entrypoint.
- Keep the tool-loop bundle free of static external imports and exercise the exact packed entrypoint before publishing.

## 0.109.0

- Rename the public `./loops` entrypoint to `./kernel` and remove the old entrypoint.
- Export the kernel's main execution types from the package root for discovery without adding root runtime weight.
- Align Runtime with Eval 0.135.1 and Knowledge 6.1.10.

## 0.108.1

- Align Runtime with Eval 0.134.2 and Knowledge 6.1.8 so every knowledge and runtime evaluation uses complete multishot judge cost accounting.
- Retain both judge scores and cost records in the self-improving-loop example.
- Declare temporary TypeScript coding workspaces as ESM so their real tests run on Node 24.

## 0.108.0

- Add the edge-safe `@tangle-network/agent-runtime/durable` entrypoint for resumable chat turns with stable retry identities.
- Resume built-in supervised runs without repeating completed keyed work, while carrying prior settlements, questions, findings, wait deadlines, output trees, and spent budget into the new process.
- Add pluggable finalization with built-in best-output and collect-all modes, and prevent finalizers from reading outputs that did not pass completion checks.
- Require profile-improvement proposals to cite typed findings with explicit search or production origin.
- Serialize Git worktree metadata changes per repository while keeping candidate evaluation parallel.
- Align Runtime with Eval 0.134.1, Interface 0.36.0, Knowledge 6.1.7, Materialize 0.9.2, and Sandbox 0.15.2.

## 0.107.5

- Replace the invalid paired t-test in benchmark reports with `@tangle-network/agent-eval`'s cross-checked Wilcoxon signed-rank test.
- Report non-zero pairs, test method, attainable p-value floor, raw p-value, adjusted q-value, and explicit ties for every profile comparison.
- Align Runtime with `@tangle-network/agent-eval` 0.133.3 and `@tangle-network/agent-knowledge` 6.1.5, and derive packaged comparison sizes from Eval's minimum.

## 0.107.4

- Pack `@tangle-network/agent-interface` from its exact source commit alongside Eval, Knowledge, and Runtime before merge and publish.
- Align Runtime with `@tangle-network/agent-eval` 0.133.2 and `@tangle-network/agent-knowledge` 6.1.4.
- Resolve local archive overrides at the pnpm workspace root for nested packages.

## 0.107.3

- Add public proposal and private activation fixtures for profile-improvement consumer tests.
- Verify the exact Eval, Knowledge, and Runtime package archives together before merge and publish.
- Align the tested package cohort with `@tangle-network/agent-eval` 0.133.1, `@tangle-network/agent-knowledge` 6.1.3, and `@tangle-network/sandbox` 0.15.1.

## 0.107.2

- Align Runtime's tested Sandbox dependency and public peer contract with `@tangle-network/sandbox` 0.15.0.

## 0.107.1

- Add a budget-bound profile improvement cycle that turns trace findings into exact, reviewable profile proposals.
- Preserve one shared cost budget and the final-test split through analysis, optimization, measurement, review, and activation.
- Align Runtime with `@tangle-network/agent-eval` 0.133.0, `@tangle-network/agent-interface` 0.36.0, and `@tangle-network/agent-knowledge` 6.1.2.
- Check the packed `proposeAgentProfileImprovement` export so the public entrypoint cannot disappear silently.

## 0.106.0

- Align Runtime with `@tangle-network/agent-eval` 0.131.0, `@tangle-network/agent-interface` 0.35.0, `@tangle-network/agent-knowledge` 6.1.1, `@tangle-network/agent-profile-materialize` 0.9.0, and `@tangle-network/sandbox` 0.14.0.
- Require maintained Node 22.13 or newer, use pnpm 11.17.0, and use the newest TypeScript supported by TypeDoc.
- Require the matching Runtime peer ranges so incompatible consumers fail installation instead of mixing profile contracts.
- Record the exact tool-step count in candidate receipts and validate optimizer evidence on both candidate and profile comparisons.
- Reject secret values hidden in Sandbox passthrough options and rank measured cost ahead of unknown cost when quality ties.
- Remove `reportLoopUsage`; campaign integrations must use `loopDispatch` or `loopCampaignDispatch` so Eval admits paid work before execution and records its receipt.

## 0.105.0

- Add `officialGepa(...)` and `officialSkillOpt(...)` as Runtime adapters over the upstream GEPA and Microsoft SkillOpt implementations in `@tangle-network/agent-eval`.
- Require one complete `OptimizationMethod` for profile improvement and keep final-test scenarios outside optimizer input.
- Authorize every exact execution-capable profile candidate before it reaches an agent.
- Preserve resumed optimizer spend, model identity, package provenance, and separate optimization versus final-test costs in activation receipts.
- Verify released Python packages, pinned source revisions, resume behavior, concurrency, and packed external installs in CI.
- Keep code improvement on Runtime-owned isolated Git worktrees.
- Remove the retired local prompt, profile-diff, campaign OTLP, and record-only optimizer paths.
- Require `@tangle-network/agent-eval` 0.126.x.

## 0.104.0

- Add the Tangle Sandbox exact-process environment provider for verified candidate execution.

## 0.103.1

- Declare and test compatibility with `@tangle-network/agent-eval` 0.125.x; runtime behavior is unchanged.
